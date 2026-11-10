// @ts-check
// Reglas de impuesto por destino (R6). Cada cálculo devuelve el id de la regla que aplicó para nombrarla en el desglose.
import { r2 } from './money.js';

/** @param {any} s @param {string} id */
export const ruleOf = (s, id) => (s?.taxRules || []).find((r) => r.id === id) || null;

/** ¿Rige en esa fecha? (sin fechas = vigente) @param {any} rule @param {string} [day] AAAA-MM-DD */
export function ruleActive(rule, day = new Date().toISOString().slice(0, 10)) {
  if (!rule) return false;
  if (rule.from && day < rule.from) return false;
  if (rule.until && day > rule.until) return false;
  return true;
}

/** Umbral de exención en Colombia (por envío = por producto, D2). */
export const threshold = (s) => Number(ruleOf(s, 'co-exempt')?.threshold ?? 200);
export const ivaRate = (s) => Number(ruleOf(s, 'co-iva')?.rate ?? 0.19);
export const dutyRate = (s) => Number(ruleOf(s, 'co-duty')?.rate ?? 0);

/**
 * Cargos de importación estimados para Colombia: 0 bajo el umbral; encima, IVA sobre precio + envío más arancel.
 * @param {number} subtotal @param {number} shipping @param {any} s
 */
export function coImportTax(subtotal, shipping, s) {
  if (subtotal < threshold(s)) return { tax: 0, rule: 'co-exempt', over: false };
  return { tax: r2(ivaRate(s) * (subtotal + shipping) + dutyRate(s) * subtotal), rule: 'co-iva', over: true };
}

/**
 * Sales tax de un destino de EE. UU. El surtax (Miami-Dade) solo aplica a los primeros `cap` dólares de cada artículo.
 * Devuelve null si la tasa no está configurada (p. ej. la sede de Micro Center).
 * @param {number} unitPrice @param {number} qty @param {string} dest @param {any} s
 */
export function salesTax(unitPrice, qty, dest, s) {
  const rule = (s?.taxRules || []).find((r) => r.kind === 'sales' && r.dest === dest);
  if (!rule || rule.rate == null) return null;
  const sur = Number(rule.surtax) || 0;
  const capped = rule.cap ? Math.min(unitPrice, Number(rule.cap)) : unitPrice;
  return { tax: r2((Number(rule.rate) * unitPrice + sur * capped) * qty), rule: rule.id, rate: Number(rule.rate) + sur };
}

/** Tasa total de sales tax (para mostrar «7 %»). */
export function salesRate(dest, s) {
  const rule = (s?.taxRules || []).find((r) => r.kind === 'sales' && r.dest === dest);
  return rule?.rate == null ? null : Number(rule.rate) + (Number(rule.surtax) || 0);
}

/**
 * Impuesto de entrada a Colombia de algo traído por casillero (D7): IVA sobre valor + flete y arancel, si supera el umbral.
 * @param {number} value @param {number} freight @param {any} s
 */
export function lockerEntryTax(value, freight, s) {
  const rule = ruleOf(s, 'locker-entry');
  if (value < threshold(s)) return { tax: 0, rule: 'co-exempt', over: false };
  return { tax: r2(Number(rule?.rate ?? 0.19) * (value + freight) + Number(rule?.duty ?? 0) * value), rule: 'locker-entry', over: true };
}
