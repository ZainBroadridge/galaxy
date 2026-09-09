import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const webRoot = path.join(root, 'apps/web/src');

async function sourceFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(absolute));
    else if (/\.(?:js|jsx|ts|tsx)$/u.test(entry.name)) output.push(absolute);
  }
  return output;
}

test('wallet signing has exactly two explicit purposes: disclaimer login and final ballot', async () => {
  const files = await sourceFiles(webRoot);
  const sources = new Map(await Promise.all(files.map(async (file) => [
    path.relative(root, file).split(path.sep).join('/'), await readFile(file, 'utf8'),
  ])));
  const wallet = sources.get('apps/web/src/wallet.jsx');
  assert.equal((wallet.match(/\.signTypedData\s*\(/gu) ?? []).length, 1);
  assert.equal((wallet.match(/\.signMessage\s*\(/gu) ?? []).length, 1);
  assert.match(sources.get('apps/web/src/investor/InvestorSession.jsx'), /wallet\.signDisclaimer\(challenge\.message, account\)/u);
  assert.match(sources.get('apps/web/src/investor/BallotPage.jsx'), /wallet\.signBallot\(typed\)/u);
  for (const [file, source] of sources) {
    if (file !== 'apps/web/src/wallet.jsx') assert.doesNotMatch(source, /\.signMessage\(|\.signTypedData\(|getSigner\(/u, file);
    if (!['apps/web/src/wallet.jsx', 'apps/web/src/investor/BallotPage.jsx'].includes(file)) assert.doesNotMatch(source, /signBallot\(/u, file);
    if (!['apps/web/src/wallet.jsx', 'apps/web/src/investor/InvestorSession.jsx'].includes(file)) assert.doesNotMatch(source, /signDisclaimer\(/u, file);
  }
});
test('receipt downloads require investor authentication and result reports require a portal session', async () => {
  const server = await readFile(path.join(root, 'apps/api/src/server.js'), 'utf8');
  assert.match(server, /app\.get\('\/v1\/events\/:id\/reports\/receipt', requireAuth/u);
  assert.match(server, /createVoteReceipt\(request\.params\.id, authenticatedWallet\(request, wallet\)\)/u);
  assert.match(server, /app\.get\('\/v1\/events\/:id\/reports\/results', requirePortal/u);
  assert.match(server, /createResultsReport\(request\.params\.id, portalWallet\(request, wallet\)\)/u);
});
