import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectTags, estimateWatts, lineCost, totals, checks, DEFAULT_SETTINGS } from '../public/logic.js';
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
  assert.equal(detectTags(mk('ASUS TUF B550M-PLUS Micro-ATX DDR4'), 'motherboard').formFactor, 'Micro-ATX');
  assert.equal(detectTags(mk('ARCTIC P12 PWM PST (5 Pack) - Ventiladores'), 'fans').count, 5);
  assert.equal(detectTags(mk('Thermalright Ventilador de CPU TL-C12C X3, ventilador'), 'fans').count, 3);
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
