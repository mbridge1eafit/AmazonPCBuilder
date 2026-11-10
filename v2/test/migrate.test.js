import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrateV1 } from '../public/js/domain/migrate-v1.js';
import { normalize, envOf } from '../public/js/domain/schema.js';
import { totals } from '../public/js/domain/build.js';

const v1 = {
  version: 1,
  settings: { trm: 3188, threshold: 200, iva: 0.19, miamiTax: 0.07, psuMargin: 1.3, staleDays: 1, refreshMinutes: 10 },
  activeBuildId: 'b1',
  builds: [
    {
      id: 'b1', name: 'Principal', budget: 2000, parts: {
        cpu: { selected: ['p1'], options: [{ id: 'p1', asin: 'B0D6NN6TM7', url: 'https://www.amazon.com/dp/B0D6NN6TM7', title: 'AMD Ryzen 5 9600X', status: 'bought', pick: 3, qty: 1, tags: {}, price: 180.49, shipping: 0, importFees: 0, shipsToCO: true, fetchedAt: '2026-10-19T01:57:11.883Z', history: [{ t: '2026-09-19T03:47:38.138Z', price: 175.5, shipping: 0, importFees: null }], paid: { total: 175.5, price: 175.5, qty: 1, date: '2026-09-18', orderId: '114-2690505-9657059', source: 'pedido', exact: true, by: 'asin' } }] },
        storage: { selected: ['p2'], options: [
          { id: 'p2', manual: true, market: 'miami', salesTax: true, store: 'Newegg', url: 'https://www.newegg.com/p/N1', title: 'MSI SSD 1TB', status: 'buy', pick: 1, qty: 1, tags: { dram: 'No' }, price: 179.99, shipping: 0, fetchedAt: '2026-11-09T05:10:59.291Z', genKey: 'x',
            stores: [{ store: 'newegg', url: 'https://www.newegg.com/p/N1', price: 179.99, currency: 'USD', shipping: 0, fetchedAt: '2026-11-09T05:10:59.291Z', prev: { price: 189.99, at: '2026-11-01T00:00:00Z' } }, { store: 'mercadolibre', url: 'https://articulo.mercadolibre.com.co/MCO-1', price: 689900, currency: 'COP' }] },
          { id: 'p3', manual: true, store: 'Tienda local', title: 'Disco local', status: 'buy', pick: 0, price: 50, shipping: 0 },
        ] },
      },
    },
    { id: 'b2', name: 'Copia', parts: { cpu: { selected: [], options: [{ id: 'p9', asin: 'B0D6NN6TM7', title: 'AMD Ryzen 5 9600X', pick: 1, price: 180.49 }] } } },
  ],
};

test('migración: producto, filas por tienda, candidatos, pagado e historial', () => {
  const { state, report } = migrateV1(v1, { now: '2026-11-09T00:00:00Z' });
  normalize(state);
  assert.equal(report.products, 3); // el ASIN copiado en el segundo armado es un solo producto
  assert.equal(report.candidates, 4);
  const cpu = state.products.p1;
  assert.equal(cpu.offers[0].store, 'amazon-co');
  assert.equal(cpu.offers[0].tax, 0);
  assert.equal(cpu.offers[0].history.length, 1);
  const ssd = state.products.p2;
  assert.deepEqual(ssd.offers.map((o) => o.store), ['newegg', 'mercadolibre']);
  assert.equal(ssd.offers[0].history.length, 2); // prev + actual
  assert.equal(ssd.specOverrides.dram, 'No');
  assert.equal(ssd.genKey, undefined);
  assert.equal(state.products.p3.offers[0].store, 'custom-tienda-local-co');
  assert.equal(state.stores['custom-tienda-local-co'].taxMode, 'included');
  const [b1, b2] = state.builds;
  assert.equal(b1.budget.amount, 2000);
  const c1 = b1.candidates.find((c) => c.productId === 'p1');
  assert.equal(c1.purchase.total.amount, 175.5);
  assert.equal(c1.decision, 3);
  assert.equal(b1.candidates.find((c) => c.productId === 'p2').purchaseOfferId, ssd.offers[0].id); // elegido: conserva la tienda de V1
  assert.equal(b1.candidates.find((c) => c.productId === 'p3').purchaseOfferId, null); // no elegido: sugerida
  assert.equal(b2.candidates[0].productId, 'p1');
  assert.equal(state.settings.taxRules.find((r) => r.id === 'mia-sales').rate, 0.06);
  const t = totals(state, b1, envOf(state));
  assert.equal(t.bought.total, 175.5);
  assert.equal(t.toBuy.total, 192.59); // 179.99 + 7 % sales tax
});

test('migración no modifica la entrada', () => {
  const copy = structuredClone(v1);
  migrateV1(copy);
  assert.deepEqual(copy, v1);
});

const real = fileURLToPath(new URL('../../data/store.json', import.meta.url));
test('migración de los datos reales de V1 (si están)', { skip: !existsSync(real) }, () => {
  const { report } = migrateV1(JSON.parse(readFileSync(real, 'utf8')));
  assert.ok(report.options >= 200);
  assert.equal(report.offers.newegg >= 100, true);
  assert.ok(report.paid >= 1);
});
