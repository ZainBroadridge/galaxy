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

function formatUtc(value) {
  const iso = new Date(value).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function announcementAudience(mode) {
  if (mode === SNAP_DELIVERY_MODE.ELIGIBLE) return COMMUNICATION_AUDIENCE.ALL_ELIGIBLE;
  if (mode === SNAP_DELIVERY_MODE.SUBSCRIBERS_ONLY) return COMMUNICATION_AUDIENCE.SUBSCRIBERS;
  return null;
}

export function buildEventAnnouncement(event) {
  const audience = announcementAudience(event.snap_delivery_mode);
  if (!audience) return null;

  const message = {
    chainId: Number(event.chain_id),
    eventId: event.id,
    eventTitle: event.title,
    tokenSymbol: event.token_symbol,
    contractAddress: ZERO_ADDRESS,
    creatorAddress: event.creator_address,
    authenticityStatus: event.authenticity_status,
    messageId: event.announcement_message?.messageId ?? randomUUID(),
    category: COMMUNICATION_CATEGORY.EVENT_ANNOUNCEMENT,
    audience,
    title: `Proxy voting event: ${event.title}`.slice(0, 180),
    body: `${event.token_name} voting opens ${formatUtc(event.voting_start_at)} and closes ${formatUtc(event.voting_end_at)}.`,
    actionUrl: `${config.webAppUrl}/vote/${event.id}`,
    publishedAt: new Date(event.created_at).toISOString(),
    expiresAt: new Date(event.voting_end_at).toISOString(),
  };

  return { message, signingMessage: buildCommunicationSigningMessage(message) };
}

export function eventAnnouncementStatus(event) {
  if (event.snap_delivery_mode === SNAP_DELIVERY_MODE.DISABLED) return 'DISABLED';
  if (event.announcement_published_at) return 'PUBLISHED';
  if (event.announcement_signature) return 'QUEUED';
  if (event.announcement_message) return 'AWAITING_SIGNATURE';
  return 'NOT_CONFIGURED';
}

async function eventForAnnouncement(eventId, client = { query }) {
  const result = await client.query('SELECT * FROM events WHERE id=$1', [eventId]);
  if (!result.rowCount) throw new HttpError(404, 'Event not found.', 'EVENT_NOT_FOUND');
  return result.rows[0];
}

async function publishWithClient(eventId, client) {
  const event = await eventForAnnouncement(eventId, client);
  if (
    event.snap_delivery_mode === SNAP_DELIVERY_MODE.DISABLED
    || !event.announcement_signature
    || event.announcement_published_at
    || !event.contract_address
    || event.deployment_block === null
  ) return false;

  const draft = buildEventAnnouncement(event);
  const stored = event.announcement_message;
  if (!draft || !stored || buildCommunicationSigningMessage(draft.message) !== buildCommunicationSigningMessage(stored)) {
    throw new HttpError(409, 'The automatic announcement no longer matches the event.', 'ANNOUNCEMENT_MISMATCH');
  }

  let signer;
  try { signer = normalizeAddress(verifyMessage(draft.signingMessage, event.announcement_signature)); } catch { signer = null; }
  if (signer !== event.creator_address) {
    throw new HttpError(401, 'The automatic announcement signature is invalid.', 'INVALID_SIGNATURE');
  }

  await client.query(
    `INSERT INTO communications(
       message_id,event_id,scope,category,audience,title,body,action_url,published_at,expires_at,
       creator_signature,signed_contract_address
     ) VALUES ($1,$2,'EVENT',$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT(message_id) DO NOTHING`,
    [
      draft.message.messageId,
      event.id,
      draft.message.category,
      draft.message.audience,
      draft.message.title,
      draft.message.body,
      draft.message.actionUrl,
      draft.message.publishedAt,
      draft.message.expiresAt,
      event.announcement_signature,
      draft.message.contractAddress,
    ],
  );
  await client.query(
    'UPDATE events SET announcement_published_at=coalesce(announcement_published_at,now()) WHERE id=$1',
    [event.id],
  );
  return true;
}

export async function publishPendingEventAnnouncement(eventId, client = null) {
  return client
    ? publishWithClient(eventId, client)
    : transaction((transactionClient) => publishWithClient(eventId, transactionClient));
}

export async function announcementDraft(eventId, wallet) {
  const event = await eventForAnnouncement(eventId);
  if (event.creator_address !== normalizeAddress(wallet)) {
    throw new HttpError(403, 'Only the event creator can authorise this announcement.', 'FORBIDDEN');
  }
  const draft = buildEventAnnouncement(event);
  if (!draft) throw new HttpError(409, 'Automatic wallet communications are disabled for this event.', 'ANNOUNCEMENT_DISABLED');
  return draft;
}

export async function authoriseEventAnnouncement(eventId, wallet, signature) {
  const creator = normalizeAddress(wallet);
  const result = await transaction(async (client) => {
    const locked = await client.query('SELECT * FROM events WHERE id=$1 FOR UPDATE', [eventId]);
    if (!locked.rowCount) throw new HttpError(404, 'Event not found.', 'EVENT_NOT_FOUND');
    const event = locked.rows[0];
    if (event.creator_address !== creator) {
      throw new HttpError(403, 'Only the event creator can authorise this announcement.', 'FORBIDDEN');
    }
    const draft = buildEventAnnouncement(event);
    if (!draft) throw new HttpError(409, 'Automatic wallet communications are disabled for this event.', 'ANNOUNCEMENT_DISABLED');

    let signer;
    try { signer = normalizeAddress(verifyMessage(draft.signingMessage, signature)); } catch { signer = null; }
    if (signer !== creator) throw new HttpError(401, 'Announcement signature is invalid.', 'INVALID_SIGNATURE');

    await client.query(
      `UPDATE events
          SET announcement_message=$2::jsonb,announcement_signature=$3
        WHERE id=$1`,
      [eventId, JSON.stringify(draft.message), signature],
    );
    const published = await publishWithClient(eventId, client);
    return { draft, published };
  });
  return {
    message: result.draft.message,
    status: result.published ? 'PUBLISHED' : 'QUEUED',
  };
}
