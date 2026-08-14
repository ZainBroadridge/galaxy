import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { createNonce, optionalAuth, requireAuth, revokeSession, verifyNonce } from './auth.js';
import { announceCommunication, closeCommunicationStreams, openCommunicationStream } from './communication-stream.js';
import {
  draftCommunication,
  draftTokenCommunication,
  inbox,
  publishCommunication,
  publishPlatformCommunication,
  publishTokenCommunication,
  saveSubscription,
  subscriptions,
} from './communications.js';
import { assertConfig, config } from './config.js';
import { db, query } from './db.js';
import {
  deleteEventDocument,
  readEventDocument,
  uploadEventDocument,
} from './documents.js';
import { triggerEventAnnouncement } from './event-announcements.js';
import { closeEventStreams, openEventStream } from './event-stream.js';
import { HttpError } from './errors.js';
import {
  createEvent,
  eventResults,
  eventView,
  organiserDashboard,
  resultsDashboard,
  retryEvent,
  votingDashboard,
} from './events.js';
import { logger } from './logger.js';
import { createResultsReport, createVoteReceipt } from './reports.js';
import { jobRunnerStatus, startJobRunner } from './runner.js';
import { securityHeaders } from './security.js';
import { inspectToken } from './tokens.js';
import {
  announcementTriggerInput,
  communicationDraftInput,
  communicationPublishInput,
  platformCommunicationInput,
  publicSubscriptionInput,
  eventInput,
  tokenCommunicationDraftInput,
  tokenCommunicationPublishInput,
  voteInput,
} from './validation.js';
import { ballot, submitVote } from './votes.js';

assertConfig();
const app = express();
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(cors((request, callback) => {
  const origin = request.get('origin');
  const snapInboxRequest = origin === 'null'
    && request.path === '/v1/communications/inbox';

  if (snapInboxRequest) {
    return callback(null, {
      origin: 'null',
      methods: ['GET', 'OPTIONS'],
      allowedHeaders: ['Accept'],
      maxAge: 86_400,
    });
  }

  if (!origin || config.corsOrigins.includes(origin)) {
    return callback(null, { origin: true });
  }

  return callback(new HttpError(403, 'Origin is not allowed.', 'CORS_DENIED'));
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
    response.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many write requests. Retry after a short pause.',
      },
      retryAfterMs: options.windowMs,
    });
  },
});
const authIpLimiter = limiter(120);
const authWalletLimiter = limiter(
  12,
  (request) => String(request.body?.walletAddress ?? 'invalid-wallet').toLowerCase(),
);
const writeLimiter = limiter(40, (request) => request.auth?.wallet_address ?? 'anonymous');
const voteLimiter = limiter(
  20,
  (request) => String(request.body?.voterAddress ?? 'invalid-voter').toLowerCase(),
);
const pdfBody = express.raw({
  type: ['application/pdf', 'application/octet-stream'],
  limit: '10mb',
});
const parse = (schema, value) => schema.parse(value);

