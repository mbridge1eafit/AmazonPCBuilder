import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, envOf, newProduct, newOffer, newCandidate, normalize } from '../public/js/domain/schema.js';
import { offerCost } from '../public/js/domain/offer-cost.js';
import { purchaseRow, markRows } from '../public/js/domain/purchase.js';
import { totals, categoryState } from '../public/js/domain/build.js';
import { checks } from '../public/js/domain/checks.js';
import { optionItems, viewOptions, facets, normalizeView } from '../public/js/domain/filters.js';
import { compareTable, scaleScores } from '../public/js/domain/compare.js';
import { applyAmazon, applyStorePrice, applyEdits, OFFER_EDITABLE } from '../public/js/domain/readings.js';
import { planRefresh } from '../public/js/domain/refresh-plan.js';
import { alertEvents } from '../public/js/domain/alerts.js';
import { priceSeries, trend } from '../public/js/domain/history.js';
import { findPaid, toPurchase } from '../public/js/domain/paid.js';
import { merchantOfUrl, urlFitsStore, DEFAULT_STORES } from '../public/js/domain/catalog.js';
import { ruleActive } from '../public/js/domain/tax.js';

const setup = () => {
  const st = emptyState();
  st.settings.fx.trm = 4000;
  return { st, env: envOf(st), b: st.builds[0] };
};
const add = (st, b, cat, title, offers, cand = {}) => {
  const p = newProduct({ category: cat, title, offers: offers.map(([store, f]) => newOffer(store, f)) });
  st.products[p.id] = p;
  const c = newCandidate(p.id, cat, cand);
  b.candidates.push(c);
  return { p, c };
};

test('Amazon Colombia: cargos según la tienda, exento bajo el umbral y estimado encima', () => {
  const { env } = setup();
  const p = newProduct();
  assert.deepEqual(pick(offerCost(newOffer('amazon-co', { price: 100, shipping: 20, tax: 5 }), p, env)), { total: 125, taxSource: 'store', partial: false });
  assert.deepEqual(pick(offerCost(newOffer('amazon-co', { price: 150, shipping: 10 }), p, env)), { total: 160, taxSource: 'exempt', partial: false });
  const over = offerCost(newOffer('amazon-co', { price: 300, shipping: 20 }), p, env);
  assert.equal(over.overThreshold, true);
  assert.equal(over.tax, 60.8); // 19 % de 320
  assert.equal(over.taxSource, 'estimated');
  assert.equal(over.taxRule, 'co-iva');
  // Cantidad 2: los cargos informados son de 1 unidad, se estiman.
  assert.equal(offerCost(newOffer('amazon-co', { price: 120, shipping: 0, tax: 3 }), p, env, 2).taxSource, 'estimated');
  // Vendedor externo que no cobra cargos y supera el umbral: parcial (se pagan en aduana).
  const ext = offerCost(newOffer('amazon-co', { price: 300, shipping: 0, taxNotCharged: true }), p, env);
  assert.equal(ext.partial, true);
  assert.match(ext.missing[0], /aduana/);
});
const pick = (c) => ({ total: c.total, taxSource: c.taxSource, partial: c.partial });

test('cambiar el umbral (US$200 ↔ US$50) recalcula', () => {
  const { st, env } = setup();
  const o = newOffer('amazon-co', { price: 100, shipping: 10 });
  assert.equal(offerCost(o, newProduct(), env).taxSource, 'exempt');
  st.settings.taxRules.find((r) => r.id === 'co-exempt').threshold = 50;
  assert.equal(offerCost(o, newProduct(), env).tax, 20.9);
});

test('Mercado Libre en COP: impuesto incluido y equivalente en US$', () => {
  const { env } = setup();
  const c = offerCost(newOffer('mercadolibre', { price: 400000, shipping: 0 }), newProduct(), env);
  assert.equal(c.total, 100);
  assert.equal(c.taxSource, 'included');
  assert.deepEqual(c.original, { currency: 'COP', price: 400000, total: 400000 });
  assert.equal(c.landedCO.inCO, true);
});

