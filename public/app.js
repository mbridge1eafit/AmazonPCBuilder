import { CATEGORIES, CAT, STATUS, PICKS, PICK_FIXED, pickLevel, pickOf, isFixed, sortByPick, DEFAULT_SETTINGS, detectTags, estimateWatts, wattsIsGuess, BASE_WATTS, selectedLines, lineCost, totals, checks, shortTitle, toMarkdown, missingFields, needsRefresh, applySession, applyEdits, EDITABLE_FIELDS, editedLabels } from './logic.js';
import { extractAsin } from './amazon-parse.js';
import { ICONS, RIG } from './icons.js';

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

function linkSession(win, origin, info) {
  const wasAlive = sessionAlive();
  Object.assign(session, { win, origin, connected: true, version: info.version, loggedIn: info.loggedIn, deliverTo: info.deliverTo || '', lastMsg: Date.now() });
  try { win.postMessage({ type: 'pcb:welcome' }, origin); } catch { /* cerrada */ }
  if (!wasAlive) {
    toast(`Amazon conectado con tu sesión${info.deliverTo ? ` (entrega: ${info.deliverTo})` : ''}.`);
    if (connectorVersion && info.version !== connectorVersion) toast('Tu marcador «➕ Armador PC» es de una versión anterior. Reinstálalo desde 🔌 Conector.', true, 10000);
    if (!info.loggedIn) toast('El conector no detecta sesión iniciada en Amazon: los envíos y cargos pueden no ser los de tu cuenta.', true, 8000);
    for (const job of jobs.values()) if (!job.sent) dispatch(job); // lo pedido antes de conectar
  }
  renderSession();
}

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

const PRODUCT_KEYS = ['asin', 'url', 'title', 'image', 'brand', 'deliverTo', 'price', 'currency', 'shipping', 'importFees', 'importFeesInfo', 'total', 'seller', 'shipsFrom', 'availability', 'shipsToCO', 'locationOk', 'rating', 'reviews', 'hasBuybox', 'condition', 'priceSource', 'loggedIn', 'fetchedAt', 'specs', 'bullets', 'offers', 'debug'];
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
  return p;
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
const productsByAsin = (asin) => store.builds.flatMap((b) => Object.values(b.parts).flatMap((s) => s.options)).filter((p) => asinOf(p) === asin);

