> Branding correction, 8 September 2026: also follow `BRANDING_CORRECTION_DEPLOYMENT.md`.
> Current validation and pending asset imports are recorded in `BRANDING_CORRECTION_VALIDATION.md`.
> The original redesign requirements below still apply on first installation.

# Apply and deploy the Galaxy investor / issuer redesign

## 0. Protect the working application

Use the original Galaxy repository, NOT B20_CB. Base commit:
`eb6dad8396c65fc5fcafff193d7a8a90aec597b3`.
The replacement ZIP has `apps/`, `packages/`, `db/`, `scripts/`, and `docs/` at its
root. Extract over that repository; do not delete any other files or directories.
Existing CRLF line endings are preserved; the whitespace check below explicitly accepts CRLF while still rejecting trailing spaces.
No secrets or node_modules are supplied. No force push or reset is needed.

For initial testing, use a separate empty test database, test relayer, and preview
frontend/API. Do not run a second job runner against copied live pending jobs or
share a relayer nonce stream between independently running test/production APIs.
Keep the original service available until the local and staging checks below pass.

## 1. After replacing files: CMD

```bat
cd /d C:\Users\QureshiM\Desktop\mini-galaxy-pv-v2.1
git branch --show-current
git rev-parse HEAD
git status --short
git branch backup-before-investor-issuer-redesign
git switch -c investor-issuer-redesign
```

The hash should match the archive base. If it does not, review/merge the replacement
against the newer source instead of blindly overwriting unrelated work. A backup
branch preserves the committed base, not unrelated uncommitted edits.

## 2. Install, compile, test, build -- STOP on any failed command

Use the organization's approved JFrog/npm configuration on work laptops. No new
package or dependency version was added. Do not delete package-lock.json.

```bat
npm ci --include=dev --no-audit --no-fund
npm run clean --workspace ./packages/contracts
npm run compile
node scripts/check-investor-release.mjs
npm run test --workspace ./packages/contracts
npm run test --workspace ./packages/shared
npm run test --workspace ./apps/api
npm run check:syntax
npm run check:imports
npm run check:structure
npm run audit:architecture
npm run build:web
git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check
```

Compilation MUST regenerate both:

```
packages/contracts/generated/VoteEvent.json
packages/contracts/generated/VoteEvent.verification.json
```

The existing Render install/start configuration does not compile Solidity. The two
newly generated files must therefore be committed. The source package intentionally
does not include fabricated or uncompiled v4 bytecode. Before compilation,
check:structure and check-investor-release will correctly reject stale artifacts.
Do not use the old full `npm run check` ordering to bypass this prerequisite.

The Hardhat tests include correct readable tally/logs; invalid proof, signature,
option and text; duplicate voting; domain isolation; identical-option-label index
substitution; long ballots; and compatibility with the archived v3 deployment.
These tests require the real dependency installation and compiler.

## 3. Database migration

For an existing Galaxy database apply ONLY the new additive migration:

```
db/migrations/006_investor_issuer_interfaces.sql
```

Take a database backup first. It does not delete events, balances, snapshots,
proofs, votes or jobs. Do NOT run `npm run db:reset`.

When the normal migration tracker already records 001-005 and the configured
connection points to the intended database:

```bat
npm run db:migrate
```

For an office network that blocks the direct database connection, use the Neon
SQL Editor. Paste the following as ONE transaction: `BEGIN;`, then the complete
contents of 006, then this tracking block and `COMMIT;`:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(filename)
VALUES ('006_investor_issuer_interfaces.sql')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
```

Do not paste a stand-alone COMMIT after a failed SQL statement; inspect errors and
rollback first. On a fresh EMPTY staging database, run the normal migration runner
for all migrations in order. Never point staging at the production database.

Verification query:

```sql
SELECT filename FROM schema_migrations
WHERE filename = '006_investor_issuer_interfaces.sql';
SELECT to_regclass('public.issuer_sessions'), to_regclass('public.issuer_logos');
SELECT column_name FROM information_schema.columns
WHERE table_name='events' AND column_name IN
 ('issuer_name','token_platform','issuer_logo_preset','issuer_logo_id','issuer_theme_color');
