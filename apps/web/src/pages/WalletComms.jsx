import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Empty, ErrorBox, Notice, Page, Panel, Spinner, Status } from '../components/UI.jsx';
import { getInstalledSnap, installSnap, snapConfiguration, snapInbox, syncSnap } from '../snap.js';
import { useWallet } from '../wallet.jsx';

const categories = ['EVENT_ANNOUNCEMENT','VOTING_OPEN','DEADLINE_REMINDER','DOCUMENT_UPDATE','RESULTS_AVAILABLE','GENERAL'];
const localDate = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

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
  const [communication, setCommunication] = useState({
    eventId: '', category: 'EVENT_ANNOUNCEMENT', audience: 'ALL_ELIGIBLE', title: '', body: '',
    expiresAt: localDate(new Date(Date.now() + 7 * 24 * 60 * 60_000)),
  });

  useEffect(() => {
    setMessages([]);
    setSubscriptions([]);
    setOrganisedEvents([]);
    setCommunication((current) => ({ ...current, eventId: '' }));
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

  async function publish(event) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const signer = await wallet.getSigner();
      const input = {
        category: communication.category,
        audience: communication.audience,
        title: communication.title,
        body: communication.body,
        actionUrl: `${window.location.origin}/vote/${communication.eventId}`,
        publishedAt: new Date().toISOString(),
        expiresAt: new Date(communication.expiresAt).toISOString(),
      };
      const draft = await api(`/v1/events/${communication.eventId}/communications/draft`, { method: 'POST', body: input });
      const signature = await signer.signMessage(draft.signingMessage);
      await api(`/v1/events/${communication.eventId}/communications`, { method: 'POST', body: { message: draft.message, signature } });
      setCommunication((current) => ({ ...current, title: '', body: '' }));
    } catch (value) { setError(value); } finally { setBusy(false); }
  }

  const activeSubscriptions = useMemo(() => subscriptions.filter((item) => item.enabled), [subscriptions]);
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
        {busy && !messages.length ? <Spinner /> : messages.length ? <div className="message-list">{messages.map((message) => <article className="message" key={message.messageId}><div className="event-card-top"><Status value={message.category} /><span>{message.tokenSymbol}</span></div><h3>{message.title}</h3><p>{message.body}</p><a href={message.actionUrl}>Open event</a></article>)}</div> : <Empty>No synced communications.</Empty>}
      </Panel>
      <Panel title="Subscriptions">
        <div className="field-grid two"><label>Token address<input value={subscription.tokenAddress} onChange={(event) => setSubscription({ ...subscription, tokenAddress: event.target.value })} placeholder="0x…" /></label><label>Delivery<select value={subscription.enabled ? 'on' : 'off'} onChange={(event) => setSubscription({ ...subscription, enabled: event.target.value === 'on' })}><option value="on">Subscribed</option><option value="off">Unsubscribed</option></select></label></div>
        <div className="checks">{categories.map((category) => <label key={category}><input type="checkbox" checked={subscription.categories.includes(category)} onChange={(event) => setSubscription({ ...subscription, categories: event.target.checked ? [...subscription.categories, category] : subscription.categories.filter((item) => item !== category) })} />{category.replaceAll('_', ' ')}</label>)}</div>
        <button className="button secondary" onClick={saveSubscription} disabled={!subscription.tokenAddress || !subscription.categories.length || busy}>Save subscription</button>
        {activeSubscriptions.length > 0 && <ul className="compact-list">{activeSubscriptions.map((item) => <li key={item.tokenAddress}><code>{item.tokenAddress}</code></li>)}</ul>}
      </Panel>
      <Panel title="Send organiser communication">
        {!organisedEvents.length ? <Empty>Unlock or refresh this page after creating an event.</Empty> : <form className="form" onSubmit={publish}>
          <div className="field-grid three"><label>Event<select value={communication.eventId} onChange={(event) => setCommunication({ ...communication, eventId: event.target.value })}>{organisedEvents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>Category<select value={communication.category} onChange={(event) => setCommunication({ ...communication, category: event.target.value })}>{categories.map((item) => <option key={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><label>Audience<select value={communication.audience} onChange={(event) => setCommunication({ ...communication, audience: event.target.value })}><option value="ALL_ELIGIBLE">All eligible</option><option value="NOT_VOTED">Not voted</option><option value="SUBSCRIBERS">Subscribers</option></select></label></div>
          <label>Title<input value={communication.title} onChange={(event) => setCommunication({ ...communication, title: event.target.value })} required /></label>
          <label>Message<textarea rows="4" value={communication.body} onChange={(event) => setCommunication({ ...communication, body: event.target.value })} required /></label>
          <label>Expires<input type="datetime-local" value={communication.expiresAt} onChange={(event) => setCommunication({ ...communication, expiresAt: event.target.value })} required /></label>
          <button className="button" disabled={busy || !communication.eventId}>Sign and publish</button>
        </form>}
      </Panel>
    </>}
  </Page>;
}
