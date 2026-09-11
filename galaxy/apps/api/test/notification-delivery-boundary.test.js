import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('automatic announcements are durable and recoverable', async () => {
  const [announcements, deploy, server] = await Promise.all([
    read('apps/api/src/event-announcements.js'),
    read('apps/api/src/deploy.js'),
    read('apps/api/src/server.js'),
  ]);

  assert.match(announcements, /SELECT \* FROM events WHERE id=\$1\$\{lock \? ' FOR UPDATE' : ''\}/u);
  assert.match(announcements, /ON CONFLICT\(message_id\) DO UPDATE SET/u);
  assert.match(announcements, /hasValidStoredAnnouncement/u);
  assert.match(announcements, /verifyMessage\(draft\.signingMessage/u);
  assert.match(announcements, /export async function publishReadyEventAnnouncements/u);
  assert.match(announcements, /LEFT JOIN communications c/u);
  assert.match(announcements, /announcement_published_at IS NULL/u);

  const alreadyComplete = deploy.indexOf('if (event.deployment_block !== null)');
  const repairCall = deploy.indexOf('await publishAutomaticAnnouncement(event.id);', alreadyComplete);
  const earlyReturn = deploy.indexOf('alreadyComplete: true', alreadyComplete);
  assert.ok(alreadyComplete >= 0 && repairCall > alreadyComplete && repairCall < earlyReturn);

  assert.match(server, /startAnnouncementSweep\(\)/u);
  assert.match(server, /setInterval\(sweepReadyAnnouncements/u);
  assert.match(server, /browserPushConfigured: browserPushConfigured\(\)/u);
  assert.match(server, /result\.messages\.forEach\(queueBrowserPush\)/u);
});

test('platform communications remain signature-verifiable without a wallet prompt', async () => {
  const [communications, announcements] = await Promise.all([
    read('apps/api/src/communications.js'),
    read('apps/api/src/event-announcements.js'),
  ]);

  assert.match(
    communications,
    /const message = eventMessageFor\(event, input, relayer\.address\.toLowerCase\(\)\);/u,
  );
  assert.match(
    communications,
    /const signature = await relayer\.signMessage\(buildCommunicationSigningMessage\(message\)\);/u,
  );
  assert.match(announcements, /creatorAddress: notificationPublisherAddress/u);
  assert.match(announcements, /const signature = await relayer\.signMessage\(draft\.signingMessage\);/u);
  assert.match(announcements, /return \{ checked: candidates\.rowCount, published, messages, failures \}/u);
});

test('the Notifications page mirrors successful publications into MetaMask', async () => {
  const page = await read('apps/web/src/pages/WalletComms.jsx');
  assert.match(page, /checkSnapNow/u);
  assert.match(page, /await notifications\.refresh\(\{ silent: true \}\)/u);
  assert.match(page, /const rejected = Number\(result\.rejected \?\? 0\)/u);
  assert.match(page, /mirror a newly received verified announcement into/u);
});
