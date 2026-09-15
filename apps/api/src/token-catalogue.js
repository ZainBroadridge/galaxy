/** Amoy demonstration catalogue. These are test mappings, not platform endorsements.
 * Edit each listing's tokenAddress here when its replacement token is deployed.
 * CUSIPs below are fictitious demo identifiers, not assigned security identifiers.
 */
export const CATALOGUE_CHAIN_ID = 80002;
export const UNCONFIGURED_TOKEN_ADDRESS = '0xffffffffffffffffffffffffffffffffffffffff';

const listing = (tokenAddress, cusip) => Object.freeze({ tokenAddress, cusip });
const company = (issuerId, issuerName, aliases, securityName, securityTicker, listings) => Object.freeze({
  issuerId, issuerName, aliases: Object.freeze(aliases), securityName, securityTicker,
  listings: Object.freeze(listings),
});

// Deliberately explicit: each security/platform mapping can be edited independently.
// Coinbase remains unconfigured until its own token addresses are supplied.
export const TOKEN_CATALOGUE = Object.freeze({
  AAPL: company('apple', 'Apple Inc.', ['Apple', 'AAPL'], 'Apple Inc. - Common Stock', 'AAPL', {
    ISSUER: listing('0x682e82d5a3f0bbb81b7c086081bd757cd5b2c4b4', 'DEMO01001'),
    DINARI: listing('0xa9ae8f7a5c88f0983bf9e9e2b05ec3db3249fb6b', 'DEMO01002'),
    COINBASE: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO01003'),
  }),
  TSLA: company('tesla', 'Tesla, Inc.', ['Tesla', 'TSLA'], 'Tesla, Inc. - Common Stock', 'TSLA', {
    ISSUER: listing('0xf3ba8da491a237cebef4fc0f95baa1483f2ae0dc', 'DEMO02001'),
    DINARI: listing('0x19f7d33190d5cb282ee46a1457876f1b767e42ca', 'DEMO02002'),
    COINBASE: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO02003'),
  }),
  NVDA: company('nvidia', 'NVIDIA Corporation', ['NVIDIA', 'NVDA'], 'NVIDIA Corporation - Common Stock', 'NVDA', {
    ISSUER: listing('0xe35b668b6924e695fc3f746c76c6a4c7eed4b59f', 'DEMO03001'),
    DINARI: listing('0x2639bbaef71c0e7445cf5cff00e9892fb8cfecf6', 'DEMO03002'),
    COINBASE: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO03003'),
  }),
  GOOGL: company('alphabet', 'Alphabet Inc.', ['Alphabet', 'Google', 'GOOGL'], 'Alphabet Inc. - Class A Common Stock', 'GOOGL', {
    ISSUER: listing('0xfabf983149841b439c68dce214b8c0b42f1bf56e', 'DEMO04001'),
    DINARI: listing('0xc46aa1ca186794d775fe542fd9d73fe33a1c79c0', 'DEMO04002'),
    COINBASE: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO04003'),
  }),
  ORCL: company('oracle', 'Oracle Corporation', ['Oracle', 'ORCL'], 'Oracle Corporation - Common Stock', 'ORCL', {
    ISSUER: listing('0x2f852e0b0509ebe08c68bb0761f0786050840740', 'DEMO05001'),
    DINARI: listing('0x8acd62c0940ac2253157420d8183ce7667bc34ef', 'DEMO05002'),
    COINBASE: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO05003'),
  }),
  // No exchange ticker or listing status is asserted for this demo equity entry.
  SPACEX: company('spacex', 'Space Exploration Technologies Corp.', ['SpaceX', 'Space Exploration Technologies', 'SPCX'], 'Space Exploration Technologies Corp. - Tokenised equity (demo)', '', {
    ISSUER: listing('0x59f35f28e1e1bae8e90ffdb48ddae46a9c43ace0', 'DEMO06001'),
    DINARI: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO06002'),
    COINBASE: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO06003'),
  }),
  GOOG: company('alphabet', 'Alphabet Inc.', ['GOOG'], 'Alphabet Inc. - Class C Capital Stock', 'GOOG', {
    ISSUER: listing('0xbf3e3d3f135d8d73ba6b196e16e381bfa25f0a71', 'DEMO07001'),
    DINARI: listing('0x9701018de2bf16d335883a434008a6287e2b4c40', 'DEMO07002'),
    COINBASE: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO07003'),
  }),
  OMEGA: company('omega', 'OMEGA', ['OMEGA'], 'OMEGA - Demo token', 'OMEGA', {
    ISSUER: listing('0xb16c938e43ba799b42f1ed1bee470534547816cb', 'DEMO08001'),
    DINARI: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO08002'),
    COINBASE: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO08003'),
  }),
  SID: company('sid', 'SID', ['SID'], 'SID - Demo token', 'SID', {
    ISSUER: listing('0x73f48c4876a1ded6e00908a3e6b26280f1ecd08d', 'DEMO09001'),
    DINARI: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO09002'),
    COINBASE: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO09003'),
  }),
  AMANX: company('amanx', 'AMANX', ['AMANX'], 'AMANX - Demo token', 'AMANX', {
    ISSUER: listing('0x89f5f622e7027a5dfedd78768519874b52668df4', 'DEMO10001'),
    DINARI: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO10002'),
    COINBASE: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO10003'),
  }),
  TESLATX: company('teslatx', 'TESLATX', ['TESLATX'], 'TESLATX - Demo token', 'TESLATX', {
    ISSUER: listing('0x1d5e45aa3fb87594119f6f361800210bf33be76c', 'DEMO11001'),
    DINARI: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO11002'),
    COINBASE: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO11003'),
  }),
});

