import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { api } from './api.js';
import { fetchCommunications } from './communications.js';
import { useWallet } from './wallet.jsx';

const NotificationsContext = createContext(null);
const refreshIntervalMs = 15_000;

export function NotificationsProvider({ children }) {
  const wallet = useWallet();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [live, setLive] = useState(false);
  const activeAccount = useRef(wallet.account);
  const messagesRef = useRef([]);
  const refreshInFlight = useRef(null);
  const readInFlight = useRef(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    activeAccount.current = wallet.account;
    messagesRef.current = [];
    refreshInFlight.current = null;
    readInFlight.current = null;
    setMessages([]);
    setLoading(Boolean(wallet.connected));
    setError(null);
    setLastUpdatedAt(null);
    setLive(false);
  }, [wallet.account, wallet.connected]);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    const account = wallet.account;
    if (!wallet.connected || !account) return [];
    if (refreshInFlight.current?.account === account) return refreshInFlight.current.promise;

    if (!silent) setLoading(true);
    const request = fetchCommunications(account)
      .then((nextMessages) => {
        if (activeAccount.current === account) {
          messagesRef.current = nextMessages;
          setMessages(nextMessages);
          setError(null);
          setLastUpdatedAt(new Date().toISOString());
          setLive(true);
        }
        return nextMessages;
      })
      .catch((value) => {
        if (activeAccount.current === account) {
          setError(value);
          setLive(false);
        }
        throw value;
      })
      .finally(() => {
        if (activeAccount.current === account) setLoading(false);
        if (refreshInFlight.current?.promise === request) refreshInFlight.current = null;
      });

    refreshInFlight.current = { account, promise: request };
    return request;
  }, [wallet.account, wallet.connected]);

  useEffect(() => {
    if (!wallet.connected || !wallet.account) return undefined;

    const refreshSilently = () => refresh({ silent: true }).catch(() => {});
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshSilently();
    };

    refresh({ silent: false }).catch(() => {});
    const timer = setInterval(refreshWhenVisible, refreshIntervalMs);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshSilently);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshSilently);
    };
  }, [refresh, wallet.account, wallet.connected]);

  const markAllRead = useCallback(async () => {
    const account = wallet.account;
    if (!wallet.connected || !account) return null;
    if (!messagesRef.current.some((message) => message.read !== true)) return null;
    if (readInFlight.current?.account === account) return readInFlight.current.promise;

    const request = api('/v1/communications/inbox/read', {
      method: 'PUT',
      auth: false,
      body: { walletAddress: account },
    })
      .then((result) => {
        if (activeAccount.current === account) {
          setMessages((current) => {
            const next = current.map((message) => ({ ...message, read: true }));
            messagesRef.current = next;
            return next;
          });
        }
        return result;
      })
      .catch((value) => {
        if (activeAccount.current === account) setError(value);
        throw value;
      })
      .finally(() => {
        if (readInFlight.current?.promise === request) readInFlight.current = null;
      });

    readInFlight.current = { account, promise: request };
    return request;
  }, [wallet.account, wallet.connected]);

  const unreadCount = useMemo(
    () => messages.reduce((count, message) => count + (message.read === true ? 0 : 1), 0),
    [messages],
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
