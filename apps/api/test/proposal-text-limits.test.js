import assert from 'node:assert/strict';
import test from 'node:test';
import { eventInput, publicEventInput } from '../src/validation.js';

function draft() {
  const now = Date.now();
  return {
    creatorAddress: '0x' + '1'.repeat(40), tokenAddress: '0x' + '2'.repeat(40),
    tokenCatalogueId: null, cusip: '123456789', issuerName: 'Sample issuer',
    title: 'Annual meeting', description: '',
    recordDateAt: new Date(now - 60_000).toISOString(),
    votingStartAt: new Date(now + 60_000).toISOString(),
    votingEndAt: new Date(now + 3_600_000).toISOString(),
    tokenToVoteRatio: 1, authenticityClaim: 'COMMUNITY',
    discoveryMode: 'PUBLIC_ELIGIBLE', snapDeliveryMode: 'ELIGIBLE',
    proposals: [{ title: 'T'.repeat(80), description: 'D'.repeat(5000), options: ['O'.repeat(20), 'Against'], recommendation: 0 }],
  };
}

for (const [name, schema] of [['eventInput', eventInput], ['publicEventInput', publicEventInput]]) {
  test(`${name}: accepts exact boundaries`, () => {
    const result = schema.safeParse(draft());
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  });
  test(`${name}: rejects oversized API payloads even without browser validation`, () => {
    const input = draft(); input.proposals[0].title += 'T'; input.proposals[0].options[1] = 'O'.repeat(21);
    const result = schema.safeParse(input);
    assert.equal(result.success, false);
    const paths = result.error.issues.map(({ path }) => path.join('.'));
    assert.ok(paths.includes('proposals.0.title'));
    assert.ok(paths.includes('proposals.0.options.1'));
  });
  test(`${name}: rejects multiline options and retains the supporting-text limit`, () => {
    const input = draft(); input.proposals[0].options[0] = 'For\nall'; input.proposals[0].description += 'D';
    const result = schema.safeParse(input);
    assert.equal(result.success, false);
    const paths = result.error.issues.map(({ path }) => path.join('.'));
    assert.ok(paths.includes('proposals.0.options.0'));
    assert.ok(paths.includes('proposals.0.description'));
  });
}
