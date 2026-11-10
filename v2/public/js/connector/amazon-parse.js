// Extracción de fichas de amazon.com, compartida por el conector (que corre dentro de amazon.com con la sesión
// del usuario; el servidor lo empaqueta en /api/connector) y por las pruebas (con cheerio).
// Cubre español e inglés, USD y COP, con y sin sesión. Sin imports.
//
// Ejemplos reales de la caja de compra:
//   sin sesión, es/USD: "US$99.99 Sin cargos de importación y US$21.60 de envío a Colombia … Envío de AmazonGlobal US$21.60
//                        Cargos estimados de importación US$0.00 Total US$121.59"
//   sin sesión, es/COP: "COP566,096.45 … Envío de AmazonGlobal COP 54,965.12 Cargos estimados de importación COP 0 Total COP 621,061.57"
//   con sesión, en/USD: "$179.00 No Import Charges & $17.38 Shipping to Colombia … AmazonGlobal Shipping $17.38
//                        Estimated Import Charges $0.00 Total $196.38 … Deliver to Mauricio - Medellin 050022"

export const clean = (s) => String(s ?? '').replace(/[​-‏⁠﻿]/g, '').replace(/\s+/g, ' ').trim();

// ---------- importes ----------
const AMT = '((?:US\\$|USD|COP|\\$)\\s?[\\d,]+(?:\\.\\d{1,2})?)';
const AMT_RE = /(US\$|USD|COP|\$)\s?([\d,]+(?:\.\d{1,2})?)/;
const re = (src, flags = 'i') => new RegExp(src.replace(/AMT/g, AMT), flags);

export function amount(s) {
  const m = String(s ?? '').match(AMT_RE);
  return m ? { value: Number(m[2].replace(/,/g, '')), currency: m[1] === 'COP' ? 'COP' : 'USD' } : null;
}
export const money = (s) => amount(s)?.value ?? null;

