// @ts-check
// Historial de precio por tienda (R8): cada lectura o edición de una fila guarda un punto.
import { r2, toUSD } from './money.js';

export const MAX_POINTS = 120;

/**
 * Agrega un punto si cambió el precio, el envío o el impuesto, o si pasaron más de 12 h.
 * @param {any} offer @param {{ total: number|null }|null} cost total en US$ @param {'read'|'manual'|'order'|'v1'} source
 * @param {number} trm @param {string} [now]
 */
export function pushObservation(offer, cost, source, trm, now = new Date().toISOString()) {
  if (offer.price == null) return false;
  offer.history ||= [];
  const last = offer.history.at(-1);
  const snap = { t: now, price: Number(offer.price), shipping: offer.shipping ?? null, tax: offer.tax ?? null, total: cost?.total ?? null, currency: offer.currency || 'USD', rate: trm, source };
  const changed = !last || last.price !== snap.price || last.shipping !== snap.shipping || last.tax !== snap.tax || last.total !== snap.total;
  if (!changed && Date.parse(now) - Date.parse(last.t) < 12 * 3600e3) return false;
  offer.history.push(snap);
  if (offer.history.length > MAX_POINTS) offer.history.splice(0, offer.history.length - MAX_POINTS);
  return true;
}

/** Total en US$ de un punto (si no se guardó el total, el precio convertido con la tasa del punto). */
export const pointUSD = (pt) => (pt.total != null ? pt.total : toUSD(pt.price, pt.currency || 'USD', pt.rate || 3188));

/**
 * Series por tienda para la gráfica, dentro del rango (días; null = todo).
 * @returns {{ offerId: string, store: string, points: { t: number, v: number }[], min: number|null, max: number|null, current: number|null, n: number }[]}
 */
export function priceSeries(product, { days = null, now = Date.now() } = {}) {
  const from = days ? now - days * 864e5 : -Infinity;
  return (product?.offers || []).map((o) => {
    const all = (o.history || []).map((pt) => ({ t: Date.parse(pt.t), v: pointUSD(pt) })).filter((p) => p.v != null && Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
    const points = all.filter((p) => p.t >= from);
    const vals = all.map((p) => p.v);
    return { offerId: o.id, store: o.store, points, min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null, current: vals.at(-1) ?? null, n: all.length };
  }).filter((s) => s.n > 0);
}

/** ▲/▼ contra la lectura anterior de la fila (en su moneda). */
export function trend(offer) {
  const h = (offer?.history || []).filter((p) => p.price != null);
  if (h.length < 2) return null;
  const a = pointUSD(h.at(-2)), b = pointUSD(h.at(-1));
  if (a == null || b == null) return null;
  return { diff: r2(b - a), pct: a ? Math.round(((b - a) / a) * 100) : null };
}
