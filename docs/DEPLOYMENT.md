# Deployment runbook

This runbook deploys the corrected V2 to:

- Polygon Amoy (`80002`);
- one Render web service for the API and durable job runner;
- Neon PostgreSQL;
- Vercel for the React application;
- npm for the MetaMask Snap;
- GitHub as the source repository.

Use a fresh Neon branch/project and stop the previous indexer before beginning.

## 1. Prerequisites

Install or create:

- Node.js `20.18.0`;
- npm and Git;
- MetaMask Extension;
- a GitHub repository;
- a Neon project;
- a Polygon Amoy Alchemy HTTPS endpoint;
- a dedicated relayer wallet funded with Amoy POL;
- an Etherscan API key for PolygonScan verification;
- a Reown Cloud project;
- Render and Vercel accounts;
- an npm account and scope for publishing the Snap.

Do not use the relayer wallet for personal funds. Never put its private key in Vercel, GitHub, or any `VITE_` variable.

## 2. Remove the old runtime first

Before deploying the corrected backend:

1. Suspend or delete the old Render indexer/web-indexer service.
2. Suspend the old API after recording any values you still need.
3. Close old browser tabs running the previous Vercel application.
4. Remove scheduled pings or monitoring calls aimed at old indexer endpoints.
5. Create a fresh Neon branch/project for the corrected schema.

Leaving the old indexer active will continue consuming Alchemy capacity even when the new application is deployed.

## 3. Install the repository locally

From Windows Command Prompt:

```cmd
cd C:\Users\QureshiM\Desktop\mini-galaxy-pv-v2
nvm use 20.18.0
npm install --include=dev --no-audit --no-fund
```

If `nvm` is not installed, confirm that the active Node version is compatible:

```cmd
node --version
npm --version
```

The first successful installation creates `package-lock.json`. Keep and commit it. From then on, use `npm ci` in CI and clean environments.

On the Broadridge network, retain the working company proxy configuration:

```cmd
npm config get proxy
npm config get https-proxy
npm config get registry
```

## 4. Configure local server variables

Create the root environment file:

```cmd
copy .env.example .env
```

Fill `.env`:

```dotenv
NODE_ENV=development
PORT=3001
CHAIN_ID=80002

DATABASE_URL=postgresql://YOUR_POOLED_NEON_URL
DATABASE_URL_DIRECT=postgresql://YOUR_DIRECT_NEON_URL

RPC_HTTP_URL=https://polygon-amoy.g.alchemy.com/v2/YOUR_KEY
RELAYER_PRIVATE_KEY=0xYOUR_TESTNET_RELAYER_PRIVATE_KEY
BLOCK_EXPLORER_URL=https://amoy.polygonscan.com
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_V2_KEY
VERIFY_CONTRACTS=true

CORS_ORIGINS=http://localhost:5173
SESSION_TTL_HOURS=24
AUTH_NONCE_TTL_MINUTES=10
MAX_EVENTS_PER_WALLET_PER_DAY=5

JOB_LOCK_MINUTES=8
JOB_IDLE_DELAY_MS=1500
TRANSACTION_WAIT_TIMEOUT_MS=180000
CONFIRMATION_BLOCKS=8
ALCHEMY_PAGE_SIZE=1000
ALCHEMY_MAX_PAGES=100
ALCHEMY_MAX_RETRIES=6
```

Use the Neon pooled connection string for `DATABASE_URL` and the direct connection string for `DATABASE_URL_DIRECT`.

`RPC_HTTP_URL` must be an Alchemy **Polygon Amoy HTTPS** endpoint. Do not use a WebSocket endpoint or an Ethereum-mainnet endpoint.

## 5. Configure the web application

Create the browser environment file:

```cmd
copy apps\web\.env.local.example apps\web\.env.local
```

Fill it for local development:

