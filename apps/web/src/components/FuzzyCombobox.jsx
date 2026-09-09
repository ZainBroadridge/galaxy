import { useEffect, useId, useRef, useState } from 'react';
import RequiredMark from './RequiredMark.jsx';

/** Accessible free-text combobox shared by issuer and tokenization-platform fields. */
export default function FuzzyCombobox({ label, value, onChange, onBlur, options,
  disabled = false, required = false, maxLength = 160, placeholder = '' }) {
  const id = useId();
  const list = useRef(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const expanded = open && !disabled && options.length > 0;
  useEffect(() => {
    if (expanded && active >= 0) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, expanded]);
  function select(option) {
    onChange(option.label);
    setOpen(false); setActive(-1);
  }
  function keyDown(event) {
    if (event.key === 'Escape') { setOpen(false); setActive(-1); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (['Home', 'End'].includes(event.key) && !expanded) return;
      event.preventDefault(); setOpen(true);
      if (!options.length) return;
      setActive((current) => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : event.key === 'ArrowDown' ? (current + 1) % options.length
          : current <= 0 ? options.length - 1 : current - 1);
    } else if (event.key === 'Enter' && expanded && options[active]) {
      event.preventDefault(); select(options[active]);
    }
  }
  return <div className="issuer-autocomplete">
    <label htmlFor={id}>{label}{required && <RequiredMark />}</label>
    <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
      aria-controls={expanded ? `${id}-options` : undefined}
      aria-activedescendant={expanded && options[active] ? `${id}-option-${active}` : undefined}
      value={value} required={required} maxLength={maxLength} disabled={disabled} autoComplete="off"
      placeholder={placeholder} onFocus={() => setOpen(true)} onKeyDown={keyDown}
      onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
      onBlur={() => { setOpen(false); setActive(-1); onBlur?.(); }} />
    {expanded && <ul ref={list} id={`${id}-options`} role="listbox" aria-label={`${label} suggestions`} className="issuer-suggestions">
      {options.map((option, index) => <li key={option.id} id={`${id}-option-${index}`} role="option"
        aria-selected={active === index} onMouseEnter={() => setActive(index)}
        onMouseDown={(event) => event.preventDefault()} onClick={() => select(option)}>
        <span>{option.label}</span>{option.detail && <small>{option.detail}</small>}
      </li>)}
    </ul>}
  </div>;
}
