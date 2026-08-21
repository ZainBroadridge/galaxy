import { useEffect, useState } from 'react';
import { useAppKit } from '@reown/appkit/react';
import {
  Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate,
} from 'react-router-dom';
import { reownConfigured } from './appkit.js';
import {
  browserPushNotificationPath,
  consumeBrowserPushBootstrap,
  listenForBrowserPushOpen,
} from './browser-push.js';
import { Notice } from './components/UI.jsx';
import { useNotifications } from './notifications.jsx';
import { useWallet } from './wallet.jsx';
import HomePage from './pages/HomePage.jsx';
import VotingDashboard, { VoteEventPage } from './pages/VotingDashboard.jsx';
import OrganiserDashboard, { OrganiserEventPage } from './pages/OrganiserDashboard.jsx';
import ResultsPage, { EventResultsPage } from './pages/ResultsPage.jsx';
import WalletComms from './pages/WalletComms.jsx';

const AMOY_CHAIN_ID = '0x13882';

function shortAddress(value) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'Connect Wallet';
}

function injectedProvider() {
  if (typeof window === 'undefined') return null;
  const ethereum = window.ethereum;
  if (!ethereum) return null;
  const providers = Array.isArray(ethereum.providers) ? ethereum.providers : [ethereum];
  return providers.find((provider) => provider?.isMetaMask && !provider?.isBraveWallet)
    ?? providers.find((provider) => provider?.isMetaMask)
    ?? ethereum;
}

function SvgIcon({ children, className = '' }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {children}
  </svg>;
}

function WalletIcon() {
  return <SvgIcon className="pv-wallet-icon">
    <path d="M3.5 6.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" />
    <path d="M1.75 9.5h17.5M15.25 13h4.25v3h-4.25a1.5 1.5 0 1 1 0-3Z" />
  </SvgIcon>;
}

function ChevronIcon() {
  return <SvgIcon className="pv-chevron-icon"><path d="m7 9.25 5 5 5-5" /></SvgIcon>;
}

function BellIcon() {
  return <SvgIcon className="pv-bell-icon">
    <path d="M18 9a6 6 0 0 0-12 0c0 7-2.75 7-2.75 9h17.5c0-2-2.75-2-2.75-9Z" />
    <path d="M9.5 21h5" />
  </SvgIcon>;
}

function HomeIcon() {
  return <SvgIcon><path d="m3.5 10.25 8.5-7 8.5 7v9.5a.75.75 0 0 1-.75.75H14v-6h-4v6H4.25a.75.75 0 0 1-.75-.75v-9.5Z" /></SvgIcon>;
}

function VoteIcon() {
  return <SvgIcon>
    <path d="M6.5 7.5h11v13h-11zM9 13l2 2 4-5" />
    <path d="M9 7.5V5.75a3 3 0 0 1 6 0V7.5M4 20.5h16" />
  </SvgIcon>;
}

function ResultsIcon() {
  return <SvgIcon>
    <path d="M5 20V11M12 20V4M19 20V8M2.5 20.5h19" />
  </SvgIcon>;
}

function OrganiserIcon() {
  return <SvgIcon>
    <rect x="3.5" y="3.5" width="6" height="6" rx=".8" />
    <rect x="14.5" y="3.5" width="6" height="6" rx=".8" />
    <rect x="3.5" y="14.5" width="6" height="6" rx=".8" />
    <rect x="14.5" y="14.5" width="6" height="6" rx=".8" />
  </SvgIcon>;
}

function PlusIcon() {
  return <SvgIcon><path d="M12 4v16M4 12h16" /></SvgIcon>;
}

function navClass(active) {
  return active ? 'active' : undefined;
}

