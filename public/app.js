import { CATEGORIES, CAT, STATUS, PICKS, PICK_FIXED, pickLevel, pickOf, isFixed, sortByPick, sortsFor, dirLabel, OPTION_AVAIL, normalizeView, viewFiltered, viewOptions, featuresFor, featureValue, fmtFeature, commonFeatures, DEFAULT_SETTINGS, detectTags, estimateWatts, wattsIsGuess, BASE_WATTS, selectedLines, lineCost, totals, checks, shortTitle, toMarkdown, missingFields, needsRefresh, applySession, applyEdits, EDITABLE_FIELDS, editedLabels, isSurgeProtector, paidTotal, paidChange, findPaid, orderQuery, isMiami, marketLabel, MARKETS, marketOf, storeRows, shownStores, setStorePrice, amazonStorePrice, ownAmazonStore, isDeal } from './logic.js';
import { STORES, STORE_KEYS, storeOfHost, storeOfUrl, urlFitsStore } from './stores.js';
import { regionOf } from './amazon-parse.js';
import { extractAsin } from './amazon-parse.js';
import { ICONS, RIG, STORE_LOGOS } from './icons.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => (n == null || Number.isNaN(n) ? '—' : 'US$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const cop = (n) => (n == null ? '—' : 'COP ' + Math.round(n * store.settings.trm).toLocaleString('es-CO'));
const copAmazon = (n) => 'COP ' + Math.round(n).toLocaleString('es-CO');
const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ago = (iso) => {
  if (!iso) return 'nunca';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
};

let store;
const openCats = new Set();          // categorías con las opciones desplegadas
let saveTimer;

const build = () => store.builds.find((b) => b.id === store.activeBuildId) || store.builds[0];
const S = () => ({ ...DEFAULT_SETTINGS, ...store.settings });
const slot = (cat) => (build().parts[cat] ||= { options: [], selected: [] });
const findP = (cat, id) => slot(cat).options.find((o) => o.id === id);

// ---------- persistencia ----------
async function loadStore() {
  const r = await fetch('/api/store');
  store = await r.json();
  store.settings = { ...DEFAULT_SETTINGS, ...store.settings };
  for (const b of store.builds) for (const c of CATEGORIES) b.parts[c.key] ||= { options: [], selected: [] };
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fetch('/api/store', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(store) })
      .catch(() => toast('No pude guardar los cambios en el servidor.', true));
  }, 350);
}
function commit() { save(); render(); }
// Si cierras la pestaña justo después de un cambio, el guardado pendiente se envía igual.
addEventListener('pagehide', () => {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  fetch('/api/store', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(store), keepalive: true }).catch(() => {});
});

function toast(msg, err = false, ms = 3800) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- sesión de Amazon (conector) ----------
// Toda la información de Amazon se lee con tu sesión: el conector (marcador) corre en una pestaña de amazon.com,
// el armador le pide productos por ASIN y el conector responde con la ficha completa.
const AMAZON_ORIGINS = ['https://www.amazon.com', 'https://amazon.com', 'https://smile.amazon.com'];
const STALL_MS = 90000; // sin noticias del conector en este tiempo, los pedidos en curso se dan por fallidos
const session = { win: null, origin: null, connected: false, version: null, loggedIn: null, deliverTo: '', lastMsg: 0 };
const jobs = new Map(); // id → { asin, resolve, reject, sent }
const busyAsins = new Set();
let connectorVersion = null;
fetch('/api/connector/version').then((r) => r.json()).then((v) => { connectorVersion = v.version; }).catch(() => {});

const IS_MOBILE = /Android|iPhone|iPad/i.test(navigator.userAgent);
const sessionAlive = () => session.connected && !!session.win && !session.win.closed;
const asinOf = (p) => p?.asin || extractAsin(p?.url);
const isBusy = (p) => busyAsins.has(asinOf(p));

// Abre (o enfoca) la pestaña de Amazon para conectar. Solo funciona dentro de un clic: los navegadores bloquean ventanas sin gesto.
function openAmazonTab() {
  if (session.win && !session.win.closed) { session.win.focus(); return; }
  // En el celular se pasa por /amazon.html para que Android no abra la app de Amazon (ver ese archivo).
  session.win = window.open(IS_MOBILE ? '/amazon.html' : 'https://www.amazon.com/', 'pcb-amazon');
  toast(IS_MOBILE
    ? 'Se abrió Amazon: activa ⋮ → «Sitio para computadoras», escribe el nombre del marcador en la barra de direcciones y tócalo. Lo pedido queda en espera.'
    : 'Se abrió Amazon: pulsa ahí el marcador «➕ Armador PC» para conectar tu sesión. Lo pedido queda en espera.', false, 9000);
  renderSession();
}
// Se llama al empezar cualquier actualización (dentro del clic) para abrir Amazon si hace falta.
function requireSession() { if (!sessionAlive()) openAmazonTab(); }

function dispatch(job) {
  job.sent = true;
  session.win.postMessage({ type: 'pcb:fetch', id: job.id, asin: job.asin }, session.origin);
}

function sendJob(asin) {
  return new Promise((resolve, reject) => {
    const job = { id: uid('j'), asin, resolve, reject, sent: false };
    jobs.set(job.id, job);
    if (sessionAlive()) dispatch(job);
    renderSession();
  });
}

function finishJob(id, product, error) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  if (error) job.reject(new Error(error)); else job.resolve(product);
  renderSession();
}

// Precio pagado: el conector lee tus pedidos (lista → facturas). Puede tardar: tiene su propio límite de tiempo.
const ORDERS_TIMEOUT_MS = 5 * 60000;
const OLD_CONNECTOR = 'Tu marcador «➕ Armador PC» es de una versión anterior: reinstálalo desde 🔌 Conector para leer tus pedidos.';
const orderJobs = new Map(); // id → { items, resolve, reject, onProgress, sent, timer }
const connectorOutdated = () => !!connectorVersion && !!session.version && session.version !== connectorVersion;

function dispatchOrders(job) {
  if (connectorOutdated()) return finishOrders(job.id, null, OLD_CONNECTOR);
  job.sent = true;
  session.win.postMessage({ type: 'pcb:orders', id: job.id, items: job.items }, session.origin);
}

// items: [{ asin, query }] → el conector busca cada uno en tus pedidos (por ASIN y, si no aparece, por nombre).
function requestOrders(items, onProgress) {
  return new Promise((resolve, reject) => {
    const job = { id: uid('o'), items, resolve, reject, onProgress, sent: false };
    job.timer = setTimeout(() => finishOrders(job.id, null, 'Leer tus pedidos tardó demasiado. Reintenta.'), ORDERS_TIMEOUT_MS);
    orderJobs.set(job.id, job);
    if (sessionAlive()) dispatchOrders(job);
  });
}

function finishOrders(id, data, error) {
  const job = orderJobs.get(id);
  if (!job) return;
  orderJobs.delete(id);
  clearTimeout(job.timer);
  if (error) job.reject(new Error(error)); else job.resolve(data);
}

function linkSession(win, origin, info) {
  const wasAlive = sessionAlive();
  Object.assign(session, { win, origin, connected: true, version: info.version, loggedIn: info.loggedIn, deliverTo: info.deliverTo || '', lastMsg: Date.now() });
  try { win.postMessage({ type: 'pcb:welcome' }, origin); } catch { /* cerrada */ }
  if (!wasAlive) {
    toast(`Amazon conectado con tu sesión${info.deliverTo ? ` (entrega: ${info.deliverTo})` : ''}.`);
    if (connectorVersion && info.version !== connectorVersion) toast('Tu marcador «➕ Armador PC» es de una versión anterior. Reinstálalo desde 🔌 Conector.', true, 10000);
    if (!info.loggedIn) toast('El conector no detecta sesión iniciada en Amazon: los envíos y cargos pueden no ser los de tu cuenta.', true, 8000);
    for (const job of jobs.values()) if (!job.sent) dispatch(job); // lo pedido antes de conectar
    for (const job of [...orderJobs.values()]) if (!job.sent) dispatchOrders(job);
    if (pricesRun.active && pricesRun.amazon?.state === 'idle') runAmazonPrices();
  }
  renderSession();
  renderPricesModal();
}

// ---------- otras tiendas (Newegg, Best Buy, Micro Center, Mercado Libre) ----------
// Sus servidores bloquean las consultas que no vienen de un navegador: el conector corre en la pestaña de cada
// tienda (una por origen) y lee el precio de cada enlace con tu navegador.
//   armador → { type: 'pcb:price', id, url }   conector → { type: 'pcb:price-data', id, data } | { type: 'pcb:price-error', id, error }
const PRICE_TIMEOUT_MS = 60000;
const storeSessions = new Map(); // origen → { win, store, connected, version }
const priceJobs = new Map();     // id → { url, origin, resolve, reject, sent, timer }
const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };
const isStoreOrigin = (origin) => { try { const u = new URL(origin); return u.protocol === 'https:' && !!storeOfHost(u.hostname); } catch { return false; } };
const storeAlive = (origin) => { const x = storeSessions.get(origin); return !!x?.connected && !!x.win && !x.win.closed; };

function dispatchPrice(job) {
  job.sent = true;
  clearTimeout(job.timer);
  job.timer = setTimeout(() => finishPrice(job.id, job.origin, null, 'La tienda no respondió a tiempo: recarga su pestaña y pulsa de nuevo el marcador.'), PRICE_TIMEOUT_MS);
  try { storeSessions.get(job.origin).win.postMessage({ type: 'pcb:price', id: job.id, url: job.url }, job.origin); } catch { job.sent = false; }
}
function requestPrice(url) {
  return new Promise((resolve, reject) => {
    const job = { id: uid('s'), url, origin: originOf(url), resolve, reject, sent: false, timer: null };
    priceJobs.set(job.id, job);
    if (storeAlive(job.origin)) dispatchPrice(job);
  });
}
function finishPrice(id, origin, data, error) {
  const job = priceJobs.get(id);
  if (!job || job.origin !== origin) return; // solo responde la tienda a la que se le pidió
  priceJobs.delete(id);
  clearTimeout(job.timer);
  if (error) job.reject(new Error(error)); else job.resolve(data);
}
function sanitizePrice(d) {
  const currency = d?.currency === 'COP' ? 'COP' : 'USD';
  return { price: num(d?.price), currency, title: String(d?.title || '').slice(0, 200), inStock: d?.inStock === true ? true : d?.inStock === false ? false : null };
}
function linkStore(win, origin, info) {
  const was = storeAlive(origin);
  storeSessions.set(origin, { win, store: storeOfHost(new URL(origin).hostname), connected: true, version: info.version });
  try { win.postMessage({ type: 'pcb:welcome' }, origin); } catch { /* cerrada */ }
  if (was) return;
  checkConnectorVersion(info.version);
  for (const job of priceJobs.values()) if (!job.sent && job.origin === origin) dispatchPrice(job);
  renderPricesModal();
}
// Abre (o enfoca) la pestaña de la tienda en uno de sus enlaces; ahí se pulsa el marcador.
function openStoreTab(origin, url) {
  const x = storeSessions.get(origin);
  if (x?.win && !x.win.closed) return x.win.focus();
  const win = window.open(url, `pcb-${new URL(origin).hostname}`);
  storeSessions.set(origin, { win, store: storeOfHost(new URL(origin).hostname), connected: false, version: null });
  renderPricesModal();
}
setInterval(() => {
  for (const [origin, x] of storeSessions) {
    if (!x.connected || (x.win && !x.win.closed)) continue;
    x.connected = false; // pestaña cerrada: lo enviado vuelve a la espera
    for (const job of priceJobs.values()) if (job.origin === origin && job.sent) { job.sent = false; clearTimeout(job.timer); }
    renderPricesModal();
  }
}, 3000);

// Vigila la conexión: si la pestaña de Amazon se cierra, lo pendiente vuelve a la espera; si el conector deja de responder, falla.
setInterval(() => {
  if (session.connected && (!session.win || session.win.closed)) {
    session.connected = false;
    let requeued = 0;
    for (const job of jobs.values()) if (job.sent) { job.sent = false; requeued++; }
    if (requeued) toast(`Se cerró la pestaña de Amazon: ${requeued} actualizaciones quedan en espera hasta reconectar.`, true, 8000);
    renderSession();
  } else if (sessionAlive() && Date.now() - session.lastMsg > STALL_MS) {
    for (const job of [...jobs.values()]) if (job.sent) finishJob(job.id, null, 'El conector no respondió. Recarga la pestaña de Amazon y pulsa de nuevo el marcador.');
    session.lastMsg = Date.now();
  }
}, 3000);

