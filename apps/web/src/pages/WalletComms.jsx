import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api.js';
import {
  browserPushState,
  disableBrowserPush,
  enableBrowserPush,
  showBrowserPushClickTest,
} from '../browser-push.js';
import { ErrorBox, Notice, Panel, Spinner, Status } from '../components/UI.jsx';
import { useNotifications } from '../notifications.jsx';
import {
  checkSnapNow,
  disableSnapBackgroundAlerts,
  getInstalledSnap,
  installSnap,
  snapConfiguration,
  snapInbox,
  syncSnap,
} from '../snap.js';
import { useWallet } from '../wallet.jsx';

const communicationCategories = [
  { value: 'EVENT_ANNOUNCEMENT', label: 'Event announcements' },
  { value: 'VOTING_OPEN', label: 'Voting opens' },
  { value: 'DEADLINE_REMINDER', label: 'Deadline reminders' },
  { value: 'DOCUMENT_UPDATE', label: 'Document updates' },
  { value: 'RESULTS_AVAILABLE', label: 'Results available' },
  { value: 'GENERAL', label: 'General issuer news' },
];

const categoryLabels = new Map(communicationCategories.map(({ value, label }) => [value, label]));
const NOTIFICATIONS_PER_PAGE = 5;
const DEFAULT_NOTIFICATION_EXPIRY_MS = 48 * 60 * 60_000;
const localDate = (date) => new Date(
  date.getTime() - date.getTimezoneOffset() * 60_000,
).toISOString().slice(0, 16);
const defaultNotificationExpiry = () => localDate(
  new Date(Date.now() + DEFAULT_NOTIFICATION_EXPIRY_MS),
);
const initialCommunication = () => ({
  scope: 'EVENT',
  eventId: '',
  tokenAddress: '',
  category: 'EVENT_ANNOUNCEMENT',
  audience: 'ALL_ELIGIBLE',
  title: '',
  body: '',
  expiresAt: defaultNotificationExpiry(),
});
const shortAddress = (value) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : '';
const messageIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function messageIdFromSearch(search) {
  const value = new URLSearchParams(search).get('messageId');
  return value && messageIdPattern.test(value) ? value.toLowerCase() : null;
}

function readableSnapIssue(value) {
  if (!value) return null;
  if (typeof value === 'object') {
    const nested = value.message ?? value.error?.message ?? value.data?.message;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
    try {
      const encoded = JSON.stringify(value);
      if (encoded && encoded !== '{}') return encoded;
    } catch {
      return 'MetaMask returned an unreadable native-alert error.';
    }
  }

  const text = String(value).trim();
  if (/^\[object\s*,?\s*object\]$/iu.test(text)) {
    return 'MetaMask rejected the native alert, but the installed Snap returned no readable detail. The verified message remains available in the MetaMask and dApp inboxes.';
  }
  return text;
}

