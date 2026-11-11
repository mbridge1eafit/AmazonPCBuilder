// Comercios donde se vende cada producto y lectura del precio de sus fichas.
// Compartido por el armador, el conector (que lo empaqueta /api/connector y corre DENTRO de cada tienda con tu
// navegador: los servidores de estas tiendas bloquean las consultas que no vienen de un navegador) y las pruebas.
// Sin imports. Los nombres de nivel superior llevan prefijo para no chocar con amazon-parse.js en el marcador.

// Amazon aparece dos veces: con envío a Medellín (importado) y con envío a Miami (dirección en EE. UU.).
// region 'us': se compra con entrega en Miami (ZIP 33186): se compara precio + envío + sales tax de Miami-Dade.
export const STORES = {
  'amazon-co': { name: 'Amazon', sub: 'envío a Medellín', region: 'co', amazon: true, currency: 'USD', host: /(^|\.)amazon\.com$/i, basis: 'Total con envío y cargos de importación a Colombia' },
  'amazon-us': { name: 'Amazon USA', sub: 'envío a Miami', region: 'us', amazon: true, currency: 'USD', host: /(^|\.)amazon\.com$/i, basis: 'Precio + envío a Miami + sales tax' },
  newegg: { name: 'Newegg', sub: 'envío a Miami', region: 'us', currency: 'USD', host: /(^|\.)newegg\.com$/i, basis: 'Precio + envío a Miami + sales tax' },
  bestbuy: { name: 'Best Buy', sub: 'envío a Miami', region: 'us', currency: 'USD', host: /(^|\.)bestbuy\.com$/i, basis: 'Precio + envío a Miami + sales tax' },
  walmart: { name: 'Walmart', sub: 'envío a Miami', region: 'us', currency: 'USD', host: /(^|\.)walmart\.com$/i, basis: 'Precio + envío a Miami + sales tax' },
  target: { name: 'Target', sub: 'envío a Miami', region: 'us', currency: 'USD', host: /(^|\.)target\.com$/i, basis: 'Precio + envío a Miami + sales tax' },
  bhphoto: { name: 'B&H', sub: 'envío a Miami', region: 'us', currency: 'USD', host: /(^|\.)bhphotovideo\.com$/i, basis: 'Precio + envío a Miami + sales tax' },
  microcenter: { name: 'Micro Center', sub: 'EE. UU.', region: 'us', currency: 'USD', host: /(^|\.)microcenter\.com$/i, basis: 'Precio (de la sede elegida en la tienda) + envío + sales tax' },
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

// JSON de un <script> de estado embebido: desde donde termina `start` hasta su </script>.
function stScriptJson(html, start) {
  const s = String(html);
  const m = start.exec(s);
  if (!m) return null;
  const from = m.index + m[0].length;
  const end = s.indexOf('</script>', from);
  try { return JSON.parse(s.slice(from, end < 0 ? undefined : end).trim().replace(/;\s*$/, '')); } catch { return null; }
}
const stNum = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

// Newegg (2026): sin JSON-LD de producto; `window.__initialState__.ItemDetail` es el artículo de la caja de
// compra (puede ser un vendedor 9SIA… aunque la URL sea N82E…). FinalPrice ya suma ShippingCharge, así que
// el precio es UnitCost − InstantRebateAmount.
function stNeweggState(html) {
  const d = stScriptJson(html, /window\.__initialState__\s*=\s*/)?.ItemDetail;
  if (!d || typeof d !== 'object') return null;
  const unit = stNum(d.UnitCost);
  const price = unit != null ? Math.round((unit - (stNum(d.InstantRebateAmount) || 0)) * 100) / 100
    : stNum(d.FinalPrice) != null ? Math.round((d.FinalPrice - (stNum(d.ShippingCharge) || 0)) * 100) / 100 : null;
  if (!stNum(price)) return null;
  const list = Math.max(stNum(d.OriginalUnitPrice) || 0, unit || 0);
  return { price, currency: 'USD', listPrice: list > price ? list : null, inStock: typeof d.Instock === 'boolean' ? d.Instock : null, title: stClean(d.Description?.Title) };
}

// Newegg, respaldo sin estado completo: el "FinalPrice" del objeto cuyo "Item" es el de la ficha
// (N82E16820147861 en la URL canónica → "20-147-861"; 9SIA… se usa tal cual). Nunca el primero suelto:
// suele ser de un patrocinado o relacionado.
function stNeweggPrice(html) {
  const url = stMeta(html, /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i) || stMeta(html, stAttr('og:url')) || '';
  const m = url.match(/\/p\/(?:N82E168(\d{2})(\d{3})(\d{3}[A-Z]?)|(9SI[A-Z0-9]+))/i);
  if (!m) return null;
  const item = (m[4] || `${m[1]}-${m[2]}-${m[3]}`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return stMeta(html, new RegExp(`"Item"\\s*:\\s*"${item}"[^{}]{0,600}?"FinalPrice"\\s*:\\s*([\\d.]+)`, 'i'));
}

// Walmart (2026): sin JSON-LD de producto; el precio está en __NEXT_DATA__.
function stWalmartState(html) {
  const p = stScriptJson(html, /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>/i)?.props?.pageProps?.initialData?.data?.product;
  const price = stNum(p?.priceInfo?.currentPrice?.price);
  if (price == null) return null;
  const was = stNum(p.priceInfo.wasPrice?.price);
  const st = String(p.availabilityStatus || '');
  return { price, currency: 'USD', listPrice: was > price ? was : null, inStock: /^IN_STOCK$/i.test(st) ? true : /OUT_OF_STOCK/i.test(st) ? false : null, title: stClean(p.name) };
}

// Target (2026): la ficha descargada no trae el precio; su propia página lo pide después a la API redsky con la
// clave pública que viene en la configuración de la página. TCIN de /-/A-1011747449; tienda de precios 3991 (online).
export function targetPriceUrl(html, pageUrl) {
  const key = (String(html).match(/\\?"apiKey\\?"\s*:\s*\\?"([0-9a-f]{32,64})\\?"/i) || [])[1];
  const tcin = (String(pageUrl).match(/\/A-(\d{5,12})(?:[/?#]|$)/) || [])[1];
  if (!key || !tcin) return null;
  return `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?key=${key}&tcin=${tcin}&pricing_store_id=3991&channel=WEB`;
}
// Respuesta de pdp_client_v1 → { price, currency, title, inStock, listPrice? } (price null si no viene).
export function readTargetApi(json) {
  const p = json?.data?.product;
  const pr = p?.price || {};
  const price = stNum(pr.current_retail) ?? stNum(pr.current_retail_min) ?? storePriceNumber(pr.formatted_current_price);
  const reg = stNum(pr.reg_retail) ?? stNum(pr.reg_retail_min);
  const out = { price: price ?? null, currency: 'USD', title: stClean(p?.item?.product_description?.title).slice(0, 200), inStock: null };
  if (price != null && reg > price) out.listPrice = reg;
  return out;
}

// Páginas de verificación (Cloudflare, Akamai, captcha) en lugar de la ficha.
export function storeBlocked(html) {
  const t = String(html).slice(0, 20000);
  return /<title>\s*(Just a moment|Un momento|Attention Required|Access Denied|Acceso denegado|Are you a human|Robot or human|Security check)/i.test(t)
    || /cf-chl-|captcha-delivery|px-captcha|account-verification|g-recaptcha/i.test(t) && !/application\/ld\+json/i.test(t);
}

// Precio de la ficha de una tienda: estado embebido propio (Newegg, Walmart) → JSON-LD → microdatos/meta →
// patrones propios de cada tienda.
export function readStorePrice(html, key) {
  const store = STORES[key] || { currency: 'USD' };
  const cur = store.currency;
  let hit = key === 'newegg' ? stNeweggState(html) : key === 'walmart' ? stWalmartState(html) : null;
  if (!hit) for (const p of stProducts(html)) { hit = stOffer(p, cur); if (hit) { hit.title = stClean(p.name); break; } }
  if (!hit) {
    const currency = /^COP$/i.test(stMeta(html, stAttr('(?:product:price:currency|og:price:currency|priceCurrency)')) || '') ? 'COP' : cur;
    const raw = stMeta(html, stAttr('(?:price|product:price:amount|og:price:amount)'))
      ?? (key === 'bestbuy' ? stMeta(html, /"currentPrice"\s*:\s*([\d.]+)/) : null)
      ?? (key === 'newegg' ? stNeweggPrice(html) : null)
      ?? (key === 'microcenter' ? stMeta(html, /data-price=["']([\d.,]+)["']/i) : null)
      ?? (key === 'mercadolibre' ? stMeta(html, /"price"\s*:\s*(\d{4,})/) : null);
    const price = storePriceNumber(raw, currency);
    if (price != null) hit = { price, currency, availability: stMeta(html, stAttr('availability', '(?:content|href)')) || '' };
  }
  const title = hit?.title || stClean(stMeta(html, stAttr('og:title')) || stMeta(html, /<title[^>]*>([^<]*)/i) || '');
  const availability = String(hit?.availability || '').replace(/^https?:\/\/schema\.org\//i, '');
  const out = {
    price: hit?.price ?? null,
    currency: hit?.currency ?? cur,
    title: title.slice(0, 200),
    inStock: typeof hit?.inStock === 'boolean' ? hit.inStock
      : /InStock|LimitedAvailability|OnlineOnly|PreOrder/i.test(availability) ? true : /OutOfStock|SoldOut|Discontinued/i.test(availability) ? false : null,
  };
  if (hit?.listPrice != null) out.listPrice = hit.listPrice;
  return out;
}
