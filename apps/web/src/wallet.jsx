import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAppKit, useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { BrowserProvider } from 'ethers';

const WalletContext = createContext(null);
const AMOY_HEX = '0x13882';
const TRANSIENT_DISCONNECT_GRACE_MS = 3_000;

function normalizedAccount(value) {
  return typeof value === 'string' && value ? value.toLowerCase() : null;
}

function useStableEvmConnection({ address, isConnected, status, walletProvider }) {
  const account = normalizedAccount(address);
  const [stable, setStable] = useState({ account: null, connected: false });
  const providerRef = useRef(null);
  const disconnectTimerRef = useRef(null);

  const cancelDisconnect = useCallback(() => {
    if (disconnectTimerRef.current === null) return;
    window.clearTimeout(disconnectTimerRef.current);
    disconnectTimerRef.current = null;
  }, []);

  useEffect(() => {
    if (walletProvider?.request) providerRef.current = walletProvider;
  }, [walletProvider]);

  useEffect(() => {
    const appKitSessionActive = Boolean(
      isConnected
      || status === 'connected'
      || status === 'connecting'
      || status === 'reconnecting',
    );
    const appKitHasAccount = Boolean(
      account
      && (appKitSessionActive || status == null),
    );

    if (appKitHasAccount) {
      cancelDisconnect();
      setStable((current) => (
        current.connected && current.account === account
          ? current
          : { account, connected: true }
      ));
      return undefined;
    }

    if (appKitSessionActive) {
      cancelDisconnect();
      return undefined;
    }

    cancelDisconnect();
    disconnectTimerRef.current = window.setTimeout(() => {
      disconnectTimerRef.current = null;
      providerRef.current = null;
      setStable({ account: null, connected: false });
    }, TRANSIENT_DISCONNECT_GRACE_MS);

    return cancelDisconnect;
  }, [account, cancelDisconnect, isConnected, status]);

  useEffect(() => () => cancelDisconnect(), [cancelDisconnect]);

  return {
    ...stable,
    reconnecting: status === 'connecting' || status === 'reconnecting',
    walletProvider: walletProvider?.request
      ? walletProvider
      : stable.connected
        ? providerRef.current
        : null,
  };
}

export function WalletProvider({ children }) {
  const accountState = useAppKitAccount({ namespace: 'eip155' });
  const providerState = useAppKitProvider('eip155');
  const { open } = useAppKit();
  const connection = useStableEvmConnection({
    address: accountState.address,
    isConnected: accountState.isConnected,
    status: accountState.status,
    walletProvider: providerState.walletProvider,
  });
  const { account, connected, walletProvider } = connection;

  const ensureAmoy = useCallback(async () => {
    if (!walletProvider?.request) throw new Error('Connect an EVM wallet first.');
    const current = await walletProvider.request({ method: 'eth_chainId' });
    if (String(current).toLowerCase() === AMOY_HEX) return;

    try {
      await walletProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: AMOY_HEX }],
      });
    } catch (error) {
      if (error.code !== 4902) throw error;
      await walletProvider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: AMOY_HEX,
          chainName: 'Amoy',
          nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
          rpcUrls: [import.meta.env.VITE_PUBLIC_RPC_URL || 'https://rpc-amoy.polygon.technology'],
          blockExplorerUrls: [import.meta.env.VITE_BLOCK_EXPLORER_URL || 'https://amoy.polygonscan.com'],
        }],
      });
      await walletProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: AMOY_HEX }],
      });
    }
  }, [walletProvider]);

  // This is deliberately the only wallet-signing capability exposed by the
  // application. It is called only when the voter submits the final ballot.
  const signBallot = useCallback(async (typedData) => {
    if (!connected || !account || !walletProvider) {
      throw new Error('Connect your wallet before signing the ballot.');
    }

    await ensureAmoy();
    const signer = await new BrowserProvider(walletProvider, 'any').getSigner(account);
    const signerAddress = (await signer.getAddress()).toLowerCase();
    if (signerAddress !== account) {
      throw new Error('The selected wallet account changed. Reconnect and submit the ballot again.');
    }

    return signer.signTypedData(typedData.domain, typedData.types, typedData.message);
  }, [account, connected, ensureAmoy, walletProvider]);

  const openWallet = useCallback(() => open({
    view: connected ? 'Account' : 'Connect',
    namespace: 'eip155',
  }), [connected, open]);

  const value = useMemo(() => ({
    account,
    connected,
    reconnecting: connection.reconnecting,
    openWallet,
    signBallot,
    walletProvider,
  }), [
    account,
    connected,
    connection.reconnecting,
    openWallet,
    signBallot,
    walletProvider,
  ]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error('WalletProvider is missing.');
  return value;
}
