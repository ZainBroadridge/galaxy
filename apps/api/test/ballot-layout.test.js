import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { boardRecommendedChoices, completeChoices, displayDate, displayHolding, meetingLifecycle } from '../../web/src/investor/meeting-utils.js';

const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch { ts = require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript')); }
const read = (file) => readFile(new URL(`../../../${file}`, import.meta.url), 'utf8');
const jsx = (type, props) => ({ type, props: props ?? {} });
const nothing = () => null;
const event = {
  id: 'a77131bd-bd59-4727-8726-f3f7315a537c', metadataHash: 'fixed-metadata', contractReady: true,
  metadataIntegrity: true, votingStartAt: '2026-09-01T00:00:00Z', votingEndAt: '2027-01-01T00:00:00Z',
  recordDateAt: '2026-08-31T00:00:00Z', tokenDecimals: 0, tokenSymbol: 'TST', cusip: 'DEMO02002',
  eligibility: { eligible: true, hasVoted: false, votingPower: '10', snapshotBalance: '10' },
  proposals: [
    { title: 'Directors', description: 'Choose a slate', recommendation: 0, options: ['For all', 'Withhold all', 'Except Nominee C'].map((text) => ({ text })) },
    { title: 'Auditor', recommendation: 1, options: ['For', 'Against', 'Abstain'].map((text) => ({ text })) },
    { title: 'Frequency', recommendation: 2, options: ['Every year', 'Every 2 years', 'Every 3 years', 'Abstain'].map((text) => ({ text })) },
    { title: 'Plan', recommendation: 0, options: ['For', 'Against'].map((text) => ({ text })) },
  ],
};
function nodes(tree) {
  if (tree == null || typeof tree === 'boolean') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props.children)];
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (typeof tree !== 'object') return String(tree);
  return text(tree.props.children);
}
async function renderBallot(input = event) {
  const state = [];
  let cursor = 0, apiCalls = 0, signatures = 0;
  const imports = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    react: { useEffect: nothing, useMemo: (fn) => fn(), useRef: (value) => ({ current: value }), useState: (initial) => {
      const index = cursor++;
      if (!(index in state)) state[index] = index === 0 ? input.proposals.map(() => null) : initial;
      return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
    } },
    'react-router-dom': { Link: 'a', useNavigate: () => nothing, useParams: () => ({ eventId: input.id }) },
    '@pv/shared': { ballotTypedData: nothing },
    '../api.js': { API_BASE_URL: 'https://api.example.test', api: () => { apiCalls += 1; } },
    '../hooks.js': { useEventLiveRefresh: nothing, useEventPolling: nothing, useLoad: () => ({ data: { rawBalance: '10' } }) },
    '../wallet.jsx': { useWallet: () => ({ connected: true, account: 'wallet', signBallot: () => { signatures += 1; } }) },
    '../components/ResourceSkeleton.jsx': { default: 'skeleton' },
    './InvestorData.jsx': { useInvestorData: () => ({ acceptedVote: nothing }), useInvestorResource: () => ({ data: input }) },
    './EventDocuments.jsx': { default: 'documents' },
    './useInvestorEvent.js': { useInvestorEvent: () => ({ data: input }) },
    './useBallotColumns.js': { useBallotColumns: () => ({ current: null }) },
    '../data/useDeadlineClock.js': { useDeadlineClock: () => Date.parse('2026-09-10T12:00:00Z') },
    './InvestorSession.jsx': { useInvestorSession: () => ({ session: { walletAddress: 'wallet' } }) },
    './InvestorFrame.jsx': { ArrowIcon: 'svg', DocumentIcon: 'svg', ErrorMessage: 'error', InvestorFrame: 'frame', MeetingPageHeader: 'meeting-header' },
    './meeting-utils.js': { boardRecommendedChoices, completeChoices, displayDate, displayHolding, meetingLifecycle },
  };
  const source = await read('apps/web/src/investor/BallotPage.jsx');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, { exports, require: (name) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`); return imports[name];
  }, window: { requestAnimationFrame: (fn) => fn(), matchMedia: () => ({ matches: true }) } });
  const render = () => { cursor = 0; return exports.default(); };
  return { render, state, calls: () => ({ apiCalls, signatures }) };
}

test('mixed-length and mixed-count proposals share equal columns with empty cells for absent options', async () => {
  const fixture = await renderBallot();
  const tree = fixture.render(); const rendered = nodes(tree);
  const tables = rendered.filter((node) => node.type === 'table');
  assert.equal(tables.length, 1, 'Every proposal must belong to the same table.');
  const ballot = tables[0];
  assert.equal(ballot.props.style['--ballot-option-columns'], 4);
  assert.equal(nodes(ballot).filter((node) => node.type === 'col' && node.props.className === 'investor-option-column').length, 4);
  const rows = nodes(ballot).filter((node) => node.type === 'tr');
  assert.equal(rows.length, 4);
  for (const [index, row] of rows.entries()) {
    const cells = nodes(row).filter((node) => node.type === 'td');
    assert.equal(cells.length, 4, 'Fewer choices must not redistribute the remaining columns.');
    const heading = nodes(row).find((node) => node.type === 'th');
    assert.equal(heading.props.scope, 'row');
    assert.ok(text(heading).includes(event.proposals[index].title));
    const radios = nodes(row).filter((node) => node.type === 'input');
    assert.equal(radios.length, event.proposals[index].options.length);
    radios.forEach((radio, option) => {
      assert.equal(radio.props.type, 'radio'); assert.equal(radio.props.name, `proposal-${index}`);
      assert.equal(radio.props.value, option);
      assert.equal(radio.props['aria-describedby'], `proposal-title-${index}`);
      assert.equal(radio.props.disabled, false);
      assert.equal(text(cells[option]), event.proposals[index].options[option].text);
    });
    for (const cell of cells.slice(radios.length)) {
      assert.equal(nodes(cell).filter((node) => node.type === 'input').length, 0);
      assert.equal(text(cell), '', 'Padding cells must not introduce fake choices.');
    }
  }
  const header = rendered.find((node) => node.type === 'meeting-header');
  assert.equal(header.props.showCusip, false);
  assert.equal(header.props.showTags, false);
  const cusip = rendered.find((node) => node.props.className === 'investor-ballot-cusip');
  assert.equal(text(cusip), `CUSIP: ${event.cusip}`);
  assert.ok(rendered.indexOf(cusip) > rendered.indexOf(tables[0]));
});

test('long historical option wording stays intact and ineligible ballots disable every radio', async () => {
  const option = 'Existing option wording that is longer than the new creation limit';
  const input = { ...event, eligibility: { ...event.eligibility, eligible: false },
    proposals: [{ ...event.proposals[0], options: [{ text: option }, { text: 'Against' }] }] };
  const fixture = await renderBallot(input);
  const rendered = nodes(fixture.render());
  assert.ok(rendered.some((node) => node.type === 'span' && text(node) === option));
  const radios = rendered.filter((node) => node.type === 'input' && node.props.type === 'radio');
  assert.equal(radios.length, 2);
  assert.ok(radios.every((node) => node.props.disabled));
});

test('manual selection changes only its proposal and Board/Reset never sign or submit', async () => {
  const fixture = await renderBallot();
  let tree = fixture.render();
  nodes(tree).find((node) => node.type === 'input' && node.props.name === 'proposal-1' && node.props.value === 2).props.onChange();
  assert.deepEqual(Array.from(fixture.state[0]), [null, 2, null, null]);
  tree = fixture.render();
  nodes(tree).find((node) => node.type === 'button' && text(node) === 'Vote with Board').props.onClick();
  assert.deepEqual(Array.from(fixture.state[0]), [0, 1, 2, 0]);
  tree = fixture.render();
  assert.equal(nodes(tree).find((node) => node.props.className === 'inv-button investor-submit-button').props.disabled, false);
  nodes(tree).find((node) => node.type === 'button' && text(node) === 'Reset All').props.onClick();
  assert.deepEqual(Array.from(fixture.state[0]), [null, null, null, null]);
  assert.deepEqual(fixture.calls(), { apiCalls: 0, signatures: 0 });
});

test('missing board recommendations keep the shortcut hidden', async () => {
  const fixture = await renderBallot({ ...event, proposals: event.proposals.map((proposal, index) => ({ ...proposal, recommendation: index === 0 ? null : proposal.recommendation })) });
  assert.equal(nodes(fixture.render()).filter((node) => node.type === 'button' && text(node) === 'Vote with Board').length, 0);
});

test('print keeps proposal rows intact and allows full option text to wrap on paper', async () => {
  const css = await read('apps/web/src/investor/investor.css');
  assert.match(css, /@media print[\s\S]*?\.investor-proposal \{ break-inside: avoid; page-break-inside: avoid/u);
  assert.match(css, /@media print[\s\S]*?\.investor-proposals-table \{ min-width: 0; table-layout: fixed/u);
  assert.match(css, /@media print[\s\S]*?\.investor-option-label span \{[^}]*white-space: normal; overflow-wrap: anywhere/u);
  assert.doesNotMatch(css, /data-expanded|--option-count/u);
});

test('topbar and ballot use the same palette and logos use the supplied blue and white artwork', async () => {
  const [css, brandCss, brand] = await Promise.all([read('apps/web/src/investor/investor.css'), read('apps/web/src/components/brand.css'), read('apps/web/src/components/BrandLockup.jsx')]);
  assert.match(css, /\.investor-utility \{ background: var\(--pv-blue-band\)/u);
  assert.match(css, /\.investor-ballot-heading \{[^}]*background: var\(--pv-blue-band\)/u);
  assert.match(brand, /inverse \? '\/proxyvote-brand-white.png' : '\/proxyvote-brand-blue.png'/u);
  assert.match(brand, /alt="ProxyVote"/u);
  assert.match(brandCss, /\.proxyvote-artwork \{[^}]*object-fit: contain/u);
  assert.doesNotMatch(brandCss, /mask-image|filter: brightness/u);
});

test('the unnecessary CUSIP sentence is absent and the empty meeting state is centered', async () => {
  const [fields, css] = await Promise.all([read('apps/web/src/issuer/IssuerBrandingFields.jsx'), read('apps/web/src/investor/investor.css')]);
  assert.doesNotMatch(fields, /These CUSIPs are fictitious demo identifiers/u);
  assert.match(fields, /label="Demo CUSIP"/u);
  assert.match(css, /\.investor-empty \{[^}]*text-align: center/u);
});

test('both file pickers append, reset the native input, and preserve state on rejection', async () => {
  const source = await read('apps/web/src/pages/OrganiserDashboard.jsx');
  const create = source.slice(source.indexOf('function chooseDocuments('), source.indexOf('async function submit('));
  const manage = source.slice(source.indexOf('function chooseAdditionalDocuments('), source.indexOf('async function uploadDocuments('));
  for (const handler of [create, manage]) {
    assert.match(handler, /appendPdfSelection/u); assert.match(handler, /input.value = ''/u);
    assert.doesNotMatch(handler, /setDocument(?:s|Files)\(\[\]\)/u);
  }
  assert.match(manage, /view.data\?\.documents\?\.length \?\? 0/u);
  assert.match(source, /setDocumentFiles\(\(current\) => current.filter\(\(selected\) => selected !== file\)\)/u);
});
