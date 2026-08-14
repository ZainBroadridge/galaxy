import { Contract, ContractFactory } from 'ethers';
import { VOTE_EVENT_ABI } from '@pv/shared';
import { announceCommunication } from './communication-stream.js';
import { config } from './config.js';
import { query, transaction } from './db.js';
import { publishPendingEventAnnouncement } from './event-announcements.js';
import { permanentError } from './errors.js';
import { logger } from './logger.js';
import { enqueueJob, updateJob } from './jobs.js';
import { loadArtifact } from './artifact.js';
import { broadcastTransaction, prepareTransaction } from './relayer.js';
import { provider } from './rpc.js';

export function constructorArguments(event) {
  return [
    event.creator_address,
    event.token_address,
    Number(event.record_date_block),
    event.snapshot_root,
    Math.floor(new Date(event.voting_start_at).getTime() / 1000),
    Math.floor(new Date(event.voting_end_at).getTime() / 1000),
    BigInt(event.vote_unit),
    event.metadata_hash,
    BigInt(event.proposal_config),
  ];
}

function lifecycle(event) {
  if (Date.now() < new Date(event.voting_start_at).getTime()) return 'SCHEDULED';
  if (Date.now() <= new Date(event.voting_end_at).getTime()) return 'OPEN';
  return 'CLOSED';
}

async function validate(event, address) {
  const contract = new Contract(address, VOTE_EVENT_ABI, provider);
  const [creator, token, block, root, start, end, unit, hash, configValue] = await Promise.all([
    contract.creator(), contract.tokenAddress(), contract.snapshotBlock(), contract.snapshotRoot(),
    contract.votingStart(), contract.votingEnd(), contract.voteUnit(), contract.metadataHash(), contract.proposalConfig(),
  ]);
  const expected = constructorArguments(event);
  const valid = creator.toLowerCase() === expected[0]
    && token.toLowerCase() === expected[1]
    && block === BigInt(expected[2])
    && root.toLowerCase() === expected[3].toLowerCase()
    && start === BigInt(expected[4]) && end === BigInt(expected[5])
    && unit === expected[6] && hash.toLowerCase() === expected[7].toLowerCase()
    && configValue === expected[8];
  if (!valid) throw permanentError('Deployed VoteEvent state does not match the event configuration.');
}

export async function deployEvent(job) {
  const found = await query('SELECT * FROM events WHERE id=$1', [job.event_id]);
  if (!found.rowCount) throw permanentError('Event no longer exists.');
  const event = found.rows[0];
  if (event.deployment_block !== null) return { contractAddress: event.contract_address, transactionHash: event.deployment_tx_hash, alreadyComplete: true };
  if (!event.snapshot_root || event.record_date_block === null) throw permanentError('Snapshot is not ready.');
  if (new Date(event.voting_end_at).getTime() <= Date.now()) throw permanentError('Voting ended before deployment.');

  const artifact = await loadArtifact();
  const request = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(...constructorArguments(event));
  await updateJob(job.id, 10, 'Preparing one VoteEvent deployment');
  const prepared = await prepareTransaction({
    job, eventId: event.id, type: 'DEPLOY_EVENT', request, predictContract: true,
    onPrepared: async (client, row) => {
      await client.query(
        `UPDATE events SET status='DEPLOYING',deployment_tx_hash=$2,contract_address=$3,failure_reason=NULL WHERE id=$1`,
        [event.id, row.transaction_hash, row.predicted_contract_address],
      );
    },
  });
  await updateJob(job.id, 45, 'Deployment submitted to Polygon Amoy', {
    transactionHash: prepared.transaction_hash,
    contractAddress: prepared.predicted_contract_address,
  });
  const receipt = await broadcastTransaction(prepared);
  if (Number(receipt.status) !== 1) throw permanentError('VoteEvent deployment reverted.');
  const address = (receipt.contractAddress ?? prepared.predicted_contract_address).toLowerCase();
  if (await provider.getCode(address) === '0x') throw permanentError('Deployment mined without contract bytecode.');
  await validate(event, address);

  await transaction(async (client) => {
    await client.query(
      `UPDATE events SET contract_address=$2,deployment_tx_hash=$3,deployment_block=$4,status=$5,
       failure_reason=NULL,verification_status=$6 WHERE id=$1`,
      [event.id, address, receipt.hash, receipt.blockNumber, lifecycle(event),
        config.verifyContracts && config.polygonScanApiKey ? 'PENDING' : 'NOT_SUBMITTED'],
    );
    if (config.verifyContracts && config.polygonScanApiKey) {
      await enqueueJob({ eventId: event.id, type: 'VERIFY_CONTRACT', dedupeKey: `verify:${event.id}`, message: 'Source verification queued', client });
    }
  });

  try {
    if (await publishPendingEventAnnouncement(event.id)) announceCommunication();
  } catch (error) {
    logger.warn(
      { err: error, eventId: event.id },
      'VoteEvent deployed, but its automatic notification announcement needs a retry',
    );
  }
  await updateJob(job.id, 96, 'VoteEvent mined and validated');
  return {
    contractAddress: address,
    transactionHash: receipt.hash,
    contractExplorerUrl: `${config.explorerUrl}/address/${address}#code`,
    transactionExplorerUrl: `${config.explorerUrl}/tx/${receipt.hash}`,
  };
}