// ASIN desde un enlace de producto o suelto ("B0DQ9PDT22").
export function extractAsin(input) {
  const s = String(input || '').trim();
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase();
  const m = s.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/product\/|[?&]asin=)([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}
export const currencyOf = (s) => amount(s)?.currency ?? null;

// Amazon repite textos para móvil/escritorio: "Amazon.com Amazon.com" → "Amazon.com".
export function undouble(s) {
  let v = clean(s).split(/\s+(?:Remitente \/ Vendedor|Shipper \/ Seller|Enviado por|Vendido por|Ships from and sold by)\b/)[0].trim();
  for (const sep of [' ', '']) {
    const h = (v.length - sep.length) / 2;
    if (Number.isInteger(h) && h > 0 && v.slice(0, h) === v.slice(h + sep.length) && v.slice(h, h + sep.length) === sep) v = v.slice(0, h);
  }
  return v;
}

const first = (s, res) => { for (const r of res) { const m = s.match(r); if (m) return m[1]; } return null; };

// ---------- caja de compra ----------
export function parseBox(box) {
  const b = clean(box);
  let shipping = money(first(b, [
    re('Env[ií]o de AmazonGlobal\\s*AMT'),
    re('AmazonGlobal Shipping\\s*AMT'),
    re('AMT de env[ií]o a Colombia'),
    re('AMT Shipping to Colombia'),
    re('Env[ií]o de AMT y dep[oó]sito'),
    re('AMT Shipping (?:&|and) Import'),
    re('Entrega por AMT'),
    re('AMT (?:Shipping|delivery)'),
  ]));
  if (shipping == null && /Entrega GRATIS|env[ií]o GRATIS|FREE (?:delivery|Shipping)/i.test(b)) shipping = 0;

  let importFees = money(first(b, [
    re('Cargos estimados de importaci[oó]n\\s*AMT'),
    re('Dep[oó]sito (?:estimado )?de cargos de importaci[oó]n(?: de)?\\s*AMT'),
    re('Estimated Import (?:Charges|Fees(?: Deposit)?)\\s*AMT'),
    re('Import Fees Deposit\\s*AMT'),
    re('AMT (?:de cargos de importaci[oó]n|Import (?:Charges|Fees))'),
  ]));
  if (importFees == null && /Sin cargos de importaci[oó]n|No Import (?:Charges|Fees)|sin dep[oó]sito de cargos/i.test(b)) importFees = 0;

  const lead = first(b, [re('^\\s*(?:Comprar nuevo:?\\s*|Buy new:?\\s*)?AMT')]);
  return {
    priceFromBox: money(lead),
    currency: currencyOf(lead) || currencyOf(b),
    shipping,
    importFees,
    total: money(first(b, [re('Total\\s*AMT')])),
    blocked: isBlocked(b),
  };
}

export function isBlocked(s) {
  return /no se puede enviar|no se env[ií]a a|cannot be shipped|doesn.t ship to|does not ship to|no está disponible para enviar|not available to ship/i.test(s);
}

// La línea de entrega puede decir "Colombia" o la ciudad ("Medellin 050022" con sesión); la caja de compra dice "to/a Colombia".
export const deliversToColombia = (deliverTo, box) => /Colombia/i.test(deliverTo || '') || /\b(?:to|a) Colombia\b/i.test(clean(box));
// Región a la que entrega tu sesión: 'co' (Colombia) o 'us' (dirección en EE. UU., p. ej. "Miami 33101").
export function regionOf(deliverTo, box = '') {
  if (deliversToColombia(deliverTo, box) || /Medell[ií]n|Bogot[aá]|Colombia/i.test(deliverTo || '')) return 'co';
  if (/\b\d{5}(?:-\d{4})?\b|Miami|United States|EE\.? ?UU/i.test(deliverTo || '')) return 'us';
  return null;
}

// Tabla "Envío por / Vendedor", "Ships from / Sold by" o "Shipper / Seller".
export function parseSellerText(tab) {
  const t = clean(tab);
  const both = first(t, [/(?:Shipper \/ Seller|Remitente \/ Vendedor)\s+(.+?)(?:\s+(?:Shipper \/ Seller|Remitente \/ Vendedor|Returns|Devoluciones|Payment|Pago)\b|$)/i]);
  if (both) { const v = undouble(both); return { seller: v, shipsFrom: v }; }
  const stop = '\\s+(?:\\d+k?\\+ (?:Orders|pedidos)|\\d+\\+ (?:Years|años)|Learn more|M[aá]s informaci[oó]n|Returns|Devoluciones|Payment|Pago|Env[ií]o por|Ships from|Detalles)';
  const s = first(t, [new RegExp(`Vendedor\\s+(.+?)(?:${stop}|$)`, 'i'), new RegExp(`Sold by\\s+(.+?)(?:${stop}|$)`, 'i')]);
  const f = first(t, [/Env[ií]o por\s+(.+?)(?:\s+Vendedor|\s+Env[ií]o por|\s+Devoluciones|$)/i, /Ships from\s+(.+?)(?:\s+Sold by|\s+Ships from|\s+Returns|$)/i]);
  return { seller: s ? undouble(s) : '', shipsFrom: f ? undouble(f) : '' };
}

const cutSeller = (s, prefix) => undouble(clean(s).replace(prefix, '').split(/\s+(?:\d+% (?:positive|positivo)|La calificaci|Seller rating|Ver menos|See less|Se envía desde|Ships from United|\(\d)/i)[0]);
export const offerSeller = (s) => cutSeller(s, /^(Sold by|Vendedor|Vendido por)\s*/i);
export const offerShipsFrom = (s) => cutSeller(s, /^(Ships from|Env[ií]o por|Enviado desde)\s*/i);

// Texto de una oferta del panel "Todas las opciones de compra".
export function parseOfferText(txt, heading = '') {
  const t = clean(txt);
  let shipping = money(first(t, [re('Entrega por AMT'), re('AMT delivery'), re('AMT Shipping')]));
  if (shipping == null && /Entrega GRATIS|FREE delivery/i.test(t)) shipping = 0;
  const h = clean(heading) || first(t, [/\b(Nuevo|New|Usado[^$]*?|Used[^$]*?|Renovado|Renewed)(?=\s+(?:Agregado|Added)|\s+(?:US\$|COP|\$))/]) || '';
  const isNew = /^(Nuevo|New)\b/i.test(h) || (!h && !/Usado|Renovado|Used|Renewed/i.test(t));
  return {
    shipping,
    condition: isNew ? 'Nuevo' : h || 'Usado',
    delivery: clean(first(t, [
      /(Entrega (?:GRATIS )?(?:por (?:US\$|COP|\$)\s?[\d,]+(?:\.\d{1,2})? )?(?:el|entre el)[^.]*?)(?=\.|\s+Realiza|\s+Agregar|\s+Ver |\s+Env[ií]o por|$)/,
      /((?:FREE )?(?:\$[\d,.]+ )?delivery [^.]*?)(?=\.|\s+Order|\s+Add|\s+Ships from|$)/i,
    ]) || ''),
    // País de origen de vendedores externos ("Se envía desde Canadá."), no el remitente ("Ships from Amazon.com").
    origin: first(t, [/Se env[ií]a desde ([^.]+)\./, /Ships from (United States|Canada|China|Mexico|United Kingdom|Germany|Japan|Hong Kong)\b/]) || '',
  };
}

export const notNewCondition = (title) => (/renewed|renovad|reacondicionad|refurbish|\busado\b|\bused\b|open.box/i.test(title || '') ? 'No nuevo (según título)' : 'Nuevo');

export function brandFrom(specs, byline) {
  return specs?.Marca || specs?.Brand || clean(byline).replace(/^(Visita la tienda de|Visit the|Marca:|Brand:)\s*/i, '').replace(/\s*(Store|tienda)$/i, '');
}

// Elige la mejor oferta nueva cuando la ficha no tiene caja de compra.
export function bestNewOffer(offers) {
  return offers.filter((o) => o.condition === 'Nuevo' && o.price != null).sort((a, b) => (a.price + (a.shipping ?? 0)) - (b.price + (b.shipping ?? 0)))[0] || null;
}

// Categoría probable a partir del título (el usuario la confirma en el conector).
export function guessCategory(title) {
  const t = String(title || '');
  const rules = [
    ['fans', /ventiladores? (de )?(caja|pc|chasis|gabinete)|case fans?|\bP12\b|TL-C12|TL-M12|\b\d[\s-]?pack\b.*(ventilador|fan)|ventilador.*(\bX[35]\b|paquete)/i],
    ['cooler', /disipador|enfriador|cpu cooler|air cooler|refrigeraci[oó]n l[ií]quida|AIO\b/i],
    ['psu', /fuente de (alimentaci[oó]n|poder)|power supply|\bPSU\b/i],
    ['gpu', /\b(RTX|GTX|Radeon|RX\s?\d{4}|Arc\s?B\d{3})\b|tarjeta gr[aá]fica|graphics card/i],
    ['motherboard', /placa (madre|base)|motherboard|tarjeta madre|\b[ABXZH]\d{3}[EM]?\b.*(ATX|ITX)/i],
    ['cpu', /\b(Ryzen|Core\s?(i[3579]|Ultra))\b|procesador|processor/i],
    ['ram', /\bDDR[45]\b|memoria ram|\bRAM\b/i],
    ['storage', /\bSSD\b|NVMe|disco duro|\bHDD\b|M\.2 2280/i],
    ['accessories', /cable|adaptador|pasta t[eé]rmica|thermal paste|hub|tornillos/i],
    ['case', /gabinete|chasis|\bcaja\b.*(ATX|torre)|mid[\s-]?tower|pc case/i],
    ['monitor', /monitor|pantalla/i],
    ['peripherals', /teclado|mouse|rat[oó]n|keyboard|aud[ií]fonos|headset|webcam/i],
  ];
  return (rules.find(([, r]) => r.test(t)) || ['accessories'])[0];
}

// Selectores de la ficha de producto.
export const SEL = {
  title: '#productTitle',
  image: '#landingImage, #imgBlkFront',
  price: '#corePrice_feature_div .a-offscreen, #apex_desktop .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen',
  hiddenPrice: 'input[name="items[0.base][customerVisiblePrice][amount]"], #twister-plus-price-data-price',
  hiddenCurrency: 'input[name="items[0.base][customerVisiblePrice][currencyCode]"], #twister-plus-price-data-price-unit',
  box: '#desktop_buybox, #buybox',
  tab: '#tabular-buybox, #offerDisplayFeatures_desktop',
  specRows: '#productDetails_techSpec_section_1 tr, #productDetails_techSpec_section_2 tr, #productDetails_detailBullets_sections1 tr, #poExpander tr, .a-normal.a-spacing-micro tr, #productOverview_feature_div tr',
  detailBullets: '#detailBullets_feature_div li',
  bullets: '#feature-bullets li span.a-list-item',
  offers: '#aod-pinned-offer, #aod-offer',
};

export const aodUrl = (asin) => `/gp/product/ajax/aodAjaxMain/ref=aod_f_new?asin=${asin}&pc=dp&experienceId=aodAjaxMain`;

// ---------- lectura de un documento completo ----------
// `r` adapta el documento: one(sel, node?) → nodo|null · all(sel, node?) → nodos · text(nodo) → texto sin scripts · attr(nodo, nombre)
export function readProduct(r) {
  const t = (sel, node) => clean(r.text(r.one(sel, node)));
  const strip = (s) => clean(s).replace(/:$/, '');

  const specs = {};
  for (const tr of r.all(SEL.specRows)) {
    const k = strip(r.text(r.one('th, td', tr)));
    const tds = r.all('td', tr);
    const v = clean(r.text(tds[tds.length - 1]));
    if (k && v && k !== v && k.length < 60 && !specs[k]) specs[k] = v.slice(0, 160);
  }
  for (const li of r.all(SEL.detailBullets)) {
    const [k, ...rest] = clean(r.text(li)).split(':');
    const v = rest.join(':').trim();
    if (k && v && k.length < 60 && !specs[k.trim()]) specs[k.trim()] = v.slice(0, 160);
  }

  const img = r.one(SEL.image);
  let image = r.attr(img, 'data-old-hires') || '';
  if (!image) { try { image = Object.keys(JSON.parse(r.attr(img, 'data-a-dynamic-image') || '{}'))[0] || ''; } catch { /* sin imagen */ } }
  image = image || r.attr(img, 'src') || '';

  const title = t(SEL.title);
  const boxText = t(SEL.box);
  const box = parseBox(boxText);

  // Precio: el visible, luego los campos ocultos del formulario de compra, luego el inicio de la caja.
  const shown = amount(t(SEL.price));
  const hiddenValue = Number(r.attr(r.one(SEL.hiddenPrice), 'value'));
  const hidden = hiddenValue > 0 ? { value: hiddenValue, currency: /COP/i.test(r.attr(r.one(SEL.hiddenCurrency), 'value') || '') ? 'COP' : 'USD' } : null;
  const priceAmt = shown || hidden || (box.priceFromBox != null ? { value: box.priceFromBox, currency: box.currency } : null);
  const price = priceAmt?.value ?? null;

  const feat = (id) => undouble(t(`#${id} .offer-display-feature-text-message`) || t(`#${id} .offer-display-feature-text`));
  const tab = parseSellerText(t(SEL.tab));
  const deliverTo = (t('#glow-ingress-line2') || t('#contextualIngressPtLabel_deliveryShortLine')).replace(/^(Enviar a|Deliver to)\s*/i, '');
  const availability = clean(t('#availability').split('{')[0]);
  const locationOk = deliversToColombia(deliverTo, boxText);
  const region = regionOf(deliverTo, boxText);

  return {
    title, image, specs, deliverTo, availability, price,
    currency: priceAmt?.currency || box.currency || 'USD',
    bullets: r.all(SEL.bullets).map((e) => clean(r.text(e))).filter(Boolean).slice(0, 8),
    brand: brandFrom(specs, t('#bylineInfo')),
    // #sellerProfileTriggerId a veces es el enlace "Learn more about the seller": primero el nombre de la sección del vendedor.
    seller: feat('merchantInfoFeature_feature_div') || undouble(t('#sellerProfileTriggerId')).replace(/^(Learn more.*|M[aá]s informaci[oó]n.*|Conoce m[aá]s.*)$/i, '') || tab.seller,
    shipsFrom: feat('fulfillerInfoFeature_feature_div') || tab.shipsFrom,
    shipping: box.shipping,
    importFees: box.importFees,
    // Vendedores externos que envían por su cuenta no muestran cargos: se pagan en aduana al recibir.
    importFeesInfo: box.importFees != null ? 'amazon' : price != null && locationOk && !/importaci[oó]n|Import (?:Charges|Fees)/i.test(boxText) ? 'no-informado' : null,
    total: box.total,
    locationOk,
    region,
    shipsToCO: box.blocked || isBlocked(availability) ? false : price != null && locationOk ? true : null,
    rating: parseFloat((r.attr(r.one('#acrPopover'), 'title') || '').replace(',', '.')) || null,
    reviews: Number(t('#acrCustomerReviewText').replace(/\D/g, '')) || null,
    hasBuybox: price != null,
    condition: notNewCondition(title),
    debug: { box: boxText.slice(0, 1500), deliverTo, priceText: t(SEL.price) || null, hiddenPrice: hidden ? `${hidden.value} ${hidden.currency}` : null },
  };
}

// ---------- tus pedidos: precio pagado ----------
// Las páginas de pedidos llegan sin los artículos (Amazon los pinta con JavaScript), pero traen los números de pedido.
// La factura imprimible de cada pedido sí trae artículos, envío, descuentos, cargos de importación y total.
// Búsqueda en tus pedidos (todos los años), por ASIN o por nombre.
export const orderSearchUrl = (q) => `/your-orders/search?search=${encodeURIComponent(q)}`;
export const invoiceUrl = (orderId) => `/gp/css/summary/print.html?orderID=${orderId}`;
// Las páginas traen además un pedido de ejemplo («000-0000000-…») que no es tuyo: se descarta.
export const readOrderIds = (html) => [...new Set(String(html ?? '').match(/\b\d{3}-\d{7}-\d{7}\b/g) || [])].filter((id) => !id.startsWith('000-'));
// ¿Amazon mandó al inicio de sesión? Por la URL final o el título de la página (todas las páginas traen
// enlaces a /ap/signin en el menú, así que buscar ese texto en el HTML da falsos positivos).
export const needsSignIn = (url, html) => /\/ap\/(?:signin|mfa|cvf)/i.test(url || '')
  || /<title>[^<]*(?:Sign[\s-]?In|Iniciar sesi[oó]n)/i.test(String(html ?? '').slice(0, 20000));

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
// «September 22, 2026» o «22 de septiembre de 2026» → «2026-09-22».
export function orderDate(s) {
  const t = clean(s);
  const en = t.match(/\b([A-Z][a-z]+) (\d{1,2}), (\d{4})\b/);
  const es = t.match(/\b(\d{1,2}) de ([a-záéíóú]+) de (\d{4})\b/i);
  const [m, d, y] = en ? [MONTHS[en[1].toLowerCase()], en[2], en[3]] : es ? [MONTHS[es[2].toLowerCase()], es[1], es[3]] : [];
  return m ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
}

// Factura de un pedido. `r` es el mismo adaptador de readProduct, con up(nodo) → nodo padre.
export function readInvoice(r) {
  const body = clean(r.text(r.one('body')));
  // Resumen del pedido: de «Item(s) Subtotal» hasta el «Grand Total» (después vienen los artículos otra vez).
  const start = body.search(/Item\(s\) Subtotal|Subtotal de (?:los )?(?:productos|art[ií]culos)/i);
  const rest = start >= 0 ? body.slice(start, start + 800) : '';
  const end = rest.match(re('(?:Grand Total|Total (?:general|del pedido)):?\\s*AMT'));
  const sum = end ? rest.slice(0, end.index + end[0].length) : rest;
  const val = (res) => money(first(sum, res));
  const items = [];
  for (const a of r.all('a[href*="/dp/"], a[href*="/gp/product/"]')) {
    const asin = extractAsin(r.attr(a, 'href'));
    if (!asin) continue;
    const title = clean(r.text(a));
    const known = items.find((x) => x.asin === asin);
    if (known) { if (!known.title && title) known.title = title; continue; }
    // El bloque del artículo es el primero, subiendo desde el enlace, que ya muestra un precio.
    let box = a;
    for (let k = 0; k < 8 && box && !AMT_RE.test(clean(r.text(box))); k++) box = r.up(box);
    const txt = clean(r.text(box));
    const qty = Number(first(txt, [/^(\d+) of:/, /\b(?:Qty|Quantity|Cantidad):?\s*(\d+)/i])) || 1;
    items.push({ asin, title, price: money(txt), qty });
  }
  // Descuentos (envío gratis, promociones): los negativos antes de «Total before tax». Lo que viene después
  // (tarjeta de regalo, puntos) es un medio de pago: baja lo cobrado a la tarjeta, no lo que pagaste.
  const cut = sum.search(/Total before tax|Total antes de impuestos/i);
  const neg = [...(cut >= 0 ? sum.slice(0, cut) : sum).matchAll(re('-\\s?AMT', 'gi'))].reduce((a, m) => a + (money(m[1]) || 0), 0);
  const beforeTax = val([re('Total before tax:?\\s*AMT'), re('Total antes de impuestos:?\\s*AMT')]);
  const tax = val([re('(?:Estimated tax to be collected|Tax Collected):?\\s*AMT'), re('Impuestos? (?:estimados? )?(?:a recaudar|recaudados?):?\\s*AMT')]);
  const charged = val([re('Grand Total:?\\s*AMT'), re('Total (?:general|del pedido):?\\s*AMT')]);
  return {
    orderId: first(body, [/Order #:?\s*(\d{3}-\d{7}-\d{7})/i, /(?:Pedido|N[uú]mero de pedido)[^\d]{0,12}(\d{3}-\d{7}-\d{7})/i]) || readOrderIds(body)[0] || '',
    date: orderDate(first(body, [/Order placed:?\s*([A-Z][a-z]+ \d{1,2}, \d{4})/i, /Pedido realizado(?: el)?:?\s*(\d{1,2} de [a-záéíóú]+ de \d{4})/i]) || ''),
    currency: currencyOf(sum) || 'USD',
    items,
    subtotal: val([re('Item\\(s\\) Subtotal:?\\s*AMT'), re('Subtotal de (?:los )?(?:productos|art[ií]culos):?\\s*AMT')]),
    shipping: val([re('Shipping (?:&|and) Handling:?\\s*AMT'), re('Env[ií]o y (?:manipulaci[oó]n|gesti[oó]n):?\\s*AMT')]),
    discounts: +neg.toFixed(2),
    importFees: val([re('Import Fees Deposit:?\\s*AMT'), re('Dep[oó]sito (?:de|por) (?:cargos|tasas) de importaci[oó]n:?\\s*AMT')]),
    tax,
    total: beforeTax != null ? +(beforeTax + (tax ?? 0)).toFixed(2) : charged, // lo pagado por el pedido
    charged, // lo cobrado a la tarjeta (sin tarjeta de regalo ni puntos)
  };
}

export function readOffers(r) {
  return r.all(SEL.offers).map((o) => {
    const heading = clean(r.text(r.one('#aod-offer-heading', o)));
    const txt = clean(r.text(o));
    const afterHeading = heading && txt.includes(heading) ? txt.slice(txt.indexOf(heading)) : txt;
    const amt = amount(clean(r.text(r.one('.a-price .a-offscreen', o)))) || amount(clean(r.text(r.one('.a-price', o)))) || amount(afterHeading);
    if (!amt) return null;
    const p = parseOfferText(txt, heading);
    return {
      price: amt.value,
      currency: amt.currency,
      shipping: p.shipping,
      condition: p.condition,
      delivery: p.delivery,
      origin: p.origin,
      seller: offerSeller(r.text(r.one('#aod-offer-soldBy', o))),
      shipsFrom: offerShipsFrom(r.text(r.one('#aod-offer-shipsFrom', o))),
    };
  }).filter(Boolean).slice(0, 12);
}
