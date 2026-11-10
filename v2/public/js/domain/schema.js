// @ts-check
// Esquema de datos V2 (brief §7) y valores por defecto. El estado completo se guarda como un JSON en el servidor.
//
// state = { schema: 2, rev, settings, merchants, stores, products: { [id]: Product }, builds: Build[], activeBuildId, alertEvents[] }
// Product   = { id, category, subtype?, title, brand, model?, image, ids{asin,mpn,upc}, weightLb, rawSpecs{}, bullets[],
//               specOverrides{}, rating, reviews, condition, edited{}, notes, createdAt, offers: Offer[] }
// Offer     = { id, store, url, price, currency, shipping, tax, taxNotCharged, listPrice, discount, seller, shipsFrom,
//               availability, inStock, delivery, shipsToDestination, condition, sellerOffers[], variantMatch, shown,
//               fetchedAt, readStatus, readError, edited{}, notes, history: PriceObservation[] }
// Build     = { id, name, budget: Money|null, createdAt, candidates: Candidate[] }
// Candidate = { id, productId, category, selected, discarded, status, decision, qty, purchaseOfferId, targetPrice,
//               alerts{target,drop,deal,coOnly}, wattsOverride, notes, purchase: Purchase|null, addedAt }
import { DEFAULT_SETTINGS, DEFAULT_STORES, MERCHANTS, DEFAULT_TAX_RULES, DESTINATIONS } from './catalog.js';
import { CAT } from './categories.js';

export const SCHEMA = 2;

export const newId = (prefix = 'x') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const DEFAULT_ALERTS = { target: true, drop: true, deal: false, coOnly: false };

export function newProduct(fields = {}) {
  return {
    id: newId('p'), category: 'accessories', subtype: null, title: '', brand: '', model: null, image: null,
    ids: { asin: null, mpn: null, upc: null }, weightLb: null, rawSpecs: {}, bullets: [], specOverrides: {},
    rating: null, reviews: null, condition: null, edited: {}, notes: '', createdAt: new Date().toISOString(), offers: [], ...fields,
  };
}
export function newOffer(store, fields = {}) {
  return {
    id: newId('o'), store, url: null, price: null, currency: DEFAULT_STORES[store]?.currency || 'USD', shipping: null, tax: null,
    taxNotCharged: false, listPrice: null, discount: null, seller: null, shipsFrom: null, availability: null, inStock: null,
    delivery: null, shipsToDestination: null, condition: null, sellerOffers: [], variantMatch: null, shown: null,
    fetchedAt: null, readStatus: null, readError: null, edited: {}, notes: '', history: [], ...fields,
  };
}
export function newCandidate(productId, category, fields = {}) {
  return {
    id: newId('c'), productId, category, selected: false, discarded: false, status: 'buy', decision: 0, qty: 1,
    purchaseOfferId: null, targetPrice: null, alerts: { ...DEFAULT_ALERTS }, wattsOverride: null, notes: '', purchase: null,
    addedAt: new Date().toISOString(), ...fields,
  };
}
export function newBuild(name = 'Armado principal', fields = {}) {
  return { id: newId('b'), name, budget: null, createdAt: new Date().toISOString(), candidates: [], ...fields };
}

export function emptyState() {
  const b = newBuild();
  return {
    schema: SCHEMA, rev: 0, settings: structuredClone(DEFAULT_SETTINGS), merchants: structuredClone(MERCHANTS),
    stores: structuredClone(DEFAULT_STORES), products: {}, builds: [b], activeBuildId: b.id, alertEvents: [],
  };
}

/** Completa lo que falte con los valores por defecto (datos viejos o importados). No borra nada del usuario. */
export function normalize(raw) {
  const st = raw && typeof raw === 'object' ? raw : emptyState();
  if (st.schema !== SCHEMA) throw new Error('Formato de datos desconocido: usa la migración desde V1.');
  const d = DEFAULT_SETTINGS;
  const s = st.settings || {};
  st.settings = {
    ...d, ...s,
    fx: { ...d.fx, ...s.fx },
    destinations: Object.fromEntries(Object.entries({ ...DESTINATIONS, ...s.destinations }).map(([k, v]) => [k, { ...DESTINATIONS[k], ...v }])),
    taxRules: [...(s.taxRules || []), ...DEFAULT_TAX_RULES.filter((r) => !(s.taxRules || []).some((x) => x.id === r.id))],
    locker: { ...d.locker, ...s.locker },
    alerts: { ...d.alerts, ...s.alerts },
  };
  st.merchants = { ...structuredClone(MERCHANTS), ...st.merchants };
  st.stores = { ...structuredClone(DEFAULT_STORES), ...st.stores };
  st.products ||= {};
  for (const p of Object.values(st.products)) {
    Object.assign(p, { ...newProduct(), ...p, id: p.id, ids: { asin: null, mpn: null, upc: null, ...p.ids } });
    p.offers = (p.offers || []).map((o) => ({ ...newOffer(o.store), ...o, id: o.id || newId('o') }));
    if (!CAT[p.category]) p.category = 'accessories';
  }
  st.builds = (st.builds?.length ? st.builds : [newBuild()]).map((b) => ({ ...newBuild(b.name), ...b, candidates: (b.candidates || []).map((c) => ({ ...newCandidate(c.productId, c.category), ...c, alerts: { ...DEFAULT_ALERTS, ...c.alerts } })) }));
  if (!st.builds.some((b) => b.id === st.activeBuildId)) st.activeBuildId = st.builds[0].id;
  st.alertEvents ||= [];
  st.rev = Number(st.rev) || 0;
  return st;
}

/** Entorno de cálculo (lo que necesitan las funciones de dominio). */
export const envOf = (state) => ({ settings: state.settings, stores: state.stores, merchants: state.merchants });
