import { Link } from 'react-router-dom';

/** Explicit in-app destinations work for fresh tabs as well as normal navigation. */
export default function BackLink({ to, children = 'Back' }) {
  return <Link className="portal-back" to={to}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h13" /></svg>
    <span>{children}</span>
  </Link>;
}
