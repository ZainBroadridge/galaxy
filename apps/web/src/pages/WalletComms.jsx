import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Empty, ErrorBox, Notice, Page, Panel, Spinner, Status } from '../components/UI.jsx';
import { useNotifications } from '../notifications.jsx';
import { getInstalledSnap, installSnap, snapConfiguration, syncSnap } from '../snap.js';
import { useWallet } from '../wallet.jsx';

const categoryOptions = [
  { value: 'EVENT_ANNOUNCEMENT', label: 'Event announcements' },
  { value: 'VOTING_OPEN', label: 'Voting opens' },
  { value: 'DEADLINE_REMINDER', label: 'Deadline reminders' },
  { value: 'DOCUMENT_UPDATE', label: 'Document updates' },
  { value: 'RESULTS_AVAILABLE', label: 'Results available' },
  { value: 'GENERAL', label: 'General issuer news' },
];
const categoryValues = categoryOptions.map(({ value }) => value);
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

function CategoryPicker({ selected, onChange, disabled = false }) {
  const summary = selected.length === categoryOptions.length
    ? 'All notification categories'
    : `${selected.length} categor${selected.length === 1 ? 'y' : 'ies'} selected`;

  function toggle(value, checked) {
    const next = checked
      ? categoryValues.filter((item) => item === value || selected.includes(item))
      : selected.filter((item) => item !== value);
    onChange(next);
  }

  return <details className={`category-select${disabled ? ' disabled' : ''}`}>
    <summary aria-disabled={disabled} onClick={(event) => disabled && event.preventDefault()}>
      <span>{selected.length ? summary : 'Select notification categories'}</span>
      <span className="category-select-count">{selected.length}</span>
    </summary>
    <div className="category-select-menu" role="group" aria-label="Notification categories">
      {categoryOptions.map((option) => <label className="category-option" key={option.value}>
        <input
          type="checkbox"
          checked={selected.includes(option.value)}
          onChange={(event) => toggle(option.value, event.target.checked)}
        />
        <span>{option.label}</span>
      </label>)}
    </div>
  </details>;
}

