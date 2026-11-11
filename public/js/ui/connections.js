// @ts-check
// Conexiones por tienda: el estado real de la pestaña que lee cada canal (según la extensión) y las acciones
// Conectar · Verificar · Ver pestaña. Se usa en Actualizar y en Ajustes → Conector.
import { html } from './dom.js';
import { icon, chip, merchantLogo } from './components.js';
import { ago } from './format.js';
import { on, toast } from './ui.js';
import * as link from '../services/connector-link.js';

on('conn-connect', (el) => link.connectChannel(el.dataset.origin, { url: el.dataset.url || '' }));
on('conn-verify', (el) => link.verifyChannel(el.dataset.origin));
on('conn-focus', (el) => link.focusChannel(el.dataset.origin));
on('ext-reload', () => { link.reloadExtension(); toast('Recargando la extensión: las pestañas de las tiendas se reconectan solas.'); });

/** Comercio de un origen (por dominio). */
export function merchantOfOrigin(env, origin) {
  let host = '';
  try { host = new URL(origin).hostname; } catch { return null; }
  return Object.values(env.merchants || {}).find((m) => m.domain && (host === m.domain || host.endsWith(`.${m.domain}`))) || null;
}
const hostOf = (origin) => { try { return new URL(origin).hostname.replace(/^www\./, ''); } catch { return origin; } };

/** Estado visible de un canal: [tono del chip, ícono, texto, detalle, nivel ('ok'|'wait'|'err'|'')]. */
function describe(c, origin) {
  const isAmazon = origin === link.AMAZON_ORIGIN;
  const check = c.check || null;
  const work = [c.running ? `leyendo ${c.running}` : '', c.queued ? `${c.queued} en cola` : ''].filter(Boolean).join(' · ');
  switch (c.state) {
    case 'no-ext': return ['', 'info', 'Sin extensión', 'Instala la extensión en Ajustes → Conector para conectar y verificar cada tienda.', ''];
    case 'ext-off': return ['warn', 'clock', 'Reconectando', 'La extensión se está reconectando con el armador…', 'wait'];
    case 'none': return ['', 'info', 'Sin pestaña', work ? `${work}: pulsa «Conectar» (abre la tienda en segundo plano).` : 'Pulsa «Conectar»: abre la tienda en una pestaña en segundo plano.', ''];
    case 'opening': return ['acc', 'refresh', 'Abriendo…', 'Cargando la tienda en una pestaña en segundo plano.', 'wait'];
    case 'stuck': return ['err', 'err', 'No responde', 'La pestaña abrió pero el conector no contestó (¿página de error, inicio de sesión o verificación?). Mírala con «Ver pestaña».', 'err'];
    default: break;
  }
  const session = isAmazon ? `${c.loggedIn ? `Sesión de ${c.account || 'Amazon'}` : 'Sin sesión iniciada'} · entrega en ${c.deliverTo || '—'}` : '';
  const outdated = link.appConnectorVersion && c.version && c.version !== link.appConnectorVersion ? 'Conector anterior: pulsa «Recargar extensión». ' : '';
  if (check?.running) return ['acc', 'refresh', 'Verificando…', [session, work].filter(Boolean).join(' · '), 'wait'];
  if (c.blocked) return ['err', 'warn', 'Verificación pendiente', `${isAmazon ? 'Amazon' : hostOf(origin)} muestra un CAPTCHA o una verificación: resuélvela en su pestaña.`, 'err'];
  if (check && check.ok === false) return ['err', 'err', 'Requiere acción', `${outdated}${check.detail || 'La verificación falló.'} (${ago(check.at)})`, 'err'];
  const verified = check?.at ? `Verificada ${ago(check.at)}${check.status ? ` · HTTP ${check.status}` : ''}${check.ms != null ? ` · ${check.ms} ms` : ''}` : 'Sin verificar';
  const warn = isAmazon && c.loggedIn === false;
  return [outdated || warn ? 'warn' : 'ok', outdated || warn ? 'warn' : 'check', 'Conectada', `${outdated}${[session, verified, work].filter(Boolean).join(' · ')}`, outdated || warn ? 'wait' : 'ok'];
}

