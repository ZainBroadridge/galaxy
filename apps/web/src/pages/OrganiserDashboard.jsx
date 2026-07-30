import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, ErrorBox, EventCard, Notice, Page, Panel, ShortAddress, Spinner, Status } from '../components/UI.jsx';
import { useEventPolling, useLoad } from '../hooks.js';
import { useWallet } from '../wallet.jsx';

const localDate = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const initialForm = () => ({
  tokenAddress: '', title: '', description: '',
  recordDateAt: localDate(new Date(Date.now() - 5 * 60_000)),
  votingStartAt: localDate(new Date(Date.now() + 5 * 60_000)),
  votingEndAt: localDate(new Date(Date.now() + 24 * 60 * 60_000)),
  tokenToVoteRatio: 1,
  authenticityClaim: 'COMMUNITY', discoveryMode: 'PUBLIC_ELIGIBLE', snapDeliveryMode: 'ELIGIBLE',
  proposals: [{ title: '', description: '', options: ['For', 'Against', 'Abstain'], recommendation: null }],
});
const iso = (value) => new Date(value).toISOString();

function ProposalEditor({ proposals, onChange }) {
  const update = (index, patch) => onChange(proposals.map((proposal, position) => position === index ? { ...proposal, ...patch } : proposal));
  return <div className="proposal-editor">
    {proposals.map((proposal, proposalIndex) => <div className="proposal-edit" key={proposalIndex}>
      <div className="row between"><h3>Proposal {proposalIndex + 1}</h3>{proposals.length > 1 && <button type="button" className="text-button danger" onClick={() => onChange(proposals.filter((_, index) => index !== proposalIndex))}>Remove</button>}</div>
      <label>Proposal title<input value={proposal.title} onChange={(event) => update(proposalIndex, { title: event.target.value })} required /></label>
      <label>Supporting text<textarea value={proposal.description} onChange={(event) => update(proposalIndex, { description: event.target.value })} rows="2" /></label>
      <div className="option-edit-list">{proposal.options.map((option, optionIndex) => <div className="row" key={optionIndex}>
        <input aria-label={`Option ${optionIndex + 1}`} value={option} onChange={(event) => update(proposalIndex, { options: proposal.options.map((value, index) => index === optionIndex ? event.target.value : value) })} required />
        {proposal.options.length > 2 && <button type="button" className="icon-button" onClick={() => update(proposalIndex, { options: proposal.options.filter((_, index) => index !== optionIndex), recommendation: null })}>×</button>}
      </div>)}</div>
      <div className="row wrap">
        {proposal.options.length < 4 && <button type="button" className="button tertiary" onClick={() => update(proposalIndex, { options: [...proposal.options, ''] })}>Add option</button>}
        <label className="inline-label">Recommendation<select value={proposal.recommendation ?? ''} onChange={(event) => update(proposalIndex, { recommendation: event.target.value === '' ? null : Number(event.target.value) })}>
          <option value="">None</option>{proposal.options.map((option, index) => <option key={index} value={index}>{option || `Option ${index + 1}`}</option>)}
        </select></label>
      </div>
    </div>)}
    {proposals.length < 32 && <button type="button" className="button secondary" onClick={() => onChange([...proposals, { title: '', description: '', options: ['For', 'Against'], recommendation: null }])}>Add proposal</button>}
  </div>;
}

