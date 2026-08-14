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

test('the connected wallet signs only the final ballot', async () => {
  const files = await sourceFiles(webRoot);
  const sources = new Map(await Promise.all(files.map(async (file) => [
    path.relative(root, file).split(path.sep).join('/'),
    await readFile(file, 'utf8'),
  ])));

  const walletSource = sources.get('apps/web/src/wallet.jsx');
  const voteSource = sources.get('apps/web/src/pages/VotingDashboard.jsx');

  assert.equal((walletSource.match(/\.signTypedData\s*\(/gu) ?? []).length, 1);
  assert.equal((voteSource.match(/signBallot\(typed\)/gu) ?? []).length, 1);

  for (const [file, source] of sources) {
    assert.equal(source.includes('.signMessage('), false, `${file} must not request a message signature`);
    assert.equal(source.includes('ensureAuthenticated'), false, `${file} must not authenticate by signature`);
    if (file !== 'apps/web/src/wallet.jsx') {
      assert.equal(source.includes('.signTypedData('), false, `${file} must not expose another typed-data signature`);
      assert.equal(/getSigner\s*\(/u.test(source), false, `${file} must not obtain a generic signer`);
    }
    if (file !== 'apps/web/src/pages/VotingDashboard.jsx' && file !== 'apps/web/src/wallet.jsx') {
      assert.equal(source.includes('signBallot('), false, `${file} must not invoke ballot signing`);
    }
  }
});

test('receipt and result-report downloads do not require wallet authentication', async () => {
  const server = await readFile(path.join(root, 'apps/api/src/server.js'), 'utf8');
  for (const route of [
    '/v1/events/:id/reports/results',
    '/v1/events/:id/reports/receipt',
  ]) {
    const start = server.indexOf(`app.get('${route}'`);
    assert.notEqual(start, -1, `${route} is missing`);
    const end = server.indexOf('\n});', start);
    const block = server.slice(start, end + 4);
    assert.equal(block.includes('requireAuth'), false, `${route} must be public and wallet-scoped`);
    assert.equal(block.includes('request.query.wallet'), true, `${route} must read the connected wallet query`);
  }
});
