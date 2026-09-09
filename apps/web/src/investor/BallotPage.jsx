import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ballotTypedData } from '@pv/shared';
import { API_BASE_URL, api } from '../api.js';
import { useEventLiveRefresh, useEventPolling, useLoad } from '../hooks.js';
import { useWallet } from '../wallet.jsx';
import BackLink from '../components/BackLink.jsx';
import ResourceSkeleton from '../components/ResourceSkeleton.jsx';
import { useInvestorData, useInvestorResource } from './InvestorData.jsx';
import { useDeadlineClock } from '../data/useDeadlineClock.js';
import { meetingLifecycle } from './meeting-utils.js';
import { useInvestorSession } from './InvestorSession.jsx';
import { ArrowIcon, DocumentIcon, ErrorMessage, InvestorFrame, MeetingIdentity, StandingDisclosure } from './InvestorFrame.jsx';
import { boardRecommendedChoices, completeChoices, displayDate, displayHolding } from './meeting-utils.js';

export function EventDocuments({ event }) {
  if (!event.documents?.length) return null;
  return <section className="investor-documents" aria-labelledby="review-documents-heading">
    <h2 id="review-documents-heading"><span>Documents to Review Before You Vote:</span> <Link className="investor-help-link" to="/education" aria-label="Learn about proxy voting documents"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5" /><circle cx="12" cy="18" r="1" /></svg></Link></h2>
    <div className="investor-document-grid" data-count={event.documents.length}>{event.documents.map((document) => <a key={document.id}
      href={`${API_BASE_URL}/v1/events/${event.id}/documents/${document.id}`} target="_blank" rel="noopener noreferrer">
      <DocumentIcon /><span>{document.fileName}<small>PDF - {document.pageCount} page{document.pageCount === 1 ? '' : 's'}</small></span><ArrowIcon />
    </a>)}</div>
  </section>;
}

export function useInvestorEvent(eventId) {
  const view = useInvestorResource(`event:${eventId}`);
  const active = ['QUEUED', 'SUBMITTED'].includes(view.data?.vote?.status) || ['PENDING', 'RUNNING'].includes(view.data?.job?.status);
  useEventLiveRefresh(view.refresh, eventId, active);
  useEventPolling(view.refresh, !active, 10_000);
  return view;
}