const PRODUCT_KEYS = ['asin', 'url', 'title', 'image', 'brand', 'deliverTo', 'price', 'currency', 'shipping', 'importFees', 'importFeesInfo', 'total', 'seller', 'shipsFrom', 'availability', 'shipsToCO', 'locationOk', 'rating', 'reviews', 'hasBuybox', 'condition', 'priceSource', 'loggedIn', 'fetchedAt', 'specs', 'bullets', 'offers', 'debug', 'region'];
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// Los datos llegan de otra pestaña: solo se aceptan campos conocidos, con tipos válidos y enlaces de amazon.com.
function sanitizeIncoming(raw) {
  const p = Object.fromEntries(PRODUCT_KEYS.filter((k) => raw?.[k] !== undefined).map((k) => [k, raw[k]]));
  if (!/^[A-Z0-9]{10}$/.test(p.asin || '') || typeof p.title !== 'string') throw new Error('Datos del conector inválidos');
  p.url = `https://www.amazon.com/dp/${p.asin}`;
  if (p.image && !/^https:\/\/[\w.-]+\.(media-amazon|ssl-images-amazon)\.com\//.test(p.image)) p.image = '';
  for (const k of ['price', 'shipping', 'importFees', 'total', 'rating', 'reviews']) p[k] = num(p[k]);
  p.currency = p.currency === 'COP' ? 'COP' : 'USD';
  p.specs = typeof p.specs === 'object' && p.specs && !Array.isArray(p.specs) ? Object.fromEntries(Object.entries(p.specs).slice(0, 60).map(([k, v]) => [String(k).slice(0, 60), String(v).slice(0, 160)])) : {};
  p.bullets = Array.isArray(p.bullets) ? p.bullets.map(String).slice(0, 8) : [];
  p.offers = Array.isArray(p.offers) ? p.offers.slice(0, 12).map((o) => ({ price: num(o?.price), currency: o?.currency === 'COP' ? 'COP' : 'USD', shipping: num(o?.shipping), condition: String(o?.condition || ''), seller: String(o?.seller || ''), shipsFrom: String(o?.shipsFrom || ''), origin: String(o?.origin || ''), delivery: String(o?.delivery || '') })) : [];
  p.debug = typeof p.debug === 'object' && p.debug ? Object.fromEntries(Object.entries(p.debug).map(([k, v]) => [k, String(v ?? '').slice(0, 1500)])) : null;
  p.locationOk = p.locationOk !== false;
  p.region = p.region === 'us' || p.region === 'co' ? p.region : null;
  return p;
}

// Facturas de tus pedidos: solo campos conocidos, con tipos válidos.
function sanitizeInvoices(list) {
  return (Array.isArray(list) ? list : []).slice(0, 500).map((v) => ({
    orderId: /^\d{3}-\d{7}-\d{7}$/.test(v?.orderId || '') ? v.orderId : '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(v?.date || '') ? v.date : null,
    currency: v?.currency === 'COP' ? 'COP' : 'USD',
    items: (Array.isArray(v?.items) ? v.items : []).slice(0, 60).filter((it) => /^[A-Z0-9]{10}$/.test(it?.asin || ''))
      .map((it) => ({ asin: it.asin, title: String(it.title || '').slice(0, 300), price: num(it.price), qty: Math.max(1, Math.round(num(it.qty) || 1)) })),
    subtotal: num(v?.subtotal), shipping: num(v?.shipping), discounts: num(v?.discounts), importFees: num(v?.importFees), tax: num(v?.tax), total: num(v?.total), charged: num(v?.charged),
  }));
}

// Si tu cuenta muestra pesos, se convierte a USD con la TRM de Ajustes (estimado) y se guarda lo que muestra Amazon en COP.
function toUSD(d) {
  if (d.currency !== 'COP') return d;
  const rate = S().trm;
  const conv = (v) => (v == null ? null : +(v / rate).toFixed(2));
  return {
    ...d,
    displayed: { currency: 'COP', price: d.price, shipping: d.shipping, importFees: d.importFees, total: d.total },
    fx: { rate, source: 'TRM de Ajustes (estimado)' },
    price: conv(d.price), shipping: conv(d.shipping), importFees: conv(d.importFees), total: conv(d.total),
    offers: d.offers.map((o) => (o.currency === 'COP' ? { ...o, price: conv(o.price), shipping: conv(o.shipping), currency: 'USD' } : o)),
    currency: 'USD',
  };
}

// Todas las copias de un producto (en todos los armados) reciben la misma lectura.
const allProducts = () => store.builds.flatMap((b) => Object.values(b.parts).flatMap((s) => s.options));
const productsByAsin = (asin) => allProducts().filter((p) => asinOf(p) === asin);
// Filas de tiendas (no Amazon) con ese enlace, en todos los armados.
const rowsByUrl = (url) => allProducts().flatMap((p) => (p.stores || []).filter((r) => r.url === url && !STORES[r.store]?.amazon).map((row) => ({ p, row })));

// Filas «Amazon CO» / «Amazon USA» con ese ASIN: se llenan solo si tu sesión entrega en su destino.
function updateAmazonRows(asin, d) {
  for (const p of allProducts()) for (const row of p.stores || []) {
    const st = STORES[row.store];
    if (!st?.amazon || extractAsin(row.url) !== asin || !d.region || d.region !== st.region) continue;
    const before = row.price;
    setStorePrice(row, { price: amazonStorePrice(d, st.region, S()), currency: 'USD' });
    notePriceChange(p, row.store, before, row.price, 'USD');
  }
}

// Pide a la sesión una lista de ASIN (sin duplicados) y reescribe cada producto al llegar su ficha.
async function updateAsins(asins, onEach) {
  const list = [...new Set(asins.filter(Boolean))];
  const r = { ok: 0, failed: 0, changed: 0, errors: [], kept: new Set(), replaced: new Set(), changes: [], skipped: 0, skippedWant: new Set() };
  list.forEach((a) => busyAsins.add(a));
  scheduleRender();
  await Promise.all(list.map(async (asin) => {
    try {
      const d = toUSD(sanitizeIncoming(await sendJob(asin)));
      updateAmazonRows(asin, d);
      for (const p of productsByAsin(asin)) {
        const prev = {
          price: p.price,
          shipping: p.shipping,
          importFees: p.importFees,
          total: p.total,
          availability: p.availability,
          shipsToCO: p.shipsToCO,
          seller: p.seller,
        };
        const res = applySession(p, structuredClone(d));
        if (res.skipped) { r.skipped++; r.skippedWant.add(res.want); continue; }
        res.keptEdits.forEach((k) => r.kept.add(k));
        res.replacedEdits.forEach((k) => r.replaced.add(k));
        if (res.keptEdits.length) r.keptProducts = (r.keptProducts || 0) + 1;
        if (res.replacedEdits.length) r.replacedProducts = (r.replacedProducts || 0) + 1;
        if (prev.price != null && prev.price !== p.price) r.changed++;

        const priceChanged = prev.price !== p.price;
        const shippingChanged = prev.shipping !== p.shipping;
        const importFeesChanged = prev.importFees !== p.importFees;
        const availabilityChanged = prev.availability !== p.availability;
        const shipsToCOChanged = prev.shipsToCO !== p.shipsToCO;
        const sellerChanged = prev.seller !== p.seller;
        const targetHit = (p.targetPrice != null && p.price != null && p.price <= p.targetPrice && (prev.price == null || prev.price > p.targetPrice));
        const hasAnyChange = priceChanged || shippingChanged || importFeesChanged || availabilityChanged || shipsToCOChanged || sellerChanged || targetHit || res.replacedEdits.length > 0;

        if (hasAnyChange && !r.changes.some((c) => c.asin === asin)) {
          let cat = 'accessories';
          for (const c of CATEGORIES) {
            if (slot(c.key).options.some((o) => o.id === p.id)) { cat = c.key; break; }
          }
          r.changes.push({
            asin,
            id: p.id,
            cat,
            catName: CAT[cat]?.name || 'Accesorio',
            title: p.title,
            image: p.image,
            url: p.url,
            prev,
            curr: {
              price: p.price,
              shipping: p.shipping,
              importFees: p.importFees,
              total: p.total,
              availability: p.availability,
              shipsToCO: p.shipsToCO,
              seller: p.seller,
            },
            priceChanged,
            priceDiff: (prev.price != null && p.price != null) ? +(p.price - prev.price).toFixed(2) : null,
            priceDiffPct: (prev.price != null && p.price != null && prev.price > 0) ? +(((p.price - prev.price) / prev.price) * 100).toFixed(1) : null,
            shippingChanged,
            importFeesChanged,
            availabilityChanged,
            shipsToCOChanged,
            sellerChanged,
            targetHit,
            targetPrice: p.targetPrice,
            keptEdits: res.keptEdits,
            replacedEdits: res.replacedEdits,
          });
        }
      }
      r.ok++;
    } catch (e) {
      r.failed++;
      r.errors.push(e.message);
    } finally {
      busyAsins.delete(asin);
      progress.done++;
      onEach?.();
      save();
      scheduleRender();
    }
  }));
  return r;
}

let refreshing = false;
const progress = { done: 0, total: 0 };

async function updateOne(cat, id) {
  const p = findP(cat, id);
  const asin = asinOf(p);
  if (!asin) return detailsModal(cat, id, { focusLink: true });
  requireSession();
  const before = p.price;
  const r = await updateAsins([asin]);
  if (r.failed) return toast(`${shortTitle(p.title, 40)}: ${r.errors[0]}`, true, 8000);
  if (r.skipped) return toast(wrongRegionText(p), true, 10000);
  if (r.kept.size) return toast(`Amazon no mostró un precio con envío a Colombia: se conservaron tus ediciones (${editedLabels([...r.kept])}).`, false, 8000);
  if (r.replaced.size) return toast(`Tu sesión encontró precio con envío a Colombia (${usd(p.price)}): se reemplazaron tus ediciones (${editedLabels([...r.replaced])}).`, false, 8000);
  const miss = missingFields(p);
  toast(before != null && p.price !== before ? `Precio cambió: ${usd(before)} → ${usd(p.price)}` : miss.length ? `Actualizado; Amazon no mostró: ${miss.join(', ')}` : 'Actualizado con tu sesión');
  if (r.changes?.length && !modal.open) openChangesModal(r);
}

// Productos de Amazon del armado activo (cualquier estado, incluidos los comprados).
// Solo entran los productos del destino al que entrega tu sesión (Colombia o Miami): los otros se omiten.
const sessionRegion = () => regionOf(session.deliverTo || '');
const wrongRegionText = (p) => `Este producto es para ${marketLabel(p)} y tu sesión de Amazon entrega en ${session.deliverTo || 'otra dirección'}: no se actualizó. Cambia la dirección de entrega en Amazon a ${marketLabel(p)}, recarga la pestaña y pulsa de nuevo el marcador.`;
function refreshQueue() {
  const s = S();
  const region = sessionRegion();
  const all = CATEGORIES.flatMap((c) => slot(c.key).options.filter((p) => asinOf(p)).map((p) => ({ cat: c.key, p })));
  const other = region ? all.filter(({ p }) => MARKETS[marketOf(p)].region !== region) : [];
  const todo = all.filter(({ p }) => needsRefresh(p, s) && !other.some((o) => o.p === p));
  return { all, todo, other };
}

async function refreshAll() {
  if (refreshing) return;
  const s = S();
  const { all, todo, other } = refreshQueue();
  const otherText = other.length ? `${other.length} de ${other[0].p ? marketLabel(other[0].p) : 'otro destino'} omitidos (tu sesión entrega en ${session.deliverTo})` : '';
  if (!all.length) return toast('No hay productos con enlace de Amazon para actualizar.');
  if (!todo.length) return toast(other.length ? `Nada que actualizar para ${session.deliverTo}: ${otherText}.` : `Todo al día: ${all.length} productos leídos con tu sesión hace menos de ${s.refreshMinutes} min y completos.`, false, 8000);
  requireSession();
  refreshing = true;
  // Lo marcado con más estrellas se lee primero: los precios que de verdad vas a pagar llegan antes.
  const asins = [...new Set(sortByPick(todo.map(({ p }) => p)).map((p) => asinOf(p)))];
  Object.assign(progress, { done: 0, total: asins.length });
  const r = await updateAsins(asins);
  refreshing = false;
  render();
  const skipped = all.length - todo.length - other.length;
  const incomplete = refreshQueue().all.filter(({ p }) => missingFields(p).length).length;
  toast([`Actualizados ${r.ok}/${asins.length} con tu sesión`, otherText, r.skipped && `${r.skipped} no coinciden con el destino de tu sesión (no se tocaron)`, skipped && `${skipped} omitidos (leídos hace < ${s.refreshMinutes} min)`, `${r.changed} cambiaron de precio`, r.keptProducts && `${r.keptProducts} con ediciones conservadas (sin precio con envío a Colombia)`, r.replacedProducts && `${r.replacedProducts} con ediciones reemplazadas por Amazon`, r.failed && `${r.failed} con error: ${r.errors[0]}`, incomplete && `${incomplete} con datos que Amazon no muestra`].filter(Boolean).join(' · '), !!r.failed, 8000);
  if (r.changes?.length) openChangesModal(r);
}

// ---------- solo precios: relee el precio de cada enlace (Amazon y las demás tiendas) ----------
// Amazon se lee con tu sesión (solo los del destino al que entrega); cada otra tienda, en su propia pestaña con el
// marcador. Lo que no tiene pestaña conectada queda en espera: el modal muestra un botón para abrir cada tienda.
const pricesRun = { active: false, amazon: null, origins: new Map(), changes: [] };

function notePriceChange(p, storeKey, before, after, currency) {
  if (!pricesRun.active || before == null || after == null || Number(before) === Number(after)) return;
  if (pricesRun.changes.some((c) => c.title === p.title && c.store === storeKey)) return; // copias en otros armados
  pricesRun.changes.push({ title: p.title, store: storeKey, before: Number(before), after: Number(after), currency });
}

// Enlaces del armado activo: ASIN por destino de Amazon y enlaces de otras tiendas agrupados por origen.
function priceTargets() {
  const amazon = { co: new Set(), us: new Set() };
  const others = new Map();
  for (const c of CATEGORIES) for (const p of slot(c.key).options) {
    const own = ownAmazonStore(p);
    if (own && asinOf(p)) amazon[STORES[own].region].add(asinOf(p));
    for (const r of p.stores || []) {
      const st = STORES[r.store];
      if (!st || !r.url || !urlFitsStore(r.url, r.store)) continue;
      if (st.amazon) { const a = extractAsin(r.url); if (a) amazon[st.region].add(a); continue; }
      const o = originOf(r.url);
      if (!others.has(o)) others.set(o, { store: r.store, urls: new Set() });
      others.get(o).urls.add(r.url);
    }
  }
  return { amazon, others };
}

async function refreshPrices() {
  if (pricesRun.active) return pricesModal();
  const { amazon, others } = priceTargets();
  if (!amazon.co.size && !amazon.us.size && !others.size) return toast('No hay enlaces de tiendas en este armado. Agrégalos en ✎ Detalles → Comercios.');
  Object.assign(pricesRun, {
    active: true,
    changes: [],
    amazon: amazon.co.size || amazon.us.size ? { co: [...amazon.co], us: [...amazon.us], state: 'idle', done: 0, total: 0, failed: 0, errors: [], other: 0, otherLabel: '' } : null,
    origins: new Map([...others].map(([o, v]) => [o, { store: v.store, urls: [...v.urls], done: 0, failed: 0, errors: [], state: 'waiting' }])),
  });
  pricesModal();
  const tasks = [...pricesRun.origins].map(([origin, o]) => runStorePrices(origin, o));
  if (pricesRun.amazon && sessionAlive()) tasks.push(runAmazonPrices());
  renderRefreshPrices();
  await Promise.all(tasks);
  maybeFinishPrices();
}

async function runAmazonPrices() {
  const a = pricesRun.amazon;
  if (!a || a.state !== 'idle') return;
  const region = sessionRegion();
  const list = region ? a[region] : [...new Set([...a.co, ...a.us])];
  const otherRegion = region === 'co' ? 'us' : 'co';
  a.other = region ? a[otherRegion].filter((x) => !list.includes(x)).length : 0;
  a.otherLabel = otherRegion === 'us' ? 'Miami' : 'Colombia';
  Object.assign(a, { state: 'running', total: list.length, done: 0 });
  renderPricesModal();
  if (list.length) {
    Object.assign(progress, { done: 0, total: list.length });
    const r = await updateAsins(list, () => { a.done++; renderPricesModal(); });
    a.failed = r.failed;
    a.errors = r.errors;
    for (const c of r.changes || []) {
      const own = ownAmazonStore(findP(c.cat, c.id) || {});
      if (own) notePriceChange({ title: c.title }, own, c.prev.total ?? c.prev.price, c.curr.total ?? c.curr.price, 'USD');
    }
  }
  a.state = 'done';
  renderPricesModal();
  maybeFinishPrices();
}

async function runStorePrices(origin, o) {
  await Promise.all(o.urls.map(async (url) => {
    try {
      const d = await requestPrice(url);
      for (const { p, row } of rowsByUrl(url)) {
        const before = row.price;
        setStorePrice(row, d);
        notePriceChange(p, row.store, before, row.price, row.currency);
      }
      o.done++;
    } catch (e) {
      if (e.message === 'Cancelado') { o.cancelled = (o.cancelled || 0) + 1; return; }
      o.failed++;
      o.errors.push(e.message);
      for (const { row } of rowsByUrl(url)) row.error = e.message.slice(0, 200); // se conserva el último precio
    } finally {
      save();
      scheduleRender();
      renderPricesModal();
    }
  }));
  o.state = 'done';
  renderPricesModal();
}

function maybeFinishPrices() {
  if (!pricesRun.active) return;
  const storesDone = [...pricesRun.origins.values()].every((o) => o.state === 'done');
  const amazonDone = !pricesRun.amazon || pricesRun.amazon.state === 'done' || pricesRun.amazon.state === 'cancelled';
  if (!storesDone || !amazonDone) return;
  pricesRun.active = false;
  const origins = [...pricesRun.origins.values()];
  const read = origins.reduce((n, o) => n + o.done, 0) + (pricesRun.amazon?.state === 'done' ? pricesRun.amazon.done - pricesRun.amazon.failed : 0);
  const failed = origins.reduce((n, o) => n + o.failed, 0) + (pricesRun.amazon?.failed || 0);
  toast(`Precios actualizados: ${read} leídos · ${pricesRun.changes.length} cambiaron${failed ? ` · ${failed} con error` : ''}`, !!failed, 8000);
  render();
  renderPricesModal();
}

// Lo que sigue en espera (sin pestaña conectada) se descarta; lo ya leído se queda.
function cancelPrices() {
  for (const job of [...priceJobs.values()]) if (!job.sent) finishPrice(job.id, job.origin, null, 'Cancelado');
  if (pricesRun.amazon?.state === 'idle') pricesRun.amazon.state = 'cancelled';
  maybeFinishPrices();
}

const storeName = (key) => STORES[key]?.name || key;
const fmtStorePrice = (price, currency) => (price == null ? '—' : currency === 'COP' ? copAmazon(price) : usd(price));

function pricesModal() {
  openModal(`
    <div class="m-head"><h2>Actualizar precios</h2><button class="btn ghost" data-action="close" aria-label="Cerrar">✕</button></div>
    <div class="m-body" id="pricesBody"></div>
    <div class="m-foot" id="pricesFoot"></div>`);
  renderPricesModal();
}

function renderPricesModal() {
  renderRefreshPrices();
  const box = $('#pricesBody');
  if (!box || !modal.open) return;
  const rowHtml = ({ key, name, sub, done, total, state, failed, errors, action }) => {
    const pct = total ? Math.round((done / total) * 100) : 0;
    const label = state === 'done' ? (failed ? `<span class="err-t">${done - failed}/${total} · ${failed} con error</span>` : `<span class="ok-t">✓ ${done}/${total}</span>`)
      : state === 'running' ? `Leyendo ${done}/${total}…`
      : state === 'cancelled' ? '<span class="muted">Cancelado</span>'
      : `<span class="warn-t">${esc(sub)}</span>`;
    return `<li class="pr-row ${state}">
      ${STORE_LOGOS[key]}
      <div class="pr-main"><b>${esc(name)}</b><div class="bar ${state === 'done' && !failed ? 'ok' : ''}"><i style="width:${state === 'done' ? 100 : pct}%"></i></div>
        <small>${label}</small>${errors?.length ? `<small class="err-t" title="${esc(errors.join(' · '))}">${esc(errors[0])}</small>` : ''}</div>
      ${action || ''}</li>`;
  };
  const rows = [];
  const a = pricesRun.amazon;
  if (a) {
    rows.push(rowHtml({
      key: sessionRegion() === 'us' ? 'amazon-us' : 'amazon-co',
      name: `Amazon${session.deliverTo ? ` · entrega: ${session.deliverTo}` : ''}`,
      sub: 'Conecta tu sesión de Amazon',
      done: a.done, total: a.total || a.co.length + a.us.length, state: a.state, failed: a.failed, errors: a.errors.slice(0, 1),
      action: a.state === 'idle' ? '<button class="btn small primary" data-action="session">● Conectar Amazon</button>' : '',
    }));
    if (a.other) rows.push(`<li class="pr-note muted">${a.other} producto(s) con envío a ${a.otherLabel} no se leyeron: tu sesión entrega en ${esc(session.deliverTo || 'otro destino')}. Cambia la dirección en Amazon, recarga, pulsa el marcador y vuelve a «$ Actualizar precios».</li>`);
  }
  for (const [origin, o] of pricesRun.origins) {
    const x = storeSessions.get(origin);
    const opened = !!x?.win && !x.win.closed;
    const state = o.state === 'done' ? (o.cancelled && !o.done && !o.failed ? 'cancelled' : 'done') : storeAlive(origin) ? 'running' : 'waiting';
    rows.push(rowHtml({
      key: o.store, name: `${storeName(o.store)} · ${new URL(origin).hostname.replace(/^www\./, '')}`,
      sub: opened ? 'Pestaña abierta: pulsa ahí el marcador «➕ Armador PC»' : 'Abre la tienda y pulsa ahí el marcador',
      done: o.done + o.failed, total: o.urls.length, state, failed: o.failed, errors: o.errors.slice(0, 1),
      action: state === 'waiting' ? `<button class="btn small primary" data-action="open-store" data-origin="${esc(origin)}">${opened ? 'Ir a' : 'Abrir'} ${esc(storeName(o.store))} ↗</button>` : '',
    }));
  }
  const ch = pricesRun.changes;
  box.innerHTML = `
    <p class="muted" style="margin:0">Relee el precio de cada enlace del armado. Las tiendas bloquean las consultas del servidor: cada una se lee en su propia pestaña con tu navegador. Ábrela con su botón y pulsa ahí el marcador «➕ Armador PC»; lo pendiente sigue solo.</p>
    <ul class="pr-list">${rows.join('')}</ul>
    ${ch.length ? `<div><p class="section-title">Cambiaron de precio (${ch.length})</p><div class="scroll-x"><table class="t">
      <tr><th>Producto</th><th>Tienda</th><th class="r">Antes</th><th class="r">Ahora</th></tr>
      ${ch.map((c) => `<tr><td>${esc(shortTitle(c.title, 60))}</td><td>${esc(storeName(c.store))}</td><td class="r">${fmtStorePrice(c.before, c.currency)}</td>
        <td class="r"><b class="${c.after < c.before ? 'ok-t' : 'err-t'}">${c.after < c.before ? '▼' : '▲'} ${fmtStorePrice(c.after, c.currency)}</b></td></tr>`).join('')}
    </table></div></div>` : pricesRun.active ? '' : '<p class="muted" style="margin:0">Ningún precio cambió.</p>'}`;
  $('#pricesFoot').innerHTML = pricesRun.active
    ? '<button class="btn ghost" data-action="cancel-prices">Cancelar lo pendiente</button><span class="spacer"></span><button class="btn" data-action="close">Seguir en segundo plano</button>'
    : '<span class="spacer"></span><button class="btn primary" data-action="close">Listo</button>';
}

function renderRefreshPrices() {
  const btn = $('#refreshPrices');
  if (!btn) return;
  if (!pricesRun.active) { btn.textContent = '$ Actualizar precios'; btn.title = 'Relee solo el precio de cada enlace: Amazon y las demás tiendas'; return; }
  const origins = [...pricesRun.origins.values()];
  const a = pricesRun.amazon;
  const total = origins.reduce((n, o) => n + o.urls.length, 0) + (a ? a.total || a.co.length + a.us.length : 0);
  const done = origins.reduce((n, o) => n + o.done + o.failed, 0) + (a?.done || 0);
  btn.textContent = `$ Precios ${done}/${total}…`;
  btn.title = 'Ver el avance';
}

// El marcador lleva el código embebido: si el conector cambió, hay que reinstalarlo.
function checkConnectorVersion(v) {
  if (connectorVersion && v !== connectorVersion) toast('Tu marcador «➕ Armador PC» es de una versión anterior. Reinstálalo desde 🔌 Conector.', true, 10000);
}

// Producto enviado desde el panel del conector ("agregar este producto").
function receiveProduct(msg) {
  checkConnectorVersion(msg.connector);
  const d = toUSD(sanitizeIncoming(msg.product));
  const cat = CAT[msg.cat] ? msg.cat : 'accessories';
  const s = slot(cat);
  const existing = s.options.find((o) => asinOf(o) === d.asin);
  if (!existing) {
    // Se crea ya con el ASIN para que productsByAsin lo encuentre y reciba la lectura.
    const p = { id: uid('p'), asin: d.asin, url: d.url, status: 'buy', pick: 0, qty: 1, tags: {}, notes: '', history: [] };
    s.options.push(p);
    if (!s.selected.length) s.selected.push(p.id);
  }
  const skipped = productsByAsin(d.asin).filter((p) => applySession(p, structuredClone(d)).skipped);
  if (skipped.length) toast(wrongRegionText(skipped[0]), true, 10000);
  const text = existing ? `Actualizado con tu sesión (${CAT[cat].name})` : `Agregado a ${CAT[cat].name}`;
  openCats.add(cat);
  commit();
  toast(`${text}: ${shortTitle(d.title, 40)}`);
  $(`#cat-${cat}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return text;
}

// Mensajes del conector.
window.addEventListener('message', (e) => {
  if (isStoreOrigin(e.origin)) {
    const m = e.data || {};
    if (m.type === 'pcb:hello' && typeof m.store === 'string') return linkStore(e.source, e.origin, m);
    if (m.type === 'pcb:price-data') return finishPrice(m.id, e.origin, sanitizePrice(m.data));
    if (m.type === 'pcb:price-error') return finishPrice(m.id, e.origin, null, String(m.error || 'Error leyendo el precio').slice(0, 300));
    return;
  }
  if (!AMAZON_ORIGINS.includes(e.origin)) return;
  const m = e.data || {};
  if (e.source === session.win) session.lastMsg = Date.now();
  if (m.type === 'pcb:hello') return linkSession(e.source, e.origin, m);
  if (m.type === 'pcb:data') return finishJob(m.id, m.product);
  if (m.type === 'pcb:error') return finishJob(m.id, null, m.error || 'Error del conector');
  if (m.type === 'pcb:orders-progress') return orderJobs.get(m.id)?.onProgress?.(Number(m.done) || 0, Number(m.total) || 0);
  if (m.type === 'pcb:orders-data') return finishOrders(m.id, { invoices: sanitizeInvoices(m.invoices), orders: Number(m.orders) || 0 });
  if (m.type === 'pcb:orders-error') return finishOrders(m.id, null, String(m.error || 'Error leyendo tus pedidos'));
  if (m.type === 'pcb:add') {
    try { e.source?.postMessage({ type: 'pcb:ack', text: receiveProduct(m) }, e.origin); } catch (err) { toast(err.message, true); }
  }
});
// Si esta pestaña la abrió el conector ("Conectar con el armador"), se le presenta.
try { window.opener?.postMessage({ type: 'pcb:ping' }, '*'); } catch { /* sin opener */ }

// Si el conector abrió una pestaña nueva (#add=…), esa pestaña se lo pasa a la del armador ya abierta.
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('pc-builder') : null;
channel?.addEventListener('message', (e) => {
  if (e.data?.type !== 'pcb:add') return;
  channel.postMessage({ type: 'pcb:ack', nonce: e.data.nonce });
  try { receiveProduct(e.data); } catch (err) { toast(err.message, true); }
});

function decodeHashPayload() {
  const m = location.hash.match(/^#add=([\w-]+)/);
  if (!m) return null;
  history.replaceState(null, '', location.pathname);
  const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
}

async function handleHashPayload() {
  let msg;
  try { msg = decodeHashPayload(); } catch { return toast('No pude leer los datos que envió el conector.', true); }
  if (!msg) return;
  // Cualquier página puede abrir esta URL: se confirma antes de tocar el armado.
  const name = CAT[msg.cat]?.name || 'Cables y accesorios';
  const price = msg.product?.price == null ? 'sin precio' : `${msg.product.currency === 'COP' ? 'COP ' : 'US$'}${msg.product.price}`;
  if (!confirm(`¿Agregar al armado (${name})?\n\n${shortTitle(msg.product?.title || '', 90)}\n${price}`)) return;
  if (channel) {
    const nonce = Math.random().toString(36).slice(2);
    const acked = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 700);
      channel.addEventListener('message', (e) => { if (e.data?.type === 'pcb:ack' && e.data.nonce === nonce) { clearTimeout(t); resolve(true); } });
      channel.postMessage({ ...msg, nonce });
    });
    if (acked) {
      document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;font:16px system-ui;text-align:center;padding:16px"><div><b>✓ Enviado al armador que ya tenías abierto.</b><br><span style="opacity:.7">Puedes cerrar esta pestaña.</span></div></div>';
      setTimeout(() => window.close(), 800);
      return 'handed-off';
    }
  }
  try { receiveProduct(msg); } catch (err) { toast(err.message, true); }
}

function renderSession() {
  const btn = $('#sessionBtn');
  if (!btn) return;
  const running = jobs.size;
  const waiting = [...jobs.values()].filter((j) => !j.sent).length;
  let text, cls;
  if (sessionAlive()) { text = `● Amazon conectado${running ? ` · ${running} en curso` : ''}`; cls = 'on'; }
  else if (session.win && !session.win.closed) { text = `● Pulsa el marcador en Amazon${waiting ? ` · ${waiting} en espera` : ''}`; cls = 'wait'; }
  else { text = `● Conectar Amazon${waiting ? ` · ${waiting} en espera` : ''}`; cls = 'off'; }
  btn.textContent = text;
  btn.className = `btn session ${cls}`;
  btn.title = sessionAlive() ? `Tu sesión de Amazon${session.deliverTo ? ` · entrega: ${session.deliverTo}` : ''}. Clic para ir a la pestaña.` : 'Abre Amazon; ahí pulsa el marcador «➕ Armador PC».';
}

async function connectorModal() {
  const code = await (await fetch('/api/connector')).text();
  const href = 'javascript:' + encodeURIComponent(code);
  // En el celular el marcador completo (~35 KB) llega dañado a Chrome para Android: se usa uno corto que carga el
  // conector desde el armador. Solo sirve por https (Tailscale): amazon.com no carga scripts de http://localhost.
  const loader = `javascript:void((()=>{const s=document.createElement('script');s.src='${location.origin}/api/connector?t='+Date.now();s.onerror=()=>alert('Armador PC: no pude cargar el conector. Revisa que el laptop y Tailscale esten encendidos.');document.head.append(s)})())`;
  openModal(`
    <div class="m-head"><h2>Conector de Amazon (tu sesión)</h2><button class="btn ghost" data-action="close" aria-label="Cerrar">✕</button></div>
    <div class="m-body">
      <p style="margin:0">Toda la información de Amazon se lee con <b>tu sesión</b>: el conector es un marcador que corre dentro de amazon.com,
      con tu cuenta y tu dirección en Colombia. El armador le pide productos y el conector le devuelve la ficha completa: precio, envío,
      cargos de importación de tu cuenta, foto, ofertas y especificaciones. El armador no ve tus cookies ni tu contraseña.</p>
      ${IS_MOBILE ? `
      <p style="margin:0"><b>En el celular</b> (Chrome para Android) se instala una vez, <b>desde aquí mismo</b>: el marcador del computador apunta a otra dirección y no sirve.
      Este es corto y carga el conector desde el armador, así que no hay que reinstalarlo cuando cambie. Si Chrome pregunta si amazon.com puede acceder a dispositivos de tu red, permítelo.</p>
      <button class="btn primary" data-action="connector-copy">Copiar código del marcador</button>
      <ol class="steps">
        <li>En Chrome toca <b>⋮ → ☆</b> para guardar esta página como favorito y luego <b>Editar</b>: nombre <b>pcb</b>; en URL borra lo que hay y <b>pega</b> el código.</li>
        <li>Toca <b>● Conectar Amazon</b>: se abre amazon.com en otra pestaña. Ahí activa <b>⋮ → Sitio para computadoras</b> (la versión para celular tiene otro formato y el conector no la lee).</li>
        <li>En esa pestaña escribe <b>pcb</b> en la barra de direcciones y toca la sugerencia con la estrella. Chrome solo ejecuta marcadores así, no desde la lista de favoritos.</li>
        <li>Vuelve a esta pestaña. Deja la de Amazon abierta; si Android la pausa y el conector deja de responder, ábrela un momento y regresa.</li>
      </ol>
      <p class="muted" style="margin:0">Si se abre la app de Amazon: Ajustes de Android → Apps → Amazon Shopping → Abrir de forma predeterminada → desactiva «Abrir vínculos compatibles».</p>
      <textarea id="connectorCode" readonly rows="3" onclick="this.select()">${esc(loader)}</textarea>
    </div>
    <div class="m-foot"><button class="btn primary" data-action="connector-ok">Listo, ya lo instalé</button></div>` : ''}
      ${IS_MOBILE ? '' : `
      <div class="connector-drag">
        <a class="btn primary" href="${esc(href)}" draggable="true" onclick="event.preventDefault();alert('Arrástrame a la barra de marcadores; no se usa aquí.')">➕ Armador PC</a>
        <span class="muted">← arrástralo a la barra de marcadores (Ctrl+Shift+B la muestra). Si ya tenías uno, reemplázalo.</span>
      </div>
      <ol class="steps">
        <li>Pulsa <b>● Conectar Amazon</b> arriba: se abre amazon.com. Ahí pulsa el marcador una vez; queda <b>conectado</b> mientras esa pestaña siga abierta.</li>
        <li>Desde entonces, <b>↻</b> en cualquier producto (incluidos los comprados) y <b>↻ Actualizar todo</b> reescriben la ficha con tu sesión, sin salir del armador.</li>
        <li>Si pulsas el marcador en la ficha de un producto, además te ofrece agregarlo a una categoría.</li>
      </ol>
      <details><summary class="muted">¿No puedes arrastrar? Copia el código</summary>
        <p class="muted">Crea un marcador nuevo y pega esto como URL:</p>
        <textarea readonly rows="4" onclick="this.select()">${esc(href)}</textarea>
      </details>
    </div>
    <div class="m-foot"><button class="btn primary" data-action="connector-ok">Listo, ya lo instalé</button></div>`}`);
}

// Resuelve enlaces cortos (amzn.to, a.co) y devuelve el ASIN.
async function asinFromInput(url) {
  let asin = extractAsin(url);
  if (!asin && /^https?:\/\/(amzn\.to|a\.co|amzn\.com)\//i.test(url)) {
    const r = await (await fetch(`/api/resolve?url=${encodeURIComponent(url)}`)).json();
    asin = extractAsin(r.url);
  }
  if (!asin) throw new Error('No encontré un producto en ese enlace. Usa un enlace de amazon.com (…/dp/XXXXXXXXXX) o amzn.to.');
  return asin;
}

async function addFromUrl(cat, url, form) {
  url = url.trim();
  if (!url) return;
  requireSession(); // dentro del envío del formulario: puede abrir Amazon
  const errMsg = (m) => { const f = $(`form.add-row[data-cat="${cat}"]`); if (f) f.querySelector('.err-msg').textContent = m; };
  form.querySelector('.err-msg').textContent = '';
  let p;
  try {
    const asin = await asinFromInput(url);
    const s = slot(cat);
    p = s.options.find((o) => asinOf(o) === asin);
    const isNew = !p;
    if (isNew) {
      // Se muestra enseguida y se completa cuando llega la ficha.
      p = { id: uid('p'), asin, url: `https://www.amazon.com/dp/${asin}`, title: `Leyendo ${asin} con tu sesión…`, status: 'buy', pick: 0, qty: 1, tags: {}, notes: '', history: [] };
      s.options.push(p);
      if (!s.selected.length) s.selected.push(p.id);
      openCats.add(cat);
      commit();
    }
    const r = await updateAsins([asin]);
    if (r.failed) {
      if (isNew) { s.options = s.options.filter((o) => o !== p); s.selected = s.selected.filter((x) => x !== p.id); commit(); }
      return errMsg(r.errors[0]);
    }
    const f = $(`form.add-row[data-cat="${cat}"]`);
    if (f) f.url.value = '';
    toast(isNew ? `Agregado: ${shortTitle(p.title, 50)} · ${usd(p.price)}` : 'Ya estaba en la lista; lo actualicé con tu sesión.');
  } catch (e) {
    errMsg(e.message);
  }
}

