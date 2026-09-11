# Branding correction validation - 8 September 2026

## Executed here

- New correction and existing mocked authentication tests: 15 passed, 0 failed.
  This includes legal-name normalization, explicit share-class matching, custom-logo
  precedence, unchanged historical data, Apple/NVIDIA file hashes and parity,
  bounded artwork requests, rejection of HTML/block pages, font URL policy,
  popover positioning and preservation of the readable sign-in message.
- Package reapplication: the consolidated ZIP over the original archive matches the corrected sources.
- Node/TypeScript syntax: 133 files passed.
- Relative import resolution: 133 files passed.
- Architecture audit: passed in the working tree and on a clean consolidated ZIP reapplication.
- Actual-source landing fixture comparison: 1440x1000, 768x1024, 390x844.
  All 12 measured regions have zero geometric displacement; no horizontal overflow.
  This uses static hook/provider stubs and local Roboto, not a live Next.js build.
- Apple and NVIDIA receipt layout harness: one page each, six link annotations,
  text bounds inside the page. Rendered/visually inspected. Actual production
  pdf-lib embedding and PDF download remain to be exercised after npm ci.
- Protected auth, signature, snapshot, contract, dependency and original stylesheet
  files are unchanged relative to the previous redesign.

## Not a full-suite pass

The full API command ran 97 tests: 94 passed, 3 failed. Two could not import the
uninstalled workspace/dependency packages (`@pv/shared` and `zod`). The third is
intentionally the configured-artwork test: required PNGs were not installed in
this container. It was NOT disabled or weakened to manufacture a green suite.

The asset release gate correctly fails for the five unimported logo files and
missing self-hosted Roboto CSS. The Vite build could not start (`vite: not found`).
External downloads into this editing environment are unavailable. No production
build, actual database migration, actual MetaMask popup, or real pdf-lib receipt
is represented as tested. No hardhat compile is necessary for the CORRECTION alone,
but the original redesign still requires its v4 compilation if not done earlier.

## Required before release

1. Restore dependencies with the repository's locked versions and approved registry.
2. Import and review all configured logos and self-hosted fonts; pass the asset gate.
3. Apply additive migration 007 to staging (006 must already be applied).
4. Run the full API suite and production web build with no failures.
5. Create an Apple event and an NVIDIA event; then exercise the other five presets.
6. Verify the MetaMask consent message and cancellation; no extra consent panel.
7. Compare the actual deployed login at desktop and mobile widths.
8. Download an actual receipt and result report and verify issuer branding, data,
   clickable links, custom-upload override and tiny neutral provider attribution.
9. Check existing events and both Alphabet share classes; no historical hash changes.
