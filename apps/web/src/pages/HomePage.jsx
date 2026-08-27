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

const insights = [
  {
    type: 'Article',
    title: 'A new way to participate in Vanguard Investor',
    href: 'https://www.broadridge.com/insights/a-new-way-to-participate-in-vanguard-investor-choice',
    image: '/insights/vanguard-investor.jpg',
    imageAlt: 'Professionals collaborating in a modern office',
    tone: 'deep',
    newTab: false,
  },
  {
    type: 'Webinar',
    title: 'Why investment stewards can\u2019t afford to ignore data quality',
    href: 'https://event.webcasts.com/starthere.jsp?ei=1755201&tp_key=e3616cd4d2',
    image: '/insights/data-quality-webinar.jpg',
    imageAlt: 'Blue glass office building',
    tone: 'deep',
    newTab: true,
  },
  {
    type: 'Webinar',
    title: 'Next-gen stewardship for asset managers: AI and proxy voting, greater efficiency, better outcomes',
    href: 'https://event.on24.com/wcc/r/5268290/08EEB0E7E050D386C27410A7E28840A6',
    image: '/insights/next-gen-stewardship.jpg',
    imageAlt: 'Business meeting in a glass conference room',
    tone: 'bright',
    newTab: true,
  },
  {
    type: 'Article',
    title: 'Data accuracy: The cornerstone of investment stewardship',
    href: 'https://www.broadridge.com/insights/data-accuracy-the-cornerstone-of-investment-stewardship',
    image: '/insights/data-accuracy.jpg',
    imageAlt: 'Professional working on a laptop',
    tone: 'bright',
    newTab: false,
  },
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

function InsightArrowIcon() {
  return <svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M5 16h20M18 8l8 8-8 8" />
  </svg>;
}

function InsightCard({ insight }) {
  const navigation = insight.newTab
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : {};

  return <a
    className={`home-insight-card home-insight-${insight.tone}`}
    href={insight.href}
    {...navigation}
  >
    <div className="home-insight-media">
      <img
        className="home-insight-image"
        src={insight.image}
        alt={insight.imageAlt}
        loading="lazy"
        decoding="async"
      />
    </div>
    <div className="home-insight-body">
      <span className="home-insight-type">{insight.type}</span>
      <h3 className="home-insight-title">{insight.title}</h3>
      <span className="home-insight-arrow" aria-hidden="true"><InsightArrowIcon /></span>
    </div>
  </a>;
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

    <section className="home-insights" aria-labelledby="home-insights-heading">
      <h2 id="home-insights-heading" className="home-insights-heading">
        Insights &amp; perspectives
      </h2>
      <div className="home-insights-grid">
        {insights.map((insight) => <InsightCard key={insight.href} insight={insight} />)}
      </div>
    </section>
  </main>;
}
