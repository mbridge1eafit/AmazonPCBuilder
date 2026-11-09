// Lógica pura del armador: categorías, detección de specs, compatibilidad, consumo y totales.
// Sin DOM, para poder probarla con `node --test`.
import { STORES, STORE_KEYS } from './stores.js';

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
  // external: se conecta al enchufe, no a la fuente del PC (cuenta para el protector de picos, no para la fuente).
  { key: 'monitor', name: 'Monitor', short: 'Monitor', multi: true, watts: 0, external: true },
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

export const DEFAULT_SETTINGS = { trm: 3160, threshold: 200, iva: 0.19, miamiTax: 0.07, psuMargin: 1.3, staleDays: 3, refreshMinutes: 10 };

// Destino de compra de cada producto: Colombia (por defecto, importado) o Miami (dirección en EE. UU.).
// Cada producto solo se actualiza con lecturas de su destino: una sesión en Miami nunca pisa precios a Colombia y viceversa.
export const MARKETS = { co: { label: 'Colombia', region: 'co' }, miami: { label: 'Miami', region: 'us' } };
export const marketOf = (p) => (p?.market === 'miami' ? 'miami' : 'co');
export const isMiami = (p) => marketOf(p) === 'miami';
export const marketLabel = (p) => MARKETS[marketOf(p)].label;

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
  if (isMiami(p)) {
    const out = REQUIRED.filter(([k]) => !['importFees', 'shipsToCO'].includes(k) && (p[k] == null || p[k] === '')).map(([, label]) => label);
    if (!p.specs || !Object.keys(p.specs).length) out.push('especificaciones');
    if (p.region && p.region !== 'us') out.push('entrega en Miami');
    return out;
  }
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

// Protector de picos: regletas con protección (no las UPS), por el título.
export const isSurgeProtector = (p) => /surge\s?(?:protector|suppressor|arrest)|supresor(?:es)? de picos|protector(?:es)? de (?:picos|sobretensi[oó]n)/i.test(p?.title || '')
  && !/\bUPS\b|battery back-?up|respaldo de bater[ií]a/i.test(p?.title || '');
// Para revisar el protector: el PC se mide en el enchufe (fuente 80 Plus Gold/Platinum ≈ 90 % de eficiencia).
const WALL_EFFICIENCY = 0.9;
const SURGE_MIN_JOULES = 1000;
const SURGE_DEFAULT_W = 1800; // regleta estándar de 15 A a 120 V

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

