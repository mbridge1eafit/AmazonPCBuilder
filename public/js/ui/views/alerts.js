// @ts-check
// Alertas de precio (R15): nuevas aparte de las vistas, con enlace al producto.
import { html } from '../dom.js';
import { icon, chip, storeName, thumb } from '../components.js';
import { n2, ago } from '../format.js';
import * as store from '../../state/store.js';
import { ALERT_LABELS } from '../../domain/alerts.js';
import { shortTitle } from '../../domain/checks.js';

export function alertsView() {
  const st = store.get();
  const env = store.env();
  const list = st.alertEvents.slice().reverse();
  const unseen = list.filter((a) => !a.seen);
  const seen = list.filter((a) => a.seen);
  const withTarget = store.build().candidates.filter((c) => c.targetPrice != null && !c.discarded);
  const item = (a) => {
    const p = st.products[a.productId];
    if (!p) return '';
    return html`<li class="flex" style="gap:12px;padding:12px 20px;border-bottom:1px solid var(--line-2);flex-wrap:nowrap" data-key="al-${a.id}">
      ${thumb(p, 'xs')}<div style="flex:1;min-width:0"><div class="flex" style="gap:6px">${chip(ALERT_LABELS[a.kind] || a.kind, a.kind === 'target' ? 'ok' : 'acc', { ico: 'bell' })}${a.seen ? '' : chip('Nueva', 'warn', { size: 'md' })}<span class="muted" style="font-size:12px">${ago(a.at)}</span></div>
        <a href="#/p/${p.id}" class="ptitle" style="font-size:14px">${shortTitle(p.title, 70)}</a>
        <div class="muted" style="font-size:13px">${storeName(env, a.store)}: <span class="num">US$${n2(a.total)}</span> · ${a.detail}</div></div>
      <button class="btn btn-s btn-g" aria-label="Quitar alerta" data-act="alert-dismiss" data-alert="${a.id}">${icon('x')}</button></li>`;
  };
  return html`<div class="wrap">
    <nav aria-label="Ruta" class="crumbs"><a href="#/">${store.build().name}</a> / Alertas</nav>
    <div class="flex"><h1>Alertas</h1>${unseen.length ? html`<button class="btn btn-s" data-act="alerts-seen">Marcar ${unseen.length} como vistas</button>` : ''}<div class="grow"></div><a class="btn btn-s" href="#/ajustes/alertas">Cuándo avisar</a></div>
    <section class="card"><div class="card-h"><h2>Nuevas</h2>${chip(String(unseen.length), unseen.length ? 'warn' : '')}</div>
      <ul style="list-style:none;margin:0;padding:0" aria-live="polite">${unseen.map(item)}</ul>${!unseen.length ? html`<div class="empty-state">Sin alertas nuevas. Se crean al actualizar, cuando una tienda baja del objetivo, baja de precio o entra en oferta.</div>` : ''}</section>
    ${seen.length ? html`<section class="card"><div class="card-h"><h2>Vistas</h2></div><ul style="list-style:none;margin:0;padding:0">${seen.slice(0, 50).map(item)}</ul></section>` : ''}
    <section class="card"><div class="card-h"><h2>Productos con precio objetivo</h2>${chip(String(withTarget.length))}</div>
      <ul style="list-style:none;margin:0;padding:0">${withTarget.map((c) => { const p = st.products[c.productId]; return html`<li class="flex" style="padding:10px 20px;border-bottom:1px solid var(--line-2)"><a href="#/p/${p.id}" style="flex:1;min-width:0;color:var(--ink);text-decoration:none">${shortTitle(p.title, 70)}</a><span class="num">objetivo US$${n2(c.targetPrice)}</span></li>`; })}</ul>
      ${!withTarget.length ? html`<div class="empty-state">Pon un precio objetivo en la ficha de un producto (Alertas de precio).</div>` : ''}</section>
  </div>`;
}
