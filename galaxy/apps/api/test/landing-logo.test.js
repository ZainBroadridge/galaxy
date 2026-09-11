import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('landing logo preserves the supplied artwork without an opaque background', async () => {
  const svg = await read('apps/web/public/proxyvote-landing-mark.svg');
  assert.match(svg, /viewBox="0 0 158 58"/u);
  assert.match(svg, /<title id="title">ProxyVote<\/title>/u);
  assert.doesNotMatch(svg, /<rect\b|<script\b|<foreignObject\b|<text\b/u);
  assert.match(svg, /<feComposite in2="SourceGraphic" operator="in"/u);
  assert.match(svg, /filter="url\(#inverse-artwork\)"/u);
  const image = svg.match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/u);
  assert.ok(image, 'The supplied embedded artwork must remain self-contained.');
  const png = Buffer.from(image[1], 'base64');
  assert.equal(createHash('sha256').update(png).digest('hex'), 'fcc6f4295c54d5a9d463292532812d6680fea1b1ac498bb27f8f44da3de25b91');
  assert.equal(png.readUInt32BE(16), 158);
  assert.equal(png.readUInt32BE(20), 58);
  assert.equal(png[25], 6, 'The source PNG must retain its alpha channel.');
});

test('investor headers select the supplied mark in normal and inverse variants', async () => {
  const [brand, frame, landing] = await Promise.all([
    read('apps/web/src/components/BrandLockup.jsx'),
    read('apps/web/src/investor/InvestorFrame.jsx'),
    read('apps/web/src/investor/LandingPage.jsx'),
  ]);
  assert.match(brand, /function ProxyVoteMark\(\{ inverse = false, variant = 'default' \}\)/u);
  assert.match(brand, /inverse \? '\/proxyvote-landing-mark\.svg'\s*: variant === 'investor' \? '\/proxyvote-voter-mark\.svg' : '\/proxyvote-mark\.svg'/u);
  assert.match(brand, /children \?\? <ProxyVoteMark inverse=\{inverse\} \/>/u);
  assert.match(frame, /<ProxyVoteMark inverse=\{inverse\} variant="investor" \/>/u);
  assert.match(landing, /<BrandBand inverse \/>/u);
  assert.match(frame, /<BrandBand event=\{event\} \/>/u);
});

test('logo dimensions and the existing white-on-blue treatment remain intact', async () => {
  const [brand, css] = await Promise.all([
    read('apps/web/src/components/BrandLockup.jsx'),
    read('apps/web/src/components/brand.css'),
  ]);
  assert.match(brand, /className="proxyvote-artwork" src=\{src\} alt="ProxyVote" width="158" height="58"/u);
  assert.match(css, /\.brand-lockup\.inverse \.proxyvote-artwork \{ filter: brightness\(0\) invert\(1\); \}/u);
  assert.match(css, /object-fit: contain/u);
});


test('normal-color voter logo preserves the same supplied image without recoloring or an opaque wrapper', async () => {
  const svg = await read('apps/web/public/proxyvote-voter-mark.svg');
  const landing = await read('apps/web/public/proxyvote-landing-mark.svg');
  const imagePattern = /href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/u;
  const image = svg.match(imagePattern);
  const landingImage = landing.match(imagePattern);
  assert.ok(image && landingImage, 'Both assets must embed the supplied image.');
  assert.equal(image[1], landingImage[1], 'Normal and inverse variants must share the same lettering.');
  assert.equal(createHash('sha256').update(Buffer.from(image[1], 'base64')).digest('hex'),
    'fcc6f4295c54d5a9d463292532812d6680fea1b1ac498bb27f8f44da3de25b91');
  assert.match(svg, /viewBox="0 0 158 58"/u);
  assert.doesNotMatch(svg, /<rect\b|<filter\b|<script\b|<foreignObject\b|<text\b|<path\b/u);
  assert.doesNotMatch(svg, /(?:href|xlink:href)="https?:/u);
});

test('generic voter pages share the corrected header while event and issuer branding remain separate', async () => {
  for (const page of ['MeetingsPage', 'EducationPage', 'NotificationsPage']) {
    const source = await read(`apps/web/src/investor/${page}.jsx`);
    assert.match(source, /<InvestorFrame>/u, page);
    assert.doesNotMatch(source, /src="[^"]*proxyvote/u, page);
  }
  for (const page of ['BallotPage', 'ConfirmationPage']) {
    const source = await read(`apps/web/src/investor/${page}.jsx`);
    assert.match(source, /<InvestorFrame event=\{event\}/u, page);
  }
  const frame = await read('apps/web/src/investor/InvestorFrame.jsx');
  assert.match(frame, /presentation\.header === 'platform' \? <PlatformLogo/u);
  assert.match(frame, /presentation\.header === 'issuer' \? <IssuerLogo/u);
  for (const page of ['IssuerLayout', 'IssuerSession']) {
    const source = await read(`apps/web/src/issuer/${page}.jsx`);
    assert.doesNotMatch(source, /variant="investor"|proxyvote-voter-mark/u, page);
  }
});
