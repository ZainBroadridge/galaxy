import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '../wallet.jsx';
import { useInvestorSession } from './InvestorSession.jsx';
import { safeInvestorReturn } from './meeting-utils.js';
import { ArrowIcon, BrandBand, ErrorMessage, TOKENHOLDER_DISCLOSURE, WalletIcon } from './InvestorFrame.jsx';
import ProxyVoteHelp from './ProxyVoteHelp.jsx';

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
        <div className="investor-login-introduction">
          <p className="investor-eyebrow">Shareholder voting</p>
          <h1 id="investor-login-heading">Vote Your Tokenized Investments</h1>
          <p className="investor-login-intro">Connect your wallet to securely access your eligible voting opportunities.</p>
        </div>
        <section className="investor-wallet-auth" aria-labelledby="wallet-auth-heading">
          <h2 id="wallet-auth-heading" className="investor-sr-only">Authenticate your wallet</h2>
          <ol className="investor-login-steps">
            <li><span className="investor-step-number">1</span><span className="investor-step-copy"><strong>Connect your wallet</strong><span>Connect the wallet holding your tokenized investments.</span></span></li>
            <li><span className="investor-step-number">2</span><span className="investor-step-copy"><strong>Confirm your connection</strong><span>Approve the request in your wallet to securely continue.</span></span></li>
            <li><span className="investor-step-number">3</span><span className="investor-step-copy"><strong>Start voting</strong><span>View your eligible voting opportunities and submit your votes.</span></span></li>
          </ol>
          {investor.session ? <Link className="investor-auth-button" to="/meetings?tab=active">Continue to My Meetings<ArrowIcon /></Link> : <button className="investor-auth-button" type="button" onClick={() => void investor.begin()} disabled={busy}
            aria-busy={busy}>
            <WalletIcon />Authenticate with your wallet
          </button>}
          <p className="investor-connection-assurance">Your connection is secure. We&apos;ll never ask for your private keys or seed phrase.</p>
          {busy && <p className="investor-login-wait" role="status">{investor.checking ? 'Restoring your session...' : investor.signing ? 'Review and sign the message in MetaMask...' : 'Configure Polygon Amoy in your wallet...'}</p>}
          {investor.waitingForWallet && !investor.signing && <p className="investor-login-wait" role="status">
            Complete the connection in your wallet. <button type="button" onClick={investor.cancel}>Cancel</button></p>}
          <ErrorMessage error={investor.error || wallet.networkError} />
        </section>
        <div className="investor-login-help">
          <ProxyVoteHelp />
          <p id="tokenholder-voting-disclosure" className="investor-disclosure"><span aria-hidden="true">*</span> {TOKENHOLDER_DISCLOSURE}</p>
        </div>
      </section>
    </main>
  </div>;
}
