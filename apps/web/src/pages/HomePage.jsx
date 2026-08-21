import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBox } from '../components/UI.jsx';
import { useLoad } from '../hooks.js';
import { useWallet } from '../wallet.jsx';

const rotatingHeadlines = [
  ['Welcome to Broadridge', 'Proxy Voting'],
  ['Secure shareholder decisions', 'Verified on-chain'],
];

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

function InfoIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="7.25" />
    <path d="M10 8.6v4.25M10 6.15h.01" />
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
  const [headlineIndex, setHeadlineIndex] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;

    const timer = window.setInterval(() => {
      setHeadlineIndex((current) => (current + 1) % rotatingHeadlines.length);
    }, 4800);
    return () => window.clearInterval(timer);
  }, []);

  const votingEvents = useLoad(
    () => (wallet.account
      ? api(`/v1/dashboard/voting?wallet=${encodeURIComponent(wallet.account)}`, { auth: false })
      : Promise.resolve([])),
    [wallet.account],
  );
  const organisedEvents = useLoad(
    () => (wallet.account
      ? api(`/v1/dashboard/organiser?wallet=${encodeURIComponent(wallet.account)}`, { auth: false })
      : Promise.resolve([])),
    [wallet.account],
  );

  const votingCount = votingEvents.loading ? '—' : (votingEvents.data?.length ?? 0);
  const organisedCount = organisedEvents.loading ? '—' : (organisedEvents.data?.length ?? 0);
  const [headlineTop, headlineBottom] = rotatingHeadlines[headlineIndex];

  return <main className="home-page pv-home-page">
    <section className="home-hero" aria-labelledby="home-hero-heading">
      <div className="home-hero-inner">
        <div className="home-heading-stage" aria-live="polite" aria-atomic="true">
          <h1 id="home-hero-heading" className="home-rotating-heading" key={headlineIndex}>
            <span>{headlineTop}</span>
            <span>{headlineBottom}</span>
          </h1>
        </div>

        <div className="home-carousel-indicators" aria-label="Headline slide">
          {rotatingHeadlines.map((_headline, index) => <button
            key={index}
            type="button"
            className={index === headlineIndex ? 'active' : ''}
            onClick={() => setHeadlineIndex(index)}
            aria-label={`Show headline ${index + 1}`}
            aria-current={index === headlineIndex ? 'true' : undefined}
          />)}
        </div>

        <a className="home-proxy-info" href="https://www.shareholdereducation.com">
          <span>What is a proxy vote?</span>
          <InfoIcon />
        </a>
      </div>
    </section>

    <section className="home-overview" aria-label="Proxy voting overview">
      <ErrorBox error={votingEvents.error || organisedEvents.error} />
      <div className="home-metrics">
        <MetricCard
          primary
          icon={<VotingEventsIcon />}
          title="Ongoing voting events"
          count={votingCount}
          action="View voting dashboard"
          to="/voting"
        />
        <MetricCard
          icon={<OrganisedEventsIcon />}
          title="Voting events organized by you"
          count={organisedCount}
          action="View your events"
          to="/organiser"
        />
      </div>
    </section>
  </main>;
}
