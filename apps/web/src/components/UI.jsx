import { Link } from 'react-router-dom';

const statusLabels = new Map([
  ['CLOSED', 'Ended'],
  ['OPEN', 'Open'],
  ['SCHEDULED', 'Scheduled'],
  ['SNAPSHOT_PENDING', 'Preparing'],
  ['SNAPSHOT_RUNNING', 'Preparing'],
  ['SNAPSHOT_READY', 'Ready'],
  ['DEPLOYING', 'Deploying'],
]);

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function proposalCount(event) {
  return event.proposalCount
    ?? event.proposals?.length
    ?? event.metadata?.proposals?.length
    ?? '—';
}

export function Page({ title, intro, actions, children, className = '' }) {
  return <main className={`page ${className}`.trim()}>
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {intro && <p>{intro}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
    {children}
  </main>;
}

export function Panel({ title, children, className = '' }) {
  return <section className={`panel ${className}`.trim()}>
    {title && <header className="panel-heading"><h2>{title}</h2></header>}
    {children}
  </section>;
}

export function Notice({ children, tone = 'info', className = '' }) {
  return <div className={`notice ${tone} ${className}`.trim()} role={tone === 'error' ? 'alert' : undefined}>{children}</div>;
}

export function Spinner({ label = 'Loading' }) {
  return <div className="spinner" role="status"><span aria-hidden="true" />{label}</div>;
}

export function ErrorBox({ error }) {
  return error ? <Notice tone="error">{error.message}</Notice> : null;
}

export function Status({ value, label }) {
  const raw = String(value || 'UNKNOWN');
  const text = label ?? statusLabels.get(raw) ?? raw.replaceAll('_', ' ');
  return <span className={`status status-${raw.toLowerCase()}`}>{text}</span>;
}

export function EventCard({ event, to, action = 'Open', variant = 'default', titleTo = to }) {
  const ended = event.status === 'CLOSED';
  return <article className={`event-card event-card-${variant}`}>
    <header className="event-card-heading">
      <h3><Link to={titleTo}>{event.title}</Link></h3>
      <Status value={event.status} label={ended ? 'Ended' : undefined} />
    </header>

    <div className="event-card-facts">
      <div><span>Voting opens</span><strong>{formatDate(event.votingStartAt)}</strong></div>
      <div><span>Voting closes</span><strong>{formatDate(event.votingEndAt)}</strong></div>
      <div><span>Record date</span><strong>{formatDate(event.recordDateAt)}</strong></div>
      <div><span>Proposals</span><strong>{proposalCount(event)}</strong></div>
    </div>

    <div className="event-card-token">
      <span>Token</span>
      <code>{event.tokenSymbol || 'Token'} · {event.tokenAddress ? `${event.tokenAddress.slice(0, 8)}…${event.tokenAddress.slice(-4)}` : '—'}</code>
    </div>

    {variant === 'organiser' && ended && <div className="event-card-note">
      This event has ended. Results remain available for review.
    </div>}

    {event.eligibility?.votingPower && <div className="event-card-power">
      <span>Your voting power</span><strong>{event.eligibility.votingPower}</strong>
    </div>}

    <footer className="event-card-footer">
      <Link className="button secondary compact" to={to}>{action}</Link>
    </footer>
  </article>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function ShortAddress({ value }) {
  return value ? <code>{`${value.slice(0, 8)}…${value.slice(-6)}`}</code> : '—';
}
