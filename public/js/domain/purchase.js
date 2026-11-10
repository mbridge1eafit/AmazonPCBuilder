// @ts-check
// Tienda de compra de un candidato (R11, D3): la elegida o, si no hay, la de menor total en su destino (sugerida).
import { offerCost, basisTotal } from './offer-cost.js';

/**
 * Filas del producto con su costo. Ordenadas por el orden de tiendas (catálogo).
 * @param {any} product @param {import('./offer-cost.js').Env} env @param {number} [qty]
 */
export function offerRows(product, env, qty = 1) {
  const order = Object.keys(env.stores);
  return (product?.offers || [])
    .map((offer) => ({ offer, store: env.stores[offer.store], cost: offerCost(offer, product, env, qty) }))
    .sort((a, b) => order.indexOf(a.offer.store) - order.indexOf(b.offer.store));
}

/** La fila más barata con precio, en la base pedida. */
export function cheapest(rows, basis = 'dest') {
  let best = null;
  for (const r of rows) {
    const t = basisTotal(r.cost, basis);
    if (t == null) continue;
    if (!best || t < basisTotal(best.cost, basis)) best = r;
  }
  return best;
}

/** Marca la más baja de las filas (si hay con qué comparar) y si se comparan destinos distintos. */
export function markRows(rows, basis = 'dest') {
  const priced = rows.filter((r) => basisTotal(r.cost, basis) != null);
  const best = priced.length > 1 ? cheapest(priced, basis) : null;
  const dests = new Set(priced.map((r) => r.cost.dest));
  return { rows: rows.map((r) => ({ ...r, lowest: r === best })), mixedDest: dests.size > 1, best };
}

/**
 * Fila con la que se compra este candidato.
 * @returns {{ row: any, suggested: boolean, mixedDest: boolean, rows: any[] }}
 */
export function purchaseRow(cand, product, env) {
  const rows = offerRows(product, env, Number(cand?.qty) || 1);
  const chosen = cand?.purchaseOfferId ? rows.find((r) => r.offer.id === cand.purchaseOfferId) : null;
  const priced = rows.filter((r) => r.cost.total != null);
  const mixedDest = new Set(priced.map((r) => r.cost.dest)).size > 1;
  if (chosen) return { row: chosen, suggested: false, mixedDest, rows };
  return { row: cheapest(rows, 'dest'), suggested: true, mixedDest, rows };
}
