import { getAddress, toQuantity } from 'ethers';
import { buildSnapshotTree } from '@pv/shared';
import { config } from './config.js';
import { query, transaction } from './db.js';
import {
  applyLedgerTransfer,
  createLedger,
  ledgerBalances,
} from './erc20-ledger.js';
import { deferredError, permanentError } from './errors.js';
import { enqueueJob, updateJob } from './jobs.js';
import { nextFinalityCheckAt } from './record-date.js';
import { rpc, rpcBlock } from './rpc.js';
import { tokenDeployment } from './tokens.js';

const BALANCE_PROGRESS_INTERVAL = 40;

async function resolveSnapshotBlocks(recordDateAt) {
  const latest = Number(BigInt(await rpc('eth_blockNumber', [])));
  const safeNumber = Math.max(0, latest - config.confirmations);
  const safeBlock = await rpcBlock(safeNumber);
  const requested = Math.floor(new Date(recordDateAt).getTime() / 1000);
  const retryAt = nextFinalityCheckAt(recordDateAt, safeBlock.timestamp);
  if (retryAt) {
    throw deferredError(
      `Waiting for Polygon finality at record date ${new Date(recordDateAt).toISOString()}.`,
      retryAt,
    );
  }

  let low = 0;
  let high = safeNumber;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const block = await rpcBlock(middle);
    if (block.timestamp <= requested) low = middle;
    else high = middle - 1;
  }

  const recordBlock = low === safeNumber
    ? safeBlock
    : await rpcBlock(low);

  return { recordBlock, safeBlock };
}

function normalizeAddress(value) {
  try {
    return getAddress(value).toLowerCase();
  } catch {
    return null;
  }
}

function parseBlockNumber(value) {
  try {
    const blockNumber = Number(BigInt(value));
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) throw new Error();
    return blockNumber;
  } catch {
    throw permanentError('Alchemy returned an invalid ERC-20 transfer block number.');
  }
}

function parseTransfer(transfer) {
  const from = normalizeAddress(transfer?.from);
  const to = normalizeAddress(transfer?.to);
  if (!from || !to) {
    throw permanentError('Alchemy returned an ERC-20 transfer with an invalid address.');
  }

  const rawValue = transfer?.rawContract?.value;
  if (rawValue === null || rawValue === undefined) {
    throw permanentError('Alchemy omitted a raw ERC-20 transfer value.');
  }

  let value;
  try {
    value = BigInt(rawValue);
  } catch {
    throw permanentError('Alchemy returned an invalid raw ERC-20 transfer value.');
  }

  const blockNumber = parseBlockNumber(transfer?.blockNum);
  const identity = transfer?.uniqueId
    ?? (transfer?.hash && transfer?.logIndex != null
      ? `${transfer.hash}:${transfer.logIndex}`
      : null);
  if (!identity) {
    throw permanentError('Alchemy omitted the identity of an ERC-20 transfer.');
  }

  return {
    blockNumber,
    identity,
    from,
    to,
    value,
  };
}

async function replayTransferHistory({
  tokenAddress,
  startBlock,
  recordBlock,
  jobId,
}) {
  const recordDate = createLedger();
  const seen = new Set();
  let pageKey;
  let page = 0;

  do {
    page += 1;
    if (page > config.alchemyMaxPages) {
      throw permanentError(
        `Token history exceeds the configured ${config.alchemyMaxPages * config.alchemyPageSize} transfer limit.`,
      );
    }

    const request = {
      fromBlock: toQuantity(startBlock),
      toBlock: toQuantity(recordBlock),
      contractAddresses: [tokenAddress],
      category: ['erc20'],
      excludeZeroValue: false,
      withMetadata: false,
      order: 'asc',
      maxCount: toQuantity(config.alchemyPageSize),
      ...(pageKey ? { pageKey } : {}),
    };

    let response;
    try {
      response = await rpc('alchemy_getAssetTransfers', [request]);
    } catch (error) {
      if (error.rpcCode === -32601) {
        throw permanentError(
          'RPC_HTTP_URL must support alchemy_getAssetTransfers on Polygon Amoy.',
        );
      }
      if (error.httpStatus === 400 || error.rpcCode === -32602) {
        throw permanentError(`Alchemy rejected the transfer-history request: ${error.message}`);
      }
      throw error;
    }

    const transfers = Array.isArray(response?.transfers) ? response.transfers : [];
    for (const rawTransfer of transfers) {
      const transfer = parseTransfer(rawTransfer);
      if (transfer.blockNumber < startBlock || transfer.blockNumber > recordBlock) {
        throw permanentError('Alchemy returned a transfer outside the requested block range.');
      }
      if (seen.has(transfer.identity)) continue;
      seen.add(transfer.identity);
      applyLedgerTransfer(recordDate, transfer);
    }

    pageKey = response?.pageKey ?? null;
    const progress = pageKey
      ? Math.min(54, 10 + Math.floor(44 * (page / (page + 10))))
      : 55;
    await updateJob(
      jobId,
      progress,
      pageKey
        ? `Read ${seen.size.toLocaleString()} indexed ERC-20 transfers across ${page} pages`
        : `Transfer history complete: ${seen.size.toLocaleString()} transfers`,
    );
  } while (pageKey);

  return {
    recordDate,
    transferCount: seen.size,
  };
}