/**
 * Lista de conexiones.
 * @param {any} env
 * @param {{ origin: string, url?: string, label?: string }[]} items  canales a mostrar (origen y un enlace para abrir)
 */
export function connectionsList(env, items) {
  if (!items.length) return html`<p class="muted" style="margin:0;font-size:13px">Ninguna tienda para conectar todavía.</p>`;
  return html`<ul class="conn-list" role="list">${items.map(({ origin, url, label }) => {
    const c = link.channelStatus(origin);
    const m = merchantOfOrigin(env, origin);
    const [tone, ico, text, detail, level] = describe(c, origin);
    const ext = link.ext.present;
    const canFocus = ext && ['connected', 'opening', 'stuck'].includes(c.state);
    const canConnect = ext ? ['none', 'stuck'].includes(c.state) : c.state !== 'connected';
    const canVerify = ext && c.state === 'connected';
    return html`<li class="conn ${level}" data-key="conn-${origin}">
      ${merchantLogo(m, 'md')}
      <div class="conn-main">
        <div class="flex" style="gap:8px"><strong>${label || m?.name || hostOf(origin)}</strong><span class="muted" style="font-size:12px">${hostOf(origin)}</span>${chip(text, tone, { ico })}</div>
        <div class="conn-detail">${detail}</div>
      </div>
      <div class="actions">
        ${canConnect ? html`<button class="btn btn-s ${ext ? 'btn-p' : ''}" data-act="${ext ? 'conn-connect' : origin === link.AMAZON_ORIGIN ? 'open-amazon' : 'open-tab'}" data-origin="${origin}" data-url="${url || ''}">${ext ? 'Conectar' : 'Abrir'}</button>` : ''}
        ${canVerify ? html`<button class="btn btn-s" data-act="conn-verify" data-origin="${origin}"${c.check?.running ? ' disabled' : ''}>${icon('refresh')}Verificar</button>` : ''}
        ${canFocus ? html`<button class="btn btn-s btn-g" data-act="conn-focus" data-origin="${origin}">Ver pestaña ${icon('ext')}</button>` : ''}
      </div>
    </li>`;
  })}</ul>`;
}

/** Aviso del estado de la extensión (sin extensión, reconectando o conector anterior). */
export function extensionBanner() {
  if (!link.ext.present) return '';
  if (!link.ext.ready) return html`<div class="banner" role="status">${icon('clock')}<span>La extensión del conector se está reconectando…</span></div>`;
  if (link.outdated()) return html`<div class="banner" role="alert">${icon('warn')}<span style="flex:1"><strong>La extensión usa un conector anterior.</strong> Recárgala para usar el nuevo; las tiendas se reconectan solas.</span><button class="btn btn-s btn-p" data-act="ext-reload">Recargar extensión</button></div>`;
  return '';
}

/** Canales de todas las filas con enlace: un origen por tienda (todo amazon.com es uno). */
export function originsOfState(state, env) {
  const out = new Map();
  for (const p of Object.values(state.products || {})) {
    for (const o of p.offers || []) {
      const m = env.merchants?.[env.stores?.[o.store]?.merchant];
      if (!m || m.readMode === 'manual') continue;
      if (m.readMode === 'amazon') { if (!out.has(link.AMAZON_ORIGIN)) out.set(link.AMAZON_ORIGIN, { origin: link.AMAZON_ORIGIN, url: '' }); continue; }
      try { const origin = new URL(o.url).origin; if (!out.has(origin)) out.set(origin, { origin, url: o.url }); } catch { /* sin enlace */ }
    }
  }
  for (const origin of link.knownChannels()) if (!out.has(origin)) out.set(origin, { origin, url: '' });
  return [...out.values()].sort((a, b) => Number(b.origin === link.AMAZON_ORIGIN) - Number(a.origin === link.AMAZON_ORIGIN) || a.origin.localeCompare(b.origin));
}
