// @ts-check
// Piezas de interfaz compartidas por las vistas. Todas devuelven HTML (con escape) para el morph.
import { html, raw, attr } from './dom.js';
import { CAT, DECISIONS, decisionLevel, STATUS } from '../domain/categories.js';
import { n2, usd, cop, ago, TAX_SOURCE, copRaw } from './format.js';
import { salesRate } from '../domain/tax.js';

export const icon = (name, cls = 'i', style = '') => html`<svg class="${cls}" aria-hidden="true"${raw(style ? ` style="${style}"` : '')}><use href="#i-${name}"></use></svg>`;

const CHIP = { ok: 'c-ok', warn: 'c-warn', err: 'c-err', acc: 'c-acc', line: 'c-line', dash: 'c-dash', '': '' };
export const chip = (text, tone = '', { ico = '', size = '', title = '' } = {}) =>
  html`<span class="chip ${CHIP[tone] ?? tone} ${size}"${raw(title ? ` title="${String(title).replace(/"/g, '&quot;')}"` : '')}>${ico ? icon(ico) : ''}${text}</span>`;

/** Estrellas de solo lectura. */
export const starsView = (n, size = 'sm') => html`<span class="stars" aria-label="Decisión: ${DECISIONS[decisionLevel(n)].label}">${[0, 1, 2].map((i) => html`<svg class="star ${size} ${i < n ? 'on' : 'off'}" aria-hidden="true"><use href="#i-star"></use></svg>`)}</span>`;

/** Selector de estrellas: un clic marca; la misma estrella vuelve a 0. */
export function starPicker(cand) {
  const n = decisionLevel(cand.decision);
  return html`<div class="stars" role="group" aria-label="Decisión: ${DECISIONS[n].label}">
    ${[1, 2, 3].map((lvl) => html`<button class="st" data-act="decide" data-cand="${cand.id}" data-level="${lvl}" aria-pressed="${lvl <= n}" aria-label="${lvl} estrella${lvl > 1 ? 's' : ''}, ${DECISIONS[lvl].label}" title="${DECISIONS[lvl].hint}"><svg class="star ${lvl <= n ? 'on' : 'off'}" aria-hidden="true"><use href="#i-star"></use></svg></button>`)}
    <span style="font-size:13px;font-weight:600;margin-left:4px">${DECISIONS[n].label}</span></div>`;
}

/** Segmentos con aria-pressed. */
export const seg = (label, options, value, act, extra = '', cls = '') => html`<div class="seg ${cls}" role="group" aria-label="${label}">${options.map(([v, t]) => html`<button type="button" data-act="${act}" data-value="${v}"${raw(extra)} aria-pressed="${String(v) === String(value)}">${t}</button>`)}</div>`;

export function thumb(product, size = '') {
  const cat = CAT[product?.category];
  return product?.image
    ? html`<div class="thumb ${size}"><img src="${product.image}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`
    : html`<div class="thumb ${size}" role="img" aria-label="Sin foto: ícono de ${cat?.name || 'producto'}">${icon(cat?.icon || 'periph')}</div>`;
}

export const statusChip = (s) => (s === 'bought' ? chip(STATUS.bought.label, 'ok') : s === 'planned' ? chip(STATUS.planned.label, 'dash') : chip(STATUS.buy.label, 'acc'));

export const storeName = (env, key) => env.stores[key]?.name || key;

// Íconos oficiales (favicon de cada sitio) en public/img/stores/. Comercio sin ícono → monograma.
const LOGOS = { amazon: 'amazon.png', newegg: 'newegg.jpg', bestbuy: 'bestbuy.png', walmart: 'walmart.png', target: 'target.png', bhphoto: 'bhphoto.png', microcenter: 'microcenter.png', mercadolibre: 'mercadolibre.png' };
export const merchantOfStore = (env, key) => env.merchants?.[env.stores[key]?.merchant] || null;
/** Ícono de un comercio (decorativo: siempre va junto al nombre o a un aria-label). */
export const merchantLogo = (m, size = '') => (m && LOGOS[m.key]
  ? html`<img class="slogo ${size}" src="img/stores/${LOGOS[m.key]}" alt="" aria-hidden="true" loading="lazy" decoding="async">`
  : html`<span class="slogo mono ${size}" aria-hidden="true">${String(m?.mono || 'TDA').slice(0, 3)}</span>`);
export const storeLogo = (env, key, size = '') => merchantLogo(merchantOfStore(env, key), size);
/** Ícono + nombre de la tienda. */
export const storeLabel = (env, key, size = '') => html`<span class="store-lbl">${storeLogo(env, key, size)}${storeName(env, key)}</span>`;

