import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '../wallet.jsx';
import { useInvestorSession } from './InvestorSession.jsx';
import { safeInvestorReturn } from './meeting-utils.js';
import { ArrowIcon, BrandBand, ErrorMessage, WalletIcon } from './InvestorFrame.jsx';
import ProxyVoteHelp from './ProxyVoteHelp.jsx';

function ControlNumberPreview() {
  return <section className="investor-auth-method" aria-labelledby="control-number-heading">
    <h2 id="control-number-heading">Vote without signing in</h2>
    <fieldset disabled className="investor-auth-preview" aria-describedby="auth-preview-description">
      <label htmlFor="preview-control-number">Enter your control number:</label>
      <div className="investor-control-field"><input id="preview-control-number" type="text" autoComplete="off" />
        <span className="investor-control-help" aria-hidden="true">?</span></div>
      <p>Forgot your Control Number? Sign in or <button type="button" className="investor-preview-link">Create an Account</button></p>
      <button type="button" className="investor-preview-action" title="Not available in this demonstration">Get Started</button>
    </fieldset>
  </section>;
}
function AccountPreview() {
  return <section className="investor-auth-method" aria-labelledby="account-heading">
    <h2 id="account-heading">Sign In To Your Account</h2>
    <fieldset disabled className="investor-auth-preview" aria-describedby="auth-preview-description">
      <label htmlFor="preview-email">Your email address</label>
      <input id="preview-email" type="email" autoComplete="off" />
      <label htmlFor="preview-password">Your password</label>
      <input id="preview-password" type="password" autoComplete="off" />
      <button type="button" className="investor-preview-link">Forgot your password?</button>
      <div className="investor-account-actions"><button type="button" className="investor-preview-action" title="Not available in this demonstration">Sign In</button>
        <button type="button" className="investor-preview-action secondary" title="Not available in this demonstration">Create an Account</button></div>
    </fieldset>
  </section>;
}
export default function LandingPage() {
  const wallet = useWallet();
  const investor = useInvestorSession();
  const [parameters] = useSearchParams();
  if (investor.session && parameters.get('welcome') !== '1') return <Navigate to={safeInvestorReturn(parameters.get('returnTo'))} replace />;
  const busy = investor.signing || investor.checking || wallet.networkBusy;
  return <div className="investor-app investor-landing">
    <header className="investor-landing-header"><BrandBand inverse />
      <Link className="investor-issuer-entry" to="/issuer">Issuer <ArrowIcon /></Link></header>
    <main className="investor-hero">
      <section className="investor-login-panel" aria-labelledby="investor-login-heading">
        <h1 id="investor-login-heading">Enter ProxyVote.com below with your control number, sign in, or connect your wallet.</h1>
        <p id="auth-preview-description" className="investor-sr-only">Control-number and email sign-in are demonstration-only and unavailable. Use wallet authentication to continue.</p>
        <div className="investor-auth-methods">
          <ControlNumberPreview /><AccountPreview />
          <section className="investor-auth-method investor-wallet-auth" aria-labelledby="wallet-auth-heading">
            <h2 id="wallet-auth-heading">Wallet Authentication</h2>
            <p>Connect your wallet to securely access and manage your proxy voting rights for tokenized holdings.</p>
            {investor.session ? <Link className="investor-auth-button" to="/meetings?tab=active">Continue to My Meetings<ArrowIcon /></Link>
              : <button className="investor-auth-button" type="button" onClick={() => void investor.begin()} disabled={busy} aria-busy={busy}>
                <WalletIcon />Authenticate with your wallet
              </button>}
            {busy && <span className="investor-auth-pending" role="status"><span className="investor-spinner" aria-hidden="true" /><span className="investor-sr-only">Authentication in progress</span></span>}
            {investor.waitingForWallet && !investor.signing && <p className="investor-login-wait" role="status">Complete the connection in your wallet. <button type="button" onClick={investor.cancel}>Cancel</button></p>}
            <ErrorMessage error={investor.error || wallet.networkError} />
          </section>
        </div>
        <div className="investor-login-help"><ProxyVoteHelp /></div>
      </section>
    </main>
  </div>;
}
