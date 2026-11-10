// @ts-check
// Aplicar lecturas del conector y ediciones manuales al modelo V2, respetando lo que el usuario editó (principio 5).
import { num, r2 } from './money.js';
import { newOffer, newProduct } from './schema.js';
import { pushObservation } from './history.js';
import { offerCost } from './offer-cost.js';
import { notNewCondition } from '../connector/amazon-parse.js';

const AMAZON_KEYS = ['asin', 'url', 'title', 'image', 'brand', 'deliverTo', 'price', 'currency', 'shipping', 'importFees', 'importFeesInfo', 'total', 'seller', 'shipsFrom', 'availability', 'shipsToCO', 'locationOk', 'rating', 'reviews', 'hasBuybox', 'condition', 'priceSource', 'loggedIn', 'fetchedAt', 'specs', 'bullets', 'offers', 'debug', 'region'];

/** Los datos llegan de otra pestaña: solo campos conocidos, tipos válidos y enlaces/imagenes de Amazon. */
export function sanitizeAmazon(raw) {
  const p = Object.fromEntries(AMAZON_KEYS.filter((k) => raw?.[k] !== undefined).map((k) => [k, raw[k]]));
  if (!/^[A-Z0-9]{10}$/.test(p.asin || '') || typeof p.title !== 'string') throw new Error('Datos del conector inválidos');
  p.url = `https://www.amazon.com/dp/${p.asin}`;
  if (p.image && !/^https:\/\/[\w.-]+\.(media-amazon|ssl-images-amazon)\.com\//.test(p.image)) p.image = null;
  for (const k of ['price', 'shipping', 'importFees', 'total', 'rating', 'reviews']) p[k] = num(p[k]);
  p.currency = p.currency === 'COP' ? 'COP' : 'USD';
  p.specs = p.specs && typeof p.specs === 'object' && !Array.isArray(p.specs) ? Object.fromEntries(Object.entries(p.specs).slice(0, 60).map(([k, v]) => [String(k).slice(0, 60), String(v).slice(0, 160)])) : {};
  p.bullets = Array.isArray(p.bullets) ? p.bullets.map(String).slice(0, 8) : [];
  p.offers = Array.isArray(p.offers) ? p.offers.slice(0, 12).map((o) => ({ price: num(o?.price), currency: o?.currency === 'COP' ? 'COP' : 'USD', shipping: num(o?.shipping), condition: String(o?.condition || ''), seller: String(o?.seller || ''), shipsFrom: String(o?.shipsFrom || ''), origin: String(o?.origin || ''), delivery: String(o?.delivery || '') })) : [];
  p.debug = p.debug && typeof p.debug === 'object' ? Object.fromEntries(Object.entries(p.debug).map(([k, v]) => [k, String(v ?? '').slice(0, 1500)])) : null;
  p.locationOk = p.locationOk !== false;
  p.region = p.region === 'us' || p.region === 'co' ? p.region : null;
  for (const k of ['title', 'brand', 'seller', 'shipsFrom', 'availability', 'condition', 'deliverTo']) if (p[k] != null) p[k] = String(p[k]).slice(0, 400);
  return p;
}

export function sanitizeStorePrice(d) {
  const currency = d?.currency === 'COP' ? 'COP' : 'USD';
  return { price: num(d?.price), currency, listPrice: num(d?.listPrice), title: String(d?.title || '').slice(0, 200), inStock: d?.inStock === true ? true : d?.inStock === false ? false : null };
}

export function sanitizeInvoices(list) {
  return (Array.isArray(list) ? list : []).slice(0, 500).map((v) => ({
    orderId: /^\d{3}-\d{7}-\d{7}$/.test(v?.orderId || '') ? v.orderId : '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(v?.date || '') ? v.date : null,
    currency: v?.currency === 'COP' ? 'COP' : 'USD',
    items: (Array.isArray(v?.items) ? v.items : []).slice(0, 60).filter((it) => /^[A-Z0-9]{10}$/.test(it?.asin || ''))
      .map((it) => ({ asin: it.asin, title: String(it.title || '').slice(0, 300), price: num(it.price), qty: Math.max(1, Math.round(num(it.qty) || 1)) })),
    subtotal: num(v?.subtotal), shipping: num(v?.shipping), discounts: num(v?.discounts), importFees: num(v?.importFees), tax: num(v?.tax), total: num(v?.total),
  }));
}

/** Tienda de Amazon de una lectura según a dónde entregaba la sesión. */
export const amazonStoreOf = (region) => (region === 'co' ? 'amazon-co' : region === 'us' ? 'amazon-us' : null);

const SHEET = ['title', 'image', 'brand', 'rawSpecs', 'bullets', 'rating', 'reviews', 'condition'];
const OFFER_FIELDS = ['price', 'shipping', 'tax', 'seller', 'availability', 'shipsToDestination', 'delivery', 'listPrice'];

/** Producto nuevo desde una lectura de Amazon. */
export function productFromAmazon(d, category) {
  const p = newProduct({ category, ids: { asin: d.asin, mpn: null, upc: null } });
  return p;
}

/**
 * Reescribe la fila de Amazon de la región de la sesión y la ficha del producto.
 * Lo editado a mano se conserva salvo que la lectura traiga un precio confirmado para el destino (V1, regla de reemplazo).
 * Si el producto no tiene fila para esa región: la crea solo si no tiene ninguna fila de Amazon (producto nuevo).
 */
export function applyAmazon(product, raw, env, now = new Date().toISOString()) {
  const d = raw;
  const storeKey = amazonStoreOf(d.region);
  const amazonOffers = product.offers.filter((o) => env.stores[o.store]?.merchant === 'amazon');
  if (!storeKey) return { skipped: true, reason: 'region', want: amazonOffers.map((o) => o.store) };
  let offer = product.offers.find((o) => o.store === storeKey);
  if (!offer) {
    if (amazonOffers.length) return { skipped: true, reason: 'region', want: amazonOffers.map((o) => o.store) };
    offer = newOffer(storeKey, { url: d.url });
    product.offers.push(offer);
  }
  const trm = Number(env.settings.fx?.trm) || 3188;
  const conv = (v) => (v == null ? null : d.currency === 'COP' ? r2(v / trm) : v);
  const before = { price: offer.price, shipping: offer.shipping, tax: offer.tax, total: offerCost(offer, product, env).total, availability: offer.availability, seller: offer.seller, shipsToDestination: offer.shipsToDestination };

  // Ficha (independiente de la tienda; guarda de dónde salió).
  const sheet = { title: d.title, image: d.image, brand: d.brand, rawSpecs: d.specs, bullets: d.bullets, rating: d.rating, reviews: d.reviews, condition: d.condition || notNewCondition(d.title) };
  for (const k of SHEET) if (!product.edited?.[k] && sheet[k] != null && !(typeof sheet[k] === 'object' && !Object.keys(sheet[k]).length && Object.keys(product[k] || {}).length)) product[k] = sheet[k];
  product.ids = { ...product.ids, asin: d.asin };
  product.sheetSource = storeKey;
  product.diagnostics = d.debug || null;

  const isCO = storeKey === 'amazon-co';
  const confirmed = d.price != null && (isCO ? d.shipsToCO === true && d.locationOk !== false : true);
  const editedKeys = Object.keys(offer.edited || {});
  const keep = editedKeys.length && !confirmed ? new Set(editedKeys) : null;
  const incoming = {
    price: conv(d.price), shipping: conv(d.shipping),
    tax: isCO ? conv(d.importFees) : null,
    seller: d.seller || null, availability: d.availability || null,
    shipsToDestination: isCO ? (d.shipsToCO ?? null) : (d.locationOk ? true : null),
    delivery: d.offers?.[0]?.delivery || null, listPrice: offer.listPrice,
  };
  for (const k of OFFER_FIELDS) if (!keep?.has(k)) offer[k] = incoming[k] ?? null;
  offer.currency = 'USD';
  offer.url = d.url;
  offer.taxNotCharged = isCO && d.importFeesInfo === 'no-informado';
  offer.shipsFrom = d.shipsFrom || null;
  offer.condition = sheet.condition;
  offer.inStock = /in stock|en stock|disponible/i.test(d.availability || '') ? true : /unavailable|no disponible|agotado/i.test(d.availability || '') ? false : null;
  offer.sellerOffers = (d.offers || []).map((o) => ({ ...o, price: conv(o.price), shipping: conv(o.shipping), currency: 'USD' }));
  offer.shown = d.currency === 'COP' ? { currency: 'COP', price: d.price, shipping: d.shipping, tax: d.importFees, total: d.total, rate: trm } : null;
  offer.priceSource = d.priceSource || null;
  offer.deliverTo = d.deliverTo || null;
  offer.loggedIn = !!d.loggedIn;
  offer.fetchedAt = d.fetchedAt || now;
  offer.readStatus = 'ok';
  offer.readError = null;
  if (!keep) offer.edited = {};
  const cost = offerCost(offer, product, env);
  pushObservation(offer, cost, 'read', trm, offer.fetchedAt);
  const after = { price: offer.price, shipping: offer.shipping, tax: offer.tax, total: cost.total, availability: offer.availability, seller: offer.seller, shipsToDestination: offer.shipsToDestination };
  return { skipped: false, offer, before, after, keptEdits: keep ? editedKeys : [], replacedEdits: keep ? [] : editedKeys };
}

/** Precio leído de una tienda (no Amazon). Se conserva el último precio si la ficha no lo mostró. */
export function applyStorePrice(product, offer, data, env, now = new Date().toISOString()) {
  const before = { price: offer.price, total: offerCost(offer, product, env).total };
  const d = sanitizeStorePrice(data);
  offer.fetchedAt = now;
  if (d.price == null) { offer.readStatus = 'error'; offer.readError = 'La ficha no mostró precio. Se conserva el último.'; return { before, after: before, error: offer.readError }; }
  if (!offer.edited?.price) { offer.price = d.price; offer.currency = d.currency; }
  if (d.listPrice != null && !offer.edited?.listPrice) offer.listPrice = d.listPrice > d.price ? d.listPrice : null;
  if (d.inStock != null) offer.inStock = d.inStock;
  offer.readStatus = 'ok'; offer.readError = null;
  const cost = offerCost(offer, product, env);
  pushObservation(offer, cost, 'read', Number(env.settings.fx?.trm) || 3188, now);
  return { before, after: { price: offer.price, total: cost.total } };
}

/** Error de lectura en una fila: se conserva el último precio. */
export function failOffer(offer, message, now = new Date().toISOString()) {
  offer.readStatus = 'error';
  offer.readError = String(message || 'Error de lectura').slice(0, 300);
  offer.errorAt = now;
}

export const OFFER_EDITABLE = ['url', 'price', 'currency', 'shipping', 'tax', 'listPrice', 'discount', 'seller', 'availability', 'delivery', 'shipsToDestination', 'notes', 'variantMatch'];
export const PRODUCT_EDITABLE = ['title', 'image', 'brand', 'model', 'weightLb', 'notes', 'subtype'];
const TRACKED = new Set(['price', 'shipping', 'tax', 'seller', 'availability', 'shipsToDestination', 'delivery', 'listPrice', 'title', 'image', 'brand']);

/**
 * Edición manual de una fila o del producto. Marca «editado» (con fecha) lo que el lector no debe pisar
 * y guarda un punto de historial si cambió el precio, el envío o el impuesto.
 * @returns {string[]} campos que cambiaron
 */
export function applyEdits(target, values, fields, { env = null, product = null, now = new Date().toISOString() } = {}) {
  const changed = [];
  const norm = (x) => (x === '' || x === undefined ? null : x);
  for (const k of fields) {
    if (!(k in values)) continue;
    const v = norm(values[k]);
    if (norm(target[k]) === v) continue;
    target[k] = v;
    changed.push(k);
  }
  if (!changed.length) return changed;
  const tracked = changed.filter((k) => TRACKED.has(k));
  if (tracked.length) target.edited = { ...(target.edited || {}), ...Object.fromEntries(tracked.map((k) => [k, now])) };
  if (env && product && changed.some((k) => ['price', 'shipping', 'tax', 'currency'].includes(k))) {
    pushObservation(target, offerCost(target, product, env), 'manual', Number(env.settings.fx?.trm) || 3188, now);
  }
  return changed;
}