```dotenv
VITE_API_BASE_URL=http://localhost:3001
VITE_PUBLIC_RPC_URL=https://polygon-amoy.g.alchemy.com/v2/YOUR_BROWSER_SAFE_KEY
VITE_BLOCK_EXPLORER_URL=https://amoy.polygonscan.com
VITE_REOWN_PROJECT_ID=YOUR_REOWN_PROJECT_ID
VITE_APP_URL=http://localhost:5173
VITE_SNAP_ID=local:http://localhost:8080
VITE_SNAP_VERSION=*
```

Every `VITE_` value is public browser configuration. Do not place private keys, Neon credentials, or a privileged Alchemy secret there.

In Reown Cloud, add these local/production application origins when applicable:

```text
http://localhost:5173
https://YOUR_APP.vercel.app
```

## 6. Prepare Neon

Recommended: use a new Neon project or branch. Then run:

```cmd
npm run db:migrate
```

The corrected schema is intentionally compact. It contains only:

- authentication nonces and sessions;
- events;
- snapshot proofs;
- durable jobs;
- vote receipts;
- crash-safe relayer transactions;
- communication subscriptions and signed messages.

To reset a **dedicated disposable V2 database only**:

```cmd
set CONFIRM_DATABASE_RESET=RESET_PV_V2
npm run db:reset
npm run db:migrate
```

Never run that command against a shared database.

## 7. Compile, test, and build locally

Run the full gate:

```cmd
npm run check
```

That performs:

```text
syntax checks
relative-import checks
architecture audit
VoteEvent compile/export
contract tests
shared tests
Vite production build
MetaMask Snap build
```

It must complete before production deployment.

The contract build writes the committed runtime artifacts used by Render:

```text
packages/contracts/generated/VoteEvent.json
packages/contracts/generated/VoteEvent.verification.json
```

The Render service never runs Hardhat and never compiles during event creation.

## 8. Run locally

Use three terminals.

Terminal 1:

```cmd
npm run dev:api
```

Terminal 2:

```cmd
npm run dev:web
```

Terminal 3:

```cmd
npm run dev:snap
```

Open:

```text
Web:         http://localhost:5173
API health:  http://localhost:3001/health
Snap:        http://localhost:8080
```

Local smoke test:

1. Open `/health` and confirm `ok: true`.
2. Connect MetaMask through Reown on Polygon Amoy.
3. Open Wallet Comms and install the local Snap.
4. Inspect a modest standard ERC-20 on Amoy.
5. Create an event using a record date in the past or present.
6. Keep voting start sufficiently ahead of current time for snapshot and deployment.
7. Confirm one contract is deployed and the PolygonScan links appear.
8. Vote from an eligible wallet and confirm the wallet stays connected and the receipt persists.

## 9. Upload to GitHub

Create an empty GitHub repository. Then run:

```cmd
git init
git add .
git commit -m "Rebuild PV V2 architecture"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/mini-galaxy-pv-v2.git
git push -u origin main
```

Confirm that secrets are not tracked:

```cmd
git status
git ls-files | findstr /I ".env private secret key"
```

Expected tracked templates are `.env.example` and `apps/web/.env.local.example`; the real `.env` files must remain ignored.

## 10. Deploy the single Render service

The repository root contains `render.yaml`. Create a Render Blueprint from the GitHub repository.

It creates exactly one free web service:

```text
mini-galaxy-pv-v2
```

The service performs:

- HTTP API requests;
- durable snapshot jobs;
- the single-contract deployment;
- gasless vote relaying;
- PolygonScan source verification.

There is no separate indexer or worker service.

Set these secret environment variables in Render:

```text
DATABASE_URL
DATABASE_URL_DIRECT
RPC_HTTP_URL
RELAYER_PRIVATE_KEY
ETHERSCAN_API_KEY
CORS_ORIGINS
WEB_PUSH_PUBLIC_KEY       # optional
WEB_PUSH_PRIVATE_KEY      # optional secret
WEB_PUSH_SUBJECT          # optional, HTTPS URL or mailto address
```

Use these production values initially:

```text
CORS_ORIGINS=https://YOUR_APP.vercel.app
VERIFY_CONTRACTS=true
CHAIN_ID=80002
BLOCK_EXPLORER_URL=https://amoy.polygonscan.com
```

