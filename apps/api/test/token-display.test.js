import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { eventIssuerBranding } from '../../../packages/shared/src/issuer-branding.js';
import { meetingPresentation } from '../../web/src/investor/presentation.js';

// Compile the actual JSX using the repository's existing TypeScript tooling.
// Router/session/image boundaries are fixtures; there is no wallet or RPC call.
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch {
  ts = require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript'));
}
const read = (file) => readFile(new URL(`../../../${file}`, import.meta.url), 'utf8');
const jsx = (type, props) => ({ type, props: props ?? {} });
const empty = () => null;
const event = {
  title: 'Annual meeting', issuerName: 'Tesla', tokenName: 'Tesla, Inc.', tokenSymbol: 'TSLA',
  tokenAddress: '0xf3ba8da491a237cebef4fc0f95baa1483f2ae0dc',
  securityName: 'Tesla, Inc. - Common Stock', securityTicker: 'TSLA', platform: 'Dinari',
  cusip: 'DEMO02002', votingEndAt: '2026-09-10T15:00:00Z',
};

async function loadFrame(environment = {}) {
  const source = (await read('apps/web/src/investor/InvestorFrame.jsx')).replaceAll('import.meta.env', JSON.stringify(environment));
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } });
  const imports = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    react: { useState: (value) => [value, empty] },
    'react-router-dom': { Link: empty, NavLink: empty },
    '@pv/shared': { eventIssuerBranding },
    './InvestorSession.jsx': { useInvestorSession: () => ({ session: null, signOut: empty }) },
    '../notifications.jsx': { useNotifications: () => ({ unreadCount: 0 }) },
    '../components/IssuerLogo.jsx': { default: (props) => jsx('img', { ...props, alt: 'Issuer logo' }) },
    '../components/BackLink.jsx': { default: empty },
    '../components/ExitButton.jsx': { default: empty },
    './meeting-utils.js': { displayDate: (value) => value },
    '../components/BrandLockup.jsx': { default: (props) => props.children, ProxyVoteMark: empty },
    './presentation.js': { meetingPresentation },
  };
  const exports = {};
  vm.runInNewContext(compiled.outputText, { exports, require: (name) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`);
    return imports[name];
  } });
  return exports;
}

function nodes(value) {
  if (value == null || typeof value === 'boolean') return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (typeof value !== 'object') return [];
  if (typeof value.type === 'function') return nodes(value.type(value.props));
  return [value, ...nodes(value.props.children)];
}
function text(value) {
  if (value == null || typeof value === 'boolean') return '';
  if (Array.isArray(value)) return value.map(text).join('');
  if (typeof value !== 'object') return String(value);
  return text(typeof value.type === 'function' ? value.type(value.props) : value.props.children);
}

test('token name is the link, address is tooltip/accessibility metadata only', async () => {
  const { SecurityIdentity } = await loadFrame();
  const tree = SecurityIdentity({ event });
  const links = nodes(tree).filter((node) => node.type === 'a');
  assert.equal(links.length, 1);
  const { props } = links[0];
  assert.equal(text(props.children), 'Tesla, Inc. (TSLA)');
  assert.equal(props.href, `https://amoy.polygonscan.com/address/${event.tokenAddress}`);
  assert.equal(props.title, event.tokenAddress);
  assert.ok(props['aria-label'].includes(event.tokenAddress));
  assert.equal(props.target, '_blank'); assert.equal(props.rel, 'noopener noreferrer');
  assert.ok(text(tree).includes('Tokenised stock:'));
  assert.ok(text(tree).includes(event.cusip));
  assert.ok(!text(tree).includes(event.tokenAddress));
});

test('configured explorer and trailing slash are respected without printing the address', async () => {
  const { SecurityIdentity } = await loadFrame({ VITE_BLOCK_EXPLORER_URL: 'https://explorer.example.test/' });
  const tree = SecurityIdentity({ event: { ...event, tokenSymbol: '' } });
  const link = nodes(tree).find((node) => node.type === 'a');
  assert.equal(link.props.href, `https://explorer.example.test/address/${event.tokenAddress}`);
  assert.equal(text(link), 'Tesla, Inc.');
});

test('an absent token address leaves a readable name rather than an empty link', async () => {
  const { SecurityIdentity } = await loadFrame();
  const tree = SecurityIdentity({ event: { ...event, tokenAddress: null } });
  assert.equal(nodes(tree).filter((node) => node.type === 'a').length, 0);
  assert.ok(text(tree).includes('Tesla, Inc. (TSLA)'));
});

test('ballot moves CUSIP below the options and hides tags while preserving its issuer and deadline', async () => {
  const { MeetingPageHeader, BrandBand } = await loadFrame();
  const tree = MeetingPageHeader({ event, showTags: false, showCusip: false });
  assert.equal(nodes(tree).filter((node) => node.props.className === 'investor-tags').length, 0);
  assert.ok(text(tree).includes(event.title)); assert.ok(!text(tree).includes(event.cusip));
  assert.ok(text(tree).includes('Voting deadline:'));
  assert.equal(nodes(tree).filter((node) => node.props.className === 'investor-issuer-logo').length, 1);
  const band = nodes(BrandBand({ event }));
  assert.equal(band.find((node) => node.props.className === 'investor-platform-logo').props.src, '/investor/dinari-logo.png');
  const ballot = await read('apps/web/src/investor/BallotPage.jsx');
  assert.match(ballot, /<MeetingPageHeader event=\{event\} showTags=\{false\} showCusip=\{false\} \/>/u);
  assert.match(ballot, /<\/table>[\s\S]*className="investor-ballot-cusip">CUSIP: <strong>\{event.cusip\}<\/strong>/u);
});

test('confirmation hides platform tags while meeting-list tags and confirmation CUSIP remain visible', async () => {
  const { MeetingPageHeader, MeetingTags } = await loadFrame();
  const header = MeetingPageHeader({ event, showTags: false });
  assert.equal(nodes(header).filter((node) => node.props.className === 'investor-tags').length, 0);
  assert.ok(text(header).includes(event.cusip));
  assert.ok(text(MeetingTags({ platform: 'Dinari', children: 'Voted' })).includes('DinariVoted'));
  const confirmation = await read('apps/web/src/investor/ConfirmationPage.jsx');
  assert.match(confirmation, /<MeetingPageHeader event=\{event\} showTags=\{false\} \/>/u);
  const meetings = await read('apps/web/src/investor/MeetingsPage.jsx');
  assert.match(meetings, /<MeetingTags platform=\{event.platform\}/u);
});

test('token-name styling removes underlines in every interaction state and preserves focus outline', async () => {
  const css = await read('apps/web/src/investor/investor.css');
  assert.match(css, /\.investor-app \.investor-token-link,[\s\S]*?\.investor-token-link:hover,[\s\S]*?\.investor-token-link:focus,[\s\S]*?\.investor-token-link:visited \{ text-decoration: none;/u);
  assert.match(css, /\.investor-app :focus-visible \{ outline: 2px solid/u);
  assert.doesNotMatch(css, /\.investor-token-address/u);
});
