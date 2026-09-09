import { Link, NavLink } from 'react-router-dom';
import { eventIssuerBranding } from '@pv/shared';
import { useInvestorSession } from './InvestorSession.jsx';
import { useNotifications } from '../notifications.jsx';
import IssuerLogo from '../components/IssuerLogo.jsx';
import { displayDate } from './meeting-utils.js';

export const EDUCATION_URL = 'https://www.shareholdereducation.com/';
export const TOKENHOLDER_DISCLOSURE = 'The voting capabilities of tokenholders referenced herein are rights to express preferences to the token minter regarding voting of the shares that the issuer beneficially owns.';

export function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>;
}
export function PrintIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8V3h12v5M6 17H3V9h18v8h-3M6 14h12v7H6zM17 11h1" /></svg>;
}
export function WalletIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6" /><path d="M16 14h6v3h-6z" /></svg>;
}
export function DocumentIcon() {
  return <svg viewBox="0 0 32 40" aria-hidden="true"><path d="M5 2h15l9 9v25a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm15 0v10h9M9 19h14M9 25h14M9 31h10" /></svg>;
}
export function ErrorMessage({ error }) {
  return error ? <p className="investor-error" role="alert">{error.message || String(error)}</p> : null;
}
export function InvestorFooter() {
  return <footer className="investor-footer">
    <div><p>&copy; 2026 Broadridge Financial Solutions, Inc. ProxyVote and Broadridge are registered trademarks of Broadridge Financial Solutions, Inc.</p>
      <p>Testnet prototype. All other trademarks belong to their respective owners.</p></div>
    <nav aria-label="Legal information">
      <a href="https://www.broadridge.com/legal/accessibility" target="_blank" rel="noopener noreferrer">Accessibility Statement</a>
      <a href="https://www.broadridge.com/legal/privacy-statement-english" target="_blank" rel="noopener noreferrer">Privacy Statement</a>
      <a href="https://www.broadridge.com/legal/terms-of-use" target="_blank" rel="noopener noreferrer">Terms of Use &amp; Linking Policy</a>
    </nav>
  </footer>;
}
export function BrandBand({ event, inverse = false }) {
  return <div className={`investor-brand-band${inverse ? ' inverse' : ''}`}>
    <div className="investor-brand-lockup">
      {event ? <IssuerLogo event={event} className="investor-brand-issuer-logo" showNameFallback />
        : inverse ? <span className="investor-stacked-wordmark" role="img" aria-label="ProxyVote"><span aria-hidden="true">Proxy</span><span aria-hidden="true">Vote</span></span>
          : <img className="investor-proxyvote-logo" src="/proxyvote-logo.png" alt="ProxyVote" />}
      <span className="investor-brand-divider" aria-hidden="true" />
      <span className="investor-powered"><small>POWERED BY</small><img
        src={inverse ? '/investor/broadridge-white.png' : '/investor/broadridge.png'} alt="Broadridge" /></span>
    </div>
  </div>;
}

export function InvestorFrame({ children, event, hideNavigation = false }) {
  const { session, signOut } = useInvestorSession();
  const { unreadCount } = useNotifications();
  const wallet = session?.walletAddress;
  const brand = event ? eventIssuerBranding(event) : null;
  return <div className={`investor-app${brand ? ' investor-issuer-theme' : ''}`} style={brand ? {
    '--issuer-color': brand.issuerThemeColor, '--issuer-ink': brand.issuerInkColor,
    '--inv-blue': brand.issuerInkColor, '--inv-navy': brand.issuerInkColor, '--inv-orange': brand.issuerInkColor,
  } : undefined}>
    <a href="#investor-main" className="investor-skip">Skip to content</a>
    {wallet && <div className="investor-utility"><span title={wallet}>Wallet Address:&nbsp; {wallet.slice(0, 6)}...{wallet.slice(-4)}</span>
      <button type="button" onClick={() => void signOut()}>Sign out</button></div>}
    <BrandBand event={event} />
    {!hideNavigation && <nav className="investor-navigation" aria-label="Investor navigation">
      <NavLink to="/meetings">My Meetings</NavLink>
      <NavLink to="/education">Investor Education</NavLink>
      {session && <NavLink to="/notifications">Notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}</NavLink>}
      {!session && <Link to="/">Sign in</Link>}
    </nav>}
    <main id="investor-main" className="investor-main">{children}</main>
    <InvestorFooter />
  </div>;
}
export function SecurityIdentity({ event }) {
  const brand = eventIssuerBranding(event);
  return <>
    <p className="investor-security-name">{brand.securityName || brand.issuerName}
      {brand.securityTicker ? ` (${brand.securityTicker})` : ''}</p>
    <p className="investor-token-name">{event.tokenName}{event.tokenSymbol ? ` (${event.tokenSymbol})` : ''}</p>
  </>;
}
export function MeetingIdentity({ event }) {
  return <header className="investor-meeting-identity">
    <IssuerLogo event={event} className="investor-issuer-logo" />
    <div><h1>{event.title}</h1><SecurityIdentity event={event} />
      {event.platform && <span className="investor-tag">{event.platform}</span>}
      <p className="investor-muted">Voting deadline: {displayDate(event.votingEndAt)}</p></div>
  </header>;
}
export function StandingDisclosure() {
  return <p id="tokenholder-voting-disclosure" className="investor-disclosure">{TOKENHOLDER_DISCLOSURE}</p>;
}
