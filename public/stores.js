// Comercios donde se vende cada producto y lectura del precio de sus fichas.
// Compartido por el armador, el conector (que lo empaqueta /api/connector y corre DENTRO de cada tienda con tu
// navegador: los servidores de estas tiendas bloquean las consultas que no vienen de un navegador) y las pruebas.
// Sin imports. Los nombres de nivel superior llevan prefijo para no chocar con amazon-parse.js en el marcador.

// Amazon aparece dos veces: con envío a Medellín (importado) y con envío a Miami (dirección en EE. UU.).
export const STORES = {
  'amazon-co': { name: 'Amazon', sub: 'envío a Medellín', region: 'co', amazon: true, currency: 'USD', host: /(^|\.)amazon\.com$/i, basis: 'Total con envío y cargos de importación a Colombia' },
  'amazon-us': { name: 'Amazon USA', sub: 'envío a Miami', region: 'us', amazon: true, currency: 'USD', host: /(^|\.)amazon\.com$/i, basis: 'Precio + envío a Miami (sin sales tax)' },
  newegg: { name: 'Newegg', sub: 'EE. UU.', currency: 'USD', host: /(^|\.)newegg\.com$/i, basis: 'Precio de venta en la tienda' },
  bestbuy: { name: 'Best Buy', sub: 'EE. UU.', currency: 'USD', host: /(^|\.)bestbuy\.com$/i, basis: 'Precio de venta en la tienda' },
  microcenter: { name: 'Micro Center', sub: 'EE. UU.', currency: 'USD', host: /(^|\.)microcenter\.com$/i, basis: 'Precio de venta (de la sede elegida en la tienda)' },
  mercadolibre: { name: 'Mercado Libre', sub: 'Colombia', currency: 'COP', host: /(^|\.)mercadolibre\.com\.co$/i, basis: 'Precio de venta en Colombia (COP)' },
};
export const STORE_KEYS = Object.keys(STORES);

// Tienda (no Amazon) a la que pertenece un host o un enlace.
export function storeOfHost(hostname) {
  return STORE_KEYS.find((k) => !STORES[k].amazon && STORES[k].host.test(hostname || '')) || null;
}
export function storeOfUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (/(^|\.)amazon\.com$/i.test(u.hostname)) return 'amazon';
    return storeOfHost(u.hostname);
  } catch { return null; }
}
// ¿El enlace sirve para esa tienda? (las dos de Amazon aceptan cualquier enlace de amazon.com)
export const urlFitsStore = (url, key) => (STORES[key]?.amazon ? storeOfUrl(url) === 'amazon' : storeOfUrl(url) === key);

// "1.899.900" (COP) · "1,234.56" · "$449.99" · 449.99 → número.
export function storePriceNumber(v, currency = 'USD') {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  let s = String(v ?? '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.234.567,89
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');                               // 449,99
  else s = s.replace(/,/g, '');                                                             // 1,234.56
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return currency === 'COP' ? Math.round(n) : n;
}

const stDecode = (s) => String(s ?? '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const stClean = (s) => stDecode(s).replace(/\s+/g, ' ').trim();

// Nodos Product del JSON-LD (incluye @graph, listas y ProductGroup con variantes).
function stProducts(html) {
  const out = [];
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    const types = [].concat(n['@type'] || []).map(String);
    if (types.some((t) => /^(Product|ProductGroup|IndividualProduct)$/i.test(t))) out.push(n);
    if (n['@graph']) visit(n['@graph']);
    if (n.hasVariant) visit(n.hasVariant);
    if (n.mainEntity) visit(n.mainEntity);
  };
  for (const m of String(html).matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, ''))); } catch { /* JSON-LD inválido: se ignora */ }
  }
  return out;
}

function stOffer(product, fallbackCurrency) {
  for (const o of [].concat(product.offers || [])) {
    if (!o || typeof o !== 'object') continue;
    const currency = /^COP$/i.test(o.priceCurrency || o.priceSpecification?.priceCurrency || '') ? 'COP' : /^USD$/i.test(o.priceCurrency || '') ? 'USD' : fallbackCurrency;
    const price = storePriceNumber(o.price ?? o.lowPrice ?? o.priceSpecification?.price, currency);
    if (price != null) return { price, currency, availability: String(o.availability || '').replace(/^https?:\/\/schema\.org\//i, '') };
  }
  return null;
}

const stMeta = (html, re) => { const m = String(html).match(re); return m ? stDecode(m[1] ?? m[2]) : null; };
const stAttr = (name, attr = 'content') => new RegExp(`<[^>]*(?:itemprop|property|name)=["']${name}["'][^>]*${attr}=["']([^"']+)["']|<[^>]*${attr}=["']([^"']+)["'][^>]*(?:itemprop|property|name)=["']${name}["']`, 'i');

// Páginas de verificación (Cloudflare, Akamai, captcha) en lugar de la ficha.
export function storeBlocked(html) {
  const t = String(html).slice(0, 20000);
  return /<title>\s*(Just a moment|Attention Required|Access Denied|Are you a human|Security check)/i.test(t)
    || /cf-chl-|captcha-delivery|px-captcha|account-verification|g-recaptcha/i.test(t) && !/application\/ld\+json/i.test(t);
}

// Precio de la ficha de una tienda: JSON-LD → microdatos/meta → patrones propios de cada tienda.
export function readStorePrice(html, key) {
  const store = STORES[key] || { currency: 'USD' };
  const cur = store.currency;
  const products = stProducts(html);
  let hit = null;
  for (const p of products) { hit = stOffer(p, cur); if (hit) { hit.title = stClean(p.name); break; } }
  if (!hit) {
    const currency = /^COP$/i.test(stMeta(html, stAttr('(?:product:price:currency|og:price:currency|priceCurrency)')) || '') ? 'COP' : cur;
    const raw = stMeta(html, stAttr('(?:price|product:price:amount|og:price:amount)'))
      ?? (key === 'bestbuy' ? stMeta(html, /"currentPrice"\s*:\s*([\d.]+)/) : null)
      ?? (key === 'newegg' ? stMeta(html, /"FinalPrice"\s*:\s*([\d.]+)/) : null)
      ?? (key === 'microcenter' ? stMeta(html, /data-price=["']([\d.,]+)["']/i) : null)
      ?? (key === 'mercadolibre' ? stMeta(html, /"price"\s*:\s*(\d{4,})/) : null);
    const price = storePriceNumber(raw, currency);
    if (price != null) hit = { price, currency, availability: stMeta(html, stAttr('availability', '(?:content|href)')) || '' };
  }
  const title = hit?.title || stClean(stMeta(html, stAttr('og:title')) || stMeta(html, /<title[^>]*>([^<]*)/i) || '');
  const availability = String(hit?.availability || '').replace(/^https?:\/\/schema\.org\//i, '');
  return {
    price: hit?.price ?? null,
    currency: hit?.currency ?? cur,
    title: title.slice(0, 200),
    inStock: /InStock|LimitedAvailability|OnlineOnly|PreOrder/i.test(availability) ? true : /OutOfStock|SoldOut|Discontinued/i.test(availability) ? false : null,
  };
}
