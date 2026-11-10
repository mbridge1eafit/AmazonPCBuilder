// @ts-check
// Armado: resumen y costos (aside), vista general por categorías, compatibilidad y compra, y las piezas elegidas.
import { html, raw } from '../dom.js';
import { icon, chip, starsView, starPicker, thumb, statusChip, storeName, destShort, readChip, taxNote, partialMark, empty } from '../components.js';
import { usd, n2, cop, ago, intCO, signed } from '../format.js';
import { ui } from '../ui.js';
import * as store from '../../state/store.js';
import { marksOf } from '../../state/prefs.js';
import * as refresh from '../../services/refresh.js';
import { CATEGORIES, CAT, DECISIONS, decisionLevel, ESSENTIAL_COUNT, FIXED } from '../../domain/categories.js';
import { totals, categoryState, candsOf } from '../../domain/build.js';
import { checks } from '../../domain/checks.js';
import { featuresFor, featureValue, fmtFeature, specView } from '../../domain/specs.js';
import { markRows, purchaseRow } from '../../domain/purchase.js';
import { trend } from '../../domain/history.js';
import { shortTitle } from '../../domain/checks.js';

export function specLine(product, cand, n = 6) {
  const view = specView(product, cand);
  return featuresFor(product.category).filter((f) => f.key !== 'brand').map((f) => { const v = featureValue(f, view, product.category); return v == null ? null : fmtFeature(f, v); }).filter(Boolean).slice(0, n).join(' · ');
}

const LV = { error: ['err', 'Problema', 'lv-error'], warn: ['warn', 'Aviso', 'lv-warn'], info: ['info', 'Nota', 'lv-info'], ok: ['check', 'Correcto', 'lv-ok'] };

