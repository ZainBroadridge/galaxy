const MIN_FINALITY_RECHECK_MS = 5_000;
const MAX_FINALITY_RECHECK_MS = 60_000;

function timestamp(value, field) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be a valid date.`);
  return parsed;
}

export function planSnapshotJob(recordDateAt, { retry = false, now = Date.now() } = {}) {
  const recordTime = timestamp(recordDateAt, 'recordDateAt');
  const scheduled = recordTime > now;
  const label = retry ? 'Snapshot retry' : 'Snapshot';
  const availableAt = scheduled ? new Date(recordTime).toISOString() : null;

  return {
    availableAt,
    scheduled,
    message: scheduled
      ? `${label} scheduled for ${availableAt}`
      : `${label} queued`,
  };
}

export function nextFinalityCheckAt(recordDateAt, finalizedBlockTimestamp, now = Date.now()) {
  const recordTime = timestamp(recordDateAt, 'recordDateAt');
  const finalizedSeconds = Number(finalizedBlockTimestamp);
  if (!Number.isFinite(finalizedSeconds) || finalizedSeconds < 0) {
    throw new TypeError('finalizedBlockTimestamp must be a non-negative number.');
  }

  if (recordTime > now) return new Date(recordTime).toISOString();

  const recordSeconds = Math.floor(recordTime / 1000);
  if (finalizedSeconds >= recordSeconds) return null;

  const lagMs = (recordSeconds - finalizedSeconds) * 1000;
  const delayMs = Math.min(
    MAX_FINALITY_RECHECK_MS,
    Math.max(MIN_FINALITY_RECHECK_MS, lagMs + MIN_FINALITY_RECHECK_MS),
  );
  return new Date(now + delayMs).toISOString();
}