function sendPdf(response, report) {
  response.set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(report.bytes.length),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(report.filename)}`,
    'Cache-Control': 'private, no-store',
  });
  response.send(report.bytes);
}

app.get('/health', async (_request, response, next) => {
  try {
    await query('SELECT 1');
    response.json({
      ok: true,
      service: 'mini-galaxy-pv-v2',
      chainId: config.chainId,
      jobs: jobRunnerStatus(),
      time: new Date().toISOString(),
    });
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
  try {
    response.status(201).json(await createEvent(
      request.auth.wallet_address,
      parse(eventInput, request.body),
    ));
  } catch (error) { next(error); }
});
app.get('/v1/events/:id/view', async (request, response, next) => {
  try { response.json(await eventView(request.params.id, request.query.wallet)); } catch (error) { next(error); }
});
app.get('/v1/events/:id/stream', openEventStream);
app.post('/v1/events/:id/retry', requireAuth, writeLimiter, async (request, response, next) => {
  try { response.json(await retryEvent(request.params.id, request.auth.wallet_address)); } catch (error) { next(error); }
});
app.get('/v1/events/:id/results', async (request, response, next) => {
  try { response.json(await eventResults(request.params.id, request.query.wallet)); } catch (error) { next(error); }
});

app.post('/v1/events/:id/announcement', writeLimiter, async (request, response, next) => {
  try {
    const input = parse(announcementTriggerInput, request.body);
    const result = await triggerEventAnnouncement(request.params.id, input.publisherAddress);
    if (result.published) announceCommunication();
    response.json(result);
  } catch (error) { next(error); }
});
// Backwards-compatible alias for earlier frontend packages. No wallet signature is required.
app.put('/v1/events/:id/announcement', writeLimiter, async (request, response, next) => {
  try {
    const input = parse(announcementTriggerInput, request.body);
    const result = await triggerEventAnnouncement(request.params.id, input.publisherAddress);
    if (result.published) announceCommunication();
    response.json(result);
  } catch (error) { next(error); }
});

app.post('/v1/events/:id/documents', requireAuth, writeLimiter, pdfBody, async (request, response, next) => {
  try {
    response.status(201).json(await uploadEventDocument(
      request.params.id,
      request.auth.wallet_address,
      request.get('x-file-name'),
      request.body,
    ));
  } catch (error) { next(error); }
});
app.delete('/v1/events/:id/documents/:documentId', requireAuth, writeLimiter, async (request, response, next) => {
  try {
    await deleteEventDocument(
      request.params.id,
      request.params.documentId,
      request.auth.wallet_address,
    );
    response.status(204).end();
  } catch (error) { next(error); }
});
app.get('/v1/events/:id/documents/:documentId', async (request, response, next) => {
  try {
    const document = await readEventDocument(request.params.id, request.params.documentId);
    const disposition = request.query.download === '1' ? 'attachment' : 'inline';
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(document.bytes.length),
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
      'Cache-Control': 'private, max-age=300',
    });
    response.send(document.bytes);
  } catch (error) { next(error); }
});
app.get('/v1/events/:id/reports/results', requireAuth, async (request, response, next) => {
  try { sendPdf(response, await createResultsReport(request.params.id, request.auth.wallet_address)); } catch (error) { next(error); }
});
app.get('/v1/events/:id/reports/receipt', requireAuth, async (request, response, next) => {
  try { sendPdf(response, await createVoteReceipt(request.params.id, request.auth.wallet_address)); } catch (error) { next(error); }
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

app.get('/v1/events/:id/ballot', async (request, response, next) => {
  try { response.json(await ballot(request.params.id, request.query.wallet)); } catch (error) { next(error); }
});
app.post('/v1/events/:id/votes', voteLimiter, async (request, response, next) => {
  try {
    const input = parse(voteInput, request.body);
    response.status(202).json(await submitVote(
      request.params.id,
      input.voterAddress,
      input.choices,
      input.signature,
    ));
  } catch (error) { next(error); }
});

app.get('/v1/communications/stream', openCommunicationStream);
app.get('/v1/communications/portal', async (request, response, next) => {
  try {
    const wallet = request.query.wallet ?? request.auth?.wallet_address;
    if (!wallet) throw new HttpError(400, 'A wallet address is required.', 'WALLET_REQUIRED');
    const [savedSubscriptions, organisedEvents] = await Promise.all([
      subscriptions(wallet),
      organiserDashboard(wallet),
    ]);
    response.json({ subscriptions: savedSubscriptions, organisedEvents });
  } catch (error) { next(error); }
});
app.get('/v1/communications/subscriptions', async (request, response, next) => {
  try {
    const wallet = request.query.wallet ?? request.auth?.wallet_address;
    if (!wallet) throw new HttpError(400, 'A wallet address is required.', 'WALLET_REQUIRED');
    response.json(await subscriptions(wallet));
  } catch (error) { next(error); }
});
app.put('/v1/communications/subscriptions', writeLimiter, async (request, response, next) => {
  try {
    const input = parse(publicSubscriptionInput, request.body);
    response.json(await saveSubscription(input.walletAddress, input));
  } catch (error) { next(error); }
});
app.get('/v1/communications/inbox', async (request, response, next) => {
  try {
    const wallet = request.query.wallet ?? request.auth?.wallet_address;
    if (!wallet) throw new HttpError(400, 'A wallet address is required.', 'WALLET_REQUIRED');
    response.set('Cache-Control', 'private, no-store');
    response.json(await inbox(wallet));
  } catch (error) { next(error); }
});
app.post('/v1/communications/token/draft', requireAuth, writeLimiter, async (request, response, next) => {
  try {
    response.json(await draftTokenCommunication(
      request.auth.wallet_address,
      parse(tokenCommunicationDraftInput, request.body),
    ));
  } catch (error) { next(error); }
});
app.post('/v1/communications/token', requireAuth, writeLimiter, async (request, response, next) => {
  try {
    const message = await publishTokenCommunication(
      request.auth.wallet_address,
      parse(tokenCommunicationPublishInput, request.body),
    );
    announceCommunication();
    response.status(201).json(message);
  } catch (error) { next(error); }
});
app.post('/v1/events/:id/communications/platform', writeLimiter, async (request, response, next) => {
  try {
    const message = await publishPlatformCommunication(
      request.params.id,
      parse(platformCommunicationInput, request.body),
    );
    announceCommunication();
    response.status(201).json(message);
  } catch (error) { next(error); }
});

app.post('/v1/events/:id/communications/draft', requireAuth, writeLimiter, async (request, response, next) => {
  try {
    response.json(await draftCommunication(
      request.params.id,
      request.auth.wallet_address,
      parse(communicationDraftInput, request.body),
    ));
  } catch (error) { next(error); }
});
app.post('/v1/events/:id/communications', requireAuth, writeLimiter, async (request, response, next) => {
  try {
    const message = await publishCommunication(
      request.params.id,
      request.auth.wallet_address,
      parse(communicationPublishInput, request.body),
    );
    announceCommunication();
    response.status(201).json(message);
  } catch (error) { next(error); }
});

app.use((_request, _response, next) => next(new HttpError(404, 'Route not found.', 'NOT_FOUND')));
app.use((error, request, response, _next) => {
  if (error instanceof ZodError) {
    return response.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.issues[0]?.message ?? 'Invalid request.',
        details: error.issues,
      },
    });
  }
  const status = error.status ?? 500;
  if (status >= 500) logger.error({ err: error, method: request.method, path: request.path }, 'Request failed');
  return response.status(status).json({
    error: {
      code: error.code ?? 'INTERNAL_ERROR',
      message: status >= 500 ? 'The service could not complete the request.' : error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, chainId: config.chainId }, 'API and durable job runner started');
  startJobRunner(logger).catch((error) => logger.error({ err: error }, 'Job runner startup failed'));
});

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  closeCommunicationStreams();
  closeEventStreams();
  server.close(async () => {
    await db.end();
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
