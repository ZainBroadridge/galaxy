import { Transaction, getCreateAddress } from 'ethers';
import { config } from './config.js';
import { query, transaction, withAdvisoryLock } from './db.js';
import { errorText } from './errors.js';
import { provider, relayer } from './rpc.js';

async function existing(jobId) {
  const result = await query('SELECT * FROM relayer_transactions WHERE job_id=$1', [jobId]);
  return result.rows[0] ?? null;
}

async function nextNonce() {
  const [network, reserved] = await Promise.all([
    provider.getTransactionCount(relayer.address, 'pending'),
    query('SELECT max(nonce) AS nonce FROM relayer_transactions'),
  ]);
  const maximum = reserved.rows[0].nonce === null ? -1 : Number(reserved.rows[0].nonce);
  return Math.max(network, maximum + 1);
}

export async function prepareTransaction({ job, eventId, voterAddress = null, type, request, predictContract = false, onPrepared = async () => {} }) {
  const found = await existing(job.id);
  if (found) return found;
  return withAdvisoryLock('pv-v2-relayer-nonce', async () => {
    const rechecked = await existing(job.id);
    if (rechecked) return rechecked;
    const nonce = await nextNonce();
    const populated = await relayer.populateTransaction({ ...request, chainId: config.chainId, nonce });
    if (populated.gasLimit) populated.gasLimit = (populated.gasLimit * 120n) / 100n;
    const raw = await relayer.signTransaction(populated);
    const parsed = Transaction.from(raw);
    const hash = parsed.hash;
    const predicted = predictContract ? getCreateAddress({ from: relayer.address, nonce }).toLowerCase() : null;
    return transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO relayer_transactions(job_id,event_id,voter_address,type,nonce,transaction_hash,raw_transaction,predicted_contract_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [job.id, eventId, voterAddress, type, nonce, hash, raw, predicted],
      );
      await onPrepared(client, inserted.rows[0]);
      return inserted.rows[0];
    });
  });
}

function known(error) {
  const text = errorText(error).toLowerCase();
  return ['already known','known transaction','nonce too low','already imported','replacement transaction underpriced'].some((value) => text.includes(value));
}

export async function broadcastTransaction(row) {
  let receipt = await provider.getTransactionReceipt(row.transaction_hash);
  if (!receipt) {
    try {
      await provider.broadcastTransaction(row.raw_transaction);
      await query("UPDATE relayer_transactions SET status='BROADCAST',error=NULL WHERE id=$1", [row.id]);
    } catch (error) {
      receipt = await provider.getTransactionReceipt(row.transaction_hash).catch(() => null);
      if (!receipt && !known(error) && !(await provider.getTransaction(row.transaction_hash).catch(() => null))) {
        await query('UPDATE relayer_transactions SET error=$2 WHERE id=$1', [row.id, errorText(error).slice(0, 4000)]);
        throw error;
      }
    }
  }
  receipt ??= await provider.waitForTransaction(row.transaction_hash, 1, config.transactionWaitTimeoutMs);
  if (!receipt) throw new Error(`Transaction ${row.transaction_hash} is still pending.`);
  const status = Number(receipt.status) === 1 ? 'CONFIRMED' : 'REVERTED';
  await query(
    'UPDATE relayer_transactions SET status=$2,receipt=$3::jsonb,error=NULL WHERE id=$1',
    [row.id, status, JSON.stringify({ hash: receipt.hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, status: Number(receipt.status), contractAddress: receipt.contractAddress })],
  );
  return receipt;
}
