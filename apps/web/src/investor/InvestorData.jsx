import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { api } from '../api.js';
import { createResourceStore, recordAcceptedVote } from '../data/resource-store.js';
import { useInvestorSession } from './InvestorSession.jsx';

const InvestorDataContext = createContext(null);

function resourcePath(key) {
  if (key === 'meetings') return '/v1/investor/meetings';
  if (/^event:[0-9a-f-]{36}$/iu.test(key)) return `/v1/investor/events/${key.slice(6)}`;
  throw new Error('Unsupported investor resource.');
}

export function InvestorDataProvider({ children }) {
  const { session } = useInvestorSession();
  const token = session?.token;
  const wallet = session?.walletAddress;
  const store = useMemo(() => createResourceStore((key, signal) => {
    if (!token || !wallet) throw new Error('Investor sign-in is required.');
    // Bind every request to this verified session, not to mutable browser storage.
    return api(resourcePath(key), { auth: false, issuerAuth: false, signal,
      headers: { authorization: `Bearer ${token}` } });
  }), [token, wallet]);
  useEffect(() => {
    const release = store.retain();
    if (token && wallet) void store.prefetch('meetings');
    return release;
  }, [store, token, wallet]);
  return <InvestorDataContext.Provider value={store}>{children}</InvestorDataContext.Provider>;
}

export function useInvestorData() {
  const store = useContext(InvestorDataContext);
  if (!store) throw new Error('InvestorDataProvider is missing.');
  const prefetchEvent = useCallback((id) => store.prefetch(`event:${id}`), [store]);
  const acceptedVote = useCallback((id, vote) => recordAcceptedVote(store, id, vote), [store]);
  return { prefetchEvent, acceptedVote };
}

export function useInvestorResource(key) {
  const store = useContext(InvestorDataContext);
  if (!store) throw new Error('InvestorDataProvider is missing.');
  const subscribe = useCallback((listener) => store.subscribe(key, listener), [store, key]);
  const snapshot = useCallback(() => store.snapshot(key), [store, key]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { void store.prefetch(key); }, [store, key]);
  const refresh = useCallback(() => store.read(key, { force: true }).catch(() => null), [store, key]);
  const reload = useCallback(() => store.read(key, { force: true }), [store, key]);
  return { ...state, refresh, reload };
}
