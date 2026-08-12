# API surface

Base path: `/v1`

## Authentication

```text
POST /auth/nonce
POST /auth/verify
POST /auth/logout
```

Wallet-authenticated write routes use the existing short-lived bearer session. Read-only event, document, and dashboard routes do not require a signature.

## Events and dashboards

```text
POST /tokens/inspect                         authenticated
POST /events                                 authenticated
GET  /events/:id/view
GET  /events/:id/stream                      event progress SSE
POST /events/:id/retry                       creator only
GET  /events/:id/results                     creator or confirmed voter
GET  /dashboard/voting?wallet=0x...
GET  /dashboard/organiser                    authenticated
GET  /dashboard/results?wallet=0x...
```

`GET /events/:id/view` is the event read model. It includes lifecycle status, the latest non-vote job, wallet eligibility, vote receipt, direct voting URL when applicable, and supporting-document metadata.

## Automatic event announcements

```text
GET /events/:id/announcement/draft           creator only
PUT /events/:id/announcement                 creator only
```

When event creation selects an enabled Wallet Comms audience, the creator signs one event-bound announcement authorisation. The announcement is published only after the `VoteEvent` deployment is confirmed. A direct-link event uses `/vote/:eventId` as its communication action URL.

## Event documents

```text
POST   /events/:id/documents                 creator only, raw PDF body
DELETE /events/:id/documents/:documentId     creator only
GET    /events/:id/documents/:documentId
GET    /events/:id/documents/:documentId?download=1
```

An event supports up to three private-R2 PDF objects, each no larger than 10 MB. The API validates the filename, PDF signature, readability, page count, and SHA-256 digest before storing metadata in Neon.

## Voting and reports

```text
GET  /events/:id/ballot?wallet=0x...
POST /events/:id/votes
GET  /events/:id/reports/receipt             authenticated voter
GET  /events/:id/reports/results             creator or confirmed voter
```

The ballot endpoint returns the immutable EIP-712 signing context. The vote endpoint validates the signature and creates one durable relayer job.

Receipt and result PDFs are generated only when requested. Creator result reports include the full record-date holder register; confirmed-voter reports contain aggregate results and only that voter’s selections. Uploaded event PDFs are appended to result reports.

## Wallet communications

```text
GET  /communications/stream                  lightweight refresh SSE
GET  /communications/portal                  authenticated
GET  /communications/subscriptions           authenticated
PUT  /communications/subscriptions           authenticated
GET  /communications/inbox?wallet=0x...
POST /communications/token/draft             authenticated
POST /communications/token                   authenticated
POST /events/:id/communications/draft        creator only
POST /events/:id/communications              creator only
```

The communication stream carries only a refresh signal. Wallet-specific eligibility remains in the inbox query, and the browser verifies organiser signatures before displaying messages.

## Health

```text
GET /health
```

Returns database availability, chain ID, current service time, and runner identity/state. It does not make an RPC call on each health check.
