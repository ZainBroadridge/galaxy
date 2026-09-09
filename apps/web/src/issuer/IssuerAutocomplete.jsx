import { useId, useState } from 'react';
import { ISSUER_PRESETS } from '@pv/shared';
import RequiredMark from '../components/RequiredMark.jsx';
import { searchIssuers } from './issuer-search.js';

export default function IssuerAutocomplete({ value, onChange, onBlur, disabled }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const options = searchIssuers(ISSUER_PRESETS, value);
  const expanded = open && !disabled && options.length > 0;
  function select(issuer) {
    onChange(issuer.name);
    setOpen(false); setActive(-1);
  }
  function keyDown(event) {
    if (event.key === 'Escape') { setOpen(false); setActive(-1); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setOpen(true);
      if (!options.length) return;
      setActive((current) => event.key === 'ArrowDown'
        ? (current + 1) % options.length : (current <= 0 ? options.length - 1 : current - 1));
    } else if (event.key === 'Enter' && expanded && active >= 0 && options[active]) {
      event.preventDefault(); select(options[active]);
    }
  }
  return <div className="issuer-autocomplete">
    <label htmlFor={id}>Official issuer name<RequiredMark /></label>
    <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
      aria-controls={`${id}-options`} aria-activedescendant={expanded && options[active] ? `${id}-${options[active].id}` : undefined}
      value={value} required maxLength={160} disabled={disabled} autoComplete="off"
      placeholder="Search an issuer or enter another official name"
      onFocus={() => setOpen(true)} onKeyDown={keyDown}
      onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
      onBlur={() => { setOpen(false); setActive(-1); onBlur?.(); }} />
    {expanded && <ul id={`${id}-options`} role="listbox" aria-label="Matching issuers" className="issuer-suggestions">
      {options.map((issuer, index) => <li key={issuer.id} id={`${id}-${issuer.id}`} role="option"
        aria-selected={active === index} onMouseEnter={() => setActive(index)}
        onMouseDown={(event) => event.preventDefault()} onClick={() => select(issuer)}>
        <span>{issuer.name}</span><small>{issuer.securities.map((security) => security.ticker).join(' / ')}</small>
      </li>)}
    </ul>}
  </div>;
}
