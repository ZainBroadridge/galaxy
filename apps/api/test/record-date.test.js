import assert from 'node:assert/strict';
import test from 'node:test';
import { nextFinalityCheckAt, planSnapshotJob } from '../src/record-date.js';

test('snapshot jobs are delayed only when the record date is still ahead', () => {
  const now = Date.parse('2026-08-24T10:00:00.000Z');
  const future = planSnapshotJob('2026-08-24T11:00:00.000Z', { now });
  assert.deepEqual(future, {
    availableAt: '2026-08-24T11:00:00.000Z',
    scheduled: true,
    message: 'Snapshot scheduled for 2026-08-24T11:00:00.000Z',
  });

  assert.deepEqual(planSnapshotJob('2026-08-24T09:00:00.000Z', { now }), {
    availableAt: null,
    scheduled: false,
    message: 'Snapshot queued',
  });
});

test('finality checks defer safely without consuming normal retry attempts', () => {
  const now = Date.parse('2026-08-24T11:00:00.000Z');
  const recordDate = '2026-08-24T11:00:00.000Z';
  const recordSeconds = Math.floor(Date.parse(recordDate) / 1000);

  assert.equal(nextFinalityCheckAt(recordDate, recordSeconds, now), null);
  assert.equal(
    nextFinalityCheckAt(recordDate, recordSeconds - 10, now),
    '2026-08-24T11:00:15.000Z',
  );
  assert.equal(
    nextFinalityCheckAt('2026-08-24T12:00:00.000Z', recordSeconds, now),
    '2026-08-24T12:00:00.000Z',
  );
});
