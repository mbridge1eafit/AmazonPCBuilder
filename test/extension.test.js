// Enrutador del service worker de la extensión (extension/router.js) con un `chrome` simulado:
// pedidos en cola sin pestaña, reconexión al recargar la tienda o el armador, verificación, tiempos y agregar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRouter, channelOf, matchRe, AMAZON, TIMEOUT } from '../extension/router.js';
import { STORES } from '../public/js/connector/store-parse.js';

const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

function fakePort(name, sender) {
  const msgs = [];
  const onMsg = [];
  const onDis = [];
  const port = {
    name, sender, msgs,
    postMessage: (m) => { if (port.closed) throw new Error('cerrado'); msgs.push(structuredClone(m)); },
    onMessage: { addListener: (fn) => onMsg.push(fn) },
    onDisconnect: { addListener: (fn) => onDis.push(fn) },
    disconnect() { port.closed = true; },
    emit: (m) => onMsg.forEach((fn) => fn(m)),
    drop() { port.closed = true; onDis.forEach((fn) => fn()); },
    last: (type) => msgs.filter((m) => m.type === type).at(-1),
    all: (type) => msgs.filter((m) => m.type === type),
    closed: false,
  };
  return port;
}

function setup({ openTabs = [] } = {}) {
  const listeners = { connect: [], installed: [], removed: [], action: [] };
  const calls = { created: [], injected: [], focused: [], reloaded: 0 };
  let nextTab = 100;
  const timers = [];
  const chrome = {
    runtime: {
      getManifest: () => manifest,
      onConnect: { addListener: (fn) => listeners.connect.push(fn) },
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      reload: () => { calls.reloaded++; },
    },
    tabs: {
      query: async ({ url }) => openTabs.filter((t) => [].concat(url).some((p) => matchRe(p).test(t.url))),
      create: async ({ url, active }) => { const t = { id: nextTab++, url, active, windowId: 1 }; calls.created.push(t); return t; },
      update: async (id) => { calls.focused.push(id); return { id, windowId: 1 }; },
      reload: async () => {},
      onRemoved: { addListener: (fn) => listeners.removed.push(fn) },
    },
    windows: { update: async () => {} },
    scripting: { executeScript: async ({ target, files }) => { calls.injected.push({ tabId: target.tabId, files }); } },
    storage: { local: { set: () => {}, get: async () => ({}) } },
    action: { onClicked: { addListener: (fn) => listeners.action.push(fn) } },
  };
  let clock = 1_000_000;
  const router = createRouter(chrome, {
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, at: clock + ms, done: false }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.done = true; },
  });
  const connect = (port) => { listeners.connect.forEach((fn) => fn(port)); return port; };
  const app = (url = 'http://localhost:4330/') => connect(fakePort('app', { url }));
  const tab = (id, url) => connect(fakePort('tab', { url, tab: { id, url, windowId: 1 } }));
  const advance = (ms) => { clock += ms; for (const t of timers) if (!t.done && t.at <= clock) { t.done = true; t.fn(); } };
  return { router, chrome, calls, app, tab, advance, listeners, flush: () => new Promise((r) => setTimeout(r, 0)) };
}
const chan = (port, origin) => port.last('status').channels.find((c) => c.origin === origin);

test('canal: todo amazon.com es uno; cada tienda, su origen; solo https', () => {
  assert.equal(channelOf('https://amazon.com/dp/B0'), AMAZON);
  assert.equal(channelOf('https://smile.amazon.com/x'), AMAZON);
  assert.equal(channelOf('https://www.newegg.com/p/N82E1'), 'https://www.newegg.com');
  assert.equal(channelOf('https://articulo.mercadolibre.com.co/MCO-1'), 'https://articulo.mercadolibre.com.co');
  assert.equal(channelOf('http://www.newegg.com/'), null);
  assert.equal(channelOf('no es url'), null);
});

test('manifiesto: el conector corre en Amazon y en todas las tiendas; el puente solo en el armador', () => {
  const cs = manifest.content_scripts.find((c) => c.js.includes('connector.js'));
  const bridge = manifest.content_scripts.find((c) => c.js.includes('bridge.js'));
  const covers = (patterns, url) => patterns.some((p) => matchRe(p).test(url));
  for (const [key, s] of Object.entries(STORES)) {
    const host = s.amazon ? 'www.amazon.com' : { mercadolibre: 'articulo.mercadolibre.com.co', bhphoto: 'www.bhphotovideo.com' }[key] || `www.${key}.com`;
    assert.ok(s.host.test(host), `host de prueba de ${key}`);
    assert.ok(covers(cs.matches, `https://${host}/x`), `el conector cubre ${key}`);
    assert.ok(covers(manifest.host_permissions, `https://${host}/x`), `permiso para ${key}`);
  }
  assert.ok(covers(bridge.matches, 'http://localhost:4330/') && covers(bridge.matches, 'https://pc.tailnet.ts.net/'));
  assert.ok(!covers(cs.matches, 'https://evilamazon.com/') && !covers(cs.matches, 'http://localhost:4330/'));
});