// Marca el nivel de decisión (0-3 estrellas). Queda en el producto: si luego eliges otra opción,
// el que marcaste «fijo» sigue fijo y aparece como aviso en Compatibilidad y compra.
function setPick(cat, id, level) {
  const p = findP(cat, id);
  if (!p) return;
  const before = pickLevel(p);
  p.pick = Math.max(0, Math.min(PICK_FIXED, Number(level) || 0));
  openCats.add(cat);
  commit();
  if (p.pick === before) return;
  const sel = slot(cat).selected.includes(id);
  toast(p.pick === PICK_FIXED
    ? `Fijo (★★★): ${shortTitle(p.title, 40)}${sel ? '' : ' — ojo: el armado usa otra opción'}`
    : `${pickOf(p).label}: ${shortTitle(p.title, 40)}`);
}

function selectOption(cat, id) {
  const s = slot(cat);
  if (CAT[cat].multi) s.selected = s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id];
  else s.selected = s.selected[0] === id ? [] : [id];
  commit();
}

// ---------- render ----------
// Durante una actualización en lote llegan muchas fichas seguidas: se agrupan en un solo repintado.
// En segundo plano (mientras trabajas en la pestaña de Amazon) requestAnimationFrame no corre, así que se usa un temporizador.
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  const run = () => { renderQueued = false; render(); };
  if (document.hidden) setTimeout(run, 50); else requestAnimationFrame(run);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRender(); });

