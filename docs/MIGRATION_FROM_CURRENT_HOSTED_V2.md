# Cutover from the currently hosted V2

Do not deploy this repository on top of the old services without completing these steps.

## 1. Stop the old RPC traffic

In Render, suspend or delete the old indexer/web-indexer service first. The corrected application has no separate indexer. Leaving the old service running will continue the ten-block `eth_getLogs` loop and can still exhaust Alchemy limits even after the frontend is replaced.

Also stop any local process or scheduled monitor that calls the old indexer endpoints.

## 2. Use a clean Neon schema

The new schema intentionally replaces the previous migration history. Recommended: create a new Neon branch or project and use its URLs in Render.

For a dedicated disposable V2 database only:

```cmd
set CONFIRM_DATABASE_RESET=RESET_PV_V2
npm run db:reset
npm run db:migrate
```

Never run the reset against a shared or production database containing unrelated data.

## 3. Replace Render with one web service

Deploy only the service in `render.yaml`. Remove the old backend and indexer services after confirming the new service has the desired public hostname.

The new API hostname must be placed in Vercel as `VITE_API_BASE_URL`.

## 4. Replace Vercel environment variables

Remove obsolete indexer URLs and role/persona settings. Keep only the variables documented in `docs/DEPLOYMENT.md`.

After deployment, hard-refresh the browser. There is no service worker, but an old open tab can continue executing old polling code until refreshed.

## 5. Republish the Snap

The previous Snap runtime and backend message shape were incompatible. Publish version `0.2.0` or later, update `VITE_SNAP_ID`/`VITE_SNAP_VERSION`, and redeploy Vercel.

Users can choose **Update Snap** on Wallet Comms. If MetaMask retains a broken local development Snap, remove it from MetaMask's Snap settings and install the published npm Snap from the production dApp.

## 6. Smoke test in this order

1. `GET /health` succeeds.
2. Reown connects MetaMask on chain `80002`.
3. Organiser authentication signs once.
4. A standard test ERC-20 is inspected.
5. Create an event with a past record date.
6. Status proceeds from snapshot to deployment to source verification.
7. PolygonScan transaction and contract links appear.
8. An eligible wallet signs and submits one gasless ballot.
9. The wallet stays connected and sees the receipt after refresh.
10. Wallet Comms installs/updates the Snap and explicit Sync delivers a signed notice.
