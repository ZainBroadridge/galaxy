import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ISSUER_PRESETS } from '../packages/shared/src/issuer-branding.js';
import { validateFont } from './sync-investor-font.mjs';
import { imageHeader } from '../apps/api/src/logo-validation.js';

const root = new URL('../', import.meta.url);
const problems = [];
const source = JSON.parse(await readFile(new URL('docs/brand-sources/artwork.json', root), 'utf8'));
for (const item of ISSUER_PRESETS) {
  try {
    const web = await readFile(new URL(`apps/web/public/issuer-logos/${item.logoFile}`, root));
    const api = await readFile(new URL(`apps/api/assets/issuer-logos/${item.logoFile}`, root));
    imageHeader(web);
    if (!web.equals(api)) throw new Error('web/PDF files differ');
    const expected = source.find((entry) => entry.id === item.id)?.sha256;
    if (expected && createHash('sha256').update(web).digest('hex') !== expected) throw new Error('supplied artwork differs');
  } catch (error) { problems.push(`${item.name}: ${error.message}`); }
}
try {
  const css = await readFile(new URL('apps/web/public/investor/fonts/roboto.css', root), 'utf8');
  const names = [...css.matchAll(/url\(\.\/([a-f0-9]+\.woff2?)\)/gu)].map((match) => match[1]);
  if (!names.length || css.includes('https://')) throw new Error('fonts must be installed locally');
  await Promise.all(names.map(async (name) => validateFont(await readFile(new URL(`apps/web/public/investor/fonts/${name}`, root)))));
} catch (error) { problems.push(`Landing typography: ${error.message}`); }
const landing = await readFile(new URL('apps/web/src/investor/LandingPage.jsx', root), 'utf8');
if (/INVESTOR_DISCLAIMER|<details|investor-testnet-note|Why authenticate my wallet/u.test(landing)) problems.push('Landing still contains the extra consent content.');
if (problems.length) {
  console.error(problems.join('\n'));
  console.error('Complete sync-issuer-artwork.mjs and sync-investor-font.mjs before deployment.');
  process.exitCode = 1;
} else { console.log('Issuer artwork, browser/PDF identity and self-hosted landing typography are ready.'); }
