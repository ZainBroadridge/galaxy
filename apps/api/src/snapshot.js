import { getAddress, toQuantity } from 'ethers';
import { ZERO_ADDRESS, buildSnapshotTree } from '@pv/shared';
import { config } from './config.js';
import { query, transaction } from './db.js';
import { permanentError } from './errors.js';
import { enqueueJob, updateJob } from './jobs.js';
import { erc20Interface, rpc, rpcBlock } from './rpc.js';
import { tokenDeployment } from './tokens.js';

const zero = ZERO_ADDRESS.toLowerCase();
const transferTopic = erc20Interface.getEvent('Transfer').topicHash;
const MAX_LOG_BLOCK_RANGE = 10_000;
const MIN_LOG_BLOCK_RANGE = 1;
const LOG_RANGE_GROW_THRESHOLD = 1_000;

async function resolveRecordBlock(recordDateAt) {
  const latest = Number(BigInt(await rpc('eth_blockNumber', [])));
  const safeNumber = Math.max(0, latest - config.confirmations);
  const safe = await rpcBlock(safeNumber);
  const requested = Math.floor(new Date(recordDateAt).getTime() / 1000);
  const target = Math.min(requested, safe.timestamp);
  let low = 0;
  let high = safeNumber;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const block = await rpcBlock(middle);
    if (block.timestamp <= target) low = middle;
    else high = middle - 1;
  }
  return rpcBlock(low);
}

function normalizeAddress(value) {
  try { return getAddress(value).toLowerCase(); } catch { return null; }
}

function applyTransfer(balances, from, to, value) {
  if (value === 0n) return;
  if (from && from !== zero) balances.set(from, (balances.get(from) ?? 0n) - value);
  if (to && to !== zero) balances.set(to, (balances.get(to) ?? 0n) + value);
}

function isLogRangeError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return error?.rpcCode === -32005
    || error?.httpStatus === 413
    || message.includes('query timeout')
    || message.includes('more than 10000 results')
    || message.includes('too many results')
    || message.includes('block range')
    || message.includes('range is too large')
    || message.includes('response size')
    || message.includes('limit exceeded');
}

