import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Vote with Board is available only when every proposal has a valid recommendation', async () => {
  const page = await read('apps/web/src/pages/VotingDashboard.jsx');

  assert.match(page, /function boardRecommendedChoices\(proposals\)/u);
  assert.match(page, /if \(!Array\.isArray\(proposals\) \|\| proposals\.length === 0\) return null;/u);
  assert.match(page, /Number\.isInteger\(recommendation\)/u);
  assert.match(page, /recommendation >= 0/u);
  assert.match(page, /recommendation < proposals\[proposalIndex\]\.options\.length/u);
  assert.match(page, /return allProposalsRecommended \? choices : null;/u);
  assert.match(page, /\{boardChoices && <button[\s\S]*>Vote with Board<\/button>\}/u);

  const helperSource = page.match(
    /function boardRecommendedChoices\(proposals\) \{[\s\S]*?\n\}/u,
  )?.[0];
  assert.ok(helperSource, 'board recommendation helper is missing');
  const helper = Function(`${helperSource}\nreturn boardRecommendedChoices;`)();

  assert.deepEqual(helper([
    { recommendation: 0, options: ['For', 'Against'] },
    { recommendation: 1, options: ['For', 'Against', 'Abstain'] },
  ]), [0, 1]);
  assert.equal(helper([
    { recommendation: 0, options: ['For', 'Against'] },
    { recommendation: null, options: ['For', 'Against'] },
  ]), null);
  assert.equal(helper([
    { recommendation: 2, options: ['For', 'Against'] },
  ]), null);
});

test('Vote with Board selects recommendations and scrolls to final submission without submitting', async () => {
  const page = await read('apps/web/src/pages/VotingDashboard.jsx');
  const handler = page.match(/function voteWithBoard\(\) \{([\s\S]*?)\n  \}/u)?.[1] ?? '';

  assert.ok(handler, 'voteWithBoard handler is missing');
  assert.match(handler, /setChoices\(\[\.\.\.boardChoices\]\)/u);
  assert.match(handler, /requestAnimationFrame/u);
  assert.match(handler, /submitRowRef\.current\?\.scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/u);
  assert.doesNotMatch(handler, /\bsubmit\s*\(/u);
  assert.match(page, /<footer ref=\{submitRowRef\} className="ballot-submit-row">/u);
});
