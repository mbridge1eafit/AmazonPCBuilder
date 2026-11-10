// @ts-check
// Actualizar en tres niveles (R7): fila, producto y armado, con el mismo comportamiento.
// Cada trabajo espera a que su canal esté listo: la sesión de Amazon entregando en su destino, o la pestaña de su tienda.
// Lo que no puede leerse queda «en espera» con la acción que lo destraba (ver waitReason).
import * as store from '../state/store.js';
import * as link from './connector-link.js';
import { planRefresh } from '../domain/refresh-plan.js';
import { applyAmazon, applyStorePrice, failOffer, sanitizeAmazon } from '../domain/readings.js';
import { alertEvents } from '../domain/alerts.js';
import { offerCost } from '../domain/offer-cost.js';

/** @typedef {{ productId: string, offerId: string, store: string, channel: string, url: string, asin: string|null, decision: number, state: string, error?: string, scope: string }} Job */

export const run = {
  active: false, startedAt: 0, scopeLabel: '',
  /** @type {Job[]} */ jobs: [],
  changes: /** @type {any[]} */ ([]), kept: /** @type {string[]} */ ([]), skipped: 0, manual: 0,
};
const subs = new Set();
const notify = () => subs.forEach((fn) => fn());
export const onRefreshChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
link.onLinkChange(() => { pump(); notify(); });

const inFlight = new Set(); // offerId

/** Estado de una fila para mostrar en su contexto: 'waiting' | 'running' | 'done' | 'error' | null. */
export function offerState(offerId) {
  for (let i = run.jobs.length - 1; i >= 0; i--) if (run.jobs[i].offerId === offerId) return run.jobs[i];
  return null;
}
export function productProgress(productId) {
  const js = run.jobs.filter((j) => j.productId === productId);
  if (!js.length) return null;
  const n = (s) => js.filter((j) => j.state === s).length;
  return { total: js.length, done: n('done'), running: n('running'), waiting: n('waiting'), error: n('error') };
}
export function summary() {
  const n = (s) => run.jobs.filter((j) => j.state === s).length;
  return { total: run.jobs.length, done: n('done'), running: n('running'), waiting: n('waiting'), error: n('error'), cancelled: n('cancelled') };
}

/** Por qué espera un canal y qué hacer. */
export function waitReason(channel) {
  if (channel.startsWith('amazon')) {
    const want = channel === 'amazon-co' ? 'co' : 'us';
    const dest = want === 'co' ? 'Medellín' : `Miami ${store.get().settings.destinations?.['us-mia']?.place || '33186'}`;
    if (!link.amazonAlive()) return { code: 'connect', text: `Abre Amazon y pulsa ahí el marcador «+ Armador PC».`, action: 'Abrir Amazon' };
    if (link.amazon.region !== want) return { code: 'region', text: `Tu sesión de Amazon entrega en ${link.amazon.deliverTo || 'otra dirección'}. En Amazon cambia «Entregar en» a ${dest}, recarga y pulsa el marcador.`, action: 'Ir a Amazon' };
    return null;
  }
  const origin = channel.slice(4);
  if (!link.tabAlive(origin)) return { code: 'tab', text: 'Abre la tienda en una pestaña y pulsa ahí el marcador.', action: 'Abrir' };
  return null;
}

/**
 * Empieza una actualización. Llamar dentro de un clic: si hace falta Amazon, abre su pestaña.
 * @param {{ kind: 'build'|'product'|'offer', productId?: string, offerId?: string }} scope
 */
export function start(scope, { force = false } = {}) {
  const st = store.get();
  const plan = planRefresh(st, store.env(), scope, { force: force || scope.kind !== 'build' });
  if (!run.active || scope.kind === 'build') {
    if (scope.kind === 'build') Object.assign(run, { jobs: [], changes: [], kept: [] });
    Object.assign(run, { active: true, startedAt: Date.now(), scopeLabel: scope.kind });
  }
  run.skipped = plan.skipped.length;
  run.manual = plan.manual.length;
  for (const j of plan.jobs) {
    if (inFlight.has(j.offerId) || run.jobs.some((x) => x.offerId === j.offerId && x.state === 'waiting')) continue;
    run.jobs.push({ ...j, state: 'waiting', scope: scope.kind });
  }
  // Abrir Amazon si hay algo para Amazon y no hay sesión (dentro del gesto del usuario).
  if (plan.jobs.some((j) => j.channel.startsWith('amazon')) && !link.amazonAlive()) link.openAmazon();
  pump();
  notify();
  return plan;
}

