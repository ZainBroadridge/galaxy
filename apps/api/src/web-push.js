import webPush from 'web-push';
import { config } from './config.js';
import { query } from './db.js';
import { HttpError, normalizeAddress } from './errors.js';
import { ensureNotificationState, inbox } from './communications.js';
import { logger } from './logger.js';

const DELIVERY_CONCURRENCY = 6;
const MAX_TTL_SECONDS = 24 * 60 * 60;
const DELIVERY_TIMEOUT_MS = 10_000;
const EVENT_LOOKUP_ATTEMPTS = 5;
const EVENT_LOOKUP_BASE_DELAY_MS = 120;
const QUEUE_DEDUPE_MS = 30_000;
const recentlyQueuedMessageIds = new Map();
const configured = Boolean(config.webPush.publicKey && config.webPush.privateKey);

if (configured) {
  webPush.setVapidDetails(
    config.webPush.subject,
    config.webPush.publicKey,
    config.webPush.privateKey,
  );
}

function normalizeEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(String(value));
  } catch {
    throw new HttpError(400, 'Push subscription endpoint is invalid.', 'INVALID_PUSH_ENDPOINT');
  }
  if (endpoint.protocol !== 'https:') {
    throw new HttpError(400, 'Push subscription endpoint must use HTTPS.', 'INVALID_PUSH_ENDPOINT');
  }
  return endpoint.toString();
}

function requireConfigured() {
  if (!configured) {
    throw new HttpError(
      503,
      'Browser notifications are not configured for this deployment.',
      'WEB_PUSH_NOT_CONFIGURED',
    );
  }
}

function notificationPayload(message) {
  const tokenSymbol = String(message?.tokenSymbol ?? 'PV').trim().slice(0, 40) || 'PV';
  const title = String(message?.title ?? 'New voting communication').trim().slice(0, 140);
  return JSON.stringify({
    version: 1,
    messageId: message.messageId,
    title: 'Mini Galaxy Proxy Voting',
    body: `${tokenSymbol}: ${title}`.slice(0, 180),
  });
}

