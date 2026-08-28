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

test('receipt and document cards share one width and every external detail link is underlined', async () => {
  const [page, styles] = await Promise.all([
    read('apps/web/src/pages/VotingDashboard.jsx'),
    read('apps/web/src/styles.css'),
  ]);

  assert.equal((page.match(/vote-detail-link/gu) ?? []).length, 4);
  assert.match(
    styles,
    /\.vote-content-frame > \.ballot-documents \{\s*width: min\(var\(--ui-receipt-width\), 100%\);\s*max-width: var\(--ui-receipt-width\);/u,
  );
  assert.match(
    styles,
    /\.receipt-panel\.receipt \{[\s\S]*width: min\(var\(--ui-receipt-width\), 100%\);[\s\S]*max-width: var\(--ui-receipt-width\);/u,
  );
  assert.match(styles, /\.vote-detail-link \{[\s\S]*text-decoration-line: underline;/u);
});
