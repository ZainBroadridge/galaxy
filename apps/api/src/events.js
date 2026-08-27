import { Contract } from 'ethers';
import {
  AUTHENTICITY_CLAIM,
  VOTE_EVENT_ABI,
  hashEventMetadata,
  packProposalConfig,
} from '@pv/shared';
import { config } from './config.js';
import { query, transaction } from './db.js';
import { listEventDocuments } from './documents.js';
import { buildEventAnnouncement } from './event-announcements.js';
import { HttpError, normalizeAddress } from './errors.js';
import { enqueueJob } from './jobs.js';
import { planSnapshotJob } from './record-date.js';
import { provider } from './rpc.js';
import { kickJobRunner } from './runner.js';
import { serializeEvent, serializeJob, serializeVote } from './serializers.js';
import { inspectToken } from './tokens.js';

export async function createEvent(wallet, input) {
  const creator = normalizeAddress(wallet);
  const used = await query(
    `SELECT count(*)::int AS count
       FROM events
      WHERE creator_address=$1 AND created_at >= now()-interval '24 hours'`,
    [creator],
  );
  if (used.rows[0].count >= config.maxEventsPerWalletPerDay) {
    throw new HttpError(429, 'Daily event-creation limit reached.', 'EVENT_LIMIT');
  }

  const token = await inspectToken(input.tokenAddress);
  const { metadata, hash } = hashEventMetadata(input);
  const proposalConfig = packProposalConfig(
    metadata.proposals.map((proposal) => proposal.options.length),
  );
  const voteUnit = BigInt(input.tokenToVoteRatio) * (10n ** BigInt(token.decimals));
  const authenticityStatus = input.authenticityClaim === AUTHENTICITY_CLAIM.ISSUER_AUTHORIZED
    ? (token.owner === creator ? 'TOKEN_OWNER_VERIFIED' : 'SELF_CLAIMED')
    : 'COMMUNITY';

  const created = await transaction(async (client) => {
    const result = await client.query(
      `INSERT INTO events(
         creator_address,token_address,token_name,token_symbol,token_decimals,title,description,proposals,
         metadata_hash,proposal_config,record_date_at,token_to_vote_ratio,vote_unit,voting_start_at,voting_end_at,
         discovery_mode,authenticity_status,snap_delivery_mode
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        creator,
        token.tokenAddress,
        token.name,
        token.symbol,
        token.decimals,
        metadata.title,
        metadata.description,
        JSON.stringify(metadata.proposals),
        hash,
        proposalConfig.toString(),
        input.recordDateAt,
        input.tokenToVoteRatio,
        voteUnit.toString(),
        input.votingStartAt,
        input.votingEndAt,
        input.discoveryMode,
        authenticityStatus,
        input.snapDeliveryMode,
      ],
    );
    let event = result.rows[0];
    const announcementDraft = buildEventAnnouncement(event);
    if (announcementDraft) {
      const updated = await client.query(
        'UPDATE events SET announcement_message=$2::jsonb WHERE id=$1 RETURNING *',
        [event.id, JSON.stringify(announcementDraft.message)],
      );
      [event] = updated.rows;
    }
    const snapshotPlan = planSnapshotJob(event.record_date_at);
    const job = await enqueueJob({
      eventId: event.id,
      type: 'BUILD_SNAPSHOT',
      dedupeKey: `snapshot:${event.id}`,
      message: snapshotPlan.message,
      availableAt: snapshotPlan.availableAt,
      client,
    });
    return { event, job, announcementDraft };
  });

  kickJobRunner();
  return {
    event: serializeEvent(created.event),
    job: serializeJob(created.job),
    // Keep the backward-compatible field without exposing a wallet-signing
    // payload. The platform notification service signs after deployment.
    announcementDraft: created.announcementDraft
      ? { message: created.announcementDraft.message, status: 'QUEUED' }
      : null,
  };
}

export async function getEventRow(id) {
  const result = await query('SELECT * FROM events WHERE id=$1', [id]);
  if (!result.rowCount) throw new HttpError(404, 'Event not found.', 'EVENT_NOT_FOUND');
  return result.rows[0];
}

async function loadEventViewRow(id, wallet) {
  const found = await query(
    `SELECT e.*,
            to_jsonb(j) AS latest_job,
            se.raw_balance AS wallet_snapshot_balance,
            se.voting_power AS wallet_voting_power,
            to_jsonb(v) AS wallet_vote
       FROM events e
       LEFT JOIN LATERAL (
         SELECT * FROM jobs WHERE event_id=e.id AND type<>'RELAY_VOTE' ORDER BY created_at DESC LIMIT 1
       ) j ON true
       LEFT JOIN snapshot_entries se ON se.event_id=e.id AND se.wallet_address=$2
       LEFT JOIN votes v ON v.event_id=e.id AND v.voter_address=$2
      WHERE e.id=$1`,
    [id, wallet],
  );
  if (!found.rowCount) throw new HttpError(404, 'Event not found.', 'EVENT_NOT_FOUND');
  return found.rows[0];
}

async function serializeEventView(id, wallet, row) {
  const vote = row.wallet_vote ?? null;
  let onChainVoted = false;
  if (
    row.wallet_snapshot_balance !== null
    && (!vote || vote.status === 'FAILED')
    && row.contract_address
    && row.deployment_block !== null
  ) {
    onChainVoted = await new Contract(row.contract_address, VOTE_EVENT_ABI, provider)
      .hasVoted(wallet)
      .catch(() => false);
  }

  const eligibility = row.wallet_snapshot_balance === null
    ? { eligible: false, hasVoted: false }
    : {
        eligible: true,
        snapshotBalance: String(row.wallet_snapshot_balance),
        votingPower: String(row.wallet_voting_power),
        hasVoted: Boolean((vote && vote.status !== 'FAILED') || onChainVoted),
        onChainOnly: Boolean(onChainVoted && (!vote || vote.status === 'FAILED')),
      };
  const documents = await listEventDocuments(id);

  return serializeEvent(row, {
    job: serializeJob(row.latest_job),
    documents,
    eligibility,
    vote: serializeVote(vote && vote.status !== 'FAILED' ? vote : null, row),
    lastVoteFailure: vote?.status === 'FAILED' ? vote.failure_reason : null,
  });
}

export async function eventView(id, walletInput) {
  if (!walletInput) {
    throw new HttpError(
      401,
      'Connect an eligible wallet to view this voting event.',
      'WALLET_REQUIRED',
    );
  }
  const wallet = normalizeAddress(walletInput, 'wallet');
  const row = await loadEventViewRow(id, wallet);
  if (row.wallet_snapshot_balance === null) {
    throw new HttpError(
      403,
      'This wallet has no voting power in the record-date snapshot.',
      'NOT_ELIGIBLE',
    );
  }
  return serializeEventView(id, wallet, row);
}

export async function organiserEventView(id, walletInput) {
  if (!walletInput) {
    throw new HttpError(
      401,
      'Connect the event creator wallet to manage this event.',
      'WALLET_REQUIRED',
    );
  }
  const wallet = normalizeAddress(walletInput, 'wallet');
  const row = await loadEventViewRow(id, wallet);
  if (row.creator_address !== wallet) {
    throw new HttpError(403, 'Only the event creator can manage this event.', 'FORBIDDEN');
  }
  return serializeEventView(id, wallet, row);
}

export async function votingDashboard(walletInput) {
  if (!walletInput) return [];
  const wallet = normalizeAddress(walletInput, 'wallet');
  const rows = await query(
    `SELECT e.*,se.raw_balance,se.voting_power,v.status AS vote_status,v.transaction_hash
       FROM snapshot_entries se
       JOIN events e ON e.id=se.event_id
       LEFT JOIN votes v ON v.event_id=e.id AND v.voter_address=se.wallet_address
       LEFT JOIN snap_subscriptions s
         ON s.wallet_address=se.wallet_address AND s.token_address=e.token_address AND s.enabled=true
      WHERE se.wallet_address=$1
        AND e.deployment_block IS NOT NULL
        AND e.voting_end_at>now()
        AND e.status<>'FAILED'
        AND e.discovery_mode<>'DIRECT_LINK'
        AND (
          e.discovery_mode='PUBLIC_ELIGIBLE'
          OR (e.discovery_mode='SUBSCRIBERS_ONLY' AND s.wallet_address IS NOT NULL)
        )
      ORDER BY e.voting_end_at,e.created_at DESC`,
    [wallet],
  );
  return rows.rows.map((row) => serializeEvent(row, {
    eligibility: {
      eligible: true,
      snapshotBalance: String(row.raw_balance),
      votingPower: String(row.voting_power),
      hasVoted: Boolean(row.vote_status && row.vote_status !== 'FAILED'),
    },
    voteStatus: row.vote_status,
    voteTransactionHash: row.transaction_hash,
  }));
}

export async function organiserDashboard(wallet) {
  const rows = await query(
    'SELECT * FROM events WHERE creator_address=$1 ORDER BY created_at DESC',
    [normalizeAddress(wallet)],
  );
  return rows.rows.map((row) => serializeEvent(row));
}

export async function resultsDashboard(walletInput) {
  if (!walletInput) return [];
  const wallet = normalizeAddress(walletInput, 'wallet');
  const rows = await query(
    `SELECT e.*
       FROM events e
      WHERE e.deployment_block IS NOT NULL
        AND e.voting_end_at<=now()
        AND (
          e.creator_address=$1
          OR EXISTS (
            SELECT 1 FROM votes v
             WHERE v.event_id=e.id AND v.voter_address=$1 AND v.status='CONFIRMED'
          )
        )
      ORDER BY e.voting_end_at DESC`,
    [wallet],
  );
  return rows.rows.map((row) => serializeEvent(row));
}

export async function eventResults(id, walletInput) {
  if (!walletInput) {
    throw new HttpError(401, 'Connect the creator or participating wallet to view results.', 'WALLET_REQUIRED');
  }
  const wallet = normalizeAddress(walletInput, 'wallet');
  const found = await query(
    `SELECT e.*,
            (
              e.creator_address=$2
              OR EXISTS (
                SELECT 1 FROM votes v
                 WHERE v.event_id=e.id AND v.voter_address=$2 AND v.status='CONFIRMED'
              )
            ) AS can_view_results
       FROM events e
      WHERE e.id=$1`,
    [id, wallet],
  );
  if (!found.rowCount) throw new HttpError(404, 'Event not found.', 'EVENT_NOT_FOUND');
  const event = found.rows[0];
  if (!event.can_view_results) {
    throw new HttpError(
      403,
      'Results are available only to the event creator and confirmed voters.',
      'RESULTS_FORBIDDEN',
    );
  }
  if (!event.contract_address || event.deployment_block === null) {
    throw new HttpError(409, 'Event contract is not deployed.', 'EVENT_NOT_DEPLOYED');
  }
  if (new Date(event.voting_end_at).getTime() > Date.now()) {
    throw new HttpError(409, 'Results publish after voting closes.', 'VOTING_OPEN');
  }

  const contract = new Contract(event.contract_address, VOTE_EVENT_ABI, provider);
  const tallies = [];
  for (let index = 0; index < event.proposals.length; index += 1) {
    tallies.push((await contract.getProposalTallies(index)).map((value) => value.toString()));
  }
  const documents = await listEventDocuments(id);
  return {
    event: serializeEvent(event, { documents }),
    proposals: event.proposals.map((proposal, index) => ({
      ...proposal,
      tallies: tallies[index],
    })),
  };
}

export async function retryEvent(id, wallet) {
  const event = await getEventRow(id);
  if (event.creator_address !== normalizeAddress(wallet)) {
    throw new HttpError(403, 'Only the event creator can retry it.', 'FORBIDDEN');
  }

  let type;
  let dedupeKey;
  let message;
  let availableAt = null;
  if (!event.snapshot_root) {
    const snapshotPlan = planSnapshotJob(event.record_date_at, { retry: true });
    type = 'BUILD_SNAPSHOT';
    dedupeKey = `snapshot:${id}`;
    message = snapshotPlan.message;
    availableAt = snapshotPlan.availableAt;
    await query("UPDATE events SET status='SNAPSHOT_PENDING',failure_reason=NULL WHERE id=$1", [id]);
  } else if (!event.deployment_block) {
    type = 'DEPLOY_EVENT';
    dedupeKey = `deploy:${id}`;
    message = 'Deployment retry queued';
    await query("UPDATE events SET status='SNAPSHOT_READY',failure_reason=NULL WHERE id=$1", [id]);
  } else if (event.verification_status === 'FAILED') {
    type = 'VERIFY_CONTRACT';
    dedupeKey = `verify:${id}`;
    message = 'Verification retry queued';
    await query(
      "UPDATE events SET verification_status='PENDING',verification_guid=NULL,verification_error=NULL WHERE id=$1",
      [id],
    );
  } else {
    throw new HttpError(409, 'There is nothing to retry for this event.', 'NOT_RETRYABLE');
  }

  const job = await transaction((client) => enqueueJob({
    eventId: id,
    type,
    dedupeKey,
    message,
    availableAt,
    client,
  }));
  kickJobRunner();
  return serializeJob(job);
}
