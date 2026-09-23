# Armador PC · amazon.com → Colombia

App web local para armar un PC por categorías con productos de amazon.com. Cada producto muestra el **precio real con envío a Colombia, los cargos de importación y si el pedido queda bajo el umbral de US$200**, leídos **con tu sesión de Amazon**. Además revisa la compatibilidad (socket, RAM, formato, fuente, conector 12V-2x6).

## Uso

```bash
npm start          # http://localhost:4321
```

Requisitos: Node 20 o superior; no hay dependencias de ejecución (`npm install` solo instala las de pruebas). Los datos se guardan en `data/store.json` (la primera vez se usa `data/seed.json`).

1. **🔌 Conector:** arrastra el marcador «➕ Armador PC» a la barra de marcadores (y reemplaza el anterior cada vez que la app avise que cambió).
2. **● Conectar Amazon:** abre amazon.com; ahí pulsa el marcador una vez. Queda conectado mientras esa pestaña siga abierta.
3. Listo: **↻** en cualquier producto, **↻ Actualizar todo** y **Agregar** (con un enlace o ASIN) leen la ficha con tu sesión sin salir del armador.

## Desde el celular (Tailscale)

`tailscale serve --bg 4321` publica el armador solo dentro de tu red de Tailscale (`https://<equipo>.<red>.ts.net/`). En Chrome para Android:

- Instala el marcador **desde el celular** (🔌 Conector → «Copiar código del marcador»): el del computador apunta a `http://localhost` y no sirve. En el celular es un marcador corto que carga `/api/connector` por https (el completo, de ~35 KB, llega dañado a Chrome para Android), así que no hay que reinstalarlo cuando cambie el conector. Se ejecuta escribiendo su nombre en la barra de direcciones y tocando la sugerencia.
- «Conectar Amazon» pasa por `public/amazon.html`, que navega a amazon.com sin gesto del usuario para que Android no abra la app de Amazon. Si aun así la abre: Ajustes → Apps → Amazon Shopping → Abrir de forma predeterminada → desactiva «Abrir vínculos compatibles».
- En la pestaña de Amazon activa **⋮ → Sitio para computadoras**: el lector usa la ficha de escritorio.

## Cómo se lee Amazon: solo con tu sesión

El servidor no consulta Amazon. Toda la información sale del **conector**, un marcador que corre dentro de una pestaña de amazon.com con tu cuenta y tu dirección en Colombia:

```
armador (localhost) ──pcb:fetch {asin}──▶ conector en amazon.com ──fetch con tus cookies──▶ /dp/ASIN + ofertas
          ◀──pcb:data {ficha completa}──
```

- La comunicación es entre ventanas (`postMessage`): el armador abre la pestaña de Amazon (o el conector abre el armador) y queda la relación de ventana. amazon.com no envía `Cross-Origin-Opener-Policy`, así que la relación se mantiene; su CSP (`upgrade-insecure-requests`) impide llamar a `http://localhost` por HTTP, por eso no se usa esa vía.
- Cada pedido descarga la ficha (`/dp/ASIN?th=1&psc=1`) y las ofertas **en paralelo**; el conector atiende **2 productos a la vez** y agrupa pedidos repetidos del mismo ASIN. Medido con tu cuenta: 4 fichas completas en ~2,5 s.
- Si la pestaña de Amazon se cierra, lo pedido queda en espera y sigue al reconectar; si el conector no responde en 90 s, se marca como error.
- El armador no ve tus cookies ni tu contraseña: solo recibe los datos del producto, y solo acepta mensajes de amazon.com con campos conocidos.
- El conector entiende la ficha en **inglés o español** y en **USD o COP** (en COP convierte con la TRM de Ajustes, marcado como estimado).
- Pulsar el marcador en la **ficha de un producto** además ofrece agregarlo a una categoría.

## Actualizar

- **↻ en cada producto** (elegido u opción, incluidos los **ya comprados**): reescribe **toda** la información de Amazon con tu sesión (título, **foto**, precio, envío, cargos, vendedor, disponibilidad, especificaciones, ofertas). Se conservan tus datos: estado, cantidad, notas, etiquetas de compatibilidad, precio objetivo y consumo.
- **Editar a mano** (✎ Detalles → «Datos del producto»): título, foto, precio, envío, cargos, vendedor, disponibilidad y si envía a Colombia. En productos con enlace de Amazon, lo que cambies queda marcado **✎ Editado** y el actualizador **no lo sobrescribe**, salvo que tu sesión encuentre en Amazon **un precio con envío a Colombia** (precio + «envía a Colombia» + entrega en Colombia): entonces Amazon reemplaza todo y se quitan las marcas. Si no lo encuentra, se conservan tus ediciones y se actualiza el resto. «Descartar ediciones y actualizar con Amazon» quita las marcas y relee el producto.
- **🔗 Vincular con Amazon** en productos manuales (p. ej. comprados sin enlace): pega el enlace y la ficha se completa con tu sesión, sin cambiar su estado.
- **↻ Actualizar todo (n)**: pide de una vez todo lo que no se haya leído con tu sesión en los últimos N minutos (Ajustes, 10 por defecto) o que tenga datos faltantes; los productos leídos antes por el servidor (versiones anteriores) siempre entran. Si el mismo producto está en varios armados, se lee una sola vez y se actualizan todas sus copias.
- Cada producto muestra «Tu sesión · hace X» o «Sin leer con tu sesión», y «Faltan N datos» si Amazon no mostró precio, envío, cargos, envío a Colombia, vendedor, imagen o especificaciones. Los vendedores externos que envían por su cuenta no informan cargos (se pagarían en aduana): eso no cuenta como faltante.
- En «Detalles», **Diagnóstico de la última lectura** muestra el texto de la caja de compra que leyó el conector.
- Diagnóstico desde la consola de la pestaña de Amazon: `await __pcbConnector.request('B0DQ9PDT22')`.

