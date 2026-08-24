# API surface

Base path: `/v1`

The current UI limits browser-wallet signing to final ballot submission. Most reads and organiser POC writes are wallet-address scoped and do not use the retained legacy bearer-session routes.

## Legacy authentication compatibility

```text
POST /auth/nonce
POST /auth/verify
POST /auth/logout
```

These routes remain for older clients and legacy signed-communication endpoints. They are not used by the current organiser UX.

## Events and dashboards

```text
POST /tokens/inspect                         public, rate-limited
POST /events                                 public creator-address scoped, rate-limited
GET  /events/:id/view?wallet=0x...
GET  /events/:id/stream                      event progress SSE
POST /events/:id/retry                       public creator-address scoped
GET  /events/:id/results?wallet=0x...
GET  /dashboard/voting?wallet=0x...
GET  /dashboard/organiser?wallet=0x...
GET  /dashboard/results?wallet=0x...
```

`POST /events` accepts a past, present, or future `recordDateAt`. Its response includes `job.availableAt`; future snapshot jobs remain durably pending until that time and may defer briefly while Polygon finality catches up.

## Automatic event announcements

```text
POST /events/:id/announcement                public creator-address scoped
PUT  /events/:id/announcement                backwards-compatible alias
```

The platform relayer signs the canonical announcement after deployment. A recovery sweep repairs missing or stale announcement rows. No organiser wallet signature is requested.

## Event documents

```text
POST   /events/:id/documents                 raw PDF body + wallet header/query
DELETE /events/:id/documents/:documentId     wallet header/query
GET    /events/:id/documents/:documentId
GET    /events/:id/documents/:documentId?download=1
```

An event supports at most three private-R2 PDFs of 10 MB each. The API validates the PDF signature, readability, page count, filename and SHA-256 before storing metadata.

## Voting and reports

```text
GET  /events/:id/ballot?wallet=0x...
POST /events/:id/votes                       final EIP-712 ballot signature
GET  /events/:id/reports/receipt?wallet=0x...
GET  /events/:id/reports/results?wallet=0x...
```

The contract remains the authority for eligibility, voting power, duplicate prevention, option bounds and tallies.

## Wallet communications

```text
GET    /communications/portal?wallet=0x...           legacy combined read
GET    /communications/subscriptions?wallet=0x...
PUT    /communications/subscriptions
GET    /communications/inbox?wallet=0x...
PUT    /communications/push-subscription
DELETE /communications/push-subscription
POST   /communications/token/platform
POST   /events/:id/communications/platform
```

The two Push-subscription methods share one resource path. The API stores only the endpoint, browser encryption keys, wallet address and timestamps. It does not store notification message content in that table. Delivery reuses the same `inbox(wallet)` eligibility logic as the dApp and Snap.

Legacy signed communication routes remain available:

```text
POST /communications/token/draft
POST /communications/token
POST /events/:id/communications/draft
POST /events/:id/communications
```

The obsolete communication-wide SSE route was removed. The web inbox uses an immediate load plus bounded visible-tab/focus polling; event workflow SSE remains separate.

## Health

```text
GET /health
```

Returns database availability, chain ID, job-runner state, automatic-announcement recovery status, whether Web Push is configured, and current service time.
