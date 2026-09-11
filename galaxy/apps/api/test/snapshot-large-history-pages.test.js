import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('snapshot supports up to one million indexed transfers without changing normal page size', async () => {
  const [config, render, snapshot] = await Promise.all([
    read('apps/api/src/config.js'),
    read('render.yaml'),
    read('apps/api/src/snapshot.js'),
  ]);

  assert.match(
    config,
    /alchemyPageSize: integer\('ALCHEMY_PAGE_SIZE', 1000, \{ min: 1, max: 1000 \}\)/u,
  );
  assert.match(
    config,
    /alchemyMaxPages: integer\('ALCHEMY_MAX_PAGES', 1000, \{ min: 1, max: 1000 \}\)/u,
  );
  assert.match(render, /- key: ALCHEMY_MAX_PAGES\s+value: "1000"/u);
  assert.match(snapshot, /maxCount: toQuantity\(config\.alchemyPageSize\)/u);
  assert.match(snapshot, /\} while \(pageKey\);/u);
});

test('transfer progress is independent of the safety-page ceiling', async () => {
  const snapshot = await read('apps/api/src/snapshot.js');

  assert.match(
    snapshot,
    /Math\.min\(54, 10 \+ Math\.floor\(44 \* \(page \/ \(page \+ 10\)\)\)\)/u,
  );
  assert.doesNotMatch(snapshot, /page \/ config\.alchemyMaxPages/u);
  assert.match(snapshot, /pageKey\s*\?[^:]+\s*:\s*55/u);
});
