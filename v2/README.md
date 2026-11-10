# Armador PC V2

Rediseño completo del armador (diseño «Armador PC — Rediseño», especificación en `../docs/brief-rediseno.md`).
Planea y compra un PC por piezas con el **costo real puesto en destino** (Colombia o Miami), varias tiendas por producto,
historial de precio, alertas, compatibilidad y consumo. Corre junto a V1 sin tocarla.

```bash
cd v2
npm run migrate          # una vez: ../data/store.json (V1) → data/store.json (V2). V1 no se modifica.
npm start                # http://localhost:4330  (PORT y HOST cambian el puerto y la interfaz)
npm test                 # dominio, migración, parsers del conector y servidor
```

- Node ≥ 20, ESM, **sin dependencias de ejecución ni build**. `cheerio` (pruebas) se toma de `../node_modules`.
- `npm run migrate -- --force` vuelve a migrar (guarda copia `.bak`); `-- --seed` regenera los datos de ejemplo.
- Ajustes → Datos → Importar acepta un JSON de V1 (lo migra) o de V2.
- **Hay que reinstalar el marcador** desde Ajustes → Conector: el de V1 apunta a otro puerto y otra versión.

## Arquitectura

```
server/          index.js (rutas) · store-repo.js (JSON atómico, rev → 409, copias por hora) · connector-bundle.js
public/js/
  domain/        lógica pura, sin DOM, probada con node --test
  connector/     amazon-parse.js · store-parse.js · connector.src.js  → empaquetados en el marcador (/api/connector)
  state/         store.js (estado único, update(), guardado con espera y control de versión) · prefs.js (este navegador)
  services/      api.js · connector-link.js (postMessage, colas, tiempos) · refresh.js (actualizar en 3 niveles)
  ui/            dom.js (plantillas con escape + morph) · ui.js (acciones delegadas, diálogos, avisos) · router.js
                 components.js · price-chart.js · guides.js · actions.js · views/*.js
public/styles/   tokens.css (claro/oscuro) · app.css
```

Reglas: `domain/` no importa nada de `ui/`, `state/` ni `services/`. Las vistas solo leen el estado y disparan
acciones (`data-act`, `data-submit`, `data-change`, `data-input`). Repintar usa `morph` para no perder foco,
lo escrito ni el scroll durante lecturas en lote. El servidor nunca consulta Amazon ni tiendas: solo sigue
enlaces cortos de Amazon y lee la TRM oficial de datos.gov.co (dataset `32sa-8pi3`).

Los tres archivos de `connector/` deben sobrevivir al minificado simple del marcador: sin imports, sin
contenido en líneas que solo son comentario `//`, nombres de nivel superior sin choques. Cambiar cualquiera
cambia la versión y el marcador instalado queda «desactualizado».

## Modelo de datos (`schema: 2`)

| Entidad | Qué es |
|---|---|
| `settings` | TRM con fecha y origen · destinos · `taxRules[]` (tasa, umbral, base, condición, vigencia, fuente) · casillero · márgenes · alertas |
| `merchants` / `stores` | Comercio (dominio, cómo se lee) y **tienda = comercio + destino** (moneda, regla de impuesto). Configurables |
| `products[id]` | El artículo, independiente de la tienda: ficha, identificadores (ASIN/MPN/UPC), peso, specs leídas y `specOverrides` manuales |
| `product.offers[]` | Fila producto × tienda: precio en la moneda de la tienda, envío, impuesto y su origen, «antes», cupón, entrega, vendedor, variante, lectura, ediciones, `history[]` |
| `builds[].candidates[]` | El producto dentro de un armado: elegido, descartado, estado, decisión (estrellas), cantidad, **tienda de compra**, precio objetivo, alertas, consumo manual, lo pagado |
| `alertEvents[]` | Alertas disparadas (nuevas / vistas) |

El total de una fila (`domain/offer-cost.js`) se calcula: subtotal, envío (vacío = sin dato), impuesto según la regla
del destino (Colombia: cargos de la tienda, estimado sobre el umbral o exento; Miami: sales tax con surtax y tope;
local: incluido), **parcial** con lo que falta, equivalentes US$/COP y, con casillero, el total puesto en Colombia.
Sin tienda de compra elegida, el armado suma la de menor total en su destino (sugerida).
