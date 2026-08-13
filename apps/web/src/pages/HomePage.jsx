import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBox } from '../components/UI.jsx';
import { useLoad } from '../hooks.js';
import { useWallet } from '../wallet.jsx';

function WalletIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4.5 6.5h12.75A2.25 2.25 0 0 1 19.5 8.75V10h.75A1.75 1.75 0 0 1 22 11.75v4.5A1.75 1.75 0 0 1 20.25 18h-.75v.75A2.25 2.25 0 0 1 17.25 21H4.5A2.5 2.5 0 0 1 2 18.5V9a2.5 2.5 0 0 1 2.5-2.5Zm0 1.75A.75.75 0 0 0 3.75 9v9.5c0 .41.34.75.75.75h12.75c.28 0 .5-.22.5-.5V18h-3.5a4 4 0 1 1 0-8h3.5V8.75a.5.5 0 0 0-.5-.5H4.5Zm9.75 3.5a2.25 2.25 0 1 0 0 4.5h6v-4.5h-6Zm.25 1.35a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Z" />
  </svg>;
}

function VotingEventsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6.75 5.5h10.5v12H6.75zM4.5 17.5h15M9.25 12l1.75 1.75L15.25 9.5" />
  </svg>;
}

function OrganisedEventsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="4" width="6" height="6" rx=".6" />
    <rect x="14" y="4" width="6" height="6" rx=".6" />
    <rect x="4" y="14" width="6" height="6" rx=".6" />
    <rect x="14" y="14" width="6" height="6" rx=".6" />
  </svg>;
}

function MetricCard({ icon, title, count, action, to, primary = false }) {
  return <article className={`home-metric-card${primary ? ' home-metric-primary' : ''}`}>
    <span className="home-metric-icon">{icon}</span>
    <h2>{title}</h2>
    <strong className="home-metric-count">{count}</strong>
    <Link className="home-metric-link" to={to}>{action}</Link>
  </article>;
}

export default function HomePage() {
  const wallet = useWallet();
  const votingEvents = useLoad(
    () => (wallet.account
      ? api(`/v1/dashboard/voting?wallet=${encodeURIComponent(wallet.account)}`, { auth: false })
      : Promise.resolve([])),
    [wallet.account],
  );
  const organisedEvents = useLoad(
    () => (wallet.authenticated
      ? api('/v1/dashboard/organiser')
      : Promise.resolve([])),
    [wallet.account, wallet.authenticated],
  );

  const votingCount = votingEvents.loading ? '—' : (votingEvents.data?.length ?? 0);
  const organisedCount = organisedEvents.loading ? '—' : (organisedEvents.data?.length ?? 0);

  return <main className="home-page">
    <h1>On-Chain Proxy Voting</h1>

    {!wallet.connected ? <section className="home-connect-card">
      <span className="home-connect-icon"><WalletIcon /></span>
      <h2>Connect your wallet to continue</h2>
      <p>Connect your wallet to create and manage proxy voting events.</p>
      <button className="button home-connect-button" type="button" onClick={wallet.openWallet}>
        <WalletIcon />
        Connect Wallet
      </button>
    </section> : <>
      <nav className="home-quick-actions" aria-label="Portal shortcuts">
        <Link className="button secondary home-action-button" to="/organiser">Organizer Dashboard</Link>
        <Link className="button secondary home-action-button" to="/results">Results</Link>
        <Link className="button home-action-button" to="/voting">Voting Dashboard</Link>
      </nav>

      <ErrorBox error={votingEvents.error || organisedEvents.error} />

      <section className="home-metrics" aria-label="Proxy voting overview">
        <MetricCard
          icon={<VotingEventsIcon />}
          title="Ongoing voting events"
          count={votingCount}
          action="View voting dashboard"
          to="/voting"
          primary
        />
        <MetricCard
          icon={<OrganisedEventsIcon />}
          title="Voting events organized by you"
          count={organisedCount}
          action="View your events"
          to="/organiser"
        />
      </section>
    </>}
  </main>;
}