async function transfersAt(tokenAddress, startBlock, recordBlock, jobId) {
  const balances = new Map();
  const seen = new Set();
  const totalBlocks = Math.max(1, recordBlock - startBlock + 1);
  let fromBlock = startBlock;
  let blockRange = Math.min(MAX_LOG_BLOCK_RANGE, totalBlocks);
  let requests = 0;

  while (fromBlock <= recordBlock) {
    const toBlock = Math.min(recordBlock, fromBlock + blockRange - 1);
    let logs;

    try {
      logs = await rpc(
        'eth_getLogs',
        [{
          address: tokenAddress,
          fromBlock: toQuantity(fromBlock),
          toBlock: toQuantity(toBlock),
          topics: [transferTopic],
        }],
        { retries: 1 },
      );
      if (!Array.isArray(logs)) throw new Error('eth_getLogs returned an invalid response.');
    } catch (error) {
      if (!isLogRangeError(error)) throw error;
      if (blockRange === MIN_LOG_BLOCK_RANGE) {
        throw permanentError(`The ERC-20 emitted too many Transfer logs in block ${fromBlock} for the RPC log limit.`);
      }
      blockRange = Math.max(MIN_LOG_BLOCK_RANGE, Math.floor(blockRange / 2));
      continue;
    }

    for (const log of logs) {
      if (log.removed) continue;
      const key = `${log.blockHash ?? log.blockNumber}:${log.transactionHash}:${log.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let decoded;
      try {
        decoded = erc20Interface.decodeEventLog('Transfer', log.data, log.topics);
      } catch {
        throw permanentError(`Unable to decode ERC-20 Transfer log ${key}.`);
      }

      applyTransfer(
        balances,
        normalizeAddress(decoded.from),
        normalizeAddress(decoded.to),
        BigInt(decoded.value),
      );
    }

    requests += 1;
    fromBlock = toBlock + 1;
    const completedBlocks = Math.min(totalBlocks, fromBlock - startBlock);
    const progress = Math.min(55, 10 + Math.round((completedBlocks / totalBlocks) * 45));

    if (requests === 1 || requests % 10 === 0 || fromBlock > recordBlock) {
      await updateJob(
        jobId,
        progress,
        `Read ${seen.size.toLocaleString()} ERC-20 transfers`,
      );
    }

    if (logs.length < LOG_RANGE_GROW_THRESHOLD) {
      blockRange = Math.min(MAX_LOG_BLOCK_RANGE, blockRange * 2);
    }
  }

  return { balances, transferCount: seen.size };
}

async function totalSupplyAt(tokenAddress, blockNumber) {
  const data = erc20Interface.encodeFunctionData('totalSupply');
  const raw = await rpc('eth_call', [{ to: tokenAddress, data }, toQuantity(blockNumber)]);
  if (!raw || raw === '0x') {
    throw permanentError('The token did not expose totalSupply at the selected record date.');
  }
  try {
    return erc20Interface.decodeFunctionResult('totalSupply', raw)[0];
  } catch {
    throw permanentError('The token returned an invalid totalSupply value at the selected record date.');
  }
}

async function reuseSnapshot(event, block, jobId) {
  const cached = await query(
    `SELECT id,snapshot_root,snapshot_holder_count
       FROM events
      WHERE id<>$1 AND token_address=$2 AND record_date_block=$3
        AND vote_unit=$4 AND snapshot_root IS NOT NULL
      ORDER BY updated_at DESC LIMIT 1`,
    [event.id, event.token_address, block.number, event.vote_unit],
  );
  if (!cached.rowCount) return null;

  const source = cached.rows[0];
  await transaction(async (client) => {
    await client.query('DELETE FROM snapshot_entries WHERE event_id=$1', [event.id]);
    await client.query(
      `INSERT INTO snapshot_entries(event_id,wallet_address,raw_balance,voting_power,merkle_proof)
       SELECT $1,wallet_address,raw_balance,voting_power,merkle_proof
         FROM snapshot_entries WHERE event_id=$2`,
      [event.id, source.id],
    );
    await client.query(
      `UPDATE events
          SET record_date_block=$2,snapshot_root=$3,snapshot_holder_count=$4,
              status='SNAPSHOT_READY',failure_reason=NULL
        WHERE id=$1`,
      [event.id, block.number, source.snapshot_root, source.snapshot_holder_count],
    );
    await enqueueJob({
      eventId: event.id,
      type: 'DEPLOY_EVENT',
      dedupeKey: `deploy:${event.id}`,
      message: 'VoteEvent deployment queued',
      client,
    });
  });
  await updateJob(jobId, 95, 'Reused a validated snapshot for the same token, block, and ratio');
  return {
    recordDateBlock: block.number,
    snapshotRoot: source.snapshot_root,
    holderCount: Number(source.snapshot_holder_count),
    reused: true,
  };
}

async function storeSnapshot(event, block, tree) {
  await transaction(async (client) => {
    await client.query('DELETE FROM snapshot_entries WHERE event_id=$1', [event.id]);
    const size = 500;
    for (let offset = 0; offset < tree.entries.length; offset += size) {
      const batch = tree.entries.slice(offset, offset + size);
      const params = [];
      const values = batch.map((entry, index) => {
        const base = index * 5;
        params.push(event.id, entry.walletAddress, entry.rawBalance, entry.votingPower, JSON.stringify(entry.merkleProof));
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5}::jsonb)`;
      });
      await client.query(
        `INSERT INTO snapshot_entries(event_id,wallet_address,raw_balance,voting_power,merkle_proof)
         VALUES ${values.join(',')}`,
        params,
      );
    }
    await client.query(
      `UPDATE events
          SET record_date_block=$2,snapshot_root=$3,snapshot_holder_count=$4,
              status='SNAPSHOT_READY',failure_reason=NULL
        WHERE id=$1`,
      [event.id, block.number, tree.root, tree.entries.length],
    );
    await enqueueJob({
      eventId: event.id,
      type: 'DEPLOY_EVENT',
      dedupeKey: `deploy:${event.id}`,
      message: 'VoteEvent deployment queued',
      client,
    });
  });
}

