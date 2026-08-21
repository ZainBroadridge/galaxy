import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  canReceiveEventCommunication,
  eventRecipientContext,
} from '../src/communication-recipient-policy.js';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const base = {
  isCreator: false,
  isEligible: false,
  hasVoted: false,
  isSubscribed: false,
  isAutomaticAnnouncement: false,
  automaticDeliveryMode: 'ELIGIBLE',
};

test('one event recipient policy serves eligible, not-voted, and subscriber audiences', () => {
  assert.equal(canReceiveEventCommunication({ ...base, audience: 'ALL_ELIGIBLE', isEligible: true }), true);
  assert.equal(canReceiveEventCommunication({ ...base, audience: 'ALL_ELIGIBLE' }), false);

  assert.equal(canReceiveEventCommunication({ ...base, audience: 'NOT_VOTED', isEligible: true }), true);
  assert.equal(canReceiveEventCommunication({ ...base, audience: 'NOT_VOTED', isEligible: true, hasVoted: true }), false);

  assert.equal(canReceiveEventCommunication({ ...base, audience: 'SUBSCRIBERS', isSubscribed: true }), true);
  assert.equal(canReceiveEventCommunication({ ...base, audience: 'SUBSCRIBERS', isSubscribed: true, isEligible: false }), true);
  assert.equal(canReceiveEventCommunication({ ...base, audience: 'SUBSCRIBERS' }), false);
});

test('automatic announcements use their signed audience while respecting the disabled toggle', () => {
  assert.equal(canReceiveEventCommunication({
    ...base,
    audience: 'ALL_ELIGIBLE',
    isEligible: true,
    isAutomaticAnnouncement: true,
    automaticDeliveryMode: 'ELIGIBLE',
  }), true);
  assert.equal(canReceiveEventCommunication({
    ...base,
    audience: 'SUBSCRIBERS',
    isSubscribed: true,
    isAutomaticAnnouncement: true,
    automaticDeliveryMode: 'SUBSCRIBERS_ONLY',
  }), true);
  assert.equal(canReceiveEventCommunication({
    ...base,
    audience: 'SUBSCRIBERS',
    isSubscribed: true,
    isAutomaticAnnouncement: true,
    automaticDeliveryMode: 'DISABLED',
  }), false);
});

test('event creator retains access and PostgreSQL recipient aliases map explicitly', () => {
  assert.equal(canReceiveEventCommunication({ ...base, audience: 'UNKNOWN', isCreator: true }), true);
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


test('published automatic announcements expose a safe delivery retry without a wallet signature', async () => {
  const organiser = await read('apps/web/src/pages/OrganiserDashboard.jsx');
  assert.match(organiser, /\['QUEUED', 'PUBLISHED'\]\.includes\(event\.announcementStatus\)/u);
  assert.match(organiser, /Retry delivery/u);
  assert.match(organiser, /result\.redelivered/u);
  assert.doesNotMatch(organiser, /signMessage\([^)]*announcement/iu);
});

test('Snap inbox and browser push consume the same persisted event policy', async () => {
  const [communications, webPush, announcements, server, deploy] = await Promise.all([
    read('apps/api/src/communications.js'),
    read('apps/api/src/web-push.js'),
    read('apps/api/src/event-announcements.js'),
    read('apps/api/src/server.js'),
    read('apps/api/src/deploy.js'),
  ]);

  assert.match(communications, /canReceiveEventCommunication\(eventRecipientContext\(row\)\)/u);
  assert.match(communications, /export async function eventBrowserPushRecipients/u);
  assert.match(communications, /c\.message_id::text=coalesce\(e\.announcement_message->>'messageId',''\)/u);
  assert.match(communications, /scope: 'EVENT'/u);
  assert.match(webPush, /eventBrowserPushRecipients/u);
  assert.match(webPush, /resolveEventSubscriptions/u);
  assert.match(webPush, /QUEUE_DEDUPE_MS/u);
  assert.match(announcements, /scope: 'EVENT'/u);
  assert.match(announcements, /redelivered: true/u);
  assert.match(announcements, /SET created_at=now\(\),revoked_at=NULL/u);
  assert.match(server, /queueBrowserPush\(message\)/u);
  assert.match(deploy, /publishAutomaticAnnouncement/u);
  assert.match(deploy, /result\.published \|\| result\.redelivered/u);
});
