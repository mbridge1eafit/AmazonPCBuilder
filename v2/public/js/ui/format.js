// @ts-check
// Formatos de Colombia: US$1,234.56 (en-US) · COP 3.188.000 (es-CO) · fechas 9-nov-2026.

const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfCO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

/** «1,234.56» o «sin dato». */
export const n2 = (n) => (n == null || !Number.isFinite(Number(n)) ? 'sin dato' : nf2.format(Number(n)));
export const usd = (n) => (n == null || !Number.isFinite(Number(n)) ? 'sin dato' : `US$${nf2.format(Number(n))}`);
export const copRaw = (n) => (n == null ? 'sin dato' : `COP ${nfCO.format(Math.round(Number(n)))}`);
export const cop = (usdAmount, trm) => (usdAmount == null ? 'sin dato' : copRaw(Number(usdAmount) * trm));
export const signed = (n) => (n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf2.format(Math.abs(n))}`);
export const intCO = (n) => (n == null ? '—' : nfCO.format(n));
export const pct = (r) => `${String(Math.round(r * 1000) / 10).replace('.', ',')} %`;

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** «9-nov-2026» desde AAAA-MM-DD o ISO. */
export function day(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).length <= 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? String(iso) : `${d.getDate()}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}
export const shortDay = (t) => { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

/** «ahora», «hace 5 min», «hace 3 h», «hace 2 d». */
export function ago(iso, now = Date.now()) {
  if (!iso) return '';
  const s = (now - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

export const TAX_SOURCE = { store: 'según la tienda', estimated: 'estimado', edited: 'editado', included: 'incluido', exempt: 'exento', customs: 'se paga en aduana' };
