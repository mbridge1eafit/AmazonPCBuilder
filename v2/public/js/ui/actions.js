// @ts-check
// Acciones del usuario que cambian el estado. Las vistas solo las disparan con data-act / data-submit / data-change.
import * as store from '../state/store.js';
import * as link from '../services/connector-link.js';
import * as refresh from '../services/refresh.js';
import * as api from '../services/api.js';
import { on, onSubmit, onChange, ui, rerender, openDialog, closeDialog, refreshDialog, confirmDialog, toast, download } from './ui.js';
import { html, raw } from './dom.js';
import { CAT, CATEGORIES, DECISIONS, decisionLevel, STATUS } from '../domain/categories.js';
import { newCandidate, newOffer, newProduct, newBuild, newId } from '../domain/schema.js';
import { asinOf, merchantOfUrl, urlFitsStore } from '../domain/catalog.js';
import { applyEdits, OFFER_EDITABLE, applyAmazon, sanitizeAmazon, sanitizeInvoices } from '../domain/readings.js';
import { findPaid, orderQuery, toPurchase } from '../domain/paid.js';
import { migrateV1 } from '../domain/migrate-v1.js';
import { toMarkdown } from '../domain/markdown.js';
import { marksOf, setMarks } from '../state/prefs.js';
import { usd, n2 } from './format.js';
import { storeName } from './components.js';
import { go } from './router.js';
import { shortTitle } from '../domain/checks.js';

const st = () => store.get();
const env = () => store.env();
const build = () => store.build();
export const candById = (id) => build().candidates.find((c) => c.id === id);
export const candOfProduct = (pid) => build().candidates.find((c) => c.productId === pid);

// ---------- decisión, estado y selección ----------
on('decide', (el) => {
  const c = candById(el.dataset.cand);
  const lvl = Number(el.dataset.level);
  store.update(() => { c.decision = el.dataset.zero ? 0 : decisionLevel(c.decision) === lvl ? 0 : lvl; });
  if (c.decision === 3 && !c.selected) toast(`Marcado ★★★ fijo, pero el armado usa otra opción en ${CAT[c.category].name}.`, { action: { label: 'Elegirlo', run: () => select(c) } });
});
on('status', (el) => {
  const c = candById(el.dataset.cand);
  const value = el.dataset.value;
  store.update(() => { c.status = value; });
  if (value === 'bought' && !c.purchase) paidDialog(c.id);
});
export function select(c) {
  const multi = CAT[c.category].multi;
  store.update(() => {
    if (multi) c.selected = !c.selected;
    else {
      for (const x of build().candidates) if (x.category === c.category) x.selected = false;
      c.selected = true;
    }
    if (c.selected) c.discarded = false;
  });
}
on('select', (el) => select(candById(el.dataset.cand)));
on('discard', (el) => {
  const c = candById(el.dataset.cand);
  store.update(() => { c.discarded = !c.discarded; if (c.discarded) c.selected = false; });
  if (c.discarded) toast('Opción descartada. Puedes recuperarla en «Ver descartadas».', { action: { label: 'Deshacer', run: () => store.update(() => { c.discarded = false; }) } });
});
on('mark', (el) => {
  const c = candById(el.dataset.cand);
  const ids = new Set(marksOf(c.category));
  if (ids.has(c.id)) ids.delete(c.id); else ids.add(c.id);
  setMarks(c.category, [...ids]);
  rerender();
});
on('unmark', (el) => { setMarks(el.dataset.cat, []); rerender(); });
onChange('purchase-store', (el) => {
  const c = candById(el.dataset.cand);
  store.update(() => { c.purchaseOfferId = el.value || null; });
});
onChange('cand-field', (el) => {
  const c = candById(el.dataset.cand);
  const k = el.dataset.field;
  const v = el.value === '' ? null : el.type === 'number' || ['qty', 'targetPrice', 'wattsOverride'].includes(k) ? Number(el.value) : el.value;
  store.update(() => { c[k] = k === 'qty' ? Math.max(1, Math.min(20, Math.round(Number(v) || 1))) : v; });
});
onChange('cand-alert', (el) => {
  const c = candById(el.dataset.cand);
  store.update(() => { c.alerts = { ...c.alerts, [el.dataset.field]: el.checked }; });
});

