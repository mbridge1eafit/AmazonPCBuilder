// @ts-check
// Preferencias de este navegador (no viajan entre dispositivos): tema, densidad, vista de opciones por categoría,
// opciones marcadas para comparar, secciones plegadas. Todo lo que falle al leer o escribir se ignora.
const KEY = 'pcb2:prefs';
const DEFAULTS = { theme: 'system', density: 'compact', views: {}, marks: {}, open: {}, compareBasis: 'dest', hideEqual: true, chartRange: 90, connectorInstalled: false };

/** @type {typeof DEFAULTS} */
let prefs = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
})();

export const prefsGet = () => prefs;
export function prefsSet(patch) {
  prefs = { ...prefs, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* sin almacenamiento */ }
}
export function viewOf(cat) { return prefs.views[cat] || {}; }
export function setView(cat, patch) { prefsSet({ views: { ...prefs.views, [cat]: { ...viewOf(cat), ...patch } } }); }
export const marksOf = (cat) => prefs.marks[cat] || [];
export function setMarks(cat, ids) { prefsSet({ marks: { ...prefs.marks, [cat]: ids } }); }

export function applyTheme() {
  const t = prefs.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  document.documentElement.dataset.density = prefs.density;
}
