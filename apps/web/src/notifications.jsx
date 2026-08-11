import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { API_BASE_URL } from './api.js';
import { fetchCommunications } from './communications.js';
import { useWallet } from './wallet.jsx';

const NotificationsContext = createContext(null);
const fallbackRefreshMs = 60_000;
const maxStoredReadIds = 500;
const readStoragePrefix = 'pv-v2-read-communications:';

function readStorageKey(account) {
  return `${readStoragePrefix}${account}`;
}

function loadReadIds(account) {
  if (!account) return new Set();
  try {
    const values = JSON.parse(localStorage.getItem(readStorageKey(account)) || '[]');
    return new Set(Array.isArray(values) ? values.filter((value) => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveReadIds(account, values) {
  if (!account) return;
  try {
    const ids = [...values].slice(-maxStoredReadIds);
    localStorage.setItem(readStorageKey(account), JSON.stringify(ids));
  } catch {
    // Read state is a local convenience; notification delivery must not fail if storage is unavailable.
  }
}

export function NotificationsProvider({ children }) {
  const wallet = useWallet();
  const [messages, setMessages] = useState([]);
  const [readIds, setReadIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [live, setLive] = useState(false);
  const activeAccount = useRef(wallet.account);
  const inFlight = useRef(null);

  useEffect(() => {
    activeAccount.current = wallet.account;
    inFlight.current = null;
    setMessages([]);
    setReadIds(loadReadIds(wallet.account));
    setLoading(Boolean(wallet.connected));
    setError(null);
    setLastUpdatedAt(null);
    setLive(false);
  }, [wallet.account, wallet.connected]);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    const account = wallet.account;
    if (!wallet.connected || !account) return [];
    if (inFlight.current?.account === account) return inFlight.current.promise;

    if (!silent) setLoading(true);
    const request = fetchCommunications(account)
      .then((nextMessages) => {
        if (activeAccount.current === account) {
          setMessages(nextMessages);
          setError(null);
          setLastUpdatedAt(new Date().toISOString());
        }
        return nextMessages;
      })
      .catch((value) => {
        if (activeAccount.current === account) setError(value);
        throw value;
      })
      .finally(() => {
        if (activeAccount.current === account) setLoading(false);
        if (inFlight.current?.promise === request) inFlight.current = null;
      });

    inFlight.current = { account, promise: request };
    return request;
  }, [wallet.account, wallet.connected]);

  useEffect(() => {
    if (!wallet.connected || !wallet.account) return undefined;

    let cancelled = false;
    let fallbackTimer;
    const refreshSilently = () => refresh({ silent: true }).catch(() => {});
    const scheduleFallback = () => {
      fallbackTimer = setTimeout(() => {
        if (document.visibilityState === 'visible') refreshSilently();
        if (!cancelled) scheduleFallback();
      }, fallbackRefreshMs);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshSilently();
    };

    refresh({ silent: false }).catch(() => {});
    scheduleFallback();
    document.addEventListener('visibilitychange', handleVisibility);

    const stream = new EventSource(`${API_BASE_URL}/v1/communications/stream`);
    stream.addEventListener('open', () => {
      if (!cancelled) setLive(true);
    });
    stream.addEventListener('refresh', refreshSilently);
    stream.addEventListener('error', () => {
      if (!cancelled) setLive(false);
    });

    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      stream.close();
    };
  }, [refresh, wallet.account, wallet.connected]);

  const markAllRead = useCallback(() => {
    if (!wallet.account || !messages.length) return;
    setReadIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const message of messages) {
        if (next.has(message.messageId)) continue;
        next.add(message.messageId);
        changed = true;
      }
      if (!changed) return current;
      saveReadIds(wallet.account, next);
      return next;
    });
  }, [messages, wallet.account]);

  const unreadCount = useMemo(
    () => messages.reduce((count, message) => count + (readIds.has(message.messageId) ? 0 : 1), 0),
    [messages, readIds],
  );

  const value = useMemo(() => ({
    messages,
    unreadCount,
    loading,
    error,
    lastUpdatedAt,
    live,
    refresh,
    markAllRead,
  }), [error, lastUpdatedAt, live, loading, markAllRead, messages, refresh, unreadCount]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error('NotificationsProvider is missing.');
  return value;
}
