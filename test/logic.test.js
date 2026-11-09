import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectTags, estimateWatts, lineCost, totals, checks, isSurgeProtector, DEFAULT_SETTINGS } from '../public/logic.js';
import { extractAsin, money } from '../public/amazon-parse.js';

const S = DEFAULT_SETTINGS;
const mk = (title, extra = {}) => ({ id: Math.random().toString(36), title, status: 'buy', qty: 1, ...extra });
const buildWith = (parts) => ({
  name: 't',
  parts: Object.fromEntries(Object.entries(parts).map(([k, ps]) => [k, { options: ps, selected: ps.map((p) => p.id) }])),
});

test('extractAsin acepta enlaces y ASIN sueltos', () => {
  assert.equal(extractAsin('https://www.amazon.com/MSI-MPG-A850GS/dp/B0DQ9PDT22/ref=sr_1_1?x=1'), 'B0DQ9PDT22');
  assert.equal(extractAsin('https://www.amazon.com/gp/product/B0CB9MSJ5N'), 'B0CB9MSJ5N');
  assert.equal(extractAsin('b0dbr3dzwg'), 'B0DBR3DZWG');
  assert.equal(extractAsin('https://google.com'), null);
});

test('money lee formatos de Amazon', () => {
  assert.equal(money('US$1,234.56'), 1234.56);
  assert.equal(money('$99.99'), 99.99);
  assert.equal(money('sin precio'), null);
});

test('detecta socket, memoria y formato', () => {
  assert.equal(detectTags(mk('AMD Ryzen 5 9600X'), 'cpu').socket, 'AM5');
  const mb = detectTags(mk('MSI MAG B850 Tomahawk WiFi ATX'), 'motherboard');
  assert.deepEqual([mb.socket, mb.memType, mb.formFactor], ['AM5', 'DDR5', 'ATX']);
  const tomahawk = detectTags(mk('MSI MAG B850 Tomahawk WiFi ATX', {
    bullets: ['TRIPLE M.2 CONNECTORS - Storage options include 1 x M.2 Gen5 x4 128Gbps slot and 2 x M.2 Gen4 x4 64Gbps slots;']
  }), 'motherboard');
  assert.equal(tomahawk.m2Slots, 3);
  assert.equal(detectTags(mk('ASUS TUF B550M-PLUS Micro-ATX DDR4'), 'motherboard').formFactor, 'Micro-ATX');
  assert.equal(detectTags(mk('ARCTIC P12 PWM PST (5 Pack) - Ventiladores'), 'fans').count, 5);
  assert.equal(detectTags(mk('Thermalright Ventilador de CPU TL-C12C X3, ventilador'), 'fans').count, 3);
  assert.equal(detectTags(mk('CORSAIR RS120 120mm PWM Fans – Daisy-Chain Connection – Triple Pack – Black'), 'fans').count, 3);
  assert.equal(detectTags(mk('Noctua NF-A12x25, Dual-Pack'), 'fans').count, 2);
  assert.equal(detectTags(mk('Ventiladores 120 mm ARGB, pack cuádruple'), 'fans').count, 4);
  const psu = detectTags(mk('MSI MPG A850GS PCIE5, 850W, 80 Plus Gold, ATX 3.1, 12V-2x6'), 'psu');
  assert.deepEqual([psu.psuWatts, psu.has12v2x6], [850, true]);
  assert.equal(detectTags(mk('Thermaltake GF A3 850W, 12VHPWR'), 'psu').has12v2x6, 'adaptable');
});

test('las etiquetas del usuario tienen prioridad', () => {
  assert.equal(detectTags(mk('Placa rara', { tags: { socket: 'AM5' } }), 'motherboard').socket, 'AM5');
});

test('consumo: GPU por modelo y override manual', () => {
  assert.equal(estimateWatts(mk('Gigabyte RTX 5070 Ti Gaming OC'), 'gpu'), 300);
  assert.equal(estimateWatts(mk('x', { watts: 42 }), 'gpu'), 42);
  assert.equal(estimateWatts(mk('ARCTIC P12 (5 Pack)'), 'fans'), 15);
});

test('consumo: modelos antiguos, CPU por modelo, ventiladores incluidos', () => {
  assert.equal(estimateWatts(mk('EVGA GeForce GTX 1650 Super SC Ultra'), 'gpu'), 100);
  assert.equal(estimateWatts(mk('MSI RTX 3060 Ti Ventus'), 'gpu'), 200);
  assert.equal(estimateWatts(mk('Tarjeta X', { bullets: ['2x faster than RTX 4090'] }), 'gpu'), 250, 'las viñetas no cuentan');
  assert.equal(estimateWatts(mk('AMD Ryzen 5 9600X'), 'cpu'), 88);
  assert.equal(estimateWatts(mk('AMD Ryzen 7 9800X3D'), 'cpu'), 162);
  assert.equal(estimateWatts(mk('Intel Core i9-14900KF'), 'cpu'), 253);
  assert.equal(estimateWatts(mk('CORSAIR 4000D RS ARGB, 3X Pre-Installed RS Fans'), 'case'), 12);
  assert.equal(estimateWatts(mk('Arctic Liquid Freezer III 360 AIO'), 'cooler'), 14);
});

test('costo: usa cargos de Amazon o estima IVA sobre el umbral', () => {
  assert.equal(lineCost(mk('a', { price: 99.99, shipping: 6.99, importFees: 0 }), S).total, 106.98);
  const over = lineCost(mk('b', { price: 239.98, shipping: 0, importFees: 47.64 }), S);
  assert.equal(over.overThreshold, true);
  assert.equal(over.feesSource, 'amazon');
  const est = lineCost(mk('c', { price: 250, shipping: 10 }), S);
  assert.equal(est.importFees, 49.4);
  assert.equal(est.feesSource, 'estimado');
  assert.equal(lineCost(mk('d', { price: 150, shipping: 0 }), S).importFees, 0);
});

