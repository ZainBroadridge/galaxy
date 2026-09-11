import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_OPTION_LABEL_LENGTH, MAX_PROPOSAL_TITLE_LENGTH } from '../src/constants.js';
import { proposalTextIssues } from '../src/proposal-text.js';
import { readableBallotSelections } from '../src/ballot-labels.js';

const proposal = (patch = {}) => ({ title: 'Election of Directors', options: ['For', 'Against'], ...patch });

test('accepts the exact published title and option limits', () => {
  assert.equal(MAX_PROPOSAL_TITLE_LENGTH, 80);
  assert.equal(MAX_OPTION_LABEL_LENGTH, 20);
  assert.deepEqual(proposalTextIssues([proposal({ title: 'T'.repeat(80), options: ['W'.repeat(20), 'Against'] })]), []);
});

test('rejects one character over each limit with the exact field path', () => {
  const issues = proposalTextIssues([proposal({ title: 'T'.repeat(81), options: ['For', 'X'.repeat(21)] })]);
  assert.deepEqual(issues.map(({ path }) => path), [['proposals', 0, 'title'], ['proposals', 0, 'options', 1]]);
  assert.match(issues[0].message, /80 characters or fewer \(currently 81\)/u);
  assert.match(issues[1].message, /20 characters or fewer \(currently 21\)/u);
});

test('accepts all the director and frequency choices shown in the screenshot', () => {
  assert.deepEqual(proposalTextIssues([
    proposal({ title: 'P-01 - Election of Directors', options: ['For all', 'Withhold all', 'Except Nominee C'] }),
    proposal({ title: 'P-04 - Frequency of Compensation Votes', options: ['Every year', 'Every 2 years', 'Every 3 years', 'Abstain'] }),
  ]), []);
});

test('rejects programmatically supplied line breaks and tabs in either field', () => {
  for (const separator of ['\n', '\r', '\t', '\u2028', '\u2029']) {
    const issues = proposalTextIssues([proposal({ title: `First${separator}second`, options: [`For${separator}all`, 'Against'] })]);
    assert.equal(issues.length, 2);
    assert.ok(issues.every(({ message }) => message.endsWith('must be on one line.')));
  }
});

test('matches the trimmed text submitted by the API without changing the input', () => {
  const input = [proposal({ title: `  ${'T'.repeat(80)}  `, options: [` ${'O'.repeat(20)} `, 'Against'] })];
  const before = JSON.stringify(input);
  assert.deepEqual(proposalTextIssues(input), []);
  assert.equal(JSON.stringify(input), before);
});

test('rejects whitespace-only titles and choices with useful messages', () => {
  const issues = proposalTextIssues([proposal({ title: '  ', options: ['For', '  '] })]);
  assert.equal(issues.length, 2);
  assert.ok(issues.every(({ message }) => message.endsWith('is required.')));
});

test('validates every proposal and leaves supporting descriptions unrestricted by label limits', () => {
  const input = [proposal({ description: 'D'.repeat(5000) }), proposal({ options: ['For', 'X'.repeat(21)] })];
  assert.deepEqual(proposalTextIssues(input).map(({ path }) => path), [['proposals', 1, 'options', 1]]);
});

test('existing long ballot wording still reaches the signing payload intact', () => {
  const title = 'Existing proposal '.repeat(10).trim();
  const selected = 'Existing option wording '.repeat(3).trim();
  const old = [{ title, description: 'Original supporting text', options: [{ text: selected }, { text: 'Against' }] }];
  const result = readableBallotSelections(old, [0]);
  assert.equal(result[0].selectedOption, selected);
  assert.equal(result[0].proposal, `${title}\n\nOriginal supporting text`);
});