test('Miami: sales tax 6 % + surtax 1 % con tope de US$5.000 y casillero puesto en Colombia', () => {
  const { st, env } = setup();
  const p = newProduct({ weightLb: 2 });
  const c = offerCost(newOffer('newegg', { price: 100, shipping: 0 }), p, env);
  assert.equal(c.tax, 7);
  assert.equal(c.total, 107);
  assert.equal(c.landedCO.freight, 10); // 2 lb × 2.50 = 5 → mínimo 10
  assert.equal(c.landedCO.total, 117);
  assert.equal(offerCost(newOffer('newegg', { price: 6000, shipping: 0 }), p, env).tax, 410); // 360 + 50
  // Sin peso: puesto en CO parcial.
  assert.equal(offerCost(newOffer('newegg', { price: 100, shipping: 0 }), newProduct(), env).landedCO.partial, true);
  // Sobre el umbral: impuesto de entrada IVA 19 % sobre valor + flete.
  const big = offerCost(newOffer('newegg', { price: 300, shipping: 0 }), p, env);
  assert.equal(big.landedCO.entryTax, +(0.19 * (321 + 10)).toFixed(2));
  st.settings.locker.enabled = false;
  assert.equal(offerCost(newOffer('newegg', { price: 1 }), p, env).landedCO, null);
});

test('total parcial: falta el envío; recogida en sede sin envío y sin tasa', () => {
  const { env } = setup();
  const c = offerCost(newOffer('bestbuy', { price: 100 }), newProduct(), env);
  assert.equal(c.partial, true);
  assert.deepEqual(c.missing, ['envío']);
  const mc = offerCost(newOffer('microcenter', { price: 100 }), newProduct(), env);
  assert.equal(mc.shipping, 0);
  assert.deepEqual(mc.missing, ['tasa de sales tax']);
  assert.equal(offerCost(newOffer('newegg', {}), newProduct(), env).total, null);
});

test('tienda de compra: elegida o la sugerida (menor total en destino) y aviso de destinos distintos', () => {
  const { st, env, b } = setup();
  const { p, c } = add(st, b, 'storage', 'SSD', [['amazon-co', { price: 160, shipping: 12.41, tax: 0 }], ['newegg', { price: 149.99, shipping: 0 }]]);
  const r = purchaseRow(c, p, env);
  assert.equal(r.suggested, true);
  assert.equal(r.row.offer.store, 'newegg');
  assert.equal(r.mixedDest, true);
  c.purchaseOfferId = p.offers[0].id;
  assert.equal(purchaseRow(c, p, env).row.offer.store, 'amazon-co');
  assert.equal(markRows(r.rows).rows.find((x) => x.lowest).offer.store, 'newegg');
});

test('totales: por comprar, comprado con lo pagado, planeado, presupuesto, umbral y por tienda', () => {
  const { st, env, b } = setup();
  b.budget = { amount: 1000, currency: 'USD' };
  add(st, b, 'cpu', 'AMD Ryzen 7 9800X3D AM5', [['amazon-co', { price: 450, shipping: 10, tax: 87.4 }]], { selected: true, decision: 3 });
  add(st, b, 'ram', 'DDR5 32GB', [['newegg', { price: 100, shipping: 0 }]], { selected: true });
  add(st, b, 'motherboard', 'B850 AM5 ATX', [['amazon-co', { price: 200, shipping: 0, tax: 0 }]], { selected: true, status: 'bought', purchase: { total: { amount: 190, currency: 'USD' } } });
  add(st, b, 'monitor', 'Monitor 27', [['amazon-us', { price: 250, shipping: 0 }]], { selected: true, status: 'planned' });
  add(st, b, 'gpu', 'RTX', [['newegg', { price: 500 }]], { selected: false });
  const t = totals(st, b, env);
  assert.equal(t.toBuy.count, 2);
  assert.equal(t.toBuy.total, 654.4);
  assert.equal(t.bought.total, 190);
  assert.equal(t.planned.total, 267.5);
  assert.equal(t.grand, 1111.9);
  assert.equal(t.over.count, 1);
  assert.equal(t.fixed.count, 1);
  assert.equal(t.budget.left, 345.6);
  assert.deepEqual(t.byStore.map((x) => x.store), ['amazon-co', 'newegg']);
  assert.equal(t.mixedDest, true);
  assert.equal(categoryState(st, b, 'gpu', []).status, 'empty');
});

