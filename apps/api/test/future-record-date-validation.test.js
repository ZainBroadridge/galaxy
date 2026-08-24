import assert from 'node:assert/strict';
import test from 'node:test';
import { eventInput } from '../src/validation.js';

function validEvent(now = Date.now()) {
  return {
    tokenAddress: '0x0000000000000000000000000000000000000001',
    title: 'Future record-date event',
    description: '',
    recordDateAt: new Date(now + 60 * 60_000).toISOString(),
    votingStartAt: new Date(now + 2 * 60 * 60_000).toISOString(),
    votingEndAt: new Date(now + 3 * 60 * 60_000).toISOString(),
    tokenToVoteRatio: 1,
    authenticityClaim: 'COMMUNITY',
    discoveryMode: 'PUBLIC_ELIGIBLE',
    snapDeliveryMode: 'ELIGIBLE',
    proposals: [{
      title: 'Proposal',
      description: '',
      options: ['For', 'Against'],
      recommendation: 0,
    }],
  };
}

test('event validation accepts a future record date', () => {
  assert.equal(eventInput.safeParse(validEvent()).success, true);
});

test('event validation still requires record date at or before voting start', () => {
  const input = validEvent();
  input.recordDateAt = new Date(Date.parse(input.votingStartAt) + 1_000).toISOString();

  const result = eventInput.safeParse(input);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some((issue) => (
    issue.path[0] === 'recordDateAt'
    && issue.message === 'Record date must be at or before voting start.'
  )));
});
