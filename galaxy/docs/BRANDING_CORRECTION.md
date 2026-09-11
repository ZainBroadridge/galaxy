# Galaxy issuer-branding and landing parity correction

## Baseline and packages

Prepared against the original Galaxy git-archive commit
`eb6dad8396c65fc5fcafff193d7a8a90aec597b3` plus the prior
`galaxy-investor-issuer-redesign-eb6dad8-20260908.zip` replacement. The BA design
source remains `shared-version-synthetic-pv.zip`. This is NOT a B20_CB update.

Use the correction ZIP on top of the previous investor redesign. The consolidated
replacement ZIP includes both the previous redesign and these corrections for a
checkout starting from the original archive. Do not mix the two manifests. Each
ZIP supplies `docs/BRANDING_RELEASE_FILES.txt` for its exact file set.

## Implemented correction

- The event brand band now uses issuer identity, never Ondo/Kraken platform logo.
  Meeting rows, ballots, confirmation, issuer result displays, PDF receipts and
  PDF results all share the issuer logo resolver.
- Apple and NVIDIA use the two supplied SVGs, converted to matching transparent
  PNGs for browser/PDF. Five other real-logo sources are provided via a validated,
  one-time importer, NOT placeholder wordmarks.
- Official issuer names, listed-security names and tickers are distinct from the
  token name/symbol. Known share classes are explicit; Alphabet is not guessed.
- The additive 007 migration stores security presentation fields. Existing hashes,
  proofs, ballots and contracts are not rewritten.
- PDF letterhead belongs only to the issuer. Body headings, links, callouts and
  table headers use issuer ink; page rules use its accent; gray is neutral.
  Broadridge is credited once per page in a small gray footer, not in letterhead.
- The sign-in consent details panel, extra authentication explanation and added
  testnet note are removed from the landing DOM. The backend challenge, full
  readable MetaMask message, nonce verification and signature requirement are
  unchanged. Canceling the signature still does not log the investor in.
- The BA heading, intro, three steps, button, assurance sentence, help popover and
  original tokenholder-standing footnote are retained verbatim. That original
  footnote is NOT the removed sign-in consent panel; it remains for design parity.
- The top-right Issuer arrow remains. No demo account or fake BA voting endpoint
  replaces Galaxy authentication or the actual ballot.

## Asset preflight - mandatory

Only Apple and NVIDIA bitmaps are already in the delivered ZIP. The other five
PNGs and self-hosted font files must be imported on your approved build network:

```bat
node scripts/sync-issuer-artwork.mjs
node scripts/sync-investor-font.mjs
node scripts/check-issuer-branding.mjs
```

The last command MUST pass. No pending-image state is treated as release-ready.
The source manifest, download URLs, offline option and naming references are in
`ISSUER_ARTWORK.md`. Do not bypass corporate networking or TLS controls to fetch
these files; use the approved network or internally approved image copies.

## Landing comparison

Actual BA login/header/wallet/help JSX was rendered for the signed-out idle state
with Tailwind generated from its classes. Actual modified Galaxy landing/header/
help JSX was rendered with Galaxy's real stylesheets. Client/provider hooks and
closed popovers were fixture stubs, not a live Next.js or wallet connection.
Both views used the same installed Roboto font and viewport in Chromium.

At 1440x1000, 768x1024 and 390x844, all measured header, lockup, panel,
introduction, eyebrow, heading, lead, steps, CTA, assurance, help and footnote
bounding boxes had zero x/y/width/height displacement. The background photograph
is byte-identical. The intentional Issuer link was excluded from pixel comparison.
Small raster/compositing differences remained (no compared pixel channel differed
by more than 8/255). This is not a guarantee that different browsers/fonts render
identical pixels. Repeat the real-browser check after font import and Vite build.

Receipt previews execute the actual receipt/writer functions against a drawing
API harness and render the recorded operations through PyMuPDF. They use explicit
layout-preview data and are not real voting receipts or an end-to-end pdf-lib test.

## Boundaries

The correction does not modify Solidity, typed-data or ballot signatures, investor
or issuer auth, wallet connection, snapshot.js, RPC, job runner, notification
recipient policy, browser push, the existing shared styles.css, dependencies,
lockfile or hosting configuration. It does modify issuer presentation fields and
both front/backend presentation, so deploy both services after migration 007.
The preceding redesign's v4 compilation/migration requirements still apply if it
has not yet been deployed. The correction does not resolve any earlier missing
compiled artifact by relabeling legacy bytecode.