export function cancel() {
  for (const j of run.jobs) if (j.state === 'waiting') j.state = 'cancelled';
  link.cancelPending();
  finishIfDone();
  notify();
}

function finishIfDone() {
  if (run.jobs.every((j) => j.state !== 'waiting' && j.state !== 'running')) run.active = false;
}

/** Envía lo que su canal ya puede atender. Amazon: de a un ASIN por producto (el conector deduplica). */
export function pump() {
  for (const j of run.jobs) {
    if (j.state !== 'waiting' || waitReason(j.channel)) continue;
    j.state = 'running';
    inFlight.add(j.offerId);
    const p = j.channel.startsWith('amazon') ? link.requestAsin(/** @type {string} */ (j.asin)) : link.requestPrice(j.url);
    p.then((data) => receive(j, data), (e) => fail(j, e.message)).finally(() => { inFlight.delete(j.offerId); finishIfDone(); notify(); });
  }
}

function recordChange(product, offer, before, after, extra = {}) {
  const changed = ['price', 'shipping', 'tax', 'total'].some((k) => before[k] != null && after[k] != null && before[k] !== after[k]);
  if (!changed && !extra.note) return;
  run.changes.push({ productId: product.id, title: product.title, offerId: offer.id, store: offer.store, before, after, at: Date.now(), ...extra });
}

function alertsFor(st, product, offer, before, after) {
  const env = store.env();
  const events = [];
  for (const b of st.builds) for (const c of b.candidates) {
    if (c.productId !== product.id) continue;
    events.push(...alertEvents(c, product, offer, before, after, env));
  }
  return events;
}

function receive(job, data) {
  store.update((st) => {
    const product = st.products[job.productId];
    const offer = product?.offers.find((o) => o.id === job.offerId);
    if (!product || !offer) return;
    const env = store.env();
    if (job.channel.startsWith('amazon')) {
      let d;
      try { d = sanitizeAmazon(data); } catch (e) { failOffer(offer, e.message); job.state = 'error'; job.error = e.message; return; }
      const res = applyAmazon(product, d, env);
      if (res.skipped) { job.state = 'waiting'; return; } // la sesión cambió de destino: queda en espera
      if (res.keptEdits.length) run.kept.push(`${product.title.slice(0, 40)}: ${res.keptEdits.join(', ')}`);
      const bDeal = false, aDeal = offerCost(res.offer, product, env).deal;
      recordChange(product, res.offer, res.before, res.after);
      st.alertEvents.push(...alertsFor(st, product, res.offer, { ...res.before, deal: bDeal }, { ...res.after, deal: aDeal }));
    } else {
      const beforeDeal = offerCost(offer, product, env).deal;
      const res = applyStorePrice(product, offer, data, env);
      if (res.error) { job.state = 'error'; job.error = res.error; return; }
      recordChange(product, offer, res.before, res.after);
      st.alertEvents.push(...alertsFor(st, product, offer, { ...res.before, deal: beforeDeal }, { ...res.after, deal: offerCost(offer, product, env).deal }));
    }
    if (st.alertEvents.length > 300) st.alertEvents.splice(0, st.alertEvents.length - 300);
    job.state = 'done';
  });
}

function fail(job, message) {
  if (message === 'Cancelado') { job.state = 'cancelled'; return; }
  store.update((st) => {
    const offer = st.products[job.productId]?.offers.find((o) => o.id === job.offerId);
    if (offer) failOffer(offer, message);
  });
  job.state = 'error';
  job.error = message;
}

/** Reintentar los que fallaron (de un canal o todos). */
export function retry(channel = null) {
  for (const j of run.jobs) if (j.state === 'error' && (!channel || j.channel === channel)) { j.state = 'waiting'; j.error = ''; }
  run.active = true;
  pump();
  notify();
}