## Funciones

Inspiradas en PCPartPicker, BuildCores, Pangoly y DropReference, adaptadas a comprar desde Colombia:

- **Categorías ilustradas** y un **diagrama del PC** que colorea cada pieza según su estado (por comprar, comprada, planeada, vacía).
- **Varias opciones por categoría** para cambiar de componente, con la diferencia de precio respecto a la elegida. Tabla **Comparar** lado a lado.
- **Estados por pieza:** *Por comprar*, *Ya comprado* y *Planeado*. Los planeados, como la GPU, cuentan para el consumo pero no para el total a pagar.
- **Decisión por estrellas** (aparte del estado): ☆☆☆ *sin decidir* · ★ *candidato* · ★★ *probable* · ★★★ **fijo** (ya lo decidiste). Se marca con un clic en las estrellas de la tarjeta; volver a pulsar la misma estrella lo deja sin decidir.
- **Costos Colombia:** envío, cargos de importación (los de Amazon o un IVA estimado si Amazon no los da), aviso ≥ US$200, un pedido por producto y conversión a COP con la TRM configurable.
- **Compatibilidad:** socket CPU/placa/disipador, DDR4/DDR5, formato placa/caja, altura del disipador, ranuras M.2 y puertos SATA, potencia de la fuente con margen y conector 12V-2x6 para GPU RTX 40/50.
- **Consumo estimado** por pieza y fuente recomendada.
- **Historial de precio** con cada lectura y **precio objetivo** con alerta.
- **Varios armados:** crear, duplicar, exportar/importar JSON y copiar como Markdown.

## Decisión: qué vas a comprar de verdad

El **estado** dice en qué punto va la pieza; las **estrellas** dicen qué tan decidido estás:

- Las estrellas viven **en el producto**, no en la selección del armado. Si marcas una fuente como ★★★ **fijo** y luego eliges otra opción, la fija sigue fija y el armador te avisa: «**Fijo sin elegir: Fuente de poder**». Tampoco se pierden al leer la ficha con tu sesión (↻ solo reescribe lo que viene de Amazon).
- Dentro de cada categoría, **las opciones se ordenan por estrellas**: lo más favorito queda de primero. Lo mismo en la tabla **Comparar**.
- Si hay **dos ★★★ en una categoría de una sola pieza**, sale un aviso: hay que escoger.
- El resumen «Por comprar» muestra **cuántos fijos hay y cuánto suman**, y cuántos siguen sin decidir. Cuando todo lo por comprar está ★★★, aparece «Todo lo por comprar está decidido».
- **↻ Actualizar todo** lee primero lo que tiene más estrellas.
- En el diagrama, la pieza queda con **contorno grueso** cuando lo elegido es fijo. «Copiar como Markdown» exporta una columna **Decisión**.

También se puede cambiar desde **✎ Detalles → Decisión**, y elegirlo al crear un producto manual.

## Estructura

```
server.js                 servidor HTTP: estáticos, datos (/api/store), conector empaquetado (/api/connector) y enlaces cortos (/api/resolve)
public/amazon-parse.js    extracción de fichas (readProduct/readOffers), compartida por el conector y las pruebas
public/connector.src.js   conector que corre en amazon.com (el servidor lo empaqueta en el marcador)
public/logic.js           compatibilidad, consumo, costos y reescritura con la sesión (sin DOM, con pruebas)
public/app.js             interfaz y enlace con la sesión de Amazon
test/                     npm test
```

`/api/resolve` solo sigue la redirección de enlaces cortos (amzn.to, a.co) para obtener el ASIN; no lee datos del producto.

## Límites

- Amazon cambia su HTML a menudo. Si un dato sale vacío, revisa «Diagnóstico» y `public/amazon-parse.js`; después reinstala el marcador.
- Si Amazon pide un CAPTCHA, resuélvelo en la pestaña de Amazon y vuelve a pulsar ↻.
- La compatibilidad es heurística: confirma altura del disipador, largo de GPU y espacio de la caja en las fichas.
- La exención de IVA por menos de US$200 depende de la normativa colombiana vigente. Los cargos que muestra Amazon son una estimación hasta el checkout.
