export function visibleCreationNotice(event, notice) {
  if (!notice) return null;
  // Router state survives navigation; creation messages must not outlive the work.
  const completed = Boolean(event?.snapshotRoot || (event?.contractReady && Number(event?.deploymentBlock) > 0));
  if (completed && /snapshot processing|snapshot.*scheduled/iu.test(notice)) return null;
  return notice;
}
