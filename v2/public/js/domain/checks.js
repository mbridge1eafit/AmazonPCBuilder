// @ts-check
// Revisiones de compatibilidad y compra (§11). Portado de V1; ahora usa la tienda de compra de cada candidato.
// level: error | warn | info | ok
import { CATEGORIES, CAT, DECISIONS, FIXED, decisionLevel } from './categories.js';
import { detectTags, isSurgeProtector } from './specs.js';
import { totals, paidUSD, candsOf } from './build.js';
import { offerCost } from './offer-cost.js';

const WALL_EFFICIENCY = 0.9;
const SURGE_MIN_JOULES = 1000;
const SURGE_DEFAULT_W = 1800;
const FF_RANK = { 'Mini-ITX': 1, 'Micro-ATX': 2, ATX: 3, 'E-ATX': 4 };

export function shortTitle(t = '', n = 60) {
  const s = String(t).split(/[,|–—](?![^(]*\))/)[0].trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** @param {any} state @param {any} build @param {any} env @param {number} [now] */
export function checks(state, build, env, now = Date.now()) {
  const s = env.settings;
  const out = [];
  const add = (level, title, detail, cats = [], go = '') => out.push({ level, title, detail, cats, go });
  const t = totals(state, build, env);
  const ls = t.lines;
  const first = (cat) => { const l = ls.find((x) => x.cat === cat); return l ? { ...l, tags: detectTags(l.view, cat) } : null; };
  const cpu = first('cpu'), mb = first('motherboard'), ram = first('ram'), gpu = first('gpu');
  const psu = first('psu'), kase = first('case'), cooler = first('cooler');

  for (const c of CATEGORIES.filter((c) => c.essential)) {
    if (!ls.some((l) => l.cat === c.key)) add('info', `Falta: ${c.name}`, c.key === 'gpu' ? `Esencial. Mientras tanto el consumo usa ${c.watts} W genéricos.` : 'Esencial. Agrega un enlace o un producto manual.', [c.key]);
  }
  if (cpu && mb) {
    if (cpu.tags.socket && mb.tags.socket) {
      if (cpu.tags.socket === mb.tags.socket) add('ok', `Socket ${cpu.tags.socket}`, 'CPU y placa madre usan el mismo socket.', ['cpu', 'motherboard']);
      else add('error', 'Socket incompatible', `CPU ${cpu.tags.socket} ≠ placa ${mb.tags.socket}.`, ['cpu', 'motherboard']);
    } else add('warn', 'Socket sin confirmar', 'No detecté el socket de la CPU o de la placa. Confírmalo en Datos para compatibilidad.', ['cpu', 'motherboard']);
  }
  if (ram && mb) {
    if (ram.tags.memType && mb.tags.memType) {
      if (ram.tags.memType === mb.tags.memType) add('ok', `Memoria ${ram.tags.memType}`, 'La RAM coincide con la placa.', ['ram', 'motherboard']);
      else add('error', 'Tipo de RAM incompatible', `RAM ${ram.tags.memType} ≠ placa ${mb.tags.memType}.`, ['ram', 'motherboard']);
    } else add('warn', 'Tipo de RAM sin confirmar', 'No detecté DDR4/DDR5 en la RAM o la placa.', ['ram', 'motherboard']);
  }
  if (ram && cpu?.tags.socket === 'AM5' && ram.tags.memType === 'DDR4') add('error', 'AM5 solo usa DDR5', 'La RAM DDR4 no funciona con CPU AM5.', ['ram', 'cpu']);
  if (mb && kase) {
    const a = FF_RANK[mb.tags.formFactor], b = FF_RANK[kase.tags.formFactor];
    if (a && b) {
      if (a <= b) add('ok', 'La placa cabe en la caja', `${mb.tags.formFactor} en caja ${kase.tags.formFactor}.`, ['motherboard', 'case']);
      else add('error', 'La placa no cabe', `Placa ${mb.tags.formFactor} en caja ${kase.tags.formFactor}.`, ['motherboard', 'case']);
    } else add('warn', 'Formato sin confirmar', 'Revisa que la caja admita el formato de la placa.', ['motherboard', 'case']);
  }
  if (cooler && kase) {
    if (cooler.tags.heightMm && kase.tags.coolerMaxMm) {
      if (cooler.tags.heightMm <= kase.tags.coolerMaxMm) add('ok', 'Altura del disipador', `${cooler.tags.heightMm} mm ≤ ${kase.tags.coolerMaxMm} mm de la caja.`, ['cooler', 'case']);
      else add('error', 'Disipador muy alto', `${cooler.tags.heightMm} mm > ${kase.tags.coolerMaxMm} mm que admite la caja.`, ['cooler', 'case']);
    } else add('warn', 'Altura del disipador sin confirmar', 'Anota la altura del disipador y el máximo de la caja en Datos para compatibilidad.', ['cooler', 'case']);
  }
  if (cooler && cpu?.tags.socket) {
    const list = String(cooler.tags.sockets || '').toUpperCase().split(/[\s,/]+/).filter(Boolean);
    if (list.includes(cpu.tags.socket)) add('ok', `Disipador compatible con ${cpu.tags.socket}`, `Montajes: ${cooler.tags.sockets}.`, ['cooler', 'cpu']);
    else if (list.length) add('error', 'Disipador sin montaje para la CPU', `Montajes detectados: ${cooler.tags.sockets}; la CPU es ${cpu.tags.socket}.`, ['cooler', 'cpu']);
    else add('warn', `Disipador–CPU: montaje ${cpu.tags.socket} sin confirmar`, 'La ficha no lista los sockets. Confírmalo en Datos para compatibilidad.', ['cooler', 'cpu']);
  }
  if (psu) {
    const w = Number(psu.tags.psuWatts);
    if (w) {
      if (w >= t.watts * s.psuMargin) add('ok', `Fuente ${w} W`, `Consumo estimado ${t.watts} W (recomendado ≥ ${t.recommendedPsu} W con margen ×${String(s.psuMargin).replace('.', ',')}).`, ['psu']);
      else if (w >= t.watts) add('warn', 'Fuente justa', `${w} W para ~${t.watts} W estimados; se recomiendan ${t.recommendedPsu} W.`, ['psu']);
      else add('error', 'Fuente insuficiente', `${w} W para ~${t.watts} W estimados.`, ['psu']);
    } else add('warn', 'Potencia de la fuente sin detectar', 'Anota los vatios en Datos para compatibilidad.', ['psu']);
    if (gpu?.tags.needs12v2x6) {
      if (psu.tags.has12v2x6 === true) add('ok', 'Conector 12V-2x6', 'La fuente trae 12V-2x6 nativo para la GPU.', ['psu', 'gpu']);
      else if (psu.tags.has12v2x6 === 'adaptable') add('warn', '12VHPWR / ATX 3.x', 'La fuente menciona 12VHPWR o ATX 3.x pero no 12V-2x6. Confírmalo.', ['psu', 'gpu']);
      else add('error', 'Falta conector 12V-2x6', 'La GPU necesita 12V-2x6 y la fuente no lo menciona.', ['psu', 'gpu']);
    }
  }
  if (ls.some((l) => CAT[l.cat].essential)) {
    const pcWall = Math.round(t.watts / WALL_EFFICIENCY);
    const nMon = ls.filter((l) => CAT[l.cat].external).reduce((a, l) => a + (Number(l.cand.qty) || 1), 0);
    const devices = 1 + nMon;
    const load = pcWall + t.externalWatts;
    const who = `PC ~${pcWall} W en el enchufe${t.watts !== t.wattsNow ? ' (con lo planeado)' : ''}${nMon ? ` + ${nMon} monitor${nMon === 1 ? '' : 'es'} ${t.externalWatts} W` : ''}`;
    const surges = ls.filter((l) => isSurgeProtector(l.view));
    if (!surges.length) add('info', 'Sin protector de picos', `Para ${who}: busca ≥ ${SURGE_MIN_JOULES} J, VPR ≤ 400 V y al menos ${devices} tomas.`, ['accessories']);
    for (const l of surges) {
      const tg = detectTags(l.view, l.cat);
      const name = shortTitle(l.product.title, 40);
      const cap = Number(tg.capacityW) || SURGE_DEFAULT_W;
      const capText = tg.capacityW ? `${cap} W` : `${cap} W (15 A estándar, sin confirmar)`;
      const pct = Math.round((load / cap) * 100);
      const cats = [l.cat, ...(nMon ? ['monitor'] : [])];
      const problems = [];
      if (load > cap) problems.push(['error', 'Protector de picos sobrecargado', `${name}: ${load} W para ${capText}. ${who}.`]);
      else if (load > cap * 0.8) problems.push(['warn', 'Protector de picos al límite', `${name}: ${load} W de ${capText} (${pct} %); deja 20 % de margen.`]);
      if (tg.joules == null) problems.push(['warn', 'Julios del protector sin confirmar', `${name}: anota los julios (≥ ${SURGE_MIN_JOULES} J).`]);
      else if (tg.joules < SURGE_MIN_JOULES) problems.push(['warn', 'Protector con poca protección', `${name}: ${tg.joules} J; se recomiendan ≥ ${SURGE_MIN_JOULES} J.`]);
      if (tg.vpr != null && tg.vpr > 500) problems.push(['warn', 'Protector deja pasar mucho voltaje', `${name}: VPR ${tg.vpr} V; busca ≤ 400 V.`]);
      if (tg.outlets != null && devices > tg.outlets) problems.push(['error', 'Faltan tomas en el protector', `${name}: ${devices} equipos para ${tg.outlets} tomas.`]);
      for (const [lv, ti, de] of problems) add(lv, ti, de, cats);
      if (!problems.length) add('ok', 'Protector de picos suficiente', `${name}: ${load} W de ${capText} (${pct} %) · ${tg.joules} J.`, cats);
    }
  }
  if (mb) {
    const drives = ls.filter((l) => l.cat === 'storage');
    const n = (iface) => drives.filter((l) => detectTags(l.view, 'storage').interface === iface).reduce((a, l) => a + (Number(l.cand.qty) || 1), 0);
    const nvme = n('NVMe'), sata = n('SATA');
    if (mb.tags.m2Slots != null && nvme > mb.tags.m2Slots) add('error', 'Faltan ranuras M.2', `${nvme} NVMe para ${mb.tags.m2Slots} ranuras.`, ['storage', 'motherboard']);
    if (mb.tags.sataPorts != null && sata > mb.tags.sataPorts) add('error', 'Faltan puertos SATA', `${sata} discos SATA para ${mb.tags.sataPorts} puertos.`, ['storage', 'motherboard']);
    if (sata && !ls.some((l) => l.cat === 'accessories' && /SATA/i.test(l.product.title || ''))) add('info', 'Cables SATA', `Tienes ${sata} disco(s) SATA; la placa suele traer solo 2 cables.`, ['accessories']);
  }

  // Compra: por producto por comprar, con su tienda de compra.
  for (const l of ls) {
    if ((l.cand.status || 'buy') === 'bought') continue;
    const name = shortTitle(l.product.title);
    const offer = l.pr.row?.offer;
    const storeName = offer ? env.stores[offer.store]?.name || offer.store : '';
    if (offer?.shipsToDestination === false) add('error', `${shortTitle(l.product.title, 40)} no se envía a ${env.settings.destinations?.[l.cost.dest]?.short || 'su destino'}`, `${storeName}${offer.seller ? ` · ${offer.seller}` : ''}. Cambia la tienda de compra o elige otra opción.`, [l.cat]);
    const cond = offer?.condition || l.product.condition;
    if (cond && cond !== 'Nuevo') add('error', 'No es nuevo', `${name}: ${cond}`, [l.cat]);
    if (!l.cost || l.cost.total == null) { add('warn', 'Sin precio', `${name}: ninguna tienda tiene precio. Actualiza el producto o escríbelo.`, [l.cat]); continue; }
    if (l.cand.status === 'buy' && l.cost.overThreshold) add('warn', `${shortTitle(l.product.title, 40)} supera US$${t.threshold}`, `Paga IVA de importación: US$${(l.cost.tax || 0).toFixed(2)} ${l.cost.taxSource === 'store' ? 'según la tienda' : 'estimado'} (regla Colombia · ${env.settings.taxRules?.find((r) => r.id === 'co-exempt')?.source || ''}).`, [l.cat]);
    if (offer?.fetchedAt && now - Date.parse(offer.fetchedAt) > s.staleDays * 864e5) add('info', 'Precio desactualizado', `${name} en ${storeName}: leído hace ${Math.round((now - Date.parse(offer.fetchedAt)) / 864e5)} días.`, [l.cat]);
    if (l.cand.targetPrice != null && l.cost.total <= l.cand.targetPrice) add('ok', '¡Precio objetivo alcanzado!', `${name}: US$${l.cost.total.toFixed(2)} en ${storeName} ≤ US$${Number(l.cand.targetPrice).toFixed(2)}.`, [l.cat]);
  }
  const bought = ls.filter((l) => l.cand.status === 'bought');
  const noPaid = bought.filter((l) => paidUSD(l.cand) == null);
  if (noPaid.length) add('info', `${noPaid.length} comprado${noPaid.length === 1 ? '' : 's'} sin precio pagado`, `El total usa su precio de hoy: ${noPaid.map((l) => shortTitle(l.product.title, 28)).join(' · ')}.`, [noPaid[0].cat]);
  for (const l of bought) {
    const paid = paidUSD(l.cand);
    if (paid != null && l.cost?.total != null && l.cost.total - paid <= -1) add('info', 'Bajó de precio desde tu compra', `${shortTitle(l.product.title, 40)}: pagaste US$${paid.toFixed(2)}; hoy US$${l.cost.total.toFixed(2)}.`, [l.cat]);
  }
  // Decisión.
  for (const c of CATEGORIES) {
    const all = candsOf(state, build, c.key).filter((x) => !x.discarded);
    const fixed = all.filter((x) => decisionLevel(x.decision) === FIXED);
    const outside = fixed.filter((x) => !x.selected);
    const title = (x) => shortTitle(state.products[x.productId]?.title, 40);
    if (outside.length) add('warn', `Fijo sin elegir: ${c.name}`, `Marcaste como fijo ${outside.map(title).join(', ')}, pero el armado usa otra opción.`, [c.key]);
    if (!c.multi && fixed.length > 1) add('warn', `Dos fijos en ${c.name}`, `${fixed.length} opciones ★★★ y solo va una: ${fixed.map(title).join(' · ')}.`, [c.key]);
  }
  const buying = ls.filter((l) => (l.cand.status || 'buy') === 'buy');
  if (buying.length) {
    const pending = buying.filter((l) => decisionLevel(l.cand.decision) !== FIXED);
    if (!pending.length) add('ok', 'Todo lo por comprar está decidido', `${buying.length} producto(s) ★★★ fijos.`, []);
    else add('info', `${pending.length} por decidir`, `Sin ★★★: ${pending.map((l) => `${shortTitle(l.product.title, 28)} (${DECISIONS[decisionLevel(l.cand.decision)].stars})`).join(' · ')}.`, [pending[0].cat]);
  }
  const order = { error: 0, warn: 1, info: 2, ok: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/** Resumen para el indicador global. */
export function checkSummary(list, linesCount = 0) {
  const n = (lv) => list.filter((k) => k.level === lv).length;
  return { errors: n('error'), warns: n('warn'), infos: n('info'), oks: n('ok') };
}
export { offerCost };
