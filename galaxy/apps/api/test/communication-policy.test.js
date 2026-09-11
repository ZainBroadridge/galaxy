import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canReceiveEventCommunication,
  eventRecipientContext,
} from '../src/communication-recipient-policy.js';

const base = {
  isEligible: false,
  hasVoted: false,
  isSubscribed: false,
  isAutomaticAnnouncement: false,
  automaticDeliveryMode: 'ELIGIBLE',
  audience: 'ALL_ELIGIBLE',
};

test('record-date eligibility is required for every event audience', () => {
  assert.equal(canReceiveEventCommunication({ ...base, isCreator: true }), false);
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
    isEligible: true,
    isSubscribed: true,
  }), true);
  assert.equal(canReceiveEventCommunication({
    ...base,
    audience: 'SUBSCRIBERS',
    isSubscribed: true,
  }), false);
});

test('automatic disabled mode and PostgreSQL aliases are handled explicitly', () => {
  assert.equal(canReceiveEventCommunication({
    ...base,
    isAutomaticAnnouncement: true,
    automaticDeliveryMode: 'DISABLED',
    isEligible: true,
  }), false);
  assert.deepEqual(eventRecipientContext({
    recipient_is_eligible: true,
    recipient_has_voted: false,
    recipient_is_subscribed: true,
    is_automatic_announcement: true,
    snap_delivery_mode: 'SUBSCRIBERS_ONLY',
    audience: 'SUBSCRIBERS',
  }), {
    isEligible: true,
    hasVoted: false,
    isSubscribed: true,
    isAutomaticAnnouncement: true,
    automaticDeliveryMode: 'SUBSCRIBERS_ONLY',
    audience: 'SUBSCRIBERS',
  });
});
