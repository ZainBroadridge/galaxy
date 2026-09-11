import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
const organiser = await readFile(new URL('../../web/src/pages/OrganiserDashboard.jsx', import.meta.url), 'utf8');
const notifications = await readFile(new URL('../../web/src/pages/WalletComms.jsx', import.meta.url), 'utf8');
const home = await readFile(new URL('../../web/src/pages/HomePage.jsx', import.meta.url), 'utf8');

function routeLine(method, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return server.match(new RegExp(`app\\.${method}\\('${escaped}'[^\\n]*`))?.[0] ?? '';
}

function assertPublicRoute(method, path) {
  const line = routeLine(method, path);
  assert.match(line, /async/);
  assert.doesNotMatch(line, /requireAuth/);
}

function assertPublicWriteRoute(method, path) {
  const line = routeLine(method, path);
  assert.match(line, /publicWriteLimiter/);
  assert.doesNotMatch(line, /requireAuth/);
}

test('issuer reads are demo-session protected while background notification reads stay public', () => {
  assert.match(routeLine('get', '/v1/dashboard/organiser'), /requireIssuer/u);
  assert.match(routeLine('get', '/v1/communications/portal'), /requireIssuer/u);
  assertPublicRoute('get', '/v1/communications/subscriptions');
  assertPublicRoute('get', '/v1/communications/inbox');

  assert.match(
    notifications,
    /communications\/subscriptions\?wallet=\$\{address\}`\s*,\s*\{\s*auth:\s*false\s*\}/,
  );
  assert.match(
    notifications,
    /dashboard\/organiser\?wallet=\$\{address\}`\s*,\s*\{\s*auth:\s*false\s*\}/,
  );
  assert.doesNotMatch(notifications, /communications\/portal/);
  assert.match(home, /dashboard\/organiser\?wallet=.*auth:\s*false/s);
});

test('organiser writes require the demo session but no extra wallet signature and keep rate limits', () => {
  assert.doesNotMatch(organiser, /ensureAuthenticated|authBusy|Unlock organiser|getSigner\(|signMessage\(/);
  assert.doesNotMatch(notifications, /ensureAuthenticated|getSigner\(|signMessage\(/);

  assert.match(server, /const publicWriteLimiter = limiter\(40/);
  for (const [method, route] of [
    ['post', '/v1/tokens/inspect'], ['post', '/v1/events'],
    ['post', '/v1/events/:id/retry'], ['post', '/v1/events/:id/announcement'],
    ['post', '/v1/events/:id/documents'], ['delete', '/v1/events/:id/documents/:documentId'],
    ['post', '/v1/communications/token/platform'], ['post', '/v1/events/:id/communications/platform'],
  ]) assert.match(routeLine(method, route), /requireIssuer/u, route);

  assertPublicWriteRoute('post', '/v1/tokens/inspect');
  assertPublicWriteRoute('post', '/v1/events');
  assertPublicWriteRoute('post', '/v1/events/:id/retry');
  assertPublicWriteRoute('post', '/v1/events/:id/announcement');
  assertPublicWriteRoute('put', '/v1/events/:id/announcement');
  assertPublicWriteRoute('post', '/v1/events/:id/documents');
  assertPublicWriteRoute('delete', '/v1/events/:id/documents/:documentId');
  assertPublicWriteRoute('put', '/v1/communications/subscriptions');
  assertPublicWriteRoute('put', '/v1/communications/push-subscription');
  assertPublicWriteRoute('put', '/v1/communications/inbox/read');
  assertPublicWriteRoute('delete', '/v1/communications/push-subscription');
  assertPublicWriteRoute('post', '/v1/communications/token/platform');
  assertPublicWriteRoute('post', '/v1/events/:id/communications/platform');
});
