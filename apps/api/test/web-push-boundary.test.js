import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('clickable browser notifications disclose only a message reference before wallet connection', async () => {
  const [serviceWorker, browserPush, page] = await Promise.all([
    read('apps/web/public/pv-push-sw.js'),
    read('apps/web/src/browser-push.js'),
    read('apps/web/src/pages/WalletComms.jsx'),
  ]);

  assert.match(serviceWorker, /\/notifications\?messageId=/u);
  assert.match(serviceWorker, /data: \{ messageId \}/u);
  assert.doesNotMatch(serviceWorker, /actionUrl|walletAddress|message\.body/u);
  assert.match(page, /!wallet\.connected && <Panel/u);
  assert.match(page, /Connect the wallet that received this notification/u);
  assert.match(page, /This communication is not available for the connected wallet/u);
  assert.match(browserPush, /Notification\.requestPermission\(\)/u);
  assert.doesNotMatch(browserPush, /signMessage|signTypedData|ensureAuthenticated|getSigner/u);
});

test('browser push reuses inbox audience rules and keeps one subscription resource route', async () => {
  const [server, delivery, migration] = await Promise.all([
    read('apps/api/src/server.js'),
    read('apps/api/src/web-push.js'),
    read('db/migrations/004_web_push_subscriptions.sql'),
  ]);

  assert.match(server, /app\.put\('\/v1\/communications\/push-subscription', publicWriteLimiter/u);
  assert.match(server, /app\.delete\('\/v1\/communications\/push-subscription', publicWriteLimiter/u);
  assert.equal((server.match(/\/v1\/communications\/push-subscription/gu) ?? []).length, 2);
  assert.match(delivery, /import \{ inbox \} from '\.\/communications\.js'/u);
  assert.match(delivery, /walletCanReadMessage/u);
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
