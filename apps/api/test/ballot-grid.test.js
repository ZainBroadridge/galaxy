import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (file) => readFile(new URL(`../../../${file}`, import.meta.url), 'utf8');

test('one column count is calculated for the whole ballot, not each proposal', async () => {
  const source = await read('apps/web/src/investor/BallotPage.jsx');
  assert.match(source, /const optionColumns = Math.max\(2,/u);
  assert.match(source, /'--ballot-option-columns': optionColumns/u);
  assert.doesNotMatch(source, /data-expanded|data-count=\{proposal.options.length\}|'--option-count'/u);
  assert.match(source, /name=\{`proposal-\$\{proposalIndex\}`\}/u);
  assert.match(source, /checked=\{choices\[proposalIndex\] === optionIndex\}/u);
  assert.match(source, /<span>\{option.text\}<\/span>/u);
  assert.doesNotMatch(source, /option.text.(slice|substring)/u);
});

test('option layout shares tracks across rows and uses an explicit print layout', async () => {
  const css = await read('apps/web/src/investor/investor.css');
  assert.match(css, /grid-template-columns: repeat\(var\(--ballot-option-columns,4\),minmax\(0,1fr\)\)/u);
  assert.doesNotMatch(css, /data-expanded|--option-count/u);
  assert.match(css, /grid-template-columns: 18px minmax\(0,1fr\)/u);
  assert.match(css, /@media print[\s\S]*--ballot-option-columns/u);
  assert.doesNotMatch(css, /text-overflow: ellipsis/u);
});

test('ballot heading and normal ProxyVote artwork use the wallet-bar blue; inverse logo stays white', async () => {
  const css = await read('apps/web/src/investor/investor.css');
  const brand = await read('apps/web/src/components/brand.css');
  assert.match(css, /\.investor-utility \{ background: var\(--pv-blue-band\)/u);
  assert.match(css, /\.investor-ballot-heading \{[^}]*background: var\(--pv-blue-band\)/u);
  assert.match(brand, /--pv-blue-band: linear-gradient\(to right,#0076b0,#0067a0 50%,#00588f\)/u);
  assert.match(brand, /\.proxyvote-artwork \{[^}]*background: var\(--pv-blue-band\)/u);
  assert.match(brand, /\.brand-lockup.inverse \.proxyvote-artwork \{ background: #fff/u);
});

test('empty meetings are centered and the standalone CUSIP explanation is absent', async () => {
  const css = await read('apps/web/src/investor/investor.css');
  const fields = await read('apps/web/src/issuer/IssuerBrandingFields.jsx');
  assert.match(css, /\.investor-empty \{[^}]*text-align: center/u);
  assert.doesNotMatch(fields, /These CUSIPs are fictitious demo identifiers/u);
  assert.match(fields, /label="Demo CUSIP"/u);
});
