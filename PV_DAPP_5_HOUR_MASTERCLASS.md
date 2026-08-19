# Mini Galaxy Proxy Voting V2.1 — 5-Hour Masterclass

## Purpose

This guide is designed for a technical presentation to senior developers. It explains the current codebase as a system, not as a collection of screens. It emphasizes architecture, cryptographic invariants, transaction safety, failure recovery, data ownership, and the honest POC-to-production gap.

The code has evolved through several replacement packages. Treat the current source files as the source of truth. Some older documents still describe the earlier wallet-session and dApp-triggered-only Snap model; the current implementation limits browser-wallet signing to the final ballot and gives Snap 0.4.1 its own cron/network path.

---

# 1. The 90-second explanation

Mini Galaxy is a gas-sponsored proxy-voting dApp for standard ERC-20 holders on Polygon Amoy.

For every voting event, the backend reconstructs token ownership at a historical record-date block from ERC-20 `Transfer` events. It converts each record-date balance into voting power using a configured token-to-vote ratio, constructs a Merkle tree, stores the detailed snapshot and proofs in Neon, and deploys a dedicated immutable `VoteEvent` contract containing only the Merkle root and event-critical configuration.

When a voter participates, the API returns the voter’s record-date balance and Merkle proof. The browser wallet signs one EIP-712 ballot containing the voter address and a hash of all selected options. A Render relayer pays gas and submits the signed ballot. The contract independently verifies the voting window, one-vote rule, Merkle eligibility, EIP-712 signature, option bounds, and voting weight before updating on-chain tallies.

Neon provides searchable metadata, durable jobs, proofs, receipts, and communications. R2 stores private PDFs. Vercel hosts the React UI. Render runs the API, durable in-process job runner, relayer, report generation, announcement recovery, and contract verification. A MetaMask Snap provides an optional persistent in-wallet inbox and background checks.

The memorable sentence is:

> **The blockchain is the integrity layer; Neon is the query and coordination layer; Render is the orchestration and gas-sponsorship layer; R2 is the private document layer; Vercel is the presentation layer; the Snap is the optional wallet inbox.**

---

# 2. Architecture

```text
                         ┌──────────────────────────────┐
                         │     React/Vite on Vercel     │
                         │                              │
                         │ Home / Organiser / Voting    │
                         │ Results / Notifications      │
                         └──────────────┬───────────────┘
                                        │ HTTPS
                                        ▼
┌──────────────────────────────────────────────────────────────────┐
│                 One Express service on Render                    │
│                                                                  │
│ REST API                         Durable in-process runner         │
│ - token inspection              - BUILD_SNAPSHOT                  │
│ - event/dashboard reads         - DEPLOY_EVENT                    │
│ - ballot preparation            - RELAY_VOTE                      │
│ - vote submission               - VERIFY_CONTRACT                 │
│ - documents/reports             - stale-job recovery              │
│ - communications                - announcement repair sweep       │
│                                                                  │
│ Relayer wallet                   PDF/report generator              │
│ - signs raw Polygon txs          - pdf-lib                         │
│ - sponsors POL                   - clickable PolygonScan links     │
└──────────────┬───────────────────────┬───────────────────┬─────────┘
               │                       │                   │
               ▼                       ▼                   ▼
       ┌───────────────┐       ┌───────────────┐  ┌─────────────────┐
       │ Neon Postgres │       │ Polygon Amoy │  │ Cloudflare R2   │
       │               │       │               │  │ private PDFs    │
       │ events        │       │ VoteEvent     │  └─────────────────┘
       │ snapshots     │       │ contracts     │
       │ jobs/votes    │       │ tallies       │
       │ comms/docs    │       │ VoteCast logs │
       └───────────────┘       └────────────────┘
               ▲                       ▲
               │                       │
               │                Alchemy JSON-RPC
               │                + indexed transfers
               │
               └─────────────────────────────────────────

Vercel dApp ── wallet_requestSnaps ──> MetaMask Snap 0.4.1
                                             │
                                             ├─ cron every minute
                                             ├─ fetch wallet inbox from Render
                                             ├─ verify signatures again
                                             ├─ persistent Snap state
                                             └─ in-app/native alert attempts
```

## Why one Render service?

The API and worker run in one process because the target deployment uses one Render web service. Jobs are not held only in memory: all state is in Neon, jobs are claimed with row locking, stale jobs are recovered, and relayer transactions are signed and saved before broadcast. A restart therefore resumes work instead of blindly repeating it.

## Why one contract per event?

Each event gets an isolated immutable `VoteEvent`. This avoids a mutable global “current event,” a factory registry dependency, role-heavy contract administration, and cross-event state coupling. The tradeoff is one deployment transaction per event.

---

# 3. Repository map