function render() {
  const b = build();
  $('#buildSel').innerHTML = store.builds.map((x) => `<option value="${x.id}" ${x.id === b.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const list = checks(b, S());
  renderRig(b, list);
  renderSummary(b, list);
  renderChecks(list);
  renderParts(b, list);
  const btn = $('#refreshAll');
  if (refreshing) {
    btn.disabled = true;
    btn.textContent = `↻ ${progress.done}/${progress.total}…`;
  } else {
    btn.disabled = false;
    const n = refreshQueue().todo.length;
    btn.textContent = n ? `↻ Actualizar todo (${n})` : '↻ Todo al día';
    btn.title = n ? `${n} productos sin leer con tu sesión en los últimos ${S().refreshMinutes} min o con datos faltantes` : `Todo leído con tu sesión hace menos de ${S().refreshMinutes} min`;
  }
  btn.setAttribute('aria-label', btn.textContent); // el title es solo ayuda visual, no el nombre del botón
  renderSession();
  renderRefreshPrices();
}

function catState(b, cat) {
  const lines = selectedLines(b).filter((l) => l.cat === cat);
  if (!lines.length) return 'empty';
  const st = lines.map((l) => l.p.status || 'buy');
  return st.includes('buy') ? 'buy' : st.includes('bought') ? 'bought' : 'planned';
}

function renderRig(b, list) {
  const el = $('#rig');
  if (!el.firstChild) el.innerHTML = RIG;
  el.querySelectorAll('.part').forEach((g) => {
    const cat = g.dataset.cat;
    const lines = selectedLines(b).filter((l) => l.cat === cat);
    const fixed = lines.length > 0 && lines.every((l) => isFixed(l.p));
    g.setAttribute('class', `part ${catState(b, cat)}${fixed ? ' pick-fixed' : ''}${list.some((c) => c.level === 'error' && c.cats.includes(cat)) ? ' flag-error' : ''}`);
    const names = lines.map((l) => `${shortTitle(l.p.title, 50)} (${pickOf(l.p).stars})`);
    g.querySelector('title').textContent = `${CAT[cat].name}: ${names.join(' + ') || 'sin elegir'}`;
  });
}

// Monto compacto para el desglose de cada línea del carrito (la moneda va en el encabezado).
const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// Precio «puesto en Colombia»: la cifra principal siempre es el total (producto + envío + impuestos);
// el desglose va en un toggletip (botón que abre/cierra, sirve con teclado y en pantallas táctiles).
const FEES_SRC = { amazon: 'según Amazon', estimado: 'estimado', editado: 'editado a mano', local: 'incluidos en el precio', 'tax-miami': 'sales tax estimado' };
function costRows(p, c, s = S()) {
  const ship = c.shipping == null ? (p.manual ? 'No aplica' : '<span class="warn-t">Por confirmar</span>') : c.shipping === 0 ? '<span class="ok-t">Gratis</span>' : usd(c.shipping);
  const fees = c.feesSource === 'local' ? 'Incluidos' : c.importFees === 0 ? '<span class="ok-t">US$0.00</span>' : usd(c.importFees);
  const feesNote = c.feesSource === 'estimado' && c.importFees ? `IVA ${Math.round(s.iva * 100)}% estimado` : c.feesSource === 'tax-miami' ? `Sales tax ${+(s.miamiTax * 100).toFixed(2)}% estimado` : FEES_SRC[c.feesSource] || '';
  const caveat = costCaveat(p, c);
  const dest = marketLabel(p);
  return `<dl class="cost-rows">
      <dt>Producto${c.qty > 1 ? ` (${c.qty} × ${usd(c.price)})` : ''}</dt><dd>${usd(c.subtotal)}</dd>
      <dt>Envío a ${dest}</dt><dd>${ship}</dd>
      <dt>${isMiami(p) ? 'Sales tax (Miami)' : 'Impuestos de importación'}${feesNote ? `<small>${esc(feesNote)}</small>` : ''}</dt><dd>${fees}</dd>
      <dt class="cost-total">Total en ${dest}</dt><dd class="cost-total">${usd(c.total)}</dd>
    </dl>
    <div class="cost-cop">≈ ${p.displayed?.total != null && c.qty === 1 ? `${copAmazon(p.displayed.total)} según Amazon` : cop(c.total)}</div>
    ${caveat ? `<div class="cost-caveat">${esc(caveat)}</div>` : ''}`;
}
// Lo que falta para que el total sea definitivo (si algo falta, el total es parcial).
function costCaveat(p, c) {
  if (p.manual) return '';
  if (c.shipping == null) return `Amazon no mostró el envío a ${marketLabel(p)}: el total puede subir.`;
  if (p.importFeesInfo === 'no-informado') return 'Vendedor externo: Amazon no cobra los impuestos; se pagarían en aduana.';
  return '';
}
function costTip(p, c, { fmt = money, cls = '' } = {}) {
  if (c.total == null) return `<b class="num muted ${cls}">—</b>`;
  const partial = !!costCaveat(p, c);
  return `<span class="ct ${cls}">
    <button type="button" class="ct-btn num ${partial ? 'partial' : ''}" data-action="cost-tip" aria-expanded="false"
      aria-label="${fmt(c.total)} en ${marketLabel(p)}${partial ? ' (parcial)' : ''}: ver desglose">${fmt(c.total)}${partial ? '<sup>*</sup>' : ''}</button>
    <span class="ct-pop" role="status" hidden>${costRows(p, c)}</span>
  </span>`;
}
function closeCostTips(except) {
  document.querySelectorAll('.ct-btn[aria-expanded="true"]').forEach((b) => {
    if (b === except) return;
    b.setAttribute('aria-expanded', 'false');
    b.nextElementSibling.hidden = true;
  });
}

// Acordeones del panel lateral: qué secciones quedan abiertas entre repintados (y entre visitas).
const SIDE_KEY = 'pcb-side-open';
const openSide = new Set((() => {
  try { return JSON.parse(localStorage.getItem(SIDE_KEY)) || ['cart', 'checks']; } catch { return ['cart', 'checks']; }
})());
function toggleSide(key, open) {
  if (open) openSide.add(key); else openSide.delete(key);
  try { localStorage.setItem(SIDE_KEY, JSON.stringify([...openSide])); } catch { /* sin almacenamiento: solo en memoria */ }
}
const acc = (key, title, meta, body, cls = '', force = false) => `
  <details class="acc ${cls}" data-acc="${key}" ${force || openSide.has(key) ? 'open' : ''}>
    <summary><span class="acc-title">${title}</span><span class="acc-meta">${meta}</span></summary>
    <div class="acc-body">${body}</div>
  </details>`;

// Línea del carrito: lo esencial (qué, cuánto, quitar) y una sola línea con envío e impuestos.
function cartItem(p, cat, s) {
  const c = lineCost(p, s);
  const qty = c.qty;
  const feesTitle = { amazon: 'Cargos de importación que muestra Amazon', estimado: `IVA estimado (${Math.round(s.iva * 100)}%) porque el pedido supera US$${s.threshold}`, editado: 'Editado a mano', local: 'Compra local: impuestos incluidos en el precio', 'tax-miami': `Sales tax estimado de Miami (${+(s.miamiTax * 100).toFixed(2)} %): el exacto sale en el checkout` }[c.feesSource] || '';
  const facts = [];
  if (c.price != null) {
    if (qty > 1) facts.push(`${qty} × ${money(c.price)}`);
    facts.push(c.shipping == null ? (p.manual ? '' : '<span class="warn-t" title="Amazon no mostró el envío a Colombia">Envío por confirmar</span>')
      : c.shipping === 0 ? '<span class="ok-t">Envío gratis</span>' : `Envío ${money(c.shipping)}`);
    facts.push(`<span title="${esc(feesTitle)}">${c.feesSource === 'local' ? 'Impuestos incluidos'
      : c.importFees === 0 ? 'Sin impuestos' : `${isMiami(p) ? 'Tax' : 'Impuestos'} ${money(c.importFees)}${['estimado', 'tax-miami'].includes(c.feesSource) ? ' <span class="warn-t">(est.)</span>' : ''}`}</span>`);
  }
  const flags = [];
  if (c.price == null) flags.push('<span class="chip warn">Sin precio</span>');
  else if (!p.manual && c.overThreshold) flags.push(`<span class="chip warn" title="El pedido supera US$${s.threshold}: paga IVA al importar">≥ US$${s.threshold}</span>`);
  if (isMiami(p)) flags.push('<span class="chip info" title="Envío a tu dirección en Miami">Miami</span>');
  else if (!p.manual && p.shipsToCO === false) flags.push('<span class="chip err">No envía a CO</span>');
  if (p.manual) flags.push(`<span class="chip">${esc(p.store || 'Manual')}</span>`);
  if (isDeal(p)) flags.push('<span class="chip deal">Oferta</span>');
  return `<li class="ci ${isBusy(p) ? 'loading' : ''}">
    <button class="ci-thumb" data-action="goto" data-cat="${cat}" tabindex="-1" aria-hidden="true">${thumb(p, cat)}</button>
    <div class="ci-info">
      <div class="ci-cat">${esc(CAT[cat].short)}${pickChip(p)}${flags.join('')}</div>
      <button class="ci-title" data-action="goto" data-cat="${cat}" title="${esc(p.title)}">${esc(shortTitle(p.title, 90))}</button>
      ${facts.length ? `<div class="ci-facts">${facts.filter(Boolean).join('<span aria-hidden="true"> · </span>')}</div>` : ''}
    </div>
    <div class="ci-total">
      ${costTip(p, c)}
      <button class="ci-remove" data-action="deselect" data-cat="${cat}" data-id="${p.id}" aria-label="Quitar ${esc(shortTitle(p.title, 40))} del armado">Quitar</button>
    </div>
  </li>`;
}

// Franja de estado (estilo PCPartPicker): compatibilidad y consumo de un vistazo, arriba de todo.
function healthStrip(b, list, t, psuW) {
  const n = (l) => list.filter((c) => c.level === l).length;
  const ess = CATEGORIES.filter((c) => c.essential);
  const have = ess.filter((c) => b.parts?.[c.key]?.selected?.length).length;
  const compat = n('error') ? ['err', '!', `${n('error')} problema${n('error') === 1 ? '' : 's'}`]
    : n('warn') ? ['warn', '!', `${n('warn')} aviso${n('warn') === 1 ? '' : 's'}`]
    : ['ok', '✓', 'Compatible'];
  const power = !psuW ? ['', 'Sin fuente elegida'] : psuW < t.watts ? ['err', 'Fuente insuficiente']
    : psuW < t.recommendedPsu ? ['warn', `Poco margen: ≥ ${t.recommendedPsu} W`] : ['ok', 'Fuente con margen'];
  return `<div class="health">
    <button class="hp ${compat[0]}" data-action="side-open" data-acc="checks">
      <span class="hp-ic">${compat[1]}</span>
      <span><b>${compat[2]}</b><small>${have}/${ess.length} piezas esenciales</small></span>
    </button>
    <button class="hp ${power[0]}" data-action="side-open" data-acc="power">
      <span class="hp-ic">⚡</span>
      <span><b class="num">${t.watts} W${psuW ? ` / ${psuW} W` : ''}</b><small>${power[1]}</small></span>
    </button>
  </div>`;
}

function renderSummary(b, list) {
  const s = S();
  const t = totals(b, s);
  const budget = Number(b.budget) || 0;
  const pct = budget ? Math.min(100, (t.toBuyTotal / budget) * 100) : 0;
  const psu = selectedLines(b).find((l) => l.cat === 'psu');
  const psuW = psu ? Number(detectTags(psu.p, 'psu').psuWatts) || 0 : 0;
  // La fuente solo alimenta las piezas del PC: los monitores van al enchufe.
  const parts = CATEGORIES.filter((c) => !c.external).map((c) => [c, selectedLines(b).filter((l) => l.cat === c.key).reduce((a, l) => a + estimateWatts(l.p, c.key), 0)]).filter(([, w]) => w > 0);
  if (parts.length) parts.push([{ name: 'Otros (USB, periféricos, RGB de la placa)', short: 'Otros' }, BASE_WATTS]);
  const guesses = selectedLines(b).filter((l) => !CAT[l.cat].external && wattsIsGuess(l.p, l.cat));
  const scale = Math.max(psuW, t.watts * s.psuMargin, 1);
  const colors = ['#ea6a12', '#3b6fd4', '#1f8a4c', '#8a5cf6', '#b7791f', '#c2372f', '#0e9aa7', '#6b675f'];
  const cart = selectedLines(b).filter((l) => (l.p.status || 'buy') === 'buy');
  const units = cart.reduce((a, l) => a + (Number(l.p.qty) || 1), 0);

  const notes = [
    t.orders ? `<span class="chip">${t.orders} pedido${t.orders === 1 ? '' : 's'} separado${t.orders === 1 ? '' : 's'}</span>` : '',
    t.overThreshold ? `<span class="chip warn" title="Pedidos de US$${s.threshold} o más pagan IVA al importar">${t.overThreshold} ≥ US$${s.threshold} · IVA</span>` : t.orders ? `<span class="chip ok" title="Ningún pedido paga IVA al importar">Todos &lt; US$${s.threshold}</span>` : '',
    t.unknownPrice ? `<span class="chip warn">${t.unknownPrice} sin precio</span>` : '',
    t.undecided ? `<span class="chip" title="Sin estrellas: todavía sin decidir">${t.undecided} sin decidir</span>` : '',
  ].join('');

  const total = `<div class="total">
      <div class="total-label">Total por comprar <span class="muted">· ${units} producto${units === 1 ? '' : 's'}</span></div>
      <div class="total-big num">${usd(t.toBuyTotal)}</div>
      <div class="sum-cop">≈ ${cop(t.toBuyTotal)} · TRM ${s.trm.toLocaleString('es-CO')}</div>
      <dl class="kv">
        <dt>Subtotal</dt><dd>${usd(t.toBuy)}</dd>
        <dt>Envío</dt><dd>${t.shipping === 0 && t.orders ? '<span class="ok-t">Gratis</span>' : usd(t.shipping)}</dd>
        <dt>Impuestos de importación</dt><dd>${t.importFees === 0 && t.orders ? '<span class="ok-t">US$0.00</span>' : usd(t.importFees)}</dd>
      </dl>
      ${budget ? `<div class="budget">
        <div class="bar ${t.toBuyTotal > budget ? 'over' : ''}"><i style="width:${pct}%"></i></div>
        <div class="budget-text ${t.toBuyTotal > budget ? 'err-t' : ''}">${t.toBuyTotal > budget ? `Te pasas por <b>${usd(t.toBuyTotal - budget)}</b>` : `Quedan <b>${usd(budget - t.toBuyTotal)}</b>`} de ${usd(budget)}</div>
      </div>` : ''}
      ${notes ? `<div class="order-notes">${notes}</div>` : ''}
    </div>`;

  const cartBody = cart.length ? `<ul class="cart">${cart.map((l) => cartItem(l.p, l.cat, s)).join('')}</ul>` : `
      <div class="cart-empty">
        <b>No hay nada por comprar</b>
        <span>Elige productos en las categorías y márcalos como «Por comprar».</span>
      </div>`;

  // Cada grupo del costo del armado se despliega con sus productos (mismo criterio de monto que totals()).
  const group = (key, label, st, amount) => {
    const lines = selectedLines(b).filter((l) => (l.p.status || 'buy') === st);
    const rows = lines.map((l) => {
      const c = lineCost(l.p, s);
      const paid = st === 'bought' ? paidTotal(l.p) : null;
      const amount = paid != null ? `<span class="num" title="Lo que pagaste (fijo)">${money(paid)}</span>`
        : c.price == null ? '<span class="warn-t">Sin precio</span>'
        : `${costTip(l.p, c)}${st === 'bought' ? ' <span class="warn-t" title="Sin precio pagado: se usa el de hoy">(hoy)</span>' : ''}`;
      return `<li><span class="bl-cat">${esc(CAT[l.cat].short)}</span><button class="bl-title" data-action="goto" data-cat="${l.cat}" title="${esc(l.p.title)}">${esc(shortTitle(l.p.title, 60))}</button>${amount}</li>`;
    }).join('');
    if (!lines.length) return `<div class="bl-empty"><span>${label}</span><span class="num">${usd(amount)}</span></div>`;
    return `<details class="acc sub bl" data-acc="build-${key}" ${openSide.has(`build-${key}`) ? 'open' : ''}>
      <summary><span class="acc-title">${label} <span class="muted">(${lines.length})</span></span><span class="acc-meta">${usd(amount)}</span></summary>
      <ul class="bl-list">${rows}</ul>
    </details>`;
  };
  const anyBought = selectedLines(b).some((l) => l.p.status === 'bought');
  const buildBody = `
    ${anyBought ? `<p class="acc-note"><button class="btn small" data-action="paid">🧾 Precio pagado${t.boughtNoPaid ? ` · ${t.boughtNoPaid} sin registrar` : ''}</button></p>` : ''}
    ${group('buy', 'Por comprar', 'buy', t.toBuyTotal)}
    ${group('bought', 'Ya comprado', 'bought', t.spent)}
    ${group('planned', 'Planeado para después', 'planned', t.planned)}
    <div class="bl-total"><b>Total del armado</b><b class="num">${usd(t.grand)}</b></div>
    ${t.fixed ? `<p class="acc-note"><span class="chip pick pick3">★★★</span> ${t.fixed} fijo${t.fixed === 1 ? '' : 's'} por comprar suman ${usd(t.fixedTotal)}</p>` : ''}`;

  const powerBody = parts.length ? `
    <div class="stack" title="Consumo por pieza sobre ${psuW ? `la fuente de ${psuW} W` : 'la fuente recomendada'}">${parts.map(([c, w], i) => `<i style="width:${(w / scale) * 100}%;background:${colors[i % colors.length]}" title="${esc(c.name)}: ${w} W"></i>`).join('')}</div>
    <ul class="wlist">${parts.map(([c, w], i) => `<li><i style="background:${colors[i % colors.length]}"></i><span>${esc(c.short || c.name)}</span><b class="num">${w} W</b></li>`).join('')}</ul>
    <div class="price-sub">Fuente recomendada ≥ ${t.recommendedPsu} W${psuW ? ` · elegida ${psuW} W` : ''}${t.watts !== t.wattsNow ? ' · incluye piezas planeadas' : ''}</div>
    ${t.externalWatts ? `<div class="price-sub">Monitores: ${t.externalWatts} W más en el enchufe (no cuentan para la fuente; sí para el protector de picos)</div>` : ''}
    ${guesses.length ? `<div class="price-sub warn-t">Consumo genérico (modelo no reconocido): ${guesses.map((l) => esc(CAT[l.cat].short)).join(', ')}. Anótalo en el detalle del producto.</div>` : ''}`
    : '<p class="acc-note muted">Elige piezas para estimar el consumo.</p>';

  $('#summary').innerHTML = `
    ${healthStrip(b, list, t, psuW)}
    ${total}
    <div class="accs">
      ${acc('cart', 'Productos por comprar', `<span class="count">${cart.length}</span>`, cartBody)}
      ${acc('build', 'Costo del armado completo', `<span class="num">${usd(t.grand)}</span>`, buildBody)}
      ${acc('power', 'Consumo eléctrico', `<span class="num">${t.watts} W</span>`, powerBody)}
    </div>`;
}

// Compatibilidad: lo que requiere atención siempre a la vista; lo correcto, plegado.
function renderChecks(list) {
  const order = { error: 0, warn: 1, info: 2, ok: 3 };
  const n = (l) => list.filter((c) => c.level === l).length;
  const sym = { error: '!', warn: '!', ok: '✓', info: 'i' };
  const item = (c) => `
    <li class="check ${c.level}" data-action="goto" data-cat="${c.cats[0] || ''}">
      <span class="ic">${sym[c.level]}</span>
      <div><b>${esc(c.title)}</b><span>${esc(c.detail)}</span></div>
    </li>`;
  const issues = [...list].filter((c) => c.level !== 'ok').sort((a, b) => order[a.level] - order[b.level]);
  const oks = list.filter((c) => c.level === 'ok');
  const meta = [
    n('error') ? `<span class="chip err">${n('error')} error${n('error') === 1 ? '' : 'es'}</span>` : '',
    n('warn') ? `<span class="chip warn">${n('warn')} aviso${n('warn') === 1 ? '' : 's'}</span>` : '',
    n('info') ? `<span class="chip info">${n('info')} nota${n('info') === 1 ? '' : 's'}</span>` : '',
    `<span class="chip ok">${n('ok')} ✓</span>`,
  ].join('');
  const body = `
    ${issues.length ? `<ul class="check-list">${issues.map(item).join('')}</ul>` : '<p class="acc-note ok-t">Todo en orden: nada que revisar.</p>'}
    ${oks.length ? `<details class="acc sub" data-acc="checks-ok" ${openSide.has('checks-ok') ? 'open' : ''}>
      <summary><span class="acc-title">${oks.length} revision${oks.length === 1 ? '' : 'es'} correcta${oks.length === 1 ? '' : 's'}</span></summary>
      <ul class="check-list">${oks.map(item).join('')}</ul>
    </details>` : ''}`;
  $('#checks').innerHTML = `<div class="accs">${acc('checks', 'Compatibilidad y compra', meta, body, n('error') ? 'has-err' : '', n('error') > 0)}</div>`;
}

// Selector de estrellas: 1 = candidato, 2 = probable, 3 = fijo (decidido). Pulsar la estrella activa la quita.
// Los botones van en orden 3-2-1 dentro de un contenedor invertido para que el hover ilumine «hasta aquí».
function starPicker(p, cat, cls = '') {
  const lvl = pickLevel(p);
  const stars = [PICK_FIXED, 2, 1].map((n) => {
    const on = n <= lvl;
    const target = n === lvl ? PICKS[0] : PICKS[n];
    return `<button type="button" class="star ${on ? 'on' : ''}" data-action="pick" data-cat="${cat}" data-id="${p.id}" data-level="${n === lvl ? 0 : n}"
      aria-pressed="${on}" aria-label="${esc(n === lvl ? `Quitar: dejar sin decidir` : PICKS[n].label)}"
      title="${esc(`${target.label} — ${target.hint}`)}">★</button>`;
  }).join('');
  return `<div class="stars ${cls}" role="group" aria-label="Decisión de compra: ${esc(pickOf(p).label)}">
    <span class="stars-btns">${stars}</span>
    <span class="stars-label lvl${lvl}">${esc(pickOf(p).short)}</span>
  </div>`;
}

// Indicador compacto (carrito, comparación): solo muestra, no edita.
const pickChip = (p) => (pickLevel(p) ? `<span class="chip pick pick${pickLevel(p)}" title="${esc(pickOf(p).hint)}">${pickOf(p).stars} ${esc(pickOf(p).short)}</span>` : '');

function chipsFor(p, cat) {
  const s = S();
  const c = lineCost(p, s);
  const out = [];
  const st = p.status || 'buy';
  out.push(`<span class="chip ${st === 'bought' ? 'ok' : st === 'planned' ? 'planned' : 'accent'}">${STATUS[st].short}</span>`);
  if (isDeal(p)) out.push('<span class="chip deal" title="Precio por debajo del precio de lista en alguna tienda">Oferta</span>');
  if (p.manual) out.push(`<span class="chip">${esc(p.store || 'Manual')}</span>`);
  else {
    if (isMiami(p)) out.push(`<span class="chip info" title="Precio con envío a tu dirección en Miami. Solo se actualiza cuando tu sesión de Amazon entrega en Miami.">Miami${p.deliverTo && p.region === 'us' ? ` · ${esc(p.deliverTo)}` : ''}</span>`);
    else if (c.price != null) out.push(c.overThreshold ? `<span class="chip warn">≥ US$${s.threshold} · IVA</span>` : `<span class="chip ok">&lt; US$${s.threshold}</span>`);
    if (!isMiami(p)) out.push(p.shipsToCO === true ? '<span class="chip ok">Envía a CO</span>' : p.shipsToCO === false ? '<span class="chip err">No envía a CO</span>' : '<span class="chip warn">Envío CO sin confirmar</span>');
    if (p.seller) out.push(`<span class="chip ${/^Amazon/i.test(p.seller) ? 'info' : ''}" title="Vendedor">${esc(p.seller)}</span>`);
    if (p.rating) out.push(`<span class="chip">★ ${p.rating}${p.reviews ? ` (${p.reviews.toLocaleString('es-CO')})` : ''}</span>`);
    if (/Solo queda|Only \d+ left/i.test(p.availability || '')) out.push(`<span class="chip warn">${esc((p.availability.match(/\d+/) || [''])[0])} en stock</span>`);
    else if (/No disponible|Agotado|Currently unavailable/i.test(p.availability || '')) out.push('<span class="chip err">Agotado</span>');
    if (p.source === 'sesion' && p.fetchedAt) out.push(`<span class="chip info" title="Leído con tu sesión de Amazon">Tu sesión · ${ago(p.fetchedAt)}</span>`);
    else out.push('<span class="chip warn" title="Aún no se ha leído con tu sesión: pulsa ↻">Sin leer con tu sesión</span>');
    const miss = missingFields(p);
    if (miss.length) out.push(`<span class="chip err" title="Faltan: ${esc(miss.join(', '))}">Faltan ${miss.length} datos</span>`);
    if (p.priceSource === 'oferta') out.push('<span class="chip warn" title="La ficha no tiene buybox; precio de la mejor oferta nueva">Precio de oferta</span>');
    if (p.condition && p.condition !== 'Nuevo') out.push(`<span class="chip err">${esc(p.condition)}</span>`);
    if (p.targetPrice && p.price != null && p.price <= p.targetPrice) out.push('<span class="chip ok">🎯 Precio objetivo</span>');
  }
  const edited = Object.keys(p.edited || {});
  if (edited.length) out.push(`<span class="chip accent" title="Editado a mano: ${esc(editedLabels(edited))}. El actualizador lo conserva, salvo que tu sesión encuentre en Amazon un precio con envío a Colombia.">✎ Editado</span>`);
  if ((p.qty || 1) > 1) out.push(`<span class="chip">× ${p.qty}</span>`);
  return out.join('');
}

function thumb(p, cat) {
  return `<div class="thumb">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ICONS[cat]}</div>`;
}

function priceBox(p, cat) {
  if (p.status === 'bought' && paidTotal(p) != null) return paidBox(p, cat);
  const c = lineCost(p, S());
  const bought = p.status === 'bought';
  const register = bought ? `<div class="price-sub"><button type="button" class="btn small ghost" data-action="paid" data-cat="${cat}" data-id="${p.id}">🧾 Registrar lo que pagaste</button></div>` : '';
  if (c.price == null) return `<div class="pricebox"><div class="price muted">—</div><div class="price-sub">${p.manual ? 'sin precio' : 'sin oferta'}</div>${register}</div>`;
  const caveat = costCaveat(p, c);
  const ship = c.shipping == null ? (p.manual ? '' : '<span class="warn-t">envío ?</span>') : c.shipping === 0 ? '<span class="ok-t">envío gratis</span>' : `${usd(c.shipping)} envío`;
  const fees = c.feesSource === 'local' ? 'imp. incluidos' : c.importFees === 0 ? 'sin impuestos' : c.feesSource === 'tax-miami' ? `${usd(c.importFees)} tax (est.)` : `${usd(c.importFees)} imp.${c.feesSource === 'estimado' ? ' (est.)' : ''}`;
  return `<div class="pricebox">
    <div class="price-label">${p.manual ? 'Precio final' : bought ? `Hoy en ${marketLabel(p)}` : `Total en ${marketLabel(p)}`}${caveat ? ` <span class="warn-t" title="${esc(caveat)}">(parcial)</span>` : ''}</div>
    <div class="price">${costTip(p, c, { fmt: usd, cls: 'big' })}</div>
    <div class="price-sub">${[`${usd(c.subtotal)} producto`, ship, fees].filter(Boolean).join(' + ')}</div>
    <div class="price-sub">${p.displayed?.total != null && c.qty === 1 ? `${copAmazon(p.displayed.total)} (Amazon)` : `≈ ${cop(c.total)}`}</div>
    ${register}
  </div>`;
}

// Ya comprado con precio pagado: lo pagado (fijo) y, debajo, cuánto vale hoy en Amazon y si subió o bajó.
const fmtDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
function trendChip(ch) {
  if (!ch) return '';
  if (Math.abs(ch.diff) < 0.01) return '<span class="delta muted">igual</span>';
  const up = ch.diff > 0;
  return `<span class="delta ${up ? 'up' : 'down'}" title="${up ? 'Subió' : 'Bajó'} desde tu compra">${up ? '▲ +' : '▼ −'}${usd(Math.abs(ch.diff)).replace('US$', '$')}${ch.pct ? ` (${up ? '+' : '−'}${Math.abs(ch.pct)} %)` : ''}</span>`;
}
function paidBox(p, cat) {
  const s = S();
  const paid = paidTotal(p);
  const c = lineCost(p, s);
  return `<div class="pricebox">
    <div class="price-label">Pagado${p.paid.date ? ` · ${esc(fmtDate(p.paid.date))}` : ''}</div>
    <div class="price"><span class="ct big"><button type="button" class="ct-btn num" data-action="paid" data-cat="${cat}" data-id="${p.id}" title="Lo que pagaste: fijo en el total del armado. Pulsa para editarlo.">${usd(paid)}</button></span></div>
    <div class="price-sub">${p.paid.original ? copAmazon(p.paid.original.amount) : `≈ ${cop(paid)}`}${p.paid.orderId ? ` · pedido ${esc(p.paid.orderId)}` : ''}</div>
    ${p.manual ? '' : `<div class="price-sub">Hoy en Amazon: ${c.total == null ? '—' : costTip(p, c, { fmt: usd })} ${trendChip(paidChange(p, s))}</div>`}
  </div>`;
}

// Enlace a la ficha en Amazon (el de la tienda donde se leyó, o el /dp/ del ASIN).
const amazonHref = (p) => p.url || (asinOf(p) ? `https://www.amazon.com/dp/${asinOf(p)}` : null);
const amazonLink = (p, cls = 'btn small ghost amz') => {
  const href = amazonHref(p);
  return href ? `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener" title="Ver en Amazon" aria-label="Ver en Amazon (abre otra pestaña)">${ICONS.amazon}</a>` : '';
};

// Precios por tienda en la parte inferior de la tarjeta: solo los que tienen enlace y precio.
// Si la única fila es la del propio producto en Amazon, no se repite (ya está en el precio de la tarjeta).
function storeTrend(r) {
  if (!r.prev || r.prev.price == null || r.price == null || r.prev.price === r.price) return '';
  const up = r.price > r.prev.price;
  return `<span class="delta ${up ? 'up' : 'down'}" title="Antes: ${esc(fmtStorePrice(r.prev.price, r.currency))}">${up ? '▲' : '▼'}</span>`;
}
const taxPct = () => `${Math.round((S().miamiTax ?? 0.07) * 1000) / 10} %`;
function storeTip(r) {
  const st = STORES[r.store];
  const miami = r.total != null ? `Precio ${usd(r.price)} + envío ${r.shipping ? usd(r.shipping) : 'gratis'} + tax ${usd(r.tax)} (${taxPct()}) = ${usd(r.total)}` : '';
  return [`${st.name} · ${st.sub}`, st.basis, miami, r.deal ? `En oferta: antes ${usd(r.listPrice)}` : '', r.note || '', r.currency === 'COP' ? `≈ ${usd(r.usd)} con la TRM de Ajustes` : '', r.fetchedAt ? `Leído ${ago(r.fetchedAt)}` : 'Escrito a mano', r.error ? `Última lectura: ${r.error}` : '', 'Abre la ficha en otra pestaña'].filter(Boolean).join('\n');
}
function storesStrip(p, compact = false) {
  const rows = shownStores(p, S());
  if (!rows.length || (rows.length === 1 && rows[0].own)) return '';
  if (compact) {
    return `<div class="schips" aria-label="Precios por tienda">${rows.map((r) => `<a class="schip ${r.best ? 'best' : ''}" href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(storeTip(r))}" aria-label="${esc(`${STORES[r.store].name}: ${fmtStorePrice(r.total ?? r.price, r.currency)}${r.deal ? ', en oferta' : ''}${r.best ? ', el más bajo' : ''}`)}">${STORE_LOGOS[r.store]}<span class="num">${fmtStorePrice(r.total ?? r.price, r.currency).replace('US$', '$')}</span>${r.deal ? '<span class="deal-dot" aria-hidden="true">%</span>' : ''}</a>`).join('')}</div>`;
  }
  return `<div class="stores" role="table" aria-label="Precios por tienda">
    ${rows.map((r) => `<a class="srow ${r.best ? 'best' : ''} ${r.error ? 'stale' : ''}" role="row" href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(storeTip(r))}">
      <span role="cell" class="slogo-cell">${STORE_LOGOS[r.store]}</span>
      <span role="cell" class="sname"><b>${esc(STORES[r.store].name)}</b><small>${esc(STORES[r.store].sub)}${r.own ? ' · este producto' : ''}</small></span>
      <span role="cell" class="sprice"><b class="num">${fmtStorePrice(r.total ?? r.price, r.currency)}</b>${storeTrend(r)}
        ${r.total != null ? `<small class="num">${usd(r.price).replace('US$', '$')} + ${r.shipping ? usd(r.shipping).replace('US$', '$') : 'envío 0'} + tax ${usd(r.tax).replace('US$', '$')}</small>` : ''}
        <small>${r.deal ? `<span class="deal-t">Oferta <s>${usd(r.listPrice).replace('US$', '$')}</s></span>${r.best ? ' · ' : ''}` : ''}${r.best ? '<span class="best-t">Más bajo</span>' : ''}${r.currency === 'COP' ? `${r.best ? ' · ' : ''}≈ ${usd(r.usd)}` : ''}${r.error ? ' <span class="err-t" aria-label="Error en la última lectura">!</span>' : ''}</small></span>
    </a>`).join('')}
  </div>`;
}

