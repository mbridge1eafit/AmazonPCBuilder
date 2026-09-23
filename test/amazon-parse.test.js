import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { amount, parseBox, parseOfferText, parseSellerText, offerSeller, offerShipsFrom, undouble, guessCategory, bestNewOffer, deliversToColombia, readProduct } from '../public/amazon-parse.js';

test('importes en USD y COP', () => {
  assert.deepEqual(amount('US$1,234.56'), { value: 1234.56, currency: 'USD' });
  assert.deepEqual(amount('$99.99'), { value: 99.99, currency: 'USD' });
  assert.deepEqual(amount('COP566,096.45'), { value: 566096.45, currency: 'COP' });
  assert.deepEqual(amount('COP 0'), { value: 0, currency: 'COP' });
  assert.equal(amount('sin precio'), null);
});

test('caja de compra sin sesión, español/USD', () => {
  const r = parseBox('US$99.99US$99.99 Sin cargos de importación y US$21.60 de envío a Colombia Detalles Detalles de envío y tarifa Precio US$99.99 Envío de AmazonGlobal US$21.60 Cargos estimados de importación US$0.00 Total US$121.59 Entrega por US$21.60 el domingo');
  assert.deepEqual([r.priceFromBox, r.currency, r.shipping, r.importFees, r.total], [99.99, 'USD', 21.6, 0, 121.59]);
});

test('caja de compra con sesión, inglés/USD (texto real de la cuenta)', () => {
  const box = '$179.00$179.00 No Import Charges & $17.38 Shipping to Colombia Details Shipping & Fee Details Price $179.00 AmazonGlobal Shipping $17.38 Estimated Import Charges $0.00 Total $196.38 Delivery Monday, September 28 to Colombia. Order within 1 hr 39 mins Deliver to Mauricio - Medellin 050022 In Stock';
  const r = parseBox(box);
  assert.deepEqual([r.priceFromBox, r.shipping, r.importFees, r.total], [179, 17.38, 0, 196.38]);
  assert.equal(deliversToColombia('Medellin 050022‌', box), true);
});

test('caja de compra en COP', () => {
  const r = parseBox('COP566,096.45COP566,096.45 Sin cargos de importación y COP 54,965.12 de envío a Colombia Detalles Precio COP 566,096.45 Envío de AmazonGlobal COP 54,965.12 Cargos estimados de importación COP 0 Total COP 621,061.57');
  assert.deepEqual([r.priceFromBox, r.currency, r.shipping, r.importFees, r.total], [566096.45, 'COP', 54965.12, 0, 621061.57]);
});

test('caja de compra con cargos (> US$200) y producto no enviable', () => {
  const r = parseBox('US$239.98 US$47.64 de cargos de importación y envío GRATIS a Colombia Precio US$239.98 Cargos estimados de importación US$47.64 Total US$287.62');
  assert.deepEqual([r.shipping, r.importFees, r.total], [0, 47.64, 287.62]);
  assert.equal(parseBox('$59.99 This item cannot be shipped to your selected delivery location.').blocked, true);
});

test('dirección: ciudad sin "Colombia" o variante sin ubicación', () => {
  assert.equal(deliversToColombia('Colombia', ''), true);
  assert.equal(deliversToColombia('Elige tu dirección', 'US$179.00 Agregar al carrito'), false);
});

test('vendedor: español, inglés y "Shipper / Seller"', () => {
  assert.equal(undouble('Amazon.com Amazon.com'), 'Amazon.com');
  assert.equal(undouble('Sales For YouSales For You'), 'Sales For You');
  assert.deepEqual(parseSellerText('Envío por Amazon.com Vendedor Amazon.com Devoluciones Reembolsable'), { seller: 'Amazon.com', shipsFrom: 'Amazon.com' });
  assert.deepEqual(parseSellerText('Shipper / Seller Amazon.com Amazon.com Shipper / Seller Amazon.com Returns 30-day refund'), { seller: 'Amazon.com', shipsFrom: 'Amazon.com' });
  assert.deepEqual(parseSellerText('Ships from Amazon Sold by Cable Matters Returns 30-day'), { seller: 'Cable Matters', shipsFrom: 'Amazon' });
});