export function buildView() {
  const st = store.get();
  const env = store.env();
  const b = store.build();
  const t = totals(st, b, env);
  const ks = checks(st, b, env);
  const trm = env.settings.fx.trm;
  const nk = (lv) => ks.filter((k) => k.level === lv).length;
  const essentials = CATEGORIES.filter((c) => c.essential && t.lines.some((l) => l.cat === c.key)).length;
  const cats = CATEGORIES.map((c) => categoryState(st, b, c.key, ks));
  const taxSrc = Object.entries(t.toBuy.taxSources).filter(([k]) => ['estimated', 'store', 'edited'].includes(k)).map(([k, v]) => `${v} ${{ estimated: v > 1 ? 'estimados' : 'estimado', store: 'según tienda', edited: v > 1 ? 'editados' : 'editado' }[k]}`).join(' · ');
  const psuLine = t.lines.find((l) => l.cat === 'psu');
  const psuW = psuLine ? Number(featureValue(featuresFor('psu').find((f) => f.key === 'power'), psuLine.view, 'psu')) || null : null;
  const pwrState = !psuW ? ['Sin fuente', ''] : psuW >= t.watts * env.settings.psuMargin ? ['Con margen', 'ok'] : psuW >= t.watts ? ['Poco margen', 'warn'] : ['Insuficiente', 'err'];
  const noPaid = b.candidates.filter((c) => c.selected && c.status === 'bought' && !c.purchase).length;
  const firstPartial = t.toBuy.partial[0];

  const aside = html`<aside class="aside" aria-label="Resumen del armado">
    <section class="card pad stack" style="gap:14px">
      <div class="row"><span class="lbl">Por comprar · ${t.toBuy.count} producto${t.toBuy.count === 1 ? '' : 's'}</span>${t.toBuy.partial.length ? chip('Parcial', 'warn', { ico: 'warn', title: `${t.toBuy.partial.length} con datos faltantes` }) : ''}</div>
      <div><div class="num big">${usd(t.toBuy.total)}${t.toBuy.partial.length ? html`<span style="color:var(--warn)" aria-label="parcial">*</span>` : ''}</div>
        <div class="num muted" style="font-size:14px;margin-top:4px">≈ ${cop(t.toBuy.total, trm)} <span style="font-family:var(--font);font-size:12px">· TRM ${intCO(trm)} del ${env.settings.fx.date}</span></div></div>
      <button class="btn breakdown" aria-expanded="${!!ui.expanded.summary}" data-act="toggle-expand" data-offer="summary">
        <span class="row" style="width:100%"><span class="muted">Productos</span><span class="num">${n2(t.toBuy.subtotal)}</span></span>
        <span class="row" style="width:100%"><span class="muted">Envío al destino</span><span class="num">${n2(t.toBuy.shipping)}</span></span>
        <span class="row" style="width:100%"><span class="muted">Impuestos ${taxSrc ? chip(taxSrc, '', { size: 'sm' }) : ''}</span><span class="num">${n2(t.toBuy.tax)}</span></span>
        ${ui.expanded.summary ? t.lines.filter((l) => (l.cand.status || 'buy') === 'buy').map((l) => html`<span class="row" style="width:100%;font-size:12px"><span class="muted" style="text-align:left">${shortTitle(l.product.title, 34)} · ${l.pr.row ? storeName(env, l.pr.row.offer.store) : 'sin tienda'}</span><span class="num">${l.cost?.total == null ? '—' : n2(l.cost.total)}${partialMark(l.cost)}</span></span>`) : ''}
        ${firstPartial ? html`<span style="font-size:12px;color:var(--warn);text-align:left">* ${shortTitle(firstPartial.line.product.title, 30)}: falta ${firstPartial.missing.join(', ')}.${t.toBuy.partial.length > 1 ? ` (+${t.toBuy.partial.length - 1})` : ''}</span>` : ''}
      </button>
      ${firstPartial ? html`<a href="#/p/${firstPartial.line.product.id}" style="font-size:12px;margin-top:-8px">Completar</a>` : ''}
      ${t.budget ? html`<div class="stack" style="gap:6px">
        <div class="row"><span style="font-weight:600">Presupuesto</span><span>${t.budget.left >= 0 ? html`<span class="num" style="font-weight:600;color:var(--ok)">Quedan ${usd(t.budget.left)}</span>` : html`<span class="num" style="font-weight:600;color:var(--err)">Te pasas por ${usd(-t.budget.left)}</span>`} <span class="muted num">de ${intCO(t.budget.amount).replace(/\./g, ',')}</span></span></div>
        <div class="meter" role="meter" aria-valuenow="${Math.round(t.budget.pct * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="Presupuesto usado ${Math.round(t.budget.pct * 100)} %"><div style="width:${Math.min(100, t.budget.pct * 100)}%;${t.budget.left < 0 ? 'background:var(--err)' : ''}"></div></div>
        <div class="muted num" style="font-size:12px">≈ ${cop(Math.abs(t.budget.left), trm)} ${t.budget.left >= 0 ? 'libres' : 'de más'} · solo cuenta lo por comprar</div></div>`
        : html`<a href="#/ajustes/armado" style="font-size:13px">Definir presupuesto</a>`}
      <ul class="notes">
        <li>${icon(t.over.count ? 'warn' : 'check', 'ico', `width:16px;color:var(--${t.over.count ? 'warn' : 'ok'})`)}<span>${t.over.count ? html`<strong>${t.over.count} de ${t.orders} pedidos</strong> supera${t.over.count > 1 ? 'n' : ''} US$${t.threshold} · IVA ${usd(t.over.tax)}` : `${t.orders} pedidos, todos < US$${t.threshold}`}</span></li>
        <li>${icon('star', 'ico', 'width:16px;fill:var(--muted)')}<span>${t.fixed.count} fijo${t.fixed.count === 1 ? '' : 's'} (★★★) suman <span class="num">${usd(t.fixed.total)}</span> · ${t.pending ? `${t.pending} por decidir` : 'todo decidido'}</span></li>
        ${t.unknownPrice ? html`<li>${icon('info', 'ico', 'width:16px;color:var(--muted)')}<span>${t.unknownPrice} sin precio</span></li>` : ''}
      </ul>
    </section>
    <section class="card pad stack" style="gap:10px">
      <div class="lbl">Costo del armado completo</div>
      <div class="row"><span>Por comprar</span><span class="num">${n2(t.toBuy.total)}${t.toBuy.partial.length ? '*' : ''}</span></div>
      <div class="row"><span>Ya comprado ${t.bought.noPaid ? chip(`${t.bought.noPaid} sin precio pagado`, '', { size: 'sm' }) : ''}</span><span class="num">${n2(t.bought.total)}</span></div>
      <div class="row"><span>Planeado</span><span class="num">${n2(t.planned.total)}</span></div>
      <div class="row" style="border-top:1px solid var(--line);padding-top:10px;font-weight:600"><span>Total del armado</span><span class="num" style="font-size:18px">${usd(t.grand)}</span></div>
      <div class="muted num" style="font-size:12px;text-align:right">≈ ${cop(t.grand, trm)}</div>
      <button class="btn btn-s" style="align-self:flex-start" data-act="paid">${icon('receipt')}Registrar precio pagado${noPaid ? ` (${noPaid})` : ''}</button>
    </section>
    ${t.byStore.length ? html`<section class="card pad stack" style="gap:10px">
      <div class="lbl">Por tienda de compra</div>
      ${t.byStore.map((g) => html`<div class="stack" style="gap:4px"><div class="row"><span><strong style="font-weight:600">${storeName(env, g.store)}</strong> <span class="muted" style="font-size:12px">${destShort(env, g.dest)} · ${g.n} pedido${g.n === 1 ? '' : 's'}</span></span><span class="num">${n2(g.total)}${g.partial ? '*' : ''}</span></div><div class="bar"><div style="width:${Math.round(g.pct * 100)}%"></div></div></div>`)}
      ${t.mixedDest ? html`<div style="font-size:12px" class="muted">Destinos distintos: el total en Miami no incluye el casillero a Colombia.</div>` : ''}
    </section>` : ''}
    <section class="card pad stack" style="gap:10px">
      <div class="row"><span class="lbl">Consumo eléctrico</span>${chip(pwrState[0], pwrState[1], { ico: pwrState[1] === 'ok' ? 'check' : pwrState[1] ? 'warn' : '' })}</div>
      <div class="row"><span><span class="num" style="font-size:22px;font-weight:600">${t.watts} W</span> <span class="muted">estimado</span></span><span class="muted">Fuente <span class="num" style="color:var(--ink)">${psuW ? `${psuW} W` : 'sin elegir'}</span></span></div>
      ${psuW ? html`<div class="watt-bar" role="img" aria-label="Consumo ${t.watts} W de ${psuW} W; recomendado ${t.recommendedPsu} W"><div class="fill" style="width:${Math.min(100, (t.watts / psuW) * 100)}%"></div><div class="mark" style="left:${Math.min(99, (t.recommendedPsu / psuW) * 100)}%"></div></div>` : ''}
      <div class="muted" style="font-size:12px">Recomendada ${t.recommendedPsu} W (×${String(env.settings.psuMargin).replace('.', ',')}).${t.watts !== t.wattsNow ? ' Incluye lo planeado.' : ''}${!t.lines.some((l) => l.cat === 'gpu') ? ' Sin GPU elegida.' : ''}${t.genericWatts.length ? ` Consumo genérico: ${t.genericWatts.map((l) => CAT[l.cat].short).join(', ')}.` : ''}${t.externalWatts ? ` Monitores ${t.externalWatts} W al enchufe.` : ''}</div>
    </section>
  </aside>`;

  const tiles = html`<section aria-labelledby="vg">
    <div class="row" style="margin-bottom:10px;align-items:center"><h2 id="vg" style="font-size:18px">Vista general</h2>
      <div class="legend hide-m"><span>${icon('check', 'ico', 'width:14px;color:var(--ok)')}Comprado</span><span><span style="width:10px;height:10px;border:2px solid var(--acc);border-radius:50%"></span>Por comprar</span><span><span style="width:10px;height:10px;border:2px dashed var(--muted);border-radius:50%"></span>Planeado</span><span>${icon('star', 'ico', 'width:14px;fill:var(--star)')}Fijo</span></div></div>
    <div class="tiles">${cats.map((c) => {
      const cat = CAT[c.cat];
      const st2 = { bought: ['Comprado', 'ok'], buy: ['Por comprar', 'acc'], planned: ['Planeado', 'line'], empty: ['Falta', 'line'], opt: ['Opcional', 'line'] }[c.status];
      const pickTxt = c.sel.length > 1 ? `${c.sel.length} elegidos · ${c.sel.map((x) => shortTitle(st.products[x.productId].title, 18)).join(', ')}` : c.sel[0] ? shortTitle(st.products[c.sel[0].productId].title, 48) : c.options ? `Sin elegir · ${c.options} opciones` : 'Sin opciones';
      const flag = c.err ? [`${c.problems.filter((k) => k.level === 'error').length} problema`, 'var(--err)'] : c.problems.length ? [`${c.problems.length} aviso${c.problems.length > 1 ? 's' : ''}`, 'var(--warn)'] : c.fixed ? ['Fijo', 'var(--fixed)'] : c.sel.length ? [DECISIONS[c.level].label, 'var(--muted)'] : ['', ''];
      return html`<a class="tile ${c.err ? 'err' : c.status === 'empty' || c.status === 'opt' ? 'empty' : ''}" href="#/c/${c.cat}" data-key="tile-${c.cat}" aria-label="${cat.name}: ${st2[0]}${flag[0] ? `, ${flag[0]}` : ''}">
        <div class="row" style="align-items:center">${icon(cat.icon, 'ico', 'width:24px;height:24px')}${chip(st2[0], st2[1], { size: 'md' })}</div>
        <div style="font-weight:600;font-size:13px">${cat.short}</div>
        <div class="clamp2 muted" style="font-size:12px;line-height:1.35">${pickTxt}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:auto;font-size:11px"><span class="tile-stars">${c.sel.length ? starsView(c.level) : ''}</span><span style="font-weight:600;color:${flag[1]}">${flag[0]}</span></div>
      </a>`;
    })}</div></section>`;

  const shown = ks.filter((k) => k.level !== 'ok');
  const oks = ks.filter((k) => k.level === 'ok');
  const checkList = (list) => list.map((k) => html`<li>${icon(LV[k.level][0], `ico ${LV[k.level][2]}`, 'margin-top:1px')}<div style="flex:1;min-width:0"><div style="font-weight:600"><span class="${LV[k.level][2]}">${LV[k.level][1]}:</span> ${k.title}</div><div class="muted" style="font-size:13px">${k.detail}</div></div>${k.cats[0] ? html`<a href="#/c/${k.cats[0]}" style="font-size:13px;white-space:nowrap;font-weight:500">Ir a ${CAT[k.cats[0]].short}</a>` : ''}</li>`);
  const compat = html`<section class="card" aria-labelledby="cc">
    <div class="card-h"><h2 id="cc">Compatibilidad y compra</h2>
      ${nk('error') ? chip(`${nk('error')} problema${nk('error') > 1 ? 's' : ''}`, 'err', { ico: 'err' }) : ''}${nk('warn') ? chip(`${nk('warn')} aviso${nk('warn') > 1 ? 's' : ''}`, 'warn', { ico: 'warn' }) : ''}${nk('info') ? chip(`${nk('info')} nota${nk('info') > 1 ? 's' : ''}`, '', { ico: 'info' }) : ''}
      ${!nk('error') && !nk('warn') ? chip('Compatible', 'ok', { ico: 'check' }) : ''}
      <span class="chip c-line num">${essentials}/${ESSENTIAL_COUNT} esenciales</span></div>
    <ul class="checks" aria-live="polite">${checkList(shown)}${ui.okOpen ? checkList(oks) : ''}</ul>
    ${oks.length ? html`<button class="btn btn-g" style="margin:6px 10px;color:var(--ok)" aria-expanded="${ui.okOpen}" data-act="toggle-ok">${icon('check')}${oks.length} revisiones correctas ${icon(ui.okOpen ? 'up' : 'down')}</button>` : ''}
  </section>`;

  const sections = CATEGORIES.map((c) => {
    const cs = cats.find((x) => x.cat === c.key);
    if (!cs.sel.length && !c.essential) return '';
    return categorySection(st, env, b, c, cs);
  });

  return html`<div class="wrap"><div class="layout">${aside}<main class="main">${tiles}${compat}${sections}</main></div></div>`;
}

