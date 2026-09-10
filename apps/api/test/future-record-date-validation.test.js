import assert from 'node:assert/strict';
import test from 'node:test';
import { eventInput } from '../src/validation.js';

function validEvent(now = Date.now()) {
  return {
    tokenAddress: '0x682e82d5a3f0bbb81b7c086081bd757cd5b2c4b4',
    tokenCatalogueId: 'aapl-issuer',
    cusip: 'DEMO01001',
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


test('new event validation rejects long or multiline options and missing catalogue identifiers', () => {
  const input = validEvent();
  for (const label of ['x'.repeat(25), 'For\nAgainst', 'For\tAgainst']) {
    const bad = { ...input, proposals: [{ ...input.proposals[0], options: [label, 'Against'] }] };
    assert.equal(eventInput.safeParse(bad).success, false);
  }
  assert.equal(eventInput.safeParse({ ...input, proposals: [{ ...input.proposals[0], options: ['x'.repeat(24), 'Against'] }] }).success, true);
  assert.equal(eventInput.safeParse({ ...input, tokenCatalogueId: undefined }).success, false);
  assert.equal(eventInput.safeParse({ ...input, cusip: undefined }).success, false);
});
