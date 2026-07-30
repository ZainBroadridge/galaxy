import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, ErrorBox, EventCard, Page, Panel, Spinner, Status } from '../components/UI.jsx';
import { useLoad } from '../hooks.js';
import { useWallet } from '../wallet.jsx';

export default function ResultsPage() {
  const { account } = useWallet();
  const results = useLoad(() => api(`/v1/dashboard/results${account ? `?wallet=${account}` : ''}`, { auth: false }), [account]);
  return <Page title="Results" intro="Final tallies read directly from each completed VoteEvent contract."
    actions={<button className="button secondary" onClick={() => results.reload().catch(() => {})}>Refresh</button>}>
    <ErrorBox error={results.error} />
    {results.loading ? <Spinner /> : results.data?.length ? <div className="card-grid">{results.data.map((event) => <EventCard key={event.id} event={event} to={`/results/${event.id}`} action="View results" />)}</div> : <Panel><Empty>No completed events.</Empty></Panel>}
  </Page>;
}

export function EventResultsPage() {
  const { eventId } = useParams();
  const result = useLoad(() => api(`/v1/events/${eventId}/results`, { auth: false }), [eventId]);
  if (result.loading) return <Page title="Results"><Spinner label="Reading contract tallies" /></Page>;
  if (result.error) return <Page title="Results"><ErrorBox error={result.error} /></Page>;
  return <Page title={result.data.event.title} intro={`${result.data.event.tokenName} final result`} actions={<Link className="button secondary" to="/results">Back</Link>}>
    <Panel><div className="status-line"><Status value={result.data.event.verificationStatus} /><a href={result.data.event.contractExplorerUrl} target="_blank" rel="noreferrer">View verified VoteEvent</a></div></Panel>
    {result.data.proposals.map((proposal, proposalIndex) => {
      const total = proposal.tallies.reduce((sum, value) => sum + BigInt(value), 0n);
      return <Panel key={proposalIndex} title={`${proposalIndex + 1}. ${proposal.title}`}>
        {proposal.description && <p>{proposal.description}</p>}
        <div className="result-list">{proposal.options.map((option, optionIndex) => {
          const value = BigInt(proposal.tallies[optionIndex]);
          const percent = total === 0n ? 0 : Number((value * 10_000n) / total) / 100;
          return <div className="result-row" key={optionIndex}>
            <div><strong>{option.text}</strong><span>{value.toString()} votes · {percent.toFixed(2)}%</span></div>
            <progress value={percent} max="100" />
          </div>;
        })}</div>
      </Panel>;
    })}
  </Page>;
}