async function reportConstructedBalanceProgress(balances, jobId) {
  await updateJob(
    jobId,
    62,
    `Finalizing ${balances.length.toLocaleString()} reconstructed record-date balances`,
  );

  for (let offset = 0; offset < balances.length; offset += BALANCE_PROGRESS_INTERVAL) {
    const processed = Math.min(balances.length, offset + BALANCE_PROGRESS_INTERVAL);
    const progress = Math.min(74, 62 + Math.round((processed / balances.length) * 12));
    await updateJob(
      jobId,
      progress,
      `Processed ${processed.toLocaleString()} of ${balances.length.toLocaleString()} reconstructed record-date balances`,
    );
  }
}

async function storeSnapshot(event, block, tree, jobId) {
  await updateJob(jobId, 84, 'Saving snapshot proofs');
  await transaction(async (client) => {
    await client.query('DELETE FROM snapshot_entries WHERE event_id=$1', [event.id]);
    const size = 500;
    for (let offset = 0; offset < tree.entries.length; offset += size) {
      const batch = tree.entries.slice(offset, offset + size);
      const params = [];
      const values = batch.map((entry, index) => {
        const base = index * 5;
        params.push(
          event.id,
          entry.walletAddress,
          entry.rawBalance,
          entry.votingPower,
          JSON.stringify(entry.merkleProof),
        );
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
  await updateJob(jobId, 92, 'Snapshot stored; preparing relayer deployment');
}

export async function buildSnapshot(job) {
  const found = await query('SELECT * FROM events WHERE id=$1', [job.event_id]);
  if (!found.rowCount) throw permanentError('Event no longer exists.');

  const event = found.rows[0];
  if (event.contract_address) {
    return { contractAddress: event.contract_address, alreadyComplete: true };
  }
  if (new Date(event.voting_end_at).getTime() <= Date.now()) {
    throw permanentError('Voting ended before deployment.');
  }

  await updateJob(job.id, 3, 'Resolving record-date and confirmation-safe blocks');
  const { recordBlock, safeBlock } = await resolveSnapshotBlocks(event.record_date_at);
  await query(
    "UPDATE events SET status='SNAPSHOT_RUNNING',failure_reason=NULL WHERE id=$1",
    [event.id],
  );
  await updateJob(
    job.id,
    8,
    `Record date resolved to block ${recordBlock.number}; chain finalized through block ${safeBlock.number}`,
  );

  const deployment = await tokenDeployment(event.token_address);
  if (deployment?.blockNumber > recordBlock.number) {
    throw permanentError(
      `The ERC-20 contract was deployed at block ${deployment.blockNumber}, after record-date block ${recordBlock.number}.`,
    );
  }

  const replay = await replayTransferHistory({
    tokenAddress: event.token_address,
    startBlock: deployment?.blockNumber ?? 0,
    recordBlock: recordBlock.number,
    jobId: job.id,
  });

  const recordDateBalances = ledgerBalances(replay.recordDate, { positiveOnly: true });
  if (!recordDateBalances.length) {
    throw permanentError('No positive token balances existed at the record date.');
  }

  await reportConstructedBalanceProgress(recordDateBalances, job.id);

  const voteUnit = BigInt(event.vote_unit);
  const eligible = recordDateBalances
    .map(([walletAddress, rawBalance]) => ({
      walletAddress,
      rawBalance,
      votingPower: rawBalance / voteUnit,
    }))
    .filter((entry) => entry.votingPower > 0n);
  if (!eligible.length) {
    throw permanentError(
      'No holder has at least one vote at the selected token-to-vote ratio.',
    );
  }

  await updateJob(
    job.id,
    75,
    `Building Merkle proofs for ${eligible.length.toLocaleString()} eligible wallets`,
  );
  const tree = buildSnapshotTree(eligible);
  await storeSnapshot(event, recordBlock, tree, job.id);
  await updateJob(job.id, 95, 'Snapshot committed; one-contract deployment queued', {
    snapshotRoot: tree.root,
    holderCount: tree.entries.length,
  });

  return {
    recordDateBlock: recordBlock.number,
    validationBlock: safeBlock.number,
    snapshotRoot: tree.root,
    holderCount: tree.entries.length,
    transfersRead: replay.transferCount,
  };
}
