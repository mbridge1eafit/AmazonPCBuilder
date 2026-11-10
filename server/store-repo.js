// Estado de la app en un JSON (data/store.json), escrito de forma atómica (.tmp + rename).
// Control de concurrencia con `rev`: un PUT con una rev vieja (otro dispositivo guardó antes) devuelve 409.
// Copias rotativas en data/backups (como máximo una por hora, las últimas 24).
import { readFile, writeFile, mkdir, rename, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function createRepo(dataDir) {
  const STORE = path.join(dataDir, 'store.json');
  const SEED = path.join(dataDir, 'seed.json');
  const BACKUPS = path.join(dataDir, 'backups');
  let lastBackup = 0;
  let queue = Promise.resolve();
  const serial = (fn) => (queue = queue.then(fn, fn));

  async function read() {
    const file = existsSync(STORE) ? STORE : SEED;
    if (!existsSync(file)) return null;
    return JSON.parse(await readFile(file, 'utf8'));
  }
  async function backup() {
    if (!existsSync(STORE) || Date.now() - lastBackup < 3600e3) return;
    lastBackup = Date.now();
    await mkdir(BACKUPS, { recursive: true });
    await writeFile(path.join(BACKUPS, `store-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), await readFile(STORE));
    const files = (await readdir(BACKUPS)).filter((f) => f.startsWith('store-')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 24))) await unlink(path.join(BACKUPS, f));
  }
  /** @returns {Promise<{ ok: true, rev: number } | { ok: false, current: any }>} */
  function write(state, { force = false } = {}) {
    return serial(async () => {
      if (!state || state.schema !== 2) throw Object.assign(new Error('Formato de datos inválido'), { status: 400 });
      const current = await read();
      if (!force && current && Number(current.rev) !== Number(state.rev)) return { ok: false, current };
      await backup();
      const next = { ...state, rev: (Number(current?.rev) || 0) + 1, savedAt: new Date().toISOString() };
      await mkdir(dataDir, { recursive: true });
      await writeFile(STORE + '.tmp', JSON.stringify(next));
      await rename(STORE + '.tmp', STORE);
      return { ok: true, rev: next.rev };
    });
  }
  const seed = async () => JSON.parse(await readFile(SEED, 'utf8'));
  return { read, write, seed, paths: { STORE, SEED } };
}
