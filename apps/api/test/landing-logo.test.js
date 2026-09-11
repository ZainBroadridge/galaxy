import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

for (const [variant, hash] of [
  ['blue', 'fcc6f4295c54d5a9d463292532812d6680fea1b1ac498bb27f8f44da3de25b91'],
  ['white', 'a4c000cf6321f86adbf24f3c934b50f3136aa29a70267b715adafe494786ab55'],
]) {
  test(`the supplied ${variant} PNG preserves its exact artwork, dimensions and transparency`, async () => {
    const png = await readFile(new URL(`apps/web/public/proxyvote-brand-${variant}.png`, root));
    assert.equal(createHash('sha256').update(png).digest('hex'), hash);
    assert.equal(png.readUInt32BE(16), 158);
    assert.equal(png.readUInt32BE(20), 58);
    assert.equal(png[25], 6, 'The supplied artwork retains its alpha channel.');
  });
}

test('headers select the supplied blue and white images without recoloring or masks', async () => {
  const [brand, frame, landing, css] = await Promise.all([
    read('apps/web/src/components/BrandLockup.jsx'), read('apps/web/src/investor/InvestorFrame.jsx'),
    read('apps/web/src/investor/LandingPage.jsx'), read('apps/web/src/components/brand.css'),
  ]);
  assert.match(brand, /inverse \? '\/proxyvote-brand-white\.png' : '\/proxyvote-brand-blue\.png'/u);
  assert.match(brand, /<img className="proxyvote-artwork"/u);
  assert.match(brand, /width="158" height="58" alt="ProxyVote"/u);
  assert.match(brand, /children \?\? <ProxyVoteMark inverse=\{inverse\} \/>/u);
  assert.match(frame, /<BrandLockup inverse=\{inverse\}/u);
  assert.match(landing, /<BrandBand inverse \/>/u);
  assert.match(frame, /<BrandBand event=\{event\} \/>/u);
  assert.match(css, /\.proxyvote-artwork \{[^}]*object-fit: contain/u);
  assert.doesNotMatch(brand, /mask|proxyvote-(?:landing|voter)-mark/u);
  assert.doesNotMatch(css, /mask-image|filter: brightness/u);
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
