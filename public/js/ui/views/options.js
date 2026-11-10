// @ts-check
// Opciones de una categoría (hasta 150+): agregar, filtros facetados con conteos, búsqueda, orden (incluido valor por
// dinero), filtros activos, marcar para comparar, descartar y recuperar. Se pintan por tandas para listas largas.
import { html, raw } from '../dom.js';
import { icon, chip, starsView, thumb, storeName, destShort, partialMark } from '../components.js';
import { n2, usd, signed, intCO } from '../format.js';
import { ui, on, onChange, onInput, rerender } from '../ui.js';
import * as store from '../../state/store.js';
import { viewOf, setView, marksOf } from '../../state/prefs.js';
import { CATEGORIES, CAT, DECISIONS, decisionLevel, FIXED } from '../../domain/categories.js';
import { optionItems, viewOptions, facets, normalizeView, sortsFor, viewFiltered, purchaseFacetCounts } from '../../domain/filters.js';
import { fmtFeature, VALUE_METRICS, featuresFor, featureValue } from '../../domain/specs.js';
import { candsOf } from '../../domain/build.js';
import { specLine } from './build.js';
import { GUIDES } from '../guides.js';
import { threshold } from '../../domain/tax.js';
import * as refresh from '../../services/refresh.js';

const PAGE = 40;
const q = {}; // búsqueda por categoría (no se guarda, brief §20)
const fullView = (cat) => ({ ...viewOf(cat), q: q[cat] || '' });

on('opt-more', (el) => { ui.limit[el.dataset.cat] = (ui.limit[el.dataset.cat] || PAGE) + PAGE; rerender(); });
onInput('opt-q', (el) => { q[el.dataset.cat] = el.value; ui.limit[el.dataset.cat] = PAGE; rerender(); });
onChange('opt-sort', (el) => { const [sort, dir] = el.value.split('|'); setView(el.dataset.cat, { sort, dir }); rerender(); });
onChange('facet', (el) => {
  const cat = el.dataset.cat, key = el.dataset.key;
  const v = normalizeView(viewOf(cat), cat);
  const f = featuresFor(cat).find((x) => x.key === key);
  const val = f.type === 'cat' ? el.dataset.value : Number(el.dataset.value);
  let list = v.feats[key] || [];
  if (el.type === 'radio') list = el.dataset.value === '' ? [] : [val];
  else list = el.checked ? [...list, val] : list.filter((x) => String(x) !== String(val));
  setView(cat, { feats: { ...v.feats, [key]: list } });
  ui.limit[cat] = PAGE;
  rerender();
});
onChange('opt-flag', (el) => {
  const cat = el.dataset.cat, key = el.dataset.key;
  const value = el.type === 'checkbox' ? el.checked : el.dataset.value === '' ? null : el.type === 'radio' ? (key === 'minDecision' ? Number(el.dataset.value) : el.dataset.value) : el.value;
  setView(cat, { [key]: key === 'maxTotal' ? (value === '' ? null : Number(value)) : value });
  rerender();
});
on('opt-clear', (el) => { setView(el.dataset.cat, { feats: {}, minDecision: 0, maxTotal: null, underThreshold: false, deals: false, complete: false, dest: null }); q[el.dataset.cat] = ''; rerender(); });
on('opt-unfilter', (el) => {
  const cat = el.dataset.cat, key = el.dataset.key, value = el.dataset.value;
  const v = normalizeView(viewOf(cat), cat);
  if (key in v.feats) setView(cat, { feats: { ...v.feats, [key]: v.feats[key].filter((x) => String(x) !== value) } });
  else setView(cat, { [key]: key === 'minDecision' ? 0 : key === 'maxTotal' || key === 'dest' ? null : false });
  rerender();
});
on('opt-discarded', (el) => { setView(el.dataset.cat, { showDiscarded: !viewOf(el.dataset.cat).showDiscarded }); rerender(); });

