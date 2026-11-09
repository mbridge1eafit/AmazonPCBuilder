import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStorePrice, storePriceNumber, storeOfUrl, urlFitsStore, storeBlocked } from '../public/stores.js';
import { storeRows, shownStores, setStorePrice, amazonStorePrice, ownAmazonStore, isDeal, lineCost, viewOptions, DEFAULT_SETTINGS } from '../public/logic.js';

const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;

test('storePriceNumber: formatos de USD y COP', () => {
  assert.equal(storePriceNumber('$449.99'), 449.99);
  assert.equal(storePriceNumber('1,299.00'), 1299);
  assert.equal(storePriceNumber('1.899.900', 'COP'), 1899900);
  assert.equal(storePriceNumber('1.899.900,50', 'COP'), 1899901);
  assert.equal(storePriceNumber(1899900, 'COP'), 1899900);
  assert.equal(storePriceNumber('449,99'), 449.99);
  assert.equal(storePriceNumber(''), null);
  assert.equal(storePriceNumber('0'), null);
});

test('storeOfUrl y urlFitsStore', () => {
  assert.equal(storeOfUrl('https://www.newegg.com/p/N82E16819113787'), 'newegg');
  assert.equal(storeOfUrl('https://articulo.mercadolibre.com.co/MCO-123-ryzen'), 'mercadolibre');
  assert.equal(storeOfUrl('https://www.bestbuy.com/site/x/123.p'), 'bestbuy');
  assert.equal(storeOfUrl('https://www.microcenter.com/product/674503/x'), 'microcenter');
  assert.equal(storeOfUrl('https://www.amazon.com/dp/B0BTZB7F88'), 'amazon');
  assert.equal(storeOfUrl('http://www.newegg.com/x'), null);
  assert.equal(storeOfUrl('https://newegg.com.evil.io/x'), null);
  assert.ok(urlFitsStore('https://www.amazon.com/dp/B0BTZB7F88', 'amazon-us'));
  assert.ok(!urlFitsStore('https://www.newegg.com/x', 'bestbuy'));
});

test('readStorePrice: JSON-LD con oferta (Newegg/Best Buy)', () => {
  const html = `<html><head><title>x</title>${ld({ '@context': 'https://schema.org', '@type': 'Product', name: 'AMD Ryzen 7 7800X3D', offers: { '@type': 'Offer', price: '449.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } })}</head></html>`;
  assert.deepEqual(readStorePrice(html, 'newegg'), { price: 449.99, currency: 'USD', title: 'AMD Ryzen 7 7800X3D', inStock: true });
});

test('readStorePrice: @graph, lista de ofertas y AggregateOffer', () => {
  const g = ld({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'Product', name: 'GPU', offers: [{ '@type': 'AggregateOffer', lowPrice: 599, priceCurrency: 'USD', availability: 'OutOfStock' }] }] });
  assert.deepEqual(readStorePrice(g, 'bestbuy'), { price: 599, currency: 'USD', title: 'GPU', inStock: false });
});

test('readStorePrice: Mercado Libre en COP', () => {
  const html = ld({ '@type': 'Product', name: 'Procesador Ryzen 7 7800X3D', offers: { price: 1899900, priceCurrency: 'COP', availability: 'http://schema.org/InStock' } });
  const r = readStorePrice(html, 'mercadolibre');
  assert.equal(r.price, 1899900);
  assert.equal(r.currency, 'COP');
});

test('readStorePrice: microdatos y patrones propios cuando no hay JSON-LD', () => {
  assert.equal(readStorePrice('<meta itemprop="price" content="329.99"><title>MC</title>', 'microcenter').price, 329.99);
  assert.equal(readStorePrice('<meta content="1.234.000" itemprop="price">', 'mercadolibre').price, 1234000);
  assert.equal(readStorePrice('<meta property="product:price:amount" content="99.5">', 'newegg').price, 99.5);
  assert.equal(readStorePrice('<script>{"currentPrice":279.99,"regularPrice":299.99}</script>', 'bestbuy').price, 279.99);
  assert.equal(readStorePrice('<script>{"FinalPrice":189.99}</script>', 'newegg').price, 189.99);
  assert.equal(readStorePrice('<span data-price="1,049.99">', 'microcenter').price, 1049.99);
  assert.equal(readStorePrice('<html><title>Nada</title></html>', 'newegg').price, null);
});

test('readStorePrice: JSON-LD inválido no rompe', () => {
  const html = '<script type="application/ld+json">{oops</script><meta itemprop="price" content="10.00">';
  assert.equal(readStorePrice(html, 'newegg').price, 10);
});

test('storeBlocked: páginas de verificación', () => {
  assert.ok(storeBlocked('<html><head><title>Just a moment...</title></head>'));
  assert.ok(storeBlocked('<title>Attention Required! | Cloudflare</title>'));
  assert.ok(!storeBlocked(`<title>Producto</title>${ld({ '@type': 'Product' })}`));
});

const S = { ...DEFAULT_SETTINGS, trm: 4000 };

test('ownAmazonStore: según el destino del producto', () => {
  assert.equal(ownAmazonStore({ asin: 'B0BTZB7F88' }), 'amazon-co');
  assert.equal(ownAmazonStore({ asin: 'B0BTZB7F88', market: 'miami' }), 'amazon-us');
  assert.equal(ownAmazonStore({ manual: true, title: 'x' }), null);
});

