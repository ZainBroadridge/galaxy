import { config } from './config.js';
import { query, transaction } from './db.js';
import { errorText } from './errors.js';

export async function enqueueJob({ eventId, voterAddress = null, type, dedupeKey, message, client = { query } }) {
  const existing = await client.query('SELECT * FROM jobs WHERE dedupe_key = $1 FOR UPDATE', [dedupeKey]);
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.status !== 'FAILED') return row;

    // Transient retries reuse the same signed transaction. A user-requested
    // retry after final failure must prepare a fresh transaction/nonce instead.
    await client.query("DELETE FROM relayer_transactions WHERE job_id=$1 AND status='REVERTED'", [row.id]);
    const reset = await client.query(
      `UPDATE jobs SET event_id=$2, voter_address=$3, type=$4, status='PENDING', progress=0,
       message=$5, result=NULL, error=NULL, attempts=0, available_at=now(), locked_at=NULL, locked_by=NULL
       WHERE id=$1 RETURNING *`,
      [row.id, eventId, voterAddress, type, message],
    );
    return reset.rows[0];
  }
  const inserted = await client.query(
    `INSERT INTO jobs(event_id,voter_address,type,dedupe_key,message)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [eventId, voterAddress, type, dedupeKey, message],
  );
  return inserted.rows[0];
}

export async function claimJob() {
  return transaction(async (client) => {
    const result = await client.query(
      `WITH next AS (
         SELECT id
           FROM jobs
          WHERE (status='PENDING' AND available_at <= now())
             OR (status='RUNNING' AND locked_at < now()-($2*interval '1 minute'))
          ORDER BY CASE WHEN status='PENDING' THEN available_at ELSE locked_at END, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE jobs j
          SET status='RUNNING', attempts=attempts+1, locked_at=now(), locked_by=$1,
              message=CASE WHEN j.status='RUNNING' THEN 'Recovered after service restart' ELSE j.message END
         FROM next
        WHERE j.id=next.id
        RETURNING j.*`,
      [config.workerId, config.jobLockMinutes],
    );
    return result.rows[0] ?? null;
  });
}

export async function updateJob(id, progress, message, resultPatch = undefined) {
  const patch = resultPatch === undefined ? null : JSON.stringify(resultPatch);
  await query(
    `UPDATE jobs
        SET progress=$2,
            message=$3,
            result=CASE WHEN $4::jsonb IS NULL THEN result ELSE coalesce(result,'{}'::jsonb) || $4::jsonb END,
            locked_at=CASE WHEN status='RUNNING' THEN now() ELSE locked_at END
      WHERE id=$1`,
    [id, progress, message, patch],
  );
}

export async function completeJob(id, result = {}) {
  await query(
    `UPDATE jobs SET status='COMPLETED',progress=100,message='Completed',result=$2::jsonb,
     error=NULL,locked_at=NULL,locked_by=NULL WHERE id=$1`,
    [id, JSON.stringify(result)],
  );
}

export async function failJob(job, error) {
  const message = errorText(error).slice(0, 4000);
  const final = Boolean(error?.permanent) || Number(job.attempts) >= Number(job.max_attempts);
  if (!final) {
    const delay = Math.min(120, 2 ** Math.max(1, Number(job.attempts)));
    await query(
      `UPDATE jobs SET status='PENDING',available_at=now()+($2*interval '1 second'),
       message='Retry scheduled',error=$3,locked_at=NULL,locked_by=NULL WHERE id=$1`,
      [job.id, delay, message],
    );
    return;
  }
  await transaction(async (client) => {
    await client.query(
      `UPDATE jobs SET status='FAILED',message='Failed',error=$2,locked_at=NULL,locked_by=NULL WHERE id=$1`,
      [job.id, message],
    );
    if (job.type === 'BUILD_SNAPSHOT') {
      await client.query("UPDATE events SET status='FAILED',failure_reason=$2 WHERE id=$1", [job.event_id, message]);
    } else if (job.type === 'DEPLOY_EVENT') {
      await client.query("UPDATE events SET status='SNAPSHOT_READY',failure_reason=$2 WHERE id=$1 AND deployment_block IS NULL", [job.event_id, message]);
    } else if (job.type === 'RELAY_VOTE') {
      await client.query("UPDATE votes SET status='FAILED',failure_reason=$3 WHERE event_id=$1 AND voter_address=$2 AND status<>'CONFIRMED'", [job.event_id, job.voter_address, message]);
    } else if (job.type === 'VERIFY_CONTRACT') {
      await client.query("UPDATE events SET verification_status='FAILED',verification_error=$2 WHERE id=$1", [job.event_id, message]);
    }
  });
}

export async function recoverJobs() {
  await query(
    `UPDATE jobs SET status='PENDING',available_at=now(),locked_at=NULL,locked_by=NULL,message='Recovered after restart'
     WHERE status='RUNNING' AND locked_at < now()-($1*interval '1 minute')`,
    [config.jobLockMinutes],
  );
}
