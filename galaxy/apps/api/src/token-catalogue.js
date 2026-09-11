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

// Deliberately explicit: all 18 issuer/platform pairs can be edited independently.
export const TOKEN_CATALOGUE = Object.freeze({
  AAPL: company('apple', 'Apple Inc.', ['Apple', 'AAPL'], 'Apple Inc. - Common Stock', 'AAPL', {
    ISSUER: listing('0x682e82d5a3f0bbb81b7c086081bd757cd5b2c4b4', 'DEMO01001'),
    DINARI: listing('0x682e82d5a3f0bbb81b7c086081bd757cd5b2c4b4', 'DEMO01002'),
    COINBASE: listing('0x682e82d5a3f0bbb81b7c086081bd757cd5b2c4b4', 'DEMO01003'),
  }),
  TSLA: company('tesla', 'Tesla, Inc.', ['Tesla', 'TSLA'], 'Tesla, Inc. - Common Stock', 'TSLA', {
    ISSUER: listing('0xf3ba8da491a237cebef4fc0f95baa1483f2ae0dc', 'DEMO02001'),
    DINARI: listing('0xf3ba8da491a237cebef4fc0f95baa1483f2ae0dc', 'DEMO02002'),
    COINBASE: listing('0xf3ba8da491a237cebef4fc0f95baa1483f2ae0dc', 'DEMO02003'),
  }),
  NVDA: company('nvidia', 'NVIDIA Corporation', ['NVIDIA', 'NVDA'], 'NVIDIA Corporation - Common Stock', 'NVDA', {
    ISSUER: listing('0xe35b668b6924e695fc3f746c76c6a4c7eed4b59f', 'DEMO03001'),
    DINARI: listing('0xe35b668b6924e695fc3f746c76c6a4c7eed4b59f', 'DEMO03002'),
    COINBASE: listing('0xe35b668b6924e695fc3f746c76c6a4c7eed4b59f', 'DEMO03003'),
  }),
  GOOGL: company('alphabet', 'Alphabet Inc.', ['Alphabet', 'Google', 'GOOGL'], 'Alphabet Inc. - Class A Common Stock', 'GOOGL', {
    ISSUER: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO04001'),
    DINARI: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO04002'),
    COINBASE: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO04003'),
  }),
  ORCL: company('oracle', 'Oracle Corporation', ['Oracle', 'ORCL'], 'Oracle Corporation - Common Stock', 'ORCL', {
    ISSUER: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO05001'),
    DINARI: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO05002'),
    COINBASE: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO05003'),
  }),
  // No exchange ticker or listing status is asserted for this demo equity entry.
  SPACEX: company('spacex', 'Space Exploration Technologies Corp.', ['SpaceX', 'Space Exploration Technologies'], 'Space Exploration Technologies Corp. - Tokenised equity (demo)', '', {
    ISSUER: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO06001'),
    DINARI: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO06002'),
    COINBASE: listing(UNCONFIGURED_TOKEN_ADDRESS, 'DEMO06003'),
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
