import {
  Link, NavLink, Outlet, useLocation,
} from 'react-router-dom';
import { reownConfigured } from '../appkit.js';
import BrandLockup, { ProxyVoteMark } from '../components/BrandLockup.jsx';
import { Notice } from '../components/UI.jsx';
import { useNotifications } from '../notifications.jsx';
import { useWallet } from '../wallet.jsx';
import { useIssuerSession } from './IssuerSession.jsx';


function shortAddress(value) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'Connect Wallet';
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

function navClass(active) {
  return active ? 'active' : undefined;
}

export default function IssuerLayout() {
  const wallet = useWallet();
  const location = useLocation();
  const issuer = useIssuerSession();
  const { unreadCount } = useNotifications();
  const homeRoute = location.pathname === '/issuer/home';
  return <div className={`app-shell pv-shell issuer-shell${homeRoute ? ' pv-shell-home' : ''}`}>
    <header className="topbar pv-topbar">
      <div className="pv-topbar-inner">
        <Link className="pv-brand-lockup" to="/issuer/home" aria-label="ProxyVote home">
          <BrandLockup><ProxyVoteMark stacked /></BrandLockup>
        </Link>

        <nav className="pv-primary-nav" aria-label="Primary navigation">
          <Link className={navClass(homeRoute)} to="/issuer/home">
            <HomeIcon /><span>Home</span>
          </Link>
          <NavLink to="/results">
            <ResultsIcon /><span>Results</span>
          </NavLink>
          <NavLink to="/organiser">
            <OrganiserIcon /><span>Organiser</span>
          </NavLink>
        </nav>

        <div className="wallet-actions pv-topbar-actions">
          <NavLink
            to="/issuer/notifications"
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
            onClick={wallet.openWallet}
            aria-label={wallet.connected ? `Open wallet ${shortAddress(wallet.account)}` : 'Connect wallet'}
          >
            <WalletIcon />
            <span>{shortAddress(wallet.account)}</span>
            <ChevronIcon />
          </button>
          <button className="issuer-exit-button" type="button" onClick={() => void issuer.logout()}
            aria-label="Exit issuer interface" title="Exit issuer interface">
            <SvgIcon><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M14 8l4 4-4 4M8 12h11" /></SvgIcon>
          </button>
        </div>
      </div>
    </header>

    <div className="app-content pv-content">
      <div className="pv-system-notices">
        {!reownConfigured && <Notice tone="warning">Set <code>VITE_REOWN_PROJECT_ID</code> before deployment.</Notice>}
        {wallet.networkError && <Notice tone="error">{wallet.networkError.message}</Notice>}
      </div>
      <Outlet />
    </div>

    <footer className="site-footer pv-site-footer">
      <div className="site-footer-inner">
        <span className="pv-footer-brand">
          <img className="pv-footer-mark" src="/brd-icon.svg" alt="" aria-hidden="true" />
          <span>Broadridge</span>
        </span>
        <span className="footer-copyright">© 2026 Broadridge Financial Solutions, Inc. All rights reserved.</span>
      </div>
    </footer>
  </div>;
}
