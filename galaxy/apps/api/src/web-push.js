import webPush from 'web-push';
import { config } from './config.js';
import { query } from './db.js';
import { HttpError, normalizeAddress } from './errors.js';
import {
  ensureNotificationState,
  eventBrowserPushRecipients,
  inbox,
} from './communications.js';
import { logger } from './logger.js';

const DELIVERY_CONCURRENCY = 6;
const MAX_TTL_SECONDS = 24 * 60 * 60;
const DELIVERY_TIMEOUT_MS = 10_000;
const EVENT_PERSISTENCE_ATTEMPTS = 4;
const EVENT_PERSISTENCE_DELAY_MS = 125;
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

function isEventMessage(message) {
  return message?.scope === 'EVENT'
    || (Boolean(message?.eventId) && message?.scope !== 'TOKEN');
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

async function tokenWalletCanReadMessage(walletAddress, messageId, subscriptionStartedAt) {
  const messages = await inbox(walletAddress, {
    messageId,
    startedAt: subscriptionStartedAt,
  });
  return messages.some((message) => message.messageId === messageId);
}

async function resolveEventSubscriptions(messageId) {
  for (let attempt = 0; attempt < EVENT_PERSISTENCE_ATTEMPTS; attempt += 1) {
    const result = await eventBrowserPushRecipients(messageId);
    if (result.persisted) {
      return { checked: result.candidateCount, subscriptions: result.recipients };
    }
    if (attempt < EVENT_PERSISTENCE_ATTEMPTS - 1) {
      await sleep(EVENT_PERSISTENCE_DELAY_MS * (attempt + 1));
    }
  }

  logger.warn(
    { messageId },
    'Event browser push message was not visible after publication retries',
  );
  return { checked: 0, subscriptions: [] };
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
    if (canRead && !await canRead(row)) return;
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
       created_at=CASE
         WHEN web_push_subscriptions.wallet_address<>EXCLUDED.wallet_address THEN now()
         ELSE web_push_subscriptions.created_at
       END,
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
  let subscriptions;
  let checked;
  if (eventScoped) {
    const resolved = await resolveEventSubscriptions(message.messageId);
    subscriptions = resolved.subscriptions;
    checked = resolved.checked;
  } else {
    subscriptions = (await query(
      `SELECT wallet_address,endpoint,p256dh,auth,
              created_at AS subscription_started_at
         FROM web_push_subscriptions
        ORDER BY updated_at DESC`,
    )).rows;
    checked = subscriptions.length;
  }

  const result = {
    checked,
    eligible: 0,
    delivered: 0,
    expired: 0,
    failed: 0,
  };
  const payload = notificationPayload(message);

  let canRead = null;
  if (!eventScoped) {
    const eligibility = new Map();
    canRead = (row) => {
      const key = `${row.wallet_address}:${new Date(row.subscription_started_at).toISOString()}`;
      if (!eligibility.has(key)) {
        eligibility.set(
          key,
          tokenWalletCanReadMessage(
            row.wallet_address,
            message.messageId,
            row.subscription_started_at,
          ),
        );
      }
      return eligibility.get(key);
    };
  }

  await mapWithConcurrency(
    subscriptions,
    DELIVERY_CONCURRENCY,
    (row) => deliverToSubscription(row, message, payload, result, canRead),
  );

  logger.info({
    messageId: message.messageId,
    eventId: message.eventId ?? undefined,
    scope: eventScoped ? 'EVENT' : 'TOKEN',
    category: message.category,
    ...result,
  }, 'Browser push dispatch completed');
  return result;
}

export function queueBrowserPush(message) {
  if (!configured || !message?.messageId) return false;
  if (!reserveQueueSlot(message.messageId)) return false;
  setImmediate(() => {
    deliverBrowserPush(message).catch((error) => {
      logger.warn(
        { err: error, messageId: message.messageId, eventId: message.eventId ?? undefined },
        'Browser push dispatch failed',
      );
    });
  });
  return true;
}
