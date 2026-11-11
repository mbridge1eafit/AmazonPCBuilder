// @ts-check
// Enlace con el conector. Dos transportes, mismo protocolo hacia arriba (refresh.js, actions.js):
//   · Extensión de Chrome (escritorio): mensajes con extension/bridge.js por window.postMessage (mismo origen);
//     el service worker (extension/router.js) enruta cada pedido a la pestaña de su canal (un origen por tienda,
//     todo amazon.com es uno) y publica el estado real de cada canal: conectado, abriendo, sin respuesta, verificado.
//     Si la tienda o el armador se recargan, todo reconecta solo y lo pendiente se reenvía.
//   · Marcador (respaldo, p. ej. Android): window.postMessage con la pestaña que el usuario abrió y donde pulsó el
//     marcador. Protocolo en js/connector/connector.src.js:
//       Amazon:  pcb:fetch {id, asin} → pcb:data {id, product} | pcb:error {id, error}
//                pcb:orders {id, items} → pcb:orders-progress | pcb:orders-data | pcb:orders-error
//       Tiendas: pcb:price {id, url} → pcb:price-data {id, data} | pcb:price-error {id, error}
//       Ambos:   pcb:hello {version, …} (latido cada 4 s) · pcb:add {cat, product} (agregar desde la ficha)
// Lo pedido sin conexión queda en espera y sale al conectar.
import { regionOf } from '../connector/amazon-parse.js';
import { storeOfHost } from '../connector/store-parse.js';

export const AMAZON_ORIGIN = 'https://www.amazon.com';
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
/** Marcador: origen → { win, connected, version, merchant } */
export const tabs = new Map();
export let appConnectorVersion = null;
export const setAppConnectorVersion = (v) => { appConnectorVersion = v; notify(); };

/**
 * Extensión: present = se detectó alguna vez en esta pestaña (desde ahí manda sobre el marcador);
 * ready = el puente está conectado ahora; channels = estado de cada canal según el service worker.
 * @type {{ present: boolean, ready: boolean, extVersion: string|null, channels: Map<string, any>, lostAt: number }}
 */
export const ext = { present: false, ready: false, extVersion: null, channels: new Map(), lostAt: 0 };
const toExt = (msg) => window.postMessage({ pcbExt: 'to', msg }, location.origin);

/** Versión del conector que reportan las pestañas (extensión) o el marcador de Amazon. */
function installedVersions() {
  if (!ext.present) return amazon.version ? [amazon.version] : [];
  return [...new Set([...ext.channels.values()].filter((c) => c.state === 'connected' && c.version).map((c) => c.version))];
}
export const outdated = () => !!appConnectorVersion && installedVersions().some((v) => v !== appConnectorVersion);

const jobs = new Map(); // id → { kind, asin|url|items, origin, resolve, reject, sent, timer, onProgress }
let addHandler = (msg, reply) => {};
/** fn(msg, reply(text)) al agregar un producto desde la ficha de Amazon. */
export const onAdd = (fn) => { addHandler = fn; };

export const amazonAlive = () => (ext.present ? ext.channels.get(AMAZON_ORIGIN)?.state === 'connected' : amazon.connected && !!amazon.win && !amazon.win.closed);
export const tabAlive = (origin) => {
  if (ext.present) return ext.channels.get(origin)?.state === 'connected';
  const t = tabs.get(origin);
  return !!t?.connected && !!t.win && !t.win.closed;
};
export function pendingCount(channel) {
  let n = 0;
  for (const j of jobs.values()) if ((channel === 'amazon' ? j.kind !== 'price' : j.origin === channel)) n++;
  return n;
}

/**
 * Estado de un canal para la interfaz.
 * state: 'no-ext' (sin extensión: modo marcador) | 'ext-off' (extensión reconectando) | 'none' | 'opening' | 'stuck' | 'connected'
 * @param {string} origin
 */