const platformNames = Object.freeze({ ISSUER: '', DINARI: 'Dinari', COINBASE: 'Coinbase' });
const clean = (value) => String(value ?? '').trim();
const sameText = (left, right) => clean(left).toLowerCase() === clean(right).toLowerCase();
const addressValid = (value) => /^0x[0-9a-f]{40}$/iu.test(value)
  && !/^0x0{40}$/iu.test(value) && !sameText(value, UNCONFIGURED_TOKEN_ADDRESS);

export class TokenCatalogueError extends Error {
  constructor(message, code, status = 400) {
    super(message); this.name = 'TokenCatalogueError'; this.code = code; this.status = status;
  }
}

/** Small public-data response; only the issuer-session route exposes it. No RPC. */
export function tokenCatalogue(chainId = CATALOGUE_CHAIN_ID) {
  const entries = Object.entries(TOKEN_CATALOGUE).flatMap(([symbol, issuer]) =>
    Object.entries(issuer.listings).map(([platformKey, value]) => ({
      id: `${symbol.toLowerCase()}-${platformKey.toLowerCase()}`,
      issuerId: issuer.issuerId, issuerName: issuer.issuerName,
      symbol, aliases: [...issuer.aliases],
      securityName: issuer.securityName, securityTicker: issuer.securityTicker,
      platform: platformNames[platformKey], platformKey,
      sponsorship: platformKey === 'ISSUER' ? 'ISSUER_SPONSORED' : 'CUSTODIAL',
      chainId: CATALOGUE_CHAIN_ID, cusip: value.cusip, demoIdentifier: true,
      tokenAddress: value.tokenAddress.toLowerCase(),
      configured: Number(chainId) === CATALOGUE_CHAIN_ID && addressValid(value.tokenAddress),
    })));
  const ids = new Set(); const cusips = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id) || cusips.has(entry.cusip) || !/^[A-Z0-9]{9}$/u.test(entry.cusip)
      || !/^0x[0-9a-f]{40}$/u.test(entry.tokenAddress)) {
      throw new Error(`Invalid or duplicate token catalogue configuration: ${entry.id}`);
    }
    ids.add(entry.id); cusips.add(entry.cusip);
  }
  return { chainId: CATALOGUE_CHAIN_ID, platforms: ['Coinbase', 'Dinari'], entries };
}

/** The client cannot relabel a token, change its identifier, or deploy a placeholder. */
export function resolveTokenSelection(input, chainId = CATALOGUE_CHAIN_ID) {
  const entry = tokenCatalogue(chainId).entries.find((item) => item.id === input.tokenCatalogueId);
  if (!entry) throw new TokenCatalogueError('Select an issuer and a token mapping from the catalogue.', 'TOKEN_SELECTION_REQUIRED');
  if (!entry.configured) throw new TokenCatalogueError(
    'The token address for this issuer/platform is not configured on Polygon Amoy. Update token-catalogue.js before creating an event.',
    'TOKEN_MAPPING_NOT_CONFIGURED', 409,
  );
  const fields = ['issuerName', 'securityName', 'securityTicker', 'platform', 'tokenAddress', 'cusip'];
  if (fields.some((field) => !sameText(input[field], entry[field]))) {
    throw new TokenCatalogueError('The issuer, platform, CUSIP and token address must match the selected catalogue entry. Reload the catalogue and select it again.', 'TOKEN_MAPPING_MISMATCH', 409);
  }
  return entry;
}
