const MAX_LOGO_BYTES = 512 * 1024;
const MAX_DIMENSION = 2048;

/** Header dimensions are bounded before any image decompression takes place. */
export function imageHeader(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array();
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES) throw new Error('The issuer logo must be a PNG or JPEG no larger than 512 KB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let mimeType;
  let width;
  let height;
  if (bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) {
    if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw new Error('Invalid PNG header.');
    mimeType = 'image/png'; width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    mimeType = 'image/jpeg';
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) throw new Error('Invalid JPEG segment.');
      while (offset < bytes.length && bytes[offset] === 255) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error('Truncated JPEG data.');
      if ([0xc0,0xc1,0xc2].includes(marker)) {
        if (length < 8) throw new Error('Invalid JPEG dimensions.');
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  } else {
    throw new Error('Only PNG and JPEG issuer logos are supported.');
  }
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > 4_000_000) {
    throw new Error('Use a logo with dimensions no larger than 2048 x 2048 and four million pixels.');
  }
  return { mimeType, width, height };
}
