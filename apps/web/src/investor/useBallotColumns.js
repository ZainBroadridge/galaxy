import { useLayoutEffect, useRef } from 'react';

/** Give every option the same width, including after the actual font loads. */
export function useBallotColumns(proposals) {
  const tableRef = useRef(null);
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return undefined;
    let active = true;
    const labels = [...table.querySelectorAll('.investor-option-label')];
    const measure = () => {
      if (!active) return;
      const width = Math.ceil(Math.max(144, ...labels.map((label) => {
        const cell = window.getComputedStyle(label.parentElement);
        return label.getBoundingClientRect().width
          + (parseFloat(cell.paddingLeft) || 0) + (parseFloat(cell.paddingRight) || 0);
      })));
      table.style.setProperty('--ballot-option-width', `${width}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    labels.forEach((label) => observer?.observe(label));
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [proposals]);
  return tableRef;
}
