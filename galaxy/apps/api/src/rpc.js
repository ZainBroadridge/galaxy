import { Interface, JsonRpcProvider, Wallet, toQuantity } from 'ethers';
import { STANDARD_ERC20_ABI } from '@pv/shared';
import { config } from './config.js';
import { errorText } from './errors.js';

export const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
export const relayer = new Wallet(config.relayerPrivateKey, provider);
export const erc20Interface = new Interface(STANDARD_ERC20_ABI);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryable(status, payload) {
  const code = payload?.error?.code;
  const text = String(payload?.error?.message ?? '').toLowerCase();
  return status === 429
    || status >= 500
    || code === 429
    || code === -32001
    || code === -32005
    || text.includes('rate limit')
    || text.includes('too many requests')
    || text.includes('timeout')
    || text.includes('unable to complete request');
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response?.headers?.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1000;
  return Math.min(8_000, 500 * 2 ** attempt) + Math.random() * 250;
}

function rpcError(method, status, payload) {
  const message = payload?.error?.message || `RPC HTTP ${status}`;
  const error = new Error(`${method} failed: ${message}`);
  error.rpcMethod = method;
  error.rpcCode = payload?.error?.code;
  error.httpStatus = status;
  return error;
}

export async function rpc(method, params, { retries = config.alchemyMaxRetries } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(config.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const text = await response.text();
      let payload;
      try { payload = JSON.parse(text); } catch { payload = { error: { message: text } }; }
      if (response.ok && !payload.error) return payload.result;

      const error = rpcError(method, response.status, payload);
      lastError = error;
      if (!retryable(response.status, payload) || attempt === retries) throw error;
      await wait(retryDelay(response, attempt));
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
      if (error.httpStatus && !retryable(error.httpStatus, { error: { code: error.rpcCode, message: error.message } })) {
        throw error;
      }
      await wait(Math.min(8_000, 500 * 2 ** attempt) + Math.random() * 250);
    }
  }
  throw new Error(errorText(lastError));
}

export async function rpcBlock(blockNumber) {
  const block = await rpc('eth_getBlockByNumber', [toQuantity(blockNumber), false]);
  if (!block) throw new Error(`RPC did not return block ${blockNumber}.`);
  return { number: Number(BigInt(block.number)), timestamp: Number(BigInt(block.timestamp)), hash: block.hash };
}