// ---------- actualizar ----------
on('refresh-build', () => {
  const plan = refresh.start({ kind: 'build' });
  if (!plan.jobs.length) toast(plan.skipped.length ? `Todo al día: ${plan.skipped.length} filas leídas hace menos de ${st().settings.refreshMinutes} min.` : 'No hay filas con enlace para leer.');
  else go('#/actualizar');
});
on('refresh-product', (el) => {
  const plan = refresh.start({ kind: 'product', productId: el.dataset.product });
  if (!plan.jobs.length) toast(plan.manual.length ? 'Las filas de este producto se escriben a mano (sin enlace o tienda manual).' : 'Nada que leer.');
});
on('refresh-offer', (el) => {
  const plan = refresh.start({ kind: 'offer', productId: el.dataset.product, offerId: el.dataset.offer });
  if (!plan.jobs.length) toast('Esta fila no tiene enlace que se pueda leer: escríbela a mano.');
});
on('refresh-category', (el) => {
  const ps = new Set(build().candidates.filter((c) => c.category === el.dataset.cat && !c.discarded).map((c) => c.productId));
  let n = 0;
  for (const pid of ps) n += refresh.start({ kind: 'product', productId: pid }).jobs.length;
  toast(n ? `${n} filas en cola. Míralas en Actualizar.` : 'Nada que leer en esta categoría.');
});
on('refresh-cancel', () => refresh.cancel());
on('refresh-retry', (el) => refresh.retry(el.dataset.channel || null));
on('open-amazon', (el) => link.openAmazon(el.dataset.path || '/'));
on('open-tab', (el) => link.openTab(el.dataset.origin, el.dataset.url));

// ---------- agregar opciones ----------
onSubmit('add-link', async (form) => {
  const cat = form.dataset.cat;
  const input = form.querySelector('input[name="url"]');
  let url = String(input.value || '').trim();
  ui.addError[cat] = '';
  if (!url) return;
  try {
    if (/^https?:\/\/(amzn\.to|a\.co|amzn\.com)\//i.test(url)) url = (await api.resolveShort(url)) || url;
    const merchant = merchantOfUrl(url, st().merchants);
    if (!merchant) throw new Error('El enlace no es de una tienda conocida (Amazon, Newegg, Best Buy, Walmart, Target, B&H, Micro Center, Mercado Libre). Usa «+ Producto manual».');
    let pid;
    if (merchant === 'amazon') {
      const asin = asinOf(url);
      if (!asin) throw new Error('No encontré un producto en ese enlace de Amazon (falta el ASIN).');
      const existing = Object.values(st().products).find((p) => p.ids?.asin === asin);
      if (existing && build().candidates.some((c) => c.productId === existing.id)) throw new Error('Ese producto ya está en el armado.');
      store.update((s) => {
        const p = existing || newProduct({ category: cat, title: `Leyendo ${asin} con tu sesión…`, ids: { asin, mpn: null, upc: null } });
        if (!existing) {
          p.offers.push(newOffer(link.amazonStoreNow() || 'amazon-co', { url: `https://www.amazon.com/dp/${asin}` }));
          s.products[p.id] = p;
        }
        build().candidates.push(newCandidate(p.id, cat));
        pid = p.id;
      });
    } else {
      const storeKey = Object.values(st().stores).find((x) => x.merchant === merchant)?.key;
      store.update((s) => {
        const p = newProduct({ category: cat, title: shortTitle(decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).find((x) => /[a-z]{3,}-/i.test(x)) || 'Producto nuevo').replace(/-/g, ' '), 90) });
        p.offers.push(newOffer(storeKey, { url }));
        s.products[p.id] = p;
        build().candidates.push(newCandidate(p.id, cat));
        pid = p.id;
      });
    }
    input.value = '';
    refresh.start({ kind: 'product', productId: pid });
    toast('Agregado. Se completa al leerlo con el marcador.');
  } catch (e) {
    ui.addError[cat] = e.message;
  }
  rerender();
});
on('search-amazon', (el) => {
  const q = /** @type {HTMLInputElement|null} */ (document.querySelector(`#add-${el.dataset.cat}`))?.value || CAT[el.dataset.cat].name;
  link.openAmazon(`/s?k=${encodeURIComponent(q)}#pcb=${el.dataset.cat}`);
});