function productCard(p, cat) {
  return `<article class="pcard ${p.status || 'buy'} ${isFixed(p) ? 'fixed' : ''} ${isBusy(p) ? 'loading' : ''}">
    ${thumb(p, cat)}
    <div>
      ${p.url ? `<a class="ptitle" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : `<div class="ptitle">${esc(p.title)}</div>`}
      <div class="chips">${chipsFor(p, cat)}</div>
      ${starPicker(p, cat)}
      ${p.fetchedAt ? `<div class="price-sub" style="margin-top:4px">Revisado ${ago(p.fetchedAt)}${isMiami(p) ? (p.region && p.region !== 'us' ? ` · <b style="color:var(--err)">sin entrega en Miami (${esc(p.deliverTo || '?')})</b>` : '') : p.locationOk === false ? ` · <b style="color:var(--err)">sin entrega en Colombia (${esc(p.deliverTo || '?')})</b>` : ''}</div>` : ''}
    </div>
    ${priceBox(p, cat)}
    <div class="pactions">
      <button class="btn small" data-action="details" data-cat="${cat}" data-id="${p.id}">✎ Detalles</button>
      ${updateButton(p, cat, 'btn small')}
      <button class="btn small ghost" data-action="deselect" data-cat="${cat}" data-id="${p.id}">Quitar del armado</button>
      ${amazonLink(p)}
    </div>
    ${storesStrip(p)}
  </article>`;
}

// Botón de actualizar con tu sesión (o vincular con Amazon si el producto no tiene enlace).
function updateButton(p, cat, cls, compact = false) {
  const attrs = `data-cat="${cat}" data-id="${p.id}"`;
  if (!asinOf(p)) return `<button class="${cls}" data-action="link-amazon" ${attrs} title="Vincular con un enlace de Amazon para actualizar con tu sesión" aria-label="Vincular con Amazon">${compact ? '🔗' : '🔗 Vincular con Amazon'}</button>`;
  if (isBusy(p)) return `<button class="${cls}" disabled aria-label="Leyendo con tu sesión">${compact ? '…' : 'Leyendo con tu sesión…'}</button>`;
  return `<button class="${cls}" data-action="refresh" ${attrs} title="Reescribir toda la información con tu sesión de Amazon" aria-label="Actualizar con tu sesión">${compact ? '↻' : '↻ Actualizar'}</button>`;
}

function optionCard(p, cat, ref, feats = []) {
  const s = slot(cat);
  const sel = s.selected.includes(p.id);
  const c = lineCost(p, S());
  const delta = !sel && ref != null && c.total != null ? c.total - ref : null;
  const specs = featLine(p, cat, feats);
  return `<div class="opt ${sel ? 'sel' : ''} ${isFixed(p) ? 'fixed' : ''} ${isBusy(p) ? 'loading' : ''}">
    <div class="opt-top">${thumb(p, cat)}<div class="opt-title" title="${esc(p.title)}">${esc(p.title)}</div></div>
    ${specs ? `<div class="opt-specs">${specs}</div>` : ''}
    <div class="opt-price">${costTip(p, c, { fmt: usd })}${delta != null ? `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : '−'}${usd(Math.abs(delta)).replace('US$', '$')}</span>` : sel ? '<span class="delta muted">elegido</span>' : ''}</div>
    <div class="chips">${chipsFor(p, cat)}</div>
    ${starPicker(p, cat, 'small')}
    ${storesStrip(p, true)}
    <div class="opt-actions">
      <button class="btn small ${sel ? '' : 'primary'}" data-action="select" data-cat="${cat}" data-id="${p.id}">${sel ? (CAT[cat].multi ? 'Quitar' : 'Elegido ✓') : CAT[cat].multi ? 'Agregar' : 'Cambiar a este'}</button>
      ${updateButton(p, cat, 'btn small ghost', true)}
      <button class="btn small ghost" data-action="details" data-cat="${cat}" data-id="${p.id}" title="Detalles" aria-label="Detalles">⋯</button>
      ${amazonLink(p)}
    </div>
  </div>`;
}

// ---------- ordenar y filtrar opciones ----------
// Vista de cada categoría (orden y filtros). Se recuerda en este navegador; lo escrito en el buscador no se guarda.
const VIEW_KEY = 'pcb-opt-view';
const optViews = (() => {
  try { const v = JSON.parse(localStorage.getItem(VIEW_KEY)); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
})();
const optView = (cat) => normalizeView(optViews[cat], cat);
function setOptView(cat, patch) {
  optViews[cat] = { ...optView(cat), ...patch };
  const saved = Object.fromEntries(Object.entries(optViews).map(([k, v]) => [k, { ...v, q: '' }]));
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(saved)); } catch { /* sin almacenamiento: solo en memoria */ }
}
const NO_FILTERS = { q: '', minPick: 0, avail: 'all', maxTotal: null, underThreshold: false, deals: false, feats: {} };

// Con una sola opción no hay barra de filtros, así que tampoco se aplican.
const shownOptions = (cat) => (slot(cat).options.length < 2 ? slot(cat).options : viewOptions(slot(cat).options, optView(cat), cat, S()));
// Características que comparten las opciones de la categoría (para la barra y la línea de cada tarjeta).
const optFeats = (cat) => (slot(cat).options.length < 2 ? [] : commonFeatures(slot(cat).options, cat));
// Lo que se compara: las opciones visibles; si los filtros dejan menos de dos, todas (en el mismo orden).
const compareList = (cat, shown = shownOptions(cat)) => (shown.length >= 2 ? shown : viewOptions(slot(cat).options, { sort: optView(cat).sort, dir: optView(cat).dir }, cat, S()));
const sameFeat = (f, a, b) => (f.type === 'cat' ? String(a).toLowerCase() === String(b).toLowerCase() : Number(a) === Number(b));
const featThreshold = (f, x) => `${f.better === 'low' ? '≤' : '≥'} ${fmtFeature(f, x)}`;
const dirText = (v) => `${v.dir === 'asc' ? '↑' : '↓'} ${dirLabel(v.sort, v.dir)}`;

// Línea con las características comunes de la opción; la que ordena o filtra va resaltada.
function featLine(p, cat, feats) {
  const v = optView(cat);
  return feats.filter((f) => f.key !== 'brand').map((f) => {
    const x = featureValue(f, p, cat);
    if (x == null) return '';
    const on = v.sort === `f:${f.key}` || f.key in v.feats;
    return `<span title="${esc(f.label)}"${on ? ' class="on"' : ''}>${esc(fmtFeature(f, x))}</span>`;
  }).filter(Boolean).join('<span aria-hidden="true"> · </span>');
}
const compareLabel = (cat, shown) => `Comparar ${compareList(cat, shown).length}`;
const optSummary = (cat, n) => { const total = slot(cat).options.length; return `Opciones (${n === total ? total : `${n} de ${total}`}): cambiar o agregar`; };
const optStatus = (cat, n) => (viewFiltered(optView(cat))
  ? `Mostrando ${n} de ${slot(cat).options.length} <button type="button" class="btn small ghost" data-action="opt-clear" data-cat="${cat}">Quitar filtros</button>` : '');

// Total de la opción elegida (si hay una sola): las demás muestran la diferencia contra él.
function refTotal(cat) {
  const s = slot(cat);
  const sel = s.selected.map((id) => s.options.find((o) => o.id === id)).filter(Boolean);
  return sel.length === 1 ? lineCost(sel[0], S()).total : null;
}

// Filtros por característica: valor exacto (texto o «exact») o umbral (número). El número de cada valor es dinámico:
// cuántas opciones quedarían al elegirlo con los demás filtros puestos; los que no dejarían ninguna se desactivan.
// Un filtro activo de una característica que ya no es común sigue a la vista para poder quitarlo.
function featSelects(cat) {
  const v = optView(cat);
  const feats = slot(cat).options.length < 2 ? [] : commonFeatures(slot(cat).options, cat, v, S());
  const shown = [...feats, ...featuresFor(cat).filter((f) => f.key in v.feats && !feats.some((x) => x.key === f.key)).map((f) => ({ ...f, values: [] }))];
  const label = (f, x) => (f.type === 'cat' || f.exact ? fmtFeature(f, x) : featThreshold(f, x));
  const sel = shown.map((f) => {
    const cur = v.feats[f.key];
    const vals = f.values.map((x) => ({ x: x.value, l: `${label(f, x.value)} (${x.count})`, off: !x.count }));
    if (cur != null && !vals.some(({ x }) => sameFeat(f, x, cur))) vals.push({ x: cur, l: `${label(f, cur)} (0)` });
    return `<label class="opt-field${cur != null ? ' on' : ''}">${esc(f.label)} <select data-view="feat" data-feat="${f.key}" data-cat="${cat}">
      <option value="">${f.type === 'cat' || f.exact ? 'Todas' : 'Cualquiera'}</option>
      ${vals.map(({ x, l, off }) => { const on = cur != null && sameFeat(f, x, cur); return `<option value="${esc(x)}" ${on ? 'selected' : ''} ${off && !on ? 'disabled' : ''}>${esc(l)}</option>`; }).join('')}
    </select></label>`;
  }).join('');
  return sel ? `<span class="opt-feats-title">Características</span>${sel}` : '';
}

function optTools(cat, n, feats) {
  const v = optView(cat);
  const total = slot(cat).options.length;
  const attrs = (key) => `data-view="${key}" data-cat="${cat}"`;
  const opts = (pairs, cur) => pairs.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('');
  // Orden: criterios generales y, aparte, las características numéricas que comparten las opciones.
  const sorts = sortsFor(cat);
  const featSorts = sorts.filter((o) => o.feature && (feats.some((f) => `f:${f.key}` === o.key) || o.key === v.sort));
  const sortOpts = `<optgroup label="General">${opts(sorts.filter((o) => !o.feature).map((o) => [o.key, o.label]), v.sort)}</optgroup>`
    + (featSorts.length ? `<optgroup label="Características">${opts(featSorts.map((o) => [o.key, o.label]), v.sort)}</optgroup>` : '');
  const featSel = featSelects(cat);
  return `<div class="opt-tools">
    <input type="search" class="opt-q" ${attrs('q')} value="${esc(v.q)}" placeholder="Buscar en ${total} opciones…" title="Busca por nombre, marca o vendedor" aria-label="Buscar en las opciones de ${esc(CAT[cat].name)}">
    <span class="opt-sort">
      <label class="opt-field">Ordenar <select ${attrs('sort')}>${sortOpts}</select></label>
      <button type="button" class="btn small opt-dir" data-action="opt-dir" data-cat="${cat}" aria-label="Sentido del orden: ${esc(dirLabel(v.sort, v.dir))}. Pulsa para invertirlo">${esc(dirText(v))}</button>
    </span>
    <label class="opt-field">Decisión <select ${attrs('minPick')}>${opts([[0, 'Todas'], [1, '★ o más'], [2, '★★ o más'], [3, '★★★ fijo']], v.minPick)}</select></label>
    <label class="opt-field">Mostrar <select ${attrs('avail')}>${opts(Object.entries(OPTION_AVAIL), v.avail)}</select></label>
    <label class="opt-field">Total hasta US$ <input type="number" min="0" step="10" inputmode="decimal" ${attrs('maxTotal')} value="${esc(optViews[cat]?.maxTotal ?? '')}"></label>
    <label class="opt-check" title="Pedidos de menos de US$${S().threshold}: no pagan IVA al importar"><input type="checkbox" ${attrs('underThreshold')} ${v.underThreshold ? 'checked' : ''}> Sin IVA (&lt; US$${S().threshold})</label>
    <label class="opt-check" title="Con precio por debajo de su precio de lista en alguna tienda"><input type="checkbox" ${attrs('deals')} ${v.deals ? 'checked' : ''}> En oferta</label>
    ${featSel ? `<div class="opt-feats" role="group" aria-label="Filtrar por características" data-cat="${cat}">${featSel}</div>` : ''}
    <div class="opt-status" data-cat="${cat}" role="status">${optStatus(cat, n)}</div>
  </div>`;
}

function optGrid(cat, list, ref, feats = optFeats(cat)) {
  if (list.length) return list.map((p) => optionCard(p, cat, ref, feats)).join('');
  return `<div class="opt-none"><span>Ninguna opción coincide con la búsqueda o los filtros.</span><button type="button" class="btn small" data-action="opt-clear" data-cat="${cat}">Quitar filtros</button></div>`;
}

// Al escribir o cambiar un filtro solo se repinta la lista de esa categoría: el campo no pierde el foco.
function renderOptions(cat) {
  const d = $(`details.options[data-cat="${cat}"]`);
  if (!d) return;
  const shown = shownOptions(cat);
  d.querySelector('summary').textContent = optSummary(cat, shown.length);
  d.querySelector('.opt-grid').innerHTML = optGrid(cat, shown, refTotal(cat));
  d.querySelector('.opt-status').innerHTML = optStatus(cat, shown.length);
  const fbox = d.querySelector('.opt-feats');
  if (fbox) {
    const focused = document.activeElement?.closest?.('.opt-feats') === fbox ? document.activeElement.dataset.feat : null;
    fbox.innerHTML = featSelects(cat);
    if (focused) fbox.querySelector(`[data-feat="${focused}"]`)?.focus();
  }
  const dir = d.querySelector('.opt-dir');
  if (dir) {
    const v = optView(cat);
    dir.textContent = dirText(v);
    dir.setAttribute('aria-label', `Sentido del orden: ${dirLabel(v.sort, v.dir)}. Pulsa para invertirlo`);
  }
  const cmp = $(`#cat-${cat} [data-action="compare"]`);
  if (cmp) cmp.textContent = compareLabel(cat, shown);
}

