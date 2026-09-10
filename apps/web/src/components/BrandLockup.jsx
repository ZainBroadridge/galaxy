export function ProxyVoteMark({ inverse = false, variant = 'default' }) {
  const src = inverse ? '/proxyvote-landing-mark.svg'
    : variant === 'investor' ? '/proxyvote-voter-mark.svg' : '/proxyvote-mark.svg';
  return <img className="proxyvote-artwork" src={src} alt="ProxyVote" width="158" height="58" />;
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
