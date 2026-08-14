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

test('organiser dashboards and the communications portal are public wallet-scoped reads', () => {
  assert.match(routeLine('get', '/v1/dashboard/organiser'), /async/);
  assert.doesNotMatch(routeLine('get', '/v1/dashboard/organiser'), /requireAuth/);
  assert.match(routeLine('get', '/v1/communications/portal'), /async/);
  assert.doesNotMatch(routeLine('get', '/v1/communications/portal'), /requireAuth/);
  assert.match(notifications, /communications\/portal\?\$\{query\}.*auth: false/s);
  assert.match(home, /dashboard\/organiser\?wallet=.*auth: false/s);
});

test('organiser create and communication actions never invoke wallet authentication', () => {
  assert.doesNotMatch(organiser, /ensureAuthenticated|authBusy|Unlock organiser/);
  assert.doesNotMatch(notifications, /ensureAuthenticated|getSigner\(|signMessage\(/);
  assert.match(routeLine('post', '/v1/events'), /publicWriteLimiter/);
  assert.match(routeLine('post', '/v1/communications/token/platform'), /publicWriteLimiter/);
  assert.match(routeLine('post', '/v1/events/:id/communications/platform'), /publicWriteLimiter/);
});
