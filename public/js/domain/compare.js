// @ts-check
// Comparar opciones lado a lado, igual en todas las categorías (R9, §13): escala peor → mejor por fila, «Gana en»,
// ocultar filas iguales o vacías y diferencia contra la elegida.
import { featuresFor, featureValue, fmtFeature, estimateWatts, wattsIsGuess, VALUE_METRICS } from './specs.js';
import { basisTotal } from './offer-cost.js';

/** Puntaje 0..1 por valor (1 = mejor). null si falta un dato o todos son iguales. */
export function scaleScores(vals, better = 'high') {
  if (vals.some((v) => v == null)) return vals.map(() => null);
  const min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) return vals.map(() => null);
  return vals.map((v) => (better === 'low' ? (max - v) / (max - min) : (v - min) / (max - min)));
}
/** @param {number|null} sc */
export const tone = (sc) => (sc == null ? 'none' : sc === 1 ? 'best' : sc === 0 ? 'worst' : 'mid');

/**
 * Tabla de comparación.
 * @param {any[]} items elementos de optionItems (con pr.row y view)
 * @param {string} cat
 * @param {{ basis?: 'dest'|'co', chosenTotal?: number|null, hideEqual?: boolean, threshold?: number, storeName?: (k:string)=>string }} [o]
 */
export function compareTable(items, cat, o = {}) {
  const basis = o.basis || 'dest';
  const storeName = o.storeName || ((k) => k);
  const totals = items.map((it) => (it.pr.row ? basisTotal(it.pr.row.cost, basis) : null));
  const rows = [];
  const grp = (label) => rows.push({ group: true, label });
  /** @param {string} key @param {string} label @param {string} hint @param {any[]} raw @param {string[]} shown @param {string|null} better @param {string[]} [notes] */
  const row = (key, label, hint, raw, shown, better, notes = []) => {
    const sc = better ? scaleScores(raw, better) : raw.map(() => null);
    rows.push({ key, label, hint, cells: raw.map((v, i) => ({ v: shown[i], raw: v, tone: tone(sc[i]), note: notes[i] || '' })), scored: sc.some((x) => x != null) });
  };
  const fmtUsd = (n) => (n == null ? 'sin dato' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  grp('Costo');
  row('total', basis === 'co' ? 'Puesto en Colombia' : 'Total en destino', 'tienda de compra o la más barata', totals, totals.map((t, i) => (t == null ? 'sin dato' : `US$${fmtUsd(t)}${items[i].pr.row?.cost.partial ? '*' : ''}`)), 'low',
    items.map((it) => (it.pr.row ? `${storeName(it.pr.row.offer.store)}${it.pr.suggested ? ' · sugerida' : ''}` : '')));
  if (o.chosenTotal != null) row('diff', 'Contra la elegida', '', totals, totals.map((t, i) => (items[i].cand.selected ? 'elegida' : t == null ? '—' : `${t - o.chosenTotal >= 0 ? '+' : '−'}${fmtUsd(Math.abs(t - o.chosenTotal))}`)), null);
  row('breakdown', 'Producto · envío · impuesto', '', items.map(() => null), items.map((it) => {
    const c = it.pr.row?.cost;
    return c?.price == null ? 'sin dato' : `${fmtUsd(c.subtotal)} · ${c.shipping == null ? '?' : fmtUsd(c.shipping)} · ${c.tax == null ? '?' : fmtUsd(c.tax)}`;
  }), null, items.map((it) => ({ estimated: 'impuesto estimado', store: 'impuesto según la tienda', exempt: `exento < US$${o.threshold ?? 200}`, included: 'incluido', edited: 'editado', customs: 'en aduana' }[it.pr.row?.cost.taxSource] || '')));
  const under = items.map((it) => (it.pr.row?.cost.total == null ? null : it.pr.row.cost.overThreshold ? 0 : 1));
  row('threshold', 'Bajo el umbral', '', under, under.map((u) => (u == null ? 'sin dato' : u ? 'sí' : 'no')), 'high');
  if (VALUE_METRICS[cat]) row('value', 'Valor por dinero', `${VALUE_METRICS[cat].label} · menos es mejor`, items.map((it) => it.value), items.map((it) => (it.value == null ? 'sin dato' : fmtUsd(it.value))), 'low');

  grp('Compra');
  row('rating', 'Calificación', '', items.map((it) => it.product?.rating ?? null), items.map((it) => (it.product?.rating == null ? 'sin dato' : `${String(it.product.rating).replace('.', ',')} · ${(it.product.reviews || 0).toLocaleString('es-CO')}`)), 'high');
  row('delivery', 'Entrega', '', items.map(() => null), items.map((it) => it.pr.row?.offer.delivery || 'sin dato'), null);
  row('stores', 'Tiendas con dato', '', items.map(() => null), items.map((it) => `${it.pr.rows.filter((r) => r.cost.total != null).length} de ${it.pr.rows.length}`), null);
  const watts = items.map((it) => (wattsIsGuess(it.view, cat) ? null : estimateWatts(it.view, cat) / (it.view.qty || 1)));
  if (watts.some((w) => w)) row('watts', 'Consumo', 'W · menos es mejor', watts, watts.map((w) => (w == null ? 'sin dato' : `${w} W`)), 'low');

  grp('Especificaciones');
  for (const f of featuresFor(cat)) {
    if (f.key === 'watts') continue;
    const raw = items.map((it) => featureValue(f, it.view, cat));
    const scoreRaw = f.type === 'cat' ? (f.rank ? raw.map((v) => (v == null ? null : f.rank(v))) : raw.map(() => null)) : raw;
    const better = f.type === 'cat' ? (f.rank ? 'high' : null) : f.better || null;
    const sc = better ? scaleScores(scoreRaw, better) : raw.map(() => null);
    rows.push({ key: `f:${f.key}`, label: f.label, hint: f.unit && f.better ? `${f.unit} · ${f.better === 'low' ? 'menos' : 'más'} es mejor` : '', cells: raw.map((v, i) => ({ v: v == null ? 'sin dato' : fmtFeature(f, v), raw: v, tone: tone(sc[i]), note: '' })), scored: sc.some((x) => x != null) });
  }

  // «Gana en»: filas con escala donde la opción es la mejor.
  const scoredRows = rows.filter((r) => !r.group && r.scored);
  const wins = items.map((_, i) => scoredRows.filter((r) => r.cells[i].tone === 'best').length);
  // Ocultar filas iguales o vacías (no las de costo).
  const hidden = [];
  let visible = rows;
  if (o.hideEqual) {
    visible = rows.filter((r) => {
      if (r.group || ['total', 'diff', 'breakdown'].includes(r.key)) return true;
      const vals = r.cells.map((c) => c.v);
      const empty = vals.every((x) => x === 'sin dato' || x === '—');
      const same = vals.every((x) => x === vals[0]);
      if (empty || same) { hidden.push(`${r.label}${same && !empty ? ` (${vals[0]})` : ''}`); return false; }
      return true;
    });
    visible = visible.filter((r, i) => !r.group || (visible[i + 1] && !visible[i + 1].group));
  }
  return { rows: visible, wins, of: scoredRows.length, hidden };
}
