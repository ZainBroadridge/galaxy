import assert from 'node:assert/strict';
import test from 'node:test';
import { tokenCatalogue, resolveTokenSelection, TOKEN_CATALOGUE, UNCONFIGURED_TOKEN_ADDRESS } from '../src/token-catalogue.js';
import { catalogueIssuers, catalogueEntry, applyCatalogueEntry, clearCatalogueEntry, selectedCatalogueEntry } from '../../web/src/issuer/catalogue-form.js';
import { searchCusips, searchIssuers, searchPlatforms } from '../../web/src/issuer/issuer-search.js';
import { meetingPresentation } from '../../web/src/investor/presentation.js';

const inputFor = (entry) => applyCatalogueEntry({ title: 'Preserved title', tokenToVoteRatio: 2 }, entry);

test('catalogue has exactly six issuers and 18 unique demo identifiers with three independently editable listings each', () => {
  const catalogue = tokenCatalogue();
  assert.equal(catalogue.chainId, 80002);
  assert.deepEqual(catalogue.platforms, ['Coinbase', 'Dinari']);
  assert.equal(catalogue.entries.length, 18);
  assert.equal(new Set(catalogue.entries.map((entry) => entry.id)).size, 18);
  assert.equal(new Set(catalogue.entries.map((entry) => entry.cusip)).size, 18);
  assert.equal(catalogueIssuers(catalogue).length, 6);
  for (const issuer of catalogueIssuers(catalogue)) {
    const rows = catalogue.entries.filter((entry) => entry.issuerId === issuer.id);
    assert.deepEqual(rows.map((entry) => entry.platform), ['', 'Dinari', 'Coinbase']);
    for (const row of rows) {
      assert.match(row.cusip, /^DEMO\d{5}$/u);
      assert.equal(row.demoIdentifier, true);
      assert.match(row.tokenAddress, /^0x[0-9a-f]{40}$/u);
      assert.equal(row.sponsorship, row.platform ? 'CUSTODIAL' : 'ISSUER_SPONSORED');
    }
  }
});

test('all nine configured mappings retain the supplied token addresses; other entries are non-deployable placeholders', () => {
  const catalogue = tokenCatalogue();
  const expected = {
    AAPL: '0x682e82d5a3f0bbb81b7c086081bd757cd5b2c4b4',
    TSLA: '0xf3ba8da491a237cebef4fc0f95baa1483f2ae0dc',
    NVDA: '0xe35b668b6924e695fc3f746c76c6a4c7eed4b59f',
  };
  for (const entry of catalogue.entries) {
    assert.equal(entry.tokenAddress, expected[entry.symbol] ?? UNCONFIGURED_TOKEN_ADDRESS);
    assert.equal(entry.configured, Boolean(expected[entry.symbol]));
  }
  assert.equal(catalogue.entries.filter((entry) => entry.configured).length, 9);
});

test('selection validates every identity field and distinguishes mappings even when addresses temporarily match', () => {
  for (const entry of tokenCatalogue().entries.filter((item) => item.configured)) {
    const input = inputFor(entry);
    assert.equal(resolveTokenSelection(input).id, entry.id);
    for (const field of ['issuerName', 'securityName', 'securityTicker', 'platform', 'tokenAddress', 'cusip']) {
      assert.throws(() => resolveTokenSelection({ ...input, [field]: 'tampered' }), { code: 'TOKEN_MAPPING_MISMATCH', status: 409 }, field);
    }
  }
  const apple = tokenCatalogue().entries.filter((entry) => entry.symbol === 'AAPL');
  assert.equal(new Set(apple.map((entry) => entry.tokenAddress)).size, 1);
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

test('issuer and platform selection resolves all 18 rows and prefills atomically without touching event inputs', () => {
  const catalogue = tokenCatalogue();
  for (const entry of catalogue.entries) {
    const row = catalogueEntry(catalogue, entry.issuerName, entry.platform);
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
