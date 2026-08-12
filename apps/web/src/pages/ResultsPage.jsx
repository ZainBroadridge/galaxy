import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiBlob, saveBlob } from '../api.js';
import {
  Empty,
  ErrorBox,
  EventCard,
  Page,
  Panel,
  Spinner,
  Status,
} from '../components/UI.jsx';
import { useLoad } from '../hooks.js';
import { useWallet } from '../wallet.jsx';

export default function ResultsPage() {
  const { account } = useWallet();
  const results = useLoad(
    () => (account
      ? api(`/v1/dashboard/results?wallet=${encodeURIComponent(account)}`, { auth: false })
      : Promise.resolve([])),
    [account],
  );

  return <Page
    title="Results"
    intro="Final tallies for events you created or voted in."
    actions={<button className="button secondary" onClick={() => results.reload().catch(() => {})} disabled={!account}>Refresh</button>}
  >
    <ErrorBox error={results.error} />
    {!account
      ? <Panel><Empty>Connect the wallet that created or voted in an event to view its results.</Empty></Panel>
      : results.loading
        ? <Spinner />
        : results.data?.length
          ? <div className="card-grid">{results.data.map((event) => <EventCard
              key={event.id}
              event={event}
              to={`/results/${event.id}`}
              action="View results"
            />)}</div>
          : <Panel><Empty>No completed events for this wallet.</Empty></Panel>}
  </Page>;
}

export function EventResultsPage() {
  const { eventId } = useParams();
  const wallet = useWallet();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const result = useLoad(
    () => (wallet.account
      ? api(`/v1/events/${eventId}/results?wallet=${encodeURIComponent(wallet.account)}`, { auth: false })
      : Promise.resolve(null)),
    [wallet.account, eventId],
  );

  async function downloadReport() {
    if (downloading || !result.data) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await wallet.ensureAuthenticated();
      const blob = await apiBlob(`/v1/events/${eventId}/reports/results`);
      saveBlob(
        blob,
        `${result.data.event.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-results.pdf`,
      );
    } catch (error) {
      setDownloadError(error);
    } finally {
      setDownloading(false);
    }
  }

  if (!wallet.account) {
    return <Page title="Results" actions={<Link className="button secondary" to="/results">Back</Link>}>
      <Panel><Empty>Connect the creator or participating wallet to view these results.</Empty></Panel>
    </Page>;
  }
  if (result.loading) return <Page title="Results"><Spinner label="Reading contract tallies" /></Page>;
  if (result.error) return <Page title="Results"><ErrorBox error={result.error} /></Page>;
  if (!result.data) return <Page title="Results"><Panel><Empty>No results are available.</Empty></Panel></Page>;

  return <Page
    title={result.data.event.title}
    intro={`${result.data.event.tokenName} final result`}
    actions={<div className="row wrap">
      <button className="button" onClick={downloadReport} disabled={downloading}>
        {downloading && <span className="button-spinner" aria-hidden="true" />}
        {downloading ? 'Generating report…' : 'Download result report'}
      </button>
      <Link className="button secondary" to="/results">Back</Link>
    </div>}
  >
    <ErrorBox error={downloadError} />
    <Panel>
      <div className="status-line">
        <Status value={result.data.event.verificationStatus} />
        <a href={result.data.event.contractExplorerUrl} target="_blank" rel="noreferrer">View verified VoteEvent</a>
      </div>
    </Panel>
    {result.data.proposals.map((proposal, proposalIndex) => {
      const total = proposal.tallies.reduce((sum, value) => sum + BigInt(value), 0n);
      return <Panel key={proposalIndex} title={`${proposalIndex + 1}. ${proposal.title}`}>
        {proposal.description && <p>{proposal.description}</p>}
        <div className="result-list">{proposal.options.map((option, optionIndex) => {
          const value = BigInt(proposal.tallies[optionIndex]);
          const percent = total === 0n ? 0 : Number((value * 10_000n) / total) / 100;
          return <div className="result-row" key={optionIndex}>
            <div>
              <strong>{option.text}</strong>
              <span>{value.toString()} votes · {percent.toFixed(2)}%</span>
            </div>
            <progress value={percent} max="100" />
          </div>;
        })}</div>
      </Panel>;
    })}
  </Page>;
}
