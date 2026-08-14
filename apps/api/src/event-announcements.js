import { randomUUID } from 'node:crypto';
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
    chainId: Number(event.chain_id),
    eventId: event.id,
    eventTitle: event.title,
    tokenSymbol: event.token_symbol,
    contractAddress: event.contract_address ?? ZERO_ADDRESS,
    // Announcements are issued by the platform notification service so the
    // organiser never has to sign a second wallet message.
    creatorAddress: notificationPublisherAddress,
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
  if (!announcementAudience(event.snap_delivery_mode)) return 'DISABLED';
  if (event.announcement_published_at) return 'PUBLISHED';
  return 'QUEUED';
}

async function eventForAnnouncement(eventId, client = { query }) {
  const result = await client.query('SELECT * FROM events WHERE id=$1', [eventId]);
  if (!result.rowCount) throw new HttpError(404, 'Event not found.', 'EVENT_NOT_FOUND');
  return result.rows[0];
}

async function publishWithClient(eventId, client) {
  const event = await eventForAnnouncement(eventId, client);
  if (event.snap_delivery_mode === SNAP_DELIVERY_MODE.DISABLED) {
    return { published: false, status: 'DISABLED', message: null };
  }
  if (event.announcement_published_at) {
    return { published: false, status: 'PUBLISHED', message: event.announcement_message ?? null };
  }
  if (!event.contract_address || event.deployment_block === null) {
    return { published: false, status: 'QUEUED', message: null };
  }

  const draft = buildEventAnnouncement(event);
  if (!draft) return { published: false, status: 'DISABLED', message: null };
  const signature = await relayer.signMessage(draft.signingMessage);

  await client.query(
    `INSERT INTO communications(
       message_id,event_id,scope,chain_id,creator_address,authenticity_status,
       category,audience,title,body,action_url,published_at,expires_at,
       creator_signature,signed_contract_address
     ) VALUES ($1,$2,'EVENT',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT(message_id) DO NOTHING`,
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
  await client.query(
    `UPDATE events
        SET announcement_message=$2::jsonb,
            announcement_signature=$3,
            announcement_published_at=coalesce(announcement_published_at,now())
      WHERE id=$1`,
    [event.id, JSON.stringify(draft.message), signature],
  );
  return { published: true, status: 'PUBLISHED', message: draft.message };
}

export async function publishPendingEventAnnouncement(eventId, client = null) {
  const result = client
    ? await publishWithClient(eventId, client)
    : await transaction((transactionClient) => publishWithClient(eventId, transactionClient));
  return result.published;
}

export async function triggerEventAnnouncement(eventId, wallet) {
  const publisher = normalizeAddress(wallet, 'publisherAddress');
  return transaction(async (client) => {
    const locked = await client.query('SELECT * FROM events WHERE id=$1 FOR UPDATE', [eventId]);
    if (!locked.rowCount) throw new HttpError(404, 'Event not found.', 'EVENT_NOT_FOUND');
    const event = locked.rows[0];
    if (event.creator_address !== publisher) {
      throw new HttpError(403, 'Only the event creator can trigger this announcement.', 'FORBIDDEN');
    }
    const result = await publishWithClient(eventId, client);
    return { published: result.published, status: result.status, message: result.message };
  });
}
