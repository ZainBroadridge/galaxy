import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ResourceSkeleton from '../components/ResourceSkeleton.jsx';
import { apiBlob, saveBlob } from '../api.js';
import EventDocuments from './EventDocuments.jsx';
import { useInvestorEvent } from './useInvestorEvent.js';
import { ArrowIcon, ErrorMessage, InvestorFrame, MeetingPageHeader, LoadingIndicator, PrintIcon } from './InvestorFrame.jsx';
import { displayDate } from './meeting-utils.js';

export default function ConfirmationPage() {
  const { eventId } = useParams();
  const view = useInvestorEvent(eventId);
  const event = view.data;
  const vote = event?.vote;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const successful = vote && vote.status !== 'FAILED';
  async function downloadReceipt() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const blob = await apiBlob(`/v1/investor/events/${eventId}/receipt`, { issuerAuth: false });
      saveBlob(blob, `${event.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-vote-receipt.pdf`);
    } catch (value) { setError(value); }
    finally { setBusy(false); }
  }
  return <InvestorFrame event={event} hideNavigation><div className="investor-confirmation investor-page-width">
    <MeetingPageHeader event={event} showTags={false} />
    <ErrorMessage error={view.error} />{view.loading && <ResourceSkeleton label="Loading vote status" rows={2} />}
    {event && <>
      {!successful ? <section className="investor-confirmation-message">
        <h2>{vote?.status === 'FAILED' ? 'Your vote was not recorded' : 'No submitted vote'}</h2>
        <p>{vote?.failureReason || 'This page shows a receipt only after a ballot has been submitted.'}</p>
        <Link className="inv-button" to={`/vote/${eventId}`}>Return to ballot<ArrowIcon /></Link>
      </section> : <>
        <section className="investor-confirmation-message" aria-live="polite">
          <h2 className={vote.status === 'CONFIRMED' ? 'confirmed' : ''}>{vote.status === 'CONFIRMED' ? 'Voted' : 'Vote submitted'}</h2>
          <h3>Thank you for voting!</h3>
          <p>You submitted selections for {vote.choices.length} of {event.proposals.length} proposals on {displayDate(vote.createdAt)}.</p>
          {vote.status !== 'CONFIRMED' && <p>The relayer is processing your signed ballot. This page updates automatically; confirmation is not complete yet.</p>}
        </section>
        <section className="investor-transaction-card" aria-label="Vote transaction details">
          <dl><div><dt>Voting power</dt><dd>{vote.votingPower}</dd></div>
            <div><dt>Transaction</dt><dd>{vote.transactionExplorerUrl
              ? <a href={vote.transactionExplorerUrl} target="_blank" rel="noopener noreferrer">{vote.transactionHash}</a>
              : <LoadingIndicator>Waiting for the relayer to broadcast</LoadingIndicator>}</dd></div>
            <div><dt>VoteEvent contract</dt><dd><a href={event.contractExplorerUrl} target="_blank" rel="noopener noreferrer">{event.contractAddress}</a></dd></div>
            <div><dt>Source verification</dt><dd>{event.verificationStatus.replaceAll('_', ' ')}</dd></div></dl>
          <details><summary>Review submitted selections</summary><ol>{event.proposals.map((proposal, index) => <li key={index}>
            <strong>{proposal.title}</strong><span>{proposal.options[vote.choices[index]]?.text ?? 'Unavailable'}</span>
          </li>)}</ol></details>
        </section>
        <div className="investor-confirmation-actions"><Link className="inv-button" to="/meetings?tab=active">Return to My Meetings<ArrowIcon /></Link>
          <button type="button" className="inv-button secondary" onClick={downloadReceipt} disabled={busy} title="Generate a branded PDF receipt to save or print">
            <PrintIcon />{busy ? 'Generating receipt...' : 'Print / download receipt'}</button></div>
        <ErrorMessage error={error} /><EventDocuments event={event} heading="Meeting documents" />
      </>}
    </>}
  </div></InvestorFrame>;
}
