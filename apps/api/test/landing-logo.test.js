import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Decode the small, non-interlaced RGBA PNG brand assets using Node built-ins.
// Pixel assertions survive valid PNG recompression and alpha anti-aliasing changes.
function decodeRgbaPng(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Expected a PNG signature.');
  const chunks = []; let width; let height; let ended = false;
  for (let offset = 8; offset < bytes.length;) {
    assert.ok(offset + 12 <= bytes.length, 'Truncated PNG chunk.');
    const length = bytes.readUInt32BE(offset);
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    assert.ok(offset + length + 12 <= bytes.length, 'Truncated PNG payload.');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (kind === 'IHDR') {
      assert.equal(length, 13);
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.ok(width > 0 && height > 0 && width * height <= 1_000_000);
      assert.deepEqual([...data.subarray(8)], [8, 6, 0, 0, 0], 'Expected non-interlaced 8-bit RGBA artwork.');
    } else if (kind === 'IDAT') chunks.push(data);
    else if (kind === 'IEND') { ended = true; break; }
    offset += length + 12;
  }
  assert.ok(width && height && ended && chunks.length, 'PNG must contain image data and an end marker.');
  const stride = width * 4;
  const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: height * (stride + 1) });
  assert.equal(raw.length, height * (stride + 1));
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4, 'Unknown PNG row filter.');
    for (let x = 0; x < stride; x += 1) {
      const index = y * stride + x;
      const left = x >= 4 ? pixels[index - 4] : 0;
      const up = y > 0 ? pixels[index - stride] : 0;
      const upperLeft = x >= 4 && y > 0 ? pixels[index - stride - 4] : 0;
      const estimate = left + up - upperLeft;
      const distances = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upperLeft)];
      const paeth = distances[0] <= distances[1] && distances[0] <= distances[2] ? left
        : distances[1] <= distances[2] ? up : upperLeft;
      const prediction = [0, left, up, Math.floor((left + up) / 2), paeth][filter];
      pixels[index] = (raw[y * (stride + 1) + 1 + x] + prediction) & 255;
    }
  }
  return { width, height, pixels };
}

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('blue and white logos retain their dimensions, lettering silhouette and transparent background', async () => {
  const variants = await Promise.all(['blue', 'white'].map(async (name) => {
    const bytes = await readFile(new URL(`apps/web/public/proxyvote-brand-${name}.png`, root));
    const image = decodeRgbaPng(bytes);
    assert.equal(image.width, 158); assert.equal(image.height, 58);
    const silhouette = []; let transparent = 0; let visible = 0;
    for (let i = 0; i < image.pixels.length; i += 4) {
      const [red, green, blue, alpha] = image.pixels.subarray(i, i + 4);
      silhouette.push(alpha > 0);
      if (alpha === 0) { transparent += 1; continue; }
      visible += 1;
      if (name === 'white') assert.ok(red >= 250 && green >= 250 && blue >= 250, 'Inverse artwork must remain white.');
      else assert.ok(blue >= red, 'Normal artwork must retain its blue palette.');
    }
    assert.ok(transparent > 0 && visible > 0, 'Artwork must contain visible lettering and a transparent background.');
    return silhouette;
  }));
  assert.deepEqual(variants[0], variants[1], 'The normal and inverse PNGs must preserve the same lettering shape.');
});

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
