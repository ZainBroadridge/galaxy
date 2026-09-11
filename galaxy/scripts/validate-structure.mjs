import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const ignored = new Set(['node_modules', '.git', 'dist', 'artifacts', 'cache', 'coverage']);

async function walk(directory, predicate) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(absolute, predicate));
    else if (predicate(absolute)) output.push(absolute);
  }
  return output;
}

async function exists(relative) {
  try { await access(path.join(root, relative)); return true; } catch { return false; }
}

const solidity = await walk(root, (file) => file.endsWith('.sol'));
const expected = path.join(root, 'packages/contracts/contracts/VoteEvent.sol');
if (solidity.length !== 1 || solidity[0] !== expected) {
  throw new Error(`Expected exactly one Solidity source: ${expected}. Found: ${solidity.join(', ')}`);
}
if (await exists('apps/indexer')) throw new Error('apps/indexer must not exist; jobs run inside the single API web service.');

const contract = await readFile(expected, 'utf8');
const deploymentArtifact = JSON.parse(await readFile(path.join(root, 'packages/contracts/generated/VoteEvent.json'), 'utf8'));
const verificationArtifact = JSON.parse(await readFile(path.join(root, 'packages/contracts/generated/VoteEvent.verification.json'), 'utf8'));
if (!deploymentArtifact.bytecode?.startsWith('0x') || !Array.isArray(deploymentArtifact.abi)) {
  throw new Error('Generated VoteEvent deployment artifact is invalid.');
}
if (verificationArtifact.input?.sources?.['contracts/VoteEvent.sol']?.content !== contract) {
  throw new Error('Generated VoteEvent verification input does not match VoteEvent.sol. Run npm run compile.');
}
for (const forbidden of ['DeploymentRegistry', 'AccessList', 'CompanyToken', 'updateVote', 'recallVote', 'pauseVoting', 'setRelayer']) {
  if (contract.includes(forbidden)) throw new Error(`Excluded V1/extra contract feature found: ${forbidden}`);
}

const snapPackage = JSON.parse(await readFile(path.join(root, 'apps/snap/package.json'), 'utf8'));
const snapManifest = JSON.parse(await readFile(path.join(root, 'apps/snap/snap.manifest.json'), 'utf8'));
if (snapPackage.version !== snapManifest.version) throw new Error('Snap package and manifest versions differ.');
if (snapPackage.name !== snapManifest.source.location.npm.packageName) throw new Error('Snap package and manifest npm names differ.');

const render = await readFile(path.join(root, 'render.yaml'), 'utf8');
if ((render.match(/\n\s*- type: web\b/gu) ?? []).length !== 1) throw new Error('render.yaml must define exactly one web service.');
if (/\n\s*- type: worker\b/u.test(render)) throw new Error('render.yaml must not define a paid background worker.');
if (!render.includes('RELAYER_PRIVATE_KEY')) throw new Error('The single API/job service requires RELAYER_PRIVATE_KEY.');
if (!render.includes('WEB_PUSH_PUBLIC_KEY') || !render.includes('WEB_PUSH_PRIVATE_KEY')) {
  throw new Error('render.yaml must expose the optional Web Push key settings.');
}

for (const required of [
  'apps/api/src/web-push.js',
  'apps/web/src/browser-push.js',
  'apps/web/public/pv-push-sw.js',
  'db/migrations/004_web_push_subscriptions.sql',
]) {
  if (!await exists(required)) throw new Error(`Missing Web Push component: ${required}`);
}
const server = await readFile(path.join(root, 'apps/api/src/server.js'), 'utf8');
if (/communications\/stream|communication-stream|announceCommunication/u.test(server)) {
  throw new Error('Obsolete communication SSE code must be removed.');
}

const snapshot = await readFile(path.join(root, 'apps/api/src/snapshot.js'), 'utf8');
if (!snapshot.includes('alchemy_getAssetTransfers')) throw new Error('Snapshot implementation must use Alchemy indexed transfers.');
if (snapshot.includes('eth_getLogs')) throw new Error('Snapshot implementation must not scan eth_getLogs block ranges.');

const web = JSON.parse(await readFile(path.join(root, 'apps/web/package.json'), 'utf8'));
for (const dependency of ['@reown/appkit', '@reown/appkit-adapter-ethers']) {
  if (!web.dependencies?.[dependency]) throw new Error(`Missing Reown dependency: ${dependency}`);
}

console.log('Structure validated: one VoteEvent contract, one Render web service, indexed snapshots, Reown AppKit, and aligned Snap metadata.');
