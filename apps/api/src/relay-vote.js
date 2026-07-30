import { Contract, Interface } from 'ethers';
import { VOTE_EVENT_ABI } from '@pv/shared';
import { config } from './config.js';
import { query } from './db.js';
import { errorText, permanentError } from './errors.js';
import { updateJob } from './jobs.js';
import { broadcastTransaction, prepareTransaction } from './relayer.js';
import { provider, relayer } from './rpc.js';

const iface = new Interface(VOTE_EVENT_ABI);

function voteLog(receipt, contractAddress) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'VoteCast') return parsed;
    } catch {}
  }
  return null;
}

export async function relayVote(job) {
  const found = await query(
    `SELECT e.*,v.voter_address,v.snapshot_balance,v.choices_hex,v.signature,v.status AS vote_status,
            v.transaction_hash,se.merkle_proof
     FROM events e JOIN votes v ON v.event_id=e.id AND v.voter_address=$2
     JOIN snapshot_entries se ON se.event_id=e.id AND se.wallet_address=v.voter_address
     WHERE e.id=$1`,
    [job.event_id, job.voter_address],
  );
  if (!found.rowCount) throw permanentError('Vote, event, or snapshot proof no longer exists.');
  const row = found.rows[0];
  if (row.vote_status === 'CONFIRMED') return { transactionHash: row.transaction_hash, alreadyComplete: true };
  if (!row.contract_address || row.deployment_block === null) throw new Error('VoteEvent deployment is not complete.');

  const args = [row.voter_address, BigInt(row.snapshot_balance), row.merkle_proof, row.choices_hex, row.signature];
  const contract = new Contract(row.contract_address, VOTE_EVENT_ABI, relayer);
  await updateJob(job.id, 12, 'Validating signed ballot');
  try { await contract.castVote.staticCall(...args); }
  catch (error) { throw permanentError(`VoteEvent rejected the ballot: ${errorText(error)}`); }
  const prepared = await prepareTransaction({
    job, eventId: row.id, voterAddress: row.voter_address, type: 'RELAY_VOTE',
    request: { to: row.contract_address, data: iface.encodeFunctionData('castVote', args) },
    onPrepared: async (client, tx) => {
      await client.query(
        `UPDATE votes SET status='SUBMITTED',transaction_hash=$3,failure_reason=NULL WHERE event_id=$1 AND voter_address=$2`,
        [row.id, row.voter_address, tx.transaction_hash],
      );
    },
  });
  await updateJob(job.id, 55, 'Ballot submitted to Polygon Amoy', { transactionHash: prepared.transaction_hash });
  const receipt = await broadcastTransaction(prepared);
  if (Number(receipt.status) !== 1) throw permanentError('Vote transaction reverted.');
  const parsed = voteLog(receipt, row.contract_address);
  if (!parsed || parsed.args.voter.toLowerCase() !== row.voter_address) throw permanentError('VoteCast receipt could not be validated.');
  await query(
    `UPDATE votes SET status='CONFIRMED',transaction_hash=$3,block_number=$4,failure_reason=NULL WHERE event_id=$1 AND voter_address=$2`,
    [row.id, row.voter_address, receipt.hash, receipt.blockNumber],
  );
  await updateJob(job.id, 95, 'Vote confirmed');
  return {
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    votingPower: parsed.args.votingPower.toString(),
    transactionExplorerUrl: `${config.explorerUrl}/tx/${receipt.hash}`,
    contractExplorerUrl: `${config.explorerUrl}/address/${row.contract_address}#code`,
  };
}