export default function App() {
  const wallet = useWallet();
  const location = useLocation();
  const navigate = useNavigate();
  const { open } = useAppKit();
  const { unreadCount } = useNotifications();
  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkError, setNetworkError] = useState(null);
  const homeRoute = location.pathname === '/' || location.pathname === '/home';
  const voteRouteActive = location.pathname.startsWith('/voting')
    || location.pathname.startsWith('/vote/');

  useEffect(() => {
    const openNotification = (messageId, replace = false) => {
      navigate(browserPushNotificationPath(messageId), { replace });
    };

    const bootstrapMessageId = consumeBrowserPushBootstrap();
    if (bootstrapMessageId) openNotification(bootstrapMessageId, true);

    return listenForBrowserPushOpen((messageId) => openNotification(messageId));
  }, [navigate]);

  async function addOrSwitchAmoy() {
    if (networkBusy) return;
    setNetworkBusy(true);
    setNetworkError(null);
    try {
      const provider = wallet.walletProvider ?? injectedProvider();
      if (!provider?.request) {
        await open({ view: 'Connect', namespace: 'eip155' });
        return;
      }

      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: AMOY_CHAIN_ID }],
        });
      } catch (error) {
        const unknownChain = error?.code === 4902
          || String(error?.message ?? '').toLowerCase().includes('unrecognized chain');
        if (!unknownChain) throw error;

        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: AMOY_CHAIN_ID,
            chainName: 'Polygon Amoy Testnet',
            nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
            rpcUrls: [import.meta.env.VITE_PUBLIC_RPC_URL || 'https://rpc-amoy.polygon.technology'],
            blockExplorerUrls: [import.meta.env.VITE_BLOCK_EXPLORER_URL || 'https://amoy.polygonscan.com'],
          }],
        });
      }
    } catch (error) {
      if (error?.code !== 4001) setNetworkError(error);
    } finally {
      setNetworkBusy(false);
    }
  }

  function openWallet() {
    open({ view: wallet.connected ? 'Account' : 'Connect', namespace: 'eip155' });
  }

  return <div className={`app-shell pv-shell${homeRoute ? ' pv-shell-home' : ''}`}>
    <header className="topbar pv-topbar">
      <div className="pv-topbar-inner">
        <Link className="pv-brand-lockup" to="/" aria-label="ProxyVote home">
          <span className="pv-wordmark" aria-label="ProxyVote">
            <span>Proxy</span><span>Vote</span>
          </span>
          <span className="pv-brand-divider" aria-hidden="true" />
          <span className="pv-powered-lockup">
            <small>Powered by</small>
            <img src="/brd-logo.svg" alt="Broadridge" />
          </span>
        </Link>

        <nav className="pv-primary-nav" aria-label="Primary navigation">
          <Link className={navClass(homeRoute)} to="/">
            <HomeIcon /><span>Home</span>
          </Link>
          <NavLink
            to="/voting"
            className={({ isActive }) => navClass(isActive || voteRouteActive)}
          >
            <VoteIcon /><span>Vote</span>
          </NavLink>
          <NavLink to="/results">
            <ResultsIcon /><span>Results</span>
          </NavLink>
          <NavLink to="/organiser">
            <OrganiserIcon /><span>Organiser</span>
          </NavLink>
        </nav>

        <div className="wallet-actions pv-topbar-actions">
          <NavLink
            to="/notifications"
            className={({ isActive }) => `topbar-notifications${isActive ? ' active' : ''}`}
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            title="Notifications"
          >
            <BellIcon />
            {unreadCount > 0 && <span
              className="notification-badge"
              aria-hidden="true"
            >{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </NavLink>
          <button
            className={`wallet-control${wallet.connected ? ' connected' : ''}`}
            type="button"
            onClick={openWallet}
            aria-label={wallet.connected ? `Open wallet ${shortAddress(wallet.account)}` : 'Connect wallet'}
          >
            <WalletIcon />
            <span>{shortAddress(wallet.account)}</span>
            <ChevronIcon />
          </button>
        </div>
      </div>
    </header>

    <main className="app-content pv-content">
      <div className="pv-system-notices">
        {!reownConfigured && <Notice tone="warning">Set <code>VITE_REOWN_PROJECT_ID</code> before deployment.</Notice>}
        {networkError && <Notice tone="error">{networkError.message || 'Unable to add Polygon Amoy to this wallet.'}</Notice>}
      </div>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/voting" element={<VotingDashboard />} />
        <Route path="/vote/:eventId" element={<VoteEventPage />} />
        <Route path="/organiser" element={<OrganiserDashboard />} />
        <Route path="/organiser/:eventId" element={<OrganiserEventPage />} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/results/:eventId" element={<EventResultsPage />} />
        <Route path="/notifications" element={<WalletComms />} />
        <Route path="/comms" element={<Navigate to="/notifications" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>

    <footer className="site-footer pv-site-footer">
      <div className="site-footer-inner">
        <img className="pv-footer-logo" src="/brd-logo.svg" alt="Broadridge" />
        <span className="footer-copyright">© 2026 Broadridge Financial Solutions, Inc. All rights reserved.</span>
      </div>
    </footer>

    {homeRoute && <div className="pv-add-network-wrap">
      <button
        className={`pv-add-network${networkBusy ? ' is-busy' : ''}`}
        type="button"
        onClick={addOrSwitchAmoy}
        disabled={networkBusy}
        aria-describedby="pv-test-network-tooltip"
        aria-label="Add Polygon Amoy test network"
      >
        <PlusIcon />
      </button>
      <div id="pv-test-network-tooltip" className="pv-network-tooltip" role="tooltip">
        <strong>Add test network</strong>
        <span>You are adding Polygon Amoy, a test network, to your wallet.</span>
      </div>
    </div>}
  </div>;
}
