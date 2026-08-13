import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { API_BASE_URL, api, uploadEventPdf } from '../api.js';
import {
  Empty,
  ErrorBox,
  EventCard,
  Notice,
  Page,
  Panel,
  ShortAddress,
  Spinner,
  Status,
} from '../components/UI.jsx';
import { useEventLiveRefresh, useLoad } from '../hooks.js';
import { useWallet } from '../wallet.jsx';

const MAX_DOCUMENTS = 3;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const localDate = (date) => new Date(
  date.getTime() - date.getTimezoneOffset() * 60_000,
).toISOString().slice(0, 16);
const iso = (value) => new Date(value).toISOString();
const initialForm = () => ({
  tokenAddress: '',
  title: '',
  description: '',
  recordDateAt: localDate(new Date(Date.now() - 5 * 60_000)),
  votingStartAt: localDate(new Date(Date.now() + 5 * 60_000)),
  votingEndAt: localDate(new Date(Date.now() + 24 * 60 * 60_000)),
  tokenToVoteRatio: 1,
  authenticityClaim: 'COMMUNITY',
  discoveryMode: 'PUBLIC_ELIGIBLE',
  snapDeliveryMode: 'ELIGIBLE',
  proposals: [{
    title: '',
    description: '',
    options: ['For', 'Against', 'Abstain'],
    recommendation: null,
  }],
});

function validateDocuments(files, existingCount = 0) {
  const selected = [...files];
  if (existingCount + selected.length > MAX_DOCUMENTS) {
    throw new Error(`An event can contain at most ${MAX_DOCUMENTS} PDF documents.`);
  }
  selected.forEach((file) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      throw new Error(`${file.name} is not a PDF.`);
    }
    if (file.size === 0 || file.size > MAX_DOCUMENT_BYTES) {
      throw new Error(`${file.name} must be no larger than 10 MB.`);
    }
  });
  return selected;
}

function DocumentSelection({ files, onRemove }) {
  if (!files.length) return null;
  return <div className="selected-documents">
    {files.map((file, index) => <div key={`${file.name}-${file.size}`}>
      <span>{file.name}</span>
      <small>{(file.size / 1024 / 1024).toFixed(2)} MB</small>
      <button type="button" className="text-button danger" onClick={() => onRemove(index)}>Remove</button>
    </div>)}
  </div>;
}

function ProposalEditor({ proposals, onChange }) {
  const update = (index, patch) => onChange(
    proposals.map((proposal, position) => (
      position === index ? { ...proposal, ...patch } : proposal
    )),
  );
  return <div className="proposal-editor">
    {proposals.map((proposal, proposalIndex) => <div className="proposal-edit" key={proposalIndex}>
      <div className="row between">
        <h3>Proposal {proposalIndex + 1}</h3>
        {proposals.length > 1 && <button
          type="button"
          className="text-button danger"
          onClick={() => onChange(proposals.filter((_item, index) => index !== proposalIndex))}
        >Remove</button>}
      </div>
      <label>Proposal title<input
        value={proposal.title}
        onChange={(event) => update(proposalIndex, { title: event.target.value })}
        required
      /></label>
      <label>Supporting text<textarea
        value={proposal.description}
        onChange={(event) => update(proposalIndex, { description: event.target.value })}
        rows="2"
      /></label>
      <div className="option-edit-list">
        {proposal.options.map((option, optionIndex) => <div className="row" key={optionIndex}>
          <input
            aria-label={`Option ${optionIndex + 1}`}
            value={option}
            onChange={(event) => update(proposalIndex, {
              options: proposal.options.map((value, index) => (
                index === optionIndex ? event.target.value : value
              )),
            })}
            required
          />
          {proposal.options.length > 2 && <button
            type="button"
            className="icon-button"
            onClick={() => update(proposalIndex, {
              options: proposal.options.filter((_value, index) => index !== optionIndex),
              recommendation: null,
            })}
          >×</button>}
        </div>)}
      </div>
      <div className="row wrap">
        {proposal.options.length < 4 && <button
          type="button"
          className="button tertiary"
          onClick={() => update(proposalIndex, { options: [...proposal.options, ''] })}
        >Add option</button>}
        <label className="inline-label">Recommendation<select
          value={proposal.recommendation ?? ''}
          onChange={(event) => update(proposalIndex, {
            recommendation: event.target.value === '' ? null : Number(event.target.value),
          })}
        >
          <option value="">None</option>
          {proposal.options.map((option, index) => <option key={index} value={index}>
            {option || `Option ${index + 1}`}
          </option>)}
        </select></label>
      </div>
    </div>)}
    {proposals.length < 32 && <button
      type="button"
      className="button secondary"
      onClick={() => onChange([...proposals, {
        title: '',
        description: '',
        options: ['For', 'Against'],
        recommendation: null,
      }])}
    >Add proposal</button>}
  </div>;
}