test('precio sin pestaña: espera, «Conectar» abre la tienda en segundo plano y al saludar se lee', async () => {
  const { app, tab, calls, flush } = setup();
  const a = app();
  const url = 'https://www.newegg.com/p/N82E16820147861';
  a.emit({ type: 'job', id: 'p1', kind: 'price', url });
  assert.deepEqual([chan(a, 'https://www.newegg.com').state, chan(a, 'https://www.newegg.com').queued], ['none', 1]);
  a.emit({ type: 'connect', origin: 'https://www.newegg.com', url });
  await flush();
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].url, url);
  assert.equal(calls.created[0].active, false);
  assert.equal(chan(a, 'https://www.newegg.com').state, 'opening');
  const t = tab(calls.created[0].id, url);
  t.emit({ type: 'hello', version: 'v1', store: 'newegg' });
  const job = t.all('job').find((m) => m.kind === 'price');
  assert.equal(job.url, url);
  assert.equal(chan(a, 'https://www.newegg.com').state, 'connected');
  t.emit({ type: 'result', id: 'p1', ok: true, data: { price: 99.99 } });
  assert.deepEqual(a.last('result'), { type: 'result', id: 'p1', ok: true, data: { price: 99.99 } });
});

test('recargar la pestaña de la tienda a mitad de lectura: se reenvía a la nueva y responde una vez', () => {
  const { app, tab } = setup();
  const a = app();
  const url = 'https://www.bestbuy.com/site/x/123.p';
  const t1 = tab(7, url);
  t1.emit({ type: 'hello', version: 'v1', store: 'bestbuy' });
  a.emit({ type: 'job', id: 'p1', kind: 'price', url });
  assert.ok(t1.all('job').some((m) => m.id === 'p1'));
  t1.drop(); // recarga
  assert.equal(chan(a, 'https://www.bestbuy.com').queued, 1);
  t1.emit({ type: 'result', id: 'p1', ok: true, data: { price: 1 } }); // respuesta tardía del puerto muerto: se ignora
  assert.equal(a.all('result').length, 0);
  const t2 = tab(7, url);
  t2.emit({ type: 'hello', version: 'v1', store: 'bestbuy' });
  assert.ok(t2.all('job').some((m) => m.id === 'p1'));
  t2.emit({ type: 'result', id: 'p1', ok: true, data: { price: 2 } });
  t2.emit({ type: 'result', id: 'p1', ok: true, data: { price: 3 } });
  assert.deepEqual(a.all('result').map((r) => r.data.price), [2]);
});

test('recargar el armador: lo suyo se descarta, el nuevo recibe el estado y puede reenviar', () => {
  const { app, tab } = setup();
  const t = tab(3, 'https://www.amazon.com/');
  t.emit({ type: 'hello', version: 'v1', loggedIn: true, deliverTo: 'Medellin 050022' });
  const a1 = app();
  assert.deepEqual(t.last('app'), { type: 'app', linked: true });
  a1.emit({ type: 'job', id: 'f1', kind: 'fetch', asin: 'B0ABCDEFGH' });
  a1.drop();
  assert.deepEqual(t.last('app'), { type: 'app', linked: false });
  const a2 = app();
  const c = chan(a2, AMAZON);
  assert.deepEqual([c.state, c.deliverTo, c.running], ['connected', 'Medellin 050022', 0]);
  a2.emit({ type: 'job', id: 'f1', kind: 'fetch', asin: 'B0ABCDEFGH' });
  t.emit({ type: 'result', id: 'f1', ok: false, error: 'Amazon pide un CAPTCHA' });
  assert.deepEqual(a2.last('result'), { type: 'result', id: 'f1', ok: false, error: 'Amazon pide un CAPTCHA' });
});

