// @ts-check
// Las 12 categorías (brief §9.1), estados (§10.1) y niveles de decisión (§10.2).

export const CATEGORIES = [
  { key: 'cpu', name: 'Procesador', short: 'CPU', icon: 'cpu', essential: true, watts: 120 },
  { key: 'cooler', name: 'Disipador de CPU', short: 'Disipador', icon: 'cooler', essential: true, watts: 6 },
  { key: 'motherboard', name: 'Placa madre', short: 'Placa', icon: 'mobo', essential: true, watts: 50 },
  { key: 'ram', name: 'Memoria RAM', short: 'RAM', icon: 'ram', essential: true, watts: 10 },
  { key: 'gpu', name: 'Tarjeta gráfica', short: 'GPU', icon: 'gpu', essential: true, watts: 250 },
  { key: 'storage', name: 'Almacenamiento', short: 'Discos', icon: 'ssd', essential: true, multi: true, watts: 6 },
  { key: 'psu', name: 'Fuente de poder', short: 'Fuente', icon: 'psu', essential: true, watts: 0 },
  { key: 'case', name: 'Caja / chasis', short: 'Caja', icon: 'case', essential: true, watts: 0 },
  { key: 'fans', name: 'Ventiladores', short: 'Ventiladores', icon: 'fans', multi: true, watts: 3 },
  { key: 'accessories', name: 'Cables y accesorios', short: 'Accesorios', icon: 'cable', multi: true, watts: 0 },
  // external: va al enchufe, no a la fuente (cuenta para el protector de picos).
  { key: 'monitor', name: 'Monitor', short: 'Monitor', icon: 'monitor', multi: true, watts: 0, external: true },
  { key: 'peripherals', name: 'Periféricos', short: 'Periféricos', icon: 'periph', multi: true, watts: 0 },
];
/** @type {Record<string, typeof CATEGORIES[number]>} */
export const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));
export const ESSENTIAL_COUNT = CATEGORIES.filter((c) => c.essential).length;

// Una sola etiqueta por estado en toda la app (inconsistencia 15 del brief).
export const STATUS = {
  buy: { key: 'buy', label: 'Por comprar' },
  bought: { key: 'bought', label: 'Comprado' },
  planned: { key: 'planned', label: 'Planeado' },
};
export const STATUS_KEYS = /** @type {const} */ (['buy', 'bought', 'planned']);

export const DECISIONS = [
  { level: 0, label: 'Sin decidir', stars: '☆☆☆', hint: 'Todavía no sé si lo compro.' },
  { level: 1, label: 'Candidato', stars: '★☆☆', hint: 'Me sirve, pero sigo mirando.' },
  { level: 2, label: 'Probable', stars: '★★☆', hint: 'Casi seguro que es este.' },
  { level: 3, label: 'Fijo', stars: '★★★', hint: 'Decidido: este lo compro.' },
];
export const FIXED = 3;
/** @param {unknown} n */
export const decisionLevel = (n) => Math.max(0, Math.min(FIXED, Math.round(Number(n) || 0)));
