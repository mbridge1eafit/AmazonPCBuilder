// Migra los datos de V1 al modelo V2.
//   npm run migrate                    → ../data/store.json  →  data/store.json   (no toca V1)
//   npm run migrate -- --force         → reemplaza data/store.json si ya existe (antes guarda una copia)
//   npm run migrate -- --seed          → ../data/seed.json   →  data/seed.json    (datos de ejemplo)
//   npm run migrate -- --from x.json --to y.json
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateV1 } from '../public/js/domain/migrate-v1.js';
import { normalize } from '../public/js/domain/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const seed = args.includes('--seed');
const from = path.resolve(opt('--from') || path.join(ROOT, '..', 'data', seed ? 'seed.json' : 'store.json'));
const to = path.resolve(opt('--to') || path.join(ROOT, 'data', seed ? 'seed.json' : 'store.json'));

if (!existsSync(from)) { console.error(`No encontré ${from}`); process.exit(1); }
if (existsSync(to) && !args.includes('--force') && !seed) {
  console.error(`${to} ya existe. Usa --force para reemplazarlo (se guarda una copia .bak).`);
  process.exit(1);
}
const { state, report } = migrateV1(JSON.parse(await readFile(from, 'utf8')));
normalize(state);
await mkdir(path.dirname(to), { recursive: true });
if (existsSync(to)) await copyFile(to, `${to}.${Date.now()}.bak`);
await writeFile(to, JSON.stringify(state, null, 1));
console.log(`Migrado ${from}\n     → ${to}`);
console.log(`Armados: ${report.builds} · opciones V1: ${report.options} · productos: ${report.products} · candidatos: ${report.candidates} (${report.selected} elegidos) · con precio pagado: ${report.paid}`);
console.log('Filas por tienda:', Object.entries(report.offers).map(([k, v]) => `${k} ${v}`).join(' · '));
if (report.customStores.length) console.log('Tiendas creadas para productos manuales:', report.customStores.join(', '));
