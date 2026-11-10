// @ts-check
// Producto × tienda + historial (R3, R4, R8, R11, R15, R18): dónde comprarlo con el desglose y origen de cada dato,
// historial con gráfica por tienda, decisión, alertas, identificadores y datos para cálculos.
import { html, raw } from '../dom.js';
import { icon, chip, thumb, statusChip, storeName, destShort, readChip, taxNote, partialMark, breakdown, seg, starsView } from '../components.js';
import { n2, usd, cop, ago, intCO, copRaw } from '../format.js';
import { ui, on, rerender } from '../ui.js';
import * as store from '../../state/store.js';
import { prefsGet, prefsSet } from '../../state/prefs.js';
import * as refresh from '../../services/refresh.js';
import { CAT, DECISIONS, decisionLevel, STATUS } from '../../domain/categories.js';
import { purchaseRow, markRows } from '../../domain/purchase.js';
import { basisTotal } from '../../domain/offer-cost.js';
import { priceSeries, trend } from '../../domain/history.js';
import { detectTags, specView, estimateWatts, wattsIsGuess, valueFor, VALUE_METRICS } from '../../domain/specs.js';
import { priceChart, legendSwatch } from '../price-chart.js';
import { specLine } from './build.js';
import { tagFields } from '../actions.js';
import { threshold } from '../../domain/tax.js';
import { channelOf } from '../../domain/refresh-plan.js';
import { newCandidate } from '../../domain/schema.js';
import * as link from '../../services/connector-link.js';

