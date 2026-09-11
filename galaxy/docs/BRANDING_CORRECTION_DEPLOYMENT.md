# Apply and deploy the issuer-branding correction

The correction ZIP layers over the previous investor redesign. The consolidated
ZIP layers over the original Galaxy source and also includes that redesign. In
both cases, replace the files in your ORIGINAL Galaxy repository, not B20_CB.
No remote repository or deployment was modified by this delivery.

## 1. CMD after replacement

```bat
cd /d C:\Users\QureshiM\Desktop\mini-galaxy-pv-v2.1
git branch --show-current
git status --short
git branch backup-before-issuer-branding-correction
git switch -c issuer-branding-correction
```

Review any already-uncommitted work. The backup branch records the current commit,
not unsaved/uncommitted file contents. Keep your pre-replacement files separately
when those contained local changes.

## 2. Dependencies and mandatory asset preparation

Use the approved npm/JFrog configuration. Run npm ci when dependencies are missing:

```bat
npm ci --include=dev --no-audit --no-fund
node scripts/sync-issuer-artwork.mjs
node scripts/sync-investor-font.mjs
node scripts/check-issuer-branding.mjs
```

Stop at any failure. Only the supplied Apple/NVIDIA PNGs are already bundled.
The importer retrieves the other five, validates them for browser and PDF, and
writes identical copies to both asset locations. --from-dir supports approved
local PNGs as documented in ISSUER_ARTWORK.md. Fonts are self-hosted after import;
no font binaries are in the delivered ZIP. Commit the generated assets after review.
Never disable TLS validation or corporate controls to make these commands pass.

## 3. Database migration

With the intended STAGING database in DATABASE_URL / DATABASE_URL_DIRECT:

```bat
npm run db:migrate
```

Migration 007 adds only security_name and security_ticker. On first deployment of
the prior redesign, 006 must be applied as well. Do not run db:reset.

If direct DB access is unavailable and 001-006 have already been applied, use the
Neon SQL Editor for this single transaction (review the target DB first):

```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('pv-v2-schema-migrations'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS security_name varchar(240) NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS security_ticker varchar(24) NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(filename)
VALUES ('007_listed_security_presentation.sql')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
```

Verify:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='events' AND column_name IN ('security_name','security_ticker');
```

## 4. Tests and production build

```bat
node --test apps\api\test\issuer-branding-correction.test.js apps\api\test\investor-auth.test.js
npm run test --workspace ./apps/api
npm run check:syntax
npm run check:imports
npm run audit:architecture
npm run build:web
```

All commands must pass. The dedicated correction/auth tests expect 15 passes.
The full count can change as other tests are added; require fail 0.

The correction itself does NOT change VoteEvent.sol or the signing protocol.
If applying the consolidated package before the original redesign was compiled,
also complete its required v4 artifact build/validation:

```bat
npm run compile
node scripts/check-investor-release.mjs
npm run test --workspace ./packages/contracts
npm run test --workspace ./packages/shared
npm run check:structure
```

Do not deploy v4 Solidity source with old generated ABI/bytecode.

## 5. Review and stage exactly this delivery

```bat
git diff --stat
git diff -- apps/api/src/snapshot.js apps/web/src/wallet.jsx package.json package-lock.json
git add --pathspec-from-file=docs/BRANDING_RELEASE_FILES.txt
git add apps/web/public/issuer-logos apps/api/assets/issuer-logos apps/web/public/investor/fonts docs/brand-sources/installed-artwork.json
git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
git diff --cached --stat
git diff --cached --name-only
```

For the correction alone, the protected-files diff is empty. The consolidated
package legitimately includes the earlier redesign's wallet/signature work, not
new wallet changes from this branding correction. Review the staged file set.
The old name-only logo filenames, if left by the earlier patch, are unreferenced;
the importers/loaders never select them.

When you regenerated the v4 artifacts during first-time installation, stage them:

```bat
git add packages/contracts/generated/VoteEvent.json packages/contracts/generated/VoteEvent.verification.json
```

Then:

```bat
git commit -m "Correct issuer branding and match investor landing reference"
git push -u origin issuer-branding-correction
```

## 6. Staging and promotion

Deploy the same tested commit to both frontend and backend with a separate empty
staging DB and test relayer. Do not start another worker on production pending jobs.
Review the acceptance checklist in BRANDING_CORRECTION_VALIDATION.md.

Once approved and with the database migration applied before serving updated API:

```bat
git switch main
git pull --ff-only origin main
git merge --ff-only issuer-branding-correction
git push origin main
```

If fast-forward fails, stop and review intervening changes. Do not force-push.
This correction needs Vercel and Render updates, not new Snap publication or an
additional contract deployment. A first-time original redesign release still has
its coordinated auth/contract compatibility requirements.
