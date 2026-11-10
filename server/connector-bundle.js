// Empaqueta el conector (marcador) en un solo script: parsers compartidos + lógica del conector.
// amazon.com no puede cargar scripts de localhost (CSP), por eso el marcador lleva el código embebido.
// La versión es un hash de los tres archivos: si cambian, el marcador instalado queda desactualizado.
// Los tres archivos deben sobrevivir a este minificado simple: sin imports, sin contenido en líneas que solo
// son comentario `//`, y sin depender de la indentación.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { CATEGORIES } from '../public/js/domain/categories.js';

const FILES = ['amazon-parse.js', 'store-parse.js', 'connector.src.js'];

export function createConnector(dir) {
  const read = () => Promise.all(FILES.map((f) => readFile(path.join(dir, f), 'utf8')));
  async function version() {
    return createHash('sha1').update((await read()).join('')).digest('hex').slice(0, 8);
  }
  async function bundle(appOrigin) {
    const [parse, stores, src] = await read();
    const shared = parse.replace(/^export /gm, '') + '\n' + stores.replace(/^export /gm, '');
    const main = src
      .replace('const VERSION = __VERSION__;', `const VERSION = ${JSON.stringify(await version())};`)
      .replace('const APP = __APP__;', `const APP = ${JSON.stringify(appOrigin)};`)
      .replace('const CATS = __CATS__;', `const CATS = ${JSON.stringify(CATEGORIES.map(({ key, name }) => ({ key, name })))};`);
    return `(() => {\n${shared}\n${main}\n})();`.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join('\n');
  }
  return { version, bundle };
}
