export function ProxyVoteMark({ inverse = false }) {
  return <img className="proxyvote-artwork"
    src={inverse ? '/proxyvote-brand-white.png' : '/proxyvote-brand-blue.png'}
    width="158" height="58" alt="ProxyVote" />;
}

export default function BrandLockup({ children, inverse = false, className = '' }) {
  return <div className={`brand-lockup${inverse ? ' inverse' : ''} ${className}`}>
    {children ?? <ProxyVoteMark inverse={inverse} />}
    <span className="brand-lockup-divider" aria-hidden="true" />
    <span className="brand-lockup-credit"><small>POWERED BY</small>
      <img src={inverse ? '/investor/broadridge-white.png' : '/investor/broadridge.png'} alt="Broadridge" />
    </span>
  </div>;
}
