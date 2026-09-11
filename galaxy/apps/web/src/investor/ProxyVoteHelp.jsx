import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EDUCATION_URL } from './InvestorFrame.jsx';
import { helpPlacement } from './help-position.js';

export default function ProxyVoteHelp() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const trigger = useRef(null);
  const icon = useRef(null);
  const popup = useRef(null);
  useLayoutEffect(() => {
    if (!open) return undefined;
    function place() {
      if (!icon.current || !popup.current) return;
      setPosition(helpPlacement(icon.current.getBoundingClientRect(), popup.current.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight }));
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    observer?.observe(popup.current);
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    function outside(event) {
      if (!popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    }
    function key(event) { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', key); };
  }, [open]);
  return <div className="investor-proxy-help">
    <button ref={trigger} type="button" className="investor-proxy-help-trigger" aria-expanded={open}
      aria-controls="proxy-vote-explainer" aria-haspopup="dialog" onClick={() => { setPosition(null); setOpen((value) => !value); }}>
      What is a proxy vote?<span ref={icon}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.08 4h.01" /></svg></span>
    </button>
    {open && <div ref={popup} className="investor-proxy-help-positioner" data-side={position?.side || 'top'} style={position ? {
        left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight,
        '--help-arrow-left': `${position.arrowLeft}px`,
      } : { visibility: 'hidden' }}>
      <section id="proxy-vote-explainer" role="dialog" aria-labelledby="proxy-vote-explainer-title" className="investor-proxy-help-popup" style={position ? { maxHeight: position.maxHeight } : undefined}>
      <h2 id="proxy-vote-explainer-title">What is a proxy vote?</h2>
      <p>Public companies and mutual funds hold shareholder meetings where key issues on business strategy or how the organization is governed are discussed. Shareholder meeting attendees are asked to vote on issues that impact the future direction of the company or fund. And while many shareholders do not attend these meetings, they are still able to have their voice heard by voting by proxy.</p>
      <p>Go to <a href={EDUCATION_URL} target="_blank" rel="noopener noreferrer">www.shareholdereducation.com</a> to learn more.</p>
      </section><svg className="investor-proxy-help-arrow" viewBox="0 0 22 11" aria-hidden="true"><path d="M0 0 L11 11 L22 0 Z" /></svg>
    </div>}
  </div>;
}
