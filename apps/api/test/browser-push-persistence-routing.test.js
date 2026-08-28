import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('browser push restores its saved wallet binding at application startup without a permission prompt', async () => {
  const [app, push] = await Promise.all([
    read('apps/web/src/App.jsx'),
    read('apps/web/src/browser-push.js'),
  ]);

  assert.match(app, /restoreBrowserPushBinding/u);
  assert.match(app, /useEffect\(\(\) => \{\s*void restoreBrowserPushBinding\(\);\s*\}, \[\]\);/u);
  assert.match(push, /export async function restoreBrowserPushBinding/u);
  assert.match(push, /persistSubscription\(subscription, binding\.walletAddress\)/u);
  assert.match(push, /enabled: endpointMatches/u);
  assert.match(push, /const bindingKey = 'pv-v2-browser-push-binding'/u);
  assert.match(push, /click-routing-4/u);

  const restoreStart = push.indexOf('export async function restoreBrowserPushBinding');
  const restoreEnd = push.indexOf('export async function browserPushState');
  const restoreBody = restoreStart >= 0 && restoreEnd > restoreStart
    ? push.slice(restoreStart, restoreEnd)
    : '';
  assert.ok(restoreBody);
  assert.doesNotMatch(restoreBody, /requestPermission/u);
  assert.doesNotMatch(restoreBody, /saveBinding\(null\)/u);
});

test('event announcement actions use the mounted React vote route', async () => {
  const page = await read('apps/web/src/pages/WalletComms.jsx');

  assert.match(page, /import \{ Link, useLocation \} from 'react-router-dom';/u);
  assert.match(page, /function EventNotificationAction/u);
  assert.match(page, /to=\{`\/vote\/\$\{message\.eventId\}`\}/u);
  assert.match(page, /<EventNotificationAction message=\{message\} \/>/u);
  assert.doesNotMatch(
    page,
    /message\.scope === 'EVENT' && message\.actionUrl && <a className="notification-action"/u,
  );
});