```text
apps/
  web/                    React/Vite frontend
    src/App.jsx           shell, routes, top bar, bell, network control
    src/wallet.jsx        Reown wallet state and the one ballot-signing method
    src/api.js            API/JSON/PDF transport helpers
    src/hooks.js          loading and live-refresh hooks
    src/notifications.jsx dApp notification polling/read state
    src/snap.js           Snap install/invoke/sync bridge
    src/pages/
      HomePage.jsx
      OrganiserDashboard.jsx
      VotingDashboard.jsx
      ResultsPage.jsx
      WalletComms.jsx
    src/components/UI.jsx reusable Page/Panel/Notice/Status/etc.
    src/styles.css        shared visual system

  api/
    src/server.js         Express composition and route/security boundary
    src/config.js         environment validation
    src/db.js             Postgres pool and transaction helper
    src/events.js         event creation, dashboards, views, results
    src/snapshot.js       record-date replay, reconciliation, Merkle snapshot
    src/erc20-ledger.js   pure mint/transfer/burn ledger logic
    src/jobs.js           durable queue operations and retry policy
    src/runner.js         in-process job loop
    src/deploy.js         VoteEvent deployment and immutable validation
    src/relayer.js        crash-safe signed raw transaction outbox
    src/votes.js          ballot context and signed-vote intake
    src/relay-vote.js     on-chain vote relay and VoteCast reconciliation
    src/tokens.js         ERC-20 interface/owner/deployment inspection
    src/verify.js         PolygonScan/Etherscan V2 verification
    src/communications.js event/token communication publication and inbox rules
    src/event-announcements.js automatic announcement generation/repair
    src/documents.js      private R2 PDF validation/storage
    src/reports.js        receipt/results PDF generation
    src/auth.js           retained legacy nonce/session routes
    src/security.js       Helmet/security headers
    src/validation.js     Zod request schemas
    src/serializers.js    API projection boundary
    test/                 ledger, announcement, route and signature-boundary tests

  snap/
    src/index.tsx         Snap state, cron fetch, verification, notifications, home page
    snap.manifest.json    permissions and production connection

packages/
  shared/
    src/canonical.js      deterministic event JSON + metadata hash
    src/merkle.js         leaf/tree/proof construction
    src/typed-data.js     EIP-712 ballot format
    src/proposal-config.js packed proposal option counts
    src/token.js          ratio -> raw units per vote
    src/communication.js  canonical communication signing text
    src/abi.js            minimal VoteEvent/ERC-20 ABIs

  contracts/
    contracts/VoteEvent.sol
    test/VoteEvent.test.cjs
    generated/            deploy and verification artifacts

db/migrations/           Neon schema evolution
render.yaml               API deployment
vercel.json               frontend build, SPA rewrite, security headers
scripts/                  syntax/import/structure/architecture checks
```

---

# 4. On-chain versus off-chain state

## On-chain — immutable integrity-critical state

`VoteEvent.sol` stores:

- creator address;
- ERC-20 token address;
- historical snapshot block;
- snapshot Merkle root;
- voting start and end;
- raw token units required for one vote (`voteUnit`);
- hash of canonical event/proposal metadata;
- packed option counts;
- `hasVoted[address]`;
- weighted proposal tallies.

It does **not** store:

- every eligible wallet;
- every balance;
- every Merkle proof;
- proposal strings;
- PDFs;
- communications;
- a privileged relayer address.

## Off-chain — availability, search, orchestration, and rich content

Neon stores the full event catalogue, proposal JSON, snapshot entries and proofs, job state, vote projections, communications, subscriptions, document metadata, and signed-transaction outbox.

R2 stores PDF bytes.

This leads to a key distinction:

> **Availability is mainly off-chain; integrity is anchored on-chain.**

If Neon changes Alice’s stored balance from 1,000 to 1,000,000, the contract rejects the proof because the leaf no longer reconstructs the immutable root. If Neon changes a proposal string, the canonical metadata hash no longer matches the immutable `metadataHash`. If Neon disappears, the contract state remains valid, but the current UI loses convenient proof/content delivery until restored from backups or exported data.

---

# 5. Smart contract deep dive

File: `packages/contracts/contracts/VoteEvent.sol`

## Constructor invariants

Deployment reverts unless:

- creator and token are nonzero;
- root and metadata hash are nonzero;
- snapshot block is strictly earlier than the deployment block;
- start is before end;
- end is still in the future;
- vote unit is positive;
- packed proposal configuration is valid.

The contract is intentionally immutable. There is no owner-only pause, no option editing, no snapshot replacement, no relayer role, and no vote recall.

## Proposal packing

The option configuration is packed into one `uint256`:

- low 8 bits: proposal count;
- then 4 bits per proposal: option count;
- limits: 1–32 proposals, 2–4 options each.

Why? The chain needs option bounds, not proposal text. Packing avoids a dynamic storage array and reduces constructor/storage overhead.

## Merkle leaf

The leaf commits to:

```solidity
keccak256(bytes.concat(keccak256(abi.encode(voter, snapshotBalance))))
```

It contains the wallet and **raw record-date balance**, not the derived voting power.

Why raw balance?

1. It is the objective historical fact being committed.
2. The immutable contract computes `snapshotBalance / voteUnit` itself.
3. The backend cannot change a derived `votingPower` value without failing the proof or the contract computation.

## Ballot signature

The EIP-712 type is:

```text
Ballot(address voter, bytes32 choicesHash)
```

The domain includes:

