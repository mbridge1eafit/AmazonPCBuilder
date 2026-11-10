// @ts-check
// Alertas de precio por producto (R15): bajo el objetivo en cualquier tienda, bajó vs la última lectura,
// entró en oferta o bajó vs lo pagado. Se evalúan al llegar una lectura.
import { newId } from './schema.js';

/**
 * @param {any} cand @param {any} product @param {any} offer
 * @param {{ total: number|null, deal?: boolean }} before @param {{ total: number|null, deal?: boolean }} after
 * @param {any} env @param {string} [now]
 */
export function alertEvents(cand, product, offer, before, after, env, now = new Date().toISOString()) {
  const out = [];
  const a = cand.alerts || {};
  const st = env.stores[offer.store];
  if (a.coOnly && st?.destination !== 'co') return out;
  const minDrop = Number(env.settings.alerts?.minDrop) || 0;
  const ev = (kind, detail) => out.push({ id: newId('a'), at: now, kind, candidateId: cand.id, productId: product.id, offerId: offer.id, store: offer.store, detail, seen: false, total: after.total });
  const t = after.total;
  if (t == null) return out;
  const target = cand.targetPrice != null ? Number(cand.targetPrice) : null;
  if (a.target && target != null && t <= target && (before.total == null || before.total > target)) ev('target', `Bajó de tu objetivo (${target.toFixed(2)})`);
  else if (a.drop && before.total != null && before.total - t >= Math.max(minDrop, 0.01)) ev('drop', `Bajó ${(before.total - t).toFixed(2)} vs la lectura anterior`);
  if (a.deal && after.deal && !before.deal) ev('deal', 'Entró en oferta');
  const paid = cand.purchase?.total?.amount;
  if (cand.status === 'bought' && paid != null && t < paid - Math.max(minDrop, 1) && (before.total == null || before.total >= paid - Math.max(minDrop, 1))) ev('paid', `Hoy ${t.toFixed(2)}; pagaste ${Number(paid).toFixed(2)}`);
  return out;
}

export const ALERT_LABELS = { target: 'Precio objetivo alcanzado', drop: 'Bajó de precio', deal: 'Entró en oferta', paid: 'Bajó desde tu compra' };
