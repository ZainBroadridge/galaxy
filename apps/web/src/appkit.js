import { createAppKit } from '@reown/appkit/react';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { defineChain } from '@reown/appkit/networks';

const rpcUrl = import.meta.env.VITE_PUBLIC_RPC_URL || 'https://rpc-amoy.polygon.technology';
const explorerUrl = import.meta.env.VITE_BLOCK_EXPLORER_URL || 'https://amoy.polygonscan.com';
const appUrl = import.meta.env.VITE_APP_URL || window.location.origin;
export const reownConfigured = Boolean(import.meta.env.VITE_REOWN_PROJECT_ID);

export const polygonAmoy = defineChain({
  id: 80002,
  caipNetworkId: 'eip155:80002',
  chainNamespace: 'eip155',
  name: 'Polygon Amoy',
  nativeCurrency: { decimals: 18, name: 'POL', symbol: 'POL' },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: 'PolygonScan', url: explorerUrl } },
  testnet: true,
});

createAppKit({
  adapters: [new EthersAdapter()],
  networks: [polygonAmoy],
  defaultNetwork: polygonAmoy,
  projectId: import.meta.env.VITE_REOWN_PROJECT_ID || 'REPLACE_WITH_REOWN_PROJECT_ID',
  metadata: {
    name: 'Mini Galaxy Proxy Voting',
    description: 'Gasless proxy voting for ERC-20 token holders',
    url: appUrl,
    icons: [`${appUrl.replace(/\/$/, '')}/broadridge-logo-white.png`],
  },
  features: {
    analytics: false,
    email: false,
    socials: [],
    swaps: false,
    onramp: false,
  },
});
