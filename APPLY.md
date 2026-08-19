# Clickable browser notifications - minimal integration

This release adds an optional Web Push delivery surface alongside the existing dApp inbox and MetaMask Snap.

## Behavior

- The user explicitly enables browser alerts from **Notifications -> Background alerts -> Clickable alerts**.
- A displayed browser notification uses the same concise token/title content as the wallet alert.
- Clicking it opens or focuses `/notifications?messageId=<id>`.
- While disconnected, the page shows only **Connect wallet** and no inbox content.
- After connection, the referenced communication is highlighted only when it belongs to that wallet's existing inbox.
- A different connected wallet sees an unavailable-for-this-wallet warning rather than the referenced message.
- No new wallet signature is introduced. Final ballot signing remains the only browser-wallet message signature.

This is the requested wallet-connection gate, not cryptographic re-authentication. Production-grade identity/privacy would require SIWE or enterprise SSO/RBAC and is intentionally outside this minimal enhancement.

## Minimal architecture

- one server adapter: `apps/api/src/web-push.js`;
- one browser adapter: `apps/web/src/browser-push.js`;
- one static service worker: `apps/web/public/pv-push-sw.js`;
- one small Neon table: `web_push_subscriptions`;
- one API resource path with `PUT` and `DELETE` methods;
- one server dependency: `web-push@3.6.7`;
- no new frontend dependency;
- no new page or React provider;
- no Snap, contract, relayer, snapshot, PDF, or CSS change.

The server reuses `communications.inbox(wallet)` as the single audience/eligibility rule. It stores no notification content or delivery history in the new table. The push payload contains only a concise title/body and the existing communication message ID.

## Cleanup

The obsolete communication-wide SSE route/module has been removed because the dApp already uses visible-tab/focus polling and the Snap has its independent cron path. Event-specific SSE for snapshot/deployment progress remains intact.

After copying the files, delete only:

```text
apps/api/src/communication-stream.js
```

## Apply

Copy this package over the repository root and choose **Replace files in the destination**.

Then delete the obsolete file:

```cmd
del apps\api\src\communication-stream.js
```

Install the one server dependency and refresh `package-lock.json`:

```cmd
npm install --include=dev --no-audit --no-fund
```

Run the new migration through the existing migration runner:

```cmd
npm run db:migrate
```

Or apply only this SQL file through Neon SQL Editor:

```text
db/migrations/004_web_push_subscriptions.sql
```

## Generate VAPID keys

Generate one key pair once:

```cmd
npx web-push generate-vapid-keys --json
```

Set on Render:

```text
WEB_PUSH_PUBLIC_KEY=<publicKey>
WEB_PUSH_PRIVATE_KEY=<privateKey>
WEB_PUSH_SUBJECT=https://YOUR-VERCEL-DOMAIN.vercel.app
```

Set the same public key on Vercel:

```text
VITE_WEB_PUSH_PUBLIC_KEY=<publicKey>
```

Do not expose the private key to Vercel or the browser.

## Validate

```cmd
npm run check:syntax
npm run check:imports
npm run check:structure
npm run audit:architecture
npm run test
npm run build:web
npm run build:snap
git diff --check
git status --short
```

The expected new or modified application scope is listed in `VALIDATION.md`. `package-lock.json` should also change after installation.

## Commit

```cmd
git add .env.example README.md package.json package-lock.json render.yaml
git add apps\api\package.json
git add apps\api\src\config.js
git add apps\api\src\deploy.js
git add apps\api\src\event-announcements.js
git add apps\api\src\server.js
git add apps\api\src\validation.js
git add apps\api\src\web-push.js
git add apps\api\test\notification-delivery-boundary.test.js
git add apps\api\test\public-organiser-routes.test.js
git add apps\api\test\web-push-boundary.test.js
git add apps\web\.env.local.example
git add apps\web\public\pv-push-sw.js
git add apps\web\src\browser-push.js
git add apps\web\src\pages\WalletComms.jsx
git add db\migrations\004_web_push_subscriptions.sql
git add docs\API.md docs\ARCHITECTURE.md docs\DEPLOYMENT.md
git add scripts\audit-project.mjs scripts\validate-structure.mjs
git rm apps\api\src\communication-stream.js

git commit -m "Add wallet-gated clickable browser notifications"
git push
```

Both Render and Vercel must deploy the same commit. No new Snap publication, Solidity compilation change, contract deployment, or R2 change is required.

## Acceptance test

1. Connect the intended receiving wallet.
2. Open **Notifications** and select **Enable browser alerts**.
3. Approve the browser notification permission.
4. Publish a brand-new communication for that wallet.
5. Wait for the browser notification and click it.
6. Confirm the dApp opens or focuses the Notifications page.
7. Disconnect the wallet and click another new notification: only the Connect Wallet gate should be visible.
8. Connect a different wallet: the target message must remain unavailable.
9. Connect the receiving wallet: the message should load, scroll into view, and receive focus.
