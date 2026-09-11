import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_OPTION_LABEL_LENGTH } from '@pv/shared';
import BackLink from '../components/BackLink.jsx';
import { useDeadlineClock } from '../data/useDeadlineClock.js';
import { meetingLifecycle } from '../investor/meeting-utils.js';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
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
import {
  TOKEN_INSPECTION_DEBOUNCE_MS,
  validateTokenAddressInput,
} from '../token-address.js';
import { useWallet } from '../wallet.jsx';
import IssuerBrandingFields from '../issuer/IssuerBrandingFields.jsx';
import { applyCatalogueEntry, clearCatalogueEntry, selectedCatalogueEntry } from '../issuer/catalogue-form.js';
import RequiredMark from '../components/RequiredMark.jsx';
import { eventProgress } from '../issuer/event-progress.js';
import { scheduleCreationLimitNotice, visibleCreationNotice } from '../issuer/notice-state.js';

import { appendPdfSelection, MAX_DOCUMENTS } from '../issuer/document-selection.js';
const localDate = (date) => new Date(
  date.getTime() - date.getTimezoneOffset() * 60_000,
).toISOString().slice(0, 16);
const iso = (value) => new Date(value).toISOString();
const initialForm = () => ({
  tokenAddress: '',
  tokenCatalogueId: '',
  cusip: '',
  issuerName: '',
  securityName: '',
  securityTicker: '',
  platform: '',
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

const DEMO_RECORD_AGE_MS = 24 * 60 * 60_000;
const DEMO_START_DELAY_MS = 5 * 60_000;
const DEMO_END_DELAY_MS = 60 * 60_000;

function demoSchedule(now = Date.now()) {
  return {
    recordDateAt: localDate(new Date(now - DEMO_RECORD_AGE_MS)),
    votingStartAt: localDate(new Date(now + DEMO_START_DELAY_MS)),
    votingEndAt: localDate(new Date(now + DEMO_END_DELAY_MS)),
  };
}

function demoProposals() {
  return [{
    title: 'P-01 - Election of Directors',
    description: 'Elect the nominated directors to serve until the next annual meeting.',
    options: ['For all', 'Withhold all', 'Except Nominee C'],
    recommendation: 0,
  }, {
    title: 'P-02 - Appointment of Independent Auditor',
    description: 'Ratify the appointment of the independent auditor for the next financial year.',
    options: ['For', 'Against', 'Abstain'],
    recommendation: 0,
  }, {
    title: 'P-03 - Advisory Vote on Executive Compensation',
    description: 'Approve the executive compensation arrangements on an advisory basis.',
    options: ['For', 'Against', 'Abstain'],
    recommendation: 0,
  }, {
    title: 'P-04 - Frequency of Compensation Votes',
    description: 'Select how often future advisory votes on executive compensation should be held.',
    options: ['Every year', 'Every 2 years', 'Every 3 years', 'Abstain'],
    recommendation: 0,
  }, {
    title: 'P-05 - Approval of the Equity Incentive Plan',
    description: 'Approve the proposed equity incentive plan and its administration.',
    options: ['For', 'Against', 'Abstain'],
    recommendation: 0,
  }];
}

function demoForm(current) {
  return {
    ...current,
    tokenAddress: current.tokenAddress,
    title: '2026 Annual Proxy Voting Demonstration',
    description: 'Annual meeting demonstration covering director elections, auditor appointment, compensation and equity incentives. Eligible record-date holders may submit one final weighted ballot. Sample agenda for testing only; not a legal proxy solicitation.',
    ...demoSchedule(),
    tokenToVoteRatio: 1,
    authenticityClaim: 'COMMUNITY',
    discoveryMode: 'PUBLIC_ELIGIBLE',
    snapDeliveryMode: 'ELIGIBLE',
    proposals: demoProposals(),
  };
}

function DocumentIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6.5 3.5h7l4 4v13H6.5z" />
    <path d="M13.5 3.5v4h4M9 12h6M9 15.5h6" />
  </svg>;
}

function AnnouncementIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 13.5V9.75l11-4.25v12.25zM15 8.25h2.25A2.75 2.75 0 0 1 20 11v1.25A2.75 2.75 0 0 1 17.25 15H15M7 14.5l1.25 5h3l-1.5-5" />
  </svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="10.75" cy="10.75" r="5.75" />
    <path d="m15.1 15.1 4.4 4.4" />
  </svg>;
}

