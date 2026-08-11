import { getAddress } from 'ethers';
import { fetchCommunications, verifyCommunications } from './communications.js';

const configuredId = import.meta.env.VITE_SNAP_ID?.trim();
export const SNAP_ID = configuredId || (location.hostname === 'localhost' ? 'local:http://localhost:8080' : null);
export const SNAP_VERSION = import.meta.env.VITE_SNAP_VERSION || '*';

export function snapConfiguration() {
  if (!SNAP_ID) return { ready: false, message: 'Set VITE_SNAP_ID to the published npm Snap ID.' };
  if (SNAP_ID.startsWith('local:') && location.hostname !== 'localhost') {
    return { ready: false, message: 'A local Snap ID cannot be installed from a hosted dApp. Publish the Snap to npm and set VITE_SNAP_ID.' };
  }
  return { ready: true, id: SNAP_ID };
}

async function discoverMetaMask() {
  const injected = window.ethereum?.providers?.find((provider) => provider.isMetaMask && !provider.isBraveWallet)
    ?? (window.ethereum?.isMetaMask && !window.ethereum?.isBraveWallet ? window.ethereum : null);
  if (injected) return injected;

  const announced = [];
  const listener = (event) => {
    if (event.detail?.info?.rdns === 'io.metamask' || event.detail?.provider?.isMetaMask) announced.push(event.detail.provider);
  };
  window.addEventListener('eip6963:announceProvider', listener);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise((resolve) => setTimeout(resolve, 150));
  window.removeEventListener('eip6963:announceProvider', listener);
  return announced[0] ?? null;
}

async function metamask() {
  const configuration = snapConfiguration();
  if (!configuration.ready) throw new Error(configuration.message);
  const provider = await discoverMetaMask();
  if (!provider?.request) throw new Error('MetaMask Extension is required for Snap communications.');
  return provider;
}

function snapError(value, fallback) {
  const error = value?.error;
  if (error) throw new Error(error.message || error.data?.message || fallback);
  return value;
}

export async function getInstalledSnap() {
  if (!snapConfiguration().ready) return null;
  const snaps = await (await metamask()).request({ method: 'wallet_getSnaps' });
  return snaps?.[SNAP_ID] ?? null;
}

export async function installSnap() {
  const provider = await metamask();
  const result = await provider.request({
    method: 'wallet_requestSnaps',
    params: { [SNAP_ID]: SNAP_ID.startsWith('local:') ? {} : { version: SNAP_VERSION } },
  });
  const installed = snapError(result?.[SNAP_ID], 'MetaMask rejected the Snap installation.');
  try {
    await provider.request({
      method: 'wallet_snap',
      params: { snapId: SNAP_ID, request: { method: 'ping' } },
    });
  } catch (error) {
    throw new Error(error?.message || 'The Snap was installed but MetaMask could not start it.');
  }
  return installed;
}

export async function invokeSnap(method, params) {
  const provider = await metamask();
  try {
    return await provider.request({
      method: 'wallet_snap',
      params: { snapId: SNAP_ID, request: params === undefined ? { method } : { method, params } },
    });
  } catch (error) {
    throw new Error(error?.message || `Snap method ${method} failed.`);
  }
}

async function assertMetaMaskWallet(walletAddress) {
  const provider = await metamask();
  const accounts = await provider.request({ method: 'eth_accounts' });
  const expected = getAddress(walletAddress).toLowerCase();
  const active = Array.isArray(accounts) ? accounts.map((value) => {
    try { return getAddress(value).toLowerCase(); } catch { return null; }
  }) : [];
  if (!active.includes(expected)) {
    throw new Error('Use the same connected wallet in MetaMask and the PV dApp before syncing communications.');
  }
}

export async function syncSnap({ walletAddress, install = false, messages }) {
  await assertMetaMaskWallet(walletAddress);
  let snap = await getInstalledSnap();
  if (!snap && install) snap = await installSnap();
  if (!snap) return { installed: false, messages: [], accepted: 0 };

  const verified = messages === undefined
    ? await fetchCommunications(walletAddress)
    : verifyCommunications(messages);
  await invokeSnap('setWalletContext', { walletAddress });
  const result = await invokeSnap('ingestCommunications', { messages: verified });
  return { installed: true, messages: verified, accepted: result?.acceptedMessageIds?.length ?? 0, ...result };
}
