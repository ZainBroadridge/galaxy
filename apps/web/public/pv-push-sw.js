const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
  const targetPath = `/notifications?messageId=${encodeURIComponent(messageId)}`;
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(async (windows) => {
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.navigate(targetUrl);
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    }));
});