export default function BallotPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const wallet = useWallet();
  const { session } = useInvestorSession();
  const view = useInvestorEvent(eventId);
  const { acceptedVote } = useInvestorData();
  const event = view.data;
  const holdings = useLoad(() => api(`/v1/investor/events/${eventId}/holding`, { issuerAuth: false }), [eventId, session.walletAddress]);
  const [choices, setChoices] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const now = useDeadlineClock(event?.votingStartAt, event?.votingEndAt);
  const lifecycle = meetingLifecycle(event, now);
  const submitRowRef = useRef(null);
  const inFlight = useRef(false);
  const activeWallet = useRef(wallet.account);
  activeWallet.current = wallet.account;
  useEffect(() => { setChoices(event?.proposals?.map(() => null) ?? []); }, [event?.metadataHash, eventId, session.walletAddress]);
  useEffect(() => {
    if (event?.vote && event.vote.status !== 'FAILED') navigate(`/vote/${eventId}/confirmation`, { replace: true });
  }, [event?.vote?.status, eventId, navigate]);
  const boardChoices = useMemo(() => boardRecommendedChoices(event?.proposals), [event?.proposals]);
  const canVote = Boolean(event?.metadataIntegrity && event?.contractReady && event?.eligibility?.eligible && !event?.eligibility?.hasVoted
    && now >= Date.parse(event.votingStartAt) && now <= Date.parse(event.votingEndAt)
    && (!event.vote || event.vote.status === 'FAILED'));
  const complete = completeChoices(event?.proposals, choices);

  function voteWithBoard() {
    if (!boardChoices || !canVote || submitting) return;
    setChoices([...boardChoices]);
    window.requestAnimationFrame(() => {
      submitRowRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      submitRowRef.current?.focus({ preventScroll: true });
    });
  }

  async function submit(eventObject) {
    eventObject.preventDefault();
    if (inFlight.current || !complete || !canVote) return;
    inFlight.current = true; setSubmitting(true); setError(null);
    const voter = session.walletAddress;
    try {
      if (!wallet.connected) {
        // Reconnect through the existing Submit action; never sign while disconnected.
        await wallet.openWallet();
        return;
      }
      if (wallet.account !== voter) throw new Error('Connect the signed-in investor wallet before submitting this ballot.');
      const ballot = await api(`/v1/investor/events/${eventId}/ballot`, { issuerAuth: false });
      if (ballot.alreadyVoted) { navigate(`/vote/${eventId}/confirmation`, { replace: true }); return; }
      if (ballot.metadataHash !== event.metadataHash || ballot.contractAddress !== event.contractAddress) {
        throw new Error('The meeting configuration changed. Refresh and review it before signing.');
      }
      const typed = ballotTypedData({ chainId: ballot.chainId, contractAddress: ballot.contractAddress,
        voter, choices, proposals: ballot.proposals, ballotVersion: ballot.ballotVersion });
      const signature = await wallet.signBallot(typed);
      if (activeWallet.current !== voter) throw new Error('Your wallet account changed while signing. Sign in again before voting.');
      const vote = await api(`/v1/investor/events/${eventId}/votes`, { method: 'POST', issuerAuth: false,
        body: { voterAddress: voter, choices, signature } });
      acceptedVote(eventId, vote);
      navigate(`/vote/${eventId}/confirmation`, { replace: true });
    } catch (value) { setError(value); }
    finally { inFlight.current = false; setSubmitting(false); }
  }

  return <InvestorFrame event={event} hideNavigation><div className="investor-page-width investor-ballot-page">
    <BackLink to="/meetings?tab=active">Back to my meetings</BackLink>
    <ErrorMessage error={view.error} />
    {view.loading && <ResourceSkeleton label="Loading meeting" rows={2} />}
    {event && <>
      <MeetingIdentity event={event} />
      <div className="investor-ballot-status"><strong>{lifecycle === 'CLOSED' ? 'Voting closed' : lifecycle === 'SCHEDULED' ? 'Voting scheduled' : 'Not Voted'}</strong>
        <p>{lifecycle === 'SCHEDULED' ? `Voting opens ${displayDate(event.votingStartAt)}` : `Vote by ${displayDate(event.votingEndAt)}`}</p></div>
      <EventDocuments event={event} />
      {event.eligibility.onChainOnly && <p className="investor-info-note">This wallet has already voted on-chain. The service has not indexed a local receipt for that transaction yet. Voting again is disabled.</p>}
      {!event.metadataIntegrity && <ErrorMessage error={new Error('The proposal details failed their integrity check. Voting is disabled.')} />}
      {event.vote?.status === 'FAILED' && <ErrorMessage error={new Error(event.vote.failureReason || 'The last vote attempt failed. Review and submit again.')} />}
      <form onSubmit={submit}>
        <section className="investor-ballot" aria-labelledby="proposal-heading">
          <header className="investor-ballot-heading"><div><h2 id="proposal-heading">Proposal(s)</h2>
            <p>For holders as of {displayDate(event.recordDateAt)}. Confirmed votes cannot be changed.</p></div>
            {boardChoices && canVote && <button type="button" className="inv-button light investor-board-button" disabled={submitting} onClick={voteWithBoard}>Vote with Board</button>}
          </header>
          <div className="investor-holdings"><span>Voting power: <strong>{event.eligibility.votingPower}</strong></span>
            <span>Tokens held at record date: <strong>{displayHolding(event.eligibility.snapshotBalance, event.tokenDecimals)} {event.tokenSymbol}</strong></span>
            <span>Current tokens held: <strong>{holdings.loading ? 'Loading...' : holdings.error ? 'Unavailable' : `${displayHolding(holdings.data?.rawBalance, event.tokenDecimals)} ${event.tokenSymbol}`}</strong>
              {holdings.error && <button type="button" className="investor-text-button" onClick={() => void holdings.reload().catch(() => {})}>Retry</button>}</span>
          </div>
          {event.proposals.map((proposal, proposalIndex) => <fieldset className="investor-proposal" key={`${event.metadataHash}-${proposalIndex}`} disabled={submitting || !canVote}>
            <legend className="investor-sr-only">{proposalIndex + 1}. {proposal.title}</legend>
            <div className="investor-proposal-row"><div className="investor-proposal-copy"><h3>{proposalIndex + 1}. {proposal.title}</h3>
              <p>Board Recommendation: <strong>{Number.isInteger(proposal.recommendation) ? proposal.options[proposal.recommendation]?.text ?? 'None' : 'None'}</strong></p>
              {proposal.description && <details><summary>More Details</summary><p>{proposal.description}</p></details>}</div>
            <div className="investor-options" data-count={proposal.options.length}>{proposal.options.map((option, optionIndex) => <label key={optionIndex}>
              <input type="radio" name={`proposal-${proposalIndex}`} value={optionIndex} checked={choices[proposalIndex] === optionIndex}
                onChange={() => setChoices((current) => current.map((value, index) => index === proposalIndex ? optionIndex : value))} />
              <span>{option.text}</span>
            </label>)}</div></div>
          </fieldset>)}
        </section>
        <div className="investor-submit-row" ref={submitRowRef} tabIndex={-1}>
          <span className="investor-muted">{choices.filter(Number.isInteger).length} of {event.proposals.length} proposals selected</span>
          <div><button type="button" className="inv-button secondary" disabled={submitting || !canVote}
            onClick={() => { setChoices(event.proposals.map(() => null)); setError(null); }}>Reset All</button>
            <button className="inv-button investor-submit-button" type="submit" disabled={!complete || !canVote || submitting}>
              {submitting ? 'Review and sign in your wallet...' : 'Submit Vote'}<ArrowIcon /></button></div>
        </div>
        <ErrorMessage error={error} />
        <p className="investor-vote-note">Select one option for every proposal. Nothing is submitted by Reset All or Vote with Board.
          Your final signature authorizes this ballot; your wallet address and choices will be public on-chain.</p>
      </form><StandingDisclosure />
    </>}
  </div></InvestorFrame>;
}
