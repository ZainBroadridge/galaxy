import { normalizeAddress } from './errors.js';
import { TOKEN_PLATFORMS } from '@pv/shared';
import { resolveTokenSelection, TokenCatalogueError, CATALOGUE_CHAIN_ID } from './token-catalogue.js';

const clean = (value) => String(value ?? '').trim();

/** Catalogue selections remain exact. Manual metadata never edits the catalogue. */
export function resolveEventTokenSelection(input, chainId = CATALOGUE_CHAIN_ID) {
  if (clean(input.tokenCatalogueId)) return resolveTokenSelection(input, chainId);
  if (Number(chainId) !== CATALOGUE_CHAIN_ID) {
    throw new TokenCatalogueError('Custom tokens must use Polygon Amoy.', 'UNSUPPORTED_CHAIN');
  }
  const issuerName = clean(input.issuerName);
  const cusip = clean(input.cusip).toUpperCase();
  const platformInput = clean(input.platform);
  const platform = TOKEN_PLATFORMS.find((name) => name.toLowerCase() === platformInput.toLowerCase()) ?? '';
  const securityName = clean(input.securityName);
  const securityTicker = clean(input.securityTicker).toUpperCase();
  if (!issuerName || issuerName.length > 160 || /[\x00-\x1f\x7f]/u.test(issuerName)
    || securityName.length > 240 || /[\x00-\x1f\x7f]/u.test(securityName)
    || !/^[A-Z0-9.\-]{0,24}$/u.test(securityTicker) || !/^[A-Z0-9]{1,9}$/u.test(cusip)) {
    throw new TokenCatalogueError('Enter a valid issuer, security symbol and demo CUSIP.', 'INVALID_CUSTOM_TOKEN');
  }
  if (platformInput && !platform) {
    throw new TokenCatalogueError('Choose Coinbase, Dinari, or leave the platform blank.', 'INVALID_TOKEN_PLATFORM');
  }
  const tokenAddress = normalizeAddress(clean(input.tokenAddress), 'Token address');
  if (/^0x(?:0{40}|f{40})$/u.test(tokenAddress)) {
    throw new TokenCatalogueError('Enter the address of a deployed ERC-20 token, not a placeholder.', 'TOKEN_MAPPING_NOT_CONFIGURED');
  }
  return { id: null, issuerName, platform, tokenAddress, cusip,
    securityName: securityName || issuerName, securityTicker };
}
