/** Shared appearance; the caller retains its existing session-revocation flow. */
export default function ExitButton({ onClick, label = 'Sign out', disabled = false }) {
  return <button className="portal-exit-button" type="button" onClick={onClick} disabled={disabled}
    aria-label={label} title={label}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M14 8l4 4-4 4M8 12h11" /></svg>
  </button>;
}
