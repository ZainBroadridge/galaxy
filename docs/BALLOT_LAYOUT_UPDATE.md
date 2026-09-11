# Ballot layout, token display and cumulative PDF selection

## Baseline and scope

Apply to the current Galaxy project with the 2026-09-10 token catalogue installed.
The earlier token-name-tooltip / ballot-tags / retired-issuer cleanup overlay is
included, so it need not be installed separately. This is not a full repository.
The withdrawn issuer-logo fix was not applied. The baseline is the supplied
Galaxy archive, the investor/issuer redesign, the subsequent supplied overlays,
and the user's individual investor-file edits supplied before the catalogue.
No later GitHub HEAD was fetched or assumed. Preserve other local changes.

## Changes

- The token name is a new-tab explorer link; its title exposes the address on hover.
  No full address is printed and no underline is shown. Focus visibility remains.
- Platform tags are hidden only in the ballot identity; the platform header logo,
  issuer logo, CUSIP, deadline, and other pages' tags remain.
- The ballot heading and normal-color ProxyVote marks share the existing BLUE
  wallet-address-bar gradient (#0076b0 / #0067a0 / #00588f). The off-white logo
  band remains off-white; the inverse landing mark remains white. The raster
  artwork is not retraced and no additional source resolution is claimed.
- Every proposal uses full-width answer tracks underneath its text. The maximum
  option count for the entire ballot sets the desktop and print columns, not each
  proposal's own count or label length. Missing positions stay unoccupied; there
  are no fake inputs or selectable blank choices. Columns collapse together at
  narrow screen widths (two below 768px, one below 480px). Existing text is not
  shortened or clipped. Normal demo labels stay on one line; exceptionally long
  historical labels may wrap safely. The existing new-option limit stays 24.
- Empty meeting categories are centered.
- Only the separate CUSIP explanation sentence was removed; Demo CUSIP labels and
  fictitious mapping identifiers remain, and no identifier is represented as real.
- Both Create Event and Manage Event append PDF selections up to three total.
  Saved documents count against the limit. Duplicate picker entries are detected
  by filename, byte length and last-modified timestamp (not a content hash).
  Cancel, an invalid file or an oversized batch never erases the previous choices.
  The native input resets after each picker action, enabling removal/reselection.
  Existing buttons, labels and selection list design are unchanged.
- During management uploads, each successful file leaves the pending queue;
  retrying a partially failed batch does not resend already-successful files.
  Upload/delete actions are otherwise unchanged. The server's PDF parsing and
  three-document limit remain authoritative.
- Retired issuer presets, aliases and artwork-import entries remain removed.
  Run the existing opt-in offline pruning command to delete old bundled artwork.
  Stored events, votes, uploads and previous receipts are not deleted.

## Apply

Back up uncommitted changes before replacing full files. Extract apps/, packages/,
scripts/ and docs/ into the existing root; merge folders rather than delete them.
Keep .env, installed logos/fonts, node_modules and generated contracts intact.

Command Prompt after replacement:

```bat
cd /d C:\Users\QureshiM\Desktop\mini-galaxy-pv-v2.1
git branch --show-current
git status --short
git switch -c pv-ballot-layout-20260910
```

Skip the switch if already on that exact branch. Do not reset existing work.
Complete old-artwork cleanup (offline, idempotent, no database access):

```bat
node scripts/prune-issuer-artwork.mjs --issuer disney
node scripts/prune-issuer-artwork.mjs --issuer disney --apply
```

Run the focused tests (26 passed in the supplied-source check tree):

```bat
node --test apps\api\test\document-selection.test.js apps\api\test\ballot-grid.test.js apps\api\test\token-display.test.js apps\api\test\landing-logo.test.js
npm run check:syntax
npm run check:imports
npm run test --workspace ./apps/api
npm run build:web
```

No new dependencies or asset downloads are needed. Use the existing approved
installation. A failed local build is not a successful release; keep the error
output for diagnosis rather than deleting the lockfile or changing versions.
No database migration, contract compilation/redeployment, or Snap release is
required. Do not run db:reset or rebuild existing snapshots for this UI update.

Stage only the update and the intentional artwork deletions:

```bat
git add --pathspec-from-file=docs/BALLOT_LAYOUT_FILES.txt
git add -u -- apps/web/public/issuer-logos apps/api/assets/issuer-logos docs/brand-sources
git diff --cached --name-only
git diff --cached --stat
git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
git commit -m "Align ballot choices and accumulate PDF selections" && git push -u origin pv-ballot-layout-20260910
```

Review the entire staged list: the manifest does not unstage earlier work.
After local checks pass and the review commit is ready:

```bat
git switch main && git pull --ff-only origin main && git merge --ff-only pv-ballot-layout-20260910 && git push origin main
git status
git log -1 --oneline
```

Stop on a refused fast-forward; do not reset or force-push. Deploy the same commit
to Vercel and Render so the included shared issuer-preset cleanup stays aligned.
Vercel receives all new ballot and PDF-picker runtime behavior. Existing Render
snapshot, verification, relayer and document/receipt implementations are retained.

## Validation actually performed

- 26 focused selection / layout / token-display / logo tests passed.
- 45 focused and related catalogue / portal tests passed.
- Full API: 177 passed; three environment/baseline failures remained: missing
  @pv/shared workspace installation, missing zod, absent tesla-brand-v2.png in
  the source copy. Your installed image is not overwritten by this package.
- Node/TypeScript syntax and relative imports passed in 166 source files.
- Architecture audit passed across 274 source/configuration files before adding
  this delivery guide.
- Chromium rendered actual component markup and CSS with fixture wallet/API data
  at 1440, 1024, 820, 640, 540, 390 and 320px. Identical per-proposal tracks,
  radio x-position alignment, single-line demo labels, blue heading/mark colors,
  centered empty state, tooltip-only address, and zero ballot tags were checked.
  No horizontal overflow was found. A print-mode grid was checked at A4 width.
- Those are offline layout fixtures, not a live React/Vite/MetaMask/backend test.
- A production Vite build was attempted and unavailable (vite not installed).
  The local build command above remains necessary. No live token transaction,
  authentication, R2 upload or deployment was attempted.

## Acceptance checks

1. Select one PDF, reopen the picker and add a second, then a third. All remain.
2. A fourth or invalid PDF produces an error while retaining the prior three.
3. Remove a file and reselect the same file. It returns normally.
4. Manage an event with two saved PDFs: only one additional file is accepted.
5. View a ballot containing both three- and four-option proposals. The first
   three circles occupy the same columns, and the fourth uses the fourth track.
6. Select manually, use Vote with Board and Reset All. Neither shortcut submits.
7. Hover/focus the token name; its full address is not printed. Clicking opens
   the token contract. The ballot platform tag is absent, not its header logo.
8. Check a generic meetings page and the inverse landing: blue versus white
   ProxyVote marks remain readable, and empty meeting text is centered.
9. Sign and relay a test ballot through the existing workflow before promotion.
