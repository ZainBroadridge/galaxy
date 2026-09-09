import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './appkit.js';
import { NotificationsProvider } from './notifications.jsx';
import { WalletProvider } from './wallet.jsx';
import App from './App.jsx';
import { InvestorSessionProvider } from './investor/InvestorSession.jsx';
import { IssuerSessionProvider } from './issuer/IssuerSession.jsx';
import './styles.css';
import './investor/investor.css';
import './issuer/issuer.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <WalletProvider>
      <InvestorSessionProvider><IssuerSessionProvider>
        <NotificationsProvider><App /></NotificationsProvider>
      </IssuerSessionProvider></InvestorSessionProvider>
    </WalletProvider>
  </BrowserRouter>,
);
