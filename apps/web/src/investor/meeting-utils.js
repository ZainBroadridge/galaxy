export const MEETING_TABS = Object.freeze([
  { id: 'active', label: 'Active Meetings', search: 'Search active meetings' },
  { id: 'recent', label: 'Recently Voted Meetings', search: 'Search recently voted meetings' },
  { id: 'past', label: 'Past Meetings', search: 'Search past meetings' },
]);

export function hasParticipation(event) {
  return ['QUEUED', 'SUBMITTED', 'CONFIRMED'].includes(event.voteStatus ?? event.vote?.status)
    || event.eligibility?.hasVoted === true;
}

export function groupMeetings(events, now = Date.now()) {
  const eligible = events.filter((event) => event.eligibility?.eligible && event.contractReady && event.status !== 'FAILED');
  const tie = (a, b) => String(a.id).localeCompare(String(b.id));
  return {
    active: eligible.filter((event) => Date.parse(event.votingEndAt) > now && !hasParticipation(event) && event.discoverable !== false)
      .sort((a, b) => Date.parse(a.votingEndAt) - Date.parse(b.votingEndAt) || tie(a, b)),
    recent: eligible.filter(hasParticipation)
      .sort((a, b) => Date.parse(b.voteCreatedAt ?? b.vote?.createdAt ?? b.updatedAt) - Date.parse(a.voteCreatedAt ?? a.vote?.createdAt ?? a.updatedAt) || tie(a, b)),
    past: eligible.filter((event) => Date.parse(event.votingEndAt) <= now)
      .sort((a, b) => Date.parse(b.votingEndAt) - Date.parse(a.votingEndAt) || tie(a, b)),
  };
}

export function boardRecommendedChoices(proposals) {
  if (!Array.isArray(proposals) || !proposals.length) return null;
  const choices = proposals.map((proposal) => proposal?.recommendation);
  return choices.every((value, index) => Number.isInteger(value) && value >= 0
    && value < (proposals[index]?.options?.length ?? 0)) ? choices : null;
}

export function completeChoices(proposals, choices) {
  return Boolean(proposals?.length && proposals.length === choices.length && choices.every((choice, index) => (
    Number.isInteger(choice) && choice >= 0 && choice < proposals[index].options.length
  )));
}

export function safeInvestorReturn(value) {
  return typeof value === 'string' && /^\/(?:meetings(?:[/?#]|$)|vote\/[0-9a-f-]+(?:[/?#]|$)|education(?:[?#]|$)|notifications(?:[?#]|$))/i.test(value)
    && !value.includes('\\') ? value : '/meetings';
}

export function displayDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString([], {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }) : 'Not available';
}

export function displayHolding(raw, decimals) {
  if (raw === null || raw === undefined) return 'Unavailable';
  const text = BigInt(raw).toString().padStart(Number(decimals) + 1, '0');
  if (Number(decimals) === 0) return text;
  const whole = text.slice(0, -Number(decimals));
  const fraction = text.slice(-Number(decimals)).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Local lifecycle labels are derived from immutable dates, not a stale API badge. */
export function meetingLifecycle(event, now = Date.now()) {
  if (!event) return null;
  if (now > Date.parse(event.votingEndAt)) return 'CLOSED';
  if (now < Date.parse(event.votingStartAt)) return 'SCHEDULED';
  return 'OPEN';
}
