import { getAddress, toQuantity } from 'ethers';
import { buildSnapshotTree } from '@pv/shared';
import { config } from './config.js';
import { query, transaction } from './db.js';
import {
  applyLedgerTransfer,
  assertLedgerConsistent,
  cloneLedger,
  createLedger,
  ledgerBalances,
} from './erc20-ledger.js';
import { permanentError } from './errors.js';
import { enqueueJob, updateJob } from './jobs.js';
import { erc20Interface, rpc, rpcBlock } from './rpc.js';
import { tokenDeployment } from './tokens.js';

const BALANCE_CHECK_CONCURRENCY = 8;
const BALANCE_PROGRESS_INTERVAL = BALANCE_CHECK_CONCURRENCY * 5;

async function resolveSnapshotBlocks(recordDateAt) {
  const latest = Number(BigInt(await rpc('eth_blockNumber', [])));
  const validationNumber = Math.max(0, latest - config.confirmations);
  const validationBlock = await rpcBlock(validationNumber);
  const requested = Math.floor(new Date(recordDateAt).getTime() / 1000);
  const target = Math.min(requested, validationBlock.timestamp);

  let low = 0;
  let high = validationNumber;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const block = await rpcBlock(middle);
    if (block.timestamp <= target) low = middle;
    else high = middle - 1;
  }

  const recordBlock = low === validationNumber
    ? validationBlock
    : await rpcBlock(low);

  return { recordBlock, validationBlock };
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

function ledgerError(message, error) {
  return permanentError(`${message}: ${error.message}`);
}

async function replayTransferHistory({
  tokenAddress,
  startBlock,
  recordBlock,
  validationBlock,
  jobId,
}) {
  const current = createLedger();
  const seen = new Set();
  let recordDate = null;
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
      toBlock: toQuantity(validationBlock),
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
      if (transfer.blockNumber < startBlock || transfer.blockNumber > validationBlock) {
        throw permanentError('Alchemy returned a transfer outside the requested block range.');
      }
      if (seen.has(transfer.identity)) continue;
      seen.add(transfer.identity);
      if (recordDate && transfer.blockNumber <= recordBlock) {
        throw permanentError('Alchemy returned transfer history out of ascending block order.');
      }
      if (!recordDate && transfer.blockNumber > recordBlock) {
        recordDate = cloneLedger(current);
      }
      applyLedgerTransfer(current, transfer);
    }

    pageKey = response?.pageKey ?? null;
    const progress = pageKey
      ? Math.min(54, 10 + Math.floor((page / config.alchemyMaxPages) * 44))
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
    recordDate: recordDate ?? cloneLedger(current),
    current,
    transferCount: seen.size,
  };
}

async function readUint256(tokenAddress, method, args, blockNumber) {
  const data = erc20Interface.encodeFunctionData(method, args);
  const raw = await rpc('eth_call', [
    { to: tokenAddress, data },
    toQuantity(blockNumber),
  ]);
  if (!raw || raw === '0x') {
    throw permanentError(`The token did not return ${method}() at validation block ${blockNumber}.`);
  }

  try {
    return erc20Interface.decodeFunctionResult(method, raw)[0];
  } catch {
    throw permanentError(`The token returned an invalid ${method}() value.`);
  }
}

async function reconcileCurrentLedger(tokenAddress, ledger, blockNumber, jobId) {
  try {
    assertLedgerConsistent(ledger);
  } catch (error) {
    throw ledgerError('Token transfer history is incomplete or non-standard', error);
  }

  const totalSupply = await readUint256(tokenAddress, 'totalSupply', [], blockNumber);
  if (totalSupply !== ledger.supply) {
    throw permanentError(
      `Token is not event-replay compatible: derived current supply (${ledger.supply}) does not equal totalSupply (${totalSupply}) at validation block ${blockNumber}.`,
    );
  }

  const balances = ledgerBalances(ledger);
  for (let offset = 0; offset < balances.length; offset += BALANCE_CHECK_CONCURRENCY) {
    const batch = balances.slice(offset, offset + BALANCE_CHECK_CONCURRENCY);
    const actualBalances = await Promise.all(
      batch.map(([walletAddress]) => readUint256(
        tokenAddress,
        'balanceOf',
        [walletAddress],
        blockNumber,
      )),
    );

    const mismatchIndex = batch.findIndex(([, expected], index) => (
      actualBalances[index] !== expected
    ));
    if (mismatchIndex !== -1) {
      const [walletAddress, expected] = batch[mismatchIndex];
      throw permanentError(
        `Token is not event-replay compatible: derived current balance for ${walletAddress} is ${expected}, but balanceOf() returned ${actualBalances[mismatchIndex]}.`,
      );
    }

    const checked = Math.min(balances.length, offset + batch.length);
    const shouldReport = checked === balances.length
      || checked % BALANCE_PROGRESS_INTERVAL === 0;
    if (shouldReport) {
      const progress = Math.min(74, 62 + Math.round((checked / balances.length) * 12));
      await updateJob(
        jobId,
        progress,
        `Validated ${checked.toLocaleString()} of ${balances.length.toLocaleString()} current balances`,
      );
    }
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
  if (new Date(event.record_date_at).getTime() > Date.now() + 15_000) {
    throw permanentError('Record date is in the future.');
  }
  if (new Date(event.voting_end_at).getTime() <= Date.now()) {
    throw permanentError('Voting ended before deployment.');
  }

  await query(
    "UPDATE events SET status='SNAPSHOT_RUNNING',failure_reason=NULL WHERE id=$1",
    [event.id],
  );
  await updateJob(job.id, 3, 'Resolving record-date and validation blocks');
  const { recordBlock, validationBlock } = await resolveSnapshotBlocks(event.record_date_at);
  await updateJob(
    job.id,
    8,
    `Record date resolved to block ${recordBlock.number}; validating at recent block ${validationBlock.number}`,
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
    validationBlock: validationBlock.number,
    jobId: job.id,
  });

  try {
    assertLedgerConsistent(replay.recordDate);
  } catch (error) {
    throw ledgerError('Record-date transfer history is incomplete or non-standard', error);
  }

  const recordDateBalances = ledgerBalances(replay.recordDate, { positiveOnly: true });
  if (!recordDateBalances.length) {
    throw permanentError('No positive token balances existed at the record date.');
  }

  await updateJob(
    job.id,
    62,
    `Reconciling event-derived balances against recent token state at block ${validationBlock.number}`,
  );
  await reconcileCurrentLedger(
    event.token_address,
    replay.current,
    validationBlock.number,
    job.id,
  );

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
    validationBlock: validationBlock.number,
    snapshotRoot: tree.root,
    holderCount: tree.entries.length,
    transfersRead: replay.transferCount,
  };
}
