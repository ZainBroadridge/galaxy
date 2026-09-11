export function visibleCreationNotice(event, notice) {
  if (!notice) return null;
  // Router state survives navigation; creation messages must not outlive the work.
  const completed = Boolean(event?.snapshotRoot || (event?.contractReady && Number(event?.deploymentBlock) > 0));
  if (completed && /snapshot processing|snapshot.*scheduled/iu.test(notice)) return null;
  return notice;
}

export const CREATION_LIMIT_NOTICE_MS = 30_000;

/** Expire only the daily-limit response; other validation/network errors stay visible. */
export function scheduleCreationLimitNotice(error, dismiss, timers = globalThis) {
  if (error?.code !== 'EVENT_LIMIT') return undefined;
  const timer = timers.setTimeout(dismiss, CREATION_LIMIT_NOTICE_MS);
  return () => timers.clearTimeout(timer);
}
