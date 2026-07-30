# API surface

Base path: `/v1`

## Authentication

```text
POST /auth/nonce
POST /auth/verify
POST /auth/logout
```

The wallet signs a human-readable nonce. The returned bearer session is stored in browser session storage and is cleared automatically on account change.

## Events and dashboards

```text
POST /tokens/inspect                 authenticated
POST /events                         authenticated
GET  /events/:id/view
POST /events/:id/retry               creator only
GET  /events/:id/results
GET  /dashboard/voting?wallet=0x...
GET  /dashboard/organiser            authenticated
GET  /dashboard/results?wallet=0x...
```

`GET /events/:id/view` is the single status/read model for nested pages. It includes event lifecycle, the latest non-vote job, connected-wallet eligibility, and the wallet's vote receipt.

## Voting

```text
GET  /events/:id/ballot              authenticated eligible wallet
POST /events/:id/votes               authenticated eligible wallet
```

`/ballot` returns the immutable signing context. The browser signs EIP-712 typed data. `/votes` validates the signature and creates one durable relayer job.

## Wallet communications

```text
GET  /communications/portal          authenticated
PUT  /communications/subscriptions   authenticated
GET  /communications/inbox           authenticated
POST /events/:id/communications/draft creator only
POST /events/:id/communications       creator only
```

`/communications/portal` combines organiser events and subscriptions in one read. `/inbox` is called only by an explicit user sync.

## Health

```text
GET /health
```

Returns database availability, chain ID, current service time, and in-process runner identity/state. It deliberately does not make an RPC call on every health check.
