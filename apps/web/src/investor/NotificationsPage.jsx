import BackLink from '../components/BackLink.jsx';
import WalletComms from '../pages/WalletComms.jsx';
import { InvestorFrame } from './InvestorFrame.jsx';

/** Reuse the existing inbox, Snap and Push controls without mounting issuer tools. */
export default function NotificationsPage() {
  return <InvestorFrame><div className="investor-page-width investor-notifications"><BackLink to="/meetings?tab=active">Back to my meetings</BackLink><WalletComms viewer="investor" /></div></InvestorFrame>;
}
