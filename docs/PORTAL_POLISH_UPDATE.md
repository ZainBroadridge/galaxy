# Portal layout and navigation update

## Baseline and application

Apply over the existing Galaxy project with the investor/issuer redesign, branding correction, and `galaxy-verification-interface-enhancements-20260909.zip` already applied. This is a replacement overlay, not a new repository or B20_CB fork. Complete files are included. Merge the apps/, packages/, and docs/ folders into the project root; do not delete other files.

Save uncommitted work separately before replacing files. Retain existing secrets, node_modules, generated contracts, issuer artwork, and installed fonts. No database migration, dependency version change, contract compilation/redeployment, Snap publication, or asset-download command is introduced.

## Behavior

| Area | Change |
| --- | --- |
| Creation feedback | The server's EVENT_LIMIT response dismisses after 30 seconds. A new Create Event attempt clears the previous error and can display a fresh response. Other errors remain visible. The server-side daily limit remains enforced. |
| Build completion | Completed is the creation badge once snapshot and validated deployment are ready. Voting status is separate and updates at the scheduled start/end and when a background tab returns. No stored voting dates or status are changed to fake completion. |
| Ballot | Removed Meeting Agenda, the current-balance explanatory line, and the standalone reconnect control. Submit still verifies wallet identity and fetches a fresh ballot. When disconnected, Submit opens the existing wallet flow; the investor then presses Submit again after connecting. Connecting alone never signs or submits. |
| Options | Fieldsets contain explicit responsive layout grids. New option labels have an 80-character limit, shared by form/API validation. Existing event labels are displayed in full and wrap; their hashes, stored labels, and signed vote text are not truncated. |
| Documents | Centered help icon, responsive document cards, and hyphen-separated PDF metadata. |
| Navigation | Explicit same-app back destinations work in new tabs. The authenticated welcome route supports returning from My Meetings without signing out or creating a redirect loop. |
| Meetings | Removed verbose loading/ordering paragraphs. Memory-only, session-scoped data reuse and background refresh avoid a blank reload on return. Tabs filter locally. Eligible-event data prefetches on pointer/focus. Accepted votes update cached participation from the real POST response, not from a simulated confirmation. |
| Footer | One issuer-style grey footer is rendered once at the application root, after route content, across both interfaces and their login/loading routes. |
| Branding | One font-free SVG mark replaces the stretched small raster and constructed text variants. Non-inverse investor brand bands use off-white #f6f5f1; the landing blue header is retained. |
| Issuer form | Removed the enclosing card and the top Required fields legend; field asterisks and all form contents remain. Platform and issuer inputs use the same accessible fuzzy combobox. The exit symbol is 18px inside its existing button. |
| Reports | Generated PDF link text and underlines use blue #2a6ba2. Existing URI annotations, issuer-colored letterhead, and all other report styling remain. Appended source documents are not rewritten. |

The ProxyVote SVG follows the outline of the supplied project mark, converted to scalable paths. It contains no embedded raster, text-font dependency, external URL, or font binary. It is a vector conversion of the supplied reference, not a claim to be a newly obtained official vector master.

First-time network requests, Render cold starts, wallet interactions, RPCs, and transaction confirmation still take real time. Caching reduces repeated navigation waits; it does not claim zero network latency or serve another wallet's data. Cached display data never replaces the fresh ballot authorization request. Signing and chain confirmation are unchanged.

## Validation performed

35 focused tests passed (portal refinements plus existing verification/interface/footer tests).
153 JS/JSX/TS files passed syntax and relative-import validation. Architecture audit passed.
The complete API command reported 125 passed and three environment/baseline failures: missing @pv/shared workspace installation, missing zod, and the previously absent Tesla preset file in the provided archive. These tests were not disabled or made to accept missing assets.
The Vite production build could not run because vite is not installed in the working environment.

Chromium rendered fixture markup evaluated from the actual component JSX and the real stylesheets at 1440, 768, and 390 pixels for ballot, meetings, and confirmation. All nine checks had no horizontal overflow and exactly one footer. The create form also had no horizontal overflow at 1440 and 390 pixels, no outer card/legend, and equal-width issuer/platform fields. Hook data and wallet actions were fixtures, not a live React/MetaMask integration test. No pixel-perfect equivalence or production deployment is claimed.
The PDF link drawing method was executed with instrumented page/font/annotation objects for red, green, and black issuer themes. Blue text/underline and preserved hyperlink targets passed. Actual pdf-lib file generation still needs the existing installed dependencies.

## After replacing files: CMD

```bat
cd /d C:\Users\QureshiM\Desktop\mini-galaxy-pv-v2.1

git branch --show-current
git status --short
git switch -c pv-portal-polish-20260909

node --test apps\api\test\portal-refinements.test.js apps\api\test\interface-enhancements.test.js apps\api\test\explorer-verification.test.js apps\api\test\verification-workflow.test.js apps\api\test\event-browser-push-footer-snap-boundary.test.js
npm run check:syntax
npm run check:imports
npm run build:web
npm run test --workspace ./apps/api
```

Use the existing dependency installation; repair missing dependencies only through the approved corporate registry configuration. Do not remove package-lock.json or disable SSL validation. Do not interpret a failed build as a successful deployment.

```bat
git diff --stat
git add --pathspec-from-file=docs/PORTAL_POLISH_FILES.txt
git diff --cached --name-only
git diff --cached --stat
git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check

git commit -m "Refine portal layout navigation and completion feedback" && git push -u origin pv-portal-polish-20260909
```

Review previously staged files as well: the manifest stages only this package but does not unstage unrelated work.

When local checks and the review commit are satisfactory:

```bat
git switch main && git pull --ff-only origin main && git merge --ff-only pv-portal-polish-20260909 && git push origin main
git status
git log -1 --oneline
```

If fast-forward fails, stop and reconcile intervening changes normally. Do not reset or force-push.

Both Render and Vercel need this commit. Render receives the PDF link color and new-event option limit; Vercel receives the interface and shared display behavior. No migration or contract update is required. Do not rerun logo/font download scripts for this package.

## Acceptance checks

Open a completed event: creation says Completed even if voting starts later. At voting start, Voting status changes to Open without rebuilding the snapshot or refreshing manually.

Attempt creation after the actual daily limit: the notice dismisses after 30 seconds, while another attempt still receives the enforced server limit.

Submit a valid ballot, return to meetings, and verify the event is in Recently Voted with its actual queued/confirmed status. Switching tabs or returning uses the same session cache. Signing out clears that cache. A different investor never sees the old cache.

Check long legacy options and new 80-character options, keyboard radio selection, Board/Reset controls, one/two/three documents, help alignment, and the compact shared footer at desktop/mobile widths.

Open the generated receipt and result report: link text and underlines are blue, clickable targets are unchanged, and issuer letterhead colors remain.
