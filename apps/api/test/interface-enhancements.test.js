import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { eventProgress } from '../../web/src/issuer/event-progress.js';
import { visibleCreationNotice } from '../../web/src/issuer/notice-state.js';
import { searchIssuers } from '../../web/src/issuer/issuer-search.js';
import { meetingPresentation } from '../../web/src/investor/presentation.js';
import { ISSUER_PRESETS } from '../../../packages/shared/src/issuer-branding.js';

const read = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const now = Date.parse('2026-09-09T10:00:00Z');
const deployed = { snapshotRoot: 'root', contractAddress: 'contract', contractReady: true, deploymentBlock: 40 };
test('deployed events stay ready regardless of explorer queue or failure', () => {
  for (const verificationStatus of ['PENDING', 'FAILED', 'VERIFIED', 'NOT_SUBMITTED']) {
    const result = eventProgress({ ...deployed, verificationStatus, job: { type: 'VERIFY_CONTRACT', status: 'FAILED', progress: 86 } }, now);
    assert.equal(result.ready, true); assert.equal(result.progress, 100); assert.equal(result.active, false);
    assert.equal(result.canRetryBuild, false); assert.equal(result.waitingForRecordDate, false);
  }
  assert.equal(eventProgress({ contractExplorerUrl: 'url', deploymentExplorerUrl: 'url' }, now).ready, false);
  assert.equal(eventProgress({ ...deployed, deploymentBlock: null }, now).ready, false);
});
test('only actual future-record-date snapshot work is labeled scheduled', () => {
  const job = { type: 'BUILD_SNAPSHOT', status: 'PENDING', availableAt: new Date(now + 60000).toISOString() };
  const event = { job, recordDateAt: job.availableAt };
  assert.equal(eventProgress(event, now).waitingForRecordDate, true);
  assert.equal(eventProgress({ ...event, job: { ...job, type: 'VERIFY_CONTRACT' } }, now).waitingForRecordDate, false);
  assert.equal(eventProgress({ ...event, job: { ...job, error: 'RPC unavailable' } }, now).waitingForRecordDate, false);
  assert.equal(eventProgress({ job: { ...job, message: 'Waiting for Polygon finality at record date' } }, now).waitingForRecordDate, true);
});
test('completed snapshot notices do not linger while unrelated notices remain visible', () => {
  for (const event of [{ snapshotRoot: 'root' }, deployed]) {
    assert.equal(visibleCreationNotice(event, 'Snapshot processing has started.'), null);
    assert.equal(visibleCreationNotice(event, 'Snapshot scheduled for tomorrow.'), null);
    assert.equal(visibleCreationNotice(event, 'PDF upload failed.'), 'PDF upload failed.');
  }
});
test('fuzzy suggestions handle common typos, aliases and tickers without mutating historical branding', () => {
  for (const [query, id] of [['appl', 'apple'], ['aapl', 'apple'], ['tesal', 'tesla'], ['nvida', 'nvidia'], ['google', 'alphabet'], ['orcle', 'oracle'], ['spacex', 'spacex']]) {
    assert.equal(searchIssuers(ISSUER_PRESETS, query)[0]?.id, id, query);
  }
  assert.equal(searchIssuers(ISSUER_PRESETS, 'zzzzzzzzzz').length, 0);
  assert.equal(searchIssuers(ISSUER_PRESETS, '').length, 6);
  assert.deepEqual(searchIssuers(ISSUER_PRESETS, ''), [...ISSUER_PRESETS]);
});
test('platform branding uses one header logo and shows the issuer by the title only when needed', () => {
  for (const platform of ['', '   ', undefined]) {
    assert.equal(meetingPresentation({ platform }).header, 'issuer');
    assert.equal(meetingPresentation({ platform }).showIssuerByTitle, false);
  }
  const ondo = meetingPresentation({ platform: ' Ondo ' });
  assert.equal(ondo.header, 'platform'); assert.equal(ondo.platformLogo, '/investor/ondo-logo.png');
  assert.equal(ondo.showIssuerByTitle, true);
  assert.equal(meetingPresentation(null).header, 'proxyvote');
});
test('meeting search is removed and the fixed web palette does not inherit issuer colors', async () => {
  const [meetings, frame, styles] = await Promise.all([
    read('apps/web/src/investor/MeetingsPage.jsx'), read('apps/web/src/investor/InvestorFrame.jsx'), read('apps/web/src/investor/investor.css'),
  ]);
  assert.doesNotMatch(meetings, /type="search"|setSearch|investor-search|setQuery/u);
  assert.doesNotMatch(frame, /issuerInkColor|--inv-blue|style=|investor-issuer-theme/u);
  assert.doesNotMatch(styles, /var\(--issuer|investor-issuer-theme/u);
  assert.match(styles, /max-width: 1024px/u);
  assert.match(styles, /--inv-blue: #2a6ba2/u);
});
test('document counts, compact board control and broadcast spinner are explicit components', async () => {
  const [ballot, receipt, styles, documents] = await Promise.all([
    read('apps/web/src/investor/BallotPage.jsx'), read('apps/web/src/investor/ConfirmationPage.jsx'), read('apps/web/src/investor/investor.css'),
    read('apps/web/src/investor/EventDocuments.jsx'),
  ]);
  assert.match(ballot, /<EventDocuments event=\{event\} \/>/u);
  assert.match(receipt, /<EventDocuments event=\{event\}/u);
  assert.match(documents, /data-count=\{documents.length\}/u);
  assert.match(documents, /if \(!documents.length\) return null/u);
  assert.match(documents, /rel="noopener noreferrer"/u);
  assert.match(ballot, /investor-board-button/u);
  assert.match(receipt, /<LoadingIndicator>Waiting for the relayer to broadcast<\/LoadingIndicator>/u);
  for (const count of ['1', '2']) assert.ok(styles.includes(`[data-count='${count}']`));
  assert.match(styles, /--inv-doc-red: #cf0039/u);
});
test('issuer autocomplete, accessible exit, required fields and demo action have bounded scope', async () => {
  const [autocomplete, layout, organiser, gate, home] = await Promise.all([
    read('apps/web/src/components/FuzzyCombobox.jsx'), read('apps/web/src/issuer/IssuerLayout.jsx'),
    read('apps/web/src/pages/OrganiserDashboard.jsx'), read('apps/web/src/issuer/IssuerSession.jsx'), read('apps/web/src/pages/HomePage.jsx'),
  ]);
  assert.match(autocomplete, /role="combobox"/u); assert.match(autocomplete, /aria-activedescendant/u);
  assert.match(autocomplete, /ArrowDown/u); assert.match(autocomplete, /Escape/u);
  assert.match(layout, /aria-label="Exit issuer interface"/u);
  assert.match(gate, /<ParticleBackground \/>/u); assert.match(gate, /<BrandLockup>/u);
  assert.match(organiser, /create-details-heading[\s\S]*?onClick=\{fillDemoData\}/u);
  assert.match(organiser, /Event title<RequiredMark/u);
  assert.doesNotMatch(home, /home-proxy-info|What is a proxy vote/u);
});
