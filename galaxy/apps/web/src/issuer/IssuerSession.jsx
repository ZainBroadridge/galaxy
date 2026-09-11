import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { api, readIssuerSession, saveIssuerSession, SESSION_EXPIRED_EVENT } from '../api.js';

import BrandLockup, { ProxyVoteMark } from '../components/BrandLockup.jsx';
import RequiredMark from '../components/RequiredMark.jsx';
import BackLink from '../components/BackLink.jsx';
import ParticleBackground from './ParticleBackground.jsx';

const IssuerContext = createContext(null);
export function IssuerSessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const clear = useCallback(() => { saveIssuerSession(null); setSession(null); }, []);
  useEffect(() => {
    let active = true;
    const saved = readIssuerSession();
    if (!saved) { setChecking(false); return undefined; }
    api('/v1/issuer/session', { auth: false }).then((result) => {
      if (active) { const value = { ...saved, ...result }; saveIssuerSession(value); setSession(value); }
    }).catch(() => { if (active) clear(); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [clear]);
  useEffect(() => {
    const listener = (event) => { if (event.detail === 'ISSUER_AUTH_REQUIRED') clear(); };
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);
    const timer = session ? window.setTimeout(clear, Math.max(0, Date.parse(session.expiresAt) - Date.now())) : null;
    return () => { window.removeEventListener(SESSION_EXPIRED_EVENT, listener); window.clearTimeout(timer); };
  }, [clear, session]);
  const login = useCallback(async (password) => {
    const result = await api('/v1/issuer/login', { method: 'POST', auth: false, issuerAuth: false, body: { password } });
    saveIssuerSession(result); setSession(result);
  }, []);
  const logout = useCallback(async () => {
    const current = readIssuerSession(); clear();
    if (current) await api('/v1/issuer/logout', { method: 'POST', auth: false, issuerAuth: false,
      headers: { 'x-issuer-session': current.token } }).catch(() => {});
  }, [clear]);
  return <IssuerContext.Provider value={{ session, checking, login, logout }}>{children}</IssuerContext.Provider>;
}
export function useIssuerSession() { return useContext(IssuerContext); }
export function RequireIssuer() {
  const { session, checking } = useIssuerSession();
  if (checking) return <div className="investor-loading" role="status">Restoring issuer session...</div>;
  return session ? <Outlet /> : <Navigate to="/issuer" replace />;
}
export function IssuerLogin() {
  const { session, checking, login } = useIssuerSession();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!checking && session) return <Navigate to="/issuer/home" replace />;
  async function submit(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    try { await login(password); navigate('/issuer/home', { replace: true }); }
    catch (value) { setError(value); }
    finally { setBusy(false); }
  }
  return <div className="issuer-login-page"><ParticleBackground /><form onSubmit={submit} className="issuer-login-card">
    <BrandLockup><ProxyVoteMark stacked /></BrandLockup>
    <h1>Issuer interface</h1><p>Enter the demonstration password to organise and manage voting events.</p>
    <label><span className="field-label">Password<RequiredMark /></span><input type="password" value={password} autoComplete="current-password" required
      onChange={(event) => setPassword(event.target.value)} /></label>
    {error && <p role="alert" className="investor-error">{error.message}</p>}
    <button className="button" disabled={busy || checking}>{busy ? 'Checking...' : 'Enter issuer interface'}</button>
    <small>This shared-password gate is for demonstration only, not production issuer authorization.</small>
    <BackLink to="/">Back to investor sign-in</BackLink>
  </form></div>;
}
