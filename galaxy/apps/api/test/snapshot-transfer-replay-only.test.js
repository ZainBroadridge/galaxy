import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('snapshot replays indexed transfers only through the record block with no token-state calls', async () => {
  const snapshot = await read('apps/api/src/snapshot.js');

  assert.match(snapshot, /alchemy_getAssetTransfers/u);
  assert.match(snapshot, /toBlock:\s*toQuantity\(recordBlock\)/u);
  assert.doesNotMatch(snapshot, /\beth_call\b/u);
  assert.doesNotMatch(snapshot, /\b(?:totalSupply|balanceOf|reconcileCurrentLedger|readUint256)\b/u);
  assert.doesNotMatch(snapshot, /assertLedgerConsistent/u);
  assert.match(snapshot, /reportConstructedBalanceProgress\(recordDateBalances, job\.id\)/u);
});

test('snapshot keeps the established durable progress milestones', async () => {
  const snapshot = await read('apps/api/src/snapshot.js');

  for (const progress of [3, 8, 62, 75, 84, 92, 95]) {
    assert.match(snapshot, new RegExp(`updateJob\\([\\s\\S]{0,180}?${progress}`, 'u'));
  }
  assert.match(snapshot, /Math\.min\(54, 10 \+ Math\.floor/u);
  assert.match(snapshot, /Processed .* reconstructed record-date balances/u);
});
