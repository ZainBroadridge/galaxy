import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { MAX_OPTION_LABEL_LENGTH } from '../../../packages/shared/src/constants.js';
import { tokenCatalogue } from '../src/token-catalogue.js';
import { applyCatalogueEntry } from '../../web/src/issuer/catalogue-form.js';
import { eventProgress } from '../../web/src/issuer/event-progress.js';

const read = (file) => readFile(new URL(`../../../${file}`, import.meta.url), 'utf8');

test('neutral autofill runs unchanged across all token mappings and preserves identity and record-date schedule', async () => {
  const source = await read('apps/web/src/pages/OrganiserDashboard.jsx');
  const sample = source.slice(source.indexOf('function demoProposals()'), source.indexOf('function validateDocuments('));
  const demoForm = vm.runInNewContext(sample + '\ndemoForm;', { demoSchedule: () => ({ recordDateAt: 'record', votingStartAt: 'start', votingEndAt: 'end' }) });
  assert.doesNotMatch(sample, /Galaxy|Zenith|Apple|Tesla|NVIDIA|Oracle|SpaceX|Alphabet/iu);
  for (const entry of tokenCatalogue().entries) {
    const current = applyCatalogueEntry({ issuerLogoId: 'custom-logo', documents: ['retained-document'] }, entry);
    const next = demoForm(current);
    for (const key of ['tokenCatalogueId', 'issuerName', 'platform', 'tokenAddress', 'cusip', 'securityName', 'securityTicker', 'issuerLogoId', 'documents']) assert.equal(next[key], current[key], key);
    assert.equal(next.recordDateAt, 'record'); assert.equal(next.votingStartAt, 'start'); assert.equal(next.votingEndAt, 'end');
    assert.equal(next.proposals.length, 5);
    for (const proposal of next.proposals) {
      assert.ok(proposal.options.length >= 2 && proposal.options.length <= 4);
      assert.ok(proposal.options.every((option) => option.length <= MAX_OPTION_LABEL_LENGTH && !/[\r\n\t]/u.test(option)));
      assert.ok(proposal.recommendation >= 0 && proposal.recommendation < proposal.options.length);
    }
  }
});

