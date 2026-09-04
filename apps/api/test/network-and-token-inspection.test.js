import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  AMOY_CHAIN_ID,
  ensureAmoyNetwork,
} from '../../web/src/amoy-network.js';
import { validateTokenAddressInput } from '../../web/src/token-address.js';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const TOKEN_ADDRESS = `0x${'12'.repeat(20)}`;

test('Amoy setup switches by chain ID without re-adding an existing network', async () => {
  const calls = [];
  const provider = {
    async request(request) {
      calls.push(request);
      if (request.method === 'eth_chainId') return '0x1';
      if (request.method === 'wallet_switchEthereumChain') return null;
      throw new Error(`Unexpected method: ${request.method}`);
    },
  };

  const result = await ensureAmoyNetwork(provider);

  assert.equal(result.switched, true);
  assert.deepEqual(calls.map((request) => request.method), [
    'eth_chainId',
    'wallet_switchEthereumChain',
  ]);
  assert.equal(calls[1].params[0].chainId, AMOY_CHAIN_ID);
});

test('Amoy setup recovers when a wallet reports the same chain as already added', async () => {
  const calls = [];
  let switchAttempts = 0;
  const provider = {
    async request(request) {
      calls.push(request);
      if (request.method === 'eth_chainId') return '0x1';
      if (request.method === 'wallet_switchEthereumChain') {
        switchAttempts += 1;
        if (switchAttempts === 1) {
          const error = new Error('Unrecognized chain ID. Try adding the chain first.');
          error.code = 4902;
          throw error;
        }
        return null;
      }
      if (request.method === 'wallet_addEthereumChain') {
        throw new Error('A network with this chain ID is already added under another name.');
      }
      throw new Error(`Unexpected method: ${request.method}`);
    },
  };

  const result = await ensureAmoyNetwork(provider);

  assert.equal(result.added, false);
  assert.equal(result.switched, true);
  assert.equal(switchAttempts, 2);
  assert.deepEqual(calls.map((request) => request.method), [
    'eth_chainId',
    'wallet_switchEthereumChain',
    'wallet_addEthereumChain',
    'eth_chainId',
    'wallet_switchEthereumChain',
  ]);
});

test('token address validation trims edge whitespace and explains malformed input', () => {
  const trimmed = validateTokenAddressInput(`  ${TOKEN_ADDRESS}\r\n`);
  assert.equal(trimmed.valid, true);
  assert.equal(trimmed.tokenAddress, TOKEN_ADDRESS);
  assert.equal(trimmed.normalizedWhitespace, true);

  const internalSpace = validateTokenAddressInput(`${TOKEN_ADDRESS.slice(0, 10)} ${TOKEN_ADDRESS.slice(10)}`);
  assert.equal(internalSpace.valid, false);
  assert.match(internalSpace.message, /Remove spaces/u);

  const incomplete = validateTokenAddressInput('0x1234');
  assert.equal(incomplete.valid, false);
  assert.match(incomplete.message, /42 characters/u);
});

test('wallet connection configures Amoy without a duplicate add-network control', async () => {
  const [wallet, app] = await Promise.all([
    read('apps/web/src/wallet.jsx'),
    read('apps/web/src/App.jsx'),
  ]);

  const preflight = wallet.indexOf("await configureAmoy(injected, { allowUntilConnected: true })");
  const openConnect = wallet.indexOf("await open({ view: 'Connect', namespace: 'eip155' })");
  assert.ok(preflight >= 0 && openConnect > preflight);
  assert.match(wallet, /void configureAmoy\(walletProvider\)\.catch/u);
  assert.match(wallet, /networkBusy/u);
  assert.match(wallet, /networkError/u);
  assert.match(app, /onClick=\{wallet\.openWallet\}/u);
  assert.doesNotMatch(app, /pv-add-network|PlusIcon|addOrSwitchAmoy/u);
  assert.doesNotMatch(app, /wallet_addEthereumChain/u);
});

test('create event retains manual inspection and adds debounced automatic inspection', async () => {
  const organiser = await read('apps/web/src/pages/OrganiserDashboard.jsx');

  assert.match(organiser, /TOKEN_INSPECTION_DEBOUNCE_MS/u);
  assert.match(organiser, /window\.setTimeout\([\s\S]*inspectTokenAddress\(form\.tokenAddress\)/u);
  assert.match(organiser, /onClick=\{inspect\}/u);
  assert.match(organiser, /body: \{ tokenAddress: validation\.tokenAddress \}/u);
  assert.match(organiser, /tokenAddress: tokenAddress\.tokenAddress/u);
  assert.doesNotMatch(organiser, /Leading or trailing spaces were ignored/u);
  assert.doesNotMatch(organiser, /inspectNotice|setInspectNotice/u);
});
