import { config } from '../src/config.js';
import { db, query, transaction } from '../src/db.js';
import { receiptEmailEnabled, mailConfiguration } from '../src/mail/config.js';
import { receiptRecipient } from '../src/mail/email-recipients.js';

const [command = 'status', id] = process.argv.slice(2);
try {
  if (command === 'check') {
    if (!receiptEmailEnabled()) {
      console.log('Receipt email is disabled. Set VOTE_RECEIPT_EMAIL_ENABLED=true after configuration and migration.');
    } else {
      const settings = mailConfiguration();
      const fallback = process.env.VOTE_RECEIPT_EMAIL_TO;
      if (fallback) receiptRecipient(`0x${'0'.repeat(40)}`);
      console.log(`Sender configured: ${settings.from}`);
      console.log(fallback ? 'Demo recipient configured.' : 'Wallet-specific recipient mapping is required.');
      console.log('API key configured (not printed).');
    }
    const schema = await query("SELECT to_regclass('public.vote_receipt_emails') AS name");
    if (!schema.rows[0]?.name) throw new Error('Apply migration 009_vote_receipt_emails.sql first.');
    console.log(`Database ready; chain ID: ${config.chainId}. No email was sent.`);
  } else if (command === 'status') {
    const result = await query(
      `SELECT m.job_id,m.vote_id,v.event_id,v.status AS vote_status,j.status AS job_status,
              j.attempts,j.available_at,j.error,m.first_attempt_at,m.provider_message_id,m.accepted_at
         FROM vote_receipt_emails m JOIN jobs j ON j.id=m.job_id JOIN votes v ON v.id=m.vote_id
        ORDER BY m.created_at DESC LIMIT 30`,
    );
    console.table(result.rows);
  } else if (command === 'retry' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(id ?? '')) {
    await transaction(async (client) => {
      const result = await client.query(
        `SELECT m.*,j.status,v.status AS vote_status,
                (m.first_attempt_at IS NULL OR m.first_attempt_at>now()-interval '23 hours') AS safe_to_retry
           FROM vote_receipt_emails m JOIN jobs j ON j.id=m.job_id JOIN votes v ON v.id=m.vote_id
          WHERE m.job_id=$1 FOR UPDATE OF j,m`, [id],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Receipt email job not found.');
      if (row.accepted_at) throw new Error('The provider already accepted this email. It will not be sent again.');
      if (row.status !== 'FAILED') throw new Error('Only a failed email job may be retried.');
      if (row.vote_status !== 'CONFIRMED') throw new Error('A confirmed vote is required.');
      if (!row.safe_to_retry) throw new Error('Delivery outcome needs manual review in the provider dashboard; automatic replay is unsafe.');
      await client.query(
        `UPDATE jobs SET status='PENDING',available_at=now(),attempts=0,error=NULL,
            locked_at=NULL,locked_by=NULL,message='Receipt email retry requested' WHERE id=$1`, [id],
      );
    });
    console.log('Email job requeued. Restart/redeploy the API service to wake an idle worker. No vote was changed.');
  } else {
    throw new Error('Usage: node apps/api/scripts/receipt-email.mjs check | status | retry <job-id>');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
