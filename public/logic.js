// Lógica pura del armador: categorías, detección de specs, compatibilidad, consumo y totales.
// Sin DOM, para poder probarla con `node --test`.

export const CATEGORIES = [
  { key: 'cpu', name: 'Procesador', short: 'CPU', essential: true, watts: 120 },
  { key: 'cooler', name: 'Disipador de CPU', short: 'Disipador', essential: true, watts: 6 },
  { key: 'motherboard', name: 'Placa madre', short: 'Placa', essential: true, watts: 50 },
  { key: 'ram', name: 'Memoria RAM', short: 'RAM', essential: true, watts: 10 },
  { key: 'gpu', name: 'Tarjeta gráfica', short: 'GPU', essential: true, watts: 250 },
  { key: 'storage', name: 'Almacenamiento', short: 'Discos', essential: true, multi: true, watts: 6 },
  { key: 'psu', name: 'Fuente de poder', short: 'Fuente', essential: true, watts: 0 },
  { key: 'case', name: 'Caja / chasis', short: 'Caja', essential: true, watts: 0 },
  { key: 'fans', name: 'Ventiladores', short: 'Ventiladores', multi: true, watts: 3 },
  { key: 'accessories', name: 'Cables y accesorios', short: 'Accesorios', multi: true, watts: 0 },
  { key: 'monitor', name: 'Monitor', short: 'Monitor', multi: true, watts: 0 },
  { key: 'peripherals', name: 'Periféricos', short: 'Periféricos', multi: true, watts: 0 },
];
export const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

export const STATUS = {
  buy: { label: 'Por comprar', short: 'Comprar' },
  bought: { label: 'Ya comprado', short: 'Comprado' },
  planned: { label: 'Planeado (después)', short: 'Planeado' },
};

// Nivel de decisión: qué tan seguro estás de comprar ese producto, de 0 a 3 estrellas.
// Vive en el producto (no en la selección del armado): si cambias la opción elegida, el que marcaste
// «fijo» sigue fijo. Ordena las opciones: más estrellas = más favorito.
export const PICKS = [
  { level: 0, label: 'Sin decidir', short: 'Sin decidir', stars: '☆☆☆', hint: 'Todavía no sé si lo compro' },
  { level: 1, label: '★ Candidato', short: 'Candidato', stars: '★☆☆', hint: 'Me sirve, pero sigo mirando' },
  { level: 2, label: '★★ Probable', short: 'Probable', stars: '★★☆', hint: 'Casi seguro que es este' },
  { level: 3, label: '★★★ Fijo', short: 'Fijo', stars: '★★★', hint: 'Decidido: este lo compro' },
];
export const PICK_FIXED = 3;

export function pickLevel(p) {
  const n = Math.round(Number(p?.pick) || 0);
  return n < 0 ? 0 : n > PICK_FIXED ? PICK_FIXED : n;
}
export const pickOf = (p) => PICKS[pickLevel(p)];
export const isFixed = (p) => pickLevel(p) === PICK_FIXED;

// Opciones ordenadas por estrellas (más favorito primero), conservando el orden en que las agregaste.
export const sortByPick = (list) => list
  .map((p, i) => [p, i])
  .sort((a, b) => pickLevel(b[0]) - pickLevel(a[0]) || a[1] - b[1])
  .map(([p]) => p);

export const DEFAULT_SETTINGS = { trm: 3160, threshold: 200, iva: 0.19, psuMargin: 1.3, staleDays: 3, refreshMinutes: 10 };

// Datos que debe tener un producto de Amazon para calcular su costo en Colombia.
const REQUIRED = [
  ['price', 'precio'],
  ['shipping', 'envío'],
  ['importFees', 'cargos de importación'],
  ['shipsToCO', 'envío a Colombia'],
  ['seller', 'vendedor'],
  ['image', 'imagen'],
];

export function missingFields(p) {
  if (!p || p.manual || !p.url) return [];
  const out = REQUIRED.filter(([k]) => (p[k] == null || p[k] === '') && !(k === 'importFees' && p.importFeesInfo === 'no-informado')).map(([, label]) => label);
  if (!p.specs || !Object.keys(p.specs).length) out.push('especificaciones');
  if (p.locationOk === false) out.push('entrega en Colombia');
  return out;
}

