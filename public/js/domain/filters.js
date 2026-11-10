// @ts-check
// Opciones de una categoría: búsqueda, filtros facetados con conteos dinámicos y orden (brief §9.2, R16, R19).
// Cada elemento es { cand, product, view, row, total, value } (ver optionItems).
import { featuresFor, featureValue, fold, valueFor, specView, VALUE_METRICS } from './specs.js';
import { decisionLevel, FIXED } from './categories.js';
import { purchaseRow } from './purchase.js';

/** Elementos listos para filtrar: total de la tienda de compra (o la sugerida) y valor por dinero. */
export function optionItems(cands, products, env) {
  return cands.map((cand, i) => {
    const product = products[cand.productId];
    const view = specView(product, cand);
    const pr = purchaseRow(cand, product, env);
    const total = pr.row?.cost.total ?? null;
    return { cand, product, view, pr, row: pr.row, total, value: valueFor(cand.category, view, total), i };
  });
}

export const OPTION_SORTS = [
  { key: 'decision', label: 'Decisión', dir: 'desc' },
  { key: 'value', label: 'Valor por dinero', dir: 'asc' },
  { key: 'total', label: 'Total', dir: 'asc' },
  { key: 'rating', label: 'Calificación', dir: 'desc' },
  { key: 'name', label: 'Nombre', dir: 'asc' },
  { key: 'added', label: 'Agregada', dir: 'desc' },
];
export const sortsFor = (cat) => [
  ...OPTION_SORTS.filter((o) => o.key !== 'value' || VALUE_METRICS[cat]).map((o) => (o.key === 'value' ? { ...o, label: `Valor: ${VALUE_METRICS[cat].label}` } : o)),
  ...featuresFor(cat).filter((f) => f.type !== 'cat').map((f) => ({ key: `f:${f.key}`, label: f.unit ? `${f.label} (${f.unit})` : f.label, dir: f.better === 'low' ? 'asc' : 'desc', feature: f })),
];
export function dirLabel(sort, dir) {
  if (sort === 'name') return dir === 'asc' ? 'A → Z' : 'Z → A';
  if (sort === 'added') return dir === 'desc' ? 'más recientes primero' : 'más antiguas primero';
  if (sort === 'decision') return dir === 'desc' ? 'más estrellas' : 'menos estrellas';
  return dir === 'asc' ? 'menor primero' : 'mayor primero';
}

/** Vista guardada → valores válidos. */
export function normalizeView(v, cat) {
  const sorts = sortsFor(cat);
  const sort = sorts.find((o) => o.key === v?.sort);
  const feats = {};
  for (const [k, vals] of Object.entries(v?.feats && typeof v.feats === 'object' ? v.feats : {})) {
    const f = featuresFor(cat).find((x) => x.key === k);
    const list = (Array.isArray(vals) ? vals : [vals]).filter((x) => x != null && x !== '');
    if (!f || !list.length) continue;
    feats[k] = f.type === 'cat' ? list.map(String) : list.map(Number).filter(Number.isFinite);
  }
  const max = Number(v?.maxTotal);
  return {
    q: typeof v?.q === 'string' ? v.q : '',
    sort: sort?.key ?? 'decision',
    dir: sort && ['asc', 'desc'].includes(v?.dir) ? v.dir : (sort ?? sorts[0]).dir,
    minDecision: Math.max(0, Math.min(FIXED, Math.round(Number(v?.minDecision) || 0))),
    maxTotal: v?.maxTotal != null && v.maxTotal !== '' && max > 0 ? max : null,
    underThreshold: v?.underThreshold === true,
    deals: v?.deals === true,
    complete: v?.complete === true,
    dest: ['co', 'us'].includes(v?.dest) ? v.dest : null,
    showDiscarded: v?.showDiscarded === true,
    feats,
  };
}
export const viewFiltered = (v) => !!(v.q.trim() || v.minDecision || v.maxTotal != null || v.underThreshold || v.deals || v.complete || v.dest || Object.keys(v.feats).length);

const SOLD_OUT = /No disponible|Agotado|Currently unavailable/i;
const isDealItem = (it) => (it.product?.offers || []).some((o) => o.price != null && Number(o.listPrice) > Number(o.price));
const destOk = (it, d) => (it.pr.rows || []).some((r) => r.cost.total != null && (d === 'co' ? r.cost.dest === 'co' : r.cost.dest !== 'co'));

/** Un filtro de características: varios valores del mismo grupo se combinan con «o»; los grupos con «y». */
function featOk(f, x, wants, cat) {
  if (x == null) return false;
  if (f.type === 'cat') return wants.some((w) => fold(w) === fold(x));
  if (f.exact) return wants.includes(x);
  const t = wants[0];
  return f.better === 'low' ? x <= t : x >= t;
}

