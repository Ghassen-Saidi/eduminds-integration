/** Parse the shared token table (semicolon CSV, French Excel style). */

const clean = (s = '') => s.trim().replace(/^"|"$/g, '');

export function parseTokens(text) {
  const [head, ...lines] = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const sep = head.includes(';') ? ';' : ',';
  const keys = head.split(sep).map(clean);
  return lines.filter(Boolean).map((line) => {
    const values = line.split(sep).map(clean);
    const row = Object.fromEntries(keys.map((k, i) => [k, values[i] ?? '']));
    const labs = [1, 2, 3].filter((n) => clean(row[`tp${n}`]).toLowerCase() === 'yes');
    return {
      ref: row.ref,
      name: row.nom,
      category: row.categorie,
      priceTnd: Number((row.prix_tnd || '0').replace(',', '.')) || 0,
      priceSource: row.prix_source || null,
      labs,
      simType: row.sim_type,
      params: row.params ? JSON.parse(row.params) : {},
      markerId: Number(row.marker_id),
      hasToken: clean(row.token).toLowerCase() === 'yes',
      polarized: clean(row.polarized).toLowerCase() === 'yes',
    };
  });
}

export const tokensByMarker = (tokens) => new Map(tokens.map((t) => [t.markerId, t]));
