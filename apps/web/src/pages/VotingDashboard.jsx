import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ballotTypedData } from '@pv/shared';
import { API_BASE_URL, api, apiBlob, saveBlob } from '../api.js';
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

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function CopyIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4.5V3.25A1.25 1.25 0 0 1 6.75 2h6A1.25 1.25 0 0 1 14 3.25v6a1.25 1.25 0 0 1-1.25 1.25H11.5M3.25 5.5h6A1.25 1.25 0 0 1 10.5 6.75v6A1.25 1.25 0 0 1 9.25 14h-6A1.25 1.25 0 0 1 2 12.75v-6A1.25 1.25 0 0 1 3.25 5.5Z" /></svg>;
}

function WalletIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h8.75A1.75 1.75 0 0 1 13 5.25V6h.75A1.25 1.25 0 0 1 15 7.25v2.5A1.25 1.25 0 0 1 13.75 11H13v.75a1.75 1.75 0 0 1-1.75 1.75H2.5A1.5 1.5 0 0 1 1 12V5a1.5 1.5 0 0 1 1.5-1.5Zm10.25 4h-2a1 1 0 1 0 0 2h2a.75.75 0 0 0 .75-.75v-.5a.75.75 0 0 0-.75-.75Z" /></svg>;
}

function ClockIcon() {
  return <svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7" /><path d="M9 5v4l2.5 1.5" /></svg>;
}

function DashboardEmptyIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6.75 5.5h10.5v12H6.75zM4.5 17.5h15M9.25 12l1.75 1.75L15.25 9.5" />
  </svg>;
}

function boardRecommendedChoices(proposals) {
  if (!Array.isArray(proposals) || proposals.length === 0) return null;

  const choices = proposals.map((proposal) => proposal?.recommendation);
  const allProposalsRecommended = choices.every((recommendation, proposalIndex) => (
    Number.isInteger(recommendation)
    && recommendation >= 0
    && Array.isArray(proposals[proposalIndex]?.options)
    && recommendation < proposals[proposalIndex].options.length
  ));

  return allProposalsRecommended ? choices : null;
}

export default function VotingDashboard() {
  const { account, connected, openWallet } = useWallet();
  const events = useLoad(
    () => (account
      ? api(`/v1/dashboard/voting?wallet=${account}`, { auth: false })
      : Promise.resolve([])),
    [account],
  );

  return <Page title="Voting Dashboard">
    {!connected && <section className="wallet-gate-card">
      <span className="wallet-gate-icon"><WalletIcon /></span>
      <h2>Connect your wallet to continue</h2>
      <p>Connect your wallet to see live voting events and your voting power for each one.</p>
      <button className="button" onClick={openWallet}>Connect wallet</button>
    </section>}
    <ErrorBox error={events.error} />
    {events.loading && connected ? <Spinner /> : null}
    {connected && !events.loading && !events.data?.length
      ? <section className="dashboard-empty-state">
          <span className="dashboard-empty-icon"><DashboardEmptyIcon /></span>
          <h2>No live voting events</h2>
          <p>There are no ongoing events with a deployed contract right now.<br />Once an organizer takes a snapshot and deploys a VoteEvent, it will appear here.</p>
        </section>
      : null}
    <div className="card-grid voting-card-grid">{events.data?.map((event) => <EventCard
      key={event.id}
      event={event}
      variant="voting"
      to={`/vote/${event.id}`}
      action={event.eligibility?.hasVoted ? 'View receipt' : 'Open ballot'}
    />)}</div>
  </Page>;
}

function EventDocuments({ event }) {
  if (!event.documents?.length) return null;
  return <Panel title="Proxy voting documents" className="ballot-documents">
    <p className="muted">Review the organiser-provided documents before submitting your ballot.</p>
    <div className="document-link-list">
      {event.documents.map((document) => <div key={document.id}>
        <div>
          <strong>{document.fileName}</strong>
          <small>{document.pageCount} page{document.pageCount === 1 ? '' : 's'}</small>
        </div>
        <div className="row wrap">
          <a
            className="button tertiary compact"
            href={`${API_BASE_URL}/v1/events/${event.id}/documents/${document.id}`}
            target="_blank"
            rel="noreferrer"
          >Open</a>
          <a
            className="button tertiary compact"
            href={`${API_BASE_URL}/v1/events/${event.id}/documents/${document.id}?download=1`}
          >Download</a>
        </div>
      </div>)}
    </div>
  </Panel>;
}