```text
name: PV VoteEvent
version: 2
chainId: 80002
verifyingContract: the specific event contract
```

This means a signature is bound to:

- the signer;
- the exact ordered choices;
- Polygon Amoy;
- one specific VoteEvent contract.

A signature cannot be replayed into another event contract or changed after signing.

## `castVote` checks

In order:

1. current timestamp is within the window;
2. the voter has not already voted;
3. one choice exists for every proposal;
4. the Merkle proof validates wallet + record-date balance;
5. EIP-712 recovery equals the voter;
6. derived voting power is nonzero;
7. every selected option is within the packed bound;
8. weighted tallies are incremented;
9. `VoteCast` is emitted.

## Why anyone can relay

`msg.sender` is intentionally not the voter and not a privileged relayer. The contract authenticates the **signed intent**, not the transaction sender. That lets the platform sponsor gas while avoiding an on-chain relayer role.

Excellent phrase:

> **Gasless is not signatureless: the holder signs intent; the relayer pays gas.**

---

# 6. Shared cryptography and canonical data

## `canonical.js`

The event title, description, proposals, options, indexes, and recommendations are normalized, key-sorted, JSON-serialized deterministically, and hashed.

The text remains in Neon for usability, while the hash is immutable on-chain. This is a gas-efficient content commitment.

## `merkle.js`

Steps:

1. checksum and lowercase wallet addresses;
2. stringify balances;
3. sort entries by wallet address;
4. double-hash each wallet/raw-balance leaf;
5. sort each hash pair before hashing;
6. duplicate the last node when a level has an odd count;
7. produce the root and one proof per entry.

A proof is the minimum sibling-hash path needed to reconstruct the root from one leaf. It is `O(log n)` rather than sending the full holder list.

## `typed-data.js`

Choices are encoded as one byte per proposal. The contract and frontend hash the same byte sequence. `ballotTypedData()` constructs the exact EIP-712 domain/types/message used for signing and recovery.

## `proposal-config.js`

Both JavaScript and Solidity implement the same compact proposal layout. Shared tests catch cross-layer encoding drift.

---

# 7. Event creation, end to end

Files:

- frontend: `apps/web/src/pages/OrganiserDashboard.jsx`;
- API route: `POST /v1/events` in `server.js`;
- domain logic: `events.js#createEvent`.

## Frontend

The organiser enters:

- ERC-20 address;
- token-to-vote ratio;
- event title and description;
- record date;
- voting window;
- authenticity claim;
- discovery mode;
- automatic announcement toggle/audience;
- 1–32 proposals, each with 2–4 options;
- optional PDFs.

The demo autofill fills the event/proposals/schedule but deliberately preserves the ERC-20 address and selected PDFs.

## Backend creation logic

`createEvent()`:

1. normalizes the supplied creator address;
2. enforces the per-wallet/day event limit;
3. inspects the token interface;
4. canonicalizes and hashes metadata;
5. packs option counts;
6. converts the natural ratio to raw token units:

```text
voteUnit = tokenToVoteRatio × 10^tokenDecimals
```

7. determines the authenticity status:
   - `COMMUNITY`;
   - `TOKEN_OWNER_VERIFIED` when an issuer-authorized claim matches token `owner()`;
   - otherwise `SELF_CLAIMED`;
8. inserts the event;
9. creates an automatic-announcement draft when enabled;
10. queues `BUILD_SNAPSHOT` in the same DB transaction;
11. wakes the runner.

Nothing is deployed inside the HTTP request. The API returns quickly with an event and job projection.

## Why queue snapshot work

Historical transfer replay, reconciliation, Merkle generation, deployment, confirmation, and source verification are long-running and failure-prone. They must be resumable, observable, and idempotent rather than tied to one HTTP request.

---

# 8. The snapshot technique

Files:

- `apps/api/src/snapshot.js`;
- `apps/api/src/erc20-ledger.js`;
- `packages/shared/src/merkle.js`.

## Step 1 — choose safe blocks

The code reads the latest block and subtracts the configured confirmation depth. This produces a recent validation block that is less likely to be reorganized.

It then binary-searches block timestamps to find the last block at or before the record-date timestamp.

## Step 2 — determine token history start

The API attempts to determine the token deployment block. If the contract was deployed after the record date, the event is invalid.

## Step 3 — retrieve indexed ERC-20 transfers

The current snapshot implementation calls Alchemy’s paginated `alchemy_getAssetTransfers` for ERC-20 transfers from deployment through the validation block.

It:

- requests ascending order;
- validates every result is in range;
- deduplicates by transfer identity;
- enforces an explicit page cap;
- records progress in the job.

## Step 4 — replay the ledger

A pure ledger applies:

- mint: zero address → holder, increasing derived supply;
- transfer: sender decreases, receiver increases;
- burn: holder → zero address, decreasing derived supply.

When replay first moves beyond the record-date block, it clones the ledger. The worker therefore obtains:

- the record-date ledger;
- a recent validation ledger;
- one continuous transfer-history read.

## Step 5 — reject incompatible tokens

The record-date ledger must have:

- no negative balances;
- nonnegative derived supply;
- sum of positive balances equal derived supply.

