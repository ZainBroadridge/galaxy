import WalletComms from '../pages/WalletComms.jsx';
import { InvestorFrame } from './InvestorFrame.jsx';

/** Reuse the existing inbox, Snap and Push controls without mounting issuer tools. */
export default function NotificationsPage() {
  return <InvestorFrame><div className="investor-page-width"><WalletComms viewer="investor" /></div></InvestorFrame>;
}