function Receipt({ event, vote }) {
  const wallet = useWallet();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const verifiedContractUrl = event.verificationStatus === 'VERIFIED'
    ? event.contractExplorerUrl
    : null;

  async function downloadReceipt() {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      if (!wallet.account) throw new Error('Connect the voting wallet before downloading its receipt.');
      const blob = await apiBlob(
        `/v1/events/${event.id}/reports/receipt?wallet=${encodeURIComponent(wallet.account)}`,
        { auth: false },
      );
      saveBlob(blob, `${event.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-vote-receipt.pdf`);
    } catch (error) {
      setDownloadError(error);
    } finally {
      setDownloading(false);
    }
  }

  return <Panel title={vote.status === 'CONFIRMED' ? 'Vote recorded' : 'Vote submitted'} className="receipt receipt-panel">
    <div className="row between wrap receipt-toolbar">
      <Status value={vote.status} />
      {verifiedContractUrl && <button
        className="button secondary compact"
        onClick={downloadReceipt}
        disabled={downloading}
      >
        {downloading && <span className="button-spinner" aria-hidden="true" />}
        {downloading ? 'Generating receipt…' : 'Download receipt'}
      </button>}
    </div>
    <dl className="details receipt-details">
      <div><dt>Voting power</dt><dd><strong className="voting-power-emphasis">{vote.votingPower}</strong></dd></div>
      <div><dt>Transaction</dt><dd>{vote.transactionHash
        ? <a href={vote.transactionExplorerUrl} target="_blank" rel="noreferrer"><ShortAddress value={vote.transactionHash} /></a>
        : <span className="inline-working"><span className="inline-spinner" />Waiting for relayer</span>}</dd></div>
      <div><dt>VoteEvent</dt><dd>{verifiedContractUrl
        ? <a href={verifiedContractUrl} target="_blank" rel="noreferrer"><ShortAddress value={event.contractAddress} /></a>
        : 'Verification pending'}</dd></div>
      <div><dt>Source</dt><dd>{event.verificationStatus === 'VERIFIED'
        ? 'Verified on PolygonScan'
        : event.verificationStatus.replaceAll('_', ' ')}</dd></div>
    </dl>
    {vote.failureReason && <Notice tone="error">{vote.failureReason}</Notice>}
    <ErrorBox error={downloadError} />
  </Panel>;
}

