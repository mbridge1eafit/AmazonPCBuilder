// @ts-check
// Rutas por hash: #/ · #/c/:cat · #/p/:productId · #/comparar/:cat · #/actualizar · #/alertas · #/ajustes/:sección
import { CAT } from '../domain/categories.js';

export function parseRoute(hash = location.hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b] = parts;
  if (a === 'c' && CAT[b]) return { name: 'options', cat: b };
  if (a === 'p' && b) return { name: 'product', id: b };
  if (a === 'comparar' && CAT[b]) return { name: 'compare', cat: b };
  if (a === 'actualizar') return { name: 'refresh' };
  if (a === 'alertas') return { name: 'alerts' };
  if (a === 'ajustes') return { name: 'settings', section: b || 'armado' };
  return { name: 'build' };
}
export const go = (path) => { location.hash = path; };
