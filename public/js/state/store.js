// @ts-check
// Estado único de la app. Las vistas solo leen; los cambios pasan por update(), que repinta y guarda
// (guardado automático con espera corta, control de versión `rev` y aviso si otro dispositivo guardó antes).
import { normalize, envOf } from '../domain/schema.js';
import * as api from '../services/api.js';

/** @type {any} */
let state = null;
const subs = new Set();
let saveTimer = 0;
let saving = false;
let dirty = false;
export const status = { save: 'idle', error: '', conflict: null };

export const get = () => state;
export const env = () => envOf(state);
export const build = () => state.builds.find((b) => b.id === state.activeBuildId) || state.builds[0];
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => subs.forEach((fn) => fn(state));

export async function load() {
  state = normalize(await api.getStore());
  emit();
  return state;
}

/** Reemplaza todo el estado (importar, restaurar). */
export function replace(next, { save = true } = {}) {
  const rev = state?.rev ?? 0;
  state = normalize(next);
  state.rev = rev;
  emit();
  if (save) scheduleSave(0);
}

/**
 * Cambia el estado con una función que muta el borrador.
 * @param {(s: any) => void} fn @param {{ save?: boolean }} [o]
 */
export function update(fn, { save = true } = {}) {
  fn(state);
  emit();
  if (save) scheduleSave();
}

export function scheduleSave(ms = 400) {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, ms);
}

async function flush() {
  if (saving || !dirty) return;
  saving = true; dirty = false;
  status.save = 'saving'; emit();
  try {
    const r = await api.putStore(state);
    if (r.conflict) {
      status.save = 'conflict'; status.conflict = r.current;
    } else {
      state.rev = r.rev; status.save = 'saved'; status.error = '';
    }
  } catch (e) {
    status.save = 'error'; status.error = e.message; dirty = true;
  } finally {
    saving = false;
    emit();
    if (dirty && status.save !== 'conflict') scheduleSave(3000);
  }
}

/** Resolver un conflicto: quedarse con lo del otro dispositivo o sobrescribirlo con lo de aquí. */
export async function resolveConflict(keep) {
  const current = status.conflict;
  status.conflict = null;
  if (keep === 'theirs' && current) { state = normalize(current); status.save = 'saved'; emit(); return; }
  try {
    const r = await api.putStore(state, { force: true });
    state.rev = r.rev; status.save = 'saved';
  } catch (e) { status.save = 'error'; status.error = e.message; }
  emit();
}

addEventListener('beforeunload', (e) => { if (dirty || saving) { flush(); e.preventDefault(); } });
