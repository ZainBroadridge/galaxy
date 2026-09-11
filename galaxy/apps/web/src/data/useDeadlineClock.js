import { useEffect, useState } from 'react';

/** Refresh time at lifecycle boundaries and when a sleeping/background tab returns. */
export function useDeadlineClock(startAt, endAt) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer;
    const update = () => {
      window.clearTimeout(timer);
      const time = Date.now();
      setNow(time);
      const next = [Date.parse(startAt), Date.parse(endAt) + 1].filter((value) => value > time).sort((a, b) => a - b)[0];
      if (next !== undefined) timer = window.setTimeout(update, Math.min(2_147_483_647, next - time + 20));
    };
    const visible = () => { if (document.visibilityState === 'visible') update(); };
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [startAt, endAt]);
  return now;
}
