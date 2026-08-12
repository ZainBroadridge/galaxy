# Mini Galaxy Proxy Voting V2

A lightweight Polygon Amoy proxy-voting dApp with:
- exactly one `VoteEvent` contract per event;
- gasless deployment and voting through one Render relayer wallet;
- record-date holder snapshots built from Alchemy's indexed ERC-20 transfer history;
- concise Neon storage for events, Merkle proofs, jobs, votes, and wallet communications;
- Reown AppKit wallet connection;
- dApp-triggered MetaMask Snap communications;
- optional private proxy-voting PDFs and on-demand Broadridge-branded reports;
- event-scoped live progress for snapshots, relayer deployment, and verification;
- four user-facing areas: Voting Dashboard, Organiser Dashboard, Results, and Wallet Comms.

## Architecture at a glance

```text
Vercel React app
   | HTTPS
   v
One Render web service
   |- REST API
   |- durable Neon-backed job runner
   |- Alchemy snapshot reader
   |- Polygon Amoy relayer
   |- Etherscan V2 verification
   |- on-demand PDF reports
   `- private R2 document adapter
   |
   +--> Neon PostgreSQL
   `--> Polygon Amoy: one VoteEvent per event

MetaMask Snap <--- explicit install/sync from the Vercel dApp
```

There is no separate indexer service, no continuous `eth_getLogs` scan, no deployment registry, no factory, no access-list contract, and no per-event token contract.

## Repository

```text
apps/web        React/Vite + Reown AppKit
apps/api        Express API + in-process durable job runner
apps/snap       MetaMask Snap
packages/shared Shared canonical data, Merkle, and EIP-712 helpers
packages/contracts/VoteEvent.sol
packages/contracts/generated Runtime deployment and verification artifacts
db/migrations  Concise Neon schema
docs            Deployment, architecture, API, and troubleshooting
```

## Local quick start

Requirements:

- Node.js `20.18.0`;
- a dedicated Neon database;
- a Polygon Amoy Alchemy HTTPS endpoint;
- a funded Amoy relayer wallet;
- MetaMask Extension;
- a Reown project ID.

On Windows Command Prompt:

```cmd
npm install --include=dev --no-audit --no-fund
copy .env.example .env
copy apps\web\.env.local.example apps\web\.env.local
```

Fill both environment files, then run:

```cmd
npm run db:migrate
npm run check
```

Start three terminals:

```cmd
npm run dev:api
```

```cmd
npm run dev:web
```

```cmd
npm run dev:snap
```

Open `http://localhost:5173`. The API health endpoint is `http://localhost:3001/health`, and the local Snap is served at `http://localhost:8080`.

## Important before replacing the hosted application

1. Stop and delete the old Render indexer/web-indexer service. It must not continue polling Alchemy.
2. Use a fresh Neon branch/project, or reset only the dedicated V2 database.
3. Deploy the single Render service from `render.yaml`.
4. Deploy the web workspace to Vercel.
5. Configure and publish the Snap, then set its npm ID in Vercel.

Read [the deployment runbook](docs/DEPLOYMENT.md) before cutover.

## Snapshot support boundary

This release supports event-complete ERC-20 tokens whose balance and supply changes are fully represented by standard `Transfer` events. The API replays indexed transfers through the record-date block, preserves the resulting holder balances, continues the replay to a recent confirmation-safe block, and reconciles the derived current supply and every discovered current balance against `totalSupply()` and `balanceOf()` at that recent block. It does not require archive-state calls at the historical record date.

Rebasing, reflection, silent balance mutation, incomplete mint/burn history, malformed transfer history, and tokens that did not exist at the record date are rejected rather than snapshotted approximately. This compatibility gate is strong for standard OpenZeppelin-style ERC-20 tokens; arbitrary contracts whose balances can change without `Transfer` events remain outside the supported boundary.

The default transfer-history cap is `100,000` records (`ALCHEMY_MAX_PAGES=100`, `ALCHEMY_PAGE_SIZE=1000`). A normal POC token with modest history should normally complete in one indexed-transfer page plus bounded recent-state reconciliation. A universal two-minute guarantee is not technically possible for arbitrarily large histories or holder sets.

## Commands

```text
npm run compile          Compile/export VoteEvent artifacts
npm run test             Contract, shared-library, and API domain tests
npm run build:web        Production web build
npm run build:snap       Production Snap build
npm run check            Full compile/test/build validation
npm run db:migrate       Apply Neon migrations
npm run db:reset         Reset a dedicated V2 database (guarded)
npm run audit:architecture
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Production deployment](docs/DEPLOYMENT.md)
- [Cutover from the currently hosted V2](docs/MIGRATION_FROM_CURRENT_HOSTED_V2.md)
- [API surface](docs/API.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Delivery validation](docs/VALIDATION.md)