export function channelStatus(origin) {
  if (!ext.present) return { origin, state: tabAlive(origin) || (origin === AMAZON_ORIGIN && amazonAlive()) ? 'connected' : 'no-ext' };
  if (!ext.ready) return { origin, state: 'ext-off' };
  return ext.channels.get(origin) || { origin, state: 'none', queued: 0, running: 0 };
}
/** Canales que la extensión conoce ahora (con pestaña, abriéndose, con trabajos o verificados). */
export const knownChannels = () => [...ext.channels.keys()];

/** Conecta un canal: enfoca su pestaña, adopta una ya abierta o abre una (en segundo plano si active = false). */
export function connectChannel(origin, { url = '', active = false } = {}) {
  if (ext.present) return toExt({ type: 'connect', origin, url, active });
  if (origin === AMAZON_ORIGIN) return openAmazon();
  return openTab(origin, url || `${origin}/`);
}
/** Prueba real del canal: la pestaña descarga la portada de la tienda con tu sesión. */
export const verifyChannel = (origin) => toExt({ type: 'verify', origin });
export const focusChannel = (origin) => toExt({ type: 'focus', origin });
/** Recarga la extensión (relee extension/connector.js del disco tras un cambio del conector). */
export const reloadExtension = () => toExt({ type: 'reload' });

/** Abre (o enfoca) Amazon. Con el marcador, solo dentro de un clic (bloqueo de ventanas emergentes). */
export function openAmazon(path = '/') {
  if (ext.present) return toExt({ type: 'connect', origin: AMAZON_ORIGIN, url: `${AMAZON_ORIGIN}${path}`, active: true, newTab: path !== '/' });
  if (amazon.win && !amazon.win.closed) { amazon.win.focus(); return amazon.win; }
  amazon.win = window.open(IS_MOBILE ? `/amazon.html#${path}` : `${AMAZON_ORIGIN}${path}`, 'pcb-amazon');
  notify();
  return amazon.win;
}
/** Abre (o enfoca) la pestaña de una tienda en uno de sus enlaces. Con el marcador, solo dentro de un clic. */
export function openTab(origin, url) {
  if (ext.present) return toExt({ type: 'connect', origin, url, active: true });
  const t = tabs.get(origin);
  if (t?.win && !t.win.closed) { t.win.focus(); return; }
  const win = window.open(url, `pcb-${new URL(origin).hostname}`);
  tabs.set(origin, { win, connected: false, version: null, merchant: storeOfHost(new URL(origin).hostname) });
  notify();
}

function post(win, origin, msg) { try { win?.postMessage(msg, origin); return true; } catch { return false; } }

function dispatch(job) {
  if (ext.present) {
    if (!ext.ready) return;
    if (job.kind === 'orders' && outdated()) return finish(job.id, null, 'La extensión tiene un conector anterior: pulsa «Recargar extensión» en Ajustes → Conector.');
    toExt({ type: 'job', id: job.id, kind: job.kind, asin: job.asin, url: job.url, items: job.items });
    job.sent = true;
    return;
  }
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
    if (job.kind === 'orders') job.timer = setTimeout(() => finish(job.id, null, 'Leer tus pedidos tardó demasiado. Reintenta.'), ORDERS_TIMEOUT_MS + 30000);
    jobs.set(job.id, job);
    dispatch(job);
    notify();
  });
}
export const requestAsin = (asin) => enqueue({ kind: 'fetch', asin, origin: AMAZON_ORIGIN });
export const requestPrice = (url) => enqueue({ kind: 'price', url, origin: new URL(url).origin });
export const requestOrders = (items, onProgress) => enqueue({ kind: 'orders', items, onProgress, origin: AMAZON_ORIGIN });

/** Cancela lo que aún no se envió (o todo, con all). Con la extensión, lo encolado en el service worker también. */
export function cancelPending({ all = false } = {}) {
  for (const j of [...jobs.values()]) {
    if (!all && j.sent && !ext.present) continue;
    if (ext.present && j.sent) {
      const ch = ext.channels.get(j.origin);
      if (!all && ch?.state === 'connected') continue; // ya lo está leyendo la pestaña
      toExt({ type: 'cancel', id: j.id });
    }
    finish(j.id, null, 'Cancelado');
  }
}

