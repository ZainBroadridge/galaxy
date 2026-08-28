import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('demo autofill uses relative record, start, and end timestamps', async () => {
  const organiser = await read('apps/web/src/pages/OrganiserDashboard.jsx');

  assert.match(organiser, /const DEMO_RECORD_AGE_MS = 24 \* 60 \* 60_000;/u);
  assert.match(organiser, /const DEMO_START_DELAY_MS = 5 \* 60_000;/u);
  assert.match(organiser, /const DEMO_END_DELAY_MS = 60 \* 60_000;/u);
  assert.match(organiser, /function demoSchedule\(now = Date\.now\(\)\)/u);
  assert.match(organiser, /recordDateAt: localDate\(new Date\(now - DEMO_RECORD_AGE_MS\)\)/u);
  assert.match(organiser, /votingStartAt: localDate\(new Date\(now \+ DEMO_START_DELAY_MS\)\)/u);
  assert.match(organiser, /votingEndAt: localDate\(new Date\(now \+ DEMO_END_DELAY_MS\)\)/u);
  assert.doesNotMatch(organiser, /SAMPLE_DEMO_SCHEDULE/u);
});
