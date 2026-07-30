import { createHash, randomBytes } from 'node:crypto';
import { verifyMessage } from 'ethers';
import { config } from './config.js';
import { query, transaction } from './db.js';
import { bearerToken, HttpError, normalizeAddress } from './errors.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');

export async function createNonce(input) {
  const walletAddress = normalizeAddress(input, 'walletAddress');
  const expiresAt = new Date(Date.now() + config.nonceTtlMinutes * 60_000);
  const nonce = randomBytes(24).toString('hex');
  const message = [
    'Mini Galaxy Proxy Voting V2', '',
    'Authenticate this wallet. This signature does not spend POL.', '',
    `Wallet: ${walletAddress}`,
    `Chain ID: ${config.chainId}`,
    `Nonce: ${nonce}`,
    `Expires At: ${expiresAt.toISOString()}`,
  ].join('\n');
  await transaction(async (client) => {
    await client.query('UPDATE auth_nonces SET used_at = now() WHERE wallet_address = $1 AND used_at IS NULL', [walletAddress]);
    await client.query('INSERT INTO auth_nonces(wallet_address, message, expires_at) VALUES ($1,$2,$3)', [walletAddress, message, expiresAt]);
  });
  return { walletAddress, message, expiresAt };
}

export async function verifyNonce(walletInput, signature) {
  const walletAddress = normalizeAddress(walletInput, 'walletAddress');
  return transaction(async (client) => {
    const found = await client.query(
      `SELECT * FROM auth_nonces WHERE wallet_address = $1 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC FOR UPDATE LIMIT 1`, [walletAddress],
    );
    if (!found.rowCount) throw new HttpError(401, 'Authentication challenge expired.', 'AUTH_EXPIRED');
    let signer;
    try { signer = normalizeAddress(verifyMessage(found.rows[0].message, signature)); } catch { signer = null; }
    if (signer !== walletAddress) throw new HttpError(401, 'Authentication signature is invalid.', 'INVALID_SIGNATURE');
    await client.query('UPDATE auth_nonces SET used_at = now() WHERE id = $1', [found.rows[0].id]);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3_600_000);
    await client.query('INSERT INTO sessions(token_hash, wallet_address, expires_at) VALUES ($1,$2,$3)', [hash(token), walletAddress, expiresAt]);
    return { token, walletAddress, expiresAt };
  });
}

export async function optionalAuth(request, _response, next) {
  try {
    const token = bearerToken(request);
    if (!token) return next();
    const found = await query(
      'SELECT wallet_address, expires_at FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()',
      [hash(token)],
    );
    if (found.rowCount) request.auth = found.rows[0];
    return next();
  } catch (error) { return next(error); }
}

export function requireAuth(request, _response, next) {
  return request.auth ? next() : next(new HttpError(401, 'Connect and authenticate your wallet.', 'AUTH_REQUIRED'));
}

export async function revokeSession(request) {
  const token = bearerToken(request);
  if (token) await query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [hash(token)]);
}
