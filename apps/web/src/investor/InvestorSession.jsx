import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { INVESTOR_DISCLAIMER_VERSION, investorSignInMessage } from '@pv/shared';
import { api, readSession, saveSession, SESSION_EXPIRED_EVENT } from '../api.js';
import { useWallet } from '../wallet.jsx';

const InvestorSessionContext = createContext(null);

export function InvestorSessionProvider({ children }) {
  const wallet = useWallet();
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [intent, setIntent] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState(null);
  const operation = useRef(0);
  const activeAccount = useRef(wallet.account);
  activeAccount.current = wallet.account;

  const clear = useCallback(() => {
    operation.current += 1;
    saveSession(null);
    setSession(null);
    setIntent(false);
    setSigning(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const saved = readSession();
    if (!saved || saved.disclaimerVersion !== INVESTOR_DISCLAIMER_VERSION) {
      saveSession(null);
      setChecking(false);
      return undefined;
    }
    api('/v1/auth/session', { issuerAuth: false }).then((result) => {
      if (!cancelled) {
        const restored = { ...saved, ...result };
        saveSession(restored);
        setSession(restored);
      }
    }).catch((value) => {
      if (!cancelled) {
        saveSession(null);
        setError(value);
      }
    }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const expired = (event) => { if (event.detail === 'AUTH_REQUIRED') clear(); };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, [clear]);

  useEffect(() => {
    if (!session) return undefined;
    const timer = window.setTimeout(clear, Math.max(0, Date.parse(session.expiresAt) - Date.now()));
    if (wallet.connected && wallet.account !== session.walletAddress) clear();
    return () => window.clearTimeout(timer);
  }, [clear, session, wallet.account, wallet.connected]);

  useEffect(() => {
    if (!intent || !wallet.connected || !wallet.account || signing) return;
    const id = ++operation.current;
    const account = wallet.account;
    setIntent(false);
    setSigning(true);
    setError(null);
    void (async () => {
      const challenge = await api('/v1/auth/nonce', {
        method: 'POST', auth: false, issuerAuth: false, body: { walletAddress: account },
      });
      const expected = investorSignInMessage({ ...challenge, origin: window.location.origin, walletAddress: account });
      if (challenge.message !== expected || challenge.chainId !== 80002
        || challenge.disclaimerVersion !== INVESTOR_DISCLAIMER_VERSION || Date.parse(challenge.expiresAt) <= Date.now()) {
        throw new Error('The sign-in challenge did not match this site, wallet, and disclaimer. Please try again.');
      }
      if (operation.current !== id || activeAccount.current !== account) return;
      const signature = await wallet.signDisclaimer(challenge.message, account);
      if (operation.current !== id || activeAccount.current !== account) return;
      const result = await api('/v1/auth/verify', { method: 'POST', auth: false, issuerAuth: false,
        body: { walletAddress: account, challengeId: challenge.id, signature } });
      if (operation.current !== id || activeAccount.current !== account) return;
      saveSession(result);
      setSession(result);
    })().catch((value) => {
      if (operation.current === id) setError(value);
    }).finally(() => { if (operation.current === id) setSigning(false); });
  }, [intent, signing, wallet.account, wallet.connected, wallet.signDisclaimer]);

  const begin = useCallback(async () => {
    if (signing) return;
    setError(null);
    setIntent(true);
    if (!wallet.connected) await wallet.openWallet();
  }, [signing, wallet.connected, wallet.openWallet]);

  const signOut = useCallback(async () => {
    const current = readSession();
    clear();
    if (current) {
      await api('/v1/auth/logout', { method: 'POST', auth: false, issuerAuth: false,
        headers: { authorization: `Bearer ${current.token}` } }).catch(() => {});
    }
    await wallet.disconnectWallet().catch(() => {});
  }, [clear, wallet.disconnectWallet]);

  return <InvestorSessionContext.Provider value={{ session, checking, signing, waitingForWallet: intent,
    error, begin, signOut, cancel: clear }}>{children}</InvestorSessionContext.Provider>;
}

export function useInvestorSession() {
  const context = useContext(InvestorSessionContext);
  if (!context) throw new Error('InvestorSessionProvider is missing.');
  return context;
}

export function RequireInvestor() {
  const { session, checking } = useInvestorSession();
  const location = useLocation();
  const wallet = useWallet();
  const accountMatches = !wallet.connected || session?.walletAddress === wallet.account;
  if (checking) return <div className="investor-loading" role="status">Restoring your investor session...</div>;
  return session && accountMatches ? <Outlet /> : <Navigate to={`/?returnTo=${encodeURIComponent(location.pathname + location.search)}`} replace />;
}