test('ofertas: condición, envío, vendedor', () => {
  const nuevo = parseOfferText('Nuevo Agregado US$118.00 US$118.00 Entrega por US$20.45 el domingo, 27 de septiembre. Envío por Amazon.com Vendedor electrolert');
  assert.deepEqual([nuevo.condition, nuevo.shipping], ['Nuevo', 20.45]);
  const en = parseOfferText('New Added Updated Not added $179.00 with 19 percent savings $17.38 delivery Monday, September 28', 'New');
  assert.deepEqual([en.condition, en.shipping], ['Nuevo', 17.38]);
  const usado = parseOfferText('Usado - Bueno Agregado US$229.99 Entrega GRATIS el jueves, 1 de octubre', 'Usado - Bueno');
  assert.deepEqual([usado.condition, usado.shipping], ['Usado - Bueno', 0]);
  assert.equal(offerSeller('Sold by Amazon.com'), 'Amazon.com');
  assert.equal(offerSeller('Vendedor electrolert La calificación del vendedor es 5'), 'electrolert');
  assert.equal(offerShipsFrom('Ships from Amazon.com'), 'Amazon.com');
  assert.equal(bestNewOffer([{ price: 120, shipping: 0, condition: 'Nuevo' }, { price: 100, shipping: 30, condition: 'Nuevo' }, { price: 80, shipping: 0, condition: 'Usado' }]).price, 120);
});

test('readProduct sobre HTML (adaptador cheerio, equivalente al DOM del conector)', () => {
  const html = `<html><body>
    <span id="productTitle"> MSI MAG B850 Tomahawk WiFi Motherboard, ATX </span>
    <span id="glow-ingress-line2">Medellin 050022&zwnj;</span>
    <img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/81SKBZ1sZnL._AC_SL1500_.jpg">
    <span id="acrPopover" title="4.3 out of 5 stars"></span><span id="acrCustomerReviewText">(13)</span>
    <div id="corePrice_feature_div"><span class="a-offscreen">$179.00</span></div>
    <div id="desktop_buybox">$179.00 No Import Charges &amp; $17.38 Shipping to Colombia AmazonGlobal Shipping $17.38 Estimated Import Charges $0.00 Total $196.38
      <div id="availability"> In Stock </div>
      <div id="merchantInfoFeature_feature_div"><span class="offer-display-feature-text-message">Amazon.com</span></div>
      <script>var x = "$999.99";</script></div>
    <table id="productDetails_techSpec_section_1"><tr><th>CPU Socket</th><td>Socket AM5</td></tr></table>
  </body></html>`;
  const $ = cheerio.load(html);
  $('script, style').remove();
  const r = { one: (s, n) => (n ? $(n).find(s) : $(s)).get(0) ?? null, all: (s, n) => (n ? $(n).find(s) : $(s)).toArray(), text: (n) => (n ? $(n).text() : ''), attr: (n, a) => (n ? $(n).attr(a) ?? null : null) };
  const p = readProduct(r);
  assert.deepEqual([p.price, p.currency, p.shipping, p.importFees, p.total, p.seller, p.availability, p.locationOk, p.shipsToCO, p.rating, p.reviews], [179, 'USD', 17.38, 0, 196.38, 'Amazon.com', 'In Stock', true, true, 4.3, 13]);
  assert.equal(p.deliverTo, 'Medellin 050022');
  assert.equal(p.specs['CPU Socket'], 'Socket AM5');
});

test('categoría sugerida por título', () => {
  assert.equal(guessCategory('ARCTIC P12 PWM PST (5 Pack) - Ventiladores de PC'), 'fans');
  assert.equal(guessCategory('Thermalright Phantom Spirit 120 EVO - Enfriador de aire para CPU'), 'cooler');
  assert.equal(guessCategory('MSI MPG A850GS PCIE5, fuente de alimentación 850W'), 'psu');
  assert.equal(guessCategory('Kingston NV3 1TB M.2 2280 NVMe SSD'), 'storage');
  assert.equal(guessCategory('GIGABYTE GeForce RTX 5070 Ti Gaming OC 16G'), 'gpu');
  assert.equal(guessCategory('MSI MAG B850 Tomahawk WiFi Motherboard, ATX - Supports AMD Ryzen 9000'), 'motherboard');
  assert.equal(guessCategory('Cable Matters Paquete de 3 cables SATA III'), 'accessories');
});

test('vendedor externo en inglés con métricas y enlace "Learn more" (texto real)', () => {
  const tab = 'Ships from Amazon Amazon Ships from Amazon Sold by Thermalright Direct Thermalright Direct 100k+ Orders fulfilled in past year 5+ Years on Amazon Learn more about the seller Returns 30-day refund';
  assert.deepEqual(parseSellerText(tab), { seller: 'Thermalright Direct', shipsFrom: 'Amazon' });
});
