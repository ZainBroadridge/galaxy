import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('the EVM wallet connection survives transient AppKit reconnect states', async () => {
  const wallet = await read('apps/web/src/wallet.jsx');

  assert.match(wallet, /useAppKitAccount\(\{ namespace: 'eip155' \}\)/u);
  assert.match(wallet, /status === 'connecting'[\s\S]*status === 'reconnecting'/u);
  assert.match(wallet, /const TRANSIENT_DISCONNECT_GRACE_MS = [\d_]+;/u);
  assert.match(wallet, /const providerRef = useRef\(null\);/u);
  assert.match(wallet, /walletProvider\?\.request\s*\? walletProvider[\s\S]*providerRef\.current/u);
  assert.match(wallet, /window\.setTimeout\([\s\S]*TRANSIENT_DISCONNECT_GRACE_MS/u);
  assert.equal((wallet.match(/\.signTypedData\(/gu) ?? []).length, 1);
});
