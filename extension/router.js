// Enrutador del service worker de la extensión. Une el armador (puertos 'app', vía bridge.js) con las pestañas de
// Amazon y de cada tienda (puertos 'tab', vía connector.js). Un canal = un origen (todo amazon.com es un canal).
//
// Por qué es más robusto que el marcador: no depende de referencias entre ventanas (window.opener), que se pierden
// al recargar o con Cross-Origin-Opener-Policy. Si una pestaña se recarga, su conector vuelve a conectarse solo y
// lo que estaba leyendo se le reenvía; si el armador se recarga, el puente reconecta y el armador reenvía lo pendiente.
//
// armador → { type: 'job', id, kind: 'fetch'|'price'|'orders', asin|url|items } · { type: 'cancel', id }
//           { type: 'connect', origin, url?, active?, newTab? } · { type: 'verify', origin } · { type: 'focus', origin }
//           { type: 'ack', addId, text } · { type: 'status' } · { type: 'reload' }
// ← armador { type: 'status', channels } · { type: 'result', id, ok, data|error } · { type: 'progress', id, done, total }
//           { type: 'add', addId, cat, product, connector }
export const AMAZON = 'https://www.amazon.com';
export const TIMEOUT = { fetch: 90000, price: 60000, orders: 5 * 60000, verify: 30000 };
export const OPEN_STUCK_MS = 45000;
const RECHECK_MS = 10 * 60000;
const APP_URL = /^(http:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/[a-z0-9.-]+\.ts\.net(:\d+)?)\//i;

/** Canal (origen) de un enlace: todo amazon.com comparte uno. */
export function channelOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    return /(^|\.)amazon\.com$/i.test(u.hostname) ? AMAZON : u.origin;
  } catch { return null; }
}
/** Patrón de chrome.tabs.query para las pestañas de un canal. */
export const tabPattern = (origin) => (origin === AMAZON ? 'https://*.amazon.com/*' : `${origin}/*`);
/** Patrón de manifiesto (https://*.x.com/*) → expresión regular. Sin puerto en el patrón, vale cualquier puerto. */
export function matchRe(p) {
  const [, scheme, host, rest] = /^(\*|https?):\/\/([^/]*)(\/.*)$/.exec(p) || [];
  if (!scheme) return /^$/;
  const lit = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const h = host === '*' ? '[^/:]+' : host.startsWith('*.') ? `([^/:]+\\.)?${lit(host.slice(2))}` : lit(host);
  return new RegExp(`^${scheme === '*' ? 'https?' : scheme}://${h}(:\\d+)?${lit(rest).replace(/\*/g, '.*')}$`);
}

const MSG = {
  fetch: 'Amazon no respondió a tiempo. Pulsa «Verificar» en su conexión o recarga su pestaña.',
  price: 'La tienda no respondió a tiempo. Pulsa «Verificar» en su conexión o recarga su pestaña.',
  orders: 'Leer tus pedidos tardó demasiado. Reintenta.',
  verify: 'La pestaña no respondió a la verificación. Recárgala.',
};