test('amazonStorePrice: Colombia con cargos, Miami precio + envío', () => {
  assert.equal(amazonStorePrice({ price: 100, shipping: 20, importFees: 5 }, 'co', S), 125);
  assert.equal(amazonStorePrice({ price: 100, shipping: 20 }, 'us', S), 120);
  assert.equal(amazonStorePrice({ price: null }, 'us', S), null);
});

test('storeRows y shownStores: fila propia, conversión COP y el más bajo', () => {
  const p = {
    asin: 'B0BTZB7F88', url: 'https://www.amazon.com/dp/B0BTZB7F88', price: 400, shipping: 20, importFees: 0, fetchedAt: '2026-11-01T00:00:00Z',
    stores: [
      { store: 'newegg', url: 'https://www.newegg.com/p/1', price: 410, currency: 'USD' },
      { store: 'mercadolibre', url: 'https://articulo.mercadolibre.com.co/MCO-1', price: 1600000, currency: 'COP' },
      { store: 'bestbuy', url: '', price: 300, currency: 'USD' }, // sin enlace: no se muestra
      { store: 'microcenter', url: 'https://www.microcenter.com/product/1', price: null, currency: 'USD' }, // sin precio
    ],
  };
  const rows = storeRows(p, S);
  assert.deepEqual(rows.map((r) => r.store), ['amazon-co', 'newegg', 'bestbuy', 'microcenter', 'mercadolibre']);
  assert.equal(rows[0].own, true);
  assert.equal(rows[0].price, 420);
  assert.equal(rows.find((r) => r.store === 'mercadolibre').usd, 400);
  const shown = shownStores(p, S);
  assert.deepEqual(shown.map((r) => r.store), ['amazon-co', 'newegg', 'mercadolibre']);
  assert.deepEqual(shown.filter((r) => r.best).map((r) => r.store), ['mercadolibre']);
});

test('setStorePrice: guarda el anterior y marca error sin precio', () => {
  const row = { store: 'newegg', url: 'u', price: 100, currency: 'USD', fetchedAt: 'a' };
  setStorePrice(row, { price: 90, currency: 'USD' }, 'b');
  assert.deepEqual(row.prev, { price: 100, at: 'a' });
  assert.equal(row.price, 90);
  assert.equal(row.error, null);
  setStorePrice(row, { price: null }, 'c');
  assert.equal(row.price, 90);
  assert.equal(row.error, 'La ficha no mostró precio');
});

test('storeRows: tiendas de EE. UU. con envío y sales tax de Miami, y oferta', () => {
  const p = {
    manual: true, title: 'x',
    stores: [
      { store: 'walmart', url: 'https://www.walmart.com/ip/1', price: 200, currency: 'USD', shipping: 10, listPrice: 250 },
      { store: 'target', url: 'https://www.target.com/p/-/A-1', price: 205, currency: 'USD', shipping: 0, listPrice: 205 },
    ],
  };
  const rows = storeRows(p, S);
  const wm = rows.find((r) => r.store === 'walmart');
  assert.equal(wm.tax, 14);
  assert.equal(wm.total, 224);
  assert.equal(wm.usd, 224);
  assert.equal(wm.deal, true);
  const tg = rows.find((r) => r.store === 'target');
  assert.equal(tg.total, 219.35);
  assert.equal(tg.deal, false); // precio de lista igual: no es oferta
  assert.deepEqual(shownStores(p, S).filter((r) => r.best).map((r) => r.store), ['target']);
});

test('isDeal, filtro «En oferta» y tax en productos de tiendas de EE. UU.', () => {
  const deal = { id: 'a', manual: true, salesTax: true, market: 'miami', title: 'A', price: 100, shipping: 5, listPrice: 120 };
  const viaStore = { id: 'b', title: 'B', price: 100, stores: [{ store: 'newegg', url: 'u', price: 90, listPrice: 95 }] };
  const plain = { id: 'c', title: 'C', price: 100, stores: [{ store: 'newegg', url: 'u', price: 90, listPrice: null }] };
  assert.equal(isDeal(deal), true);
  assert.equal(isDeal(viaStore), true);
  assert.equal(isDeal(plain), false);
  assert.deepEqual(viewOptions([deal, viaStore, plain], { deals: true }, 'storage', S).map((p) => p.id).sort(), ['a', 'b']);
  const c = lineCost(deal, S);
  assert.equal(c.importFees, 7);
  assert.equal(c.total, 112);
  assert.equal(lineCost({ ...deal, salesTax: false }, S).total, 105); // manual sin tax: como antes
});

test('setStorePrice: guarda el precio de lista solo si es mayor', () => {
  const row = { store: 'walmart', url: 'u', price: 100, currency: 'USD' };
  setStorePrice(row, { price: 90, currency: 'USD', listPrice: 120 }, 'a');
  assert.equal(row.listPrice, 120);
  setStorePrice(row, { price: 90, currency: 'USD', listPrice: 90 }, 'b');
  assert.equal(row.listPrice, null);
});

test('storeOfUrl: Walmart, Target y B&H', () => {
  assert.equal(storeOfUrl('https://www.walmart.com/ip/x/123'), 'walmart');
  assert.equal(storeOfUrl('https://www.target.com/p/x/-/A-1'), 'target');
  assert.equal(storeOfUrl('https://www.bhphotovideo.com/c/product/1-REG/x.html'), 'bhphoto');
});
