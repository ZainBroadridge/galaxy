import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useEventPolling } from '../hooks.js';
import { useInvestorData, useInvestorResource } from './InvestorData.jsx';
import BackLink from '../components/BackLink.jsx';
import ResourceSkeleton from '../components/ResourceSkeleton.jsx';
import IssuerLogo from '../components/IssuerLogo.jsx';
import { ArrowIcon, ErrorMessage, InvestorFrame, MeetingTags, SecurityIdentity, StandingDisclosure } from './InvestorFrame.jsx';
import { displayDate, groupMeetings, MEETING_TABS } from './meeting-utils.js';

export default function MeetingsPage() {
  const { prefetchEvent } = useInvestorData();
  const [parameters, setParameters] = useSearchParams();
  const tab = MEETING_TABS.find((item) => item.id === parameters.get('tab')) ?? MEETING_TABS[0];
  const [now, setNow] = useState(Date.now);
  const meetings = useInvestorResource('meetings');
  useEventPolling(meetings.refresh, true, 10_000);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(timer); }, []);
  const groups = useMemo(() => groupMeetings(meetings.data ?? [], now), [meetings.data, now]);
  const matching = groups[tab.id];
  return <InvestorFrame><section className="investor-meetings investor-page-width">
    <h1>Here are the meetings you can vote</h1>
    <div className="investor-tabs" role="tablist" aria-label="Meeting categories">
      {MEETING_TABS.map((item) => <button type="button" key={item.id} role="tab" id={`tab-${item.id}`}
        aria-selected={tab.id === item.id} aria-controls="meeting-tab-panel" tabIndex={tab.id === item.id ? 0 : -1}
        onKeyDown={(event) => {
          const index = MEETING_TABS.indexOf(item);
          const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : null;
          if (next !== null) { event.preventDefault(); setParameters({ tab: MEETING_TABS[next].id }); document.getElementById(`tab-${MEETING_TABS[next].id}`)?.focus(); }
        }} onClick={() => { setParameters({ tab: item.id }); }}>{item.label}</button>)}
    </div>
    <section id="meeting-tab-panel" role="tabpanel" aria-labelledby={`tab-${tab.id}`}>
      <ErrorMessage error={meetings.error} />
      {meetings.loading ? <ResourceSkeleton label="Loading meetings" /> : !meetings.error && !matching.length
        ? <p className="investor-empty">There are no meetings in this category.</p> : null}
      <div className="investor-meeting-list">{matching.map((event) => {
        const voted = event.eligibility.hasVoted;
        const scheduled = Date.parse(event.votingStartAt) > now;
        return <article className="investor-meeting-row" key={event.id}>
          <div><div className="investor-meeting-title"><IssuerLogo event={event} className="investor-list-issuer-logo" /><h2>{event.title}</h2></div><SecurityIdentity event={event} />
            <MeetingTags platform={event.platform}>
              {scheduled && <span className="investor-tag muted">Scheduled</span>}
              {voted && <span className="investor-tag muted">{event.voteStatus === 'CONFIRMED' ? 'Voted' : 'Vote submitted'}</span>}</MeetingTags>
            <p>Voting deadline: {displayDate(event.votingEndAt)}</p>
            {scheduled && <p className="investor-muted">Opens: {displayDate(event.votingStartAt)}</p>}</div>
          <Link className="inv-button" onPointerEnter={() => void prefetchEvent(event.id)} onFocus={() => void prefetchEvent(event.id)} to={`/vote/${event.id}${voted ? '/confirmation' : ''}`}>
            {voted ? 'View receipt' : tab.id === 'past' || scheduled ? 'View' : 'Vote'}<ArrowIcon /></Link>
        </article>;
      })}</div>
    </section><StandingDisclosure />
  </section></InvestorFrame>;
}
