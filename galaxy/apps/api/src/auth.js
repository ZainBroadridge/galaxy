import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { verifyMessage } from 'ethers';
import { INVESTOR_DISCLAIMER_VERSION, investorSignInMessage } from '@pv/shared';
import { config } from './config.js';
import { query, transaction } from './db.js';
import { bearerToken, HttpError, normalizeAddress } from './errors.js';

const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const DEMO_ISSUER_PASSWORD = 'broadridge';

function approvedOrigin(input) {
  const origin = input || config.webAppUrl;
  if (!config.corsOrigins.includes(origin)) throw new HttpError(403, 'Origin is not allowed.', 'CORS_DENIED');
  return origin;
}

export async function createNonce(input, originInput) {
  const walletAddress = normalizeAddress(input, 'walletAddress');
  const origin = approvedOrigin(originInput);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + config.nonceTtlMinutes * 60_000);
  const nonce = randomBytes(24).toString('hex');
  const message = investorSignInMessage({ origin, walletAddress, chainId: config.chainId, nonce, issuedAt, expiresAt });
  const id = await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`investor-login:${walletAddress}`]);
    await client.query('UPDATE auth_nonces SET used_at=now() WHERE wallet_address=$1 AND used_at IS NULL', [walletAddress]);
    const result = await client.query(
      'INSERT INTO auth_nonces(wallet_address,message,expires_at,origin,disclaimer_version) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [walletAddress, message, expiresAt, origin, INVESTOR_DISCLAIMER_VERSION],
    );
    return result.rows[0].id;
  });
  return { id, walletAddress, origin, chainId: config.chainId, nonce, message, issuedAt, expiresAt, disclaimerVersion: INVESTOR_DISCLAIMER_VERSION };
}

export async function verifyNonce(walletInput, signature, challengeId, originInput) {
  const walletAddress = normalizeAddress(walletInput, 'walletAddress');
  const origin = approvedOrigin(originInput);
  if (typeof challengeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(challengeId)
    || typeof signature !== 'string' || !/^0x[0-9a-f]{130}$/i.test(signature)) {
    throw new HttpError(400, 'A valid challenge ID and wallet signature are required.', 'INVALID_AUTH_REQUEST');
  }
  return transaction(async (client) => {
    const found = await client.query(
      `SELECT * FROM auth_nonces WHERE id=$1 AND wallet_address=$2 AND origin=$3
       AND disclaimer_version=$4 AND used_at IS NULL AND expires_at>now() FOR UPDATE`,
      [challengeId, walletAddress, origin, INVESTOR_DISCLAIMER_VERSION],
    );
    if (!found.rowCount) throw new HttpError(401, 'Authentication challenge expired or was already used.', 'AUTH_EXPIRED');
    let signer;
    try { signer = normalizeAddress(verifyMessage(found.rows[0].message, signature)); } catch { signer = null; }
    if (signer !== walletAddress) throw new HttpError(401, 'Authentication signature is invalid.', 'INVALID_SIGNATURE');
    await client.query('UPDATE auth_nonces SET used_at=now() WHERE id=$1', [found.rows[0].id]);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3_600_000);
    await client.query('INSERT INTO sessions(token_hash,wallet_address,expires_at,origin,disclaimer_version) VALUES ($1,$2,$3,$4,$5)', [hash(token), walletAddress, expiresAt, origin, INVESTOR_DISCLAIMER_VERSION]);
    return { token, walletAddress, expiresAt, disclaimerVersion: INVESTOR_DISCLAIMER_VERSION };
  });
}

export async function optionalAuth(request, _response, next) {
  try {
    const token = bearerToken(request);
    if (!token) return next();
    const found = await query(
      'SELECT wallet_address,expires_at FROM sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() AND origin=$2 AND disclaimer_version=$3',
      [hash(token), approvedOrigin(request.get('origin')), INVESTOR_DISCLAIMER_VERSION],
    );
    if (found.rowCount) request.auth = found.rows[0];
    return next();
  } catch (error) { return next(error); }
}

export function requireAuth(request, _response, next) {
  return request.auth ? next() : next(new HttpError(401, 'Sign in with your wallet to continue.', 'AUTH_REQUIRED'));
}

/** Never authorize a voter based on a query/body address alone. */
export function authenticatedWallet(request, supplied) {
  if (!request.auth) throw new HttpError(401, 'Sign in with your wallet to continue.', 'AUTH_REQUIRED');
  const wallet = request.auth.wallet_address;
  if (supplied && normalizeAddress(supplied) !== wallet) {
    throw new HttpError(403, 'The wallet does not match the authenticated investor.', 'WALLET_MISMATCH');
  }
  return wallet;
}

export async function revokeSession(request) {
  const token = bearerToken(request);
  if (token) await query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1', [hash(token)]);
}

export async function createIssuerSession(password, originInput) {
  const expected = Buffer.from(hash(DEMO_ISSUER_PASSWORD), 'hex');
  const supplied = Buffer.from(hash(typeof password === 'string' ? password : ''), 'hex');
  if (!timingSafeEqual(expected, supplied)) throw new HttpError(401, 'Incorrect issuer demo password.', 'ISSUER_PASSWORD_INVALID');
  const origin = approvedOrigin(originInput);
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 4 * 3_600_000);
  await query('INSERT INTO issuer_sessions(token_hash,origin,expires_at) VALUES ($1,$2,$3)', [hash(token), origin, expiresAt]);
  return { token, expiresAt, demo: true };
}

export async function requireIssuer(request, _response, next) {
  try {
    const token = request.get('x-issuer-session');
    const found = token ? await query(
      'SELECT expires_at,origin FROM issuer_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()', [hash(token)],
    ) : { rows: [] };
    const issuer = found.rows[0];
    if (!issuer || (request.get('origin') && request.get('origin') !== issuer.origin)) {
      throw new HttpError(401, 'Enter the issuer demo password to continue.', 'ISSUER_AUTH_REQUIRED');
    }
    request.issuer = issuer;
    next();
  } catch (error) { next(error); }
}

export async function revokeIssuerSession(request) {
  const token = request.get('x-issuer-session');
  if (token) await query('UPDATE issuer_sessions SET revoked_at=now() WHERE token_hash=$1', [hash(token)]);
}

export function requirePortal(request, response, next) {
  return request.auth ? next() : requireIssuer(request, response, next);
}

export function portalWallet(request, supplied) {
  if (request.auth) return authenticatedWallet(request, supplied);
  if (!request.issuer || !supplied) throw new HttpError(400, 'Connect the issuer wallet.', 'WALLET_REQUIRED');
  return normalizeAddress(supplied);
}