test('compatibilidad: socket incompatible y falta esencial', () => {
  const { st, env, b } = setup();
  add(st, b, 'cpu', 'AMD Ryzen 7 9800X3D AM5', [['amazon-co', { price: 450 }]], { selected: true });
  add(st, b, 'motherboard', 'MSI Z790 LGA1700 ATX DDR5', [['amazon-co', { price: 200 }]], { selected: true });
  const ks = checks(st, b, env);
  assert.ok(ks.some((k) => k.level === 'error' && k.title === 'Socket incompatible'));
  assert.ok(ks.some((k) => k.title === 'Falta: Tarjeta gráfica'));
  assert.equal(ks[0].level, 'error');
});

test('no se envía a destino: error de compra en la tienda elegida', () => {
  const { st, env, b } = setup();
  add(st, b, 'accessories', 'Cable HDMI 2.1', [['amazon-co', { price: 20, shipping: 5, tax: 0, shipsToDestination: false }]], { selected: true });
  assert.ok(checks(st, b, env).some((k) => k.level === 'error' && /no se envía/.test(k.title)));
});

test('opciones: filtros facetados con conteos dinámicos, descartadas aparte y orden por valor', () => {
  const { st, env, b } = setup();
  const mk = (t, price, extra = {}) => add(st, b, 'storage', t, [['newegg', { price, shipping: 0 }]], extra);
  mk('Disco A 2TB NVMe PCIe 4.0 TLC DRAM cache', 160);
  mk('Disco B 1TB NVMe PCIe 4.0 QLC DRAM-less', 60);
  mk('Disco C 2TB NVMe PCIe 5.0 TLC DRAM cache', 220);
  mk('Disco D 4TB NVMe PCIe 4.0 TLC DRAM-less', 250, { discarded: true });
  const items = optionItems(b.candidates, st.products, env);
  assert.equal(viewOptions(items, {}, 'storage').length, 3);
  assert.equal(viewOptions(items, { showDiscarded: true }, 'storage').length, 1);
  const v = { feats: { capacity: [2000] } };
  const fs = facets(items, v, 'storage');
  const cap = fs.find((f) => f.key === 'capacity');
  assert.deepEqual(cap.values.map((x) => [x.value, x.count]), [[1000, 1], [2000, 2]]);
  const pcie = fs.find((f) => f.key === 'pcie');
  assert.deepEqual(pcie.values.map((x) => [x.value, x.count]), [['PCIe 4.0', 1], ['PCIe 5.0', 1]]);
  const byValue = viewOptions(items, { sort: 'value', dir: 'asc' }, 'storage').map((it) => it.product.title[6]);
  assert.deepEqual(byValue, ['B', 'A', 'C']); // 60/TB, 80/TB, 110/TB
  // El umbral solo aplica a lo que se importa a Colombia (Newegg entrega en Miami).
  assert.equal(viewOptions(items, { underThreshold: true }, 'storage').length, 3);
  assert.equal(normalizeView({ sort: 'nope' }, 'storage').sort, 'decision');
});

