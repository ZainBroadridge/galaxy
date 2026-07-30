const baseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const sessionKey = 'pv-v2-session';

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message || `API request failed (${status}).`);
    this.status = status;
    this.code = payload?.error?.code || 'API_ERROR';
    this.details = payload?.error?.details;
  }
}

export function readSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(sessionKey));
    if (!value?.token || !value?.walletAddress || Date.parse(value.expiresAt) <= Date.now()) throw new Error();
    return value;
  } catch {
    sessionStorage.removeItem(sessionKey);
    return null;
  }
}

export function saveSession(value) {
  if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
  else sessionStorage.removeItem(sessionKey);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function api(path, options = {}, retry = true) {
  const { auth = true, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});
  const session = auth ? readSession() : null;
  if (session?.token) headers.set('authorization', `Bearer ${session.token}`);
  let body = fetchOptions.body;
  if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...fetchOptions, headers, body });
  } catch (error) {
    throw new ApiError(0, {
      error: {
        code: 'NETWORK_ERROR',
        message: `Could not reach the Render API at ${baseUrl}. Check that it is awake and that CORS_ORIGINS includes this dApp origin.`,
        details: error?.message,
      },
    });
  }

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (response.status === 429 && retry && (!fetchOptions.method || fetchOptions.method === 'GET')) {
    const seconds = Number(response.headers.get('retry-after'));
    await sleep(Number.isFinite(seconds) ? Math.min(5000, seconds * 1000) : 1000);
    return api(path, options, false);
  }
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload;
}

export { baseUrl as API_BASE_URL };
