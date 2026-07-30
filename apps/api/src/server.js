import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { createNonce, optionalAuth, requireAuth, revokeSession, verifyNonce } from './auth.js';
import { config, assertConfig } from './config.js';
import { db, query } from './db.js';
import { HttpError } from './errors.js';
import {
  createEvent, eventResults, eventView, organiserDashboard, resultsDashboard, retryEvent, votingDashboard,
} from './events.js';
import { draftCommunication, inbox, publishCommunication, saveSubscription, subscriptions } from './communications.js';
import { inspectToken } from './tokens.js';
import { ballot, submitVote } from './votes.js';
import {
  communicationDraftInput, communicationPublishInput, eventInput, subscriptionInput, voteInput,
} from './validation.js';
import { jobRunnerStatus, startJobRunner } from './runner.js';
import { logger } from './logger.js';

assertConfig();
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new HttpError(403, 'Origin is not allowed.', 'CORS_DENIED'));
  },
}));
app.use(express.json({ limit: '256kb' }));
app.use(optionalAuth);

const limiter = (limit, keyGenerator = undefined) => rateLimit({
  windowMs: 60_000,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  ...(keyGenerator ? { keyGenerator } : {}),
  handler(_request, response, _next, options) {
    response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many write requests. Retry after a short pause.' }, retryAfterMs: options.windowMs });
  },
});
// IP protection is intentionally generous for corporate proxies; wallet-level
// limits prevent one address from hammering authentication or write routes.
const authIpLimiter = limiter(120);
const authWalletLimiter = limiter(12, (request) => String(request.body?.walletAddress ?? 'invalid-wallet').toLowerCase());
const writeLimiter = limiter(40, (request) => request.auth?.wallet_address ?? 'anonymous');
const parse = (schema, value) => schema.parse(value);

app.get('/health', async (_request, response, next) => {
  try {
    await query('SELECT 1');
    response.json({ ok: true, service: 'mini-galaxy-pv-v2', chainId: config.chainId, jobs: jobRunnerStatus(), time: new Date().toISOString() });
  } catch (error) { next(error); }
});

app.post('/v1/auth/nonce', authIpLimiter, authWalletLimiter, async (request, response, next) => {
  try { response.json(await createNonce(request.body?.walletAddress)); } catch (error) { next(error); }
});
app.post('/v1/auth/verify', authIpLimiter, authWalletLimiter, async (request, response, next) => {
  try { response.json(await verifyNonce(request.body?.walletAddress, request.body?.signature)); } catch (error) { next(error); }
});
app.post('/v1/auth/logout', writeLimiter, async (request, response, next) => {
  try { await revokeSession(request); response.status(204).end(); } catch (error) { next(error); }
});

app.post('/v1/tokens/inspect', requireAuth, writeLimiter, async (request, response, next) => {
  try { response.json(await inspectToken(request.body?.tokenAddress)); } catch (error) { next(error); }
});
app.post('/v1/events', requireAuth, writeLimiter, async (request, response, next) => {
  try { response.status(201).json(await createEvent(request.auth.wallet_address, parse(eventInput, request.body))); } catch (error) { next(error); }
});
app.get('/v1/events/:id/view', async (request, response, next) => {
  try { response.json(await eventView(request.params.id, request.query.wallet)); } catch (error) { next(error); }
});
app.post('/v1/events/:id/retry', requireAuth, writeLimiter, async (request, response, next) => {
  try { response.json(await retryEvent(request.params.id, request.auth.wallet_address)); } catch (error) { next(error); }
});
app.get('/v1/events/:id/results', async (request, response, next) => {
  try { response.json(await eventResults(request.params.id)); } catch (error) { next(error); }
});

app.get('/v1/dashboard/voting', async (request, response, next) => {
  try { response.json(await votingDashboard(request.query.wallet)); } catch (error) { next(error); }
});
app.get('/v1/dashboard/results', async (request, response, next) => {
  try { response.json(await resultsDashboard(request.query.wallet)); } catch (error) { next(error); }
});
app.get('/v1/dashboard/organiser', requireAuth, async (request, response, next) => {
  try { response.json(await organiserDashboard(request.auth.wallet_address)); } catch (error) { next(error); }
});

app.get('/v1/events/:id/ballot', requireAuth, async (request, response, next) => {
  try { response.json(await ballot(request.params.id, request.auth.wallet_address)); } catch (error) { next(error); }
});
app.post('/v1/events/:id/votes', requireAuth, writeLimiter, async (request, response, next) => {
  try {
    const input = parse(voteInput, request.body);
    response.status(202).json(await submitVote(request.params.id, request.auth.wallet_address, input.choices, input.signature));
  } catch (error) { next(error); }
});

app.get('/v1/communications/portal', requireAuth, async (request, response, next) => {
  try {
    const wallet = request.auth.wallet_address;
    const [savedSubscriptions, organisedEvents] = await Promise.all([subscriptions(wallet), organiserDashboard(wallet)]);
    response.json({ subscriptions: savedSubscriptions, organisedEvents });
  } catch (error) { next(error); }
});
app.get('/v1/communications/subscriptions', requireAuth, async (request, response, next) => {
  try { response.json(await subscriptions(request.auth.wallet_address)); } catch (error) { next(error); }
});
app.put('/v1/communications/subscriptions', requireAuth, writeLimiter, async (request, response, next) => {
  try { response.json(await saveSubscription(request.auth.wallet_address, parse(subscriptionInput, request.body))); } catch (error) { next(error); }
});
app.get('/v1/communications/inbox', requireAuth, async (request, response, next) => {
  try { response.json(await inbox(request.auth.wallet_address)); } catch (error) { next(error); }
});
app.post('/v1/events/:id/communications/draft', requireAuth, writeLimiter, async (request, response, next) => {
  try { response.json(await draftCommunication(request.params.id, request.auth.wallet_address, parse(communicationDraftInput, request.body))); } catch (error) { next(error); }
});
app.post('/v1/events/:id/communications', requireAuth, writeLimiter, async (request, response, next) => {
  try { response.status(201).json(await publishCommunication(request.params.id, request.auth.wallet_address, parse(communicationPublishInput, request.body))); } catch (error) { next(error); }
});
app.use((_request, _response, next) => next(new HttpError(404, 'Route not found.', 'NOT_FOUND')));
app.use((error, request, response, _next) => {
  if (error instanceof ZodError) {
    return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: error.issues[0]?.message ?? 'Invalid request.', details: error.issues } });
  }
  const status = error.status ?? 500;
  if (status >= 500) logger.error({ err: error, method: request.method, path: request.path }, 'Request failed');
  return response.status(status).json({ error: { code: error.code ?? 'INTERNAL_ERROR', message: status >= 500 ? 'The service could not complete the request.' : error.message, ...(error.details ? { details: error.details } : {}) } });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, chainId: config.chainId }, 'API and durable job runner started');
  startJobRunner(logger).catch((error) => logger.error({ err: error }, 'Job runner startup failed'));
});

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => { await db.end(); process.exit(0); });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
