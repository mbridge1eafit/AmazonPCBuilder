// @ts-check
// Comparar opciones lado a lado, igual en todas las categorías (R9): marcadas o filtradas, base del total,
// ocultar filas iguales o vacías, escala peor → mejor (con ▲/▼, no solo color), «Gana en» y elegir desde la tabla.
import { html, raw } from '../dom.js';
import { icon, chip, thumb, storeName, seg } from '../components.js';
import { ui, on, rerender } from '../ui.js';
import * as store from '../../state/store.js';
import { prefsGet, prefsSet, marksOf, setMarks, viewOf } from '../../state/prefs.js';
import { CAT, DECISIONS, decisionLevel } from '../../domain/categories.js';
import { candsOf } from '../../domain/build.js';
import { optionItems, viewOptions } from '../../domain/filters.js';
import { compareTable } from '../../domain/compare.js';
import { threshold } from '../../domain/tax.js';

on('cmp-set', (el) => { ui.compareSet = el.dataset.value; rerender(); });
on('cmp-basis', (el) => { prefsSet({ compareBasis: el.dataset.value }); rerender(); });
on('cmp-hide', (el) => { prefsSet({ hideEqual: el.checked }); rerender(); });
on('cmp-remove', (el) => {
  const cat = el.dataset.cat;
  const ids = marksOf(cat);
  if (ids.length) setMarks(cat, ids.filter((x) => x !== el.dataset.cand));
  else ui.cmpHidden = { ...(ui.cmpHidden || {}), [el.dataset.cand]: true };
  rerender();
});

const MAX_COLS = 8;
const TAG = { best: '▲ mejor', worst: '▼ peor', mid: '', none: '' };

