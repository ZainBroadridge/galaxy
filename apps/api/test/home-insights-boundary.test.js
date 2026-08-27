import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const readText = (path) => readFile(new URL(path, root), 'utf8');
const readBytes = (path) => readFile(new URL(path, root));

const destinations = [
  'https://www.broadridge.com/insights/a-new-way-to-participate-in-vanguard-investor-choice',
  'https://event.webcasts.com/starthere.jsp?ei=1755201&tp_key=e3616cd4d2',
  'https://event.on24.com/wcc/r/5268290/08EEB0E7E050D386C27410A7E28840A6',
  'https://www.broadridge.com/insights/data-accuracy-the-cornerstone-of-investment-stewardship',
];

const images = [
  'apps/web/public/insights/vanguard-investor.jpg',
  'apps/web/public/insights/data-quality-webinar.jpg',
  'apps/web/public/insights/next-gen-stewardship.jpg',
  'apps/web/public/insights/data-accuracy.jpg',
];

test('home adds four functional Broadridge insight cards without changing dashboard metrics', async () => {
  const home = await readText('apps/web/src/pages/HomePage.jsx');

  assert.match(home, /const insights = \[/u);
  assert.match(home, /Insights &amp; perspectives/u);
  assert.match(home, /className="home-insights-grid"/u);
  assert.equal((home.match(/type: '(?:Article|Webinar)'/gu) ?? []).length, 4);
  for (const destination of destinations) assert.ok(home.includes(destination), destination);

  assert.match(home, /loading="lazy"/u);
  assert.match(home, /target: '_blank', rel: 'noopener noreferrer'/u);
  assert.match(home, /title="Ongoing voting events"/u);
  assert.match(home, /title="Voting events organized by you"/u);
  assert.match(home, /to="\/voting"/u);
  assert.match(home, /to="\/organiser"/u);
});

test('insight cards use a shorter responsive layout and Broadridge-style hover motion', async () => {
  const styles = await readText('apps/web/src/styles.css');

  assert.match(styles, /\.home-insight-card \{[\s\S]*?min-height: 520px;/u);
  assert.doesNotMatch(styles, /\.home-insight-card \{[\s\S]*?min-height: 606px;/u);
  assert.match(styles, /\.home-insight-card:hover \{[\s\S]*?transform: translateY\(-6px\)/u);
  assert.match(styles, /\.home-insight-card:hover \.home-insight-image \{ transform: scale\(1\.055\); \}/u);
  assert.match(styles, /\.home-insight-card:hover \.home-insight-arrow \{ transform: translateX\(8px\); \}/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.home-insight-card/u);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.home-insights-grid \{ grid-template-columns: 1fr;/u);
});

test('all four locally served insight images are valid JPEG files', async () => {
  for (const image of images) {
    const bytes = await readBytes(image);
    assert.ok(bytes.length > 10_000, `${image} is unexpectedly small`);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  }
});
