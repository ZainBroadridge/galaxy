# Token catalogue and portal refinement update

## Baseline and scope

Apply this overlay to the original Galaxy dApp with the investor/issuer redesign,
branding correction, verification/interface update, portal polish, and landing/voter
logo corrections already installed. It is not a complete repository or B20_CB fork.
The later issuer-logo correction that was withdrawn is NOT included or required.

The latest ten investor source files uploaded by the user on September 10 are the
baseline for this work. In particular, education-content.js, help-position.js,
InvestorData.jsx and InvestorSession.jsx are byte-identical to those uploads.
The meetings page had already lost its Back link; that manual change is preserved.

Merge the ZIP's apps/, packages/ and docs/ and db/ folders into the current repo.
Replace matching files only. Do not delete folders. Preserve installed issuer logos,
fonts, node_modules, environment files and generated contracts. The file manifest
lists every replacement and addition. Back up unrelated uncommitted edits first.

## Catalogue-driven event creation

The server is the only source of token-address mappings:

    apps/api/src/token-catalogue.js

The issuer-authenticated GET /v1/issuer/token-catalogue endpoint supplies the small
catalogue once Create Event opens. Issuer, platform and demo CUSIP use the existing
shared fuzzy dropdown. Selecting any one complete mapping fills its issuer name,
platform, underlying security, trading symbol, token address and CUSIP atomically.
Clearing or partially editing a selection clears its old mapping/address/CUSIP.
Create Event remains disabled until a configured mapping is selected. The address
is read-only in the form; administrators edit its source in the file above.
Automatic inspection and the manual Inspect button remain for configured tokens.

New choices are Coinbase and Dinari. Empty platform means issuer-sponsored tokens.
Historical Ondo/Kraken events are not rewritten or removed. The Coinbase mark is
copied from public/wallets/coinbase.svg in the user-supplied BA prototype ZIP.
Existing Dinari artwork/name fallback is retained; no new external download is needed.

The requested six-company total includes Alphabet, carried over from the existing
presets. Its catalogue entry defaults explicitly to Class A / GOOGL. Its token is
unconfigured pending an administrator-supplied address. SpaceX is a demo-equity
entry with no asserted public-market trading ticker. This catalogue does not verify
backing, legal ownership, issuer authorization, platform affiliation or production
availability. The Amoy addresses are supplied test fixtures, not live stock products.

## Demo CUSIPs

All identifiers are fictitious nine-character DEMO identifiers, not assigned,
validated or exchange-recognized CUSIPs. Do not use them for production records.

| Issuer | Issuer-sponsored | Dinari | Coinbase |
|---|---|---|---|
| Apple | DEMO01001 | DEMO01002 | DEMO01003 |
| Tesla | DEMO02001 | DEMO02002 | DEMO02003 |
| NVIDIA | DEMO03001 | DEMO03002 | DEMO03003 |
| Alphabet (Class A) | DEMO04001 | DEMO04002 | DEMO04003 |
| Oracle | DEMO05001 | DEMO05002 | DEMO05003 |
| SpaceX (demo) | DEMO06001 | DEMO06002 | DEMO06003 |

Initial token addresses, deliberately identical across each company's three entries:

    AAPL  0x682e82d5a3f0bbb81b7c086081bd757cd5b2c4b4
    TSLA  0xf3ba8da491a237cebef4fc0f95baa1483f2ae0dc
    NVDA  0xe35b668b6924e695fc3f746c76c6a4c7eed4b59f

Alphabet, Oracle and SpaceX currently use the explicit sentinel:

    0xffffffffffffffffffffffffffffffffffffffff

Those nine placeholder mappings are visible/selectable so the future catalogue can
be demonstrated, but BOTH the browser and server refuse inspection/event creation
for them. A missing mapping, changed address, wrong issuer/platform/CUSIP or wrong
chain is rejected before any database write, token inspection or snapshot job.
The server validates the current mapping again on submission. A stale client gets
TOKEN_MAPPING_MISMATCH and a Refresh token mapping action, rather than silently
switching assets while creating an event.

## Editing a mapping later

Open apps/api/src/token-catalogue.js and change only the desired listing, for example:

    AAPL: company(..., {
      ISSUER: listing('0x...', 'DEMO01001'),
      DINARI: listing('0xYOUR_NEW_40_HEX_DIGIT_ADDRESS', 'DEMO01002'),
      COINBASE: listing('0x...', 'DEMO01003'),
    })

The example address is illustrative: replace it with a real 42-character address
on Polygon Amoy. Each platform's tokenAddress and cusip is explicit and independent.
Keep each demo identifier unique. Run the catalogue tests, commit the file, and
redeploy Render. New form visits fetch the revised mapping; no frontend build is
needed for a pure address change. Existing events retain their stored token address,
CUSIP and mapping ID. No old snapshot, metadata hash or ballot is rewritten.
If changing fixture addresses intentionally, update the corresponding expected-address
regression fixtures as part of that reviewed change; do not weaken mismatch guards.

## Portal changes

- Login uses the supplied three-column composition: control number, account sign-in,
  wallet authentication. The first two are disabled previews: no credential collection,
  persistence, request or fake login is added. Only the existing wallet entry works.
  The page does not claim reCAPTCHA integration that this dApp does not implement.
- The visible Review and sign message and tokenholder-standing copy are removed.
  Actual readable disclaimer signing, challenge checking and backend verification
  remain unchanged. Error reporting and wallet-connection cancellation remain.
- Meetings has no redundant Back button. Investor sign-out is the small exit icon;
  it calls the existing signOut, including session revocation and wallet disconnect.
- Other Back controls render arrow + Back without an underline while retaining an
  accessible label describing their explicit destination. Issuer Home/Organiser list
  lose their redundant welcome/home links. Login-gate Back still returns to investors.
- Ballot and confirmation share a centered identity/header with a left-side Back.
  The repeated deadline is removed. Scheduled meetings still show their opening time.
- Tokenised stock is labeled explicitly, with the full clickable token contract
  address beside the token name. Demo CUSIP appears for catalogue-created events.
- New option labels are limited to 24 characters and one line in the creation API
  and form. Equal-width choice columns use extra horizontal room for long/4-option
  rows, then stack at narrow breakpoints. Old signed/deployed option text is never
  truncated or renamed; unusually long legacy labels can wrap for accessibility.
- Ready creation displays Completed + Successfully created event, without a 100%
  progress bar. Genuine snapshot/deployment progress remains. Source verification
  continues independently through the existing recovery/defer logic.
- Results title and token subtitle center independently of issuer-logo width and
  the download action. The redundant Closed badge in the detail header is removed.
- Dummy proposals are company-neutral and preserve selected mapping, logo and PDFs.

Unchanged: actual snapshot computation, verification/runner behavior, vote protocol,
contracts, wallet signing/authentication, notification recipient logic, existing
PDF receipt/report layout and blue links, shared footer, logo corrections, dependency
versions and hosting configuration. No font binaries are included.

## Deployment

Both Render and Vercel must update. Apply migration 008 before the updated API
serves event creation. Existing migrations through 007 remain prerequisites.
No contract compilation/redeployment, Snap release, dependency change, asset-sync
command or new environment variable is required. See TOKEN_CATALOGUE_DEPLOYMENT.md.
