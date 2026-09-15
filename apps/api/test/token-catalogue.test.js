import assert from 'node:assert/strict';
import test from 'node:test';
import { tokenCatalogue, resolveTokenSelection, TOKEN_CATALOGUE, UNCONFIGURED_TOKEN_ADDRESS } from '../src/token-catalogue.js';
import { catalogueIssuers, catalogueEntry, applyCatalogueEntry, clearCatalogueEntry, selectedCatalogueEntry, editTokenIdentity, changeTokenIssuer, changeTokenPlatform } from '../../web/src/issuer/catalogue-form.js';
import { searchCusips, searchIssuers, searchPlatforms } from '../../web/src/issuer/issuer-search.js';
import { meetingPresentation } from '../../web/src/investor/presentation.js';

const inputFor = (entry) => applyCatalogueEntry({ title: 'Preserved title', tokenToVoteRatio: 2 }, entry);

const expectedAddresses = Object.freeze({
  'omega-issuer': '0xb16c938e43ba799b42f1ed1bee470534547816cb',
  'sid-issuer': '0x73f48c4876a1ded6e00908a3e6b26280f1ecd08d',
  'amanx-issuer': '0x89f5f622e7027a5dfedd78768519874b52668df4',
  'teslatx-issuer': '0x1d5e45aa3fb87594119f6f361800210bf33be76c',
  'aapl-issuer': '0x682e82d5a3f0bbb81b7c086081bd757cd5b2c4b4',
  'aapl-dinari': '0xa9ae8f7a5c88f0983bf9e9e2b05ec3db3249fb6b',
  'tsla-issuer': '0xf3ba8da491a237cebef4fc0f95baa1483f2ae0dc',
  'tsla-dinari': '0x19f7d33190d5cb282ee46a1457876f1b767e42ca',
  'nvda-issuer': '0xe35b668b6924e695fc3f746c76c6a4c7eed4b59f',
  'nvda-dinari': '0x2639bbaef71c0e7445cf5cff00e9892fb8cfecf6',
  'spacex-issuer': '0x59f35f28e1e1bae8e90ffdb48ddae46a9c43ace0',
  'googl-issuer': '0xfabf983149841b439c68dce214b8c0b42f1bf56e',
  'googl-dinari': '0xc46aa1ca186794d775fe542fd9d73fe33a1c79c0',
  'goog-issuer': '0xbf3e3d3f135d8d73ba6b196e16e381bfa25f0a71',
  'goog-dinari': '0x9701018de2bf16d335883a434008a6287e2b4c40',
  'orcl-issuer': '0x2f852e0b0509ebe08c68bb0761f0786050840740',
  'orcl-dinari': '0x8acd62c0940ac2253157420d8183ce7667bc34ef',
});

test('catalogue has 11 securities across 10 issuers and 33 independently identified platform mappings', () => {
  const catalogue = tokenCatalogue();
  assert.equal(catalogue.chainId, 80002);
  assert.deepEqual(catalogue.platforms, ['Coinbase', 'Dinari']);
  assert.deepEqual(Object.keys(TOKEN_CATALOGUE), ['AAPL', 'TSLA', 'NVDA', 'GOOGL', 'ORCL', 'SPACEX', 'GOOG', 'OMEGA', 'SID', 'AMANX', 'TESLATX']);
  assert.equal(catalogue.entries.length, 33);
  assert.equal(new Set(catalogue.entries.map((entry) => entry.id)).size, 33);
  assert.equal(new Set(catalogue.entries.map((entry) => entry.cusip)).size, 33);
  assert.equal(catalogueIssuers(catalogue).length, 10);
  for (const symbol of Object.keys(TOKEN_CATALOGUE)) {
    const rows = catalogue.entries.filter((entry) => entry.symbol === symbol);
    assert.deepEqual(rows.map((entry) => entry.platform), ['', 'Dinari', 'Coinbase']);
    for (const row of rows) {
      assert.match(row.cusip, /^DEMO\d{5}$/u);
      assert.equal(row.demoIdentifier, true);
      assert.match(row.tokenAddress, /^0x[0-9a-f]{40}$/u);
      assert.equal(row.sponsorship, row.platform ? 'CUSTODIAL' : 'ISSUER_SPONSORED');
    }
  }
  // Existing identifiers must remain stable when token addresses change.
  for (const [index, symbol] of ['aapl', 'tsla', 'nvda', 'googl', 'orcl', 'spacex'].entries()) {
    for (const [platformIndex, platform] of ['issuer', 'dinari', 'coinbase'].entries()) {
      assert.equal(catalogue.entries.find((entry) => entry.id === `${symbol}-${platform}`).cusip,
        `DEMO0${index + 1}00${platformIndex + 1}`);
    }
  }
});

