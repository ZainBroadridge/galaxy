import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('voter event views require a snapshot entry while organiser access stays separate', async () => {
  const [events, server, votingPage, organiserPage] = await Promise.all([
    read('apps/api/src/events.js'),
    read('apps/api/src/server.js'),
    read('apps/web/src/pages/VotingDashboard.jsx'),
    read('apps/web/src/pages/OrganiserDashboard.jsx'),
  ]);

  assert.match(
    events,
    /export async function eventView[\s\S]*row\.wallet_snapshot_balance === null[\s\S]*'NOT_ELIGIBLE'/u,
  );
  assert.match(
    events,
    /export async function organiserEventView[\s\S]*row\.creator_address !== wallet[\s\S]*'FORBIDDEN'/u,
  );
  assert.match(server, /app\.get\('\/v1\/events\/:id\/view'[\s\S]*eventView/u);
  assert.match(server, /app\.get\('\/v1\/events\/:id\/organiser-view'[\s\S]*organiserEventView/u);
  assert.match(votingPage, /account[\s\S]*\/view\?wallet=\$\{encodeURIComponent\(account\)\}/u);
  assert.match(votingPage, /view\.error\?\.code === 'NOT_ELIGIBLE'/u);
  assert.match(organiserPage, /\/organiser-view/u);
});

test('dashboard discovery and ballot submission remain snapshot-gated', async () => {
  const [events, votes] = await Promise.all([
    read('apps/api/src/events.js'),
    read('apps/api/src/votes.js'),
  ]);

  assert.match(
    events,
    /FROM snapshot_entries se[\s\S]*WHERE se\.wallet_address=\$1/u,
  );
  assert.match(
    votes,
    /SELECT \* FROM snapshot_entries WHERE event_id=\$1 AND wallet_address=\$2/u,
  );
  assert.match(votes, /if \(!entry\.rowCount\)[\s\S]*'NOT_ELIGIBLE'/u);
  assert.doesNotMatch(votes, /creator_address/u);
});

test('event inbox and browser push do not contain creator or non-holder bypasses', async () => {
  const [communications, policy] = await Promise.all([
    read('apps/api/src/communications.js'),
    read('apps/api/src/communication-recipient-policy.js'),
  ]);

  assert.match(policy, /if \(!isEligible\) return false;/u);
  assert.doesNotMatch(policy, /if \(isCreator\) return true/u);
  assert.doesNotMatch(communications, /recipient_is_creator/u);
  assert.match(
    communications,
    /export async function eventBrowserPushRecipients[\s\S]*JOIN snapshot_entries se/u,
  );
  assert.match(
    communications,
    /export async function inbox[\s\S]*JOIN snapshot_entries se/u,
  );
});
