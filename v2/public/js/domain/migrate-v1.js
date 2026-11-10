// @ts-check
// Migración V1 → V2. Separa lo que V1 mezclaba en un solo «producto» (brief §16):
//   artículo → Product · oferta en Amazon y filas de comercios → Offer (una por tienda) · decisión en el armado → Candidate.
// El mismo ASIN copiado en varios armados se vuelve un solo producto. No modifica la entrada.
import { emptyState, newOffer, newProduct, newCandidate, SCHEMA } from './schema.js';
import { DEFAULT_STORES, merchantOfUrl, asinOf, MERCHANTS } from './catalog.js';
import { CAT } from './categories.js';
import { decisionLevel } from './categories.js';

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const slug = (s) => String(s || 'manual').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'manual';

/** @param {any} v1 store.json de V1 @param {{ now?: string }} [o] */
export function migrateV1(v1, { now = new Date().toISOString() } = {}) {
  if (!v1 || !Array.isArray(v1.builds)) throw new Error('No es un archivo de datos de V1 (falta builds).');
  const st = emptyState();
  const s1 = v1.settings || {};
  const trm = num(s1.trm) ?? 3160;
  st.settings.fx = { trm, date: now.slice(0, 10), source: 'manual' };
  for (const k of ['psuMargin', 'staleDays', 'refreshMinutes']) if (num(s1[k]) != null) st.settings[k] = num(s1[k]);
  const rule = (id) => st.settings.taxRules.find((r) => r.id === id);
  if (num(s1.threshold) != null) rule('co-exempt').threshold = num(s1.threshold);
  if (num(s1.iva) != null) { rule('co-iva').rate = num(s1.iva); rule('locker-entry').rate = num(s1.iva); }
  if (num(s1.miamiTax) != null) { const r = rule('mia-sales'); r.rate = Math.max(0, +(num(s1.miamiTax) - (r.surtax || 0)).toFixed(4)); }

  const report = { builds: 0, options: 0, products: 0, candidates: 0, offers: {}, paid: 0, customStores: [], selected: 0 };
  const byAsin = new Map();
  st.builds = [];

  /** Tienda propia para productos manuales sin tienda conocida («Tienda local», «Manual»…). */
  const customStore = (name, market, salesTax) => {
    const key = `custom-${slug(name)}-${market === 'miami' ? 'mia' : 'co'}`;
    if (!st.stores[key]) {
      st.stores[key] = { key, merchant: 'manual', name: name || 'Manual', destination: market === 'miami' ? 'us-mia' : 'co', currency: 'USD', taxMode: market === 'miami' || salesTax ? 'sales-tax' : 'included', custom: true, note: 'Creada al migrar desde V1.' };
      report.customStores.push(st.stores[key].name);
    }
    return key;
  };
  const histOf = (h) => (Array.isArray(h) ? h : []).filter((x) => x && x.t && x.price != null)
    .map((x) => ({ t: x.t, price: Number(x.price), shipping: num(x.shipping), tax: num(x.importFees), total: null, currency: 'USD', rate: trm, source: x.source === 'manual' ? 'manual' : 'v1' }));
  const storeKeyOfUrl = (url, market) => {
    const m = merchantOfUrl(url || '', MERCHANTS);
    if (m === 'amazon') return market === 'miami' ? 'amazon-us' : 'amazon-co';
    return m && DEFAULT_STORES[m] ? m : null;
  };

  /** Convierte un producto de V1 en Product (+ offers) y devuelve [product, ownOfferId]. */
  function toProduct(p, cat) {
    const market = p.market === 'miami' ? 'miami' : 'co';
    const asin = p.asin || (/amazon\.com\//i.test(p.url || '') ? asinOf(p.url) : null);
    const prod = newProduct({
      id: p.id, category: CAT[cat] ? cat : 'accessories', title: String(p.title || 'Sin nombre'), brand: p.brand || '', image: p.image || null,
      ids: { asin, mpn: null, upc: null }, rawSpecs: p.specs && typeof p.specs === 'object' ? p.specs : {}, bullets: Array.isArray(p.bullets) ? p.bullets : [],
      specOverrides: Object.fromEntries(Object.entries(p.tags || {}).filter(([, v]) => v !== '' && v != null)),
      rating: num(p.rating), reviews: num(p.reviews), condition: p.condition || null, diagnostics: p.debug || null,
      edited: Object.fromEntries(Object.entries(p.edited || {}).filter(([k]) => ['title', 'image'].includes(k))),
      createdAt: p.history?.[0]?.t || p.fetchedAt || now,
    });
    let own = null;
    const edited = p.edited || {};
    if (!p.manual && asin) {
      const key = market === 'miami' ? 'amazon-us' : 'amazon-co';
      const co = key === 'amazon-co';
      own = newOffer(key, {
        url: `https://www.amazon.com/dp/${asin}`, price: num(p.price), currency: 'USD', shipping: num(p.shipping),
        tax: co ? num(p.importFees) : edited.importFees ? num(p.importFees) : null, taxNotCharged: co && p.importFeesInfo === 'no-informado',
        listPrice: num(p.listPrice), seller: p.seller || null, shipsFrom: p.shipsFrom || null, availability: p.availability || null,
        inStock: /in stock|en stock/i.test(p.availability || '') ? true : null, shipsToDestination: co ? (p.shipsToCO ?? null) : null,
        condition: p.condition || null, sellerOffers: Array.isArray(p.offers) ? p.offers : [], deliverTo: p.deliverTo || null, priceSource: p.priceSource || null,
        shown: p.displayed?.currency === 'COP' ? { currency: 'COP', price: p.displayed.price, shipping: p.displayed.shipping, tax: p.displayed.importFees, total: p.displayed.total, rate: p.fx?.rate ?? trm } : null,
        fetchedAt: p.fetchedAt || null, readStatus: p.fetchedAt ? 'ok' : null, loggedIn: !!p.loggedIn,
        edited: Object.fromEntries(Object.entries(edited).filter(([k]) => !['title', 'image'].includes(k)).map(([k, v]) => [{ importFees: 'tax', shipsToCO: 'shipsToDestination' }[k] || k, v])),
        history: histOf(p.history),
      });
      prod.offers.push(own);
    }
    for (const r of Array.isArray(p.stores) ? p.stores : []) {
      if (!r?.store || !DEFAULT_STORES[r.store]) continue;
      if (prod.offers.some((o) => o.store === r.store)) continue;
      const amazonCmp = r.store === 'amazon-us' || r.store === 'amazon-co';
      const h = [];
      if (r.prev?.price != null) h.push({ t: r.prev.at || r.fetchedAt || now, price: Number(r.prev.price), shipping: num(r.shipping), tax: null, total: null, currency: r.currency === 'COP' ? 'COP' : 'USD', rate: trm, source: 'v1' });
      if (r.price != null) h.push({ t: r.fetchedAt || now, price: Number(r.price), shipping: num(r.shipping), tax: null, total: null, currency: r.currency === 'COP' ? 'COP' : 'USD', rate: trm, source: r.fetchedAt ? 'v1' : 'manual' });
      prod.offers.push(newOffer(r.store, {
        url: r.url || null, price: num(r.price), currency: r.currency === 'COP' ? 'COP' : DEFAULT_STORES[r.store].currency,
        // V1 guardaba en las filas de Amazon el precio comparable (con envío): queda como precio con envío 0.
        shipping: amazonCmp ? 0 : num(r.shipping), tax: r.store === 'amazon-co' ? 0 : null,
        listPrice: num(r.listPrice), notes: [r.note, amazonCmp ? 'Migrado de V1: precio comparable (incluye envío).' : ''].filter(Boolean).join(' '),
        fetchedAt: r.fetchedAt || null, readStatus: r.error ? 'error' : r.fetchedAt ? 'ok' : null, readError: r.error || null,
        edited: r.fetchedAt ? {} : { price: now }, history: h,
      }));
    }
    if (p.manual) {
      const key = storeKeyOfUrl(p.url, market) || customStore(p.store, market, p.salesTax);
      const existing = prod.offers.find((o) => o.store === key);
      if (existing) {
        own = existing;
        const extra = histOf(p.history).filter((x) => !existing.history.some((y) => y.t === x.t));
        existing.history = [...extra, ...existing.history].sort((a, b) => String(a.t).localeCompare(String(b.t))).slice(-120);
        if (existing.price == null && num(p.price) != null) existing.price = num(p.price);
      } else {
        own = newOffer(key, {
          url: p.url || null, price: num(p.price), currency: 'USD', shipping: num(p.shipping), listPrice: num(p.listPrice),
          tax: p.edited?.importFees ? num(p.importFees) : null, fetchedAt: p.fetchedAt || null, readStatus: null,
          edited: { price: p.fetchedAt || now }, history: histOf(p.history),
        });
        prod.offers.push(own);
      }
    }
    return [prod, own?.id ?? null];
  }

  for (const b1 of v1.builds) {
    report.builds++;
    const build = { id: b1.id || `b${report.builds}`, name: b1.name || 'Armado', budget: num(b1.budget) != null ? { amount: num(b1.budget), currency: 'USD' } : null, createdAt: b1.createdAt || now, candidates: [] };
    for (const [cat, slot] of Object.entries(b1.parts || {})) {
      for (const p of slot?.options || []) {
        report.options++;
        let prod, own;
        const asin = p.asin || null;
        if (asin && byAsin.has(asin)) [prod, own] = byAsin.get(asin);
        else {
          [prod, own] = toProduct(p, cat);
          if (st.products[prod.id]) prod.id = `${prod.id}-${report.options}`;
          st.products[prod.id] = prod;
          if (asin) byAsin.set(asin, [prod, own]);
        }
        const selected = (slot.selected || []).includes(p.id);
        const ownOffer = prod.offers.find((o) => o.id === own);
        const cand = newCandidate(prod.id, CAT[cat] ? cat : 'accessories', {
          id: `c-${p.id}`, selected, status: ['buy', 'bought', 'planned'].includes(p.status) ? p.status : 'buy', decision: decisionLevel(p.pick),
          qty: Math.max(1, Math.round(num(p.qty) || 1)), targetPrice: num(p.targetPrice), wattsOverride: num(p.watts), notes: p.notes || '',
          // V1 sumaba siempre el precio del destino propio: en lo elegido se conserva como tienda de compra;
          // en las demás opciones queda la sugerida (la de menor total en su destino).
          purchaseOfferId: selected && ownOffer?.price != null ? own : null,
          addedAt: p.history?.[0]?.t || p.fetchedAt || now,
          purchase: p.paid?.total != null ? {
            total: { amount: Number(p.paid.total), currency: 'USD' },
            breakdown: { item: num(p.paid.price) != null ? +(num(p.paid.price) * (num(p.paid.qty) || 1)).toFixed(2) : null, shipping: num(p.paid.shipping), taxes: num(p.paid.importFees), discounts: null },
            original: p.paid.original || null, date: p.paid.date || null, orderId: p.paid.orderId || '', items: p.paid.items || 1,
            store: ownOffer?.store || (p.market === 'miami' ? 'amazon-us' : 'amazon-co'), source: p.paid.source === 'pedido' ? 'order' : 'manual',
            by: p.paid.by || null, exact: p.paid.exact !== false, matchedTitle: p.paid.matchedTitle || null, at: p.paid.at || now,
          } : null,
        });
        if (cand.purchase) report.paid++;
        if (selected) report.selected++;
        build.candidates.push(cand);
        report.candidates++;
      }
    }
    st.builds.push(build);
  }
  if (!st.builds.length) st.builds = emptyState().builds;
  st.activeBuildId = st.builds.some((b) => b.id === v1.activeBuildId) ? v1.activeBuildId : st.builds[0].id;
  for (const p of Object.values(st.products)) for (const o of p.offers) report.offers[o.store] = (report.offers[o.store] || 0) + 1;
  report.products = Object.keys(st.products).length;
  st.schema = SCHEMA;
  st.migratedFrom = { version: v1.version ?? 1, at: now };
  return { state: st, report };
}
