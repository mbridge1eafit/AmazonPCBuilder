// @ts-check
// Barra superior (armado, estado de conexión, actualizar, alertas, ajustes, más acciones) y navegación inferior en el celular.
import { html, raw } from '../dom.js';
import { icon } from '../components.js';
import { ui } from '../ui.js';
import * as store from '../../state/store.js';
import * as link from '../../services/connector-link.js';
import * as refresh from '../../services/refresh.js';
import { planRefresh } from '../../domain/refresh-plan.js';

export function header(route) {
  const st = store.get();
  const b = store.build();
  const am = link.amazon;
  const alive = link.amazonAlive();
  const amazonLabel = alive ? html`<span class="dot" style="background:var(--dot-ok)"></span>Amazon · entrega <strong style="font-weight:600">${am.region === 'co' ? 'Medellín' : am.region === 'us' ? 'Miami' : am.deliverTo || '¿?'}</strong><span class="muted hide-m">· conectado</span>`
    : html`<span class="dot" style="background:var(--line-strong)"></span>Conectar Amazon`;
  const plan = planRefresh(st, store.env(), { kind: 'build' });
  const tabsOn = [...link.tabs.values()].filter((t) => t.connected && t.win && !t.win.closed).length;
  const channels = new Set(plan.jobs.filter((j) => j.channel.startsWith('tab:')).map((j) => j.channel));
  const sum = refresh.summary();
  const unseen = st.alertEvents.filter((a) => !a.seen).length;
  const saveTxt = { saving: 'Guardando…', error: `No se pudo guardar: ${store.status.error}`, conflict: 'Conflicto al guardar' }[store.status.save] || '';
  return html`<header class="top"><div class="wrap">
    <a class="brand hide-m" href="#/"><span class="brand-mark">${icon('cpu', 'ico')}</span><span class="hide-m">Armador PC</span></a>
    <div class="menu">
      <button class="btn" style="font-weight:600" aria-haspopup="menu" aria-expanded="${ui.menu === 'builds'}" data-act="menu" data-menu="builds">${b.name} ${icon('down')}</button>
      ${ui.menu === 'builds' ? html`<div class="menu-pop" role="menu">
        ${st.builds.map((x) => html`<button role="menuitemradio" aria-checked="${x.id === b.id}" class="${x.id === b.id ? 'on' : ''}" data-act="build-switch" data-build="${x.id}">${x.id === b.id ? icon('check') : raw('<span style="width:16px"></span>')}${x.name}</button>`)}
        <hr><button role="menuitem" data-act="build-new">${icon('plus')}Nuevo armado</button><button role="menuitem" data-act="build-duplicate">${icon('copy')}Duplicar</button><button role="menuitem" data-act="build-rename">${icon('pencil')}Renombrar</button><button role="menuitem" data-act="build-delete">${icon('trash')}Eliminar</button>
      </div>` : ''}
    </div>
    <div class="flex" role="status" aria-label="Estado de conexión">
      <button class="btn pill-btn" data-act="open-amazon" title="${alive ? `Sesión ${am.loggedIn ? 'iniciada' : 'sin iniciar'} · entrega: ${am.deliverTo}` : 'Abre Amazon y pulsa ahí el marcador'}">${amazonLabel}</button>
      <a class="btn pill-btn hide-m" href="#/actualizar"><span class="dot sq" style="background:${channels.size && tabsOn < channels.size ? 'var(--warn-strong)' : 'var(--dot-ok)'}"></span>Tiendas ${tabsOn} de ${channels.size}${sum.waiting ? html`<span class="muted">· ${sum.waiting} en espera</span>` : ''}</a>
      ${link.outdated() ? html`<a class="chip c-warn lg" href="#/ajustes/conector">${icon('warn')}Marcador desactualizado</a>` : ''}
    </div>
    <div class="grow"></div>
    ${saveTxt ? html`<span class="save-state ${store.status.save === 'error' || store.status.save === 'conflict' ? 'lv-error' : 'muted'}" role="status">${saveTxt}</span>` : ''}
    <button class="btn btn-p hide-m" data-act="refresh-build">${icon('refresh')}<span class="hide-m">${sum.total && refresh.run.active ? `Actualizando ${sum.done}/${sum.total}` : 'Actualizar armado'}</span><span class="count">${plan.jobs.length}</span></button>
    <a class="btn hide-m" href="#/alertas" aria-label="Alertas${unseen ? `, ${unseen} nuevas` : ''}">${icon('bell')}${unseen ? html`<span class="badge">${unseen}</span>` : ''}</a>
    <a class="btn hide-m" href="#/ajustes" aria-label="Ajustes">${icon('gear')}</a>
    <div class="menu">
      <button class="btn btn-g" aria-label="Más acciones del armado" aria-haspopup="menu" data-act="menu" data-menu="more">${icon('dots')}</button>
      ${ui.menu === 'more' ? html`<div class="menu-pop right" role="menu">
        <a role="menuitem" href="#/ajustes">${icon('gear')}Ajustes</a>
        <button role="menuitem" data-act="paid">${icon('receipt')}Precio pagado</button>
        <button role="menuitem" data-act="copy-markdown">${icon('copy')}Copiar como Markdown</button>
        <button role="menuitem" data-act="export-json">Exportar JSON</button><button role="menuitem" data-act="import-json">Importar JSON (V1 o V2)</button>
        <hr><a role="menuitem" href="#/ajustes/conector">Instalar el conector</a>
      </div>` : ''}
    </div>
  </div></header>
  ${store.status.save === 'conflict' ? html`<div class="wrap" style="padding-bottom:0"><div class="banner" role="alert">${icon('warn')}<span style="flex:1">Otro dispositivo guardó cambios mientras editabas aquí.</span><button class="btn btn-s" data-act="conflict-theirs">Usar lo del otro dispositivo</button><button class="btn btn-s btn-p" data-act="conflict-mine">Guardar lo de aquí</button></div></div>` : ''}`;
}

export function bottomNav(route) {
  const unseen = store.get().alertEvents.filter((a) => !a.seen).length;
  const cur = (n) => (route.name === n ? raw(' aria-current="page"') : '');
  const lastCat = route.cat || 'storage';
  return html`<nav class="bottom-nav" aria-label="Principal">
    <a href="#/"${cur('build')}>${icon('home')}Armado</a>
    <a href="#/c/${lastCat}"${cur('options')}>${icon('list')}Opciones</a>
    <a href="#/actualizar"${cur('refresh')}>${icon('refresh')}Actualizar</a>
    <a href="#/alertas"${cur('alerts')}>${icon('bell')}Alertas${unseen ? ` · ${unseen}` : ''}</a>
  </nav>`;
}