export function createRouter(chrome, { now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const apps = []; // puertos del armador (el último es el que recibe lo que se agrega desde Amazon)
  const tabs = new Map(); // tabId → { port, tabId, windowId, origin, info, at }
  const opening = new Map(); // origen → { tabId, at }
  const jobs = new Map(); // id → { msg, app, origin, tabId, timer, internal? }
  const checks = new Map(); // origen → resultado de la última verificación
  const pendingAdds = []; // agregados desde Amazon sin armador abierto
  const addPorts = new Map(); // addId → puerto de la pestaña de Amazon que espera el acuse
  let seq = 0;
  let appHome = '';

  const iso = () => new Date(now()).toISOString();
  const send = (port, msg) => { try { port.postMessage(msg); return true; } catch { return false; } };
  const contentScripts = () => chrome.runtime.getManifest().content_scripts || [];
  const storeRes = () => contentScripts().filter((c) => c.js.includes('connector.js')).flatMap((c) => c.matches).map(matchRe);
  const isStoreUrl = (url) => storeRes().some((re) => re.test(url || ''));

  /** La pestaña conectada más reciente de un canal. */
  function pick(origin) {
    let best = null;
    for (const t of tabs.values()) if (t.origin === origin && (!best || t.at > best.at)) best = t;
    return best;
  }

  function channels() {
    const out = new Map();
    const add = (o) => out.get(o) || out.set(o, { origin: o, state: 'none', tabs: 0, queued: 0, running: 0 }).get(o);
    for (const t of tabs.values()) add(t.origin).tabs++;
    for (const [o, op] of opening) {
      const c = add(o);
      c.openingSince = op.at;
    }
    for (const j of jobs.values()) {
      if (j.internal) continue;
      const c = add(j.origin);
      if (j.tabId == null) c.queued++; else c.running++;
    }
    for (const [o, ch] of checks) add(o).check = ch;
    for (const c of out.values()) {
      const t = pick(c.origin);
      if (t) Object.assign(c, t.info, { state: 'connected', tabId: t.tabId });
      else if (c.openingSince) c.state = now() - c.openingSince > OPEN_STUCK_MS ? 'stuck' : 'opening';
    }
    return [...out.values()];
  }
  const statusMsg = () => ({ type: 'status', channels: channels(), extVersion: chrome.runtime.getManifest().version });
  function broadcast() {
    const msg = statusMsg();
    for (const a of apps) send(a, msg);
  }
  function tellTabs() {
    for (const t of tabs.values()) send(t.port, { type: 'app', linked: apps.length > 0 });
  }

  // ---------- trabajos ----------
  function dispatch(origin) {
    const t = pick(origin);
    if (!t) return;
    for (const [id, j] of jobs) {
      if (j.origin !== origin || j.tabId != null) continue;
      j.tabId = t.tabId;
      send(t.port, { ...j.msg, type: 'job', id });
      clearTimer(j.timer);
      j.timer = setTimer(() => finish(id, false, MSG[j.msg.kind] || MSG.price), TIMEOUT[j.msg.kind] || TIMEOUT.price);
    }
  }
  function finish(id, ok, payload) {
    const j = jobs.get(id);
    if (!j) return;
    jobs.delete(id);
    clearTimer(j.timer);
    if (j.internal) j.internal(ok, payload);
    else if (j.app) send(j.app, ok ? { type: 'result', id, ok: true, data: payload } : { type: 'result', id, ok: false, error: String(payload || 'Error del conector') });
    broadcast();
  }
  /** La pestaña se fue (recarga, navegación o cierre): lo que leía vuelve a la cola de su canal. */
  function requeue(entry) {
    for (const j of jobs.values()) {
      if (j.tabId !== entry.tabId) continue;
      clearTimer(j.timer);
      j.tabId = null;
      j.timer = 0;
    }
    dispatch(entry.origin);
  }

  function verify(origin) {
    origin = channelOf(origin);
    if (!origin) return;
    if (!pick(origin)) {
      return adopt(origin).then((found) => {
        checks.set(origin, { ok: false, at: iso(), detail: found ? 'Conectando con la pestaña que ya estaba abierta…' : 'No hay ninguna pestaña abierta: pulsa «Conectar».' });
        broadcast();
      });
    }
    const id = `v${++seq}`;
    checks.set(origin, { ...checks.get(origin), running: true });
    jobs.set(id, {
      msg: { kind: 'verify' }, app: null, origin, tabId: null, timer: 0,
      internal: (ok, r) => { checks.set(origin, ok ? { ...r, at: r?.at || iso() } : { ok: false, at: iso(), detail: String(r) }); },
    });
    dispatch(origin);
    broadcast();
  }

  // ---------- pestañas ----------
  /** Una pestaña del canal abierta sin conector (p. ej. antes de instalar o recargar la extensión): se le inyecta. */
  async function adopt(origin) {
    let found = [];
    try { found = await chrome.tabs.query({ url: tabPattern(origin) }); } catch { /* sin permiso */ }
    const tab = found.find((t) => !tabs.has(t.id) && channelOf(t.url) === origin);
    if (!tab) return false;
    opening.set(origin, { tabId: tab.id, at: now() });
    try {
      if (tab.discarded) await chrome.tabs.reload(tab.id); // al recargarla, Chrome inyecta el conector
      else await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['connector.js'] });
    } catch { /* pestaña de error o cerrándose: queda «sin responder» */ }
    broadcast();
    return true;
  }
  async function focusTab(tabId) {
    try {
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    } catch { /* cerrada */ }
  }
  async function connect(originOrUrl, { url = '', active = false, newTab = false } = {}) {
    const origin = channelOf(originOrUrl);
    if (!origin) return;
    const t = pick(origin);
    const op = opening.get(origin);
    if (!newTab) {
      if (t) return active ? focusTab(t.tabId) : undefined;
      if (op && now() - op.at < OPEN_STUCK_MS) return active ? focusTab(op.tabId) : undefined;
      if (await adopt(origin)) return active ? focusTab(opening.get(origin).tabId) : undefined;
    }
    const target = url && channelOf(url) === origin ? url : `${origin}/`;
    const tab = await chrome.tabs.create({ url: target, active: !!active });
    if (!t) opening.set(origin, { tabId: tab.id, at: now() });
    broadcast();
  }
  function focus(origin) {
    origin = channelOf(origin);
    const id = pick(origin)?.tabId ?? opening.get(origin)?.tabId;
    if (id != null) return focusTab(id);
    return connect(origin, { active: true });
  }

  // ---------- puertos ----------
  function onApp(port) {
    const url = port.sender?.url || '';
    if (!APP_URL.test(url)) return port.disconnect();
    apps.push(port);
    appHome = `${new URL(url).origin}/`;
    try { chrome.storage?.local?.set({ appHome }); } catch { /* opcional */ }
    port.onMessage.addListener((m) => fromApp(port, m));
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // leerlo evita «Unchecked runtime.lastError» (p. ej. al pasar a la caché atrás/adelante)
      if (apps.includes(port)) apps.splice(apps.indexOf(port), 1);
      for (const [id, j] of jobs) if (j.app === port) { clearTimer(j.timer); jobs.delete(id); }
      tellTabs();
      broadcast();
    });
    tellTabs();
    send(port, statusMsg());
    while (pendingAdds.length) send(port, pendingAdds.shift());
  }
  function fromApp(port, m) {
    switch (m?.type) {
      case 'job': {
        const origin = m.kind === 'price' ? channelOf(m.url) : AMAZON;
        if (!origin || !TIMEOUT[m.kind]) return send(port, { type: 'result', id: m.id, ok: false, error: 'Pedido no válido.' });
        const old = jobs.get(m.id);
        if (old) clearTimer(old.timer);
        jobs.set(m.id, { msg: m, app: port, origin, tabId: null, timer: 0 });
        dispatch(origin);
        return broadcast();
      }
      case 'cancel': {
        const j = jobs.get(m.id);
        if (j) { clearTimer(j.timer); jobs.delete(m.id); broadcast(); }
        return;
      }
      case 'connect': return connect(m.origin, m);
      case 'verify': return verify(m.origin);
      case 'focus': return focus(m.origin);
      case 'status': return send(port, statusMsg());
      case 'ack': {
        const p = addPorts.get(m.addId);
        addPorts.delete(m.addId);
        if (p) send(p, { type: 'ack', text: String(m.text || '') });
        return;
      }
      case 'reload': return chrome.runtime.reload();
      default:
    }
  }

  function onTab(port) {
    const tab = port.sender?.tab;
    const origin = channelOf(port.sender?.url || tab?.url);
    if (!tab || !origin) return port.disconnect();
    const entry = { port, tabId: tab.id, windowId: tab.windowId, origin, info: {}, at: now(), live: false };
    port.onMessage.addListener((m) => fromTab(entry, m));
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (tabs.get(entry.tabId) !== entry) return;
      tabs.delete(entry.tabId);
      requeue(entry);
      broadcast();
    });
    send(port, { type: 'app', linked: apps.length > 0 });
  }
  function fromTab(entry, m) {
    switch (m?.type) {
      case 'hello': {
        const s = (v, n = 200) => (v == null ? null : String(v).slice(0, n));
        entry.info = { version: s(m.version, 20), store: s(m.store, 30), loggedIn: m.loggedIn == null ? null : !!m.loggedIn, deliverTo: s(m.deliverTo), account: s(m.account, 80), blocked: !!m.blocked, title: s(m.title, 120) };
        entry.at = now();
        const prev = tabs.get(entry.tabId);
        if (prev && prev !== entry) { tabs.delete(entry.tabId); requeue(prev); }
        const wasUp = !!pick(entry.origin);
        tabs.set(entry.tabId, entry);
        if (opening.get(entry.origin)?.tabId === entry.tabId || !wasUp) opening.delete(entry.origin);
        dispatch(entry.origin);
        const c = checks.get(entry.origin);
        if (!entry.live && (!c || c.ok === false || now() - Date.parse(c.at || 0) > RECHECK_MS || entry.info.blocked)) verify(entry.origin);
        entry.live = true;
        return broadcast();
      }
      case 'result': {
        const j = jobs.get(m.id);
        if (j && j.tabId === entry.tabId) finish(m.id, !!m.ok, m.ok ? m.data : m.error);
        return;
      }
      case 'progress': {
        const j = jobs.get(m.id);
        if (j?.app) send(j.app, { type: 'progress', id: m.id, done: m.done, total: m.total });
        return;
      }
      case 'add': {
        const addId = `a${++seq}`;
        addPorts.set(addId, entry.port);
        const msg = { type: 'add', addId, cat: m.cat, product: m.product, connector: entry.info.version };
        const app = apps.at(-1);
        if (app) return send(app, msg);
        pendingAdds.push(msg);
        return openApp(false);
      }
      default: // 'ping': solo mantiene vivo el service worker
    }
  }

  async function openApp(focusExisting = true) {
    let home = appHome;
    try { home ||= (await chrome.storage?.local?.get('appHome'))?.appHome || ''; } catch { /* opcional */ }
    if (focusExisting) {
      try {
        const [tab] = await chrome.tabs.query({ url: ['http://localhost/*', 'http://127.0.0.1/*', 'https://*.ts.net/*'] });
        if (tab) return focusTab(tab.id);
      } catch { /* sin permiso */ }
    }
    return chrome.tabs.create({ url: home || 'http://localhost:4330/', active: true });
  }

  /** Al instalar o recargar la extensión, las pestañas ya abiertas no tienen los scripts: se les inyectan. */
  async function injectExisting() {
    for (const cs of contentScripts()) {
      let found = [];
      try { found = await chrome.tabs.query({ url: cs.matches }); } catch { continue; }
      for (const t of found) {
        if (t.discarded || /^chrome/.test(t.url || '')) continue;
        chrome.scripting.executeScript({ target: { tabId: t.id }, files: cs.js }).catch(() => {});
      }
    }
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'app') onApp(port);
    else if (port.name === 'tab') onTab(port);
    else port.disconnect();
  });
  chrome.runtime.onInstalled?.addListener(() => { injectExisting(); });
  chrome.tabs.onRemoved?.addListener((tabId) => {
    for (const [o, op] of opening) if (op.tabId === tabId) opening.delete(o);
    broadcast();
  });
  chrome.action?.onClicked.addListener((tab) => {
    const entry = tabs.get(tab.id);
    if (entry) return send(entry.port, { type: 'panel' });
    if (isStoreUrl(tab.url)) return chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['connector.js'] }).catch(() => {});
    return openApp();
  });

  // Para las pruebas.
  return { channels, jobs, tabs, opening, checks, connect, verify };
}