export function compareView(cat) {
  const st = store.get();
  const env = store.env();
  const b = store.build();
  const items = optionItems(candsOf(st, b, cat), st.products, env);
  const marks = marksOf(cat);
  const marked = items.filter((it) => marks.includes(it.cand.id) && !it.cand.discarded);
  const filtered = viewOptions(items, viewOf(cat), cat);
  const useMarked = ui.compareSet === 'marked' && marked.length >= 2;
  // Ordenada como la vista de opciones.
  const order = new Map(filtered.map((it, i) => [it.cand.id, i]));
  let cols = (useMarked ? marked.sort((a, z) => (order.get(a.cand.id) ?? 999) - (order.get(z.cand.id) ?? 999)) : (filtered.length >= 2 ? filtered : items.filter((it) => !it.cand.discarded))).filter((it) => !ui.cmpHidden?.[it.cand.id]).slice(0, MAX_COLS);
  const basis = prefsGet().compareBasis === 'co' ? 'co' : 'dest';
  const hideEqual = prefsGet().hideEqual !== false;
  const chosen = items.find((it) => it.cand.selected && !it.cand.discarded);
  const t = compareTable(cols, cat, { basis, hideEqual, chosenTotal: chosen?.total ?? null, threshold: threshold(env.settings), storeName: (k) => storeName(env, k) });
  const n = cols.length;
  const c = CAT[cat];
  const grid = `200px repeat(${n}, minmax(240px, 1fr))`;
  return html`<div class="wrap">
    <nav aria-label="Ruta" class="crumbs"><a href="#/">${b.name}</a> / <a href="#/c/${cat}">${c.name}</a> / Comparar</nav>
    <div class="flex" style="gap:12px"><h1>Comparar ${c.name.toLowerCase()}</h1>
      ${seg('Qué comparar', [['marked', `Marcadas · ${marked.length}`], ['filtered', `Filtradas · ${filtered.length}`]], useMarked ? 'marked' : 'filtered', 'cmp-set')}
      <div class="grow"></div>
      <label class="chk"><input type="checkbox" data-act="cmp-hide"${raw(hideEqual ? ' checked' : '')} style="width:18px;height:18px">Ocultar filas iguales o vacías ${t.hidden.length ? html`<span class="muted">(${t.hidden.length} ocultas)</span>` : ''}</label>
      ${seg('Base del total', [['dest', 'En destino'], ['co', 'Puesto en CO']], basis, 'cmp-basis')}</div>
    ${ui.compareSet === 'marked' && marked.length < 2 ? html`<div class="banner">${icon('info')}<span>Marca 2 o más opciones en la lista para comparar solo esas. Mientras tanto se comparan las filtradas${filtered.length > MAX_COLS ? ` (las ${MAX_COLS} primeras)` : ''}.</span></div>` : ''}
    <div class="legend" aria-label="Leyenda de la escala">
      <span><span style="width:28px;height:14px;border-radius:4px;background:var(--best)"></span>${icon('up', 'i', 'width:12px;height:12px;color:var(--acc-ink)')}Mejor de la fila</span>
      <span><span style="width:28px;height:14px;border-radius:4px;background:var(--mid)"></span>Intermedio</span>
      <span><span style="width:28px;height:14px;border-radius:4px;background:var(--worst)"></span>${icon('down', 'i', 'width:12px;height:12px;color:var(--worst-ink)')}Peor de la fila</span>
      <span>Sin escala si falta un dato o todos son iguales · orden de la lista de opciones</span></div>
    ${n < 2 ? html`<div class="card empty-state">Se necesitan al menos 2 opciones para comparar. <a href="#/c/${cat}">Ir a las opciones</a></div>` : html`
    <div class="card" style="overflow:auto;max-height:calc(100vh - 220px)">
      <div class="cmp" role="table" aria-label="Comparación de ${n} opciones" style="grid-template-columns:${grid}">
        <div class="corner muted" role="columnheader">${n} opciones</div>
        ${cols.map((it, i) => html`<div class="ch ${it.cand.selected ? 'sel' : ''}" role="columnheader" data-key="col-${it.cand.id}">
          <div style="display:flex;gap:10px;align-items:flex-start">${thumb(it.product, 'xs')}
            <div style="flex:1;min-width:0"><a href="#/p/${it.product.id}" class="clamp2" style="font-weight:600;color:var(--ink);text-decoration:none;font-size:14px">${it.product.title}</a>
              <div class="muted" style="font-size:12px;font-weight:500">${DECISIONS[decisionLevel(it.cand.decision)].stars} ${DECISIONS[decisionLevel(it.cand.decision)].label}</div></div>
            <button class="btn btn-g btn-s" aria-label="Quitar columna" data-act="cmp-remove" data-cat="${cat}" data-cand="${it.cand.id}" style="padding:0 6px">${icon('x')}</button></div>
          <div class="wins"><span style="font-size:12px;font-weight:600">Gana en</span><span class="num" style="font-size:16px;font-weight:600">${t.wins[i]} de ${t.of}</span></div>
          <div style="margin-top:10px">${it.cand.selected ? chip('Elegido en el armado', 'acc', { size: 'lg' }) : html`<button class="btn btn-p btn-s" data-act="select" data-cand="${it.cand.id}">${c.multi ? 'Agregar al armado' : 'Elegir esta'}</button>`}</div>
        </div>`)}
        ${t.rows.map((r) => r.group ? html`<div class="grp" role="row">${r.label}</div>` : html`<div class="rh" role="rowheader">${r.label}${r.hint ? html`<div style="font-size:11px;color:var(--faint)">${r.hint}</div>` : ''}</div>
          ${r.cells.map((x) => html`<div role="cell"><div class="rk num t-${x.tone}"><span>${x.v}</span><small>${TAG[x.tone]}</small></div>${x.note ? html`<div style="font-size:11px;margin-top:4px" class="muted">${x.note}</div>` : ''}</div>`)}`)}
      </div></div>
    ${t.hidden.length ? html`<div class="muted" style="font-size:12px">Ocultas por iguales o vacías: ${t.hidden.join(', ')}.</div>` : ''}`}
  </div>`;
}