function DocumentSelection({ files, onRemove, disabled = false }) {
  if (!files.length) return null;
  return <div className="selected-documents">
    {files.map((file, index) => <div key={JSON.stringify([file.name, file.size, file.lastModified ?? 0])}>
      <span>{file.name}</span>
      <small>{(file.size / 1024 / 1024).toFixed(2)} MB</small>
      <button type="button" className="text-button danger" disabled={disabled} onClick={() => onRemove(index)}>Remove</button>
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
      <div className="proposal-edit-heading">
        <div><span>{proposalIndex + 1}</span><h3>Proposal {proposalIndex + 1}</h3></div>
        {proposals.length > 1 && <button
          type="button"
          className="text-button danger"
          onClick={() => onChange(proposals.filter((_item, index) => index !== proposalIndex))}
        >Remove</button>}
      </div>
      <label><span className="field-label">Proposal title<RequiredMark /></span><input
        maxLength={220}
        value={proposal.title}
        onChange={(event) => update(proposalIndex, { title: event.target.value })}
        required
      /></label>
      <label>Supporting text<textarea
        maxLength={5000}
        value={proposal.description}
        onChange={(event) => update(proposalIndex, { description: event.target.value })}
        rows="2"
      /></label>
      <div className="option-edit-list">
        {proposal.options.map((option, optionIndex) => <div className="row" key={optionIndex}>
          <label className="option-edit-field"><span className="field-label">Option {optionIndex + 1}<RequiredMark /></span><input
            maxLength={MAX_OPTION_LABEL_LENGTH}
            title={`Option label: maximum ${MAX_OPTION_LABEL_LENGTH} characters`}
            aria-label={`Option ${optionIndex + 1}`}
            value={option}
            onChange={(event) => update(proposalIndex, {
              options: proposal.options.map((value, index) => (
                index === optionIndex ? event.target.value : value
              )),
            })}
            required
          /></label>
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
  const [creating, setCreating] = useState(false);
  const events = useLoad(
    () => (wallet.account
      ? api(`/v1/dashboard/organiser?wallet=${encodeURIComponent(wallet.account)}`, { auth: false })
      : Promise.resolve([])),
    [wallet.account],
  );
  const [form, setForm] = useState(initialForm);
  const catalogue = useLoad(() => creating
    ? api('/v1/issuer/token-catalogue', { auth: false }) : Promise.resolve(null), [creating]);
  const selection = selectedCatalogueEntry(catalogue.data, form);
  const [documents, setDocuments] = useState([]);
  const [issuerLogoFile, setIssuerLogoFile] = useState(null);
  const [token, setToken] = useState(null);
  const [inspectError, setInspectError] = useState(null);
  const [inspectBusy, setInspectBusy] = useState(false);
  const inspectRequestRef = useRef(0);
  const automaticInspectTimerRef = useRef(null);
  const [busyStage, setBusyStage] = useState('');
  const [error, setError] = useState(null);
  const [announcementAudience, setAnnouncementAudience] = useState('ELIGIBLE');

  useEffect(() => scheduleCreationLimitNotice(error, () => setError((current) => current === error ? null : current)), [error]);

  async function refreshCatalogue() {
    setError(null);
    try {
      const latest = await catalogue.reload();
      setForm((current) => {
        const entry = latest.entries.find((item) => item.id === current.tokenCatalogueId);
        return entry ? applyCatalogueEntry(current, entry) : clearCatalogueEntry(current);
      });
    } catch (value) { setError(value); }
  }

  function fillDemoData() {
    setForm((current) => demoForm(current));
    setAnnouncementAudience('ELIGIBLE');
    setError(null);
    setInspectError(null);
  }

  const inspectTokenAddress = useCallback(async (rawValue) => {
    if (!selection?.configured) return null;
    const validation = validateTokenAddressInput(rawValue);
    const requestId = inspectRequestRef.current + 1;
    inspectRequestRef.current = requestId;

    if (!validation.valid) {
      setInspectBusy(false);
      setToken(null);
      setInspectError(new Error(validation.message));
      return null;
    }

    setInspectBusy(true);
    setToken(null);
    setInspectError(null);

    try {
      const inspected = await api('/v1/tokens/inspect', {
        method: 'POST',
        auth: false,
        body: { tokenAddress: validation.tokenAddress },
      });
      if (inspectRequestRef.current === requestId) setToken(inspected);
      return inspected;
    } catch (value) {
      if (inspectRequestRef.current === requestId) setInspectError(value);
      return null;
    } finally {
      if (inspectRequestRef.current === requestId) setInspectBusy(false);
    }
  }, [selection]);

  useEffect(() => {
    if (automaticInspectTimerRef.current !== null) {
      window.clearTimeout(automaticInspectTimerRef.current);
      automaticInspectTimerRef.current = null;
    }

    inspectRequestRef.current += 1;
    setInspectBusy(false);
    setToken(null);
    setInspectError(null);

    if (!creating || !selection?.configured || !form.tokenAddress.trim()) return undefined;

    automaticInspectTimerRef.current = window.setTimeout(() => {
      automaticInspectTimerRef.current = null;
      void inspectTokenAddress(form.tokenAddress);
    }, TOKEN_INSPECTION_DEBOUNCE_MS);

    return () => {
      if (automaticInspectTimerRef.current !== null) {
        window.clearTimeout(automaticInspectTimerRef.current);
        automaticInspectTimerRef.current = null;
      }
    };
  }, [creating, form.tokenAddress, selection, inspectTokenAddress]);

  function inspect() {
    if (automaticInspectTimerRef.current !== null) {
      window.clearTimeout(automaticInspectTimerRef.current);
      automaticInspectTimerRef.current = null;
    }
    void inspectTokenAddress(form.tokenAddress);
  }

  function chooseDocuments(event) {
    const input = event.currentTarget;
    const selected = Array.from(input.files ?? []);
    input.value = '';
    if (!selected.length) return;
    try {
      setDocuments(appendPdfSelection(documents, selected));
      setError(null);
    } catch (value) {
      setError(value);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!wallet.account) return;
    setBusyStage('Creating event…');
    setError(null);
    try {
      if (!selection?.configured) throw new Error('Select a configured token mapping before creating an event.');
      const tokenAddress = validateTokenAddressInput(form.tokenAddress);
      if (!tokenAddress.valid) throw new Error(tokenAddress.message);

      let issuerLogoId = null;
      if (issuerLogoFile) {
        setBusyStage('Uploading issuer logo...');
        const logo = await api('/v1/issuer/logos', {
          method: 'POST', auth: false,
          headers: { 'content-type': issuerLogoFile.type, 'x-wallet-address': wallet.account },
          body: issuerLogoFile,
        });
        issuerLogoId = logo.id;
      }
      setBusyStage('Creating event...');
      const created = await api('/v1/events', {
        method: 'POST',
        auth: false,
        body: {
          creatorAddress: wallet.account,
          ...form,
          issuerLogoId,
          tokenAddress: tokenAddress.tokenAddress,
          recordDateAt: iso(form.recordDateAt),
          votingStartAt: iso(form.votingStartAt),
          votingEndAt: iso(form.votingEndAt),
          tokenToVoteRatio: Number(form.tokenToVoteRatio),
        },
      });

      const warnings = [];
      if (documents.length) {
        setBusyStage('Uploading proxy voting documents…');
        for (const file of documents) {
          try { await uploadEventPdf(created.event.id, file, wallet.account); }
          catch { warnings.push(`${file.name} could not be uploaded. It can be added from Manage Event.`); }
        }
      }

      const availableAt = Date.parse(created.job?.availableAt ?? '');
      const snapshotScheduled = created.job?.status === 'PENDING'
        && Number.isFinite(availableAt)
        && availableAt > Date.now();
      const notice = snapshotScheduled
        ? `Event created successfully. Snapshot processing is scheduled for ${new Date(availableAt).toLocaleString()}.`
        : 'Event created successfully. Snapshot processing has started.';
      navigate(`/organiser/${created.event.id}`, {
        state: { notice, warning: warnings.join(' ') },
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

  if (!creating) {
    return <Page
      className="organiser-index-page"
      title="Your Voting Events"
      intro={`${events.data?.length ?? 0} event${events.data?.length === 1 ? '' : 's'} created by this wallet`}
      actions={<button className="button" type="button" onClick={() => setCreating(true)}>Create Voting Event</button>}
    >
      <ErrorBox error={error || events.error} />
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

  const announcementEnabled = form.snapDeliveryMode !== 'DISABLED';
  const deliveryLabel = announcementEnabled
    ? form.snapDeliveryMode === 'SUBSCRIBERS_ONLY'
      ? 'Subscribers only'
      : 'Eligible holders'
    : 'Off';
  const recordDateIsFuture = Date.parse(form.recordDateAt) > Date.now();

  function setAnnouncementEnabled(enabled) {
    setForm((current) => ({
      ...current,
      snapDeliveryMode: enabled ? announcementAudience : 'DISABLED',
    }));
  }

  function setAnnouncementDelivery(value) {
    setAnnouncementAudience(value);
    setForm((current) => ({ ...current, snapDeliveryMode: value }));
  }

  return <Page
    className="organiser-create-page"
    title="Create event"
    actions={<BackLink onClick={() => setCreating(false)}>Back to events</BackLink>}
  >
    <ErrorBox error={error} />
    {error?.code === 'TOKEN_MAPPING_MISMATCH' && <button type="button" className="button secondary compact"
      onClick={() => void refreshCatalogue()} disabled={catalogue.loading}>Refresh token mapping</button>}
      <form className="form create-event-form" onSubmit={submit}>
        {catalogue.loading && <p role="status">Loading token catalogue...</p>}
        <ErrorBox error={catalogue.error} />
        {catalogue.error && <button type="button" className="button secondary compact" onClick={() => void catalogue.reload().catch(() => {})}>Retry catalogue</button>}
        <IssuerBrandingFields form={form} setForm={setForm} file={issuerLogoFile} setFile={setIssuerLogoFile}
          disabled={Boolean(busyStage)} catalogue={catalogue.data} />
        {selection && !selection.configured && <Notice tone="warning">This token mapping is not configured yet. Update its address in apps/api/src/token-catalogue.js before creating an event.</Notice>}
        <section className="create-event-section">
          <header className="create-event-section-heading create-details-heading">
            <div><h2>Event details</h2>
              <p>Choose the ERC-20 token and describe the voting event shown to eligible holders.</p></div>
            <button className="button secondary compact" type="button" onClick={fillDemoData}
              disabled={Boolean(busyStage)} title="Fill demo fields without replacing the token, issuer or PDFs">Auto fill dummy data</button>
          </header>

          <div className="field-grid create-token-grid">
            <label className="create-token-address-field"><span className="field-label">ERC-20 token address<RequiredMark /></span><div className="create-token-input">
              <input
                value={form.tokenAddress}
                readOnly
                aria-label="ERC-20 token address from selected catalogue mapping"
                placeholder="Select an issuer and platform above"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                required
              />
              <button
                type="button"
                className="create-token-inspect-button"
                onClick={inspect}
                disabled={!selection?.configured || inspectBusy}
                aria-busy={inspectBusy}
                aria-label="Inspect ERC-20 token"
                title="Inspect ERC-20 token"
              >
                <SearchIcon />
                <span className="sr-only">Inspect ERC-20 token</span>
              </button>
            </div></label>
            <label><span className="field-label">Token-to-vote ratio<RequiredMark /></span><input
              type="number"
              min="1"
              step="1"
              value={form.tokenToVoteRatio}
              onChange={(event) => setForm({ ...form, tokenToVoteRatio: event.target.value })}
              required
            /></label>
          </div>

          {(token || inspectError || inspectBusy) && <div className="create-token-feedback">
            {inspectBusy && <Notice>Inspecting token on Polygon Amoy…</Notice>}
            {token && <Notice tone="success">
              {token.name} ({token.symbol}), {token.decimals} decimals. Standard ERC-20 interface confirmed.
            </Notice>}
            <ErrorBox error={inspectError} />
          </div>}

          <div className="field-grid create-copy-grid">
            <label><span className="field-label">Event title<RequiredMark /></span><input maxLength={180} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label>
            <label>Description<textarea maxLength={8000} rows="2" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Explain the purpose of the vote and any context holders should know." /></label>
          </div>
        </section>

        <section className="create-event-section">
          <header className="create-event-section-heading">
            <h2>Schedule &amp; access</h2>
            <p>Set the record date, voting window, discovery rules, and communication audience.</p>
          </header>

          <div className="field-grid three create-schedule-grid">
            <label><span className="field-label">Record date<RequiredMark /></span><input
              type="datetime-local"
              value={form.recordDateAt}
              onChange={(event) => setForm({ ...form, recordDateAt: event.target.value })}
              required
            /><small>{recordDateIsFuture
              ? 'The snapshot and deployment start automatically after this time reaches Polygon finality.'
              : 'Balances are captured at the latest confirmed block at or before this time.'}</small></label>
            <label><span className="field-label">Voting starts<RequiredMark /></span><input type="datetime-local" value={form.votingStartAt} onChange={(event) => setForm({ ...form, votingStartAt: event.target.value })} required /></label>
            <label><span className="field-label">Voting ends<RequiredMark /></span><input type="datetime-local" value={form.votingEndAt} onChange={(event) => setForm({ ...form, votingEndAt: event.target.value })} required /></label>
          </div>
          <div className="field-grid three create-policy-grid">
            <label><span className="field-label">Authenticity<RequiredMark /></span><select required value={form.authenticityClaim} onChange={(event) => setForm({ ...form, authenticityClaim: event.target.value })}>
              <option value="COMMUNITY">Community-created</option>
              <option value="ISSUER_AUTHORIZED">Issuer-authorized claim</option>
            </select></label>
            <label><span className="field-label">Discovery<RequiredMark /></span><select required value={form.discoveryMode} onChange={(event) => setForm({ ...form, discoveryMode: event.target.value })}>
              <option value="PUBLIC_ELIGIBLE">Eligible holders</option>
              <option value="SUBSCRIBERS_ONLY">Subscribed holders</option>
              <option value="DIRECT_LINK">Direct link only</option>
            </select></label>
            <label><span className="field-label">Announcement audience{announcementEnabled && <RequiredMark />}</span><select
              required={announcementEnabled}
              value={announcementEnabled ? form.snapDeliveryMode : announcementAudience}
              onChange={(event) => setAnnouncementDelivery(event.target.value)}
              disabled={!announcementEnabled}
            >
              <option value="ELIGIBLE">Eligible holders</option>
              <option value="SUBSCRIBERS_ONLY">Subscribers only</option>
            </select></label>
          </div>
        </section>

        <section className="create-event-section">
          <header className="create-event-section-heading">
            <h2>Proxy voting documents</h2>
            <p>Optionally attach up to three PDFs, with a maximum size of 10 MB each.</p>
          </header>
          <div className="optional-upload create-documents-row">
            <div>
              <strong>Supporting material</strong>
              <small>PDF only - up to 3 files - 10 MB per file</small>
            </div>
            <label className="button secondary file-button">
              {documents.length ? `${documents.length} PDF${documents.length === 1 ? '' : 's'} selected` : 'Select PDFs'}
              <input type="file" accept="application/pdf,.pdf" multiple onChange={chooseDocuments} disabled={Boolean(busyStage)} />
            </label>
          </div>
          <DocumentSelection
            files={documents}
            disabled={Boolean(busyStage)}
            onRemove={(index) => setDocuments((current) => current.filter((_file, position) => position !== index))}
          />
          <div className={`automatic-notice-row${announcementEnabled ? '' : ' is-disabled'}`}>
            <span className="automatic-notice-icon"><AnnouncementIcon /></span>
            <div>
              <strong>Automatic event announcement</strong>
              <small>{announcementEnabled
                ? `Published after deployment to ${deliveryLabel}. No additional MetaMask signature is required.`
                : 'No event announcement will be published after deployment.'}</small>
            </div>
            <label className="announcement-switch" title={`Automatic event announcement: ${announcementEnabled ? 'On' : 'Off'}`}>
              <input
                type="checkbox"
                role="switch"
                checked={announcementEnabled}
                onChange={(event) => setAnnouncementEnabled(event.target.checked)}
                aria-label="Automatic event announcement"
              />
              <span className="announcement-switch-track" aria-hidden="true"><span /></span>
              <span className="announcement-switch-state">{announcementEnabled ? 'On' : 'Off'}</span>
            </label>
          </div>
        </section>

        <section className="create-event-section">
          <header className="create-event-section-heading">
            <h2>Proposals</h2>
            <p>Define each resolution, its available options, and an optional recommendation.</p>
          </header>
          <ProposalEditor proposals={form.proposals} onChange={(proposals) => setForm({ ...form, proposals })} />
        </section>

        <ErrorBox error={error} />
        <footer className="create-event-submit-row">
          <div>
            <strong>Ready to create the event?</strong>
            <span>{recordDateIsFuture
              ? 'The event is saved now; snapshot processing starts automatically after the record date.'
              : 'Snapshot processing and deployment continue in the background.'}</span>
          </div>
          <button className="button" disabled={Boolean(busyStage) || !selection?.configured}>
            {busyStage || 'Create Event'}
          </button>
        </footer>
      </form>
  </Page>;
}

export function OrganiserEventPage() {
  const { eventId } = useParams();
  const location = useLocation();
  const wallet = useWallet();
  const view = useLoad(
    () => api(`/v1/events/${eventId}/organiser-view${wallet.account ? `?wallet=${wallet.account}` : ''}`, { auth: false }),
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
  const now = useDeadlineClock(view.data?.votingStartAt, view.data?.votingEndAt);
  const progress = eventProgress(view.data, now);
  const jobAvailableAt = progress.availableAt;
  const jobWaitingForRecordDate = progress.waitingForRecordDate;
  const jobActive = progress.active;
  useEventLiveRefresh(
    view.refresh,
    eventId,
    Boolean(jobActive || progress.verificationActive),
    2_000,
    jobWaitingForRecordDate ? progress.buildJob.availableAt : null,
  );

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    setRetrySuccess(null);
    try {
      if (!wallet.account) throw new Error('Connect the event creator wallet first.');
      await api(`/v1/events/${eventId}/retry`, {
        method: 'POST',
        auth: false,
        body: { publisherAddress: wallet.account },
      });
      await view.reload();
      setRetrySuccess(progress.ready
        ? 'Explorer verification recheck queued. The deployed event and snapshot are unchanged.'
        : 'Retry queued successfully. Processing will resume from the last safe step.');
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
    const input = event.currentTarget;
    const selected = Array.from(input.files ?? []);
    input.value = '';
    if (!selected.length) return;
    try {
      setDocumentFiles(appendPdfSelection(documentFiles, selected, view.data?.documents?.length ?? 0));
      setDocumentFeedback(null);
    } catch (value) {
      setDocumentFeedback({ tone: 'error', message: value.message });
    }
  }

  async function uploadDocuments() {
    if (!documentFiles.length || documentBusy) return;
    setDocumentBusy(true);
    setDocumentFeedback(null);
    try {
      if (!wallet.account) throw new Error('Connect the event creator wallet first.');
      for (const file of documentFiles) {
        await uploadEventPdf(eventId, file, wallet.account);
        setDocumentFiles((current) => current.filter((item) => item !== file));
      }
      await view.reload();
      setDocumentFeedback({ tone: 'success', message: 'Proxy voting documents uploaded successfully.' });
    } catch (error) {
      await view.reload().catch(() => {});
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
      if (!wallet.account) throw new Error('Connect the event creator wallet first.');
      await api(`/v1/events/${eventId}/documents/${documentId}?wallet=${encodeURIComponent(wallet.account)}`, {
        method: 'DELETE',
        auth: false,
      });
      await view.reload();
      setDocumentFeedback({ tone: 'success', message: 'Document removed.' });
    } catch (error) {
      setDocumentFeedback({ tone: 'error', message: error.message });
    } finally {
      setDocumentBusy(false);
    }
  }

  async function publishAnnouncement() {
    if (announcementBusy || !wallet.account) return;
    setAnnouncementBusy(true);
    setAnnouncementFeedback(null);
    try {
      const result = await api(`/v1/events/${eventId}/announcement`, {
        method: 'POST',
        auth: false,
        body: { publisherAddress: wallet.account },
      });
      await view.reload();
      setAnnouncementFeedback({
        tone: 'success',
        message: result.redelivered
          ? 'Event announcement delivery retried for browser and MetaMask inbox channels.'
          : result.status === 'PUBLISHED'
            ? 'Event announcement published successfully. No wallet signature was required.'
            : 'The announcement remains queued until deployment completes.',
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
  const canRetry = progress.canRetryBuild;
  const documentSlots = Math.max(0, MAX_DOCUMENTS - (event.documents?.length ?? 0));
  const canPublishAnnouncement = event.contractReady
    && ['QUEUED', 'PUBLISHED'].includes(event.announcementStatus);
  const announcementHeading = event.announcementStatus === 'PUBLISHED'
    ? 'Announcement published'
    : event.contractReady
      ? 'Ready to publish'
      : 'Scheduled automatically';
  const announcementMessage = event.announcementStatus === 'PUBLISHED'
    ? 'The platform-issued event notice is available in Notifications. Retry delivery if a browser or MetaMask alert was interrupted.'
    : event.contractReady
      ? 'Automatic publication can be retried from this issuer session without a wallet signature.'
      : 'The platform will publish this event notice automatically after the VoteEvent contract is deployed.';

  return <Page
    title={event.title}
    intro={`${event.tokenName} (${event.tokenSymbol})`}
    actions={<BackLink to="/organiser">Back to events</BackLink>}
  >
    {visibleCreationNotice(event, location.state?.notice) && <Notice tone="success">{visibleCreationNotice(event, location.state.notice)}</Notice>}
    {location.state?.warning && <Notice>{location.state.warning}</Notice>}

    <Panel title="Event status">
      <div className="status-line">
        <Status value={progress.ready ? 'COMPLETED' : event.status} label={progress.ready ? 'Completed' : undefined} />
        <span>{progress.message}</span>
      </div>
      {jobWaitingForRecordDate && <Notice>
        The record-date snapshot is scheduled for {new Date(jobAvailableAt).toLocaleString()}.
        It will start automatically once that time is confirmation-safe on Polygon.
      </Notice>}
      {!progress.ready && jobActive && <div className="job-progress">
        <div><span>{progress.message}</span><strong>{progress.progress}%</strong></div>
        <progress value={progress.progress} max="100" />
      </div>}
      {!progress.ready && event.failureReason && <Notice tone="error">{event.failureReason}</Notice>}
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
        {progress.ready && <div><dt>Voting status</dt><dd><Status value={meetingLifecycle(event, now)} /></dd></div>}
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
      {progress.ready && event.verificationStatus !== 'VERIFIED' && <div className="verification-background-notice" role="status">
        <p>{event.verificationStatus === 'FAILED'
          ? 'The event is ready. Explorer source publication needs a recheck; it does not invalidate the deployed contract.'
          : event.verificationStatus === 'PENDING'
            ? 'The event is ready. Source verification continues separately in the background.'
            : 'Explorer source verification has not been submitted. Deployment is complete.'}</p>
        {event.verificationStatus === 'FAILED' && <button className="button secondary compact" type="button" onClick={retry} disabled={retrying}>
          {retrying ? 'Queuing recheck...' : 'Recheck source verification'}
        </button>}
      </div>}
      {event.verificationError && <Notice>{event.verificationError}</Notice>}
    </Panel>

    {!['DISABLED', 'NOT_CONFIGURED'].includes(event.announcementStatus) && <Panel
      title="Automatic event announcement"
      className="announcement-panel"
    >
      <div className="announcement-card-layout">
        <span className="announcement-card-icon"><AnnouncementIcon /></span>
        <div className="announcement-card-copy">
          <div className="announcement-card-title-line">
            <Status value={event.announcementStatus} />
            <h3>{announcementHeading}</h3>
          </div>
          <p>{announcementMessage}</p>
        </div>
        {canPublishAnnouncement && <button
          className="button secondary announcement-card-action"
          onClick={publishAnnouncement}
          disabled={announcementBusy}
        >{announcementBusy
          ? 'Publishing…'
          : event.announcementStatus === 'PUBLISHED'
            ? 'Retry delivery'
            : 'Publish now'}</button>}
      </div>
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
      {documentSlots > 0 && <div className="document-upload-callout">
        <span className="document-upload-icon"><DocumentIcon /></span>
        <div>
          <strong>Add supporting PDFs</strong>
          <small>{documentSlots} document slot{documentSlots === 1 ? '' : 's'} available - 10 MB maximum per PDF</small>
        </div>
        <label className="button secondary compact file-button">
          Select PDF{documentSlots > 1 ? 's' : ''}
          <input type="file" accept="application/pdf,.pdf" multiple={documentSlots > 1} onChange={chooseAdditionalDocuments} disabled={documentBusy} />
        </label>
      </div>}
      <DocumentSelection
        files={documentFiles}
        disabled={documentBusy}
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
