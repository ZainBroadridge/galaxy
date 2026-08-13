import { useState } from 'react';
import { useAppKit } from '@reown/appkit/react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { reownConfigured } from './appkit.js';
import { Notice } from './components/UI.jsx';
import { useNotifications } from './notifications.jsx';
import { useWallet } from './wallet.jsx';
import VotingDashboard, { VoteEventPage } from './pages/VotingDashboard.jsx';
import OrganiserDashboard, { OrganiserEventPage } from './pages/OrganiserDashboard.jsx';
import ResultsPage, { EventResultsPage } from './pages/ResultsPage.jsx';
import WalletComms from './pages/WalletComms.jsx';
import HomePage from './pages/HomePage.jsx';

const AMOY_CHAIN_ID = '0x13882';
const primaryNavigation = [
  ['/voting', 'Voting Dashboard'],
  ['/results', 'Results'],
  ['/organiser', 'Organizer'],
  ['/comms', 'Wallet Comms'],
];

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

function WalletIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M3.25 4.5h10.8a2 2 0 0 1 2 2v1.15h.7a1.5 1.5 0 0 1 1.5 1.5v4.1a1.5 1.5 0 0 1-1.5 1.5h-.7v.75a2 2 0 0 1-2 2H3.25a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Zm0 1.5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h10.8a.5.5 0 0 0 .5-.5v-.75h-2.7a3.55 3.55 0 1 1 0-7.1h2.7V6.5a.5.5 0 0 0-.5-.5H3.25Zm8.6 3.15a2.05 2.05 0 1 0 0 4.1h4.9V9.15h-4.9Zm.05 1.3a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Z" />
  </svg>;
}

function ChevronIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 5.75 4.5 4.5 4.5-4.5" /></svg>;
}

function PlusIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>;
}

export default function App() {
  const wallet = useWallet();
  const { open } = useAppKit();
  const { unreadCount } = useNotifications();
  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkError, setNetworkError] = useState(null);

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
        if (error?.code !== 4902 && !String(error?.message ?? '').toLowerCase().includes('unrecognized chain')) {
          throw error;
        }
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

  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-primary">
          <Link to="/" className="brand" aria-label="On-Chain Proxy Voting home">
            <img className="brand-logo" src="/brd-logo.svg" alt="Broadridge" />
            <img className="brand-icon" src="/brd-icon.svg" alt="" aria-hidden="true" />
            <span>On-Chain Proxy Voting</span>
          </Link>

          <nav aria-label="Primary navigation">
            <Link className="nav-home" to="/">Home</Link>
            {primaryNavigation.map(([to, label]) => {
              const notifications = to === '/comms';
              return <NavLink key={to} to={to} end={to === '/'}>
                <span>{label}</span>
                {notifications && unreadCount > 0 && <span
                  className="notification-badge"
                  aria-label={`${unreadCount} unread notifications`}
                >{unreadCount > 99 ? '99+' : unreadCount}</span>}
              </NavLink>;
            })}
          </nav>
        </div>

        <div className="wallet-actions">
          <button
            className="network-control"
            type="button"
            onClick={addOrSwitchAmoy}
            disabled={networkBusy}
            title="Add or switch to Polygon Amoy Testnet"
          >
            <span className="network-dot" aria-hidden="true" />
            <span>{networkBusy ? 'Opening wallet…' : 'Polygon Amoy Testnet'}</span>
            <PlusIcon />
          </button>
          <button className="wallet-control" type="button" onClick={openWallet}>
            <WalletIcon />
            <span>{shortAddress(wallet.account)}</span>
            <ChevronIcon />
          </button>
        </div>
      </div>
    </header>

    <main className="app-content">
      {!reownConfigured && <Notice tone="warning">Set <code>VITE_REOWN_PROJECT_ID</code> before deployment.</Notice>}
      {networkError && <Notice tone="error">{networkError.message || 'Unable to add Polygon Amoy to this wallet.'}</Notice>}
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/voting" element={<VotingDashboard />} />
        <Route path="/vote/:eventId" element={<VoteEventPage />} />
        <Route path="/organiser" element={<OrganiserDashboard />} />
        <Route path="/organiser/:eventId" element={<OrganiserEventPage />} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/results/:eventId" element={<EventResultsPage />} />
        <Route path="/comms" element={<WalletComms />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>

    <footer className="site-footer">
      <div className="site-footer-inner">
        <img src="/brd-icon.svg" alt="" aria-hidden="true" />
        <span className="footer-brand">Broadridge</span>
        <span className="footer-copyright">© 2026 Broadridge Financial Solutions, Inc. All rights reserved.</span>
      </div>
    </footer>
  </div>;
}
