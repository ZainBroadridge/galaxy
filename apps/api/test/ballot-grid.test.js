import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = (file) => readFile(new URL(`../../../${file}`, import.meta.url), 'utf8');
const rule = (css, selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `Missing CSS rule: ${selector}`);
  return css.slice(start, css.indexOf('}', start) + 1);
};

test('mixed proposal counts determine one ballot-wide set of option columns', async () => {
  const source = await read('apps/web/src/investor/BallotPage.jsx');
  const expression = source.match(/const optionColumns = ([^;]+);/u)?.[1];
  assert.ok(expression, 'The table must calculate its column count from the whole ballot.');
  for (const counts of [[3, 3, 4, 2], [2, 2], [4, 3], []]) {
    const event = { proposals: counts.map((count) => ({ options: Array(count).fill({ text: 'Choice' }) })) };
    const actual = vm.runInNewContext(expression, { event });
    if (counts.length) assert.equal(actual, Math.max(...counts));
    else assert.ok(Number.isInteger(actual) && actual >= 0);
  }
  assert.equal((source.match(/<table className="investor-proposals-table"/gu) ?? []).length, 1);
  assert.match(source, /'--ballot-option-columns': optionColumns/u);
  assert.match(source, /length: optionColumns - proposal.options.length/u);
  assert.match(source, /name=\{`proposal-\$\{proposalIndex\}`\}/u);
  assert.match(source, /checked=\{choices\[proposalIndex\] === optionIndex\}/u);
  assert.match(source, /<span>\{option.text\}<\/span>/u);
  assert.doesNotMatch(source, /option.text.(?:slice|substring)/u);
});

test('equal table columns keep full labels on one line and scroll together on small screens', async () => {
  const css = await read('apps/web/src/investor/investor.css');
  assert.match(rule(css, '.investor-proposals-table'), /table-layout:\s*fixed/u);
  assert.match(rule(css, '.investor-option-column'), /width:\s*var\(--ballot-option-width\)/u);
  assert.match(rule(css, '.investor-proposals-scroll'), /overflow-x:\s*auto/u);
  const label = rule(css, '.investor-option-label');
  assert.match(label, /white-space:\s*nowrap/u);
  assert.match(label, /width:\s*max-content/u);
  assert.doesNotMatch(label, /ellipsis|overflow:\s*hidden/u);
  const print = css.slice(css.indexOf('@media print'));
  assert.match(rule(print, '.investor-proposals-table'), /min-width:\s*0/u);
  assert.match(rule(print, '.investor-option-label span'), /white-space:\s*normal/u);
  assert.match(rule(print, '.investor-proposal'), /break-inside:\s*avoid/u);
});

test('wallet bar and ballot share a blue band while logos display their supplied PNG variants', async () => {
  const [css, brandCss, brand] = await Promise.all([
    read('apps/web/src/investor/investor.css'), read('apps/web/src/components/brand.css'),
    read('apps/web/src/components/BrandLockup.jsx'),
  ]);
  for (const selector of ['.investor-utility', '.investor-ballot-heading']) {
    assert.match(rule(css, selector), /background:\s*var\(--pv-blue-band\)/u);
  }
  assert.match(brand, /inverse\s*\?\s*'\/proxyvote-brand-white.png'\s*:\s*'\/proxyvote-brand-blue.png'/u);
  assert.match(rule(brandCss, '.proxyvote-artwork'), /object-fit:\s*contain/u);
  assert.doesNotMatch(rule(brandCss, '.proxyvote-artwork'), /mask|filter|background:/u);
});

test('empty meetings are centered and the standalone CUSIP explanation is absent', async () => {
  const css = await read('apps/web/src/investor/investor.css');
  const fields = await read('apps/web/src/issuer/IssuerBrandingFields.jsx');
  assert.match(rule(css, '.investor-empty'), /text-align:\s*center/u);
  assert.doesNotMatch(fields, /These CUSIPs are fictitious demo identifiers/u);
  assert.match(fields, /label="Demo CUSIP"/u);
});