test('verificar: automático al conectar y con el botón; el resultado queda en el estado del canal', () => {
  const { app, tab } = setup();
  const a = app();
  const t = tab(5, 'https://www.walmart.com/ip/1');
  t.emit({ type: 'hello', version: 'v1', store: 'walmart' });
  const v1 = t.last('job');
  assert.equal(v1.kind, 'verify');
  assert.equal(chan(a, 'https://www.walmart.com').check.running, true);
  t.emit({ type: 'result', id: v1.id, ok: true, data: { ok: false, status: 200, detail: 'Walmart pide una verificación (CAPTCHA)', at: '2026-11-10T12:00:00.000Z' } });
  let c = chan(a, 'https://www.walmart.com');
  assert.deepEqual([c.state, c.check.ok, c.check.detail, c.queued, c.running], ['connected', false, 'Walmart pide una verificación (CAPTCHA)', 0, 0]);
  a.emit({ type: 'verify', origin: 'https://www.walmart.com' });
  const v2 = t.last('job');
  assert.notEqual(v2.id, v1.id);
  t.emit({ type: 'result', id: v2.id, ok: true, data: { ok: true, status: 200, ms: 320 } });
  c = chan(a, 'https://www.walmart.com');
  assert.deepEqual([c.check.ok, c.check.ms], [true, 320]);
  // Una recarga con la verificación reciente y buena no vuelve a verificar.
  const before = t.all('job').length;
  t.drop();
  const t2 = tab(5, 'https://www.walmart.com/ip/1');
  t2.emit({ type: 'hello', version: 'v1', store: 'walmart' });
  assert.equal(t2.all('job').length, 0);
  assert.equal(before, 2);
});

test('sin respuesta: el pedido falla con su mensaje; la pestaña que abre y no saluda pasa a «sin respuesta»', async () => {
  const { app, tab, advance, flush } = setup();
  const a = app();
  const t = tab(9, 'https://www.target.com/p/x');
  t.emit({ type: 'hello', version: 'v1', store: 'target' });
  t.emit({ type: 'result', id: t.last('job').id, ok: true, data: { ok: true } });
  a.emit({ type: 'job', id: 'p9', kind: 'price', url: 'https://www.target.com/p/x' });
  advance(TIMEOUT.price + 1);
  assert.equal(a.last('result').ok, false);
  assert.match(a.last('result').error, /no respondió/);
  a.emit({ type: 'connect', origin: 'https://www.newegg.com' });
  await flush();
  assert.equal(chan(a, 'https://www.newegg.com').state, 'opening');
  advance(60000);
  a.emit({ type: 'status' });
  assert.equal(chan(a, 'https://www.newegg.com').state, 'stuck');
});

test('pestaña abierta antes de instalar la extensión: «Conectar» la adopta (inyecta el conector) en vez de abrir otra', async () => {
  const { app, calls, flush } = setup({ openTabs: [{ id: 42, url: 'https://www.bhphotovideo.com/c/product/1.html' }] });
  const a = app();
  a.emit({ type: 'connect', origin: 'https://www.bhphotovideo.com' });
  await flush(); await flush();
  assert.equal(calls.created.length, 0);
  assert.deepEqual(calls.injected, [{ tabId: 42, files: ['connector.js'] }]);
  assert.equal(chan(a, 'https://www.bhphotovideo.com').state, 'opening');
});

test('agregar desde Amazon sin armador abierto: abre el armador y se lo entrega al conectar; el acuse vuelve a la pestaña', async () => {
  const { app, tab, calls, flush } = setup();
  const t = tab(11, 'https://www.amazon.com/dp/B0ABCDEFGH');
  t.emit({ type: 'hello', version: 'v1', loggedIn: true, deliverTo: 'Medellin' });
  t.emit({ type: 'add', cat: 'ssd', product: { asin: 'B0ABCDEFGH' } });
  await flush(); await flush();
  assert.equal(calls.created.at(-1).url, 'http://localhost:4330/');
  const a = app();
  const add = a.last('add');
  assert.equal(add.cat, 'ssd');
  a.emit({ type: 'ack', addId: add.addId, text: 'Agregado a SSD' });
  assert.deepEqual(t.last('ack'), { type: 'ack', text: 'Agregado a SSD' });
});

test('solo el armador puede abrir un puerto de app', () => {
  const { app } = setup();
  const evil = app('https://evil.example/');
  assert.equal(evil.closed, true);
  assert.equal(app('http://127.0.0.1:4330/').closed, false);
  assert.equal(app('https://pc.tailnet.ts.net/').closed, false);
});

test('connector.js de la extensión: el mismo conector empaquetado, válido y sin origen del armador', async () => {
  const { createConnector } = await import('../server/connector-bundle.js');
  const c = createConnector(new URL('../public/js/connector/', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1'));
  const code = await c.bundle(null);
  assert.doesNotThrow(() => new Function(code));
  assert.match(code, /const APP = null;/);
  assert.match(code, new RegExp(`const VERSION = "${await c.version()}";`));
  assert.match(code, /chrome\.runtime\.connect\(\{ name: 'tab' \}\)/);
});
