const text = (value) => String(value ?? '').trim();
const key = (value) => text(value).toLowerCase().replace(/[.,]/gu, '').replace(/\s+/gu, ' ');

export function catalogueIssuers(catalogue) {
  const unique = new Map();
  for (const entry of catalogue?.entries ?? []) {
    if (!unique.has(entry.issuerId)) unique.set(entry.issuerId, {
      id: entry.issuerId, name: entry.issuerName, aliases: entry.aliases ?? [],
      securities: [{ name: entry.securityName, ticker: entry.securityTicker || entry.symbol }],
    });
  }
  return [...unique.values()];
}
export function exactCatalogueIssuer(catalogue, value) {
  const query = key(value);
  if (!query) return null;
  return catalogueIssuers(catalogue).find((issuer) => [issuer.name, issuer.id, ...issuer.aliases]
    .some((term) => key(term) === query)) ?? null;
}
export function catalogueEntry(catalogue, issuerValue, platformValue) {
  const issuer = exactCatalogueIssuer(catalogue, issuerValue);
  return issuer ? catalogue.entries.find((entry) => entry.issuerId === issuer.id
    && key(entry.platform) === key(platformValue)) ?? null : null;
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
