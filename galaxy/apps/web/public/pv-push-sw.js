const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN_NOTIFICATION_MESSAGE = 'PV_PUSH_OPEN_NOTIFICATION';
const BOOTSTRAP_PARAMETER = 'pvPushMessageId';
const FOCUS_TIMEOUT_MS = 1_500;
const OPEN_WINDOW_TIMEOUT_MS = 5_000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function after(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function bounded(operation, milliseconds) {
  try {
    return await Promise.race([operation, after(milliseconds).then(() => null)]);
  } catch {
    return null;
  }
}

function isTopLevelDappClient(client) {
  try {
    const topLevel = client.frameType === undefined || client.frameType === 'top-level';
    return topLevel && new URL(client.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function clientPriority(client) {
  return Number(client.focused) * 2 + Number(client.visibilityState === 'visible');
}

function bootstrapUrl(messageId) {
  const url = new URL('/', self.location.origin);
  url.searchParams.set(BOOTSTRAP_PARAMETER, messageId);
  return url.href;
}

async function openNotification(messageId) {
  const windows = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  const client = windows
    .filter(isTopLevelDappClient)
    .sort((left, right) => clientPriority(right) - clientPriority(left))[0];

  if (client) {
    // Keep routing inside the mounted React application. This avoids a second
    // document request through an office proxy and avoids selecting embedded
    // Reown/WalletConnect frames.
    try {
      client.postMessage({ type: OPEN_NOTIFICATION_MESSAGE, messageId });
      await bounded(client.focus(), FOCUS_TIMEOUT_MS);
      return;
    } catch {
      // Fall through to opening the already-allowlisted application root.
    }
  }

  if (typeof self.clients.openWindow !== 'function') return;

  // Only the root is network-loaded. App.jsx consumes the short bootstrap query
  // and performs the /notifications transition through React Router.
  const opened = await bounded(
    self.clients.openWindow(bootstrapUrl(messageId)),
    OPEN_WINDOW_TIMEOUT_MS,
  );
  if (opened) await bounded(opened.focus(), FOCUS_TIMEOUT_MS);
}

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { payload = {}; }
  const messageId = MESSAGE_ID.test(String(payload.messageId ?? ''))
    ? String(payload.messageId).toLowerCase()
    : null;
  if (!messageId) return;

  event.waitUntil(self.registration.showNotification(
    String(payload.title || 'Mini Galaxy Proxy Voting').slice(0, 120),
    {
      body: String(payload.body || 'New verified voting communication.').slice(0, 180),
      icon: '/favicon.png',
      badge: '/favicon.png',
      tag: `pv-${messageId}`,
      renotify: true,
      data: { messageId },
    },
  ));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const messageId = String(event.notification.data?.messageId ?? '').toLowerCase();
  if (!MESSAGE_ID.test(messageId)) return;
  event.waitUntil(openNotification(messageId));
});