export default function WalletComms() {
  const wallet = useWallet();
  const notifications = useNotifications();
  const configuration = snapConfiguration();
  const [activeTab, setActiveTab] = useState('investor');
  const [snapInstalled, setSnapInstalled] = useState(false);
  const [subscriptions, setSubscriptions] = useState([]);
  const [organisedEvents, setOrganisedEvents] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [subscription, setSubscription] = useState({ tokenAddress: '', categories: categoryValues, enabled: true });
  const [communication, setCommunication] = useState(initialCommunication);

  useEffect(() => {
    setActiveTab('investor');
    setSubscriptions([]);
    setOrganisedEvents([]);
    setCommunication(initialCommunication());
    setError(null);
    setFeedback(null);
  }, [wallet.account]);

  useEffect(() => {
    if (!configuration.ready) return;
    getInstalledSnap().then((value) => setSnapInstalled(Boolean(value))).catch(() => setSnapInstalled(false));
  }, [configuration.ready]);

  useEffect(() => {
    if (!snapInstalled && activeTab === 'organiser') setActiveTab('investor');
  }, [activeTab, snapInstalled]);

  useEffect(() => {
    if (wallet.connected && notifications.messages.length) notifications.markAllRead();
  }, [notifications.markAllRead, notifications.messages, wallet.connected]);

  const loadPortalData = useCallback(async () => {
    if (!wallet.connected) return;
    const portal = await api('/v1/communications/portal');
    setSubscriptions(portal.subscriptions);
    setOrganisedEvents(portal.organisedEvents);
    setCommunication((current) => ({
      ...current,
      eventId: current.eventId || portal.organisedEvents[0]?.id || '',
    }));
  }, [wallet.account, wallet.connected]);

  useEffect(() => {
    if (!wallet.authenticated) return;
    loadPortalData().catch(setError);
  }, [loadPortalData, wallet.authenticated]);

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
      setSnapInstalled(true);
      setFeedback({
        action: 'install',
        tone: 'success',
        message: updating ? 'MetaMask Snap updated successfully.' : 'MetaMask Snap installed successfully.',
      });
    });
  }

  async function sync() {
    await runAction('sync', async () => {
      const messages = await notifications.refresh({ silent: true });
      const result = await syncSnap({
        walletAddress: wallet.account,
        install: false,
        messages,
      });
      setSnapInstalled(result.installed);
      if (!result.installed) {
        setFeedback({ action: 'sync', tone: 'info', message: 'Install the MetaMask Snap before syncing wallet notices.' });
        return;
      }
      const accepted = Number(result.accepted ?? 0);
      setFeedback({
        action: 'sync',
        tone: 'success',
        message: accepted > 0
          ? `${accepted} new notice${accepted === 1 ? '' : 's'} added to the MetaMask inbox.`
          : 'MetaMask inbox is up to date.',
      });
    });
  }

  async function saveSubscription() {
    await runAction('subscription', async () => {
      await wallet.ensureAuthenticated();
      await api('/v1/communications/subscriptions', { method: 'PUT', body: subscription });
      await loadPortalData();
      notifications.refresh({ silent: true }).catch(() => {});
      setFeedback({
        action: 'subscription',
        tone: 'success',
        message: subscription.enabled
          ? 'Subscription preferences saved successfully.'
          : 'Notifications disabled for this token.',
      });
    });
  }

  async function unlockOrganiser() {
    await runAction('organiser', async () => {
      await wallet.ensureAuthenticated();
      await loadPortalData();
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
      await wallet.ensureAuthenticated();
      const signer = await wallet.getSigner();
      const tokenScoped = communication.scope === 'TOKEN';
      const input = {
        ...(tokenScoped ? { tokenAddress: communication.tokenAddress } : {}),
        category: communication.category,
        audience: communication.audience,
        title: communication.title,
        body: communication.body,
        actionUrl: tokenScoped
          ? `${window.location.origin}/comms`
          : `${window.location.origin}/vote/${communication.eventId}`,
        publishedAt: new Date().toISOString(),
        expiresAt: new Date(communication.expiresAt).toISOString(),
      };
      const draftPath = tokenScoped
        ? '/v1/communications/token/draft'
        : `/v1/events/${communication.eventId}/communications/draft`;
      const publishPath = tokenScoped
        ? '/v1/communications/token'
        : `/v1/events/${communication.eventId}/communications`;
      const draft = await api(draftPath, { method: 'POST', body: input });
      const signature = await signer.signMessage(draft.signingMessage);
      await api(publishPath, { method: 'POST', body: { message: draft.message, signature } });
      setCommunication((current) => ({ ...current, title: '', body: '' }));
      notifications.refresh({ silent: true }).catch(() => {});
      setFeedback({
        action: 'publish',
        tone: 'success',
        message: tokenScoped
          ? 'Token communication signed and published successfully.'
          : 'Event communication signed and published successfully.',
      });
    });
  }

  const activeSubscriptions = useMemo(() => subscriptions.filter((item) => item.enabled), [subscriptions]);
  const tokenScoped = communication.scope === 'TOKEN';
  const canPublish = Boolean(
    communication.title && communication.body && communication.expiresAt
      && (tokenScoped ? communication.tokenAddress : communication.eventId),
  );
  const actionNotice = (action) => feedback?.action === action
    ? <Notice tone={feedback.tone}>{feedback.message}</Notice>
    : null;
  const lastUpdated = notifications.lastUpdatedAt
    ? `Updated ${new Date(notifications.lastUpdatedAt).toLocaleTimeString()}`
    : 'Waiting for the first update';

  return <Page title="Wallet Comms" intro="A verified inbox for investor notices, subscription preferences and organiser communications.">
    {!configuration.ready && <Notice tone="error">{configuration.message}</Notice>}
    {!wallet.connected && <Panel><Empty><p>Connect a wallet to view and manage notifications.</p><button className="button" onClick={wallet.openWallet}>Connect wallet</button></Empty></Panel>}
    <ErrorBox error={error} />
    <ErrorBox error={notifications.error} />

    {wallet.connected && <>
      <div className="comms-tabs" role="tablist" aria-label="Wallet communications">
        <button
          type="button"
          id="comms-tab-investor"
          role="tab"
          aria-controls="comms-panel-investor"
          aria-selected={activeTab === 'investor'}
          className={`comms-tab${activeTab === 'investor' ? ' active' : ''}`}
          onClick={() => setActiveTab('investor')}
        >Investor</button>
        {snapInstalled && <button
          type="button"
          id="comms-tab-organiser"
          role="tab"
          aria-controls="comms-panel-organiser"
          aria-selected={activeTab === 'organiser'}
          className={`comms-tab${activeTab === 'organiser' ? ' active' : ''}`}
          onClick={() => setActiveTab('organiser')}
        >Organiser</button>}
      </div>

      {activeTab === 'investor' && <div id="comms-panel-investor" className="comms-layout" role="tabpanel" aria-labelledby="comms-tab-investor">
        <Panel className="comms-inbox-panel">
          <div className="comms-panel-heading">
            <div>
              <span className="panel-eyebrow">Investor inbox</span>
              <h2>Notifications</h2>
              <p>Verified notices load automatically and update while the dApp is open.</p>
            </div>
            <div className="comms-panel-tools">
              <div className="inbox-status"><Status value={notifications.live ? 'LIVE' : 'POLLING'} /><span>{lastUpdated}</span></div>
              <button className="button secondary compact" onClick={sync} disabled={busy} title="Copy current notifications to MetaMask">{pendingAction === 'sync' ? 'Syncing…' : 'Sync now'}</button>
            </div>
          </div>
          {actionNotice('sync')}
          {notifications.loading && !notifications.messages.length
            ? <Spinner />
            : notifications.messages.length
              ? <div className="notification-list">{notifications.messages.map((message) => <article className="notification-card" key={message.messageId}>
                <div className="notification-card-meta">
                  <div className="notification-card-tags"><span className="token-tag">{message.tokenSymbol}</span><Status value={message.category} /></div>
                  <time dateTime={message.publishedAt}>{new Date(message.publishedAt).toLocaleString()}</time>
                </div>
                <h3>{message.title}</h3>
                <p>{message.body}</p>
                {message.scope === 'EVENT' && message.actionUrl && <a className="notification-action" href={message.actionUrl}>Open event</a>}
              </article>)}</div>
              : <Empty>No notifications for this wallet.</Empty>}
        </Panel>

        <aside className="comms-sidebar">
          <Panel className="comms-side-card">
            <div className="comms-card-header">
              <div><span className="panel-eyebrow">Wallet extension</span><h2>MetaMask Snap</h2></div>
              <Status value={snapInstalled ? 'INSTALLED' : 'NOT_INSTALLED'} />
            </div>
            <p className="muted package-id">{configuration.ready ? configuration.id : 'Production package not configured'}</p>
            <button className="button" onClick={install} disabled={!configuration.ready || busy}>{pendingAction === 'install' ? (snapInstalled ? 'Updating…' : 'Installing…') : (snapInstalled ? 'Update Snap' : 'Install Snap')}</button>
            {actionNotice('install')}
            <p className="muted">Sync copies the current inbox to MetaMask. Installing the Snap also unlocks organiser publishing tools on this page.</p>
          </Panel>

          <Panel className="comms-side-card">
            <div className="comms-card-header">
              <div><span className="panel-eyebrow">Preferences</span><h2>Subscriptions</h2></div>
            </div>
            <div className="settings-stack">
              <label>Token address<input value={subscription.tokenAddress} onChange={(event) => setSubscription({ ...subscription, tokenAddress: event.target.value })} placeholder="0x…" /></label>
              <label>Delivery<select value={subscription.enabled ? 'on' : 'off'} onChange={(event) => setSubscription({ ...subscription, enabled: event.target.value === 'on' })}><option value="on">Subscribed</option><option value="off">Unsubscribed</option></select></label>
              <div className="field"><span className="field-label">Notification categories</span><CategoryPicker selected={subscription.categories} onChange={(next) => setSubscription({ ...subscription, categories: next })} disabled={busy} /></div>
            </div>
            <button className="button secondary" onClick={saveSubscription} disabled={!subscription.tokenAddress || !subscription.categories.length || busy}>{pendingAction === 'subscription' ? 'Saving…' : 'Save preferences'}</button>
            {actionNotice('subscription')}
            {activeSubscriptions.length > 0 && <div className="subscription-list"><span className="muted">Active token subscriptions</span>{activeSubscriptions.map((item) => <code key={item.tokenAddress}>{item.tokenAddress}</code>)}</div>}
          </Panel>
        </aside>
      </div>}

      {activeTab === 'organiser' && snapInstalled && <div id="comms-panel-organiser" role="tabpanel" aria-labelledby="comms-tab-organiser">
        {!wallet.authenticated
          ? <Panel className="organiser-access">
            <span className="panel-eyebrow">Organiser access</span>
            <h2>Unlock communication tools</h2>
            <p>Authenticate the connected wallet once to load its organised events and publish verified communications.</p>
            <button className="button" onClick={unlockOrganiser} disabled={busy}>{pendingAction === 'organiser' ? 'Unlocking…' : 'Unlock organiser tools'}</button>
            {actionNotice('organiser')}
          </Panel>
          : <Panel className="organiser-comms-panel">
            <div className="comms-panel-heading">
              <div>
                <span className="panel-eyebrow">Organiser tools</span>
                <h2>Issue a communication</h2>
                <p>Publish a signed notice for a voting event or an ERC-20 token audience.</p>
              </div>
            </div>
            <form className="form organiser-comms-form" onSubmit={publish}>
              <section className="form-section">
                <div className="form-section-heading"><span>1</span><div><h3>Audience</h3><p>Choose the asset context and recipients.</p></div></div>
                <div className="field-grid three">
                  <label>Communication for<select value={communication.scope} onChange={(event) => changeScope(event.target.value)}><option value="EVENT">Voting event</option><option value="TOKEN">Token news / announcement</option></select></label>
                  {tokenScoped
                    ? <label>ERC-20 token address<input value={communication.tokenAddress} onChange={(event) => setCommunication({ ...communication, tokenAddress: event.target.value })} placeholder="0x…" required /></label>
                    : <label>Event<select value={communication.eventId} onChange={(event) => setCommunication({ ...communication, eventId: event.target.value })} required><option value="">Select an event</option>{organisedEvents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
                  <label>Category<select value={communication.category} onChange={(event) => setCommunication({ ...communication, category: event.target.value })}>{categoryOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                </div>
                <label>Audience<select value={communication.audience} onChange={(event) => setCommunication({ ...communication, audience: event.target.value })}>
                  {tokenScoped ? <><option value="SUBSCRIBERS">Subscribed investors</option><option value="CURRENT_HOLDERS">Current token holders</option></> : <><option value="ALL_ELIGIBLE">All eligible</option><option value="NOT_VOTED">Not voted</option><option value="SUBSCRIBERS">Subscribers</option></>}
                </select></label>
                {tokenScoped && <Notice>Current-holder broadcasts require a verified token authority: the standard <code>owner()</code> address, or the deployment creator when the token does not expose <code>owner()</code>. Unverified senders can still publish clearly labelled notices to subscribers.</Notice>}
                {!tokenScoped && !organisedEvents.length && <Notice>No organised event is available. Select “Token news / announcement” to publish independently using an ERC-20 address.</Notice>}
              </section>

              <section className="form-section">
                <div className="form-section-heading"><span>2</span><div><h3>Message</h3><p>Keep the title concise and the action clear.</p></div></div>
                <label>Title<input value={communication.title} onChange={(event) => setCommunication({ ...communication, title: event.target.value })} required /></label>
                <label>Message<textarea rows="5" value={communication.body} onChange={(event) => setCommunication({ ...communication, body: event.target.value })} required /></label>
                <label>Expires<input type="datetime-local" value={communication.expiresAt} onChange={(event) => setCommunication({ ...communication, expiresAt: event.target.value })} required /></label>
              </section>

              <div className="form-actions">
                <button className="button" disabled={busy || !canPublish}>{pendingAction === 'publish' ? 'Signing and publishing…' : 'Sign and publish'}</button>
                {actionNotice('publish')}
              </div>
            </form>
          </Panel>}
      </div>}
    </>}
  </Page>;
}