function categorySection(st, env, b, c, cs) {
  const marks = marksOf(c.key).filter((id) => b.candidates.some((x) => x.id === id && !x.discarded));
  const fixedN = cs.all.filter((x) => !x.discarded && decisionLevel(x.decision) === FIXED).length;
  if (!cs.sel.length) {
    const probable = cs.all.filter((x) => !x.discarded && decisionLevel(x.decision) >= 2).length;
    return html`<section class="card dashed" aria-labelledby="h-${c.key}" data-key="sec-${c.key}">
      <div style="padding:16px 20px" class="flex">${icon(c.icon, 'ico', 'width:24px;height:24px')}<h2 id="h-${c.key}">${c.name}</h2>${chip('Falta · esencial', '', { ico: 'info' })}<span class="muted" style="font-size:13px">${cs.options} opciones${probable ? ` · ${probable} probables (★★)` : ''}</span></div>
      <div style="padding:0 20px 20px" class="flex" ><p style="margin:0;flex:1 1 300px">${c.key === 'gpu' ? `Aún no eliges GPU. El consumo usa ${c.watts} W genéricos y la revisión de 12V-2x6 queda pendiente.` : `Aún no eliges ${c.name.toLowerCase()}.`}</p>
        <a class="btn btn-p" href="#/c/${c.key}">${cs.options ? `Elegir entre ${cs.options} opciones` : 'Agregar opciones'}</a></div>
    </section>`;
  }
  return html`<section class="card" aria-labelledby="h-${c.key}" data-key="sec-${c.key}">
    <div class="card-h">${icon(c.icon, 'ico', 'width:24px;height:24px')}<h2 id="h-${c.key}">${c.name}</h2>${c.multi ? chip(c.external ? 'Varios · externo' : 'Varios') : ''}
      <span class="muted" style="font-size:13px">${cs.sel.length} elegido${cs.sel.length > 1 ? 's' : ''} · ${cs.options} opciones${cs.discarded ? ` · ${cs.discarded} descartadas` : ''}${fixedN ? ` · ${fixedN} ★★★` : ''}</span>
      <div class="grow"></div>
      ${marks.length >= 2 ? html`<a class="btn btn-s" href="#/comparar/${c.key}">Comparar ${marks.length} marcadas</a>` : ''}
      <a class="btn btn-s" href="#/c/${c.key}">Ver opciones ${icon('chev')}</a></div>
    ${cs.sel.map((cand) => chosenCard(st, env, cand))}
  </section>`;
}

