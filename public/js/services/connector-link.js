// @ts-check
// Enlace con el conector (marcador) por window.postMessage. Protocolo en js/connector/connector.src.js:
//   Amazon:  pcb:fetch {id, asin} → pcb:data {id, product} | pcb:error {id, error}
//            pcb:orders {id, items} → pcb:orders-progress | pcb:orders-data | pcb:orders-error
//   Tiendas: pcb:price {id, url} → pcb:price-data {id, data} | pcb:price-error {id, error}
//   Ambos:   pcb:hello {version, …} (latido cada 4 s) · pcb:add {cat, product} (agregar desde la ficha)
// Lo pedido sin conexión queda en espera y sale al conectar. Si la pestaña se cierra, lo enviado vuelve a la espera;
// si el conector deja de responder, falla con la instrucción para destrabarlo.
import { regionOf } from '../connector/amazon-parse.js';
import { storeOfHost } from '../connector/store-parse.js';

const AMAZON_ORIGINS = ['https://www.amazon.com', 'https://amazon.com', 'https://smile.amazon.com'];
const STALL_MS = 90000;
const PRICE_TIMEOUT_MS = 60000;
const ORDERS_TIMEOUT_MS = 5 * 60000;
export const IS_MOBILE = /Android|iPhone|iPad/i.test(navigator.userAgent);

const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const subs = new Set();
const notify = () => subs.forEach((fn) => fn());
export const onLinkChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };

export const amazon = { win: /** @type {Window|null} */ (null), origin: '', connected: false, version: null, loggedIn: null, deliverTo: '', region: /** @type {'co'|'us'|null} */ (null), lastMsg: 0 };
/** origen → { win, connected, version, merchant } */
export const tabs = new Map();
export let appConnectorVersion = null;
export const setAppConnectorVersion = (v) => { appConnectorVersion = v; notify(); };
export const outdated = () => !!appConnectorVersion && !!amazon.version && amazon.version !== appConnectorVersion;

const jobs = new Map(); // id → { kind, asin|url, origin, resolve, reject, sent, timer, onProgress }
let addHandler = (msg, source) => {};
export const onAdd = (fn) => { addHandler = fn; };

export const amazonAlive = () => amazon.connected && !!amazon.win && !amazon.win.closed;
export const tabAlive = (origin) => { const t = tabs.get(origin); return !!t?.connected && !!t.win && !t.win.closed; };
export function pendingCount(channel) {
  let n = 0;
  for (const j of jobs.values()) if ((channel === 'amazon' ? j.kind !== 'price' : j.origin === channel)) n++;
  return n;
}

/** Abre (o enfoca) Amazon. Solo dentro de un clic (bloqueo de ventanas emergentes). */
export function openAmazon(path = '/') {
  if (amazon.win && !amazon.win.closed) { amazon.win.focus(); return amazon.win; }
  amazon.win = window.open(IS_MOBILE ? `/amazon.html#${path}` : `https://www.amazon.com${path}`, 'pcb-amazon');
  notify();
  return amazon.win;
}
/** Abre (o enfoca) la pestaña de una tienda en uno de sus enlaces. Solo dentro de un clic. */
export function openTab(origin, url) {
  const t = tabs.get(origin);
  if (t?.win && !t.win.closed) { t.win.focus(); return; }
  const win = window.open(url, `pcb-${new URL(origin).hostname}`);
  tabs.set(origin, { win, connected: false, version: null, merchant: storeOfHost(new URL(origin).hostname) });
  notify();
}

function post(win, origin, msg) { try { win?.postMessage(msg, origin); return true; } catch { return false; } }

function dispatch(job) {
  if (job.kind === 'price') {
    if (!tabAlive(job.origin)) return;
    clearTimeout(job.timer);
    job.timer = setTimeout(() => finish(job.id, null, 'La tienda no respondió a tiempo: recarga su pestaña y pulsa de nuevo el marcador.'), PRICE_TIMEOUT_MS);
    job.sent = post(tabs.get(job.origin).win, job.origin, { type: 'pcb:price', id: job.id, url: job.url });
    return;
  }
  if (!amazonAlive()) return;
  if (job.kind === 'orders' && outdated()) return finish(job.id, null, 'Tu marcador es de una versión anterior: reinstálalo desde Ajustes → Conector para leer tus pedidos.');
  job.sent = post(amazon.win, amazon.origin, job.kind === 'fetch' ? { type: 'pcb:fetch', id: job.id, asin: job.asin } : { type: 'pcb:orders', id: job.id, items: job.items });
}

