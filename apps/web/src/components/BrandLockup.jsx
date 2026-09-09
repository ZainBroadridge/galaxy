export function ProxyVoteMark() {
  return <img className="proxyvote-artwork" src="/proxyvote-mark.svg" alt="ProxyVote" width="158" height="58" />;
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
