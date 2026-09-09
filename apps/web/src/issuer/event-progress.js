const BUILD_TYPES = new Set(['BUILD_SNAPSHOT', 'DEPLOY_EVENT']);
const active = (job) => ['PENDING', 'RUNNING'].includes(job?.status);

/** Deployment readiness is independent of explorer publication and URL presence. */
export function eventProgress(event, now = Date.now()) {
  const ready = Boolean(event?.snapshotRoot && event?.contractAddress && event?.contractReady
    && Number(event?.deploymentBlock) > 0);
  const buildJob = BUILD_TYPES.has(event?.job?.type) ? event.job : null;
  const verificationJob = event?.verificationJob ?? (event?.job?.type === 'VERIFY_CONTRACT' ? event.job : null);
  const availableAt = Date.parse(buildJob?.availableAt ?? '');
  const recordDateAt = Date.parse(event?.recordDateAt ?? '');
  const waitingForRecordDate = !ready && buildJob?.type === 'BUILD_SNAPSHOT'
    && buildJob.status === 'PENDING' && !buildJob.error && availableAt > now
    && (recordDateAt > now || /record.date|finality/iu.test(buildJob.message ?? ''));
  const progress = ready ? 100 : Math.max(0, Math.min(100, Number(buildJob?.progress) || 0));
  return {
    ready, buildJob, verificationJob, progress, availableAt, waitingForRecordDate,
    active: !ready && active(buildJob) && !waitingForRecordDate,
    verificationActive: event?.verificationStatus !== 'VERIFIED'
      && (event?.verificationStatus === 'PENDING' || active(verificationJob)),
    message: ready ? 'Snapshot complete; VoteEvent deployed and ready'
      : buildJob?.message || 'Preparing the voting event',
    canRetryBuild: !ready && Boolean(event?.failureReason || buildJob?.status === 'FAILED'),
  };
}
