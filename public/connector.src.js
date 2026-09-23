// Conector (marcador) que corre DENTRO de amazon.com con tu sesión.
// El servidor lo empaqueta en /api/connector junto con amazon-parse.js e inyecta el origen del armador, la versión y las categorías.
//
// Al pulsarlo queda conectado al armador (la pestaña que abrió esta, o la que este abra) y atiende sus pedidos:
//   armador → { type: 'pcb:fetch', id, asin }      conector → { type: 'pcb:data', id, asin, product } | { type: 'pcb:error', id, asin, error }
// Cada pedido descarga la ficha (/dp/ASIN?th=1&psc=1) y las ofertas en paralelo, con tus cookies, y las lee con
// las mismas funciones compartidas (readProduct/readOffers). Si la página abierta es un producto, además ofrece agregarlo.
(async () => {
  const APP = __APP__;
  const VERSION = __VERSION__;
  const CATS = __CATS__;
  const CONCURRENCY = 2;
  const q = (s) => document.querySelector(s);

  if (!/(^|\.)amazon\.com$/i.test(location.hostname)) {
    alert('Armador PC: abre amazon.com (con tu sesión iniciada) y pulsa de nuevo el marcador.');
    return;
  }
  window.__pcbConnector?.dispose(); // pulsarlo otra vez reinicia el conector

  // ---------- interfaz flotante (shadow DOM para aislarla de los estilos de Amazon) ----------
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    .b{width:350px;font:14px/1.4 system-ui,Segoe UI,sans-serif;background:#1c1b1a;color:#efece6;border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.45);padding:12px 16px 14px;border:1px solid #33312e}
    .b.min{width:auto;padding:8px 12px}.b.min #body,.b.min #product{display:none}
    .h{display:flex;justify-content:space-between;align-items:center;gap:8px}.h b{font-size:15px}.h b::before{content:"";display:inline-block;width:10px;height:14px;border-radius:3px;background:#ff8a3d;margin-right:8px;vertical-align:-1px}
    .x{background:none;border:0;color:#a29d93;font-size:16px;cursor:pointer;padding:2px 4px}
    .t{font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .kv{display:grid;grid-template-columns:1fr auto;gap:2px 10px;margin:8px 0;font-size:13px}.kv span:nth-child(odd){color:#a29d93}.kv span:nth-child(even){text-align:right;font-variant-numeric:tabular-nums}
    .ok{color:#4cc27f}.warn{color:#e5b04e}.err{color:#f06b62}
    .cats{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
    button.c,button.p{padding:7px 8px;border-radius:8px;border:1px solid #33312e;background:#252422;color:#efece6;cursor:pointer;font:inherit;font-size:12.5px;text-align:left}
    button.c:hover{border-color:#ff8a3d}button.c.g{border-color:#ff8a3d;background:#3a2616}
    button.p{background:#ff8a3d;border-color:#ff8a3d;color:#fff;font-weight:600;text-align:center;width:100%;margin-top:8px}
    .m{font-size:13px;color:#a29d93;margin-top:6px}.s{font-size:13px;margin-top:6px}
    #product{border-top:1px solid #33312e;margin-top:10px;padding-top:10px}#product:empty{display:none}
  </style><div class="b"><div class="h"><b>Armador PC</b><span><button class="x" id="min" title="Minimizar">–</button><button class="x" id="close" title="Cerrar conector">✕</button></span></div>
  <div id="body"></div><div id="product"></div></div>`;
  document.body.append(host);
  const box = root.querySelector('.b');
  const body = root.querySelector('#body');
  const panel = root.querySelector('#product');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  root.querySelector('#min').onclick = () => box.classList.toggle('min');

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
  });
  const parse = (html) => {
    const d = new DOMParser().parseFromString(html, 'text/html');
    d.querySelectorAll('script, style, noscript').forEach((x) => x.remove());
    return d;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const get = async (url, headers = {}) => {
    const r = await fetch(url, { credentials: 'include', headers });
    return { status: r.status, html: await r.text() };
  };
  const account = clean(q('#nav-link-accountList-nav-line-1')?.textContent);
  const loggedIn = !!account && !/Identif|sign in/i.test(account);
  const deliverTo = clean(q('#glow-ingress-line2')?.textContent);

  async function readAsin(asin) {
    // Ficha y ofertas en paralelo. Si Amazon sirve la variante sin ubicación, reintenta la ficha una vez.
    let [dp, aod] = await Promise.all([get(`/dp/${asin}?th=1&psc=1`), get(aodUrl(asin), { 'x-requested-with': 'XMLHttpRequest' }).catch(() => ({ html: '' }))]);
    let d = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) { await sleep(1200); dp = await get(`/dp/${asin}?th=1&psc=1`); }
      if (/captchacharacters|validateCaptcha/i.test(dp.html)) throw new Error('Amazon pide un CAPTCHA: resuélvelo en la pestaña de Amazon y reintenta.');
      if (dp.status === 404) throw new Error('El producto ya no existe en amazon.com.');
      if (/id="productTitle"/.test(dp.html)) d = readProduct(reader(parse(dp.html), false));
      if (d?.locationOk) break;
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
    return { asin, url: `https://www.amazon.com/dp/${asin}`, ...d, offers, priceSource, source: 'sesion', loggedIn, fetchedAt: new Date().toISOString() };
  }

  // ---------- servicio para el armador ----------
  const jobs = new Map(); // asin → [{ id, source }]  (pedidos repetidos del mismo ASIN se atienden con una sola lectura)
  const pending = [];
  const stats = { done: 0, failed: 0, active: 0, lastError: '' };
  let appWin = window.opener; // la pestaña del armador con la que se habla
  let linked = false;

  const post = (win, msg) => { try { win?.postMessage(msg, APP); } catch { /* ventana cerrada o de otro origen */ } };
  const hello = (win) => post(win, { type: 'pcb:hello', version: VERSION, loggedIn, deliverTo });

  function pump() {
    while (stats.active < CONCURRENCY && pending.length) {
      const asin = pending.shift();
      stats.active++;
      readAsin(asin).then(
        (product) => { stats.done++; for (const j of jobs.get(asin) || []) post(j.source, { type: 'pcb:data', id: j.id, asin, product }); },
        (e) => { stats.failed++; stats.lastError = e.message; for (const j of jobs.get(asin) || []) post(j.source, { type: 'pcb:error', id: j.id, asin, error: e.message }); },
      ).finally(() => { jobs.delete(asin); stats.active--; status(); pump(); });
    }
    status();
  }

  function status() {
    const queued = pending.length + stats.active;
    body.innerHTML = `
      <div class="s ${linked ? 'ok' : 'warn'}">${linked ? '● Conectado al armador · deja esta pestaña abierta' : '● Sin armador conectado'}</div>
      ${linked ? '' : `<div class="m">Abre el armador y pulsa «Conectar Amazon», o usa este botón:</div><button class="p" id="link">Conectar con el armador ↗</button>`}
      <div class="m">${loggedIn ? `Sesión: ${esc(account)}` : '<span class="warn">No detecté sesión iniciada</span>'}${deliverTo ? ` · entrega: ${esc(deliverTo)}` : ''}</div>
      <div class="m">Actualizados: ${stats.done}${queued ? ` · en curso: ${queued}` : ''}${stats.failed ? ` · <span class="err">errores: ${stats.failed}</span>` : ''}</div>
      ${stats.lastError ? `<div class="m err">${esc(stats.lastError)}</div>` : ''}`;
    root.querySelector('#link')?.addEventListener('click', () => { appWin = window.open(`${APP}/`, 'pcb-armador'); });
  }

  const onMessage = (e) => {
    if (e.origin !== APP) return;
    const m = e.data || {};
    appWin = e.source;
    if (!linked) { linked = true; status(); }
    if (m.type === 'pcb:ping') return hello(e.source);
    if (m.type === 'pcb:fetch' && /^[A-Z0-9]{10}$/.test(m.asin || '')) {
      if (!jobs.has(m.asin)) { jobs.set(m.asin, []); pending.push(m.asin); }
      jobs.get(m.asin).push({ id: m.id, source: e.source });
      pump();
    }
  };
  addEventListener('message', onMessage);
  hello(window.opener);
  const heartbeat = setInterval(() => { if (appWin && !appWin.closed) hello(appWin); else if (linked) { linked = false; status(); } }, 4000);
  window.__pcbConnector = {
    dispose() { removeEventListener('message', onMessage); clearInterval(heartbeat); host.remove(); },
    request: readAsin, // diagnóstico desde la consola: await __pcbConnector.request('B0...')
    stats,
  };
  root.querySelector('#close').onclick = () => window.__pcbConnector.dispose();
  status();

  // ---------- agregar el producto de esta página ----------
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
    const msg = { type: 'pcb:add', cat, product, connector: VERSION };
    const target = appWin && !appWin.closed ? appWin : null;
    if (!target) {
      // Sin armador conectado: abre uno nuevo con el producto; si ya hay otro abierto, se lo pasa y se cierra.
      window.open(`${APP}/#add=${b64(JSON.stringify(msg))}`, '_blank');
      return done('✓ Enviado. Revisa la pestaña del armador.');
    }
    const onAck = (e) => {
      if (e.origin !== APP || e.data?.type !== 'pcb:ack') return;
      removeEventListener('message', onAck);
      done(`✓ ${esc(e.data.text || 'Agregado al armador')}`);
    };
    addEventListener('message', onAck);
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
})();
