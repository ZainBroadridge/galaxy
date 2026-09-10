import { Link } from 'react-router-dom';

/** Explicit destinations remain usable after a refresh or a fresh-tab visit. */
export default function BackLink({ to, onClick, children = 'Back', className = '' }) {
  const props = { className: `portal-back ${className}`.trim(), 'aria-label': children, title: children };
  const content = <><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h13" /></svg><span>Back</span></>;
  return onClick ? <button {...props} type="button" onClick={onClick}>{content}</button>
    : <Link {...props} to={to}>{content}</Link>;
}
