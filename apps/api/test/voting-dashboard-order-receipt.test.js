import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('unvoted events are ordered ahead of voted events with lifecycle timestamps preserved', async () => {
  const events = await read('apps/api/src/events.js');
  const dashboard = events.match(/export async function votingDashboard[\s\S]*?return rows\.rows\.map/u)?.[0] ?? '';

  assert.ok(dashboard);
  assert.match(
    dashboard,
    /CASE WHEN v\.status IS NOT NULL AND v\.status<>'FAILED' THEN 1 ELSE 0 END/u,
  );
  assert.match(dashboard, /CASE WHEN e\.voting_start_at<=now\(\) THEN 0 ELSE 1 END/u);
  assert.match(
    dashboard,
    /WHEN e\.voting_start_at<=now\(\) THEN e\.voting_end_at[\s\S]*ELSE e\.voting_start_at/u,
  );
});

test('issuer-branded receipt and document sections share the same parent width and readable links', async () => {
  const [page, styles] = await Promise.all([
    read('apps/web/src/investor/ConfirmationPage.jsx'),
    read('apps/web/src/investor/investor.css'),
  ]);
  assert.match(page, /investor-confirmation investor-page-width/u);
  assert.match(page, /investor-transaction-card/u);
  assert.match(page, /<EventDocuments event=\{event\}/u);
  assert.match(page, /vote\.transactionExplorerUrl/u);
  assert.match(page, /event\.contractExplorerUrl/u);
  assert.match(styles, /\.investor-app a[\s\S]*?text-decoration: underline/u);
});