```

## 4. Local or staging settings

No new mandatory environment-variable key. Existing values must be consistent:

- Backend: DATABASE_URL (and DATABASE_URL_DIRECT for migrations), RPC_HTTP_URL,
  RELAYER_PRIVATE_KEY, CHAIN_ID=80002, WEB_APP_URL, CORS_ORIGINS, R2 keys,
  explorer key, and the existing Web Push keys.
- Frontend: VITE_API_BASE_URL, VITE_REOWN_PROJECT_ID, VITE_PUBLIC_RPC_URL,
  VITE_BLOCK_EXPLORER_URL and existing optional Snap settings.

WEB_APP_URL and CORS_ORIGINS must include the EXACT served origin, with the correct
scheme and no trailing path. A preview URL is a different session origin. The
frontend must use the same environment's API, not the live API accidentally.

With staging values set locally, run API and frontend in separate terminals:

```bat
npm run dev:api
```

```bat
npm run dev:web
```

## 5. Acceptance checks

1. Open `/` disconnected. Confirm BA-style landing, working education links, and
   Issuer arrow. Cancel the wallet request and retry without a locked spinner.
2. Connect wallet. Read the disclaimer. Decline signing: no investor session.
   Sign it: genuine server verification then meetings. Old/replayed challenge
   must fail. A wallet change must not expose another wallet's authenticated view.
3. Confirm Active, Recently Voted and Past against real snapshot entries; test
   unvoted expired, voted expired, pending-vote and scheduled cases.
4. Open `/issuer`; wrong password rejected, `broadridge` admitted. Without its
   token, direct Create Event / upload / management API requests return 401.
5. Inspect a token, use existing autofill, select issuer/platform; try each preset
   and a valid uploaded PNG/JPEG. Test invalid, oversized and internally corrupt
   image files. Verify form symmetry at desktop and narrow widths.
6. Create a FRESH v4 event with a valid record date and enough time before closing.
   Follow real snapshot progress; no page refresh. The stale snapshot-start notice
   must disappear after completion. Check the new deployment is verified.
7. Eligible investor: review uploaded documents. Compare record-date power and
   current holdings; transfer tokens after record date and confirm voting power
   does not move. A balance-display error must not bypass eligibility.
8. Vote with Board selects every recommendation and scrolls, but never submits.
   Missing one recommendation hides it. Reset clears selections.
9. Submit one ballot. Inspect actual proposal and option names in MetaMask. Reject
   signing: no vote. Accept: show queued/submitted state then confirmed. Verify
   `VoteCast` contains validated text and on-chain tallies match the choices.
10. Confirm same event is no longer Active. Return to Active using the confirmation
    button. No Change Vote button. Refresh shows persisted real vote status.
11. Print/download receipt: check actual PDF contains issuer image, BR mark,
    wallet, proposal selections, dates, voting power and working explorer links.
    Download the issuer result report after close and check the same letterhead.
12. Test one existing v3 event separately; old contract still accepts the legacy
    signature/call, without a promise of retrofitted v4 human-name logs.
13. Check existing issuer announcement publication, investor inbox, Web Push,
    optional Snap, notification deep links, and a signed-out user's return path.

## 6. Commit only the intended source and generated artifacts

```bat
git status --short
git diff --stat
git diff -- apps/api/src/snapshot.js apps/web/src/styles.css package.json package-lock.json
git add --pathspec-from-file=docs/INVESTOR_REDESIGN_FILES.txt
git add packages/contracts/generated/VoteEvent.json packages/contracts/generated/VoteEvent.verification.json
git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
git diff --cached --stat
git diff --cached --name-only
git commit -m "Separate investor and issuer portals with readable ballots"
git push -u origin investor-issuer-redesign
```

The protected-files diff should be empty unless YOU have unrelated local edits.
Do not erase those edits with a blanket restore. Review all staged files.

## 7. Promote after the checks pass

Migration 006 must exist before the updated API serves investor/issuer requests.
Coordinate Render and Vercel deployment: the old frontend does not supply the new
session headers, and the new frontend cannot use the old authentication endpoints.
Use a short planned maintenance window or deploy both in staging first.

```bat
git switch main
git pull --ff-only origin main
git merge --ff-only investor-issuer-redesign
git push origin main
```

If fast-forward fails, stop and merge/review the intervening work; do not force
push. Confirm both Render and Vercel run this same release commit, then perform
acceptance checks against the actual service.

No existing VoteEvent is overwritten or redeployed. New events use v4. No Snap
publication or change to Alchemy pagination is required by this package.

## Rollback caveat

Do not delete migration 006 or old vote rows. Once v4 events exist, reverting to an
old backend that understands only v2/v3 can make those new events unusable through
the dApp. Retain version-aware backend support when planning rollback. Keep the
backup branch and database backup until the new flow is accepted.
