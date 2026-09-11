import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { boardRecommendedChoices, completeChoices, displayHolding, groupMeetings, safeInvestorReturn } from '../../web/src/investor/meeting-utils.js';
import { visibleCreationNotice } from '../../web/src/issuer/notice-state.js';
import { imageHeader } from '../src/logo-validation.js';
import { ISSUER_PRESETS, issuerBranding, issuerPreset } from '../../../packages/shared/src/issuer-branding.js';
import { INVESTOR_DISCLAIMER_VERSION, investorSignInMessage } from '../../../packages/shared/src/investor-disclaimer.js';
import { LEGACY_CAST_VOTE, READABLE_CAST_VOTE, proposalAnnouncementText, readableBallotSelections, readableVoteText, voteCall } from '../../../packages/shared/src/ballot-labels.js';

const now = Date.parse('2026-09-08T12:00:00Z');
const minute = 60_000;
function meeting(id, end, extra = {}) {
  return { id, contractReady: true, status: end > now ? 'OPEN' : 'CLOSED',
    votingStartAt: new Date(now - minute).toISOString(), votingEndAt: new Date(end).toISOString(),
    eligibility: { eligible: true, hasVoted: false }, ...extra };
}
const proposals = [
  { title: 'Elect directors', description: 'Review the slate.', options: [{ text: 'For' }, { text: 'Withhold' }], recommendation: 0 },
  { title: 'Auditor appointment', description: '', options: [{ text: 'For' }, { text: 'Against' }, { text: 'Abstain' }], recommendation: 2 },
];

test('active meetings contain only eligible unvoted events and sort by deadline', () => {
  const events = [meeting('later', now + 9 * minute), meeting('soon', now + minute),
    meeting('ineligible', now + minute, { eligibility: { eligible: false } }),
    meeting('voted', now + minute, { voteStatus: 'CONFIRMED', voteCreatedAt: new Date(now).toISOString() }),
    meeting('hidden', now + minute, { discoverable: false }), meeting('undeployed', now + minute, { contractReady: false }),
    meeting('expired', now - minute)];
  assert.deepEqual(groupMeetings(events, now).active.map((item) => item.id), ['soon', 'later']);
  assert.equal(events[0].id, 'later', 'tab sorting must not mutate the API array');
});

test('recent includes pending participation; past includes voted AND unvoted eligible meetings', () => {
  const events = [meeting('past-unvoted', now - minute),
    meeting('past-voted', now - 2 * minute, { voteStatus: 'CONFIRMED', voteCreatedAt: new Date(now - 9 * minute).toISOString() }),
    meeting('pending', now + minute, { voteStatus: 'QUEUED', voteCreatedAt: new Date(now - minute).toISOString() }),
    meeting('failed', now + minute, { voteStatus: 'FAILED' })];
  const grouped = groupMeetings(events, now);
  assert.deepEqual(grouped.recent.map((item) => item.id), ['pending', 'past-voted']);
  assert.deepEqual(grouped.past.map((item) => item.id), ['past-unvoted', 'past-voted']);
  assert.deepEqual(grouped.active.map((item) => item.id), ['failed']);
});

test('scheduled eligible events remain visible without being treated as open for voting', () => {
  const scheduled = meeting('scheduled', now + 60 * minute, { status: 'SCHEDULED', votingStartAt: new Date(now + minute).toISOString() });
  assert.equal(groupMeetings([scheduled], now).active[0].status, 'SCHEDULED');
});

test('Board selection requires every valid recommendation and accepts index zero', () => {
  assert.deepEqual(boardRecommendedChoices(proposals), [0, 2]);
  for (const recommendation of [undefined, null, -1, 3, 0.5, '0']) {
    assert.equal(boardRecommendedChoices([proposals[0], { ...proposals[1], recommendation }]), null);
  }
  assert.equal(boardRecommendedChoices([]), null);
  assert.equal(completeChoices(proposals, [0, 2]), true);
  for (const choices of [[null, 2], [0], [0, 3], [0, -1], ['0', 1]]) assert.equal(completeChoices(proposals, choices), false);
});

test('balances keep integer precision and are displayed separately from snapshot power', () => {
  assert.equal(displayHolding('27305900', 6), '27.3059');
  assert.equal(displayHolding('9007199254740993000000001', 18), '9007199.254740993000000001');
  assert.equal(displayHolding('0', 18), '0');
  assert.equal(displayHolding('7', 0), '7');
  assert.equal(displayHolding(undefined, 6), 'Unavailable');
});

test('return routes cannot redirect to an external origin or the issuer portal', () => {
  for (const value of ['https://evil.example', '//evil.example', '/issuer/home', '/vote/abc\\evil', undefined]) {
    assert.equal(safeInvestorReturn(value), '/meetings');
  }
  assert.equal(safeInvestorReturn('/vote/1234-abcd/confirmation'), '/vote/1234-abcd/confirmation');
  assert.equal(safeInvestorReturn('/meetings?tab=past'), '/meetings?tab=past');
});

