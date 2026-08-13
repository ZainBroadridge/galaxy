import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Page, Spinner } from '../components/UI.jsx';
import { useLoad } from '../hooks.js';
import { useWallet } from '../wallet.jsx';

function CheckIcon() {
  return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9.5 7 13l8-8" /></svg>;
}

function GridIcon() {
  return <svg viewBox="0 0 18 18" aria-hidden="true"><rect x="2.5" y="2.5" width="5" height="5" rx=".5" /><rect x="10.5" y="2.5" width="5" height="5" rx=".5" /><rect x="2.5" y="10.5" width="5" height="5" rx=".5" /><rect x="10.5" y="10.5" width="5" height="5" rx=".5" /></svg>;
}

export default function HomePage() {
  const { account, authenticated } = useWallet();
  const voting = useLoad(() => (account
    ? api(`/v1/dashboard/voting?wallet=${encodeURIComponent(account)}`, { auth: false })
    : Promise.resolve([])), [account]);
  const organised = useLoad(() => (authenticated
    ? api('/v1/dashboard/organiser')
    : Promise.resolve([])), [authenticated, account]);

  return <Page className="home-page">
    <div className="home-heading"><h1>On-Chain Proxy Voting</h1></div>
    <div className="home-actions page-actions">
      <Link className="button secondary" to="/organiser">Organizer Dashboard</Link>
      <Link className="button secondary" to="/results">Results</Link>
      <Link className="button" to="/">Voting Dashboard</Link>
    </div>
    {(voting.loading || organised.loading) ? <Spinner /> : <div className="home-summary-grid">
      <section className="home-summary-card home-summary-card-primary">
        <CheckIcon />
        <span className="home-summary-label">Ongoing voting events</span>
        <strong>{voting.data?.length ?? 0}</strong>
        <Link to="/voting">View voting dashboard</Link>
      </section>
      <section className="home-summary-card home-summary-card-secondary">
        <GridIcon />
        <span className="home-summary-label">Voting events organized by you</span>
        <strong>{organised.data?.length ?? 0}</strong>
        <Link to="/organiser">View your events</Link>
      </section>
    </div>}
  </Page>;
}
