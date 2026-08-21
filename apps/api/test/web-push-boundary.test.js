import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('clickable browser notifications route through the mounted React application', async () => {
  const [serviceWorker, browserPush, app, page] = await Promise.all([
    read('apps/web/public/pv-push-sw.js'),
    read('apps/web/src/browser-push.js'),
    read('apps/web/src/App.jsx'),
    read('apps/web/src/pages/WalletComms.jsx'),
  ]);

  assert.match(serviceWorker, /pvPushMessageId/u);
  assert.match(serviceWorker, /frameType === 'top-level'/u);
  assert.match(serviceWorker, /client\.postMessage/u);
  assert.match(serviceWorker, /client\.focus\(\)/u);
  assert.match(serviceWorker, /clients\.openWindow\(bootstrapUrl\(messageId\)\)/u);
  assert.doesNotMatch(serviceWorker, /\.navigate\(/u);
  assert.doesNotMatch(serviceWorker, /actionUrl|walletAddress|message\.body/u);

  assert.match(browserPush, /listenForBrowserPushOpen/u);
  assert.match(browserPush, /consumeBrowserPushBootstrap/u);
  assert.match(browserPush, /showBrowserPushClickTest/u);
  assert.match(browserPush, /click-routing-4/u);
  assert.doesNotMatch(browserPush, /window\.history\.pushState|PopStateEvent/u);

  assert.match(app, /useNavigate/u);
  assert.match(app, /listenForBrowserPushOpen/u);
  assert.match(app, /consumeBrowserPushBootstrap/u);
  assert.match(app, /navigate\(browserPushNotificationPath\(messageId\)/u);

  assert.match(page, /!wallet\.connected && <Panel/u);
  assert.match(page, /Connect the wallet that received this notification/u);
  assert.match(page, /This communication is not available for the connected wallet/u);
  assert.match(page, /Test click routing/u);
});

test('push registration reports VAPID, Brave and managed-network failures clearly', async () => {
  const [browserPush, page] = await Promise.all([
    read('apps/web/src/browser-push.js'),
    read('apps/web/src/pages/WalletComms.jsx'),
  ]);

  assert.match(browserPush, /bytes\.length !== 65 \|\| bytes\[0\] !== 4/u);
  assert.match(browserPush, /Use Google services for push messaging/u);
  assert.match(browserPush, /brave:\/\/settings\/privacy/u);
  assert.match(browserPush, /office proxy or firewall/u);
  assert.match(browserPush, /PUSH_SERVICE_UNAVAILABLE/u);
  assert.match(browserPush, /VITE_WEB_PUSH_PUBLIC_KEY/u);
  assert.match(browserPush, /sessionStorage/u);
  assert.match(page, /browserPush\?\.issue\?\.message/u);
  assert.match(page, /readableSnapIssue/u);
  assert.match(page, /MetaMask in-app alerts stay inside MetaMask/u);
  assert.match(page, /Use Google services for push messaging/u);
  assert.match(page, /returned no readable detail/u);
  assert.doesNotMatch(browserPush, /signMessage|signTypedData|ensureAuthenticated|getSigner/u);
});

test('Snap owns only the MetaMask inbox and in-app alert channel', async () => {
  const [snapSource, snapPackage, snapManifest, snapClient] = await Promise.all([
    read('apps/snap/src/index.tsx'),
    read('apps/snap/package.json'),
    read('apps/snap/snap.manifest.json'),
    read('apps/web/src/snap.js'),
  ]);

  assert.match(snapPackage, /"version": "0\.4\.2"/u);
  assert.match(snapManifest, /"version": "0\.4\.2"/u);
  assert.match(snapSource, /type: 'inApp'/u);
  assert.doesNotMatch(snapSource, /type: 'native'|notifyNative|lastNativeNotificationAt|nativeNotified/u);
  assert.match(snapSource, /MetaMask returned an unreadable alert error/u);
  assert.match(snapSource, /Clickable[\s\S]*Web Push worker/u);
  assert.match(snapClient, /SNAP_VERSION.*'0\.4\.2'/u);
});

test('browser push shares event policy, preserves token inbox rules, and keeps one subscription resource', async () => {
  const [server, delivery, migration] = await Promise.all([
    read('apps/api/src/server.js'),
    read('apps/api/src/web-push.js'),
    read('db/migrations/004_web_push_subscriptions.sql'),
  ]);

  assert.match(server, /app\.put\('\/v1\/communications\/push-subscription', publicWriteLimiter/u);
  assert.match(server, /app\.delete\('\/v1\/communications\/push-subscription', publicWriteLimiter/u);
  assert.equal((server.match(/\/v1\/communications\/push-subscription/gu) ?? []).length, 2);
  assert.match(
    delivery,
    /import \{[\s\S]*ensureNotificationState,[\s\S]*eventBrowserPushRecipients,[\s\S]*inbox,[\s\S]*\} from '\.\/communications\.js'/u,
  );
  assert.match(delivery, /await ensureNotificationState\(walletAddress\)/u);
  assert.match(delivery, /tokenWalletCanReadMessage/u);
  assert.match(delivery, /eventBrowserPushRecipients\(messageId\)/u);
  assert.match(delivery, /resolveEventSubscriptions/u);
  assert.match(delivery, /created_at AS subscription_started_at/u);
  assert.match(delivery, /startedAt: subscriptionStartedAt/u);
  assert.match(delivery, /isEventMessage/u);
  assert.match(delivery, /QUEUE_DEDUPE_MS/u);
  assert.match(delivery, /Browser push dispatch completed/u);
  assert.match(migration, /endpoint text PRIMARY KEY/u);
  assert.match(migration, /wallet_address varchar\(42\) NOT NULL/u);
  assert.doesNotMatch(migration, /message|title|body|action_url/u);
});

test('obsolete communication SSE implementation is removed', async () => {
  const [server, notifications, deploy] = await Promise.all([
    read('apps/api/src/server.js'),
    read('apps/web/src/notifications.jsx'),
    read('apps/api/src/deploy.js'),
  ]);

  assert.doesNotMatch(server, /communications\/stream|communication-stream|announceCommunication/u);
  assert.doesNotMatch(notifications, /EventSource|communications\/stream/u);
  assert.doesNotMatch(deploy, /communication-stream|announceCommunication/u);
  await assert.rejects(access(new URL('apps/api/src/communication-stream.js', root)));
});
