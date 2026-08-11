import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './appkit.js';
import { NotificationsProvider } from './notifications.jsx';
import { WalletProvider } from './wallet.jsx';
import App from './App.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <WalletProvider>
      <NotificationsProvider><App /></NotificationsProvider>
    </WalletProvider>
  </BrowserRouter>,
);
