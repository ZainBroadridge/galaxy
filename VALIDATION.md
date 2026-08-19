# Validation and architecture review

## Completed in the delivery environment

```text
JavaScript/JSX/TypeScript syntax: passed (75 source files)
Relative imports: passed (75 source files)
Architecture audit: passed (112 source/configuration files)
Structure validation: passed
Focused notification/route regression tests: 8 passed, 0 failed
Trailing-whitespace audit: passed
Obsolete communication SSE references: removed
Event-specific SSE: retained
```

The full dependency-backed test/build suite could not run in the delivery container because npm registry access was unavailable. Run `npm install` and the complete validation commands in `APPLY.md` before committing.

## New files

```text
apps/api/src/web-push.js
apps/api/test/web-push-boundary.test.js
apps/web/public/pv-push-sw.js
apps/web/src/browser-push.js
db/migrations/004_web_push_subscriptions.sql
```

## Modified files

```text
.env.example
README.md
package.json
render.yaml
apps/api/package.json
apps/api/src/config.js
apps/api/src/deploy.js
apps/api/src/event-announcements.js
apps/api/src/server.js
apps/api/src/validation.js
apps/api/test/notification-delivery-boundary.test.js
apps/api/test/public-organiser-routes.test.js
apps/web/.env.local.example
apps/web/src/pages/WalletComms.jsx
docs/API.md
docs/ARCHITECTURE.md
docs/DEPLOYMENT.md
scripts/audit-project.mjs
scripts/validate-structure.mjs
```

## Delete

```text
apps/api/src/communication-stream.js
```

## Explicitly unchanged

```text
packages/contracts/**
packages/shared/**
apps/snap/**
apps/web/src/styles.css
apps/web/src/notifications.jsx
apps/api/src/communications.js
apps/api/src/snapshot.js
apps/api/src/relayer.js
apps/api/src/reports.js
R2 configuration and PDF behavior
```

## Data minimization

The new Neon table stores only:

```text
wallet_address
endpoint
p256dh
auth
created_at
updated_at
```

It does not store message IDs, titles, bodies, action URLs, delivery logs, read state, wallet signatures, or duplicate communication content.

## Security boundary

The click URL contains only an existing communication UUID. The disconnected Notifications page does not load or render the inbox. The target is shown only after the connected wallet's existing inbox query includes that UUID.

This is a connection-based UI gate, matching the requirement. It is not a new cryptographic proof of wallet control and does not change the current public wallet-scoped API authorization model.