The recent ledger is then reconciled against live historical-state reads at the same validation block:

- derived supply must equal `totalSupply()`;
- every discovered address’s derived balance must equal `balanceOf(address)`.

This catches:

- incomplete transfer history;
- malformed mint/burn history;
- rebasing/reflection behavior;
- balance mutation without `Transfer` events;
- provider/indexer omissions.

The application rejects incompatible tokens instead of silently creating an approximate electorate.

## Step 6 — calculate voting power

```text
votingPower = floor(rawBalance / voteUnit)
```

Holders below one complete vote are excluded.

## Step 7 — build and store the Merkle snapshot

The worker builds the tree, stores rows in batches of 500, writes the root/block/count to the event, and queues `DEPLOY_EVENT` in one transaction.

Each Neon row stores:

```text
event_id
wallet_address
raw_balance
voting_power
merkle_proof
```

Why store proofs? A Merkle root is a commitment, not a reversible database. You cannot derive Alice’s balance or path from the root alone.

## Complexity and scaling

- transfer retrieval: proportional to token transfer history;
- reconciliation: proportional to discovered addresses, with bounded concurrency;
- tree build: `O(n log n)` in this implementation;
- voter proof size: `O(log n)`;
- on-chain verification: `O(log n)`.

The configured default history cap is 100,000 indexed transfers. This is suitable for a POC/modest token, not arbitrary high-volume mainnet assets.

---

# 9. Durable jobs and restart safety

Files:

- `jobs.js`;
- `runner.js`;
- `relayer.js`.

## Job types

```text
BUILD_SNAPSHOT
DEPLOY_EVENT
RELAY_VOTE
VERIFY_CONTRACT
```

## Queue invariants

Every job has a unique `dedupe_key`, status, attempts, max attempts, available time, progress, lock owner, and error/result data.

`claimJob()` uses `FOR UPDATE SKIP LOCKED`, so multiple processes do not claim the same row.

Stale `RUNNING` jobs can be returned to `PENDING` after their lock expires.

Transient failures use delayed retries. Permanent domain failures mark the event/vote appropriately.

## Why this is stronger than an in-memory queue

An in-memory promise or cron cannot survive process death. Here, Neon is the durable state machine. The in-process runner is only the executor.

---

# 10. Relayer and crash-safe transaction outbox

The relayer pays POL for event deployment and vote submission.

## Preparation

Before broadcasting, `relayer.js`:

1. checks whether the job already has a prepared transaction;
2. obtains a PostgreSQL advisory lock for nonce reservation;
3. compares the provider pending nonce with the highest DB-reserved nonce;
4. populates gas/fees;
5. signs the raw transaction;
6. derives its deterministic hash;
7. predicts the CREATE address for deployments;
8. saves nonce, raw bytes, hash, and predicted address in `relayer_transactions`;
9. only then allows broadcast.

## Retry behavior

If Render dies after signing but before broadcast, the next attempt finds the saved raw transaction and rebroadcasts the exact same bytes.

If the provider returns “already known” or “nonce too low,” the code checks chain state rather than preparing a second transaction immediately.

## Security boundary

The relayer can pay gas and choose whether/when to broadcast. It cannot forge a voter’s signature, fabricate a valid Merkle proof, change signed choices, or bypass contract option/window/duplicate checks.

A compromised relayer can cause availability/censorship or spend its own POL, but not create a cryptographically valid ballot for another holder.

---

# 11. Event contract deployment

Files:

- `deploy.js`;
- `artifact.js`;
- `verify.js`.

The deployment job:

1. loads the generated VoteEvent artifact;
2. constructs arguments from event/snapshot state;
3. prepares and persists the signed deployment transaction;
4. predicts the contract address;
5. broadcasts and waits for confirmations;
6. verifies bytecode exists;
7. reads every immutable getter back from the deployed contract;
8. compares chain values to the event configuration;
9. updates lifecycle status to `SCHEDULED`, `OPEN`, or `CLOSED`;
10. queues optional source verification;
11. publishes or repairs the automatic event announcement.

Reading immutables back is important: transaction confirmation alone proves execution, not that the expected configuration was deployed.

---

# 12. Voting flow

Files:

- frontend `VotingDashboard.jsx`;
- `wallet.jsx`;
- API `votes.js`;
- worker `relay-vote.js`;
- contract `VoteEvent.sol`.

## Page load

The API joins:

- event;
- latest lifecycle job;
- wallet snapshot entry;
- wallet vote.

If Neon lacks a good vote projection but the contract is deployed, the API can query `hasVoted(wallet)` to reconcile an on-chain-only vote.

## Ballot preparation

The API ensures:

- event exists and is deployed;
- voting is open;
- wallet has a snapshot entry;
- wallet has not already voted.

It returns the record-date balance, voting power, proof context, chain ID, and contract address.

## The only browser-wallet signature

`wallet.jsx` exposes a narrow `signBallot()` capability. The voting page builds the EIP-712 ballot and requests one typed-data signature.

Connecting, inspecting, creating, uploading PDFs, publishing platform communications, downloading reports, and switching the network do not use a message signature.

## API intake