test('comparar: escala peor → mejor, «Gana en» y ocultar filas iguales', () => {
  assert.deepEqual(scaleScores([1, 2, 3]), [0, 0.5, 1]);
  assert.deepEqual(scaleScores([1, null]), [null, null]);
  const { st, env, b } = setup();
  add(st, b, 'storage', 'X 2TB NVMe 7000 MB/s 1200 TBW TLC', [['newegg', { price: 150, shipping: 0 }]], { selected: true });
  add(st, b, 'storage', 'Y 2TB NVMe 7450 MB/s 1600 TBW TLC', [['newegg', { price: 180, shipping: 0 }]]);
  const items = optionItems(b.candidates, st.products, env);
  const t = compareTable(items, 'storage', { hideEqual: true, chosenTotal: items[0].total });
  const total = t.rows.find((r) => r.key === 'total');
  assert.deepEqual(total.cells.map((c) => c.tone), ['best', 'worst']);
  assert.ok(t.hidden.some((h) => /NAND/.test(h)));
  assert.equal(t.wins[1] > 0, true);
  assert.equal(t.rows.find((r) => r.key === 'diff').cells[1].v, '+32.10');
});

test('lectura de Amazon: región de la sesión, ediciones conservadas o reemplazadas e historial', () => {
  const { env } = setup();
  const p = newProduct({ offers: [newOffer('amazon-co', { price: 100, shipping: 9, edited: { shipping: 'x' } })] });
  const d = { asin: 'B000000001', url: 'https://www.amazon.com/dp/B000000001', title: 'T', price: 95, shipping: 12, importFees: 0, currency: 'USD', region: 'co', shipsToCO: null, locationOk: true, offers: [], specs: {}, bullets: [] };
  const r1 = applyAmazon(p, d, env, '2026-11-01T00:00:00Z');
  assert.equal(p.offers[0].shipping, 9); // sin envío a CO confirmado: se conserva lo editado
  assert.deepEqual(r1.keptEdits, ['shipping']);
  const r2 = applyAmazon(p, { ...d, shipsToCO: true }, env, '2026-11-02T00:00:00Z');
  assert.equal(p.offers[0].shipping, 12);
  assert.deepEqual(r2.replacedEdits, ['shipping']);
  assert.equal(applyAmazon(p, { ...d, region: 'us' }, env).skipped, true);
  assert.equal(p.offers[0].history.length, 2);
  assert.ok(trend(p.offers[0]));
  // Producto nuevo: crea la fila de su región.
  const q = newProduct();
  applyAmazon(q, { ...d, region: 'us' }, env);
  assert.equal(q.offers[0].store, 'amazon-us');
});

test('precio de tienda y edición manual con marca e historial', () => {
  const { env } = setup();
  const p = newProduct({ offers: [newOffer('newegg', { url: 'https://www.newegg.com/x', price: 100, shipping: 0 })] });
  const o = p.offers[0];
  const r = applyStorePrice(p, o, { price: 90, currency: 'USD', listPrice: 120 }, env, '2026-11-01T00:00:00Z');
  assert.equal(r.after.price, 90);
  assert.equal(o.listPrice, 120);
  applyStorePrice(p, o, { price: null }, env);
  assert.equal(o.readStatus, 'error');
  assert.equal(o.price, 90);
  const changed = applyEdits(o, { price: '85', shipping: '' }, OFFER_EDITABLE, { env, product: p, now: '2026-11-03T00:00:00Z' });
  assert.deepEqual(changed, ['price', 'shipping']);
  assert.ok(o.edited.price);
  assert.equal(priceSeries(p)[0].n, 2);
});