function m2SlotsFrom(t) {
  if (/\b(?:triple|three)\s+(?:connectors?|slots?|ranuras?|puertos?)?\s*M\.2\b/i.test(t) || /\bM\.2\s+(?:triple)\b/i.test(t)) return 3;
  if (/\b(?:quad(?:ruple)?|four)\s+(?:connectors?|slots?|ranuras?|puertos?)?\s*M\.2\b/i.test(t)) return 4;
  if (/\b(?:dual|two)\s+(?:connectors?|slots?|ranuras?|puertos?)?\s*M\.2\b/i.test(t)) return 2;
  if (/\b(?:five)\s+(?:connectors?|slots?|ranuras?|puertos?)?\s*M\.2\b/i.test(t)) return 5;
  const total = t.match(/(\d)\s?(?:x|×)?\s*M\.2\s*(?:slots?|sockets?|connectors?|ranuras?|puertos?)\b/i)
    || t.match(/(\d)\s*(?:ranuras?|puertos?|slots?)\s*M\.2\b/i)
    || t.match(/hasta\s*(\d)\s*M\.2\b/i);
  if (total) return Number(total[1]);
  const genMatches = [...t.matchAll(/(\d)\s?(?:x|×)\s?M\.2(?:\s?Gen\s?\d|\s?PCIe|\s?NVMe)?\s*(?:x\d)?\s*(?:slots?|ranuras?)?/gi)];
  if (genMatches.length > 1) {
    const sum = genMatches.reduce((acc, m) => acc + Number(m[1]), 0);
    if (sum > 0 && sum <= 8) return sum;
  }
  const standard = t.match(/(\d)\s?(?:x|×)\s?M\.2/i) || t.match(/(\d)\s?ranuras? M\.2/i);
  return standard ? Number(standard[1]) : null;
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
    auto.m2Slots = m2SlotsFrom(t);
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
  if (cat === 'storage') Object.assign(auto, storageTags(p, t));
  if (cat === 'fans') {
    const m = tt.match(/(?:paquete de|pack de|pack of)\s?(\d{1,2})|\((\d{1,2})\s?(?:pack|unidades|piezas)\)|\bX(\d{1,2})\b|(\d{1,2})[\s-]?pack/i);
    // «Triple Pack», «Dual Pack», «pack doble»…: la cantidad viene en palabras.
    const w = tt.match(/\b(?:(dual|twin|triple|quad)[\s-]?pack|(?:pack|paquete)\s(doble|triple|cu[aá]druple))\b/i);
    const words = { dual: 2, twin: 2, doble: 2, triple: 3, quad: 4, 'cuádruple': 4, cuadruple: 4 };
    auto.count = m ? Number(m.slice(1).find(Boolean)) : w ? words[(w[1] || w[2]).toLowerCase()] : 1;
  }
  if (isSurgeProtector(p)) {
    const j = t.match(/(\d{1,2},\d{3}|\d{3,5})\s?-?\s?(?:joules?|julios?|J)\b/i);
    auto.joules = j ? Number(j[1].replace(',', '')) : null;
    auto.outlets = num(tt.match(/(\d{1,2})[\s-]?(?:AC\s)?(?:outlets?|tomas?|tomacorrientes)\b/i))
      ?? num(t.match(/(?:Number of Outlets|Total Power Outlets|N[uú]mero de tomas)[^\d\n]{0,5}(\d{1,2})/i))
      ?? num(t.match(/(\d{1,2})[\s-]?(?:AC\s)?(?:outlets?|tomas?)\b/i));
    // Capacidad: los vatios si los dice; si no, los amperios del breaker a 120 V.
    const amps = num(t.match(/\b(1[05]|20)\s?(?:A|amps?|amperios)\b/i));
    auto.capacityW = num(t.match(/\b(1[5-9]\d{2}|[23]\d{3})\s?(?:W|watts?|vatios)\b/i)) ?? (amps ? amps * 120 : null);
    // VPR (UL 1449): si da varias vías («330/400/400») se toma la peor.
    const v = t.match(/(?:VPR|clamping(?: voltage| level)?|let[\s-]through(?: rating| voltage)?|voltage protection rating|voltaje de (?:limitaci[oó]n|sujeci[oó]n))[^\d\n]{0,40}(\d{3}(?:\s?\/\s?\d{3})*)/i)
      || t.match(/(\d{3})\s?V\s(?:clamping|VPR|voltage clamping|let[\s-]through)/i);
    auto.vpr = v ? Math.max(...v[1].split('/').map(Number)) : null;
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
  if (cat === 'monitor') w = monitorSpecWatts(p) ?? monitorSizeWatts(p);
  return w * (p.qty || 1);
}

// Monitores: el consumo de la ficha («Consumo: ≤42 W», «Power Consumption 35W») o uno típico por tamaño.
const monitorSpecWatts = (p) => num(text(p).match(/(?:power consumption|consumo(?: de energ[ií]a)?|typical power|wattage)[^\d\n]{0,25}(\d{2,3})\s?(?:W|watts?|vatios)\b/i));
function monitorSizeWatts(p) {
  const size = Number((text(p).match(/(\d{2}(?:\.\d)?)\s?(?:"|”|″|''|-?inch\b|in\b|pulgadas)/i) || [])[1]) || parseFloat(p.specs?.['Screen Size']) || 27;
  return size >= 34 ? 60 : size >= 30 ? 50 : size >= 26 ? 40 : 30;
}

// ¿El consumo sale de un modelo conocido o es un valor genérico? Para avisar en la interfaz.
export function wattsIsGuess(p, cat) {
  if (p.watts != null && p.watts !== '') return false;
  if (cat === 'monitor') return monitorSpecWatts(p) == null;
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
  if (isMiami(p) && (!p.manual || p.salesTax)) {
    // Miami: compra en EE. UU., sin cargos de importación. Sales tax estimado (Miami-Dade 7 %) sobre el producto;
    // el exacto solo lo da el checkout.
    const rate = s.miamiTax ?? DEFAULT_SETTINGS.miamiTax;
    const tax = p.edited?.importFees && p.importFees != null ? Number(p.importFees) : +(rate * subtotal).toFixed(2);
    const total = +(subtotal + (shipping || 0) + tax).toFixed(2);
    return { qty, price, subtotal, shipping, importFees: tax, total, overThreshold: false, feesSource: p.edited?.importFees ? 'editado' : 'tax-miami', ivaIfOver: total };
  }
  const overThreshold = subtotal >= s.threshold;
  let importFees = null;
  let feesSource = null;
  if (p.importFees != null && qty === 1) { importFees = Number(p.importFees); feesSource = p.edited?.importFees ? 'editado' : 'amazon'; }
  else if (!p.manual) { importFees = overThreshold ? +(s.iva * (subtotal + (shipping || 0))).toFixed(2) : 0; feesSource = 'estimado'; }
  else { importFees = 0; feesSource = 'local'; }
  const total = +(subtotal + (shipping || 0) + (importFees || 0)).toFixed(2);
  return { qty, price, subtotal, shipping, importFees, total, overThreshold, feesSource, ivaIfOver: +(subtotal * (1 + s.iva)).toFixed(2) };
}

// ---------- precio pagado ----------
// Lo ya comprado vale lo que pagaste (fijo); el precio de Amazon se sigue leyendo para ver si subió o bajó.
export const paidTotal = (p) => (p?.paid?.total != null ? Number(p.paid.total) : null);

// Lo pagado por un artículo según la factura de su pedido. Si el pedido trae varios artículos, el envío neto,
// los cargos y los impuestos del pedido se reparten según el valor de cada uno (exacto si no hubo nada que repartir).
export function paidFromInvoice(inv, it, by = 'asin') {
  if (!inv || !it || inv.total == null) return null;
  const qty = Number(it.qty) || 1;
  const line = it.price != null ? +(it.price * qty).toFixed(2) : null;
  const single = (inv.items || []).length === 1;
  const sub = inv.subtotal ?? (inv.items || []).reduce((a, x) => a + (x.price ?? 0) * (Number(x.qty) || 1), 0);
  if (!single && (line == null || !sub)) return null;
  const extra = +(inv.total - sub).toFixed(2);
  const share = single ? 1 : line / sub;
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    total: single ? inv.total : r2(line + extra * share),
    price: it.price ?? null, qty, currency: inv.currency === 'COP' ? 'COP' : 'USD',
    shipping: r2(Math.max(0, (inv.shipping ?? 0) - (inv.discounts ?? 0)) * share),
    importFees: r2((inv.importFees ?? 0) * share),
    date: inv.date || null, orderId: inv.orderId || '', items: (inv.items || []).length,
    source: 'pedido', exact: single || extra === 0, by,
  };
}

// Parecido entre títulos (la marca va primero): fracción de palabras del más corto que están en el otro.
const STOP = new Set(['the', 'and', 'for', 'with', 'con', 'para', 'del', 'las', 'los', 'black', 'white', 'negro', 'blanco']);
const words = (t) => new Set(String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)));
export function titleMatch(a, b) {
  const brand = (t) => String(t || '').trim().split(/\s+/)[0].toLowerCase();
  if (!brand(a) || brand(a) !== brand(b)) return 0;
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

// Texto para buscarlo por nombre en tus pedidos: las tres primeras palabras del título (marca y modelo).
export const orderQuery = (title) => String(title || '').replace(/[™®©]/g, '').split(/[\s,|–—]+/).filter((w) => /[a-z0-9]/i.test(w)).slice(0, 3).join(' ');

// Busca el producto en las facturas (la más reciente primero): por ASIN y, si no está (otra variante), por nombre.
export function findPaid(p, invoices) {
  const list = [...(invoices || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  for (const inv of list) {
    const it = inv.items.find((x) => x.asin === p.asin);
    if (it) return paidFromInvoice(inv, it, 'asin');
  }
  let best = null;
  for (const inv of list) for (const it of inv.items) {
    const score = titleMatch(p.title, it.title);
    if (score >= 0.7 && (!best || score > best.score)) best = { inv, it, score };
  }
  return best ? { ...paidFromInvoice(best.inv, best.it, 'nombre'), matchedTitle: best.it.title } : null;
}

// Cuánto cambió el precio en Amazon (con envío e impuestos a Colombia) respecto a lo que pagaste.
export function paidChange(p, s = DEFAULT_SETTINGS) {
  const paid = paidTotal(p);
  if (paid == null || p.manual) return null;
  const now = lineCost(p, s).total;
  if (now == null) return null;
  const diff = +(now - paid).toFixed(2);
  return { paid, now, diff, pct: paid ? Math.round((diff / paid) * 100) : null };
}

export function totals(build, s = DEFAULT_SETTINGS) {
  const lines = selectedLines(build);
  const r = { toBuy: 0, shipping: 0, importFees: 0, toBuyTotal: 0, spent: 0, planned: 0, orders: 0, amazonOrders: 0, overThreshold: 0, unknownPrice: 0, watts: 0, wattsNow: 0, externalWatts: 0, fixed: 0, fixedTotal: 0, undecided: 0, boughtNoPaid: 0 };
  for (const { cat, p } of lines) {
    const st = p.status || 'buy';
    const w = estimateWatts(p, cat);
    if (CAT[cat]?.external) r.externalWatts += w; // monitores: al enchufe, no a la fuente
    else {
      r.watts += w;
      if (st !== 'planned') r.wattsNow += w;
    }
    if (st === 'bought' && paidTotal(p) != null) { r.spent += paidTotal(p); continue; } // lo pagado no fluctúa
    if (st === 'bought') r.boughtNoPaid++;
    const c = lineCost(p, s);
    if (c.price == null) { if (st === 'buy') r.unknownPrice++; continue; }
    if (st === 'bought') r.spent += c.total; // sin precio pagado: el de hoy (con envío e impuestos)
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

  // Protector de picos: debe aguantar el PC (en el enchufe, con lo planeado) y los monitores, con una toma para cada uno.
  const lines = selectedLines(build);
  if (lines.some((l) => CAT[l.cat].essential)) {
    const pcWall = Math.round(tot.watts / WALL_EFFICIENCY);
    const monitors = lines.filter((l) => CAT[l.cat].external);
    const nMon = monitors.reduce((a, l) => a + (Number(l.p.qty) || 1), 0);
    const devices = 1 + nMon;
    const load = pcWall + tot.externalWatts;
    const who = `PC ~${pcWall} W en el enchufe${tot.watts !== tot.wattsNow ? ' (con lo planeado)' : ''}${nMon ? ` + ${nMon} monitor${nMon === 1 ? '' : 'es'} ${tot.externalWatts} W` : ''}`;
    const surges = lines.filter(({ p }) => isSurgeProtector(p));
    if (!surges.length) add('info', 'Sin protector de picos', `Para ${who}: busca ≥ ${SURGE_MIN_JOULES} J, VPR ≤ 400 V y al menos ${devices} tomas.`, ['accessories']);
    for (const { cat, p } of surges) {
      const tg = detectTags(p, cat);
      const name = shortTitle(p.title, 40);
      const cap = Number(tg.capacityW) || SURGE_DEFAULT_W;
      const capText = tg.capacityW ? `${cap} W` : `${cap} W (15 A estándar, sin confirmar)`;
      const pct = Math.round((load / cap) * 100);
      const cats = [cat, ...(nMon ? ['monitor'] : [])];
      const problems = [];
      if (load > cap) problems.push(['error', 'Protector de picos sobrecargado', `${name}: ${load} W para ${capText}. ${who}.`]);
      else if (load > cap * 0.8) problems.push(['warn', 'Protector de picos al límite', `${name}: ${load} W de ${capText} (${pct} %); deja 20 % de margen. ${who}.`]);
      if (tg.joules == null) problems.push(['warn', 'Julios del protector sin confirmar', `${name}: anota los julios en su detalle (para PC y monitores, ≥ ${SURGE_MIN_JOULES} J).`]);
      else if (tg.joules < SURGE_MIN_JOULES) problems.push(['warn', 'Protector de picos con poca protección', `${name}: ${tg.joules} J; para PC y monitores se recomiendan ≥ ${SURGE_MIN_JOULES} J.`]);
      if (tg.vpr != null && tg.vpr > 500) problems.push(['warn', 'Protector deja pasar mucho voltaje', `${name}: VPR ${tg.vpr} V; busca ≤ 400 V.`]);
      if (tg.outlets != null && devices > tg.outlets) problems.push(['error', 'Faltan tomas en el protector', `${name}: ${devices} equipos (PC y ${nMon} monitor${nMon === 1 ? '' : 'es'}) para ${tg.outlets} tomas.`]);
      for (const [level, title, detail] of problems) add(level, title, detail, cats);
      if (!problems.length) add('ok', 'Protector de picos suficiente', `${name}: ${load} W de ${capText} (${pct} %) · ${tg.joules} J · ${tg.vpr ? `VPR ${tg.vpr} V` : 'VPR sin confirmar'}${tg.outlets ? ` · ${devices} de ${tg.outlets} tomas` : ''}. ${who}.`, cats);
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
    if (p.shipsToCO === false && !isMiami(p)) add('error', 'No se envía a Colombia', name, [cat]);
    if (p.condition && p.condition !== 'Nuevo') add('error', 'No es nuevo', `${name}: ${p.condition}`, [cat]);
    if (p.price == null && p.url) add('warn', 'Sin precio', `${name}: sin oferta disponible o sin datos. Actualiza el producto.`, [cat]);
    const c = lineCost(p, s);
    if (st === 'buy' && c.overThreshold) add('warn', `Supera US$${s.threshold}`, `${name}: US$${c.subtotal.toFixed(2)} → paga IVA (cargos ${c.feesSource === 'amazon' ? 'según Amazon' : 'estimados'} US$${(c.importFees || 0).toFixed(2)}).`, [cat]);
    if (p.fetchedAt && now - Date.parse(p.fetchedAt) > s.staleDays * 864e5) add('info', 'Precio desactualizado', `${name}: revisado hace ${Math.round((now - Date.parse(p.fetchedAt)) / 864e5)} días.`, [cat]);
    if (p.targetPrice && p.price != null && p.price <= p.targetPrice) add('ok', '¡Precio objetivo alcanzado!', `${name}: US$${p.price} ≤ US$${p.targetPrice}.`, [cat]);
  }

  // Lo ya comprado: precio pagado registrado y cambios del precio de Amazon desde la compra.
  const bought = selectedLines(build).filter(({ p }) => p.status === 'bought');
  const noPaid = bought.filter(({ p }) => paidTotal(p) == null);
  if (noPaid.length) add('info', `${noPaid.length} comprado${noPaid.length === 1 ? '' : 's'} sin precio pagado`, `El total usa su precio de hoy, que cambia. Regístralo con «🧾 Precio pagado»: ${noPaid.map(({ p }) => shortTitle(p.title, 28)).join(' · ')}.`, [noPaid[0].cat]);
  for (const { cat, p } of bought) {
    const ch = paidChange(p, s);
    if (ch && ch.diff <= -1) add('info', 'Bajó de precio desde tu compra', `${shortTitle(p.title, 40)}: pagaste US$${ch.paid.toFixed(2)}; hoy US$${ch.now.toFixed(2)} (−US$${Math.abs(ch.diff).toFixed(2)}).`, [cat]);
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
    const paid = p.status === 'bought' ? paidTotal(p) : null;
    const price = c.price == null ? '—' : `US$${c.subtotal.toFixed(2)}`;
    const total = paid != null ? `**US$${paid.toFixed(2)}** (pagado)` : c.total == null ? '—' : `**US$${c.total.toFixed(2)}**`;
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
export const AMAZON_FIELDS = ['asin', 'url', 'title', 'image', 'brand', 'deliverTo', 'price', 'currency', 'shipping', 'importFees', 'importFeesInfo', 'total', 'seller', 'shipsFrom', 'availability', 'shipsToCO', 'locationOk', 'rating', 'reviews', 'hasBuybox', 'condition', 'priceSource', 'loggedIn', 'fetchedAt', 'specs', 'bullets', 'offers', 'debug', 'displayed', 'fx', 'region'];
const EMPTY = { specs: () => ({}), bullets: () => [], offers: () => [] };

// Tu sesión encontró en Amazon un precio con envío a Colombia confirmado.
export const hasColombiaPrice = (d) => d?.price != null && d.shipsToCO === true && d.locationOk !== false;

// Reescribe el producto con una lectura de tu sesión. Lo editado a mano se conserva, salvo que la lectura traiga
// un precio con envío a Colombia: entonces Amazon reemplaza todo y se quitan las marcas de edición.
// Devuelve { keptEdits, replacedEdits } con los campos editados que se conservaron o se reemplazaron.
export function applySession(p, d) {
  // Un producto nuevo (sin lecturas) toma el destino de la sesión que lo lee por primera vez.
  if (!p.fetchedAt && p.market == null && d.region === 'us') p.market = 'miami';
  const want = MARKETS[marketOf(p)].region;
  // Lectura de otro destino (p. ej. sesión en Miami para un producto a Colombia): no se toca nada.
  if ((d.region && d.region !== want) || (!d.region && want === 'us')) return { skipped: true, want: marketOf(p), got: d.region || null, keptEdits: [], replacedEdits: [] };
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
// ---------- características de las opciones (para ordenar y filtrar) ----------
// Se leen de la ficha (specs de Amazon, en inglés o español), del título y de las viñetas, con unidades normalizadas.
// Numéricas: se ordenan y se filtran por umbral (better: 'high' = más es mejor, 'low' = menos es mejor). type 'cat': por valor.

// «7,450» y «7.450» son miles; «4,2» es decimal.
const toNum = (s) => {
  const t = String(s ?? '').trim().replace(/[.,]$/, '');
  if (!t) return null;
  const n = Number(/^\d{1,3}([.,]\d{3})+$/.test(t) ? t.replace(/[.,]/g, '') : t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const largest = (a) => Math.max(...a);
const smallest = (a) => Math.min(...a);
const within = (lo, hi) => (n) => (n != null && n >= lo && n <= hi ? n : null);
// Frecuencia en GHz dentro de [lo, hi]. Amazon mezcla unidades («2300 gigahertz», «2.5 kilohertz»): manda la magnitud.
const ghz = (lo, hi) => (n) => (n == null ? null : n >= lo * 1000 && n <= hi * 1000 ? n / 1000 : n >= lo && n <= hi ? n : null);
const FREQ = /(\d+(?:[.,]\d+)?)\s?(?:[GMk]Hz|gigahertz|megahertz|kilohertz)\b/gi;

// Número de una característica: las specs cuyo nombre coincide con keys y lo que diga el título (re, con unidad);
// si no hay nada, el resto de specs y las viñetas. conv normaliza y descarta lo imposible; agg elige entre varios.
function numFeature(p, { keys, re, conv = (n) => n, agg = largest }) {
  const specs = Object.entries(p.specs || {});
  const val = (n, raw) => { const v = n == null ? null : conv(n, raw); return v != null && Number.isFinite(v) ? v : null; };
  const scan = (s) => (re ? [...String(s || '').matchAll(re)].map((m) => val(toNum(m.slice(1).find(Boolean)), m[0])) : []);
  const keyed = keys ? specs.filter(([k]) => keys.test(k)).map(([, v]) => val(toNum(String(v).match(/\d[\d.,]*/)?.[0]), String(v))) : [];
  let found = [...keyed, ...scan(p.title)].filter((n) => n != null);
  if (!found.length) found = [...specs.filter(([k]) => !keys?.test(k)).flatMap(([, v]) => scan(v)), ...(p.bullets || []).flatMap(scan)].filter((n) => n != null);
  return found.length ? agg(found) : null;
}
// Texto de una característica: primer acierto en las specs indicadas, el título, el resto de specs y las viñetas.
function catFeature(p, { keys, re, map = (m) => m[0] }) {
  const specs = Object.entries(p.specs || {});
  const srcs = [...(keys ? specs.filter(([k]) => keys.test(k)).map(([, v]) => v) : []), p.title, specs.filter(([k]) => !keys?.test(k)).map(([, v]) => v).join(' \n '), (p.bullets || []).join(' \n ')];
  for (const s of srcs) { const m = String(s || '').match(re); if (m) return map(m); }
  return null;
}

// ---------- discos: lo que dice la ficha (título, specs y viñetas) ----------
// Capacidad comercial: 1024 GB es «1 TB», 2048 GB es «2 TB»…
export const snapCapacity = (gb) => {
  if (gb == null || !Number.isFinite(gb)) return null;
  for (let c = 1000; c <= 64000; c *= 2) if (Math.abs(gb - c) / c <= 0.03) return c;
  return Math.round(gb);
};
const MBS = String.raw`(\d{1,2}[,.]?\d{3})`;
const CAPACITY = { keys: /capacity|capacidad|hard disk size/i, re: /(\d+(?:[.,]\d+)?)\s?(?:TB|GB)\b/gi,
  conv: (n, raw) => { const gb = /TB/i.test(raw) ? n * 1000 : n; return gb >= 16 && gb <= 64000 ? snapCapacity(gb) : null; } };
// «Up to 14,000/10,000 MB/s», «7,450MB/s Read», «Read 7400 MB/S»: la lectura es la primera cifra.
const READ = { keys: /read speed|velocidad de lectura/i, re: new RegExp(String.raw`${MBS}(?:\s?\/\s?\d{1,2}[,.]?\d{3})?\s?MB\/s(?:ec)?`, 'gi'), conv: within(50, 20000) };
const WRITE = { keys: /write speed|velocidad de escritura/i,
  re: new RegExp(String.raw`${MBS}\s?MB\/s(?:ec)?\s?(?:sequential\s)?write|write[^\d.]{0,25}${MBS}\s?MB|\d{1,2}[,.]?\d{3}\s?\/\s?${MBS}\s?MB\/s`, 'gi'), conv: within(50, 20000) };
// La primera que aparezca (las viñetas suelen listar la de cada capacidad).
const TBW = { keys: /endurance|durabilidad|tbw/i, re: /(\d{2,5}(?:[.,]\d{3})?)\s?TBW\b/gi, conv: within(20, 30000), agg: (a) => a[0] };
const CONTROLLER = [
  [/\bPhison\s?(?:PS50\d\d-)?(E\d{2}T?)\b|\bPS50\d\d-(E\d{2}T?)\b/i, (m) => `Phison ${(m[1] || m[2]).toUpperCase()}`],
  [/\b(SM2\d{3}(?:EN|XT|G|H)?)\b/i, (m) => `SMI ${m[1].toUpperCase()}`],
  [/\b(IG5\d{3})\b/i, (m) => `InnoGrit ${m[1].toUpperCase()}`],
  [/\b(MAP1\d{3}A?)\b/i, (m) => `Maxio ${m[1].toUpperCase()}`],
];
function storageTags(p, t) {
  const tt = p.title || '';
  const out = { interface: /NVMe|M\.2|PCIe/i.test(t) ? 'NVMe' : /SATA|2\.5|HDD|3\.5|RPM/i.test(t) ? 'SATA' : null };
  out.capacityGb = numFeature(p, CAPACITY);
  const gen = t.match(/\b(?:PCI[\s-]?E(?:xpress)?|PCle)\s?(?:Gen\s?)?([345])(?:\.0)?(?![\d.]\d)|\bGen\s?([345])(?:\.0)?(?![\d.]\d)/i);
  out.pcie = out.interface === 'NVMe' && gen ? `PCIe ${gen[1] || gen[2]}.0` : null;
  // DRAM: «DRAM-less»/HMB es que no tiene; «DRAM», «DDR4 cache»… que sí. El tipo, si lo nombra.
  const dramType = t.match(/\b(LPDDR4X|LPDDR5X?|LPDDR4|DDR4|DDR3)\b/i);
  out.dramType = dramType ? dramType[1].toUpperCase() : null;
  // «outperforms DRAM-less drives» no quiere decir que no tenga: manda que anuncie su caché DRAM.
  const hasDram = /\bDRAM\s?(?:cache|buffer)|\b\d\s?GB\s(?:LP)?DDR|with\s(?:onboard\s|dedicated\s)?DRAM\b/i.test(t) && !/(?:without|no|sin)\sDRAM\b/i.test(t);
  out.dram = hasDram ? 'Sí' : /DRAM[\s-]?less|sin DRAM|without DRAM|\bHMB\b|host memory buffer/i.test(t) ? 'No' : /\bDRAM\b/i.test(t) || dramType ? 'Sí' : null;
  // NAND: la caché SLC aparece también en las TLC, así que no cuenta.
  out.nand = /\bQLC\b/i.test(t) ? 'QLC' : /\bTLC\b/i.test(t) ? 'TLC' : /\bMLC\b/i.test(t) ? 'MLC' : null;
  out.controller = null;
  for (const [re, map] of CONTROLLER) { const m = t.match(re); if (m) { out.controller = map(m); break; } }
  // Disipador: por el título (los que lo traen lo anuncian); en NVMe sin mención se asume que no.
  out.heatsink = /without heat\s?(?:sink|spreader)|w\/o heat|non[\s-]?heat\s?sink|no heat\s?sink|sin disipador/i.test(tt) ? 'No'
    : /heat\s?sink|heat\s?spreader|air cooler|disipador/i.test(tt) ? 'Sí' : out.interface === 'NVMe' ? 'No' : null;
  out.readMBs = numFeature(p, READ);
  out.writeMBs = numFeature(p, WRITE);
  out.tbw = numFeature(p, TBW);
  return out;
}

const brandOf = (p) => String(p.brand || Object.entries(p.specs || {}).find(([k]) => /^(brand|marca)$/i.test(k))?.[1] || String(p.title || '').trim().split(/\s+/)[0] || '').trim() || null;
const BRAND = { key: 'brand', label: 'Marca', type: 'cat', get: brandOf };
// Consumo por unidad; si el modelo no se reconoce (valor genérico), no cuenta.
const WATTS = { key: 'watts', label: 'Consumo', unit: 'W', better: 'low', get: (p, cat) => (wattsIsGuess(p, cat) ? null : estimateWatts(p, cat) / (Number(p.qty) || 1)) };
const NOISE = { key: 'noise', label: 'Ruido', unit: 'dB', better: 'low', keys: /noise|ruido/i, re: /(\d{1,2}(?:[.,]\d)?)\s?dB(?:A)?\b/gi, conv: within(5, 60) };
const cap = (w) => w[0].toUpperCase() + w.slice(1).toLowerCase();
const GPU_CHIP = /\b(RTX|GTX|RX|Arc)\s?-?([AB]?\d{3,4})(?:\s?(Ti|Super|XTX|XT|GRE)(?![a-z]))?(?!\d)/i;
const CHIPSET = /\b(X870E?|B850|B840|X670E?|B650E?|A620|X570|B550|A520|B450|X470|Z890|B860|H810|Z790|B760|H770|H610|Z690|B660)/i;
const isLiquid = (p) => catFeature(p, { keys: /cooling method|refrigeraci|enfriamiento/i, re: /\b(AIO|liquid|l[ií]quid[oa]|water|agua|air|aire)\b/i, map: (m) => !/^(air|aire)$/i.test(m[1]) });

// Características por categoría. tag: viene de detectTags (las mismas que usa la compatibilidad, editables a mano).
export const FEATURES = {
  cpu: [
    { key: 'cores', label: 'Núcleos', unit: 'núcleos', better: 'high', keys: /n[uú]cleos|cores?\b/i, re: /(\d{1,2})[\s-]?(?:cores?|n[uú]cleos)\b/gi, conv: within(2, 128) },
    { key: 'clock', label: 'Frecuencia', unit: 'GHz', better: 'high', keys: /cpu speed|clock|velocidad|frecuencia/i, re: FREQ, conv: ghz(1, 7) },
    { key: 'socket', label: 'Socket', type: 'cat', tag: 'socket' },
    WATTS, BRAND,
  ],
  cooler: [
    { key: 'kind', label: 'Tipo', type: 'cat', get: (p) => { const l = isLiquid(p); return l == null ? null : l ? 'Líquida (AIO)' : 'Aire'; } },
    { key: 'radiator', label: 'Radiador', unit: 'mm', better: 'high', get: (p) => (isLiquid(p) ? numFeature(p, { re: /\b(240|280|360|420)\s?mm\b/gi }) : null) },
    { key: 'height', label: 'Altura', unit: 'mm', better: 'low', tag: 'heightMm' },
    NOISE, BRAND,
  ],
  motherboard: [
    { key: 'chipset', label: 'Chipset', type: 'cat', keys: /chipset/i, re: CHIPSET, map: (m) => m[1].toUpperCase() },
    { key: 'socket', label: 'Socket', type: 'cat', tag: 'socket' },
    { key: 'formFactor', label: 'Formato', type: 'cat', tag: 'formFactor' },
    { key: 'memType', label: 'Memoria', type: 'cat', tag: 'memType' },
    { key: 'm2', label: 'Ranuras M.2', unit: 'M.2', better: 'high', tag: 'm2Slots' },
    BRAND,
  ],
  ram: [
    { key: 'capacity', label: 'Capacidad', unit: 'GB', better: 'high', tag: 'capacityGb' },
    { key: 'speed', label: 'Velocidad', unit: 'MT/s', better: 'high', keys: /memory speed|velocidad|frecuencia/i, re: /(\d{4,5})\s?(?:MT\/s|MHz|Mbps)|DDR[45]-(\d{4,5})/gi, conv: within(1600, 12000) },
    { key: 'cl', label: 'Latencia', better: 'low', keys: /cas latency|latencia/i, re: /\bCL\s?-?(\d{2})\b/gi, conv: within(10, 60), agg: smallest, fmt: (v) => `CL${v}` },
    { key: 'memType', label: 'Tipo', type: 'cat', tag: 'memType' },
    BRAND,
  ],
  gpu: [
    // Sin keys: el título manda (la spec «Graphics Coprocessor» a veces omite el «Ti»).
    { key: 'chip', label: 'Chip', type: 'cat', re: GPU_CHIP,
      map: (m) => [m[1].toUpperCase() === 'ARC' ? 'Arc' : m[1].toUpperCase(), m[2].toUpperCase(), m[3] && (/^(ti|super)$/i.test(m[3]) ? cap(m[3]) : m[3].toUpperCase())].filter(Boolean).join(' ') },
    { key: 'vram', label: 'VRAM', unit: 'GB', better: 'high', keys: /graphics ram size|memoria (?:de )?(?:video|gr[aá]fica)|video memory/i, re: /(\d{1,2})\s?GB?\b/gi,
      conv: (n, raw) => within(1, 96)(/MB/i.test(raw) || n >= 512 ? n / 1024 : n) },
    { key: 'memType', label: 'Memoria', type: 'cat', keys: /ram type|tipo de (?:memoria|ram)/i, re: /\bG?DDR(\d)(X?)\b/i, map: (m) => `GDDR${m[1]}${m[2].toUpperCase()}` },
    { key: 'clock', label: 'Frecuencia', unit: 'GHz', better: 'high', keys: /clock|reloj/i, re: FREQ, conv: ghz(0.5, 4) },
    WATTS, BRAND,
  ],
  storage: [
    // exact: se filtra por cada valor (todas las capacidades), no por umbral; always: aunque todas sean iguales.
    { key: 'capacity', label: 'Capacidad', unit: 'GB', better: 'high', exact: true, always: true, tag: 'capacityGb', fmt: (v) => (v >= 1000 ? `${+(v / 1000).toFixed(2)} TB` : `${v} GB`) },
    { key: 'iface', label: 'Interfaz', type: 'cat', tag: 'interface' },
    { key: 'pcie', label: 'PCIe', type: 'cat', tag: 'pcie' },
    { key: 'dram', label: 'DRAM', type: 'cat', tag: 'dram', always: true, fmt: (v) => (/^s/i.test(v) ? 'Con DRAM' : /^no/i.test(v) ? 'Sin DRAM (HMB)' : v) },
    { key: 'dramType', label: 'Tipo de DRAM', type: 'cat', tag: 'dramType' },
    { key: 'nand', label: 'NAND', type: 'cat', tag: 'nand' },
    { key: 'controller', label: 'Controlador', type: 'cat', tag: 'controller' },
    { key: 'heatsink', label: 'Disipador', type: 'cat', tag: 'heatsink', fmt: (v) => (/^s/i.test(v) ? 'Con disipador' : /^no/i.test(v) ? 'Sin disipador' : v) },
    { key: 'read', label: 'Lectura', unit: 'MB/s', better: 'high', tag: 'readMBs' },
    { key: 'write', label: 'Escritura', unit: 'MB/s', better: 'high', tag: 'writeMBs' },
    { key: 'tbw', label: 'Durabilidad', unit: 'TBW', better: 'high', tag: 'tbw' },
    BRAND,
  ],
  psu: [
    { key: 'power', label: 'Potencia', unit: 'W', better: 'high', tag: 'psuWatts' },
    { key: 'cert', label: 'Certificación', type: 'cat', re: /80\s?(?:PLUS|\+)\s?(Titanium|Platinum|Gold|Silver|Bronze|White)?/i, map: (m) => `80 Plus${m[1] ? ` ${cap(m[1])}` : ''}` },
    { key: 'modular', label: 'Modular', type: 'cat', re: /\b(full(?:y)?[\s-]?modular|totalmente modular|semi[\s-]?modular|non[\s-]?modular|no modular)\b/i,
      map: (m) => (/semi/i.test(m[1]) ? 'Semimodular' : /^no/i.test(m[1]) ? 'No modular' : 'Totalmente modular') },
    BRAND,
  ],
  case: [
    { key: 'formFactor', label: 'Placa máxima', type: 'cat', tag: 'formFactor' },
    { key: 'tower', label: 'Tamaño', type: 'cat', keys: /case type|tipo de (?:caja|gabinete|chasis)/i, re: /\b(full|mid|mini|micro)[\s-]?tower\b|\btorre (media|completa|mini)\b|\b(SFF)\b/i,
      map: (m) => (m[3] ? 'SFF' : { full: 'Full Tower', completa: 'Full Tower', mid: 'Mid Tower', media: 'Mid Tower', mini: 'Mini Tower', micro: 'Mini Tower' }[(m[1] || m[2]).toLowerCase()]) },
    { key: 'coolerMax', label: 'Disipador máx.', unit: 'mm', better: 'high', tag: 'coolerMaxMm' },
    BRAND,
  ],
  fans: [
    { key: 'size', label: 'Tamaño', unit: 'mm', better: 'high', keys: /fan size|tama[ñn]o del ventilador/i, re: /\b(80|92|120|140|200)\s?mm\b/gi, conv: (n, raw) => within(40, 250)(/cm|cent/i.test(raw) ? n * 10 : n) },
    { key: 'count', label: 'Unidades', unit: 'unid.', better: 'high', tag: 'count' },
    { key: 'rpm', label: 'Velocidad máx.', unit: 'RPM', better: 'high', keys: /rotational speed|velocidad/i, re: /(\d[\d.,]{2,5})\s?RPM\b/gi, conv: within(300, 6000) },
    NOISE,
    { key: 'rgb', label: 'Iluminación', type: 'cat', get: (p) => (/\bARGB\b/i.test(p.title || '') ? 'ARGB' : /\bRGB\b/i.test(p.title || '') ? 'RGB' : 'Sin RGB') },
    BRAND,
  ],
  monitor: [
    { key: 'size', label: 'Tamaño', unit: '″', better: 'high', keys: /screen size|tama[ñn]o de (?:la )?pantalla/i, re: /(\d{2}(?:[.,]\d)?)\s?(?:"|”|″|''|-?inch\b|in\b|pulgadas)/gi, conv: within(15, 65) },
    { key: 'hz', label: 'Frecuencia', unit: 'Hz', better: 'high', keys: /refresh|frecuencia|tasa de actualizaci/i, re: /(\d{2,3})\s?Hz\b/gi, conv: within(30, 600) },
    { key: 'res', label: 'Resolución', type: 'cat', keys: /resolution|resoluci/i, re: /\b(?:(?:3840|3440|2560|1920)\s?[x×]\s?\d{4}|4K|UHD|W?QHD|FHD|Full HD|2160p|1440p|1080p)\b/i,
      map: (m) => { const s = m[0].toUpperCase(); return /3440/.test(s) ? '3440×1440' : /3840|4K|UHD|2160/.test(s) ? '4K' : /2560|QHD|1440/.test(s) ? '1440p' : '1080p'; } },
    { key: 'panel', label: 'Panel', type: 'cat', keys: /panel|display technology|tecnolog[ií]a de (?:la )?pantalla/i, re: /\b(QD-?OLED|OLED|IPS|VA|TN)\b/i, map: (m) => m[1].toUpperCase().replace('QDOLED', 'QD-OLED') },
    { key: 'response', label: 'Respuesta', unit: 'ms', better: 'low', keys: /response time|tiempo de respuesta/i, re: /(\d(?:[.,]\d{1,2})?)\s?ms\b/gi, conv: within(0.01, 30), agg: smallest },
    WATTS, BRAND,
  ],
};
export const featuresFor = (cat) => FEATURES[cat] || [BRAND];

// Valor de una característica en un producto (número redondeado o texto), o null si la ficha no lo dice.
export function featureValue(f, p, cat) {
  const v = f.tag ? detectTags(p, cat)[f.tag] : f.get ? f.get(p, cat) : f.type === 'cat' ? catFeature(p, f) : numFeature(p, f);
  if (v == null || v === '') return null;
  if (f.type === 'cat') return String(v).trim() || null;
  const n = Number(v);
  return Number.isFinite(n) ? +n.toFixed(3) : null;
}
export const fmtFeature = (f, v) => (v == null ? '—' : f.fmt ? f.fmt(v) : f.type === 'cat' ? String(v) : `${v}${!f.unit ? '' : f.unit === '″' ? '″' : ` ${f.unit}`}`);

// Características que comparten las opciones (al menos dos con dato y dos valores distintos) y sus valores para filtrar:
// en las de texto, cada valor con cuántas lo tienen; en las numéricas, umbrales (≥ o ≤ según qué es mejor).
// Con view, los conteos son dinámicos: cuántas quedarían al elegir cada valor con los demás filtros puestos
// (cada característica se cuenta sin su propio filtro). Los valores ofrecidos son siempre los de toda la lista.
export function commonFeatures(list, cat, view = null, s = DEFAULT_SETTINGS) {
  const out = [];
  for (const f of featuresFor(cat)) {
    const vals = (list || []).map((p) => featureValue(f, p, cat)).filter((v) => v != null);
    const min = f.always ? 1 : 2;
    let base = null;
    if (view) {
      const v = normalizeView(view, cat);
      const { [f.key]: _own, ...others } = v.feats;
      base = viewOptions(list, { ...v, feats: others }, cat, s).map((p) => featureValue(f, p, cat)).filter((x) => x != null);
    }
    const counted = base || vals;
    if (f.exact) {
      const distinct = [...new Set(vals)].sort((a, b) => a - b);
      if (vals.length < 2 || distinct.length < min) continue;
      out.push({ ...f, values: distinct.map((x) => ({ value: x, count: counted.filter((y) => y === x).length })) });
      continue;
    }
    if (f.type === 'cat') {
      const groups = new Map();
      for (const v of vals) {
        const g = groups.get(fold(v)) || groups.set(fold(v), { count: 0, names: {} }).get(fold(v));
        g.count++;
        g.names[v] = (g.names[v] || 0) + 1;
      }
      // Se muestra la forma más usada («MSI» y no «msi» si la mayoría lo escribe así).
      const values = [...groups.values()].map((g) => ({ value: Object.entries(g.names).sort((a, b) => b[1] - a[1])[0][0], count: g.count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'es'))
        .map((x) => (base ? { ...x, count: base.filter((y) => fold(y) === fold(x.value)).length } : x));
      if (vals.length >= 2 && values.length >= min) out.push({ ...f, values });
      continue;
    }
    const distinct = [...new Set(vals)].sort((a, b) => a - b);
    if (vals.length < 2 || distinct.length < min) continue;
    // Todos los valores como umbral o, si son muchos, seis repartidos entre el menor y el mayor.
    const steps = distinct.length <= 8 ? distinct : [...new Set([0, 1, 2, 3, 4, 5].map((i) => distinct[Math.round((i * (distinct.length - 1)) / 5)]))];
    out.push({ ...f, values: steps.map((t) => ({ value: t, count: counted.filter((v) => (f.better === 'low' ? v <= t : v >= t)).length })) });
  }
  return out;
}

// ---------- ordenar y filtrar las opciones de una categoría ----------
// Criterios generales con su sentido por defecto; después, las características numéricas de la categoría.
export const OPTION_SORTS = [
  { key: 'pick', label: 'Decisión (estrellas)', dir: 'desc' },
  { key: 'total', label: 'Precio total', dir: 'asc' },
  { key: 'rating', label: 'Calificación', dir: 'desc' },
  { key: 'reviews', label: 'Reseñas', dir: 'desc' },
  { key: 'name', label: 'Nombre', dir: 'asc' },
  { key: 'added', label: 'Fecha en que se agregó', dir: 'desc' },
];
export const sortsFor = (cat) => [
  ...OPTION_SORTS,
  ...featuresFor(cat).filter((f) => f.type !== 'cat').map((f) => ({ key: `f:${f.key}`, label: f.label, dir: f.better === 'low' ? 'asc' : 'desc', feature: f })),
];
export function dirLabel(sort, dir) {
  if (sort === 'name') return dir === 'asc' ? 'A → Z' : 'Z → A';
  if (sort === 'added') return dir === 'desc' ? 'Más recientes primero' : 'Más antiguas primero';
  if (sort === 'pick') return dir === 'desc' ? 'Más estrellas primero' : 'Menos estrellas primero';
  return dir === 'asc' ? 'Menor a mayor' : 'Mayor a menor';
}
export const OPTION_AVAIL = { all: 'Todas', priced: 'Con precio', ships: 'Con precio y envío confirmado' };
// Órdenes de la versión anterior (guardados en el navegador).
const LEGACY_SORTS = { 'total-asc': ['total', 'asc'], 'total-desc': ['total', 'desc'], recent: ['added', 'desc'], watts: ['f:watts', 'asc'] };

// Vista guardada → valores válidos (lo desconocido vuelve al valor por defecto: sin filtros, por estrellas).
export function normalizeView(v, cat) {
  const max = Number(v?.maxTotal);
  const sorts = sortsFor(cat);
  const [wantSort, wantDir] = Object.hasOwn(LEGACY_SORTS, v?.sort ?? '') ? LEGACY_SORTS[v.sort] : [v?.sort, v?.dir];
  const sort = sorts.find((o) => o.key === wantSort);
  const feats = {};
  for (const [k, val] of Object.entries(v?.feats && typeof v.feats === 'object' ? v.feats : {})) {
    const f = featuresFor(cat).find((x) => x.key === k);
    if (!f || val == null || val === '') continue;
    if (f.type === 'cat') feats[k] = String(val);
    else if (Number.isFinite(Number(val))) feats[k] = Number(val);
  }
  return {
    q: typeof v?.q === 'string' ? v.q : '',
    sort: sort?.key ?? 'pick',
    dir: sort && ['asc', 'desc'].includes(wantDir) ? wantDir : (sort ?? sorts[0]).dir,
    minPick: Math.max(0, Math.min(PICK_FIXED, Math.round(Number(v?.minPick) || 0))),
    avail: Object.hasOwn(OPTION_AVAIL, v?.avail ?? '') ? v.avail : 'all',
    maxTotal: v?.maxTotal != null && v.maxTotal !== '' && max > 0 ? max : null,
    underThreshold: v?.underThreshold === true,
    deals: v?.deals === true,
    feats,
  };
}
// ¿Algún filtro oculta opciones? (el orden no cuenta)
export const viewFiltered = (v) => !!(v.q.trim() || v.minPick || v.avail !== 'all' || v.maxTotal != null || v.underThreshold || v.deals || Object.keys(v.feats).length);

const fold = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const SOLD_OUT = /No disponible|Agotado|Currently unavailable/i;

// Opciones filtradas y ordenadas según la vista (no modifica la lista). Los precios son el total en su destino.
// Lo que no tiene dato va al final en cualquier sentido. Empates: más estrellas y luego el orden en que las agregaste.
export function viewOptions(list, view, cat, s = DEFAULT_SETTINGS) {
  const v = normalizeView(view, cat);
  const terms = fold(v.q).split(/\s+/).filter(Boolean);
  const feats = Object.entries(v.feats).map(([k, want]) => [featuresFor(cat).find((f) => f.key === k), want]);
  const sortF = sortsFor(cat).find((o) => o.key === v.sort)?.feature;
  const key = sortF ? (p) => featureValue(sortF, p, cat)
    : { pick: (p) => pickLevel(p), total: (p, c) => c.total, rating: (p) => p.rating || null, reviews: (p) => p.reviews || null, added: (p, c, i) => i, name: () => null }[v.sort];
  const rows = (list || []).map((p, i) => { const c = lineCost(p, s); return { p, i, c, k: key(p, c, i) }; });
  const keep = rows.filter(({ p, c }) => {
    if (terms.length) {
      const hay = fold([p.title, p.brand, p.seller, p.store, p.asin].join(' '));
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    if (pickLevel(p) < v.minPick) return false;
    if (v.avail !== 'all') {
      if (c.price == null || SOLD_OUT.test(p.availability || '')) return false;
      if (v.avail === 'ships' && !p.manual && !isMiami(p) && p.shipsToCO !== true) return false;
    }
    if (v.maxTotal != null && !(c.total != null && c.total <= v.maxTotal)) return false;
    if (v.underThreshold && (c.price == null || (c.overThreshold && !p.manual))) return false;
    if (v.deals && !isDeal(p)) return false;
    for (const [f, want] of feats) {
      const x = featureValue(f, p, cat);
      if (x == null) return false;
      if (f.type === 'cat' ? fold(x) !== fold(want) : f.exact ? x !== want : f.better === 'low' ? x > want : x < want) return false;
    }
    return true;
  });
  const sign = v.dir === 'asc' ? 1 : -1;
  const nullLast = (a, b) => (a == null) - (b == null) || (a == null ? 0 : sign * (a - b));
  const primary = v.sort === 'name'
    ? (a, b) => sign * String(a.p.title || '').localeCompare(String(b.p.title || ''), 'es', { sensitivity: 'base' })
    : (a, b) => nullLast(a.k, b.k) || (v.sort === 'rating' ? nullLast(a.p.reviews || null, b.p.reviews || null) : 0);
  return keep.sort((a, b) => primary(a, b) || pickLevel(b.p) - pickLevel(a.p) || a.i - b.i).map(({ p }) => p);
}

// ---------- comercios ----------
// Cada producto puede tener enlaces en varias tiendas (p.stores = [{ store, url, price, currency, listPrice, shipping, note, fetchedAt, prev, error }]).
// En las tiendas de EE. UU. (entrega en Miami, ZIP 33186) se compara precio + envío + sales tax de Miami-Dade (Ajustes).
// listPrice: precio de referencia tachado («antes», «comp. value», «reg»); si es mayor que el precio, la fila está en oferta.
// La fila de Amazon del destino del producto no se guarda: sale del propio producto (su precio, envío y cargos).
export const ownAmazonStore = (p) => (!p || p.manual || !(p.asin || /amazon\.com\//i.test(p.url || '')) ? null : isMiami(p) ? 'amazon-us' : 'amazon-co');

// Precio comparable de una lectura de Amazon: a Colombia, el total con envío y cargos; a Miami, producto + envío.
export function amazonStorePrice(d, region, s = DEFAULT_SETTINGS) {
  if (d?.price == null) return null;
  if (region === 'us') return +(Number(d.price) + (Number(d.shipping) || 0)).toFixed(2);
  return lineCost({ price: d.price, shipping: d.shipping, importFees: d.importFees, qty: 1 }, s).total;
}

// Filas para mostrar/editar, en el orden de STORES. usd = precio en dólares (COP con la TRM) para comparar.
export function storeRows(p, s = DEFAULT_SETTINGS) {
  const own = ownAmazonStore(p);
  const rows = [];
  for (const key of STORE_KEYS) {
    let r;
    if (key === own) {
      const url = p.url || `https://www.amazon.com/dp/${p.asin}`;
      r = STORES[key].region === 'us'
        ? { store: key, own: true, url, price: p.price != null ? Number(p.price) : null, shipping: p.shipping != null ? Number(p.shipping) : null, currency: 'USD', fetchedAt: p.fetchedAt || null, prev: null }
        : { store: key, own: true, url, price: amazonStorePrice(p, STORES[key].region, s), currency: 'USD', fetchedAt: p.fetchedAt || null, prev: null };
    } else r = (p.stores || []).find((x) => x?.store === key);
    if (!r) continue;
    const price = r.price != null ? Number(r.price) : null;
    const row = { ...r, price, deal: price != null && Number(r.listPrice) > price };
    if (STORES[key].region === 'us' && price != null) {
      const shipping = r.shipping != null ? Number(r.shipping) : 0;
      row.tax = +((s.miamiTax ?? DEFAULT_SETTINGS.miamiTax) * price).toFixed(2);
      row.total = +(price + shipping + row.tax).toFixed(2);
      row.usd = row.total;
    } else row.usd = price == null ? null : r.currency === 'COP' ? +(price / (s.trm || DEFAULT_SETTINGS.trm)).toFixed(2) : price;
    rows.push(row);
  }
  return rows;
}

// Las que se muestran en la tarjeta: con enlace y precio. La más barata (en US$) se marca si hay con qué comparar.
export function shownStores(p, s = DEFAULT_SETTINGS) {
  const rows = storeRows(p, s).filter((r) => r.url && r.price != null);
  if (rows.length > 1) {
    const min = Math.min(...rows.map((r) => r.usd));
    rows.forEach((r) => { r.best = r.usd === min; });
  }
  return rows;
}

// Guarda un precio leído en una fila (conserva el anterior para mostrar si subió o bajó).
export function setStorePrice(row, { price, currency, listPrice }, now = new Date().toISOString()) {
  const n = price != null ? Number(price) : null;
  if (n != null && row.price != null && Number(row.price) !== n) row.prev = { price: Number(row.price), at: row.fetchedAt || null };
  if (n != null) { row.price = n; row.currency = currency === 'COP' ? 'COP' : 'USD'; }
  if (n != null && listPrice !== undefined) row.listPrice = Number(listPrice) > n ? Number(listPrice) : null;
  row.fetchedAt = now;
  row.error = n == null ? 'La ficha no mostró precio' : null;
  return row;
}

// ---------- ofertas ----------
// Un producto está en oferta si su precio está por debajo de su precio de lista o si alguna tienda lo tiene en oferta.
export function isDeal(p) {
  if (p?.price != null && Number(p.listPrice) > Number(p.price)) return true;
  return (p?.stores || []).some((r) => r?.price != null && Number(r.listPrice) > Number(r.price));
}
