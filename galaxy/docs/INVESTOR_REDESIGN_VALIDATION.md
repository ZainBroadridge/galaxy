> Branding correction, 8 September 2026: also follow `BRANDING_CORRECTION_DEPLOYMENT.md`.
> Current validation and pending asset imports are recorded in `BRANDING_CORRECTION_VALIDATION.md`.
> The original redesign requirements below still apply on first installation.

# Validation record - 2026-09-08

## Actual results in the working environment

| Check | Result |
|---|---|
| New dependency-free interface/policy/format tests | 13 passed |
| New auth tests with explicitly mocked database and signature recovery | 5 passed |
| Combined focused command | 18 passed, 0 failed |
| Complete API test command | 87 total: 85 passed, 2 failed to import unavailable dependencies |
| Syntax check | 127 files passed (103 Node, 24 JSX/TypeScript) |
| Relative imports | 127 source files passed |
| Architecture audit | Passed |
| Whitespace check accepting the original CRLF convention | Passed |
| Artifact release gate before compilation | Correctly rejects stale v3 generated artifact |

The two API imports that could not run were `event-announcements.test.js` (missing
`ethers`) and `future-record-date-validation.test.js` (missing `zod`). No tests
were disabled or skipped to turn that full-suite result into a claimed pass.
`npm ci` was attempted but could not fetch the dependency installation in this
environment. No dependencies or package lock versions were changed.

## Rendered UI fixture checks

Actual redesigned JSX modules were transpiled with the installed TypeScript
compiler and rendered in Chromium with controlled Router/API/session/wallet data.
The fixture renderer used locally available React 18.2; the project remains pinned
to its existing React 18.3.1. These are useful UI checks, NOT a production Vite
build or a real wallet/API integration test.

Desktop 1440 x 1050: login, meetings, ballot, confirmed receipt, queued receipt,
education, issuer home and issuer form rendered without JS exceptions or
horizontal overflow. Mobile 390 x 844: login, meetings, ballot, receipt and issuer
form did the same.

Actual UI handler checks in those fixtures:

- Vote with Board selected all five recommended radio values, enabled submission
  and scrolled to the submit section. It did not call ballot/sign/submit APIs.
- Reset All cleared all selections and disabled submission.
- One missing recommendation removed the board shortcut.
- Active / Recent / Past fixtures classified into their expected rows.

Screenshots were inspected. The images contain clearly synthetic test data and
are not screenshots of deployed production behavior.

## PDF layout check

The actual reports.js report-writing functions ran against recording drawing
adapters, standard Helvetica metrics and fixture database/event records. The
resulting drawing operations were rendered with ReportLab and inspected as page
images: one-page receipt, two-page results report, no out-of-page text. This
checks letterhead/layout/link rectangles, NOT the unavailable real pdf-lib
embedding/serialization, actual database reads or R2 appended-document path.

## Not executed here - mandatory before release

- Clean Hardhat / Solidity compilation and artifact export.
- Real ECDSA/EIP-712 shared-package and contract tests, including v3 compatibility.
- Full API suite with actual project dependencies installed.
- Production Vite build with the project's locked dependencies.
- PostgreSQL migration execution, session/nonce transactions under a real database.
- MetaMask sign-in, account switching, signing display and real Amoy voting.
- Real png/jpeg decoding and receipt generation through pdf-lib / R2.
- Coordinated Render and Vercel deployment acceptance test.

Source tests for these paths are included; their presence is not a claim that they
passed. Follow `INVESTOR_REDESIGN_DEPLOYMENT.md` and stop on any failed check.

## Preserved source fingerprint

The supplied baseline commit is eb6dad8396c65fc5fcafff193d7a8a90aec597b3.
Snapshot, progress hooks, durable runner, relayer transaction plumbing, public
notification policy, old shared CSS, package/lock files and hosting configuration
were byte-compared with the provided archive and are unchanged. See the source
manifest and replacement SHA-256 list for the exact delivery scope.

## External links checked

The supplied education SEC statement link, Shareholder Education, Broadridge
Accessibility, Privacy Statement and Terms of Use links resolved to their named
pages through the web reader. Corporate proxy/browser policy can independently
block external destinations; application code cannot override that policy.