The Blueprint already sets the remaining non-secret defaults.

After deploy, open:

```text
https://YOUR_RENDER_SERVICE.onrender.com/health
```

Expected shape:

```json
{
  "ok": true,
  "service": "mini-galaxy-pv-v2",
  "chainId": 80002,
  "jobs": {
    "running": false
  }
}
```

A Render free web service may sleep after inactivity. Open `/health` before a demonstration and keep the event-status page open while a snapshot/deployment is active. The page makes one controlled status request at a time, which also keeps the service available during the job.

## 11. Deploy the web application to Vercel

Import the same GitHub repository into Vercel.

Use the repository root. `vercel.json` supplies:

```text
install command
web-only build command
apps/web/dist output directory
SPA rewrites
```

Set Vercel production variables:

```text
VITE_API_BASE_URL=https://YOUR_RENDER_SERVICE.onrender.com
VITE_PUBLIC_RPC_URL=https://YOUR_BROWSER_SAFE_AMOY_RPC
VITE_BLOCK_EXPLORER_URL=https://amoy.polygonscan.com
VITE_REOWN_PROJECT_ID=YOUR_REOWN_PROJECT_ID
VITE_APP_URL=https://YOUR_APP.vercel.app
VITE_SNAP_ID=npm:@YOUR_NPM_SCOPE/pv-communications-snap
VITE_SNAP_VERSION=0.4.1
VITE_WEB_PUSH_PUBLIC_KEY=YOUR_VAPID_PUBLIC_KEY
```

The production Snap values can be added after the first web deployment and then redeployed.

Once the final Vercel origin is known:

1. update Render `CORS_ORIGINS` to that exact origin;
2. update the Reown project allowlist;
3. configure the Snap manifest with that origin;
4. redeploy Render and Vercel.

Do not include a path or trailing slash in `CORS_ORIGINS`.

## 12. Configure and publish the MetaMask Snap

Choose a public npm package name, for example:

```text
@YOUR_NPM_SCOPE/pv-communications-snap
```

From the repository root:

```cmd
npm run snap:configure -- --origin https://YOUR_APP.vercel.app --package @YOUR_NPM_SCOPE/pv-communications-snap --repository https://github.com/YOUR_USERNAME/mini-galaxy-pv-v2.git
npm run build:snap
```

Review:

```text
apps/snap/package.json
apps/snap/snap.manifest.json
```

Confirm:

- package and manifest version are both `0.2.0`;
- `source.location.npm.packageName` matches the npm package;
- `allowedOrigins` contains only the production Vercel origin;
- `initialConnections` contains the production Vercel origin;
- repository metadata is correct;
- the manifest shasum was generated by the Snap build.

Publish:

```cmd
npm login
npm publish --workspace ./apps/snap --access public
```

Then set/reconfirm on Vercel:

```text
VITE_SNAP_ID=npm:@YOUR_NPM_SCOPE/pv-communications-snap
VITE_SNAP_VERSION=^0.2.0
```

Redeploy Vercel. On Wallet Comms, choose **Install Snap** or **Update Snap**.

The production dApp cannot install a `local:` Snap. MetaMask and Reown must have the same active wallet before a communication sync.

## 13. Production smoke test

Run this sequence after the final deployments:

1. Stop/delete the old Render indexer.
2. Open the new Render `/health` endpoint.
3. Open the new Vercel application in a fresh tab.
4. Connect MetaMask through Reown on chain `80002`.
5. Confirm the organiser dashboard loads for the connected address without a wallet signature.
6. Inspect a standard, modest-history Amoy ERC-20.
7. Create an event with:
   - record date in the past/present;
   - voting start sufficiently ahead;
   - natural-number token-to-vote ratio;
   - one or more proposals;
   - desired discovery and Snap settings.