test('totales separan comprado, planeado y por comprar', () => {
  const b = buildWith({
    cpu: [mk('Ryzen 5 9600X', { status: 'bought', price: 200, manual: true })],
    gpu: [mk('RTX 5070 Ti', { status: 'planned', price: 750, manual: true })],
    psu: [mk('MSI 850W', { price: 99.99, shipping: 6.99, importFees: 0 })],
  });
  const t = totals(b, S);
  assert.equal(t.orders, 1);
  assert.equal(t.toBuyTotal, 106.98);
  assert.equal(t.spent, 200);
  assert.equal(t.planned, 750);
});

test('totales: lo ya comprado cuenta con envío e impuestos', () => {
  const b = buildWith({ cpu: [mk('Ryzen 5 9600X', { status: 'bought', price: 175.5, shipping: 12, importFees: 3.5 })] });
  assert.equal(totals(b, S).spent, 191);
});

test('checks: socket incompatible y fuente sin 12V-2x6', () => {
  const b = buildWith({
    cpu: [mk('Ryzen 5 9600X')],
    motherboard: [mk('ASUS B550 DDR4 ATX')],
    gpu: [mk('RTX 5070 Ti')],
    psu: [mk('EVGA 500W Bronze', { price: 50 })],
  });
  const list = checks(b, S);
  assert.ok(list.some((c) => c.level === 'error' && c.title === 'Socket incompatible'));
  assert.ok(list.some((c) => c.level === 'error' && c.title === 'Falta conector 12V-2x6'));
  assert.ok(list.some((c) => c.level === 'warn' && c.title === 'Fuente justa')); // ~438 W estimados, se recomiendan 600 W
});