export default function OrganiserDashboard() {
  const navigate = useNavigate();
  const wallet = useWallet();
  const events = useLoad(() => wallet.authenticated ? api('/v1/dashboard/organiser') : Promise.resolve([]), [wallet.authenticated, wallet.account]);
  const [form, setForm] = useState(initialForm);
  const [token, setToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function unlock() {
    setError(null);
    try { await wallet.ensureAuthenticated(); await events.reload(); } catch (value) { setError(value); }
  }
  async function inspect() {
    setError(null); setToken(null);
    try { await wallet.ensureAuthenticated(); setToken(await api('/v1/tokens/inspect', { method: 'POST', body: { tokenAddress: form.tokenAddress } })); } catch (value) { setError(value); }
  }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await wallet.ensureAuthenticated();
      const created = await api('/v1/events', { method: 'POST', body: {
        ...form,
        recordDateAt: iso(form.recordDateAt), votingStartAt: iso(form.votingStartAt), votingEndAt: iso(form.votingEndAt),
        tokenToVoteRatio: Number(form.tokenToVoteRatio),
      } });
      navigate(`/organiser/${created.event.id}`);
    } catch (value) { setError(value); } finally { setBusy(false); }
  }

  return <Page title="Organiser Dashboard" intro="Create a lightweight proxy vote for a standard Polygon Amoy ERC-20 token.">
    {!wallet.connected && <Panel><Empty><p>Connect a wallet to create and manage events.</p><button className="button" onClick={wallet.openWallet}>Connect wallet</button></Empty></Panel>}
    {wallet.connected && !wallet.authenticated && <Panel><Empty><p>Authenticate once to unlock organiser actions.</p><button className="button" onClick={unlock} disabled={wallet.authBusy}>Unlock organiser</button></Empty></Panel>}
    <ErrorBox error={error} />
    {wallet.authenticated && <>
      <Panel title="Create event">
        <form className="form" onSubmit={submit}>
          <div className="field-grid two">
            <label>ERC-20 token address<div className="input-action"><input value={form.tokenAddress} onChange={(event) => { setForm({ ...form, tokenAddress: event.target.value }); setToken(null); }} placeholder="0x…" required /><button type="button" className="button tertiary" onClick={inspect}>Inspect</button></div></label>
            <label>Token-to-vote ratio<input type="number" min="1" step="1" value={form.tokenToVoteRatio} onChange={(event) => setForm({ ...form, tokenToVoteRatio: event.target.value })} required /><small>Voting power = whole tokens ÷ X</small></label>
          </div>
          {token && <Notice tone="success">{token.name} ({token.symbol}), {token.decimals} decimals. Standard ERC-20 interface confirmed.</Notice>}
          <label>Event title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label>
          <label>Description<textarea rows="3" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <div className="field-grid three">
            <label>Record date<input type="datetime-local" max={localDate(new Date())} value={form.recordDateAt} onChange={(event) => setForm({ ...form, recordDateAt: event.target.value })} required /></label>
            <label>Voting starts<input type="datetime-local" value={form.votingStartAt} onChange={(event) => setForm({ ...form, votingStartAt: event.target.value })} required /></label>
            <label>Voting ends<input type="datetime-local" value={form.votingEndAt} onChange={(event) => setForm({ ...form, votingEndAt: event.target.value })} required /></label>
          </div>
          <div className="field-grid three">
            <label>Authenticity<select value={form.authenticityClaim} onChange={(event) => setForm({ ...form, authenticityClaim: event.target.value })}><option value="COMMUNITY">Community-created</option><option value="ISSUER_AUTHORIZED">Issuer-authorized claim</option></select></label>
            <label>Discovery<select value={form.discoveryMode} onChange={(event) => setForm({ ...form, discoveryMode: event.target.value })}><option value="PUBLIC_ELIGIBLE">Eligible holders</option><option value="SUBSCRIBERS_ONLY">Subscribed holders</option><option value="DIRECT_LINK">Direct link only</option></select></label>
            <label>Wallet communications<select value={form.snapDeliveryMode} onChange={(event) => setForm({ ...form, snapDeliveryMode: event.target.value })}><option value="ELIGIBLE">Eligible holders</option><option value="SUBSCRIBERS_ONLY">Subscribers only</option><option value="DISABLED">Disabled</option></select></label>
          </div>
          <ProposalEditor proposals={form.proposals} onChange={(proposals) => setForm({ ...form, proposals })} />
          <ErrorBox error={error} />
          <button className="button" disabled={busy}>{busy ? 'Creating…' : 'Create event'}</button>
        </form>
      </Panel>
      <Panel title="Your events">
        {events.loading ? <Spinner /> : events.data?.length ? <div className="card-grid">{events.data.map((item) => <EventCard key={item.id} event={item} to={`/organiser/${item.id}`} action="Manage" />)}</div> : <Empty>No events created by this wallet.</Empty>}
      </Panel>
    </>}
  </Page>;
}

export function OrganiserEventPage() {
  const { eventId } = useParams();
  const wallet = useWallet();
  const view = useLoad(() => api(`/v1/events/${eventId}/view${wallet.account ? `?wallet=${wallet.account}` : ''}`, { auth: false }), [eventId, wallet.account]);
  const [retryError, setRetryError] = useState(null);
  const jobActive = ['PENDING', 'RUNNING'].includes(view.data?.job?.status);
  useEventPolling(view.refresh, Boolean(jobActive || view.data?.verificationStatus === 'PENDING'));
  async function retry() {
    setRetryError(null);
    try { await wallet.ensureAuthenticated(); await api(`/v1/events/${eventId}/retry`, { method: 'POST' }); await view.reload(); } catch (error) { setRetryError(error); }
  }
  if (view.loading) return <Page title="Organiser Dashboard"><Spinner /></Page>;
  if (view.error) return <Page title="Organiser Dashboard"><ErrorBox error={view.error} /></Page>;
  const event = view.data;
  const canRetry = Boolean(event.failureReason || event.verificationStatus === 'FAILED');
  return <Page title={event.title} intro={`${event.tokenName} (${event.tokenSymbol})`} actions={<Link className="button secondary" to="/organiser">Back</Link>}>
    <Panel title="Event status">
      <div className="status-line"><Status value={event.status} /><span>{event.job?.message}</span></div>
      {jobActive && <progress value={event.job?.progress || 0} max="100" />}
      {event.failureReason && <Notice tone="error">{event.failureReason}</Notice>}
      {canRetry && <button className="button" onClick={retry}>Retry safely</button>}
      <ErrorBox error={retryError} />
    </Panel>
    <Panel title="Deployment">
      <dl className="details">
        <div><dt>Contract</dt><dd>{event.contractExplorerUrl ? <a href={event.contractExplorerUrl} target="_blank" rel="noreferrer"><ShortAddress value={event.contractAddress} /></a> : event.contractAddress ? 'Awaiting confirmation' : 'Pending'}</dd></div>
        <div><dt>Transaction</dt><dd>{event.deploymentTransactionHash ? <a href={event.deploymentExplorerUrl} target="_blank" rel="noreferrer"><ShortAddress value={event.deploymentTransactionHash} /></a> : 'Pending'}</dd></div>
        <div><dt>Source verification</dt><dd><Status value={event.verificationStatus} /></dd></div>
        <div><dt>Eligible wallets</dt><dd>{event.snapshotHolderCount ?? 'Pending'}</dd></div>
        <div><dt>Record block</dt><dd>{event.recordDateBlock ?? 'Pending'}</dd></div>
        <div><dt>Merkle root</dt><dd><ShortAddress value={event.snapshotRoot} /></dd></div>
      </dl>
      {event.verificationError && <Notice tone="error">{event.verificationError}</Notice>}
    </Panel>
    <Panel title="Proposals">{event.proposals.map((proposal, index) => <article className="proposal-summary" key={index}><h3>{index + 1}. {proposal.title}</h3><p>{proposal.description}</p><ol>{proposal.options.map((option) => <li key={option.index}>{option.text}</li>)}</ol></article>)}</Panel>
  </Page>;
}
