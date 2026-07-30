import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './appkit.js';
import { WalletProvider } from './wallet.jsx';
import App from './App.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <WalletProvider><App /></WalletProvider>
  </BrowserRouter>,
);