`submitVote()`:

1. normalizes the voter;
2. loads event/snapshot context;
3. validates proposal count and each option index;
4. rebuilds the EIP-712 data;
5. recovers the signer;
6. rejects mismatch;
7. inserts or safely resets the unique `(event, voter)` vote projection;
8. queues `RELAY_VOTE`;
9. returns a queued receipt immediately.

## Worker relay

`relayVote()`:

1. loads event, vote, and snapshot proof;
2. runs a `staticCall` preflight against the contract;
3. prepares/persists a signed relayer transaction;
4. marks the vote `SUBMITTED` with deterministic hash;
5. broadcasts/waits;
6. finds and decodes `VoteCast`;
7. verifies the logged voter;
8. marks the vote `CONFIRMED`.

The UI can show the transaction hash before chain confirmation because the hash is known once the raw transaction is signed.

---

# 13. Results and reports

## Results

The API does not treat Neon as tally authority. After voting closes, `eventResults()` calls `getProposalTallies()` on the deployed contract for every proposal.

Access is currently limited by a supplied wallet address to:

- event creator; or
- a wallet with a confirmed vote projection.

## Receipt

The vote receipt contains:

- event/token information;
- record date and voting period;
- VoteEvent contract and verified PolygonScan URL;
- voter wallet;
- status and transaction hash;
- voting power;
- selected options and recommendations.

Receipt generation is gated on successful contract source verification.

## Results report

The creator gets:

- event details;
- participation statistics;
- on-chain proposal results;
- record-date holder register;
- appended supporting PDFs.

A confirmed voter gets:

- aggregate results;
- that wallet’s selections;
- appended supporting PDFs.

The current report writer provides explicit blue, underlined PDF links and URI annotations, keeps headings with following content, repeats table headers across pages, and keeps rows from splitting abruptly.

---

# 14. PDF documents and R2

Files:

- `documents.js`;
- migration 003;
- frontend organiser/voting pages.

Rules:

- maximum three documents per event;
- maximum 10 MB each;
- PDF extension/content type check;
- `%PDF-` magic check;
- pdf-lib parse validation;
- page count extraction;
- SHA-256 stored in Neon;
- object bytes stored in a private R2 bucket.

The browser uploads through Render, not directly to R2. The API also proxies reads/downloads, so no public bucket or browser-side R2 credential is required.

Failure handling is deliberate:

- if R2 upload succeeds but DB insert fails, the object is removed;
- deletion soft-marks metadata and removes the object; DB state is restored if object deletion fails.

---

# 15. Communications and notifications

There are three presentation destinations:

1. dApp notification inbox;
2. MetaMask Snap inbox/in-app notification;
3. best-effort native browser/OS notification.

## Message scopes

```text
EVENT — tied to one VoteEvent
TOKEN — general asset-level communication
```

## Categories

```text
EVENT_ANNOUNCEMENT
VOTING_OPEN
DEADLINE_REMINDER
DOCUMENT_UPDATE
RESULTS_AVAILABLE
GENERAL
```

## Event audiences

```text
ALL_ELIGIBLE
NOT_VOTED
SUBSCRIBERS
```

## Token audiences

The deployed database/code supports subscriber and current-holder delivery. Current-holder checks use live ERC-20 `balanceOf`.

## Current no-signature UI path

The current organiser UI calls platform publication routes. The API checks the supplied publisher address against event/token authority and uses the Render relayer to sign the canonical communication message. This means MetaMask does not open for communication publication.

Legacy wallet-signed communication routes remain in the API for compatibility but are not used by the current UI.

## Automatic announcement

At event creation, a stable draft/message ID is stored. Once deployment is ready, the relayer signs and inserts/upserts the communication. A 30-second recovery sweep repairs missing or stale announcement rows/signatures after restarts or earlier partial failures.

## Inbox filtering

Event messages are filtered using snapshot eligibility, event delivery mode, subscription, audience, and vote status.

Token messages can be filtered by subscription and/or current live holding depending on audience/category.

## DApp refresh

The current dApp uses an immediate load plus visible-tab polling and focus/visibility refresh. This avoids dependence on a long-lived stream through proxies that repeatedly closed EventSource connections.

---

# 16. MetaMask Snap 0.4.1

File: `apps/snap/src/index.tsx`.

## Permissions

The current Snap manifest gives it:

- dApp RPC permission for the production origin;
- network access;
- cronjob every minute;
- state management;
- notification permission;
- Snap home page.

## Background path

```text
cron fires
  -> read wallet/background state
  -> GET wallet-specific Render inbox
  -> validate every field
  -> rebuild canonical event/token signing message
  -> recover signer
  -> reject invalid, expired, future, wrong-chain, wrong-origin content
  -> deduplicate by messageId
  -> persist up to 100 messages
  -> attempt in-app and native notifications
```

Messages are persisted before presentation notifications are attempted. A native notification failure therefore does not lose the inbox item.

## State

The Snap keeps:

- selected wallet;
- background enabled flag;
- messages/read state;
- last check time;
- last fetch/alert error;
- native notification timing.

State is intentionally accessible to the background cron path; do not describe it as a confidential storage vault.

