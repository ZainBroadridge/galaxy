import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createExplorerClient, hasVerifiedSource, verificationResult } from '../src/explorer-verification.js';

// Execute the production orchestration with explicit DB/RPC boundaries. No live
// credentials or explorer traffic are needed to reproduce stale-GUID behavior.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gmu, '').replace(/^export /gmu, '');
const verified = { status: '1', result: [{ SourceCode: 'contract Example {}', ABI: '[]' }] };
const unverified = { status: '1', result: [{ SourceCode: '', ABI: 'Contract source code not verified' }] };
function fixture(responses, patch = {}) {
  const event = { id: 'event-id', contract_address: `0x${'1'.repeat(40)}`, deployment_block: 42,
    verification_status: 'PENDING', verification_guid: 'saved-guid', ...patch };
  const job = { id: 'job-id', event_id: event.id, type: 'VERIFY_CONTRACT', attempts: 8, max_attempts: 8, result: {} };
  const calls = []; const writes = []; const updates = [];
  let artifacts = 0;
  const context = vm.createContext({
    config: { verifyContracts: true, polygonScanApiKey: 'test', chainId: 80002, explorerUrl: 'https://amoy.polygonscan.com' },
    query: async (sql, values) => {
      if (sql.startsWith('SELECT')) return { rowCount: 1, rows: [event] };
      writes.push({ sql, values }); return { rowCount: 1, rows: [] };
    },
    updateJob: async (id, progress, message, result) => updates.push({ id, progress, message, result }),
    permanentError: (message) => Object.assign(new Error(message), { permanent: true }),
    deferredError: (message, retryAt) => Object.assign(new Error(message), { deferred: true, retryAt: new Date(retryAt).toISOString() }),
    createExplorerClient: (options) => createExplorerClient({ ...options, fetchImpl: async (url, init) => {
      calls.push(url.searchParams.get('action'));
      assert.ok(responses.length, 'unexpected extra explorer request');
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return new Response(JSON.stringify(response));
    } }),
    hasVerifiedSource, verificationResult,
    deployedBallotVersion: async () => 4,
    loadVerificationInput: async () => { artifacts += 1; return { input: {}, contractName: 'VoteEvent', compilerVersion: 'test' }; },
    loadLegacyVerificationInput: async () => { throw new Error('unexpected legacy artifact'); },
    constructorArguments: () => Array(11).fill('value'),
    AbiCoder: { defaultAbiCoder: () => ({ encode: () => '0x1234' }) },
  });
  const verify = vm.runInContext(read('../src/verify.js') + '\nverifyContract;', context);
  return { event, job, calls, writes, updates, verify: () => verify(job), artifacts: () => artifacts };
}
test('a stale pending GUID is completed from verified source without loading deployment artifacts', async () => {
  const f = fixture([verified]); const result = await f.verify();
  assert.equal(result.verified, true); assert.equal(result.alreadyVerified, true);
  assert.deepEqual(f.calls, ['getsourcecode']); assert.equal(f.artifacts(), 0);
  assert.match(f.writes[0].sql, /verification_status='VERIFIED'/);
  assert.equal(f.updates.at(-1).progress, 100);
  assert.ok(f.writes.every(({ sql }) => !/snapshot_root|deployment_block|INSERT|DELETE/u.test(sql)));
});
test('a job recovered after DB verification finishes without another network request', async () => {
  const f = fixture([], { verification_status: 'VERIFIED' });
  assert.equal((await f.verify()).verified, true); assert.equal(f.calls.length, 0);
});
test('pending verification defers once without sleep loops or exhausting failure attempts', async () => {
  const f = fixture([unverified, { status: '0', result: 'Pending in queue' }, unverified]);
  await assert.rejects(f.verify(), (error) => error.deferred === true && Date.parse(error.retryAt) > Date.now());
  assert.deepEqual(f.calls, ['getsourcecode', 'checkverifystatus', 'getsourcecode']);
  assert.equal(f.updates.at(-1).result.verificationPolls, 1);
  assert.ok(!f.writes.some(({ sql }) => /FAILED/.test(sql)));
});
test('verification completed during a GUID check is noticed in the same run', async () => {
  const f = fixture([unverified, { status: '0', result: 'Pending in queue' }, verified]);
  assert.equal((await f.verify()).verified, true);
});
test('a fresh request persists its GUID then releases the runner', async () => {
  const f = fixture([unverified, { status: '1', result: 'new-guid' }], { verification_guid: null });
  await assert.rejects(f.verify(), { deferred: true });
  assert.equal(f.artifacts(), 1); assert.deepEqual(f.calls, ['getsourcecode', 'verifysourcecode']);
  assert.ok(f.writes.some(({ values }) => values[1] === 'new-guid'));
});
test('genuine compiler rejection remains a failure unless address verification proves success', async () => {
  const f = fixture([unverified, { status: '0', result: 'Fail - Bytecode mismatch' }, unverified]);
  await assert.rejects(f.verify(), { permanent: true, message: 'Fail - Bytecode mismatch' });
  const already = fixture([unverified, { status: '0', result: 'Fail - Bytecode mismatch' }, verified]);
  assert.equal((await already.verify()).verified, true);
});
test('expired GUID recovery is bounded and changes only verification state', async () => {
  const responses = () => [unverified, { status: '0', result: 'GUID expired' }, unverified];
  const f = fixture(responses()); await assert.rejects(f.verify(), { deferred: true });
  assert.match(f.writes[0].sql, /verification_guid=NULL/);
  const stopped = fixture(responses()); stopped.job.result.guidResets = 2;
  await assert.rejects(stopped.verify(), { permanent: true });
});
test('verification deferral preserves progress and refunds the attempt without touching event readiness', async () => {
  const calls = []; const updates = [];
  const query = async (sql, values) => { calls.push({ sql, values }); return { rows: [], rowCount: 1 }; };
  const context = vm.createContext({ query, transaction: (fn) => fn({ query }), config: {},
    publishEventUpdate: (id) => updates.push(id), errorText: (error) => error.message });
  const failJob = vm.runInContext(read('../src/jobs.js') + '\nfailJob;', context);
  const outcome = await failJob({ id: 'job', event_id: 'event', type: 'VERIFY_CONTRACT', attempts: 8, max_attempts: 8 },
    { deferred: true, retryAt: new Date(Date.now() + 20000).toISOString(), message: 'Pending' });
  assert.equal(outcome.deferred, true); assert.equal(outcome.final, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /type='VERIFY_CONTRACT' THEN progress ELSE 0 END/);
  assert.match(calls[0].sql, /attempts=greatest\(attempts-1,0\)/);
  assert.match(calls[0].sql, /locked_at=NULL,locked_by=NULL/);
  assert.deepEqual(updates, ['event']);
});