function renderParts(b, list) {
  const html = CATEGORIES.map((c) => {
    const s = slot(c.key);
    const sel = s.selected.map((id) => s.options.find((o) => o.id === id)).filter(Boolean);
    const state = catState(b, c.key);
    const flags = list.filter((x) => x.cats.includes(c.key) && (x.level === 'error' || x.level === 'warn'));
    const ref = refTotal(c.key);
    const shown = shownOptions(c.key);
    const feats = optFeats(c.key);
    const sub = sel.length ? sel.map((p) => shortTitle(p.title, 45)).join(' + ') : c.essential ? 'Sin elegir' : 'Opcional';
    return `<section class="cat has-${state}" id="cat-${c.key}">
      <div class="cat-head">
        <div class="cat-icon">${ICONS[c.key]}</div>
        <div class="cat-title"><h3>${c.name}${c.multi ? '<span class="chip">varios</span>' : ''}</h3><p title="${esc(sub)}">${esc(sub)}</p></div>
        <div class="cat-flags">
          ${s.options.filter(isFixed).length ? `<span class="chip pick pick3" title="Opciones marcadas ★★★ fijo">★★★ ${s.options.filter(isFixed).length}</span>` : ''}
          ${flags.some((x) => x.level === 'error') ? '<span class="chip err">error</span>' : flags.length ? '<span class="chip warn">revisar</span>' : ''}
          ${s.options.length > 1 ? `<button class="btn small ghost" data-action="compare" data-cat="${c.key}">${compareLabel(c.key, shown)}</button>` : ''}
        </div>
      </div>
      <div class="cat-body">
        ${sel.length ? sel.map((p) => productCard(p, c.key)).join('') : `<div class="empty-slot">${ICONS[c.key].replace('<svg', '<svg width="28" height="28"')}<span>${s.options.length ? 'Elige una de las opciones de abajo' : 'Pega abajo un enlace de amazon.com para agregar opciones'}</span></div>`}
        <details class="options" data-cat="${c.key}" ${openCats.has(c.key) || !s.options.length ? 'open' : ''}>
          <summary>${s.options.length ? optSummary(c.key, shown.length) : 'Agregar producto'}</summary>
          ${s.options.length > 1 ? optTools(c.key, shown.length, feats) : ''}
          ${s.options.length ? `<div class="opt-grid">${optGrid(c.key, shown, ref, feats)}</div>` : ''}
          <form class="add-row" data-action="add-url" data-cat="${c.key}" style="margin-top:10px">
            <input type="url" name="url" placeholder="Enlace de amazon.com o amzn.to (se lee con tu sesión)" aria-label="Enlace de Amazon para ${esc(c.name)}" required>
            <button class="btn primary" type="submit">Agregar</button>
            <button class="btn" type="button" data-action="search-amazon" data-cat="${c.key}">Buscar en Amazon ↗</button>
            <button class="btn ghost" type="button" data-action="add-manual" data-cat="${c.key}">+ Manual</button>
            <div class="err-msg"></div>
          </form>
        </details>
      </div>
    </section>`;
  }).join('');
  // Conserva lo que el usuario estaba escribiendo en los campos de enlace.
  const typed = Object.fromEntries([...document.querySelectorAll('form.add-row')].map((f) => [f.dataset.cat, f.url.value]).filter(([, v]) => v));
  // Y el foco (con el cursor) del buscador o un filtro, si el repintado llega mientras lo usas.
  const f = document.activeElement?.matches?.('#parts [data-view]') ? document.activeElement : null;
  const focus = f && { cat: f.dataset.cat, key: f.dataset.view, feat: f.dataset.feat, start: f.selectionStart, end: f.selectionEnd };
  $('#parts').innerHTML = html;
  for (const [cat, v] of Object.entries(typed)) { const f = $(`form.add-row[data-cat="${cat}"]`); if (f) f.url.value = v; }
  const el = focus && $(`#parts [data-view="${focus.key}"][data-cat="${focus.cat}"]${focus.feat ? `[data-feat="${focus.feat}"]` : ''}`);
  if (el) {
    el.focus();
    try { el.setSelectionRange(focus.start, focus.end); } catch { /* type=number no admite selección */ }
  }
}

// ---------- modales ----------
const modal = $('#modal');
function openModal(html) { $('#modalBody').innerHTML = html; if (!modal.open) modal.showModal(); }
function closeModal() { modal.close(); }

// ---------- modal y dock de resumen de cambios ----------
const changesModal = $('#changesModal');
const changesDock = $('#changesDock');
let currentChanges = null;

