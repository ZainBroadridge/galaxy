import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { INVESTOR_DISCLAIMER_VERSION, investorSignInMessage } from '../../../packages/shared/src/investor-disclaimer.js';

// Unit-test the real service functions with explicit database and signature
// boundaries. ECDSA itself is tested separately in the shared ethers suite.
const source = (await readFile(new URL('../src/auth.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
const origin = 'https://galaxy-api-ten.vercel.app';
const wallet = '0x' + 'a'.repeat(40);
const otherWallet = '0x' + 'b'.repeat(40);
const signature = '0x' + 'a'.repeat(130);
class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
function fixture() {
  const state = { challenges: [], sessions: [], issuers: [], calls: [], recoveredSigner: wallet };
  const normalizeAddress = (value) => {
    if (!/^0x[0-9a-f]{40}$/i.test(value ?? '')) throw new HttpError(400, 'Invalid address.', 'INVALID_ADDRESS');
    return value.toLowerCase();
  };
  async function query(sql, args = []) {
    state.calls.push({ sql, args });
    const result = (rows = []) => ({ rows, rowCount: rows.length });
    if (sql.startsWith('SELECT pg_advisory')) return result();
    if (sql.startsWith('UPDATE auth_nonces') && sql.includes('wallet_address')) {
      state.challenges.filter((x) => x.wallet_address === args[0]).forEach((x) => { x.used_at = new Date(); }); return result();
    }
    if (sql.startsWith('INSERT INTO auth_nonces')) {
      const [wallet_address, message, expires_at, nonceOrigin, disclaimer_version] = args;
      const row = { id: randomUUID(), wallet_address, message, expires_at, origin: nonceOrigin, disclaimer_version };
      state.challenges.push(row); return result([{ id: row.id }]);
    }
    if (sql.startsWith('SELECT * FROM auth_nonces')) return result(state.challenges.filter((x) => (
      x.id === args[0] && x.wallet_address === args[1] && x.origin === args[2] && x.disclaimer_version === args[3]
      && !x.used_at && new Date(x.expires_at).getTime() > Date.now()
    )));
    if (sql.startsWith('UPDATE auth_nonces')) { state.challenges.find((x) => x.id === args[0]).used_at = new Date(); return result(); }
    if (sql.startsWith('INSERT INTO sessions')) { state.sessions.push({ token_hash: args[0], wallet_address: args[1], expires_at: args[2], origin: args[3], disclaimer_version: args[4] }); return result(); }
    if (sql.startsWith('SELECT wallet_address,expires_at FROM sessions')) return result(state.sessions.filter((x) => (
      x.token_hash === args[0] && x.origin === args[1] && x.disclaimer_version === args[2] && !x.revoked_at && x.expires_at > new Date()
    )));
    if (sql.startsWith('UPDATE sessions')) { state.sessions.filter((x) => x.token_hash === args[0]).forEach((x) => { x.revoked_at = new Date(); }); return result(); }
    if (sql.startsWith('INSERT INTO issuer_sessions')) { state.issuers.push({ token_hash: args[0], origin: args[1], expires_at: args[2] }); return result(); }
    if (sql.startsWith('SELECT expires_at,origin')) return result(state.issuers.filter((x) => x.token_hash === args[0] && !x.revoked_at && x.expires_at > new Date()));
    if (sql.startsWith('UPDATE issuer_sessions')) { state.issuers.filter((x) => x.token_hash === args[0]).forEach((x) => { x.revoked_at = new Date(); }); return result(); }
    throw new Error('Unexpected database boundary: ' + sql);
  }
  const context = vm.createContext({ ...crypto, Buffer, Date, URL, Number, String, Array, Error,
    INVESTOR_DISCLAIMER_VERSION, investorSignInMessage, HttpError, normalizeAddress,
    config: { webAppUrl: origin, corsOrigins: [origin, 'https://preview.example'], chainId: 80002, nonceTtlMinutes: 10, sessionTtlHours: 24 },
    query, transaction: async (fn) => fn({ query }),
    verifyMessage: () => state.recoveredSigner,
    bearerToken: (request) => request.get('authorization')?.replace(/^Bearer /, '') || null,
  });
  const service = vm.runInContext(source + '\n({createNonce,verifyNonce,optionalAuth,requireAuth,authenticatedWallet,revokeSession,createIssuerSession,requireIssuer,revokeIssuerSession})', context);
  const request = (headers = {}) => ({ get: (name) => headers[name] });
  const middleware = (fn, req) => new Promise((resolve, reject) => fn(req, {}, (error) => error ? reject(error) : resolve(req)));
  return { state, service, request, middleware };
}

test('login consumes one nonce and stores only an origin-bound hashed session token', async () => {
  const f = fixture();
  const challenge = await f.service.createNonce(wallet, origin);
  const session = await f.service.verifyNonce(wallet, signature, challenge.id, origin);
  assert.equal(f.state.challenges[0].used_at instanceof Date, true);
  assert.equal(f.state.sessions[0].token_hash, crypto.createHash('sha256').update(session.token).digest('hex'));
  assert.equal(f.state.sessions[0].origin, origin);
  assert.equal(f.state.sessions[0].disclaimer_version, INVESTOR_DISCLAIMER_VERSION);
  assert.ok(!JSON.stringify(f.state.sessions).includes(session.token));
  await assert.rejects(f.service.verifyNonce(wallet, signature, challenge.id, origin), { code: 'AUTH_EXPIRED' });
  const req = f.request({ origin, authorization: 'Bearer ' + session.token });
  await f.middleware(f.service.optionalAuth, req);
  assert.equal(req.auth.wallet_address, wallet);
  assert.equal(f.service.authenticatedWallet(req, wallet), wallet);
  assert.throws(() => f.service.authenticatedWallet(req, otherWallet), { code: 'WALLET_MISMATCH' });
});

test('wrong wallet, signer, origin, expiry and old disclaimer challenges do not log in', async () => {
  const f = fixture(); const c = await f.service.createNonce(wallet, origin);
  await assert.rejects(f.service.verifyNonce(otherWallet, signature, c.id, origin), { code: 'AUTH_EXPIRED' });
  await assert.rejects(f.service.verifyNonce(wallet, signature, c.id, 'https://preview.example'), { code: 'AUTH_EXPIRED' });
  await assert.rejects(f.service.verifyNonce(wallet, signature, c.id, 'https://evil.example'), { code: 'CORS_DENIED' });
  f.state.recoveredSigner = otherWallet;
  await assert.rejects(f.service.verifyNonce(wallet, signature, c.id, origin), { code: 'INVALID_SIGNATURE' });
  assert.equal(f.state.sessions.length, 0);
  f.state.recoveredSigner = wallet;
  f.state.challenges[0].expires_at = new Date(Date.now() - 1);
  await assert.rejects(f.service.verifyNonce(wallet, signature, c.id, origin), { code: 'AUTH_EXPIRED' });
  const next = await f.service.createNonce(wallet, origin);
  f.state.challenges[1].disclaimer_version = 'old-disclaimer';
  await assert.rejects(f.service.verifyNonce(wallet, signature, next.id, origin), { code: 'AUTH_EXPIRED' });
});

test('a new login challenge invalidates older unused challenges for the same wallet', async () => {
  const f = fixture(); const first = await f.service.createNonce(wallet, origin);
  const second = await f.service.createNonce(wallet, origin);
  assert.notEqual(first.nonce, second.nonce);
  await assert.rejects(f.service.verifyNonce(wallet, signature, first.id, origin), { code: 'AUTH_EXPIRED' });
  assert.ok((await f.service.verifyNonce(wallet, signature, second.id, origin)).token);
});

test('issuer demo password creates a distinct expiring session and never grants investor authentication', async () => {
  const f = fixture();
  await assert.rejects(f.service.createIssuerSession('wrong', origin), { code: 'ISSUER_PASSWORD_INVALID' });
  assert.equal(f.state.issuers.length, 0);
  const session = await f.service.createIssuerSession('broadridge', origin);
  const req = f.request({ origin, 'x-issuer-session': session.token });
  await f.middleware(f.service.requireIssuer, req);
  assert.equal(req.auth, undefined);
  await assert.rejects(f.middleware(f.service.requireAuth, req), { code: 'AUTH_REQUIRED' });
  await assert.rejects(f.middleware(f.service.requireIssuer, f.request({ origin: 'https://preview.example', 'x-issuer-session': session.token })), { code: 'ISSUER_AUTH_REQUIRED' });
  await f.service.revokeIssuerSession(req);
  await assert.rejects(f.middleware(f.service.requireIssuer, req), { code: 'ISSUER_AUTH_REQUIRED' });
});

test('logout revokes the bearer token without changing any voting or push subscription record', async () => {
  const f = fixture(); const challenge = await f.service.createNonce(wallet, origin);
  const session = await f.service.verifyNonce(wallet, signature, challenge.id, origin);
  const req = f.request({ origin, authorization: 'Bearer ' + session.token });
  await f.service.revokeSession(req);
  await f.middleware(f.service.optionalAuth, req);
  assert.equal(req.auth, undefined);
  assert.equal(f.state.calls.some(({ sql }) => /UPDATE votes|DELETE FROM|push_subscription/i.test(sql)), false);
});
