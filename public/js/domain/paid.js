// @ts-check
// Precio pagado (§8.7): lectura de facturas de Amazon con reparto y búsqueda por ASIN o por nombre.
import { toUSD } from './money.js';

/** Lo pagado por un artículo según la factura. Varios artículos: envío neto, cargos e impuestos se reparten por valor. */
export function paidFromInvoice(inv, it, by = 'asin') {
  if (!inv || !it || inv.total == null) return null;
  const qty = Number(it.qty) || 1;
  const line = it.price != null ? +(it.price * qty).toFixed(2) : null;
  const single = (inv.items || []).length === 1;
  const sub = inv.subtotal ?? (inv.items || []).reduce((a, x) => a + (x.price ?? 0) * (Number(x.qty) || 1), 0);
  if (!single && (line == null || !sub)) return null;
  const extra = +(inv.total - sub).toFixed(2);
  const share = single ? 1 : line / sub;
  const rr = (n) => Math.round(n * 100) / 100;
  return {
    total: single ? inv.total : rr(line + extra * share),
    price: it.price ?? null, qty, currency: inv.currency === 'COP' ? 'COP' : 'USD',
    shipping: rr(Math.max(0, (inv.shipping ?? 0) - (inv.discounts ?? 0)) * share),
    importFees: rr((inv.importFees ?? 0) * share),
    date: inv.date || null, orderId: inv.orderId || '', items: (inv.items || []).length,
    source: 'pedido', exact: single || extra === 0, by,
  };
}

const STOP = new Set(['the', 'and', 'for', 'with', 'con', 'para', 'del', 'las', 'los', 'black', 'white', 'negro', 'blanco']);
const words = (t) => new Set(String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)));
export function titleMatch(a, b) {
  const brand = (t) => String(t || '').trim().split(/\s+/)[0].toLowerCase();
  if (!brand(a) || brand(a) !== brand(b)) return 0;
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}
export const orderQuery = (title) => String(title || '').replace(/[™®©]/g, '').split(/[\s,|–—]+/).filter((w) => /[a-z0-9]/i.test(w)).slice(0, 3).join(' ');

/** Busca el producto en las facturas (la más reciente primero): por ASIN y, si no, por nombre (≥ 70 % → revisar). */
export function findPaid(product, invoices) {
  const asin = product?.ids?.asin;
  const list = [...(invoices || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (asin) for (const inv of list) { const it = inv.items.find((x) => x.asin === asin); if (it) return paidFromInvoice(inv, it, 'asin'); }
  let best = null;
  for (const inv of list) for (const it of inv.items) {
    const score = titleMatch(product?.title, it.title);
    if (score >= 0.7 && (!best || score > best.score)) best = { inv, it, score };
  }
  return best ? { ...paidFromInvoice(best.inv, best.it, 'nombre'), matchedTitle: best.it.title } : null;
}

/**
 * Lo pagado en el modelo: total fijo en US$ (lo de COP guarda el original y la tasa).
 * @param {any} hit resultado de paidFromInvoice o lo escrito a mano { total, currency, date, store }
 * @param {number} trm
 */
export function toPurchase(hit, trm, store = 'amazon-co', now = new Date().toISOString()) {
  const cur = hit.currency === 'COP' ? 'COP' : 'USD';
  const usd = (v) => (v == null ? null : toUSD(Number(v), cur, trm));
  return {
    total: { amount: usd(hit.total), currency: 'USD' },
    breakdown: { item: usd(hit.price != null ? hit.price * (hit.qty || 1) : null), shipping: usd(hit.shipping), taxes: usd(hit.importFees), discounts: null },
    original: cur === 'COP' ? { currency: 'COP', amount: Number(hit.total), rate: trm } : null,
    date: hit.date || now.slice(0, 10), orderId: hit.orderId || '', items: hit.items || 1, store,
    source: hit.source === 'pedido' ? 'order' : 'manual', by: hit.by || null, exact: hit.exact !== false, matchedTitle: hit.matchedTitle || null, at: now,
  };
}