on('basis', (el) => { prefsSet({ compareBasis: el.dataset.value }); rerender(); });
on('chart-range', (el) => { prefsSet({ chartRange: el.dataset.value === 'all' ? null : Number(el.dataset.value) }); rerender(); });
on('chart-table', () => { ui.chartTable = !ui.chartTable; rerender(); });
on('serie', (el) => { ui.hiddenSeries[el.dataset.offer] = !ui.hiddenSeries[el.dataset.offer]; rerender(); });
on('scroll-to', (el) => document.getElementById(el.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
on('add-to-build', (el) => {
  const p = store.get().products[el.dataset.product];
  store.update(() => store.build().candidates.push(newCandidate(p.id, p.category)));
});

const VARIANT = { exact: ['Exacto', 'ok'], name: ['Por nombre', ''], doubtful: ['Dudoso', 'warn'] };

export function productView(pid) {
  const st = store.get();
  const env = store.env();
  const b = store.build();
  const p = st.products[pid];
  if (!p) return html`<div class="wrap"><div class="card empty-state">Ese producto ya no existe. <a href="#/">Volver al armado</a></div></div>`;
  const cand = b.candidates.find((c) => c.productId === pid);
  const c = CAT[p.category];
  const trm = env.settings.fx.trm;
  const basis = prefsGet().compareBasis === 'co' ? 'co' : 'dest';
  const pr = purchaseRow(cand || { qty: 1 }, p, env);
  const { rows, mixedDest, best } = markRows(pr.rows, basis);
  const sorted = [...rows].sort((a, z) => (basisTotal(a.cost, basis) ?? Infinity) - (basisTotal(z.cost, basis) ?? Infinity));
  const view = specView(p, cand);
  const th = threshold(env.settings);
  const overAll = rows.length && rows.every((r) => r.cost.total == null || !r.cost.overThreshold);
  const dealRow = rows.find((r) => r.cost.deal);
  const targetHit = cand?.targetPrice != null && rows.some((r) => r.cost.total != null && r.cost.total <= cand.targetPrice);
  const nAmazonOffers = (p.offers || []).filter((o) => env.stores[o.store]?.merchant === 'amazon');
  const sellerOffers = nAmazonOffers.flatMap((o) => (o.sellerOffers || []).map((s) => ({ ...s, store: o.store })));
  const prog = refresh.productProgress(pid);
  const coRow = rows.find((r) => r.cost.dest === 'co' && r.cost.total != null);
  const miaBest = rows.filter((r) => r.cost.dest !== 'co' && r.cost.total != null).sort((a, z) => a.cost.total - z.cost.total)[0];

  const head = html`<header style="background:var(--surface);border-bottom:1px solid var(--line)"><div class="wrap" style="padding-bottom:0;gap:12px">
    <nav aria-label="Ruta" class="crumbs"><a href="#/">${b.name}</a> / <a href="#/c/${p.category}">${c.name}</a> / ${p.title.split(/[—,|]/)[0].slice(0, 50)}</nav>
    <div class="flex" style="gap:20px;align-items:flex-start">${thumb(p)}
      <div style="flex:1 1 480px;min-width:0;display:flex;flex-direction:column;gap:8px">
        <h1 style="font-size:22px">${p.title}</h1>
        <div class="num muted" style="font-size:13px">${[p.brand, p.ids.mpn && `MPN ${p.ids.mpn}`, specLine(p, cand, 6)].filter(Boolean).join(' · ')}</div>
        <div class="flex" style="gap:6px">${cand ? statusChip(cand.status) : chip('No está en este armado', 'line')}${cand ? chip(`${DECISIONS[decisionLevel(cand.decision)].stars} ${DECISIONS[decisionLevel(cand.decision)].label}`) : ''}
          ${rows.some((r) => r.cost.dest === 'co') ? (overAll ? chip(`< US$${th}${rows.length > 1 ? ' en todas' : ''}`, 'ok') : chip(`≥ US$${th} en alguna`, 'warn')) : ''}
          ${dealRow ? chip(`Oferta en ${storeName(env, dealRow.offer.store)} −${Math.round((1 - dealRow.offer.price / dealRow.offer.listPrice) * 100)} %`, 'warn') : ''}
          ${targetHit ? chip('Objetivo alcanzado', 'ok', { ico: 'bell' }) : ''}
          ${p.rating ? chip(`★ ${String(p.rating).replace('.', ',')} · ${intCO(p.reviews || 0)} reseñas`) : ''}
          ${p.condition && p.condition !== 'Nuevo' ? chip(p.condition, 'err') : ''}</div>
      </div>
      <div class="flex">
        <button class="btn" data-act="refresh-product" data-product="${pid}">${icon('refresh')}${prog && (prog.running || prog.waiting) ? `Actualizando ${prog.done}/${prog.total}` : `Actualizar producto (${rows.length} tienda${rows.length === 1 ? '' : 's'})`}</button>
        ${cand ? html`<a class="btn btn-p" href="#/">Volver al armado</a>` : html`<button class="btn btn-p" data-act="add-to-build" data-product="${pid}">Agregar a este armado</button>`}
      </div></div>
    <nav class="ptabs" aria-label="Secciones del producto">
      ${[['tiendas', `Tiendas · ${rows.length}`], ['historial', 'Historial'], ['specs', 'Especificaciones'], ['vendedores', `Vendedores de Amazon · ${sellerOffers.length}`], ['notas', 'Notas y diagnóstico']].map(([id, t], i) => html`<a href="#/p/${pid}" data-act="scroll-to" data-target="${id}"${raw(i === 0 ? ' aria-current="true"' : '')}>${t}</a>`)}
    </nav></div></header>`;

  const tableRows = sorted.map((r) => {
    const o = r.offer, cost = r.cost, s = env.stores[o.store];
    const jobS = refresh.offerState(o.id);
    const tr = trend(o);
    const isBuy = pr.row?.offer.id === o.id;
    const edited = Object.keys(o.edited || {});
    const vm = VARIANT[o.variantMatch];
    const ch = channelOf(o, env);
    const wait = jobS?.state === 'waiting' && ch ? refresh.waitReason(ch) : null;
    const origin = ch?.startsWith('tab:') ? ch.slice(4) : null;
    return html`<tr${raw(isBuy ? ' class="sel"' : '')} data-key="row-${o.id}">
      <td>${cand ? html`<input type="radio" name="buy-${pid}" aria-label="Comprar en ${s?.name}" value="${o.id}" data-change="purchase-radio" data-cand="${cand.id}"${raw(isBuy ? ' checked' : '')}${raw(cost.total == null ? ' disabled' : '')} style="width:18px;height:18px">${isBuy && pr.suggested ? html`<div class="src" style="color:var(--acc-ink)">Sugerida</div>` : isBuy ? html`<div class="src">Elegida</div>` : ''}` : ''}</td>
      <td><strong>${s?.name || o.store}</strong><div class="src">${destShort(env, cost.dest)}${s?.destination === 'us-mia' ? ` ${env.settings.destinations['us-mia'].place}` : ''} · ${cost.currency}${o.seller ? ` · vend. ${o.seller}` : ''}${vm ? html` · <span style="color:var(--${vm[1] || 'muted'})">Variante ${vm[0].toLowerCase()}</span>` : ''}</div>${edited.length ? html`<div class="src" style="color:var(--warn)">${icon('pencil', 'i', 'width:11px;height:11px')} editado: ${edited.join(', ')}</div>` : ''}</td>
      <td class="r num">${o.price == null ? html`<span class="src">sin dato</span>` : cost.currency === 'COP' ? html`${copRaw(o.price)}<div class="src">≈ ${usd(cost.price)}</div>` : n2(o.price)}${o.listPrice > o.price ? html`<div class="src"><s>${n2(o.listPrice)}</s> antes</div>` : ''}</td>
      <td class="r num">${cost.shipping == null ? html`<span class="src">sin dato</span>` : html`${n2(cost.shipping)}<div class="src">${cost.dest === 'us-pickup' ? 'recogida' : cost.shipping === 0 ? 'gratis' : o.edited?.shipping ? 'editado' : 'según la tienda'}</div>`}</td>
      <td class="r num">${cost.tax == null ? html`<span class="src">${taxNote(cost, env)}</span>` : html`${cost.taxSource === 'included' ? '' : n2(cost.tax)}<div class="src">${taxNote(cost, env)}</div>`}</td>
      <td class="r">${cost.total == null ? html`<span class="muted">—</span>` : html`<button class="btn btn-s num" style="font-weight:600;font-family:var(--mono)" aria-expanded="${!!ui.expanded[o.id]}" data-act="toggle-expand" data-offer="${o.id}" title="Ver desglose">${n2(cost.total)}${partialMark(cost)}</button>`}
        ${cost.partial && cost.total != null ? html`<div class="src">parcial: falta ${cost.missing.join(', ')}</div>` : ''}${r.lowest ? html`<div style="margin-top:4px">${chip('Más bajo', 'ok', { size: 'sm' })}</div>` : ''}</td>
      <td class="r num">${cost.landedCO ? html`${n2(cost.landedCO.total)}${cost.landedCO.partial && !cost.landedCO.inCO ? '*' : ''}<div class="src">${cost.landedCO.inCO ? 'ya en CO' : 'ref. · casillero'}</div>` : html`<span class="muted">—</span>`}</td>
      <td class="num" style="color:${!tr || !tr.diff ? 'var(--muted)' : tr.diff < 0 ? 'var(--ok)' : 'var(--err)'}">${!tr ? '—' : !tr.diff ? '= sin cambio' : html`${tr.diff < 0 ? '▼' : '▲'} ${n2(Math.abs(tr.diff))}<div class="src">vs lectura anterior</div>`}</td>
      <td>${o.delivery || html`<span class="muted">—</span>`}${o.inStock === true ? html`<div class="src">en stock</div>` : o.inStock === false ? html`<div class="src" style="color:var(--err)">agotado</div>` : ''}</td>
      <td>${readChip(o, env, jobS)}${o.readStatus === 'error' && o.readError ? html`<div style="font-size:12px;margin-top:4px;max-width:220px">${o.readError}</div>` : ''}
        ${wait ? html`<div style="font-size:12px;margin-top:4px;max-width:220px">${wait.text}</div>${wait.code === 'tab' && origin ? html`<div style="margin-top:6px"><button class="btn btn-s" data-act="open-tab" data-origin="${origin}" data-url="${o.url}">Abrir ${s?.name} y pulsar el marcador ${icon('ext')}</button></div>` : html`<div style="margin-top:6px"><button class="btn btn-s" data-act="open-amazon">${wait.action} ${icon('ext')}</button></div>`}` : ''}</td>
      <td style="white-space:nowrap"><button class="btn btn-s btn-g" aria-label="Actualizar fila ${s?.name}" title="Actualizar fila" data-act="refresh-offer" data-product="${pid}" data-offer="${o.id}">${icon('refresh')}</button>${o.url ? html`<a class="btn btn-s btn-g" href="${o.url}" target="_blank" rel="noopener noreferrer" aria-label="Abrir en ${s?.name}" title="Abrir en ${s?.name}">${icon('ext')}</a>` : ''}<button class="btn btn-s btn-g" aria-label="Editar fila ${s?.name}" title="Editar fila" data-act="offer-edit" data-product="${pid}" data-offer="${o.id}">${icon('pencil')}</button></td>
    </tr>${ui.expanded[o.id] && cost.total != null ? html`<tr class="expand" data-key="exp-${o.id}"><td colspan="11">${breakdown(cost, env, p)}</td></tr>` : ''}`;
  });

  const range = prefsGet().chartRange;
  const series = priceSeries(p, { days: range });
  const idx = new Map(p.offers.map((o, i) => [o.id, i]));
  const visible = series.filter((s) => !ui.hiddenSeries[s.offerId] && s.points.length);
  const chartLabel = `Gráfica del total en destino en US$: ${series.map((s) => `${storeName(env, s.store)} actual ${s.current?.toFixed(2)}, mínimo ${s.min?.toFixed(2)}`).join('; ')}${cand?.targetPrice != null ? `; objetivo ${cand.targetPrice}` : ''}.`;

  const hist = html`<section class="card pad stack" id="historial" aria-labelledby="h-h" style="gap:12px">
    <div class="flex" style="gap:12px"><h2 id="h-h">Historial de precio · total en destino (US$)</h2><div class="grow"></div>
      ${seg('Rango', [['30', '30 d'], ['90', '90 d'], ['all', 'Todo']], range == null ? 'all' : String(range), 'chart-range')}
      <button class="btn btn-s" data-act="chart-table" aria-pressed="${ui.chartTable}">${ui.chartTable ? 'Ver gráfica' : 'Ver como tabla'}</button></div>
    <div class="flex" style="gap:8px 16px;font-size:13px" role="group" aria-label="Series">${series.map((s) => html`<label class="chk"><input type="checkbox" data-act="serie" data-offer="${s.offerId}"${raw(!ui.hiddenSeries[s.offerId] ? ' checked' : '')}>${s.points.length ? legendSwatch(idx.get(s.offerId)) : ''}${storeName(env, s.store)}${env.stores[s.store]?.currency === 'COP' ? ' (en US$)' : ''}${s.n < 2 ? html`<span class="muted"> · ${s.n} lectura</span>` : ''}</label>`)}</div>
    ${ui.chartTable ? html`<div class="tbl-wrap" style="max-height:360px;overflow:auto"><table><thead><tr><th>Fecha</th><th>Tienda</th><th class="r">Precio</th><th class="r">Envío</th><th class="r">Impuesto</th><th class="r">Total US$</th><th class="r">Variación</th><th>Origen</th></tr></thead><tbody>
        ${p.offers.flatMap((o) => (o.history || []).map((h, i, arr) => ({ o, h, prev: arr[i - 1] }))).sort((a, z) => String(z.h.t).localeCompare(String(a.h.t))).slice(0, 200).map(({ o, h, prev }) => { const tot = h.total ?? (h.currency === 'COP' ? h.price / (h.rate || trm) : h.price); const pt = prev ? prev.total ?? (prev.currency === 'COP' ? prev.price / (prev.rate || trm) : prev.price) : null; return html`<tr><td class="num">${new Date(h.t).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>${storeName(env, o.store)}</td><td class="r num">${h.currency === 'COP' ? copRaw(h.price) : n2(h.price)}</td><td class="r num">${h.shipping == null ? '—' : n2(h.shipping)}</td><td class="r num">${h.tax == null ? '—' : n2(h.tax)}</td><td class="r num">${n2(tot)}</td><td class="r num" style="color:${pt == null || pt === tot ? 'var(--muted)' : tot < pt ? 'var(--ok)' : 'var(--err)'}">${pt == null ? '—' : tot === pt ? '=' : `${tot < pt ? '▼' : '▲'} ${n2(Math.abs(tot - pt))}`}</td><td class="src">${{ read: 'lectura', manual: 'manual', order: 'pedido', v1: 'V1' }[h.source] || h.source}</td></tr>`; })}
      </tbody></table></div>`
      : priceChart(visible.map((s) => ({ name: storeName(env, s.store), idx: idx.get(s.offerId), points: s.points })), { target: cand?.targetPrice ?? null, paid: cand?.status === 'bought' ? cand.purchase?.total?.amount ?? null : null, label: chartLabel })}
    ${series.length ? html`<div class="tbl-wrap"><table><thead><tr><th>Tienda</th><th class="r">Mínimo</th><th class="r">Máximo</th><th class="r">Actual</th><th class="r">Lecturas</th><th>Nota</th></tr></thead><tbody>
      ${series.map((s) => html`<tr><td>${storeName(env, s.store)}${env.stores[s.store]?.currency === 'COP' ? html` <span class="src">COP → US$ con la TRM de cada lectura</span>` : ''}</td><td class="r num">${n2(s.min)}</td><td class="r num">${n2(s.max)}</td><td class="r num" style="font-weight:600">${n2(s.current)}</td><td class="r num">${s.n}</td>
        <td>${s.current === s.min && s.n > 1 ? chip(`Mínimo histórico${cand?.targetPrice != null && s.current <= cand.targetPrice ? ' · bajo objetivo' : ''}`, 'ok', { size: 'md' }) : s.current != null && s.min != null && s.current > s.min ? html`<span class="muted">+${n2(s.current - s.min)} sobre su mínimo</span>` : html`<span class="muted">—</span>`}</td></tr>`)}
    </tbody></table></div>` : ''}
  </section>`;

  const tags = detectTags(view, p.category);
  const metric = VALUE_METRICS[p.category];
  const value = valueFor(p.category, view, pr.row?.cost.total ?? null);
  const watts = estimateWatts(view, p.category);
  const asideHtml = html`<aside class="aside" style="max-width:380px;flex-basis:320px" aria-label="Decisión y datos">
    ${cand ? html`<section class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <div class="lbl">Decisión</div>
      <div class="seg grid" role="group" aria-label="Decisión" style="grid-template-columns:repeat(4,minmax(0,1fr))">${DECISIONS.map((d) => html`<button type="button" data-act="decide" data-cand="${cand.id}" data-level="${d.level || decisionLevel(cand.decision) || 1}" aria-pressed="${decisionLevel(cand.decision) === d.level}" ${raw(d.level === 0 ? `data-zero="1"` : '')}>${d.level ? `${'★'.repeat(d.level)} ` : ''}${d.label}</button>`)}</div>
      <div class="muted" style="font-size:12px">${DECISIONS[decisionLevel(cand.decision)].hint}</div>
      <div class="lbl" style="margin-top:4px">Estado</div>
      <div class="seg grid" role="group" aria-label="Estado" style="grid-template-columns:repeat(3,minmax(0,1fr))">${Object.values(STATUS).map((s) => html`<button type="button" data-act="status" data-cand="${cand.id}" data-value="${s.key}" aria-pressed="${(cand.status || 'buy') === s.key}">${s.label}</button>`)}</div>
      <div class="flex" style="gap:12px;align-items:flex-end;flex-wrap:nowrap">
        <label class="fld" style="width:80px">Cantidad<input class="input sm num" type="number" min="1" max="20" value="${cand.qty}" data-change="cand-field" data-cand="${cand.id}" data-field="qty"></label>
        <label class="fld" style="flex:1">Comprar en<select class="input sm" data-change="purchase-store" data-cand="${cand.id}"><option value=""${raw(!cand.purchaseOfferId ? ' selected' : '')}>${pr.suggested && pr.row ? `${storeName(env, pr.row.offer.store)} (sugerida)` : 'La sugerida'}</option>${rows.filter((r) => r.cost.total != null).map((r) => html`<option value="${r.offer.id}"${raw(cand.purchaseOfferId === r.offer.id ? ' selected' : '')}>${storeName(env, r.offer.store)}</option>`)}</select></label>
      </div>
      ${cand.status === 'bought' ? html`<div class="row"><span>Pagado</span><span class="num">${cand.purchase ? usd(cand.purchase.total.amount) : html`<span class="muted">sin registrar</span>`}</span></div><button class="btn btn-s" data-act="paid" data-cand="${cand.id}">${icon('receipt')}${cand.purchase ? 'Editar lo pagado' : 'Registrar lo pagado'}</button>` : ''}
    </section>
    <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:8px">
      <div class="row" style="align-items:center"><span class="lbl">Alertas de precio</span>${targetHit ? chip('Cumplida', 'ok') : ''}</div>
      <label class="fld">Precio objetivo (total en destino, US$)<input class="input sm num" inputmode="decimal" value="${cand.targetPrice ?? ''}" data-change="cand-field" data-cand="${cand.id}" data-field="targetPrice" placeholder="sin objetivo"></label>
      ${[['target', 'Cualquier tienda baja del objetivo'], ['drop', 'Baja respecto a la última lectura'], ['deal', 'Entra en oferta'], ['coOnly', 'Solo tiendas con destino Colombia']].map(([k, t]) => html`<label class="chk"><input type="checkbox" data-change="cand-alert" data-cand="${cand.id}" data-field="${k}"${raw(cand.alerts?.[k] ? ' checked' : '')}>${t}</label>`)}
    </section>` : ''}
    <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:6px">
      <div class="lbl" style="margin-bottom:4px">Identificadores y variantes</div>
      <div class="kv"><span>MPN</span><span class="num">${p.ids.mpn || 'sin dato'}</span></div>
      <div class="kv"><span>UPC</span><span class="num">${p.ids.upc || 'sin dato'}</span></div>
      <div class="kv"><span>ASIN</span><span class="num">${p.ids.asin || 'sin dato'}</span></div>
      <div style="display:flex;flex-direction:column;gap:4px;margin-top:6px;font-size:13px">${Object.entries(VARIANT).map(([k, [label, tone]]) => { const ss = rows.filter((r) => r.offer.variantMatch === k); return ss.length ? html`<span>${chip(label, tone, { size: 'md' })} ${ss.map((r) => storeName(env, r.offer.store)).join(', ')}</span>` : ''; })}
        ${rows.some((r) => !r.offer.variantMatch) ? html`<span class="muted" style="font-size:12px">Sin revisar: ${rows.filter((r) => !r.offer.variantMatch).map((r) => storeName(env, r.offer.store)).join(', ')}. Márcalo al editar cada fila.</span>` : ''}</div>
      <button class="btn btn-s btn-g" style="align-self:flex-start;color:var(--link);padding:0" data-act="product-edit" data-product="${pid}">Editar identificadores</button>
    </section>
    <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:6px">
      <div class="lbl" style="margin-bottom:4px">Datos para cálculos</div>
      <div class="kv"><span>Peso (casillero)</span><span class="num">${p.weightLb == null ? 'sin dato' : `${String(p.weightLb).replace('.', ',')} lb`} ${p.edited?.weightLb ? chip('editado', '', { ico: 'pencil', size: 'sm' }) : ''}</span></div>
      <div class="kv"><span>Consumo</span><span class="num">${watts} W <span class="src">${cand?.wattsOverride != null ? 'manual' : wattsIsGuess(view, p.category) ? 'genérico' : 'automático'}</span></span></div>
      ${cand ? html`<label class="fld" style="font-weight:400">Consumo manual (W por unidad)<input class="input sm num" value="${cand.wattsOverride ?? ''}" placeholder="automático" data-change="cand-field" data-cand="${cand.id}" data-field="wattsOverride"></label>` : ''}
      ${tagFields(p.category).map(([k, label]) => html`<div class="kv"><span>${label}</span><span>${tags[k] == null ? html`<span class="muted">no detectado</span>` : String(tags[k])} <span class="src">${p.specOverrides?.[k] != null ? 'manual' : tags[k] == null ? '' : 'detectado'}</span></span></div>`)}
      ${metric ? html`<div class="kv"><span>Valor por dinero</span><span class="num">${value == null ? 'sin dato' : `US$${n2(value)}/${metric.label.split('/')[1]}`}</span></div>` : ''}
      <div class="flex" style="gap:12px"><button class="btn btn-s btn-g" style="color:var(--link);padding:0" data-act="specs-edit" data-product="${pid}">Editar datos de compatibilidad</button><button class="btn btn-s btn-g" style="color:var(--link);padding:0" data-act="product-edit" data-product="${pid}">Peso y datos del producto</button></div>
    </section>
  </aside>`;

  const specsSec = html`<section class="card pad stack" id="specs" aria-labelledby="h-s" style="gap:10px"><h2 id="h-s">Especificaciones</h2>
    ${p.bullets?.length ? html`<ul style="margin:0;padding-left:18px;font-size:13px;display:flex;flex-direction:column;gap:4px">${p.bullets.map((x) => html`<li>${x}</li>`)}</ul>` : ''}
    ${Object.keys(p.rawSpecs || {}).length ? html`<div class="tbl-wrap"><table><tbody>${Object.entries(p.rawSpecs).map(([k, v]) => html`<tr><th style="width:40%;background:none;white-space:normal">${k}</th><td>${v}</td></tr>`)}</tbody></table></div><div class="src">Origen: ficha de ${storeName(env, p.sheetSource || nAmazonOffers[0]?.store || '')}</div>` : html`<p class="muted" style="margin:0">Sin ficha leída. Actualiza el producto con el marcador en Amazon o corrige los datos de compatibilidad a mano.</p>`}
  </section>`;
  const sellersSec = html`<section class="card pad stack" id="vendedores" aria-labelledby="h-v" style="gap:10px"><h2 id="h-v">Vendedores de Amazon</h2>
    ${sellerOffers.length ? html`<div class="tbl-wrap"><table><thead><tr><th>Tienda</th><th>Condición</th><th>Vendedor</th><th>Envía desde</th><th class="r">Precio</th><th class="r">Envío</th><th>Entrega</th></tr></thead><tbody>
      ${sellerOffers.map((s) => html`<tr style="${s.condition && s.condition !== 'Nuevo' && !/^new|nuevo/i.test(s.condition) ? 'opacity:.6' : ''}"><td>${storeName(env, s.store)}</td><td>${s.condition || '—'}</td><td>${s.seller || '—'}</td><td>${s.shipsFrom || s.origin || '—'}</td><td class="r num">${n2(s.price)}</td><td class="r num">${s.shipping == null ? '—' : n2(s.shipping)}</td><td>${s.delivery || '—'}</td></tr>`)}</tbody></table></div>`
    : html`<p class="muted" style="margin:0">Sin ofertas de otros vendedores leídas.</p>`}</section>`;
  const notesSec = html`<section class="card pad stack" id="notas" aria-labelledby="h-n" style="gap:10px"><h2 id="h-n">Notas y diagnóstico</h2>
    ${cand ? html`<label class="fld">Notas de este armado<textarea class="input" data-change="cand-field" data-cand="${cand.id}" data-field="notes">${cand.notes || ''}</textarea></label>` : ''}
    ${p.diagnostics ? html`<details><summary style="cursor:pointer;font-size:13px">Diagnóstico de la última lectura de Amazon</summary><pre style="white-space:pre-wrap;font-size:11px;font-family:var(--mono);background:var(--surface-2);padding:10px;border-radius:8px;max-height:300px;overflow:auto">${Object.entries(p.diagnostics).map(([k, v]) => `${k}: ${v}`).join('\n\n')}</pre></details>` : html`<p class="muted" style="margin:0;font-size:13px">Sin diagnóstico (se guarda al leer con la sesión de Amazon).</p>`}
  </section>`;

  return html`${head}<div class="wrap"><div class="layout" style="gap:20px">
    <main class="main" style="flex-basis:720px">
      <section class="card" id="tiendas" aria-labelledby="h-t">
        <div class="flex" style="padding:16px 20px;gap:12px"><h2 id="h-t">Dónde comprarlo</h2><div class="grow"></div><span class="muted" style="font-size:13px">Ordenar y comparar por</span>${seg('Base de comparación', [['dest', 'Total en destino'], ['co', 'Puesto en Colombia']], basis, 'basis')}</div>
        ${mixedDest && basis === 'dest' && coRow && miaBest ? html`<div class="banner" style="margin:0 20px 12px">${icon('warn')}<span>Comparas <strong>Colombia</strong> y <strong>Miami</strong>: el total en Miami no incluye el casillero.${miaBest.cost.landedCO ? html` Puesto en Colombia, ${miaBest.cost.landedCO.total <= coRow.cost.total ? html`<strong>${storeName(env, miaBest.offer.store)}</strong> sigue siendo más bajo` : html`<strong>${storeName(env, coRow.offer.store)}</strong> resulta más bajo`} (<span class="num">${n2(miaBest.cost.landedCO.total)}</span> vs <span class="num">${n2(coRow.cost.total)}</span>${miaBest.cost.landedCO.partial ? ', sin peso: parcial' : ''}).` : ' Activa el casillero en Ajustes para comparar en la misma base.'}</span></div>` : ''}
        ${rows.length ? html`<div class="tbl-wrap" style="border-top:1px solid var(--line)"><table style="min-width:1060px"><caption class="sr">Producto por tienda, montos en US$ salvo los indicados</caption>
          <thead><tr><th>Comprar</th><th>Tienda · destino</th><th class="r">Precio</th><th class="r">Envío</th><th class="r">Impuesto</th><th class="r">Total en destino</th><th class="r">Puesto en CO</th><th>Tendencia</th><th>Entrega</th><th>Lectura</th><th></th></tr></thead>
          <tbody>${tableRows}</tbody></table></div>` : html`<div class="empty-state" style="border-top:1px solid var(--line)">Este producto aún no tiene tiendas. Agrega una con su enlace o escribe el precio a mano.</div>`}
        <div class="flex" style="padding:12px 20px"><button class="btn btn-s" data-act="offer-add" data-product="${pid}">${icon('plus')}Agregar tienda</button><button class="btn btn-s btn-g" data-act="product-edit" data-product="${pid}">${icon('pencil')}Datos del producto</button>
          <span class="muted" style="font-size:12px">Todos los campos son opcionales. Un dato vacío se muestra como «sin dato», nunca como 0.</span></div>
      </section>
      ${hist}${specsSec}${sellersSec}${notesSec}
    </main>${asideHtml}</div></div>`;
}
