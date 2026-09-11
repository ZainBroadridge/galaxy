import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { eventIssuerBranding, issuerBranding, issuerPreset } from '../../../packages/shared/src/issuer-branding.js';
import { investorSignInMessage } from '../../../packages/shared/src/investor-disclaimer.js';
import { helpPlacement } from '../../web/src/investor/help-position.js';
import { fontUrls, validateFont } from '../../../scripts/sync-investor-font.mjs';
import { validateArtwork, downloadArtwork } from '../../../scripts/sync-issuer-artwork.mjs';

const root = new URL('../../../', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');

test('legal issuer names normalize exact aliases without guessing token affiliation', () => {
  assert.equal(issuerBranding({ issuerName: 'Apple' }).issuerName, 'Apple Inc.');
  assert.equal(issuerPreset('  Tesla, Inc. ').name, 'Tesla, Inc.');
  assert.equal(issuerPreset('NVIDIA').name, 'NVIDIA Corporation');
  assert.equal(issuerPreset('Oracle').name, 'Oracle Corporation');
  assert.equal(issuerPreset('AAPL.d'), null);
  assert.equal(issuerPreset('Suspicious Apple Fund'), null);
});
test('listed security is explicit and Alphabet classes are not conflated', () => {
  assert.equal(issuerBranding({ issuerName: 'Alphabet' }).securityName, '');
  assert.equal(issuerBranding({ issuerName: 'Alphabet', securityTicker: 'GOOG' }).securityName, 'Alphabet Inc. - Class C Capital Stock');
  assert.equal(issuerBranding({ issuerName: 'Alphabet', securityTicker: 'GOOGL' }).securityName, 'Alphabet Inc. - Class A Common Stock');
  assert.throws(() => issuerBranding({ issuerName: 'Alphabet', securityTicker: 'AAPL' }), /belonging/);
  assert.throws(() => issuerBranding({ issuerName: 'Apple', securityTicker: 'AAPL', securityName: 'Different security' }), /does not match/);
  assert.throws(() => issuerBranding({ issuerName: 'Apple', securityName: 'Invented stock class' }), /official listed security/);
});
test('legacy event presentation upgrades name/logo without rewriting immutable inputs', () => {
  const event = { issuer_name: 'Apple', issuer_logo_preset: 'apple', issuer_theme_color: '#263238',
    token_platform: 'Ondo', metadata_hash: '0xabc', token_name: 'Apple.d', snapshot_root: '0xdef' };
  const before = structuredClone(event); const brand = eventIssuerBranding(event);
  assert.equal(brand.issuerName, 'Apple Inc.'); assert.equal(brand.issuerThemeColor, '#111111');
  assert.equal(brand.issuerLogoUrl, '/issuer-logos/apple-brand-v2.png');
  assert.equal(brand.securityName, '', 'no share class is invented for a historical event');
  assert.deepEqual(event, before);
});
test('custom uploads take precedence and an inconsistent preset cannot impersonate another issuer', () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  assert.equal(eventIssuerBranding({ issuer_name: 'Apple', issuer_logo_id: id }).issuerLogoUrl, `/v1/issuer-logos/${id}`);
  assert.equal(eventIssuerBranding({ issuerName: 'Other Ltd.', issuerLogoPreset: 'apple' }).issuerLogoUrl, null);
  assert.equal(eventIssuerBranding({ issuerName: 'Other Ltd.', issuerLogoUrl: 'https://bad.example/x.svg' }).issuerLogoUrl, null);
  assert.equal(eventIssuerBranding(null).issuerName, '');
});
test('supplied Apple/NVIDIA vectors and PNGs are traceable and browser/PDF bytes agree', async () => {
  const manifest = JSON.parse(await read('docs/brand-sources/artwork.json'));
  for (const id of ['apple', 'nvidia']) {
    const item = manifest.find((entry) => entry.id === id);
    const web = await readFile(new URL(`apps/web/public/issuer-logos/${item.filename}`, root));
    const pdf = await readFile(new URL(`apps/api/assets/issuer-logos/${item.filename}`, root));
    assert.deepEqual(web, pdf); assert.equal(validateArtwork(web, item).mimeType, 'image/png');
    assert.equal(createHash('sha256').update(web).digest('hex'), item.sha256);
    const vector = await read(`docs/brand-sources/${id}.svg`); assert.match(vector, /<path/u);
  }
});
test('artwork importer rejects errors, HTML block pages, oversize responses and changed supplied artwork', async () => {
  const item = { id: 'tesla', downloadUrl: 'https://example.invalid/image.png' };
  await assert.rejects(downloadArtwork(item, async () => new Response('blocked', { status: 403 })), /HTTP 403/);
  await assert.rejects(downloadArtwork(item, async () => new Response('<html>Proxy login</html>')), /PNG|JPEG/);
  await assert.rejects(downloadArtwork(item, async () => new Response(new Uint8Array(524289))), /512 KB/);
  const bytes = await readFile(new URL('apps/web/public/issuer-logos/apple-brand-v2.png', root));
  assert.throws(() => validateArtwork(bytes, { id: 'apple', sha256: 'wrong' }), /checksum/);
});
test('explainer placement stays in narrow viewports and uses available space above/below', () => {
  for (const width of [320, 390, 768, 1440]) {
    const position = helpPlacement({ left: width - 40, width: 20, top: 600, bottom: 620 }, { height: 300 }, { width, height: 844 });
    assert.ok(position.left >= 16); assert.ok(position.left + position.width <= width - 16);
    assert.ok(position.top >= 16); assert.equal(position.side, 'top');
  }
  assert.equal(helpPlacement({ left: 50, width: 20, top: 20, bottom: 40 }, { height: 200 }, { width: 390, height: 844 }).side, 'bottom');
});
test('consent remains in signed message, not in the landing DOM', async () => {
  const [landing, session, wallet] = await Promise.all([
    read('apps/web/src/investor/LandingPage.jsx'), read('apps/web/src/investor/InvestorSession.jsx'), read('apps/web/src/wallet.jsx'),
  ]);
  assert.doesNotMatch(landing, /INVESTOR_DISCLAIMER|<details|Why authenticate my wallet|investor-testnet-note/u);
  assert.match(landing, /Wallet Authentication/u);
  assert.match(landing, /investor\.begin\(\)/u);
  assert.match(session, /signDisclaimer\(challenge\.message/u);
  assert.match(wallet, /signMessage\(message\)/u);
  const message = investorSignInMessage({ origin: 'https://galaxy-api-ten.vercel.app', walletAddress: `0x${'1'.repeat(40)}`, chainId: 80002,
    nonce: 'a'.repeat(48), issuedAt: '2026-09-08T10:00:00Z', expiresAt: '2026-09-08T10:10:00Z' });
  assert.match(message, /agree|acknowledge/iu); assert.match(message, /not cast a vote|does not cast a vote/iu);
});
test('event header places platform or issuer once; PDF letterhead remains issuer-themed', async () => {
  const frame = await read('apps/web/src/investor/InvestorFrame.jsx');
  const report = await read('apps/api/src/reports.js');
  assert.match(frame, /presentation\.header === 'platform'/u);
  assert.match(frame, /presentation\.showIssuerByTitle/u);
  assert.match(frame, /IssuerLogo event=\{event\} className="investor-brand-issuer-logo"/u);
  assert.doesNotMatch(report, /const NAVY|LINK_BLUE|Broadridge Proxy Voting - Confidential|broadridge-logo-blue/u);
  const addPage = report.slice(report.indexOf('  addPage() {'), report.indexOf('  ensure(height) {'));
  assert.doesNotMatch(addPage, /this\.logo|Powered by/u);
  assert.match(addPage, /this\.issuerImage/u);
  const footer = report.slice(report.indexOf('  finishFooters() {'));
  assert.match(footer, /Powered by/u);
});

test('font importer accepts only expected Google-hosted resources', () => {
  assert.equal(validateFont(Buffer.from('wOF2example-font')), 'woff2');
  assert.throws(() => validateFont(Buffer.from('<html>blocked</html>')), /WOFF/);
  assert.deepEqual(fontUrls('@font-face { src: url(https://fonts.gstatic.com/s/roboto/example.woff2); }'), ['https://fonts.gstatic.com/s/roboto/example.woff2']);
  assert.throws(() => fontUrls('html proxy login page'), /Unexpected/);
  assert.throws(() => fontUrls('@font-face {src:url(https://other.invalid/a.woff2)}'), /Unexpected/);
});
