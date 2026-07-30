import { config as loadEnvironment } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

loadEnvironment();
loadEnvironment({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

function integer(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function bool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: integer('PORT', 3001, { min: 1, max: 65535 }),
  chainId: integer('CHAIN_ID', 80002),
  databaseUrl: process.env.DATABASE_URL,
  rpcUrl: process.env.RPC_HTTP_URL,
  relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY,
  explorerUrl: (process.env.BLOCK_EXPLORER_URL ?? 'https://amoy.polygonscan.com').replace(/\/$/, ''),
  polygonScanApiKey: process.env.ETHERSCAN_API_KEY ?? process.env.POLYGONSCAN_API_KEY ?? '',
  verifyContracts: bool('VERIFY_CONTRACTS', true),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',').map((value) => value.trim()).filter(Boolean),
  sessionTtlHours: integer('SESSION_TTL_HOURS', 24, { min: 1, max: 168 }),
  nonceTtlMinutes: integer('AUTH_NONCE_TTL_MINUTES', 10, { min: 1, max: 60 }),
  maxEventsPerWalletPerDay: integer('MAX_EVENTS_PER_WALLET_PER_DAY', 5, { min: 1, max: 100 }),
  confirmations: integer('CONFIRMATION_BLOCKS', 8, { min: 1, max: 128 }),
  jobLockMinutes: integer('JOB_LOCK_MINUTES', 8, { min: 1, max: 60 }),
  jobIdleDelayMs: integer('JOB_IDLE_DELAY_MS', 1500, { min: 250, max: 30_000 }),
  transactionWaitTimeoutMs: integer('TRANSACTION_WAIT_TIMEOUT_MS', 180_000, { min: 30_000, max: 600_000 }),
  alchemyPageSize: integer('ALCHEMY_PAGE_SIZE', 1000, { min: 1, max: 1000 }),
  alchemyMaxPages: integer('ALCHEMY_MAX_PAGES', 100, { min: 1, max: 1000 }),
  alchemyMaxRetries: integer('ALCHEMY_MAX_RETRIES', 6, { min: 0, max: 10 }),
  workerId: `api-worker-${randomUUID()}`,
});

export function assertConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.rpcUrl) missing.push('RPC_HTTP_URL');
  if (!config.relayerPrivateKey) missing.push('RELAYER_PRIVATE_KEY');
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  if (config.chainId !== 80002) throw new Error('This release is locked to Polygon Amoy (chain ID 80002).');
  if (!/^https:\/\//i.test(config.rpcUrl)) throw new Error('RPC_HTTP_URL must be an HTTPS endpoint.');
}