test('snapshot creation notice disappears on snapshot completion without hiding other notices', () => {
  const notice = 'Event created successfully. Snapshot processing has started.';
  assert.equal(visibleCreationNotice({ snapshotRoot: null }, notice), notice);
  assert.equal(visibleCreationNotice({ snapshotRoot: '0xabc' }, notice), null);
  assert.equal(visibleCreationNotice({ snapshotRoot: '0xabc' }, 'Document upload failed.'), 'Document upload failed.');
  assert.equal(visibleCreationNotice(null, null), null);
});

test('issuer presets use exact aliases, never infer affiliation from a token ticker', () => {
  assert.equal(issuerPreset('  Apple INC. ').id, 'apple');
  assert.equal(issuerPreset('Google').id, 'alphabet');
  assert.equal(issuerPreset('AAPL.d'), null);
  assert.equal(issuerPreset('Fake Apple investment'), null);
  assert.equal(ISSUER_PRESETS.length, 7);
  assert.equal(issuerBranding({ issuerName: 'Tesla', platform: 'Ondo' }).platform, 'Ondo');
});

test('every bundled issuer preset has matching valid PNG bytes for browser and PDF', async () => {
  for (const preset of ISSUER_PRESETS) {
    const web = await readFile(new URL(`../../web/public/issuer-logos/${preset.logoFile}`, import.meta.url));
    const pdf = await readFile(new URL(`../assets/issuer-logos/${preset.logoFile}`, import.meta.url));
    assert.deepEqual(web, pdf);
    assert.equal(imageHeader(web).mimeType, 'image/png');
  }
});

test('image preflight rejects unsupported, oversized and excessive-pixel uploads', () => {
  assert.throws(() => imageHeader(Buffer.from('<svg>not allowed</svg>')), /PNG and JPEG/);
  assert.throws(() => imageHeader(Buffer.alloc(524289)), /512 KB/);
  const header = Buffer.alloc(33);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(header);
  header.writeUInt32BE(13, 8); header.write('IHDR', 12);
  header.writeUInt32BE(2048, 16); header.writeUInt32BE(2048, 20);
  assert.throws(() => imageHeader(header), /four million/);
  header.writeUInt32BE(640, 16); header.writeUInt32BE(180, 20);
  assert.deepEqual(imageHeader(header), { mimeType: 'image/png', width: 640, height: 180 });
});

test('readable vote labels bind actual proposal and option text plus indexes', () => {
  const selections = readableBallotSelections(proposals, [1, 0]);
  assert.deepEqual(selections, [
    { proposalNumber: 1, proposal: 'Elect directors\n\nReview the slate.', optionNumber: 2, selectedOption: 'Withhold' },
    { proposalNumber: 2, proposal: 'Auditor appointment', optionNumber: 1, selectedOption: 'For' },
  ]);
  assert.equal(readableVoteText(selections), 'Proposal 1: Elect directors\n\nReview the slate.\nSelected option: Withhold\n\nProposal 2: Auditor appointment\nSelected option: For');
  assert.equal(proposalAnnouncementText({ title: ' T\r\nT ', description: ' D\r\nD ' }), 'T\nT\n\nD\nD');
  for (const choices of [[0], [3, 0], [null, 0], ['0', 0]]) assert.throws(() => readableBallotSelections(proposals, choices));
});

test('legacy calldata stays five-argument; version four uses bound readable selections', () => {
  const input = { voter: '0x' + '1'.repeat(40), snapshotBalance: '99', proof: [], choicesBytes: '0x0001', choices: [0, 1], proposals, signature: '0x12' };
  for (const ballotVersion of [2, 3]) {
    const call = voteCall({ ...input, ballotVersion });
    assert.equal(call.method, LEGACY_CAST_VOTE); assert.equal(call.args.length, 5);
    assert.equal(call.args[4], input.signature);
  }
  const call = voteCall({ ...input, ballotVersion: 4 });
  assert.equal(call.method, READABLE_CAST_VOTE); assert.equal(call.args.length, 6);
  assert.equal(call.args[4][0].selectedOption, 'For');
  assert.throws(() => voteCall({ ...input, ballotVersion: 8 }), /Unsupported/);
});

test('disclaimer binds website, wallet, nonce, chain, expiry and consent without authorizing a vote', () => {
  const input = { origin: 'https://galaxy-api-ten.vercel.app', walletAddress: '0x' + 'a'.repeat(40), chainId: 80002,
    nonce: 'b'.repeat(48), issuedAt: '2026-09-08T12:00:00Z', expiresAt: '2026-09-08T12:10:00Z' };
  const message = investorSignInMessage(input);
  for (const value of [input.origin, input.walletAddress, input.nonce, '80002', INVESTOR_DISCLAIMER_VERSION]) assert.ok(message.includes(value));
  assert.match(message, /not cast a vote|does not cast a vote/i);
  assert.notEqual(message, investorSignInMessage({ ...input, nonce: 'c'.repeat(48) }));
  assert.throws(() => investorSignInMessage({ ...input, origin: 'javascript:alert(1)' }));
});
