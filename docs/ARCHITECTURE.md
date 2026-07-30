# Architecture

## Design goals

V2 is deliberately narrow:

1. One immutable `VoteEvent` contract per proxy-voting event.
2. No auxiliary contracts.
3. Relayer-funded deployment and final voting.
4. Record-date eligibility proven with a Merkle proof.
5. Neon is the fast catalogue/read layer, not a replacement for on-chain vote enforcement.
6. No permanent blockchain log indexer.
7. No background Snap network polling.

## Components

### Vercel web application

The React/Vite app contains only four primary routes:

- `/` — Voting Dashboard;
- `/organiser` — Organiser Dashboard;
- `/results` — Results;
- `/comms` — Wallet Comms.

Nested event routes stay within those products. Reown AppKit supplies wallet connection. Account changes invalidate wallet-specific state without redirecting or disconnecting the page.

The browser normally makes one dashboard request. Only an event actively snapshotting/deploying, a vote awaiting confirmation, or source verification in progress triggers one consolidated five-second status refresh. Requests never overlap.

### One Render web service

`apps/api` serves HTTP and runs a Neon-backed job runner in the same process. This replaces the paid background-worker requirement.

Durable job types:

- `BUILD_SNAPSHOT`;
- `DEPLOY_EVENT`;
- `RELAY_VOTE`;
- `VERIFY_CONTRACT`.

The runner is idle when no work exists. When a request creates work, it wakes immediately. Jobs are claimed with PostgreSQL locking. A crashed service can reclaim a stale job after its lock expires.

Relayer transactions are signed and persisted before broadcast. A transient restart reuses the exact raw transaction. A confirmed/reverted receipt is reconciled idempotently.

### Snapshot pipeline

The previous small-range `eth_getLogs` loop has been removed.

For each event:

1. Resolve the finalized Polygon block at or before the selected record date.
2. Confirm the token contract existed at that block.
3. Page `alchemy_getAssetTransfers` for that token from genesis to the record block.
4. Reconstruct balances from standard ERC-20 transfers, mints, and burns.
5. Reject negative or malformed histories.
6. Read historical `totalSupply()` once and require equality with reconstructed positive balances.
7. Calculate `votingPower = rawBalance / voteUnit`.
8. Exclude holders with zero whole voting units.
9. Build one Merkle root and store only eligible holder proofs in Neon.
10. Queue the one-contract deployment.

A snapshot is reused only for the same token, exact record block, and exact `voteUnit`.

### `VoteEvent.sol`

The contract stores only immutable event enforcement data, `hasVoted`, and tallies:

- creator;
- token address;
- snapshot block/root;
- voting start/end;
- raw token units per vote;
- proposal metadata hash;
- compact proposal/option configuration;
- final-vote flag per wallet;
- proposal option tallies.

The ballot signature is EIP-712 domain-separated by chain and contract address. A signature cannot be reused on another event. `hasVoted` prevents a second ballot. There is no update, recall, pause, role, owner action, or stored relayer.

### Neon

The schema intentionally contains only:

- authentication nonces and short-lived sessions;
- events;
- eligible snapshot entries/proofs;
- durable jobs;
- votes/receipts;
- crash-safe relayer transactions;
- Snap subscriptions;
- signed communications.

Results are read directly from the completed `VoteEvent` contract, so there is no mirrored tally table or log index.

### MetaMask Snap

The Snap has no background network access. The dApp explicitly:

1. installs or updates it;
2. verifies that the same wallet is active in MetaMask and Reown;
3. authenticates to the API;
4. fetches the wallet's current notices once;
5. invokes the Snap.

The browser and Snap both recover the organiser signature over every displayed field. The Snap stores read/unread state and shows at most three notifications per explicit sync so MetaMask notification limits do not break inbox delivery.

## Request and 429 control

- No global read limiter.
- Write limits are keyed by authenticated wallet, not a shared corporate proxy address.
- Authentication also has a generous IP guard plus a wallet-specific limit.
- Public event/status reads do not attach a bearer token, avoiding an unnecessary session query.
- Wallet Comms never runs a timer.
- Result RPC reads are sequential rather than a burst of up to 32 calls.
- Alchemy retry/backoff is confined to the snapshot job.

## Trust boundary

Neon can make reads fast, but it cannot create voting eligibility or alter a confirmed vote:

- eligibility must match the on-chain snapshot root;
- voting power is recomputed by the contract;
- every final ballot is signed by the voter;
- duplicate voting is rejected on-chain;
- tallies are authoritative on-chain;
- proposal content is committed by an immutable metadata hash.