/** Filtra y ordena (no modifica la lista). Lo que no tiene dato va al final. Empates: estrellas, orden agregado. */
export function viewOptions(items, view, cat, { skipFeat = null } = {}) {
  const v = normalizeView(view, cat);
  const terms = fold(v.q).split(/\s+/).filter(Boolean);
  const feats = Object.entries(v.feats).filter(([k]) => k !== skipFeat).map(([k, w]) => [featuresFor(cat).find((f) => f.key === k), w]);
  const sortF = sortsFor(cat).find((o) => o.key === v.sort)?.feature;
  const keep = items.filter((it) => {
    if (!!it.cand.discarded !== v.showDiscarded) return false;
    if (terms.length) {
      const p = it.product || {};
      const hay = fold([p.title, p.brand, p.ids?.asin, p.ids?.mpn, p.ids?.upc, ...(p.offers || []).flatMap((o) => [o.seller, o.store])].join(' '));
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    if (decisionLevel(it.cand.decision) < v.minDecision) return false;
    if (v.maxTotal != null && !(it.total != null && it.total <= v.maxTotal)) return false;
    if (v.underThreshold && (it.total == null || it.row?.cost.overThreshold)) return false;
    if (v.deals && !isDealItem(it)) return false;
    if (v.complete && (it.total == null || it.row?.cost.partial)) return false;
    if (v.dest && !destOk(it, v.dest)) return false;
    for (const [f, w] of feats) if (!featOk(f, featureValue(f, it.view, cat), w, cat)) return false;
    return true;
  });
  const key = sortF ? (it) => featureValue(sortF, it.view, cat)
    : { decision: (it) => decisionLevel(it.cand.decision), total: (it) => it.total, value: (it) => it.value, rating: (it) => it.product?.rating || null, added: (it) => it.i, name: () => null }[v.sort];
  const sign = v.dir === 'asc' ? 1 : -1;
  const nullLast = (a, b) => (a == null) - (b == null) || (a == null ? 0 : sign * (a - b));
  const rows = keep.map((it) => ({ it, k: key(it) }));
  const primary = v.sort === 'name'
    ? (a, b) => sign * String(a.it.product?.title || '').localeCompare(String(b.it.product?.title || ''), 'es', { sensitivity: 'base' })
    : (a, b) => nullLast(a.k, b.k) || (v.sort === 'rating' ? nullLast(a.it.product?.reviews || null, b.it.product?.reviews || null) : 0);
  return rows.sort((a, b) => primary(a, b) || decisionLevel(b.it.cand.decision) - decisionLevel(a.it.cand.decision) || a.it.i - b.it.i).map((r) => r.it);
}

/**
 * Facetas: una característica aparece si al menos dos opciones tienen dato y hay dos valores distintos (algunas siempre).
 * Conteos dinámicos: cuántas quedarían con los demás filtros (cada faceta sin su propio filtro). Un valor activo que ya no
 * existe sigue visible para poder quitarlo. Las numéricas con muchos valores se ofrecen en 6 umbrales.
 */
export function facets(items, view, cat) {
  const v = normalizeView(view, cat);
  const pool = items.filter((it) => !!it.cand.discarded === v.showDiscarded);
  const out = [];
  for (const f of featuresFor(cat)) {
    const vals = pool.map((it) => featureValue(f, it.view, cat)).filter((x) => x != null);
    const base = viewOptions(items, v, cat, { skipFeat: f.key }).map((it) => featureValue(f, it.view, cat)).filter((x) => x != null);
    const active = v.feats[f.key] || [];
    const min = f.always ? 1 : 2;
    let values = [];
    if (f.type === 'cat') {
      const groups = new Map();
      for (const x of vals) {
        const g = groups.get(fold(x)) || groups.set(fold(x), { n: 0, names: {} }).get(fold(x));
        g.n++; g.names[x] = (g.names[x] || 0) + 1;
      }
      values = [...groups.values()].map((g) => Object.entries(g.names).sort((a, b) => b[1] - a[1])[0][0])
        .map((x) => ({ value: x, count: base.filter((y) => fold(y) === fold(x)).length }))
        .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value), 'es'));
      if (vals.length < 2 || values.length < min) values = [];
    } else {
      const distinct = [...new Set(vals)].sort((a, b) => a - b);
      if (vals.length >= 2 && distinct.length >= min) {
        if (f.exact) values = distinct.map((x) => ({ value: x, count: base.filter((y) => y === x).length }));
        else {
          const steps = distinct.length <= 8 ? distinct : [...new Set([0, 1, 2, 3, 4, 5].map((i) => distinct[Math.round((i * (distinct.length - 1)) / 5)]))];
          values = steps.map((t) => ({ value: t, count: base.filter((y) => (f.better === 'low' ? y <= t : y >= t)).length }));
        }
      }
    }
    for (const a of active) if (!values.some((x) => (f.type === 'cat' ? fold(x.value) === fold(a) : x.value === a))) values.push({ value: a, count: 0, stale: true });
    if (values.length) out.push({ ...f, values, active, threshold: f.type !== 'cat' && !f.exact });
  }
  return out;
}

/** Conteo de cada filtro de compra con los demás puestos (para la sección «Precio y compra»). */
export function purchaseFacetCounts(items, view, cat) {
  const v = normalizeView(view, cat);
  const count = (patch) => viewOptions(items, { ...v, ...patch }, cat).length;
  return {
    underThreshold: count({ underThreshold: true }),
    deals: count({ deals: true }),
    complete: count({ complete: true }),
    co: count({ dest: 'co' }),
    us: count({ dest: 'us' }),
    d1: count({ minDecision: 1 }),
    d2: count({ minDecision: 2 }),
    d3: count({ minDecision: 3 }),
  };
}
export { SOLD_OUT };
