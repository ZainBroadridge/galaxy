# Issuer artwork and listed-security labels - correction, 8 September 2026

## What is supplied and what must be imported

The former generated name-only PNGs are no longer used. The catalog and both image
loaders reference versioned `*-brand-v2.png` files. This avoids reusing cached fake
wordmarks. This is the original Galaxy investor redesign, not B20_CB.

Apple and NVIDIA use the user's original SVG artwork, preserved under
`docs/brand-sources/`. Their PNG counterparts preserve the source aspect ratio,
transparency and colors; the browser and PDF copies are byte-identical. SHA-256
values are pinned in `artwork.json` and tested. No public SVG upload endpoint was
added; issuer uploads remain validated PNG/JPEG.

The other five logos were located and visually checked on the web. Binary downloads
into this editing container were unavailable. They are NOT silently replaced with
newly drawn marks and are NOT included as if already downloaded. Import them once:

```bat
node scripts/sync-issuer-artwork.mjs
```

The importer uses the recorded PNG sources, verifies HTTP status, maximum size,
PNG dimensions, and actual `pdf-lib` image decoding, then writes identical web/API
files. No runtime image hotlinks are used. The importer fails rather than deploy a
block page or fabricated logo. It records installed hashes for review in
`docs/brand-sources/installed-artwork.json`.

An approved-network/offline alternative is:

```bat
node scripts/sync-issuer-artwork.mjs --from-dir "C:\approved-issuer-logos"
```

That folder should contain `tesla.png`, `alphabet.png`, `disney.png`, `spacex.png`,
and `oracle.png`. The two supplied, pinned images are reused. Every PNG must be at
most 512 KiB and within the existing image dimension limits. Review the images
before committing them. Public availability is not authorization for production
use of a trademark. Obtain your team's artwork approval before public deployment.

## Sources

Apple and NVIDIA: the user-supplied SVGs. Remaining downloadable sources and exact
PNG URLs: `docs/brand-sources/artwork.json`. They are Wikimedia Commons copies
whose source records link to issuer materials, not an assertion that Wikimedia is
the brand owner. Relevant issuer source sites include the Tesla gallery,
Alphabet's investor materials, Disney's annual reports, SpaceX, and Oracle's brand
resources. Preserve the original mark; do not typeset the issuer name as its logo.

## Names and share classes

The legal issuer name and the underlying listed security are separate from the
on-chain token's name/symbol and from a platform such as Ondo or Dinari. The following
common-equity presets were researched on 8 September 2026. They are a small
presentation catalog, NOT a complete security master or an assertion of token
backing, issuer affiliation, or statutory voting rights.

| Legal issuer | Ticker | Security class |
|---|---|---|
| Apple Inc. | AAPL | Common Stock |
| Tesla, Inc. | TSLA | Common Stock |
| NVIDIA Corporation | NVDA | Common Stock |
| Alphabet Inc. | GOOGL / GOOG | Class A Common Stock / Class C Capital Stock |
| The Walt Disney Company | DIS | Common Stock |
| Space Exploration Technologies Corp. | SPCX | Class A Common Stock |
| Oracle Corporation | ORCL | Common Stock |

Primary source links are recorded in `docs/brand-sources/securities.json`.

Alphabet requires an explicit share-class choice; GOOG and GOOGL are not silently
conflated. The UI labels these as `<legal issuer> - <security class>`. Known
issuer/ticker/name mismatches are rejected server-side. No underlying security is
inferred from an arbitrary ERC-20 address or symbol.

Existing events keep their stored metadata hash, proposal text and snapshot. Their
presentation can normalize a known issuer alias (Apple to Apple Inc.) and use the
new logo, but it does not invent a missing historical share class.

## Fonts and theme

The BA login source uses Roboto, including its real italic 900-weight wordmark.
`node scripts/sync-investor-font.mjs` retrieves the needed font faces into your
project for self-hosting. No font files are distributed in this replacement.
Both asset import steps must run successfully before the release check.

Single-issuer pages use the issuer logo, brand accent and a darker accessible ink
where white-on-accent would be difficult to read. Generic sign-in and multi-issuer
meeting lists remain ProxyVote branded. Receipts/results have issuer-only
letterhead and issuer-colored headings/tables/links. The only provider attribution
is a small neutral Powered by Broadridge footer. Platform tags remain data, not
letterhead or a replacement issuer logo.
