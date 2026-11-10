// @ts-check
// Dinero: cada monto se guarda en su moneda original y se convierte al mostrarlo.
// US$ es la moneda principal (D4); COP aparece al lado con la TRM de Ajustes.

/** @typedef {'USD'|'COP'} Currency */
/** @typedef {{ amount: number, currency: Currency }} Money */

/** Redondeo a centavos. @param {number} n */
export const r2 = (n) => Math.round(n * 100) / 100;

/** Número o null (vacío, NaN y no números son «sin dato», nunca 0). @param {unknown} v */
export function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** @param {unknown} c @returns {Currency} */
export const currencyOf = (c) => (c === 'COP' ? 'COP' : 'USD');

/**
 * Convierte a US$. USD = COP / TRM.
 * @param {number|null|undefined} amount @param {Currency} currency @param {number} trm
 */
export function toUSD(amount, currency, trm) {
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  return currency === 'COP' ? r2(Number(amount) / trm) : Number(amount);
}

/** @param {number|null|undefined} usd @param {number} trm */
export const toCOP = (usd, trm) => (usd == null ? null : Math.round(Number(usd) * trm));

/** @param {number|null} amount @param {Currency} [currency] @returns {Money|null} */
export const money = (amount, currency = 'USD') => (amount == null ? null : { amount, currency });
