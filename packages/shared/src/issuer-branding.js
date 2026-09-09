/** Presentation catalog, not verification of affiliation or token backing.
 * Names identify the underlying security separately from ERC-20 name/symbol.
 * Sources and artwork provenance: docs/ISSUER_ARTWORK.md.
 */
const preset = (id, name, aliases, color, ink, securities) => Object.freeze({
  id, name, aliases: Object.freeze(aliases), color, ink,
  logoFile: `${id}-brand-v2.png`,
  securities: Object.freeze(securities.map(([ticker, title]) => Object.freeze({ ticker, name: `${name} - ${title}` }))),
});
export const ISSUER_PRESETS = Object.freeze([
  preset('apple', 'Apple Inc.', ['apple', 'apple inc'], '#111111', '#111111', [['AAPL', 'Common Stock']]),
  preset('tesla', 'Tesla, Inc.', ['tesla', 'tesla inc'], '#e82127', '#b4191e', [['TSLA', 'Common Stock']]),
  preset('nvidia', 'NVIDIA Corporation', ['nvidia', 'nvidia corporation', 'nvidia corp'], '#76b900', '#416600', [['NVDA', 'Common Stock']]),
  preset('alphabet', 'Alphabet Inc.', ['alphabet', 'alphabet inc', 'google'], '#ed1c24', '#b41920', [
    ['GOOGL', 'Class A Common Stock'], ['GOOG', 'Class C Capital Stock'],
  ]),
  preset('disney', 'The Walt Disney Company', ['walt disney', 'the walt disney company', 'walt disney company', 'disney'], '#111111', '#111111', [['DIS', 'Common Stock']]),
  preset('spacex', 'Space Exploration Technologies Corp.', ['spacex', 'space exploration technologies', 'space exploration technologies corp'], '#111111', '#111111', [['SPCX', 'Class A Common Stock']]),
  preset('oracle', 'Oracle Corporation', ['oracle', 'oracle corporation', 'oracle corp'], '#c74634', '#aa3627', [['ORCL', 'Common Stock']]),
]);
export const TOKEN_PLATFORMS = Object.freeze(['Ondo', 'Dinari', 'Kraken', 'Other']);

const clean = (value) => String(value ?? '').trim().replace(/\s+/gu, ' ');
const aliasKey = (value) => clean(value).toLowerCase().replace(/[.,]/gu, '');
export function issuerPreset(name) {
  const key = aliasKey(name);
  return ISSUER_PRESETS.find((item) => item.aliases.includes(key) || aliasKey(item.name) === key) ?? null;
}
export function issuerPresetById(id) {
  return ISSUER_PRESETS.find((item) => item.id === id) ?? null;
}

/** Used on create: ambiguous share classes must be chosen, never guessed. */
export function issuerBranding(input = {}) {
  const requestedName = clean(input.issuerName);
  const selected = issuerPreset(requestedName);
  const ticker = clean(input.securityTicker).toUpperCase();
  const suppliedSecurity = clean(input.securityName);
  const security = selected?.securities.find((item) => ticker ? item.ticker === ticker : item.name === suppliedSecurity);
  if (ticker && selected && !security) throw new Error('Choose a listed security belonging to this issuer.');
  if (selected && suppliedSecurity && !security) throw new Error('Choose the official listed security name for this issuer.');
  if (security && suppliedSecurity && security.name !== suppliedSecurity) throw new Error('The listed security name does not match the selected ticker.');
  return {
    issuerName: selected?.name ?? requestedName,
    issuerLogoPreset: selected?.id ?? null,
    issuerThemeColor: selected?.color ?? '#222222',
    issuerInkColor: selected?.ink ?? '#222222',
    securityName: security?.name ?? suppliedSecurity,
    securityTicker: security?.ticker ?? ticker,
    platform: clean(input.platform),
  };
}

/** Read projection only: never edits existing event metadata or ballot hashes. */
export function eventIssuerBranding(event = {}) {
  event = event ?? {};
  const rawName = clean(event.issuerName ?? event.issuer_name);
  const byName = issuerPreset(rawName);
  // Only use a stored preset without a name; mismatched old metadata must not
  // silently put a different company's logo on an event.
  const selected = byName ?? (!rawName ? issuerPresetById(event.issuerLogoPreset ?? event.issuer_logo_preset) : null);
  const issuerName = selected?.name ?? rawName;
  const explicitColor = event.issuerThemeColor ?? event.issuer_theme_color;
  const color = selected?.color ?? (/^#[0-9a-f]{6}$/iu.test(explicitColor ?? '') && explicitColor !== '#24506e' ? explicitColor : '#222222');
  const customId = event.issuerLogoId ?? event.issuer_logo_id;
  const suppliedUrl = event.issuerLogoUrl;
  const customUrl = customId ? `/v1/issuer-logos/${customId}`
    : /^\/v1\/issuer-logos\/[0-9a-f-]{36}$/iu.test(suppliedUrl ?? '') ? suppliedUrl : null;
  return {
    issuerName,
    issuerLogoPreset: selected?.id ?? null,
    issuerLogoUrl: customUrl ?? (selected ? `/issuer-logos/${selected.logoFile}` : null),
    issuerThemeColor: color,
    // Neutral ink for arbitrary uploaded brands avoids unreadable light colors.
    issuerInkColor: selected?.ink ?? '#222222',
    securityName: clean(event.securityName ?? event.security_name),
    securityTicker: clean(event.securityTicker ?? event.security_ticker),
  };
}
