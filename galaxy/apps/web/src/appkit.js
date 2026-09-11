import { createAppKit } from '@reown/appkit/react';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { defineChain } from '@reown/appkit/networks';

const rpcUrl = import.meta.env.VITE_PUBLIC_RPC_URL || 'https://rpc-amoy.polygon.technology';
const explorerUrl = import.meta.env.VITE_BLOCK_EXPLORER_URL || 'https://amoy.polygonscan.com';
const appUrl = window.location.origin;
const projectId = String(import.meta.env.VITE_REOWN_PROJECT_ID || '').trim();
export const reownConfigured = Boolean(projectId);

// Reown 1.8.x treats a Windows touch laptop as mobile when the touchscreen is
// the primary pointer, which hides the desktop WalletConnect QR connector.
// Remove this narrow shim after upstream issue reown-com/appkit#5648 is fixed.
function exposeQrOnTouchDesktop() {
  if (typeof window.matchMedia !== 'function') return;

  const mobileUserAgent = navigator.userAgentData?.mobile === true
    || /Android|webOS|iPhone|iPad|iPod|BlackBerry|Opera Mini/i.test(navigator.userAgent);
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const finePointerAvailable = window.matchMedia('(any-pointer: fine)').matches;

  if (mobileUserAgent || !coarsePointer || !finePointerAvailable) return;

  const nativeMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = (query) => {
    const result = nativeMatchMedia(query);
    if (query.replace(/\s+/g, '').toLowerCase() !== '(pointer:coarse)') return result;

    return new Proxy(result, {
      get(target, property) {
        if (property === 'matches') return false;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
}

exposeQrOnTouchDesktop();

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
  projectId: projectId || 'REPLACE_WITH_REOWN_PROJECT_ID',
  metadata: {
    name: 'Mini Galaxy Proxy Voting',
    description: 'Gasless proxy voting for ERC-20 token holders',
    url: appUrl,
    icons: [`${appUrl}/broadridge-logo-white.png`],
  },
  allWallets: 'SHOW',
  features: {
    analytics: false,
    email: false,
    socials: [],
    swaps: false,
    onramp: false,
  },
});