on('manual-product', (el) => manualDialog(el.dataset.cat));
function manualDialog(cat) {
  const stores = Object.values(st().stores);
  openDialog(() => html`<form data-submit="manual-product" data-cat="${cat}">
    <div class="dlg-h"><h2 id="dlg-title">Producto manual · ${CAT[cat].name}</h2><button type="button" class="btn btn-g btn-s" data-act="close-dialog" aria-label="Cerrar">✕</button></div>
    <div class="dlg-b"><div class="edit-grid">
      <label class="fld span4">Nombre<input class="input" name="title" required autofocus></label>
      <label class="fld span2">Tienda<select class="input" name="store">${stores.map((s) => html`<option value="${s.key}">${s.name} · ${st().settings.destinations[s.destination]?.short} · ${s.currency}</option>`)}</select></label>
      <label class="fld">Precio<input class="input num" name="price" inputmode="decimal"><small>En la moneda de la tienda</small></label>
      <label class="fld">Envío<input class="input num" name="shipping" inputmode="decimal"><small>Vacío = sin dato</small></label>
      <label class="fld span4">Enlace (opcional)<input class="input" name="url" placeholder="https://…"><small>Se valida contra el dominio de la tienda.</small></label>
      <label class="fld span2">Foto (URL, opcional)<input class="input" name="image"></label>
      <label class="fld">Estado<select class="input" name="status">${Object.values(STATUS).map((s) => html`<option value="${s.key}">${s.label}</option>`)}</select></label>
      <label class="fld">Cantidad<input class="input num" name="qty" type="number" min="1" max="20" value="1"></label>
    </div><p class="muted" id="manual-err" role="alert" style="margin:0;color:var(--err)"></p></div>
    <div class="dlg-f"><button type="button" class="btn" data-act="close-dialog">Cancelar</button><button class="btn btn-p">Agregar</button></div></form>`);
}
onSubmit('manual-product', (form, d) => {
  const s = st().stores[d.store];
  if (d.url && !urlFitsStore(d.url, s, st().merchants)) { form.querySelector('#manual-err').textContent = `El enlace no es de ${s.name}.`; return; }
  store.update((state) => {
    const p = newProduct({ category: form.dataset.cat, title: d.title, image: d.image || null });
    p.offers.push(newOffer(d.store, { url: d.url || null, price: num(d.price), shipping: num(d.shipping), currency: s.currency, edited: num(d.price) != null ? { price: new Date().toISOString() } : {} }));
    if (merchantOfUrl(d.url || '') === 'amazon') p.ids.asin = asinOf(d.url);
    state.products[p.id] = p;
    build().candidates.push(newCandidate(p.id, form.dataset.cat, { status: d.status, qty: Math.max(1, Number(d.qty) || 1) }));
  });
  closeDialog();
  toast('Producto agregado.');
});
export const num = (v) => (v == null || String(v).trim() === '' ? null : Number(String(v).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.')));

// ---------- filas producto × tienda ----------
on('toggle-expand', (el) => { ui.expanded[el.dataset.offer] = !ui.expanded[el.dataset.offer]; rerender(); });
on('offer-edit', (el) => offerDialog(el.dataset.product, el.dataset.offer));
on('offer-add', (el) => offerDialog(el.dataset.product, null));
function offerDialog(pid, oid) {
  const p = st().products[pid];
  const o = oid ? p.offers.find((x) => x.id === oid) : null;
  const used = new Set(p.offers.map((x) => x.store));
  const stores = Object.values(st().stores).filter((s) => !used.has(s.key) || s.key === o?.store);
  const f = (k) => (o?.[k] ?? '');
  openDialog(() => html`<form data-submit="offer-save" data-product="${pid}" data-offer="${oid || ''}">
    <div class="dlg-h"><h2 id="dlg-title">${o ? `Editar fila · ${storeName(env(), o.store)}` : 'Agregar tienda'}</h2><button type="button" class="btn btn-g btn-s" data-act="close-dialog" aria-label="Cerrar">✕</button></div>
    <div class="dlg-b"><div class="edit-grid">
      <label class="fld span2">Tienda<select class="input" name="store"${raw(o ? ' disabled' : '')}>${stores.map((s) => html`<option value="${s.key}"${raw(s.key === o?.store ? ' selected' : '')}>${s.name} · ${st().settings.destinations[s.destination]?.short} · ${s.currency}</option>`)}</select><small>El destino y la moneda vienen de la tienda.</small></label>
      <label class="fld span2">Enlace<input class="input" name="url" value="${f('url')}" placeholder="https://…"></label>
      <label class="fld">Precio<input class="input num" name="price" value="${f('price')}" inputmode="decimal"></label>
      <label class="fld">Envío al destino<input class="input num" name="shipping" value="${f('shipping')}" inputmode="decimal"><small>Vacío = sin dato · 0 = gratis</small></label>
      <label class="fld">Impuesto<input class="input num" name="tax" value="${o?.edited?.tax || o?.store === 'amazon-co' ? f('tax') : ''}" inputmode="decimal"><small>Vacío = se estima con la regla</small></label>
      <label class="fld">Precio «antes»<input class="input num" name="listPrice" value="${f('listPrice')}" inputmode="decimal"></label>
      <label class="fld">Cupón / reembolso<input class="input num" name="discount" value="${f('discount')}" inputmode="decimal"></label>
      <label class="fld">Vendedor<input class="input" name="seller" value="${f('seller')}"></label>
      <label class="fld">Entrega<input class="input" name="delivery" value="${f('delivery')}" placeholder="3–5 días"></label>
      <label class="fld">¿Envía al destino?<select class="input" name="shipsToDestination">${[['', 'Sin confirmar'], ['true', 'Sí'], ['false', 'No']].map(([v, t]) => html`<option value="${v}"${raw(String(o?.shipsToDestination ?? '') === v ? ' selected' : '')}>${t}</option>`)}</select></label>
      <label class="fld span2">Variante<select class="input" name="variantMatch">${[['', 'Sin revisar'], ['exact', 'Exacto (identificador)'], ['name', 'Por nombre'], ['doubtful', 'Dudoso']].map(([v, t]) => html`<option value="${v}"${raw((o?.variantMatch || '') === v ? ' selected' : '')}>${t}</option>`)}</select></label>
      <label class="fld span2">Notas (garantía, devoluciones…)<input class="input" name="notes" value="${f('notes')}"></label>
    </div>
    <p class="muted" style="margin:0;font-size:12px">Todos los campos son opcionales. Lo que escribas queda marcado «editado» y el lector no lo pisa, salvo que lea un precio confirmado para el destino.</p>
    <p id="offer-err" role="alert" style="margin:0;color:var(--err)"></p></div>
    <div class="dlg-f">${o ? html`<button type="button" class="btn btn-danger" data-act="offer-remove" data-product="${pid}" data-offer="${o.id}" style="margin-right:auto">Quitar fila</button>${Object.keys(o.edited || {}).length ? html`<button type="button" class="btn" data-act="offer-unedit" data-product="${pid}" data-offer="${o.id}">Volver a lo leído</button>` : ''}` : ''}
    <button type="button" class="btn" data-act="close-dialog">Cancelar</button><button class="btn btn-p">Guardar</button></div></form>`);
}
onSubmit('offer-save', (form, d) => {
  const pid = form.dataset.product, oid = form.dataset.offer;
  const p = st().products[pid];
  const storeKey = oid ? p.offers.find((x) => x.id === oid).store : d.store;
  const s = st().stores[storeKey];
  if (d.url && !urlFitsStore(d.url, s, st().merchants)) { form.querySelector('#offer-err').textContent = `Ese enlace no es de ${s.name} (${st().merchants[s.merchant]?.domain}).`; return; }
  store.update(() => {
    let o = p.offers.find((x) => x.id === oid);
    if (!o) { o = newOffer(storeKey, { currency: s.currency }); p.offers.push(o); }
    const values = { ...d, price: num(d.price), shipping: num(d.shipping), tax: num(d.tax), listPrice: num(d.listPrice), discount: num(d.discount), shipsToDestination: d.shipsToDestination === '' ? null : d.shipsToDestination === 'true', variantMatch: d.variantMatch || null };
    applyEdits(o, values, OFFER_EDITABLE.filter((k) => k !== 'currency'), { env: env(), product: p });
    if (values.tax == null && o.edited) delete o.edited.tax;
    if (o.url && merchantOfUrl(o.url) === 'amazon' && !p.ids.asin) p.ids.asin = asinOf(o.url);
  });
  closeDialog();
});
on('offer-remove', async (el) => {
  const p = st().products[el.dataset.product];
  const o = p.offers.find((x) => x.id === el.dataset.offer);
  if (!(await confirmDialog({ title: 'Quitar fila', body: `Se quita ${storeName(env(), o.store)} de este producto, con su historial.`, ok: 'Quitar', danger: true }))) return;
  store.update(() => {
    p.offers = p.offers.filter((x) => x !== o);
    for (const b of st().builds) for (const c of b.candidates) if (c.purchaseOfferId === o.id) c.purchaseOfferId = null;
  });
});
on('offer-unedit', (el) => {
  const p = st().products[el.dataset.product];
  const o = p.offers.find((x) => x.id === el.dataset.offer);
  store.update(() => { o.edited = {}; });
  closeDialog();
  refresh.start({ kind: 'offer', productId: p.id, offerId: o.id });
  toast('Ediciones descartadas: la próxima lectura reescribe la fila.');
});
onChange('purchase-radio', (el) => {
  const c = candById(el.dataset.cand);
  store.update(() => { c.purchaseOfferId = el.value; });
});
on('purchase-suggested', (el) => { const c = candById(el.dataset.cand); store.update(() => { c.purchaseOfferId = null; }); });

// ---------- datos del producto ----------
on('product-edit', (el) => productDialog(el.dataset.product));
function productDialog(pid) {
  const p = st().products[pid];
  openDialog(() => html`<form data-submit="product-save" data-product="${pid}">
    <div class="dlg-h"><h2 id="dlg-title">Datos del producto</h2><button type="button" class="btn btn-g btn-s" data-act="close-dialog" aria-label="Cerrar">✕</button></div>
    <div class="dlg-b"><div class="edit-grid">
      <label class="fld span4">Título<input class="input" name="title" value="${p.title}"></label>
      <label class="fld">Marca<input class="input" name="brand" value="${p.brand || ''}"></label>
      <label class="fld">Modelo<input class="input" name="model" value="${p.model || ''}"></label>
      <label class="fld">Categoría<select class="input" name="category">${CATEGORIES.map((c) => html`<option value="${c.key}"${raw(c.key === p.category ? ' selected' : '')}>${c.name}</option>`)}</select></label>
      <label class="fld">Peso (lb)<input class="input num" name="weightLb" value="${p.weightLb ?? ''}" inputmode="decimal"><small>Para el casillero</small></label>
      <label class="fld">MPN<input class="input" name="mpn" value="${p.ids.mpn || ''}"></label>
      <label class="fld">UPC<input class="input" name="upc" value="${p.ids.upc || ''}"></label>
      <label class="fld">ASIN<input class="input" name="asin" value="${p.ids.asin || ''}"></label>
      <label class="fld">Foto (URL)<input class="input" name="image" value="${p.image || ''}"></label>
      <label class="fld span4">Notas<textarea class="input" name="notes">${p.notes || ''}</textarea></label>
    </div></div>
    <div class="dlg-f"><button type="button" class="btn btn-danger" data-act="product-delete" data-product="${pid}" style="margin-right:auto">Eliminar producto</button><button type="button" class="btn" data-act="close-dialog">Cancelar</button><button class="btn btn-p">Guardar</button></div></form>`);
}
onSubmit('product-save', (form, d) => {
  const p = st().products[form.dataset.product];
  store.update(() => {
    applyEdits(p, { title: d.title, brand: d.brand, model: d.model, image: d.image, notes: d.notes, weightLb: num(d.weightLb) }, ['title', 'brand', 'model', 'image', 'notes', 'weightLb']);
    if (num(d.weightLb) != null) p.edited.weightLb = new Date().toISOString();
    p.ids = { ...p.ids, mpn: d.mpn || null, upc: d.upc || null, asin: (d.asin || '').toUpperCase() || null };
    if (d.category !== p.category) {
      p.category = d.category;
      for (const b of st().builds) for (const c of b.candidates) if (c.productId === p.id) { c.category = d.category; c.selected = false; }
    }
  });
  closeDialog();
});
on('product-delete', async (el) => {
  const p = st().products[el.dataset.product];
  if (!(await confirmDialog({ title: 'Eliminar producto', body: `«${shortTitle(p.title, 60)}» se elimina de todos los armados, con sus tiendas e historial. No se puede deshacer (exporta antes si lo necesitas).`, ok: 'Eliminar', danger: true }))) return;
  store.update((s) => {
    delete s.products[p.id];
    for (const b of s.builds) b.candidates = b.candidates.filter((c) => c.productId !== p.id);
  });
  go(`#/c/${p.category}`);
});
on('specs-edit', (el) => specsDialog(el.dataset.product));
import { featuresFor, detectTags, specView } from '../domain/specs.js';
const TAG_FIELDS = {
  cpu: [['socket', 'Socket'], ['tdp', 'TDP (W)']], cooler: [['sockets', 'Montajes / sockets'], ['heightMm', 'Altura (mm)']],
  motherboard: [['socket', 'Socket'], ['formFactor', 'Formato'], ['memType', 'Memoria (DDR4/DDR5)'], ['m2Slots', 'Ranuras M.2'], ['sataPorts', 'Puertos SATA']],
  ram: [['memType', 'Tipo (DDR4/DDR5)'], ['capacityGb', 'Capacidad (GB)'], ['sticks', 'Módulos']], gpu: [['needs12v2x6', 'Requiere 12V-2x6 (true/false)']],
  storage: [['capacityGb', 'Capacidad (GB)'], ['interface', 'Interfaz (NVMe/SATA)'], ['pcie', 'PCIe'], ['dram', 'DRAM (Sí/No)'], ['dramType', 'Tipo de DRAM'], ['nand', 'NAND'], ['controller', 'Controlador'], ['heatsink', 'Disipador (Sí/No)'], ['readMBs', 'Lectura (MB/s)'], ['writeMBs', 'Escritura (MB/s)'], ['tbw', 'Durabilidad (TBW)']],
  psu: [['psuWatts', 'Potencia (W)'], ['has12v2x6', '12V-2x6 (true / adaptable / false)']], case: [['formFactor', 'Placa máxima'], ['coolerMaxMm', 'Disipador máx. (mm)']],
  fans: [['count', 'Unidades en el pack']], accessories: [['joules', 'Protección (J)'], ['outlets', 'Tomas'], ['vpr', 'VPR (V)'], ['capacityW', 'Capacidad (W)']],
  monitor: [], peripherals: [],
};
export const tagFields = (cat) => TAG_FIELDS[cat] || [];
function specsDialog(pid) {
  const p = st().products[pid];
  const auto = detectTags({ ...specView(p), tags: {} }, p.category);
  openDialog(() => html`<form data-submit="specs-save" data-product="${pid}">
    <div class="dlg-h"><h2 id="dlg-title">Datos para compatibilidad · ${CAT[p.category].name}</h2><button type="button" class="btn btn-g btn-s" data-act="close-dialog" aria-label="Cerrar">✕</button></div>
    <div class="dlg-b"><p class="muted" style="margin:0;font-size:13px">Lo que escribas manda sobre lo detectado. Vacío = usar lo detectado (se muestra de guía).</p>
    <div class="edit-grid">${tagFields(p.category).map(([k, label]) => html`<label class="fld span2">${label}<input class="input" name="${k}" value="${p.specOverrides?.[k] ?? ''}" placeholder="${auto[k] == null ? 'no detectado' : `detectado: ${auto[k]}`}"></label>`)}
    ${tagFields(p.category).length ? '' : html`<p class="muted span4">Esta categoría no tiene datos de compatibilidad.</p>`}</div></div>
    <div class="dlg-f"><button type="button" class="btn" data-act="close-dialog">Cancelar</button><button class="btn btn-p">Guardar</button></div></form>`);
}
onSubmit('specs-save', (form, d) => {
  const p = st().products[form.dataset.product];
  store.update(() => {
    const o = {};
    for (const [k, v] of Object.entries(d)) {
      const t = String(v).trim();
      if (!t) continue;
      o[k] = t === 'true' ? true : t === 'false' ? false : /^\d+(\.\d+)?$/.test(t) ? Number(t) : t;
    }
    p.specOverrides = o;
  });
  closeDialog();
});

// ---------- precio pagado ----------
on('paid', (el) => paidDialog(el.dataset.cand || null));
export function paidDialog(candId) {
  const list = build().candidates.filter((c) => c.status === 'bought' && c.selected && (!candId || c.id === candId));
  const target = candId ? [candById(candId)] : list;
  const trm = st().settings.fx.trm;
  openDialog(() => html`<form data-submit="paid-save">
    <div class="dlg-h"><h2 id="dlg-title">Precio pagado</h2><button type="button" class="btn btn-g btn-s" data-act="close-dialog" aria-label="Cerrar">✕</button></div>
    <div class="dlg-b">
      <p class="muted" style="margin:0;font-size:13px">Lo pagado queda fijo en el total del armado. Los precios de hoy se siguen leyendo para ver si subió o bajó desde tu compra.</p>
      <div class="tbl-wrap"><table><thead><tr><th>Producto</th><th>Origen</th><th class="r">Pagado</th><th>Moneda</th><th>Fecha</th></tr></thead><tbody>
      ${target.map((c) => { const p = st().products[c.productId]; const pu = c.purchase; return html`<tr>
        <td style="max-width:280px">${shortTitle(p.title, 50)}${pu?.by === 'nombre' ? html`<div class="src" style="color:var(--warn)">Encontrado por nombre: revísalo («${shortTitle(pu.matchedTitle, 40)}»)</div>` : ''}</td>
        <td><span class="src">${!pu ? 'Sin registrar' : pu.source === 'order' ? `Pedido ${pu.orderId}${pu.exact ? '' : ' · repartido'}` : 'Escrito a mano'}</span></td>
        <td class="r"><input class="input sm num" style="width:110px" name="amount-${c.id}" value="${pu ? (pu.original ? pu.original.amount : pu.total.amount) : ''}" inputmode="decimal" aria-label="Pagado"></td>
        <td><select class="input sm" name="cur-${c.id}" style="width:80px"><option${raw(!pu?.original ? ' selected' : '')}>USD</option><option${raw(pu?.original ? ' selected' : '')}>COP</option></select></td>
        <td><input class="input sm" type="date" name="date-${c.id}" value="${pu?.date || ''}" style="width:150px"></td></tr>`; })}
      ${target.length ? '' : html`<tr><td colspan="5" class="muted">No hay productos comprados elegidos.</td></tr>`}
      </tbody></table></div>
      <div class="flex"><button type="button" class="btn" data-act="paid-orders" data-cands="${target.map((c) => c.id).join(',')}">${raw('<svg class="i" aria-hidden="true"><use href="#i-receipt"></use></svg>')}Leer de mis pedidos de Amazon</button><span class="muted" role="status" aria-live="polite" style="font-size:13px">${ui.paidProgress}</span></div>
      <p class="src" style="margin:0">Lo escrito en COP se guarda con la TRM de hoy (${trm.toLocaleString('es-CO')}).</p>
    </div>
    <div class="dlg-f"><button type="button" class="btn" data-act="close-dialog">Cancelar</button><button class="btn btn-p">Guardar</button></div></form>`);
}
onSubmit('paid-save', (form, d) => {
  const trm = st().settings.fx.trm;
  store.update(() => {
    for (const [k, v] of Object.entries(d)) {
      if (!k.startsWith('amount-')) continue;
      const c = candById(k.slice(7));
      const amount = num(v);
      if (amount == null) { c.purchase = null; continue; }
      const cur = d[`cur-${c.id}`] === 'COP' ? 'COP' : 'USD';
      const prev = c.purchase;
      const same = prev && (prev.original ? prev.original.amount : prev.total.amount) === amount && (prev.original ? 'COP' : 'USD') === cur;
      if (same) { prev.date = d[`date-${c.id}`] || prev.date; continue; }
      c.purchase = toPurchase({ total: amount, currency: cur, date: d[`date-${c.id}`] || null, source: 'manual' }, trm, candStore(c));
    }
  });
  closeDialog();
  toast('Precio pagado guardado.');
});
const candStore = (c) => {
  const p = st().products[c.productId];
  return p.offers.find((o) => o.id === c.purchaseOfferId)?.store || p.offers[0]?.store || 'manual';
};
on('paid-orders', async (el) => {
  const ids = el.dataset.cands.split(',').filter(Boolean);
  const cands = ids.map(candById).filter(Boolean);
  const items = cands.map((c) => st().products[c.productId]).filter((p) => p.ids?.asin).map((p) => ({ asin: p.ids.asin, query: orderQuery(p.title) }));
  if (!items.length) return toast('Ninguno de estos productos tiene ASIN de Amazon.');
  if (!link.amazonAlive()) link.openAmazon();
  ui.paidProgress = 'Esperando el conector de Amazon…';
  refreshDialog();
  try {
    const r = await link.requestOrders(items, (done, total) => { ui.paidProgress = `Leyendo facturas ${done}/${total}…`; refreshDialog(); });
    const inv = sanitizeInvoices(r.invoices);
    let found = 0;
    store.update(() => {
      for (const c of cands) {
        const hit = findPaid(st().products[c.productId], inv);
        if (hit) { c.purchase = toPurchase(hit, st().settings.fx.trm, candStore(c)); found++; }
      }
    });
    ui.paidProgress = `Encontrados ${found} de ${cands.length} (${r.scanned} facturas revisadas).`;
  } catch (e) {
    ui.paidProgress = e.message;
  }
  closeDialog();
  paidDialog(ids.length === 1 ? ids[0] : null);
});

// ---------- armados ----------
on('menu', (el) => { ui.menu = ui.menu === el.dataset.menu ? null : el.dataset.menu; rerender(); });
document.addEventListener('click', (e) => {
  if (ui.menu && !(/** @type {Element} */ (e.target)).closest('.menu')) { ui.menu = null; rerender(); }
});
on('build-switch', (el) => { ui.menu = null; store.update((s) => { s.activeBuildId = el.dataset.build; }); });
on('build-new', () => nameDialog('Nuevo armado', '', (name) => store.update((s) => { const b = newBuild(name); s.builds.push(b); s.activeBuildId = b.id; })));
on('build-rename', () => nameDialog('Renombrar armado', build().name, (name) => store.update(() => { build().name = name; })));
on('build-duplicate', () => {
  store.update((s) => {
    const src = build();
    const b = { ...structuredClone(src), id: newId('b'), name: `${src.name} (copia)`, createdAt: new Date().toISOString() };
    b.candidates = b.candidates.map((c) => ({ ...c, id: newId('c') }));
    s.builds.push(b);
    s.activeBuildId = b.id;
  });
  toast('Armado duplicado: los productos y sus tiendas se comparten; la decisión y el estado son de cada armado.');
});
on('build-delete', async () => {
  if (st().builds.length < 2) return toast('Debe quedar al menos un armado.', { error: true });
  if (!(await confirmDialog({ title: 'Eliminar armado', body: `Se elimina «${build().name}». Los productos que solo están en este armado quedan sin usar.`, ok: 'Eliminar', danger: true }))) return;
  store.update((s) => { s.builds = s.builds.filter((b) => b.id !== s.activeBuildId); s.activeBuildId = s.builds[0].id; });
});
function nameDialog(title, value, done) {
  ui.menu = null;
  openDialog(() => html`<form data-submit="name-ok"><div class="dlg-h"><h2 id="dlg-title">${title}</h2></div>
    <div class="dlg-b"><label class="fld">Nombre<input class="input" name="name" value="${value}" required autofocus></label></div>
    <div class="dlg-f"><button type="button" class="btn" data-act="close-dialog">Cancelar</button><button class="btn btn-p">Guardar</button></div></form>`);
  onSubmit('name-ok', (f, d) => { closeDialog(); done(String(d.name).trim()); });
}
on('export-json', () => download(`armador-pc-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(st(), null, 1)));
on('import-json', () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      const next = data.schema === 2 ? data : migrateV1(data).state;
      if (!(await confirmDialog({ title: 'Importar', body: `Se reemplazan todos tus datos por los del archivo${data.schema === 2 ? '' : ' (V1, se migra)'}. Exporta antes si quieres conservar los actuales.`, ok: 'Importar', danger: true }))) return;
      store.replace(next);
      toast('Datos importados.');
    } catch (e) { toast(`No pude importar: ${e.message}`, { error: true }); }
  };
  inp.click();
});
on('copy-markdown', async () => {
  const md = toMarkdown(st(), build(), env());
  try { await navigator.clipboard.writeText(md); toast('Armado copiado como Markdown.'); } catch { download('armado.md', md, 'text/markdown'); }
});
on('restore-seed', async () => {
  if (!(await confirmDialog({ title: 'Restaurar datos de ejemplo', body: 'Reemplaza todos tus armados por los de ejemplo. Exporta antes si quieres conservarlos.', ok: 'Restaurar', danger: true }))) return;
  store.replace(await api.resetStore());
  toast('Datos de ejemplo restaurados.');
});

// ---------- agregar desde la ficha de Amazon (marcador) ----------
link.onAdd((msg, src) => {
  let d;
  try { d = sanitizeAmazon(msg.product); } catch { return; }
  const cat = CAT[msg.cat] ? msg.cat : 'accessories';
  let text = '';
  store.update((s) => {
    let p = Object.values(s.products).find((x) => x.ids?.asin === d.asin);
    if (!p) { p = newProduct({ category: cat, ids: { asin: d.asin, mpn: null, upc: null } }); s.products[p.id] = p; }
    applyAmazon(p, d, env());
    if (!build().candidates.some((c) => c.productId === p.id)) build().candidates.push(newCandidate(p.id, cat));
    text = `Agregado a ${CAT[cat].name} en «${build().name}»`;
  });
  try { src.win.postMessage({ type: 'pcb:ack', text }, src.origin); } catch { /* cerrada */ }
  toast(text);
});

// ---------- alertas ----------
on('alerts-seen', () => store.update((s) => { for (const a of s.alertEvents) a.seen = true; }));
on('alert-dismiss', (el) => store.update((s) => { s.alertEvents = s.alertEvents.filter((a) => a.id !== el.dataset.alert); }));

// ---------- ajustes ----------
onChange('setting', (el) => {
  const path = el.dataset.path.split('.');
  let v = el.type === 'checkbox' ? el.checked : el.dataset.type === 'num' ? num(el.value) : el.value;
  if (el.dataset.scale) v = v == null ? null : v / Number(el.dataset.scale);
  store.update((s) => {
    let o = s.settings;
    for (const k of path.slice(0, -1)) o = o[k] ||= {};
    o[path.at(-1)] = v;
  });
});
on('setting-set', (el) => {
  const path = el.dataset.path.split('.');
  const raw = el.dataset.value;
  const v = raw === 'true' ? true : raw === 'false' ? false : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  store.update((s) => { let o = s.settings; for (const k of path.slice(0, -1)) o = o[k] ||= {}; o[path.at(-1)] = v; });
});
onChange('budget', (el) => store.update(() => { const v = num(el.value); build().budget = v == null ? null : { amount: v, currency: 'USD' }; }));
on('trm-auto', async () => {
  try {
    const r = await api.trm();
    store.update((s) => { s.settings.fx = { trm: r.trm, date: r.date, source: 'auto' }; });
    toast(`TRM oficial ${r.trm.toLocaleString('es-CO')} del ${r.date} (${r.source}).`);
  } catch (e) { toast(e.message, { error: true }); }
});
on('threshold', (el) => {
  const v = el.dataset.value;
  if (v === 'other') { ui.editRule = 'co-exempt'; rerender(); return; }
  store.update((s) => { s.settings.taxRules.find((r) => r.id === 'co-exempt').threshold = Number(v); });
  toast(`Umbral de Colombia: US$${v}. Se recalculó todo.`);
});
on('rule-edit', (el) => { ui.editRule = ui.editRule === el.dataset.rule ? null : el.dataset.rule; rerender(); });
onSubmit('rule-save', (form, d) => {
  store.update((s) => {
    const r = s.settings.taxRules.find((x) => x.id === form.dataset.rule);
    for (const k of ['label', 'base', 'condition', 'from', 'until', 'source', 'note']) if (k in d) r[k] = d[k] || null;
    for (const k of ['rate', 'surtax', 'duty']) if (k in d) r[k] = num(d[k]) == null ? null : num(d[k]) / 100;
    for (const k of ['threshold', 'cap']) if (k in d) r[k] = num(d[k]);
  });
  ui.editRule = null;
  toast('Regla guardada: se recalcularon los totales y el desglose nombra esta regla.');
});
on('store-new', () => { ui.newStore = !ui.newStore; rerender(); });
onSubmit('store-save', (form, d) => {
  const name = String(d.name || '').trim();
  if (!name) return toast('Escribe el nombre de la tienda.', { error: true });
  store.update((s) => {
    let merchant = d.merchant;
    if (merchant === '__new') {
      merchant = `m-${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}`;
      s.merchants[merchant] = { key: merchant, name, domain: String(d.domain || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase(), readMode: 'manual', mono: name.slice(0, 3).toUpperCase() };
    }
    const key = `s-${newId('').slice(1)}`;
    s.stores[key] = { key, merchant, name, destination: d.destination, currency: d.currency, taxMode: d.taxMode, custom: true, warranty: d.warranty || '', returns: d.returns || '' };
  });
  ui.newStore = false;
  toast('Tienda agregada.');
});
on('store-delete', async (el) => {
  const key = el.dataset.store;
  const used = Object.values(st().products).some((p) => p.offers.some((o) => o.store === key));
  if (used) return toast('Esa tienda tiene filas en productos: quítalas primero.', { error: true });
  store.update((s) => { delete s.stores[key]; });
});
export { refresh, link, usd, n2, DECISIONS };