function VotingPowerCard({ event, wallet, copied, onCopy, onAddToken }) {
  const votingPower = event.vote?.votingPower ?? event.eligibility?.votingPower;
  if (!wallet.connected || !votingPower) return null;

  return <section className="voting-power-card">
    <span className="voting-power-label">Voting power</span>
    <div className="voting-power-value">
      <strong>{votingPower}</strong>
      <span>On-chain {event.tokenSymbol} votes</span>
    </div>
    <p>Wallet: {wallet.account ? `${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}` : '—'}</p>

    <div className="token-wallet-card">
      <div className="token-wallet-row">
        <div>
          <span>{event.tokenSymbol} token address</span>
          <strong>{event.tokenAddress ? `${event.tokenAddress.slice(0, 8)}…${event.tokenAddress.slice(-4)}` : '—'}</strong>
        </div>
        <button className="button secondary compact icon-label-button" type="button" onClick={onCopy}>
          <CopyIcon />{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <button className="button secondary token-add-button" type="button" onClick={onAddToken}>
        <WalletIcon />Add to Wallet
      </button>
    </div>
  </section>;
}

export function VoteEventPage() {
  const { eventId } = useParams();
  const wallet = useWallet();
  const { account, connected, openWallet, signBallot } = wallet;
  const view = useLoad(
    () => (account
      ? api(`/v1/events/${eventId}/view?wallet=${encodeURIComponent(account)}`, { auth: false })
      : Promise.resolve(null)),
    [eventId, account],
  );
  const event = view.data;
  const [choices, setChoices] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [walletActionError, setWalletActionError] = useState(null);
  const submitRowRef = useRef(null);

  useEffect(() => {
    setChoices(event?.proposals?.map(() => null) ?? []);
  }, [account, event?.metadataHash, eventId]);

  const jobActive = ['PENDING', 'RUNNING'].includes(event?.job?.status);
  const voteActive = ['QUEUED', 'SUBMITTED'].includes(event?.vote?.status);
  const shouldRefresh = Boolean(jobActive || voteActive || event?.verificationStatus === 'PENDING');
  useEventLiveRefresh(view.refresh, eventId, shouldRefresh);
  const complete = useMemo(
    () => choices.length > 0 && choices.every(Number.isInteger),
    [choices],
  );
  const boardChoices = useMemo(
    () => boardRecommendedChoices(event?.proposals),
    [event?.proposals],
  );

  function voteWithBoard() {
    if (!boardChoices || submitting) return;

    setChoices([...boardChoices]);
    window.requestAnimationFrame(() => {
      submitRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  async function submit() {
    if (!account || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const ballot = await api(`/v1/events/${eventId}/ballot?wallet=${account}`, { auth: false });
      if (ballot.alreadyVoted) {
        await view.reload();
        return;
      }
      const typed = ballotTypedData({
        chainId: ballot.chainId,
        contractAddress: ballot.contractAddress,
        voter: account,
        choices,
        ballotVersion: ballot.ballotVersion,
      });
      const signature = await signBallot(typed);
      const vote = await api(`/v1/events/${eventId}/votes`, {
        method: 'POST',
        auth: false,
        body: { voterAddress: account, choices, signature },
      });
      view.setData({
        ...event,
        vote,
        eligibility: { ...event.eligibility, hasVoted: true },
      });
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function copyTokenAddress() {
    if (!event.tokenAddress) return;
    setWalletActionError(null);
    try {
      await navigator.clipboard.writeText(event.tokenAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      setCopied(false);
      setWalletActionError(error);
    }
  }

  async function addTokenToWallet() {
    setWalletActionError(null);
    try {
      if (!wallet.walletProvider?.request || !event.tokenAddress) {
        throw new Error('Connect MetaMask before adding this token.');
      }
      await wallet.walletProvider.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: event.tokenAddress,
            symbol: event.tokenSymbol,
            decimals: Number.isInteger(event.tokenDecimals) ? event.tokenDecimals : 18,
          },
        },
      });
    } catch (error) {
      setWalletActionError(error);
    }
  }

  if (!connected || !account) return <Page title="Voting Dashboard">
    <section className="wallet-gate-card">
      <span className="wallet-gate-icon"><WalletIcon /></span>
      <h2>Connect an eligible wallet</h2>
      <p>Only wallets with voting power in this event's record-date snapshot can view the ballot.</p>
      <button className="button" onClick={openWallet}>Connect wallet</button>
    </section>
  </Page>;
  if (view.loading) return <Page title="Voting Dashboard"><Spinner /></Page>;
  if (view.error?.code === 'NOT_ELIGIBLE') return <Page
    title="Voting Dashboard"
    actions={<Link className="button secondary" to="/voting">Back to dashboard</Link>}
  >
    <Notice>This wallet has no voting power in the record-date snapshot and cannot view this ballot.</Notice>
  </Page>;
  if (view.error) return <Page title="Voting Dashboard"><ErrorBox error={view.error} /></Page>;

  const voted = Boolean(event.vote || event.eligibility?.hasVoted || event.eligibility?.onChainOnly);
  const stateLabel = voted
    ? 'Vote recorded'
    : event.status === 'SCHEDULED'
      ? 'Not started'
      : event.status === 'OPEN'
        ? 'Voting open'
        : event.status === 'CLOSED'
          ? 'Voting closed'
          : 'Event preparation';

  return <main className="page vote-event-page">
    <div className="page-back-row"><Link to="/voting">← Back to dashboard</Link></div>

    <header className="vote-event-heading">
      <h1>{event.title}</h1>
      <p>Voting open {formatDate(event.votingStartAt)} — {formatDate(event.votingEndAt)}</p>
    </header>

    <div className="vote-content-frame">
    {!event.metadataIntegrity && <Notice tone="error">
      Event metadata does not match the hash committed to the contract. Voting is disabled.
    </Notice>}

    {jobActive && event.deploymentBlock === null && <Panel title="Event preparation" className="event-preparation-panel">
      <div className="status-line"><Status value={event.status} /><span>{event.job?.message}</span></div>
      <div className="job-progress">
        <div><span>{event.job?.message}</span><strong>{event.job?.progress ?? 0}%</strong></div>
        <progress value={event.job?.progress ?? 0} max="100" />
      </div>
    </Panel>}

    <VotingPowerCard
      event={event}
      wallet={wallet}
      copied={copied}
      onCopy={copyTokenAddress}
      onAddToken={addTokenToWallet}
    />
    <ErrorBox error={walletActionError} />

    <div className={`vote-state-banner vote-state-${event.status.toLowerCase()}`}>
      <div><ClockIcon /><strong>{stateLabel}</strong></div>
      <span>{event.status === 'CLOSED' ? 'Closed' : 'Vote by'} {formatDate(event.votingEndAt)}</span>
    </div>

    {event.failureReason && <Notice tone="error">{event.failureReason}</Notice>}
    {event.lastVoteFailure && <Notice tone="error">
      Previous relay attempt failed: {event.lastVoteFailure}. You may submit the ballot again.
    </Notice>}

    <EventDocuments event={event} />
    {event.vote && event.vote.status !== 'FAILED' ? <Receipt event={event} vote={event.vote} /> : null}

    {!event.vote && !connected ? <Panel><Empty>
      <p>Connect the eligible wallet to view this ballot.</p>
      <button className="button" onClick={openWallet}>Connect wallet</button>
    </Empty></Panel> : null}
    {!event.vote && connected && event.eligibility && !event.eligibility.eligible
      ? <Notice>This wallet was not eligible at the record date.</Notice>
      : null}
    {!event.vote && event.eligibility?.onChainOnly ? <Panel title="Vote recorded" className="receipt">
      <Status value="CONFIRMED" />
      <p>This wallet is already marked as voted by the VoteEvent contract. The ballot is locked; a local transaction receipt was not available in Neon.</p>
    </Panel> : null}
    {!event.vote && event.status === 'CLOSED'
      ? <Notice>Voting is closed. <Link to={`/results/${event.id}`}>View results</Link>.</Notice>
      : null}

    {!event.vote
      && !event.eligibility?.hasVoted
      && event.status === 'OPEN'
      && event.eligibility?.eligible
      && event.metadataIntegrity
      ? <section className="ballot-shell">
        <header className="ballot-shell-heading">
          <div><span>Official ballot</span><h2>Cast your vote</h2></div>
          <div><span>Voting power</span><strong>{event.eligibility.votingPower}</strong></div>
        </header>
        <div className="ballot-meta">
          <span>Record date <strong>{formatDate(event.recordDateAt)}</strong></span>
          <span>Voting closes <strong>{formatDate(event.votingEndAt)}</strong></span>
          {boardChoices && <button
            type="button"
            className="button secondary compact"
            style={{ marginInlineStart: 'auto' }}
            disabled={submitting}
            onClick={voteWithBoard}
          >Vote with Board</button>}
        </div>
        <div className="proposal-stack">
          {event.proposals.map((proposal, proposalIndex) => <fieldset
            key={proposal.index ?? proposalIndex}
            className="proposal ballot-proposal"
          >
            <legend>{proposalIndex + 1}. {proposal.title}</legend>
            {proposal.description && <p>{proposal.description}</p>}
            <div className="ballot-options">
              {proposal.options.map((option, optionIndex) => <label
                key={option.index ?? optionIndex}
                className="option"
              >
                <input
                  type="radio"
                  name={`proposal-${proposalIndex}`}
                  checked={choices[proposalIndex] === optionIndex}
                  onChange={() => setChoices((current) => current.map((value, index) => (
                    index === proposalIndex ? optionIndex : value
                  )))}
                />
                <span>{option.text ?? option}</span>
                {proposal.recommendation === optionIndex && <small>Board recommendation</small>}
              </label>)}
            </div>
          </fieldset>)}
        </div>
        <ErrorBox error={submitError} />
        <footer ref={submitRowRef} className="ballot-submit-row">
          <p>MetaMask requests one final-ballot signature. The Render relayer pays POL.</p>
          <button className="button" disabled={!complete || submitting} onClick={submit}>
            {submitting ? 'Signing and submitting…' : 'Submit final vote'}
          </button>
        </footer>
      </section>
      : null}
    </div>
  </main>;
}