test('all 17 supplied addresses are assigned to the correct mappings and Coinbase remains unconfigured', () => {
  const catalogue = tokenCatalogue();
  for (const entry of catalogue.entries) {
    assert.equal(entry.tokenAddress, expectedAddresses[entry.id] ?? UNCONFIGURED_TOKEN_ADDRESS, entry.id);
    assert.equal(entry.configured, Object.hasOwn(expectedAddresses, entry.id), entry.id);
  }
  assert.equal(catalogue.entries.filter((entry) => entry.configured).length, 17);
  assert.equal(new Set(catalogue.entries.filter((entry) => entry.configured).map((entry) => entry.tokenAddress)).size, 17);
  const coinbase = catalogue.entries.filter((entry) => entry.platformKey === 'COINBASE');
  assert.equal(coinbase.length, 11);
  assert.ok(coinbase.every((entry) => !entry.configured && entry.tokenAddress === UNCONFIGURED_TOKEN_ADDRESS));
});

test('selection validates every identity field and rejects crossing issuer and Dinari mappings', () => {
  for (const entry of tokenCatalogue().entries.filter((item) => item.configured)) {
    const input = inputFor(entry);
    assert.equal(resolveTokenSelection(input).id, entry.id);
    for (const field of ['issuerName', 'securityName', 'securityTicker', 'platform', 'tokenAddress', 'cusip']) {
      assert.throws(() => resolveTokenSelection({ ...input, [field]: 'tampered' }), { code: 'TOKEN_MAPPING_MISMATCH', status: 409 }, field);
    }
  }
  const apple = tokenCatalogue().entries.filter((entry) => entry.symbol === 'AAPL');
  assert.equal(new Set(apple.map((entry) => entry.tokenAddress)).size, 3);
  assert.equal(new Set(apple.map((entry) => entry.id)).size, 3);
  assert.throws(() => resolveTokenSelection({ ...inputFor(apple[0]), tokenCatalogueId: apple[1].id }), { code: 'TOKEN_MAPPING_MISMATCH' });
});

test('unknown entries, full-F placeholders and non-Amoy requests fail closed', () => {
  const entries = tokenCatalogue().entries;
  assert.throws(() => resolveTokenSelection({}), { code: 'TOKEN_SELECTION_REQUIRED' });
  assert.throws(() => resolveTokenSelection({ tokenCatalogueId: 'unlisted' }), { code: 'TOKEN_SELECTION_REQUIRED' });
  for (const entry of entries.filter((item) => !item.configured)) {
    assert.throws(() => resolveTokenSelection(inputFor(entry)), { code: 'TOKEN_MAPPING_NOT_CONFIGURED' });
  }
  assert.equal(tokenCatalogue(1).entries.every((entry) => !entry.configured), true);
  assert.throws(() => resolveTokenSelection(inputFor(entries[0]), 1), { code: 'TOKEN_MAPPING_NOT_CONFIGURED' });
});

test('responses are copies and immutable server configuration cannot be changed by a client', () => {
  const first = tokenCatalogue();
  first.entries[0].tokenAddress = 'tampered'; first.entries[0].aliases.push('injected'); first.platforms.push('Unknown');
  const second = tokenCatalogue();
  assert.equal(second.entries[0].tokenAddress, TOKEN_CATALOGUE.AAPL.listings.ISSUER.tokenAddress);
  assert.ok(!second.entries[0].aliases.includes('injected'));
  assert.deepEqual(second.platforms, ['Coinbase', 'Dinari']);
  assert.ok(Object.isFrozen(TOKEN_CATALOGUE.AAPL.listings.DINARI));
});

