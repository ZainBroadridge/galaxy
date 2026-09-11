import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolveTokenSelection, tokenCatalogue, TokenCatalogueError } from '../src/token-catalogue.js';
import { issuerBranding, eventIssuerBranding } from '../../../packages/shared/src/issuer-branding.js';
import { applyCatalogueEntry } from '../../web/src/issuer/catalogue-form.js';

const source = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gmu, '').replace(/^export /gmu, '');
class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
function fixture({ used = 0, chainId = 80002 } = {}) {
  const queries = []; const inspected = []; const jobs = []; const kicks = []; let inserted;
  const query = async (sql, values) => {
    queries.push({ sql, values });
    if (sql.includes('count(*)')) return { rows: [{ count: used }], rowCount: 1 };
    assert.match(sql, /INSERT INTO events/u);
    const fields = sql.match(/INSERT INTO events\(\s*([\s\S]*?)\) VALUES/u)[1].split(',').map((value) => value.trim());
    assert.equal(fields.length, values.length);
    inserted = { id: 'new-event', chain_id: 80002, ...Object.fromEntries(fields.map((field, i) => [field, values[i]])) };
    return { rows: [inserted], rowCount: 1 };
  };
  const context = vm.createContext({
    HttpError, resolveTokenSelection, TokenCatalogueError, issuerBranding,
    config: { chainId, maxEventsPerWalletPerDay: 5 }, normalizeAddress: (value) => value.toLowerCase(),
    AUTHENTICITY_CLAIM: { ISSUER_AUTHORIZED: 'ISSUER_AUTHORIZED' },
    query, transaction: (fn) => fn({ query }),
    ensureOwnedIssuerLogo: async () => {},
    inspectToken: async (tokenAddress) => { inspected.push(tokenAddress); return { tokenAddress, name: 'Test token', symbol: 'TEST', decimals: 18 }; },
    hashEventMetadata: (input) => ({ metadata: { title: input.title, description: input.description, proposals: input.proposals }, hash: 'immutable-hash' }),
    packProposalConfig: () => 2n, buildEventAnnouncement: () => null,
    planSnapshotJob: (recordDate) => ({ message: 'Snapshot queued', availableAt: recordDate }),
    enqueueJob: async (args) => { jobs.push(args); return { id: 'snapshot-job', ...args }; },
    kickJobRunner: () => kicks.push(true), serializeEvent: (row) => row, serializeJob: (row) => row,
  });
  return { create: vm.runInContext(source('events.js') + '\ncreateEvent;', context), queries, inspected, jobs, kicks, inserted: () => inserted };
}
const form = (id = 'aapl-issuer') => applyCatalogueEntry({
  title: 'Annual meeting', description: 'Demo', proposals: [{ title: 'Election', options: ['For', 'Against'] }],
  recordDateAt: '2026-09-10T00:00:00Z', votingStartAt: '2026-09-11T00:00:00Z', votingEndAt: '2026-09-12T00:00:00Z',
  tokenToVoteRatio: 2, authenticityClaim: 'COMMUNITY', discoveryMode: 'PUBLIC_ELIGIBLE', snapDeliveryMode: 'DISABLED',
}, tokenCatalogue().entries.find((entry) => entry.id === id));
const wallet = `0x${'a'.repeat(40)}`;

test('event creation persists the selected mapping and CUSIP in the existing transaction, then queues one snapshot', async () => {
  for (const id of ['aapl-issuer', 'aapl-dinari', 'aapl-coinbase', 'tsla-dinari', 'nvda-coinbase']) {
    const f = fixture(); const input = form(id); const result = await f.create(wallet, input);
    assert.deepEqual(f.inspected, [input.tokenAddress]);
    assert.equal(f.inserted().token_catalogue_id, id); assert.equal(f.inserted().cusip, input.cusip);
    assert.equal(f.inserted().token_platform, input.platform); assert.equal(f.inserted().issuer_name, input.issuerName);
    assert.equal(f.inserted().security_name, input.securityName); assert.equal(f.inserted().security_ticker, input.securityTicker);
    assert.equal(f.inserted().metadata_hash, 'immutable-hash'); assert.equal(f.inserted().vote_unit, '2000000000000000000');
    assert.equal(f.jobs.length, 1); assert.equal(f.jobs[0].type, 'BUILD_SNAPSHOT'); assert.equal(f.kicks.length, 1);
    assert.equal(result.event.id, 'new-event'); assert.equal(result.announcementDraft, null);
    assert.equal(f.queries.some(({ sql }) => /UPDATE|DELETE|snapshot_entries/u.test(sql)), false);
  }
});

test('placeholder or spoofed combinations cannot reach token inspection, database writes or job creation', async () => {
  for (const input of [form('orcl-issuer'), form('spacex-coinbase'), form('googl-dinari'),
    { ...form(), cusip: 'DEMO99999' }, { ...form(), tokenAddress: `0x${'b'.repeat(40)}` },
    { ...form(), platform: 'Kraken' }, { ...form(), issuerName: 'Tesla, Inc.' }]) {
    const f = fixture();
    await assert.rejects(f.create(wallet, input), (error) => error.status === 409 && /^TOKEN_MAPPING_/u.test(error.code));
    assert.equal(f.inspected.length, 0); assert.equal(f.queries.length, 0); assert.equal(f.jobs.length, 0); assert.equal(f.kicks.length, 0);
  }
});

test('daily creation limit remains enforced before external inspection for a valid selection', async () => {
  const f = fixture({ used: 5 });
  await assert.rejects(f.create(wallet, form()), { status: 429, code: 'EVENT_LIMIT' });
  assert.equal(f.queries.length, 1); assert.equal(f.inspected.length, 0); assert.equal(f.jobs.length, 0);
});

test('legacy and new event reads use stored identifiers rather than current catalogue entries', () => {
  const context = vm.createContext({ eventIssuerBranding, hashEventMetadata: () => ({ hash: 'hash' }),
    eventAnnouncementStatus: () => 'DISABLED', config: { webAppUrl: 'https://example.invalid', explorerUrl: 'https://amoy.polygonscan.com' } });
  const serialize = vm.runInContext(source('serializers.js') + '\nserializeEvent;', context);
  const row = { id: 'legacy', chain_id: 80002, title: 'Existing meeting', token_name: 'Historical token',
    issuer_name: 'Apple Inc.', token_platform: 'Ondo', token_address: `0x${'c'.repeat(40)}`, metadata_hash: 'hash',
    proposals: [], deployment_block: null, status: 'SNAPSHOT_PENDING' };
  const legacy = serialize(row); assert.equal(legacy.cusip, null); assert.equal(legacy.tokenCatalogueId, null);
  assert.equal(legacy.tokenAddress, row.token_address); assert.equal(legacy.platform, 'Ondo');
  const stored = serialize({ ...row, token_catalogue_id: 'aapl-dinari', cusip: 'DEMO99999' });
  assert.equal(stored.cusip, 'DEMO99999'); assert.equal(stored.tokenAddress, row.token_address);
});