## Native notification limitation

`snap_notify(type: native)` is best effort. MetaMask can accept it while Brave/Chrome/Windows suppresses the visible toast. The authoritative outcomes are the dApp inbox and MetaMask in-app/Snap inbox.

## Origin coupling

The Snap validates the dApp action URL origin and trusts only the configured production dApp. Changing the production domain or API endpoint requires a new Snap package/version.

---

# 17. Frontend architecture

## App shell and routes

`App.jsx` provides:

```text
/                    Home
/home                Home
/voting              eligible events
/vote/:eventId       ballot/receipt
/organiser           create/manage events
/organiser/:eventId  event status/documents/deployment
/results             accessible closed events
/results/:eventId    detailed results/report
/notifications       announcements + organiser communication tools
/comms               legacy redirect
```

The topbar includes the Amoy network control, bell/unread badge, and compact wallet control.

## Wallet provider

Reown AppKit manages connection state. The custom provider intentionally exposes one signing capability: `signBallot()`.

## API transport

`api.js` centralizes:

- base URL;
- JSON parsing and normalized errors;
- optional retained Bearer session compatibility;
- PDF raw upload;
- PDF blob download;
- conservative GET retry behavior.

## UI state

`useLoad` handles load/reload state. Event pages use live refresh/polling while a job or verification is active. Notification read IDs are a browser convenience stored per wallet in localStorage.

---

# 18. Neon schema mental model

## `events`

One row is the full off-chain projection of an event: token metadata, content, canonical hash, record date, vote ratio/unit, discovery/authenticity/notification modes, snapshot root/count, deployment/verification state, and automatic-announcement state.

## `snapshot_entries`

The detailed electorate:

```text
(event, wallet) -> raw balance, voting power, Merkle proof
```

## `jobs`

Durable workflow state with dedupe, locks, attempts, progress, result, and errors.

## `votes`

One unique row per event/wallet, holding choices/signature and relayer/chain projection.

## `relayer_transactions`

The crash-safe raw signed transaction outbox.

## `communications` and `snap_subscriptions`

Published messages and per-wallet token-following preferences. Migration 002 expanded the original event-only communication schema to token scope; migration 003 added signed contract address and event announcement fields.

## `event_documents`

Private-object metadata, hash, size, page count, uploader, and soft-delete state.

## Legacy `auth_nonces`/`sessions`

These remain for backward-compatible authenticated routes. They are not the current UX boundary for organiser actions.

---

# 19. Security model — what is strong

## Cryptographic voting integrity

- raw balance and wallet are committed by Merkle root;
- immutable vote unit derives voting power on-chain;
- EIP-712 binds voter, exact choices, chain, and event contract;
- one vote per wallet is enforced on-chain;
- option bounds and time window are enforced on-chain;
- tallies are authoritative on-chain;
- relayer has no privileged contract role;
- event text is committed by metadata hash.

## Operational safety

- parameterized SQL;
- Zod validation;
- exact CORS allowlist;
- Helmet/security headers;
- body-size limits;
- wallet/IP rate limiting;
- private R2 bucket;
- PDF content validation;
- persisted jobs;
- persisted raw signed transactions;
- nonce advisory lock;
- idempotency keys;
- contract immutable read-back validation;
- source-verification gating for receipts.

---

# 20. The most important honest limitation

The user experience intentionally removed wallet signatures from organiser and report operations. Therefore, the current public organiser writes are **address-scoped, not cryptographically ownership-authenticated**.

The server verifies statements such as:

```text
publisherAddress == event.creator_address
```

but the public request itself does not prove the caller controls that address.

That means the POC’s voting integrity is strong, but organiser administration is not production-grade authorization. Before production, use one of:

- SIWE/session authentication;
- enterprise SSO/OIDC mapped to permitted wallets/issuer entities;
- RBAC/ABAC;
- signed admin actions;
- a controlled issuer portal/backend service identity.

Say this directly:

> **The voting plane is cryptographically authenticated; the current organiser control plane is an address-scoped POC convenience and must be replaced with enterprise identity and authorization before production.**

This answer will impress senior developers more than pretending the gap does not exist.

Other limitations:

- POC/testnet, not legally compliant proxy infrastructure;
- compatible standard ERC-20s only;
- transfer history and holder reconciliation have explicit scale caps;
- one Render free instance can cold-start and is not an SLA architecture;
- off-chain services are availability dependencies;
- privacy is limited: wallet addresses, weights, choices/signatures may be visible in service/chain data;
- relayer can censor/delay even though it cannot forge votes;
- Snap native OS notifications are not guaranteed;
- Snap production URLs are package-coupled;
- no contract upgrade/pause/emergency governance;
- migration/package/import changes must be deployed atomically.

---

# 21. Failure scenarios and answers

## Render crashes during snapshot

Job remains in Neon. A stale lock is recovered and the runner resumes/retries.

## Render crashes after deployment transaction is signed

The raw signed transaction and hash were stored before broadcast. The runner rebroadcasts the same bytes rather than reserving a new nonce and deploying twice.

## Render crashes after chain confirmation but before DB update