// «Actualizar todo» omite lo leído con tu sesión hace menos de refreshMinutes, salvo que le falten datos.
export function needsRefresh(p, s = DEFAULT_SETTINGS, now = Date.now()) {
  if (!p?.url || !/amazon\.com\//i.test(p.url)) return false;
  if (p.source !== 'sesion' || missingFields(p).length || !p.fetchedAt) return true;
  return now - Date.parse(p.fetchedAt) >= (Number(s.refreshMinutes) || 0) * 60000;
}

// Potencia de tarjeta (TGP/TBP) de referencia. El orden importa: variantes (Ti, Super, XT) antes del modelo base.
const GPU_WATTS = [
  [/5090/, 575], [/5080/, 360], [/5070\s?Ti/i, 300], [/5070/, 250], [/5060\s?Ti/i, 180], [/5060/, 145], [/5050/, 130],
  [/4090/, 450], [/4080/, 320], [/4070\s?Ti/i, 285], [/4070\s?Super/i, 220], [/4070/, 200], [/4060\s?Ti/i, 165], [/4060/, 115],
  [/3090\s?Ti/i, 450], [/3090/, 350], [/3080\s?Ti/i, 350], [/3080/, 320], [/3070\s?Ti/i, 290], [/3070/, 220], [/3060\s?Ti/i, 200], [/3060/, 170], [/3050/, 130],
  [/2080\s?Ti/i, 250], [/2080/, 215], [/2070\s?Super/i, 215], [/2070/, 175], [/2060\s?Super/i, 175], [/2060/, 160],
  [/1660/, 125], [/1650\s?Super/i, 100], [/1650/, 75], [/1630/, 75], [/1080\s?Ti/i, 250], [/1080/, 180], [/1070/, 150], [/1060/, 120], [/1050/, 75],
  [/9070\s?XT/i, 304], [/9070/, 220], [/9060\s?XT/i, 160], [/7900\s?XTX/i, 355], [/7900\s?XT/i, 315], [/7900\s?GRE/i, 260], [/7800\s?XT/i, 263], [/7700\s?XT/i, 245], [/7600\s?XT/i, 190], [/7600/, 165],
  [/6950\s?XT/i, 335], [/6900\s?XT/i, 300], [/6800\s?XT/i, 300], [/6800/, 250], [/6750\s?XT/i, 250], [/6700\s?XT/i, 230], [/6650\s?XT/i, 180], [/6600\s?XT/i, 160], [/6600/, 132], [/6500\s?XT/i, 107],
  [/5700\s?XT/i, 225], [/5600\s?XT/i, 150], [/RX\s?5[78]0\b/i, 185],
  [/B580/i, 190], [/B570/i, 150], [/A770/i, 225], [/A750/i, 225], [/A580/i, 185], [/A380/i, 75],
];
const GPU_FALLBACK_W = 250;

// CPU: [modelo, TDP, potencia máxima real]. AMD: PPT = 1.35 × TDP. Intel: PL2 (turbo sostenido).
const CPU_WATTS = [
  [/9950X3D/i, 170, 230], [/(?:9900|9800|7950|7900|7800)X3D/i, 120, 162], [/5[78]00X3D/i, 105, 142],
  [/(?:9950|7950|7900)X\b/i, 170, 230], [/9900X\b/i, 120, 162], [/(?:7700|7600|59[05]0|5800)X\b/i, 105, 142],
  [/Ultra\s?9\s?285K|Ultra\s?7\s?265K|1[34][79]00K[FS]?\b/i, 125, 253], [/Ultra\s?5\s?245K|1[34]600K/i, 125, 181],
  [/12900K/i, 125, 241], [/12700K/i, 125, 190], [/12600K/i, 125, 150],
  [/1[34][79]00F?\b/i, 65, 219], [/12[79]00F?\b/i, 65, 190], [/Ultra\s?[79]\s?2[68]5\b/i, 65, 182],
  [/Ultra\s?5\s?2[2-4]5\b|1[234][456]00F?\b/i, 65, 148], [/i3-?1[234]1\d0/i, 60, 89],
];

// Consumo fijo que no es de ninguna pieza: USB, periféricos, RGB de la placa, pérdidas.
export const BASE_WATTS = 15;

const text = (p) => [p.title, p.brand, ...(Object.entries(p.specs || {}).map(([k, v]) => `${k}: ${v}`)), ...(p.bullets || [])].join(' \n ');

function socketFrom(t, cat) {
  const m = t.match(/\b(AM5|AM4|LGA\s?1851|LGA\s?1700|LGA\s?1200|sTR5)\b/i);
  if (m) return m[1].toUpperCase().replace(/\s/g, '');
  if (cat === 'cpu') {
    if (/Ryzen\s?\d\s?(7\d{3}|8\d{3}|9\d{3})/i.test(t)) return 'AM5';
    if (/Ryzen\s?\d\s?5\d{3}/i.test(t)) return 'AM4';
    if (/Core\s?Ultra\s?\d\s?2\d{2}/i.test(t)) return 'LGA1851';
    if (/i[3579]-?1[234]\d{3}/i.test(t)) return 'LGA1700';
  }
  if (cat === 'motherboard') {
    if (/\b(X870E?|B850|B840|X670E?|B650E?|A620)\b/i.test(t)) return 'AM5';
    if (/\b(X570|B550|A520|B450|X470)\b/i.test(t)) return 'AM4';
    if (/\b(Z890|B860|H810)\b/i.test(t)) return 'LGA1851';
    if (/\b(Z790|B760|H770|H610|Z690|B660)\b/i.test(t)) return 'LGA1700';
  }
  return null;
}

function formFactorFrom(t) {
  if (/\bE-?ATX\b/i.test(t)) return 'E-ATX';
  if (/\b(Mini[\s-]?ITX|\bITX)\b/i.test(t)) return 'Mini-ITX';
  if (/\b(Micro[\s-]?ATX|m-?ATX|µATX|uATX)\b/i.test(t)) return 'Micro-ATX';
  if (/\bATX\b/i.test(t)) return 'ATX';
  return null;
}

const num = (m) => (m ? Number(m[1]) : null);

// Detecta specs relevantes para compatibilidad desde título/specs. `p.tags` del usuario tiene prioridad.
export function detectTags(p, cat) {
  const t = text(p);
  const tt = p.title || '';
  const auto = {};
  if (['cpu', 'motherboard'].includes(cat)) auto.socket = socketFrom(t, cat);
  if (cat === 'cooler') {
    // Los disipadores listan varios montajes ("LGA1700/1851, AM4/AM5"); guarda todos.
    const found = new Set();
    for (const m of t.matchAll(/\b(AM[45]|LGA\s?(?:1851|1700|1200|115X|1151))((?:\s?\/\s?(?:AM[45]|\d{4}))*)/gi)) {
      const base = m[1].toUpperCase().replace(/\s/g, '');
      found.add(base);
      for (const extra of (m[2] || '').split('/').map((x) => x.trim()).filter(Boolean)) found.add(/^AM/i.test(extra) ? extra.toUpperCase() : `LGA${extra}`);
    }
    auto.sockets = found.size ? [...found].join(', ') : null;
  }
  if (cat === 'cpu') {
    auto.tdp = num(tt.match(/(\d{2,3})\s?W\b/i)) ?? num(t.match(/TDP[^\d]{0,20}(\d{2,3})\s?W/i)) ?? cpuModel(p)?.[1] ?? (/Ryzen/i.test(t) ? 65 : null);
  }
  if (cat === 'motherboard' || cat === 'ram') auto.memType = (t.match(/\b(DDR5|DDR4)\b/i) || [])[1]?.toUpperCase() || (cat === 'motherboard' && ['AM5', 'LGA1851'].includes(auto.socket) ? 'DDR5' : null);
  if (cat === 'motherboard') {
    auto.formFactor = formFactorFrom(tt) || formFactorFrom(t);
    auto.m2Slots = num(t.match(/(\d)\s?(?:x|×)\s?M\.2/i)) ?? num(t.match(/(\d)\s?ranuras? M\.2/i));
    auto.sataPorts = num(t.match(/(\d)\s?(?:x|×)?\s?(?:puertos\s)?SATA/i));
  }
  if (cat === 'case') {
    auto.formFactor = formFactorFrom(tt) || formFactorFrom(t);
    auto.coolerMaxMm = num(t.match(/(?:cooler|disipador|enfriador)[^.\d]{0,40}(\d{3})\s?mm/i));
  }
  if (cat === 'cooler') auto.heightMm = num(t.match(/(?:altura|height|alto)[^\d]{0,15}(\d{3}(?:\.\d)?)\s?mm/i)) ?? num(tt.match(/(1[2-7]\d)\s?mm/i));
  if (cat === 'ram') {
    const m = t.match(/(\d)\s?[x×]\s?(\d{1,3})\s?GB/i);
    auto.sticks = m ? Number(m[1]) : null;
    auto.capacityGb = m ? Number(m[1]) * Number(m[2]) : num(tt.match(/(\d{1,3})\s?GB/i));
  }
  if (cat === 'psu') {
    auto.psuWatts = num(tt.match(/(\d{3,4})\s?(?:W|vatios|watts)\b/i)) ?? num(t.match(/Potencia[^:]*:\s*(\d{3,4})/i));
    auto.has12v2x6 = /12V-?2\s?x\s?6/i.test(t) ? true : /12VHPWR|ATX\s?3\.[01]/i.test(t) ? 'adaptable' : false;
  }
  if (cat === 'gpu') auto.needs12v2x6 = /RTX\s?(40|50)[5-9]0|12V-?2x6|12VHPWR|16[\s-]?pin/i.test(t);
  if (cat === 'storage') auto.interface = /NVMe|M\.2|PCIe/i.test(t) ? 'NVMe' : /SATA|2\.5|HDD|3\.5|RPM/i.test(t) ? 'SATA' : null;
  if (cat === 'fans') {
    const m = tt.match(/(?:paquete de|pack de|pack of)\s?(\d{1,2})|\((\d{1,2})\s?(?:pack|unidades|piezas)\)|\bX(\d{1,2})\b|(\d{1,2})[\s-]?pack/i);
    auto.count = m ? Number(m.slice(1).find(Boolean)) : 1;
  }

  const tags = { ...auto };
  for (const [k, v] of Object.entries(p.tags || {})) if (v !== '' && v != null) tags[k] = v;
  return tags;
}

// Busca el modelo primero en el título y luego en las specs; las viñetas suelen comparar con otros
// modelos («hasta 2× más rápida que la RTX 3060») y darían falsos positivos.
function findModel(p, table) {
  const specs = Object.values(p.specs || {}).join(' \n ');
  for (const src of [p.title || '', specs]) {
    const hit = table.find(([re]) => re.test(src));
    if (hit) return hit;
  }
  return null;
}
const cpuModel = (p) => findModel(p, CPU_WATTS);

const ARGB = /\bA?RGB\b/i;
// Ventiladores que trae incluidos una caja o un disipador (0 si no dice).
function includedFans(p, cat) {
  const t = text(p);
  const n = num(t.match(/(\d{1,2})\s?(?:x\s?)?(?:pre-?installed|preinstalados?|incluidos?)\b[^.\n]{0,20}fans?/i))
    ?? num(t.match(/(\d{1,2})\s?x?\s?(?:[A-Z]{2,}\s){0,3}(?:A?RGB\s)?(?:PWM\s)?fans?\s(?:pre-?installed|included)/i))
    ?? num(t.match(/\b(\d{1,2})\s(?:A?RGB\s|PWM\s)*fans\b/i));
  if (n) return n;
  if (cat === 'cooler') {
    if (/\b(?:double|dual|twin|two|2\s?x)\s(?:\w+\s)?fans?\b/i.test(t)) return 2;
    const aio = t.match(/\b(240|280|360|420)(?:\s?mm)?\b/i);
    if (/AIO|liquid|líquida/i.test(t) && aio) return { 240: 2, 280: 2, 360: 3, 420: 3 }[aio[1]];
    return 1;
  }
  return 0;
}

export function estimateWatts(p, cat) {
  if (p.watts != null && p.watts !== '') return Number(p.watts) * (p.qty || 1);
  const tags = detectTags(p, cat);
  const t = text(p);
  const fanW = ARGB.test(t) ? 4 : 3; // un ventilador de 120 mm ≈ 2–3 W; el ARGB suma ~1 W
  let w = CAT[cat]?.watts ?? 0;
  if (cat === 'cpu') {
    const m = cpuModel(p);
    const titleTdp = num((p.title || '').match(/(\d{2,3})\s?W\b/i));
    w = m && !titleTdp ? m[2] : Math.round((Number(tags.tdp) || 65) * 1.35);
  }
  if (cat === 'gpu') w = (findModel(p, GPU_WATTS) || [0, GPU_FALLBACK_W])[1];
  if (cat === 'storage') w = /HDD|RPM|disco duro mec/i.test(t) ? 8 : tags.interface === 'NVMe' ? (/Gen\s?5|PCIe\s?5\.0\s?x4/i.test(p.title || '') ? 11 : 7) : 4;
  if (cat === 'ram') w = (ARGB.test(t) ? 6 : 5) * (Number(tags.sticks) || 2);
  if (cat === 'fans') w = fanW * (Number(tags.count) || 1);
  if (cat === 'case') w = fanW * includedFans(p, cat);
  if (cat === 'cooler') w = fanW * includedFans(p, cat) + (/AIO|liquid|líquida/i.test(t) ? 5 : 0);
  return w * (p.qty || 1);
}

// ¿El consumo sale de un modelo conocido o es un valor genérico? Para avisar en la interfaz.
export function wattsIsGuess(p, cat) {
  if (p.watts != null && p.watts !== '') return false;
  if (cat === 'gpu') return !findModel(p, GPU_WATTS);
  if (cat === 'cpu') return !cpuModel(p) && detectTags(p, cat).tdp == null;
  return false;
}

// Líneas seleccionadas del armado con su categoría.
export function selectedLines(build) {
  const out = [];
  for (const c of CATEGORIES) {
    const slot = build.parts?.[c.key];
    if (!slot) continue;
    for (const id of slot.selected || []) {
      const p = slot.options.find((o) => o.id === id);
      if (p) out.push({ cat: c.key, p });
    }
  }
  return out;
}

// Costo de un producto para Colombia. Amazon da los cargos de importación reales para cantidad 1;
// si no los da, se estima el IVA sobre precio+envío cuando el pedido supera el umbral.
export function lineCost(p, s = DEFAULT_SETTINGS) {
  const qty = Number(p.qty) || 1;
  const price = p.price != null ? Number(p.price) : null;
  if (price == null) return { qty, price: null, subtotal: null, shipping: null, importFees: null, total: null, overThreshold: false, feesSource: null };
  const subtotal = price * qty;
  const shipping = p.shipping != null ? Number(p.shipping) : null;
  const overThreshold = subtotal >= s.threshold;
  let importFees = null;
  let feesSource = null;
  if (p.importFees != null && qty === 1) { importFees = Number(p.importFees); feesSource = p.edited?.importFees ? 'editado' : 'amazon'; }
  else if (!p.manual) { importFees = overThreshold ? +(s.iva * (subtotal + (shipping || 0))).toFixed(2) : 0; feesSource = 'estimado'; }
  else { importFees = 0; feesSource = 'local'; }
  const total = +(subtotal + (shipping || 0) + (importFees || 0)).toFixed(2);
  return { qty, price, subtotal, shipping, importFees, total, overThreshold, feesSource, ivaIfOver: +(subtotal * (1 + s.iva)).toFixed(2) };
}

export function totals(build, s = DEFAULT_SETTINGS) {
  const lines = selectedLines(build);
  const r = { toBuy: 0, shipping: 0, importFees: 0, toBuyTotal: 0, spent: 0, planned: 0, orders: 0, amazonOrders: 0, overThreshold: 0, unknownPrice: 0, watts: 0, wattsNow: 0, fixed: 0, fixedTotal: 0, undecided: 0 };
  for (const { cat, p } of lines) {
    const st = p.status || 'buy';
    const w = estimateWatts(p, cat);
    r.watts += w;
    if (st !== 'planned') r.wattsNow += w;
    const c = lineCost(p, s);
    if (c.price == null) { if (st === 'buy') r.unknownPrice++; continue; }
    if (st === 'bought') r.spent += c.total; // lo pagado de verdad: con envío e impuestos
    else if (st === 'planned') r.planned += c.total;
    else {
      r.orders++;
      if (!p.manual) r.amazonOrders++;
      r.toBuy += c.subtotal;
      r.shipping += c.shipping || 0;
      r.importFees += c.importFees || 0;
      r.toBuyTotal += c.total;
      if (isFixed(p)) { r.fixed++; r.fixedTotal += c.total; } else if (pickLevel(p) === 0) r.undecided++;
      if (c.overThreshold && !p.manual) r.overThreshold++;
    }
  }
  for (const k of ['toBuy', 'shipping', 'importFees', 'toBuyTotal', 'spent', 'planned', 'fixedTotal']) r[k] = +r[k].toFixed(2);
  r.grand = +(r.toBuyTotal + r.spent + r.planned).toFixed(2);
  if (lines.length) { r.watts += BASE_WATTS; r.wattsNow += BASE_WATTS; }
  r.recommendedPsu = Math.ceil((r.watts * s.psuMargin) / 50) * 50;
  return r;
}

const first = (build, cat) => {
  const l = selectedLines(build).filter((x) => x.cat === cat);
  return l[0] ? { p: l[0].p, tags: detectTags(l[0].p, cat) } : null;
};
const FF_RANK = { 'Mini-ITX': 1, 'Micro-ATX': 2, ATX: 3, 'E-ATX': 4 };

// Revisiones de compatibilidad y compra. level: error | warn | ok | info
export function checks(build, s = DEFAULT_SETTINGS, now = Date.now()) {
  const out = [];
  const add = (level, title, detail, cats = []) => out.push({ level, title, detail, cats });
  const cpu = first(build, 'cpu'), mb = first(build, 'motherboard'), ram = first(build, 'ram'), gpu = first(build, 'gpu');
  const psu = first(build, 'psu'), kase = first(build, 'case'), cooler = first(build, 'cooler');
  const tot = totals(build, s);

  for (const c of CATEGORIES.filter((c) => c.essential)) {
    if (!build.parts?.[c.key]?.selected?.length) add('info', `Falta: ${c.name}`, 'Agrega un enlace de Amazon o un producto manual.', [c.key]);
  }

  if (cpu && mb) {
    if (cpu.tags.socket && mb.tags.socket) {
      if (cpu.tags.socket === mb.tags.socket) add('ok', `Socket ${cpu.tags.socket}`, 'CPU y placa madre usan el mismo socket.', ['cpu', 'motherboard']);
      else add('error', 'Socket incompatible', `CPU ${cpu.tags.socket} ≠ placa ${mb.tags.socket}.`, ['cpu', 'motherboard']);
    } else add('warn', 'Socket sin confirmar', 'No detecté el socket de la CPU o de la placa. Edítalo en el detalle del producto.', ['cpu', 'motherboard']);
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
      if (a <= b) add('ok', 'Placa cabe en la caja', `${mb.tags.formFactor} en caja ${kase.tags.formFactor}.`, ['motherboard', 'case']);
      else add('error', 'La placa no cabe', `Placa ${mb.tags.formFactor} en caja ${kase.tags.formFactor}.`, ['motherboard', 'case']);
    } else add('warn', 'Formato sin confirmar', 'Revisa que la caja admita el formato de la placa.', ['motherboard', 'case']);
  }
  if (cooler && kase) {
    if (cooler.tags.heightMm && kase.tags.coolerMaxMm) {
      if (cooler.tags.heightMm <= kase.tags.coolerMaxMm) add('ok', 'Altura del disipador', `${cooler.tags.heightMm} mm ≤ ${kase.tags.coolerMaxMm} mm de la caja.`, ['cooler', 'case']);
      else add('error', 'Disipador muy alto', `${cooler.tags.heightMm} mm > ${kase.tags.coolerMaxMm} mm que admite la caja.`, ['cooler', 'case']);
    } else add('warn', 'Altura del disipador sin confirmar', 'Anota la altura del disipador y el máximo de la caja en sus detalles.', ['cooler', 'case']);
  }
  if (cooler && cpu?.tags.socket) {
    const list = String(cooler.tags.sockets || '').toUpperCase().split(/[\s,/]+/).filter(Boolean);
    if (list.includes(cpu.tags.socket)) add('ok', `Disipador compatible con ${cpu.tags.socket}`, `Montajes: ${cooler.tags.sockets}.`, ['cooler', 'cpu']);
    else if (list.length) add('error', 'Disipador sin montaje para la CPU', `Montajes detectados: ${cooler.tags.sockets}; la CPU es ${cpu.tags.socket}.`, ['cooler', 'cpu']);
    else add('warn', 'Montaje del disipador sin confirmar', `Confirma que incluye montaje ${cpu.tags.socket}.`, ['cooler', 'cpu']);
  }

  if (psu) {
    const w = Number(psu.tags.psuWatts);
    if (w) {
      const need = tot.watts * s.psuMargin;
      if (w >= need) add('ok', `Fuente ${w} W`, `Consumo estimado ${tot.watts} W (recomendado ≥ ${tot.recommendedPsu} W con margen ×${s.psuMargin}).`, ['psu']);
      else if (w >= tot.watts) add('warn', 'Fuente justa', `${w} W para ~${tot.watts} W estimados; se recomiendan ${tot.recommendedPsu} W.`, ['psu']);
      else add('error', 'Fuente insuficiente', `${w} W para ~${tot.watts} W estimados.`, ['psu']);
    } else add('warn', 'Potencia de la fuente sin detectar', 'Anota los vatios en el detalle del producto.', ['psu']);
    if (gpu?.tags.needs12v2x6) {
      if (psu.tags.has12v2x6 === true) add('ok', 'Conector 12V-2x6', 'La fuente trae 12V-2x6 nativo para la GPU.', ['psu', 'gpu']);
      else if (psu.tags.has12v2x6 === 'adaptable') add('warn', '12VHPWR / ATX 3.0', 'La fuente menciona 12VHPWR o ATX 3.x pero no 12V-2x6. Confírmalo.', ['psu', 'gpu']);
      else add('error', 'Falta conector 12V-2x6', 'La GPU necesita 12V-2x6 y la fuente no lo menciona.', ['psu', 'gpu']);
    }
  }

  if (mb) {
    const drives = selectedLines(build).filter((l) => l.cat === 'storage');
    const nvme = drives.filter((l) => detectTags(l.p, 'storage').interface === 'NVMe').reduce((a, l) => a + (Number(l.p.qty) || 1), 0);
    const sata = drives.filter((l) => detectTags(l.p, 'storage').interface === 'SATA').reduce((a, l) => a + (Number(l.p.qty) || 1), 0);
    if (mb.tags.m2Slots != null && nvme > mb.tags.m2Slots) add('error', 'Faltan ranuras M.2', `${nvme} NVMe para ${mb.tags.m2Slots} ranuras.`, ['storage', 'motherboard']);
    if (mb.tags.sataPorts != null && sata > mb.tags.sataPorts) add('error', 'Faltan puertos SATA', `${sata} discos SATA para ${mb.tags.sataPorts} puertos.`, ['storage', 'motherboard']);
    if (sata && !selectedLines(build).some((l) => l.cat === 'accessories' && /SATA/i.test(l.p.title || ''))) add('info', 'Cables SATA', `Tienes ${sata} disco(s) SATA; la placa suele traer solo 2 cables.`, ['accessories']);
  }

  for (const { cat, p } of selectedLines(build)) {
    const st = p.status || 'buy';
    if (st === 'bought' || p.manual) continue;
    const name = shortTitle(p.title);
    if (p.shipsToCO === false) add('error', 'No se envía a Colombia', name, [cat]);
    if (p.condition && p.condition !== 'Nuevo') add('error', 'No es nuevo', `${name}: ${p.condition}`, [cat]);
    if (p.price == null && p.url) add('warn', 'Sin precio', `${name}: sin oferta disponible o sin datos. Actualiza el producto.`, [cat]);
    const c = lineCost(p, s);
    if (st === 'buy' && c.overThreshold) add('warn', `Supera US$${s.threshold}`, `${name}: US$${c.subtotal.toFixed(2)} → paga IVA (cargos ${c.feesSource === 'amazon' ? 'según Amazon' : 'estimados'} US$${(c.importFees || 0).toFixed(2)}).`, [cat]);
    if (p.fetchedAt && now - Date.parse(p.fetchedAt) > s.staleDays * 864e5) add('info', 'Precio desactualizado', `${name}: revisado hace ${Math.round((now - Date.parse(p.fetchedAt)) / 864e5)} días.`, [cat]);
    if (p.targetPrice && p.price != null && p.price <= p.targetPrice) add('ok', '¡Precio objetivo alcanzado!', `${name}: US$${p.price} ≤ US$${p.targetPrice}.`, [cat]);
  }

  // Decisión por estrellas: el nivel vive en el producto, así que un «fijo» puede quedar fuera del armado.
  for (const c of CATEGORIES) {
    const sl = build.parts?.[c.key];
    if (!sl?.options?.length) continue;
    const fixed = sl.options.filter(isFixed);
    const outside = fixed.filter((p) => !(sl.selected || []).includes(p.id));
    if (outside.length) add('warn', `Fijo sin elegir: ${c.name}`, `Marcaste como fijo ${outside.map((p) => shortTitle(p.title, 40)).join(', ')}, pero el armado usa otra opción.`, [c.key]);
    if (!c.multi && fixed.length > 1) add('warn', `Dos fijos en ${c.name}`, `${fixed.length} opciones marcadas ★★★ y solo va una: ${fixed.map((p) => shortTitle(p.title, 30)).join(' · ')}.`, [c.key]);
  }
  const buying = selectedLines(build).filter(({ p }) => (p.status || 'buy') === 'buy');
  if (buying.length) {
    const pending = buying.filter(({ p }) => !isFixed(p));
    if (!pending.length) add('ok', 'Todo lo por comprar está decidido', `${buying.length} producto(s) marcados ★★★ fijo.`, []);
    else add('info', `${pending.length} por decidir`, `Sin marcar ★★★ fijo: ${pending.map(({ p }) => `${shortTitle(p.title, 28)} (${pickOf(p).stars})`).join(' · ')}.`, [pending[0].cat]);
  }
  return out;
}