test('catalogue request is issuer-session gated and the migration only adds nullable presentation fields', async () => {
  const server = await read('apps/api/src/server.js');
  assert.match(server, /app.get\('\/v1\/issuer\/token-catalogue', requireIssuer/u);
  assert.match(server, /private, no-store/u);
  const migration = await read('db/migrations/008_event_token_catalogue.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS token_catalogue_id/u);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS cusip/u);
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\b|\bUPDATE\b/iu);
  assert.doesNotMatch(migration.split('CREATE INDEX')[0], /\bNOT NULL\b/iu);
});

test('all mapping fields use shared selection helpers and placeholders cannot be inspected or submitted by the form', async () => {
  const form = await read('apps/web/src/pages/OrganiserDashboard.jsx');
  assert.match(form, /if \(!selection\?\.configured\) return null/u);
  assert.match(form, /!creating \|\| !selection\?\.configured/u);
  assert.match(form, /if \(!selection\?\.configured\) throw new Error/u);
  assert.match(form, /disabled=\{Boolean\(busyStage\) \|\| !selection\?\.configured\}/u);
  assert.match(form, /Refresh token mapping/u);
  assert.match(form, /readOnly[\s\S]*?ERC-20 token address from selected catalogue mapping/u);
  const fields = await read('apps/web/src/issuer/IssuerBrandingFields.jsx');
  assert.match(fields, /<IssuerAutocomplete/u); assert.match(fields, /<PlatformAutocomplete/u);
  assert.match(fields, /<FuzzyCombobox label="Demo CUSIP"/u);
  assert.match(fields, /applyCatalogueEntry/u); assert.match(fields, /clearCatalogueEntry/u);
  assert.match(fields, /setFile\(null\)/u);
});

test('display-only sign-in methods never submit credentials and real wallet consent is retained', async () => {
  const [landing, session] = await Promise.all([read('apps/web/src/investor/LandingPage.jsx'), read('apps/web/src/investor/InvestorSession.jsx')]);
  assert.equal((landing.match(/<fieldset disabled/gu) || []).length, 2);
  assert.match(landing, /type="email"/u); assert.match(landing, /type="password"/u);
  assert.doesNotMatch(landing, /<form|localStorage|sessionStorage|fetch\(|api\(/u);
  assert.doesNotMatch(landing, /Review and sign|TOKENHOLDER_DISCLOSURE|investor-login-steps/u);
  assert.match(landing, /investor\.begin\(\)/u);
  assert.match(session, /wallet.signDisclaimer\(challenge.message, account\)/u);
  assert.match(session, /\/v1\/auth\/verify/u);
  assert.match(session, /challenge.message !== expected/u);
});

test('redundant disclosures and welcome navigation are removed without changing explicit back destinations', async () => {
  const files = await Promise.all(['LandingPage.jsx', 'InvestorFrame.jsx', 'BallotPage.jsx', 'MeetingsPage.jsx', 'ConfirmationPage.jsx'].map((file) => read(`apps/web/src/investor/${file}`)));
  files.forEach((source) => assert.doesNotMatch(source, /StandingDisclosure|TOKENHOLDER_DISCLOSURE|voting capabilities of tokenholders|Select one option for every proposal/u));
  assert.doesNotMatch(files[3], /BackLink|Back to welcome/u);
  assert.match(files[1], /<ExitButton onClick=\{\(\) => void signOut\(\)\}/u);
  assert.match(files[1], /BackLink to="\/meetings\?tab=active"/u);
  const back = await read('apps/web/src/components/BackLink.jsx');
  assert.match(back, /<span>Back<\/span>/u);
  const home = await read('apps/web/src/pages/HomePage.jsx');
  assert.doesNotMatch(home, /Back to investor welcome|<BackLink/u);
});

test('ballot and confirmation share one header and deadline, while signed choices remain untouched', async () => {
  const ballot = await read('apps/web/src/investor/BallotPage.jsx');
  const confirmation = await read('apps/web/src/investor/ConfirmationPage.jsx');
  const frame = await read('apps/web/src/investor/InvestorFrame.jsx');
  for (const page of [ballot, confirmation]) assert.match(page, /<MeetingPageHeader event=\{event\}/u);
  assert.doesNotMatch(ballot, /Vote by \$\{/u);
  assert.doesNotMatch(confirmation, /<p>Voting deadline:/u);
  assert.match(frame, /Voting deadline: \{displayDate\(event.votingEndAt\)\}/u);
  assert.match(frame, /Tokenised stock: \{event.tokenName\}/u);
  assert.match(frame, /className="investor-token-address"/u);
  assert.match(ballot, /<span>\{option.text\}<\/span>/u);
  assert.doesNotMatch(ballot, /option.text.(?:slice|substring)/u);
  assert.match(ballot, /wallet.signBallot\(typed\)/u);
  assert.match(ballot, /ballot.metadataHash !== event.metadataHash/u);
  assert.match(ballot, /activeWallet.current !== voter/u);
});

test('completed progress hides the bar and source verification remains independent', async () => {
  const source = await read('apps/web/src/pages/OrganiserDashboard.jsx');
  assert.match(source, /!progress.ready && jobActive && <div className="job-progress"/u);
  const result = eventProgress({ snapshotRoot: 'root', contractReady: true, contractAddress: 'address', deploymentBlock: 123, verificationStatus: 'PENDING' });
  assert.equal(result.ready, true); assert.equal(result.progress, 100);
  assert.equal(result.message, 'Successfully created event'); assert.equal(result.verificationActive, true);
});

test('results title is independent of logo width and the redundant closed badge is gone', async () => {
  const page = await read('apps/web/src/pages/ResultsPage.jsx');
  const details = page.slice(page.indexOf('export function EventResultsPage'));
  assert.match(details, /className="issuer-results-identity"/u);
  assert.match(details, /<div><h1>\{event.title\} Results<\/h1><p>\{event.tokenName\}/u);
  assert.doesNotMatch(details, /<Status/u);
  const style = await read('apps/web/src/issuer/issuer.css');
  assert.match(style, /grid-template-columns: 140px minmax\(0,1fr\) 140px/u);
  assert.match(style, /\.issuer-results-identity > div \{ grid-column: 2; text-align: center/u);
});
