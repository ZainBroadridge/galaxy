import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBox, Notice, Panel, Spinner, Status } from '../components/UI.jsx';
import { useNotifications } from '../notifications.jsx';
import {
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
const localDate = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
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

  useEffect(() => {
    setActiveTab('announcements');
    setSubscriptions([]);
    setOrganisedEvents([]);
    setSnapState(null);
    setSubscription({ tokenAddress: '', enabled: true });
    setCommunication(initialCommunication());
    setError(null);
    setFeedback(null);
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

  const loadPortalData = useCallback(async () => {
    if (!wallet.connected || !wallet.account) return;
    const query = new URLSearchParams({ wallet: wallet.account });
    const portal = await api(`/v1/communications/portal?${query}`, { auth: false });
    setSubscriptions(portal.subscriptions ?? []);
    setOrganisedEvents(portal.organisedEvents ?? []);
    setCommunication((current) => ({
      ...current,
      eventId: current.eventId || portal.organisedEvents?.[0]?.id || '',
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
          ? 'MetaMask notifications updated and background alerts enabled.'
          : 'MetaMask notifications installed and background alerts enabled.',
      });
    });
  }

  async function sync() {
    await runAction('sync', async () => {
      const result = await syncSnap({ walletAddress: wallet.account, install: false });
      setSnapInstalled(result.installed);
      setSnapState(result.state ?? null);
      if (!result.installed) {
        setFeedback({ action: 'sync', tone: 'info', message: 'Install the MetaMask notification companion before syncing.' });
        return;
      }
      const accepted = Number(result.accepted ?? 0);
      setFeedback({
        action: 'sync',
        tone: 'success',
        message: accepted > 0
          ? `${accepted} new announcement${accepted === 1 ? '' : 's'} added to MetaMask.`
          : 'MetaMask notifications are up to date.',
      });
    });
  }

  async function disableBackgroundAlerts() {
    await runAction('disable-alerts', async () => {
      const state = await disableSnapBackgroundAlerts(wallet.account);
      setSnapState(state);
      setFeedback({ action: 'disable-alerts', tone: 'success', message: 'Background MetaMask alerts disabled.' });
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
      notifications.refresh({ silent: true }).catch(() => {});
      setFeedback({
        action: 'publish',
        tone: 'success',
        message: tokenScoped
          ? 'Token communication published successfully.'
          : 'Event communication published successfully.',
      });
    });
  }

  const activeSubscriptions = useMemo(() => subscriptions.filter((item) => item.enabled), [subscriptions]);
  const tokenScoped = communication.scope === 'TOKEN';
  const selectedEvent = tokenScoped ? null : organisedEvents.find((item) => item.id === communication.eventId);
  const selectedEventReady = tokenScoped || Boolean(selectedEvent?.contractReady || selectedEvent?.contractAddress);
  const canPublish = Boolean(
    communication.title.trim()
      && communication.body.trim()
      && communication.expiresAt
      && selectedEventReady
      && (tokenScoped ? communication.tokenAddress : communication.eventId),
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
    ? new Date(snapState.lastCheckedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return <main className="page wallet-comms-page notifications-page">
    <header className="wallet-comms-header notifications-header">
      <div>
        <span className="wallet-comms-kicker">Investor communications</span>
        <h1>Notifications</h1>
        <p>Read voting announcements or issue a communication for an event or token audience.</p>
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
        >Announcements{notifications.unreadCount > 0 && <span>{notifications.unreadCount > 99 ? '99+' : notifications.unreadCount}</span>}</button>
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

    {!configuration.ready && <Notice tone="error">{configuration.message}</Notice>}
    {!wallet.connected && <Panel><div className="notification-organiser-empty">
      <strong>Connect a wallet to open Notifications.</strong>
      <span>Your wallet determines which announcements and organised events are available.</span>
      <button className="button" onClick={wallet.openWallet}>Connect wallet</button>
    </div></Panel>}
    <ErrorBox error={error} />
    <ErrorBox error={notifications.error} />

    {wallet.connected && activeTab === 'announcements' && <div id="comms-panel-announcements" role="tabpanel" aria-labelledby="comms-tab-announcements" className="notification-workspace">
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
            <button className="button secondary compact" onClick={sync} disabled={!snapInstalled || busy} title="Check for new MetaMask notices now">
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
                  {message.actionUrl && <a className="notification-action" href={message.actionUrl}>{message.scope === 'EVENT' ? 'Open event' : 'Open notifications'}</a>}
                </div>
              </article>)
              : <div className="notification-empty">
                <strong>You’re all caught up</strong>
                <span>New verified notices will appear here automatically.</span>
              </div>}
        </div>
      </section>

      <div className="comms-utilities">
        <section className="comms-utility-card">
          <div className="utility-card-heading">
            <div><span className="panel-eyebrow">MetaMask</span><h2>Background wallet alerts</h2></div>
            <Status value={backgroundEnabled ? 'ACTIVE' : snapInstalled ? 'INSTALLED' : 'NOT_INSTALLED'} />
          </div>
          <p>Receive verified notices inside MetaMask automatically, even when this dApp is closed.</p>
          {snapInstalled && <p className="muted">
            {backgroundEnabled ? 'Checks every minute' : 'Background alerts are disabled'}
            {snapLastChecked ? ` · Last checked ${snapLastChecked}` : ''}
          </p>}
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
        </section>

        <section className="comms-utility-card">
          <div className="utility-card-heading">
            <div><span className="panel-eyebrow">Token updates</span><h2>Follow a token</h2></div>
          </div>
          <p>Follow general issuer news and published results for an ERC-20 token.</p>
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

    {wallet.connected && activeTab === 'organiser' && <div id="comms-panel-organiser" role="tabpanel" aria-labelledby="comms-tab-organiser">
      <Panel className="organiser-comms-panel notifications-organiser-panel">
        <div className="comms-panel-heading">
          <div>
            <span className="panel-eyebrow">Organiser tools</span>
            <h2>Issue a communication</h2>
            <p>Publish a notice for a voting event or an ERC-20 token audience. No unlock or MetaMask signature is required.</p>
          </div>
        </div>

        <form className="form organiser-comms-form" onSubmit={publish}>
          <section className="form-section">
            <div className="form-section-heading"><span>1</span><div><h3>Audience</h3><p>Choose the asset context and recipients.</p></div></div>
            <div className="field-grid three">
              <label>Communication for<select value={communication.scope} onChange={(event) => changeScope(event.target.value)}><option value="EVENT">Voting event</option><option value="TOKEN">Token news / announcement</option></select></label>
              {tokenScoped
                ? <label>ERC-20 token address<input value={communication.tokenAddress} onChange={(event) => setCommunication({ ...communication, tokenAddress: event.target.value })} placeholder="0x…" required /></label>
                : <label>Event<select value={communication.eventId} onChange={(event) => setCommunication({ ...communication, eventId: event.target.value })} required><option value="">Select an event</option>{organisedEvents.map((item) => <option key={item.id} value={item.id}>{item.title}{item.contractReady || item.contractAddress ? '' : ' — deploying'}</option>)}</select></label>}
              <label>Category<select value={communication.category} onChange={(event) => setCommunication({ ...communication, category: event.target.value })}>{communicationCategories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            </div>
            <label>Audience<select value={communication.audience} onChange={(event) => setCommunication({ ...communication, audience: event.target.value })}>
              {tokenScoped ? <><option value="SUBSCRIBERS">Subscribed investors</option><option value="CURRENT_HOLDERS">Current token holders</option></> : <><option value="ALL_ELIGIBLE">All eligible</option><option value="NOT_VOTED">Not voted</option><option value="SUBSCRIBERS">Subscribers</option></>}
            </select></label>
            {tokenScoped && communication.audience === 'SUBSCRIBERS' && <Notice>General news and published results reach all subscribers. Other categories are delivered only to subscribers who currently hold the token.</Notice>}
            {tokenScoped && communication.audience === 'CURRENT_HOLDERS' && <Notice>Current-holder broadcasts require the publisher address to match the token authority detected by the platform.</Notice>}
            {!tokenScoped && !organisedEvents.length && <Notice>No organised event is available. <Link to="/organiser">Create an event</Link>, or select “Token news / announcement” to publish independently.</Notice>}
            {!tokenScoped && communication.eventId && !selectedEventReady && <Notice>The selected event is still deploying. Event communications become available once its VoteEvent contract is ready.</Notice>}
          </section>

          <section className="form-section">
            <div className="form-section-heading"><span>2</span><div><h3>Message</h3><p>Keep the title concise and the action clear.</p></div></div>
            <label>Title<input value={communication.title} onChange={(event) => setCommunication({ ...communication, title: event.target.value })} required /></label>
            <label>Message<textarea rows="5" value={communication.body} onChange={(event) => setCommunication({ ...communication, body: event.target.value })} required /></label>
            <label>Expires<input type="datetime-local" value={communication.expiresAt} onChange={(event) => setCommunication({ ...communication, expiresAt: event.target.value })} required /></label>
          </section>

          <div className="form-actions notifications-publish-actions">
            <button className="button" disabled={busy || !canPublish}>{pendingAction === 'publish' ? 'Publishing…' : 'Publish communication'}</button>
            <span>The platform signs and distributes the notice automatically.</span>
          </div>
          {actionNotice('publish')}
        </form>
      </Panel>
    </div>}
  </main>;
}
