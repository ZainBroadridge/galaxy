const normalize = (value) => String(value ?? '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();

function distance(left, right) {
  const rows = Array.from({ length: left.length + 1 }, (_row, index) => [index]);
  for (let column = 0; column <= right.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1, rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + Number(left[row - 1] !== right[column - 1]),
      );
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
        rows[row][column] = Math.min(rows[row][column], rows[row - 2][column - 2] + 1);
      }
    }
  }
  return rows[left.length][right.length];
}

function matchScore(query, term) {
  if (term === query) return 0;
  if (term.startsWith(query)) return 10 + (term.length - query.length) / 100;
  if (query.length < 2) return Infinity;
  if (term.includes(query)) return 20 + term.indexOf(query) / 100;
  if (query.length < 3) return Infinity;
  const tolerance = query.length < 6 ? 1 : 2;
  const candidates = [term, ...term.split(' ')];
  const errors = Math.min(...candidates.map((part) => Math.abs(part.length - query.length) <= tolerance
    ? distance(query, part) : Infinity));
  return errors <= tolerance ? 30 + errors : Infinity;
}

/** Search is a presentation aid, never proof of an issuer's identity. */
export function searchIssuers(catalog, value, limit = 6) {
  const query = normalize(value).slice(0, 160);
  // Keep the historical catalog intact for existing events and PDF branding.
  return catalog.filter((issuer) => issuer.id !== 'disney').map((issuer, index) => {
    const terms = [issuer.id, issuer.name, ...(issuer.aliases ?? []),
      ...(issuer.securities ?? []).map((security) => security.ticker)].map(normalize);
    return { issuer, index, score: query ? Math.min(...terms.map((term) => matchScore(query, term))) : 0 };
  }).filter((item) => Number.isFinite(item.score))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, Math.max(0, limit)).map((item) => item.issuer);
}
