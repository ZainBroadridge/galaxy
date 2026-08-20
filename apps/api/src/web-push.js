import webPush from 'web-push';
import { config } from './config.js';
import { query } from './db.js';
import { HttpError, normalizeAddress } from './errors.js';
import { ensureNotificationState, inbox } from './communications.js';
import { logger } from './logger.js';

const DELIVERY_CONCURRENCY = 6;
const MAX_TTL_SECONDS = 24 * 60 * 60;
const DELIVERY_TIMEOUT_MS = 10_000;
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

async function deliverToSubscription(row, message, payload, result, canRead) {
  try {
    if (!await canRead(row.wallet_address)) return;
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
      { err: error, messageId: message.messageId, statusCode: statusCode || undefined },
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
  const subscriptions = await query(
    `SELECT wallet_address,endpoint,p256dh,auth
       FROM web_push_subscriptions
      ORDER BY updated_at DESC`,
  );
  const result = {
    checked: subscriptions.rowCount,
    eligible: 0,
    delivered: 0,
    expired: 0,
    failed: 0,
  };
  const payload = notificationPayload(message);
  const eligibility = new Map();
  const canRead = (walletAddress) => {
    if (!eligibility.has(walletAddress)) {
      eligibility.set(
        walletAddress,
        walletCanReadMessage(walletAddress, message.messageId),
      );
    }
    return eligibility.get(walletAddress);
  };
  await mapWithConcurrency(
    subscriptions.rows,
    DELIVERY_CONCURRENCY,
    (row) => deliverToSubscription(row, message, payload, result, canRead),
  );
  return result;
}

export function queueBrowserPush(message) {
  if (!configured || !message?.messageId) return;
  setImmediate(() => {
    deliverBrowserPush(message).catch((error) => {
      logger.warn({ err: error, messageId: message.messageId }, 'Browser push dispatch failed');
    });
  });
}
