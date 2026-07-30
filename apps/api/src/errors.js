import { getAddress } from 'ethers';

export class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED', details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function normalizeAddress(value, field = 'address') {
  try {
    return getAddress(String(value)).toLowerCase();
  } catch {
    throw new HttpError(400, `${field} must be a valid EVM address.`, 'INVALID_ADDRESS');
  }
}

export function permanentError(message) {
  const error = new Error(message);
  error.permanent = true;
  return error;
}

export function errorText(error) {
  return String(
    error?.info?.error?.message
      ?? error?.error?.message
      ?? error?.shortMessage
      ?? error?.reason
      ?? error?.message
      ?? error,
  );
}

export function bearerToken(request) {
  const header = request.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}