// ---------- extensión ----------
function syncAmazonFromExt() {
  const c = ext.channels.get(AMAZON_ORIGIN);
  const up = c?.state === 'connected';
  const deliverTo = String(c?.deliverTo || c?.check?.deliverTo || ''); // el saludo se repite al verificar y al recargar: es lo más nuevo
  Object.assign(amazon, {
    connected: up, origin: up ? AMAZON_ORIGIN : '', version: up ? c.version || null : null,
    loggedIn: up ? (c.loggedIn ?? c.check?.loggedIn ?? null) : null, deliverTo: up ? deliverTo : '', region: up ? regionOf(deliverTo) || null : null,
  });
}
function onExtMessage(m) {
  switch (m?.type) {
    case 'ext-ready': {
      const was = ext.ready;
      Object.assign(ext, { present: true, ready: true, extVersion: m.extVersion || null });
      if (!was) {
        // Primera conexión o el service worker se reinició: lo pendiente se (re)envía; el service worker deduplica por id.
        for (const j of jobs.values()) { j.sent = false; dispatch(j); }
        toExt({ type: 'status' });
      }
      break;
    }
    case 'ext-lost':
      ext.ready = false;
      ext.lostAt = Date.now();
      break;
    case 'status':
      ext.channels = new Map((m.channels || []).map((c) => [c.origin, c]));
      if (m.extVersion) ext.extVersion = m.extVersion;
      syncAmazonFromExt();
      break;
    case 'result':
      finish(m.id, m.ok ? m.data : null, m.ok ? null : (m.error || 'Error del conector'));
      return;
    case 'progress':
      jobs.get(m.id)?.onProgress?.(m.done, m.total);
      return;
    case 'add':
      addHandler(m, (text) => toExt({ type: 'ack', addId: m.addId, text }));
      return;
    default:
      return;
  }
  notify();
}

addEventListener('message', (e) => {
  const m = e.data || {};
  // Extensión: el puente comparte la ventana del armador.
  if (e.source === window && e.origin === location.origin && m.pcbExt === 'from') return onExtMessage(m.msg);
  if (typeof m.type !== 'string' || !m.type.startsWith('pcb:')) return;
  const isAmazon = AMAZON_ORIGINS.includes(e.origin);
  const isTab = (() => { try { const u = new URL(e.origin); return u.protocol === 'https:' && !!storeOfHost(u.hostname); } catch { return false; } })();
  if (!isAmazon && !isTab) return;
  const win = /** @type {Window} */ (e.source);
  if (m.type === 'pcb:add') return addHandler(m, (text) => post(win, e.origin, { type: 'pcb:ack', text }));
  if (ext.present) return; // con la extensión, el marcador no se usa
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
  if (!job) return;
  // Solo responde la pestaña a la que se le pidió.
  if (job.kind === 'price' && e.origin !== job.origin) return;
  if (job.kind !== 'price' && !isAmazon) return;
  if (m.type === 'pcb:data' || m.type === 'pcb:price-data' || m.type === 'pcb:orders-data') finish(m.id, m.type === 'pcb:data' ? m.product : m.type === 'pcb:price-data' ? m.data : m, null);
  else if (m.type === 'pcb:error' || m.type === 'pcb:price-error' || m.type === 'pcb:orders-error') finish(m.id, null, m.error || 'Error del conector');
  else if (m.type === 'pcb:orders-progress') job.onProgress?.(m.done, m.total);
});
// El puente pudo anunciarse antes de que cargara este módulo.
toExt({ type: 'probe' });

// Vigilancia (solo marcador): pestañas cerradas → lo enviado vuelve a la espera; Amazon sin noticias → lo enviado falla.
setInterval(() => {
  if (ext.present) {
    // Cambia «abriendo» → «sin respuesta» sin esperar otro mensaje del service worker.
    if ([...ext.channels.values()].some((c) => c.state === 'opening')) toExt({ type: 'status' });
    return;
  }
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
