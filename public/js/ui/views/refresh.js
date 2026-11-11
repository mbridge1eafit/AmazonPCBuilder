// @ts-check
// Centro de actualización (R7): totales, una tarjeta por tienda con lo que falta y la acción que lo destraba,
// qué cambió y el mismo estado en los tres niveles. Las pestañas solo se abren con un clic del usuario.
import { html, raw } from '../dom.js';
import { icon, chip, storeName, destShort, merchantLogo } from '../components.js';
import { n2, ago } from '../format.js';
import * as store from '../../state/store.js';
import * as refresh from '../../services/refresh.js';
import * as link from '../../services/connector-link.js';
import { planRefresh } from '../../domain/refresh-plan.js';
import { shortTitle } from '../../domain/checks.js';
import { connectionsList, extensionBanner } from '../connections.js';

const TONE = { done: ['c-ok', 'check', 'Listo', 'var(--ok-strong)', ''], running: ['c-acc', 'refresh', 'En curso', 'var(--acc)', ''], waiting: ['c-warn', 'clock', 'En espera', 'var(--warn-strong)', 'wait'], error: ['c-err', 'err', 'Error', 'var(--err)', 'err'] };

export function refreshView() {
  const st = store.get();
  const env = store.env();
  const b = store.build();
  const run = refresh.run;
  const s = refresh.summary();
  const plan = planRefresh(st, env, { kind: 'build' });
  // Tarjetas por canal.
  const groups = new Map();
  for (const j of run.jobs) (groups.get(j.channel) || groups.set(j.channel, []).get(j.channel)).push(j);
  const cards = [...groups.entries()].map(([ch, js]) => {
    const n = (x) => js.filter((j) => j.state === x).length;
    const state = n('running') ? 'running' : n('waiting') ? 'waiting' : n('error') ? 'error' : 'done';
    const storeKey = js[0].store;
    const stObj = env.stores[storeKey];
    const merchant = env.merchants[stObj?.merchant];
    const origin = ch.startsWith('tab:') ? ch.slice(4) : null;
    const reason = n('waiting') ? refresh.waitReason(ch) : null;
    const err = js.find((j) => j.state === 'error')?.error;
    const done = n('done');
    const name = ch.startsWith('amazon') ? stObj?.name : `${merchant?.name || stObj?.name}${origin && !origin.includes(merchant?.domain || '§') ? '' : ''}`;
    const msg = reason ? reason.text : state === 'running' ? `Leyendo con la pestaña abierta… deja ${name} abierto.` : err ? `${err}${/CAPTCHA|verific/i.test(err) ? '' : ''} Se conserva el último precio.` : ch.startsWith('amazon') ? `Sesión ${link.amazon.loggedIn ? 'iniciada' : 'sin iniciar'} · entrega en ${link.amazon.deliverTo || '—'}.` : `${done} leídas.`;
    const tone = TONE[state];
    const actionBtn = reason ? (!reason.action ? '' : origin ? html`<button class="btn btn-s btn-p" data-act="open-tab" data-origin="${origin}" data-url="${js.find((j) => j.state === 'waiting')?.url}">${link.ext.present ? reason.action : `Abrir ${merchant?.name || ''}`} ${icon('ext')}</button>` : html`<button class="btn btn-s btn-p" data-act="open-amazon">${reason.action} ${icon('ext')}</button>`)
      : n('error') && /CAPTCHA|verific/i.test(err || '') ? (origin ? html`<button class="btn btn-s btn-p" data-act="open-tab" data-origin="${origin}" data-url="${js[0].url}">Ir a ${merchant?.name} ${icon('ext')}</button>` : html`<button class="btn btn-s btn-p" data-act="open-amazon">Ir a Amazon ${icon('ext')}</button>`) : '';
    return html`<article class="card storecard ${tone[4]}" data-key="card-${ch}">
      ${merchantLogo(merchant, 'lg')}
      <div style="flex:1 1 260px;min-width:0">
        <div class="flex" style="gap:8px"><strong>${name}</strong><span class="muted" style="font-size:12px;display:inline-flex;align-items:center;gap:3px">${icon('pin', 'i', 'width:13px;height:13px')}${destShort(env, stObj?.destination)}${stObj?.currency === 'COP' ? ' · COP' : ''}</span><span class="chip ${tone[0]}">${icon(tone[1])}${tone[2]}</span></div>
        <div style="font-size:13px;margin-top:4px">${msg}</div></div>
      <div style="width:150px"><div class="num r" style="font-size:13px;font-weight:600">${done} / ${js.length}</div>
        <div class="bar" style="margin-top:4px"><div style="width:${Math.round((done / js.length) * 100)}%;background:${tone[3]}"></div></div></div>
      <div class="actions" style="width:260px">${actionBtn}${n('error') ? html`<button class="btn btn-s" data-act="refresh-retry" data-channel="${ch}">${icon('refresh')}Reintentar</button>` : ''}</div>
    </article>`;
  });
  const order = { waiting: 0, error: 1, running: 2, done: 3 };
  const changes = run.changes.slice().reverse();
  const down = changes.filter((x) => x.after.total != null && x.before.total != null && x.after.total < x.before.total).length;
  const up = changes.filter((x) => x.after.total != null && x.before.total != null && x.after.total > x.before.total).length;
  const recentAlerts = st.alertEvents.filter((a) => Date.parse(a.at) >= run.startedAt);
  const pct = (x) => (s.total ? x : 0);
  // Conexiones de los canales de esta actualización (o de lo que se actualizaría).
  const conn = new Map();
  for (const j of run.jobs.length ? run.jobs : plan.jobs) {
    const origin = refresh.originOf(j.channel);
    if (!conn.has(origin)) conn.set(origin, { origin, url: j.channel.startsWith('amazon') ? '' : j.url });
  }
  return html`<div class="wrap">
    <nav aria-label="Ruta" class="crumbs"><a href="#/">${b.name}</a> / Actualizar</nav>
    <section class="card pad stack" style="gap:14px" aria-labelledby="h-u">
      <div class="flex" style="gap:12px"><h1 id="h-u" style="font-size:22px">${run.active ? 'Actualizando el armado' : s.total ? 'Actualización terminada' : 'Actualizar el armado'}</h1>
        ${chip(`${s.total || plan.jobs.length} filas producto × tienda · lo de más estrellas primero`)}
        <div class="grow"></div>
        ${run.active ? html`<button class="btn" data-act="refresh-cancel">Cancelar lo pendiente</button><a class="btn" href="#/">Seguir en segundo plano</a>` : html`<button class="btn btn-p" data-act="refresh-build"${raw(plan.jobs.length ? '' : ' disabled title="Todo se leyó hoy"')}>${icon('refresh')}${plan.jobs.length ? `Actualizar ${plan.jobs.length} fila${plan.jobs.length === 1 ? '' : 's'}` : 'Todo leído hoy'}</button><button class="btn" data-act="refresh-build" data-force="1" title="Releer todas las filas, aunque ya se hayan leído hoy">${icon('refresh')}Forzar actualización</button>`}</div>
      <div role="status" aria-live="polite" class="flex" style="gap:8px 20px;font-size:13px">
        <span><strong class="num">${s.done}</strong> listas</span><span><strong class="num">${s.running}</strong> en curso</span><span><strong class="num">${s.waiting}</strong> en espera de una acción</span><span><strong class="num">${s.error}</strong> con error</span>
        ${run.skipped || plan.skipped.length ? html`<span class="muted">· ${run.skipped || plan.skipped.length} omitidas: ya leídas hoy</span>` : ''}${run.manual ? html`<span class="muted">· ${run.manual} escritas a mano</span>` : ''}</div>
      ${s.total ? html`<div class="progress" role="img" aria-label="${s.done} listas, ${s.running} en curso, ${s.waiting} en espera, ${s.error} con error de ${s.total}">
        <div class="p-done" style="flex:${pct(s.done)}"></div><div class="p-run" style="flex:${pct(s.running)}"></div><div class="p-wait" style="flex:${pct(s.waiting + s.cancelled)}"></div><div class="p-err" style="flex:${pct(s.error)}"></div></div>` : ''}
    </section>
    ${extensionBanner()}
    <section class="card pad stack" style="gap:10px" aria-labelledby="h-conn">
      <div class="row" style="align-items:center"><h2 id="h-conn">Conexiones</h2><span class="muted" style="font-size:12px">${link.ext.present ? 'Estado real de la pestaña que lee cada tienda. «Verificar» la prueba con tu sesión.' : html`Con el marcador no hay verificación. <a href="#/ajustes/conector">Instala la extensión</a> para conectar y verificar cada tienda.`}</span></div>
      ${connectionsList(env, [...conn.values()])}
    </section>
    <div class="layout" style="gap:20px">
      <section style="flex:999 1 640px;min-width:0;display:flex;flex-direction:column;gap:10px" aria-labelledby="h-s">
        <h2 id="h-s">Por tienda: qué falta y qué hacer</h2>
        ${cards.length ? cards.sort((a, z) => 0) : html`<div class="card empty-state">${plan.jobs.length ? `Hay ${plan.jobs.length} filas para leer. Pulsa «Actualizar» (abre Amazon si hace falta).` : 'Todo al día.'}</div>`}
        <p class="muted" style="font-size:12px;margin:4px 0 0">${link.ext.present ? 'Con la extensión, cada tienda se abre sola en segundo plano y se reconecta si recargas su pestaña o el armador; si la cierras, lo pendiente espera a que la conectes de nuevo.' : 'Las pestañas solo se abren con tu clic. Cada tienda necesita su pestaña abierta y el marcador pulsado; si la cierras, lo enviado vuelve a «en espera».'} Amazon lee un destino a la vez: cambia «Entregar en» dentro de Amazon para leer el otro.</p>
      </section>
      <aside style="flex:1 1 380px;max-width:460px;min-width:0;display:flex;flex-direction:column;gap:16px">
        <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px" aria-labelledby="h-c">
          <div class="row" style="align-items:center"><h2 id="h-c">Qué cambió</h2><span class="muted num" style="font-size:12px">${changes.length} de ${s.done}</span></div>
          <div class="flex">${down ? chip(`${down} bajaron`, 'ok') : ''}${up ? chip(`${up} subieron`, 'err') : ''}${recentAlerts.length ? chip(`${recentAlerts.length} alerta${recentAlerts.length > 1 ? 's' : ''}`, 'acc', { ico: 'bell' }) : ''}</div>
          ${changes.slice(0, 30).map((x) => { const d = x.after.total != null && x.before.total != null ? x.after.total - x.before.total : null; const alert = recentAlerts.find((a) => a.offerId === x.offerId); return html`<div style="border-top:1px solid var(--line-2);padding-top:10px;display:flex;flex-direction:column;gap:2px">
            <div class="row"><a href="#/p/${x.productId}" style="font-weight:600;color:var(--ink);text-decoration:none;font-size:13px">${shortTitle(x.title, 44)}</a><span class="num" style="font-weight:600;font-size:13px;white-space:nowrap;color:${d == null ? 'var(--muted)' : d < 0 ? 'var(--ok)' : 'var(--err)'}">${d == null ? 'nuevo' : `${d < 0 ? '▼' : '▲'} ${n2(Math.abs(d))}${x.before.total ? ` · ${d < 0 ? '−' : '+'}${Math.round(Math.abs(d / x.before.total) * 100)} %` : ''}`}</span></div>
            <div class="muted num" style="font-size:12px">${storeName(env, x.store)} · total ${n2(x.before.total)} → ${n2(x.after.total)}</div>
            ${alert ? html`<div style="font-size:12px;color:var(--ok);font-weight:600">${alert.detail}</div>` : ''}</div>`; })}
          ${!changes.length ? html`<p class="muted" style="margin:0;font-size:13px">${s.done ? 'Ningún precio cambió.' : 'Aquí aparecen los cambios al llegar cada lectura.'}</p>` : ''}
          ${run.kept.length ? html`<div style="border-top:1px solid var(--line-2);padding-top:10px;font-size:12px" class="muted">${run.kept.length} con ediciones a mano conservadas: ${run.kept.slice(0, 4).join(' · ')}.</div>` : ''}
        </section>
        <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px" aria-labelledby="h-l">
          <h2 id="h-l" style="font-size:14px">El mismo estado en los tres niveles</h2>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
            <div class="flex"><span class="lbl" style="width:72px">Fila</span>${chip('Leyendo…', 'acc', { ico: 'refresh' })}<span class="muted">en la tabla de tiendas del producto</span></div>
            <div class="flex"><span class="lbl" style="width:72px">Producto</span>${chip('4/6 · 1 en espera', '', { ico: 'clock' })}<span class="muted">en su tarjeta y su ficha</span></div>
            <div class="flex"><span class="lbl" style="width:72px">Armado</span><span class="chip c-acc num">Actualizando ${s.done}/${s.total}</span><span class="muted">botón superior</span></div>
          </div></section>
      </aside>
    </div></div>`;
}
