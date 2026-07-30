import { hashEventMetadata } from '@pv/shared';
import { config } from './config.js';

export function effectiveStatus(row) {
  if (row.status === 'FAILED' || row.deployment_block === null) return row.status;
  const now = Date.now();
  if (now < new Date(row.voting_start_at).getTime()) return 'SCHEDULED';
  if (now <= new Date(row.voting_end_at).getTime()) return 'OPEN';
  return 'CLOSED';
}

export function serializeEvent(row, extras = {}) {
  const metadata = { title: row.title, description: row.description, proposals: row.proposals };
  let metadataIntegrity = false;
  try { metadataIntegrity = hashEventMetadata(metadata).hash.toLowerCase() === row.metadata_hash.toLowerCase(); } catch {}
  return {
    id: row.id,
    chainId: Number(row.chain_id),
    creatorAddress: row.creator_address,
    tokenAddress: row.token_address,
    tokenName: row.token_name,
    tokenSymbol: row.token_symbol,
    tokenDecimals: Number(row.token_decimals),
    title: row.title,
    description: row.description,
    proposals: row.proposals,
    metadataHash: row.metadata_hash,
    metadataIntegrity,
    proposalConfig: String(row.proposal_config),
    recordDateAt: row.record_date_at,
    recordDateBlock: row.record_date_block === null ? null : Number(row.record_date_block),
    snapshotRoot: row.snapshot_root,
    snapshotHolderCount: row.snapshot_holder_count === null ? null : Number(row.snapshot_holder_count),
    tokenToVoteRatio: Number(row.token_to_vote_ratio),
    voteUnit: String(row.vote_unit),
    votingStartAt: row.voting_start_at,
    votingEndAt: row.voting_end_at,
    discoveryMode: row.discovery_mode,
    authenticityStatus: row.authenticity_status,
    snapDeliveryMode: row.snap_delivery_mode,
    status: effectiveStatus(row),
    storedStatus: row.status,
    failureReason: row.failure_reason,
    contractAddress: row.contract_address,
    contractReady: row.deployment_block !== null,
    deploymentTransactionHash: row.deployment_tx_hash,
    deploymentBlock: row.deployment_block === null ? null : Number(row.deployment_block),
    verificationStatus: row.verification_status,
    verificationError: row.verification_error,
    contractExplorerUrl: row.contract_address && row.deployment_block !== null ? `${config.explorerUrl}/address/${row.contract_address}#code` : null,
    deploymentExplorerUrl: row.deployment_tx_hash ? `${config.explorerUrl}/tx/${row.deployment_tx_hash}` : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extras,
  };
}

export function serializeJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    progress: Number(row.progress),
    message: row.message,
    result: row.result,
    error: row.error,
    attempts: Number(row.attempts),
    updatedAt: row.updated_at,
  };
}

export function serializeVote(row, event = null) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    voterAddress: row.voter_address,
    snapshotBalance: String(row.snapshot_balance),
    votingPower: String(row.voting_power),
    choices: row.choices,
    status: row.status,
    transactionHash: row.transaction_hash,
    transactionExplorerUrl: row.transaction_hash ? `${config.explorerUrl}/tx/${row.transaction_hash}` : null,
    contractAddress: event?.contract_address ?? null,
    contractExplorerUrl: event?.contract_address ? `${config.explorerUrl}/address/${event.contract_address}#code` : null,
    verificationStatus: event?.verification_status ?? null,
    blockNumber: row.block_number === null ? null : Number(row.block_number),
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