8. Confirm progress advances through snapshot, deployment, and verification.
9. Confirm the deployment transaction and contract links appear.
10. Confirm the PolygonScan contract source shows as verified.
11. Connect an eligible holder.
12. Confirm the event appears on Voting Dashboard.
13. Submit one gasless final ballot.
14. Confirm the ballot disappears immediately and the wallet remains connected.
15. Refresh/reconnect and confirm the receipt remains instead of the ballot.
16. Close voting or use an already completed test event and inspect Results.
17. Install/update the Snap from Notifications.
18. Publish a platform-issued communication without a wallet signature.
19. Confirm it appears in the dApp and Snap inboxes.
20. Enable browser alerts, publish a new message, click the notification, and confirm the dApp requires/uses the receiving wallet before revealing the message.

## 14. Snapshot timing expectations

This architecture removes the former ten-block `eth_getLogs` loop and the historical `balanceOf` request per candidate wallet. It pages Alchemy's indexed ERC-20 transfer history and performs one historical `totalSupply()` consistency read.

For a modest Amoy test token, snapshot + deployment can normally finish within a short demonstration window once Render is awake. Do not promise a universal two-minute SLA for any arbitrary public token: history size, Alchemy throttling, Render cold starts, Polygon block inclusion, and explorer verification are external variables.

Use these safeguards:

- choose standard ERC-20 test tokens with modest transfer history;
- open `/health` before a demo;
- set voting start at least several minutes after creation;
- keep the event status page open while work runs;
- maintain enough POL in the relayer wallet;
- use an active Etherscan API key;
- do not leave the old indexer running.

## 15. Updating the application later

For ordinary web/API changes:

```cmd
git add .
git commit -m "Describe change"
git push
```

Render and Vercel auto-deploy after checks pass.

For Snap changes:

1. increment `apps/snap/package.json` and `apps/snap/snap.manifest.json` together;
2. run `npm run build:snap`;
3. publish the new npm version;
4. adjust `VITE_SNAP_VERSION` when needed;
5. redeploy Vercel;
6. choose **Update Snap** in the dApp.

For database schema changes, add a new numbered migration. Do not edit an already-applied production migration.

## Event documents and report generation

This release adds two server dependencies only:

```text
@aws-sdk/client-s3   private Cloudflare R2 object access
pdf-lib              on-demand PDF validation, generation, and merging
```

Create one **Standard** R2 bucket, for example `mini-galaxy-pv-documents`. Keep the bucket private. Create an R2 API token with **Object Read & Write** permission scoped only to that bucket, then record the Account ID, Access Key ID, and Secret Access Key.

Add these Render environment variables:

```text
WEB_APP_URL=https://YOUR_APP.vercel.app
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=mini-galaxy-pv-documents
```

No R2 CORS policy or public bucket URL is required because uploads and downloads pass through Render.

Apply only the new migration to an existing V2 database:

```text
db/migrations/003_event_documents_announcements.sql
```

Do not rerun `001_schema.sql` or `002_token_communications.sql` on a database where they were already applied.

After copying the release files, update the lockfile and validate:

```cmd
npm install --include=dev --no-audit --no-fund
npm run compile
npm run test
npm run build:web
```

Commit the updated `package-lock.json` together with the source changes.

## Clickable browser notifications

Web Push is optional and independent of the Snap package. It uses the single `web-push` server dependency and one static service worker.

After installing dependencies, generate one VAPID key pair:

```cmd
npx web-push generate-vapid-keys --json
```

Set on Render:

```text
WEB_PUSH_PUBLIC_KEY=...
WEB_PUSH_PRIVATE_KEY=...
WEB_PUSH_SUBJECT=https://YOUR_APP.vercel.app
```

Set the same public key on Vercel:

```text
VITE_WEB_PUSH_PUBLIC_KEY=...
```

Apply only the new migration to an existing database:

```text
db/migrations/004_web_push_subscriptions.sql
```

Then redeploy Render and Vercel. On the Notifications page, connect the intended receiving wallet and select **Enable browser alerts**. The browser permission prompt is not a wallet signature. A notification click opens `/notifications?messageId=...`; if the dApp is disconnected, it displays only the wallet-connect gate. If another wallet is connected, the referenced communication is not displayed.

