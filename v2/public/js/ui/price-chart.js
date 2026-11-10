// @ts-check
// Gráfica de historial por tienda (R8): cada serie se distingue por color, trazo y forma del marcador (no solo color),
// con línea de objetivo y de lo pagado, detalle del punto con el puntero o al tocar, y alternativa en tabla.
import { html, raw, esc } from './dom.js';
import { shortDay } from './format.js';

export const SERIES_STYLE = [
  { color: 'var(--s1)', dash: '', marker: 'circle' },
  { color: 'var(--s2)', dash: '6 4', marker: 'square' },
  { color: 'var(--s3)', dash: '2 3', marker: 'triangle' },
  { color: 'var(--s4)', dash: '8 3 2 3', marker: 'diamond' },
  { color: 'var(--s5)', dash: '1 2', marker: 'circle' },
  { color: 'var(--s6)', dash: '10 3', marker: 'square' },
];
export function markerPath(kind, x, y, r = 4) {
  if (kind === 'square') return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}"></rect>`;
  if (kind === 'triangle') return `<path d="M${x} ${y - r - 1}l${r + 1} ${2 * r}h${-2 * r - 2}z"></path>`;
  if (kind === 'diamond') return `<path d="M${x} ${y - r - 1}l${r + 1} ${r + 1}-${r + 1} ${r + 1}-${r + 1}-${r + 1}z"></path>`;
  return `<circle cx="${x}" cy="${y}" r="${r}"></circle>`;
}
/** Muestra de leyenda (28×10). */
export const legendSwatch = (i) => {
  const s = SERIES_STYLE[i % SERIES_STYLE.length];
  return raw(`<svg width="28" height="10" aria-hidden="true"><line x1="0" y1="5" x2="28" y2="5" stroke="${s.color}" stroke-width="2.5"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}></line><g fill="${s.color}">${markerPath(s.marker, 14, 5, 3.2)}</g></svg>`);
};

/**
 * @param {{ name: string, idx: number, points: { t: number, v: number }[] }[]} series
 * @param {{ target?: number|null, paid?: number|null, label: string }} o
 */
export function priceChart(series, o) {
  const W = 780, H = 280, L = 60, R = 740, T = 20, B = 240;
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return html`<p class="muted" style="margin:0">Sin lecturas en este rango. La gráfica aparece tras dos lecturas de una tienda.</p>`;
  const refs = [o.target, o.paid].filter((x) => x != null);
  let lo = Math.min(...pts.map((p) => p.v), ...refs), hi = Math.max(...pts.map((p) => p.v), ...refs);
  if (hi - lo < 1) { lo -= 5; hi += 5; }
  const pad = (hi - lo) * 0.08; lo = Math.max(0, lo - pad); hi += pad;
  const t0 = Math.min(...pts.map((p) => p.t)), t1 = Math.max(...pts.map((p) => p.t));
  const x = (t) => (t1 === t0 ? (L + R) / 2 : L + ((t - t0) / (t1 - t0)) * (R - L));
  const y = (v) => B - ((v - lo) / (hi - lo)) * (B - T);
  const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * (3 - i)) / 3);
  const xt = t1 === t0 ? [t0] : [0, 1, 2, 3].map((i) => t0 + ((t1 - t0) * i) / 3);
  let svg = `<g font-family="var(--mono)" font-size="11" fill="var(--muted)">`;
  for (const v of ticks) svg += `<line x1="${L}" y1="${y(v)}" x2="${R}" y2="${y(v)}" stroke="var(--line-2)"></line><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`;
  svg += `<line x1="${L}" y1="${B}" x2="${R}" y2="${B}" stroke="var(--line-strong)"></line>`;
  for (const t of xt) svg += `<text x="${x(t)}" y="${B + 18}" text-anchor="middle">${esc(shortDay(t))}</text>`;
  svg += '</g>';
  const refLine = (v, color, label) => `<line x1="${L}" y1="${y(v)}" x2="${R}" y2="${y(v)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 4"></line><text x="${L + 4}" y="${y(v) - 5}" font-family="var(--font)" font-size="11" font-weight="600" fill="${color}">${esc(label)}</text>`;
  if (o.target != null) svg += refLine(o.target, 'var(--ok)', `Objetivo ${o.target.toFixed(2)}`);
  if (o.paid != null) svg += refLine(o.paid, 'var(--warn-strong)', `Pagado ${o.paid.toFixed(2)}`);
  const data = [];
  for (const s of series) {
    const st = SERIES_STYLE[s.idx % SERIES_STYLE.length];
    const p = s.points;
    svg += `<polyline points="${p.map((q) => `${x(q.t).toFixed(1)},${y(q.v).toFixed(1)}`).join(' ')}" fill="none" stroke="${st.color}" stroke-width="2.5"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}></polyline>`;
    svg += `<g fill="${st.color}">${p.map((q) => markerPath(st.marker, +x(q.t).toFixed(1), +y(q.v).toFixed(1))).join('')}</g>`;
    data.push({ n: s.name, p: p.map((q) => [Math.round(x(q.t)), q.t, q.v]) });
  }
  svg += `<line class="cursor" x1="0" y1="${T}" x2="0" y2="${B}" stroke="var(--ink)" stroke-dasharray="2 2" visibility="hidden"></line>`;
  return html`<figure class="chart-wrap" data-morph-skip data-key="chart-${series.map((s) => s.name + s.points.length).join('|')}-${o.target}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.label}" data-chart="${JSON.stringify(data)}">${raw(svg)}</svg>
    <div class="chart-tip" aria-hidden="true"></div></figure>`;
}

/** Detalle del punto más cercano bajo el puntero (escritorio y táctil). */
export function attachChartHover(root) {
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerdown', onMove);
  root.addEventListener('pointerleave', (e) => { const f = /** @type {Element} */ (e.target).closest?.('.chart-wrap'); if (f) hide(f); }, true);
}
function hide(fig) { fig.querySelector('.chart-tip').style.display = 'none'; fig.querySelector('.cursor')?.setAttribute('visibility', 'hidden'); }
function onMove(e) {
  const svg = /** @type {Element} */ (e.target).closest?.('svg[data-chart]');
  if (!svg) return;
  const fig = svg.closest('.chart-wrap');
  const data = JSON.parse(svg.getAttribute('data-chart') || '[]');
  const box = svg.getBoundingClientRect();
  const vx = ((e.clientX - box.left) / box.width) * 780;
  let best = null;
  for (const s of data) for (const [px, t] of s.p) if (!best || Math.abs(px - vx) < Math.abs(best.px - vx)) best = { px, t };
  if (!best) return;
  const lines = [new Date(best.t).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })];
  for (const s of data) {
    let near = null;
    for (const q of s.p) if (q[1] <= best.t && (!near || q[1] > near[1])) near = q;
    if (near) lines.push(`${s.n.padEnd(16).slice(0, 16)} ${near[2].toFixed(2)}`);
  }
  const tip = fig.querySelector('.chart-tip');
  tip.textContent = lines.join('\n');
  tip.style.display = 'block';
  const left = (best.px / 780) * box.width;
  tip.style.left = `${Math.max(0, Math.min(box.width - 200, left + 12))}px`;
  tip.style.top = '24px';
  const cur = fig.querySelector('.cursor');
  cur.setAttribute('x1', best.px); cur.setAttribute('x2', best.px); cur.setAttribute('visibility', 'visible');
}