export function chosenCard(st, env, cand) {
  const p = st.products[cand.productId];
  const pr = purchaseRow(cand, p, env);
  const cost = pr.row?.cost;
  const { rows } = markRows(pr.rows);
  const bought = cand.status === 'bought';
  const trm = env.settings.fx.trm;
  const busy = refresh.productProgress(p.id);
  return html`<div data-key="chosen-${cand.id}">
    <div class="chosen">
      ${thumb(p)}
      <div style="flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:8px">
        <a href="#/p/${p.id}" class="ptitle clamp2">${p.title}</a>
        <div class="muted num" style="font-size:12px">${specLine(p, cand)}</div>
        <div class="flex" style="gap:6px">${statusChip(cand.status)}
          ${cost?.dest === 'co' && cost.total != null ? (cost.overThreshold ? chip(`≥ US$${env.settings.taxRules.find((r) => r.id === 'co-exempt')?.threshold} · IVA ${taxNote(cost, env)}`, 'warn', { ico: 'warn' }) : chip(`< US$${env.settings.taxRules.find((r) => r.id === 'co-exempt')?.threshold}`, 'ok')) : ''}
          ${pr.row?.offer.shipsToDestination === true ? chip(`Envía a ${destShort(env, cost.dest)}`, 'ok', { ico: 'check' }) : pr.row?.offer.shipsToDestination === false ? chip(`No envía a ${destShort(env, cost.dest)}`, 'err', { ico: 'err' }) : ''}
          ${p.rating ? chip(`★ ${String(p.rating).replace('.', ',')} (${intCO(p.reviews || 0)})`) : ''}
          ${cost?.deal ? chip(`Oferta −${Math.round((1 - pr.row.offer.price / pr.row.offer.listPrice) * 100)} %`, 'warn') : ''}
          ${cand.qty > 1 ? chip(`× ${cand.qty}`) : ''}
          ${cand.targetPrice != null && cost?.total != null && cost.total <= cand.targetPrice ? chip('Objetivo alcanzado', 'ok', { ico: 'bell' }) : ''}
          ${busy && (busy.running || busy.waiting) ? chip(busy.running ? 'Leyendo…' : `${busy.done}/${busy.total} · ${busy.waiting} en espera`, busy.running ? 'acc' : '', { ico: busy.running ? 'refresh' : 'clock' }) : ''}
        </div>
        ${starPicker(cand)}
      </div>
      <div class="pricebox">
        ${bought && cand.purchase ? html`<div class="row"><span class="lbl">Pagado · ${cand.purchase.date || ''}</span>${chip(cand.purchase.source === 'order' ? 'Pedido' : 'Manual', '', { size: 'md' })}</div>
          <div class="num" style="font-size:24px;font-weight:600">${usd(cand.purchase.total.amount)}</div>
          <div class="num muted" style="font-size:12px">${cand.purchase.original ? `COP ${intCO(cand.purchase.original.amount)} · TRM ${cand.purchase.original.rate}` : `≈ ${cop(cand.purchase.total.amount, trm)}`}${cand.purchase.orderId ? ` · pedido ${cand.purchase.orderId}` : ''}</div>
          ${cost?.total != null ? html`<div style="font-size:12px">Hoy en ${storeName(env, pr.row.offer.store)}: <span class="num">${usd(cost.total)}</span> <span class="num" style="color:var(--${cost.total < cand.purchase.total.amount ? 'ok' : 'err'})">${cost.total === cand.purchase.total.amount ? '=' : `${cost.total < cand.purchase.total.amount ? '▼' : '▲'} ${n2(Math.abs(cost.total - cand.purchase.total.amount))}`}</span></div>` : ''}
          <button class="btn btn-s" data-act="paid" data-cand="${cand.id}">Editar lo pagado</button>`
        : html`<div class="row"><span class="lbl">${bought ? 'Hoy en ' : 'Total en '}${cost ? destShort(env, cost.dest) : 'destino'}</span>${pr.row ? chip(pr.suggested ? 'Sugerida' : 'Elegida', pr.suggested ? 'acc' : '', { size: 'md' }) : ''}</div>
          <div class="num" style="font-size:24px;font-weight:600">${cost?.total == null ? 'sin precio' : usd(cost.total)}${partialMark(cost)}</div>
          <div class="num muted" style="font-size:12px">${cost?.total == null ? '' : cost.original ? `COP ${intCO(cost.original.total)}` : `≈ ${cop(cost.total, trm)}`}${cost?.landedCO && !cost.landedCO.inCO ? ` · puesto en CO ≈ ${usd(cost.landedCO.total)}${cost.landedCO.partial ? '*' : ''}` : ''}</div>
          ${bought ? html`<button class="btn btn-s" data-act="paid" data-cand="${cand.id}">Registrar lo que pagaste</button>` : ''}`}
        ${rows.length ? html`<label style="font-size:12px;display:flex;flex-direction:column;gap:4px;margin-top:4px"><span class="muted">Comprar en</span>
          <select class="input sm" data-change="purchase-store" data-cand="${cand.id}">
            <option value=""${raw(!cand.purchaseOfferId ? ' selected' : '')}>Sugerida: ${pr.suggested && pr.row ? `${storeName(env, pr.row.offer.store)} · ${destShort(env, pr.row.cost.dest)}` : 'menor total en su destino'}</option>
            ${rows.map((r) => html`<option value="${r.offer.id}"${raw(cand.purchaseOfferId === r.offer.id ? ' selected' : '')}>${storeName(env, r.offer.store)} · ${destShort(env, r.cost.dest)} — ${r.cost.total == null ? 'sin precio' : usd(r.cost.total)}${r.lowest ? ' (menor)' : ''}</option>`)}
          </select></label>` : html`<a class="btn btn-s" href="#/p/${p.id}">+ Agregar tienda</a>`}
        ${pr.row ? html`<div class="muted" style="font-size:12px">${pr.row.offer.fetchedAt ? `Leído ${ago(pr.row.offer.fetchedAt)}` : 'Escrito a mano'} · ${cost?.dest === 'co' ? 'cargos' : 'sales tax'} ${taxNote(cost, env)}${pr.mixedDest ? ' · destinos distintos' : ''}</div>` : ''}
      </div>
    </div>
    ${rows.length > 1 ? html`<div style="padding:0 20px 16px" class="tbl-wrap"><table aria-label="Tiendas de ${shortTitle(p.title, 40)}">
      <thead><tr><th>Tienda</th><th>Destino</th><th class="r">Total en destino</th><th class="r">Puesto en CO</th><th>Tendencia</th><th>Lectura</th></tr></thead>
      <tbody>${rows.map((r) => { const tr = trend(r.offer); return html`<tr${raw(pr.row?.offer.id === r.offer.id ? ' class="sel"' : '')}>
        <td class="mid"><strong>${storeName(env, r.offer.store)}</strong> ${r.lowest ? chip('Más bajo', 'ok', { size: 'sm' }) : ''}</td>
        <td class="mid">${destShort(env, r.cost.dest)}</td>
        <td class="r num mid">${r.cost.total == null ? html`<span class="src">sin dato</span>` : n2(r.cost.total)}${partialMark(r.cost)}${r.cost.original ? html` <span class="muted" style="font-size:11px">COP ${intCO(r.cost.original.total)}</span>` : ''}</td>
        <td class="r num mid">${r.cost.landedCO?.total == null ? '—' : n2(r.cost.landedCO.total)}${r.cost.landedCO?.partial && !r.cost.landedCO.inCO ? '*' : ''}</td>
        <td class="num mid" style="color:${!tr || !tr.diff ? 'var(--muted)' : tr.diff < 0 ? 'var(--ok)' : 'var(--err)'}">${!tr ? '—' : !tr.diff ? '=' : `${tr.diff < 0 ? '▼' : '▲'} ${n2(Math.abs(tr.diff))}`}</td>
        <td class="mid">${readChip(r.offer, env, refresh.offerState(r.offer.id))}</td></tr>`; })}</tbody></table></div>` : ''}
  </div>`;
}
export { signed };
