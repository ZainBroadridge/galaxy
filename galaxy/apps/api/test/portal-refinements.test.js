import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createResourceStore, recordAcceptedVote } from '../../web/src/data/resource-store.js';
import { CREATION_LIMIT_NOTICE_MS, scheduleCreationLimitNotice } from '../../web/src/issuer/notice-state.js';
import { searchIssuers, searchPlatforms } from '../../web/src/issuer/issuer-search.js';
import { eventProgress } from '../../web/src/issuer/event-progress.js';
import { meetingLifecycle, groupMeetings } from '../../web/src/investor/meeting-utils.js';
import { MAX_OPTION_LABEL_LENGTH } from '../../../packages/shared/src/constants.js';
import { ISSUER_PRESETS, TOKEN_PLATFORMS } from '../../../packages/shared/src/issuer-branding.js';

const read = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const pending = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('daily-limit feedback expires after 30 seconds and cancels cleanly for each new attempt', () => {
  let callback; let delay; const cleared = [];
  const timers = { setTimeout(fn, ms) { callback = fn; delay = ms; return 9; }, clearTimeout(id) { cleared.push(id); } };
  let dismissed = 0;
  const stop = scheduleCreationLimitNotice({ code: 'EVENT_LIMIT' }, () => { dismissed += 1; }, timers);
  assert.equal(delay, 30_000); assert.equal(CREATION_LIMIT_NOTICE_MS, 30_000);
  callback(); assert.equal(dismissed, 1); stop(); assert.deepEqual(cleared, [9]);
  assert.equal(scheduleCreationLimitNotice({ code: 'NETWORK_ERROR' }, () => {}, timers), undefined);
});

test('Completed build and scheduled/open/closed voting are independent and time-derived', () => {
  const event = { snapshotRoot: 'root', contractAddress: 'address', contractReady: true, deploymentBlock: 42,
    status: 'SCHEDULED', votingStartAt: '2026-09-09T10:00:00Z', votingEndAt: '2026-09-09T11:00:00Z', verificationStatus: 'PENDING' };
  assert.equal(eventProgress(event).progress, 100);
  assert.equal(eventProgress(event).message, 'Successfully created event');
  assert.equal(meetingLifecycle(event, Date.parse('2026-09-09T09:59:00Z')), 'SCHEDULED');
  assert.equal(meetingLifecycle(event, Date.parse(event.votingStartAt)), 'OPEN');
  assert.equal(meetingLifecycle(event, Date.parse(event.votingEndAt) + 1), 'CLOSED');
  assert.equal(event.status, 'SCHEDULED', 'presentation never rewrites a stored status');
});

test('resource reads are deduplicated, reused during the freshness window, then revalidated', async () => {
  let calls = 0; let time = 1000;
  const first = pending();
  const store = createResourceStore(() => { calls += 1; return calls === 1 ? first.promise : Promise.resolve(['fresh']); }, { now: () => time });
  assert.equal(store.snapshot('meetings'), store.snapshot('meetings'), 'external-store snapshots are stable');
  const request = store.read('meetings'); const second = store.read('meetings');
  assert.equal(request, second);
  await Promise.resolve(); assert.equal(calls, 1);
  first.resolve(['cached']); await request;
  assert.deepEqual(await store.read('meetings'), ['cached']); assert.equal(calls, 1);
  time += 10001;
  const refresh = store.read('meetings');
  assert.deepEqual(store.snapshot('meetings').data, ['cached']); assert.equal(store.snapshot('meetings').loading, false);
  await refresh; assert.deepEqual(store.snapshot('meetings').data, ['fresh']); assert.equal(calls, 2);
});

test('disposing a session aborts requests and cannot populate a different wallet store', async () => {
  const oldRequest = pending(); let signal;
  const first = createResourceStore((_key, value) => { signal = value; return oldRequest.promise; });
  const second = createResourceStore(() => Promise.resolve(['wallet-b']));
  const request = first.read('meetings'); await Promise.resolve(); first.dispose();
  assert.equal(signal.aborted, true);
  oldRequest.resolve(['wallet-a']); await request;
  await second.read('meetings');
  assert.equal(first.snapshot('meetings').data, null);
  assert.deepEqual(second.snapshot('meetings').data, ['wallet-b']);
});

test('React effect re-acquisition does not dispose an active session store', async () => {
  const store = createResourceStore(() => Promise.resolve(['active']));
  const release = store.retain(); release(); const releaseAgain = store.retain();
  await Promise.resolve(); assert.deepEqual(await store.read('meetings'), ['active']);
  releaseAgain(); await Promise.resolve(); assert.equal(store.snapshot('meetings').data, null);
});

test('authorization failure discards stale eligibility rather than rendering an old private list', async () => {
  let allowed = true;
  const store = createResourceStore(() => allowed ? Promise.resolve(['eligible']) : Promise.reject(Object.assign(new Error('denied'), { status: 403 })));
  await store.read('meetings'); allowed = false;
  await assert.rejects(store.read('meetings', { force: true }), /denied/u);
  assert.equal(store.snapshot('meetings').data, null); assert.equal(store.snapshot('meetings').loading, false);
});

