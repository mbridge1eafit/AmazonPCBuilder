import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from './public/logic.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const STORE = path.join(DATA, 'store.json');
const SEED = path.join(DATA, 'seed.json');
const PORT = Number(process.env.PORT) || 4321;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

async function readBody(req, limit = 5 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('Cuerpo demasiado grande');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Empaqueta el conector (marcador) en un solo script: reglas compartidas + lógica del conector.
// La versión es un hash del código: si cambian el parser o el conector, el marcador instalado queda desactualizado.
async function connectorVersion() {
  const code = (await readFile(path.join(PUBLIC, 'amazon-parse.js'), 'utf8')) + (await readFile(path.join(PUBLIC, 'connector.src.js'), 'utf8'));
  return createHash('sha1').update(code).digest('hex').slice(0, 8);
}

async function buildConnector(appOrigin) {
  const parse = (await readFile(path.join(PUBLIC, 'amazon-parse.js'), 'utf8')).replace(/^export /gm, '');
  const src = (await readFile(path.join(PUBLIC, 'connector.src.js'), 'utf8'))
    .replace('const VERSION = __VERSION__;', `const VERSION = ${JSON.stringify(await connectorVersion())};`)
    .replace('const APP = __APP__;', `const APP = ${JSON.stringify(appOrigin)};`)
    .replace('const CATS = __CATS__;', `const CATS = ${JSON.stringify(CATEGORIES.map(({ key, name }) => ({ key, name })))};`);
  // Minificado simple para acortar el marcador: quita comentarios de línea completa e indentación.
  return `(() => {\n${parse}\n${src}\n})();`.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join('\n');
}

async function api(req, res, url) {
  if (url.pathname === '/api/resolve' && req.method === 'GET') {
    // Solo sigue la redirección de un enlace corto (amzn.to, a.co) para obtener el ASIN; los datos se leen con tu sesión.
    let target = url.searchParams.get('url') || '';
    for (let hop = 0; hop < 5 && /^https:\/\/(amzn\.to|a\.co|amzn\.com)\//i.test(target); hop++) {
      const r = await fetch(target, { redirect: 'manual' });
      const next = r.headers.get('location');
      if (!next) break;
      target = new URL(next, target).toString();
    }
    return send(res, 200, { url: /^https:\/\/(www\.)?amazon\.com\//i.test(target) ? target : null });
  }
  if (url.pathname === '/api/connector/version' && req.method === 'GET') {
    return send(res, 200, { version: await connectorVersion() });
  }
  if (url.pathname === '/api/connector' && req.method === 'GET') {
    // amazon.com no puede cargar scripts de localhost (CSP y acceso a red local), por eso el marcador lleva el código embebido.
    // Detrás de `tailscale serve` (celular) el armador se abre por https: el origen del marcador debe coincidir.
    const host = req.headers.host || '';
    const proto = req.headers['x-forwarded-proto'] || (/\.ts\.net(:\d+)?$/i.test(host) ? 'https' : 'http');
    return send(res, 200, await buildConnector(`${proto}://${host}`), 'text/javascript; charset=utf-8');
  }
  if (url.pathname === '/api/store' && req.method === 'GET') {
    const file = existsSync(STORE) ? STORE : SEED;
    return send(res, 200, await readFile(file, 'utf8'));
  }
  if (url.pathname === '/api/store' && req.method === 'PUT') {
    const body = await readBody(req);
    JSON.parse(body); // valida antes de escribir
    await mkdir(DATA, { recursive: true });
    await writeFile(STORE + '.tmp', body);
    await rename(STORE + '.tmp', STORE);
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/api/store/reset' && req.method === 'POST') {
    return send(res, 200, await readFile(SEED, 'utf8'));
  }
  return send(res, 404, { error: 'No encontrado' });
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Prohibido', 'text/plain');
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  } catch {
    send(res, 404, 'No encontrado', 'text/plain');
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return await serveStatic(res, url.pathname);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`PC Builder CO → http://localhost:${PORT}`);
});
