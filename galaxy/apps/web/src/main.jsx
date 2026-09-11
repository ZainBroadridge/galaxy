import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './appkit.js';
import { NotificationsProvider } from './notifications.jsx';
import { WalletProvider } from './wallet.jsx';
import App from './App.jsx';
import { InvestorDataProvider } from './investor/InvestorData.jsx';
import { InvestorSessionProvider } from './investor/InvestorSession.jsx';
import { IssuerSessionProvider } from './issuer/IssuerSession.jsx';
import './styles.css';
import './components/brand.css';
import './investor/investor.css';
import './issuer/issuer.css';
import './components/portal.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <WalletProvider>
      <InvestorSessionProvider><InvestorDataProvider><IssuerSessionProvider>
        <NotificationsProvider><App /></NotificationsProvider>
      </IssuerSessionProvider></InvestorDataProvider></InvestorSessionProvider>
    </WalletProvider>
  </BrowserRouter>,
);
