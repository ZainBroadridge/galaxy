import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('event browser push and Snap inbox share one recipient policy', async () => {
  const [communications, policy, webPush] = await Promise.all([
    read('apps/api/src/communications.js'),
    read('apps/api/src/communication-recipient-policy.js'),
    read('apps/api/src/web-push.js'),
  ]);

  assert.match(communications, /canReceiveEventCommunication\(eventRecipientContext\(row\)\)/u);
  assert.match(communications, /export async function eventBrowserPushRecipients/u);
  assert.match(policy, /export function canReceiveEventCommunication/u);
  assert.match(policy, /case EVENT_AUDIENCE\.SUBSCRIBERS:[\s\S]*return isSubscribed;/u);
  assert.match(webPush, /eventBrowserPushRecipients/u);
  assert.match(webPush, /resolveEventSubscriptions/u);
});

test('automatic and manual event announcements always enter the browser-push dispatcher', async () => {
  const [server, deploy, announcements] = await Promise.all([
    read('apps/api/src/server.js'),
    read('apps/api/src/deploy.js'),
    read('apps/api/src/event-announcements.js'),
  ]);

  assert.match(
    server,
    /app\.post\('\/v1\/events\/:id\/communications\/platform'[\s\S]*queueBrowserPush\(message\)/u,
  );
  assert.match(
    server,
    /app\.post\('\/v1\/events\/:id\/communications'[\s\S]*queueBrowserPush\(message\)/u,
  );
  assert.match(server, /result\.messages\.forEach\(queueBrowserPush\)/u);
  assert.match(
    deploy,
    /publishPendingEventAnnouncement\(eventId\)[\s\S]*result\.published \|\| result\.redelivered[\s\S]*queueBrowserPush\(result\.message\)/u,
  );
  assert.match(announcements, /redelivered: true/u);
  assert.match(announcements, /SET created_at=now\(\),revoked_at=NULL/u);
});

test('Snap RPC handler is assignable without optional undefined JSON fields', async () => {
  const snap = await read('apps/snap/src/index.tsx');

  assert.match(snap, /type RpcRequestContext = Parameters<OnRpcRequestHandler>\[0\]/u);
  assert.match(snap, /const handleRpcRequest = async/u);
  assert.match(snap, /export const onRpcRequest = handleRpcRequest as unknown as OnRpcRequestHandler/u);
  assert.doesNotMatch(snap, /export const onRpcRequest: OnRpcRequestHandler = async/u);
});

test('one shared footer retains the issuer minute grey presentation on all routes', async () => {
  const [app, footer, styles, issuer] = await Promise.all([
    read('apps/web/src/App.jsx'), read('apps/web/src/components/SiteFooter.jsx'),
    read('apps/web/src/components/portal.css'), read('apps/web/src/issuer/IssuerLayout.jsx'),
  ]);
  assert.match(app, /<SiteFooter \/>/u);
  assert.match(footer, /className="portal-footer-brand"/u);
  assert.match(footer, /All rights reserved/u);
  assert.match(styles, /background: #f4f4f5/u);
  assert.match(styles, /font: 400 10px/u);
  assert.doesNotMatch(issuer, /pv-add-network|<footer/u);
});
