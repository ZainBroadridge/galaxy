import { randomUUID } from 'node:crypto';
import { verifyMessage } from 'ethers';
import {
  COMMUNICATION_AUDIENCE,
  COMMUNICATION_CATEGORY,
  SNAP_DELIVERY_MODE,
  ZERO_ADDRESS,
  buildCommunicationSigningMessage,
} from '@pv/shared';
import { config } from './config.js';
import { query, transaction } from './db.js';
import { HttpError, normalizeAddress } from './errors.js';
import { relayer } from './rpc.js';

function formatUtc(value) {
  const iso = new Date(value).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function announcementAudience(mode) {
  if (mode === SNAP_DELIVERY_MODE.ELIGIBLE) return COMMUNICATION_AUDIENCE.ALL_ELIGIBLE;
  if (mode === SNAP_DELIVERY_MODE.SUBSCRIBERS_ONLY) return COMMUNICATION_AUDIENCE.SUBSCRIBERS;
  return null;
}

export const notificationPublisherAddress = relayer.address.toLowerCase();

export function buildEventAnnouncement(event) {
  const audience = announcementAudience(event.snap_delivery_mode);
  if (!audience) return null;

  const message = {
    scope: 'EVENT',
    chainId: Number(event.chain_id),
    eventId: event.id,
    eventTitle: event.title,
    tokenSymbol: event.token_symbol,
    contractAddress: event.contract_address ?? ZERO_ADDRESS,
    // The platform notification service signs these notices, so event creation
    // and publication never require an additional organizer wallet signature.
    creatorAddress: notificationPublisherAddress,
    authenticityStatus: event.authenticity_status,
    messageId: event.announcement_message?.messageId ?? randomUUID(),
    category: COMMUNICATION_CATEGORY.EVENT_ANNOUNCEMENT,
    audience,
    title: `Proxy voting event: ${event.title}`.slice(0, 180),
    body: `${event.token_name} voting opens ${formatUtc(event.voting_start_at)} and closes ${formatUtc(event.voting_end_at)}.`,
    actionUrl: `${config.webAppUrl}/vote/${event.id}`,
    publishedAt: new Date(
      event.announcement_message?.publishedAt
        ?? event.announcement_published_at
        ?? Date.now(),
    ).toISOString(),
    expiresAt: new Date(event.voting_end_at).toISOString(),
  };

  return { message, signingMessage: buildCommunicationSigningMessage(message) };
}

export function eventAnnouncementStatus(event) {
  if (!announcementAudience(event.snap_delivery_mode)) return 'DISABLED';
  if (event.announcement_published_at) return 'PUBLISHED';
  return 'QUEUED';
}

async function eventForAnnouncement(eventId, client, lock = false) {
  const result = await client.query(
    `SELECT * FROM events WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
    [eventId],
  );
  if (!result.rowCount) throw new HttpError(404, 'Event not found.', 'EVENT_NOT_FOUND');
  return result.rows[0];
}

async function hasValidStoredAnnouncement(event, draft, client) {
  const stored = await client.query(
    `SELECT creator_address,creator_signature,signed_contract_address
       FROM communications
      WHERE event_id=$1 AND message_id=$2
      LIMIT 1`,
    [event.id, draft.message.messageId],
  );
  if (!stored.rowCount) return false;

  const row = stored.rows[0];
  if (row.creator_address !== draft.message.creatorAddress) return false;
  if (row.signed_contract_address !== draft.message.contractAddress) return false;
  if (!row.creator_signature) return false;

  try {
    return normalizeAddress(verifyMessage(draft.signingMessage, row.creator_signature))
      === notificationPublisherAddress;
  } catch {
    return false;
  }
}

async function publishWithClient(eventId, client, publisherAddress = null) {
  // Serialize deployment completion, manual retries, and recovery sweeps around
  // one event row. This keeps publication idempotent without another job type.
  const event = await eventForAnnouncement(eventId, client, true);

  if (publisherAddress && event.creator_address !== publisherAddress) {
    throw new HttpError(403, 'Only the event creator can trigger this announcement.', 'FORBIDDEN');
  }
  if (event.snap_delivery_mode === SNAP_DELIVERY_MODE.DISABLED) {
    return { published: false, status: 'DISABLED', message: null };
  }
  if (!event.contract_address || event.deployment_block === null) {
    return { published: false, status: 'QUEUED', message: null };
  }
  if (new Date(event.voting_end_at).getTime() <= Date.now()) {
    return { published: false, status: 'EXPIRED', message: null };
  }

  const draft = buildEventAnnouncement(event);
  if (!draft) return { published: false, status: 'DISABLED', message: null };
  if (event.announcement_published_at && await hasValidStoredAnnouncement(event, draft, client)) {
    if (publisherAddress) {
      // An explicit organiser retry is a delivery retry, not a new signed
      // communication. Refresh only the delivery timestamp so wallets whose
      // Snap/browser channel was enabled after the original attempt can receive
      // the same verified message without creating duplicate history.
      await client.query(
        `UPDATE communications
            SET created_at=now(),revoked_at=NULL
          WHERE event_id=$1 AND message_id=$2`,
        [event.id, draft.message.messageId],
      );
      return {
        published: false,
        redelivered: true,
        status: 'PUBLISHED',
        message: draft.message,
      };
    }
    return {
      published: false,
      redelivered: false,
      status: 'PUBLISHED',
      message: draft.message,
    };
  }
  const signature = await relayer.signMessage(draft.signingMessage);

  // Upsert repairs an older partially published row that used the same stable
  // message ID but did not contain the current platform signature/contract.
  const stored = await client.query(
    `INSERT INTO communications(
       message_id,event_id,scope,chain_id,creator_address,authenticity_status,
       category,audience,title,body,action_url,published_at,expires_at,
       creator_signature,signed_contract_address
     ) VALUES ($1,$2,'EVENT',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT(message_id) DO UPDATE SET
       event_id=EXCLUDED.event_id,
       scope=EXCLUDED.scope,
       chain_id=EXCLUDED.chain_id,
       creator_address=EXCLUDED.creator_address,
       authenticity_status=EXCLUDED.authenticity_status,
       category=EXCLUDED.category,
       audience=EXCLUDED.audience,
       title=EXCLUDED.title,
       body=EXCLUDED.body,
       action_url=EXCLUDED.action_url,
       published_at=EXCLUDED.published_at,
       expires_at=EXCLUDED.expires_at,
       creator_signature=EXCLUDED.creator_signature,
       signed_contract_address=EXCLUDED.signed_contract_address,
       created_at=now(),
       revoked_at=NULL
     WHERE communications.event_id=EXCLUDED.event_id
     RETURNING id`,
    [
      draft.message.messageId,
      event.id,
      draft.message.chainId,
      draft.message.creatorAddress,
      draft.message.authenticityStatus,
      draft.message.category,
      draft.message.audience,
      draft.message.title,
      draft.message.body,
      draft.message.actionUrl,
      draft.message.publishedAt,
      draft.message.expiresAt,
      signature,
      draft.message.contractAddress,
    ],
  );
  if (!stored.rowCount) {
    throw new HttpError(
      409,
      'The announcement message identifier is already used by another event.',
      'ANNOUNCEMENT_CONFLICT',
    );
  }

  await client.query(
    `UPDATE events
        SET announcement_message=$2::jsonb,
            announcement_signature=$3,
            announcement_published_at=coalesce(announcement_published_at,now())
      WHERE id=$1`,
    [event.id, JSON.stringify(draft.message), signature],
  );
  return { published: true, redelivered: false, status: 'PUBLISHED', message: draft.message };
}

export async function publishPendingEventAnnouncement(eventId, client = null) {
  const result = client
    ? await publishWithClient(eventId, client)
    : await transaction((transactionClient) => publishWithClient(eventId, transactionClient));
  return {
    published: result.published,
    redelivered: result.redelivered === true,
    status: result.status,
    message: result.message,
  };
}

export async function triggerEventAnnouncement(eventId, wallet) {
  const publisher = normalizeAddress(wallet, 'publisherAddress');
  return transaction((client) => publishWithClient(eventId, client, publisher));
}

/**
 * Recover deployed events whose automatic announcement was missed by a prior
 * process restart or transient failure. The row lock and stable message ID make
 * repeated sweeps safe.
 */
export async function publishReadyEventAnnouncements({ limit = 25 } = {}) {
  const candidates = await query(
    `SELECT e.id
       FROM events e
       LEFT JOIN communications c
         ON c.event_id=e.id
        AND c.message_id=NULLIF(e.announcement_message->>'messageId','')::uuid
      WHERE e.snap_delivery_mode<>$1
        AND e.contract_address IS NOT NULL
        AND e.deployment_block IS NOT NULL
        AND e.voting_end_at>now()
        AND (
          e.announcement_published_at IS NULL
          OR c.id IS NULL
          OR c.creator_address<>$2
          OR c.signed_contract_address IS DISTINCT FROM e.contract_address
          OR c.creator_signature IS DISTINCT FROM e.announcement_signature
        )
      ORDER BY e.updated_at ASC
      LIMIT $3`,
    [SNAP_DELIVERY_MODE.DISABLED, notificationPublisherAddress, limit],
  );

  let published = 0;
  const messages = [];
  const failures = [];
  for (const row of candidates.rows) {
    try {
      const result = await publishPendingEventAnnouncement(row.id);
      if (result.published) {
        published += 1;
        if (result.message) messages.push(result.message);
      }
    } catch (error) {
      failures.push({ eventId: row.id, message: error?.message ?? String(error) });
    }
  }
  return { checked: candidates.rowCount, published, messages, failures };
}
