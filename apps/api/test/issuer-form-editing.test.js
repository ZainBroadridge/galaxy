import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as helpers from '../../web/src/issuer/catalogue-form.js';

const source = readFileSync(new URL('../../web/src/issuer/IssuerBrandingFields.jsx', import.meta.url), 'utf8');
const entry = { id: 'example-issuer', issuerId: 'example', issuerName: 'Example Holdings',
  aliases: ['Example'], platform: '', tokenAddress: `0x${'a'.repeat(40)}`,
  cusip: 'EXAMPLE01', securityName: 'Example Common Stock', securityTicker: 'EXM', configured: true };
const other = { ...entry, id: 'second-dinari', issuerId: 'second', issuerName: 'Second Holdings',
  aliases: ['Second'], platform: 'Dinari', tokenAddress: `0x${'b'.repeat(40)}`, cusip: 'SECOND001' };
const catalogue = { entries: [entry, other], platforms: ['Coinbase', 'Dinari'] };
const draft = () => helpers.applyCatalogueEntry({ title: 'Keep this meeting',
  recordDateAt: 'record-date', documents: ['proxy.pdf'] }, entry);

function fixture(initial = draft(), mappings = catalogue) {
  let form = initial;
  const logoChanges = [];
  const context = vm.createContext({ ...helpers, catalogue: mappings, entries: mappings?.entries ?? [],
    form, setForm: (update) => { form = update(form); context.form = form; },
    setFile: (value) => logoChanges.push(value),
  });
  // Execute the component's real event callbacks; React rendering and image
  // effects are outside these state-transition tests.
  const start = source.indexOf('  function selectEntry(');
  const end = source.indexOf('  function chooseLogo(');
  assert.ok(start >= 0 && end > start, 'Issuer field callbacks must be present.');
  const actions = vm.runInContext(source.slice(start, end)
    + '\n({ selectEntry, changeIssuer, changePlatform, changeCusip });', context);
  return { ...actions, current: () => form, context, logoChanges };
}

test('editing the CUSIP preserves the token and meeting while clearing only the catalogue binding', () => {
  const original = draft(); const f = fixture(original);
  f.changeCusip(' custom01 ');
  assert.equal(f.current().cusip, 'CUSTOM01');
  assert.equal(f.current().tokenCatalogueId, '');
  for (const key of ['tokenAddress', 'issuerName', 'platform', 'securityName', 'securityTicker',
    'title', 'recordDateAt', 'documents']) assert.equal(f.current()[key], original[key], key);
  assert.equal(original.cusip, entry.cusip); assert.equal(entry.cusip, 'EXAMPLE01');
});

test('selecting an exact CUSIP restores the complete mapping and clears a different issuer logo', () => {
  const f = fixture();
  f.changeCusip(' second001 ');
  for (const key of ['issuerName', 'platform', 'tokenAddress', 'cusip', 'securityName', 'securityTicker']) {
    assert.equal(f.current()[key], other[key], key);
  }
  assert.equal(f.current().tokenCatalogueId, other.id);
  assert.equal(f.current().title, 'Keep this meeting');
  assert.deepEqual(f.logoChanges, [null]);
});

test('manual issuer and platform edits preserve custom details when no catalogue is available', () => {
  const initial = { ...draft(), tokenCatalogueId: '', cusip: 'CUSTOM01' };
  const f = fixture(initial, null);
  f.changeIssuer('Independent Holdings');
  f.changePlatform('Dinari');
  assert.equal(f.current().issuerName, 'Independent Holdings');
  assert.equal(f.current().platform, 'Dinari');
  for (const key of ['tokenAddress', 'cusip', 'securityName', 'securityTicker', 'title', 'documents']) {
    assert.equal(f.current()[key], initial[key], key);
  }
  assert.equal(f.current().tokenCatalogueId, '');
});

test('changing a bound issuer or platform clears stale token details, while matching selections prefill', () => {
  const issuer = fixture(); issuer.changeIssuer('Independent Holdings');
  assert.equal(issuer.current().tokenCatalogueId, ''); assert.equal(issuer.current().tokenAddress, '');
  const platform = fixture(); platform.changePlatform('Dinari');
  assert.equal(platform.current().tokenCatalogueId, ''); assert.equal(platform.current().tokenAddress, '');
  platform.changeIssuer('Second Holdings');
  assert.equal(platform.current().tokenCatalogueId, other.id);
  assert.equal(platform.current().tokenAddress, other.tokenAddress);
});

test('security name and ticker controls execute edits without dropping the address or meeting fields', () => {
  for (const [field, value, limit] of [['securityName', 'Class B Common Stock', 240], ['securityTicker', 'EXM.B', 24]]) {
    const input = source.match(new RegExp(`<input value=\\{form\\.${field}[^]*?\\/>`, 'u'))?.[0];
    assert.ok(input, `Missing ${field} field`);
    assert.doesNotMatch(input, /readOnly/u);
    assert.match(input, new RegExp(`maxLength=\\{${limit}\\}`, 'u'));
    const callback = input.match(/onChange=\{([^]*?)\}\s*placeholder=/u)?.[1];
    assert.ok(callback, `${field} must have an edit callback`);
    const f = fixture();
    vm.runInContext(`(${callback})`, f.context)({ target: { value } });
    assert.equal(f.current()[field], value);
    assert.equal(f.current().tokenCatalogueId, '');
    assert.equal(f.current().tokenAddress, entry.tokenAddress);
    assert.equal(f.current().title, 'Keep this meeting');
  }
});

test('issuer identity fields remain editable without catalogue data and honor the busy state', () => {
  for (const tag of ['IssuerAutocomplete', 'PlatformAutocomplete', 'FuzzyCombobox']) {
    const control = source.match(new RegExp(`<${tag}\\b[^]*?\\/>`, 'u'))?.[0];
    assert.ok(control, tag);
    const disabledExpression = control.match(/disabled=\{([^}]+)\}/u)?.[1];
    assert.ok(disabledExpression, `${tag} disabled guard`);
    for (const disabled of [false, true]) {
      const actual = vm.runInNewContext(disabledExpression, { disabled, entries: [], catalogue: null,
        locked: disabled || ![].length });
      assert.equal(actual, disabled, `${tag} with no catalogue and busy=${disabled}`);
    }
  }
});
