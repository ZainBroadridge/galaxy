import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Empty, ErrorBox, Notice, Page, Panel, Spinner, Status } from '../components/UI.jsx';
import { getInstalledSnap, installSnap, snapConfiguration, snapInbox, syncSnap } from '../snap.js';
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
  const configuration = snapConfiguration();
  const [snapInstalled, setSnapInstalled] = useState(false);
  const [messages, setMessages] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [organisedEvents, setOrganisedEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [subscription, setSubscription] = useState({ tokenAddress: '', categories, enabled: true });
  const [communication, setCommunication] = useState(initialCommunication);

  useEffect(() => {
    setMessages([]);
    setSubscriptions([]);
    setOrganisedEvents([]);
    setCommunication(initialCommunication());
  }, [wallet.account]);

  useEffect(() => {
    if (!configuration.ready) return;
    getInstalledSnap().then((value) => setSnapInstalled(Boolean(value))).catch(() => setSnapInstalled(false));
  }, [configuration.ready]);

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

  async function install() {
    setBusy(true); setError(null);
    try { await installSnap(); setSnapInstalled(true); } catch (value) { setError(value); } finally { setBusy(false); }
  }

  async function sync() {
    setBusy(true); setError(null);
    try {
      const result = await syncSnap({ walletAddress: wallet.account, ensureAuthenticated: wallet.ensureAuthenticated, install: false });
      setSnapInstalled(result.installed);
      if (result.installed) {
        const inbox = await snapInbox();
        setMessages(inbox?.messages ?? inbox ?? result.messages ?? []);
      }
      await loadPortalData();
    } catch (value) { setError(value); } finally { setBusy(false); }
  }

  async function saveSubscription() {
    setBusy(true); setError(null);
    try {
      await wallet.ensureAuthenticated();
      await api('/v1/communications/subscriptions', { method: 'PUT', body: subscription });
      await loadPortalData();
    } catch (value) { setError(value); } finally { setBusy(false); }
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
    event.preventDefault(); setBusy(true); setError(null);
    try {
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
    } catch (value) { setError(value); } finally { setBusy(false); }
  }

  const activeSubscriptions = useMemo(() => subscriptions.filter((item) => item.enabled), [subscriptions]);
  const tokenScoped = communication.scope === 'TOKEN';
  const canPublish = Boolean(
    communication.title && communication.body && communication.expiresAt
      && (tokenScoped ? communication.tokenAddress : communication.eventId),
  );

  return <Page title="Wallet Comms" intro="Verified organiser notices delivered to MetaMask only when you choose to sync."
    actions={<button className="button secondary" onClick={sync} disabled={!wallet.connected || busy}>Sync now</button>}>
    {!configuration.ready && <Notice tone="error">{configuration.message}</Notice>}
    {!wallet.connected && <Panel><Empty><p>Connect a wallet to manage communications.</p><button className="button" onClick={wallet.openWallet}>Connect wallet</button></Empty></Panel>}
    <ErrorBox error={error} />
    {wallet.connected && <>
      <Panel title="MetaMask Snap">
        <div className="status-line"><Status value={snapInstalled ? 'INSTALLED' : 'NOT_INSTALLED'} /><span>{configuration.ready ? configuration.id : 'Production package not configured'}</span></div>
        <div className="row wrap"><button className="button" onClick={install} disabled={!configuration.ready || busy}>{snapInstalled ? 'Update Snap' : 'Install Snap'}</button><button className="button secondary" onClick={sync} disabled={!snapInstalled || busy}>Fetch new notices</button></div>
        <p className="muted">No timer, background fetch, or repeated API polling is used.</p>
      </Panel>

      <Panel title="In-wallet inbox">
        {busy && !messages.length ? <Spinner /> : messages.length
          ? <div className="message-list">{messages.map((message) => <article className="message" key={message.messageId}>
            <div className="event-card-top"><Status value={message.category} /><span>{message.tokenSymbol}</span></div>
            <h3>{message.title}</h3><p>{message.body}</p>
            <a href={message.actionUrl}>{message.scope === 'TOKEN' ? 'Open communication' : 'Open event'}</a>
          </article>)}</div>
          : <Empty>No synced communications.</Empty>}
      </Panel>

      <Panel title="Subscriptions">
        <div className="field-grid two"><label>Token address<input value={subscription.tokenAddress} onChange={(event) => setSubscription({ ...subscription, tokenAddress: event.target.value })} placeholder="0x…" /></label><label>Delivery<select value={subscription.enabled ? 'on' : 'off'} onChange={(event) => setSubscription({ ...subscription, enabled: event.target.value === 'on' })}><option value="on">Subscribed</option><option value="off">Unsubscribed</option></select></label></div>
        <div className="checks">{categories.map((category) => <label key={category}><input type="checkbox" checked={subscription.categories.includes(category)} onChange={(event) => setSubscription({ ...subscription, categories: event.target.checked ? [...subscription.categories, category] : subscription.categories.filter((item) => item !== category) })} />{category.replaceAll('_', ' ')}</label>)}</div>
        <button className="button secondary" onClick={saveSubscription} disabled={!subscription.tokenAddress || !subscription.categories.length || busy}>Save subscription</button>
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
          <button className="button" disabled={busy || !canPublish}>Sign and publish</button>
        </form>
      </Panel>
    </>}
  </Page>;
}
