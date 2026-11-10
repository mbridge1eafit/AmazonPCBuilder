// Servidor local de Armador PC V2. Solo sirve archivos y guarda un JSON: nunca consulta Amazon ni las tiendas
// (eso lo hace el conector en el navegador del usuario). Excepciones: seguir redirecciones de enlaces cortos de
// Amazon y leer la TRM oficial (datos.gov.co, Superintendencia Financiera).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepo } from './store-repo.js';
import { createConnector } from './connector-bundle.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 4330;
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const TRM_URL = 'https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=1';

export function createServer({ dataDir = path.join(ROOT, 'data'), fetchImpl = fetch } = {}) {
  const repo = createRepo(dataDir);
  const connector = createConnector(path.join(PUBLIC, 'js', 'connector'));

  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  async function readBody(req, limit = 20 * 1024 * 1024) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 });
      chunks.push(c);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  const routes = {
    'GET /api/store': async (req, res) => {
      const st = await repo.read();
      return st ? send(res, 200, st) : send(res, 404, { error: 'Sin datos: ejecuta npm run migrate o usa datos de ejemplo.' });
    },
    'PUT /api/store': async (req, res, url) => {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.status || 400, { error: e.status ? e.message : 'JSON inválido' }); }
      const r = await repo.write(body, { force: url.searchParams.get('force') === '1' });
      return r.ok ? send(res, 200, { ok: true, rev: r.rev }) : send(res, 409, { error: 'Otro dispositivo guardó cambios', current: r.current });
    },
    'POST /api/store/reset': async (req, res) => send(res, 200, await repo.seed()),
    'GET /api/connector/version': async (req, res) => send(res, 200, { version: await connector.version() }),
    'GET /api/connector': async (req, res) => {
      // Detrás de `tailscale serve` (celular) el armador se abre por https: el origen del marcador debe coincidir.
      const host = req.headers.host || '';
      const proto = req.headers['x-forwarded-proto'] || (/\.ts\.net(:\d+)?$/i.test(host) ? 'https' : 'http');
      return send(res, 200, await connector.bundle(`${proto}://${host}`), 'text/javascript; charset=utf-8');
    },
    'GET /api/resolve': async (req, res, url) => {
      // Solo sigue la redirección de un enlace corto (amzn.to, a.co) para obtener el ASIN.
      let target = url.searchParams.get('url') || '';
      for (let hop = 0; hop < 5 && /^https:\/\/(amzn\.to|a\.co|amzn\.com)\//i.test(target); hop++) {
        const r = await fetchImpl(target, { redirect: 'manual' });
        const next = r.headers.get('location');
        if (!next) break;
        target = new URL(next, target).toString();
      }
      return send(res, 200, { url: /^https:\/\/(www\.)?amazon\.com\//i.test(target) ? target : null });
    },
    'GET /api/trm': async (req, res) => {
      // TRM oficial vigente (dataset 32sa-8pi3 de datos.gov.co).
      try {
        const r = await fetchImpl(TRM_URL, { signal: AbortSignal.timeout(8000) });
        const [row] = await r.json();
        const trm = Number(row?.valor);
        if (!Number.isFinite(trm) || trm <= 0) throw new Error('Respuesta sin TRM');
        return send(res, 200, { trm, date: String(row.vigenciadesde).slice(0, 10), until: String(row.vigenciahasta || '').slice(0, 10), source: 'datos.gov.co (Superfinanciera)' });
      } catch (e) {
        return send(res, 502, { error: `No pude leer la TRM oficial: ${e.message}. Escríbela a mano.` });
      }
    },
  };

  async function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) return send(res, 403, 'Prohibido', 'text/plain');
    try {
      const buf = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
      res.end(buf);
    } catch {
      send(res, 404, 'No encontrado', 'text/plain');
    }
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        const route = routes[`${req.method} ${url.pathname}`];
        return route ? await route(req, res, url) : send(res, 404, { error: 'No encontrado' });
      }
      return await serveStatic(res, url.pathname);
    } catch (e) {
      if (!e.status || e.status >= 500) console.error(e);
      send(res, e.status || 500, { error: e.message });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, HOST, () => console.log(`Armador PC V2 → http://localhost:${PORT}`));
}