export default function WalletComms() {
  const wallet = useWallet();
  const notifications = useNotifications();
  const configuration = snapConfiguration();
  const location = useLocation();
  const targetMessageId = useMemo(() => messageIdFromSearch(location.search), [location.search]);
  const [activeTab, setActiveTab] = useState('announcements');
  const [snapInstalled, setSnapInstalled] = useState(false);
  const [snapState, setSnapState] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [organisedEvents, setOrganisedEvents] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [subscription, setSubscription] = useState({ tokenAddress: '', enabled: true });
  const [communication, setCommunication] = useState(initialCommunication);
  const [browserPush, setBrowserPush] = useState(null);
  const [page, setPage] = useState(1);
  const lastSnapMessageId = useRef(null);
  const targetMessageRef = useRef(null);

  useEffect(() => {
    setActiveTab('announcements');
    setSubscriptions([]);
    setOrganisedEvents([]);
    setSnapState(null);
    setSubscription({ tokenAddress: '', enabled: true });
    setCommunication(initialCommunication());
    setBrowserPush(null);
    setPage(1);
    setError(null);
    setFeedback(null);
    lastSnapMessageId.current = null;
  }, [wallet.account]);

  useEffect(() => {
    if (!configuration.ready) return undefined;
    let active = true;
    getInstalledSnap()
      .then(async (value) => {
        if (!active) return;
        const installed = Boolean(value);
        setSnapInstalled(installed);
        if (installed) {
          const state = await snapInbox().catch(() => null);
          if (active) setSnapState(state);
        }
      })
      .catch(() => {
        if (active) {
          setSnapInstalled(false);
          setSnapState(null);
        }
      });
    return () => { active = false; };
  }, [configuration.ready]);

  useEffect(() => {
    let active = true;
    browserPushState(wallet.account)
      .then((state) => { if (active) setBrowserPush(state); })
      .catch(() => { if (active) setBrowserPush(null); });
    return () => { active = false; };
  }, [wallet.account]);

  useEffect(() => {
    if (targetMessageId) setActiveTab('announcements');
  }, [targetMessageId]);

  useEffect(() => {
    if (!targetMessageId) return;
    const targetIndex = notifications.messages.findIndex(
      (message) => message.messageId?.toLowerCase() === targetMessageId,
    );
    if (targetIndex >= 0) {
      setPage(Math.floor(targetIndex / NOTIFICATIONS_PER_PAGE) + 1);
    }
  }, [notifications.messages, targetMessageId]);

  useEffect(() => {
    if (wallet.connected && activeTab === 'announcements' && notifications.unreadCount > 0) {
      notifications.markAllRead().catch(() => {});
    }
  }, [activeTab, notifications.markAllRead, notifications.unreadCount, wallet.connected]);

  // When the dApp is open, mirror a newly received verified announcement into
  // the installed Snap immediately. The Snap cron remains the closed-tab path.
  useEffect(() => {
    const messageId = notifications.messages[0]?.messageId;
    if (!messageId
      || !wallet.account
      || !snapInstalled
      || snapState?.backgroundEnabled !== true
      || lastSnapMessageId.current === messageId) return;

    lastSnapMessageId.current = messageId;
    checkSnapNow(wallet.account)
      .then((result) => {
        if (result?.state) setSnapState(result.state);
      })
      .catch((value) => {
        setSnapState((current) => ({
          ...(current ?? {}),
          lastError: value?.message ?? String(value),
        }));
      });
  }, [notifications.messages, snapInstalled, snapState?.backgroundEnabled, wallet.account]);

  const loadPortalData = useCallback(async () => {
    if (!wallet.connected || !wallet.account) return;
    const address = encodeURIComponent(wallet.account);
    const [savedSubscriptions, events] = await Promise.all([
      api(`/v1/communications/subscriptions?wallet=${address}`, { auth: false }),
      api(`/v1/dashboard/organiser?wallet=${address}`, { auth: false }),
    ]);
    setSubscriptions(savedSubscriptions);
    setOrganisedEvents(events);
    setCommunication((current) => ({
      ...current,
      eventId: current.eventId || events[0]?.id || '',
    }));
  }, [wallet.account, wallet.connected]);

  useEffect(() => {
    if (!wallet.connected) return;
    loadPortalData().catch(setError);
  }, [loadPortalData, wallet.connected]);

  const busy = pendingAction !== null;

  async function runAction(name, operation) {
    if (busy) return;
    setPendingAction(name);
    setError(null);
    setFeedback(null);
    try {
      await operation();
    } catch (value) {
      setError(value);
    } finally {
      setPendingAction(null);
    }
  }

  async function install() {
    const updating = snapInstalled;
    await runAction('install', async () => {
      await installSnap();
      const result = await syncSnap({ walletAddress: wallet.account, install: false });
      setSnapInstalled(true);
      setSnapState(result.state ?? null);
      setFeedback({
        action: 'install',
        tone: 'success',
        message: updating
          ? 'MetaMask Snap updated and background alerts enabled.'
          : 'MetaMask Snap installed and background alerts enabled.',
      });
    });
  }

  async function sync() {
    await runAction('sync', async () => {
      const result = await syncSnap({ walletAddress: wallet.account, install: false });
      setSnapInstalled(result.installed);
      setSnapState(result.state ?? null);
      if (!result.installed) {
        setFeedback({ action: 'sync', tone: 'info', message: 'Install the MetaMask Snap before checking wallet notices.' });
        return;
      }
      const accepted = Number(result.accepted ?? 0);
      const rejected = Number(result.rejected ?? 0);
      const notificationErrors = Array.isArray(result.notificationErrors)
        ? result.notificationErrors.map(readableSnapIssue).filter(Boolean)
        : [];
      setFeedback({
        action: 'sync',
        tone: rejected > 0 || notificationErrors.length > 0 ? 'error' : 'success',
        message: rejected > 0
          ? `${rejected} notice${rejected === 1 ? ' was' : 's were'} rejected by MetaMask verification. Update the Snap and check again.`
          : notificationErrors.length > 0
            ? `The notice was stored, but MetaMask reported an alert issue: ${notificationErrors.join(' | ')}`
            : accepted > 0
              ? `${accepted} new notice${accepted === 1 ? '' : 's'} added to the MetaMask inbox.`
              : 'MetaMask inbox is up to date. Background alerts remain enabled.',
      });
    });
  }

  async function disableBackgroundAlerts() {
    await runAction('disable-alerts', async () => {
      const state = await disableSnapBackgroundAlerts(wallet.account);
      setSnapState(state);
      setFeedback({
        action: 'disable-alerts',
        tone: 'success',
        message: 'Background MetaMask alerts disabled.',
      });
    });
  }

  async function enableBrowserNotifications() {
    await runAction('browser-push', async () => {
      try {
        const state = await enableBrowserPush(wallet.account);
        setBrowserPush(state);
        setFeedback({
          action: 'browser-push',
          tone: 'success',
          message: 'Clickable browser notifications enabled for this wallet.',
        });
      } catch (value) {
        const state = await browserPushState(wallet.account).catch(() => null);
        if (state) setBrowserPush(state);
        throw value;
      }
    });
  }

  async function disableBrowserNotifications() {
    await runAction('browser-push', async () => {
      const state = await disableBrowserPush(wallet.account);
      setBrowserPush(state);
      setFeedback({
        action: 'browser-push',
        tone: 'success',
        message: 'Browser notifications disabled.',
      });
    });
  }

  async function testBrowserNotificationClick() {
    await runAction('browser-push-test', async () => {
      const messageId = notifications.messages[0]?.messageId;
      await showBrowserPushClickTest(messageId);
      setFeedback({
        action: 'browser-push-test',
        tone: 'info',
        message: 'Test notification sent. Click it to verify dApp routing.',
      });
    });
  }

  async function saveSubscription() {
    await runAction('subscription', async () => {
      await api('/v1/communications/subscriptions', {
        method: 'PUT',
        auth: false,
        body: { ...subscription, walletAddress: wallet.account },
      });
      await loadPortalData();
      notifications.refresh({ silent: true }).catch(() => {});
      setFeedback({
        action: 'subscription',
        tone: 'success',
        message: subscription.enabled
          ? 'Token subscription saved successfully.'
          : 'Token notifications disabled successfully.',
      });
    });
  }

  function changeScope(scope) {
    setCommunication((current) => ({
      ...current,
      scope,
      category: scope === 'TOKEN' ? 'GENERAL' : 'EVENT_ANNOUNCEMENT',
      audience: scope === 'TOKEN' ? 'SUBSCRIBERS' : 'ALL_ELIGIBLE',
    }));
  }

  async function publish(event) {
    event.preventDefault();
    await runAction('publish', async () => {
      const tokenScoped = communication.scope === 'TOKEN';
      const selectedEvent = tokenScoped
        ? null
        : organisedEvents.find((item) => item.id === communication.eventId);
      const input = {
        publisherAddress: wallet.account,
        ...(tokenScoped ? { tokenAddress: communication.tokenAddress } : {}),
        category: communication.category,
        audience: communication.audience,
        title: communication.title,
        body: communication.body,
        actionUrl: tokenScoped
          ? `${window.location.origin}/notifications`
          : (selectedEvent?.votingUrl ?? `${window.location.origin}/vote/${communication.eventId}`),
        publishedAt: new Date().toISOString(),
        expiresAt: new Date(communication.expiresAt).toISOString(),
      };
      const path = tokenScoped
        ? '/v1/communications/token/platform'
        : `/v1/events/${communication.eventId}/communications/platform`;
      await api(path, { method: 'POST', auth: false, body: input });
      setCommunication((current) => ({
        ...current,
        title: '',
        body: '',
        expiresAt: defaultNotificationExpiry(),
      }));
      await notifications.refresh({ silent: true }).catch(() => []);
      if (snapInstalled) {
        const snapResult = await checkSnapNow(wallet.account).catch(() => null);
        if (snapResult?.state) setSnapState(snapResult.state);
      }
      setFeedback({
        action: 'publish',
        tone: 'success',
        message: tokenScoped
          ? 'Token communication published successfully.'
          : 'Event communication published successfully.',
      });
    });
  }

  const activeSubscriptions = useMemo(
    () => subscriptions.filter((item) => item.enabled),
    [subscriptions],
  );
  const tokenScoped = communication.scope === 'TOKEN';
  const selectedEvent = tokenScoped
    ? null
    : organisedEvents.find((item) => item.id === communication.eventId);
  const selectedEventReady = Boolean(selectedEvent?.contractReady || selectedEvent?.contractAddress);
  const canPublish = Boolean(
    wallet.account
      && communication.title
      && communication.body
      && communication.expiresAt
      && (tokenScoped ? communication.tokenAddress : communication.eventId && selectedEventReady),
  );
  const actionNotice = (action) => feedback?.action === action
    ? <Notice tone={feedback.tone}>{feedback.message}</Notice>
    : null;
  const lastUpdated = notifications.lastUpdatedAt
    ? new Date(notifications.lastUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const notificationCount = notifications.messages.length;
  const unreadCount = notifications.unreadCount;
  const pageCount = Math.max(1, Math.ceil(notificationCount / NOTIFICATIONS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * NOTIFICATIONS_PER_PAGE;
  const pagedMessages = notifications.messages.slice(
    pageStart,
    pageStart + NOTIFICATIONS_PER_PAGE,
  );
  const backgroundEnabled = snapState?.backgroundEnabled === true;
  const snapLastChecked = snapState?.lastCheckedAt
    ? new Date(snapState.lastCheckedAt).toLocaleString()
    : null;
  const snapDeliveryIssue = readableSnapIssue(snapState?.lastDeliveryError);
  const latestMessageId = notifications.messages[0]?.messageId ?? null;

  const targetMessage = targetMessageId
    ? notifications.messages.find((message) => message.messageId?.toLowerCase() === targetMessageId)
    : null;
  const targetMessageMissing = Boolean(
    targetMessageId
      && wallet.connected
      && notifications.lastUpdatedAt
      && !notifications.loading
      && !targetMessage,
  );

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    if (!targetMessage || activeTab !== 'announcements' || !wallet.connected) return undefined;
    const frame = requestAnimationFrame(() => {
      targetMessageRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      targetMessageRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, currentPage, targetMessage, wallet.connected]);
  const browserPushStatus = !browserPush
    ? 'CHECKING'
    : !browserPush.configured
      ? 'NOT_CONFIGURED'
      : !browserPush.supported
        ? 'UNSUPPORTED'
        : browserPush.permission === 'denied'
          ? 'BLOCKED'
          : browserPush.issue?.code === 'PUSH_SERVICE_UNAVAILABLE'
            ? 'UNAVAILABLE'
            : browserPush.enabledForWallet ? 'ACTIVE' : 'NOT_ENABLED';
  const browserPushUnavailable = !browserPush?.configured
    || !browserPush?.supported
    || browserPush?.permission === 'denied';

  return <main className="page wallet-comms-page notifications-page">
    <header className="wallet-comms-header">
      <div>
        <span className="wallet-comms-kicker">Proxy voting communications</span>
        <h1>Notifications</h1>
        <p>Read voting announcements or issue a communication for an event or token.</p>
      </div>
      {wallet.connected && <div className="comms-tabs" role="tablist" aria-label="Notifications">
        <button
          type="button"
          id="comms-tab-announcements"
          role="tab"
          aria-controls="comms-panel-announcements"
          aria-selected={activeTab === 'announcements'}
          className={`comms-tab${activeTab === 'announcements' ? ' active' : ''}`}
          onClick={() => { setActiveTab('announcements'); setPage(1); }}
        >
          <span>Announcements</span>
          {unreadCount > 0 && <span
            className="comms-tab-count"
            aria-label={`${unreadCount} unread announcement${unreadCount === 1 ? '' : 's'}`}
          >{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </button>
        <button
          type="button"
          id="comms-tab-organiser"
          role="tab"
          aria-controls="comms-panel-organiser"
          aria-selected={activeTab === 'organiser'}
          className={`comms-tab${activeTab === 'organiser' ? ' active' : ''}`}
          onClick={() => setActiveTab('organiser')}
        >Organiser</button>
      </div>}
    </header>

    <ErrorBox error={error} />
    <ErrorBox error={notifications.error} />

    {!wallet.connected && <Panel className="comms-connect-panel">
      <div>
        <h2>Connect your wallet</h2>
        <p>{targetMessageId ? 'Connect the wallet that received this notification.' : 'Open the notification center and communication tools for this wallet.'}</p>
      </div>
      <button className="button" onClick={wallet.openWallet}>Connect wallet</button>
    </Panel>}

    {wallet.connected && activeTab === 'announcements' && <div
      id="comms-panel-announcements"
      className="notification-workspace"
      role="tabpanel"
      aria-labelledby="comms-tab-announcements"
    >
      <section className="notification-center" aria-labelledby="notification-center-title">
        <header className="notification-toolbar">
          <div>
            <div className="notification-title-line">
              <h2 id="notification-center-title">Announcements</h2>
              {unreadCount > 0 && <span className="notification-total">{unreadCount} unread</span>}
            </div>
            <p>Verified voting notices load automatically and update live.</p>
          </div>
          <div className="notification-actions">
            <span className={`live-indicator${notifications.live ? ' online' : ''}`}>
              <span aria-hidden="true" />{notifications.live ? 'Live' : 'Refreshing'}
            </span>
            {lastUpdated && <span className="notification-updated">Updated {lastUpdated}</span>}
            <button className="button secondary compact" onClick={sync} disabled={!snapInstalled || busy}>
              {pendingAction === 'sync' ? 'Checking…' : 'Sync MetaMask'}
            </button>
          </div>
        </header>

        {actionNotice('sync')}
        {targetMessageMissing && <Notice tone="warning">This communication is not available for the connected wallet. Connect the wallet that received the browser notification.</Notice>}
        <div className="notification-feed" aria-live="polite">
          {notifications.loading && !notificationCount
            ? <Spinner />
            : notificationCount
              ? pagedMessages.map((message) => {
                const targeted = message.messageId?.toLowerCase() === targetMessageId;
                return <article
                  className="notification-row"
                  key={message.messageId}
                  ref={targeted ? targetMessageRef : null}
                  tabIndex={targeted ? -1 : undefined}
                  aria-current={targeted ? 'true' : undefined}
                  style={targeted ? { outline: '2px solid var(--blue)', outlineOffset: '-2px' } : undefined}
                >
                  <div className="notification-token-mark" aria-hidden="true">{message.tokenSymbol?.slice(0, 2) || 'PV'}</div>
                  <div className="notification-row-body">
                    <div className="notification-row-meta">
                      <span className="notification-token-name">{message.tokenSymbol}</span>
                      <span>{categoryLabels.get(message.category) ?? String(message.category).replaceAll('_', ' ')}</span>
                      <time dateTime={message.publishedAt}>{new Date(message.publishedAt).toLocaleString()}</time>
                    </div>
                    <h3>{message.title}</h3>
                    <p>{message.body}</p>
                    {message.scope === 'EVENT' && message.actionUrl && <a className="notification-action" href={message.actionUrl}>Open event</a>}
                  </div>
                </article>;
              })
              : <div className="notification-empty">
                <strong>You’re all caught up</strong>
                <span>New voting announcements will appear here automatically.</span>
              </div>}
        </div>
        {pageCount > 1 && <nav className="notification-toolbar" aria-label="Notification pages">
          <button
            type="button"
            className="button secondary compact"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={currentPage === 1}
          >Previous</button>
          <span className="notification-updated">Page {currentPage} of {pageCount}</span>
          <button
            type="button"
            className="button secondary compact"
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            disabled={currentPage === pageCount}
          >Next</button>
        </nav>}
      </section>

      <div className="comms-utilities">
        <section className="comms-utility-card">
          <div className="utility-card-heading">
            <div><span className="panel-eyebrow">MetaMask</span><h2>In-wallet alerts</h2></div>
            <Status value={backgroundEnabled ? 'ACTIVE' : snapInstalled ? 'INSTALLED' : 'NOT_INSTALLED'} />
          </div>
          <p>Keep a verified copy of voting notices inside MetaMask while the dApp is closed. MetaMask in-app alerts stay inside MetaMask; clickable desktop alerts are handled below.</p>
          {snapInstalled && <p className="muted">
            {backgroundEnabled ? 'Checks every minute' : 'Background alerts are disabled'}
            {snapLastChecked ? ` · Last checked ${snapLastChecked}` : ''}
          </p>}
          {!configuration.ready && <Notice tone="error">{configuration.message}</Notice>}
          <div className="inline-actions">
            <button className="button" onClick={install} disabled={!configuration.ready || busy}>
              {pendingAction === 'install' ? (snapInstalled ? 'Updating…' : 'Installing…') : (snapInstalled ? 'Update and enable' : 'Install and enable')}
            </button>
            {snapInstalled && backgroundEnabled && <button type="button" className="button secondary" onClick={disableBackgroundAlerts} disabled={busy}>
              {pendingAction === 'disable-alerts' ? 'Disabling…' : 'Disable alerts'}
            </button>}
          </div>
          {actionNotice('install')}
          {actionNotice('disable-alerts')}
          {snapState?.lastError && <Notice tone="error">Last background check: {snapState.lastError}</Notice>}
          {snapDeliveryIssue && <Notice tone="error">Last MetaMask in-app alert: {snapDeliveryIssue}</Notice>}

          <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 14 }}>
            <div className="utility-card-heading">
              <div><span className="panel-eyebrow">Browser</span><h2>Clickable alerts</h2></div>
              <Status value={browserPushStatus} />
            </div>
            <p>Show the same concise voting alert as a browser notification. Clicking it opens this inbox; message contents remain hidden until the receiving wallet is connected.</p>
            {browserPush?.permission === 'denied' && <Notice tone="warning">Browser notifications are blocked. Allow them in the browser site settings before enabling this feature.</Notice>}
            {!browserPush?.configured && browserPush && <Notice tone="info">Set the Web Push public key in Vercel to enable clickable browser alerts.</Notice>}
            {browserPush?.browser === 'brave' && !browserPush?.enabledForWallet && <Notice tone="info">Brave requires <code>Use Google services for push messaging</code> in <code>brave://settings/privacy</code>. If that setting is locked, your browser administrator must enable it.</Notice>}
            {browserPush?.issue?.message && <Notice tone="warning">{browserPush.issue.message}</Notice>}
            <div className="inline-actions">
              {browserPush?.enabledForWallet
                ? <button type="button" className="button secondary" onClick={disableBrowserNotifications} disabled={busy}>
                  {pendingAction === 'browser-push' ? 'Disabling…' : 'Disable browser alerts'}
                </button>
                : <button type="button" className="button secondary" onClick={enableBrowserNotifications} disabled={busy || browserPushUnavailable}>
                  {pendingAction === 'browser-push'
                    ? 'Enabling…'
                    : browserPush?.boundWalletAddress ? 'Enable for this wallet' : 'Enable browser alerts'}
                </button>}
              {browserPush?.serviceWorkerReady && browserPush?.permission === 'granted' && latestMessageId && <button
                type="button"
                className="button secondary"
                onClick={testBrowserNotificationClick}
                disabled={busy}
              >{pendingAction === 'browser-push-test' ? 'Sending test…' : 'Test click routing'}</button>}
            </div>
            {actionNotice('browser-push')}
            {actionNotice('browser-push-test')}
          </div>
        </section>

        <section className="comms-utility-card">
          <div className="utility-card-heading">
            <div><span className="panel-eyebrow">Token updates</span><h2>Follow a token</h2></div>
          </div>
          <p>Follow general issuer updates and published results for an ERC-20 token.</p>
          <div className="subscription-form">
            <label>Token address<input value={subscription.tokenAddress} onChange={(event) => setSubscription({ ...subscription, tokenAddress: event.target.value })} placeholder="0x…" /></label>
            <label>Delivery<select value={subscription.enabled ? 'on' : 'off'} onChange={(event) => setSubscription({ ...subscription, enabled: event.target.value === 'on' })}><option value="on">Subscribed</option><option value="off">Unsubscribed</option></select></label>
          </div>
          <button className="button secondary" onClick={saveSubscription} disabled={!subscription.tokenAddress || busy}>
            {pendingAction === 'subscription' ? 'Saving…' : 'Save subscription'}
          </button>
          {actionNotice('subscription')}
          {activeSubscriptions.length > 0 && <div className="subscription-list">
            <span>Following</span>
            <div>{activeSubscriptions.map((item) => <code key={item.tokenAddress} title={item.tokenAddress}>{shortAddress(item.tokenAddress)}</code>)}</div>
          </div>}
        </section>
      </div>
    </div>}

    {wallet.connected && activeTab === 'organiser' && <div
      id="comms-panel-organiser"
      role="tabpanel"
      aria-labelledby="comms-tab-organiser"
    >
      <Panel className="organiser-comms-panel notifications-organiser-panel">
        <div className="comms-panel-heading">
          <div>
            <span className="panel-eyebrow">Organiser tools</span>
            <h2>Issue a communication</h2>
            <p>Publish an event notice or token announcement without an additional wallet signature.</p>
          </div>
        </div>

        <form className="form organiser-comms-form" onSubmit={publish}>
          <section className="form-section">
            <div className="form-section-heading"><span>1</span><div><h3>Audience</h3><p>Choose the asset context, category, and recipients.</p></div></div>
            <div className="field-grid three">
              <label>Communication for<select value={communication.scope} onChange={(event) => changeScope(event.target.value)}><option value="EVENT">Voting event</option><option value="TOKEN">Token news / announcement</option></select></label>
              {tokenScoped
                ? <label>ERC-20 token address<input value={communication.tokenAddress} onChange={(event) => setCommunication({ ...communication, tokenAddress: event.target.value })} placeholder="0x…" required /></label>
                : <label>Event<select value={communication.eventId} onChange={(event) => setCommunication({ ...communication, eventId: event.target.value })} required><option value="">Select an event</option>{organisedEvents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
              <label>Category<select value={communication.category} onChange={(event) => setCommunication({ ...communication, category: event.target.value })}>{communicationCategories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            </div>
            <label>Audience<select value={communication.audience} onChange={(event) => setCommunication({ ...communication, audience: event.target.value })}>
              {tokenScoped
                ? <><option value="SUBSCRIBERS">Subscribed investors</option><option value="CURRENT_HOLDERS">Current token holders</option></>
                : <><option value="ALL_ELIGIBLE">All eligible</option><option value="NOT_VOTED">Not voted</option><option value="SUBSCRIBERS">Subscribers</option></>}
            </select></label>
            {tokenScoped && communication.audience === 'SUBSCRIBERS' && <Notice>General news and published results reach all subscribers. Other categories are delivered only to subscribers who currently hold the token.</Notice>}
            {tokenScoped && communication.audience === 'CURRENT_HOLDERS' && <Notice>Current-holder broadcasts require the supplied publisher address to match the verified token authority.</Notice>}
            {!tokenScoped && !organisedEvents.length && <Notice>No organised event is available. Select “Token news / announcement” to publish independently using an ERC-20 address.</Notice>}
            {!tokenScoped && communication.eventId && !selectedEventReady && <Notice>The selected event is still deploying. Communications become available after its VoteEvent contract is ready.</Notice>}
          </section>

          <section className="form-section">
            <div className="form-section-heading"><span>2</span><div><h3>Message</h3><p>Keep the title concise and the action clear.</p></div></div>
            <label>Title<input value={communication.title} onChange={(event) => setCommunication({ ...communication, title: event.target.value })} required /></label>
            <label>Message<textarea rows="5" value={communication.body} onChange={(event) => setCommunication({ ...communication, body: event.target.value })} required /></label>
            <label>Expires<input type="datetime-local" value={communication.expiresAt} onChange={(event) => setCommunication({ ...communication, expiresAt: event.target.value })} required /></label>
          </section>

          <div className="form-actions notifications-publish-actions">
            <button className="button" disabled={busy || !canPublish}>{pendingAction === 'publish' ? 'Publishing…' : 'Publish communication'}</button>
            <span>No organiser unlock or MetaMask signature is required.</span>
          </div>
          {actionNotice('publish')}
        </form>
      </Panel>
    </div>}
  </main>;
}
