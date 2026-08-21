import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('event browser push resolves the one persisted event message directly', async () => {
  const delivery = await read('apps/api/src/web-push.js');

  assert.match(delivery, /function isEventMessage\(message\)/u);
  assert.match(delivery, /async function persistedEventSubscriptions\(messageId\)/u);
  assert.match(delivery, /JOIN communications c[\s\S]*c\.message_id=\$1[\s\S]*c\.scope='EVENT'/u);
  assert.match(delivery, /FROM web_push_subscriptions push/u);
  assert.match(delivery, /LEFT JOIN snapshot_entries se/u);
  assert.match(delivery, /c\.audience='ALL_ELIGIBLE' AND se\.wallet_address IS NOT NULL/u);
  assert.match(delivery, /c\.audience='NOT_VOTED'[\s\S]*se\.wallet_address IS NOT NULL[\s\S]*v\.id IS NULL/u);
  assert.match(delivery, /c\.audience='SUBSCRIBERS'[\s\S]*subscription\.wallet_address IS NOT NULL/u);
  assert.match(delivery, /e\.snap_delivery_mode='SUBSCRIBERS_ONLY'/u);
  assert.match(delivery, /c\.created_at>=push\.created_at/u);
  assert.match(delivery, /EVENT_LOOKUP_ATTEMPTS/u);
});

test('event subscriber notices do not incorrectly require snapshot eligibility', async () => {
  const [delivery, communications] = await Promise.all([
    read('apps/api/src/web-push.js'),
    read('apps/api/src/communications.js'),
  ]);

  for (const source of [delivery, communications]) {
    assert.match(source, /c\.audience='SUBSCRIBERS'[\s\S]*wallet_address IS NOT NULL/u);
    assert.match(source, /e\.snap_delivery_mode='ELIGIBLE'[\s\S]*se\.wallet_address IS NOT NULL/u);
    assert.match(source, /e\.snap_delivery_mode='SUBSCRIBERS_ONLY'/u);
    assert.doesNotMatch(
      source,
      /OR \(\s*se\.wallet_address IS NOT NULL\s*AND \(\s*c\.audience='ALL_ELIGIBLE'/u,
    );
  }
});

test('automatic and manual event publication paths queue browser push', async () => {
  const [server, announcements] = await Promise.all([
    read('apps/api/src/server.js'),
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
  assert.match(announcements, /import \{ queueBrowserPush \} from '\.\/web-push\.js'/u);
  assert.match(
    announcements,
    /publishPendingEventAnnouncement[\s\S]*!client && result\.published && result\.message[\s\S]*queueBrowserPush\(result\.message\)/u,
  );
  assert.match(
    announcements,
    /triggerEventAnnouncement[\s\S]*result\.published && result\.message[\s\S]*queueBrowserPush\(result\.message\)/u,
  );
});

test('token news keeps the existing inbox-authorized path and duplicate queue calls are suppressed', async () => {
  const delivery = await read('apps/api/src/web-push.js');

  assert.match(delivery, /import \{ ensureNotificationState, inbox \} from '\.\/communications\.js'/u);
  assert.match(delivery, /walletCanReadMessage\(walletAddress, message\.messageId\)/u);
  assert.match(delivery, /const QUEUE_DEDUPE_MS/u);
  assert.match(delivery, /function reserveQueueSlot\(messageId\)/u);
  assert.match(delivery, /if \(!reserveQueueSlot\(message\.messageId\)\) return false/u);
});
