import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canReceiveEventCommunication,
  eventRecipientContext,
} from '../src/communication-recipient-policy.js';

const base = {
  isCreator: false,
  isEligible: false,
  hasVoted: false,
  isSubscribed: false,
  isAutomaticAnnouncement: false,
  automaticDeliveryMode: 'ELIGIBLE',
  audience: 'ALL_ELIGIBLE',
};

test('event recipient policy covers creator, eligible, not-voted, and subscriber audiences', () => {
  assert.equal(canReceiveEventCommunication({ ...base, isCreator: true }), true);
  assert.equal(canReceiveEventCommunication({ ...base, isEligible: true }), true);
  assert.equal(canReceiveEventCommunication(base), false);
  assert.equal(canReceiveEventCommunication({
    ...base,
    audience: 'NOT_VOTED',
    isEligible: true,
  }), true);
  assert.equal(canReceiveEventCommunication({
    ...base,
    audience: 'NOT_VOTED',
    isEligible: true,
    hasVoted: true,
  }), false);
  assert.equal(canReceiveEventCommunication({
    ...base,
    audience: 'SUBSCRIBERS',
    isSubscribed: true,
  }), true);
});

test('automatic disabled mode and PostgreSQL aliases are handled explicitly', () => {
  assert.equal(canReceiveEventCommunication({
    ...base,
    isAutomaticAnnouncement: true,
    automaticDeliveryMode: 'DISABLED',
    isEligible: true,
  }), false);
  assert.deepEqual(eventRecipientContext({
    recipient_is_creator: false,
    recipient_is_eligible: true,
    recipient_has_voted: false,
    recipient_is_subscribed: true,
    is_automatic_announcement: true,
    snap_delivery_mode: 'SUBSCRIBERS_ONLY',
    audience: 'SUBSCRIBERS',
  }), {
    isCreator: false,
    isEligible: true,
    hasVoted: false,
    isSubscribed: true,
    isAutomaticAnnouncement: true,
    automaticDeliveryMode: 'SUBSCRIBERS_ONLY',
    audience: 'SUBSCRIBERS',
  });
});
