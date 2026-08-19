# Architecture

## Design goals

V2 is deliberately narrow:

1. One immutable `VoteEvent` contract per proxy-voting event.
2. No auxiliary contracts.
3. Relayer-funded deployment and final voting.
4. Record-date eligibility proven with a Merkle proof.
5. Neon is the fast catalogue/read layer, not a replacement for on-chain vote enforcement.
6. No permanent blockchain log indexer.
7. The Snap is an optional verified background wallet inbox; clickable browser notifications use standard Web Push.
8. Optional event PDFs are private objects; Neon stores metadata only.
9. Reports are generated on demand and never persisted.
10. Notification clicks reveal content only after the receiving wallet is connected.

## Components

### Vercel web application

The React/Vite app exposes Home, Voting, Organiser, Results, and Notifications routes. `/notifications` is the current inbox route and `/comms` remains a compatibility redirect. Nested event routes stay within those products. Reown AppKit supplies wallet connection. Account changes invalidate wallet-specific state without redirecting or disconnecting the page.

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
- token-following subscriptions;
- signed communications;
- minimal Web Push subscriptions (wallet, endpoint, encryption keys, timestamps);
- event-document metadata and automatic-announcement state.

Results are read directly from the completed `VoteEvent` contract, so there is no mirrored tally table or log index.

### MetaMask Snap and clickable Web Push

The Snap is an optional verified wallet inbox. Its cron path reads the selected wallet, fetches the wallet-specific Render inbox, validates canonical signatures and trusted origins, deduplicates by message ID, persists messages, and attempts MetaMask in-app/native notifications. Snap-native desktop presentation is best effort and does not provide a controllable click URL.

Clickable desktop notifications therefore use a small, separate Web Push adapter:

1. The connected wallet explicitly enables browser notifications.
2. The browser creates one Push subscription.
3. Render stores only the wallet address, endpoint, encryption keys, and timestamps.
4. On publication, Render reuses `inbox(wallet)` as the single audience/eligibility rule and sends only a concise title plus `messageId`.
5. The service worker opens `/notifications?messageId=...` when clicked.
6. The page displays no inbox content while disconnected. After connection, it highlights the message only when that wallet's inbox contains it.

Web Push does not add a wallet signature or a second authentication system. It implements the requested wallet-connection gate; production identity assurance for organiser/report actions remains a separate hardening concern.

The obsolete communication-wide SSE module and route were removed. The web inbox uses one immediate read plus bounded visible-tab/focus polling. Event-specific SSE remains for durable job progress.

## Request and 429 control

- No global read limiter.
- Write limits are keyed by authenticated wallet, not a shared corporate proxy address.
- Authentication also has a generous IP guard plus a wallet-specific limit.
- Public event/status reads do not attach a bearer token, avoiding an unnecessary session query.
- Wallet communications use an immediate read plus one bounded visible-tab/focus refresh loop; requests never overlap.
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
