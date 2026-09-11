import { config } from '../config.js';
import { query } from '../db.js';
import { deferredError, permanentError } from '../errors.js';
import { eventIssuerBranding } from '@pv/shared';
import { receiptEmailEnabled, mailConfiguration } from './config.js';
import { receiptRecipient } from './email-recipients.js';
import { receiptEmailContent } from './receipt-template.js';
import { assertEmailPayload, sendEmail } from './resend.js';

// Resend retains idempotency keys for 24h; stop earlier if the delivery outcome is ambiguous.
export const SAFE_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

export function assertRetryWindow(firstAttemptAt, now = Date.now()) {
  if (firstAttemptAt === null || firstAttemptAt === undefined) return;
  const started = new Date(firstAttemptAt).getTime();
  if (!Number.isFinite(started) || now - started >= SAFE_RETRY_WINDOW_MS) {
    throw permanentError('Receipt email needs manual delivery review: the safe idempotency retry window expired. Do not clear its first-attempt timestamp.');
  }
}

async function deliveryRow(job) {
  const found = await query(
    `SELECT m.*,v.event_id,v.voter_address,v.status AS vote_status,v.transaction_hash,v.block_number
       FROM vote_receipt_emails m JOIN votes v ON v.id=m.vote_id
      WHERE m.job_id=$1 AND v.event_id=$2 AND v.voter_address=$3`,
    [job.id, job.event_id, job.voter_address],
  );
  if (!found.rowCount) throw permanentError('Receipt email does not match an accepted vote.');
  return found.rows[0];
}

async function preparePayload(job, from) {
  // Load the existing report generator only for mail work; the ballot request never generates a PDF.
  const [{ createVoteReceipt }, { getEventRow }, { reportIssuerLogo }] = await Promise.all([
    import('../reports.js'), import('../events.js'), import('../issuer-logos.js'),
  ]);
  const event = await getEventRow(job.event_id);
  const saved = await query('SELECT * FROM votes WHERE event_id=$1 AND voter_address=$2', [job.event_id, job.voter_address]);
  const vote = saved.rows[0];
  if (vote?.status !== 'CONFIRMED') throw deferredError('Waiting for the confirmed vote receipt.', Date.now() + 30_000);
  let recipient;
  try { recipient = receiptRecipient(vote.voter_address); }
  catch (error) { throw permanentError(error.message); }
  const receipt = await createVoteReceipt(event.id, vote.voter_address);
  if (!Buffer.isBuffer(receipt.bytes) || receipt.bytes.subarray(0, 5).toString() !== '%PDF-') {
    throw permanentError('The existing receipt generator did not return a PDF.');
  }
  const logo = await reportIssuerLogo(event).catch(() => null);
  const hasLogo = Boolean(logo && ['image/png', 'image/jpeg'].includes(logo.mimeType)
    && Buffer.isBuffer(logo.bytes) && logo.bytes.length > 0 && logo.bytes.length <= 512 * 1024);
  const content = receiptEmailContent({ event, vote, branding: eventIssuerBranding(event),
    webAppUrl: config.webAppUrl, explorerUrl: config.explorerUrl, hasLogo });
  const attachments = [{ filename: receipt.filename, content: receipt.bytes.toString('base64') }];
  if (hasLogo) attachments.push({ filename: `issuer-logo.${logo.mimeType === 'image/png' ? 'png' : 'jpg'}`,
    content: logo.bytes.toString('base64'), content_id: 'issuer-logo' });
  const payload = { from, to: [recipient], ...content, attachments };
  assertEmailPayload(payload);
  // Persist once: PDF generation timestamps, logo updates and mapping edits cannot change a retry's body.
  await query(
    `UPDATE vote_receipt_emails SET recipient=$2,request_payload=$3::jsonb
      WHERE job_id=$1 AND request_payload IS NULL AND accepted_at IS NULL`,
    [job.id, recipient, JSON.stringify(payload)],
  );
}

export async function sendVoteReceiptEmail(job) {
  let row = await deliveryRow(job);
  if (row.accepted_at) return { emailAccepted: true, alreadyComplete: true };
  if (!receiptEmailEnabled()) throw deferredError('Receipt email delivery is disabled.', Date.now() + 60 * 60 * 1000);
  if (row.vote_status === 'FAILED') throw permanentError('The vote failed; no confirmation receipt email was sent.');
  if (row.vote_status !== 'CONFIRMED' || !row.transaction_hash || !row.block_number) {
    throw deferredError('Waiting for vote confirmation before sending the receipt email.', Date.now() + 30_000);
  }
  assertRetryWindow(row.first_attempt_at);
  let settings;
  try { settings = mailConfiguration(); }
  catch (error) { throw permanentError(error.message); }
  if (!row.request_payload) {
    await preparePayload(job, settings.from);
    row = await deliveryRow(job);
    if (row.accepted_at) return { emailAccepted: true, alreadyComplete: true };
  }
  if (!row.request_payload) throw new Error('Receipt email payload is not ready.');
  const attempt = await query(
    `UPDATE vote_receipt_emails m SET first_attempt_at=coalesce(first_attempt_at,now())
       FROM jobs j WHERE m.job_id=$1 AND j.id=m.job_id AND j.status='RUNNING'
        AND j.locked_by=$2 AND m.accepted_at IS NULL
      RETURNING m.*`,
    [job.id, config.workerId],
  );
  if (!attempt.rowCount) {
    if ((await deliveryRow(job)).accepted_at) return { emailAccepted: true, alreadyComplete: true };
    throw new Error('The receipt email job is no longer owned by this runner.');
  }
  row = attempt.rows[0];
  assertRetryWindow(row.first_attempt_at);
  let response;
  try {
    response = await sendEmail(row.request_payload, { apiKey: settings.apiKey, idempotencyKey: `vote-receipt/${row.vote_id}` });
  } catch (error) {
    if (Number.isFinite(error.retryAfterMs)) {
      throw deferredError(error.message, Date.now() + error.retryAfterMs);
    }
    throw error;
  }
  // Retain only the audit metadata after provider acceptance, not a second copy of the PDF/body.
  await query(
    `UPDATE vote_receipt_emails SET provider_message_id=$2,accepted_at=coalesce(accepted_at,now()),request_payload=NULL
      WHERE job_id=$1 AND accepted_at IS NULL`,
    [job.id, response.id],
  );
  // Provider acceptance is not a claim that the recipient's inbox delivered or displayed the message.
  return { emailAccepted: true };
}
