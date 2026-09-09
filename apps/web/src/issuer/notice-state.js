export function visibleCreationNotice(event, notice) {
  if (!notice) return null;
  // A persisted router notice describes creation, not the current worker state.
  if (event?.snapshotRoot && /snapshot processing/i.test(notice)) return null;
  return notice;
}
