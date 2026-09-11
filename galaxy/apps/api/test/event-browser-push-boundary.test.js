import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('event browser push resolves the one persisted event message directly', async () => {
  const [delivery, communications] = await Promise.all([
    read('apps/api/src/web-push.js'),
    read('apps/api/src/communications.js'),
  ]);

  assert.match(delivery, /function isEventMessage\(message\)/u);
  assert.match(delivery, /async function resolveEventSubscriptions\(messageId\)/u);
  assert.match(delivery, /eventBrowserPushRecipients\(messageId\)/u);
  assert.match(communications, /export async function eventBrowserPushRecipients\(messageId\)/u);
  assert.match(communications, /FROM web_push_subscriptions push/u);
  assert.match(
    communications,
    /JOIN communications c[\s\S]*c\.message_id=\$1[\s\S]*c\.scope='EVENT'/u,
  );
  assert.match(communications, /c\.created_at>=push\.created_at/u);
});

test('event subscriber notices remain inside record-date eligibility', async () => {
  const [communications, policy] = await Promise.all([
    read('apps/api/src/communications.js'),
    read('apps/api/src/communication-recipient-policy.js'),
  ]);

  assert.match(communications, /recipient_is_subscribed/u);
  assert.match(
    communications,
    /JOIN snapshot_entries se[\s\S]*se\.wallet_address=push\.wallet_address/u,
  );
  assert.match(
    communications,
    /JOIN snapshot_entries se[\s\S]*se\.wallet_address=\$1/u,
  );
  assert.doesNotMatch(communications, /recipient_is_creator/u);
  assert.match(policy, /if \(!isEligible\) return false;/u);
  assert.match(policy, /case EVENT_AUDIENCE\.SUBSCRIBERS:[\s\S]*return isSubscribed;/u);
});

test('automatic and manual event publication paths queue browser push after persistence', async () => {
  const [server, announcements, deploy] = await Promise.all([
    read('apps/api/src/server.js'),
    read('apps/api/src/event-announcements.js'),
    read('apps/api/src/deploy.js'),
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
  assert.match(announcements, /scope: 'EVENT'/u);
  assert.match(announcements, /return \{ checked: candidates\.rowCount, published, messages, failures \}/u);
});

test('token news keeps the existing inbox-authorized delivery path', async () => {
  const delivery = await read('apps/api/src/web-push.js');

  assert.match(delivery, /tokenWalletCanReadMessage/u);
  assert.match(delivery, /const messages = await inbox\(walletAddress/u);
  assert.match(delivery, /eventScoped \? 'EVENT' : 'TOKEN'/u);
  assert.match(delivery, /const QUEUE_DEDUPE_MS/u);
});
