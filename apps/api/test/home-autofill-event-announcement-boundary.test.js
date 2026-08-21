import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('home uses the horizontal ProxyVote shell and a two-slide heading', async () => {
  const [app, home, styles] = await Promise.all([
    read('apps/web/src/App.jsx'),
    read('apps/web/src/pages/HomePage.jsx'),
    read('apps/web/src/styles.css'),
  ]);

  assert.match(app, /className="topbar pv-topbar"/u);
  assert.match(app, /className="pv-primary-nav"/u);
  assert.doesNotMatch(app, /pv-sidebar/u);
  assert.match(app, /homeRoute && <div className="pv-add-network-wrap">/u);
  assert.match(home, /const rotatingHeadlines = \[/u);
  assert.match(home, /Welcome to Broadridge/u);
  assert.match(home, /Secure shareholder decisions/u);
  assert.match(home, /https:\/\/www\.shareholdereducation\.com/u);
  assert.match(styles, /@keyframes pv-headline-slide/u);
  assert.match(styles, /right: 24px;\s*left: auto;\s*bottom: calc\(var\(--pv-footer-height\) \+ 12px\);/u);
});

test('create event restores deterministic demo autofill without touching token or PDFs', async () => {
  const organiser = await read('apps/web/src/pages/OrganiserDashboard.jsx');

  assert.match(organiser, /function demoForm\(current\)/u);
  assert.match(organiser, /tokenAddress: current\.tokenAddress/u);
  assert.match(organiser, /proposals: demoProposals\(\)/u);
  assert.match(organiser, /function fillDemoData\(\)/u);
  assert.match(organiser, />Auto fill dummy data<\/button>/u);
  assert.match(organiser, /Auto fill dummy data<\/button>[\s\S]*Back to events/u);
  const fillBody = organiser.match(/function fillDemoData\(\) \{([\s\S]*?)\n  \}/u)?.[1] ?? '';
  assert.ok(fillBody);
  assert.doesNotMatch(fillBody, /setDocuments/u);
});

test('voting-event announcements select a deployed event and preserve manual delivery', async () => {
  const [page, communications] = await Promise.all([
    read('apps/web/src/pages/WalletComms.jsx'),
    read('apps/api/src/communications.js'),
  ]);

  assert.match(page, /const eventIsReady =/u);
  assert.match(page, /events\.find\(eventIsReady\)/u);
  assert.match(page, /Select a deployed event/u);
  assert.match(page, /communications\/platform/u);
  assert.match(page, /The selected voting event is still deploying/u);

  assert.match(
    communications,
    /publishPlatformCommunication[\s\S]*await ensureNotificationState\(publisher\)[\s\S]*insertEventCommunication/u,
  );
  assert.match(
    communications,
    /c\.message_id IS DISTINCT FROM NULLIF\(e\.announcement_message->>'messageId',''\)::uuid/u,
  );
  assert.match(communications, /Manually issued event communications use their/u);
});