function finish(id, data, error) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  clearTimeout(job.timer);
  if (error) job.reject(new Error(error)); else job.resolve(data);
  notify();
}

function enqueue(job) {
  return new Promise((resolve, reject) => {
    Object.assign(job, { id: uid(job.kind[0]), resolve, reject, sent: false, timer: 0 });
    if (job.kind === 'orders') job.timer = setTimeout(() => finish(job.id, null, 'Leer tus pedidos tardó demasiado. Reintenta.'), ORDERS_TIMEOUT_MS);
    jobs.set(job.id, job);
    dispatch(job);
    notify();
  });
}
export const requestAsin = (asin) => enqueue({ kind: 'fetch', asin });
export const requestPrice = (url) => enqueue({ kind: 'price', url, origin: new URL(url).origin });
export const requestOrders = (items, onProgress) => enqueue({ kind: 'orders', items, onProgress });

/** Cancela lo que aún no se envió (o todo, con all). */
export function cancelPending({ all = false } = {}) {
  for (const j of [...jobs.values()]) if (all || !j.sent) finish(j.id, null, 'Cancelado');
}

addEventListener('message', (e) => {
  const m = e.data || {};
  if (typeof m.type !== 'string' || !m.type.startsWith('pcb:')) return;
  const isAmazon = AMAZON_ORIGINS.includes(e.origin);
  const isTab = (() => { try { const u = new URL(e.origin); return u.protocol === 'https:' && !!storeOfHost(u.hostname); } catch { return false; } })();
  if (!isAmazon && !isTab) return;
  const win = /** @type {Window} */ (e.source);
  if (isAmazon) amazon.lastMsg = Date.now();
  if (m.type === 'pcb:hello') {
    if (isAmazon) {
      const was = amazonAlive();
      Object.assign(amazon, { win, origin: e.origin, connected: true, version: m.version || null, loggedIn: !!m.loggedIn, deliverTo: String(m.deliverTo || ''), region: regionOf(String(m.deliverTo || '')) || null });
      if (!was) for (const j of jobs.values()) if (j.kind !== 'price' && !j.sent) dispatch(j);
    } else {
      const was = tabAlive(e.origin);
      tabs.set(e.origin, { win, connected: true, version: m.version || null, merchant: m.store || storeOfHost(new URL(e.origin).hostname) });
      if (!was) for (const j of jobs.values()) if (j.kind === 'price' && j.origin === e.origin && !j.sent) dispatch(j);
    }
    notify();
    return;
  }
  const job = jobs.get(m.id);
  if (m.type === 'pcb:add') return addHandler(m, { win, origin: e.origin });
  if (!job) return;
  // Solo responde la pestaña a la que se le pidió.
  if (job.kind === 'price' && e.origin !== job.origin) return;
  if (job.kind !== 'price' && !isAmazon) return;
  if (m.type === 'pcb:data' || m.type === 'pcb:price-data' || m.type === 'pcb:orders-data') finish(m.id, m.type === 'pcb:data' ? m.product : m.type === 'pcb:price-data' ? m.data : m, null);
  else if (m.type === 'pcb:error' || m.type === 'pcb:price-error' || m.type === 'pcb:orders-error') finish(m.id, null, m.error || 'Error del conector');
  else if (m.type === 'pcb:orders-progress') job.onProgress?.(m.done, m.total);
});

// Vigilancia: pestañas cerradas → lo enviado vuelve a la espera; Amazon sin noticias → lo enviado falla.
setInterval(() => {
  let changed = false;
  if (amazon.connected && (!amazon.win || amazon.win.closed)) {
    amazon.connected = false; changed = true;
    for (const j of jobs.values()) if (j.kind !== 'price' && j.sent) j.sent = false;
  } else if (amazonAlive() && Date.now() - amazon.lastMsg > STALL_MS) {
    for (const j of [...jobs.values()]) if (j.kind === 'fetch' && j.sent) finish(j.id, null, 'El conector no respondió. Recarga la pestaña de Amazon y pulsa de nuevo el marcador.');
    amazon.lastMsg = Date.now();
  }
  for (const [origin, t] of tabs) {
    if (!t.connected || (t.win && !t.win.closed)) continue;
    t.connected = false; changed = true;
    for (const j of jobs.values()) if (j.origin === origin && j.sent) { j.sent = false; clearTimeout(j.timer); }
  }
  if (changed) notify();
}, 3000);

/** Destino de la sesión de Amazon como tienda: 'amazon-co' | 'amazon-us' | null. */
export const amazonStoreNow = () => (amazonAlive() ? (amazon.region === 'co' ? 'amazon-co' : amazon.region === 'us' ? 'amazon-us' : null) : null);
