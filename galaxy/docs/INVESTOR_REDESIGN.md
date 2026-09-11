# Galaxy investor / issuer redesign

## Source and scope

This replacement is based on the user's `git archive HEAD` export, commit
`eb6dad8396c65fc5fcafff193d7a8a90aec597b3`. It modifies the original Galaxy project,
not B20_CB. The visual source is the supplied `shared-version-synthetic-pv.zip`.
The BA login/meetings/agenda/confirmation/education presentation is ported to the
existing React/Vite application. Its mocked account, demo voting endpoints,
sessionStorage ballots and placeholder document links are NOT used as live data.
No second application framework or package dependency is introduced.

## Release status

The current branding correction has additional asset preparation and migration 007
requirements. `BRANDING_CORRECTION_VALIDATION.md` supersedes the earlier validation
for these changed presentation files.

Implementation and runnable checks are supplied. This is a review/test release,
not an audited or fully integration-validated production release. Read
`INVESTOR_REDESIGN_VALIDATION.md` before deploying. The generated contract files
must be compiled and exported locally; old v3 bytecode is deliberately not
relabeled as v4. `node scripts/check-investor-release.mjs` blocks that mistake.

## Routes

| Route | Purpose |
|---|---|
| `/`, `/login` | Investor wallet connection and readable disclaimer sign-in |
| `/meetings` | Eligible Active / Recently Voted / Past meetings |
| `/vote/:eventId` | Real investor ballot |
| `/vote/:eventId/confirmation` | Persisted queued, submitted, failed or confirmed vote state |
| `/education` | Adapted BA education content and working external resources |
| `/notifications` | Investor inbox, preserving existing push/Snap integration |
| `/issuer` | Server-checked demo password entrance |
| `/issuer/home` | Existing Galaxy-style homepage and rotating heading |
| `/organiser`, `/organiser/:eventId` | Existing issuer event creation/management |
| `/results`, `/results/:eventId` | Existing results interface in issuer shell |
| `/issuer/notifications` | Existing issuer communication interface |

`/voting`, `/home`, and `/comms` remain compatibility aliases where applicable.
The landing-page link is **Issuer**, resolving the earlier Investor/Issuer label
ambiguity in favor of the described organiser destination.

## Investor authentication

The default sign-in session is 24 hours, controlled by the existing
`SESSION_TTL_HOURS` configuration. A random, single-use, expiring challenge binds
the wallet, origin, chain, issue/expiry timestamps and disclaimer version. The
backend verifies the actual wallet signature before issuing an opaque token;
only its SHA-256 hash is stored in Neon. Nonce consumption and session creation
are transactional. Older sessions lacking the new disclaimer version are not
accepted. Account changes invalidate the investor session; sign-out revokes it.

The consent signature is NOT a vote, token transfer, token approval, or permission
to access a private key. Voting still requires its own explicit signature.
Session storage is per browser tab; a fresh tab can require sign-in. Existing
browser-alert bindings are not deleted by investor sign-out.

## Issuer authentication

The requested demonstration password is `broadridge`, checked on the server,
not merely compared inside React. Issuer sessions expire after four hours and
issuer mutations require the session header. Password attempts are rate limited.
This shared, publicly known password is NOT issuer identity verification, SSO,
production access control, or proof that the wallet represents a corporation.
Issuer actions remain wallet-address-scoped behind that demonstration gate.
Replace this model with enterprise authentication/authorization before real use.

## Meeting classification and voting

Active: record-date eligible, unvoted, not expired, and permitted by the existing
discovery policy. Order by deadline; not-yet-open events are labeled scheduled.
Recently Voted: persisted non-failed participation, latest first, including a
queued/submitted status while the relayer is working. Past: expired eligible
events, whether voted or not, most recent deadline first. Recent and Past may
both contain a voted, expired event because they answer different questions.

A current-token-holding display uses one live `balanceOf` read for the signed-in
investor. It never changes the record-date Merkle leaf or voting power. A failed
live balance read displays Unavailable/Retry without blocking an otherwise valid
ballot. No holder-by-holder snapshot reconciliation was reintroduced.

Vote with Board appears only when every recommendation is a valid option index.
It selects and scrolls; it never signs or submits. Reset All clears local choices.
The BA's default-vote and change-vote behavior is not copied: Galaxy still requires
one selection per proposal and permits only one final confirmed vote.

