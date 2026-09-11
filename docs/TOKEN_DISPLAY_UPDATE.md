# Token-name links and ballot tags

## Baseline

Apply this overlay after `galaxy-token-catalogue-portal-update-20260910.zip` in the
original Galaxy project. It uses that delivery and the user's latest uploaded
investor source as the baseline. The withdrawn issuer-logo update is not included.
Merge folders and replace matching files; do not remove the existing project.
Back up any newer, uncommitted changes before overwriting complete files.

## Presentation change

The shared security identity displays `Tokenised stock: <name> (<symbol>)`.
The name/symbol is a blue link to the token contract using the configured explorer.
The full address is in the link's native browser hover tooltip and accessible
label, not printed in the page. There is no underline in normal, hover, focus or
visited states. The existing keyboard-focus outline remains. When no address is
available, the name renders as plain text rather than a broken link.

This shared display is used by the ballot, confirmation and meeting list.
Only the ballot opts out of platform tags. Confirmation tags and meeting-list
platform/participation tags remain. CUSIP, issuer name, deadline, header platform
logo and issuer logo remain unchanged. No logo asset is replaced.

## Previously requested issuer cleanup

The supported presentation presets, aliases, issuer search, artwork source lists,
import expectations and related tests now contain only the six supported issuers.
The removed preset is no longer maintained as a special case in search code.
The importer derives its filenames and success count from its current manifest.

Disney-specific bundled assets may still be present in a local checkout because
extracting a ZIP cannot delete old files. The offline pruning tool completes that
cleanup, removing only matching artwork in these managed directories:

- apps/web/public/issuer-logos
- apps/api/assets/issuer-logos
- docs/brand-sources

It also removes the retired entry from an optional installed-artwork.json while
preserving other records. It refuses active issuer IDs, path-like IDs, symlinked
parents and non-regular artwork files. Preview is the default; --apply is explicit.
It does not read a private key, access a database, contact the network, stage files,
or delete uploaded logos, historical events, snapshots, votes, or generated PDFs.
Historical events retain their stored name/theme and custom uploaded logos. An
old event that relied solely on the removed bundled preset uses the existing
name fallback instead of that deleted preset image.

## CMD after replacement

```bat
cd /d C:\Users\QureshiM\Desktop\mini-galaxy-pv-v2.1
git branch --show-current
git status --short
git switch -c pv-token-display-20260910
```

Stay on that branch when it already exists and is selected. Do not reset or
force-push. Preserve unrelated pending edits and review the changes below.

Preview and apply the previously requested asset removal:

```bat
node scripts/prune-issuer-artwork.mjs --issuer disney
node scripts/prune-issuer-artwork.mjs --issuer disney --apply
```

Already absent files are safe: the tool is idempotent. No network/font/artwork
import is required. Its log reports every removed path. A custom filename that
does not use the preset ID naming convention is not deleted automatically.

Run the new tests (11 tests):

```bat
node --test apps\api\test\token-display.test.js apps\api\test\issuer-artwork-pruning.test.js
npm run check:syntax
npm run check:imports
npm run test --workspace ./apps/api
npm run build:web
```

No dependency was added or changed. Existing TypeScript dev tooling is used for
JSX fixture tests, as in the repository's syntax checks. Repair a missing local
installation through your approved registry only when necessary; do not delete
or rewrite package-lock.json to silence a test failure.

Review and stage the replacement manifest, then the asset removals:

```bat
git diff --stat
git add --pathspec-from-file=docs/TOKEN_DISPLAY_FILES.txt
git add -u -- apps/web/public/issuer-logos apps/api/assets/issuer-logos docs/brand-sources
git diff --cached --name-only
git diff --cached --stat
git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
```

The second `git add` also sees pre-existing tracked changes in those three asset
folders; review the staged list and keep unrelated edits out of this commit.
The replacement manifest does not unstage anything already staged.

```bat
git commit -m "Refine token links and remove retired issuer preset" && git push -u origin pv-token-display-20260910
```

After local checks and review:

```bat
git switch main && git pull --ff-only origin main && git merge --ff-only pv-token-display-20260910 && git push origin main
git status
git log -1 --oneline
```

A refused fast-forward must be resolved by reviewing intervening work, not by
resetting the project. Deploy the resulting commit to Vercel and Render: the UI
is on Vercel, and the shared preset removal also affects the API's presentation
catalogue on Render. No migration, new environment variable, contract compilation,
contract redeployment, snapshot rebuild, or Snap release is required.

## Validation in the delivery environment

- New tests: 11 passed, 0 failed.
- Related focused set: 66 passed, 0 failed.
- Syntax and relative imports: 163 source files passed.
- Architecture audit: passed.
- Actual JSX compiled with TypeScript against fixture boundaries. Six Chromium
  header cases (ballot/confirmation at 1440, 768 and 390 pixels) verified no printed
  address, correct href/title, no default/hover/focus underline, retained focus
  outline, no overflow and ballot-only tag removal. These are isolated rendering
  checks, not real wallet/API or full-page brand-image tests. No claim is made of
  validating a browser-native tooltip's visual appearance.
- Full API invocation: 162 passed, 3 failed. Missing @pv/shared workspace
  installation, missing zod, and the baseline's absent Tesla artwork account for
  the three failures. The existing artwork test was not removed to hide this.
- Production Vite build: could not run because vite is not installed here.
- Live MetaMask, database, explorer and deployment integration were not run.

Snapshot, verification, deployment, relayer, signing/authentication, notification,
report generation, event mapping/CUSIPs, dependencies and database schemas are
outside this change. Existing reports are not regenerated or restyled.
