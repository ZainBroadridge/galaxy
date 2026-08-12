import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMUNICATION_AUDIENCE,
  SNAP_DELIVERY_MODE,
  ZERO_ADDRESS,
} from '@pv/shared';
import {
  buildEventAnnouncement,
  eventAnnouncementStatus,
} from '../src/event-announcements.js';

const baseEvent = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  chain_id: 80002,
  title: 'Annual General Meeting',
  token_name: 'Example Token',
  token_symbol: 'EXT',
  creator_address: '0x0000000000000000000000000000000000000001',
  authenticity_status: 'COMMUNITY',
  snap_delivery_mode: SNAP_DELIVERY_MODE.ELIGIBLE,
  voting_start_at: new Date('2026-08-12T09:00:00.000Z'),
  voting_end_at: new Date('2026-08-13T09:00:00.000Z'),
  created_at: new Date('2026-08-12T08:00:00.000Z'),
  announcement_message: null,
  announcement_signature: null,
  announcement_published_at: null,
});

test('builds a deterministic eligible-holder event announcement', () => {
  const first = buildEventAnnouncement(baseEvent);
  const second = buildEventAnnouncement({
    ...baseEvent,
    announcement_message: first.message,
  });

  assert.equal(first.message.audience, COMMUNICATION_AUDIENCE.ALL_ELIGIBLE);
  assert.equal(first.message.contractAddress, ZERO_ADDRESS);
  assert.equal(first.message.actionUrl.endsWith(`/vote/${baseEvent.id}`), true);
  assert.equal(first.message.body, 'Example Token voting opens 2026-08-12 09:00 UTC and closes 2026-08-13 09:00 UTC.');
  assert.equal(second.message.messageId, first.message.messageId);
  assert.equal(second.signingMessage, first.signingMessage);
});

test('maps subscriber announcements and disables unwanted announcements', () => {
  const subscriber = buildEventAnnouncement({
    ...baseEvent,
    snap_delivery_mode: SNAP_DELIVERY_MODE.SUBSCRIBERS_ONLY,
  });
  assert.equal(subscriber.message.audience, COMMUNICATION_AUDIENCE.SUBSCRIBERS);
  assert.equal(buildEventAnnouncement({
    ...baseEvent,
    snap_delivery_mode: SNAP_DELIVERY_MODE.DISABLED,
  }), null);
});

test('reports the automatic announcement lifecycle', () => {
  assert.equal(eventAnnouncementStatus(baseEvent), 'NOT_CONFIGURED');
  assert.equal(eventAnnouncementStatus({ ...baseEvent, announcement_message: { messageId: 'draft' } }), 'AWAITING_SIGNATURE');
  assert.equal(eventAnnouncementStatus({ ...baseEvent, announcement_signature: '0x01' }), 'QUEUED');
  assert.equal(eventAnnouncementStatus({ ...baseEvent, announcement_published_at: new Date() }), 'PUBLISHED');
  assert.equal(eventAnnouncementStatus({
    ...baseEvent,
    snap_delivery_mode: SNAP_DELIVERY_MODE.DISABLED,
  }), 'DISABLED');
});
