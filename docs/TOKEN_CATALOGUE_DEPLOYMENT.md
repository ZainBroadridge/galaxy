# Apply and deploy (VS Code Command Prompt)

These steps assume you merged and replaced the ZIP files in the current original
Galaxy checkout. A branch preserves commits, not overwritten uncommitted edits;
keep a separate backup of uncommitted work before replacement.

## 1. Inspect and branch

```bat
cd /d C:\Users\QureshiM\Desktop\mini-galaxy-pv-v2.1
git branch --show-current
git status --short
git switch -c pv-token-catalogue-20260910
```

Skip branch creation if already on that exact branch. Do not reset other branches.

## 2. Test existing installation

```bat
node --test apps\api\test\token-catalogue.test.js apps\api\test\token-catalogue-workflow.test.js apps\api\test\catalogue-portal.test.js
npm run check:syntax
npm run check:imports
npm run audit:architecture
npm run test --workspace ./apps/api
npm run build:web
```

The three new test files report 21 passes. A broader regression command is:

```bat
node --test apps\api\test\token-catalogue.test.js apps\api\test\token-catalogue-workflow.test.js apps\api\test\catalogue-portal.test.js apps\api\test\portal-refinements.test.js apps\api\test\interface-enhancements.test.js apps\api\test\explorer-verification.test.js apps\api\test\verification-workflow.test.js apps\api\test\landing-logo.test.js
```

Expected 57 passes. Do not treat a failed Vite build as a usable release. No npm
install is required by this change. If the existing dependency installation needs
repair, use the organization's approved registry configuration and existing lockfile;
do not delete/rewrite the lockfile or turn off certificate verification.

## 3. Add database fields

Use the same Galaxy database; do not reset it. With the correct database URL and
existing migrations already tracked, the migration runner applies the new file:

```bat
npm run db:migrate
```

New file: db/migrations/008_event_token_catalogue.sql. It adds two nullable columns
and one index; old records remain untouched.

When your workstation cannot connect directly to Neon, run this equivalent block
in the Neon SQL Editor for the correct project/database. This block does NOT apply
older migrations; migrations through 007 must already be installed.

```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('pv-v2-schema-migrations'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS token_catalogue_id varchar(100);
ALTER TABLE events ADD COLUMN IF NOT EXISTS cusip varchar(9);
CREATE INDEX IF NOT EXISTS events_cusip_idx ON events(cusip) WHERE cusip IS NOT NULL;
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(filename)
VALUES ('008_event_token_catalogue.sql')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
```

Verify:

```sql
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'events'
  AND column_name IN ('token_catalogue_id', 'cusip');
SELECT filename FROM schema_migrations
WHERE filename = '008_event_token_catalogue.sql';
```

Expected: two nullable columns and the migration filename. Do not run db:reset.

## 4. Stage the exact overlay

```bat
git diff --stat
git add --pathspec-from-file=docs/TOKEN_CATALOGUE_UPDATE_FILES.txt
git diff --cached --name-only
git diff --cached --stat
git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
```

The manifest does not unstage earlier unrelated files. Review the entire staged
list. Original CRLF conventions are retained where present.

## 5. Commit/push the review branch

```bat
git commit -m "Add issuer token catalogue and refine portal flows" && git push -u origin pv-token-catalogue-20260910
```

## 6. Promote after local checks

```bat
git switch main && git pull --ff-only origin main && git merge --ff-only pv-token-catalogue-20260910 && git push origin main
git status
git log -1 --oneline
```

Stop if fast-forward fails. Do not reset or force-push. Use the repository's
approved network/proxy configuration.

## 7. Deployment order and smoke tests

Apply 008 first. Deploy Render and Vercel to the same new commit; coordinate the
change because an old frontend does not send the new required mapping fields.
Use the existing services, relayer and environment values. No real contracts or
snapshots need redeployment to gain these UI changes.

Check:
- Control-number/email controls do nothing; wallet still signs the real disclaimer.
- Issuer Apple + blank platform fills DEMO01001; Dinari DEMO01002; Coinbase DEMO01003.
- Searching a Tesla CUSIP fills issuer/platform/token together.
- Partial edits clear the old mapping and disable creation until selected.
- Oracle/Alphabet/SpaceX placeholders show not-configured and cannot be inspected
  or created. Configured token inspection still runs normally.
- Dummy agenda contains no Galaxy/company-specific copy and does not reset mapping.
- New event row contains token_catalogue_id and cusip. Older events still render.
- Ballot shows a linked token name with its address on hover and no platform tag; Back is aligned and not underlined.
- Completed creation shows success, no progress bar; voting lifecycle stays separate.
- Results headings are centered; PDF downloads retain their existing design.

Later token-address changes require editing apps/api/src/token-catalogue.js and
redeploying Render. Do not change existing events to match new addresses.
