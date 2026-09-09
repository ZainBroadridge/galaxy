export function ProxyVoteMark({ stacked = false }) {
  return stacked
    ? <img className="proxyvote-artwork" src="/proxyvote-logo.png" alt="ProxyVote" />
    : <span className="proxyvote-wordmark" role="img" aria-label="ProxyVote"><span aria-hidden="true">Proxy</span><span aria-hidden="true">Vote</span></span>;
}

export default function BrandLockup({ children, inverse = false, className = '' }) {
  return <div className={`brand-lockup${inverse ? ' inverse' : ''} ${className}`}>
    {children ?? <ProxyVoteMark />}
    <span className="brand-lockup-divider" aria-hidden="true" />
    <span className="brand-lockup-credit"><small>POWERED BY</small>
      <img src={inverse ? '/investor/broadridge-white.png' : '/investor/broadridge.png'} alt="Broadridge" />
    </span>
  </div>;
}
