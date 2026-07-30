import { Contract } from 'ethers';
import { STANDARD_ERC20_ABI, ZERO_ADDRESS } from '@pv/shared';
import { HttpError, normalizeAddress } from './errors.js';
import { provider } from './rpc.js';

async function optional(contract, method, fallback) {
  try { return await contract[method](); } catch { return fallback; }
}

export async function inspectToken(input) {
  const tokenAddress = normalizeAddress(input, 'tokenAddress');
  if (await provider.getCode(tokenAddress) === '0x') {
    throw new HttpError(400, 'No contract exists at this address on Polygon Amoy.', 'TOKEN_NOT_FOUND');
  }
  const token = new Contract(tokenAddress, STANDARD_ERC20_ABI, provider);
  let decimals; let totalSupply;
  try {
    [decimals, totalSupply] = await Promise.all([token.decimals(), token.totalSupply(), token.balanceOf(ZERO_ADDRESS)]);
  } catch {
    throw new HttpError(400, 'This contract does not expose the standard ERC-20 interface.', 'UNSUPPORTED_TOKEN');
  }
  const decimalCount = Number(decimals);
  if (!Number.isInteger(decimalCount) || decimalCount < 0 || decimalCount > 36) {
    throw new HttpError(400, 'Unsupported ERC-20 decimals value.', 'UNSUPPORTED_TOKEN');
  }
  let owner = null;
  try { owner = normalizeAddress(await new Contract(tokenAddress, ['function owner() view returns (address)'], provider).owner()); } catch {}
  return {
    tokenAddress,
    name: String(await optional(token, 'name', 'ERC-20 Token')).slice(0, 120),
    symbol: String(await optional(token, 'symbol', 'TOKEN')).slice(0, 40),
    decimals: decimalCount,
    totalSupply: totalSupply.toString(),
    owner,
  };
}
