import { Contract, verifyTypedData } from 'ethers';
import { VOTE_EVENT_ABI, ballotTypedData, choicesToBytes } from '@pv/shared';
import { transaction, query } from './db.js';
import { HttpError, normalizeAddress } from './errors.js';
import { enqueueJob } from './jobs.js';
import { provider } from './rpc.js';
import { serializeVote } from './serializers.js';
import { getEventRow } from './events.js';
import { kickJobRunner } from './runner.js';

async function votingContext(eventId, walletInput) {
  const wallet = normalizeAddress(walletInput);
  const event = await getEventRow(eventId);
  if (!event.contract_address || event.deployment_block === null) throw new HttpError(409, 'Event is not deployed yet.', 'EVENT_NOT_READY');
  const now = Date.now();
  if (now < new Date(event.voting_start_at).getTime() || now > new Date(event.voting_end_at).getTime()) {
    throw new HttpError(409, 'Voting is not open.', 'VOTING_NOT_OPEN');
  }
  const entry = await query('SELECT * FROM snapshot_entries WHERE event_id=$1 AND wallet_address=$2', [eventId, wallet]);
  if (!entry.rowCount) throw new HttpError(403, 'This wallet has no voting power in the record-date snapshot.', 'NOT_ELIGIBLE');
  return { wallet, event, entry: entry.rows[0] };
}

export async function ballot(eventId, walletInput) {
  const { wallet, event, entry } = await votingContext(eventId, walletInput);
  const existing = await query('SELECT * FROM votes WHERE event_id=$1 AND voter_address=$2', [eventId, wallet]);
  if (existing.rowCount && existing.rows[0].status !== 'FAILED') {
    return { alreadyVoted: true, vote: serializeVote(existing.rows[0], event) };
  }
  if (await new Contract(event.contract_address, VOTE_EVENT_ABI, provider).hasVoted(wallet)) {
    throw new HttpError(409, 'This wallet has already voted on-chain.', 'ALREADY_VOTED');
  }
  return {
    eventId,
    chainId: Number(event.chain_id),
    contractAddress: event.contract_address,
    snapshotBalance: String(entry.raw_balance),
    votingPower: String(entry.voting_power),
  };
}

export async function submitVote(eventId, walletInput, choices, signature) {
  const { wallet, event, entry } = await votingContext(eventId, walletInput);
  if (choices.length !== event.proposals.length) throw new HttpError(400, 'Select one option for every proposal.', 'INVALID_CHOICES');
  choices.forEach((choice, index) => {
    if (choice >= event.proposals[index].options.length) throw new HttpError(400, `Invalid option for proposal ${index + 1}.`, 'INVALID_CHOICES');
  });
  const typed = ballotTypedData({ chainId: event.chain_id, contractAddress: event.contract_address, voter: wallet, choices });
  let signer;
  try { signer = normalizeAddress(verifyTypedData(typed.domain, typed.types, typed.message, signature)); } catch { signer = null; }
  if (signer !== wallet) throw new HttpError(401, 'Ballot signature is invalid.', 'INVALID_SIGNATURE');

  const result = await transaction(async (client) => {
    const existing = await client.query('SELECT * FROM votes WHERE event_id=$1 AND voter_address=$2 FOR UPDATE', [eventId, wallet]);
    if (existing.rowCount && existing.rows[0].status !== 'FAILED') return { vote: existing.rows[0], job: null };
    let vote;
    if (existing.rowCount) {
      const reset = await client.query(
        `UPDATE votes SET snapshot_balance=$3,voting_power=$4,choices=$5::jsonb,choices_hex=$6,signature=$7,
         status='QUEUED',transaction_hash=NULL,block_number=NULL,failure_reason=NULL WHERE event_id=$1 AND voter_address=$2 RETURNING *`,
        [eventId, wallet, entry.raw_balance, entry.voting_power, JSON.stringify(choices), choicesToBytes(choices), signature],
      );
      vote = reset.rows[0];
    } else {
      const inserted = await client.query(
        `INSERT INTO votes(event_id,voter_address,snapshot_balance,voting_power,choices,choices_hex,signature,status)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,'QUEUED') RETURNING *`,
        [eventId, wallet, entry.raw_balance, entry.voting_power, JSON.stringify(choices), choicesToBytes(choices), signature],
      );
      vote = inserted.rows[0];
    }
    const job = await enqueueJob({ eventId, voterAddress: wallet, type: 'RELAY_VOTE', dedupeKey: `vote:${eventId}:${wallet}`, message: 'Gasless vote queued', client });
    return { vote, job };
  });
  kickJobRunner();
  return serializeVote(result.vote, event);
}
