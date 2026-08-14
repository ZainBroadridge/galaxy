import { createContext, useCallback, useContext, useMemo } from 'react';
import { useAppKit, useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { BrowserProvider } from 'ethers';

const WalletContext = createContext(null);
const AMOY_HEX = '0x13882';

export function WalletProvider({ children }) {
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider('eip155');
  const { open } = useAppKit();
  const account = address?.toLowerCase() ?? null;

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
          chainName: 'Polygon Amoy',
          nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
          rpcUrls: [import.meta.env.VITE_PUBLIC_RPC_URL || 'https://rpc-amoy.polygon.technology'],
          blockExplorerUrls: [import.meta.env.VITE_BLOCK_EXPLORER_URL || 'https://amoy.polygonscan.com'],
        }],
      });
    }
  }, [walletProvider]);

  // This is deliberately the only wallet-signing capability exposed by the
  // application. It is called only when the voter submits the final ballot.
  const signBallot = useCallback(async (typedData) => {
    if (!isConnected || !account || !walletProvider) {
      throw new Error('Connect your wallet before signing the ballot.');
    }

    await ensureAmoy();
    const signer = await new BrowserProvider(walletProvider, 'any').getSigner(account);
    const signerAddress = (await signer.getAddress()).toLowerCase();
    if (signerAddress !== account) {
      throw new Error('The selected wallet account changed. Reconnect and submit the ballot again.');
    }

    return signer.signTypedData(typedData.domain, typedData.types, typedData.message);
  }, [account, ensureAmoy, isConnected, walletProvider]);

  const value = useMemo(() => ({
    account,
    connected: Boolean(isConnected && account),
    openWallet: () => open({ view: 'Connect', namespace: 'eip155' }),
    signBallot,
    walletProvider,
  }), [account, isConnected, open, signBallot, walletProvider]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error('WalletProvider is missing.');
  return value;
}
