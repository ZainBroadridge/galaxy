import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const read = () => readFile(new URL('../../web/src/pages/OrganiserDashboard.jsx', import.meta.url), 'utf8');
async function schedule(timezoneOffset, now) {
  const source = await read();
  const localDate = source.slice(source.indexOf('const localDate ='), source.indexOf('const iso ='));
  const definitions = source.slice(source.indexOf('const DEMO_RECORD_AGE_MS'), source.indexOf('function demoProposals('));
  assert.ok(localDate.includes('getTimezoneOffset'));
  assert.ok(definitions.includes('function demoSchedule('));
  class Clock extends Date {
    static now() { return now; }
    getTimezoneOffset() { return timezoneOffset; }
  }
  return vm.runInNewContext(`${localDate}\n${definitions}\ndemoSchedule;`, { Date: Clock });
}

for (const [offset, expected] of [
  [0, { recordDateAt: '2026-09-11T10:00', votingStartAt: '2026-09-11T12:05', votingEndAt: '2026-09-11T13:00' }],
  [-330, { recordDateAt: '2026-09-11T15:30', votingStartAt: '2026-09-11T17:35', votingEndAt: '2026-09-11T18:30' }],
]) {
  test(`demo autofill uses a 2-hour-old record, +5-minute start and +60-minute end at UTC offset ${-offset} minutes`, async () => {
    const now = Date.parse('2026-09-11T12:00:00Z');
    const demoSchedule = await schedule(offset, now);
    assert.deepEqual({ ...demoSchedule() }, expected);
    assert.deepEqual({ ...demoSchedule(now) }, expected);
    const later = demoSchedule(now + 60 * 60_000);
    for (const field of Object.keys(expected)) {
      assert.equal(Date.parse(later[field] + ':00Z') - Date.parse(expected[field] + ':00Z'), 60 * 60_000,
        'A later autofill must use fresh relative dates.');
    }
  });
}
