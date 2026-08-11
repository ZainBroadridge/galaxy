import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Empty, ErrorBox, Notice, Page, Panel, Spinner, Status } from '../components/UI.jsx';
import { useNotifications } from '../notifications.jsx';
import { getInstalledSnap, installSnap, snapConfiguration, syncSnap } from '../snap.js';
import { useWallet } from '../wallet.jsx';

const categories = [
  'EVENT_ANNOUNCEMENT', 'VOTING_OPEN', 'DEADLINE_REMINDER',
  'DOCUMENT_UPDATE', 'RESULTS_AVAILABLE', 'GENERAL',
];
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

export default function WalletComms() {
  const wallet = useWallet();
  const notifications = useNotifications();
  const configuration = snapConfiguration();
  const [snapInstalled, setSnapInstalled] = useState(false);
  const [subscriptions, setSubscriptions] = useState([]);
  const [organisedEvents, setOrganisedEvents] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [subscription, setSubscription] = useState({ tokenAddress: '', categories, enabled: true });
  const [communication, setCommunication] = useState(initialCommunication);

  useEffect(() => {
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
    if (wallet.connected && notifications.messages.length) notifications.markAllRead();
  }, [notifications.markAllRead, notifications.messages, wallet.connected]);

  const loadPortalData = useCallback(async () => {
    if (!wallet.connected) return;
    await wallet.ensureAuthenticated();
    const portal = await api('/v1/communications/portal');
    setSubscriptions(portal.subscriptions);
    setOrganisedEvents(portal.organisedEvents);
    setCommunication((current) => ({
      ...current,
      eventId: current.eventId || portal.organisedEvents[0]?.id || '',
    }));
  }, [wallet.account, wallet.connected, wallet.ensureAuthenticated]);

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

  return <Page title="Wallet Comms" intro="Verified notifications load automatically and update live while the dApp is open."
    actions={<button className="button secondary" onClick={sync} disabled={!wallet.connected || busy} title="Copy current notifications to MetaMask">{pendingAction === 'sync' ? 'Syncing…' : 'Sync now'}</button>}>
    {!configuration.ready && <Notice tone="error">{configuration.message}</Notice>}
    {!wallet.connected && <Panel><Empty><p>Connect a wallet to view and manage notifications.</p><button className="button" onClick={wallet.openWallet}>Connect wallet</button></Empty></Panel>}
    <ErrorBox error={error} />
    <ErrorBox error={notifications.error} />
    {actionNotice('sync')}
    {wallet.connected && <>
      <Panel title="Notifications">
        <div className="status-line"><Status value={notifications.live ? 'LIVE' : 'POLLING'} /><span>{lastUpdated}</span></div>
        {notifications.loading && !notifications.messages.length ? <Spinner /> : notifications.messages.length
          ? <div className="message-list">{notifications.messages.map((message) => <article className="message" key={message.messageId}>
            <div className="event-card-top"><Status value={message.category} /><span>{message.tokenSymbol} · <time dateTime={message.publishedAt}>{new Date(message.publishedAt).toLocaleString()}</time></span></div>
            <h3>{message.title}</h3><p>{message.body}</p>
            {message.scope === 'EVENT' && message.actionUrl && <a href={message.actionUrl}>Open event</a>}
          </article>)}</div>
          : <Empty>No notifications for this wallet.</Empty>}
      </Panel>

      <Panel title="MetaMask Snap">
        <div className="status-line"><Status value={snapInstalled ? 'INSTALLED' : 'NOT_INSTALLED'} /><span>{configuration.ready ? configuration.id : 'Production package not configured'}</span></div>
        <button className="button" onClick={install} disabled={!configuration.ready || busy}>{pendingAction === 'install' ? (snapInstalled ? 'Updating…' : 'Installing…') : (snapInstalled ? 'Update Snap' : 'Install Snap')}</button>
        {actionNotice('install')}
        <p className="muted">Use Sync now to copy the current notification inbox to MetaMask.</p>
      </Panel>

      <Panel title="Subscriptions">
        <div className="field-grid two"><label>Token address<input value={subscription.tokenAddress} onChange={(event) => setSubscription({ ...subscription, tokenAddress: event.target.value })} placeholder="0x…" /></label><label>Delivery<select value={subscription.enabled ? 'on' : 'off'} onChange={(event) => setSubscription({ ...subscription, enabled: event.target.value === 'on' })}><option value="on">Subscribed</option><option value="off">Unsubscribed</option></select></label></div>
        <div className="checks">{categories.map((category) => <label key={category}><input type="checkbox" checked={subscription.categories.includes(category)} onChange={(event) => setSubscription({ ...subscription, categories: event.target.checked ? [...subscription.categories, category] : subscription.categories.filter((item) => item !== category) })} />{category.replaceAll('_', ' ')}</label>)}</div>
        <button className="button secondary" onClick={saveSubscription} disabled={!subscription.tokenAddress || !subscription.categories.length || busy}>{pendingAction === 'subscription' ? 'Saving…' : 'Save subscription'}</button>
        {actionNotice('subscription')}
        {activeSubscriptions.length > 0 && <ul className="compact-list">{activeSubscriptions.map((item) => <li key={item.tokenAddress}><code>{item.tokenAddress}</code></li>)}</ul>}
      </Panel>

      <Panel title="Send organiser communication">
        <form className="form" onSubmit={publish}>
          <div className="field-grid three">
            <label>Communication for<select value={communication.scope} onChange={(event) => changeScope(event.target.value)}><option value="EVENT">Voting event</option><option value="TOKEN">Token news / announcement</option></select></label>
            {tokenScoped
              ? <label>ERC-20 token address<input value={communication.tokenAddress} onChange={(event) => setCommunication({ ...communication, tokenAddress: event.target.value })} placeholder="0x…" required /></label>
              : <label>Event<select value={communication.eventId} onChange={(event) => setCommunication({ ...communication, eventId: event.target.value })} required><option value="">Select an event</option>{organisedEvents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
            <label>Category<select value={communication.category} onChange={(event) => setCommunication({ ...communication, category: event.target.value })}>{categories.map((item) => <option key={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>
          </div>
          <label>Audience<select value={communication.audience} onChange={(event) => setCommunication({ ...communication, audience: event.target.value })}>
            {tokenScoped ? <><option value="SUBSCRIBERS">Subscribed investors</option><option value="CURRENT_HOLDERS">Current token holders</option></> : <><option value="ALL_ELIGIBLE">All eligible</option><option value="NOT_VOTED">Not voted</option><option value="SUBSCRIBERS">Subscribers</option></>}
          </select></label>
          {tokenScoped && <Notice>Current-holder broadcasts require a verified token authority: the standard <code>owner()</code> address, or the deployment creator when the token does not expose <code>owner()</code>. Unverified senders can still publish clearly labelled notices to subscribers.</Notice>}
          {!tokenScoped && !organisedEvents.length && <Notice>No organised event is available. Select “Token news / announcement” to publish independently using an ERC-20 address.</Notice>}
          <label>Title<input value={communication.title} onChange={(event) => setCommunication({ ...communication, title: event.target.value })} required /></label>
          <label>Message<textarea rows="4" value={communication.body} onChange={(event) => setCommunication({ ...communication, body: event.target.value })} required /></label>
          <label>Expires<input type="datetime-local" value={communication.expiresAt} onChange={(event) => setCommunication({ ...communication, expiresAt: event.target.value })} required /></label>
          <button className="button" disabled={busy || !canPublish}>{pendingAction === 'publish' ? 'Signing and publishing…' : 'Sign and publish'}</button>
          {actionNotice('publish')}
        </form>
      </Panel>
    </>}
  </Page>;
}
