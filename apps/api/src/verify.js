import { AbiCoder } from 'ethers';
import { config } from './config.js';
import { query } from './db.js';
import { permanentError } from './errors.js';
import { updateJob } from './jobs.js';
import { loadVerificationInput } from './artifact.js';
import { constructorArguments } from './deploy.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const endpoint = 'https://api.etherscan.io/v2/api';

async function request(parameters, body) {
  const url = new URL(endpoint);
  Object.entries({ chainid: config.chainId, module: 'contract', apikey: config.polygonScanApiKey, ...parameters })
    .forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, body ? {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  } : undefined);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Explorer API HTTP ${response.status}`);
  return payload;
}

async function check(guid) {
  return request({ action: 'checkverifystatus', guid });
}

export async function verifyContract(job) {
  if (!config.verifyContracts || !config.polygonScanApiKey) return { skipped: true };
  const found = await query('SELECT * FROM events WHERE id=$1', [job.event_id]);
  if (!found.rowCount) throw permanentError('Event no longer exists.');
  const event = found.rows[0];
  if (!event.contract_address) throw permanentError('Contract address is missing.');
  const verification = await loadVerificationInput();
  let guid = event.verification_guid;

  if (!guid) {
    await updateJob(job.id, 15, 'Submitting source code to PolygonScan');
    const types = ['address','address','uint64','bytes32','uint64','uint64','uint256','bytes32','uint256'];
    const constructorArgumentsHex = AbiCoder.defaultAbiCoder().encode(types, constructorArguments(event)).slice(2);
    const submitted = await request({ action: 'verifysourcecode' }, {
      contractaddress: event.contract_address,
      sourceCode: JSON.stringify(verification.input),
      contractname: verification.contractName,
      compilerversion: verification.compilerVersion,
      codeformat: 'solidity-standard-json-input',
      constructorArguments: constructorArgumentsHex,
      licenseType: '3',
    });
    const result = String(submitted.result ?? '');
    if (result.toLowerCase().includes('already verified')) {
      await query("UPDATE events SET verification_status='VERIFIED',verification_error=NULL WHERE id=$1", [event.id]);
      return { verified: true, alreadyVerified: true };
    }
    if (submitted.status !== '1' || !result) throw new Error(result || submitted.message || 'Source verification submission failed.');
    guid = result;
    await query("UPDATE events SET verification_status='PENDING',verification_guid=$2,verification_error=NULL WHERE id=$1", [event.id, guid]);
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await wait(attempt === 0 ? 1000 : 2500);
    const status = await check(guid);
    const result = String(status.result ?? '');
    if (status.status === '1' || result.toLowerCase().includes('pass - verified') || result.toLowerCase().includes('already verified')) {
      await query("UPDATE events SET verification_status='VERIFIED',verification_error=NULL WHERE id=$1", [event.id]);
      return { verified: true, url: `${config.explorerUrl}/address/${event.contract_address}#code` };
    }
    if (!result.toLowerCase().includes('pending') && !result.toLowerCase().includes('queue')) {
      throw permanentError(result || status.message || 'Source verification failed.');
    }
    await updateJob(job.id, Math.min(90, 30 + attempt * 8), 'Waiting for PolygonScan verification');
  }
  throw new Error('PolygonScan verification is still pending.');
}
