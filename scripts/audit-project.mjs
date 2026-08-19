import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['node_modules', '.git', 'dist', 'artifacts', 'cache', 'coverage']);
const failures = [];
const warnings = [];

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(absolute));
    else output.push(absolute);
  }
  return output;
}

const files = await walk(root);
const relative = (file) => path.relative(root, file);
const read = (name) => readFile(path.join(root, name), 'utf8');

const solidity = files.filter((file) => file.endsWith('.sol'));
if (solidity.length !== 1 || relative(solidity[0] ?? '') !== 'packages/contracts/contracts/VoteEvent.sol') {
  failures.push(`Expected one VoteEvent.sol source; found ${solidity.length}.`);
}

for (const file of files.filter((value) => value.endsWith('.json'))) {
  try { JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { failures.push(`Invalid JSON: ${relative(file)} (${error.message})`); }
}

for (const file of files.filter((value) => /apps[\\/]api[\\/]src[\\/]/u.test(value))) {
  const source = await readFile(file, 'utf8');
  if (/hardhat\s+(compile|run)/u.test(source) || source.includes('node:child_process')) {
    failures.push(`Runtime compiler/process execution in ${relative(file)}.`);
  }
  if (source.includes('eth_getLogs')) failures.push(`eth_getLogs range scan in ${relative(file)}.`);
  for (const legacy of ['DeploymentRegistry', 'AccessList', 'CompanyToken', 'ProxyVoting']) {
    if (source.includes(legacy)) failures.push(`Legacy ${legacy} reference in ${relative(file)}.`);
  }
}

const contract = await read('packages/contracts/contracts/VoteEvent.sol');
for (const required of ['contract VoteEvent', 'MerkleProof.verifyCalldata', 'mapping(address voter => bool voted) public hasVoted', 'event VoteCast']) {
  if (!contract.includes(required)) failures.push(`VoteEvent is missing: ${required}`);
}
for (const excluded of ['updateVote', 'recallVote', 'setRelayer', 'pauseVoting']) {
  if (contract.includes(excluded)) failures.push(`VoteEvent contains excluded feature: ${excluded}`);
}

const migration = await read('db/migrations/001_schema.sql');
for (const table of ['events', 'snapshot_entries', 'jobs', 'votes', 'relayer_transactions', 'snap_subscriptions', 'communications']) {
  if (!migration.includes(`CREATE TABLE ${table}`)) failures.push(`Neon schema is missing ${table}.`);
}
for (const removed of ['token_holder_candidates', 'token_index_cursors', 'chain_logs', 'proposal_tallies', 'worker_heartbeats']) {
  if (migration.includes(removed)) failures.push(`Removed complexity is still present: ${removed}.`);
}

const snap = await read('apps/snap/src/index.tsx');
if (snap.includes("input.signingMessage")) failures.push('Snap still requires the obsolete signingMessage field.');
if (!snap.includes('notificationErrors')) failures.push('Snap notifications must be best-effort and non-fatal.');

const server = await read('apps/api/src/server.js');
if (/app\.use\([^\n]*rateLimit/u.test(server)) failures.push('A global API rate limiter is still installed.');
if (/communications\/stream|communication-stream|announceCommunication/u.test(server)) {
  failures.push('Obsolete communication SSE code is still present.');
}
const pushMigration = await read('db/migrations/004_web_push_subscriptions.sql');
if (!pushMigration.includes('CREATE TABLE IF NOT EXISTS web_push_subscriptions')) {
  failures.push('Web Push subscription migration is missing.');
}
if (/\b(?:message|title|body|action_url)\b/u.test(pushMigration)) {
  failures.push('Web Push subscriptions must not persist communication content.');
}
const render = await read('render.yaml');
if ((render.match(/\n\s*- type: web\b/gu) ?? []).length !== 1 || /type: worker/u.test(render)) {
  failures.push('Render must contain exactly one web service and no worker service.');
}

for (const required of [
  'packages/contracts/generated/VoteEvent.json',
  'packages/contracts/generated/VoteEvent.verification.json',
  'packages/contracts/scripts/export-artifact.cjs',
  'apps/api/src/snapshot.js',
  'apps/api/src/runner.js',
  'apps/api/src/web-push.js',
  'apps/snap/src/index.tsx',
  'apps/web/src/appkit.js',
  'apps/web/src/browser-push.js',
  'apps/web/public/pv-push-sw.js',
  'db/migrations/004_web_push_subscriptions.sql',
  'render.yaml',
  'vercel.json',
]) {
  if (!files.some((file) => relative(file) === required)) failures.push(`Missing required file: ${required}`);
}

const snapPackage = JSON.parse(await read('apps/snap/package.json'));
if (snapPackage.name.includes('replace-me')) warnings.push('Configure the production Snap package and dApp origin before publishing.');

if (failures.length) {
  console.error('Architecture audit failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Architecture audit passed across ${files.length} source/configuration files.`);
warnings.forEach((warning) => console.warn(`Warning: ${warning}`));