test('issuer, security and platform selection resolves every row and preserves event inputs', () => {
  const catalogue = tokenCatalogue();
  for (const entry of catalogue.entries) {
    const row = catalogueEntry(catalogue, entry.issuerName, entry.platform, entry.securityTicker);
    assert.equal(row.id, entry.id);
    const before = { title: 'AGM', proposals: [{ title: 'Elect directors' }], issuerLogoId: 'custom-logo', recordDateAt: 'record' };
    const applied = applyCatalogueEntry(before, row);
    assert.equal(applied.tokenAddress, entry.tokenAddress); assert.equal(applied.cusip, entry.cusip);
    assert.equal(applied.platform, entry.platform); assert.equal(applied.title, before.title);
    assert.equal(applied.proposals, before.proposals); assert.equal(applied.issuerLogoId, 'custom-logo');
    assert.equal(selectedCatalogueEntry(catalogue, applied), row);
    assert.equal(before.tokenAddress, undefined);
  }
  assert.equal(catalogueEntry(catalogue, ' AAPL ', 'Dinari').id, 'aapl-dinari');
  assert.equal(catalogueEntry(catalogue, 'Google', '').id, 'googl-issuer');
  assert.equal(catalogueEntry(catalogue, 'Apple', 'Ondo'), null);
});

test('partial edits clear stale addresses and identifiers, preventing accidental deployment of the previous choice', () => {
  const catalogue = tokenCatalogue(); const form = inputFor(catalogue.entries[0]);
  const partial = clearCatalogueEntry(form, { issuerName: 'Tes' });
  assert.equal(partial.tokenAddress, ''); assert.equal(partial.cusip, ''); assert.equal(partial.tokenCatalogueId, '');
  assert.equal(selectedCatalogueEntry(catalogue, partial), null); assert.equal(partial.title, form.title);
  assert.equal(selectedCatalogueEntry(catalogue, { ...form, cusip: 'DEMO99999' }), null);
  const revised = structuredClone(catalogue); revised.entries[0].tokenAddress = `0x${'1'.repeat(40)}`;
  assert.equal(selectedCatalogueEntry(revised, form), null, 'a newly loaded catalogue cannot silently reuse an old address');
});

test('CUSIP dropdown is reversible and uses the same fuzzy ranking as issuer and platform controls', () => {
  const catalogue = tokenCatalogue();
  for (const entry of catalogue.entries) {
    const options = searchCusips(catalogue.entries, entry.cusip);
    assert.equal(options[0].id, entry.id);
    const form = inputFor(options[0]);
    assert.equal(form.issuerName, entry.issuerName); assert.equal(form.platform, entry.platform);
    assert.equal(form.cusip, entry.cusip); assert.equal(selectedCatalogueEntry(catalogue, form).id, entry.id);
  }
  assert.equal(searchCusips(catalogue.entries, 'tesal')[0].symbol, 'TSLA');
  assert.equal(searchCusips(catalogue.entries, 'DEMO010')[0].symbol, 'AAPL');
  assert.equal(searchIssuers(catalogueIssuers(catalogue), 'nvida')[0].id, 'nvidia');
  assert.equal(searchPlatforms(catalogue.platforms, 'coinbsae')[0], 'Coinbase');
  assert.equal(searchCusips(catalogue.entries, 'no-such-cusip-xyz').length, 0);
});

test('new platform choices do not erase existing event branding', () => {
  assert.deepEqual(tokenCatalogue().platforms, ['Coinbase', 'Dinari']);
  assert.equal(meetingPresentation({ platform: 'Coinbase' }).platformLogo, '/investor/coinbase-logo.svg');
  assert.equal(meetingPresentation({ platform: 'Ondo' }).platformLogo, '/investor/ondo-logo.png');
  assert.equal(meetingPresentation({ platform: 'Kraken' }).platformLogo, '/investor/kraken-logo.png');
  assert.equal(meetingPresentation({ platform: '' }).header, 'issuer');
});


test('manual edits clear the catalogue binding while preserving unrelated draft fields and the original mapping', () => {
  const catalogue = tokenCatalogue(); const selected = catalogue.entries.find((entry) => entry.configured);
  const proposals = [{ title: 'Keep this proposal' }];
  const mapped = applyCatalogueEntry({ title: 'Annual meeting', proposals, recordDateAt: 'record' }, selected);
  const before = JSON.stringify(catalogue);
  for (const [field, value] of Object.entries({ tokenAddress: `0x${'a'.repeat(40)}`, cusip: 'CUSTOM001',
    issuerName: 'Custom issuer', securityName: 'Custom security', securityTicker: 'CUSTOM' })) {
    const edited = editTokenIdentity(mapped, { [field]: value });
    assert.equal(edited.tokenCatalogueId, ''); assert.equal(edited[field], value);
    assert.equal(edited.title, mapped.title); assert.equal(edited.proposals, proposals);
    assert.equal(edited.recordDateAt, mapped.recordDateAt);
    assert.equal(selectedCatalogueEntry(catalogue, edited), null);
    assert.equal(mapped.tokenCatalogueId, selected.id);
  }
  assert.equal(JSON.stringify(catalogue), before);
});

