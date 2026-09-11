const enabledValues = new Set(['1', 'true', 'yes', 'on']);

export function receiptEmailEnabled(environment = process.env) {
  return enabledValues.has(String(environment.VOTE_RECEIPT_EMAIL_ENABLED ?? '').trim().toLowerCase());
}

export function mailConfiguration(environment = process.env) {
  const apiKey = String(environment.RESEND_API_KEY ?? '').trim();
  const from = String(environment.VOTE_RECEIPT_EMAIL_FROM ?? '').trim();
  if (!apiKey || /[\r\n]/u.test(apiKey)) throw new Error('Set RESEND_API_KEY on the backend.');
  if (!from || from.length > 320 || /[\r\n]/u.test(from)) {
    throw new Error('Set VOTE_RECEIPT_EMAIL_FROM to an approved sender address.');
  }
  return { apiKey, from };
}
