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

const nav = [
  ['/', 'Voting Dashboard'],
  ['/organiser', 'Organiser Dashboard'],
  ['/results', 'Results'],
  ['/comms', 'Wallet Comms'],
];

function BellIcon() {
  return <svg className="bell-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 21h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>;
}

export default function App() {
  const { authenticated, logoutPortal } = useWallet();
  const { unreadCount } = useNotifications();
  return <div className="app-shell">
    <header className="topbar">
      <NavLink to="/" className="brand">
        <img src="/broadridge-logo-white.png" alt="Broadridge" />
        <span>Proxy Voting</span>
      </NavLink>
      <nav>{nav.map(([to, label]) => {
        const notifications = to === '/comms';
        return <NavLink key={to} to={to} end={to === '/'}>
          {notifications && <BellIcon />}
          <span>{label}</span>
          {notifications && unreadCount > 0 && <span className="notification-badge" aria-label={`${unreadCount} unread notifications`}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </NavLink>;
      })}</nav>
      <div className="wallet-actions"><AppKitButton size="sm" balance="hide" />{authenticated && <button className="text-button" onClick={logoutPortal}>Lock portal</button>}</div>
    </header>
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
  </div>;
}