test('plan de actualización: canales, omite lo leído hoy en el armado y lo manual', () => {
  const { st, env, b } = setup();
  const now = new Date(2026, 10, 9, 18, 0).getTime();
  const { p } = add(st, b, 'cpu', 'CPU', [
    ['amazon-co', { url: 'https://www.amazon.com/dp/B000000001' }],
    ['newegg', { url: 'https://www.newegg.com/p/1', fetchedAt: new Date(2026, 10, 9, 0, 30).toISOString(), readStatus: 'ok' }],
  ], { decision: 2 });
  p.ids.asin = 'B000000001';
  st.stores['custom-x'] = { key: 'custom-x', merchant: 'manual', name: 'X', destination: 'co', currency: 'USD', taxMode: 'included' };
  p.offers.push(newOffer('custom-x', { price: 10 }));
  const plan = planRefresh(st, env, { kind: 'build' }, { now });
  assert.deepEqual(plan.jobs.map((j) => j.channel), ['amazon-co']);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.manual.length, 1);
  assert.equal(planRefresh(st, env, { kind: 'product', productId: p.id }, { now }).jobs.length, 2);
  // Forzar lee todo; al día siguiente vuelve a leerse aunque hayan pasado menos de 24 h.
  assert.equal(planRefresh(st, env, { kind: 'build' }, { now, force: true }).jobs.length, 2);
  assert.equal(planRefresh(st, env, { kind: 'build' }, { now: new Date(2026, 10, 10, 0, 10).getTime() }).jobs.length, 2);
  // Una lectura de hoy con error no cuenta como leída.
  p.offers[1].readStatus = 'error';
  assert.equal(planRefresh(st, env, { kind: 'build' }, { now }).jobs.length, 2);
});

test('alertas: objetivo alcanzado, bajada y solo Colombia', () => {
  const { env } = setup();
  const c = newCandidate('p', 'storage', { targetPrice: 165 });
  const p = newProduct();
  const o = newOffer('newegg');
  assert.equal(alertEvents(c, p, o, { total: 172.5 }, { total: 160.49 }, env)[0].kind, 'target');
  assert.equal(alertEvents(c, p, o, { total: 162 }, { total: 160 }, env)[0].kind, 'drop');
  assert.equal(alertEvents({ ...c, alerts: { ...c.alerts, coOnly: true } }, p, o, { total: 172 }, { total: 150 }, env).length, 0);
});

test('precio pagado: por ASIN y en COP con la tasa', () => {
  const inv = [{ orderId: '114-1', date: '2026-10-01', currency: 'COP', items: [{ asin: 'B000000001', title: 'AMD Ryzen', price: 400000, qty: 1 }], subtotal: 400000, total: 400000 }];
  const hit = findPaid(newProduct({ title: 'AMD Ryzen', ids: { asin: 'B000000001' } }), inv);
  const pu = toPurchase(hit, 4000);
  assert.equal(pu.total.amount, 100);
  assert.deepEqual(pu.original, { currency: 'COP', amount: 400000, rate: 4000 });
});

test('catálogo: dominios, una tienda solo admite su dominio, vigencia de reglas', () => {
  assert.equal(merchantOfUrl('https://articulo.mercadolibre.com.co/MCO-1'), 'mercadolibre');
  assert.equal(merchantOfUrl('https://newegg.com.evil.io/x'), null);
  assert.ok(urlFitsStore('https://www.amazon.com/dp/B000000001', DEFAULT_STORES['amazon-us']));
  assert.ok(!urlFitsStore('https://www.newegg.com/x', DEFAULT_STORES.bestbuy));
  assert.ok(ruleActive({ from: '2026-01-29' }, '2026-11-09'));
  assert.ok(!ruleActive({ from: '2026-01-29' }, '2026-01-01'));
});

test('normalize completa valores por defecto sin borrar datos', () => {
  const st = emptyState();
  delete st.settings.locker;
  st.settings.taxRules = st.settings.taxRules.filter((r) => r.id !== 'mia-sales');
  const n = normalize(structuredClone(st));
  assert.equal(n.settings.locker.rate, 2.5);
  assert.ok(n.settings.taxRules.some((r) => r.id === 'mia-sales'));
  assert.throws(() => normalize({ version: 1, builds: [] }));
});
