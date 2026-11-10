// @ts-check
// Total de una fila producto × tienda (brief §8.3): subtotal, envío, impuesto con su origen y regla,
// total en destino, parcial (y qué falta), equivalentes y, si hay casillero, el total puesto en Colombia.
import { r2, toUSD, toCOP, num } from './money.js';
import { coImportTax, salesTax, lockerEntryTax, threshold } from './tax.js';

/**
 * @typedef {{ settings: any, stores: Record<string, any>, merchants?: Record<string, any> }} Env
 * @typedef {'store'|'estimated'|'edited'|'included'|'exempt'|'customs'|null} TaxSource
 */

/** Libras de un peso guardado en lb. Si el casillero cobra por kilo, convierte. */
const LB_PER_KG = 2.20462;

/**
 * @param {any} offer
 * @param {any} product
 * @param {Env} env
 * @param {number} [qty]
 */
export function offerCost(offer, product, env, qty = 1) {
  const s = env.settings;
  const trm = Number(s.fx?.trm) || 3188;
  const store = env.stores[offer?.store] || null;
  const dest = store?.destination ?? 'co';
  const currency = offer?.currency || store?.currency || 'USD';
  const conv = (v) => toUSD(num(v), currency, trm);
  /** @type {any} */
  const out = {
    store: offer?.store, dest, currency, qty, price: null, subtotal: null, shipping: null, tax: null,
    taxSource: /** @type {TaxSource} */ (null), taxRule: null, total: null, partial: true, missing: [], overThreshold: false,
    cop: null, original: null, landedCO: null, deal: false,
  };
  const unit = conv(offer?.price);
  if (unit == null) { out.missing.push('precio'); return out; }
  const disc = conv(offer.discount) || 0;
  out.price = unit;
  out.subtotal = r2(Math.max(0, unit - disc) * qty);
  out.deal = num(offer.listPrice) != null && Number(offer.listPrice) > Number(offer.price);

  out.shipping = dest === 'us-pickup' ? 0 : conv(offer.shipping);
  if (out.shipping == null) out.missing.push('envío');

  const edited = !!offer.edited?.tax && num(offer.tax) != null;
  const mode = store?.taxMode;
  if (mode === 'included') {
    out.tax = 0; out.taxSource = 'included';
  } else if (mode === 'import-co') {
    out.overThreshold = out.subtotal >= threshold(s);
    if (edited) { out.tax = conv(offer.tax); out.taxSource = 'edited'; }
    // Amazon da los cargos reales solo para cantidad 1.
    else if (num(offer.tax) != null && qty === 1) { out.tax = conv(offer.tax); out.taxSource = 'store'; }
    else if (offer.taxNotCharged) {
      out.tax = 0; out.taxSource = 'customs';
      if (out.overThreshold) out.missing.push('cargos de importación (se pagan en aduana)');
    } else {
      const t = coImportTax(out.subtotal, out.shipping || 0, s);
      out.tax = t.tax; out.taxSource = t.over ? 'estimated' : 'exempt';
    }
    out.taxRule = out.overThreshold ? 'co-iva' : 'co-exempt';
  } else if (mode === 'sales-tax') {
    if (edited) { out.tax = conv(offer.tax); out.taxSource = 'edited'; }
    else {
      const t = salesTax(Math.max(0, unit - disc), qty, dest, s);
      if (t) { out.tax = t.tax; out.taxSource = 'estimated'; out.taxRule = t.rule; } else out.missing.push('tasa de sales tax');
    }
  } else if (num(offer.tax) != null) { out.tax = conv(offer.tax); out.taxSource = 'edited'; }
  else out.missing.push('impuesto');

  out.total = r2(out.subtotal + (out.shipping || 0) + (out.tax || 0));
  out.partial = out.missing.length > 0;
  out.cop = toCOP(out.total, trm);
  if (currency === 'COP') out.original = { currency: 'COP', price: Number(offer.price), total: Math.round(Number(offer.price) * qty + (num(offer.shipping) || 0)) };
  if (offer.shown?.currency === 'COP') out.shown = offer.shown;

  if (dest === 'co') out.landedCO = { total: out.total, partial: out.partial, freight: 0, entryTax: 0, inCO: true, missing: [] };
  else if (dest === 'us-mia' && s.locker?.enabled) out.landedCO = lockerCost(out.total, out.partial, product, s);
  return out;
}

/** Tramo Miami → Colombia por casillero (R14, D1, D7). Es una referencia. */
export function lockerCost(total, partial, product, s) {
  const L = s.locker || {};
  const weightLb = num(product?.weightLb);
  const missing = [];
  const units = weightLb == null ? null : L.unit === 'kg' ? weightLb / LB_PER_KG : weightLb;
  if (units == null) missing.push('peso');
  const freight = r2(Math.max(Number(L.min) || 0, (units ?? 0) * (Number(L.rate) || 0)));
  const entry = lockerEntryTax(total, freight, s);
  return {
    total: r2(total + freight + entry.tax), freight, entryTax: entry.tax, entryRule: entry.rule, minApplied: units == null || (units * (Number(L.rate) || 0)) < (Number(L.min) || 0),
    partial: partial || missing.length > 0, missing, inCO: false, units, unit: L.unit || 'lb', rate: Number(L.rate) || 0, days: L.days || '',
  };
}

/** Total comparable según la base: 'dest' (en destino) o 'co' (puesto en Colombia; sin tramo usa el de destino). */
export const basisTotal = (cost, basis = 'dest') => (basis === 'co' ? (cost.landedCO?.total ?? cost.total) : cost.total);