test('el armado de ejemplo no tiene errores de compatibilidad', () => {
  const seed = JSON.parse(readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
  const errs = checks(seed.builds[0], seed.settings).filter((c) => c.level === 'error');
  assert.deepEqual(errs, []);
});

test('needsRefresh: omite lo reciente y completo, siempre completa lo faltante', async () => {
  const { needsRefresh, missingFields } = await import('../public/logic.js');
  const now = Date.parse('2026-09-19T12:00:00Z');
  const full = { source: 'sesion', url: 'https://www.amazon.com/dp/B0DQ9PDT22', price: 99.99, shipping: 6.99, importFees: 0, shipsToCO: true, seller: 'Amazon.com', image: 'x', availability: 'In Stock', specs: { a: 1 }, locationOk: true };
  const s = { ...DEFAULT_SETTINGS, refreshMinutes: 10 };
  assert.deepEqual(missingFields(full), []);
  assert.equal(needsRefresh({ ...full, fetchedAt: '2026-09-19T11:55:00Z' }, s, now), false);
  assert.equal(needsRefresh({ ...full, fetchedAt: '2026-09-19T11:45:00Z' }, s, now), true);
  assert.equal(needsRefresh({ ...full, importFees: null, fetchedAt: '2026-09-19T11:59:00Z' }, s, now), true);
  assert.deepEqual(missingFields({ ...full, importFees: null, locationOk: false }), ['cargos de importación', 'entrega en Colombia']);
  assert.equal(needsRefresh({ title: 'manual', manual: true }, s, now), false); // sin enlace de Amazon no hay nada que leer
});

test('applySession: reescribe todo lo de Amazon (incluida la foto) y conserva lo del usuario', async () => {
  const { applySession } = await import('../public/logic.js');
  // Producto ya comprado, manual, sin enlace; se vincula a Amazon y se lee con la sesión.
  const p = { id: 'x', manual: true, status: 'bought', qty: 2, tags: { socket: 'AM5' }, notes: 'comprado en agosto', title: 'MSI B850 (manual)', image: null, price: null, store: 'Ya comprado', history: [] };
  applySession(p, { asin: 'B0G3SVRLT3', url: 'https://www.amazon.com/dp/B0G3SVRLT3', title: 'MSI MAG B850 Tomahawk WiFi', image: 'https://m.media-amazon.com/images/I/81SKBZ1sZnL.jpg', fetchedAt: '2026-09-19T03:30:04Z', price: 179, shipping: 17.38, importFees: 0, total: 196.38, shipsToCO: true, locationOk: true, seller: 'Amazon.com', specs: { 'CPU Socket': 'Socket AM5' }, offers: [{ price: 179 }] });
  assert.deepEqual([p.manual, p.source, p.status, p.qty, p.notes, p.tags.socket], [false, 'sesion', 'bought', 2, 'comprado en agosto', 'AM5']);
  assert.deepEqual([p.title, p.image, p.price, p.shipping], ['MSI MAG B850 Tomahawk WiFi', 'https://m.media-amazon.com/images/I/81SKBZ1sZnL.jpg', 179, 17.38]);
  // Una lectura nueva reescribe todo: lo que ya no viene queda vacío (no se mezcla con lo anterior).
  applySession(p, { asin: 'B0G3SVRLT3', url: 'https://www.amazon.com/dp/B0G3SVRLT3', title: 'MSI MAG B850 Tomahawk WiFi', image: 'https://m.media-amazon.com/images/I/nueva.jpg', fetchedAt: '2026-09-19T05:00:00Z', price: 175, shipping: 17.38, importFees: 0 });
  assert.deepEqual([p.image, p.price, p.seller, p.offers, p.specs], ['https://m.media-amazon.com/images/I/nueva.jpg', 175, null, [], {}]);
  assert.equal(p.history.length, 2);
});

test('needsRefresh: lo no leído con tu sesión siempre se actualiza', async () => {
  const { needsRefresh } = await import('../public/logic.js');
  const now = Date.parse('2026-09-19T12:00:00Z');
  const base = { url: 'https://www.amazon.com/dp/B0DQ9PDT22', price: 99.99, shipping: 6.99, importFees: 0, shipsToCO: true, seller: 'Amazon.com', image: 'x', specs: { a: 1 }, fetchedAt: '2026-09-19T11:59:00Z' };
  assert.equal(needsRefresh({ ...base, source: 'servidor' }, DEFAULT_SETTINGS, now), true);
  assert.equal(needsRefresh({ ...base, source: 'sesion' }, DEFAULT_SETTINGS, now), false);
  assert.equal(needsRefresh({ ...base, source: 'sesion', status: 'bought' }, { ...DEFAULT_SETTINGS, refreshMinutes: 0 }, now), true);
});

test('cargos no informados por vendedor externo no cuentan como faltantes', async () => {
  const { missingFields } = await import('../public/logic.js');
  const { parseBox } = await import('../public/amazon-parse.js');
  const box = 'US$99.99US$99.99 Entrega por US$7.99 entre el 1 - 16 de octubre. Ver detalles Enviar a Colombia Disponible La tramitación del pedido para los pedidos con este proveedor tarda 4 a 5 días más.';
  assert.deepEqual([parseBox(box).shipping, parseBox(box).importFees], [7.99, null]);
  const p = { url: 'u', price: 99.99, shipping: 7.99, importFees: null, importFeesInfo: 'no-informado', shipsToCO: true, seller: 'NexaCore Computers', image: 'x', specs: { a: 1 }, availability: '' };
  assert.deepEqual(missingFields(p), []);
  assert.deepEqual(missingFields({ ...p, importFeesInfo: null }), ['cargos de importación']);
});

test('edición manual: se conserva si Amazon no muestra precio con envío a Colombia; se reemplaza si lo muestra', async () => {
  const { applyEdits, applySession, lineCost: cost } = await import('../public/logic.js');
  const read = (extra = {}) => ({ asin: 'B0CB9MSJ5N', url: 'https://www.amazon.com/dp/B0CB9MSJ5N', title: 'MSI MAG A850GL', image: 'https://m.media-amazon.com/images/I/a.jpg', fetchedAt: '2026-09-19T10:00:00Z', price: 99.99, shipping: 7.99, importFees: null, importFeesInfo: 'no-informado', seller: 'NexaCore Computers', shipsToCO: true, locationOk: true, specs: { a: '1' }, ...extra });
  const p = { id: 'x', status: 'buy', qty: 1, tags: {}, history: [] };
  applySession(p, read());

  // Edito a mano precio y cargos (p. ej. lo que vi en el checkout).
  const changed = applyEdits(p, { title: 'MSI MAG A850GL', price: 95, importFees: 3.5, shipping: 7.99 }, { now: '2026-09-19T11:00:00Z' });
  assert.deepEqual(changed, ['price', 'importFees']);
  assert.deepEqual(Object.keys(p.edited), ['price', 'importFees']);
  assert.equal(cost(p, DEFAULT_SETTINGS).feesSource, 'editado');

  // 1) La sesión no encuentra precio con envío a Colombia: se conservan las ediciones; lo demás sí se actualiza.
  let r = applySession(p, read({ price: null, shipsToCO: null, image: 'https://m.media-amazon.com/images/I/b.jpg', seller: 'Otro' }));
  assert.deepEqual(r, { keptEdits: ['price', 'importFees'], replacedEdits: [] });
  assert.deepEqual([p.price, p.importFees, p.image, p.seller], [95, 3.5, 'https://m.media-amazon.com/images/I/b.jpg', 'Otro']);
  r = applySession(p, read({ locationOk: false }));
  assert.deepEqual(r.keptEdits, ['price', 'importFees']);
  assert.equal(p.price, 95);

  // 2) La sesión encuentra precio con envío a Colombia: Amazon reemplaza todo y se quitan las marcas.
  r = applySession(p, read({ price: 97.5 }));
  assert.deepEqual(r, { keptEdits: [], replacedEdits: ['price', 'importFees'] });
  assert.deepEqual([p.price, p.importFees, p.edited], [97.5, null, undefined]);
});

test('edición de un producto sin enlace de Amazon no lo marca como editado', async () => {
  const { applyEdits } = await import('../public/logic.js');
  const p = { id: 'm', manual: true, title: 'SSD SATA reutilizado', price: null };
  assert.deepEqual(applyEdits(p, { price: 25, title: 'SSD SATA 500 GB' }, { track: false }), ['title', 'price']);
  assert.equal(p.edited, undefined);
});

test('guardar sin tocar un campo vacío no lo marca como editado', async () => {
  const { applyEdits } = await import('../public/logic.js');
  const p = { id: 'x', asin: 'B0CB9MSJ5N', title: 'MSI', availability: '', seller: 'NexaCore', price: 99.99, shipsToCO: null };
  assert.deepEqual(applyEdits(p, { title: 'MSI', availability: null, seller: 'NexaCore', price: 99.99, shipsToCO: null }), []);
  assert.equal(p.edited, undefined);
});

test('decisión por estrellas: niveles, orden y totales', async () => {
  const { pickLevel, isFixed, sortByPick, PICK_FIXED } = await import('../public/logic.js');
  assert.equal(pickLevel({}), 0);                    // los productos viejos quedan «sin decidir»
  assert.equal(pickLevel({ pick: 3 }), 3);
  assert.equal(pickLevel({ pick: 9 }), PICK_FIXED);  // fuera de rango se recorta
  assert.equal(pickLevel({ pick: -2 }), 0);
  assert.equal(isFixed({ pick: 3 }), true);
  assert.equal(isFixed({ pick: 2 }), false);

  // Más estrellas primero; entre iguales se conserva el orden en que se agregaron.
  const [a, b, c, d] = [mk('a'), mk('b', { pick: 1 }), mk('c', { pick: 3 }), mk('d')];
  assert.deepEqual(sortByPick([a, b, c, d]).map((p) => p.title), ['c', 'b', 'a', 'd']);

  const build = buildWith({
    cpu: [mk('Ryzen 5 9600X', { price: 175.5, shipping: 0, importFees: 0, pick: 3 })],
    psu: [mk('MSI 850W', { price: 99.99, shipping: 6.99, importFees: 0 })],
    gpu: [mk('RTX 5070 Ti', { status: 'planned', price: 750, manual: true, pick: 3 })],
  });
  const t = totals(build, S);
  assert.deepEqual([t.fixed, t.fixedTotal, t.undecided], [1, 175.5, 1]); // lo planeado no entra en «por comprar»
});

test('checks: un fijo que no está elegido avisa y se conserva al cambiar de opción', async () => {
  const { isFixed } = await import('../public/logic.js');
  const elegido = mk('MSI MAG A850GL', { price: 99.99, shipping: 0, importFees: 0 });
  const fijo = mk('MSI MPG A850GS', { price: 129.99, shipping: 0, importFees: 0, pick: 3 });
  const b = { name: 't', parts: { psu: { options: [elegido, fijo], selected: [elegido.id] } } };
  const list = checks(b, S);
  assert.ok(list.some((c) => c.level === 'warn' && c.title === 'Fijo sin elegir: Fuente de poder'));
  assert.ok(list.some((c) => c.level === 'info' && c.title === '1 por decidir'));

  // Cambiar la opción elegida no toca las estrellas: el producto sigue fijo.
  b.parts.psu.selected = [fijo.id];
  assert.equal(isFixed(fijo), true);
  const after = checks(b, S);
  assert.ok(!after.some((c) => c.title.startsWith('Fijo sin elegir')));
  assert.ok(after.some((c) => c.level === 'ok' && c.title === 'Todo lo por comprar está decidido'));

  // Dos ★★★ en una categoría de una sola pieza: hay que escoger.
  elegido.pick = 3;
  assert.ok(checks(b, S).some((c) => c.level === 'warn' && c.title === 'Dos fijos en Fuente de poder'));
});

test('applySession conserva el nivel de decisión', async () => {
  const { applySession, pickLevel } = await import('../public/logic.js');
  const p = { id: 'x', status: 'buy', pick: 3, qty: 1, tags: {}, history: [] };
  applySession(p, { asin: 'B0CB9MSJ5N', url: 'https://www.amazon.com/dp/B0CB9MSJ5N', title: 'MSI MAG A850GL', fetchedAt: '2026-09-19T10:00:00Z', price: 99.99, shipping: 0, importFees: 0 });
  assert.equal(pickLevel(p), 3);
});

test('protector de picos: julios, tomas, capacidad y VPR', () => {
  const super7 = mk('Eaton Tripp Lite Super-7 White 7 Outlet Flat Plug Surge Protector', { bullets: ['Features 7 outlets, 2160 joule rating', 'Includes a 15A circuit breaker'] });
  assert.equal(isSurgeProtector(super7), true);
  const t = detectTags(super7, 'accessories');
  assert.deepEqual([t.joules, t.outlets, t.capacityW, t.vpr], [2160, 7, 1800, null]);
  assert.equal(detectTags(mk('Belkin 6-Outlet Surge Protector', { bullets: ['1080 Joules, 72,000 Amps, 400V clamping voltage'] }), 'accessories').vpr, 400);
  assert.equal(detectTags(mk('Tripp Lite Surge Protector', { bullets: ['Let Through Rating (clamping voltage) of 330/400/400'] }), 'accessories').vpr, 400);
  assert.equal(isSurgeProtector(mk('APC UPS Battery Backup & Surge Protector 1500VA')), false);
  assert.equal(isSurgeProtector(mk('Cable Matters 3-Pack SATA III')), false);
});

test('monitores: consumo de la ficha o por tamaño, fuera de la fuente', () => {
  assert.equal(estimateWatts(mk('Monitor Janus 27" VA', { specs: { Consumo: '≤42 W' } }), 'monitor'), 42);
  assert.equal(estimateWatts(mk('INNOCN 24.5" 1440P 240Hz'), 'monitor'), 30);
  const b = buildWith({ cpu: [mk('AMD Ryzen 5 9600X')], monitor: [mk('INNOCN 24.5" 240Hz')] });
  const t = totals(b, S);
  assert.deepEqual([t.watts, t.externalWatts], [88 + 15, 30]);
});

test('checks: el protector de picos cubre el PC con lo planeado y los monitores', () => {
  const surge = mk('Tripp Lite Super-7 7 Outlet Surge Protector', { bullets: ['2160 joule rating', '15A circuit breaker'] });
  const b = buildWith({
    cpu: [mk('AMD Ryzen 5 9600X')],
    gpu: [mk('RTX 5070 Ti', { status: 'planned' })],
    accessories: [surge],
    monitor: [mk('INNOCN 24.5" 240Hz'), mk('Janus 27" VA', { specs: { Consumo: '≤42 W' } })],
  });
  const ok = checks(b, S).find((c) => c.title === 'Protector de picos suficiente');
  assert.ok(ok, 'PC ~448 W + monitores 72 W en una regleta de 1800 W');
  assert.match(ok.detail, /520 W de 1800 W/);

  surge.bullets = ['600 joules'];
  surge.tags = { outlets: 2 };
  const list = checks(b, S);
  assert.ok(list.some((c) => c.level === 'warn' && c.title === 'Protector de picos con poca protección'));
  assert.ok(list.some((c) => c.level === 'error' && c.title === 'Faltan tomas en el protector'));

  surge.tags = { capacityW: 500 };
  assert.ok(checks(b, S).some((c) => c.level === 'error' && c.title === 'Protector de picos sobrecargado'));

  b.parts.accessories.selected = [];
  assert.ok(checks(b, S).some((c) => c.level === 'info' && c.title === 'Sin protector de picos'));
});

test('precio pagado: factura de un artículo, pedido repartido y búsqueda por nombre', async () => {
  const { findPaid, paidFromInvoice, titleMatch, orderQuery } = await import('../public/logic.js');
  assert.equal(orderQuery('AMD Ryzen™ 5 9600X 6-Core, 12-Thread'), 'AMD Ryzen 5');
  assert.equal(orderQuery('ASUS ROG Strix GeForce GTX 1650 Super™'), 'ASUS ROG Strix');
  const ssd = { orderId: '113-3557960-9521800', date: '2026-09-22', currency: 'USD', items: [{ asin: 'B0FJXQHXM2', title: 'Ediloca SSD 1TB', price: 199.99, qty: 1 }], subtotal: 199.99, shipping: 11.85, discounts: 11.85, importFees: null, tax: 0, total: 199.99 };
  const combo = { orderId: '112-0000000-9748204', date: '2026-09-25', currency: 'USD', subtotal: 100, shipping: 10, discounts: 0, importFees: 10, tax: 0, total: 120,
    items: [{ asin: 'B0D49QX74S', title: 'CORSAIR RS120 120mm PWM Fans – Triple Pack – Black', price: 40, qty: 1 }, { asin: 'B0D949MRNM', title: 'Thermalright Phantom Spirit 120 SE Black CPU Air Cooler,7 Heat Pipes Cooler', price: 60, qty: 1 }] };
  const a = findPaid({ asin: 'B0FJXQHXM2', title: 'Ediloca SSD 1TB NVMe' }, [ssd, combo]);
  assert.deepEqual([a.total, a.shipping, a.exact, a.by, a.orderId], [199.99, 0, true, 'asin', '113-3557960-9521800']);
  const fans = paidFromInvoice(combo, combo.items[0]);
  assert.deepEqual([fans.total, fans.importFees, fans.exact], [48, 4, false]); // 40 + 40 % de los US$20 de envío y cargos
  const cooler = findPaid({ asin: 'B0BNDTJVPL', title: 'Thermalright Phantom Spirit 120SE CPU Air Cooler, 7 Heat Pipes CPU Cooler' }, [ssd, combo]);
  assert.deepEqual([cooler.total, cooler.by], [72, 'nombre']);
  assert.equal(titleMatch('Thermalright Phantom Spirit', 'CORSAIR RS120'), 0);
  assert.equal(findPaid({ asin: 'B082N86RPJ', title: 'ASUS ROG Strix GTX 1650 Super' }, [ssd, combo]), null);
});

test('precio pagado: fijo en el total y comparación con el precio de hoy', async () => {
  const { paidChange } = await import('../public/logic.js');
  const ssd = mk('Ediloca SSD', { status: 'bought', price: 189.99, shipping: 0, importFees: 0, paid: { total: 199.99, source: 'pedido' } });
  const ram = mk('RAM', { status: 'bought', price: 120, shipping: 0, importFees: 0 });
  const b = buildWith({ storage: [ssd], ram: [ram] });
  const t = totals(b, S);
  assert.deepEqual([t.spent, t.boughtNoPaid], [319.99, 1]); // 199.99 pagado + 120 de hoy (sin precio pagado)
  assert.deepEqual(paidChange(ssd, S), { paid: 199.99, now: 189.99, diff: -10, pct: -5 });
  ssd.price = 250; // Amazon sube: el total del armado no cambia
  assert.equal(totals(b, S).spent, 319.99);
  const list = checks(b, S);
  assert.ok(list.some((c) => c.level === 'info' && c.title === '1 comprado sin precio pagado'));
  ssd.price = 150;
  assert.ok(checks(b, S).some((c) => c.title === 'Bajó de precio desde tu compra'));
});

test('destino Miami: una sesión de otro destino no reescribe el producto', async () => {
  const { applySession, lineCost, missingFields, DEFAULT_SETTINGS } = await import('../public/logic.js');
  const co = { id: 'a', asin: 'B000000001', url: 'https://www.amazon.com/dp/B000000001', price: 700, shipping: 30, importFees: 140, fetchedAt: '2026-10-01T00:00:00Z' };
  const miamiRead = { asin: 'B000000001', title: 'RTX 5070 Ti', price: 749.99, shipping: 0, region: 'us', deliverTo: 'Miami 33101', fetchedAt: '2026-10-14T00:00:00Z' };
  assert.equal(applySession(co, miamiRead).skipped, true);
  assert.equal(co.price, 700);
  const mi = { id: 'b', asin: 'B000000001', url: 'https://www.amazon.com/dp/B000000001', market: 'miami', fetchedAt: '2026-10-01T00:00:00Z', price: 760 };
  assert.equal(applySession(mi, { ...miamiRead, region: 'co' }).skipped, true);
  assert.equal(mi.price, 760);
  assert.ok(!applySession(mi, miamiRead).skipped);
  assert.equal(mi.price, 749.99);
  const c = lineCost(mi, DEFAULT_SETTINGS);
  assert.equal(c.importFees, 52.5);
  assert.equal(c.total, 802.49);
  assert.ok(!missingFields({ ...mi, seller: 'Amazon.com', image: 'x', specs: { a: 1 } }).length);
  const fresh = { id: 'c', asin: 'B000000002', url: 'https://www.amazon.com/dp/B000000002' };
  applySession(fresh, { ...miamiRead, asin: 'B000000002' });
  assert.equal(fresh.market, 'miami');
});

test('opciones: ordenar y filtrar', async () => {
  const { viewOptions, normalizeView, viewFiltered, sortsFor } = await import('../public/logic.js');
  const a = mk('ASUS Dual GeForce RTX 4060', { price: 300, shipping: 0, importFees: 60, shipsToCO: true, rating: 4.5, reviews: 900, seller: 'Amazon.com', pick: 1 });
  const b = mk('MSI GeForce RTX 5070 Ventus', { price: 600, shipping: 20, importFees: 120, shipsToCO: true, rating: 4.8, reviews: 100, pick: 3 });
  const c = mk('Gigabyte Radeon RX 7600 Gaming', { price: 150, shipping: 10, importFees: 0, shipsToCO: false, rating: 4.5, reviews: 2000 });
  const d = mk('Tarjeta gráfica genérica', { price: null });
  const list = [a, b, c, d];
  const names = (v, cat = 'gpu') => viewOptions(list, v, cat, S).map((p) => p.title.split(' ')[0]);

  // Orden: por defecto estrellas y luego como se agregaron; sin precio siempre al final.
  assert.deepEqual(names({}), ['MSI', 'ASUS', 'Gigabyte', 'Tarjeta']);
  assert.deepEqual(names({ sort: 'total-asc' }), ['Gigabyte', 'ASUS', 'MSI', 'Tarjeta']);
  assert.deepEqual(names({ sort: 'total-desc' }), ['MSI', 'ASUS', 'Gigabyte', 'Tarjeta']);
  assert.deepEqual(names({ sort: 'rating' }), ['MSI', 'Gigabyte', 'ASUS', 'Tarjeta']); // empate en ★: más reseñas
  assert.deepEqual(names({ sort: 'reviews' }), ['Gigabyte', 'ASUS', 'MSI', 'Tarjeta']);
  assert.deepEqual(names({ sort: 'recent' }), ['Tarjeta', 'Gigabyte', 'MSI', 'ASUS']);
  assert.deepEqual(names({ sort: 'name' }), ['ASUS', 'Gigabyte', 'MSI', 'Tarjeta']);
  assert.deepEqual(names({ sort: 'watts' }), ['ASUS', 'Gigabyte', 'MSI', 'Tarjeta']); // 115 · 165 · 250 · 250 (genérico)
  assert.ok(sortsFor('gpu').some((o) => o.key === 'f:watts'));
  assert.equal(normalizeView({ sort: 'watts' }, 'ram').sort, 'pick'); // orden de la versión anterior: en RAM no existe
  assert.deepEqual(list, [a, b, c, d]); // no reordena la lista guardada

  // Búsqueda: varias palabras, sin tildes ni mayúsculas, también por vendedor.
  assert.deepEqual(names({ q: 'geforce DUAL' }), ['ASUS']);
  assert.deepEqual(names({ q: 'grafica' }), ['Tarjeta']);
  assert.deepEqual(names({ q: 'amazon.com' }), ['ASUS']);
  assert.deepEqual(names({ q: 'geforce', sort: 'total-desc' }), ['MSI', 'ASUS']);

  // Filtros
  assert.deepEqual(names({ minPick: 1 }), ['MSI', 'ASUS']);
  assert.deepEqual(names({ minPick: '3' }), ['MSI']);
  assert.deepEqual(names({ avail: 'priced' }), ['MSI', 'ASUS', 'Gigabyte']);
  assert.deepEqual(names({ avail: 'ships' }), ['MSI', 'ASUS']); // la Gigabyte no envía a CO
  assert.deepEqual(names({ maxTotal: '400' }), ['ASUS', 'Gigabyte']); // 360 y 160 en Colombia
  assert.deepEqual(names({ underThreshold: true }), ['Gigabyte']);
  assert.equal(viewOptions([mk('Zotac', { price: 200, shipsToCO: true, availability: 'Currently unavailable.' })], { avail: 'priced' }, 'gpu', S).length, 0);
  const local = mk('Local', { manual: true, price: 500 });
  assert.equal(viewOptions([local], { underThreshold: true, avail: 'ships' }, 'gpu', S).length, 1); // compra local: sin IVA de importación

  // ¿Hay filtros activos? El orden y los valores vacíos no cuentan.
  assert.equal(viewFiltered(normalizeView({ sort: 'total-asc' }, 'gpu')), false);
  assert.equal(viewFiltered(normalizeView({ q: '  ', maxTotal: '0', avail: 'toString' }, 'gpu')), false);
  assert.equal(viewFiltered(normalizeView({ minPick: '2' }, 'gpu')), true);
});

test('opciones: sentido del orden y órdenes de la versión anterior', async () => {
  const { viewOptions, normalizeView, dirLabel } = await import('../public/logic.js');
  const list = [mk('A', { price: 100 }), mk('B', { price: 300 }), mk('C', { price: null }), mk('D', { price: 200 })];
  const names = (v) => viewOptions(list, v, 'gpu', S).map((p) => p.title);
  assert.deepEqual(names({ sort: 'total' }), ['A', 'D', 'B', 'C']); // por defecto, el más barato primero
  assert.deepEqual(names({ sort: 'total', dir: 'desc' }), ['B', 'D', 'A', 'C']); // sin precio al final en ambos sentidos
  assert.deepEqual(names({ sort: 'added', dir: 'asc' }), ['A', 'B', 'C', 'D']);
  assert.deepEqual(names({ sort: 'name', dir: 'desc' }), ['D', 'C', 'B', 'A']);
  assert.deepEqual(normalizeView({ sort: 'total-desc' }, 'gpu'), { ...normalizeView({}, 'gpu'), sort: 'total', dir: 'desc' });
  assert.equal(normalizeView({ sort: 'recent' }, 'gpu').sort, 'added');
  assert.equal(normalizeView({ sort: 'toString', dir: 'asc' }, 'gpu').dir, 'desc'); // desconocido: estrellas, más primero
  assert.equal(dirLabel('total', 'asc'), 'Menor a mayor');
});

test('características: GPU (frecuencia con unidades mal puestas, VRAM, chip)', async () => {
  const { featuresFor, featureValue, commonFeatures, viewOptions, fmtFeature } = await import('../public/logic.js');
  const F = Object.fromEntries(featuresFor('gpu').map((f) => [f.key, f]));
  const v = (p, k) => featureValue(F[k], p, 'gpu');
  // La spec trae la base y el título el boost: gana el mayor. «2300 gigahertz» y «2.5 kilohertz» son 2.3 y 2.5 GHz.
  const pny = mk('PNY GeForce RTX 5070 Ti OC (16GB GDDR7, Boost Speed: 2572 MHz)', { specs: { 'GPU Clock Speed': '2295 megahertz', 'Graphics Ram Size': '16 GB' } });
  const odd = mk('PNY GeForce RTX 5070 TI 16GB Triple Fan', { specs: { 'GPU Clock Speed': '2300 gigahertz' } });
  const kilo = mk('msi Gaming RTX 5070 TI 16G', { specs: { 'GPU Clock Speed': '2.5 kilohertz', 'Graphics Ram Size': '16384 MB' } });
  // «28 gigahertz» es la velocidad de la memoria: se descarta y se usa la de las viñetas.
  const zotac = mk('ZOTAC GeForce RTX 5070 Ti 16GB GDDR7 28 Gbps', { specs: { 'GPU Clock Speed': '28 gigahertz' }, bullets: ['2482 MHz Boost Clock'] });
  // La spec dice «RTX 5070» pero el título dice Ti: manda el título.
  const msi = mk('msi Gaming RTX 5070 Ti 16G Shadow 3X OC', { specs: { 'Graphics Coprocessor': 'NVIDIA GeForce RTX 5070' } });
  const old = mk('ASUS ROG Strix GeForce GTX 1650 Super™ Advanced 4GB Edition GDDR6');
  assert.deepEqual([v(pny, 'clock'), v(odd, 'clock'), v(kilo, 'clock'), v(zotac, 'clock'), v(old, 'clock')], [2.572, 2.3, 2.5, 2.482, null]);
  assert.deepEqual([v(pny, 'vram'), v(kilo, 'vram'), v(old, 'vram')], [16, 16, 4]);
  assert.deepEqual([v(msi, 'chip'), v(old, 'chip'), v(mk('Sapphire Radeon RX 7900 XTX'), 'chip')], ['RTX 5070 Ti', 'GTX 1650 Super', 'RX 7900 XTX']);
  assert.equal(v(old, 'memType'), 'GDDR6');
  assert.equal(fmtFeature(F.clock, 2.572), '2.572 GHz');

  // Ordenar por frecuencia (mayor primero por defecto; sin dato al final) y filtrar por umbral y por chip.
  const list = [pny, odd, kilo, zotac, msi, old];
  const t = (view) => viewOptions(list, view, 'gpu', S).map((p) => list.indexOf(p));
  assert.deepEqual(t({ sort: 'f:clock' }), [0, 2, 3, 1, 4, 5]);
  assert.deepEqual(t({ sort: 'f:clock', dir: 'asc' }), [1, 3, 2, 0, 4, 5]);
  assert.deepEqual(t({ feats: { clock: '2.48' } }), [0, 2, 3]);
  assert.deepEqual(t({ feats: { chip: 'rtx 5070 ti', vram: 16 } }), [0, 1, 2, 3, 4]);

  // Comunes: al menos dos opciones con dato y dos valores distintos; umbrales con cuántas cumplen.
  const common = Object.fromEntries(commonFeatures(list, 'gpu').map((f) => [f.key, f]));
  assert.deepEqual(common.chip.values, [{ value: 'RTX 5070 Ti', count: 5 }, { value: 'GTX 1650 Super', count: 1 }]);
  assert.deepEqual(common.vram.values, [{ value: 4, count: 6 }, { value: 16, count: 5 }]);
  assert.deepEqual(common.clock.values.map((x) => x.count), [4, 3, 2, 1]);
  assert.equal(commonFeatures([pny, kilo], 'gpu').some((f) => f.key === 'vram'), false); // un solo valor: no sirve para filtrar
});

test('características: CPU, RAM, almacenamiento, fuente, monitor y disipador', async () => {
  const { featuresFor, featureValue } = await import('../public/logic.js');
  const vals = (cat, p) => Object.fromEntries(featuresFor(cat).map((f) => [f.key, featureValue(f, p, cat)]));
  const cpu = vals('cpu', mk('AMD Ryzen 7 9800X3D 8-Core, 16-Thread Desktop Processor', { specs: { 'CPU Speed': '4.7 GHz' }, bullets: ['Max boost clock up to 5.2 GHz'] }));
  assert.deepEqual([cpu.cores, cpu.clock, cpu.socket], [8, 4.7, 'AM5']); // la spec da la base; las viñetas solo si no hay nada
  const ram = vals('ram', mk('Silicon Power 32GB (2x16GB) XPOWER Zenith DDR5-6000 (PC5-48000) CL30 1.35V', { specs: { 'Memory Speed': '6000 MT/s (PC5-48000)' } }));
  assert.deepEqual([ram.capacity, ram.speed, ram.cl, ram.memType], [32, 6000, 30, 'DDR5']);
  const ssd = vals('storage', mk('Ediloca SSD 1TB NVMe PCIe 5.0x4, Up to 14,000MB/s Read, 1TB SSD with 1GB LPDDR4 DRAM', { specs: { 'Digital Storage Capacity': '1 TB' } }));
  assert.deepEqual([ssd.capacity, ssd.pcie, ssd.read, ssd.iface], [1000, 'PCIe 5.0', 14000, 'NVMe']);
  const psu = vals('psu', mk('ASRock Steel Legend SL-850P 850W ATX Power Supply, 80 Plus Platinum, Fully Modular'));
  assert.deepEqual([psu.power, psu.cert, psu.modular], [850, '80 Plus Platinum', 'Totalmente modular']);
  const mon = vals('monitor', mk('Monitor Gamer Janus 27" VA Full HD 200Hz', { specs: { 'Tiempo de respuesta': '1 ms', 'Resolución': '1920 × 1080 (Full HD)' } }));
  assert.deepEqual([mon.size, mon.hz, mon.res, mon.panel, mon.response], [27, 200, '1080p', 'VA', 1]);
  assert.equal(vals('monitor', mk('INNOCN 24.5" 1440P 240Hz Gaming Monitor Fast IPS', { specs: { Resolution: 'QHD Wide 1440p' } })).res, '1440p');
  const air = vals('cooler', mk('Thermalright Phantom Spirit 120SE CPU Air Cooler', { specs: { 'Cooling Method': 'Air' } }));
  const aio = vals('cooler', mk('ARCTIC Liquid Freezer III 360 A-RGB AIO CPU Cooler, 360mm radiator'));
  assert.deepEqual([air.kind, air.radiator, aio.kind, aio.radiator], ['Aire', null, 'Líquida (AIO)', 360]);
});

test('discos: DRAM, tipo, NAND, controlador, disipador, velocidades y capacidad comercial', async () => {
  const { featuresFor, featureValue } = await import('../public/logic.js');
  const vals = (p) => Object.fromEntries(featuresFor('storage').map((f) => [f.key, featureValue(f, p, 'storage')]));
  const lexar = vals(mk('Lexar 1TB NM1090 PRO NVMe SSD, 14,000/10,000 MB/s, M.2 2280, PCIe Gen 5', { bullets: ['DRAM Cache and SLC Dynamic Cache, 700TBW (1TB), 1400TBW (2TB)'] }));
  assert.deepEqual([lexar.read, lexar.write, lexar.dram, lexar.tbw, lexar.pcie, lexar.heatsink], [14000, 10000, 'Sí', 700, 'PCIe 5.0', 'No']);
  const kc = vals(mk('Kingston KC3000 PCIe 4.0 NVMe M.2 1024 GB SSD'));
  assert.equal(kc.capacity, 1000); // 1024 GB se vende como 1 TB
  const z540 = vals(mk('TEAMGROUP T-Force Z540 1TB Gen5x4 DRAM SLC Cache 3D TLC NAND NVMe Phison E26 PCIe M.2 2280 Gaming SSD with Ultra-Thin Graphene Heatsink'));
  assert.deepEqual([z540.pcie, z540.nand, z540.controller, z540.heatsink], ['PCIe 5.0', 'TLC', 'Phison E26', 'Sí']);
  const lp = vals(mk('Corsair MP600 PRO LPX 1TB M.2 NVMe PCIe x4 Gen4 SSD (Up to 7,100MB/sec Sequential Read & 5,800MB/sec Sequential Write)'));
  assert.deepEqual([lp.read, lp.write], [7100, 5800]);
  // «outperforms DRAM-less drives» no es «sin DRAM»; HMB sí lo es.
  assert.equal(vals(mk('1TB PCIe 3.0 NVMe SSD', { bullets: ['dedicated DRAM cache—outperforms DRAM-less drives'] })).dram, 'Sí');
  assert.equal(vals(mk('Crucial P3 Plus 1TB PCIe Gen4 NVMe', { bullets: ['DRAM-less design with HMB'] })).dram, 'No');
  assert.equal(vals(mk('Ediloca SSD 1TB with 1GB LPDDR4 DRAM')).dramType, 'LPDDR4');
  assert.equal(vals(mk('GIGABYTE AORUS Gen4 7300 SSD 1TB (w/o Heat Spreader) PCIe 4.0 NVMe')).heatsink, 'No');
  // Lo editado a mano manda.
  assert.equal(vals(mk('Crucial T500 1TB PCIe Gen4 NVMe', { tags: { dram: 'No', controller: 'Phison E25' } })).controller, 'Phison E25');
});

test('filtros de discos: todas las capacidades y conteos dinámicos según los demás filtros', async () => {
  const { commonFeatures, viewOptions } = await import('../public/logic.js');
  const list = [
    mk('A 1TB NVMe PCIe 5.0 DRAM cache'), mk('B 2TB NVMe PCIe 5.0 DRAM cache'), mk('C 2TB NVMe PCIe 4.0 DRAM-less HMB'),
    mk('D 1TB NVMe PCIe 4.0 DRAM cache'),
  ];
  const by = (v) => Object.fromEntries(commonFeatures(list, 'storage', v).map((f) => [f.key, f.values]));
  assert.deepEqual(by({}).capacity, [{ value: 1000, count: 2 }, { value: 2000, count: 2 }]); // valores exactos, no umbrales
  const f = by({ feats: { pcie: 'PCIe 4.0' } });
  assert.deepEqual(f.capacity, [{ value: 1000, count: 1 }, { value: 2000, count: 1 }]);
  assert.deepEqual(f.dram, [{ value: 'Sí', count: 1 }, { value: 'No', count: 1 }]);
  assert.deepEqual(f.pcie.map((x) => x.count), [2, 2]); // su propio filtro no se cuenta
  assert.deepEqual(viewOptions(list, { feats: { capacity: 2000, dram: 'Sí' } }, 'storage').map((p) => p.title[0]), ['B']);
  // Con una sola capacidad igual se ofrece (always).
  assert.deepEqual(commonFeatures(list.filter((p) => /1TB/.test(p.title)), 'storage').find((x) => x.key === 'capacity').values, [{ value: 1000, count: 2 }]);
});
