import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from './api.js';

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

  const reload = useCallback(() => load(false), [load]);
  const refresh = useCallback(() => load(true), [load]);
  const setData = useCallback((data) => {
    setState({ loading: false, data, error: null });
  }, []);

  return {
    ...state,
    reload,
    refresh,
    setData,
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

const MAX_BROWSER_TIMER_MS = 24 * 60 * 60 * 1000;

export function useEventLiveRefresh(
  refresh,
  eventId,
  active,
  fallbackInterval = 2_000,
  startsAt = null,
) {
  useEffect(() => {
    if (!eventId) return undefined;

    if (!active) {
      const startTime = Date.parse(startsAt ?? '');
      if (!Number.isFinite(startTime) || startTime <= Date.now()) return undefined;

      let cancelled = false;
      let timer;
      const schedule = () => {
        if (cancelled) return;
        const remaining = startTime - Date.now() + 1_000;
        if (remaining <= 0) {
          refresh().catch(() => {
            if (!cancelled) timer = setTimeout(schedule, fallbackInterval);
          });
          return;
        }
        timer = setTimeout(schedule, Math.min(remaining, MAX_BROWSER_TIMER_MS));
      };
      schedule();

      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }

    let closed = false;
    let refreshing = false;
    let fallbackTimer;
    let source;

    const refreshOnce = async () => {
      if (refreshing || closed) return;
      refreshing = true;
      try { await refresh(); } catch {}
      finally { refreshing = false; }
    };

    const scheduleFallback = () => {
      if (closed) return;
      fallbackTimer = setTimeout(async () => {
        await refreshOnce();
        scheduleFallback();
      }, fallbackInterval);
    };

    // Do not wait for the first SSE message or fallback interval before reading
    // the latest durable job progress from the API.
    void refreshOnce();
    scheduleFallback();

    try {
      source = new EventSource(`${API_BASE_URL}/v1/events/${encodeURIComponent(eventId)}/stream`);
      source.addEventListener('open', refreshOnce);
      source.addEventListener('event-progress', refreshOnce);
    } catch {
      // Polling remains active when EventSource is unavailable or blocked.
    }

    return () => {
      closed = true;
      clearTimeout(fallbackTimer);
      source?.close();
    };
  }, [active, eventId, fallbackInterval, refresh, startsAt]);
}
