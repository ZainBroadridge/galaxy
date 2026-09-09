import assert from 'node:assert/strict';
import test from 'node:test';
import { createExplorerClient, hasVerifiedSource, verificationResult } from '../src/explorer-verification.js';

const verified = { status: '1', result: [{ SourceCode: 'contract Example {}', ABI: '[]' }] };
test('address-level confirmation requires actual source and a decoded ABI', () => {
  assert.equal(hasVerifiedSource(verified), true);
  for (const value of [null, {}, { status: '1', result: 'GUID' },
    { status: '0', result: verified.result }, { status: '1', result: [{ SourceCode: '', ABI: '[]' }] },
    { status: '1', result: [{ SourceCode: 'code', ABI: 'Contract source code not verified' }] },
    { status: '1', result: [{ SourceCode: 'code', ABI: '{}' }] }]) {
    assert.equal(hasVerifiedSource(value), false);
  }
});
test('verification responses distinguish completion from queue receipts and real rejection', () => {
  for (const result of ['Pass - Verified', 'Already Verified', 'Contract source code already verified']) {
    assert.equal(verificationResult({ status: '1', result }).state, 'VERIFIED');
  }
  assert.equal(verificationResult({ status: '0', result: 'Pending in queue' }).state, 'PENDING');
  assert.equal(verificationResult({ status: '1', result: 'Pending in queue' }).state, 'PENDING');
  assert.equal(verificationResult({ status: '0', result: 'Max rate limit reached' }).state, 'RETRY');
  assert.equal(verificationResult({ status: '0', result: 'Unable to locate GUID' }).state, 'EXPIRED');
  for (const result of ['Fail - Unable to verify', 'Not verified', 'Some arbitrary submission GUID', 'Invalid API Key']) {
    assert.equal(verificationResult({ status: '1', result }).state, 'REJECTED');
  }
});
test('explorer requests use the correct address, chain and GUID, with a timeout signal', async () => {
  const calls = [];
  const client = createExplorerClient({ chainId: 80002, apiKey: 'test-key', fetchImpl: async (url, init) => {
    calls.push({ url, init }); return new Response(JSON.stringify(verified));
  } });
  await client.source('0x1234'); await client.status('request-guid'); await client.submit({ sourceCode: '{}', contractaddress: '0x1234' });
  for (const { url, init } of calls) {
    assert.equal(url.origin, 'https://api.etherscan.io');
    assert.equal(url.searchParams.get('chainid'), '80002');
    assert.equal(url.searchParams.get('module'), 'contract');
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.equal(calls[0].url.searchParams.get('action'), 'getsourcecode');
  assert.equal(calls[0].url.searchParams.get('address'), '0x1234');
  assert.equal(calls[1].url.searchParams.get('guid'), 'request-guid');
  assert.equal(calls[2].init.method, 'POST');
  assert.equal(calls[2].init.body.get('sourceCode'), '{}');
});
test('HTTP errors and malformed payloads are not mistaken for verified source', async () => {
  for (const response of [new Response('blocked', { status: 429 }), new Response('<html>not JSON</html>'), new Response('{}')]) {
    const client = createExplorerClient({ chainId: 80002, apiKey: 'test', fetchImpl: async () => response });
    await assert.rejects(client.source('0x1234'), /Explorer API/);
  }
});
