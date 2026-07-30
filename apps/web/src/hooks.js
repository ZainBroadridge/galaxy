import { useCallback, useEffect, useRef, useState } from 'react';

export function useLoad(loader, dependencies = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const request = useRef(0);

  const load = useCallback(async (silent = false) => {
    const id = ++request.current;
    if (!silent) setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await loader();
      if (id === request.current) setState({ loading: false, data, error: null });
      return data;
    } catch (error) {
      if (id === request.current) {
        setState((current) => ({ loading: false, data: silent ? current.data : null, error }));
      }
      throw error;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    load(false).catch(() => {});
    return () => { request.current += 1; };
  }, [load]);

  return {
    ...state,
    reload: () => load(false),
    refresh: () => load(true),
    setData: (data) => setState({ loading: false, data, error: null }),
  };
}

export function useEventPolling(refresh, active, interval = 5000) {
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let timer;

    const tick = async () => {
      try { await refresh(); } catch {}
      if (!cancelled) timer = setTimeout(tick, interval);
    };
    timer = setTimeout(tick, interval);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, interval, refresh]);
}
