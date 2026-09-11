import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../apps/web/public/investor/fonts/', import.meta.url));
const cssUrl = 'https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,400;0,500;0,700;0,900;1,900&display=swap';
const agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
async function get(url, limit) {
  const response = await fetch(url, { headers: { 'User-Agent': agent }, signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.body) throw new Error(`Font request failed: HTTP ${response.status}`);
  const parts = []; let size = 0;
  for await (const part of response.body) { size += part.length; if (size > limit) throw new Error('Font resource exceeded its bound.'); parts.push(part); }
  return Buffer.concat(parts);
}

export function validateFont(bytes) {
  const signature = bytes.subarray(0, 4).toString('ascii');
  if (bytes.length > 2_000_000 || !['wOF2', 'wOFF'].includes(signature)) {
    throw new Error('Expected a bounded WOFF2/WOFF font.');
  }
  return signature === 'wOF2' ? 'woff2' : 'woff';
}

export function fontUrls(css) {
  const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/gu)].map((match) => match[1]))];
  if (!urls.length || urls.length > 64 || /url\((?!https:\/\/fonts\.gstatic\.com\/)/u.test(css)) throw new Error('Unexpected Google Fonts stylesheet.');
  return urls;
}
async function main() {
  // Safe to rerun: all referenced local files must exist, not only the stylesheet.
  try {
    const css = await readFile(path.join(directory, 'roboto.css'), 'utf8');
    const names = [...css.matchAll(/url\(\.\/([a-f0-9]+\.woff2?)\)/gu)].map((match) => match[1]);
    if (names.length && !css.includes('https://')) { await Promise.all(names.map(async (name) => validateFont(await readFile(path.join(directory, name))))); console.log('Self-hosted Roboto is already installed.'); return; }
  } catch { /* Download a complete set below; no installed CSS is overwritten until ready. */ }
  let css = (await get(cssUrl, 200000)).toString('utf8');
  const downloads = [];
  for (const url of fontUrls(css)) {
    const bytes = await get(url, 2000000);
    const extension = validateFont(bytes);
    const filename = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
    downloads.push({ filename, bytes }); css = css.split(url).join(`./${filename}`);
  }
  await mkdir(directory, { recursive: true });
  for (const { filename, bytes } of downloads) await writeFile(path.join(directory, filename), bytes);
  await writeFile(path.join(directory, 'roboto.css'), css);
  console.log('Roboto installed from Google Fonts for the BA landing-page typography. Commit the generated font assets under your font licensing policy.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Font import stopped: ${error.message}`); console.error('Use the approved build network; the release checker will reject missing fonts.'); process.exitCode = 1; });
}