export function optionsView(cat) {
  const st = store.get();
  const env = store.env();
  const b = store.build();
  const c = CAT[cat];
  const cands = candsOf(st, b, cat);
  const items = optionItems(cands, st.products, env);
  const v = normalizeView(fullView(cat), cat);
  const list = viewOptions(items, v, cat);
  const fs = facets(items, v, cat);
  const counts = purchaseFacetCounts(items, v, cat);
  const notDiscarded = items.filter((it) => !it.cand.discarded);
  const discarded = items.length - notDiscarded.length;
  const marks = marksOf(cat).filter((id) => cands.some((x) => x.id === id));
  const chosen = items.find((it) => it.cand.selected && !it.cand.discarded);
  const limit = ui.limit[cat] || PAGE;
  const values = list.map((it) => it.value).filter((x) => x != null);
  const bestValue = values.length ? Math.min(...values) : null;
  const metric = VALUE_METRICS[cat];
  const nProb = notDiscarded.filter((it) => decisionLevel(it.cand.decision) === 2).length;
  const nFixed = notDiscarded.filter((it) => decisionLevel(it.cand.decision) === FIXED).length;
  const th = threshold(env.settings);

  const tabs = html`<div class="tabs-cat" role="navigation" aria-label="Categorías">${CATEGORIES.map((x) => {
    const n = candsOf(st, b, x.key).filter((y) => !y.discarded).length;
    return html`<a class="tab" href="#/c/${x.key}"${raw(x.key === cat ? ' aria-current="page"' : '')}>${icon(x.icon)}${x.short}${n > 1 ? html` <span class="chip sm">${n}</span>` : ''}</a>`;
  })}</div>`;

  const active = [];
  for (const f of fs) for (const a of f.active) active.push([f.key, String(a), f.type === 'cat' ? (f.fmt ? f.fmt(a) : a) : f.threshold ? `${f.label} ${f.better === 'low' ? '≤' : '≥'} ${fmtFeature(f, a)}` : fmtFeature(f, a)]);
  if (v.minDecision) active.push(['minDecision', '', `${'★'.repeat(v.minDecision)} o más`]);
  if (v.maxTotal != null) active.push(['maxTotal', '', `≤ US$${v.maxTotal}`]);
  if (v.underThreshold) active.push(['underThreshold', '', `< US$${th}`]);
  if (v.deals) active.push(['deals', '', 'En oferta']);
  if (v.complete) active.push(['complete', '', 'Total completo']);
  if (v.dest) active.push(['dest', '', v.dest === 'co' ? 'Colombia' : 'Miami']);

  const facetBox = html`<aside class="card facets" aria-label="Filtros">
    <div class="row" style="padding:10px 0;align-items:center"><strong>Filtros</strong>${viewFiltered(v) ? html`<button class="btn btn-g btn-s" style="color:var(--link)" data-act="opt-clear" data-cat="${cat}">Quitar todos</button>` : ''}</div>
    ${fs.filter((f) => f.key !== 'brand' || f.values.length > 1).map((f) => html`<fieldset data-key="fs-${f.key}"><legend>${f.label}${f.unit && f.threshold ? ` (${f.unit})` : ''}</legend>
      ${f.threshold
        ? html`<label class="facet"><input type="radio" name="f-${cat}-${f.key}" data-change="facet" data-cat="${cat}" data-key="${f.key}" data-value=""${raw(!f.active.length ? ' checked' : '')}>Cualquiera</label>
          ${f.values.map((x) => html`<label class="facet ${x.count ? '' : 'off'}"><input type="radio" name="f-${cat}-${f.key}" data-change="facet" data-cat="${cat}" data-key="${f.key}" data-value="${x.value}"${raw(f.active.includes(x.value) ? ' checked' : '')}${raw(!x.count && !f.active.includes(x.value) ? ' disabled' : '')}>${f.better === 'low' ? '≤' : '≥'} ${fmtFeature(f, x.value)}<span class="n">${x.count}</span></label>`)}`
        : f.values.slice(0, ui.expanded[`facet-${cat}-${f.key}`] ? 99 : 6).map((x) => { const on = f.active.some((a) => String(a).toLowerCase() === String(x.value).toLowerCase()); return html`<label class="facet ${x.count || on ? '' : 'off'} ${x.stale ? 'stale' : ''}"><input type="checkbox" data-change="facet" data-cat="${cat}" data-key="${f.key}" data-value="${x.value}"${raw(on ? ' checked' : '')}${raw(!x.count && !on ? ' disabled' : '')}>${f.fmt ? f.fmt(x.value) : f.type === 'cat' ? x.value : fmtFeature(f, x.value)}<span class="n">${x.count}</span></label>`; })}
      ${!f.threshold && f.values.length > 6 ? html`<button class="btn btn-g btn-s" style="justify-content:flex-start;color:var(--link);padding:0" data-act="toggle-expand" data-offer="facet-${cat}-${f.key}">${ui.expanded[`facet-${cat}-${f.key}`] ? 'Ver menos' : `Ver ${f.values.length - 6} más`}</button>` : ''}
    </fieldset>`)}
    <fieldset><legend>Precio y compra</legend>
      <label class="fld" style="font-weight:400">Total hasta (US$)<input class="input sm num" type="number" min="0" step="1" value="${v.maxTotal ?? ''}" data-change="opt-flag" data-cat="${cat}" data-key="maxTotal"></label>
      <label class="facet"><input type="checkbox" data-change="opt-flag" data-cat="${cat}" data-key="underThreshold"${raw(v.underThreshold ? ' checked' : '')}>Bajo el umbral (&lt; US$${th})<span class="n">${counts.underThreshold}</span></label>
      <label class="facet"><input type="checkbox" data-change="opt-flag" data-cat="${cat}" data-key="deals"${raw(v.deals ? ' checked' : '')}>En oferta<span class="n">${counts.deals}</span></label>
      <label class="facet"><input type="checkbox" data-change="opt-flag" data-cat="${cat}" data-key="complete"${raw(v.complete ? ' checked' : '')}>Total completo (no parcial)<span class="n">${counts.complete}</span></label>
    </fieldset>
    <fieldset><legend>Destino de la tienda</legend>
      ${[['', 'Todos', ''], ['co', 'Colombia', counts.co], ['us', 'Miami / EE. UU.', counts.us]].map(([k, t, n]) => html`<label class="facet"><input type="radio" name="dest-${cat}" data-change="opt-flag" data-cat="${cat}" data-key="dest" data-value="${k}"${raw((v.dest || '') === k ? ' checked' : '')}>${t}${n !== '' ? html`<span class="n">${n}</span>` : ''}</label>`)}
    </fieldset>
    <fieldset><legend>Decisión</legend>
      ${[[0, 'Todas', ''], [1, '★ o más', counts.d1], [2, '★★ o más', counts.d2], [3, '★★★', counts.d3]].map(([k, t, n]) => html`<label class="facet"><input type="radio" name="dec-${cat}" data-change="opt-flag" data-cat="${cat}" data-key="minDecision" data-value="${k}"${raw(v.minDecision === k ? ' checked' : '')}>${t}${n !== '' ? html`<span class="n">${n}</span>` : ''}</label>`)}
    </fieldset>
  </aside>`;

  const rows = list.slice(0, limit).map((it) => {
    const p = it.product, cand = it.cand, cost = it.row?.cost;
    const marked = marks.includes(cand.id);
    const diff = !chosen || cand.selected || it.total == null || chosen.total == null ? null : it.total - chosen.total;
    const sortF = sortsFor(cat).find((o) => o.key === v.sort)?.feature;
    const sortVal = sortF ? featureValue(sortF, it.view, cat) : null;
    const nStores = it.pr.rows.filter((r) => r.cost.total != null).length;
    const busy = refresh.productProgress(p.id);
    return html`<div class="optgrid ${cand.selected ? 'sel' : ''}" data-key="opt-${cand.id}">
      <input type="checkbox" aria-label="Marcar para comparar" data-act="mark" data-cand="${cand.id}"${raw(marked ? ' checked' : '')}>
      <div style="display:flex;gap:12px;min-width:0">${thumb(p, 'sm')}
        <div style="min-width:0;display:flex;flex-direction:column;gap:4px">
          <a href="#/p/${p.id}" class="clamp2 ptitle" style="font-size:14px">${p.title}</a>
          <div class="num muted" style="font-size:12px">${sortF && sortVal != null ? html`<strong style="color:var(--acc-ink);font-weight:600">${sortF.label} ${fmtFeature(sortF, sortVal)}</strong> · ` : v.sort === 'value' && it.value != null ? html`<strong style="color:var(--acc-ink);font-weight:600">${metric.label} ${n2(it.value)}</strong> · ` : ''}${specLine(p, cand, 5)}</div>
          <div class="flex" style="gap:6px">${starsView(decisionLevel(cand.decision), 'sm')}
            ${cand.selected ? chip('Elegido', 'acc', { ico: 'check' }) : ''}
            ${cost?.deal ? chip('Oferta', 'warn') : ''}
            ${cost?.partial && cost.total != null ? chip(`Parcial: falta ${cost.missing[0]}`, 'warn', { ico: 'warn' }) : ''}
            ${cost?.overThreshold ? chip(`≥ US$${th}`, 'warn') : ''}
            ${chip(`${nStores} de ${it.pr.rows.length} tienda${it.pr.rows.length === 1 ? '' : 's'}`)}
            ${busy && (busy.running || busy.waiting) ? chip(busy.running ? 'Leyendo…' : 'En espera', busy.running ? 'acc' : '', { ico: busy.running ? 'refresh' : 'clock' }) : ''}
            ${p.rating ? html`<span class="muted" style="font-size:12px">★ ${String(p.rating).replace('.', ',')} (${intCO(p.reviews || 0)})</span>` : ''}
          </div></div></div>
      <div class="r"><div class="num" style="font-weight:600">${it.total == null ? 'sin precio' : usd(it.total)}${partialMark(cost)}</div><div style="font-size:11px" class="muted">${it.row ? `${storeName(env, it.row.offer.store)} · ${destShort(env, cost.dest)}${it.pr.suggested ? ' · sugerida' : ''}` : 'sin tiendas'}${cost?.original ? ` · COP ${intCO(cost.original.total)}` : ''}</div></div>
      <div class="r c-value">${metric ? html`<div class="num" style="font-weight:600">${it.value == null ? '—' : n2(it.value)}</div>${it.value != null && bestValue ? html`<div class="valbar"><div style="width:${Math.round((bestValue / it.value) * 100)}%"></div></div>` : ''}` : '—'}</div>
      <div class="num r c-diff" style="font-weight:600;color:${diff == null ? 'var(--muted)' : diff < 0 ? 'var(--ok)' : diff > 0 ? 'var(--err)' : 'var(--muted)'}">${cand.selected ? 'elegido' : diff == null ? '—' : signed(diff)}</div>
      <div class="actions">
        ${cand.discarded ? html`<button class="btn btn-s" data-act="discard" data-cand="${cand.id}">${icon('eye')}Recuperar</button>`
        : cand.selected ? html`<button class="btn btn-s" data-act="select" data-cand="${cand.id}"${raw(c.multi ? '' : ' disabled title="Elige otra para cambiarla"')}>${c.multi ? 'Quitar' : 'Elegido'}</button>`
        : html`<button class="btn btn-s btn-p" data-act="select" data-cand="${cand.id}">${c.multi ? 'Agregar' : 'Cambiar a este'}</button>`}
        <button class="btn btn-s btn-g" aria-label="Actualizar esta opción" title="Actualizar esta opción" data-act="refresh-product" data-product="${p.id}">${icon('refresh')}</button>
        ${cand.discarded ? '' : html`<button class="btn btn-s btn-g" aria-label="Descartar sin borrar" title="Descartar sin borrar" data-act="discard" data-cand="${cand.id}">${icon('hide')}</button>`}
      </div></div>`;
  });

  return html`<header style="background:var(--surface);border-bottom:1px solid var(--line)"><div class="wrap" style="padding-top:12px;padding-bottom:12px;gap:10px">
      <nav aria-label="Ruta" class="crumbs"><a href="#/">${b.name}</a> / ${c.name}</nav>${tabs}</div></header>
    <div class="wrap">
      <div class="flex" style="gap:12px"><h1>${c.name}</h1>${chip(c.multi ? 'Varios: puedes elegir más de uno' : 'Una pieza')}
        <span class="muted">${notDiscarded.filter((x) => x.cand.selected).length} elegido${notDiscarded.filter((x) => x.cand.selected).length === 1 ? '' : 's'} · ${nProb} probables · ${nFixed} fijos</span>
        <div class="grow"></div>
        ${GUIDES[cat] ? html`<button class="btn btn-s" data-act="guide" data-cat="${cat}">${icon('info')}${GUIDES[cat].label}</button>` : ''}
        <button class="btn btn-s" data-act="refresh-category" data-cat="${cat}">${icon('refresh')}Actualizar categoría</button></div>
      <form class="card flex" style="padding:12px" aria-label="Agregar opción" data-submit="add-link" data-cat="${cat}">
        <label for="add-${cat}" style="font-weight:600;font-size:13px">Agregar opción</label>
        <input id="add-${cat}" name="url" class="input" style="flex:1 1 360px" placeholder="Pega un enlace de Amazon, Newegg, B&amp;H, Mercado Libre…" autocomplete="off" value="">
        <button class="btn btn-p">Agregar</button>
        <button type="button" class="btn" data-act="search-amazon" data-cat="${cat}">Buscar en Amazon ${icon('ext')}</button>
        <button type="button" class="btn btn-g" data-act="manual-product" data-cat="${cat}">+ Producto manual</button>
        ${ui.addError[cat] ? html`<p role="alert" style="margin:0;flex:1 1 100%;color:var(--err);font-size:13px">${ui.addError[cat]}</p>` : ''}
      </form>
      ${items.length ? html`<div class="layout" style="gap:20px">${facetBox}
        <section class="results" aria-labelledby="res">
          <div class="card flex" style="padding:12px;gap:10px">
            <div style="position:relative;flex:1 1 260px;min-width:0">${icon('search', 'i', 'width:18px;height:18px;position:absolute;left:10px;top:11px;color:var(--muted)')}
              <input class="input" id="q-${cat}" data-input="opt-q" data-cat="${cat}" aria-label="Buscar por nombre, marca, vendedor, tienda o identificador" placeholder="Buscar nombre, marca, vendedor, MPN, ASIN…" style="padding-left:36px" value="${q[cat] || ''}" type="search"></div>
            <label class="flex" style="gap:6px;font-size:13px">Ordenar <select class="input sm" style="width:auto" data-change="opt-sort" data-cat="${cat}">${sortsFor(cat).flatMap((o) => [o.dir, o.dir === 'asc' ? 'desc' : 'asc'].map((dir) => html`<option value="${o.key}|${dir}"${raw(v.sort === o.key && v.dir === dir ? ' selected' : '')}>${o.label} · ${dirText(o.key, dir)}</option>`))}</select></label>
          </div>
          <div class="flex" aria-live="polite"><span id="res" style="font-weight:600">${v.showDiscarded ? `${list.length} descartadas` : `Mostrando ${list.length} de ${notDiscarded.length}`}</span>
            ${discarded && !v.showDiscarded ? html`<span class="muted" style="font-size:13px">· ${discarded} descartada${discarded > 1 ? 's' : ''} oculta${discarded > 1 ? 's' : ''}</span>` : ''}
            ${active.map(([key, value, label]) => html`<button class="chip c-acc lg" data-act="opt-unfilter" data-cat="${cat}" data-key="${key}" data-value="${value}" aria-label="Quitar filtro ${label}">${label} ${icon('x')}</button>`)}</div>
          ${marks.length ? html`<div class="cmpbar" role="region" aria-label="Comparación"><strong>${marks.length} marcada${marks.length > 1 ? 's' : ''} para comparar</strong>
            <span style="opacity:.75;font-size:13px">${marks.map((id) => (st.products[cands.find((x) => x.id === id)?.productId]?.title || '').split(/\s+/).slice(0, 2).join(' ')).join(' · ')}</span><div class="grow"></div>
            <button class="btn btn-s" data-act="unmark" data-cat="${cat}">Desmarcar</button>${marks.length >= 2 ? html`<a class="btn btn-s solid" href="#/comparar/${cat}">Comparar ${marks.length}</a>` : html`<span style="font-size:13px;opacity:.75">Marca otra para comparar</span>`}</div>`
          : list.length >= 2 ? html`<div class="flex muted" style="font-size:13px">Marca 2 o más para comparar solo esas, o <a href="#/comparar/${cat}">compara las ${Math.min(list.length, 8)} primeras filtradas</a>.</div>` : ''}
          <div class="card" style="overflow:hidden">
            <div class="optgrid head"><span></span><span>Producto · especificaciones</span><span class="r">Total</span><span class="r">${metric ? metric.label : 'Valor'}</span><span class="r">vs elegida</span><span></span></div>
            ${rows}
            ${!list.length ? html`<div class="empty-state">Ninguna opción coincide con los filtros. <button class="btn btn-s" data-act="opt-clear" data-cat="${cat}">Quitar filtros</button></div>` : ''}
            <div class="row" style="padding:12px 16px;align-items:center;flex-wrap:wrap">
              <span class="muted" style="font-size:13px">${Math.min(limit, list.length)} de ${list.length}</span>
              ${list.length > limit ? html`<button class="btn btn-s" data-act="opt-more" data-cat="${cat}">Ver ${Math.min(PAGE, list.length - limit)} más</button>` : ''}
              ${discarded ? html`<button class="btn btn-s btn-g" style="color:var(--link)" data-act="opt-discarded" data-cat="${cat}">${icon(v.showDiscarded ? 'eye' : 'hide')}${v.showDiscarded ? 'Volver a las opciones' : `Ver ${discarded} descartada${discarded > 1 ? 's' : ''}`}</button>` : ''}
            </div>
          </div>
        </section></div>`
      : html`<div class="card empty-state">Aún no hay opciones de ${c.name.toLowerCase()}. Pega arriba un enlace de una tienda, busca en Amazon y pulsa el marcador en la ficha, o agrega un producto manual.</div>`}
    </div>`;
}
const dirText = (key, dir) => (key === 'name' ? (dir === 'asc' ? 'A → Z' : 'Z → A') : key === 'added' ? (dir === 'desc' ? 'recientes' : 'antiguas') : key === 'decision' ? (dir === 'desc' ? 'más estrellas' : 'menos estrellas') : dir === 'asc' ? 'menor primero' : 'mayor primero');
