import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ISSUER_PRESETS, eventIssuerBranding } from '../../../packages/shared/src/issuer-branding.js';
import { tokenCatalogue } from '../src/token-catalogue.js';
import { pruneIssuerArtwork } from '../../../scripts/prune-issuer-artwork.mjs';

const read = (file) => readFile(new URL(`../../../${file}`, import.meta.url), 'utf8');
const ids = ['apple', 'tesla', 'nvidia', 'alphabet', 'spacex', 'oracle'];
const retired = 'retired-example';
const artifact = `apps/web/public/issuer-logos/${retired}-brand-v2.png`;
const record = 'docs/brand-sources/installed-artwork.json';
async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'issuer-prune-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ['apps/web/public/issuer-logos', 'apps/api/assets/issuer-logos', 'docs/brand-sources']) await mkdir(path.join(root, dir), { recursive: true });
  return root;
}

test('all six current issuers align with source manifests and retain eighteen token mappings', async () => {
  assert.deepEqual(ISSUER_PRESETS.map((item) => item.id), ids);
  const artwork = JSON.parse(await read('docs/brand-sources/artwork.json'));
  assert.deepEqual(artwork.map((item) => item.id).sort(), [...ids].sort());
  assert.equal(JSON.parse(await read('docs/brand-sources/securities.json')).length, ids.length);
  const entries = tokenCatalogue().entries;
  assert.equal(entries.length, 18);
  for (const id of ids) assert.equal(entries.filter((entry) => entry.issuerId === id).length, 3);
});

test('unknown historical issuer remains readable and a custom upload remains usable without a preset', () => {
  const event = { issuer_name: 'Archived Company Ltd.', issuer_logo_preset: retired,
    issuer_logo_id: '11111111-1111-1111-1111-111111111111', issuer_theme_color: '#334455',
    security_name: 'Archived Company Ltd. - Common Stock', security_ticker: 'ARCH', snapshot_root: 'unchanged', metadata_hash: 'unchanged' };
  const before = structuredClone(event);
  const brand = eventIssuerBranding(event);
  assert.equal(brand.issuerName, event.issuer_name); assert.equal(brand.issuerLogoPreset, null);
  assert.equal(brand.issuerLogoUrl, `/v1/issuer-logos/${event.issuer_logo_id}`);
  assert.equal(brand.issuerThemeColor, '#334455'); assert.deepEqual(event, before);
});

test('pruning previews by default, removes only retired bundled assets, and is idempotent', async (t) => {
  const root = await workspace(t);
  const retained = 'apps/web/public/issuer-logos/apple-brand-v2.png';
  await writeFile(path.join(root, artifact), 'old-artwork'); await writeFile(path.join(root, retained), 'retained-artwork');
  const keep = { id: 'apple', sha256: 'unchanged', source: 'supplied' };
  await writeFile(path.join(root, record), JSON.stringify([keep, { id: retired, sha256: 'old' }]));
  const preview = await pruneIssuerArtwork(root, retired);
  assert.deepEqual(preview.files, [artifact]); assert.equal(preview.applied, false);
  await access(path.join(root, artifact));
  const result = await pruneIssuerArtwork(root, retired, { apply: true });
  assert.equal(result.recordUpdated, true);
  await assert.rejects(access(path.join(root, artifact)), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(root, retained), 'utf8'), 'retained-artwork');
  assert.deepEqual(JSON.parse(await readFile(path.join(root, record), 'utf8')), [keep]);
  assert.deepEqual(await pruneIssuerArtwork(root, retired, { apply: true }), { files: [], recordUpdated: false, applied: true });
});

test('pruning refuses active presets and path-like IDs', async (t) => {
  const root = await workspace(t);
  await assert.rejects(pruneIssuerArtwork(root, 'apple', { apply: true }), /active issuer/u);
  for (const id of ['../outside', '', 'bad/id', 'bad\\id']) await assert.rejects(pruneIssuerArtwork(root, id), /issuer ID/u);
});

test('invalid installation records do not cause partial artwork deletion', async (t) => {
  const root = await workspace(t);
  await writeFile(path.join(root, artifact), 'old-artwork'); await writeFile(path.join(root, record), '{broken');
  await assert.rejects(pruneIssuerArtwork(root, retired, { apply: true }));
  assert.equal(await readFile(path.join(root, artifact), 'utf8'), 'old-artwork');
});
