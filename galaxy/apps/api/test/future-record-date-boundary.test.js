import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('future record dates use the existing durable-job schedule instead of a parallel workflow', async () => {
  const [validation, events, jobs, snapshot] = await Promise.all([
    read('apps/api/src/validation.js'),
    read('apps/api/src/events.js'),
    read('apps/api/src/jobs.js'),
    read('apps/api/src/snapshot.js'),
  ]);

  assert.doesNotMatch(validation, /Record date cannot be in the future/u);
  assert.match(validation, /if \(record > start\)/u);
  assert.match(events, /planSnapshotJob\(event\.record_date_at\)/u);
  assert.match(events, /availableAt: snapshotPlan\.availableAt/u);
  assert.match(jobs, /availableAt = null/u);
  assert.match(jobs, /coalesce\(\$6::timestamptz,now\(\)\)/u);
  assert.match(jobs, /attempts=greatest\(attempts-1,0\)/u);
  assert.match(snapshot, /nextFinalityCheckAt/u);
  assert.match(snapshot, /throw deferredError/u);
  assert.doesNotMatch(snapshot, /Record date is in the future/u);
});

test('scheduled events expose their wake time and avoid long-lived browser polling', async () => {
  const [serializers, hooks, organiser] = await Promise.all([
    read('apps/api/src/serializers.js'),
    read('apps/web/src/hooks.js'),
    read('apps/web/src/pages/OrganiserDashboard.jsx'),
  ]);

  assert.match(serializers, /availableAt: row\.available_at/u);
  assert.match(serializers, /row\.status === 'SNAPSHOT_PENDING'[\s\S]*return 'SCHEDULED'/u);
  assert.match(hooks, /startsAt = null/u);
  assert.match(hooks, /MAX_BROWSER_TIMER_MS/u);
  assert.doesNotMatch(organiser, /max=\{localDate\(new Date\(\)\)\}/u);
  assert.match(organiser, /snapshot and deployment start automatically after this time reaches Polygon finality/u);
  assert.match(organiser, /jobWaitingForRecordDate/u);
});
