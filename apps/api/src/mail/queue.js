import { enqueueJob } from '../jobs.js';
import { receiptEmailEnabled } from './config.js';

/** Enqueue inside the same transaction as the accepted ballot; never send from an HTTP/page handler. */
export async function queueReceiptEmail(vote, client) {
  if (!receiptEmailEnabled()) return null;
  const job = await enqueueJob({
    eventId: vote.event_id,
    voterAddress: vote.voter_address,
    type: 'SEND_VOTE_RECEIPT',
    dedupeKey: `receipt-email:${vote.id}`,
    message: 'Vote receipt email queued',
    client,
  });
  await client.query(
    `INSERT INTO vote_receipt_emails(job_id,vote_id) VALUES ($1,$2)
     ON CONFLICT(vote_id) DO NOTHING`,
    [job.id, vote.id],
  );
  return job;
}
