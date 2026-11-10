// Especificaciones por categoría (brief §9.2): detección desde la ficha, características para filtrar/ordenar/comparar
// y consumo eléctrico (§12). Las funciones reciben una
// «vista de ficha» { title, brand, specs, bullets, tags, qty, watts } que arma specView() desde el modelo.
// Lo manual (product.specOverrides) manda sobre lo detectado.
import { CAT } from './categories.js';

/** Vista de ficha que esperan los detectores. @param {any} product @param {any} [cand] */
export function specView(product, cand) {
  return {
    title: product?.title || '', brand: product?.brand || '', specs: product?.rawSpecs || {}, bullets: product?.bullets || [],
    tags: product?.specOverrides || {}, qty: Number(cand?.qty) || 1, watts: cand?.wattsOverride ?? null,
    rating: product?.rating ?? null, reviews: product?.reviews ?? null,
  };
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

// ---------- cables y accesorios ----------
// Tipo de accesorio por el título.
function accessoryKind(p) {
  const tt = p.title || '';
  if (isSurgeProtector(p)) return 'Protector de picos';
  if (/\bDisplay\s?Port\b|\bDP\s?(?:to|a)\s?DP\b|\bDP\s?(?:1\.4|2\.1)\b|\bDP(?:8K|40|54|80)\b/i.test(tt)) return 'Cable DisplayPort';
  if (/\bHDMI\b/i.test(tt)) return 'Cable HDMI';
  if (/\bSATA\b/i.test(tt)) return 'Cable SATA';
  if (/\bUSB\b/i.test(tt)) return 'Cable USB';
  return /cable/i.test(tt) ? 'Otro cable' : 'Otro accesorio';
}
const isVideoCable = (p) => /DisplayPort|HDMI/.test(accessoryKind(p));
// Certificación de cable de video declarada. VESA: DP80/DP54/DP40 son DisplayPort 2.1 (UHBR20/13.5/10); DP8K es DP 1.4 (HBR3).
// HDMI: «Certified Ultra High Speed» es el programa de HDMI LA para 48 Gbps (etiqueta con QR).
function cableCert(p) {
  const kind = accessoryKind(p);
  if (!/DisplayPort|HDMI/.test(kind)) return null;
  const t = text(p);
  if (kind === 'Cable HDMI') return /certif/i.test(t) && /ultra high speed|48\s?Gbps/i.test(t) ? 'HDMI Ultra High Speed' : 'Sin certificación';
  if (!/VESA[\s-]?certif|certif\w*\s(?:by|por)\s(?:the\s)?VESA|DP(?:80|54|40)(?:LL)?\b|DP8K/i.test(t)) return 'Sin certificación';
  const m = t.match(/\bDP(80|54|40)(?:LL)?\b|\b(80|54|40)\s?Gbps/i);
  if (m) return `VESA DP${m[1] || m[2]}`;
  return /DP8K|DisplayPort\s?(?:Cable\s)?1\.4|DP\s?1\.4|32\.4\s?Gbps|HBR3/i.test(t) ? 'VESA DP8K' : 'VESA (sin clase)';
}
const CERT_GBPS = { 'VESA DP80': 80, 'VESA DP54': 54, 'VESA DP40': 40, 'VESA DP8K': 32.4, 'HDMI Ultra High Speed': 48 };
// Ancho de banda: el del título («80Gbps», «32.4Gbps») o el de la certificación.
function cableGbps(p) {
  const m = (p.title || '').match(/(\d{1,2}(?:\.\d)?)\s?Gbps/i);
  return m ? Number(m[1]) : CERT_GBPS[cableCert(p)] ?? null;
}
function cableVersion(p) {
  const kind = accessoryKind(p);
  const tt = p.title || '';
  if (kind === 'Cable DisplayPort') {
    const m = tt.match(/(?:Display\s?Port|DP)\s?(?:Cable\s|Cord\s)?(2\.1|2\.0|1\.4|1\.2)\b/i);
    if (m) return `DP ${m[1]}`;
    const c = cableCert(p);
    return /DP(80|54|40)/.test(c) ? 'DP 2.1' : c === 'VESA DP8K' ? 'DP 1.4' : null;
  }
  if (kind === 'Cable HDMI') {
    const m = tt.match(/HDMI\s?(?:Cable\s)?(2\.1|2\.0|1\.4)/i);
    return m ? `HDMI ${m[1]}` : cableCert(p) === 'HDMI Ultra High Speed' ? 'HDMI 2.1' : null;
  }
  return null;
}
// Longitud en metros: la del título (los metros si los dice; si no, pies o pulgadas) o la spec de largo.
function cableLengthM(p) {
  const r1 = (n) => Math.round(n * 10) / 10;
  for (const s of [p.title || '', ...Object.entries(p.specs || {}).filter(([k]) => /length|longitud|largo/i.test(k)).map(([, v]) => v)]) {
    const str = String(s).replace(/(\d),(\d)/g, '$1.$2');
    const m = str.match(/(\d{1,2}(?:\.\d{1,2})?)\s?(?:m|meters?|metros?)\b/i);
    if (m) return r1(Number(m[1]));
    const ft = str.match(/(\d{1,3}(?:\.\d{1,2})?)\s?(?:ft|feet|foot|pies)\b/i);
    if (ft) return r1(Number(ft[1]) * 0.3048);
    const inch = str.match(/(\d{1,3}(?:\.\d)?)\s?(?:inch(?:es)?|in\b|pulgadas|")/i);
    if (inch) return r1(Number(inch[1]) * 0.0254);
  }
  return null;
}

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
  accessories: [
    { key: 'kind', label: 'Tipo', type: 'cat', always: true, get: accessoryKind },
    // rank: orden de calidad de un valor de texto (para la escala de colores del comparador; mayor = mejor).
    { key: 'cert', label: 'Certificación', type: 'cat', get: cableCert, rank: (v) => CERT_GBPS[v] ?? (v === 'VESA (sin clase)' ? 10 : 0) },
    { key: 'version', label: 'Versión', type: 'cat', get: cableVersion, rank: (v) => Number(String(v).match(/\d+(?:\.\d+)?/)?.[0]) || null },
    { key: 'gbps', label: 'Ancho de banda', unit: 'Gbps', better: 'high', get: (p) => (isVideoCable(p) ? cableGbps(p) : null) },
    { key: 'length', label: 'Longitud', unit: 'm', better: 'high', exact: true, get: (p) => (/cable/i.test(accessoryKind(p)) ? cableLengthM(p) : null) },
    { key: 'braided', label: 'Forro', type: 'cat', get: (p) => (/cable/i.test(accessoryKind(p)) ? (/braided|trenzad|nylon/i.test(p.title || '') ? 'Trenzado' : 'Normal') : null), rank: (v) => (v === 'Trenzado' ? 1 : 0) },
    { key: 'joules', label: 'Protección', unit: 'J', better: 'high', tag: 'joules' },
    { key: 'outlets', label: 'Tomas', unit: 'tomas', better: 'high', tag: 'outlets' },
    { key: 'vpr', label: 'VPR', unit: 'V', better: 'low', tag: 'vpr' },
    BRAND,
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

const foldTxt = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export { foldTxt as fold, accessoryKind };

// Valor por dinero (R16, §9.3): precio por unidad de una característica de la categoría.
export const VALUE_METRICS = {
  storage: { feature: 'capacity', label: 'US$/TB', per: (v) => v / 1000 },
  ram: { feature: 'capacity', label: 'US$/GB', per: (v) => v },
  gpu: { feature: 'vram', label: 'US$/GB VRAM', per: (v) => v },
  cpu: { feature: 'cores', label: 'US$/núcleo', per: (v) => v },
  psu: { feature: 'power', label: 'US$/W', per: (v) => v },
  monitor: { feature: 'size', label: 'US$/pulgada', per: (v) => v },
  fans: { feature: 'count', label: 'US$/unidad', per: (v) => v },
  accessories: { feature: 'length', label: 'US$/m', per: (v) => v },
};
/** US$ por unidad, o null si falta la especificación o el precio. */
export function valueFor(cat, view, total) {
  const m = VALUE_METRICS[cat];
  if (!m || total == null) return null;
  const f = featuresFor(cat).find((x) => x.key === m.feature);
  const v = f ? featureValue(f, view, cat) : null;
  const units = v == null ? null : m.per(v);
  return units ? Math.round((total / units) * 100) / 100 : null;
}