function deliveryOptions(message) {
  const expiresAt = Date.parse(message?.expiresAt ?? '');
  const remainingSeconds = Number.isFinite(expiresAt)
    ? Math.floor((expiresAt - Date.now()) / 1000)
    : MAX_TTL_SECONDS;
  return {
    TTL: Math.max(60, Math.min(MAX_TTL_SECONDS, remainingSeconds)),
    urgency: 'normal',
    topic: String(message.messageId).replaceAll('-', '').slice(0, 32),
    timeout: DELIVERY_TIMEOUT_MS,
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function mapWithConcurrency(items, limit, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}

async function removeExpiredEndpoint(endpoint) {
  await query('DELETE FROM web_push_subscriptions WHERE endpoint=$1', [endpoint]);
}

async function walletCanReadMessage(walletAddress, messageId) {
  const messages = await inbox(walletAddress);
  return messages.some((message) => message.messageId === messageId);
}

function isEventMessage(message) {
  return Boolean(message?.eventId) && message?.scope !== 'TOKEN';
}

/**
 * Resolve event recipients from the persisted communication and event snapshot.
 *
 * Event communications previously reused inbox(wallet) once for every push
 * subscription. That made push delivery depend on a second, broad inbox read at
 * exactly the moment the message was committed. Token messages were unaffected,
 * but event and automatic-event messages could resolve zero recipients during
 * that boundary. This query applies the same inbox audience rules directly to
 * the one event message being dispatched.
 */
async function persistedEventSubscriptions(messageId) {
  const persisted = await query(
    `SELECT 1
       FROM communications
      WHERE message_id=$1 AND scope='EVENT'
      LIMIT 1`,
    [messageId],
  );
  if (!persisted.rowCount) return null;

  const recipients = await query(
    `SELECT push.wallet_address,
            push.endpoint,
            push.p256dh,
            push.auth
       FROM web_push_subscriptions push
       JOIN wallet_notification_state state
         ON state.wallet_address=push.wallet_address
       JOIN communications c
         ON c.message_id=$1
        AND c.scope='EVENT'
       JOIN events e
         ON e.id=c.event_id
       LEFT JOIN snapshot_entries se
         ON se.event_id=e.id
        AND se.wallet_address=push.wallet_address
       LEFT JOIN votes v
         ON v.event_id=e.id
        AND v.voter_address=push.wallet_address
        AND v.status<>'FAILED'
       LEFT JOIN snap_subscriptions subscription
         ON subscription.wallet_address=push.wallet_address
        AND subscription.token_address=e.token_address
        AND subscription.enabled=true
      WHERE c.revoked_at IS NULL
        AND c.published_at<=now()
        AND c.expires_at>now()
        AND c.created_at>=state.started_at
        AND c.created_at>=push.created_at
        AND (
          e.creator_address=push.wallet_address
          OR (
            (
              (c.audience='ALL_ELIGIBLE' AND se.wallet_address IS NOT NULL)
              OR (
                c.audience='NOT_VOTED'
                AND se.wallet_address IS NOT NULL
                AND v.id IS NULL
              )
              OR (
                c.audience='SUBSCRIBERS'
                AND subscription.wallet_address IS NOT NULL
                AND c.created_at>=subscription.updated_at
              )
            )
            AND (
              -- The event toggle controls only the automatic deployment
              -- announcement. Manually issued event notices continue to use
              -- the audience selected by the organiser.
              c.message_id IS DISTINCT FROM NULLIF(
                e.announcement_message->>'messageId',
                ''
              )::uuid
              OR (
                (
                  e.snap_delivery_mode='ELIGIBLE'
                  AND se.wallet_address IS NOT NULL
                )
                OR (
                  e.snap_delivery_mode='SUBSCRIBERS_ONLY'
                  AND subscription.wallet_address IS NOT NULL
                  AND c.created_at>=subscription.updated_at
                )
              )
            )
          )
        )
      ORDER BY push.updated_at DESC`,
    [messageId],
  );
  return recipients.rows;
}

async function eventSubscriptions(messageId) {
  let messagePersisted = false;
  for (let attempt = 0; attempt < EVENT_LOOKUP_ATTEMPTS; attempt += 1) {
    const rows = await persistedEventSubscriptions(messageId);
    if (rows !== null) {
      messagePersisted = true;
      if (rows.length > 0 || attempt === EVENT_LOOKUP_ATTEMPTS - 1) return rows;
    }
    if (attempt < EVENT_LOOKUP_ATTEMPTS - 1) {
      await sleep(EVENT_LOOKUP_BASE_DELAY_MS * (attempt + 1));
    }
  }

  logger.warn(
    { messageId, messagePersisted },
    messagePersisted
      ? 'Event browser push resolved no eligible registered endpoints'
      : 'Event browser push message was not visible after publication retries',
  );
  return [];
}

function reserveQueueSlot(messageId) {
  const now = Date.now();
  for (const [knownMessageId, expiresAt] of recentlyQueuedMessageIds) {
    if (expiresAt <= now) recentlyQueuedMessageIds.delete(knownMessageId);
  }
  const reservedUntil = recentlyQueuedMessageIds.get(messageId) ?? 0;
  if (reservedUntil > now) return false;
  recentlyQueuedMessageIds.set(messageId, now + QUEUE_DEDUPE_MS);
  return true;
}

async function deliverToSubscription(row, message, payload, result, canRead = null) {
  try {
    if (canRead && !await canRead(row.wallet_address)) return;
    result.eligible += 1;
    await webPush.sendNotification(
      {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      },
      payload,
      deliveryOptions(message),
    );
    result.delivered += 1;
  } catch (error) {
    const statusCode = Number(error?.statusCode ?? 0);
    if (statusCode === 404 || statusCode === 410) {
      await removeExpiredEndpoint(row.endpoint).catch(() => {});
      result.expired += 1;
      return;
    }
    result.failed += 1;
    logger.warn(
      {
        err: error,
        messageId: message.messageId,
        eventId: message.eventId ?? undefined,
        walletAddress: row.wallet_address,
        statusCode: statusCode || undefined,
      },
      'Browser push delivery failed',
    );
  }
}

export function browserPushConfigured() {
  return configured;
}

export async function saveBrowserPushSubscription(walletInput, input) {
  requireConfigured();
  const walletAddress = normalizeAddress(walletInput, 'walletAddress');
  await ensureNotificationState(walletAddress);
  const endpoint = normalizeEndpoint(input.subscription.endpoint);
  const { p256dh, auth } = input.subscription.keys;
  await query(
    `INSERT INTO web_push_subscriptions(wallet_address,endpoint,p256dh,auth)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT(endpoint) DO UPDATE SET
       wallet_address=EXCLUDED.wallet_address,
       p256dh=EXCLUDED.p256dh,
       auth=EXCLUDED.auth,
       updated_at=now()`,
    [walletAddress, endpoint, p256dh, auth],
  );
  return { enabled: true, walletAddress };
}

export async function deleteBrowserPushSubscription(walletInput, endpointInput) {
  const walletAddress = normalizeAddress(walletInput, 'walletAddress');
  const endpoint = normalizeEndpoint(endpointInput);
  await query(
    'DELETE FROM web_push_subscriptions WHERE wallet_address=$1 AND endpoint=$2',
    [walletAddress, endpoint],
  );
  return { enabled: false, walletAddress };
}

export async function deliverBrowserPush(message) {
  if (!configured || !message?.messageId) {
    return { checked: 0, eligible: 0, delivered: 0, expired: 0, failed: 0 };
  }

  const eventScoped = isEventMessage(message);
  const subscriptions = eventScoped
    ? await eventSubscriptions(message.messageId)
    : (await query(
      `SELECT wallet_address,endpoint,p256dh,auth
         FROM web_push_subscriptions
        ORDER BY updated_at DESC`,
    )).rows;

  const result = {
    checked: subscriptions.length,
    eligible: 0,
    delivered: 0,
    expired: 0,
    failed: 0,
  };
  const payload = notificationPayload(message);

  let canRead = null;
  if (!eventScoped) {
    const eligibility = new Map();
    canRead = (walletAddress) => {
      if (!eligibility.has(walletAddress)) {
        eligibility.set(
          walletAddress,
          walletCanReadMessage(walletAddress, message.messageId),
        );
      }
      return eligibility.get(walletAddress);
    };
  }

  await mapWithConcurrency(
    subscriptions,
    DELIVERY_CONCURRENCY,
    (row) => deliverToSubscription(row, message, payload, result, canRead),
  );
  return result;
}

export function queueBrowserPush(message) {
  if (!configured || !message?.messageId) return false;
  if (!reserveQueueSlot(message.messageId)) return false;
  setImmediate(() => {
    deliverBrowserPush(message)
      .then((result) => {
        logger.info(
          {
            messageId: message.messageId,
            eventId: message.eventId ?? undefined,
            scope: isEventMessage(message) ? 'EVENT' : 'TOKEN',
            ...result,
          },
          'Browser push dispatch completed',
        );
      })
      .catch((error) => {
        logger.warn(
          { err: error, messageId: message.messageId, eventId: message.eventId ?? undefined },
          'Browser push dispatch failed',
        );
      });
  });
  return true;
}
