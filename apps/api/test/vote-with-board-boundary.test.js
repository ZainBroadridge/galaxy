import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { boardRecommendedChoices } from '../../web/src/investor/meeting-utils.js';
const page = await readFile(new URL('../../web/src/investor/BallotPage.jsx', import.meta.url), 'utf8');
test('Vote with Board is available only when every proposal has a valid recommendation', () => {
  assert.deepEqual(boardRecommendedChoices([
    { recommendation: 0, options: ['For', 'Against'] },
    { recommendation: 1, options: ['For', 'Against', 'Abstain'] },
  ]), [0, 1]);
  assert.equal(boardRecommendedChoices([{ recommendation: null, options: ['For', 'Against'] }]), null);
  assert.equal(boardRecommendedChoices([{ recommendation: 2, options: ['For', 'Against'] }]), null);
  assert.match(page, /boardChoices && canVote && <button/u);
});
test('Vote with Board selects and scrolls, while respecting reduced motion and never submitting', () => {
  const handler = page.match(/function voteWithBoard\(\) \{([\s\S]*?)\n  \}/u)?.[1] ?? '';
  assert.match(handler, /setChoices\(\[\.\.\.boardChoices\]\)/u);
  assert.match(handler, /scrollIntoView/u);
  assert.match(handler, /prefers-reduced-motion/u);
  assert.doesNotMatch(handler, /signBallot|api\(|submit\(/u);
  assert.match(page, /ref=\{submitRowRef\} tabIndex=\{-1\}/u);
  assert.match(page, />Reset All<\/button>/u);
});
