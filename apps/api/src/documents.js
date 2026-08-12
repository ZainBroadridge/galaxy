import { createHash, randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PDFDocument } from 'pdf-lib';
import { config } from './config.js';
import { query, transaction } from './db.js';
import { HttpError, normalizeAddress } from './errors.js';

export const MAX_EVENT_DOCUMENTS = 3;
export const MAX_EVENT_DOCUMENT_BYTES = 10 * 1024 * 1024;

let storageClient;

function r2Client() {
  if (!Object.values(config.r2).every(Boolean)) {
    throw new HttpError(503, 'Document storage is not configured.', 'DOCUMENT_STORAGE_UNAVAILABLE');
  }
  if (!storageClient) {
    storageClient = new S3Client({
      region: 'auto',
      endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
    });
  }
  return storageClient;
}

function cleanFilename(value) {
  let decoded;
  try { decoded = decodeURIComponent(String(value ?? '')); } catch { decoded = String(value ?? ''); }
  const filename = decoded
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (!filename || !filename.toLowerCase().endsWith('.pdf')) {
    throw new HttpError(400, 'Upload a PDF document.', 'INVALID_DOCUMENT');
  }
  return filename;
}

function serialize(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    fileName: row.file_name,
    fileSize: Number(row.file_size),
    pageCount: Number(row.page_count),
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

async function ensureCreator(client, eventId, wallet, lock = false) {
  const result = await client.query(
    `SELECT creator_address FROM events WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
    [eventId],
  );
  if (!result.rowCount) throw new HttpError(404, 'Event not found.', 'EVENT_NOT_FOUND');
  if (result.rows[0].creator_address !== normalizeAddress(wallet)) {
    throw new HttpError(403, 'Only the event creator can manage documents.', 'FORBIDDEN');
  }
}

async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function listEventDocuments(eventId) {
  const result = await query(
    `SELECT id,event_id,file_name,file_size,page_count,sha256,created_at
       FROM event_documents
      WHERE event_id=$1 AND deleted_at IS NULL
      ORDER BY created_at,id`,
    [eventId],
  );
  return result.rows.map(serialize);
}

export async function uploadEventDocument(eventId, wallet, rawFilename, bytes) {
  const filename = cleanFilename(rawFilename);
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (buffer.length === 0 || buffer.length > MAX_EVENT_DOCUMENT_BYTES) {
    throw new HttpError(400, 'Each PDF must be between 1 byte and 10 MB.', 'DOCUMENT_SIZE_INVALID');
  }
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new HttpError(400, 'The uploaded file is not a valid PDF.', 'INVALID_DOCUMENT');
  }

  let pdf;
  try {
    pdf = await PDFDocument.load(buffer, { updateMetadata: false });
  } catch {
    throw new HttpError(400, 'The PDF is unreadable or encrypted.', 'INVALID_DOCUMENT');
  }
  const pageCount = pdf.getPageCount();
  if (pageCount < 1) throw new HttpError(400, 'The PDF has no pages.', 'INVALID_DOCUMENT');

  await ensureCreator({ query }, eventId, wallet);
  const id = randomUUID();
  const objectKey = `events/${eventId}/${id}.pdf`;
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const storage = r2Client();

  await storage.send(new PutObjectCommand({
    Bucket: config.r2.bucketName,
    Key: objectKey,
    Body: buffer,
    ContentType: 'application/pdf',
    Metadata: { eventId, sha256 },
  }));

  try {
    const row = await transaction(async (client) => {
      await ensureCreator(client, eventId, wallet, true);
      const count = await client.query(
        'SELECT count(*)::int AS count FROM event_documents WHERE event_id=$1 AND deleted_at IS NULL',
        [eventId],
      );
      if (count.rows[0].count >= MAX_EVENT_DOCUMENTS) {
        throw new HttpError(409, `An event can contain at most ${MAX_EVENT_DOCUMENTS} PDFs.`, 'DOCUMENT_LIMIT');
      }
      const inserted = await client.query(
        `INSERT INTO event_documents(
           id,event_id,file_name,object_key,file_size,page_count,sha256,uploaded_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id,event_id,file_name,file_size,page_count,sha256,created_at`,
        [id, eventId, filename, objectKey, buffer.length, pageCount, sha256, normalizeAddress(wallet)],
      );
      return inserted.rows[0];
    });
    return serialize(row);
  } catch (error) {
    await storage.send(new DeleteObjectCommand({
      Bucket: config.r2.bucketName,
      Key: objectKey,
    })).catch(() => {});
    throw error;
  }
}

export async function deleteEventDocument(eventId, documentId, wallet) {
  const document = await transaction(async (client) => {
    await ensureCreator(client, eventId, wallet, true);
    const result = await client.query(
      `UPDATE event_documents
          SET deleted_at=now()
        WHERE id=$1 AND event_id=$2 AND deleted_at IS NULL
        RETURNING object_key`,
      [documentId, eventId],
    );
    if (!result.rowCount) throw new HttpError(404, 'Document not found.', 'DOCUMENT_NOT_FOUND');
    return result.rows[0];
  });

  try {
    await r2Client().send(new DeleteObjectCommand({
      Bucket: config.r2.bucketName,
      Key: document.object_key,
    }));
  } catch (error) {
    await query(
      'UPDATE event_documents SET deleted_at=NULL WHERE id=$1 AND event_id=$2',
      [documentId, eventId],
    ).catch(() => {});
    throw error;
  }
}

async function documentRow(eventId, documentId) {
  const result = await query(
    `SELECT id,event_id,file_name,object_key,file_size,page_count,sha256,created_at
       FROM event_documents
      WHERE id=$1 AND event_id=$2 AND deleted_at IS NULL`,
    [documentId, eventId],
  );
  if (!result.rowCount) throw new HttpError(404, 'Document not found.', 'DOCUMENT_NOT_FOUND');
  return result.rows[0];
}

export async function readEventDocument(eventId, documentId) {
  const row = await documentRow(eventId, documentId);
  const object = await r2Client().send(new GetObjectCommand({
    Bucket: config.r2.bucketName,
    Key: row.object_key,
  }));
  return { ...serialize(row), bytes: await bodyToBuffer(object.Body) };
}

export async function readAllEventDocuments(eventId) {
  const rows = await query(
    `SELECT id,event_id,file_name,object_key,file_size,page_count,sha256,created_at
       FROM event_documents
      WHERE event_id=$1 AND deleted_at IS NULL
      ORDER BY created_at,id`,
    [eventId],
  );
  if (!rows.rowCount) return [];
  const storage = r2Client();
  return Promise.all(rows.rows.map(async (row) => {
    const object = await storage.send(new GetObjectCommand({
      Bucket: config.r2.bucketName,
      Key: row.object_key,
    }));
    return { ...serialize(row), bytes: await bodyToBuffer(object.Body) };
  }));
}
