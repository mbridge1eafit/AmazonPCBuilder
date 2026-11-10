// @ts-check
// Armado: líneas elegidas, totales (§8.6), consumo (§12) y estado por categoría para la vista general.
import { CATEGORIES, CAT, decisionLevel, FIXED } from './categories.js';
import { purchaseRow } from './purchase.js';
import { specView, estimateWatts, wattsIsGuess, BASE_WATTS } from './specs.js';
import { r2, toCOP } from './money.js';
import { threshold } from './tax.js';

/** Candidatos de una categoría (sin los de productos borrados). */
export const candsOf = (state, build, cat) => (build?.candidates || []).filter((c) => c.category === cat && state.products[c.productId]);
export const selectedOf = (state, build, cat) => candsOf(state, build, cat).filter((c) => c.selected && !c.discarded);

/** Líneas elegidas del armado con su producto, tienda de compra y costo. */
export function lines(state, build, env) {
  const out = [];
  for (const c of CATEGORIES) for (const cand of selectedOf(state, build, c.key)) {
    const product = state.products[cand.productId];
    const pr = purchaseRow(cand, product, env);
    out.push({ cat: c.key, cand, product, pr, cost: pr.row?.cost ?? null, view: specView(product, cand) });
  }
  return out;
}

/** Lo pagado (fijo) de un candidato comprado, en US$. */
export const paidUSD = (cand) => (cand?.purchase?.total?.amount != null ? Number(cand.purchase.total.amount) : null);

export function totals(state, build, env) {
  const s = env.settings;
  const ls = lines(state, build, env);
  const r = {
    toBuy: { count: 0, subtotal: 0, shipping: 0, tax: 0, total: 0, partial: [], taxSources: {} },
    bought: { count: 0, total: 0, noPaid: 0 }, planned: { count: 0, total: 0 },
    grand: 0, orders: 0, over: { count: 0, tax: 0, names: [] }, unknownPrice: 0,
    fixed: { count: 0, total: 0 }, undecided: 0, pending: 0, byStore: /** @type {any[]} */ ([]),
    watts: 0, wattsNow: 0, externalWatts: 0, genericWatts: [], recommendedPsu: 0, budget: null, cop: 0, lines: ls,
  };
  const byStore = new Map();
  for (const l of ls) {
    const st = l.cand.status || 'buy';
    const w = estimateWatts(l.view, l.cat);
    if (wattsIsGuess(l.view, l.cat)) r.genericWatts.push(l);
    if (CAT[l.cat].external) r.externalWatts += w;
    else { r.watts += w; if (st !== 'planned') r.wattsNow += w; }
    if (st === 'bought') {
      r.bought.count++;
      const paid = paidUSD(l.cand);
      if (paid != null) { r.bought.total += paid; continue; }
      r.bought.noPaid++;
      if (l.cost?.total != null) r.bought.total += l.cost.total;
      continue;
    }
    if (st === 'planned') { r.planned.count++; if (l.cost?.total != null) r.planned.total += l.cost.total; continue; }
    r.toBuy.count++;
    const lvl = decisionLevel(l.cand.decision);
    if (lvl === FIXED) { r.fixed.count++; r.fixed.total += l.cost?.total || 0; } else r.pending++;
    if (lvl === 0) r.undecided++;
    if (l.cost?.total == null) { r.unknownPrice++; r.toBuy.partial.push({ line: l, missing: ['precio'] }); continue; }
    r.orders++;
    r.toBuy.subtotal += l.cost.subtotal; r.toBuy.shipping += l.cost.shipping || 0; r.toBuy.tax += l.cost.tax || 0; r.toBuy.total += l.cost.total;
    if (l.cost.partial) r.toBuy.partial.push({ line: l, missing: l.cost.missing });
    if (l.cost.taxSource) r.toBuy.taxSources[l.cost.taxSource] = (r.toBuy.taxSources[l.cost.taxSource] || 0) + 1;
    if (l.cost.overThreshold) { r.over.count++; r.over.tax += l.cost.tax || 0; r.over.names.push(l); }
    const key = l.pr.row.offer.store;
    const g = byStore.get(key) || byStore.set(key, { store: key, dest: l.cost.dest, n: 0, total: 0, partial: false }).get(key);
    g.n++; g.total += l.cost.total; g.partial ||= l.cost.partial;
  }
  for (const o of [r.toBuy, r.bought, r.planned, r.fixed, r.over]) for (const k of ['subtotal', 'shipping', 'tax', 'total']) if (k in o) o[k] = r2(o[k]);
  r.grand = r2(r.toBuy.total + r.bought.total + r.planned.total);
  r.byStore = [...byStore.values()].map((g) => ({ ...g, total: r2(g.total), pct: r.toBuy.total ? g.total / r.toBuy.total : 0 })).sort((a, b) => b.total - a.total);
  r.mixedDest = new Set(r.byStore.map((g) => g.dest)).size > 1;
  if (ls.length) { r.watts += BASE_WATTS; r.wattsNow += BASE_WATTS; }
  r.recommendedPsu = Math.ceil((r.watts * (s.psuMargin || 1.3)) / 50) * 50;
  const budget = build?.budget?.amount ?? null;
  if (budget != null) r.budget = { amount: budget, left: r2(budget - r.toBuy.total), pct: budget ? r.toBuy.total / budget : 0 };
  r.cop = toCOP(r.toBuy.total, s.fx.trm);
  r.threshold = threshold(s);
  return r;
}

/** Estado de una categoría para su ficha en la vista general. */
export function categoryState(state, build, cat, checksList) {
  const all = candsOf(state, build, cat);
  const sel = all.filter((c) => c.selected && !c.discarded);
  const problems = (checksList || []).filter((k) => k.cats.includes(cat) && (k.level === 'error' || k.level === 'warn'));
  const err = problems.some((k) => k.level === 'error');
  const statuses = new Set(sel.map((c) => c.status || 'buy'));
  const status = !sel.length ? (CAT[cat].essential ? 'empty' : 'opt')
    : statuses.has('buy') ? 'buy' : statuses.has('planned') && !statuses.has('bought') ? 'planned' : 'bought';
  const fixed = sel.length > 0 && sel.every((c) => decisionLevel(c.decision) === FIXED);
  const level = sel.length ? Math.min(...sel.map((c) => decisionLevel(c.decision))) : 0;
  return { cat, all, sel, options: all.filter((c) => !c.discarded).length, discarded: all.filter((c) => c.discarded).length, status, fixed, level, err, problems };
}
