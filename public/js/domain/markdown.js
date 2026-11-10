// @ts-check
// Copiar el armado como Markdown.
import { CAT, STATUS, DECISIONS, decisionLevel } from './categories.js';
import { totals, paidUSD } from './build.js';
import { shortTitle } from './checks.js';

const usd = (n) => (n == null ? '—' : `US$${Number(n).toFixed(2)}`);

export function toMarkdown(state, build, env) {
  const t = totals(state, build, env);
  const rows = t.lines.map((l) => {
    const c = l.cost;
    const paid = l.cand.status === 'bought' ? paidUSD(l.cand) : null;
    const store = l.pr.row ? env.stores[l.pr.row.offer.store]?.name || l.pr.row.offer.store : '—';
    const link = l.pr.row?.offer.url ? `[${shortTitle(l.product.title, 70)}](${l.pr.row.offer.url})` : shortTitle(l.product.title, 70);
    return `| ${CAT[l.cat].name} | ${link} | ${STATUS[l.cand.status || 'buy'].label} | ${DECISIONS[decisionLevel(l.cand.decision)].stars} | ${store}${l.pr.suggested ? ' (sugerida)' : ''} | ${paid != null ? `**${usd(paid)}** (pagado)` : `**${usd(c?.total)}**${c?.partial ? '*' : ''}`} | ${usd(c?.subtotal)} | ${usd(c?.shipping)} | ${usd(c?.tax)} |`;
  });
  return [
    `# ${build.name}`, '',
    '| Pieza | Producto | Estado | Decisión | Tienda | Total en destino | Producto | Envío | Impuesto |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows, '',
    `**Por comprar:** ${usd(t.toBuy.total)} (${t.orders} pedidos, ${t.over.count} ≥ US$${t.threshold}) · **Ya comprado:** ${usd(t.bought.total)} · **Planeado:** ${usd(t.planned.total)} · **Total:** ${usd(t.grand)}`,
    `**Decididos (★★★):** ${t.fixed.count} por ${usd(t.fixed.total)}${t.pending ? ` · **por decidir:** ${t.pending}` : ''}`,
    `**Consumo estimado:** ${t.watts} W · fuente recomendada ≥ ${t.recommendedPsu} W`,
    `TRM ${env.settings.fx.trm} (${env.settings.fx.date})`,
  ].join('\n');
}
