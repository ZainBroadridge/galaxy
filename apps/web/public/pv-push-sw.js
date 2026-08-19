const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN_NOTIFICATION_MESSAGE = 'PV_PUSH_OPEN_NOTIFICATION';
const FOCUS_TIMEOUT_MS = 2_000;
const OPEN_WINDOW_TIMEOUT_MS = 8_000;
const CLICK_TIMEOUT_MS = 9_000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function bounded(operation, milliseconds) {
  return new Promise((resolve) => {
    let finished = false;
    const complete = (value = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => complete(), milliseconds);

    Promise.resolve()
      .then(operation)
      .then(complete)
      .catch(() => complete());
  });
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

async function openNotification(messageId) {
  const targetPath = `/notifications?messageId=${encodeURIComponent(messageId)}`;
  const targetUrl = new URL(targetPath, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = windows
    .filter(isTopLevelDappClient)
    .sort((left, right) => clientPriority(right) - clientPriority(left))[0];

  if (existing) {
    // Let the already-loaded React app perform a local route change. This avoids
    // a full page navigation through an enterprise proxy and avoids selecting a
    // nested Reown/WalletConnect frame as the destination.
    existing.postMessage({ type: OPEN_NOTIFICATION_MESSAGE, messageId });
    await bounded(() => existing.focus(), FOCUS_TIMEOUT_MS);
    return;
  }

  if (typeof self.clients.openWindow === 'function') {
    // When no dApp tab exists, opening a top-level window remains controlled by
    // browser/administrator policy. Bound the request so the notification click
    // cannot remain in a permanent loading state when that action is blocked.
    await bounded(() => self.clients.openWindow(targetUrl), OPEN_WINDOW_TIMEOUT_MS);
  }
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

  // The outer timeout also covers clients.matchAll(). Promise.race does not
  // cancel a browser operation, but it prevents the OS toast from spinning
  // indefinitely if a managed browser never settles the navigation request.
  event.waitUntil(bounded(() => openNotification(messageId), CLICK_TIMEOUT_MS));
});
