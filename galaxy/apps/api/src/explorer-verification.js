const EXPLORER_API = 'https://api.etherscan.io/v2/api';

/** A request receipt is not the verification state of the deployed address. */
export function verificationResult(payload) {
  const message = String(payload?.result ?? payload?.message ?? '').trim();
  if (/^(?:pass\s*-\s*verified|already verified|contract source code already verified)\b/iu.test(message)) {
    return { state: 'VERIFIED', message };
  }
  if (/pending|queue|in progress/iu.test(message)) return { state: 'PENDING', message };
  if (/guid|uid/iu.test(message) && /invalid|not found|expired|unable to locate/iu.test(message)) {
    return { state: 'EXPIRED', message };
  }
  if (/rate limit|too many requests|temporar|busy|timeout|try again|unavailable/iu.test(message)) {
    return { state: 'RETRY', message };
  }
  if (String(payload?.status) === '1' && /^verified(?: successfully)?[.!]?$/iu.test(message)) {
    return { state: 'VERIFIED', message };
  }
  return { state: 'REJECTED', message: message || 'The explorer returned an unrecognized verification response.' };
}

export function hasVerifiedSource(payload) {
  if (String(payload?.status) !== '1' || !Array.isArray(payload?.result)) return false;
  const contract = payload.result[0];
  if (typeof contract?.SourceCode !== 'string' || !contract.SourceCode.trim()) return false;
  try {
    return Array.isArray(JSON.parse(contract.ABI));
  } catch {
    return false;
  }
}

/** All calls are bounded; an unavailable explorer must not occupy the runner indefinitely. */
export function createExplorerClient({ chainId, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 12_000 }) {
  async function request(action, parameters = {}, body) {
    const url = new URL(EXPLORER_API);
    Object.entries({ chainid: chainId, module: 'contract', apikey: apiKey, action, ...parameters })
      .forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      ...(body ? {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
      } : {}),
    });
    if (!response.ok) {
      const error = new Error(`Explorer API HTTP ${response.status}`);
      error.httpStatus = response.status;
      throw error;
    }
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('Explorer API returned invalid JSON.'); }
    if (!payload || typeof payload !== 'object' || !('status' in payload)) {
      throw new Error('Explorer API returned an invalid response.');
    }
    return payload;
  }
  return {
    source: (address) => request('getsourcecode', { address }),
    status: (guid) => request('checkverifystatus', { guid }),
    submit: (body) => request('verifysourcecode', {}, body),
  };
}