The saved hash/predicted address lets reconciliation discover the confirmed transaction/code and complete the projection.

## Neon is altered

Invalid balance/proof combinations fail against the root. Changed proposal text can be detected against `metadataHash`. Availability can still be disrupted.

## Alchemy returns incomplete transfer history

Recent derived supply/balance reconciliation fails; the token is rejected.

## Token rebases

Replayed `Transfer` state diverges from `totalSupply` or `balanceOf`, so snapshot creation fails.

## Voter transfers tokens after record date

No effect on this event. Rights are frozen by the historical snapshot.

## Could buyer and seller both vote after a post-record transfer?

Only the record-date wallet has a committed leaf. The buyer cannot prove eligibility unless independently present at record date.

## Relayer disappears

The contract allows anyone to relay a valid ballot. The current UI/API would need an alternate relayer or self-submit feature, but the signed ballot remains independently verifiable.

## R2 is unavailable

Event voting can still operate, but PDF upload/read/report append operations fail. It is an availability failure, not a tally-integrity failure.

## Snap fails

The dApp inbox remains. Snap is an optional delivery surface, not voting infrastructure.

---

# 22. Senior-developer questions and crisp answers

## Why Merkle instead of mappings on-chain?

A root is one commitment, while storing every wallet/balance requires `O(n)` writes and large gas. Each voter submits an `O(log n)` proof only when needed.

## Why not read current `balanceOf()` at vote time?

That violates record-date ownership. Transfers after record date would move voting rights incorrectly.

## Why commit raw balance, not voting power?

Raw balance is the historical fact; the immutable contract derives voting power from immutable `voteUnit`, eliminating trust in a backend-derived weight.

## Why store proofs in Neon?

The root is not reversible. The platform needs the original leaf data and sibling path to serve a ballot.

## Why store proposal text off-chain?

Rich text is expensive on-chain. The immutable metadata hash gives tamper evidence while Neon provides search/display.

## Why no relayer address in the contract?

The voter signature is authority. Any sender can submit it, avoiding a privileged/censorable contract role and allowing relayer replacement.

## Why use a job queue?

Snapshot/deploy/relay/verification outlive HTTP requests, need retries, progress, locking, and crash recovery.

## Why save raw transactions before broadcast?

To make nonce use and retries deterministic and prevent duplicate deployments/votes after crashes.

## Are results actually on-chain?

Yes. Result APIs call contract tally getters after close. Neon is not the tally source of truth.

## Is it decentralized?

Integrity is partially decentralized/on-chain; availability and orchestration are centralized in the current API/database/relayer. Do not call it fully decentralized.

## Is it production secure?

The voter plane has strong cryptographic checks. The no-signature organiser plane is a deliberate POC limitation and needs enterprise auth/RBAC before production.

## Why two communication signing models?

Legacy routes preserve organizer-wallet-signed messages. The current UX uses platform-signed routes to avoid MetaMask prompts. The latter proves platform issuance, while publisher identity is validated by the API’s address-scoped rules.

## Why a Snap if the dApp already has notifications?

The dApp is the web inbox. The Snap adds persistent MetaMask-local storage, signature re-verification, cron checks, and in-wallet presentation.

---

# 23. Five-hour study schedule

## 00:00–00:25 — learn the story

Memorize:

1. problem: record-date weighted proxy voting;
2. one immutable contract per event;
3. replay transfers → reconcile → Merkle root;
4. one EIP-712 signature;
5. relayer pays gas;
6. Neon coordinates, chain verifies;
7. honest POC admin-auth limitation.

Draw the architecture diagram from memory twice.

## 00:25–01:15 — contract and shared cryptography

Read:

```text
packages/contracts/contracts/VoteEvent.sol
packages/shared/src/merkle.js
packages/shared/src/typed-data.js
packages/shared/src/canonical.js
packages/shared/src/proposal-config.js
```

Be able to explain every `castVote` rejection and why the leaf contains raw balance.

Active recall:

- What stops replay across contracts?
- What stops weight inflation?
- Why can anyone relay?
- What changes the metadata hash?

## 01:15–02:15 — creation and snapshot

Read:

```text
apps/api/src/events.js
apps/api/src/snapshot.js
apps/api/src/erc20-ledger.js
apps/api/src/tokens.js
```

Draw the snapshot flow. Explain the difference between the record block and validation block.

Active recall:

- How are rebasing tokens rejected?
- Why is deployment block useful?
- What are the scaling limits?
- Why is transfer replay preferable to current balance?

## 02:15–03:00 — jobs, deployment, relayer

Read:

```text
apps/api/src/jobs.js
apps/api/src/runner.js
apps/api/src/relayer.js
apps/api/src/deploy.js
apps/api/src/verify.js
```

Focus on crash windows: before sign, after sign/before broadcast, after broadcast/before DB update.

Active recall:

- What prevents nonce races?
- What prevents duplicate deployment?
- Why read immutables after deployment?

## 03:00–03:45 — voting, results, PDFs

Read:

```text
apps/api/src/votes.js
apps/api/src/relay-vote.js
apps/api/src/reports.js
apps/api/src/documents.js
apps/web/src/pages/VotingDashboard.jsx
apps/web/src/pages/ResultsPage.jsx
```

