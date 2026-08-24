import { config } from './config.js';
import { query, transaction } from './db.js';
import { publishEventUpdate } from './event-stream.js';
import { errorText } from './errors.js';

function scheduledAt(value) {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('availableAt must be a valid date.');
  return date.toISOString();
}

export async function enqueueJob({
  eventId,
  voterAddress = null,
  type,
  dedupeKey,
  message,
  availableAt = null,
  client = { query },
}) {
  const schedule = scheduledAt(availableAt);
  const existing = await client.query('SELECT * FROM jobs WHERE dedupe_key=$1 FOR UPDATE', [dedupeKey]);
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.status !== 'FAILED') {
      if (row.status === 'PENDING' && schedule) {
        const rescheduled = await client.query(
          `UPDATE jobs
              SET available_at=greatest(available_at,$2::timestamptz),message=$3
            WHERE id=$1
            RETURNING *`,
          [row.id, schedule, message],
        );
        return rescheduled.rows[0];
      }
      return row;
    }

    await client.query(
      "DELETE FROM relayer_transactions WHERE job_id=$1 AND status='REVERTED'",
      [row.id],
    );
    const reset = await client.query(
      `UPDATE jobs
          SET event_id=$2,voter_address=$3,type=$4,status='PENDING',progress=0,
              message=$5,result=NULL,error=NULL,attempts=0,
              available_at=coalesce($6::timestamptz,now()),locked_at=NULL,locked_by=NULL
        WHERE id=$1
        RETURNING *`,
      [row.id, eventId, voterAddress, type, message, schedule],
    );
    return reset.rows[0];
  }

  const inserted = await client.query(
    `INSERT INTO jobs(event_id,voter_address,type,dedupe_key,message,available_at)
     VALUES ($1,$2,$3,$4,$5,coalesce($6::timestamptz,now()))
     RETURNING *`,
    [eventId, voterAddress, type, dedupeKey, message, schedule],
  );
  return inserted.rows[0];
}

export async function claimJob() {
  const job = await transaction(async (client) => {
    const result = await client.query(
      `WITH next AS (
         SELECT id
           FROM jobs
          WHERE (status='PENDING' AND available_at<=now())
             OR (status='RUNNING' AND locked_at<now()-($2*interval '1 minute'))
          ORDER BY CASE WHEN status='PENDING' THEN available_at ELSE locked_at END,created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE jobs j
          SET status='RUNNING',attempts=attempts+1,locked_at=now(),locked_by=$1,
              message=CASE WHEN j.status='RUNNING' THEN 'Recovered after service restart' ELSE j.message END
         FROM next
        WHERE j.id=next.id
        RETURNING j.*`,
      [config.workerId, config.jobLockMinutes],
    );
    return result.rows[0] ?? null;
  });
  if (job) publishEventUpdate(job.event_id);
  return job;
}

export async function updateJob(id, progress, message, resultPatch = undefined) {
  const patch = resultPatch === undefined ? null : JSON.stringify(resultPatch);
  const result = await query(
    `UPDATE jobs
        SET progress=$2,
            message=$3,
            result=CASE
              WHEN $4::jsonb IS NULL THEN result
              ELSE coalesce(result,'{}'::jsonb) || $4::jsonb
            END,
            locked_at=CASE WHEN status='RUNNING' THEN now() ELSE locked_at END
      WHERE id=$1
      RETURNING event_id`,
    [id, progress, message, patch],
  );
  publishEventUpdate(result.rows[0]?.event_id);
}

export async function completeJob(id, result = {}) {
  const updated = await query(
    `UPDATE jobs
        SET status='COMPLETED',progress=100,message='Completed',result=$2::jsonb,
            error=NULL,locked_at=NULL,locked_by=NULL
      WHERE id=$1
      RETURNING event_id`,
    [id, JSON.stringify(result)],
  );
  publishEventUpdate(updated.rows[0]?.event_id);
}

function providerOutage(error) {
  const text = errorText(error).toLowerCase();
  return Number(error?.httpStatus) >= 500
    || Number(error?.rpcCode) === -32001
    || text.includes('unable to complete request');
}

export async function failJob(job, error) {
  const message = errorText(error).slice(0, 4000);
  const deferredAt = error?.deferred ? scheduledAt(error.retryAt) : null;

  if (deferredAt) {
    await transaction(async (client) => {
      await client.query(
        `UPDATE jobs
            SET status='PENDING',progress=0,available_at=$2::timestamptz,
                message=$3,error=NULL,attempts=greatest(attempts-1,0),
                locked_at=NULL,locked_by=NULL
          WHERE id=$1`,
        [job.id, deferredAt, message],
      );
      if (job.type === 'BUILD_SNAPSHOT') {
        await client.query(
          "UPDATE events SET status='SNAPSHOT_PENDING',failure_reason=NULL WHERE id=$1 AND snapshot_root IS NULL",
          [job.event_id],
        );
      }
    });
    publishEventUpdate(job.event_id);
    return { final: false, deferred: true, availableAt: deferredAt };
  }

  const final = Boolean(error?.permanent) || Number(job.attempts) >= Number(job.max_attempts);

  if (!final) {
    const attempt = Math.max(1, Number(job.attempts));
    const delay = providerOutage(error)
      ? Math.min(120, 15 * 2 ** (attempt - 1))
      : Math.min(120, 2 ** attempt);
    await query(
      `UPDATE jobs
          SET status='PENDING',available_at=now()+($2*interval '1 second'),
              message=$3,error=$4,locked_at=NULL,locked_by=NULL
        WHERE id=$1`,
      [job.id, delay, `Retry scheduled in ${delay} seconds`, message],
    );
    publishEventUpdate(job.event_id);
    return { final: false, delay };
  }

  await transaction(async (client) => {
    await client.query(
      `UPDATE jobs
          SET status='FAILED',message='Failed',error=$2,locked_at=NULL,locked_by=NULL
        WHERE id=$1`,
      [job.id, message],
    );
    if (job.type === 'BUILD_SNAPSHOT') {
      await client.query(
        "UPDATE events SET status='FAILED',failure_reason=$2 WHERE id=$1",
        [job.event_id, message],
      );
    } else if (job.type === 'DEPLOY_EVENT') {
      await client.query(
        "UPDATE events SET status='SNAPSHOT_READY',failure_reason=$2 WHERE id=$1 AND deployment_block IS NULL",
        [job.event_id, message],
      );
    } else if (job.type === 'RELAY_VOTE') {
      await client.query(
        "UPDATE votes SET status='FAILED',failure_reason=$3 WHERE event_id=$1 AND voter_address=$2 AND status<>'CONFIRMED'",
        [job.event_id, job.voter_address, message],
      );
    } else if (job.type === 'VERIFY_CONTRACT') {
      await client.query(
        "UPDATE events SET verification_status='FAILED',verification_error=$2 WHERE id=$1",
        [job.event_id, message],
      );
    }
  });
  publishEventUpdate(job.event_id);
  return { final: true, delay: null };
}

export async function recoverJobs() {
  await query(
    `UPDATE jobs
        SET status='PENDING',available_at=now(),locked_at=NULL,locked_by=NULL,
            message='Recovered after restart'
      WHERE status='RUNNING' AND locked_at<now()-($1*interval '1 minute')`,
    [config.jobLockMinutes],
  );
}
