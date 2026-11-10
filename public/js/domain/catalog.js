// @ts-check
// Catálogo inicial (brief §7–8): destinos, comercios, tiendas (= comercio + destino) y reglas de impuesto.
// Todo es configurable en Ajustes; esto solo es el valor por defecto de un armador nuevo o migrado.

export const DESTINATIONS = {
  co: { key: 'co', name: 'Colombia', short: 'Medellín', place: 'Medellín 050022', country: 'CO', final: true },
  'us-mia': { key: 'us-mia', name: 'EE. UU. — Miami', short: 'Miami', place: '33186', country: 'US', locker: true },
  'us-pickup': { key: 'us-pickup', name: 'EE. UU. — Recogida en sede', short: 'Recogida', place: '', country: 'US', pickup: true },
};

// readMode: 'amazon' (sesión de Amazon) | 'tab' (pestaña propia con el marcador) | 'manual'
export const MERCHANTS = {
  amazon: { key: 'amazon', name: 'Amazon', domain: 'amazon.com', readMode: 'amazon', mono: 'AMZ' },
  newegg: { key: 'newegg', name: 'Newegg', domain: 'newegg.com', readMode: 'tab', mono: 'NE' },
  bestbuy: { key: 'bestbuy', name: 'Best Buy', domain: 'bestbuy.com', readMode: 'tab', mono: 'BBY' },
  walmart: { key: 'walmart', name: 'Walmart', domain: 'walmart.com', readMode: 'tab', mono: 'WMT' },
  target: { key: 'target', name: 'Target', domain: 'target.com', readMode: 'tab', mono: 'TGT' },
  bhphoto: { key: 'bhphoto', name: 'B&H', domain: 'bhphotovideo.com', readMode: 'tab', mono: 'B&H' },
  microcenter: { key: 'microcenter', name: 'Micro Center', domain: 'microcenter.com', readMode: 'tab', mono: 'MC' },
  mercadolibre: { key: 'mercadolibre', name: 'Mercado Libre', domain: 'mercadolibre.com.co', readMode: 'tab', mono: 'ML' },
  manual: { key: 'manual', name: 'Manual', domain: '', readMode: 'manual', mono: 'MAN' },
};

// taxMode: 'import-co' (cargos de importación de Colombia) | 'sales-tax' (regla del destino) | 'included' (en el precio)
// Las claves las comparte el conector.
const us = (key, extra = {}) => ({ key, merchant: key, name: MERCHANTS[key].name, destination: 'us-mia', currency: 'USD', taxMode: 'sales-tax', ...extra });
export const DEFAULT_STORES = {
  'amazon-co': { key: 'amazon-co', merchant: 'amazon', name: 'Amazon Colombia', destination: 'co', currency: 'USD', taxMode: 'import-co', note: 'Varios vendedores; los externos pueden no cobrar cargos (se pagan en aduana).' },
  'amazon-us': { key: 'amazon-us', merchant: 'amazon', name: 'Amazon USA', destination: 'us-mia', currency: 'USD', taxMode: 'sales-tax' },
  newegg: us('newegg'),
  bestbuy: us('bestbuy'),
  walmart: us('walmart'),
  target: us('target'),
  bhphoto: us('bhphoto'),
  microcenter: us('microcenter', { destination: 'us-pickup', note: 'Sin envío; precio de la sede elegida en la tienda.' }),
  mercadolibre: { key: 'mercadolibre', merchant: 'mercadolibre', name: 'Mercado Libre', destination: 'co', currency: 'COP', taxMode: 'included', note: 'Tienda local: impuestos incluidos en el precio.' },
};
export const STORE_ORDER = Object.keys(DEFAULT_STORES);

// Reglas de impuesto (brief §8.4). Valores editables con vigencia y fuente.
export const DEFAULT_TAX_RULES = [
  { id: 'co-iva', dest: 'co', kind: 'iva', label: 'IVA de importación', rate: 0.19, base: 'Precio + envío', condition: 'Si supera el umbral', from: null, until: null, source: 'Estatuto Tributario', note: '' },
  { id: 'co-exempt', dest: 'co', kind: 'exemption', label: 'Exención de IVA, tráfico postal y envíos urgentes', threshold: 200, base: 'Valor por envío', condition: 'Origen EE. UU. (TLC)', from: '2026-01-29', until: null, source: 'Concepto DIAN 1470 de 2026', note: 'Antes, en 2026: US$50 (Decreto Legislativo 1474 de 2025). Confirmar antes de comprar.' },
  { id: 'co-duty', dest: 'co', kind: 'duty', label: 'Arancel', rate: 0, base: 'Valor FOB', condition: 'Hasta US$200 FOB: 0', from: null, until: null, source: 'DIAN · tráfico postal', note: '' },
  { id: 'locker-entry', dest: 'locker', kind: 'entry', label: 'Impuesto de entrada sobre el umbral', rate: 0.19, duty: 0, base: 'Valor + flete', condition: 'Si supera el umbral', from: null, until: null, source: 'Decisión D7; el courier puede cobrar distinto', note: '' },
  { id: 'mia-sales', dest: 'us-mia', kind: 'sales', label: 'Sales tax', rate: 0.06, surtax: 0.01, cap: 5000, base: 'Precio', condition: 'Surtax 1 % solo sobre los primeros US$5.000 por artículo', from: null, until: null, source: '6 % Florida + 1 % Miami-Dade; el exacto sale en el checkout', note: '' },
  { id: 'pickup-sales', dest: 'us-pickup', kind: 'sales', label: 'Sales tax de la sede', rate: null, surtax: 0, cap: null, base: 'Precio', condition: 'Micro Center', from: null, until: null, source: 'Escribe la tasa de tu sede', note: '' },
];

export const DEFAULT_SETTINGS = {
  fx: { trm: 3188, date: '2026-11-09', source: 'manual' },
  destinations: DESTINATIONS,
  taxRules: DEFAULT_TAX_RULES,
  locker: { enabled: true, unit: 'lb', rate: 2.5, min: 10, days: '5–8' },
  psuMargin: 1.3,
  staleDays: 3,
  refreshMinutes: 10,
  alerts: { onRefresh: true, badge: true, repeat: false, minDrop: 1, defaults: 'target' },
};

/** Host de un enlace https, o null. @param {string} url */
function hostOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch { return null; }
}
/** ¿El host pertenece al dominio (o a un subdominio)? */
const onDomain = (host, domain) => !!domain && (host === domain || host.endsWith('.' + domain));

/**
 * Comercio de un enlace (validado por dominio, R3). Devuelve la clave del comercio o null.
 * @param {string} url @param {Record<string, any>} [merchants]
 */
export function merchantOfUrl(url, merchants = MERCHANTS) {
  const host = hostOf(url);
  if (!host) return null;
  return Object.values(merchants).find((m) => onDomain(host, m.domain))?.key ?? null;
}

/** ¿El enlace es del dominio de esa tienda? @param {string} url @param {any} store @param {Record<string, any>} merchants */
export function urlFitsStore(url, store, merchants = MERCHANTS) {
  if (!url) return true; // el enlace es opcional
  const m = merchants[store?.merchant];
  if (!m?.domain) return !!hostOf(url);
  return merchantOfUrl(url, merchants) === m.key;
}

/** ASIN de un enlace de Amazon. @param {string} [s] */
export function asinOf(s) {
  const m = String(s || '').match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/ASIN\/|^)([A-Z0-9]{10})(?:[/?#]|$)/i);
  return m ? m[1].toUpperCase() : null;
}
