import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageHeader } from '../apps/api/src/logo-validation.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const targets = ['apps/web/public/issuer-logos', 'apps/api/assets/issuer-logos'];
const manifest = JSON.parse(await readFile(new URL('../docs/brand-sources/artwork.json', import.meta.url), 'utf8'));

export function validateArtwork(bytes, item) {
  const header = imageHeader(bytes);
  if (header.mimeType !== 'image/png') throw new Error(`${item.id}: use a PNG of the sourced logo.`);
  if (item.sha256 && sha256(bytes) !== item.sha256) throw new Error(`${item.id}: supplied artwork checksum does not match.`);
  return header;
}

export async function downloadArtwork(item, fetcher = fetch) {
  if (!item.downloadUrl) throw new Error(`${item.id}: restore the supplied file from the replacement ZIP.`);
  const result = await fetcher(item.downloadUrl, { signal: AbortSignal.timeout(30_000),
    headers: { 'User-Agent': 'Galaxy-PV-artwork-import/1.0 (manual build-time image import)' } });
  if (!result.ok) throw new Error(`${item.id}: download failed (HTTP ${result.status}).`);
  if (!result.body) throw new Error(`${item.id}: empty download.`);
  const chunks = []; let total = 0;
  for await (const chunk of result.body) {
    total += chunk.length;
    if (total > 524288) { throw new Error(`${item.id}: download exceeds 512 KB.`); }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  validateArtwork(bytes, item);
  return bytes;
}

export async function syncArtwork({ fromDirectory = null, fetcher = fetch } = {}) {
  const pending = [];
  for (const item of manifest) {
    let bytes;
    // Supplied or previously imported assets are reused. Legacy placeholder
    // filenames are never candidates; the new filenames prevent stale caches.
    try { bytes = await readFile(path.join(root, targets[0], item.filename)); validateArtwork(bytes, item); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!bytes) {
      bytes = fromDirectory ? await readFile(path.join(fromDirectory, `${item.id}.png`)) : await downloadArtwork(item, fetcher);
      validateArtwork(bytes, item);
    }
    pending.push({ item, bytes });
  }
  // Decode every configured logo before any files are written.
  // This also verifies that the same bytes will work in the receipt writer.
  const { PDFDocument } = await import('pdf-lib');
  for (const { item, bytes } of pending) {
    const document = await PDFDocument.create(); await document.embedPng(bytes); await document.save();
    console.log(`Verified ${item.id}: ${bytes.length} bytes`);
  }
  for (const { item, bytes } of pending) {
    for (const target of targets) {
      const directory = path.join(root, target); await mkdir(directory, { recursive: true });
      const destination = path.join(directory, item.filename);
      await writeFile(`${destination}.tmp`, bytes); await rename(`${destination}.tmp`, destination);
    }
  }
  const report = pending.map(({ item, bytes }) => ({ id: item.id, filename: item.filename, source: item.source, sha256: sha256(bytes) }));
  await writeFile(path.join(root, 'docs/brand-sources/installed-artwork.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`All ${pending.length} issuer logos installed identically for browser and PDF. No runtime hotlinks.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--from-dir')) {
    console.error('Usage: node scripts/sync-issuer-artwork.mjs [--from-dir C:\\approved-logos]'); process.exitCode = 1;
  } else {
    syncArtwork({ fromDirectory: args[1] ? path.resolve(args[1]) : null }).catch((error) => {
      console.error(`Artwork import stopped: ${error.message}`);
      const names = manifest.filter((item) => item.downloadUrl).map((item) => `${item.id}.png`).join(', ');
      console.error(`Do not deploy missing artwork. Use your approved network or --from-dir with ${names}. No placeholder is substituted.`);
      process.exitCode = 1;
    });
  }
}
