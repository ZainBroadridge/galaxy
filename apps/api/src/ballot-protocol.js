import { Contract } from 'ethers';
import { VOTE_EVENT_ABI } from '@pv/shared';
import { HttpError } from './errors.js';
import { provider } from './rpc.js';

/** Legacy v2 deployments have no version getter. Network errors never downgrade a ballot. */
export async function deployedBallotVersion(contractAddress) {
  try {
    const version = Number(await new Contract(contractAddress, VOTE_EVENT_ABI, provider).ballotVersion());
    if (![3, 4].includes(version)) {
      throw new HttpError(409, `Unsupported ballot version ${version}.`, 'UNSUPPORTED_BALLOT_VERSION');
    }
    return version;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (['CALL_EXCEPTION', 'BAD_DATA'].includes(error?.code)) return 2;
    throw error;
  }
}