/** Enlace a la ficha de Amazon del producto: la fila de Amazon con URL o, si no, /dp/ASIN. */
export function amazonUrl(product, env) {
  const o = (product?.offers || []).find((x) => env.stores[x.store]?.merchant === 'amazon' && x.url);
  return o?.url || (product?.ids?.asin ? `https://www.amazon.com/dp/${product.ids.asin}` : null);
}
/** Botón visible «Ver en Amazon» (abre pestaña nueva). */
export const amazonLink = (url, { label = 'Ver en Amazon', size = '' } = {}) => (url
  ? html`<a class="btn btn-amz ${size}" href="${url}" target="_blank" rel="noopener noreferrer" title="Abrir la ficha en amazon.com (pestaña nueva)">${merchantLogo({ key: 'amazon' })}${label}${icon('ext')}</a>`
  : '');
export const destShort = (env, d) => env.settings.destinations?.[d]?.short || d;

/** Lectura de una fila: leído hace X / escrito a mano / viejo / error / en espera. */
export function readChip(offer, env, jobState = null) {
  if (jobState?.state === 'running') return chip('Leyendo…', 'acc', { ico: 'refresh', size: 'md' });
  if (jobState?.state === 'waiting') return chip('En espera', '', { ico: 'clock', size: 'md' });
  if (offer.readStatus === 'error') return chip(`Error ${ago(offer.errorAt || offer.fetchedAt)}`.trim(), 'err', { ico: 'err', size: 'md', title: offer.readError || '' });
  if (!offer.fetchedAt) return offer.price != null ? chip('Escrito a mano', '', { ico: 'pencil', size: 'md' }) : chip('Sin leer', 'line', { size: 'md' });
  const old = Date.now() - Date.parse(offer.fetchedAt) > (env.settings.staleDays || 3) * 864e5;
  return chip(`${ago(offer.fetchedAt)}${old ? ' · viejo' : ''}`, old ? 'warn' : 'ok', { ico: old ? 'clock' : 'check', size: 'md' });
}

/** «estimado 7 %», «según la tienda», «exento < US$200»… */
export function taxNote(cost, env) {
  if (!cost || cost.tax == null) return cost?.missing?.includes('tasa de sales tax') ? 'falta la tasa' : 'sin dato';
  if (cost.taxSource === 'estimated' && cost.dest !== 'co') return `estimado ${String(Math.round((salesRate(cost.dest, env.settings) || 0) * 1000) / 10).replace('.', ',')} %`;
  if (cost.taxSource === 'exempt') return `exento < US$${env.settings.taxRules.find((r) => r.id === 'co-exempt')?.threshold ?? 200}`;
  if (cost.taxSource === 'estimated') return 'estimado IVA 19 %';
  return TAX_SOURCE[cost.taxSource] || '';
}

/** Monto con su equivalente: US$ con COP, o COP con US$. */
export function moneyPair(cost, env) {
  const trm = env.settings.fx.trm;
  if (cost?.total == null) return 'sin dato';
  return cost.original ? `${copRaw(cost.original.total)} ≈ ${usd(cost.total)}` : `≈ ${cop(cost.total, trm)}`;
}

export function partialMark(cost) {
  return cost?.partial ? html`<span style="color:var(--warn)" aria-label="parcial" title="Falta: ${cost.missing.join(', ')}">*</span>` : '';
}

