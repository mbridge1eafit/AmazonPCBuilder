// Conector que corre DENTRO de amazon.com o de cada tienda con tu sesión, de dos formas:
//   · Extensión de Chrome (escritorio, recomendada): se carga sola en cada página y habla con el armador por el
//     service worker de la extensión (extension/router.js). Sobrevive a recargas de la tienda y del armador.
//   · Marcador (respaldo, p. ej. Android): se pulsa en la pestaña y habla con el armador por window.postMessage.
// El servidor lo empaqueta (server/connector-bundle.js) junto con amazon-parse.js y store-parse.js e inyecta el
// origen del armador, la versión y las categorías.
//
// Pedidos que atiende (kind): 'fetch' {asin} → producto · 'price' {url} → precio de tienda · 'orders' {items} →
// facturas (con progreso) · 'verify' → prueba real de la sesión (descarga la portada y busca bloqueos o CAPTCHA).
//   Extensión: tienda → { type: 'hello', … } · armador → { type: 'job', id, kind, … } · tienda → { type: 'result', id, ok, data|error }
//   Marcador:  pcb:fetch → pcb:data|pcb:error · pcb:price → pcb:price-data|pcb:price-error ·
//              pcb:orders → pcb:orders-progress … pcb:orders-data|pcb:orders-error · pcb:hello (latido cada 4 s)
// Cada lectura descarga la ficha con tus cookies y la lee con las funciones compartidas (readProduct/readOffers/readStorePrice).
(async () => {
  const APP = __APP__;
  const VERSION = __VERSION__;
  const CATS = __CATS__;
  const CONCURRENCY = 2;
  const q = (s) => document.querySelector(s);
  const EXT = typeof chrome === 'object' && !!chrome?.runtime?.id;

  // En Newegg, Best Buy, Micro Center o Mercado Libre el conector solo lee precios.
  const STORE = storeOfHost(location.hostname);
  if (!STORE && !/(^|\.)amazon\.com$/i.test(location.hostname)) {
    if (!EXT) alert('Armador PC: abre amazon.com (con tu sesión iniciada) o la ficha de una tienda (Newegg, Best Buy, Walmart, Target, B&H, Micro Center, Mercado Libre) y pulsa de nuevo el marcador.');
    return;
  }
  window.__pcbConnector?.dispose(); // pulsarlo otra vez (o reinyectar la extensión) reinicia el conector
  let disposed = false;

  // ---------- interfaz flotante (shadow DOM para aislarla de los estilos de la tienda) ----------
  // Con la extensión empieza oculta: se muestra con el ícono de la extensión.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;';
  host.hidden = EXT;
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host([hidden]){display:none}
    .b{width:350px;font:14px/1.45 Inter,system-ui,Segoe UI,sans-serif;background:#0F1216;color:#E8EBF0;border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.45);padding:12px 16px 14px;border:1px solid #2C323C}
    .b.min{width:auto;padding:8px 12px}.b.min #body,.b.min #product{display:none}
    .h{display:flex;justify-content:space-between;align-items:center;gap:8px}.h b{font-size:15px}.h b::before{content:"";display:inline-block;width:10px;height:14px;border-radius:3px;background:#6C93FF;margin-right:8px;vertical-align:-1px}
    .x{background:none;border:0;color:#9AA3B0;font-size:16px;cursor:pointer;padding:2px 4px}
    .t{font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .kv{display:grid;grid-template-columns:1fr auto;gap:2px 10px;margin:8px 0;font-size:13px}.kv span:nth-child(odd){color:#9AA3B0}.kv span:nth-child(even){text-align:right;font-variant-numeric:tabular-nums}
    .ok{color:#8FDCAE}.warn{color:#F6C56B}.err{color:#FF9E96}
    .cats{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
    button.c,button.p{padding:7px 8px;border-radius:8px;border:1px solid #39404B;background:#1A1E25;color:#E8EBF0;min-height:36px;cursor:pointer;font:inherit;font-size:12.5px;text-align:left}
    button.c:hover{border-color:#6C93FF}button.c.g{border-color:#6C93FF;background:#1B2A55}
    button.p{background:#2453D6;border-color:#2453D6;color:#fff;font-weight:600;text-align:center;width:100%;margin-top:8px}
    .m{font-size:13px;color:#9AA3B0;margin-top:6px}.s{font-size:13px;margin-top:6px}
    #product{border-top:1px solid #2C323C;margin-top:10px;padding-top:10px}#product:empty{display:none}
  </style><div class="b"><div class="h"><b>Armador PC</b><span><button class="x" id="min" title="Minimizar">–</button><button class="x" id="close" title="${EXT ? 'Ocultar' : 'Cerrar conector'}">✕</button></span></div>
  <div id="body"></div><div id="product"></div></div>`;
  document.body.append(host);
  const box = root.querySelector('.b');
  const body = root.querySelector('#body');
  const panel = root.querySelector('#product');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  root.querySelector('#min').onclick = () => box.classList.toggle('min');
  const storeName = STORE ? STORES[STORE].name : 'Amazon';

  // ---------- lectura con tu sesión ----------
  const reader = (doc, live) => ({
    one: (sel, node) => (node || doc).querySelector(sel),
    all: (sel, node) => [...(node || doc).querySelectorAll(sel)],
    text: (node) => {
      if (!node) return '';
      if (!live) return node.textContent;
      const c = node.cloneNode(true); // en la página viva no se pueden quitar los scripts
      c.querySelectorAll('script, style, noscript').forEach((x) => x.remove());
      return c.textContent;
    },
    attr: (node, name) => node?.getAttribute(name) ?? null,
    up: (node) => node?.parentElement ?? null,
  });
  const parse = (html) => {
    const d = new DOMParser().parseFromString(html, 'text/html');
    d.querySelectorAll('script, style, noscript').forEach((x) => x.remove());
    return d;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const get = async (url, headers = {}) => {
    const r = await fetch(url, { credentials: 'include', headers });
    return { status: r.status, url: r.url, html: await r.text() };
  };
  const AMAZON_CAPTCHA = /captchacharacters|validateCaptcha/i;
  const sessionOf = (doc) => {
    const acc = clean(doc.querySelector('#nav-link-accountList-nav-line-1')?.textContent);
    return { account: acc, loggedIn: !!acc && !/Identif|sign in/i.test(acc), deliverTo: clean(doc.querySelector('#glow-ingress-line2')?.textContent) };
  };
  // Sesión de Amazon (se relee al verificar: «Entregar en» pudo cambiar en otra pestaña).
  let session = STORE ? { account: '', loggedIn: null, deliverTo: '' } : sessionOf(document);
  const blockedHere = () => (STORE
    ? /^\s*(Just a moment|Un momento|Attention Required|Access Denied|Acceso denegado|Are you a human|Security check)/i.test(document.title)
    : !!q('form[action*="validateCaptcha"]'));

  async function readPrice(url) {
    const u = new URL(url, location.href);
    if (u.origin !== location.origin) throw new Error(`El enlace es de ${u.host}: ábrelo y pulsa ahí el marcador.`);
    const r = await fetch(u.href, { credentials: 'include' });
    const html = await r.text();
    if (r.status === 404) throw new Error('La ficha ya no existe en la tienda.');
    if (storeBlocked(html)) throw new Error(`${storeName} pidió una verificación: resuélvela en su pestaña y reintenta.`);
    let d = readStorePrice(html, STORE);
    if (d.price == null && STORE === 'target') {
      const api = targetPriceUrl(html, u.href);
      if (!api) throw new Error('Target no trajo la clave de su API en la ficha: recarga su pestaña y reintenta.');
      const ar = await fetch(api);
      if (ar.status === 404) throw new Error('La ficha ya no existe en Target.');
      const t = readTargetApi(await ar.json().catch(() => null));
      if (t.price == null) throw new Error(`La API de Target no devolvió el precio (HTTP ${ar.status}).`);
      d = { ...t, title: t.title || d.title };
    }
    if (d.price == null) throw new Error(`No encontré el precio en la ficha (HTTP ${r.status}).`);
    return { ...d, url: u.href, fetchedAt: new Date().toISOString() };
  }

  async function readAsin(asin) {
    // Ficha y ofertas en paralelo. Si Amazon sirve la variante sin ubicación, reintenta la ficha una vez.
    let [dp, aod] = await Promise.all([get(`/dp/${asin}?th=1&psc=1`), get(aodUrl(asin), { 'x-requested-with': 'XMLHttpRequest' }).catch(() => ({ html: '' }))]);
    let d = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) { await sleep(1200); dp = await get(`/dp/${asin}?th=1&psc=1`); }
      if (AMAZON_CAPTCHA.test(dp.html)) throw new Error('Amazon pide un CAPTCHA: resuélvelo en la pestaña de Amazon y reintenta.');
      if (dp.status === 404) throw new Error('El producto ya no existe en amazon.com.');
      if (/id="productTitle"/.test(dp.html)) d = readProduct(reader(parse(dp.html), false));
      if (d?.region) break;
    }
    if (!d) throw new Error(`Amazon no devolvió la ficha (HTTP ${dp.status}).`);
    const offers = aod.html ? readOffers(reader(parse(aod.html), false)) : [];
    let priceSource = 'buybox';
    if (d.price == null) {
      const o = bestNewOffer(offers);
      if (o) {
        Object.assign(d, { price: o.price, currency: o.currency, shipping: o.shipping, seller: o.seller, shipsFrom: o.shipsFrom, shipsToCO: d.locationOk ? true : null, importFees: null, total: null });
        priceSource = 'oferta';
      }
    }
    return { asin, url: `https://www.amazon.com/dp/${asin}`, ...d, offers, priceSource, source: 'sesion', loggedIn: session.loggedIn, fetchedAt: new Date().toISOString() };
  }

  // Prueba real: descarga la portada con tus cookies y revisa bloqueos, CAPTCHA y (en Amazon) sesión y destino.
  async function verify() {
    const t0 = Date.now();
    const r = await fetch(`${location.origin}/`, { credentials: 'include' });
    const html = await r.text();
    const out = { ok: r.ok, status: r.status, ms: Date.now() - t0, at: new Date().toISOString(), detail: '' };
    if (STORE) {
      if (storeBlocked(html)) Object.assign(out, { ok: false, detail: `${storeName} pide una verificación (CAPTCHA): resuélvela en su pestaña.` });
    } else if (AMAZON_CAPTCHA.test(html)) {
      Object.assign(out, { ok: false, detail: 'Amazon pide un CAPTCHA: resuélvelo en su pestaña.' });
    } else {
      session = sessionOf(new DOMParser().parseFromString(html, 'text/html'));
      Object.assign(out, session);
      if (!session.loggedIn) out.detail = 'No hay sesión iniciada en Amazon: inicia sesión en su pestaña.';
      hello();
    }
    if (!r.ok && !out.detail) out.detail = `${storeName} respondió HTTP ${r.status}.`;
    return out;
  }

  // ---------- tus pedidos: precio pagado ----------
  // Busca cada producto en tus pedidos (todos los años): primero por ASIN y, si su factura no aparece (otra
  // variante, p. ej. otro color), por nombre. Lee las facturas de los pedidos encontrados y las devuelve todas:
  // el armador elige la que corresponde a cada producto (por ASIN o por nombre).
  const orders = { active: false, done: 0, total: 0 };
  async function readOrders(items, onProgress) {
    const invoices = new Map(); // número de pedido → factura
    const searchIds = async (query) => {
      const page = await get(orderSearchUrl(query));
      const ids = readOrderIds(page.html);
      if (!ids.length && needsSignIn(page.url, page.html)) throw new Error('Amazon pide iniciar sesión de nuevo para ver tus pedidos: abre «Tus pedidos» en esta pestaña, entra y reintenta.');
      return ids;
    };
    const readIds = async (ids) => {
      const todo = [...new Set(ids)].filter((id) => !invoices.has(id));
      orders.total += todo.length;
      let next = 0;
      const worker = async () => {
        while (next < todo.length) {
          const id = todo[next++];
          const inv = readInvoice(reader(parse((await get(invoiceUrl(id))).html), false));
          invoices.set(id, { ...inv, orderId: inv.orderId || id });
          orders.done++;
          onProgress(orders.done, orders.total);
          status();
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    };
    const has = (asin) => [...invoices.values()].some((inv) => inv.items.some((it) => it.asin === asin));
    Object.assign(orders, { active: true, done: 0, total: 0 });
    status();
    try {
      const byAsin = [];
      for (const it of items) byAsin.push(...await searchIds(it.asin));
      await readIds(byAsin);
      const byName = [];
      for (const it of items) if (!has(it.asin) && it.query) byName.push(...await searchIds(it.query));
      await readIds(byName);
    } finally {
      orders.active = false;
      status();
    }
    const list = [...invoices.values()].filter((inv) => inv.items.length && inv.total != null);
    return { invoices: list, scanned: orders.done, orders: list.length };
  }

  // ---------- enlace con el armador ----------
  let linked = false; // ¿hay un armador escuchando?
  let port = null; // extensión: puerto con el service worker
  let appWin = window.opener; // marcador: la pestaña del armador con la que se habla
  let onAppAck = null;
  const post = (win, msg) => { try { win?.postMessage(msg, APP); } catch { /* ventana cerrada o de otro origen */ } };
  const helloInfo = () => ({ version: VERSION, store: STORE, loggedIn: session.loggedIn, deliverTo: session.deliverTo, account: session.account, blocked: blockedHere(), title: document.title.slice(0, 120) });
  function hello() {
    if (EXT) { try { port?.postMessage({ type: 'hello', ...helloInfo() }); } catch { /* reconecta solo */ } } else post(appWin, { type: 'pcb:hello', ...helloInfo() });
  }
  const LEGACY = { fetch: ['pcb:data', 'pcb:error', 'product'], price: ['pcb:price-data', 'pcb:price-error', 'data'], orders: ['pcb:orders-data', 'pcb:orders-error', ''] };
  function reply(job, ok, payload) {
    if (EXT) { try { port?.postMessage(ok ? { type: 'result', id: job.id, ok: true, data: payload } : { type: 'result', id: job.id, ok: false, error: payload }); } catch { /* el service worker lo reenvía al reconectar */ } return; }
    const [okType, errType, key] = LEGACY[job.kind] || [];
    if (!okType) return;
    const base = { id: job.id, asin: job.asin, url: job.url };
    post(job.source, ok ? (key ? { type: okType, ...base, [key]: payload } : { type: okType, id: job.id, ...payload }) : { type: errType, ...base, error: payload });
  }
  function progress(job, done, total) {
    if (EXT) { try { port?.postMessage({ type: 'progress', id: job.id, done, total }); } catch { /* sin puerto */ } } else post(job.source, { type: 'pcb:orders-progress', id: job.id, done, total });
  }

  // ---------- cola de lecturas (pedidos repetidos del mismo ASIN o enlace se atienden con una sola lectura) ----------
  const stats = { done: 0, failed: 0, active: 0, lastError: '' };
  const queue = [];
  const byKey = new Map();
  function onJob(job) {
    if (job.kind === 'verify') return verify().then((r) => reply(job, true, r), (e) => reply(job, false, e.message));
    if (job.kind === 'orders') {
      if (STORE) return reply(job, false, 'Esta pestaña no es de Amazon.');
      if (orders.active) return reply(job, false, 'Ya estoy leyendo tus pedidos; espera a que termine.');
      const items = (Array.isArray(job.items) ? job.items : []).filter((it) => /^[A-Z0-9]{10}$/.test(it?.asin || '')).slice(0, 60)
        .map((it) => ({ asin: it.asin, query: String(it.query || '').slice(0, 80) }));
      return readOrders(items, (done, total) => progress(job, done, total)).then((r) => reply(job, true, r), (e) => reply(job, false, e.message));
    }
    let key = '';
    let run = null;
    if (job.kind === 'fetch' && !STORE && /^[A-Z0-9]{10}$/.test(job.asin || '')) { key = `f${job.asin}`; run = () => readAsin(job.asin); }
    if (job.kind === 'price' && STORE && typeof job.url === 'string') { key = `p${job.url}`; run = () => readPrice(job.url); }
    if (!run) return reply(job, false, `Pedido no válido para la pestaña de ${storeName}.`);
    let task = byKey.get(key);
    if (!task) { task = { key, run, jobs: [] }; byKey.set(key, task); queue.push(task); }
    task.jobs.push(job);
    pump();
  }
  function pump() {
    while (stats.active < CONCURRENCY && queue.length) {
      const task = queue.shift();
      stats.active++;
      task.run().then(
        (data) => { stats.done++; for (const j of task.jobs) reply(j, true, data); },
        (e) => { stats.failed++; stats.lastError = e.message; for (const j of task.jobs) reply(j, false, e.message); },
      ).finally(() => { byKey.delete(task.key); stats.active--; status(); setTimeout(pump, STORE ? 400 : 0); });
    }
    status();
  }

  function status() {
    if (disposed) return;
    const queued = queue.length + stats.active;
    const state = EXT
      ? (!port ? ['warn', 'Reconectando con la extensión…'] : linked ? ['ok', `${storeName} conectado al armador`] : ['warn', 'Extensión lista · abre el armador'])
      : (linked ? ['ok', `${STORE ? `${storeName} conectado` : 'Conectado'} al armador · deja esta pestaña abierta`] : ['warn', 'Sin armador conectado']);
    body.innerHTML = `
      <div class="s ${state[0]}">● ${esc(state[1])}</div>
      ${linked || EXT ? '' : STORE ? '<div class="m">Vuelve al armador y pulsa «Actualizar armado» o el botón de la tienda.</div>' : '<div class="m">Abre el armador y pulsa el estado de Amazon, o usa este botón:</div><button class="p" id="link">Conectar con el armador</button>'}
      ${STORE ? '' : `<div class="m">${session.loggedIn ? `Sesión: ${esc(session.account)}` : '<span class="warn">No detecté sesión iniciada</span>'}${session.deliverTo ? ` · entrega: ${esc(session.deliverTo)}` : ''}</div>`}
      <div class="m">${STORE ? 'Precios leídos' : 'Actualizados'}: ${stats.done}${queued ? ` · en curso: ${queued}` : ''}${stats.failed ? ` · <span class="err">errores: ${stats.failed}</span>` : ''}</div>
      ${orders.active ? `<div class="m">Leyendo tus pedidos: ${orders.done}/${orders.total} facturas…</div>` : ''}
      ${stats.lastError ? `<div class="m err">${esc(stats.lastError)}</div>` : ''}`;
    root.querySelector('#link')?.addEventListener('click', () => { appWin = window.open(`${APP}/`, 'pcb-armador'); });
  }

  let reconnectTimer = 0;
  function connectPort() {
    if (disposed || port) return;
    try {
      port = chrome.runtime.connect({ name: 'tab' });
    } catch {
      return dispose(); // la extensión se recargó o se quitó: la versión nueva se inyecta sola
    }
    port.onMessage.addListener((m) => {
      if (m?.type === 'job') onJob(m);
      else if (m?.type === 'app') { linked = !!m.linked; status(); }
      else if (m?.type === 'panel') togglePanel();
      else if (m?.type === 'ack') onAppAck?.(m);
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; /* leerlo evita «Unchecked runtime.lastError» (p. ej. al pasar a la caché atrás/adelante) */
      port = null;
      linked = false;
      status();
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectPort, 1000);
    });
    hello();
    status();
  }
  const onWinMessage = (e) => {
    if (e.origin !== APP) return;
    const m = e.data || {};
    appWin = e.source;
    if (!linked) { linked = true; status(); }
    if (m.type === 'pcb:ping') return hello();
    if (m.type === 'pcb:ack') return onAppAck?.(m);
    const kind = { 'pcb:fetch': 'fetch', 'pcb:price': 'price', 'pcb:orders': 'orders' }[m.type];
    if (kind) onJob({ ...m, kind, source: e.source });
  };
  const onPageShow = (e) => { if (e.persisted) connectPort(); }; // vuelta desde la caché atrás/adelante
  let heartbeat = 0;
  if (EXT) {
    addEventListener('pageshow', onPageShow);
    connectPort();
    heartbeat = setInterval(() => { try { port?.postMessage({ type: 'ping' }); } catch { /* reconecta solo */ } }, 20000);
  } else {
    addEventListener('message', onWinMessage);
    hello();
    heartbeat = setInterval(() => { if (appWin && !appWin.closed) hello(); else if (linked) { linked = false; status(); } }, 4000);
  }
  function dispose() {
    disposed = true;
    removeEventListener('message', onWinMessage);
    removeEventListener('pageshow', onPageShow);
    clearInterval(heartbeat);
    clearTimeout(reconnectTimer);
    try { port?.disconnect(); } catch { /* ya cerrado */ }
    host.remove();
  }
  window.__pcbConnector = {
    dispose,
    request: STORE ? readPrice : readAsin, // diagnóstico desde la consola: await __pcbConnector.request('B0...' | location.href)
    verify,
    orders: (items) => readOrders(items, () => {}), // await __pcbConnector.orders([{ asin: 'B0...', query: 'Marca Modelo' }])
    stats,
  };
  root.querySelector('#close').onclick = () => (EXT ? (host.hidden = true) : dispose());
  status();

  // ---------- la ficha abierta: precio (tienda) o agregar al armador (Amazon) ----------
  let shown = false;
  function togglePanel() {
    host.hidden = !host.hidden;
    if (!host.hidden && !shown) { shown = true; showHere(); }
  }
  async function showHere() {
    if (STORE) {
      // En una ficha, muestra el precio que se leería (sirve para comprobar el lector).
      const here = readStorePrice(document.documentElement.outerHTML, STORE);
      if (here.price != null) panel.innerHTML = `<div class="t">${esc(here.title)}</div><div class="kv"><span>Precio en ${esc(storeName)}</span><span>${here.currency === 'COP' ? 'COP ' + here.price.toLocaleString('es-CO') : 'US$' + here.price.toFixed(2)}</span></div><div class="m">Para guardarlo: en el armador, Producto → Tiendas → «+ Agregar tienda» y pega este enlace.</div>`;
      return;
    }
    const asin = (location.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i) || [])[1] || q('#ASIN')?.value || q('input[name="ASIN"]')?.value;
    if (!asin || !q(SEL.title)) return;
    panel.innerHTML = '<div class="m">Leyendo este producto con tu sesión…</div>';
    let product;
    try {
      product = await readAsin(asin);
      // Lo que la ficha descargada no trajo se completa con la página abierta.
      const live = readProduct(reader(document, true));
      const empty = (v) => v == null || v === '' || (typeof v === 'object' && !Object.keys(v).length);
      for (const [k, v] of Object.entries(live)) if (empty(product[k]) && !empty(v)) product[k] = v;
    } catch (e) {
      panel.innerHTML = `<div class="m err">${esc(e.message)}</div>`;
      return;
    }

    const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const done = (m) => { panel.innerHTML = `<div class="s ok">${m}</div>`; };
    function send(cat) {
      onAppAck = (m) => { onAppAck = null; done(`✓ ${esc(m.text || 'Agregado al armador')}`); };
      if (EXT) {
        if (!port) return done('<span class="err">Sin conexión con la extensión: recarga esta página.</span>');
        port.postMessage({ type: 'add', cat, product });
        return done(linked ? 'Enviando al armador…' : 'Abriendo el armador…');
      }
      const msg = { type: 'pcb:add', cat, product, connector: VERSION };
      const target = appWin && !appWin.closed ? appWin : null;
      if (!target) {
        // Sin armador conectado: abre uno nuevo con el producto.
        window.open(`${APP}/#add=${b64(JSON.stringify(msg))}`, '_blank');
        return done('✓ Enviado. Revisa la pestaña del armador.');
      }
      post(target, msg);
    }

    const cur = product.currency === 'COP' ? 'COP ' : 'US$';
    const fmt = (n) => (n == null ? '<span class="warn">—</span>' : n === 0 ? `${cur}0` : cur + n.toLocaleString('en-US', { minimumFractionDigits: product.currency === 'COP' ? 0 : 2, maximumFractionDigits: 2 }));
    const guess = new URLSearchParams(location.hash.slice(1)).get('pcb') || guessCategory(product.title);
    panel.innerHTML = `
      <div class="t">${esc(product.title)}</div>
      <div class="kv">
        <span>Precio</span><span>${fmt(product.price)}${product.priceSource === 'oferta' ? ' (oferta)' : ''}</span>
        <span>Envío a CO</span><span>${product.shipping === 0 ? 'Gratis' : fmt(product.shipping)}</span>
        <span>Cargos de importación</span><span>${product.importFeesInfo === 'no-informado' ? 'no informados' : fmt(product.importFees)}</span>
        <span>Total</span><span>${fmt(product.total)}</span>
        <span>Vendedor</span><span>${esc(product.seller || '—')}</span>
        <span>Envía a Colombia</span><span class="${product.shipsToCO ? 'ok' : product.shipsToCO === false ? 'err' : 'warn'}">${product.shipsToCO ? 'Sí' : product.shipsToCO === false ? 'No' : 'Sin confirmar'}</span>
      </div>
      ${product.locationOk ? '' : `<div class="m err">No detecté entrega a Colombia (entrega: "${esc(product.deliverTo || '?')}").</div>`}
      ${product.condition !== 'Nuevo' ? '<div class="m err">El título indica que no es nuevo.</div>' : ''}
      <div class="m">¿En qué categoría lo agrego?</div>
      <div class="cats">${CATS.map((c) => `<button class="c ${c.key === guess ? 'g' : ''}" data-cat="${c.key}">${c.name}</button>`).join('')}</div>`;
    root.querySelectorAll('button.c').forEach((b) => { b.onclick = () => send(b.dataset.cat); });
  }
  // Marcador: se pulsó en esta página, así que se muestra de una. Extensión: al buscar desde el armador (#pcb=).
  if (!EXT || /(^|&)pcb=/.test(location.hash.slice(1))) { if (EXT) host.hidden = false; shown = true; showHere(); }
})();
