import { AppKitButton } from '@reown/appkit/react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { reownConfigured } from './appkit.js';
import { Notice } from './components/UI.jsx';
import { useNotifications } from './notifications.jsx';
import { useWallet } from './wallet.jsx';
import VotingDashboard, { VoteEventPage } from './pages/VotingDashboard.jsx';
import OrganiserDashboard, { OrganiserEventPage } from './pages/OrganiserDashboard.jsx';
import ResultsPage, { EventResultsPage } from './pages/ResultsPage.jsx';
import WalletComms from './pages/WalletComms.jsx';

const navigation = [
  ['/', 'Voting Dashboard'],
  ['/results', 'Results'],
  ['/organiser', 'Organizer'],
  ['/comms', 'Wallet Comms'],
];

export default function App() {
  const { authenticated, logoutPortal } = useWallet();
  const { unreadCount } = useNotifications();

  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar-inner">
        <NavLink to="/" className="brand" aria-label="On-Chain Proxy Voting home">
          <img className="brand-logo" src="/brd-logo.svg" alt="Broadridge" />
          <img className="brand-icon" src="/brd-icon.svg" alt="" aria-hidden="true" />
          <span>On-Chain Proxy Voting</span>
        </NavLink>

        <nav aria-label="Primary navigation">
          {navigation.map(([to, label]) => {
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

        <div className="wallet-actions">
          <span className="network-label" aria-label="Connected network">
            <span aria-hidden="true" />
            Polygon Amoy Testnet
          </span>
          <AppKitButton size="sm" balance="hide" />
          {authenticated && <button className="text-button" type="button" onClick={logoutPortal}>Lock portal</button>}
        </div>
      </div>
    </header>

    <main className="app-content">
      {!reownConfigured && <Notice tone="warning">Set <code>VITE_REOWN_PROJECT_ID</code> before deployment.</Notice>}
      <Routes>
        <Route path="/" element={<VotingDashboard />} />
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
        <img src="/brd-logo.svg" alt="Broadridge" />
        <span>© 2026 Broadridge Financial Solutions, Inc. All rights reserved.</span>
      </div>
    </footer>
  </div>;
}
