import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { eventIssuerBranding, issuerPresetById } from '@pv/shared';
import { query } from './db.js';
import { HttpError, normalizeAddress } from './errors.js';
import { imageHeader } from './logo-validation.js';

export async function uploadIssuerLogo(walletInput, input) {
  const wallet = normalizeAddress(walletInput, 'wallet');
  const bytes = Buffer.isBuffer(input) ? input : Buffer.alloc(0);
  let header;
  try { header = imageHeader(bytes); }
  catch (error) { throw new HttpError(400, error.message, 'INVALID_ISSUER_LOGO'); }
  try {
    const document = await PDFDocument.create();
    const image = header.mimeType === 'image/png' ? await document.embedPng(bytes) : await document.embedJpg(bytes);
    // Force decoding before accepting the image, not during receipt generation.
    await document.save();
    if (image.width !== header.width || image.height !== header.height) throw new Error('Image dimensions disagree.');
  } catch {
    throw new HttpError(400, 'The logo is not a readable PNG or JPEG image.', 'INVALID_ISSUER_LOGO');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const result = await query(
    `INSERT INTO issuer_logos(uploaded_by,mime_type,image_bytes,sha256) VALUES ($1,$2,$3,$4)
     ON CONFLICT(uploaded_by,sha256) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING id`,
    [wallet, header.mimeType, bytes, sha256],
  );
  return { id: result.rows[0].id, mimeType: header.mimeType, url: `/v1/issuer-logos/${result.rows[0].id}` };
}

export async function ensureOwnedIssuerLogo(id, wallet) {
  if (!id) return;
  const found = await query('SELECT id FROM issuer_logos WHERE id=$1 AND uploaded_by=$2', [id, normalizeAddress(wallet)]);
  if (!found.rowCount) throw new HttpError(400, 'Upload a logo from this issuer wallet before creating the event.', 'ISSUER_LOGO_NOT_FOUND');
}

export async function readIssuerLogo(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new HttpError(404, 'Issuer logo not found.', 'ISSUER_LOGO_NOT_FOUND');
  const result = await query('SELECT mime_type,image_bytes FROM issuer_logos WHERE id=$1', [id]);
  if (!result.rowCount) throw new HttpError(404, 'Issuer logo not found.', 'ISSUER_LOGO_NOT_FOUND');
  return { mimeType: result.rows[0].mime_type, bytes: result.rows[0].image_bytes };
}

export async function reportIssuerLogo(event) {
  if (event.issuer_logo_id) return readIssuerLogo(event.issuer_logo_id);
  const preset = issuerPresetById(eventIssuerBranding(event).issuerLogoPreset);
  if (!preset) return null;
  return { mimeType: 'image/png', bytes: await readFile(new URL(`../assets/issuer-logos/${preset.logoFile}`, import.meta.url)) };
}
