import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { api } from '../api.js';
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
const localDate = (date) => new Date(
  date.getTime() - date.getTimezoneOffset() * 60_000,
).toISOString().slice(0, 16);
const initialCommunication = () => ({
  scope: 'EVENT',
  eventId: '',
  tokenAddress: '',
  category: 'EVENT_ANNOUNCEMENT',
  audience: 'ALL_ELIGIBLE',
  title: '',
  body: '',
  expiresAt: localDate(new Date(Date.now() + 7 * 24 * 60 * 60_000)),
});
const shortAddress = (value) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : '';

export default function WalletComms() {
  const wallet = useWallet();
  const notifications = useNotifications();
  const configuration = snapConfiguration();
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
  const lastSnapMessageId = useRef(null);

  useEffect(() => {
    setActiveTab('announcements');
    setSubscriptions([]);
    setOrganisedEvents([]);
    setSnapState(null);
    setSubscription({ tokenAddress: '', enabled: true });
    setCommunication(initialCommunication());
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
    if (wallet.connected && activeTab === 'announcements' && notifications.messages.length) {
      notifications.markAllRead();
    }
  }, [activeTab, notifications.markAllRead, notifications.messages, wallet.connected]);

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
        ? result.notificationErrors
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
      setCommunication((current) => ({ ...current, title: '', body: '' }));
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
  const backgroundEnabled = snapState?.backgroundEnabled === true;
  const snapLastChecked = snapState?.lastCheckedAt
    ? new Date(snapState.lastCheckedAt).toLocaleString()
    : null;

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
          onClick={() => setActiveTab('announcements')}
        >
          <span>Announcements</span>
          {notificationCount > 0 && <span
            className="comms-tab-count"
            aria-label={`${notificationCount} announcement${notificationCount === 1 ? '' : 's'}`}
          >{notificationCount > 99 ? '99+' : notificationCount}</span>}
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
        <p>Open the notification center and communication tools for this wallet.</p>
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
              <span className="notification-total">{notificationCount}</span>
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
        <div className="notification-feed" aria-live="polite">
          {notifications.loading && !notificationCount
            ? <Spinner />
            : notificationCount
              ? notifications.messages.map((message) => <article className="notification-row" key={message.messageId}>
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
              </article>)
              : <div className="notification-empty">
                <strong>You’re all caught up</strong>
                <span>New voting announcements will appear here automatically.</span>
              </div>}
        </div>
      </section>

      <div className="comms-utilities">
        <section className="comms-utility-card">
          <div className="utility-card-heading">
            <div><span className="panel-eyebrow">MetaMask</span><h2>Background alerts</h2></div>
            <Status value={backgroundEnabled ? 'ACTIVE' : snapInstalled ? 'INSTALLED' : 'NOT_INSTALLED'} />
          </div>
          <p>Keep a verified copy of voting notices inside MetaMask while the dApp is closed.</p>
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
          {snapState?.lastDeliveryError && <Notice tone="error">Last MetaMask alert: {snapState.lastDeliveryError}</Notice>}
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
