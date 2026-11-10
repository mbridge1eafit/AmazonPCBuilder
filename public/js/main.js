// @ts-check
// Arranque: carga el estado, enruta, repinta con morph y delega los eventos de la interfaz.
import * as store from './state/store.js';
import { applyTheme } from './state/prefs.js';
import * as link from './services/connector-link.js';
import * as refresh from './services/refresh.js';
import * as api from './services/api.js';
import { morph, html } from './ui/dom.js';
import { ui, ACTIONS, SUBMITS, CHANGES, INPUTS, on, onChange, rerender, setRenderer, refreshDialog, toast } from './ui/ui.js';
import { parseRoute } from './ui/router.js';
import './ui/actions.js';
import './ui/guides.js';
import { header, bottomNav } from './ui/views/shell.js';
import { buildView } from './ui/views/build.js';
import { optionsView } from './ui/views/options.js';
import { productView } from './ui/views/product.js';
import { compareView } from './ui/views/compare.js';
import { refreshView } from './ui/views/refresh.js';
import { settingsView } from './ui/views/settings.js';
import { alertsView } from './ui/views/alerts.js';
import { attachChartHover } from './ui/price-chart.js';

const app = /** @type {HTMLElement} */ (document.getElementById('app'));
let lastRoute = '';

function view(route) {
  switch (route.name) {
    case 'options': return optionsView(route.cat);
    case 'product': return productView(route.id);
    case 'compare': return compareView(route.cat);
    case 'refresh': return refreshView();
    case 'settings': return settingsView(route.section);
    case 'alerts': return alertsView();
    default: return buildView();
  }
}

function render() {
  if (!store.get()) return;
  const route = parseRoute();
  const key = location.hash;
  try {
    morph(app, html`${header(route)}<div id="view" data-key="view-${route.name}-${route.cat || route.id || ''}">${view(route)}</div>${bottomNav(route)}`);
  } catch (e) {
    console.error(e);
    morph(app, html`${header(route)}<div class="wrap"><div class="card pad" role="alert"><strong>Algo falló al mostrar esta vista.</strong><p class="muted">${e.message}</p><a class="btn" href="#/">Volver al armado</a></div></div>`);
  }
  refreshDialog();
  if (key !== lastRoute) {
    lastRoute = key;
    if (route.name === 'settings') document.getElementById(route.section)?.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
    document.title = { build: 'Armador PC', options: 'Opciones · Armador PC', product: 'Producto · Armador PC', compare: 'Comparar · Armador PC', refresh: 'Actualizar · Armador PC', settings: 'Ajustes · Armador PC', alerts: 'Alertas · Armador PC' }[route.name];
  }
}
setRenderer(render);

// ---------- eventos delegados ----------
document.addEventListener('click', (e) => {
  const el = /** @type {HTMLElement|null} */ ((/** @type {Element} */ (e.target)).closest('[data-act]'));
  if (!el || el.hasAttribute('disabled')) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A' && el.dataset.act !== 'bookmarklet-click' && el.getAttribute('href')?.startsWith('#') && el.dataset.act === 'scroll-to') e.preventDefault();
  Promise.resolve(fn(el, e)).catch((err) => { console.error(err); toast(err.message, { error: true }); });
});
document.addEventListener('submit', (e) => {
  const form = /** @type {HTMLFormElement} */ (e.target);
  const fn = SUBMITS[form.dataset.submit || ''];
  if (!fn) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  Promise.resolve(fn(form, data)).catch((err) => { console.error(err); toast(err.message, { error: true }); });
});
document.addEventListener('change', (e) => {
  const el = /** @type {HTMLInputElement} */ (e.target);
  const fn = CHANGES[el.dataset?.change || ''];
  if (fn) fn(el, e);
});
let inputTimer = 0;
document.addEventListener('input', (e) => {
  const el = /** @type {HTMLInputElement} */ (e.target);
  const fn = INPUTS[el.dataset?.input || ''];
  if (!fn) return;
  clearTimeout(inputTimer);
  inputTimer = setTimeout(() => fn(el, e), 120);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.menu) { ui.menu = null; rerender(); } });
attachChartHover(app);

on('toggle-ok', () => { ui.okOpen = !ui.okOpen; rerender(); });
on('conflict-theirs', () => store.resolveConflict('theirs'));
on('conflict-mine', () => store.resolveConflict('mine'));
onChange('pickup-rate', (el) => {
  const v = el.value.trim() === '' ? null : Number(el.value.replace(',', '.')) / 100;
  store.update((s) => { s.settings.taxRules.find((r) => r.id === 'pickup-sales').rate = Number.isFinite(v) ? v : null; });
});

// ---------- arranque ----------
applyTheme();
store.subscribe(rerender);
link.onLinkChange(rerender);
refresh.onRefreshChange(rerender);
addEventListener('hashchange', () => { ui.menu = null; render(); });
api.connectorVersion().then(link.setAppConnectorVersion).catch(() => {});
store.load().then(render).catch((e) => {
  morph(app, html`<div class="wrap"><div class="card pad" role="alert"><h1>No pude cargar los datos</h1><p class="muted">${e.message}</p><p>Revisa que el servidor esté corriendo (<code>npm start</code> en la carpeta v2) y recarga.</p></div></div>`);
});
