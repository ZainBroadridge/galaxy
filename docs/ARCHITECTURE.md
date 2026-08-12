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
8. Optional event PDFs are private objects; Neon stores metadata only.
9. Reports are generated on demand and never persisted.

## Components

### Vercel web application

The React/Vite app contains only four primary routes:

- `/` — Voting Dashboard;
- `/organiser` — Organiser Dashboard;
- `/results` — Results;
- `/comms` — Wallet Comms.

Nested event routes stay within those products. Reown AppKit supplies wallet connection. Account changes invalidate wallet-specific state without redirecting or disconnecting the page.

Event workflow pages subscribe to one event-scoped server-sent event stream while work is active. Every persisted job update emits a lightweight refresh signal; a controlled 15-second read is retained only as a recovery fallback. Requests never overlap.

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

The snapshot path uses Alchemy's indexed transfer history and does not depend on historical archive state at the record-date block.

For each event:

1. Resolve the Polygon block at or before the selected record date and a recent confirmation-safe validation block.
2. Obtain the token deployment block when explorer metadata is available and reject a record date before deployment.
3. Page `alchemy_getAssetTransfers` from deployment through the validation block.
4. Replay standard ERC-20 transfers, mints, and burns in raw integer units.
5. Preserve the event-derived ledger immediately after the record-date block.
6. Reject negative balances, negative supply, malformed transfers, duplicate ambiguity, and accounting inconsistencies.
7. Reconcile the event-derived current supply with `totalSupply()` at the recent validation block.
8. Reconcile every discovered current wallet balance with `balanceOf()` at the same recent block using bounded concurrency.
9. Calculate `votingPower = recordDateRawBalance / voteUnit`.
10. Exclude holders with zero whole voting units.
11. Build one Merkle root and store only eligible holder proofs in Neon.
12. Queue the one-contract deployment.

The recent-state reconciliation is a compatibility gate for event-complete ERC-20 implementations. Rebasing, reflection, hidden balance mutation, and incomplete mint/burn histories are rejected. The POC rebuilds each snapshot rather than reusing unversioned legacy snapshot data.

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

### Documents and generated reports

Optional proxy-voting PDFs are stored in a private Cloudflare R2 Standard bucket through its S3-compatible API. The API validates each PDF before upload, caps an event at three files of 10 MB each, and stores only metadata and the object key in Neon. The bucket is never public; browser open/download requests pass through the API.

Result and voter-receipt PDFs are generated only after the user clicks download. Reports use a shared Broadridge letterhead renderer. Creator result reports include the record-date holder register; voter reports expose only aggregate results and the connected voter's own choices. Supporting PDFs are appended to result reports.

### Neon

The schema intentionally contains only:

- authentication nonces and short-lived sessions;
- events;
- eligible snapshot entries/proofs;
- durable jobs;
- votes/receipts;
- crash-safe relayer transactions;
- Snap subscriptions;
- signed communications;
- event-document metadata and automatic-announcement authorisations.

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
- Wallet Comms uses a live refresh stream with one bounded fallback refresh; requests never overlap.
- Result RPC reads are sequential rather than a burst of up to 32 calls.
- Alchemy retry/backoff is confined to the snapshot job.
- Current-balance reconciliation uses a fixed small concurrency limit rather than an unbounded RPC burst.

## Trust boundary

Neon can make reads fast, but it cannot create voting eligibility or alter a confirmed vote:

- eligibility must match the on-chain snapshot root;
- voting power is recomputed by the contract;
- every final ballot is signed by the voter;
- duplicate voting is rejected on-chain;
- tallies are authoritative on-chain;
- proposal content is committed by an immutable metadata hash.