/** Desglose de un total en destino (y, si aplica, puesto en Colombia). */
export function breakdown(cost, env, product) {
  if (!cost) return '';
  const st = env.stores[cost.store];
  const destName = destShort(env, cost.dest);
  const rule = (id) => env.settings.taxRules.find((r) => r.id === id);
  const lc = cost.landedCO;
  return html`<div style="display:flex;flex-wrap:wrap;gap:28px">
    <div style="flex:1 1 280px">
      <div class="lbl" style="margin-bottom:6px">Total en ${destName}</div>
      <div class="kv"><span>Precio × ${cost.qty}</span><span class="num">${n2(cost.subtotal)}</span></div>
      <div class="kv"><span>Envío a ${destName} <span class="src">${cost.shipping == null ? 'sin dato' : cost.shipping === 0 ? 'gratis' : 'según la tienda'}</span></span><span class="num">${cost.shipping == null ? '—' : n2(cost.shipping)}</span></div>
      <div class="kv"><span>${cost.dest === 'co' ? 'Cargos de importación' : 'Sales tax'} <span class="src">${taxNote(cost, env)}${cost.taxRule ? ` · regla «${rule(cost.taxRule)?.label}» (${rule(cost.taxRule)?.source})` : ''}</span></span><span class="num">${cost.tax == null ? '—' : n2(cost.tax)}</span></div>
      <div class="kv total"><span>Total en destino${partialMark(cost)}</span><span class="num">${n2(cost.total)}</span></div>
      <div class="src" style="margin-top:4px">${moneyPair(cost, env)} · TRM ${env.settings.fx.trm.toLocaleString('es-CO')} (${env.settings.fx.date})${cost.partial ? ` · parcial: falta ${cost.missing.join(', ')}` : ''}</div>
      ${cost.shown ? html`<div class="src">Amazon mostró ${copRaw(cost.shown.total)} (convertido con TRM ${cost.shown.rate})</div>` : ''}
    </div>
    ${lc && !lc.inCO ? html`<div style="flex:1 1 280px">
      <div class="lbl" style="margin-bottom:6px">Puesto en Colombia (referencia)</div>
      <div class="kv"><span>Total en ${destName}</span><span class="num">${n2(cost.total)}</span></div>
      <div class="kv"><span>Casillero ${lc.units == null ? 'sin peso' : `${String(Math.round(lc.units * 10) / 10).replace('.', ',')} ${lc.unit}`} × US$${n2(lc.rate)} <span class="src">${lc.minApplied ? 'aplica mínimo' : ''}</span></span><span class="num">${n2(lc.freight)}</span></div>
      <div class="kv"><span>Impuesto de entrada <span class="src">${lc.entryTax ? 'IVA sobre valor + flete' : `no aplica: < US$${rule('co-exempt')?.threshold} · ${rule('co-exempt')?.source}`}</span></span><span class="num">${n2(lc.entryTax)}</span></div>
      <div class="kv total"><span>Puesto en Colombia${lc.partial ? html`<span style="color:var(--warn)">*</span>` : ''}</span><span class="num">${n2(lc.total)}</span></div>
      <div class="src" style="margin-top:4px">${product?.weightLb == null ? 'Falta el peso del producto (Datos para cálculos)' : product?.edited?.weightLb ? 'Peso escrito a mano' : 'Peso de la ficha'} · casillero ${lc.days} días</div>
    </div>` : ''}
  </div>`;
}

/**
 * Acordeón de las tiendas que venden un producto, con el total en el destino de cada una (Medellín o Miami).
 * Agrupa por destino (los totales de destinos distintos no se comparan) y marca la más baja de cada uno.
 * `<details>` nativo: el morph conserva si está abierto entre re-renders.
 * @param {any} env @param {any[]} rows filas de offerRows/purchaseRow @param {{ selectedId?: string|null, body?: any }} [o]
 */
export function storesAccordion(env, rows, { selectedId = null, body = null } = {}) {
  if (!rows.length) return '';
  const dests = Object.keys(env.settings.destinations || {});
  const di = (d) => { const i = dests.indexOf(d); return i < 0 ? 99 : i; };
  const sorted = rows.slice().sort((a, b) => di(a.cost.dest) - di(b.cost.dest) || (a.cost.total ?? Infinity) - (b.cost.total ?? Infinity));
  const best = new Map(); // destino → fila más barata
  const priced = new Map(); // destino → cuántas con precio
  for (const r of sorted) if (r.cost.total != null) {
    if (!best.has(r.cost.dest)) best.set(r.cost.dest, r);
    priced.set(r.cost.dest, (priced.get(r.cost.dest) || 0) + 1);
  }
  const byDest = [...best.values()].map((r) => `${usd(r.cost.total)} ${destShort(env, r.cost.dest)}`).join(' · ');
  const n = rows.length;
  return html`<details class="stores">
    <summary>${icon('down', 'i chev')}${n} tienda${n === 1 ? '' : 's'}${byDest ? html`<span class="muted num" style="font-weight:400">· desde ${byDest}</span>` : ''}</summary>
    ${body || html`<ul class="stores-list">${sorted.map((r) => html`<li${raw(r.offer.id === selectedId ? ' class="sel"' : '')}>
      <span style="min-width:0">${storeLabel(env, r.offer.store)}${best.get(r.cost.dest) === r && priced.get(r.cost.dest) > 1 ? html` ${chip('Más bajo', 'ok', { size: 'sm' })}` : ''}${r.offer.id === selectedId ? html` ${chip('Elegida', 'acc', { size: 'sm' })}` : ''}</span>
      <span class="muted" style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap">${icon('pin', 'i', 'width:13px;height:13px')}${destShort(env, r.cost.dest)}</span>
      <span class="num r" style="white-space:nowrap">${r.cost.total == null ? html`<span class="muted">sin precio</span>` : html`<strong>${usd(r.cost.total)}</strong>${partialMark(r.cost)}`}${r.cost.original ? html`<br><span class="muted" style="font-size:11px">${copRaw(r.cost.original.total)}</span>` : ''}</span>
    </li>`)}</ul>`}
  </details>`;
}

export const empty = (text, action = '') => html`<div class="empty-state">${text}${action ? html`<div style="margin-top:12px">${raw(String(action))}</div>` : ''}</div>`;
export { attr };
