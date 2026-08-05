import { Contract, getCreateAddress, toQuantity } from 'ethers';
import { STANDARD_ERC20_ABI, ZERO_ADDRESS } from '@pv/shared';
import { config } from './config.js';
import { HttpError, normalizeAddress } from './errors.js';
import { provider } from './rpc.js';

const CACHE_TTL_MS = 60_000;
const cache = new Map();

async function optional(contract, method, fallback) {
  try { return await contract[method](); } catch { return fallback; }
}

async function creatorFromExplorer(tokenAddress) {
  if (!config.polygonScanApiKey) return null;

  const query = new URLSearchParams({
    chainid: String(config.chainId),
    module: 'contract',
    action: 'getcontractcreation',
    contractaddresses: tokenAddress,
    apikey: config.polygonScanApiKey,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(`https://api.etherscan.io/v2/api?${query}`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload = await response.json();
    const creator = payload?.status === '1' ? payload.result?.[0]?.contractCreator : null;
    return creator ? normalizeAddress(creator) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function creatorFromRpc(tokenAddress) {
  let low = 0;
  let high = await provider.getBlockNumber();

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const code = await provider.getCode(tokenAddress, middle);
    if (code === '0x') low = middle + 1;
    else high = middle;
  }

  const block = await provider.send('eth_getBlockByNumber', [toQuantity(low), true]);
  const transaction = block?.transactions?.find((candidate) => {
    if (candidate.to !== null) return false;
    try {
      return normalizeAddress(getCreateAddress({
        from: candidate.from,
        nonce: candidate.nonce,
      })) === tokenAddress;
    } catch {
      return false;
    }
  });
  return transaction?.from ? normalizeAddress(transaction.from) : null;
}

async function deploymentCreator(tokenAddress) {
  return await creatorFromExplorer(tokenAddress)
    ?? await creatorFromRpc(tokenAddress).catch(() => null);
}

export async function inspectToken(input) {
  const tokenAddress = normalizeAddress(input, 'tokenAddress');
  const cached = cache.get(tokenAddress);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  if (await provider.getCode(tokenAddress) === '0x') {
    throw new HttpError(400, 'No contract exists at this address on Polygon Amoy.', 'TOKEN_NOT_FOUND');
  }

  const token = new Contract(tokenAddress, STANDARD_ERC20_ABI, provider);
  let decimals;
  let totalSupply;
  try {
    [decimals, totalSupply] = await Promise.all([
      token.decimals(),
      token.totalSupply(),
      token.balanceOf(ZERO_ADDRESS),
    ]);
  } catch {
    throw new HttpError(400, 'This contract does not expose the standard ERC-20 interface.', 'UNSUPPORTED_TOKEN');
  }

  const decimalCount = Number(decimals);
  if (!Number.isInteger(decimalCount) || decimalCount < 0 || decimalCount > 36) {
    throw new HttpError(400, 'Unsupported ERC-20 decimals value.', 'UNSUPPORTED_TOKEN');
  }

  const ownership = new Contract(
    tokenAddress,
    ['function owner() view returns (address)'],
    provider,
  );
  const ownerValue = await optional(ownership, 'owner', null);
  const declaredOwner = ownerValue ? normalizeAddress(ownerValue) : null;
  const hasDeclaredOwner = declaredOwner && declaredOwner !== ZERO_ADDRESS;
  const owner = hasDeclaredOwner ? declaredOwner : await deploymentCreator(tokenAddress);

  const value = {
    tokenAddress,
    name: String(await optional(token, 'name', 'ERC-20 Token')).slice(0, 120),
    symbol: String(await optional(token, 'symbol', 'TOKEN')).slice(0, 40),
    decimals: decimalCount,
    totalSupply: totalSupply.toString(),
    owner,
    authoritySource: hasDeclaredOwner ? 'OWNER' : owner ? 'DEPLOYER' : null,
  };

  cache.set(tokenAddress, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