// Pide a la sesión una lista de ASIN (sin duplicados) y reescribe cada producto al llegar su ficha.
async function updateAsins(asins) {
  const list = [...new Set(asins.filter(Boolean))];
  const r = { ok: 0, failed: 0, changed: 0, errors: [], kept: new Set(), replaced: new Set() };
  list.forEach((a) => busyAsins.add(a));
  scheduleRender();
  await Promise.all(list.map(async (asin) => {
    try {
      const d = toUSD(sanitizeIncoming(await sendJob(asin)));
      for (const p of productsByAsin(asin)) {
        const before = p.price;
        const res = applySession(p, structuredClone(d));
        res.keptEdits.forEach((k) => r.kept.add(k));
        res.replacedEdits.forEach((k) => r.replaced.add(k));
        if (res.keptEdits.length) r.keptProducts = (r.keptProducts || 0) + 1;
        if (res.replacedEdits.length) r.replacedProducts = (r.replacedProducts || 0) + 1;
        if (before != null && before !== p.price) r.changed++;
      }
      r.ok++;
    } catch (e) {
      r.failed++;
      r.errors.push(e.message);
    } finally {
      busyAsins.delete(asin);
      progress.done++;
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
  if (r.kept.size) return toast(`Amazon no mostró un precio con envío a Colombia: se conservaron tus ediciones (${editedLabels([...r.kept])}).`, false, 8000);
  if (r.replaced.size) return toast(`Tu sesión encontró precio con envío a Colombia (${usd(p.price)}): se reemplazaron tus ediciones (${editedLabels([...r.replaced])}).`, false, 8000);
  const miss = missingFields(p);
  toast(before != null && p.price !== before ? `Precio cambió: ${usd(before)} → ${usd(p.price)}` : miss.length ? `Actualizado; Amazon no mostró: ${miss.join(', ')}` : 'Actualizado con tu sesión');
}

// Productos de Amazon del armado activo (cualquier estado, incluidos los comprados).
function refreshQueue() {
  const s = S();
  const all = CATEGORIES.flatMap((c) => slot(c.key).options.filter((p) => asinOf(p)).map((p) => ({ cat: c.key, p })));
  const todo = all.filter(({ p }) => needsRefresh(p, s));
  return { all, todo };
}

async function refreshAll() {
  if (refreshing) return;
  const s = S();
  const { all, todo } = refreshQueue();
  if (!all.length) return toast('No hay productos con enlace de Amazon para actualizar.');
  if (!todo.length) return toast(`Todo al día: ${all.length} productos leídos con tu sesión hace menos de ${s.refreshMinutes} min y completos.`);
  requireSession();
  refreshing = true;
  // Lo marcado con más estrellas se lee primero: los precios que de verdad vas a pagar llegan antes.
  const asins = [...new Set(sortByPick(todo.map(({ p }) => p)).map((p) => asinOf(p)))];
  Object.assign(progress, { done: 0, total: asins.length });
  const r = await updateAsins(asins);
  refreshing = false;
  render();
  const skipped = all.length - todo.length;
  const incomplete = refreshQueue().all.filter(({ p }) => missingFields(p).length).length;
  toast([`Actualizados ${r.ok}/${asins.length} con tu sesión`, skipped && `${skipped} omitidos (leídos hace < ${s.refreshMinutes} min)`, `${r.changed} cambiaron de precio`, r.keptProducts && `${r.keptProducts} con ediciones conservadas (sin precio con envío a Colombia)`, r.replacedProducts && `${r.replacedProducts} con ediciones reemplazadas por Amazon`, r.failed && `${r.failed} con error: ${r.errors[0]}`, incomplete && `${incomplete} con datos que Amazon no muestra`].filter(Boolean).join(' · '), !!r.failed, 8000);
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
  for (const p of productsByAsin(d.asin)) applySession(p, structuredClone(d));
  const text = existing ? `Actualizado con tu sesión (${CAT[cat].name})` : `Agregado a ${CAT[cat].name}`;
  openCats.add(cat);
  commit();
  toast(`${text}: ${shortTitle(d.title, 40)}`);
  $(`#cat-${cat}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return text;
}

// Mensajes del conector.
window.addEventListener('message', (e) => {
  if (!AMAZON_ORIGINS.includes(e.origin)) return;
  const m = e.data || {};
  if (e.source === session.win) session.lastMsg = Date.now();
  if (m.type === 'pcb:hello') return linkSession(e.source, e.origin, m);
  if (m.type === 'pcb:data') return finishJob(m.id, m.product);
  if (m.type === 'pcb:error') return finishJob(m.id, null, m.error || 'Error del conector');
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
const FEES_SRC = { amazon: 'según Amazon', estimado: 'estimado', editado: 'editado a mano', local: 'incluidos en el precio' };
function costRows(p, c, s = S()) {
  const ship = c.shipping == null ? (p.manual ? 'No aplica' : '<span class="warn-t">Por confirmar</span>') : c.shipping === 0 ? '<span class="ok-t">Gratis</span>' : usd(c.shipping);
  const fees = c.feesSource === 'local' ? 'Incluidos' : c.importFees === 0 ? '<span class="ok-t">US$0.00</span>' : usd(c.importFees);
  const feesNote = c.feesSource === 'estimado' && c.importFees ? `IVA ${Math.round(s.iva * 100)}% estimado` : FEES_SRC[c.feesSource] || '';
  const caveat = costCaveat(p, c);
  return `<dl class="cost-rows">
      <dt>Producto${c.qty > 1 ? ` (${c.qty} × ${usd(c.price)})` : ''}</dt><dd>${usd(c.subtotal)}</dd>
      <dt>Envío a Colombia</dt><dd>${ship}</dd>
      <dt>Impuestos de importación${feesNote ? `<small>${esc(feesNote)}</small>` : ''}</dt><dd>${fees}</dd>
      <dt class="cost-total">Total en Colombia</dt><dd class="cost-total">${usd(c.total)}</dd>
    </dl>
    <div class="cost-cop">≈ ${p.displayed?.total != null && c.qty === 1 ? `${copAmazon(p.displayed.total)} según Amazon` : cop(c.total)}</div>
    ${caveat ? `<div class="cost-caveat">${esc(caveat)}</div>` : ''}`;
}
// Lo que falta para que el total sea definitivo (si algo falta, el total es parcial).
function costCaveat(p, c) {
  if (p.manual) return '';
  if (c.shipping == null) return 'Amazon no mostró el envío a Colombia: el total puede subir.';
  if (p.importFeesInfo === 'no-informado') return 'Vendedor externo: Amazon no cobra los impuestos; se pagarían en aduana.';
  return '';
}
function costTip(p, c, { fmt = money, cls = '' } = {}) {
  if (c.total == null) return `<b class="num muted ${cls}">—</b>`;
  const partial = !!costCaveat(p, c);
  return `<span class="ct ${cls}">
    <button type="button" class="ct-btn num ${partial ? 'partial' : ''}" data-action="cost-tip" aria-expanded="false"
      aria-label="${fmt(c.total)} en Colombia${partial ? ' (parcial)' : ''}: ver desglose">${fmt(c.total)}${partial ? '<sup>*</sup>' : ''}</button>
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
  const feesTitle = { amazon: 'Cargos de importación que muestra Amazon', estimado: `IVA estimado (${Math.round(s.iva * 100)}%) porque el pedido supera US$${s.threshold}`, editado: 'Editado a mano', local: 'Compra local: impuestos incluidos en el precio' }[c.feesSource] || '';
  const facts = [];
  if (c.price != null) {
    if (qty > 1) facts.push(`${qty} × ${money(c.price)}`);
    facts.push(c.shipping == null ? (p.manual ? '' : '<span class="warn-t" title="Amazon no mostró el envío a Colombia">Envío por confirmar</span>')
      : c.shipping === 0 ? '<span class="ok-t">Envío gratis</span>' : `Envío ${money(c.shipping)}`);
    facts.push(`<span title="${esc(feesTitle)}">${c.feesSource === 'local' ? 'Impuestos incluidos'
      : c.importFees === 0 ? 'Sin impuestos' : `Impuestos ${money(c.importFees)}${c.feesSource === 'estimado' ? ' <span class="warn-t">(est.)</span>' : ''}`}</span>`);
  }
  const flags = [];
  if (c.price == null) flags.push('<span class="chip warn">Sin precio</span>');
  else if (!p.manual && c.overThreshold) flags.push(`<span class="chip warn" title="El pedido supera US$${s.threshold}: paga IVA al importar">≥ US$${s.threshold}</span>`);
  if (!p.manual && p.shipsToCO === false) flags.push('<span class="chip err">No envía a CO</span>');
  if (p.manual) flags.push(`<span class="chip">${esc(p.store || 'Manual')}</span>`);
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
  const parts = CATEGORIES.map((c) => [c, selectedLines(b).filter((l) => l.cat === c.key).reduce((a, l) => a + estimateWatts(l.p, c.key), 0)]).filter(([, w]) => w > 0);
  if (parts.length) parts.push([{ name: 'Otros (USB, periféricos, RGB de la placa)', short: 'Otros' }, BASE_WATTS]);
  const guesses = selectedLines(b).filter((l) => wattsIsGuess(l.p, l.cat));
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
        <dt>Envío a Colombia</dt><dd>${t.shipping === 0 && t.orders ? '<span class="ok-t">Gratis</span>' : usd(t.shipping)}</dd>
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
      return `<li><span class="bl-cat">${esc(CAT[l.cat].short)}</span><button class="bl-title" data-action="goto" data-cat="${l.cat}" title="${esc(l.p.title)}">${esc(shortTitle(l.p.title, 60))}</button>${c.price == null ? '<span class="warn-t">Sin precio</span>' : costTip(l.p, c)}</li>`;
    }).join('');
    if (!lines.length) return `<div class="bl-empty"><span>${label}</span><span class="num">${usd(amount)}</span></div>`;
    return `<details class="acc sub bl" data-acc="build-${key}" ${openSide.has(`build-${key}`) ? 'open' : ''}>
      <summary><span class="acc-title">${label} <span class="muted">(${lines.length})</span></span><span class="acc-meta">${usd(amount)}</span></summary>
      <ul class="bl-list">${rows}</ul>
    </details>`;
  };
  const buildBody = `
    ${group('buy', 'Por comprar', 'buy', t.toBuyTotal)}
    ${group('bought', 'Ya comprado', 'bought', t.spent)}
    ${group('planned', 'Planeado para después', 'planned', t.planned)}
    <div class="bl-total"><b>Total del armado</b><b class="num">${usd(t.grand)}</b></div>
    ${t.fixed ? `<p class="acc-note"><span class="chip pick pick3">★★★</span> ${t.fixed} fijo${t.fixed === 1 ? '' : 's'} por comprar suman ${usd(t.fixedTotal)}</p>` : ''}`;

  const powerBody = parts.length ? `
    <div class="stack" title="Consumo por pieza sobre ${psuW ? `la fuente de ${psuW} W` : 'la fuente recomendada'}">${parts.map(([c, w], i) => `<i style="width:${(w / scale) * 100}%;background:${colors[i % colors.length]}" title="${esc(c.name)}: ${w} W"></i>`).join('')}</div>
    <ul class="wlist">${parts.map(([c, w], i) => `<li><i style="background:${colors[i % colors.length]}"></i><span>${esc(c.short || c.name)}</span><b class="num">${w} W</b></li>`).join('')}</ul>
    <div class="price-sub">Fuente recomendada ≥ ${t.recommendedPsu} W${psuW ? ` · elegida ${psuW} W` : ''}${t.watts !== t.wattsNow ? ' · incluye piezas planeadas' : ''}</div>
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
  if (p.manual) out.push(`<span class="chip">${esc(p.store || 'Manual')}</span>`);
  else {
    if (c.price != null) out.push(c.overThreshold ? `<span class="chip warn">≥ US$${s.threshold} · IVA</span>` : `<span class="chip ok">&lt; US$${s.threshold}</span>`);
    out.push(p.shipsToCO === true ? '<span class="chip ok">Envía a CO</span>' : p.shipsToCO === false ? '<span class="chip err">No envía a CO</span>' : '<span class="chip warn">Envío CO sin confirmar</span>');
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

function priceBox(p) {
  const c = lineCost(p, S());
  if (c.price == null) return `<div class="pricebox"><div class="price muted">—</div><div class="price-sub">${p.manual ? 'sin precio' : 'sin oferta'}</div></div>`;
  const caveat = costCaveat(p, c);
  const ship = c.shipping == null ? (p.manual ? '' : '<span class="warn-t">envío ?</span>') : c.shipping === 0 ? '<span class="ok-t">envío gratis</span>' : `${usd(c.shipping)} envío`;
  const fees = c.feesSource === 'local' ? 'imp. incluidos' : c.importFees === 0 ? 'sin impuestos' : `${usd(c.importFees)} imp.${c.feesSource === 'estimado' ? ' (est.)' : ''}`;
  return `<div class="pricebox">
    <div class="price-label">${p.manual ? 'Precio final' : 'Total en Colombia'}${caveat ? ` <span class="warn-t" title="${esc(caveat)}">(parcial)</span>` : ''}</div>
    <div class="price">${costTip(p, c, { fmt: usd, cls: 'big' })}</div>
    <div class="price-sub">${[`${usd(c.subtotal)} producto`, ship, fees].filter(Boolean).join(' + ')}</div>
    <div class="price-sub">${p.displayed?.total != null && c.qty === 1 ? `${copAmazon(p.displayed.total)} (Amazon)` : `≈ ${cop(c.total)}`}</div>
  </div>`;
}

function productCard(p, cat) {
  return `<article class="pcard ${p.status || 'buy'} ${isFixed(p) ? 'fixed' : ''} ${isBusy(p) ? 'loading' : ''}">
    ${thumb(p, cat)}
    <div>
      ${p.url ? `<a class="ptitle" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : `<div class="ptitle">${esc(p.title)}</div>`}
      <div class="chips">${chipsFor(p, cat)}</div>
      ${starPicker(p, cat)}
      ${p.fetchedAt ? `<div class="price-sub" style="margin-top:4px">Revisado ${ago(p.fetchedAt)}${p.locationOk === false ? ` · <b style="color:var(--err)">sin entrega en Colombia (${esc(p.deliverTo || '?')})</b>` : ''}</div>` : ''}
    </div>
    ${priceBox(p)}
    <div class="pactions">
      <button class="btn small" data-action="details" data-cat="${cat}" data-id="${p.id}">✎ Detalles</button>
      ${updateButton(p, cat, 'btn small')}
      <button class="btn small ghost" data-action="deselect" data-cat="${cat}" data-id="${p.id}">Quitar del armado</button>
    </div>
  </article>`;
}

// Botón de actualizar con tu sesión (o vincular con Amazon si el producto no tiene enlace).
function updateButton(p, cat, cls, compact = false) {
  const attrs = `data-cat="${cat}" data-id="${p.id}"`;
  if (!asinOf(p)) return `<button class="${cls}" data-action="link-amazon" ${attrs} title="Vincular con un enlace de Amazon para actualizar con tu sesión" aria-label="Vincular con Amazon">${compact ? '🔗' : '🔗 Vincular con Amazon'}</button>`;
  if (isBusy(p)) return `<button class="${cls}" disabled aria-label="Leyendo con tu sesión">${compact ? '…' : 'Leyendo con tu sesión…'}</button>`;
  return `<button class="${cls}" data-action="refresh" ${attrs} title="Reescribir toda la información con tu sesión de Amazon" aria-label="Actualizar con tu sesión">${compact ? '↻' : '↻ Actualizar'}</button>`;
}

function optionCard(p, cat, ref) {
  const s = slot(cat);
  const sel = s.selected.includes(p.id);
  const c = lineCost(p, S());
  const delta = !sel && ref != null && c.total != null ? c.total - ref : null;
  return `<div class="opt ${sel ? 'sel' : ''} ${isFixed(p) ? 'fixed' : ''} ${isBusy(p) ? 'loading' : ''}">
    <div class="opt-top">${thumb(p, cat)}<div class="opt-title" title="${esc(p.title)}">${esc(p.title)}</div></div>
    <div class="opt-price">${costTip(p, c, { fmt: usd })}${delta != null ? `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : '−'}${usd(Math.abs(delta)).replace('US$', '$')}</span>` : sel ? '<span class="delta muted">elegido</span>' : ''}</div>
    <div class="chips">${chipsFor(p, cat)}</div>
    ${starPicker(p, cat, 'small')}
    <div class="opt-actions">
      <button class="btn small ${sel ? '' : 'primary'}" data-action="select" data-cat="${cat}" data-id="${p.id}">${sel ? (CAT[cat].multi ? 'Quitar' : 'Elegido ✓') : CAT[cat].multi ? 'Agregar' : 'Cambiar a este'}</button>
      ${updateButton(p, cat, 'btn small ghost', true)}
      <button class="btn small ghost" data-action="details" data-cat="${cat}" data-id="${p.id}" title="Detalles" aria-label="Detalles">⋯</button>
    </div>
  </div>`;
}

function renderParts(b, list) {
  const html = CATEGORIES.map((c) => {
    const s = slot(c.key);
    const sel = s.selected.map((id) => s.options.find((o) => o.id === id)).filter(Boolean);
    const state = catState(b, c.key);
    const flags = list.filter((x) => x.cats.includes(c.key) && (x.level === 'error' || x.level === 'warn'));
    const ref = sel.length === 1 ? lineCost(sel[0], S()).total : null;
    const sub = sel.length ? sel.map((p) => shortTitle(p.title, 45)).join(' + ') : c.essential ? 'Sin elegir' : 'Opcional';
    return `<section class="cat has-${state}" id="cat-${c.key}">
      <div class="cat-head">
        <div class="cat-icon">${ICONS[c.key]}</div>
        <div class="cat-title"><h3>${c.name}${c.multi ? '<span class="chip">varios</span>' : ''}</h3><p title="${esc(sub)}">${esc(sub)}</p></div>
        <div class="cat-flags">
          ${s.options.filter(isFixed).length ? `<span class="chip pick pick3" title="Opciones marcadas ★★★ fijo">★★★ ${s.options.filter(isFixed).length}</span>` : ''}
          ${flags.some((x) => x.level === 'error') ? '<span class="chip err">error</span>' : flags.length ? '<span class="chip warn">revisar</span>' : ''}
          ${s.options.length > 1 ? `<button class="btn small ghost" data-action="compare" data-cat="${c.key}">Comparar ${s.options.length}</button>` : ''}
        </div>
      </div>
      <div class="cat-body">
        ${sel.length ? sel.map((p) => productCard(p, c.key)).join('') : `<div class="empty-slot">${ICONS[c.key].replace('<svg', '<svg width="28" height="28"')}<span>${s.options.length ? 'Elige una de las opciones de abajo' : 'Pega abajo un enlace de amazon.com para agregar opciones'}</span></div>`}
        <details class="options" data-cat="${c.key}" ${openCats.has(c.key) || !s.options.length ? 'open' : ''}>
          <summary>${s.options.length ? `Opciones (${s.options.length}): cambiar o agregar` : 'Agregar producto'}</summary>
          ${s.options.length ? `<div class="opt-grid">${sortByPick(s.options).map((p) => optionCard(p, c.key, ref)).join('')}</div>` : ''}
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
  $('#parts').innerHTML = html;
  for (const [cat, v] of Object.entries(typed)) { const f = $(`form.add-row[data-cat="${cat}"]`); if (f) f.url.value = v; }
}

// ---------- modales ----------
const modal = $('#modal');
function openModal(html) { $('#modalBody').innerHTML = html; if (!modal.open) modal.showModal(); }
function closeModal() { modal.close(); }

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
  storage: [['interface', 'Interfaz (NVMe/SATA)', 'NVMe']],
  fans: [['count', 'Ventiladores en el pack', '3']],
};

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
    </div>
    <small class="muted">${linked
      ? 'Lo que cambies queda marcado como editado: «↻ Actualizar» no lo sobrescribe, salvo que tu sesión encuentre en Amazon un precio con envío a Colombia (entonces Amazon reemplaza todo).'
      : 'Producto sin enlace de Amazon: estos son los datos que usa el armador.'}</small>
    ${linked && editedList.length ? `<div style="margin-top:8px"><button type="button" class="btn small" data-action="clear-edits" data-cat="${cat}" data-id="${p.id}">Descartar ediciones y actualizar con Amazon</button> <span class="muted">Editado: ${esc(editedLabels(editedList))}</span></div>` : ''}
  </div>`;
}

function detailsModal(cat, id, { focusLink = false } = {}) {
  const p = findP(cat, id);
  if (!p) return;
  const c = lineCost(p, S());
  const tags = detectTags({ ...p, tags: {} }, cat);
  const fields = TAG_FIELDS[cat] || [];
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
            ${p.manual ? '' : `<tr><th>Envío a Colombia</th><td class="r">${c.shipping == null ? '—' : c.shipping === 0 ? 'Gratis' : usd(c.shipping)}</td></tr>
            <tr><th>Cargos de importación ${p.importFeesInfo === 'no-informado' ? '(Amazon no los informa: vendedor externo, se pagarían en aduana)' : c.feesSource === 'amazon' ? '(Amazon)' : c.feesSource === 'editado' ? '(editado)' : '(estimado)'}</th><td class="r">${usd(c.importFees)}</td></tr>`}
            <tr><th><b>Total en Colombia</b></th><td class="r"><b>${usd(c.total)}</b><br><span class="muted">${p.displayed?.total != null ? `${copAmazon(p.displayed.total)} según Amazon` : cop(c.total)}</span></td></tr>
            ${p.fx ? `<tr><th>Tasa usada</th><td class="r">${p.fx.rate.toLocaleString('es-CO')} COP/US$ (${esc(p.fx.source)})</td></tr>` : ''}
            ${p.manual ? '' : `<tr><th>Vendedor / envía</th><td class="r">${esc(p.seller || '—')} / ${esc(p.shipsFrom || '—')}</td></tr>
            <tr><th>Disponibilidad</th><td class="r">${esc(p.availability || '—')}</td></tr>
            <tr><th>Entrega a</th><td class="r">${esc(p.deliverTo || '—')}${p.locationOk === false ? ' <span class="chip err">sin Colombia</span>' : ''}</td></tr>
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
  const s = slot(cat);
  s.options.push(p);
  if (!s.selected.length || CAT[cat].multi) s.selected.push(p.id);
  closeModal();
  commit();
  if (amazonLink) await linkAndUpdate(p, amazonLink);
}

function compareModal(cat) {
  const s = slot(cat);
  const ps = sortByPick(s.options);
  const costs = ps.map((p) => lineCost(p, S()));
  const best = (arr, fn) => { const vals = arr.map(fn).filter((x) => x != null); return vals.length ? Math.min(...vals) : null; };
  const minTotal = best(costs, (c) => c.total);
  const maxRating = Math.max(...ps.map((p) => p.rating || 0));
  const tagKeys = (TAG_FIELDS[cat] || []).map(([k, l]) => [k, l]);
  const row = (label, fn) => `<tr><th>${label}</th>${ps.map((p, i) => `<td>${fn(p, costs[i])}</td>`).join('')}</tr>`;
  openModal(`
    <div class="m-head"><h2>Comparar · ${CAT[cat].name}</h2><button class="btn ghost" data-action="close" aria-label="Cerrar">✕</button></div>
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
  store.settings = { trm: n('trm') || 3160, threshold: n('threshold') || 200, iva: n('iva') || 0.19, psuMargin: n('psuMargin') || 1.3, staleDays: n('staleDays') || 3, refreshMinutes: Number.isFinite(n('refreshMinutes')) && f.elements.refreshMinutes.value !== '' ? Math.max(0, n('refreshMinutes')) : 10 };
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
    case 'compare': return compareModal(cat);
    case 'add-manual': return manualModal(cat);
    case 'save-manual': return saveManual();
    case 'save-details': return saveDetails();
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

await loadStore();
render();
await handleHashPayload();