test('issuer and platform changes prefill matching mappings and clear stale mapped identities', () => {
  const catalogue = tokenCatalogue();
  const first = applyCatalogueEntry({ title: 'Keep event title' }, catalogue.entries.find((entry) => entry.id === 'aapl-issuer'));
  const dinari = changeTokenPlatform(first, catalogue, 'Dinari');
  assert.equal(selectedCatalogueEntry(catalogue, dinari).id, 'aapl-dinari');
  const tesla = changeTokenIssuer(dinari, catalogue, 'Tesla');
  assert.equal(selectedCatalogueEntry(catalogue, tesla).id, 'tsla-dinari');
  const custom = changeTokenIssuer(tesla, catalogue, 'Independent issuer');
  assert.equal(custom.tokenCatalogueId, ''); assert.equal(custom.tokenAddress, '');
  assert.equal(custom.cusip, ''); assert.equal(custom.title, first.title);
  const manual = editTokenIdentity(custom, { tokenAddress: `0x${'b'.repeat(40)}`, cusip: 'CUSTOM001' });
  const renamed = changeTokenIssuer(manual, catalogue, 'Renamed independent issuer');
  assert.equal(renamed.tokenAddress, manual.tokenAddress); assert.equal(renamed.cusip, manual.cusip);
});


test('Alphabet exposes both share classes once and exact ticker lookups select the correct token', () => {
  const catalogue = tokenCatalogue();
  const before = JSON.stringify(catalogue);
  const alphabet = catalogueIssuers(catalogue).filter((issuer) => issuer.id === 'alphabet');
  assert.equal(alphabet.length, 1);
  assert.deepEqual(alphabet[0].securities.map((security) => security.ticker), ['GOOGL', 'GOOG']);
  assert.ok(alphabet[0].aliases.includes('GOOG'));
  for (const platform of ['', 'Dinari', 'Coinbase']) {
    for (const symbol of ['GOOG', 'GOOGL']) {
      const entry = catalogueEntry(catalogue, symbol, platform);
      assert.equal(entry.symbol, symbol);
      assert.equal(entry.platform, platform);
      assert.equal(searchCusips(catalogue.entries, entry.cusip)[0].id, entry.id);
    }
  }
  assert.equal(catalogueEntry(catalogue, 'SPCX', '').id, 'spacex-issuer');
  assert.equal(searchCusips(catalogue.entries, 'GOOG')[0].symbol, 'GOOG');
  assert.equal(searchIssuers(catalogueIssuers(catalogue), 'GOOG')[0].id, 'alphabet');
  assert.equal(JSON.stringify(catalogue), before, 'Merging issuer options cannot mutate catalogue data.');
});

test('GOOG keeps its share class when platforms change, including a round trip through unconfigured Coinbase', () => {
  const catalogue = tokenCatalogue();
  let form = inputFor(catalogue.entries.find((entry) => entry.id === 'goog-issuer'));
  for (const [platform, id] of [['Dinari', 'goog-dinari'], ['Coinbase', 'goog-coinbase'], ['', 'goog-issuer']]) {
    form = changeTokenPlatform(form, catalogue, platform);
    assert.equal(form.tokenCatalogueId, id);
    assert.equal(form.securityTicker, 'GOOG');
    assert.equal(selectedCatalogueEntry(catalogue, form).id, id);
  }
  form = changeTokenIssuer(form, catalogue, 'Alphabet Inc.');
  assert.equal(form.tokenCatalogueId, 'goog-issuer');
  form = changeTokenIssuer(form, catalogue, 'GOOGL');
  assert.equal(form.tokenCatalogueId, 'googl-issuer');
  form = changeTokenIssuer(form, catalogue, 'Apple');
  assert.equal(form.tokenCatalogueId, 'aapl-issuer');
  assert.equal(catalogueEntry(catalogue, 'Alphabet', 'Dinari', 'UNKNOWN'), null);
});
