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
    if (!value?.token || !value?.walletAddress || Date.parse(value.expiresAt) <= Date.now()) {
      throw new Error();
    }
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

async function request(path, options = {}, responseType = 'json', retry = true) {
  const { auth = true, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});
  const session = auth ? readSession() : null;
  if (session?.token) headers.set('authorization', `Bearer ${session.token}`);

  let body = fetchOptions.body;
  const rawBody = body instanceof Blob || body instanceof FormData || body instanceof ArrayBuffer;
  if (body !== undefined && !rawBody && typeof body !== 'string') {
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
  if (response.status === 429 && retry && (!fetchOptions.method || fetchOptions.method === 'GET')) {
    const seconds = Number(response.headers.get('retry-after'));
    await sleep(Number.isFinite(seconds) ? Math.min(5000, seconds * 1000) : 1000);
    return request(path, options, responseType, false);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(response.status, payload);
  }
  if (responseType === 'blob') return response.blob();
  return response.json().catch(() => ({}));
}

export function api(path, options = {}) {
  return request(path, options, 'json');
}

export function apiBlob(path, options = {}) {
  return request(path, options, 'blob');
}

export function uploadEventPdf(eventId, file) {
  return api(`/v1/events/${eventId}/documents`, {
    method: 'POST',
    headers: {
      'content-type': 'application/pdf',
      'x-file-name': encodeURIComponent(file.name),
    },
    body: file,
  });
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { baseUrl as API_BASE_URL };
