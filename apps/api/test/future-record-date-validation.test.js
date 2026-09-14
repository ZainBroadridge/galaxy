import assert from 'node:assert/strict';
import test from 'node:test';
import { eventInput } from '../src/validation.js';
import { MAX_OPTION_LABEL_LENGTH, MAX_PROPOSAL_TITLE_LENGTH } from '../../../packages/shared/src/constants.js';

function validEvent(now = Date.now()) {
  return {
    tokenAddress: `0x${'1'.repeat(40)}`,
    tokenCatalogueId: null, cusip: 'DEMO01001', issuerName: 'Example issuer',
    title: 'Future record-date event', description: '',
    recordDateAt: new Date(now + 60 * 60_000).toISOString(),
    votingStartAt: new Date(now + 2 * 60 * 60_000).toISOString(),
    votingEndAt: new Date(now + 3 * 60 * 60_000).toISOString(),
    tokenToVoteRatio: 1, authenticityClaim: 'COMMUNITY',
    discoveryMode: 'PUBLIC_ELIGIBLE', snapDeliveryMode: 'ELIGIBLE',
    proposals: [{ title: 'Proposal', description: '', options: ['For', 'Against'], recommendation: 0 }],
  };
}
const expectValid = (input) => {
  const result = eventInput.safeParse(input);
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  return result.data;
};
const expectIssue = (input, path) => {
  const result = eventInput.safeParse(input);
  assert.equal(result.success, false, `Expected validation to reject ${path}`);
  assert.ok(result.error.issues.some((issue) => issue.path.join('.') === path), JSON.stringify(result.error.issues));
};

test('a complete event accepts a future record date, including record date equal to voting start', () => {
  const input = validEvent(); expectValid(input);
  expectValid({ ...input, recordDateAt: input.votingStartAt });
});

test('record date after voting start is rejected on the record-date field', () => {
  const input = validEvent(); expectValid(input);
  input.recordDateAt = new Date(Date.parse(input.votingStartAt) + 1_000).toISOString();
  expectIssue(input, 'recordDateAt');
});

test('the voting window must end after its start and remain available for ten minutes', () => {
  const input = validEvent();
  expectIssue({ ...input, votingEndAt: input.votingStartAt }, 'votingEndAt');
  expectIssue({ ...input, recordDateAt: new Date(Date.now() - 120_000).toISOString(),
    votingStartAt: new Date(Date.now() - 60_000).toISOString(),
    votingEndAt: new Date(Date.now() + 5 * 60_000).toISOString() }, 'votingEndAt');
});

test('new option labels accept the published boundary and reject one-over or multiline text', () => {
  assert.equal(MAX_OPTION_LABEL_LENGTH, 20);
  const input = validEvent();
  input.proposals[0].options[0] = 'x'.repeat(MAX_OPTION_LABEL_LENGTH);
  expectValid(input);
  for (const label of ['x'.repeat(MAX_OPTION_LABEL_LENGTH + 1), 'For\nAgainst', 'For\tAgainst', 'For\rAgainst', 'For\u2028Against']) {
    expectIssue({ ...input, proposals: [{ ...input.proposals[0], options: [label, 'Against'] }] }, 'proposals.0.options.0');
  }
});

test('new proposal titles accept 80 characters and reject 81', () => {
  assert.equal(MAX_PROPOSAL_TITLE_LENGTH, 80);
  const input = validEvent(); input.proposals[0].title = 'T'.repeat(MAX_PROPOSAL_TITLE_LENGTH);
  expectValid(input); input.proposals[0].title += 'T'; expectIssue(input, 'proposals.0.title');
});

test('custom-event schema allows an omitted or null catalogue ID and requires issuer name and CUSIP', () => {
  const input = validEvent();
  expectValid(input); expectValid({ ...input, tokenCatalogueId: undefined });
  // Catalogue identity matching is checked separately by the token-selection tests.
  expectValid({ ...input, tokenCatalogueId: 'aapl-issuer' });
  for (const issuerName of [undefined, '', '   ']) expectIssue({ ...input, issuerName }, 'issuerName');
  for (const cusip of [undefined, '', 'TOO-LONG-CUSIP']) expectIssue({ ...input, cusip }, 'cusip');
});