Rehearse the exact point where the wallet signs and where the relayer signs.

## 03:45–04:20 — frontend, communications, Snap

Read:

```text
apps/web/src/App.jsx
apps/web/src/wallet.jsx
apps/web/src/pages/OrganiserDashboard.jsx
apps/web/src/pages/WalletComms.jsx
apps/web/src/notifications.jsx
apps/web/src/snap.js
apps/api/src/communications.js
apps/api/src/event-announcements.js
apps/snap/src/index.tsx
```

Be able to distinguish dApp inbox, MetaMask in-app alert, and native OS alert.

## 04:20–04:45 — security and limitations

Write two columns:

```text
Cryptographically enforced          Operational / POC trust
Merkle eligibility                  API availability
EIP-712 voter intent                organiser address-scoped writes
one-vote contract state             relayer availability
window/options/tallies              Neon/R2 availability
metadata hash                       legal/compliance controls
```

Practice saying the organizer-auth limitation confidently.

## 04:45–05:00 — presentation rehearsal

Rehearse:

- 90-second overview;
- 5-minute event-to-vote walkthrough;
- 3-minute security model;
- 2-minute production roadmap;
- five hostile questions from the Q&A sheet.

---

# 24. Suggested live-demo narration

1. **Home** — “The UI is wallet-contextual, but browsing and organiser reads no longer require an authentication signature.”
2. **Create event** — enter token, inspect standard ERC-20 interface, use dummy data, show ratio/schedule/proposals/PDF/announcement toggle.
3. **Create** — “The HTTP request stores deterministic metadata and queues a durable snapshot; it does not block on chain history or deployment.”
4. **Manage event** — show progress: record block, replay, reconciliation, Merkle root, deployment, verification.
5. **PolygonScan** — show one immutable VoteEvent and its constructor/getters.
6. **Eligible wallet** — “The page gets only this wallet’s snapshot row and proof.”
7. **Sign ballot** — “This is the only message signature in the current UX.”
8. **Receipt** — show deterministic tx hash, relayer sponsorship, then confirmation.
9. **Results** — after close, show on-chain weighted tallies and generated report.
10. **Notifications** — show dApp inbox, Snap inbox, automatic announcement, and explain native alerts are best effort.

---

# 25. Presentation language that sounds precise

Use:

- “record-date entitlement,” not “current token balance”;
- “gas-sponsored,” not simply “free”;
- “off-chain projection,” not “database truth”;
- “cryptographic commitment,” not “the root stores the list”;
- “idempotent recovery,” not “we retry it”;
- “address-scoped POC authorization,” not “fully authenticated organizer”;
- “platform-issued communication,” not “organizer-signed,” for the current no-prompt path;
- “best-effort native notification,” not “guaranteed browser notification”;
- “integrity decentralized/on-chain, availability centralized,” not “fully decentralized.”

Avoid claiming:

- legal proxy-voting compliance;
- arbitrary ERC-20 compatibility;
- full decentralization;
- guaranteed native notifications;
- production-grade organiser authorization;
- unlimited scale;
- that Neon is unnecessary;
- that the relayer is trusted to validate votes.

---

# 26. Production-hardening roadmap

1. Enterprise identity: OIDC/SSO + issuer RBAC or SIWE for organiser actions.
2. Separate API and worker processes on an always-on plan; retain Neon queue semantics.
3. Relayer key in managed KMS/HSM; policy controls, alerts, funding limits, rotation.
4. Multi-provider RPC/indexed-data fallback and reconciliation telemetry.
5. Exportable snapshot/proof bundle to reduce API availability dependence.
6. Independent/self-relay option for signed ballots.
7. Formal contract audit and property/fuzz testing.
8. Privacy design: minimize wallet/choice exposure, retention policy, encrypted sensitive data.
9. Legal/compliance workflow, issuer authorization, audit trails, records retention.
10. Observability: structured metrics, tracing, dead-letter handling, SLOs.
11. Web Push if reliable browser notifications are required; keep Snap as wallet inbox.
12. Migration/package/import consistency checks in CI to prevent mixed-version deployments.

---

# Final memory model

```text
CREATE
form -> canonical metadata -> Neon event -> BUILD_SNAPSHOT

SNAPSHOT
record block -> transfer replay -> current reconciliation -> voting power
-> Merkle root + per-wallet proofs -> DEPLOY_EVENT

DEPLOY
persist signed raw tx -> broadcast -> confirm -> verify immutables
-> optional source verification -> automatic announcement

VOTE
wallet proof -> EIP-712 choices signature -> API validation -> RELAY_VOTE
-> contract verifies proof/signature/window/options/duplicate -> weighted tallies

REPORT
on-chain tallies + Neon metadata/participation + R2 PDFs -> generated PDF

NOTIFY
platform-signed communication -> filtered Render inbox -> dApp + Snap
```

Your closing line:

> **The design deliberately keeps the smart contract small and authoritative over the facts that must not be trusted to the backend, while using conventional web infrastructure for search, documents, workflow, gas sponsorship, and user experience.**
