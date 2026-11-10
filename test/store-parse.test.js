import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStorePrice, storePriceNumber, storeOfUrl, urlFitsStore, storeBlocked } from '../public/js/connector/store-parse.js';

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

test('readStorePrice: Newegg toma el FinalPrice del ítem de la ficha, no el de relacionados', () => {
  // Recorte real (990 PRO 2TB): el primer FinalPrice del estado embebido es de otro artículo.
  const html = '<link rel="canonical" href="https://www.newegg.com/samsung-2tb-990-pro-nvme-2-0/p/N82E16820147861"/>'
    + '<script>{"ItemNumber":"20-147-861"},{"Item":"20-985-132","UnitCost":129.99,"FinalPrice":102.99,"Instock":true}'
    + ',{"ItemPriceRange":{"PriceRangeMin":386,"PriceRangeMax":805.36},"Item":"20-147-861","Qty":517,"UnitCost":639.99,"InstantRebateAmount":250,"ExchangeRate":0,"FinalPrice":389.99,"Instock":true}</script>';
  assert.equal(readStorePrice(html, 'newegg').price, 389.99);
  const market = '<meta property="og:url" content="https://www.newegg.com/p/9SIA12345678"><script>{"Item":"1-2-3","FinalPrice":5},{"Item":"9SIA12345678","FinalPrice":77.5}</script>';
  assert.equal(readStorePrice(market, 'newegg').price, 77.5);
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

test('storeOfUrl: Walmart, Target y B&H', () => {
  assert.equal(storeOfUrl('https://www.walmart.com/ip/x/123'), 'walmart');
  assert.equal(storeOfUrl('https://www.target.com/p/x/-/A-1'), 'target');
  assert.equal(storeOfUrl('https://www.bhphotovideo.com/c/product/1-REG/x.html'), 'bhphoto');
});
