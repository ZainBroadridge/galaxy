import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('browser push targets the exact event message using the subscription delivery boundary', async () => {
  const [communications, webPush] = await Promise.all([
    read('apps/api/src/communications.js'),
    read('apps/api/src/web-push.js'),
  ]);

  assert.match(communications, /export async function inbox\(wallet, options = \{\}\)/u);
  assert.match(communications, /messageId = typeof options\.messageId === 'string'/u);
  assert.match(communications, /deliveryStartedAt/u);
  assert.equal(
    (communications.match(/\(\$3::uuid IS NULL OR c\.message_id=\$3::uuid\)/gu) ?? []).length,
    2,
  );
  assert.match(webPush, /created_at AS subscription_started_at/u);
  assert.match(
    webPush,
    /inbox\(walletAddress, \{\s*messageId,\s*startedAt: subscriptionStartedAt,\s*\}\)/u,
  );
  assert.match(webPush, /Browser push dispatch completed/u);
});

test('automatic and manual event announcements always enter the browser-push dispatcher', async () => {
  const [server, deploy, announcements] = await Promise.all([
    read('apps/api/src/server.js'),
    read('apps/api/src/deploy.js'),
    read('apps/api/src/event-announcements.js'),
  ]);

  assert.match(server, /app\.post\('\/v1\/events\/:id\/communications\/platform'[\s\S]*queueBrowserPush\(message\)/u);
  assert.match(server, /app\.post\('\/v1\/events\/:id\/communications'[\s\S]*queueBrowserPush\(message\)/u);
  assert.equal((server.match(/if \(result\.message\) queueBrowserPush\(result\.message\);/gu) ?? []).length, 2);
  assert.match(deploy, /publishPendingEventAnnouncement\(eventId\)[\s\S]*if \(result\.message\) queueBrowserPush/u);
  assert.match(announcements, /event\.announcement_published_at[\s\S]*event\.announcement_message\?\.publishedAt[\s\S]*Date\.now\(\)/u);
  assert.match(announcements, /created_at=now\(\)/u);
});

test('Snap RPC handler is assignable without optional undefined JSON fields', async () => {
  const snap = await read('apps/snap/src/index.tsx');

  assert.match(snap, /type RpcRequestContext = Parameters<OnRpcRequestHandler>\[0\]/u);
  assert.match(snap, /const handleRpcRequest = async/u);
  assert.match(snap, /export const onRpcRequest = handleRpcRequest as unknown as OnRpcRequestHandler/u);
  assert.doesNotMatch(snap, /export const onRpcRequest: OnRpcRequestHandler = async/u);
});

test('footer is minute and grey while the Home add-network control is bottom-right', async () => {
  const [app, styles] = await Promise.all([
    read('apps/web/src/App.jsx'),
    read('apps/web/src/styles.css'),
  ]);

  assert.match(app, /className="pv-footer-brand"/u);
  assert.match(app, /className="pv-footer-mark"/u);
  assert.match(styles, /--pv-footer-height: 34px/u);
  assert.match(styles, /\.pv-site-footer \{[\s\S]*background: #f4f4f5/u);
  assert.match(styles, /\.pv-footer-brand \{[\s\S]*font-size: 10px/u);
  assert.match(styles, /\.pv-site-footer \.footer-copyright \{[\s\S]*font-size: 10px/u);
  assert.match(styles, /\.pv-add-network-wrap \{[\s\S]*right: 24px;[\s\S]*left: auto/u);
  assert.match(styles, /\.pv-network-tooltip \{[\s\S]*right: calc\(100% \+ 11px\);[\s\S]*left: auto/u);
});
