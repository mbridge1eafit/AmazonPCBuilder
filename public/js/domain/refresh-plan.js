// @ts-check
// Qué leer al actualizar en cualquiera de los tres niveles (R7): fila, producto o armado.
// Cada trabajo va por un canal: la sesión de Amazon de su destino ('amazon-co' / 'amazon-us') o la pestaña de su comercio.
import { asinOf } from './catalog.js';
import { decisionLevel } from './categories.js';

/** Canal de lectura de una fila, o null si se escribe a mano. */
export function channelOf(offer, env) {
  const st = env.stores[offer.store];
  const m = env.merchants?.[st?.merchant];
  if (!st || !m || m.readMode === 'manual') return null;
  if (m.readMode === 'amazon') return offer.store; // 'amazon-co' o 'amazon-us': depende del destino de la sesión
  // El conector de una tienda solo lee enlaces de su mismo origen: un canal por origen.
  try { return offer.url ? `tab:${new URL(offer.url).origin}` : null; } catch { return null; }
}

/**
 * @param {any} state @param {any} env
 * @param {{ kind: 'build'|'product'|'offer', productId?: string, offerId?: string }} scope
 * @param {{ now?: number, force?: boolean }} [o]
 */
export function planRefresh(state, env, scope, { now = Date.now(), force = false } = {}) {
  const build = state.builds.find((b) => b.id === state.activeBuildId);
  const fresh = (o) => o.fetchedAt && o.readStatus === 'ok' && now - Date.parse(o.fetchedAt) < (Number(env.settings.refreshMinutes) || 0) * 60000;
  let pairs = [];
  if (scope.kind === 'build') {
    const seen = new Set();
    const cands = (build?.candidates || []).filter((c) => !c.discarded && state.products[c.productId]);
    // Lo de más estrellas primero (y lo elegido antes que el resto).
    cands.sort((a, b) => decisionLevel(b.decision) - decisionLevel(a.decision) || Number(b.selected) - Number(a.selected));
    for (const c of cands) {
      if (seen.has(c.productId)) continue;
      seen.add(c.productId);
      const p = state.products[c.productId];
      for (const o of p.offers) pairs.push({ p, o, decision: decisionLevel(c.decision) });
    }
  } else {
    const p = state.products[scope.productId];
    if (p) for (const o of p.offers) if (scope.kind === 'product' || o.id === scope.offerId) pairs.push({ p, o, decision: 0 });
  }
  const jobs = [], manual = [], skipped = [];
  for (const { p, o, decision } of pairs) {
    const channel = channelOf(o, env);
    if (!channel) { manual.push({ productId: p.id, offerId: o.id, store: o.store }); continue; }
    if (scope.kind === 'build' && !force && fresh(o)) { skipped.push({ productId: p.id, offerId: o.id, store: o.store }); continue; }
    const asin = channel.startsWith('amazon') ? p.ids?.asin || asinOf(o.url) : null;
    if (channel.startsWith('amazon') && !asin) { manual.push({ productId: p.id, offerId: o.id, store: o.store }); continue; }
    jobs.push({ productId: p.id, offerId: o.id, store: o.store, channel, url: o.url, asin, decision });
  }
  return { jobs, manual, skipped };
}

/** Agrupa trabajos por canal (una tarjeta por tienda en el centro de actualización). */
export function byChannel(jobs) {
  const m = new Map();
  for (const j of jobs) (m.get(j.channel) || m.set(j.channel, []).get(j.channel)).push(j);
  return m;
}
