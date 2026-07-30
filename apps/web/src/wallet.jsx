import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAppKit, useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { BrowserProvider } from 'ethers';
import { api, readSession, saveSession } from './api.js';

const WalletContext = createContext(null);
const AMOY_HEX = '0x13882';

export function WalletProvider({ children }) {
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider('eip155');
  const { open } = useAppKit();
  const account = address?.toLowerCase() ?? null;
  const [session, setSession] = useState(readSession());
  const [authBusy, setAuthBusy] = useState(false);
  const authenticated = Boolean(
    account
    && session?.walletAddress?.toLowerCase() === account
    && Date.parse(session.expiresAt) > Date.now(),
  );

  useEffect(() => {
    const current = readSession();
    if (!account || (current?.walletAddress && current.walletAddress.toLowerCase() !== account)) {
      saveSession(null);
      setSession(null);
    } else {
      setSession(current);
    }
  }, [account]);

  const ensureAmoy = useCallback(async () => {
    if (!walletProvider?.request) throw new Error('Connect an EVM wallet first.');
    const current = await walletProvider.request({ method: 'eth_chainId' });
    if (String(current).toLowerCase() === AMOY_HEX) return;
    try {
      await walletProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: AMOY_HEX }] });
    } catch (error) {
      if (error.code !== 4902) throw error;
      await walletProvider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: AMOY_HEX,
          chainName: 'Polygon Amoy',
          nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
          rpcUrls: [import.meta.env.VITE_PUBLIC_RPC_URL || 'https://rpc-amoy.polygon.technology'],
          blockExplorerUrls: [import.meta.env.VITE_BLOCK_EXPLORER_URL || 'https://amoy.polygonscan.com'],
        }],
      });
    }
  }, [walletProvider]);

  const ensureAuthenticated = useCallback(async () => {
    if (!isConnected || !account || !walletProvider) throw new Error('Connect your wallet first.');
    const stored = readSession();
    if (stored?.walletAddress?.toLowerCase() === account) {
      setSession(stored);
      return stored;
    }
    setAuthBusy(true);
    try {
      await ensureAmoy();
      const challenge = await api('/v1/auth/nonce', { method: 'POST', body: { walletAddress: account } });
      const signer = await new BrowserProvider(walletProvider).getSigner();
      const signature = await signer.signMessage(challenge.message);
      const next = await api('/v1/auth/verify', { method: 'POST', body: { walletAddress: account, signature } });
      saveSession(next);
      setSession(next);
      return next;
    } finally { setAuthBusy(false); }
  }, [account, ensureAmoy, isConnected, walletProvider]);

  const getSigner = useCallback(async () => {
    await ensureAuthenticated();
    await ensureAmoy();
    return new BrowserProvider(walletProvider).getSigner();
  }, [ensureAmoy, ensureAuthenticated, walletProvider]);

  const logoutPortal = useCallback(async () => {
    await api('/v1/auth/logout', { method: 'POST' }).catch(() => {});
    saveSession(null);
    setSession(null);
  }, []);

  const value = useMemo(() => ({
    account,
    connected: Boolean(isConnected && account),
    authenticated,
    authBusy,
    openWallet: () => open({ view: 'Connect' }),
    ensureAuthenticated,
    getSigner,
    logoutPortal,
    walletProvider,
  }), [account, authBusy, authenticated, ensureAuthenticated, getSigner, isConnected, logoutPortal, open, walletProvider]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error('WalletProvider is missing.');
  return value;
}
