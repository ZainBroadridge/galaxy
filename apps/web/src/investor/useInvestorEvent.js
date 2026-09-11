import { useEventLiveRefresh, useEventPolling } from '../hooks.js';
import { useInvestorResource } from './InvestorData.jsx';

export function useInvestorEvent(eventId) {
  const view = useInvestorResource(`event:${eventId}`);
  const active = ['QUEUED', 'SUBMITTED'].includes(view.data?.vote?.status) || ['PENDING', 'RUNNING'].includes(view.data?.job?.status);
  useEventLiveRefresh(view.refresh, eventId, active);
  useEventPolling(view.refresh, !active, 10_000);
  return view;
}
