import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ballotTypedData } from '@pv/shared';
import { api } from '../api.js';
import { Empty, ErrorBox, EventCard, Notice, Page, Panel, ShortAddress, Spinner, Status } from '../components/UI.jsx';
import { useEventPolling, useLoad } from '../hooks.js';
import { useWallet } from '../wallet.jsx';

export default function VotingDashboard() {
  const { account, connected, openWallet } = useWallet();
  const events = useLoad(() => account
    ? api(`/v1/dashboard/voting?wallet=${account}`, { auth: false })
    : Promise.resolve([]), [account]);

  return <Page title="Voting Dashboard" intro="Open proxy votes for which your connected wallet had voting power on the record date."
    actions={<button className="button secondary" onClick={() => events.reload().catch(() => {})}>Refresh</button>}>
    {!connected && <Panel><Empty><p>Connect a wallet to discover eligible voting events.</p><button className="button" onClick={openWallet}>Connect wallet</button></Empty></Panel>}
    <ErrorBox error={events.error} />
    {events.loading && connected ? <Spinner /> : null}
    {connected && !events.loading && !events.data?.length ? <Panel><Empty>No ongoing eligible events.</Empty></Panel> : null}
    <div className="card-grid">{events.data?.map((event) => <EventCard key={event.id} event={event} to={`/vote/${event.id}`} action={event.eligibility?.hasVoted ? 'View receipt' : 'Open ballot'} />)}</div>
  </Page>;
}

function Receipt({ event, vote }) {
  return <Panel title={vote.status === 'CONFIRMED' ? 'Vote recorded' : 'Vote submitted'} className="receipt">
    <Status value={vote.status} />
    <dl className="details">
      <div><dt>Voting power</dt><dd>{vote.votingPower}</dd></div>
      <div><dt>Transaction</dt><dd>{vote.transactionHash ? <a href={vote.transactionExplorerUrl} target="_blank" rel="noreferrer"><ShortAddress value={vote.transactionHash} /></a> : 'Waiting for relayer'}</dd></div>
      <div><dt>VoteEvent</dt><dd><a href={event.contractExplorerUrl} target="_blank" rel="noreferrer"><ShortAddress value={event.contractAddress} /></a></dd></div>
      <div><dt>Source</dt><dd>{event.verificationStatus === 'VERIFIED' ? 'Verified on PolygonScan' : event.verificationStatus.replaceAll('_', ' ')}</dd></div>
    </dl>
    {vote.failureReason && <Notice tone="error">{vote.failureReason}</Notice>}
  </Panel>;
}

export function VoteEventPage() {
  const { eventId } = useParams();
  const { account, connected, openWallet, getSigner } = useWallet();
  const view = useLoad(() => api(`/v1/events/${eventId}/view${account ? `?wallet=${account}` : ''}`, { auth: false }), [eventId, account]);
  const event = view.data;
  const [choices, setChoices] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    setChoices(event?.proposals?.map(() => null) ?? []);
  }, [account, event?.metadataHash, eventId]);

  const jobActive = ['PENDING', 'RUNNING'].includes(event?.job?.status);
  const voteActive = ['QUEUED', 'SUBMITTED'].includes(event?.vote?.status);
  const shouldPoll = Boolean(jobActive || voteActive || event?.verificationStatus === 'PENDING');
  useEventPolling(view.refresh, shouldPoll);
  const complete = useMemo(() => choices.length > 0 && choices.every(Number.isInteger), [choices]);

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
      const signer = await getSigner();
      const signature = await signer.signTypedData(typed.domain, typed.types, typed.message);
      const vote = await api(`/v1/events/${eventId}/votes`, {
        method: 'POST',
        auth: false,
        body: { voterAddress: account, choices, signature },
      });
      view.setData({ ...event, vote, eligibility: { ...event.eligibility, hasVoted: true } });
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  }

  if (view.loading) return <Page title="Voting Dashboard"><Spinner /></Page>;
  if (view.error) return <Page title="Voting Dashboard"><ErrorBox error={view.error} /></Page>;

  return <Page title={event.title} intro={`${event.tokenName} (${event.tokenSymbol})`} actions={<Link className="button secondary" to="/">Back</Link>}>
    {!event.metadataIntegrity && <Notice tone="error">Event metadata does not match the hash committed to the contract. Voting is disabled.</Notice>}
    {jobActive && event.deploymentBlock === null && <Panel title="Event preparation"><Status value={event.status} /><p>{event.job?.message}</p><progress value={event.job?.progress || 0} max="100" /></Panel>}
    {event.failureReason && <Notice tone="error">{event.failureReason}</Notice>}
    {event.lastVoteFailure && <Notice tone="error">Previous relay attempt failed: {event.lastVoteFailure}. You may submit the ballot again.</Notice>}
    {event.vote && event.vote.status !== 'FAILED' ? <Receipt event={event} vote={event.vote} /> : null}
    {!event.vote && !connected ? <Panel><Empty><p>Connect the eligible wallet to view this ballot.</p><button className="button" onClick={openWallet}>Connect wallet</button></Empty></Panel> : null}
    {!event.vote && connected && event.eligibility && !event.eligibility.eligible ? <Notice>This wallet was not eligible at the record date.</Notice> : null}
    {!event.vote && event.eligibility?.onChainOnly ? <Panel title="Vote recorded" className="receipt"><Status value="CONFIRMED" /><p>This wallet is already marked as voted by the VoteEvent contract. The ballot is locked; a local transaction receipt was not available in Neon.</p></Panel> : null}
    {!event.vote && event.status === 'SCHEDULED' ? <Notice>Voting opens {new Date(event.votingStartAt).toLocaleString()}.</Notice> : null}
    {!event.vote && event.status === 'CLOSED' ? <Notice>Voting is closed. <Link to={`/results/${event.id}`}>View results</Link>.</Notice> : null}
    {!event.vote && !event.eligibility?.hasVoted && event.status === 'OPEN' && event.eligibility?.eligible && event.metadataIntegrity ? <Panel title="Ballot">
      <div className="ballot-meta"><span>Voting power <strong>{event.eligibility.votingPower}</strong></span><span>Closes <strong>{new Date(event.votingEndAt).toLocaleString()}</strong></span></div>
      {event.proposals.map((proposal, proposalIndex) => <fieldset key={proposal.index ?? proposalIndex} className="proposal">
        <legend>{proposalIndex + 1}. {proposal.title}</legend>
        {proposal.description && <p>{proposal.description}</p>}
        {proposal.options.map((option, optionIndex) => <label key={option.index ?? optionIndex} className="option">
          <input type="radio" name={`proposal-${proposalIndex}`} checked={choices[proposalIndex] === optionIndex}
            onChange={() => setChoices((current) => current.map((value, index) => index === proposalIndex ? optionIndex : value))} />
          <span>{option.text ?? option}</span>{proposal.recommendation === optionIndex && <small>Organiser recommendation</small>}
        </label>)}
      </fieldset>)}
      <ErrorBox error={submitError} />
      <button className="button" disabled={!complete || submitting} onClick={submit}>{submitting ? 'Signing and submitting…' : 'Submit final vote'}</button>
      <p className="muted">MetaMask will request one final-ballot signature. The Render relayer pays POL.</p>
    </Panel> : null}
  </Page>;
}
