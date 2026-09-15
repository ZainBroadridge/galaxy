const text = (value) => String(value ?? '').trim();
const key = (value) => text(value).toLowerCase().replace(/[.,]/gu, '').replace(/\s+/gu, ' ');

export function catalogueIssuers(catalogue) {
  const unique = new Map();
  for (const entry of catalogue?.entries ?? []) {
    if (!unique.has(entry.issuerId)) unique.set(entry.issuerId, {
      id: entry.issuerId, name: entry.issuerName, aliases: [], securities: [],
    });
    const issuer = unique.get(entry.issuerId);
    for (const alias of entry.aliases ?? []) {
      if (!issuer.aliases.some((value) => key(value) === key(alias))) issuer.aliases.push(alias);
    }
    const ticker = entry.securityTicker || entry.symbol;
    if (!issuer.securities.some((security) => key(security.ticker) === key(ticker))) {
      issuer.securities.push({ name: entry.securityName, ticker });
    }
  }
  return [...unique.values()];
}
export function exactCatalogueIssuer(catalogue, value) {
  const query = key(value);
  if (!query) return null;
  return catalogueIssuers(catalogue).find((issuer) => [issuer.name, issuer.id, ...issuer.aliases]
    .some((term) => key(term) === query)) ?? null;
}
export function catalogueEntry(catalogue, issuerValue, platformValue, securityTicker = '') {
  const issuer = exactCatalogueIssuer(catalogue, issuerValue);
  if (!issuer) return null;
  const entries = catalogue.entries.filter((entry) => entry.issuerId === issuer.id
    && key(entry.platform) === key(platformValue));
  // An explicit symbol selects its share class; platform changes retain the
  // selected class even when multiple securities have the same issuer name.
  const explicit = entries.find((entry) => [entry.symbol, entry.securityTicker]
    .some((symbol) => key(symbol) === key(issuerValue)));
  if (explicit) return explicit;
  if (key(securityTicker)) return entries.find((entry) => [entry.symbol, entry.securityTicker]
    .some((symbol) => key(symbol) === key(securityTicker))) ?? null;
  return entries[0] ?? null;
}
export function applyCatalogueEntry(form, entry) {
  return { ...form, tokenCatalogueId: entry.id, issuerName: entry.issuerName,
    platform: entry.platform, securityName: entry.securityName, securityTicker: entry.securityTicker,
    tokenAddress: entry.tokenAddress, cusip: entry.cusip };
}
export function clearCatalogueEntry(form, patch = {}) {
  return { ...form, tokenCatalogueId: '', tokenAddress: '', cusip: '', securityName: '', securityTicker: '', ...patch };
}
export function selectedCatalogueEntry(catalogue, form) {
  const entry = catalogue?.entries?.find((item) => item.id === form.tokenCatalogueId);
  if (!entry) return null;
  return ['issuerName', 'platform', 'tokenAddress', 'cusip', 'securityName', 'securityTicker']
    .every((field) => key(entry[field]) === key(form[field])) ? entry : null;
}

/** Editing a prefill creates independent event metadata, never a catalogue mutation. */
export function editTokenIdentity(form, patch) {
  return { ...form, ...patch, tokenCatalogueId: '' };
}

export function changeTokenIssuer(form, catalogue, value) {
  const sameIssuer = exactCatalogueIssuer(catalogue, form.issuerName)?.id
    === exactCatalogueIssuer(catalogue, value)?.id;
  const entry = catalogueEntry(catalogue, value, form.platform, sameIssuer ? form.securityTicker : '');
  if (entry) return applyCatalogueEntry(form, entry);
  return form.tokenCatalogueId
    ? clearCatalogueEntry(form, { issuerName: value })
    : editTokenIdentity(form, { issuerName: value });
}

export function changeTokenPlatform(form, catalogue, value) {
  if (key(form.platform) === key(value)) return { ...form, platform: value };
  const entry = catalogueEntry(catalogue, form.issuerName, value, form.securityTicker);
  if (entry) return applyCatalogueEntry(form, entry);
  return form.tokenCatalogueId
    ? clearCatalogueEntry(form, { platform: value })
    : editTokenIdentity(form, { platform: value });
}
