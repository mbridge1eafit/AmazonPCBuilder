// @ts-check
// Estado efímero de la interfaz (no se guarda), registro de acciones delegadas, diálogos y avisos.
import { morph, html } from './dom.js';

export const ui = {
  menu: /** @type {string|null} */ (null),
  expanded: /** @type {Record<string, boolean>} */ ({}),
  editRule: /** @type {string|null} */ (null),
  newStore: false,
  hiddenSeries: /** @type {Record<string, boolean>} */ ({}),
  chartTable: false,
  limit: /** @type {Record<string, number>} */ ({}),
  compareSet: 'marked',
  okOpen: false,
  addError: /** @type {Record<string, string>} */ ({}),
  paidProgress: '',
};

let renderFn = () => {};
export const setRenderer = (fn) => { renderFn = fn; };
let queued = false;
/** Repinta una vez al terminar la tarea actual (agrupa muchos cambios seguidos). Sin requestAnimationFrame:
 *  en una pestaña en segundo plano (p. ej. mientras se usa la de Amazon) no correría y la vista quedaría vieja. */
export function rerender() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; renderFn(); });
}

/** Acciones por nombre: clic en [data-act], envío de form[data-submit], cambio en [data-change], escritura en [data-input]. */
export const ACTIONS = {};
export const SUBMITS = {};
export const CHANGES = {};
export const INPUTS = {};
export const on = (name, fn) => { ACTIONS[name] = fn; };
export const onSubmit = (name, fn) => { SUBMITS[name] = fn; };
export const onChange = (name, fn) => { CHANGES[name] = fn; };
export const onInput = (name, fn) => { INPUTS[name] = fn; };

// ---------- diálogo nativo ----------
const dlg = /** @type {HTMLDialogElement} */ (document.getElementById('dlg'));
const dlgBody = /** @type {HTMLElement} */ (document.getElementById('dlg-body'));
let dlgRender = null;
/** Abre un diálogo; `render` se vuelve a llamar en cada repintado (progreso en vivo). */
export function openDialog(render) {
  dlgRender = render;
  morph(dlgBody, render());
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('[autofocus]')?.focus();
}
export const refreshDialog = () => { if (dlg.open && dlgRender) morph(dlgBody, dlgRender()); };
export function closeDialog() { dlgRender = null; dlg.close(); }
dlg.addEventListener('close', () => { dlgRender = null; });
dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(); });

/** Confirmación en un diálogo propio (no confirm() nativo). */
export function confirmDialog({ title, body, ok = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    const done = (v) => { dlg.removeEventListener('close', onClose); closeDialog(); resolve(v); };
    const onClose = () => resolve(false);
    ACTIONS.__confirm = () => done(true);
    openDialog(() => html`<div class="dlg-h"><h2 id="dlg-title">${title}</h2><button class="btn btn-g btn-s" data-act="close-dialog" aria-label="Cerrar">✕</button></div>
      <div class="dlg-b"><p style="margin:0">${body}</p></div>
      <div class="dlg-f"><button class="btn" data-act="close-dialog">Cancelar</button><button class="btn ${danger ? 'btn-danger' : 'btn-p'}" data-act="__confirm" autofocus>${ok}</button></div>`);
    dlg.addEventListener('close', onClose, { once: true });
  });
}
on('close-dialog', () => closeDialog());

// ---------- avisos breves ----------
const toasts = /** @type {HTMLElement} */ (document.getElementById('toasts'));
export function toast(msg, { error = false, ms = 4000, action = null } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' err' : ''}`;
  el.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.run(); el.remove(); };
    el.append(b);
  }
  toasts.append(el);
  setTimeout(() => el.remove(), ms);
}

export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