export default function OrganiserDashboard() {
  const navigate = useNavigate();
  const wallet = useWallet();
  const events = useLoad(
    () => (wallet.authenticated ? api('/v1/dashboard/organiser') : Promise.resolve([])),
    [wallet.authenticated, wallet.account],
  );
  const [form, setForm] = useState(initialForm);
  const [documents, setDocuments] = useState([]);
  const [token, setToken] = useState(null);
  const [busyStage, setBusyStage] = useState('');
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  async function unlock() {
    setError(null);
    try {
      await wallet.ensureAuthenticated();
      await events.reload();
    } catch (value) { setError(value); }
  }

  async function inspect() {
    setError(null);
    setToken(null);
    try {
      await wallet.ensureAuthenticated();
      setToken(await api('/v1/tokens/inspect', {
        method: 'POST',
        body: { tokenAddress: form.tokenAddress },
      }));
    } catch (value) { setError(value); }
  }

  function chooseDocuments(event) {
    try {
      setDocuments(validateDocuments(event.target.files));
      setError(null);
    } catch (value) {
      event.target.value = '';
      setDocuments([]);
      setError(value);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setBusyStage('Creating event…');
    setError(null);
    try {
      await wallet.ensureAuthenticated();
      const created = await api('/v1/events', {
        method: 'POST',
        body: {
          ...form,
          recordDateAt: iso(form.recordDateAt),
          votingStartAt: iso(form.votingStartAt),
          votingEndAt: iso(form.votingEndAt),
          tokenToVoteRatio: Number(form.tokenToVoteRatio),
        },
      });

      const warnings = [];
      if (created.announcementDraft) {
        setBusyStage('Authorising event announcement…');
        try {
          const signer = await wallet.getSigner();
          const signature = await signer.signMessage(created.announcementDraft.signingMessage);
          await api(`/v1/events/${created.event.id}/announcement`, {
            method: 'PUT',
            body: { signature },
          });
        } catch (value) {
          warnings.push('Automatic Wallet Comms announcement was not authorised. It can be authorised from Manage Event.');
        }
      }

      if (documents.length) {
        setBusyStage('Uploading proxy voting documents…');
        for (const file of documents) {
          try { await uploadEventPdf(created.event.id, file); }
          catch { warnings.push(`${file.name} could not be uploaded. It can be added from Manage Event.`); }
        }
      }

      navigate(`/organiser/${created.event.id}`, {
        state: {
          notice: 'Event created successfully. Snapshot processing has started.',
          warning: warnings.join(' '),
        },
      });
    } catch (value) {
      setError(value);
    } finally {
      setBusyStage('');
    }
  }

  if (!wallet.connected) {
    return <Page title="Organizer">
      <Panel><Empty>
        <p>Connect a wallet to create and manage voting events.</p>
        <button className="button" onClick={wallet.openWallet}>Connect wallet</button>
      </Empty></Panel>
    </Page>;
  }

  if (!wallet.authenticated) {
    return <Page title="Organizer">
      <ErrorBox error={error} />
      <Panel><Empty>
        <p>Authenticate once to unlock organizer actions.</p>
        <button className="button" onClick={unlock} disabled={wallet.authBusy}>Unlock organizer</button>
      </Empty></Panel>
    </Page>;
  }

  if (!creating) {
    return <Page
      className="organiser-index-page"
      title="Your Voting Events"
      intro={`${events.data?.length ?? 0} event${events.data?.length === 1 ? '' : 's'} created by this wallet`}
      actions={<button className="button" type="button" onClick={() => setCreating(true)}>Create Voting Event</button>}
    >
      <ErrorBox error={error} />
      {events.loading
        ? <Spinner />
        : events.data?.length
          ? <div className="organiser-events-grid">{events.data.map((item) => <EventCard
              key={item.id}
              event={item}
              variant="organiser"
              to={item.status === 'CLOSED' ? `/results/${item.id}` : `/organiser/${item.id}`}
              titleTo={`/organiser/${item.id}`}
              action={item.status === 'CLOSED' ? 'Results' : 'Manage'}
            />)}</div>
          : <Panel><Empty>
              <p>No voting events have been created by this wallet.</p>
              <button className="button" type="button" onClick={() => setCreating(true)}>Create Voting Event</button>
            </Empty></Panel>}
    </Page>;
  }

  return <main className="page organiser-create-page">
    <button className="back-link-button" type="button" onClick={() => setCreating(false)}>← Back to your events</button>
    <header className="organiser-create-heading">
      <h1>Create Voting Event</h1>
    </header>

    <ErrorBox error={error} />
    <form className="form organiser-create-form" onSubmit={submit}>
      <section className="form-section-card">
        <header className="form-section-heading">
          <h2>Event details</h2>
          <p>Identify the token and define the voting event shown to eligible holders.</p>
        </header>
        <div className="field-grid two">
          <label>ERC-20 token address<div className="input-action">
            <input
              value={form.tokenAddress}
              onChange={(event) => {
                setForm({ ...form, tokenAddress: event.target.value });
                setToken(null);
              }}
              placeholder="0x…"
              required
            />
            <button type="button" className="button secondary compact" onClick={inspect}>Inspect</button>
          </div></label>
          <label>Token-to-vote ratio<input
            type="number"
            min="1"
            step="1"
            value={form.tokenToVoteRatio}
            onChange={(event) => setForm({ ...form, tokenToVoteRatio: event.target.value })}
            required
          /><small>Voting power = whole tokens ÷ X</small></label>
        </div>
        {token && <Notice tone="success">
          {token.name} ({token.symbol}), {token.decimals} decimals. Standard ERC-20 interface confirmed.
        </Notice>}
        <div className="field-grid two">
          <label>Event title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label>
          <label>Description<textarea rows="3" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        </div>
      </section>

      <section className="form-section-card">
        <header className="form-section-heading">
          <h2>Proposals</h2>
          <p>Define each resolution, its available options, and an optional board recommendation.</p>
        </header>
        <ProposalEditor proposals={form.proposals} onChange={(proposals) => setForm({ ...form, proposals })} />
      </section>

      <section className="form-section-card">
        <header className="form-section-heading">
          <h2>Schedule &amp; eligibility</h2>
          <p>Set the record date, voting window, event discovery, and communications behavior.</p>
        </header>
        <div className="field-grid three">
          <label>Voting start<input type="datetime-local" value={form.votingStartAt} onChange={(event) => setForm({ ...form, votingStartAt: event.target.value })} required /></label>
          <label>Voting end<input type="datetime-local" value={form.votingEndAt} onChange={(event) => setForm({ ...form, votingEndAt: event.target.value })} required /></label>
          <label>Record date<input type="datetime-local" max={localDate(new Date())} value={form.recordDateAt} onChange={(event) => setForm({ ...form, recordDateAt: event.target.value })} required /></label>
        </div>
        <div className="field-grid three">
          <label>Authenticity<select value={form.authenticityClaim} onChange={(event) => setForm({ ...form, authenticityClaim: event.target.value })}>
            <option value="COMMUNITY">Community-created</option>
            <option value="ISSUER_AUTHORIZED">Issuer-authorized claim</option>
          </select></label>
          <label>Discovery<select value={form.discoveryMode} onChange={(event) => setForm({ ...form, discoveryMode: event.target.value })}>
            <option value="PUBLIC_ELIGIBLE">Eligible holders</option>
            <option value="SUBSCRIBERS_ONLY">Subscribed holders</option>
            <option value="DIRECT_LINK">Direct link only</option>
          </select></label>
          <label>Wallet communications<select value={form.snapDeliveryMode} onChange={(event) => setForm({ ...form, snapDeliveryMode: event.target.value })}>
            <option value="ELIGIBLE">Eligible holders</option>
            <option value="SUBSCRIBERS_ONLY">Subscribers only</option>
            <option value="DISABLED">Disabled</option>
          </select></label>
        </div>

        <div className="optional-upload">
          <div>
            <strong>Proxy voting documents</strong>
            <small>Optional. Up to three PDFs, 10 MB each.</small>
          </div>
          <label className="button secondary compact file-button">
            Select PDFs
            <input type="file" accept="application/pdf,.pdf" multiple onChange={chooseDocuments} />
          </label>
        </div>
        <DocumentSelection
          files={documents}
          onRemove={(index) => setDocuments((current) => current.filter((_file, position) => position !== index))}
        />
      </section>

      <footer className="create-form-actions">
        <button className="button" disabled={Boolean(busyStage)}>
          {busyStage || 'Create Event'}
        </button>
      </footer>
    </form>
  </main>;
}

export function OrganiserEventPage() {
  const { eventId } = useParams();
  const location = useLocation();
  const wallet = useWallet();
  const view = useLoad(
    () => api(`/v1/events/${eventId}/view${wallet.account ? `?wallet=${wallet.account}` : ''}`, { auth: false }),
    [eventId, wallet.account],
  );
  const [retryError, setRetryError] = useState(null);
  const [retrySuccess, setRetrySuccess] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [copySuccess, setCopySuccess] = useState('');
  const [documentFiles, setDocumentFiles] = useState([]);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentFeedback, setDocumentFeedback] = useState(null);
  const [announcementBusy, setAnnouncementBusy] = useState(false);
  const [announcementFeedback, setAnnouncementFeedback] = useState(null);
  const jobActive = ['PENDING', 'RUNNING'].includes(view.data?.job?.status);
  useEventLiveRefresh(
    view.refresh,
    eventId,
    Boolean(jobActive || view.data?.verificationStatus === 'PENDING'),
  );

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    setRetrySuccess(null);
    try {
      await wallet.ensureAuthenticated();
      await api(`/v1/events/${eventId}/retry`, { method: 'POST' });
      await view.reload();
      setRetrySuccess('Retry queued successfully. Processing will resume from the last safe step.');
    } catch (error) {
      setRetryError(error);
    } finally {
      setRetrying(false);
    }
  }

  async function copyDirectLink() {
    if (!view.data?.directVotingUrl) return;
    try {
      await navigator.clipboard.writeText(view.data.directVotingUrl);
      setCopySuccess('Direct voting link copied.');
    } catch {
      setCopySuccess('Copy failed. Select the link and copy it manually.');
    }
  }

  function chooseAdditionalDocuments(event) {
    try {
      setDocumentFiles(validateDocuments(event.target.files, view.data?.documents?.length ?? 0));
      setDocumentFeedback(null);
    } catch (value) {
      event.target.value = '';
      setDocumentFiles([]);
      setDocumentFeedback({ tone: 'error', message: value.message });
    }
  }

  async function uploadDocuments() {
    if (!documentFiles.length || documentBusy) return;
    setDocumentBusy(true);
    setDocumentFeedback(null);
    try {
      await wallet.ensureAuthenticated();
      for (const file of documentFiles) await uploadEventPdf(eventId, file);
      setDocumentFiles([]);
      await view.reload();
      setDocumentFeedback({ tone: 'success', message: 'Proxy voting documents uploaded successfully.' });
    } catch (error) {
      setDocumentFeedback({ tone: 'error', message: error.message });
    } finally {
      setDocumentBusy(false);
    }
  }

  async function removeDocument(documentId) {
    if (documentBusy) return;
    setDocumentBusy(true);
    setDocumentFeedback(null);
    try {
      await wallet.ensureAuthenticated();
      await api(`/v1/events/${eventId}/documents/${documentId}`, { method: 'DELETE' });
      await view.reload();
      setDocumentFeedback({ tone: 'success', message: 'Document removed.' });
    } catch (error) {
      setDocumentFeedback({ tone: 'error', message: error.message });
    } finally {
      setDocumentBusy(false);
    }
  }

  async function authoriseAnnouncement() {
    if (announcementBusy) return;
    setAnnouncementBusy(true);
    setAnnouncementFeedback(null);
    try {
      await wallet.ensureAuthenticated();
      const draft = await api(`/v1/events/${eventId}/announcement/draft`);
      const signer = await wallet.getSigner();
      const signature = await signer.signMessage(draft.signingMessage);
      const result = await api(`/v1/events/${eventId}/announcement`, {
        method: 'PUT',
        body: { signature },
      });
      await view.reload();
      setAnnouncementFeedback({
        tone: 'success',
        message: result.status === 'PUBLISHED'
          ? 'Event announcement published successfully.'
          : 'Event announcement authorised and will publish after deployment.',
      });
    } catch (error) {
      setAnnouncementFeedback({ tone: 'error', message: error.message });
    } finally {
      setAnnouncementBusy(false);
    }
  }

  if (view.loading) return <Page title="Organizer"><Spinner /></Page>;
  if (view.error) return <Page title="Organizer"><ErrorBox error={view.error} /></Page>;
  const event = view.data;
  const canRetry = Boolean(event.failureReason || event.verificationStatus === 'FAILED');
  const documentSlots = Math.max(0, MAX_DOCUMENTS - (event.documents?.length ?? 0));
  const canAuthoriseAnnouncement = event.announcementStatus === 'AWAITING_SIGNATURE'
    || (event.announcementStatus === 'QUEUED' && event.contractReady);

  return <Page
    title={event.title}
    intro={`${event.tokenName} (${event.tokenSymbol})`}
    actions={<Link className="button secondary" to="/organiser">Back to events</Link>}
  >
    {location.state?.notice && <Notice tone="success">{location.state.notice}</Notice>}
    {location.state?.warning && <Notice>{location.state.warning}</Notice>}

    <Panel title="Event status">
      <div className="status-line">
        <Status value={event.status} />
        <span>{event.job?.message}</span>
      </div>
      {jobActive && <div className="job-progress">
        <div><span>{event.job?.message}</span><strong>{event.job?.progress ?? 0}%</strong></div>
        <progress value={event.job?.progress ?? 0} max="100" />
      </div>}
      {event.failureReason && <Notice tone="error">{event.failureReason}</Notice>}
      {canRetry && <button className="button" onClick={retry} disabled={retrying}>
        {retrying ? 'Queuing retry…' : 'Retry safely'}
      </button>}
      <ErrorBox error={retryError} />
      {retrySuccess && <Notice tone="success">{retrySuccess}</Notice>}
    </Panel>

    {event.directVotingUrl && <Panel title="Direct voter link">
      <p className="muted">Share this URL with eligible wallets. It is not listed on the public Voting Dashboard.</p>
      <div className="copy-link-row">
        <input value={event.directVotingUrl} readOnly aria-label="Direct voter link" />
        <button className="button secondary" onClick={copyDirectLink}>Copy link</button>
      </div>
      {copySuccess && <Notice tone={copySuccess.startsWith('Direct') ? 'success' : undefined}>{copySuccess}</Notice>}
    </Panel>}

    <Panel title="Deployment">
      <dl className="details">
        <div><dt>Contract</dt><dd>{event.contractExplorerUrl
          ? <a href={event.contractExplorerUrl} target="_blank" rel="noreferrer"><ShortAddress value={event.contractAddress} /></a>
          : event.contractAddress ? 'Awaiting confirmation' : 'Pending'}</dd></div>
        <div><dt>Transaction</dt><dd>{event.deploymentTransactionHash
          ? <a href={event.deploymentExplorerUrl} target="_blank" rel="noreferrer"><ShortAddress value={event.deploymentTransactionHash} /></a>
          : 'Pending'}</dd></div>
        <div><dt>Source verification</dt><dd><Status value={event.verificationStatus} /></dd></div>
        <div><dt>Eligible wallets</dt><dd>{event.snapshotHolderCount ?? 'Pending'}</dd></div>
        <div><dt>Record block</dt><dd>{event.recordDateBlock ?? 'Pending'}</dd></div>
        <div><dt>Merkle root</dt><dd><ShortAddress value={event.snapshotRoot} /></dd></div>
      </dl>
      {event.verificationError && <Notice tone="error">{event.verificationError}</Notice>}
    </Panel>

    {!['DISABLED', 'NOT_CONFIGURED'].includes(event.announcementStatus) && <Panel title="Automatic Wallet Comms announcement">
      <div className="status-line"><Status value={event.announcementStatus} /><span>
        {event.announcementStatus === 'AWAITING_SIGNATURE'
          ? 'Authorise once; the announcement publishes automatically after deployment.'
          : event.announcementStatus === 'QUEUED'
            ? (event.contractReady
                ? 'Deployment is complete, but publication needs a manual retry.'
                : 'Authorised and waiting for deployment.')
            : 'Published to the selected Wallet Comms audience.'}
      </span></div>
      {canAuthoriseAnnouncement && <button
        className="button secondary"
        onClick={authoriseAnnouncement}
        disabled={announcementBusy}
      >{announcementBusy
        ? 'Authorising…'
        : event.announcementStatus === 'QUEUED' ? 'Retry announcement' : 'Authorise announcement'}</button>}
      {announcementFeedback && <Notice tone={announcementFeedback.tone}>{announcementFeedback.message}</Notice>}
    </Panel>}

    <Panel title="Proxy voting documents">
      {event.documents?.length
        ? <div className="document-manage-list">{event.documents.map((document) => <div key={document.id}>
            <div><strong>{document.fileName}</strong><small>{document.pageCount} page{document.pageCount === 1 ? '' : 's'}</small></div>
            <div className="row wrap">
              <a className="button tertiary" href={`${API_BASE_URL}/v1/events/${eventId}/documents/${document.id}`} target="_blank" rel="noreferrer">Open</a>
              <a className="button tertiary" href={`${API_BASE_URL}/v1/events/${eventId}/documents/${document.id}?download=1`}>Download</a>
              <button className="text-button danger" onClick={() => removeDocument(document.id)} disabled={documentBusy}>Remove</button>
            </div>
          </div>)}</div>
        : <p className="muted">No proxy voting documents have been added.</p>}
      {documentSlots > 0 && <div className="document-upload-row">
        <label className="button tertiary file-button">
          Select PDF{documentSlots > 1 ? 's' : ''}
          <input type="file" accept="application/pdf,.pdf" multiple={documentSlots > 1} onChange={chooseAdditionalDocuments} />
        </label>
        <span className="muted">{documentSlots} slot{documentSlots === 1 ? '' : 's'} available</span>
      </div>}
      <DocumentSelection
        files={documentFiles}
        onRemove={(index) => setDocumentFiles((current) => current.filter((_file, position) => position !== index))}
      />
      {documentFiles.length > 0 && <button className="button" onClick={uploadDocuments} disabled={documentBusy}>
        {documentBusy ? 'Uploading…' : 'Upload selected documents'}
      </button>}
      {documentFeedback && <Notice tone={documentFeedback.tone}>{documentFeedback.message}</Notice>}
    </Panel>

    <Panel title="Proposals">
      {event.proposals.map((proposal, index) => <article className="proposal-summary" key={index}>
        <h3>{index + 1}. {proposal.title}</h3>
        <p>{proposal.description}</p>
        <ol>{proposal.options.map((option) => <li key={option.index}>{option.text}</li>)}</ol>
      </article>)}
    </Panel>
  </Page>;
}
