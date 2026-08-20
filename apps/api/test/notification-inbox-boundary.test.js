import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('notification inbox state is wallet-scoped and stores no message content', async () => {
  const migration = await read('db/migrations/005_notification_inbox_state.sql');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS wallet_notification_state/u);
  assert.match(migration, /wallet_address varchar\(42\) PRIMARY KEY/u);
  assert.match(migration, /started_at timestamptz NOT NULL DEFAULT now\(\)/u);
  assert.match(migration, /last_read_at timestamptz/u);
  assert.doesNotMatch(migration, /message_id|title|body|action_url|token_symbol/u);
});

test('new wallets and new subscriptions do not receive old token history', async () => {
  const communications = await read('apps/api/src/communications.js');

  assert.match(communications, /export async function ensureNotificationState/u);
  assert.match(communications, /c\.created_at >= \$2/u);
  assert.match(communications, /c\.created_at >= s\.updated_at/u);
  assert.match(communications, /ORDER BY c\.created_at DESC LIMIT 100/u);
  assert.match(communications, /deliveredAt: row\.created_at/u);
  assert.match(communications, /WHEN snap_subscriptions\.enabled=false AND EXCLUDED\.enabled=true THEN now\(\)/u);
});

test('read state is persisted through one wallet-scoped resource', async () => {
  const [communications, validation, server, notifications] = await Promise.all([
    read('apps/api/src/communications.js'),
    read('apps/api/src/validation.js'),
    read('apps/api/src/server.js'),
    read('apps/web/src/notifications.jsx'),
  ]);

  assert.match(communications, /export async function markInboxRead/u);
  assert.match(communications, /SET last_read_at=now\(\),updated_at=now\(\)/u);
  assert.match(communications, /read: lastReadAt !== null/u);
  assert.match(validation, /export const notificationReadInput/u);
  assert.match(server, /app\.put\('\/v1\/communications\/inbox\/read', publicWriteLimiter/u);
  assert.equal((server.match(/\/v1\/communications\/inbox\/read/gu) ?? []).length, 1);
  assert.match(notifications, /api\('\/v1\/communications\/inbox\/read'/u);
  assert.match(notifications, /message\.read === true/u);
  assert.doesNotMatch(notifications, /localStorage|readStoragePrefix|saveReadIds|loadReadIds/u);
});

test('notifications page shows five per page and only unread counts', async () => {
  const page = await read('apps/web/src/pages/WalletComms.jsx');

  assert.match(page, /const NOTIFICATIONS_PER_PAGE = 5/u);
  assert.match(page, /const DEFAULT_NOTIFICATION_EXPIRY_MS = 48 \* 60 \* 60_000/u);
  assert.match(page, /const pagedMessages = notifications\.messages\.slice/u);
  assert.match(page, /pagedMessages\.map/u);
  assert.match(page, /Page \{currentPage\} of \{pageCount\}/u);
  assert.match(page, /notifications\.unreadCount/u);
  assert.match(page, /notifications\.markAllRead\(\)/u);
  assert.match(page, /activeTab === 'announcements'/u);
  assert.doesNotMatch(page, /aria-label=\{`\$\{notificationCount\} announcement/u);
  assert.doesNotMatch(page, /notification-total">\{notificationCount\}/u);
});