function renderChangesSummaryHtml(r) {
  const changes = r.changes || [];
  const drops = changes.filter((c) => c.priceDiff != null && c.priceDiff < 0);
  const rises = changes.filter((c) => c.priceDiff != null && c.priceDiff > 0);
  const targets = changes.filter((c) => c.targetHit);
  const shipChanges = changes.filter((c) => c.shippingChanged || c.shipsToCOChanged);

  const dateStr = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  const title = `Resumen de cambios tras la actualización`;
  const sub = `${changes.length} producto${changes.length === 1 ? '' : 's'} con cambios de ${r.ok || changes.length} consultado${(r.ok || changes.length) === 1 ? '' : 's'} · ${dateStr}`;

  return `
    <div class="m-head changes-head">
      <div>
        <h2 id="changesModalTitle">📋 ${title}</h2>
        <div class="muted small" style="margin-top:3px">${sub}</div>
      </div>
      <div class="changes-head-actions">
        <button type="button" class="btn ghost small" data-action="minimize-changes" title="Minimizar a barra inferior" aria-label="Minimizar">🗕 Minimizar</button>
        <button type="button" class="btn ghost small" data-action="close-changes" title="Cerrar y descartar resumen" aria-label="Cerrar">✕</button>
      </div>
    </div>

    <div class="m-body changes-body">
      <div class="changes-kpis">
        <div class="kpi-card">
          <span class="kpi-val">${changes.length}</span>
          <span class="kpi-lbl">Productos con cambios</span>
        </div>
        ${drops.length ? `
          <div class="kpi-card ok">
            <span class="kpi-val">↓ ${drops.length}</span>
            <span class="kpi-lbl">Bajaron de precio</span>
          </div>
        ` : ''}
        ${rises.length ? `
          <div class="kpi-card warn">
            <span class="kpi-val">↑ ${rises.length}</span>
            <span class="kpi-lbl">Subieron de precio</span>
          </div>
        ` : ''}
        ${targets.length ? `
          <div class="kpi-card accent">
            <span class="kpi-val">🎯 ${targets.length}</span>
            <span class="kpi-lbl">Meta alcanzada</span>
          </div>
        ` : ''}
        ${shipChanges.length ? `
          <div class="kpi-card">
            <span class="kpi-val">🚚 ${shipChanges.length}</span>
            <span class="kpi-lbl">Cambios en envío</span>
          </div>
        ` : ''}
      </div>

      <div class="changes-list">
        ${changes.map((c) => `
          <div class="change-card">
            <div class="change-card-top">
              <span class="chip">${esc(c.catName)}</span>
              <a href="${esc(c.url || '#')}" target="_blank" rel="noopener" class="change-title" title="Ver en Amazon">
                ${esc(c.title)}
              </a>
              <span class="muted small num">${esc(c.asin)}</span>
            </div>

            <div class="change-card-main">
              ${c.image ? `<img src="${esc(c.image)}" alt="" class="change-thumb" loading="lazy">` : ''}
              <div class="change-details">
                ${c.targetHit ? `
                  <div class="change-target-hit">
                    🎯 <strong>¡Precio objetivo alcanzado!</strong> Está en ${usd(c.curr.price)} (tu meta era ≤ ${usd(c.targetPrice)})
                  </div>
                ` : ''}

                ${c.priceChanged ? `
                  <div class="change-row">
                    <span class="change-label">Precio:</span>
                    <div class="change-val">
                      <span class="prev-val">${c.prev.price != null ? usd(c.prev.price) : 'Sin precio'}</span>
                      <span class="arrow">→</span>
                      <strong class="curr-val">${c.curr.price != null ? usd(c.curr.price) : 'No disponible'}</strong>
                      ${c.priceDiff != null ? (
                        c.priceDiff < 0
                          ? `<span class="diff-badge drop">↓ ${usd(Math.abs(c.priceDiff))} (${c.priceDiffPct}%)</span>`
                          : `<span class="diff-badge rise">↑ +${usd(c.priceDiff)} (+${c.priceDiffPct}%)</span>`
                      ) : (c.curr.price != null ? `<span class="diff-badge drop">Disponible</span>` : `<span class="diff-badge rise">Sin precio</span>`)}
                    </div>
                  </div>
                ` : ''}

                ${c.shippingChanged ? `
                  <div class="change-row">
                    <span class="change-label">Envío a Colombia:</span>
                    <div class="change-val">
                      <span class="prev-val">${c.prev.shipping == null ? 'Sin datos' : c.prev.shipping === 0 ? 'Gratis' : usd(c.prev.shipping)}</span>
                      <span class="arrow">→</span>
                      <strong class="curr-val">${c.curr.shipping == null ? 'Sin datos' : c.curr.shipping === 0 ? 'Gratis' : usd(c.curr.shipping)}</strong>
                    </div>
                  </div>
                ` : ''}

                ${c.importFeesChanged ? `
                  <div class="change-row">
                    <span class="change-label">Cargos importación:</span>
                    <div class="change-val">
                      <span class="prev-val">${c.prev.importFees == null ? 'Sin datos' : usd(c.prev.importFees)}</span>
                      <span class="arrow">→</span>
                      <strong class="curr-val">${c.curr.importFees == null ? 'Sin datos' : usd(c.curr.importFees)}</strong>
                    </div>
                  </div>
                ` : ''}

                ${c.shipsToCOChanged ? `
                  <div class="change-row">
                    <span class="change-label">¿Envía a Colombia?:</span>
                    <div class="change-val">
                      <span class="prev-val">${c.prev.shipsToCO ? 'Sí' : 'No'}</span>
                      <span class="arrow">→</span>
                      <strong class="curr-val" style="color:var(${c.curr.shipsToCO ? '--ok' : '--err'})">${c.curr.shipsToCO ? 'Sí' : 'No'}</strong>
                    </div>
                  </div>
                ` : ''}

                ${c.availabilityChanged ? `
                  <div class="change-row">
                    <span class="change-label">Disponibilidad:</span>
                    <div class="change-val">
                      <span class="prev-val">${esc(c.prev.availability || 'Sin datos')}</span>
                      <span class="arrow">→</span>
                      <strong class="curr-val">${esc(c.curr.availability || 'Sin datos')}</strong>
                    </div>
                  </div>
                ` : ''}

                ${c.sellerChanged ? `
                  <div class="change-row">
                    <span class="change-label">Vendedor:</span>
                    <div class="change-val">
                      <span class="prev-val">${esc(c.prev.seller || 'Sin datos')}</span>
                      <span class="arrow">→</span>
                      <strong class="curr-val">${esc(c.curr.seller || 'Sin datos')}</strong>
                    </div>
                  </div>
                ` : ''}

                ${c.replacedEdits && c.replacedEdits.length ? `
                  <div class="change-row"><span class="chip accent">Amazon reemplazó tus ediciones en: ${esc(editedLabels(c.replacedEdits))}</span></div>
                ` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="m-foot changes-foot">
      <small class="muted">Puedes minimizar este modal para navegar por el armador y recuperarlo cuando quieras.</small>
      <div class="spacer"></div>
      <button type="button" class="btn" data-action="minimize-changes">🗕 Minimizar</button>
      <button type="button" class="btn primary" data-action="close-changes">Cerrar resumen</button>
    </div>
  `;
}

function renderChangesDockHtml(r) {
  const count = r.changes?.length || 0;
  return `
    <div class="changes-dock-inner">
      <div class="changes-dock-info">
        <span class="changes-dock-icon">📋</span>
        <span class="changes-dock-text">
          <strong>Resumen de cambios:</strong> ${count} producto${count === 1 ? '' : 's'} con cambios
        </span>
      </div>
      <div class="changes-dock-actions">
        <button type="button" class="btn small primary" data-action="restore-changes" title="Expandir modal de resumen">🔼 Ver resumen</button>
        <button type="button" class="btn small ghost" data-action="close-changes" title="Cerrar y descartar resumen" aria-label="Cerrar">✕</button>
      </div>
    </div>
  `;
}

function openChangesModal(summary) {
  if (!summary?.changes?.length) return;
  currentChanges = summary;
  hideChangesDock();
  $('#changesModalBody').innerHTML = renderChangesSummaryHtml(summary);
  if (!changesModal.open) changesModal.showModal();
}

function minimizeChangesModal() {
  if (changesModal.open) changesModal.close();
  if (currentChanges?.changes?.length) {
    showChangesDock(currentChanges);
    toast('Resumen de cambios minimizado. Puedes reabrirlo abajo.', false, 3500);
  }
}

function restoreChangesModal() {
  if (currentChanges) {
    openChangesModal(currentChanges);
  }
}

function closeChangesModal() {
  if (changesModal.open) changesModal.close();
  currentChanges = null;
  hideChangesDock();
}

function showChangesDock(summary) {
  changesDock.innerHTML = renderChangesDockHtml(summary);
  changesDock.hidden = false;
}

function hideChangesDock() {
  changesDock.hidden = true;
  changesDock.innerHTML = '';
}

function sparkline(hist) {
  const pts = (hist || []).filter((h) => h.price != null);
  if (pts.length < 2) return '<p class="muted" style="margin:0">Aún no hay historial suficiente. Cada actualización guarda un punto.</p>';
  const xs = pts.map((h) => Date.parse(h.t)), ys = pts.map((h) => h.price);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const W = 600, H = 56, px = (x) => ((x - x0) / (x1 - x0 || 1)) * (W - 8) + 4, py = (y) => H - 6 - ((y - y0) / (y1 - y0 || 1)) * (H - 12);
  const d = pts.map((h, i) => `${i ? 'L' : 'M'}${px(xs[i]).toFixed(1)},${py(h.price).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="area" d="${d}L${px(x1)},${H}L${px(x0)},${H}Z"/><path d="${d}"/></svg>
    <div class="price-sub">Mín ${usd(y0)} · Máx ${usd(y1)} · ${pts.length} lecturas desde ${new Date(x0).toLocaleDateString('es-CO')}</div>`;
}

const TAG_FIELDS = {
  cpu: [['socket', 'Socket', 'AM5'], ['tdp', 'TDP (W)', '65']],
  motherboard: [['socket', 'Socket', 'AM5'], ['memType', 'Memoria', 'DDR5'], ['formFactor', 'Formato', 'ATX'], ['m2Slots', 'Ranuras M.2', '3'], ['sataPorts', 'Puertos SATA', '4']],
  ram: [['memType', 'Tipo', 'DDR5'], ['sticks', 'Módulos', '2'], ['capacityGb', 'Capacidad (GB)', '32']],
  gpu: [['needs12v2x6', 'Requiere 12V-2x6 (true/false)', 'true']],
  psu: [['psuWatts', 'Potencia (W)', '850'], ['has12v2x6', '12V-2x6 nativo (true/false)', 'true']],
  case: [['formFactor', 'Placa máxima', 'ATX'], ['coolerMaxMm', 'Altura máx. disipador (mm)', '165']],
  cooler: [['heightMm', 'Altura (mm)', '157'], ['sockets', 'Montajes (AM5, LGA1700…)', 'AM5']],
  storage: [['interface', 'Interfaz (NVMe/SATA)', 'NVMe'], ['capacityGb', 'Capacidad (GB)', '1000'], ['pcie', 'PCIe', 'PCIe 4.0'], ['dram', 'DRAM (Sí/No)', 'Sí'], ['dramType', 'Tipo de DRAM', 'LPDDR4'],
    ['nand', 'NAND (TLC/QLC)', 'TLC'], ['controller', 'Controlador', 'Phison E18'], ['heatsink', 'Disipador (Sí/No)', 'No'], ['readMBs', 'Lectura (MB/s)', '7000'], ['writeMBs', 'Escritura (MB/s)', '6000'], ['tbw', 'Durabilidad (TBW)', '600']],
  fans: [['count', 'Ventiladores en el pack', '3']],
};
// Protector de picos (va en cualquier categoría, normalmente «Cables y accesorios»).
const SURGE_FIELDS = [['joules', 'Julios (J)', '2160'], ['vpr', 'Voltaje de limitación VPR (V)', '400'], ['outlets', 'Tomas', '7'], ['capacityW', 'Capacidad (W)', '1800']];
const tagFields = (ps, cat) => [...(TAG_FIELDS[cat] || []), ...(ps.some(isSurgeProtector) ? SURGE_FIELDS : [])];

// Datos del producto editables a mano. En productos con enlace de Amazon lo cambiado queda marcado como editado.
function editSection(p, cat) {
  const edited = p.edited || {};
  const linked = !!asinOf(p);
  const input = ([k, label, type]) => {
    const mark = edited[k] ? ' <span class="chip accent">editado</span>' : '';
    const v = p[k];
    if (type === 'bool') return `<label class="field"><span class="field-label">${label}${mark}</span><select name="edit_${k}">${[['', 'Sin confirmar'], ['true', 'Sí'], ['false', 'No']].map(([val, t]) => `<option value="${val}" ${String(v ?? '') === val ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    const attrs = type === 'number' ? 'type="number" step="0.01" min="0"' : type === 'url' ? 'type="url" placeholder="https://…"' : 'type="text"';
    return `<label class="field" ${k === 'title' || k === 'image' ? 'style="grid-column:1/-1"' : ''}><span class="field-label">${label}${mark}</span><input ${attrs} name="edit_${k}" value="${esc(v ?? '')}"></label>`;
  };
  const editedList = Object.keys(edited);
  return `<div><p class="section-title">Datos del producto</p>
    <div class="grid2">
      ${EDITABLE_FIELDS.map(input).join('')}
      ${p.manual ? `<label class="field">Tienda<input type="text" name="store" value="${esc(p.store || '')}"></label>` : ''}
      ${linked ? `<label class="field">Destino del envío<select name="market">${Object.entries(MARKETS).map(([k, m]) => `<option value="${k}" ${marketOf(p) === k ? 'selected' : ''}>${m.label}</option>`).join('')}</select><small>Solo se actualiza cuando tu sesión de Amazon entrega en ese destino.</small></label>` : ''}
    </div>
    <small class="muted">${linked
      ? 'Lo que cambies queda marcado como editado: «↻ Actualizar» no lo sobrescribe, salvo que tu sesión encuentre en Amazon un precio con envío a Colombia (entonces Amazon reemplaza todo).'
      : 'Producto sin enlace de Amazon: estos son los datos que usa el armador.'}</small>
    ${linked && editedList.length ? `<div style="margin-top:8px"><button type="button" class="btn small" data-action="clear-edits" data-cat="${cat}" data-id="${p.id}">Descartar ediciones y actualizar con Amazon</button> <span class="muted">Editado: ${esc(editedLabels(editedList))}</span></div>` : ''}
  </div>`;
}

// Enlaces y precios en cada tienda (opcionales). La fila de Amazon del destino del producto es el propio producto.
const STORE_HINT = { 'amazon-co': 'https://www.amazon.com/dp/…', 'amazon-us': 'https://www.amazon.com/dp/…', newegg: 'https://www.newegg.com/…/p/N82E…', bestbuy: 'https://www.bestbuy.com/product/…', walmart: 'https://www.walmart.com/ip/…', target: 'https://www.target.com/p/…', bhphoto: 'https://www.bhphotovideo.com/c/product/…', microcenter: 'https://www.microcenter.com/product/…', mercadolibre: 'https://www.mercadolibre.com.co/…' };
function storesSection(p) {
  const own = ownAmazonStore(p);
  const rows = storeRows(p, S());
  return `<div><p class="section-title">Comercios</p>
    <div class="se-list">${STORE_KEYS.map((key) => {
      const st = STORES[key];
      const r = rows.find((x) => x.store === key);
      const head = `${STORE_LOGOS[key]}<div class="se-name"><b>${esc(st.name)}</b><small>${esc(st.sub)}</small></div>`;
      if (key === own) return `<div class="se-row own">${head}<div class="se-own muted">Es este producto: ${r?.price != null ? `<b>${usd(r.price)}</b> (${esc(st.basis.charAt(0).toLowerCase() + st.basis.slice(1))})` : 'sin precio aún'}. Se actualiza con ↻.</div></div>`;
      const status = r?.error ? `<span class="err-t">${esc(r.error)}</span>` : r?.fetchedAt ? `Leído ${ago(r.fetchedAt)}` : r?.price != null ? 'Escrito a mano' : '';
      return `<div class="se-row">${head}
        <input type="url" class="se-url" name="st_url_${key}" value="${esc(r?.url || '')}" placeholder="${esc(STORE_HINT[key])}" aria-label="Enlace en ${esc(st.name)}">
        <label class="se-price"><span>${st.currency === 'COP' ? 'COP' : 'US$'}</span><input type="number" min="0" step="${st.currency === 'COP' ? 1 : 0.01}" name="st_price_${key}" value="${r?.price ?? ''}" aria-label="Precio en ${esc(st.name)}"></label>
        ${st.region === 'us' ? `<label class="se-price se-extra"><span>Envío</span><input type="number" min="0" step="0.01" name="st_ship_${key}" value="${r?.shipping ?? ''}" placeholder="0" aria-label="Envío a Miami en ${esc(st.name)}"></label>
        <label class="se-price se-extra"><span>Antes</span><input type="number" min="0" step="0.01" name="st_list_${key}" value="${r?.listPrice ?? ''}" aria-label="Precio de lista (sin oferta) en ${esc(st.name)}"></label>` : ''}
        ${r?.total != null ? `<small class="se-status num">Con envío y tax: ${usd(r.total)}${r.deal ? ' · <span class="deal-t">Oferta</span>' : ''}${r.note ? ` · ${esc(r.note)}` : ''}</small>` : ''}
        ${status ? `<small class="se-status">${status}</small>` : ''}
      </div>`;
    }).join('')}</div>
    <small class="muted">Opcionales: se muestran en la tarjeta los que tengan enlace y precio, y se marca el más bajo. El precio se escribe a mano o se lee con «$ Actualizar precios». Amazon con envío a Medellín compara el total con envío y cargos; las tiendas con envío a Miami (ZIP 33186), precio + envío + sales tax (${taxPct()}, en Ajustes). «Antes» es el precio sin oferta. No cambian el total del armado.</small>
  </div>`;
}

// Lee la sección «Comercios» del formulario. Devuelve los nombres de las tiendas con un enlace que no es suyo.
function readStoresForm(f, p) {
  const bad = [];
  const out = [];
  for (const key of STORE_KEYS) {
    const uel = f.elements[`st_url_${key}`];
    if (!uel) continue;
    const old = (p.stores || []).find((x) => x?.store === key);
    const url = uel.value.trim();
    const raw = f.elements[`st_price_${key}`].value.trim();
    if (url && !urlFitsStore(url, key)) { bad.push(STORES[key].name); if (old) out.push(old); continue; }
    if (!url && raw === '') continue;
    const row = old ? { ...old } : { store: key };
    if ((old?.url || null) !== (url || null)) Object.assign(row, { url: url || null, fetchedAt: null, error: null, prev: null });
    const price = raw === '' ? null : Math.max(0, Number(raw));
    if (price !== (old?.price ?? null)) {
      if (old?.price != null && price != null) row.prev = { price: old.price, at: old.fetchedAt || null };
      Object.assign(row, { price, currency: STORES[key].currency, fetchedAt: null, error: null });
    }
    for (const [field, name] of [['shipping', 'st_ship_'], ['listPrice', 'st_list_']]) {
      const el = f.elements[name + key];
      if (!el) continue;
      const v = el.value.trim();
      row[field] = v === '' ? null : Math.max(0, Number(v));
    }
    out.push(row);
  }
  if (out.length) p.stores = out; else delete p.stores;
  return bad;
}

function detailsModal(cat, id, { focusLink = false } = {}) {
  const p = findP(cat, id);
  if (!p) return;
  const c = lineCost(p, S());
  const tags = detectTags({ ...p, tags: {} }, cat);
  const fields = tagFields([p], cat);
  const specs = Object.entries(p.specs || {});
  openModal(`
    <div class="m-head"><h2>${esc(p.title)}</h2><button class="btn ghost" data-action="close" aria-label="Cerrar">✕</button></div>
    <form class="m-body" id="detailForm" data-cat="${cat}" data-id="${id}">
      <div class="m-hero">
        ${thumb(p, cat)}
        <div>
          <div class="chips">${chipsFor(p, cat)}</div>
          <table class="t" style="margin-top:8px">
            <tr><th>Producto</th><td class="r">${usd(c.subtotal)}</td></tr>
            ${p.manual ? '' : isMiami(p) ? `<tr><th>Envío a Miami</th><td class="r">${c.shipping == null ? '—' : c.shipping === 0 ? 'Gratis' : usd(c.shipping)}</td></tr>
            <tr><th>Sales tax ${c.feesSource === 'editado' ? '(editado)' : `(estimado ${+(S().miamiTax * 100).toFixed(2)} %; el exacto sale en el checkout)`}</th><td class="r">${usd(c.importFees)}</td></tr>` : `<tr><th>Envío a Colombia</th><td class="r">${c.shipping == null ? '—' : c.shipping === 0 ? 'Gratis' : usd(c.shipping)}</td></tr>
            <tr><th>Cargos de importación ${p.importFeesInfo === 'no-informado' ? '(Amazon no los informa: vendedor externo, se pagarían en aduana)' : c.feesSource === 'amazon' ? '(Amazon)' : c.feesSource === 'editado' ? '(editado)' : '(estimado)'}</th><td class="r">${usd(c.importFees)}</td></tr>`}
            <tr><th><b>${p.status === 'bought' && !p.manual ? `Total hoy en ${marketLabel(p)}` : `Total en ${marketLabel(p)}`}</b></th><td class="r"><b>${usd(c.total)}</b><br><span class="muted">${p.displayed?.total != null ? `${copAmazon(p.displayed.total)} según Amazon` : cop(c.total)}</span></td></tr>
            ${p.status === 'bought' ? `<tr><th>Pagado <small class="muted">(fijo en el total)</small></th><td class="r">${paidTotal(p) != null ? `<b>${usd(paidTotal(p))}</b> ${trendChip(paidChange(p, S()))}${p.paid.date ? `<br><span class="muted">${esc(fmtDate(p.paid.date))}</span>` : ''}` : '<span class="warn-t">Sin registrar</span>'}
              <br><button type="button" class="btn small" data-action="paid" data-cat="${cat}" data-id="${id}">🧾 ${paidTotal(p) != null ? 'Editar' : 'Registrar'}</button></td></tr>` : ''}
            ${p.fx ? `<tr><th>Tasa usada</th><td class="r">${p.fx.rate.toLocaleString('es-CO')} COP/US$ (${esc(p.fx.source)})</td></tr>` : ''}
            ${p.manual ? '' : `<tr><th>Vendedor / envía</th><td class="r">${esc(p.seller || '—')} / ${esc(p.shipsFrom || '—')}</td></tr>
            <tr><th>Disponibilidad</th><td class="r">${esc(p.availability || '—')}</td></tr>
            <tr><th>Entrega a</th><td class="r">${esc(p.deliverTo || '—')}${isMiami(p) ? (p.region && p.region !== 'us' ? ' <span class="chip err">sin Miami</span>' : '') : p.locationOk === false ? ' <span class="chip err">sin Colombia</span>' : ''}</td></tr>
            <tr><th>Última lectura</th><td class="r">${p.source === 'sesion' ? `tu sesión · ${ago(p.fetchedAt)}` : 'aún no leído con tu sesión'}</td></tr>
            ${missingFields(p).length ? `<tr><th>Faltan</th><td class="r"><span class="chip err">${esc(missingFields(p).join(', '))}</span></td></tr>` : ''}`}
          </table>
        </div>
      </div>

      <div class="grid2">
        <label class="field">Estado
          <select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${(p.status || 'buy') === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <label class="field">Decisión
          <select name="pick">${PICKS.map((k) => `<option value="${k.level}" ${pickLevel(p) === k.level ? 'selected' : ''}>${esc(k.stars)} ${esc(k.short)}</option>`).join('')}</select>
          <small>${esc(pickOf(p).hint)}. Se queda en el producto aunque elijas otra opción.</small></label>
        <label class="field">Cantidad<input type="number" name="qty" min="1" max="20" value="${p.qty || 1}"></label>
        <label class="field">Precio objetivo (US$)<input type="number" step="0.01" name="targetPrice" value="${p.targetPrice ?? ''}" placeholder="alerta al actualizar"></label>
        <label class="field">Consumo (W)<input type="number" name="watts" value="${p.watts ?? ''}" placeholder="auto: ${estimateWatts({ ...p, watts: null, qty: 1 }, cat)} W"></label>
        ${asinOf(p) ? '' : `<label class="field" style="grid-column:1/-1">Enlace de Amazon (para actualizar con tu sesión, incluida la foto)<input type="url" name="amazonUrl" placeholder="https://www.amazon.com/dp/… o amzn.to/…"><small>Al guardar, la ficha se reescribe con tu sesión. El estado (p. ej. «Ya comprado») se conserva.</small></label>`}
      </div>

      ${editSection(p, cat)}

      ${storesSection(p)}

      ${fields.length ? `<div><p class="section-title">Datos para compatibilidad</p>
        <div class="grid2">${fields.map(([k, label]) => `<label class="field">${label}<input type="text" name="tag_${k}" value="${esc(p.tags?.[k] ?? '')}" placeholder="auto: ${esc(tags[k] ?? 'no detectado')}"></label>`).join('')}</div>
        <small class="muted">Se detectan del título y las especificaciones. Escribe un valor solo para corregirlo.</small></div>` : ''}

      <label class="field">Notas<textarea name="notes" rows="2">${esc(p.notes || '')}</textarea></label>

      ${p.manual ? '' : `<div><p class="section-title">Historial de precio</p>${sparkline(p.history)}</div>`}
      ${p.debug ? `<details><summary class="muted">Diagnóstico de la última lectura</summary>
        <table class="t" style="margin-top:6px">${Object.entries({ ...p.debug, priceSource: p.priceSource, hasBuybox: p.hasBuybox, locationOk: p.locationOk, loggedIn: p.loggedIn }).map(([k, v]) => `<tr><th>${esc(k)}</th><td style="word-break:break-word">${esc(v)}</td></tr>`).join('')}</table>
      </details>` : ''}

      ${p.offers?.length ? `<div><p class="section-title">Ofertas para Colombia (${p.offers.length})</p><div class="scroll-x"><table class="t">
        <tr><th>Condición</th><th>Vendedor</th><th>Envía</th><th class="r">Precio</th><th class="r">Envío</th><th>Entrega</th></tr>
        ${p.offers.map((o) => `<tr ${o.condition !== 'Nuevo' ? 'class="muted"' : ''}><td>${esc(o.condition)}</td><td>${esc(o.seller)}</td><td>${esc(o.shipsFrom)}${o.origin ? ` (${esc(o.origin)})` : ''}</td><td class="r">${usd(o.price)}</td><td class="r">${o.shipping == null ? '—' : o.shipping === 0 ? 'Gratis' : usd(o.shipping)}</td><td>${esc(o.delivery)}</td></tr>`).join('')}
      </table></div></div>` : ''}

      ${p.bullets?.length ? `<div><p class="section-title">Características</p><ul class="bullets">${p.bullets.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${specs.length ? `<div><p class="section-title">Especificaciones</p><table class="t">${specs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table></div>` : ''}
    </form>
    <div class="m-foot">
      <button class="btn danger ghost" data-action="delete" data-cat="${cat}" data-id="${id}">Eliminar opción</button>
      <span class="spacer"></span>
      ${p.url ? `<a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener">Abrir en Amazon ↗</a>` : ''}
      ${asinOf(p) ? `<button class="btn" data-action="refresh-modal" data-cat="${cat}" data-id="${id}">↻ Actualizar con mi sesión</button>` : ''}
      <button class="btn primary" data-action="save-details">Guardar</button>
    </div>`);
  if (focusLink) $('#detailForm [name="amazonUrl"]')?.focus();
}

async function saveDetails() {
  const f = $('#detailForm');
  const p = findP(f.dataset.cat, f.dataset.id);
  const v = (n) => f.elements[n]?.value?.trim();
  const link = v('amazonUrl');
  if (link) requireSession(); // dentro del clic en Guardar
  const nowBought = v('status') === 'bought' && p.status !== 'bought';
  p.status = v('status');
  p.pick = Math.max(0, Math.min(PICK_FIXED, Number(v('pick')) || 0));
  p.qty = Math.max(1, Number(v('qty')) || 1);
  p.targetPrice = v('targetPrice') ? Number(v('targetPrice')) : null;
  p.watts = v('watts') ? Number(v('watts')) : null;
  p.notes = v('notes');
  const values = {};
  for (const [k, , type] of EDITABLE_FIELDS) {
    const el = f.elements[`edit_${k}`];
    if (!el) continue;
    const raw = el.value.trim();
    if (type === 'number') values[k] = raw === '' ? null : Math.max(0, Number(raw));
    else if (type === 'bool') values[k] = raw === '' ? null : raw === 'true';
    else if (type === 'url') values[k] = /^https?:\/\//i.test(raw) ? raw : null;
    else values[k] = raw || null;
  }
  if (!values.title) delete values.title; // el título no puede quedar vacío
  const changed = applyEdits(p, values, { track: !!asinOf(p) });
  if (p.manual) p.store = v('store');
  if (f.elements.market) { if (f.elements.market.value === 'miami') p.market = 'miami'; else delete p.market; }
  const badStores = readStoresForm(f, p);
  if (badStores.length) toast(`Enlace que no es de la tienda (no se guardó): ${badStores.join(', ')}.`, true, 7000);
  if (changed.length && asinOf(p)) toast(`Editado: ${editedLabels(changed)}. «↻ Actualizar» lo conservará salvo que Amazon muestre precio con envío a Colombia.`, false, 7000);
  p.tags = {};
  for (const el of f.querySelectorAll('[name^="tag_"]')) {
    const raw = el.value.trim();
    if (!raw) continue;
    p.tags[el.name.slice(4)] = raw === 'true' ? true : raw === 'false' ? false : /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw.toUpperCase() === raw.toLowerCase() ? raw : /^(ddr|am|lga|nvme|sata)/i.test(raw) ? raw.toUpperCase() : raw;
  }
  closeModal();
  commit();
  if (link) await linkAndUpdate(p, link);
  if (nowBought && paidTotal(p) == null) paidModal(f.dataset.cat, p.id); // recién comprado: ¿cuánto pagaste?
}

// Vincula un producto (p. ej. uno ya comprado) con su ficha de Amazon y la lee con tu sesión.
async function linkAndUpdate(p, link) {
  try {
    const asin = await asinFromInput(link);
    Object.assign(p, { asin, url: `https://www.amazon.com/dp/${asin}` });
    commit();
    const r = await updateAsins([asin]);
    toast(r.failed ? `No pude leerlo: ${r.errors[0]}` : `Vinculado y actualizado con tu sesión: ${shortTitle(p.title, 40)}`, !!r.failed, 7000);
  } catch (e) { toast(e.message, true); }
}

function manualModal(cat) {
  openModal(`
    <div class="m-head"><h2>Producto manual · ${CAT[cat].name}</h2><button class="btn ghost" data-action="close" aria-label="Cerrar">✕</button></div>
    <form class="m-body" id="manualForm" data-cat="${cat}">
      <p class="muted" style="margin:0">Para piezas ya compradas o de otra tienda (Medellín, B&amp;H…). Si pones un enlace de Amazon, la ficha (precio, foto, especificaciones) se completa con tu sesión.</p>
      <div class="grid2">
        <label class="field" style="grid-column:1/-1">Nombre<input type="text" name="title" required placeholder="Ej: Lian Li Lancool 216"></label>
        <label class="field">Estado<select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
        <label class="field">Decisión<select name="pick">${PICKS.map((k) => `<option value="${k.level}">${k.stars} ${k.short}</option>`).join('')}</select></label>
        <label class="field">Precio (US$)<input type="number" step="0.01" name="price"></label>
        <label class="field">Tienda<input type="text" name="store" placeholder="Tienda local / B&H / Newegg"></label>
        <label class="field">Enlace (opcional; si es de Amazon se lee con tu sesión)<input type="url" name="url"></label>
        <label class="field">Imagen (URL, opcional)<input type="url" name="image"></label>
        <label class="field">Cantidad<input type="number" name="qty" min="1" value="1"></label>
      </div>
    </form>
    <div class="m-foot"><button class="btn ghost" data-action="close">Cancelar</button><button class="btn primary" data-action="save-manual">Agregar</button></div>`);
}

async function saveManual() {
  const f = $('#manualForm');
  if (!f.reportValidity()) return;
  const v = (n) => f.elements[n].value.trim();
  const amazonLink = /amazon\.com\/|amzn\.|a\.co\//i.test(v('url')) ? v('url') : '';
  if (amazonLink) requireSession();
  const cat = f.dataset.cat;
  const p = { id: uid('p'), manual: true, title: v('title'), status: v('status'), pick: Math.max(0, Math.min(PICK_FIXED, Number(v('pick')) || 0)), price: v('price') ? Number(v('price')) : null, shipping: 0, store: v('store') || 'Manual', url: v('url') || null, image: v('image') || null, qty: Math.max(1, Number(v('qty')) || 1), tags: {}, history: [], notes: '' };
  // Comprado en otra tienda: el precio que escribiste es lo que pagaste.
  if (p.status === 'bought' && p.price != null && !amazonLink) p.paid = { total: p.price, date: null, source: 'manual', at: new Date().toISOString() };
  const s = slot(cat);
  s.options.push(p);
  if (!s.selected.length || CAT[cat].multi) s.selected.push(p.id);
  closeModal();
  commit();
  if (amazonLink) await linkAndUpdate(p, amazonLink);
  if (p.status === 'bought' && paidTotal(p) == null) paidModal(cat, p.id);
}

// ---------- precio pagado ----------
// Lo que pagaste queda fijo en el total del armado; el precio de Amazon se sigue leyendo para ver si subió o bajó.
// «Leer de mis pedidos» busca cada producto en las facturas de tus pedidos; lo que no aparece se escribe a mano.
const paidFound = new Map(); // id de producto → lo encontrado en tus pedidos (mientras el modal está abierto)
const paidOrigin = (paid) => (!paid ? 'Sin registrar'
  : paid.source === 'pedido' ? `Pedido ${paid.orderId}${paid.by === 'nombre' ? ' · coincide por nombre, revísalo' : ''}${paid.exact ? '' : ` · envío y cargos repartidos entre ${paid.items} artículos`}`
  : 'Escrito a mano');

function paidLines(cat, id) {
  if (id) { const p = findP(cat, id); return p ? [{ cat, p }] : []; }
  return selectedLines(build()).filter(({ p }) => p.status === 'bought');
}

function paidModal(cat = '', id = '') {
  const lines = paidLines(cat, id);
  if (!lines.length) return toast('No hay productos «Ya comprado» en este armado.', true);
  paidFound.clear();
  const s = S();
  const row = ({ cat: c, p }) => {
    const now = p.manual ? null : lineCost(p, s).total;
    const inCop = p.paid?.original?.currency === 'COP';
    return `<tr data-cat="${c}" data-id="${p.id}">
      <td><div class="paid-title" title="${esc(p.title)}">${esc(shortTitle(p.title, 60))}</div><small class="paid-origin muted">${esc(paidOrigin(p.paid))}</small></td>
      <td class="r num">${now == null ? '—' : usd(now)}</td>
      <td><div class="paid-amount"><input type="number" step="0.01" min="0" name="amount" value="${p.paid?.original?.amount ?? p.paid?.total ?? ''}" placeholder="${now != null ? now.toFixed(2) : ''}" aria-label="Pagado por ${esc(shortTitle(p.title, 40))}">
        <select name="currency" aria-label="Moneda"><option value="USD" ${inCop ? '' : 'selected'}>US$</option><option value="COP" ${inCop ? 'selected' : ''}>COP</option></select></div></td>
      <td><input type="date" name="date" value="${esc(p.paid?.date || '')}" aria-label="Fecha de compra"></td>
    </tr>`;
  };
  openModal(`
    <div class="m-head"><h2>Precio pagado</h2><button class="btn ghost" data-action="close" aria-label="Cerrar">✕</button></div>
    <form class="m-body" id="paidForm" data-cat="${esc(cat)}" data-id="${esc(id)}">
      <p class="muted" style="margin:0">Total pagado por cada producto, con envío e impuestos. Queda fijo en el total del armado; el precio de Amazon se sigue actualizando para ver si sube o baja.</p>
      ${lines.some(({ p }) => !p.manual && asinOf(p)) ? `<div class="paid-read"><button type="button" class="btn" data-action="paid-read">🧾 Leer de mis pedidos de Amazon</button><span id="paidStatus" class="muted" role="status"></span></div>` : ''}
      <div class="scroll-x"><table class="t paid-table">
        <tr><th>Producto</th><th class="r">Hoy en Amazon</th><th>Pagado</th><th>Fecha</th></tr>
        ${lines.map(row).join('')}
      </table></div>
    </form>
    <div class="m-foot"><button class="btn ghost" data-action="close">Cancelar</button><button class="btn primary" data-action="save-paid">Guardar</button></div>`);
}

function paidStatus(text, err = false) {
  const el = $('#paidStatus');
  if (!el) return;
  el.textContent = text;
  el.className = err ? 'err-t' : 'muted';
}

// Si la factura viene en pesos, se guarda en USD con la TRM de Ajustes y se conserva el valor original.
function paidToUSD(hit) {
  if (hit.currency !== 'COP') return hit;
  const rate = S().trm;
  const conv = (v) => (v == null ? null : +(v / rate).toFixed(2));
  return { ...hit, total: conv(hit.total), price: conv(hit.price), shipping: conv(hit.shipping), importFees: conv(hit.importFees), currency: 'USD', original: { currency: 'COP', amount: hit.total, rate } };
}

async function readPaidFromOrders() {
  const f = $('#paidForm');
  if (!f) return;
  requireSession(); // dentro del clic: abre Amazon si hace falta
  if (connectorOutdated()) return paidStatus(OLD_CONNECTOR, true);
  const lines = paidLines(f.dataset.cat, f.dataset.id).filter(({ p }) => !p.manual && asinOf(p));
  const btn = f.querySelector('[data-action="paid-read"]');
  btn.disabled = true;
  paidStatus(sessionAlive() ? 'Buscando en tus pedidos…' : 'Pulsa el marcador en la pestaña de Amazon: la lectura queda en espera…');
  try {
    const items = [...new Map(lines.map(({ p }) => [asinOf(p), { asin: asinOf(p), query: orderQuery(p.title) }])).values()];
    const r = await requestOrders(items, (done, total) => paidStatus(`Leyendo facturas de tus pedidos: ${done}/${total}…`));
    let found = 0;
    for (const { p } of lines) {
      const tr = f.querySelector(`tr[data-id="${p.id}"]`);
      const hit = findPaid({ asin: asinOf(p), title: p.title }, r.invoices);
      if (!tr) continue;
      if (!hit) { tr.querySelector('.paid-origin').textContent = 'No aparece en tus pedidos de Amazon: escríbelo'; continue; }
      const paid = paidToUSD(hit);
      paidFound.set(p.id, paid);
      found++;
      tr.querySelector('[name="amount"]').value = paid.original?.amount ?? paid.total;
      tr.querySelector('[name="currency"]').value = paid.original ? 'COP' : 'USD';
      tr.querySelector('[name="date"]').value = paid.date || '';
      tr.querySelector('.paid-origin').textContent = paidOrigin(paid);
    }
    paidStatus(`Encontrados ${found} de ${lines.length} (${r.orders} pedidos revisados). Revisa y pulsa «Guardar».`);
  } catch (e) {
    paidStatus(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

function savePaid() {
  const f = $('#paidForm');
  const s = S();
  const at = new Date().toISOString();
  let changed = 0;
  for (const tr of f.querySelectorAll('tr[data-id]')) {
    const p = findP(tr.dataset.cat, tr.dataset.id);
    if (!p) continue;
    const raw = tr.querySelector('[name="amount"]').value.trim();
    const currency = tr.querySelector('[name="currency"]').value;
    const date = tr.querySelector('[name="date"]').value || null;
    const before = JSON.stringify(p.paid ?? null);
    if (raw === '') delete p.paid;
    else {
      const amount = Math.max(0, Number(raw));
      const same = (x) => x && Math.abs((x.original?.amount ?? x.total) - amount) < 0.005 && (x.original ? 'COP' : 'USD') === currency;
      const found = paidFound.get(p.id);
      if (same(found)) p.paid = { ...found, date: date || found.date, at };
      else if (same(p.paid)) p.paid = { ...p.paid, date };
      else p.paid = currency === 'COP'
        ? { total: +(amount / s.trm).toFixed(2), original: { currency: 'COP', amount, rate: s.trm }, date, source: 'manual', at }
        : { total: amount, date, source: 'manual', at };
    }
    if (JSON.stringify(p.paid ?? null) !== before) changed++;
  }
  paidFound.clear();
  closeModal();
  commit();
  toast(changed ? `Precio pagado guardado (${changed}). El total del armado ya no cambia con Amazon.` : 'Sin cambios.');
}

function compareModal(cat) {
  const s = slot(cat);
  const ps = compareList(cat);
  const costs = ps.map((p) => lineCost(p, S()));
  const best = (arr, fn) => { const vals = arr.map(fn).filter((x) => x != null); return vals.length ? Math.min(...vals) : null; };
  const minTotal = best(costs, (c) => c.total);
  const maxRating = Math.max(...ps.map((p) => p.rating || 0));
  const tagKeys = tagFields(ps, cat).map(([k, l]) => [k, l]);
  const row = (label, fn) => `<tr><th>${label}</th>${ps.map((p, i) => `<td>${fn(p, costs[i])}</td>`).join('')}</tr>`;
  // Características (sin repetir el consumo ni las etiquetas de compatibilidad de abajo); la mejor numérica, resaltada.
  const featRows = featuresFor(cat).filter((f) => f.key !== 'watts' && !tagKeys.some(([k]) => k === f.tag)).map((f) => {
    const vals = ps.map((p) => featureValue(f, p, cat));
    if (!vals.some((x) => x != null)) return '';
    const nums = f.type === 'cat' ? [] : vals.filter((x) => x != null);
    const top = new Set(nums).size > 1 ? (f.better === 'low' ? Math.min(...nums) : Math.max(...nums)) : null;
    return `<tr><th>${esc(f.label)}</th>${vals.map((x) => `<td><span class="${x != null && x === top ? 'best' : ''}">${esc(fmtFeature(f, x))}</span></td>`).join('')}</tr>`;
  }).join('');
  openModal(`
    <div class="m-head"><h2>Comparar · ${CAT[cat].name}${ps.length < s.options.length ? ` <span class="muted">(${ps.length} de ${s.options.length}, según tus filtros)</span>` : ''}</h2><button class="btn ghost" data-action="close" aria-label="Cerrar">✕</button></div>
    <div class="m-body"><div class="scroll-x"><table class="t compare">
      ${row('', (p) => `${thumb(p, cat)}<div class="opt-title" style="margin-top:6px">${esc(shortTitle(p.title, 70))}</div>`)}
      ${row('Decisión', (p) => `<span class="${isFixed(p) ? 'best' : 'muted'}" title="${esc(pickOf(p).hint)}">${pickOf(p).stars}</span> ${esc(pickOf(p).short)}`)}
      ${row('Total en CO', (p, c) => `<span class="${c.total === minTotal ? 'best' : ''}">${usd(c.total)}</span>`)}
      ${row('Producto', (p, c) => usd(c.subtotal))}
      ${row('Envío', (p, c) => (c.shipping == null ? '—' : c.shipping === 0 ? 'Gratis' : usd(c.shipping)))}
      ${row('Impuestos import.', (p, c) => `${usd(c.importFees)}${c.feesSource === 'estimado' && c.importFees ? ' (est.)' : ''}`)}
      ${row(`&lt; US$${S().threshold}`, (p, c) => (c.price == null ? '—' : c.overThreshold ? '<span class="chip warn">No</span>' : '<span class="chip ok">Sí</span>'))}
      ${row('Calificación', (p) => (p.rating ? `<span class="${p.rating === maxRating ? 'best' : ''}">★ ${p.rating}</span> <span class="muted">(${(p.reviews || 0).toLocaleString('es-CO')})</span>` : '—'))}
      ${row('Vendedor', (p) => esc(p.manual ? p.store : p.seller || '—'))}
      ${row('Disponibilidad', (p) => esc(p.availability || '—'))}
      ${row('Consumo', (p) => `${estimateWatts(p, cat)} W`)}
      ${featRows}
      ${tagKeys.map(([k, l]) => row(esc(l), (p) => esc(detectTags(p, cat)[k] ?? '—'))).join('')}
      ${row('', (p) => `<button class="btn small ${s.selected.includes(p.id) ? '' : 'primary'}" data-action="select-close" data-cat="${cat}" data-id="${p.id}">${s.selected.includes(p.id) ? 'Elegido ✓' : 'Elegir'}</button>`)}
    </table></div></div>`);
}

function settingsModal() {
  const s = S(), b = build();
  openModal(`
    <div class="m-head"><h2>Ajustes</h2><button class="btn ghost" data-action="close" aria-label="Cerrar">✕</button></div>
    <form class="m-body" id="settingsForm">
      <div class="grid2">
        <label class="field">Presupuesto de este armado (US$)<input type="number" name="budget" value="${b.budget ?? ''}"><small>Solo lo que falta por comprar.</small></label>
        <label class="field">TRM (COP por US$)<input type="number" name="trm" value="${s.trm}"></label>
        <label class="field">Umbral libre de IVA (US$)<input type="number" name="threshold" value="${s.threshold}"><small>Colombia: envíos &lt; US$200 desde EE. UU.</small></label>
        <label class="field">IVA estimado<input type="number" step="0.01" name="iva" value="${s.iva}"><small>Se usa solo si Amazon no da los cargos.</small></label>
        <label class="field">Sales tax Miami<input type="number" step="0.001" name="miamiTax" value="${s.miamiTax ?? DEFAULT_SETTINGS.miamiTax}"><small>Productos con envío a Miami. Miami-Dade: 7 % (6 % Florida + 1 % condado). Amazon no lo muestra en la ficha.</small></label>
        <label class="field">Margen de la fuente<input type="number" step="0.05" name="psuMargin" value="${s.psuMargin}"><small>Fuente recomendada = consumo × margen.</small></label>
        <label class="field">Precio viejo después de (días)<input type="number" name="staleDays" value="${s.staleDays}"></label>
        <label class="field">No re-consultar si se revisó hace menos de (min)<input type="number" min="0" name="refreshMinutes" value="${s.refreshMinutes}"><small>«Actualizar precios» omite esos productos, salvo que les falten datos.</small></label>
      </div>
    </form>
    <div class="m-foot"><button class="btn ghost" data-action="close">Cancelar</button><button class="btn primary" data-action="save-settings">Guardar</button></div>`);
}

function saveSettings() {
  const f = $('#settingsForm');
  const n = (k) => Number(f.elements[k].value);
  store.settings = { trm: n('trm') || 3160, threshold: n('threshold') || 200, iva: n('iva') || 0.19, miamiTax: f.elements.miamiTax.value !== '' ? Math.max(0, n('miamiTax')) : DEFAULT_SETTINGS.miamiTax, psuMargin: n('psuMargin') || 1.3, staleDays: n('staleDays') || 3, refreshMinutes: Number.isFinite(n('refreshMinutes')) && f.elements.refreshMinutes.value !== '' ? Math.max(0, n('refreshMinutes')) : 10 };
  build().budget = n('budget') || null;
  closeModal();
  commit();
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- eventos ----------
document.addEventListener('click', async (e) => {
  const menu = $('#buildMenu');
  if (!e.target.closest('.builds')) menu.hidden = true;
  if (!e.target.closest('.ct')) closeCostTips();
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'FORM') return;
  const { action, cat, id } = el.dataset;
  const b = build();
  switch (action) {
    case 'build-menu': menu.hidden = !menu.hidden; return;
    case 'select': return selectOption(cat, id);
    case 'pick': return setPick(cat, id, Number(el.dataset.level));
    case 'select-close': { const s = slot(cat); if (!s.selected.includes(id)) selectOption(cat, id); closeModal(); return; }
    case 'deselect': slot(cat).selected = slot(cat).selected.filter((x) => x !== id); openCats.add(cat); return commit();
    case 'details': return detailsModal(cat, id);
    case 'refresh': return updateOne(cat, id);
    case 'refresh-modal': await updateOne(cat, id); return detailsModal(cat, id);
    case 'link-amazon': return detailsModal(cat, id, { focusLink: true });
    case 'clear-edits': {
      const p = findP(cat, id);
      delete p.edited;
      closeModal();
      commit();
      return updateOne(cat, id);
    }
    case 'session': return sessionAlive() ? session.win.focus() : openAmazonTab();
    case 'refresh-all': return refreshAll();
    case 'refresh-prices': return refreshPrices();
    case 'cancel-prices': return cancelPrices();
    case 'open-store': {
      const o = pricesRun.origins.get(el.dataset.origin);
      if (o) openStoreTab(el.dataset.origin, o.urls[0]);
      return toast('En la pestaña de la tienda pulsa el marcador «➕ Armador PC». Si dice «abre amazon.com», reinstálalo desde 🔌 Conector.', false, 8000);
    }
    case 'compare': return compareModal(cat);
    case 'opt-clear': setOptView(cat, NO_FILTERS); return render();
    case 'opt-dir': setOptView(cat, { dir: optView(cat).dir === 'asc' ? 'desc' : 'asc' }); return renderOptions(cat);
    case 'add-manual': return manualModal(cat);
    case 'save-manual': return saveManual();
    case 'save-details': return saveDetails();
    case 'paid': return paidModal(cat || '', id || '');
    case 'paid-read': return readPaidFromOrders();
    case 'save-paid': return savePaid();
    case 'connector': return connectorModal();
    case 'connector-ok': localStorage.setItem('pcb-connector-ok', '1'); return closeModal();
    case 'connector-copy': {
      const code = $('#connectorCode').value;
      return navigator.clipboard.writeText(code).then(() => toast('Código copiado. Pégalo como URL del marcador «pcb».'), () => { $('#connectorCode').select(); toast('No pude copiar: mantén presionado el texto de abajo y cópialo.', true); });
    }
    case 'search-amazon': {
      // Búsqueda en otra pestaña (la de la sesión no se toca). En la ficha elegida, el marcador ofrece agregarla.
      const q = el.closest('form').url.value.trim();
      const search = `/s?k=${encodeURIComponent(!extractAsin(q) && q ? q : CAT[cat].name)}`;
      window.open(IS_MOBILE ? `/amazon.html#${search}` : `https://www.amazon.com${search}`, '_blank');
      return toast('En la ficha del producto pulsa el marcador «➕ Armador PC» y elige la categoría.', false, 6000);
    }
    case 'settings': return settingsModal();
    case 'save-settings': return saveSettings();
    case 'close': return closeModal();
    case 'minimize-changes': return minimizeChangesModal();
    case 'restore-changes': return restoreChangesModal();
    case 'close-changes': return closeChangesModal();
    case 'delete': {
      const p = findP(cat, id);
      if (!confirm(`¿Eliminar "${shortTitle(p.title, 60)}" de las opciones?`)) return;
      const s = slot(cat);
      s.options = s.options.filter((o) => o.id !== id);
      s.selected = s.selected.filter((x) => x !== id);
      closeModal();
      return commit();
    }
    case 'cost-tip': {
      const open = el.getAttribute('aria-expanded') !== 'true';
      closeCostTips(el);
      el.setAttribute('aria-expanded', String(open));
      el.nextElementSibling.hidden = !open;
      return;
    }
    case 'side-open': {
      const d = $(`details[data-acc="${el.dataset.acc}"]`);
      if (!d) return;
      d.open = true;
      d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    case 'goto': {
      if (!cat) return;
      const sec = $(`#cat-${cat}`);
      sec?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      sec?.classList.remove('flash'); void sec?.offsetWidth; sec?.classList.add('flash');
      return;
    }
    case 'build-new': {
      menu.hidden = true;
      const name = prompt('Nombre del nuevo armado:', 'Nuevo armado');
      if (!name) return;
      const nb = { id: uid('b'), name, budget: null, createdAt: new Date().toISOString(), parts: Object.fromEntries(CATEGORIES.map((c) => [c.key, { options: [], selected: [] }])) };
      store.builds.push(nb); store.activeBuildId = nb.id; return commit();
    }
    case 'build-dup': {
      menu.hidden = true;
      const nb = structuredClone(b);
      nb.id = uid('b'); nb.name = `${b.name} (copia)`; nb.createdAt = new Date().toISOString();
      store.builds.push(nb); store.activeBuildId = nb.id; toast('Armado duplicado: prueba otras piezas sin perder el original.'); return commit();
    }
    case 'build-rename': {
      menu.hidden = true;
      const name = prompt('Nuevo nombre:', b.name);
      if (name) { b.name = name; commit(); }
      return;
    }
    case 'build-delete': {
      menu.hidden = true;
      if (store.builds.length === 1) return toast('Debe quedar al menos un armado.', true);
      if (!confirm(`¿Eliminar el armado "${b.name}"?`)) return;
      store.builds = store.builds.filter((x) => x.id !== b.id); store.activeBuildId = store.builds[0].id; return commit();
    }
    case 'export-md': {
      menu.hidden = true;
      const md = toMarkdown(b, S());
      try { await navigator.clipboard.writeText(md); toast('Markdown copiado al portapapeles'); } catch { /* sin permiso de portapapeles */ }
      return openModal(`<div class="m-head"><h2>Markdown</h2><button class="btn ghost" data-action="close">✕</button></div><div class="m-body"><pre class="md">${esc(md)}</pre></div>`);
    }
    case 'export-json': menu.hidden = true; return download(`${b.name.replace(/[^\w-]+/g, '_')}.json`, JSON.stringify({ type: 'pc-build', build: b, settings: store.settings }, null, 1), 'application/json');
    case 'import-json': menu.hidden = true; return $('#importFile').click();
    case 'reset-seed': {
      menu.hidden = true;
      if (!confirm('Esto reemplaza todos tus armados por los datos de ejemplo. ¿Continuar?')) return;
      store = await (await fetch('/api/store/reset', { method: 'POST' })).json();
      return commit();
    }
  }
});

document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-action="add-url"]');
  if (!f) return;
  e.preventDefault();
  addFromUrl(f.dataset.cat, f.url.value, f);
});

// Ordenar y filtrar opciones: el buscador y el tope de precio al escribir; listas y casilla al cambiar.
function onViewChange(el) {
  const { cat, view, feat } = el.dataset;
  if (feat) {
    const feats = { ...optView(cat).feats };
    if (el.value === '') delete feats[feat]; else feats[feat] = el.value;
    setOptView(cat, { feats });
  } else if (view === 'sort') setOptView(cat, { sort: el.value, dir: sortsFor(cat).find((o) => o.key === el.value)?.dir }); // cada criterio con su sentido natural
  else setOptView(cat, { [view]: el.type === 'checkbox' ? el.checked : el.value });
  renderOptions(cat);
}
document.addEventListener('input', (e) => { if (e.target.matches?.('input[data-view]:not([type="checkbox"])')) onViewChange(e.target); });
document.addEventListener('change', (e) => { if (e.target.matches?.('select[data-view], input[type="checkbox"][data-view]')) onViewChange(e.target); });

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector('.ct-btn[aria-expanded="true"]');
  if (open) { closeCostTips(); open.focus(); }
});

document.addEventListener('toggle', (e) => {
  if (e.target.matches?.('details.acc')) return toggleSide(e.target.dataset.acc, e.target.open);
  if (!e.target.matches?.('details.options')) return;
  const cat = e.target.dataset.cat;
  if (e.target.open) openCats.add(cat); else openCats.delete(cat);
}, true);

$('#rig').addEventListener('click', (e) => {
  const g = e.target.closest('.part');
  if (!g) return;
  const sec = $(`#cat-${g.dataset.cat}`);
  sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  sec.classList.remove('flash'); void sec.offsetWidth; sec.classList.add('flash');
});

$('#buildSel').addEventListener('change', (e) => { store.activeBuildId = e.target.value; commit(); });

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const b = data.build || data;
    if (!b.parts) throw new Error('El archivo no parece un armado');
    b.id = uid('b');
    b.name = b.name ? `${b.name} (importado)` : 'Armado importado';
    for (const c of CATEGORIES) b.parts[c.key] ||= { options: [], selected: [] };
    store.builds.push(b);
    store.activeBuildId = b.id;
    commit();
    toast('Armado importado');
  } catch (err) { toast(`No pude importar: ${err.message}`, true); }
});

modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
changesModal.addEventListener('cancel', (e) => { e.preventDefault(); minimizeChangesModal(); });
changesModal.addEventListener('click', (e) => { if (e.target === changesModal) minimizeChangesModal(); });

await loadStore();
render();
await handleHashPayload();