export async function buildSnapshot(job) {
  const found = await query('SELECT * FROM events WHERE id=$1', [job.event_id]);
  if (!found.rowCount) throw permanentError('Event no longer exists.');
  const event = found.rows[0];
  if (event.contract_address) return { contractAddress: event.contract_address, alreadyComplete: true };
  if (new Date(event.record_date_at).getTime() > Date.now() + 15_000) throw permanentError('Record date is in the future.');
  if (new Date(event.voting_end_at).getTime() <= Date.now()) throw permanentError('Voting ended before deployment.');

  await query("UPDATE events SET status='SNAPSHOT_RUNNING',failure_reason=NULL WHERE id=$1", [event.id]);
  await updateJob(job.id, 3, 'Resolving record-date block');
  const block = await resolveRecordBlock(event.record_date_at);
  await updateJob(job.id, 8, `Record date resolved to block ${block.number}`);

  const reused = await reuseSnapshot(event, block, job.id);
  if (reused) return reused;

  // Historical eth_getCode is an unnecessary archive-state dependency and can
  // fail upstream even for valid contracts. Prefer the explorer's creation
  // block when available, then let indexed transfers and historical supply
  // validation establish snapshot compatibility.
  const deployment = await tokenDeployment(event.token_address);
  if (deployment?.blockNumber > block.number) {
    throw permanentError(
      `The ERC-20 contract was deployed at block ${deployment.blockNumber}, after the selected record-date block ${block.number}.`,
    );
  }

  const startBlock = deployment?.blockNumber ?? 0;
  const { balances, transferCount } = await transfersAt(
    event.token_address,
    startBlock,
    block.number,
    job.id,
  );
  const negative = [...balances.entries()].find(([, value]) => value < 0n);
  if (negative) {
    throw permanentError(`Transfer history produced a negative balance for ${negative[0]}; this is not a compatible standard ERC-20 history.`);
  }

  const positive = [...balances.entries()].filter(([, value]) => value > 0n);
  if (!positive.length) throw permanentError('No positive token balances existed at the record date.');

  await updateJob(job.id, 62, 'Validating reconstructed balances against historical total supply');
  const reconstructed = positive.reduce((sum, [, value]) => sum + value, 0n);
  const totalSupply = await totalSupplyAt(event.token_address, block.number);
  if (reconstructed !== totalSupply) {
    throw permanentError(
      `Token is not compatible with event-based snapshots: reconstructed balances (${reconstructed}) do not equal totalSupply (${totalSupply}) at block ${block.number}.`,
    );
  }

  const voteUnit = BigInt(event.vote_unit);
  const eligible = positive
    .map(([walletAddress, rawBalance]) => ({
      walletAddress,
      rawBalance,
      votingPower: rawBalance / voteUnit,
    }))
    .filter((entry) => entry.votingPower > 0n);
  if (!eligible.length) throw permanentError('No holder has at least one vote at the selected token-to-vote ratio.');

  await updateJob(job.id, 75, `Building Merkle proofs for ${eligible.length.toLocaleString()} eligible wallets`);
  const tree = buildSnapshotTree(eligible);
  await storeSnapshot(event, block, tree);
  await updateJob(job.id, 95, 'Snapshot committed; one-contract deployment queued', {
    snapshotRoot: tree.root,
    holderCount: tree.entries.length,
  });
  return {
    recordDateBlock: block.number,
    snapshotRoot: tree.root,
    holderCount: tree.entries.length,
    transfersRead: transferCount,
  };
}
