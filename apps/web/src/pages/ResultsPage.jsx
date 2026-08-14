import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiBlob, saveBlob } from '../api.js';
import {
  Empty,
  ErrorBox,
  Page,
  Panel,
  ShortAddress,
  Spinner,
  Status,
} from '../components/UI.jsx';
import { useLoad } from '../hooks.js';
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

function formatVotes(value) {
  try { return new Intl.NumberFormat().format(BigInt(value)); }
  catch { return String(value ?? '0'); }
}

function proposalCount(event) {
  return event.proposalCount ?? event.proposals?.length ?? '—';
}

function eligibleWallets(event) {
  return event.snapshotHolderCount ?? event.eligibleWallets ?? '—';
}

export default function ResultsPage() {
  const { account } = useWallet();
  const results = useLoad(
    () => (account
      ? api(`/v1/dashboard/results?wallet=${encodeURIComponent(account)}`, { auth: false })
      : Promise.resolve([])),
    [account],
  );

  return <Page
    className="results-index-page"
    title="Voting Results"
    intro="Per-proposal tallies read from each VoteEvent contract for events you created or participated in."
    actions={<button className="button secondary compact" onClick={() => results.reload().catch(() => {})} disabled={!account}>Refresh</button>}
  >
    <ErrorBox error={results.error} />
    {!account
      ? <Panel><Empty>Connect the wallet that created or voted in an event to view its results.</Empty></Panel>
      : results.loading
        ? <Spinner />
        : results.data?.length
          ? <section className="results-table-card">
            <div className="results-table-scroll">
              <table className="results-table">
                <thead><tr>
                  <th>Token</th>
                  <th>Token address</th>
                  <th>Status</th>
                  <th>Proposals</th>
                  <th>Eligible wallets</th>
                  <th>Voting closes</th>
                  <th aria-label="Actions" />
                </tr></thead>
                <tbody>{results.data.map((event) => <tr key={event.id}>
                  <td><strong>{event.tokenSymbol || event.tokenName}</strong></td>
                  <td><ShortAddress value={event.tokenAddress} /></td>
                  <td>{event.status === 'CLOSED' ? 'Closed' : String(event.status).replaceAll('_', ' ')}</td>
                  <td>{proposalCount(event)}</td>
                  <td>{eligibleWallets(event)}</td>
                  <td>{formatDate(event.votingEndAt)}</td>
                  <td><Link className="table-action" to={`/results/${event.id}`}>View results</Link></td>
                </tr>)}</tbody>
              </table>
            </div>
          </section>
          : <Panel><Empty>No completed events for this wallet.</Empty></Panel>}
  </Page>;
}

function ProposalResults({ proposal, proposalIndex }) {
  const values = proposal.tallies.map((value) => BigInt(value));
  const total = values.reduce((sum, value) => sum + value, 0n);
  const maximum = values.reduce((max, value) => value > max ? value : max, 0n);
  const leadingIndex = maximum > 0n ? values.findIndex((value) => value === maximum) : -1;

  return <section className="result-proposal-card">
    <header className="result-proposal-heading">
      <h2>{proposalIndex + 1}. {proposal.title}</h2>
      {proposal.description && <p>{proposal.description}</p>}
    </header>

    <div className="result-chart" aria-label={`Vote power chart for ${proposal.title}`}>
      <div className="chart-y-label">Vote power</div>
      <div className="chart-grid-lines" aria-hidden="true"><span /><span /><span /><span /></div>
      <div className="chart-columns">
        {proposal.options.map((option, optionIndex) => {
          const value = values[optionIndex];
          const height = maximum === 0n ? 0 : Math.max(2, Number((value * 100n) / maximum));
          return <div className="chart-column" key={option.index ?? optionIndex}>
            <div className="chart-bar-track">
              <div className={`chart-bar chart-bar-${optionIndex % 3}`} style={{ height: `${height}%` }}>
                <span className="sr-only">{formatVotes(value)} votes</span>
              </div>
            </div>
            <span>{option.text}</span>
          </div>;
        })}
      </div>
    </div>

    <div className="proposal-result-table-wrap">
      <table className="proposal-result-table">
        <thead><tr><th>Option</th><th>Vote power</th><th>Share</th></tr></thead>
        <tbody>{proposal.options.map((option, optionIndex) => {
          const value = values[optionIndex];
          const percent = total === 0n ? 0 : Number((value * 10_000n) / total) / 100;
          const labels = [];
          if (proposal.recommendation === optionIndex) labels.push('Board rec.');
          if (leadingIndex === optionIndex && value > 0n) labels.push('Leading');
          return <tr key={option.index ?? optionIndex}>
            <td>{option.text}{labels.length ? <small> · {labels.join(' · ')}</small> : null}</td>
            <td>{formatVotes(value)}</td>
            <td>{percent.toFixed(2)}%</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
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
      if (!wallet.account) throw new Error('Connect the creator or participating wallet before downloading this report.');
      const blob = await apiBlob(
        `/v1/events/${eventId}/reports/results?wallet=${encodeURIComponent(wallet.account)}`,
        { auth: false },
      );
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
    return <Page title="Results" actions={<Link className="button secondary compact" to="/results">Back</Link>}>
      <Panel><Empty>Connect the creator or participating wallet to view these results.</Empty></Panel>
    </Page>;
  }
  if (result.loading) return <Page title="Results"><Spinner label="Reading contract tallies" /></Page>;
  if (result.error) return <Page title="Results"><ErrorBox error={result.error} /></Page>;
  if (!result.data) return <Page title="Results"><Panel><Empty>No results are available.</Empty></Panel></Page>;

  const { event } = result.data;
  const explorerBase = import.meta.env.VITE_BLOCK_EXPLORER_URL || 'https://amoy.polygonscan.com';

  return <main className="page results-detail-page">
    <section className="results-summary-card">
      <div className="results-summary-top">
        <Link className="back-link" to="/results">← Back</Link>
        <Status value={event.status} label={event.status === 'CLOSED' ? 'Closed' : undefined} />
      </div>
      <div className="results-title-row">
        <div>
          <h1>{event.title} Results</h1>
          <p>{event.tokenName} ({event.tokenSymbol})</p>
        </div>
        <button className="button compact" onClick={downloadReport} disabled={downloading}>
          {downloading && <span className="button-spinner" aria-hidden="true" />}
          {downloading ? 'Generating report…' : 'Download result report'}
        </button>
      </div>

      <div className="results-summary-metrics">
        <div><span>Eligible voters</span><strong>{eligibleWallets(event)}</strong></div>
        <div><span>Proposals</span><strong>{result.data.proposals.length}</strong></div>
        <div><span>Voting closed</span><strong>{formatDate(event.votingEndAt)}</strong></div>
      </div>

      <div className="results-summary-links">
        {event.contractExplorerUrl && <a href={event.contractExplorerUrl} target="_blank" rel="noreferrer">View VoteEvent contract ↗</a>}
        {event.tokenAddress && <a href={`${explorerBase}/address/${event.tokenAddress}`} target="_blank" rel="noreferrer">View {event.tokenSymbol} token contract ↗</a>}
      </div>
      <ErrorBox error={downloadError} />
    </section>

    <div className="results-proposal-stack">
      {result.data.proposals.map((proposal, proposalIndex) => <ProposalResults
        key={proposal.index ?? proposalIndex}
        proposal={proposal}
        proposalIndex={proposalIndex}
      />)}
    </div>
  </main>;
}
