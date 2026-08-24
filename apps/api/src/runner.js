import { config } from './config.js';
import { query } from './db.js';
import { buildSnapshot } from './snapshot.js';
import { deployEvent } from './deploy.js';
import { relayVote } from './relay-vote.js';
import { verifyContract } from './verify.js';
import { claimJob, completeJob, failJob, recoverJobs } from './jobs.js';

let running = false;
let timer = null;
let logger = console;

const MAX_TIMER_DELAY_MS = 24 * 60 * 60 * 1000;

const handlers = {
  BUILD_SNAPSHOT: buildSnapshot,
  DEPLOY_EVENT: deployEvent,
  RELAY_VOTE: relayVote,
  VERIFY_CONTRACT: verifyContract,
};

async function nextDelay() {
  const result = await query(
    `SELECT extract(epoch FROM (min(wake_at)-now()))*1000 AS delay
       FROM (
         SELECT available_at AS wake_at FROM jobs WHERE status='PENDING'
         UNION ALL
         SELECT locked_at+($1*interval '1 minute') AS wake_at FROM jobs WHERE status='RUNNING'
       ) wakeups`,
    [config.jobLockMinutes],
  );
  const delay = Number(result.rows[0]?.delay);
  return Number.isFinite(delay)
    ? Math.max(250, Math.min(MAX_TIMER_DELAY_MS, delay))
    : null;
}

async function loop() {
  if (running) return;
  running = true;
  clearTimeout(timer);
  timer = null;
  try {
    while (true) {
      const job = await claimJob();
      if (!job) break;
      const handler = handlers[job.type];
      try {
        logger.info?.({ jobId: job.id, type: job.type, eventId: job.event_id }, 'Processing durable job');
        const result = await handler(job);
        await completeJob(job.id, result);
      } catch (error) {
        const outcome = await failJob(job, error);
        const context = {
          jobId: job.id,
          type: job.type,
          eventId: job.event_id,
          error: error.message,
          availableAt: outcome.availableAt,
        };
        if (outcome.deferred) logger.info?.(context, 'Durable job deferred');
        else logger.warn?.(context, 'Job failed or will retry');
      }
    }
  } finally {
    running = false;
    const delay = await nextDelay().catch(() => null);
    if (delay !== null) timer = setTimeout(kickJobRunner, Math.max(config.jobIdleDelayMs, delay));
  }
}

export function kickJobRunner() {
  if (!running) queueMicrotask(() => loop().catch((error) => logger.error?.({ error }, 'Job runner failed')));
}

export async function startJobRunner(log = console) {
  logger = log;
  await recoverJobs();
  kickJobRunner();
}

export function jobRunnerStatus() {
  return { running, workerId: config.workerId };
}