export function shortTitle(t = '', n = 60) {
  let s = String(t).split(/[,|–—](?![^(]*\))/)[0].trim(); // no corta dentro de paréntesis
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function toMarkdown(build, s = DEFAULT_SETTINGS) {
  const t = totals(build, s);
  const rows = selectedLines(build).map(({ cat, p }) => {
    const c = lineCost(p, s);
    const price = c.price == null ? '—' : `US$${c.subtotal.toFixed(2)}`;
    const total = c.total == null ? '—' : `**US$${c.total.toFixed(2)}**`;
    const link = p.url ? `[${shortTitle(p.title, 70)}](${p.url})` : shortTitle(p.title, 70);
    return `| ${CAT[cat].name} | ${link} | ${STATUS[p.status || 'buy'].label} | ${pickOf(p).stars} | ${total} | ${price} | ${c.shipping == null ? '—' : 'US$' + c.shipping.toFixed(2)} | ${c.importFees == null ? '—' : 'US$' + c.importFees.toFixed(2)} | ${c.price == null ? '—' : c.overThreshold ? 'No' : 'Sí'} |`;
  });
  return [
    `# ${build.name}`,
    '',
    '| Pieza | Producto | Estado | Decisión | Total en CO | Precio | Envío CO | Cargos import. | <$' + s.threshold + ' |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `**Por comprar:** US$${t.toBuyTotal.toFixed(2)} (${t.orders} pedidos) · **Ya comprado:** US$${t.spent.toFixed(2)} · **Planeado:** US$${t.planned.toFixed(2)}`,
    `**Decididos (★★★):** ${t.fixed} por US$${t.fixedTotal.toFixed(2)}${t.undecided ? ` · **sin decidir:** ${t.undecided}` : ''}`,
    `**Consumo estimado:** ${t.watts} W · fuente recomendada ≥ ${t.recommendedPsu} W`,
  ].join('\n');
}

// ---------- lecturas de Amazon con tu sesión ----------
// Todo lo que viene de Amazon se reescribe completo en cada lectura (incluida la foto).
// Lo del usuario (estado, cantidad, notas, etiquetas, precio objetivo, consumo, historial) se conserva.
export const AMAZON_FIELDS = ['asin', 'url', 'title', 'image', 'brand', 'deliverTo', 'price', 'currency', 'shipping', 'importFees', 'importFeesInfo', 'total', 'seller', 'shipsFrom', 'availability', 'shipsToCO', 'locationOk', 'rating', 'reviews', 'hasBuybox', 'condition', 'priceSource', 'loggedIn', 'fetchedAt', 'specs', 'bullets', 'offers', 'debug', 'displayed', 'fx'];
const EMPTY = { specs: () => ({}), bullets: () => [], offers: () => [] };

// Tu sesión encontró en Amazon un precio con envío a Colombia confirmado.
export const hasColombiaPrice = (d) => d?.price != null && d.shipsToCO === true && d.locationOk !== false;

// Reescribe el producto con una lectura de tu sesión. Lo editado a mano se conserva, salvo que la lectura traiga
// un precio con envío a Colombia: entonces Amazon reemplaza todo y se quitan las marcas de edición.
// Devuelve { keptEdits, replacedEdits } con los campos editados que se conservaron o se reemplazaron.
export function applySession(p, d) {
  const edited = Object.keys(p.edited || {});
  const keep = edited.length && !hasColombiaPrice(d) ? new Set(edited) : null;
  for (const k of AMAZON_FIELDS) if (!keep?.has(k)) p[k] = d[k] ?? EMPTY[k]?.() ?? null;
  if (!keep) delete p.edited;
  p.source = 'sesion';
  p.manual = false; // un producto manual vinculado a Amazon pasa a actualizarse como cualquier otro
  delete p.sessionFetchedAt; // campo de la versión con servidor

  p.history ||= [];
  const last = p.history.at(-1);
  const snap = { t: d.fetchedAt, price: p.price, shipping: p.shipping, importFees: p.importFees };
  if (!last || last.price !== snap.price || last.shipping !== snap.shipping || Date.parse(snap.t) - Date.parse(last.t) > 12 * 3600e3) p.history.push(snap);
  if (p.history.length > 120) p.history.splice(0, p.history.length - 120);
  return { keptEdits: keep ? edited : [], replacedEdits: keep ? [] : edited };
}

// ---------- edición manual ----------
// Campos del producto que se pueden editar a mano: [campo, etiqueta, tipo].
export const EDITABLE_FIELDS = [
  ['title', 'Título', 'text'],
  ['image', 'Foto (URL)', 'url'],
  ['price', 'Precio (US$)', 'number'],
  ['shipping', 'Envío a Colombia (US$)', 'number'],
  ['importFees', 'Cargos de importación (US$)', 'number'],
  ['seller', 'Vendedor', 'text'],
  ['availability', 'Disponibilidad', 'text'],
  ['shipsToCO', '¿Envía a Colombia?', 'bool'],
];
export const EDIT_LABELS = { title: 'título', image: 'foto', price: 'precio', shipping: 'envío', importFees: 'cargos de importación', seller: 'vendedor', availability: 'disponibilidad', shipsToCO: 'si envía a Colombia' };
export const editedLabels = (fields) => fields.map((k) => EDIT_LABELS[k] || k).join(', ');

// Aplica lo editado a mano. Con track (productos con enlace de Amazon), marca los campos cambiados para que
// el actualizador no los sobrescriba. Devuelve los campos que cambiaron.
export function applyEdits(p, values, { track = true, now = new Date().toISOString() } = {}) {
  const changed = [];
  for (const [k] of EDITABLE_FIELDS) {
    if (!(k in values)) continue;
    const norm = (x) => (x === '' || x === undefined ? null : x); // vacío y sin dato son lo mismo
    const v = norm(values[k]);
    if (norm(p[k]) === v) continue;
    p[k] = v;
    changed.push(k);
  }
  if (!changed.length) return changed;
  if (track) p.edited = { ...(p.edited || {}), ...Object.fromEntries(changed.map((k) => [k, now])) };
  if (changed.includes('importFees')) p.importFeesInfo = p.importFees == null ? null : 'manual';
  if (changed.some((k) => ['price', 'shipping', 'importFees'].includes(k))) {
    p.history ||= [];
    p.history.push({ t: now, price: p.price, shipping: p.shipping, importFees: p.importFees, source: 'manual' });
  }
  return changed;
}