## Ballot protocol v4

The legacy contract used a readable indexed string such as Proposal 1 = Option 2.
New v4 contracts additionally bind the complete proposal and selected option text.
Each signed VoteSelection contains:

```
proposalNumber  uint256   (one-based)
proposal        string    (deployment title + optional description)
optionNumber    uint256   (one-based)
selectedOption  string    (deployment option label)
```

The EIP-712 domain includes chain ID and event contract address. The contract
checks proposal/option numbers and text hashes fixed in its constructor before
checking the signature and tallying. This also prevents changing the index when
two option labels happen to be identical. The event emitted by a new deployment is:

```
VoteCast(address indexed voter, uint256 votingPower, string selectedOptions)
```

Example text:

```
Proposal 1: Election of Director

Proposal description
Selected option: For

Proposal 2: Appointment of Auditor
Selected option: Abstain
```

`AnnouncedProposals` remains the previous explorer-friendly tuple shape.
Long proposal text increases calldata, signing payload size and gas. New deployment
also stores text hashes; it is not free compared with the old indexed-only ballot.

Existing v2/v3 event deployments cannot be upgraded by replacing source files.
Their correct legacy signer/call format remains supported. They do NOT acquire
readable v4 historical logs. Existing v3 verification artifacts are archived under
`packages/contracts/legacy`. Missing v2 verification source is reported explicitly,
not replaced with incorrect v4 source. Use a FRESH event for v4 acceptance testing.

## Issuer data, logos, reports

New event fields separate issuer name, tokenization platform, logo and theme.
Old events retain their existing data and fall back to the token name where issuer
metadata is absent. No issuer/platform relationship is guessed from a token ticker.

PNG/JPEG uploads are restricted to 512 KiB and 2048 x 2048 / 4 megapixels. Headers
and image decoding are checked server-side; SVG and arbitrary remote logo URLs
are not accepted. Custom logos are stored in Neon and used by both the investor
pages and report writer. The existing R2 PDF-document pipeline is unchanged.

**Artwork correction:** use the user's supplied Apple/NVIDIA vectors and the
versioned sourced-logo catalog. The five other PNGs require the one-time import
step; fonts are self-hosted by a separate import command. Generated issuer-name
wordmarks are no longer referenced. Listed-security fields are added in migration
007. Read `BRANDING_CORRECTION.md`, `BRANDING_CORRECTION_DEPLOYMENT.md` and
`ISSUER_ARTWORK.md` before deployment.

The print control downloads the actual server-generated PDF receipt, not a browser
print of a mock confirmation page. Open that PDF to print. The same report writer
adds issuer letterhead, theme accent and Powered by Broadridge branding to receipts
and organiser reports. All existing receipt fields, selections and links remain.
A queued vote is never labeled confirmed merely because a signature was accepted.

## Security / compatibility boundaries

- This changes authentication requirements on investor and issuer endpoints;
  deploy frontend and backend together after migrating the database.
- Existing background notification, subscription, Snap and push endpoints retain
  their previous address-scoped behavior. This release does not claim those
  previously public channels are confidential or completely authenticated.
- The public event-progress stream and document-reader behavior are unchanged.
- Brand names and platform tags do not prove a live partnership or legal rights.
- Smart-contract wallets / arbitrary ERC-1271 signatures are not added; the
  original EOA-signature model remains.
- No B20 contracts, multiplier logic, revoting, payout logic, or snapshot redesign.

## Source boundaries deliberately retained

`apps/api/src/snapshot.js`, `rpc.js`, `runner.js`, `jobs.js`, `relayer.js`,
`event-announcements.js`, `communications.js`, the recipient-policy module,
`apps/web/src/hooks.js`, browser-push/Snap code, `styles.css`, existing migrations,
package manifests, lockfile, and hosting configurations are byte-identical to the
provided baseline. The snapshot-start notice is suppressed only in its UI when
the completed snapshot root is present.

## Reference documentation

These external references explain signing formats; the supplied archives remain
the application and design baseline:

- https://docs.metamask.io/wallet/how-to/sign-data/
- https://eips.ethereum.org/EIPS/eip-712
- https://www.shareholdereducation.com/
