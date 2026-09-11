import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('event progress refresh is stable, immediate, SSE-driven, and polling-backed', async () => {
  const [hooks, organiser, jobs, stream] = await Promise.all([
    read('apps/web/src/hooks.js'),
    read('apps/web/src/pages/OrganiserDashboard.jsx'),
    read('apps/api/src/jobs.js'),
    read('apps/api/src/event-stream.js'),
  ]);

  assert.match(hooks, /const refresh = useCallback\(\(\) => load\(true\), \[load\]\)/u);
  assert.match(hooks, /fallbackInterval = 2_000/u);
  assert.match(hooks, /void refreshOnce\(\)/u);
  assert.match(hooks, /source\.addEventListener\('event-progress', refreshOnce\)/u);
  assert.match(hooks, /setTimeout\(async \(\) => \{[\s\S]*scheduleFallback\(\)/u);
  assert.doesNotMatch(hooks, /setInterval\(refreshOnce/u);
  assert.match(organiser, /useEventLiveRefresh\([\s\S]*?2_000,/u);
  assert.match(jobs, /publishEventUpdate\(result\.rows\[0\]\?\.event_id\)/u);
  assert.match(stream, /Content-Type': 'text\/event-stream'/u);
  assert.match(stream, /X-Accel-Buffering': 'no'/u);
});
