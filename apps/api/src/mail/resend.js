const endpoint = 'https://api.resend.com/emails';
const timeoutMs = 15_000;
const maxRequestBytes = 8 * 1024 * 1024;

function deliveryError(message, permanent = false, status = null) {
  const error = new Error(message);
  error.permanent = permanent;
  if (status !== null) error.httpStatus = status;
  return error;
}

export function assertEmailPayload(payload) {
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > maxRequestBytes) {
    throw deliveryError('Receipt email exceeds the configured 8 MiB request limit.', true);
  }
}

/** HTTPS transport; the caller owns retries and persists both payload and idempotency key. */
export async function sendEmail(payload, { apiKey, idempotencyKey }) {
  assertEmailPayload(payload);
  let response;
  let result;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json',
        'idempotency-key': idempotencyKey },
      body: JSON.stringify(payload),
    });
    result = await response.json().catch(() => null);
  } catch {
    // Do not propagate provider URLs, headers, credentials, or message content into application logs.
    throw deliveryError('Receipt email transport failed or timed out; delivery status is unknown.');
  }
  if (response.ok) {
    if (typeof result?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(result.id)) {
      throw deliveryError('Email provider returned no valid message identifier; delivery status is unknown.');
    }
    return { id: result.id };
  }
  const name = typeof result?.name === 'string' && /^[a-z_]{1,80}$/u.test(result.name) ? result.name : 'request_failed';
  const quota = ['daily_quota_exceeded', 'monthly_quota_exceeded'].includes(name);
  const transient = response.status >= 500 || response.status === 408
    || (response.status === 429 && !quota)
    || (response.status === 409 && name === 'concurrent_idempotent_requests');
  const error = deliveryError(`Email provider HTTP ${response.status} (${name}). Check the mail provider dashboard.`, !transient, response.status);
  if (response.status === 429 && !quota) {
    const header = response.headers.get('retry-after');
    const seconds = Number(header);
    const date = Date.parse(header ?? '');
    error.retryAfterMs = Number.isFinite(seconds) && header !== null
      ? Math.max(1_000, Math.min(3_600_000, seconds * 1_000))
      : Number.isFinite(date) ? Math.max(1_000, Math.min(3_600_000, date - Date.now())) : 30_000;
  }
  throw error;
}
