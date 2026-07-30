# Mini Galaxy PV V2.1 delivery

This is the complete source repository for the lightweight Polygon Amoy proxy-voting application.

Architecture:

- one `VoteEvent` contract per voting event;
- one Render web service containing the API and durable Neon-backed job runner;
- no separate Render indexer/background-worker service;
- record-date snapshots from Alchemy's indexed ERC-20 transfer history, not ten-block `eth_getLogs` scans;
- Neon PostgreSQL for event, snapshot, job, vote, and communication state;
- Reown AppKit for wallet connection;
- dApp-triggered MetaMask Snap communications;
- four primary UI areas: Voting Dashboard, Organiser Dashboard, Results, and Wallet Comms.

The archive intentionally excludes `node_modules`, generated frontend/Snap builds, Hardhat cache/artifacts, `.git`, and real environment files.

Start with:

```bash
npm install --include=dev --no-audit --no-fund
npm run check
```

Then follow `docs/DEPLOYMENT.md` and `docs/MIGRATION_FROM_CURRENT_HOSTED_V2.md`.
