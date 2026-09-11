import { AbiCoder } from 'ethers';
import { config } from './config.js';
import { query } from './db.js';
import { deferredError, permanentError } from './errors.js';
import { updateJob } from './jobs.js';
import { loadLegacyVerificationInput, loadVerificationInput } from './artifact.js';
import { constructorArguments } from './deploy.js';
import { deployedBallotVersion } from './ballot-protocol.js';
import { createExplorerClient, hasVerifiedSource, verificationResult } from './explorer-verification.js';

const CONSTRUCTOR_TYPES = [
  'address', 'address', 'uint64', 'bytes32', 'uint64', 'uint64',
  'uint256', 'bytes32', 'uint256', 'uint64', 'tuple(string,string[4],uint256,uint8)[]',
];

async function markVerified(job, event, alreadyVerified = false) {
  await query("UPDATE events SET verification_status='VERIFIED',verification_error=NULL WHERE id=$1", [event.id]);
  const result = {
    verified: true,
    alreadyVerified,
    url: `${config.explorerUrl}/address/${event.contract_address}#code`,
  };
  await updateJob(job.id, 100, 'Source verified on PolygonScan', result);
  return result;
}

async function deferVerification(job, message, patch = {}) {
  const polls = Math.max(0, Number(job.result?.verificationPolls) || 0) + 1;
  // Normal queue latency does not consume the failure-attempt budget. Longer
  // waits back off to five minutes while freeing the runner for other events.
  const delay = Math.min(300_000, 20_000 * 2 ** Math.min(4, Math.floor(polls / 10)));
  await updateJob(job.id, 50, message, { verificationPolls: polls, ...patch });
  throw deferredError(message, Date.now() + delay);
}

export async function verifyContract(job) {
  const found = await query('SELECT * FROM events WHERE id=$1', [job.event_id]);
  if (!found.rowCount) throw permanentError('Event no longer exists.');
  const event = found.rows[0];
  if (!event.contract_address || event.deployment_block === null) {
    throw permanentError('The contract must be mined before source verification.');
  }
  if (event.verification_status === 'VERIFIED') return markVerified(job, event, true);
  if (!config.verifyContracts || !config.polygonScanApiKey) return { skipped: true };

  const explorer = createExplorerClient({ chainId: config.chainId, apiKey: config.polygonScanApiKey });
  // An old GUID can remain pending even after address-level verification exists.
  // Check the address before polling a GUID or loading a local compiler artifact.
  if (hasVerifiedSource(await explorer.source(event.contract_address))) return markVerified(job, event, true);

  let guid = event.verification_guid;
  if (!guid) {
    const version = await deployedBallotVersion(event.contract_address);
    const verification = version === 4 ? await loadVerificationInput() : await loadLegacyVerificationInput(version);
    const args = constructorArguments(event);
    const constructorArgumentsHex = AbiCoder.defaultAbiCoder()
      .encode(version === 2 ? CONSTRUCTOR_TYPES.slice(0, 9) : CONSTRUCTOR_TYPES, version === 2 ? args.slice(0, 9) : args).slice(2);
    await updateJob(job.id, 15, 'Submitting source code to PolygonScan');
    const submitted = await explorer.submit({
      contractaddress: event.contract_address,
      sourceCode: JSON.stringify(verification.input),
      contractname: verification.contractName,
      compilerversion: verification.compilerVersion,
      codeformat: 'solidity-standard-json-input',
      constructorArguments: constructorArgumentsHex,
      licenseType: '3',
    });
    const result = verificationResult(submitted);
    if (result.state === 'VERIFIED') return markVerified(job, event, true);
    if (String(submitted.status) !== '1' || typeof submitted.result !== 'string' || !submitted.result.trim()) {
      if (['RETRY', 'PENDING'].includes(result.state)) return deferVerification(job, result.message);
      throw permanentError(result.message);
    }
    guid = submitted.result.trim();
    await query("UPDATE events SET verification_status='PENDING',verification_guid=$2,verification_error=NULL WHERE id=$1", [event.id, guid]);
    return deferVerification(job, 'Source submitted; explorer verification continues in the background');
  }

  const result = verificationResult(await explorer.status(guid));
  if (result.state === 'VERIFIED') return markVerified(job, event);
  if (['PENDING', 'RETRY'].includes(result.state)) {
    // Close the window in which the address becomes verified during this poll.
    if (hasVerifiedSource(await explorer.source(event.contract_address))) return markVerified(job, event, true);
    await query("UPDATE events SET verification_status='PENDING',verification_error=NULL WHERE id=$1", [event.id]);
    return deferVerification(job, 'Event ready; explorer source verification is pending');
  }
  if (hasVerifiedSource(await explorer.source(event.contract_address))) return markVerified(job, event, true);
  if (result.state === 'EXPIRED' && (Number(job.result?.guidResets) || 0) < 2) {
    await query("UPDATE events SET verification_guid=NULL,verification_error=NULL WHERE id=$1", [event.id]);
    return deferVerification(job, 'Explorer request expired; source verification will be resubmitted', {
      guidResets: (Number(job.result?.guidResets) || 0) + 1,
    });
  }
  throw permanentError(result.message);
}
