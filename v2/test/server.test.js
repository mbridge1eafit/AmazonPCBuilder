import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server/index.js';
import { emptyState } from '../public/js/domain/schema.js';

async function withServer(fn, fetchImpl) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pcb2-'));
  writeFileSync(path.join(dir, 'seed.json'), JSON.stringify(emptyState()));
  const srv = createServer({ dataDir: dir, fetchImpl });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base, dir); } finally { srv.close(); }
}

test('store: lee la semilla, guarda con rev y rechaza una rev vieja (409)', () => withServer(async (base, dir) => {
  const st = await (await fetch(`${base}/api/store`)).json();
  assert.equal(st.schema, 2);
  const put = (body, q = '') => fetch(`${base}/api/store${q}`, { method: 'PUT', body: JSON.stringify(body) });
  const r1 = await put(st);
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).rev, 1);
  assert.ok(existsSync(path.join(dir, 'store.json')));
  const stale = await put(st); // rev 0 otra vez
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).current.rev, 1);
  assert.equal((await put(st, '?force=1')).status, 200);
  assert.equal((await put({ version: 1 })).status, 400);
}));

test('conector: el marcador empaquetado es JavaScript válido y lleva versión', () => withServer(async (base) => {
  const code = await (await fetch(`${base}/api/connector`)).text();
  assert.doesNotThrow(() => new Function(code));
  const { version } = await (await fetch(`${base}/api/connector/version`)).json();
  assert.match(code, new RegExp(version));
  assert.ok(!/__APP__|__VERSION__|__CATS__/.test(code));
}));

test('TRM oficial: lee datos.gov.co y falla con mensaje si no responde', async () => {
  await withServer(async (base) => {
    const r = await (await fetch(`${base}/api/trm`)).json();
    assert.deepEqual([r.trm, r.date], [3269.88, '2026-11-10']);
  }, async () => ({ json: async () => [{ valor: '3269.88', vigenciadesde: '2026-11-10T00:00:00.000', vigenciahasta: '2026-11-10T00:00:00.000' }] }));
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/trm`)).status, 502);
  }, async () => { throw new Error('sin red'); });
});

test('archivos estáticos: no sale de public/', () => withServer(async (base) => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.notEqual((await fetch(`${base}/..%2Fserver%2Findex.js`)).status, 200);
}));
