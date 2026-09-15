import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { ISSUER_PRESETS, issuerPreset, TOKEN_PLATFORMS } from '../../../packages/shared/src/issuer-branding.js';
import { tokenCatalogue, resolveTokenSelection } from '../src/token-catalogue.js';
import * as helpers from '../../web/src/issuer/catalogue-form.js';
import * as search from '../../web/src/issuer/issuer-search.js';

const ts = createRequire(import.meta.url)('typescript');
const read = (file) => readFile(new URL(`../../../${file}`, import.meta.url), 'utf8');
const jsx = (type, props) => ({ type, props: props ?? {} });
const nothing = () => null;
const catalogue = tokenCatalogue();
function nodes(tree) {
  if (tree == null || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props.children)];
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(text).join('');
  return typeof tree === 'object' ? text(tree.props.children) : String(tree);
}
async function loadJsx(file, imports) {
  const compiled = ts.transpileModule(await read(file), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } });
  const dependencies = { 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' }, ...imports };
  const exports = {};
  vm.runInNewContext(compiled.outputText, { exports, require: (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  return exports.default;
}

// Execute all three actual JSX components. Only React's render scheduler and
// image effects are simulated; option generation and event callbacks are real.
async function fixture(platform = '', { disabled = false, initial = {} } = {}) {
  let form = { issuerName: '', platform, tokenCatalogueId: '', securityName: '', securityTicker: '',
    tokenAddress: '', cusip: '', title: 'Keep meeting', recordDateAt: 'keep-record', ...initial };
  const logoChanges = [];
  const states = { fields: [], combobox: [] }; let component = 'fields', cursor = 0;
  const react = { useEffect: nothing, useId: () => 'issuer-test', useRef: (value) => ({ current: value }),
    useState: (initialValue) => {
      const state = states[component], index = cursor++;
      if (!(index in state)) state[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
      return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    } };
  const FuzzyCombobox = await loadJsx('apps/web/src/components/FuzzyCombobox.jsx', {
    react, './RequiredMark.jsx': { default: nothing },
  });
  const IssuerAutocomplete = await loadJsx('apps/web/src/issuer/IssuerAutocomplete.jsx', {
    '@pv/shared': { ISSUER_PRESETS }, '../components/FuzzyCombobox.jsx': { default: FuzzyCombobox },
    './issuer-search.js': search,
  });
  const Fields = await loadJsx('apps/web/src/issuer/IssuerBrandingFields.jsx', {
    react, '@pv/shared': { issuerPreset, TOKEN_PLATFORMS },
    '../components/FuzzyCombobox.jsx': { default: FuzzyCombobox },
    './IssuerAutocomplete.jsx': { default: IssuerAutocomplete },
    './PlatformAutocomplete.jsx': { default: 'platform-field' },
    './issuer-search.js': search, './catalogue-form.js': helpers,
  });
  function render() {
    component = 'fields'; cursor = 0;
    const fields = Fields({ form, setForm: (update) => { form = update(form); }, catalogue,
      file: null, setFile: (value) => logoChanges.push(value), disabled });
    const issuer = nodes(fields).find((node) => node.type === IssuerAutocomplete);
    assert.ok(issuer, 'Issuer selection must be wired into the real form.');
    const combo = IssuerAutocomplete(issuer.props);
    assert.equal(combo.type, FuzzyCombobox);
    component = 'combobox'; cursor = 0;
    const tree = FuzzyCombobox(combo.props);
    return { fields, input: nodes(tree).find((node) => node.type === 'input'),
      options: nodes(tree).filter((node) => node.props.role === 'option') };
  }
  function open() { render().input.props.onFocus(); return render(); }
  function choose(ticker) {
    const option = open().options.find((row) => nodes(row).some((node) => node.type === 'small' && text(node) === ticker));
    assert.ok(option, `Missing selectable ${ticker} row`); option.props.onClick();
  }
  return { render, open, choose, current: () => form, logoChanges };
}

const names = { GOOGL: 'Alphabet Inc. - Class A Common Stock', GOOG: 'Alphabet Inc. - Class C Capital Stock' };
function assertSelection(form, ticker, platformKey) {
  const entry = catalogue.entries.find((row) => row.id === `${ticker.toLowerCase()}-${platformKey}`);
  assert.equal(form.issuerName, 'Alphabet Inc.');
  assert.equal(form.securityName, names[ticker]);
  assert.equal(form.securityTicker, ticker);
  assert.equal(form.tokenCatalogueId, entry.id);
  assert.equal(form.cusip, entry.cusip);
  assert.equal(form.tokenAddress, entry.tokenAddress);
  assert.equal(form.platform, entry.platform);
  assert.equal(form.title, 'Keep meeting');
  assert.equal(form.recordDateAt, 'keep-record');
  if (entry.configured) assert.equal(resolveTokenSelection(form).id, entry.id);
  else assert.throws(() => resolveTokenSelection(form), { code: 'TOKEN_MAPPING_NOT_CONFIGURED' });
}

test('issuer suggestions expose separate Alphabet class rows and search each ticker independently', () => {
  const issuers = helpers.catalogueIssuers(catalogue); const before = JSON.stringify(issuers);
  const options = search.searchIssuerSecurities(issuers, '');
  assert.equal(options.length, 11);
  const alphabet = options.filter((row) => row.issuerId === 'alphabet');
  assert.deepEqual(alphabet.map((row) => row.label), Object.values(names));
  assert.deepEqual(alphabet.map((row) => row.detail), ['GOOGL', 'GOOG']);
  assert.equal(new Set(alphabet.map((row) => row.id)).size, 2);
  assert.equal(options.find((row) => row.issuerId === 'apple').label, 'Apple Inc.');
  for (const ticker of ['GOOG', 'GOOGL']) {
    assert.equal(search.searchIssuerSecurities(issuers, ticker)[0].securityTicker, ticker);
  }
  assert.equal(search.searchIssuerSecurities(issuers, 'class c')[0].securityTicker, 'GOOG');
  assert.equal(search.searchIssuerSecurities(issuers, 'Alphabet').filter((row) => row.issuerId === 'alphabet').length, 2);
  assert.equal(JSON.stringify(issuers), before);
});

for (const [platform, key] of [['', 'issuer'], ['Dinari', 'dinari']]) {
  for (const ticker of ['GOOGL', 'GOOG']) {
    test(`clicking ${ticker} selects its own ${key} address and CUSIP through the actual dropdown`, async () => {
      const f = await fixture(platform);
      const rows = f.open().options;
      assert.ok(rows.some((row) => text(row).includes(names.GOOGL)));
      assert.ok(rows.some((row) => text(row).includes(names.GOOG)));
      f.choose(ticker); assertSelection(f.current(), ticker, key);
      assert.equal(f.render().options.length, 0, 'Selection closes the dropdown.');
    });
  }
}

for (const ticker of ['GOOGL', 'GOOG']) {
  test(`keyboard selection retains ${ticker} rather than falling back to the issuer's first security`, async () => {
    const f = await fixture('Dinari');
    const index = f.open().options.findIndex((row) => text(row).includes(names[ticker]));
    assert.ok(index >= 0);
    let prevented = 0;
    for (let i = 0; i <= index; i += 1) f.render().input.props.onKeyDown({ key: 'ArrowDown', preventDefault: () => { prevented += 1; } });
    f.render().input.props.onKeyDown({ key: 'Enter', preventDefault: () => { prevented += 1; } });
    assert.equal(prevented, index + 2);
    assertSelection(f.current(), ticker, 'dinari');
  });
}

test('class switching preserves the issuer logo and changing platform preserves the selected class', async () => {
  const f = await fixture('Dinari'); f.choose('GOOG');
  const logoChanges = f.logoChanges.length;
  f.choose('GOOGL'); assertSelection(f.current(), 'GOOGL', 'dinari');
  f.choose('GOOG'); assertSelection(f.current(), 'GOOG', 'dinari');
  assert.equal(f.logoChanges.length, logoChanges, 'Both securities belong to the same issuer.');
  for (const [platform, key] of [['Coinbase', 'coinbase'], ['', 'issuer'], ['Dinari', 'dinari']]) {
    nodes(f.render().fields).find((node) => node.type === 'platform-field').props.onChange(platform);
    assertSelection(f.current(), 'GOOG', key);
  }
});

test('disabled forms cannot expose selectable dropdown rows', async () => {
  const f = await fixture('Dinari', { disabled: true });
  assert.equal(f.open().input.props.disabled, true);
  assert.equal(f.render().options.length, 0);
});

test('a selection without a platform mapping keeps custom token fields and the chosen security', async () => {
  const f = await fixture('Unlisted', { initial: { tokenAddress: `0x${'b'.repeat(40)}`, cusip: 'CUSTOM001' } });
  f.choose('GOOG');
  assert.equal(f.current().issuerName, 'Alphabet Inc.');
  assert.equal(f.current().securityName, names.GOOG);
  assert.equal(f.current().securityTicker, 'GOOG');
  assert.equal(f.current().tokenCatalogueId, '');
  assert.equal(f.current().tokenAddress, `0x${'b'.repeat(40)}`);
  assert.equal(f.current().cusip, 'CUSTOM001');
});
