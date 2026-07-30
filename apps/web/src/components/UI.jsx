import { Link } from 'react-router-dom';

export function Page({ title, intro, actions, children }) {
  return <main className="page">
    <header className="page-head"><div><h1>{title}</h1>{intro && <p>{intro}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>
    {children}
  </main>;
}

export function Panel({ title, children, className = '' }) {
  return <section className={`panel ${className}`}>{title && <h2>{title}</h2>}{children}</section>;
}

export function Notice({ children, tone = 'info' }) {
  return <div className={`notice ${tone}`}>{children}</div>;
}

export function Spinner({ label = 'Loading' }) { return <div className="spinner">{label}…</div>; }
export function ErrorBox({ error }) { return error ? <Notice tone="error">{error.message}</Notice> : null; }

export function Status({ value }) {
  const label = String(value || 'UNKNOWN').replaceAll('_', ' ');
  return <span className={`status status-${String(value || '').toLowerCase()}`}>{label}</span>;
}

export function EventCard({ event, to, action = 'Open' }) {
  return <article className="event-card">
    <div className="event-card-top"><Status value={event.status} /><span>{event.tokenSymbol}</span></div>
    <h3>{event.title}</h3>
    <p>{event.description || 'Proxy voting event'}</p>
    <dl>
      <div><dt>Record date</dt><dd>{new Date(event.recordDateAt).toLocaleString()}</dd></div>
      <div><dt>Voting closes</dt><dd>{new Date(event.votingEndAt).toLocaleString()}</dd></div>
      {event.eligibility?.votingPower && <div><dt>Your voting power</dt><dd>{event.eligibility.votingPower}</dd></div>}
    </dl>
    <Link className="button secondary" to={to}>{action}</Link>
  </article>;
}

export function Empty({ children }) { return <div className="empty">{children}</div>; }
export function ShortAddress({ value }) { return value ? <code>{`${value.slice(0, 8)}…${value.slice(-6)}`}</code> : '—'; }