test('server-accepted participation immediately updates meeting categories without claiming confirmation', async () => {
  const event = { id: 'test-event', contractReady: true, discoverable: true, votingStartAt: '2026-09-09T10:00:00Z',
    votingEndAt: '2026-09-09T12:00:00Z', eligibility: { eligible: true, hasVoted: false } };
  const stale = pending(); let count = 0;
  const store = createResourceStore((key) => key === 'meetings' ? Promise.resolve([event]) : ++count === 1 ? Promise.resolve(event) : stale.promise);
  await store.read('meetings'); await store.read('event:test-event');
  const old = store.read('event:test-event', { force: true }); await Promise.resolve();
  recordAcceptedVote(store, event.id, { eventId: event.id, status: 'QUEUED', createdAt: '2026-09-09T11:00:00Z', choices: [0] });
  const groups = groupMeetings(store.snapshot('meetings').data, Date.parse('2026-09-09T11:10:00Z'));
  assert.equal(groups.active.length, 0); assert.equal(groups.recent.length, 1);
  assert.equal(store.snapshot('event:test-event').data.vote.status, 'QUEUED');
  stale.resolve(event); await old;
  assert.equal(store.snapshot('event:test-event').data.vote.status, 'QUEUED', 'a stale GET cannot erase the accepted vote');
});

test('issuer and supported-platform suggestions share typo-tolerant matching', () => {
  assert.equal(searchIssuers(ISSUER_PRESETS, 'tesal')[0].id, 'tesla');
  assert.equal(searchIssuers(ISSUER_PRESETS, 'disney').length, 0);
  assert.equal(searchPlatforms(TOKEN_PLATFORMS, 'coinbsae')[0], 'Coinbase');
  assert.equal(searchPlatforms(TOKEN_PLATFORMS, 'dinrai')[0], 'Dinari');
  assert.equal(searchPlatforms(TOKEN_PLATFORMS, 'krakn').length, 0);
  assert.equal(searchPlatforms(TOKEN_PLATFORMS, 'unknown platform').length, 0);
});

test('new options are capped consistently while displayed and signed legacy text is not truncated', async () => {
  assert.equal(MAX_OPTION_LABEL_LENGTH, 24);
  const [form, validation, ballot] = await Promise.all([
    read('apps/web/src/pages/OrganiserDashboard.jsx'), read('apps/api/src/validation.js'), read('apps/web/src/investor/BallotPage.jsx'),
  ]);
  assert.match(form, /maxLength=\{MAX_OPTION_LABEL_LENGTH\}/u);
  assert.match(validation, /options: z.array\(z.string\(\).trim\(\).min\(1\).max\(MAX_OPTION_LABEL_LENGTH/u);
  assert.match(ballot, /<span>\{option.text\}<\/span>/u);
  assert.match(ballot, /wallet.account !== voter/u);
  assert.match(ballot, /api\(`\/v1\/investor\/events\/\$\{eventId\}\/ballot`/u);
});

test('PDF hyperlink text, underline and actual annotation remain together for every issuer color', async () => {
  const source = await read('apps/api/src/reports.js');
  const start = source.indexOf('  drawValueLine('); const end = source.indexOf('\n  keyValues(', start);
  const linkColor = { red: 42 / 255, green: 107 / 255, blue: 162 / 255 };
  const Writer = vm.runInNewContext(`class Writer {${source.slice(start, end)}}; Writer`, { LINK_COLOR: linkColor, TEXT: 'body' });
  for (const ink of ['red', 'green', 'black']) {
    const writer = new Writer(); writer.ink = ink; const drawn = []; let annotation;
    writer.page = { drawText(_text, opts) { drawn.push(opts.color); }, drawLine(opts) { drawn.push(opts.color); } };
    writer.addLinkAnnotation = (value) => { annotation = value; };
    const font = { widthOfTextAtSize: () => 90, heightAtSize: () => 12 };
    writer.drawValueLine('View transaction', { x: 10, y: 20, size: 10, font, url: 'https://amoy.polygonscan.com/tx/0x123' });
    assert.deepEqual(drawn, [linkColor, linkColor]); assert.match(annotation.url, /polygonscan/u);
    drawn.length = 0; writer.drawValueLine('Regular text', { x: 0, y: 0, size: 10, font });
    assert.deepEqual(drawn, ['body']);
  }
});

test('layout uses a single shared footer and accessible fieldset inner grids', async () => {
  const [app, frame, issuer, ballot, css, logo, footer] = await Promise.all([
    read('apps/web/src/App.jsx'), read('apps/web/src/investor/InvestorFrame.jsx'), read('apps/web/src/issuer/IssuerLayout.jsx'),
    read('apps/web/src/investor/BallotPage.jsx'), read('apps/web/src/investor/investor.css'),
    read('apps/web/public/proxyvote-mark.svg'), read('apps/web/src/components/SiteFooter.jsx'),
  ]);
  assert.equal((app.match(/<SiteFooter \/>/gu) ?? []).length, 1);
  assert.doesNotMatch(frame, /<footer|<InvestorFooter/u); assert.doesNotMatch(issuer, /<footer/u);
  assert.match(footer, /All rights reserved/u);
  assert.match(ballot, /<div className="investor-proposal-row" data-expanded=/u);
  assert.match(css, /\.investor-proposal-row \{ display: grid/u);
  assert.match(css, /background: #f6f5f1/u);
  assert.doesNotMatch(ballot, /Meeting Agenda|Current holdings do not change|Reconnect your investor wallet/u);
  assert.match(logo, /<path/u); assert.doesNotMatch(logo, /<text|data:image|<image/u);
});
