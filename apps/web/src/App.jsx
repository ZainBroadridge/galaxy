import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { browserPushNotificationPath, consumeBrowserPushBootstrap, listenForBrowserPushOpen, restoreBrowserPushBinding } from './browser-push.js';
import LandingPage from './investor/LandingPage.jsx';
import MeetingsPage from './investor/MeetingsPage.jsx';
import BallotPage from './investor/BallotPage.jsx';
import ConfirmationPage from './investor/ConfirmationPage.jsx';
import EducationPage from './investor/EducationPage.jsx';
import NotificationsPage from './investor/NotificationsPage.jsx';
import { RequireInvestor } from './investor/InvestorSession.jsx';
import { IssuerLogin, RequireIssuer } from './issuer/IssuerSession.jsx';
import IssuerLayout from './issuer/IssuerLayout.jsx';
import SiteFooter from './components/SiteFooter.jsx';
import HomePage from './pages/HomePage.jsx';
import OrganiserDashboard, { OrganiserEventPage } from './pages/OrganiserDashboard.jsx';
import ResultsPage, { EventResultsPage } from './pages/ResultsPage.jsx';
import WalletComms from './pages/WalletComms.jsx';

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => { void restoreBrowserPushBinding(); }, []);
  useEffect(() => {
    const open = (id, replace = false) => navigate(browserPushNotificationPath(id), { replace });
    const bootstrap = consumeBrowserPushBootstrap();
    if (bootstrap) open(bootstrap, true);
    return listenForBrowserPushOpen((id) => open(id));
  }, [navigate]);
  useEffect(() => { if (!location.hash) window.scrollTo({ top: 0, behavior: 'auto' }); }, [location.pathname]);

  return <div className="portal-root"><Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<LandingPage />} />
    <Route path="/education" element={<EducationPage />} />
    <Route element={<RequireInvestor />}>
      <Route path="/meetings" element={<MeetingsPage />} />
      <Route path="/voting" element={<Navigate to="/meetings?tab=active" replace />} />
      <Route path="/vote/:eventId" element={<BallotPage />} />
      <Route path="/vote/:eventId/confirmation" element={<ConfirmationPage />} />
      <Route path="/notifications" element={<NotificationsPage />} />
      <Route path="/comms" element={<Navigate to="/notifications" replace />} />
    </Route>
    <Route path="/issuer" element={<IssuerLogin />} />
    <Route element={<RequireIssuer />}>
      <Route element={<IssuerLayout />}>
        <Route path="/issuer/home" element={<HomePage />} />
        <Route path="/home" element={<Navigate to="/issuer/home" replace />} />
        <Route path="/organiser" element={<OrganiserDashboard />} />
        <Route path="/organiser/:eventId" element={<OrganiserEventPage />} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/results/:eventId" element={<EventResultsPage />} />
        <Route path="/issuer/notifications" element={<WalletComms />} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes><SiteFooter /></div>;
}
