const EVENT_AUDIENCE = Object.freeze({
  ALL_ELIGIBLE: 'ALL_ELIGIBLE',
  NOT_VOTED: 'NOT_VOTED',
  SUBSCRIBERS: 'SUBSCRIBERS',
});

const AUTOMATIC_DELIVERY_DISABLED = 'DISABLED';

/**
 * Decide whether one wallet may receive one persisted event communication.
 *
 * This is intentionally the only event-audience policy used by both the
 * dApp/Snap inbox and browser Web Push. Keeping the rule pure prevents the two
 * delivery channels from drifting apart again.
 */
export function canReceiveEventCommunication({
  isCreator = false,
  isEligible = false,
  hasVoted = false,
  isSubscribed = false,
  isAutomaticAnnouncement = false,
  automaticDeliveryMode = null,
  audience,
}) {
  if (isCreator) return true;
  if (isAutomaticAnnouncement && automaticDeliveryMode === AUTOMATIC_DELIVERY_DISABLED) {
    return false;
  }

  switch (audience) {
    case EVENT_AUDIENCE.ALL_ELIGIBLE:
      return isEligible;
    case EVENT_AUDIENCE.NOT_VOTED:
      return isEligible && !hasVoted;
    case EVENT_AUDIENCE.SUBSCRIBERS:
      return isSubscribed;
    default:
      return false;
  }
}

/** Convert PostgreSQL aliases into the explicit policy input above. */
export function eventRecipientContext(row) {
  return {
    isCreator: row.recipient_is_creator === true,
    isEligible: row.recipient_is_eligible === true,
    hasVoted: row.recipient_has_voted === true,
    isSubscribed: row.recipient_is_subscribed === true,
    isAutomaticAnnouncement: row.is_automatic_announcement === true,
    automaticDeliveryMode: row.snap_delivery_mode ?? null,
    audience: row.audience,
  };
}
