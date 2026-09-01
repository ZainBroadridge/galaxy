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
import {
  canDeferNetworkSetupUntilConnected,
  ensureAmoyNetwork,
  friendlyAmoyError,
  injectedEvmProvider,
  walletProviderUnavailableError,
} from './amoy-network.js';

const WalletContext = createContext(null);
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
  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkError, setNetworkError] = useState(null);
  const networkOperationRef = useRef(null);
  const automaticNetworkRef = useRef({ account: null, provider: null });

  const configureAmoy = useCallback(async (
    providerOverride = null,
    { allowUntilConnected = false } = {},
  ) => {
    const provider = providerOverride ?? walletProvider ?? injectedEvmProvider();
    if (!provider?.request) throw walletProviderUnavailableError();
    if (networkOperationRef.current) return networkOperationRef.current;

    setNetworkBusy(true);
    setNetworkError(null);

    const operation = (async () => {
      try {
        return await ensureAmoyNetwork(provider);
      } catch (error) {
        if (allowUntilConnected && canDeferNetworkSetupUntilConnected(error)) {
          return { deferred: true };
        }
        const friendly = friendlyAmoyError(error);
        setNetworkError(friendly);
        throw friendly;
      }
    })();

    networkOperationRef.current = operation;
    try {
      return await operation;
    } finally {
      if (networkOperationRef.current === operation) networkOperationRef.current = null;
      setNetworkBusy(false);
    }
  }, [walletProvider]);

  // A new AppKit connection can expose its provider a moment after the account.
  // Configure Amoy once both are stable, without prompting repeatedly if the
  // user deliberately declines the network request.
  useEffect(() => {
    if (!connected || !account || !walletProvider?.request) {
      if (!connected) automaticNetworkRef.current = { account: null, provider: null };
      return;
    }

    const previous = automaticNetworkRef.current;
    if (previous.account === account && previous.provider === walletProvider) return;
    automaticNetworkRef.current = { account, provider: walletProvider };
    void configureAmoy(walletProvider).catch(() => {});
  }, [account, configureAmoy, connected, walletProvider]);

  // This is deliberately the only wallet-signing capability exposed by the
  // application. It is called only when the voter submits the final ballot.
  const signBallot = useCallback(async (typedData) => {
    if (!connected || !account || !walletProvider) {
      throw new Error('Connect your wallet before signing the ballot.');
    }

    await configureAmoy(walletProvider);
    const signer = await new BrowserProvider(walletProvider, 'any').getSigner(account);
    const signerAddress = (await signer.getAddress()).toLowerCase();
    if (signerAddress !== account) {
      throw new Error('The selected wallet account changed. Reconnect and submit the ballot again.');
    }

    return signer.signTypedData(typedData.domain, typedData.types, typedData.message);
  }, [account, configureAmoy, connected, walletProvider]);

  const openWallet = useCallback(async () => {
    if (connected) {
      try {
        await open({ view: 'Account', namespace: 'eip155' });
      } catch (error) {
        const friendly = new Error(
          String(error?.message ?? '').trim() || 'Unable to open the wallet account window.',
        );
        friendly.code = 'WALLET_CONNECTION_FAILED';
        setNetworkError(friendly);
      }
      return;
    }

    // MetaMask can add/switch a chain before account permission is granted.
    // Doing this first prevents AppKit from declining a new connection merely
    // because Polygon Amoy is not yet present in the wallet.
    const injected = injectedEvmProvider();
    if (injected?.request) {
      try {
        await configureAmoy(injected, { allowUntilConnected: true });
      } catch {
        return;
      }
    }

    try {
      await open({ view: 'Connect', namespace: 'eip155' });
    } catch (error) {
      const friendly = new Error(
        String(error?.message ?? '').trim() || 'Unable to open the wallet connection window.',
      );
      friendly.code = 'WALLET_CONNECTION_FAILED';
      setNetworkError(friendly);
    }
  }, [configureAmoy, connected, open]);

  const ensureAmoy = useCallback(async () => configureAmoy(), [configureAmoy]);

  const value = useMemo(() => ({
    account,
    connected,
    reconnecting: connection.reconnecting,
    openWallet,
    signBallot,
    ensureAmoy,
    networkBusy,
    networkError,
    walletProvider,
  }), [
    account,
    connected,
    connection.reconnecting,
    ensureAmoy,
    networkBusy,
    networkError,
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
