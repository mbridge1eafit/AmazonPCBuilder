# Armador PC — Especificación de producto para el rediseño UX/UI

> Documento para el diseñador (o agente de diseño) que hará el rediseño completo.
> Dice **qué necesita el usuario, qué debe hacer el producto, qué datos maneja y qué reglas aplica**. No dice cómo debe verse: eso lo define el diseño.
> Fuente: código actual (`public/`, `server.js`, rama `feat/comercios-precios`), datos reales de `data/store.json` e investigación de producto (nov-2026).

## Cómo leer este documento

| Parte | Secciones | Qué es |
|---|---|---|
| **A. Producto** | 1–6 | Usuario, necesidades, principios, **requisitos priorizados**, criterios de aceptación y decisiones del usuario. **Es lo que manda.** |
| **B. Dominio** | 7–13 | Modelo de datos estandarizado, tiendas/destinos/monedas/impuestos, categorías y especificaciones, estados, compatibilidad, consumo y comparación. |
| **C. App actual** | 14–21 | Cómo funciona hoy (arquitectura, datos, inconsistencias, pantallas, flujos, errores, escala, restricciones). Sirve para **no perder nada**; donde contradiga a la parte A, manda la parte A. |
| **D. Calidad** | 22–23 | Revisión de buenas prácticas de UX/UI por sección y lista de verificación. |

Los requisitos tienen identificador (**R1**, **R2**…) y prioridad: **Debe** (imprescindible para el rediseño), **Debería** (importante, se puede escalonar), **Podría** (deseable).

## Índice

**A. Producto**
1. Propósito, usuario y contexto de uso
2. Necesidades del usuario (investigación)
3. Principios del producto
4. Requisitos priorizados
5. Criterios de aceptación y métricas
6. Decisiones del usuario

**B. Dominio**
7. Modelo de datos estandarizado
8. Tiendas, destinos, monedas, impuestos y costos
9. Categorías y especificaciones
10. Estado, decisión y señales de un producto
11. Revisiones de compatibilidad y compra
12. Consumo eléctrico
13. Comparar

**C. App actual**
14. Arquitectura que condiciona el diseño
15. Modelo de datos actual
16. Inconsistencias del modelo actual
17. Inventario de vistas actuales
18. Flujos actuales
19. Estados del sistema, errores y mensajes
20. Preferencias locales, persistencia y escala real
21. Restricciones técnicas

**D. Calidad**
22. Revisión de buenas prácticas de UX/UI por sección
23. Lista de verificación

---

# Parte A — Producto

## 1. Propósito, usuario y contexto de uso

**Qué es.** Una app web local para **planear y comprar un PC por piezas** desde Colombia. Para cada pieza el usuario junta varias **opciones** (productos candidatos), las compara, decide cuál compra y ve el **costo real puesto en destino**: precio + envío + impuestos de importación (Colombia) o sales tax (Miami).

**Usuario.** Una sola persona (uso personal, sin cuentas ni colaboración). Vive en Medellín, compra en tiendas de Colombia y de EE. UU.: en Amazon con envío a Colombia o a su dirección en Miami (ZIP 33186), y en otras tiendas de EE. UU. con envío a Miami. Perfil completo en 2.1. Conoce de hardware: le importan sockets, DDR, ranuras M.2, controladores de SSD, certificaciones de cables, etc.

**Dispositivos.** Escritorio (principal, Chrome en Windows) y **celular Android** (Chrome) a través de Tailscale. En el celular, la pestaña de Amazon debe estar en «Sitio para computadoras».

**Idioma y formatos.** Español (Colombia). Hoy los montos van en **US$** como moneda principal (`US$1,234.56`, formato en-US) y **COP** como referencia (`COP 3.188.000`, formato es-CO). Fechas es-CO. Tiempos relativos: «ahora», «hace 5 min», «hace 3 h», «hace 2 d».

**Problemas que resuelve** (lo que el rediseño debe seguir resolviendo):
- Saber **cuánto cuesta de verdad** cada pieza en Colombia (Amazon muestra cargos de importación solo con sesión y dirección colombiana).
- Mantener los pedidos **por debajo del umbral** de exención de impuestos en Colombia (hoy US$200; ver 8.4).
- Comparar el mismo producto en **varias tiendas**: Amazon Colombia, Amazon USA, Newegg, Best Buy, Walmart, Target, B&H, Micro Center y Mercado Libre (solo Colombia). Cada tienda tiene su destino de envío y su moneda.
- Comparar **opciones entre sí** por especificaciones (cientos de SSD, decenas de GPU).
- Verificar **compatibilidad** (socket, DDR, formato, altura, fuente, 12V-2x6, M.2/SATA, protector de picos).
- Llevar el **progreso de compra**: qué ya compró (y cuánto pagó), qué falta, qué queda para después.
- Registrar **qué tan decidido** está por cada opción (estrellas).
- Vigilar **cambios de precio** (historial, precio objetivo, bajó desde que compré, ofertas).

Referentes declarados por el autor: PCPartPicker, BuildCores, Pangoly, DropReference.

## 2. Necesidades del usuario (investigación)

### 2.1 Usuario objetivo

- Entusiasta del hardware que **arma su propio PC** desde Medellín.
- Tiene **alto conocimiento técnico**: sockets, DDR, controladores de SSD, certificaciones de cables.
- Es **sensible al precio total**, no al precio de vitrina.
- **Compra por partes y a lo largo de semanas**: compra unas piezas, espera ofertas para otras y deja algunas para después (por ejemplo, la GPU).
- Tiene **dos lugares de entrega**: su dirección en Colombia y una dirección en **Miami**, desde donde trae las cosas a Colombia.
- Consulta y actualiza desde el **computador** y, a veces, desde el **celular**.
- Uso personal: una sola persona, sin cuentas ni colaboración.

### 2.2 Trabajos por hacer (jobs to be done)

| # | Cuando… | quiero… | para… |
|---|---|---|---|
| J1 | elijo una pieza entre muchas opciones | filtrar por lo que me importa y comparar lado a lado | decidir rápido y sin errores |
| J2 | encuentro un producto que me gusta | saber **en qué tienda y con qué destino** me sale más barato tenerlo, con todos los costos | no llevarme sorpresas en el checkout ni en la aduana |
| J3 | planeo las compras | agrupar lo que compro en pedidos que **no superen el umbral** libre de impuestos y aprovechen el envío gratis | pagar menos impuestos y envíos |
| J4 | los precios cambian (Black Friday, ofertas) | enterarme a tiempo y ver la **historia de precio por tienda** | comprar en el mejor momento |
| J5 | estoy armando el PC completo | saber que **todo es compatible** y que la fuente alcanza | no comprar piezas que no sirvan |
| J6 | dudo entre opciones | marcar qué tan decidido estoy y ver **qué falta decidir** | avanzar sin perder candidatos |
| J7 | voy comprando | registrar **lo que pagué** y ver cuánto falta frente al presupuesto | controlar el gasto real |
| J8 | estoy lejos del computador | consultar el armado y actualizar precios desde el celular | aprovechar una oferta cuando aparezca |

### 2.3 Hallazgos

| # | Hallazgo | Implicación |
|---|---|---|
| H1 | **La tienda y el destino van juntos.** Amazon con envío a Colombia y Amazon con envío a Miami tienen distinto precio, envío, impuestos, vendedores y disponibilidad. Mercado Libre (mercadolibre.com.co) solo vende para Colombia y en COP. Newegg, Best Buy, Walmart, Target y B&H se usan con entrega en Miami. | Una **tienda** es la combinación de comercio + destino de envío: **Amazon Colombia** y **Amazon USA** son dos tiendas distintas del mismo comercio. Cada tienda tiene un destino fijo, una moneda y una regla de impuestos (R2). |
| H2 | **Lo que importa es el costo puesto en las manos del usuario.** Comprar en Miami agrega el traslado a Colombia (por casillero) y, si supera el umbral, impuestos al entrar al país. Hoy ese tramo no existe y la comparación Colombia ↔ Miami es engañosa. | Total en destino para todas las tiendas y, como opción, **total puesto en Colombia** con el tramo Miami → Colombia (R14). |
| H3 | **Las reglas de impuestos de Colombia cambian.** En 2026 la exención de IVA para envíos pequeños bajó a US$50 (Decreto Legislativo 1474 de 2025) y luego la DIAN (Concepto 1470, feb-2026) la devolvió a US$200 para envíos que cumplan el TLC con EE. UU. El arancel tampoco aplica hasta US$200 FOB. | Las reglas (umbral, tasa, base, origen) deben ser **configurables, con fecha de vigencia y fuente**, y el usuario debe ver qué regla se aplicó (R6). |
| H4 | **El umbral se aplica por envío, no por producto.** Hoy la app asume un pedido por producto. Comprar dos cosas juntas puede superar el umbral; separarlas puede evitarlo, aunque pague dos envíos. | Decisión D2: **un pedido por producto**; el umbral se evalúa por producto y se avisa cuando se supera (R13). |
| H5 | **El mismo producto se llama distinto en cada tienda** y tiene variantes (capacidad, color, revisión). Comparar variantes distintas como si fueran iguales lleva a errores. | El producto es **independiente de la tienda** (R1) y debe poder vincularse con su ficha en cada tienda, con identificadores (MPN, UPC, ASIN) y aviso de variante dudosa (R18). |
| H6 | **El usuario necesita confiar en el número.** Hoy hay valores exactos, estimados, editados, parciales y viejos mezclados. | Cada cifra muestra su **origen y frescura** (según la tienda, estimado, editado, parcial, leído hace X) (R4). |
| H7 | **Las listas son grandes** (158 SSD y 42 GPU en los datos reales). El precio solo no basta para decidir. | Filtros por especificaciones con conteos, **precio por unidad de valor** (US$/TB, US$/GB de VRAM, US$/W) y poder **descartar** opciones sin borrarlas (R16, R19). |
| H8 | **Los referentes** (PCPartPicker, BuildCores) ofrecen precios de varias tiendas, historial de precio, alertas por producto y alertas por categoría con filtros, impuestos y reembolsos configurables. | Historial con gráfica por tienda (R8), alertas por producto (R15) y por categoría (R21), descuentos y cupones (R23). |
| H9 | **El envío y la entrega importan.** La fecha estimada de llegada y la disponibilidad cambian la decisión, sobre todo si hay prisa. | Fecha o plazo de entrega y disponibilidad como dimensiones de la comparación (R17). |
| H10 | **Comprar importado complica la garantía y las devoluciones.** | Campo opcional de garantía y devoluciones por tienda u oferta (R22). |
| H11 | **Leer datos requiere el marcador en cada pestaña** (Amazon y cada tienda), y la sesión de Amazon entrega en un solo destino a la vez. Es la mayor fricción de uso. | Actualizar en tres niveles y un **centro de actualización** que diga qué falta y qué acción tomar, tienda por tienda (R7). |
| H12 | **Piensa en dos monedas.** Compra en US$, pero su presupuesto y su vida están en COP. | Decisión D4: **US$ como moneda principal con COP al lado**, con la TRM y su fecha (R5). |

## 3. Principios del producto

1. **El total en destino manda.** Toda comparación de precio usa el costo completo de llegar al destino (precio + envío + impuestos), nunca solo el precio de vitrina.
2. **Misma base o se avisa.** Si dos cifras no son comparables (Colombia frente a Miami sin el traslado, un dato estimado frente a uno exacto), se dice explícitamente.
3. **El producto es uno; las tiendas son muchas.** El artículo se describe una vez; cada tienda solo aporta su oferta.
4. **Todo es opcional, nada se inventa.** Un dato que falta se muestra como faltante, no como cero. Lo estimado se marca como estimado.
5. **El usuario manda sobre lo automático.** Lo que se edita a mano no se pisa sin avisar, y se puede volver a lo leído.
6. **Mismas reglas en todas las categorías.** Filtros, orden, comparación, especificaciones y edición funcionan igual en CPU, SSD o cables.
7. **Decir siempre qué hacer.** Cada espera, error o dato faltante viene con la acción que lo resuelve.

## 4. Requisitos priorizados

### 4.1 Debe

| ID | Requisito |
|---|---|
| **R1** | **Producto independiente de la tienda.** El producto es el artículo: categoría, subtipo, nombre, marca, modelo, foto, especificaciones, viñetas e identificadores. Puede existir sin ninguna tienda. Cada dato guarda su origen (qué tienda lo leyó o si es manual). |
| **R2** | **Tienda = comercio + destino.** Cada tienda tiene un **destino de envío fijo**, una moneda, una regla de impuestos y una forma de lectura. Ejemplos: **Amazon Colombia** (envío a Medellín, cargos de importación) y **Amazon USA** (envío a Miami, sales tax) son dos tiendas del comercio Amazon; **Mercado Libre** solo Colombia (COP); Newegg, Best Buy, Walmart, Target y B&H con envío a Miami. Si un comercio vende a dos destinos, son dos tiendas. Catálogo en 8.2. |
| **R3** | **Tabla producto × tienda.** Cada producto tiene una fila por tienda donde se vende, con **todos los campos opcionales**: URL, precio (en la moneda de la tienda), precio del envío al destino de la tienda, impuesto si aplica (cargos de importación o sales tax, con su origen), precio «antes», disponibilidad, plazo de entrega, vendedor, notas. El **total en destino** se calcula. Se pueden agregar, editar y quitar filas. |
| **R4** | **Confianza del dato.** Cada cifra muestra su origen (según la tienda, estimado, editado, incluido) y su frescura (leído hace X, escrito a mano, desactualizado). Un total sin envío o sin impuesto conocido es **parcial**, y se dice qué falta. |
| **R5** | **Monedas.** Cada precio se guarda en su moneda original. **US$ es la moneda principal** de precios, totales y presupuesto, con el **equivalente en COP** al lado, la TRM usada y su fecha. Lo que está en COP (Mercado Libre) muestra su valor original y su equivalente en US$ (D4). |
| **R6** | **Reglas de impuestos configurables.** Por destino: tipo (importación o sales tax), tasa, umbral, base de cálculo, condición (origen EE. UU./TLC), vigencia y fuente. El desglose dice qué regla se aplicó. Ver 8.4. |
| **R7** | **Actualizar en tres niveles**, con el mismo comportamiento: **fila** (producto × tienda), **producto** (todas sus filas y su ficha) y **general** (todo el armado). Cada nivel muestra en su contexto en espera / en curso / listo / error y lo que cambió. Lo que no se puede leer ahora queda en espera **con la acción que lo destraba**: abrir la tienda y pulsar el marcador; cambiar la entrega de Amazon al otro destino; resolver un CAPTCHA. Reemplaza «↻ Actualizar», «↻ Actualizar todo» y «$ Actualizar precios». |
| **R8** | **Historial de precio por tienda, con gráfica.** Cada lectura o edición de una fila guarda un punto: fecha, precio, envío, impuesto, total y moneda. Por producto:<br>• gráfica en el tiempo con todas sus tiendas juntas y cada una por separado;<br>• lista de lecturas con su variación;<br>• mínimo, máximo y actual por tienda;<br>• referencias de precio objetivo, precio pagado y ofertas. |
| **R9** | **Comparar igual en todas las categorías:**<br>• opciones lado a lado, por especificaciones y por total;<br>• tiendas de un mismo producto;<br>• diferencia contra la opción elegida;<br>• historial.<br>Ver sección 13. |
| **R10** | **Mantener todo lo que la app ya hace:**<br>• categorías con íconos y estado;<br>• compatibilidad y consumo;<br>• estado (por comprar, comprado, planeado) y decisión por estrellas;<br>• precio pagado con lectura de pedidos;<br>• presupuesto;<br>• varios armados;<br>• exportar e importar;<br>• guía por categoría;<br>• conector y su panel. |
| **R11** | **Tienda de compra por candidato.** Cada producto elegido en el armado indica **en qué tienda se va a comprar**; eso es lo que suma al total. Mientras no se elija, suma la de **menor total en su destino** (Colombia o Miami, sin contar el casillero), marcada como sugerida; si las candidatas tienen destinos distintos, se avisa (D3). |
| **R12** | **Escritorio y celular**, con tema claro y oscuro. |
| **R13** | **Un pedido por producto** (D2). El umbral se evalúa por producto; se avisa cuando un producto lo supera y cuántos lo superan. |

### 4.2 Debería

| ID | Requisito |
|---|---|
| **R14** | **Tramo Miami → Colombia por casillero** (opcional, D1). Configuración: tarifa por libra o kilo, mínimo y días. Usa el peso del producto (dato opcional). Si el producto supera el umbral, suma el impuesto de entrada: IVA 19 % sobre valor + flete, más un arancel configurable, 0 % por defecto (D7). Con eso cada tienda de EE. UU. muestra, además del total en Miami, el **total puesto en Colombia** como referencia. |
| **R15** | **Alertas de precio por producto:** avisar cuando **cualquier tienda** baje del precio objetivo, cuando baje el precio respecto a la última lectura o respecto a lo pagado, o cuando entre en oferta. Las alertas se ven al actualizar y en un lugar propio. |
| **R16** | **Valor por dinero:** precio por unidad según la categoría (US$/TB en discos, US$/GB en RAM, US$/GB de VRAM en GPU, US$/W en fuentes, US$/núcleo en CPU…), usable para ordenar, filtrar y comparar. |
| **R17** | **Entrega:** plazo o fecha estimada de entrega por fila de tienda, y disponibilidad, como dimensiones de comparación. |
| **R18** | **Mismo producto en varias tiendas:** vincular la ficha de cada tienda al producto por identificadores (MPN, UPC, ASIN) o a mano, con aviso cuando la variante pueda no coincidir (capacidad, color, revisión). |
| **R19** | **Descartar opciones** sin borrarlas: ocultarlas de la lista y poder recuperarlas. |
| **R20** | **Tiendas configurables:** agregar una tienda nueva (por ejemplo, una tienda local de Medellín) con su comercio, destino, moneda y regla de impuestos. |

### 4.3 Podría

| ID | Requisito |
|---|---|
| **R21** | Alertas por categoría con filtros. Ejemplo: «avísame si aparece un SSD NVMe de 2 TB con DRAM por menos de US$120 en Colombia». |
| **R22** | Garantía y devoluciones por tienda u oferta (por ejemplo, si la garantía aplica en Colombia o el plazo de devolución). |
| **R23** | Descuentos, cupones y reembolsos por fila, restados del total. |
| **R24** | Condiciones aceptadas por el usuario: nuevo, open box, reacondicionado. Hoy todo lo que no es nuevo es error. |
| **R25** | TRM automática con fecha, en lugar de manual. |

### 4.4 Fuera de alcance

- Varios usuarios.
- Comprar dentro de la app.
- Planear envíos agrupados (D2).
- Consultar tiendas desde el servidor: hoy las bloquean, y por eso se lee con el navegador del usuario.

## 5. Criterios de aceptación y métricas

### 5.1 Criterios de aceptación (por requisito Debe)

- **R1–R3:**
  - Un producto puede tener 0 tiendas.
  - Se le pueden agregar Amazon Colombia y Amazon USA como filas distintas.
  - Una fila de Mercado Libre solo admite destino Colombia y moneda COP.
  - Ningún campo de la fila es obligatorio.
- **R4:** frente a cualquier total se puede saber, sin salir de la vista, de qué se compone, de dónde salió cada parte y hace cuánto se leyó.
- **R5:** toda cifra en US$ muestra su equivalente en COP, y toda cifra en COP su equivalente en US$, con la TRM y su fecha.
- **R6:**
  - Cambiar el umbral de Colombia (US$200 ↔ US$50) recalcula todo.
  - El desglose nombra la regla aplicada.
- **R7:**
  - Desde una fila, un producto o el armado se lanza una actualización.
  - Lo que queda en espera dice exactamente qué hacer.
  - Al terminar se ve qué cambió.
- **R8:**
  - Tras dos lecturas de una tienda, su serie aparece en la gráfica.
  - Las tiendas en COP se pueden comparar en US$.
- **R9:** la comparación con escala peor → mejor y «Gana en» está disponible en todas las categorías.
- **R11:** el total del armado usa la tienda de compra elegida; si no hay elegida, se ve que es la sugerida.

### 5.2 Métricas (uso personal)

- Porcentaje de candidatos elegidos con **total completo** (no parcial).
- Porcentaje de filas de tienda **leídas en los últimos N días**.
- Piezas compradas con **error de compatibilidad**: meta 0.
- **Ahorro estimado**: total con la tienda elegida frente a la tienda más cara con dato.
- Pasos y tiempo para **actualizar todo** el armado (incluida la apertura de pestañas).

## 6. Decisiones del usuario

Respuestas del usuario a las preguntas abiertas (nov-2026). Ya están aplicadas en los requisitos y en el dominio.

| # | Tema | Decisión | Dónde aplica |
|---|---|---|---|
| D1 | Traslado Miami → Colombia | **Por casillero**: tarifa por libra o kilo, con mínimo y días | R14, 7.2, 8.3, 8.4 |
| D2 | Umbral de impuestos | **Un pedido por producto**, como hoy. El umbral se evalúa por producto; no se planean envíos agrupados | R13, 8.1, 8.6 |
| D3 | Tienda que suma al total mientras no se elija | **La de menor total en su destino** (Colombia o Miami, sin contar el casillero), marcada como sugerida | R11, 8.5 |
| D4 | Moneda | **US$ como moneda principal, con COP al lado** (no hay selector de moneda) | R5, 7.1, 8.3, 8.6 |
| D5 | Tiendas con dos destinos | **Solo Amazon** (Amazon Colombia y Amazon USA). Las demás tiendas de EE. UU. van solo a Miami | R2, 8.2 |
| D6 | Micro Center | **Recogida en sede**: sin envío, precio y sales tax de la sede elegida | 8.1, 8.2 |
| D7 | Impuesto de entrada por casillero sobre el umbral | **IVA 19 % sobre valor + flete, más arancel configurable** (0 % por defecto) | R14, 8.4 |

---

# Parte B — Dominio

## 7. Modelo de datos estandarizado

Contrato conceptual para diseñar pantallas y componentes. Los nombres son orientativos; lo importante son las relaciones y los campos.

```
Merchant (comercio) ─< Store (tienda = comercio + destino) >─ Destination ─< TaxRule
Category ─< SpecDefinition
Category ─< Product ─< SpecValue
Product ─< Offer (producto × tienda) ─< PriceObservation
Build ─< Candidate (producto en el armado) ─ Purchase
Product/Category ─< Alert          Build ─< Check (calculado)
Settings (globales) · Build.budget       Money / Currency
```

### 7.1 Money y Currency
- `Money = { amount, currency }`, con `currency` en {USD, COP}.
- Se guarda **en la moneda original**. Se muestra en **US$** (moneda principal) con su equivalente en COP, la **tasa usada** (TRM de Ajustes con fecha, la de la tienda o manual) y si es **estimada**.
- Conversión: `USD = COP / TRM`.

### 7.2 Destination (destino de envío)
| id | Nombre | Notas |
|---|---|---|
| `co` | Colombia (Medellín) | Destino final del usuario |
| `us-mia` | EE. UU. — Miami (ZIP 33186) | Dirección en EE. UU.; desde aquí se trae a Colombia por casillero |
| `us-pickup` | EE. UU. — Recogida en sede | Micro Center (D6): sin envío; sales tax de la sede |

Campos:
- `id`, `nombre`, `país`, `ciudad o ZIP`;
- `reglas de impuesto[]` (7.3);
- `tramo hacia Colombia?` (R14, D1): casillero con tarifa por libra o kilo, mínimo, días e impuesto de entrada (D7).

### 7.3 TaxRule (regla de impuesto, R6)
`{ destino, tipo (importación-IVA | importación-arancel | sales tax), tasa, umbral?, base (precio | precio + envío | valor FOB), condición (origen EE. UU./TLC, uso personal, unidades), tope? (ej. surtax de Florida sobre los primeros US$5.000 por artículo), vigente desde/hasta, fuente, nota }`. Valores iniciales en 8.4.

### 7.4 Merchant y Store
- **Merchant (comercio):** `{ key, nombre, logo, dominio, forma de lectura (sesión de Amazon | pestaña propia con el marcador | solo manual) }`. Agrupa las tiendas que comparten marca, sesión y lector.
- **Store (tienda):** `{ key, comercio, nombre visible, destino (fijo), moneda, regla de impuestos, base de comparación, impuestos incluidos en el precio?, notas (garantía, devoluciones) }`.
- Ejemplos: «Amazon Colombia» y «Amazon USA» son dos tiendas del comercio Amazon; «Mercado Libre» es una tienda del comercio Mercado Libre con destino Colombia. Catálogo en 8.2.
- Configurables por el usuario (R20).

### 7.5 Product (artículo, independiente de la tienda — R1)
`{ id, categoría, subtipo?, título, marca, modelo?, imagen, identificadores { MPN?, UPC?, ASIN?, SKU por tienda? }, peso? (R14), specs: SpecValue[], viñetas[], calificación?, reseñas?, condición }`. Cada dato guarda su **origen**: qué tienda lo leyó o si es manual.

### 7.6 SpecDefinition y SpecValue (iguales en todas las categorías)
- `SpecDefinition = { key, categoría, subtipo?, etiqueta, tipo (número | lista | sí/no | texto), unidad?, mejor (más | menos | no aplica), orden de calidad? (para listas), filtro (umbral | exacto | valor), usos [compatibilidad, filtro, orden, comparar, tarjeta, valor por dinero], editable, formato }`.
- `SpecValue = { key, valor, origen (detectado | ficha de una tienda | manual), texto original? }`. Lo manual manda.
- Las etiquetas de compatibilidad y las características son la misma definición con usos distintos.

### 7.7 Offer (fila producto × tienda — R3)
Todo opcional salvo producto y tienda. El destino, la moneda y la regla de impuestos **vienen de la tienda**.

| Campo | Notas |
|---|---|
| `productId`, `store` | |
| `url` | Validada contra el dominio del comercio |
| `price` | En la moneda de la tienda |
| `shipping` | Envío al destino de la tienda; vacío = desconocido, 0 = gratis |
| `tax` | Impuesto informado o editado; si falta, se estima con la regla. `taxSource`: según la tienda \| estimado \| editado \| incluido |
| `listPrice` | Precio «antes»; oferta si es mayor que `price` |
| `discount` | Cupón o reembolso (R23) |
| `qty` | Unidades por compra, si aplica |
| `landed` | **Calculado**: total en destino, equivalentes en US$ y COP, `partial` y qué falta |
| `landedCO` | **Calculado** si hay tramo (R14): total puesto en Colombia |
| `seller`, `shipsFrom` | |
| `availability`, `inStock` | |
| `delivery` | Plazo o fecha estimada (R17) |
| `shipsToDestination` | sí \| no \| sin confirmar |
| `condition` | |
| `sellerOffers[]` | Otras ofertas dentro de la tienda (vendedores de Amazon): precio, envío, condición, vendedor, entrega |
| `variantMatch` | Exacto \| por nombre \| dudoso (R18) |
| `fetchedAt`, `readStatus`, `readError` | |
| `edited{campo: fecha}` | |
| `notes` | |

### 7.8 PriceObservation (historial por tienda — R8)
`{ offerId, fecha, precio, envío, impuesto, total, moneda, tasa, origen (lectura | manual | pedido) }`.

### 7.9 Candidate (producto dentro de un armado)
| Campo | Notas |
|---|---|
| `productId`, `categoría` | |
| `selected` | Si está elegido en el armado |
| `discarded` | Descartado sin borrar (R19) |
| `status` | Por comprar \| Ya comprado \| Planeado |
| `decision` | 0–3 estrellas; se conserva aunque no esté elegido |
| `qty` | |
| `purchaseOfferId` | Tienda donde se va a comprar (R11); si no hay, la sugerida |
| `targetPrice` | Money (R15) |
| `wattsOverride` | |
| `notes` | |

### 7.10 Purchase (lo pagado)
`{ candidateId, tienda, total: Money (fijo), desglose { artículo, envío, impuestos, descuentos }, fecha, pedido?, origen (factura de la tienda | manual), coincidencia (identificador | nombre), exacto }`. La lectura de facturas existe hoy solo para Amazon.

### 7.11 Alert (R15, R21)
`{ id, alcance (producto | categoría con filtros), condición (total ≤ X | baja vs última lectura | en oferta | baja vs lo pagado), tiendas o destinos?, activa, última vez cumplida }`.

### 7.12 Check y Settings
- `Check = { nivel (error | aviso | nota | correcto), título, detalle, categorías[], candidatos[] }`.
- **Settings globales:**
  - TRM con fecha;
  - reglas de impuesto por destino;
  - casillero Miami → Colombia;
  - margen de fuente;
  - días de precio viejo;
  - minutos para no releer.
- **Por armado:** presupuesto (Money).

---

## 8. Tiendas, destinos, monedas, impuestos y costos

### 8.1 Destinos
| Destino | Impuestos | Umbral | Tramo posterior |
|---|---|---|---|
| Colombia (Medellín) | Importación: IVA y arancel, salvo exención (8.4). Las tiendas locales incluyen impuestos en el precio | US$200 por pedido; un pedido por producto (D2, configurable) | — |
| Miami (ZIP 33186) | Sales tax de Florida + Miami-Dade | — | Casillero a Colombia (R14, opcional) |
| Recogida en sede (EE. UU.) | Sales tax del estado y condado de la sede (configurable) | — | El usuario lo lleva |

### 8.2 Catálogo de tiendas (inicial)
| Tienda | Comercio | Destino | Moneda | Impuesto | Cómo se lee | Notas |
|---|---|---|---|---|---|---|
| **Amazon Colombia** | Amazon | Colombia (Medellín) | USD; si la cuenta muestra COP, se convierte y se guarda lo mostrado | Cargos de importación que informa Amazon; si no, estimados con la regla | Sesión de Amazon **entregando en Colombia** | Varios vendedores por producto; vendedores externos pueden no cobrar cargos (se pagan en aduana); lectura de pedidos y facturas |
| **Amazon USA** | Amazon | Miami | USD | Sales tax estimado | Sesión de Amazon **entregando en Miami** | Mismo lector que Amazon Colombia; solo cambia la dirección de entrega en Amazon |
| Newegg | Newegg | Miami | USD | Sales tax | Pestaña propia con el marcador | |
| Best Buy | Best Buy | Miami | USD | Sales tax | Pestaña propia | |
| Walmart | Walmart | Miami | USD | Sales tax | Pestaña propia | |
| Target | Target | Miami | USD | Sales tax | Pestaña propia | |
| B&H | B&H | Miami | USD | Sales tax | Pestaña propia | |
| Micro Center | Micro Center | Recogida en sede (D6) | USD | Sales tax de la sede | Pestaña propia | Sin envío; precio de la sede elegida en la tienda |
| **Mercado Libre** | Mercado Libre | **Solo Colombia** | **COP** | Incluido en el precio | Pestaña propia (mercadolibre.com.co) | Tienda local |
| (otras) | — | El que se configure | El que se configure | El que se configure | Manual o pestaña | R20 |

- Una tienda **solo** admite su destino y su moneda.
- Si un comercio vende a dos destinos, son dos tiendas. Hoy solo Amazon (D5).
- Hoy la lectura automática de tiendas que no son Amazon trae precio, disponibilidad y título. El envío, el precio «antes» y la nota se escriben a mano.

### 8.3 Total de una fila producto × tienda
1. `subtotal = (precio − descuento) × cantidad`.
2. Impuesto según la regla del destino de la tienda:
   - **Colombia, tienda que importa (Amazon Colombia):**
     - los cargos que informa la tienda (válidos con cantidad 1) → «según la tienda»;
     - si no los informa y el producto supera el umbral → `IVA × (subtotal + envío)` (más arancel si se configura) → «estimado»;
     - si no supera el umbral → 0 → «exento».
     - Si el vendedor es externo y no cobra cargos, el total es **parcial** (se pagan en aduana).
   - **Colombia, tienda local (Mercado Libre):** «incluido».
   - **Miami:** `tasa × subtotal`, con el tope configurado → «estimado», o el informado o editado.
3. `total en destino = subtotal + envío + impuesto`. Si falta el envío o el impuesto, el total es **parcial** y se dice qué falta.
4. **Total puesto en Colombia** (tiendas de Miami, si hay casillero configurado): total en Miami + casillero (peso × tarifa, con mínimo) + impuesto de entrada si el producto supera el umbral: IVA 19 % × (valor + flete) + arancel configurable (D7). Es una **referencia**: la tienda sugerida (R11) usa el total en destino.
5. **Equivalentes** en US$ (principal) y COP, con la TRM y su fecha. Si la tienda mostró COP, también «según la tienda».

### 8.4 Reglas de impuesto iniciales (configurables, con vigencia y fuente)
| Destino | Regla | Valor inicial | Fuente / nota |
|---|---|---|---|
| Colombia | IVA importación | 19 % | Estatuto Tributario |
| Colombia | Exención de IVA para tráfico postal y envíos urgentes desde EE. UU. (TLC) | Hasta **US$200** por envío | Concepto DIAN 1470 de 2026 (desde el 29-ene-2026). Antes de esa fecha, en 2026 rigió US$50 (Decreto Legislativo 1474 de 2025). **Confirmar antes de comprar** |
| Colombia | Arancel | 0 hasta US$200 FOB; por encima, según la mercancía | DIAN, modalidad de tráfico postal y envíos urgentes |
| Colombia (entrada por casillero) | Impuesto de entrada sobre el umbral | IVA 19 % sobre valor + flete, más arancel configurable (0 % por defecto) | Decisión D7; el courier puede cobrar distinto, por eso el valor es editable |
| Miami | Sales tax | 7 % (6 % Florida + 1 % surtax Miami-Dade) | El surtax aplica a los primeros US$5.000 de un artículo; el exacto sale en el checkout |

### 8.5 Comparación entre tiendas
- **Más bajo:** el menor total en US$ entre las filas con precio.
  - Se compara **en la misma base**: en destino, o puesto en Colombia si hay tramo.
  - Si se comparan destinos distintos sin tramo, se avisa (principio 2).
- **Oferta:** `precio «antes» > precio`.
- **Tendencia:** ▲/▼ contra la lectura anterior de la fila, más el historial y la gráfica (R8).
- **Estado de cada fila:** leído hace X / escrito a mano / en espera / error (se conserva el último precio).

### 8.6 Totales del armado
Solo cuentan los candidatos **elegidos**, cada uno con su **tienda de compra** (R11):

| Total | Regla |
|---|---|
| Por comprar | Suma de los *Por comprar*, desglosada en subtotal, envío e impuestos |
| Ya comprado | Lo **pagado** si está registrado; si no, el precio de hoy, y se cuenta como «sin precio pagado» |
| Planeado | Suma de los *Planeado* |
| Total del armado | Por comprar + ya comprado + planeado |
| Pedidos | Número de pedidos (uno por producto por comprar) y cuántos superan el umbral (D2) |
| Sin precio | Por comprar sin precio |
| Decisión | Número y suma de ★★★ fijos por comprar; número sin decidir |
| Presupuesto | Se compara **solo con «Por comprar»**: «Quedan X de Y» o «Te pasas por X», en US$ con su equivalente en COP |
| Por tienda | Cuánto se compra en cada tienda y destino |

### 8.7 Precio pagado
- Lo pagado queda **fijo** en el total del armado. Los precios de hoy se siguen leyendo para mostrar **subió/bajó desde tu compra**.
- **Leer de mis pedidos** (hoy solo Amazon):
  - busca por identificador o por nombre (≥70 % de coincidencia → «revísalo»);
  - con varios artículos en el pedido, el envío, los descuentos, los cargos y los impuestos se reparten según el valor de cada uno;
  - la tarjeta de regalo y los puntos no bajan lo pagado.
- **Manual:** monto en US$ o COP (se guarda el original y la tasa), fecha y tienda.
- Al marcar un producto como «Ya comprado», se pregunta cuánto se pagó.

## 9. Categorías y especificaciones por categoría

### 9.1 Categorías (12, en este orden)

| key | Nombre | Corto | Esencial | Varios | Consumo base | Externo |
|---|---|---|---|---|---|---|
| cpu | Procesador | CPU | sí | no | 120 W | |
| cooler | Disipador de CPU | Disipador | sí | no | 6 W | |
| motherboard | Placa madre | Placa | sí | no | 50 W | |
| ram | Memoria RAM | RAM | sí | no | 10 W | |
| gpu | Tarjeta gráfica | GPU | sí | no | 250 W | |
| storage | Almacenamiento | Discos | sí | **sí** | 6 W | |
| psu | Fuente de poder | Fuente | sí | no | 0 | |
| case | Caja / chasis | Caja | sí | no | 0 | |
| fans | Ventiladores | Ventiladores | no | sí | 3 W | |
| accessories | Cables y accesorios | Accesorios | no | sí | 0 | |
| monitor | Monitor | Monitor | no | sí | 0 | **sí** (va al enchufe, no a la fuente) |
| peripherals | Periféricos | Periféricos | no | sí | 0 | |

- *Esencial*: si no hay elegido sale «Falta: …».
- *Varios*: se pueden elegir varias opciones a la vez («Agregar»/«Quitar»); si no, se **cambia** la elegida.
- Cada categoría se representa con su **nombre e ícono propio**. La vista general del armado se arma con las categorías y sus íconos, cada una con su estado (hoy: 17.2).

**Subtipos de «Cables y accesorios»** (detectados por título): Protector de picos · Cable DisplayPort · Cable HDMI · Cable SATA · Cable USB · Otro cable · Otro accesorio.

### 9.2 Especificaciones por categoría

Leyenda — Tipo: N número / E enumerado. Mejor: ↑ más es mejor, ↓ menos es mejor. Usos: **C** compatibilidad, **F** filtro, **O** ordenar, **T** tabla comparar, **L** línea de la tarjeta, **M** editable a mano.
Filtro: umbral (≥/≤ según «mejor»), exacto (cada valor) o por valor (enumerados). Todas las categorías tienen además **Marca** (E, F/T/L).

**CPU**
| Spec | Tipo | Unidad | Mejor | Usos |
|---|---|---|---|---|
| Núcleos | N | núcleos | ↑ | F O T L |
| Frecuencia | N | GHz | ↑ | F O T L |
| Socket (AM5, AM4, LGA1851, LGA1700, LGA1200, sTR5) | E | | | C F T L M |
| TDP | N | W | | C (consumo) M |
| Consumo (estimado, por modelo) | N | W | ↓ | F O T L |

**Disipador**
| Tipo (Aire / Líquida AIO) | E | | | F T L |
| Radiador (240/280/360/420) | N | mm | ↑ | F O T L |
| Altura | N | mm | ↓ | C F O T L M |
| Montajes / sockets (lista) | E múltiple | | | C M |
| Ruido | N | dB | ↓ | F O T L |

**Placa madre**
| Chipset (X870E, B650, Z790…) | E | | | F T L |
| Socket | E | | | C F T L M |
| Formato (E-ATX, ATX, Micro-ATX, Mini-ITX) | E | | | C F T L M |
| Memoria (DDR4/DDR5) | E | | | C F T L M |
| Ranuras M.2 | N | | ↑ | C F O T L M |
| Puertos SATA | N | | | C M |

**RAM**
| Capacidad | N | GB | ↑ | F O T L M |
| Velocidad | N | MT/s | ↑ | F O T L |
| Latencia (CL) | N | CLxx | ↓ | F O T L |
| Tipo (DDR4/DDR5) | E | | | C F T L M |
| Módulos | N | | | C (consumo) M |

**GPU**
| Chip (RTX 5070 Ti, RX 9070 XT, Arc B580…) | E | | | F T L |
| VRAM | N | GB | ↑ | F O T L |
| Memoria (GDDR6/6X/7) | E | | | F T L |
| Frecuencia | N | GHz | ↑ | F O T L |
| Consumo (tabla por modelo) | N | W | ↓ | F O T L |
| Requiere 12V-2x6 | bool | | | C M |

**Almacenamiento**
| Capacidad (exacto; 1024 GB → 1 TB) | N | GB/TB | ↑ | F O T L M |
| Interfaz (NVMe/SATA) | E | | | C F T L M |
| PCIe (3.0/4.0/5.0) | E | | | F T L M |
| DRAM (Con DRAM / Sin DRAM HMB) | E | | | F T L M |
| Tipo de DRAM (LPDDR4, DDR4…) | E | | | F T L M |
| NAND (TLC/QLC/MLC) | E | | | F T L M |
| Controlador (Phison E18, SMI SM2508…) | E | | | F T L M |
| Disipador (Con/Sin) | E | | | F T L M |
| Lectura | N | MB/s | ↑ | F O T L M |
| Escritura | N | MB/s | ↑ | F O T L M |
| Durabilidad | N | TBW | ↑ | F O T L M |

**Fuente**
| Potencia | N | W | ↑ | C F O T L M |
| Certificación (80 Plus White…Titanium) | E | | | F T L |
| Modular (Totalmente / Semi / No) | E | | | F T L |
| 12V-2x6 nativo (sí / adaptable 12VHPWR-ATX 3.x / no) | E | | | C M |

**Caja**
| Placa máxima (formato) | E | | | C F T L M |
| Tamaño (Full/Mid/Mini Tower, SFF) | E | | | F T L |
| Disipador máx. | N | mm | ↑ | C F O T L M |
| Ventiladores incluidos | N | | | consumo |

**Ventiladores**
| Tamaño (80/92/120/140/200) | N | mm | ↑ | F O T L |
| Unidades en el pack | N | unid. | ↑ | F O T L M |
| Velocidad máx. | N | RPM | ↑ | F O T L |
| Ruido | N | dB | ↓ | F O T L |
| Iluminación (ARGB/RGB/Sin RGB) | E | | | F T L |

**Monitor**
| Tamaño | N | ″ | ↑ | F O T L |
| Frecuencia | N | Hz | ↑ | F O T L |
| Resolución (1080p/1440p/3440×1440/4K) | E | | | F T L |
| Panel (QD-OLED/OLED/IPS/VA/TN) | E | | | F T L |
| Respuesta | N | ms | ↓ | F O T L |
| Consumo (ficha o por tamaño) | N | W | ↓ | F O T L + protector de picos |

**Cables y accesorios** (las specs aplican según subtipo)
| Tipo (subtipo) | E | | | F T L (siempre) |
| Certificación (VESA DP80/DP54/DP40/DP8K, VESA sin clase, HDMI Ultra High Speed, Sin certificación) | E con rango | | ↑ | F T L |
| Versión (DP 2.1/1.4, HDMI 2.1…) | E con rango | | ↑ | F T L |
| Ancho de banda | N | Gbps | ↑ | F O T L |
| Longitud (exacto) | N | m | | F O T L |
| Forro (Trenzado/Normal) | E con rango | | | F T L |
| Protección (protector de picos) | N | J | ↑ | C F O T L M |
| Tomas | N | tomas | ↑ | C F O T L M |
| VPR (voltaje de limitación) | N | V | ↓ | C F O T L M |
| Capacidad | N | W | | C M |

**Periféricos**: solo Marca (no tiene especificaciones definidas).

**Reglas de las características (filtros):** una característica aparece como filtro solo si **al menos dos opciones tienen dato y hay al menos dos valores distintos** (algunas aparecen siempre: capacidad y DRAM en discos, tipo en accesorios). Los conteos por valor son **dinámicos** (cuántas quedarían con los demás filtros); los valores que dejarían cero se desactivan. Un filtro activo cuyo valor ya no existe sigue visible para poder quitarlo. Las numéricas con muchos valores se ofrecen en 6 umbrales repartidos.

### 9.3 Valor por dinero (R16)

Métrica de precio por unidad, calculada con el total en la tienda de compra (o la más barata) y una especificación de la categoría:

| Categoría | Métrica |
|---|---|
| Almacenamiento | US$/TB |
| RAM | US$/GB |
| GPU | US$/GB de VRAM |
| CPU | US$/núcleo |
| Fuente | US$/W |
| Monitor | US$/pulgada o US$/Hz |
| Ventiladores | US$/unidad |
| Cables | US$/m |

Se puede usar para ordenar, filtrar y comparar. Si falta la especificación o el precio, no se calcula.

## 10. Estado, decisión y señales de un producto

### 10.1 Estado (en qué punto va)
| key | Etiqueta larga | Corta | Efecto |
|---|---|---|---|
| buy | Por comprar | Comprar | Suma a «Por comprar» y a pedidos |
| bought | Ya comprado | Comprado | Suma lo pagado (o el precio de hoy) |
| planned | Planeado (después) | Planeado | Suma al consumo y a «Planeado», no a lo que se paga ahora |

### 10.2 Decisión (qué tan seguro está), 0–3 estrellas
| Nivel | Etiqueta | Ayuda |
|---|---|---|
| 0 ☆☆☆ | Sin decidir | Todavía no sé si lo compro |
| 1 ★☆☆ | Candidato | Me sirve, pero sigo mirando |
| 2 ★★☆ | Probable | Casi seguro que es este |
| 3 ★★★ | Fijo | Decidido: este lo compro |

Reglas: se marca en un clic; pulsar la misma estrella vuelve a 0. Vive en el producto aunque no esté elegido. Las opciones se ordenan por estrellas por defecto. «Actualizar todo» lee primero lo de más estrellas. Avisos: *Fijo sin elegir*, *Dos fijos en categoría de una pieza*, *N por decidir* / *Todo lo por comprar está decidido*. En la vista general por categorías, la categoría cuyo elegido es fijo se distingue.

### 10.3 Catálogo de señales (chips) que puede tener un producto
Estado · Oferta · Tienda (manual) · Miami (+ dirección de entrega) · < US$200 / ≥ US$200 · IVA · Envía a CO / No envía a CO / Envío CO sin confirmar · Vendedor (Amazon resaltado) · ★ calificación (reseñas) · N en stock / Agotado · Tu sesión · hace X / Sin leer con tu sesión · Faltan N datos (lista) · Precio de oferta (sin buybox) · Condición no nueva · 🎯 Precio objetivo alcanzado · ✎ Editado (campos) · × cantidad · Leyendo con tu sesión (cargando) · sin entrega en Colombia/Miami (dirección) · Parcial (*) en el total.

**Datos faltantes** (Amazon, Colombia): precio, envío, cargos de importación (salvo vendedor externo), envío a Colombia, vendedor, imagen, especificaciones, entrega en Colombia. En Miami: sin cargos ni envío a CO, y «entrega en Miami».

## 11. Revisiones de compatibilidad y compra

Cada revisión tiene nivel (**error / aviso / nota / correcto**), título, detalle y categorías afectadas (permite ir a la categoría). Se recalculan siempre.

| Grupo | Revisión | Niveles |
|---|---|---|
| Faltantes | Falta: {categoría esencial} | nota |
| CPU–placa | Socket igual / incompatible / sin confirmar | ok / error / aviso |
| RAM–placa | DDR igual / incompatible / sin confirmar; AM5 solo DDR5 | ok / error / aviso |
| Placa–caja | Formato cabe / no cabe / sin confirmar | ok / error / aviso |
| Disipador–caja | Altura ≤ máximo / muy alto / sin confirmar | ok / error / aviso |
| Disipador–CPU | Montaje compatible / sin montaje / sin confirmar | ok / error / aviso |
| Fuente | Con margen / justa / insuficiente / potencia sin detectar | ok / aviso / error / aviso |
| Fuente–GPU | 12V-2x6 nativo / 12VHPWR-ATX 3 (confirmar) / falta | ok / aviso / error |
| Protector de picos | Sin protector (recomendación J/VPR/tomas) · sobrecargado · al límite (>80 %) · julios sin confirmar · poca protección (<1000 J) · VPR alto (>500 V) · faltan tomas · suficiente | nota / error / aviso / ok |
| Discos–placa | Faltan ranuras M.2 · faltan puertos SATA · recordatorio cables SATA | error / nota |
| Compra (por producto por comprar) | No se envía a Colombia · No es nuevo · Sin precio · Supera US$200 (cargos según Amazon/estimados) · Precio desactualizado (N días) · ¡Precio objetivo alcanzado! | error / error / aviso / aviso / nota / ok |
| Comprado | N comprados sin precio pagado · Bajó de precio desde tu compra | nota |
| Decisión | Fijo sin elegir · Dos fijos · N por decidir · Todo decidido | aviso / aviso / nota / ok |

Indicador global: «Compatible» / «N avisos» / «N problemas» + «x/8 piezas esenciales».

## 12. Consumo eléctrico

- Consumo por pieza: CPU por modelo (potencia real) o TDP × 1,35; GPU por tabla de modelos (fallback 250 W); RAM 5–6 W por módulo; SSD/HDD 4–11 W; ventiladores 3–4 W c/u; caja y disipador según ventiladores incluidos (+5 W AIO); monitor por ficha o por tamaño (30–60 W); + 15 W base (USB, RGB, pérdidas). Valor manual por producto si se escribe.
- **Genérico** cuando el modelo no se reconoce (se avisa: «Consumo genérico: …»).
- Fuente recomendada = consumo × margen, redondeada a 50 W. Estado: sin fuente / insuficiente / poco margen / con margen.
- Incluye piezas planeadas (se indica). Monitores van aparte (enchufe), cuentan para el protector de picos (PC en el enchufe = consumo / 0,9).
- Desglose por pieza con proporción respecto a la fuente.

## 13. Comparar

El rediseño cubre cinco formas de comparar, **iguales en todas las categorías** (R9). Hoy la versión completa solo existe en Cables y accesorios.

1. **Opciones de una categoría, lado a lado.** Columnas = opciones; filas:
   - foto y título; decisión;
   - total en la tienda de compra (o en la más barata) y su destino;
   - desglose: producto, envío, impuestos;
   - bajo el umbral (sí/no);
   - **valor por dinero** (R16);
   - calificación y reseñas; vendedor y tienda; disponibilidad y entrega;
   - consumo;
   - todas las especificaciones de la categoría (incluidas las de compatibilidad);
   - acción para elegir esa opción.

   Reglas:
   - Compara las opciones visibles con los filtros; si quedan menos de 2, todas.
   - Se pueden **marcar** 2 o más opciones para comparar solo esas, quitar columnas y volver a las filtradas.
   - **Escala peor → mejor por fila** (sin escala si falta el dato o todos son iguales) y fila **«Gana en» N de M**.
   - Ordenada como la vista de opciones (por estrellas por defecto).
2. **Contra la elegida:** cada opción muestra la diferencia de total (+/−) contra la elegida.
3. **Tiendas de un mismo producto** (tabla producto × tienda):
   - total en destino y, si hay tramo, puesto en Colombia;
   - desglose y origen de cada dato;
   - moneda original y equivalente;
   - oferta (precio «antes») y más bajo;
   - tendencia y entrega;
   - estado de lectura;
   - enlace y botón de actualizar la fila.
4. **En el tiempo:**
   - historial y gráfica por tienda (R8);
   - cambio desde la compra;
   - resumen de cambios al terminar una actualización.
5. **Contra el presupuesto y la decisión:** cuánto suman los ★★★ fijos, qué falta por decidir y cuánto queda.

**Guía de referencia por categoría** (botón «i»): hoy solo existe la de **clases de cable DisplayPort**. Es una tabla DP8K/DP40/DP54/DP80 con:
- modo y ancho de banda;
- Hz máximos a 1080p, 1440p y 4K, con 8 y 10 bits;
- notas sobre DSC y sobre la cadena de puertos.

La estructura debe admitir guías en cualquier categoría.

---

# Parte C — App actual

> Cómo funciona hoy. Sirve para no perder nada; donde contradiga la parte A, manda la parte A.

## 14. Arquitectura que condiciona el diseño

- **Servidor local** Node (`localhost:4321`) que solo sirve archivos y guarda un JSON (`data/store.json`). **No consulta Amazon ni tiendas**.
- **Conector = marcador (bookmarklet) «➕ Armador PC»**. Corre dentro de la pestaña de amazon.com (o de la tienda) con las cookies del usuario y responde a la app por `postMessage` entre ventanas. Consecuencias de UX:
  - Para leer datos tiene que haber **una pestaña de Amazon abierta y el marcador pulsado** en ella. La app abre esa pestaña (solo dentro de un clic del usuario: los navegadores bloquean ventanas sin gesto).
  - Lo pedido sin conexión **queda en espera** y continúa al conectar.
  - El conector tiene **versión**; si la app cambió, el marcador instalado queda **desactualizado** y hay que reinstalarlo.
  - **Cada tienda distinta de Amazon** necesita **su propia pestaña** con el marcador pulsado (sus servidores bloquean consultas que no vengan del navegador).
  - El conector muestra **su propio panel flotante** dentro de Amazon/tienda (también es parte del rediseño, ver 17.11).
- **Destino de la sesión**: Amazon entrega a una sola dirección a la vez («Deliver to»). Si la sesión entrega en Medellín solo se actualizan productos con destino Colombia; si entrega en Miami, solo los de Miami. Cambiar de destino se hace **en Amazon**, no en la app.
- **Lectura de pedidos**: el conector también puede leer «Tus pedidos» y las facturas de Amazon para registrar el precio pagado.
- Sin frameworks ni build: HTML + CSS + JS de módulos. Tema claro/oscuro según el sistema.

## 15. Modelo de datos actual

### 15.1 Raíz (`store.json`)

| Campo | Tipo | Notas |
|---|---|---|
| `version` | número | 1 |
| `settings` | objeto | Ajustes globales (15.6) |
| `activeBuildId` | id | Armado visible |
| `builds[]` | lista | Armados (15.2) |

### 15.2 Armado (`build`)

| Campo | Tipo | Notas |
|---|---|---|
| `id`, `name` | texto | |
| `budget` | US$ \| null | Presupuesto **solo de lo que falta por comprar** (se edita en Ajustes) |
| `createdAt` | ISO | |
| `parts` | mapa `categoría → slot` | Una entrada por cada una de las 12 categorías |
| `parts[cat].options[]` | lista de productos | Candidatos de esa categoría (15.3) |
| `parts[cat].selected[]` | lista de ids | Los elegidos para el armado. Categoría de una pieza: 0 o 1; categoría «varios»: 0..n |

Un mismo producto (mismo ASIN) puede estar **copiado** en varios armados; al leerlo se actualizan todas las copias.

### 15.3 Producto / opción (mezcla datos de Amazon, de usuario y de tiendas)

**Identidad y origen**

| Campo | Notas |
|---|---|
| `id` | interno |
| `asin`, `url` | Amazon (`https://www.amazon.com/dp/ASIN`). En productos manuales `url` puede ser de otra tienda o null |
| `manual` | true = creado a mano (comprado en otra tienda, o solo existe en tiendas de EE. UU.) |
| `store` | texto libre en manuales («Newegg», «Tienda local», «Manual») |
| `market` | `'miami'` o ausente (= Colombia). **Destino del producto** |
| `salesTax` | true en manuales con destino Miami: su total suma sales tax |
| `source` | `'sesion'` si se leyó con la sesión del usuario |
| `region` | `'co'` \| `'us'` \| null: a dónde entregaba la sesión en la última lectura |
| `deliverTo` | texto de Amazon («Medellin 050022», «Miami 33186») |
| `locationOk` | false si la lectura no detectó entrega en Colombia |
| `loggedIn` | sesión iniciada al leer |
| `fetchedAt` | última lectura |

**Ficha (de Amazon)**: `title`, `brand`, `image`, `specs{clave: valor}` (en inglés o español, hasta 60), `bullets[]` (hasta 8), `rating`, `reviews`, `condition` («Nuevo» u otra), `availability` (texto), `seller`, `shipsFrom`, `hasBuybox`, `priceSource` (`'buybox'` \| `'oferta'`).

**Precio (de Amazon, normalizado a US$)**: `price`, `shipping` (al destino del producto), `importFees` (cargos de importación a CO; en Miami se reusa para sales tax editado), `importFeesInfo` (`'no-informado'` = vendedor externo que no cobra cargos → se pagan en aduana; `'manual'`), `total`, `currency`, `shipsToCO` (true/false/null), `listPrice` (precio «antes»), `displayed{currency:'COP', price, shipping, importFees, total}` (lo que mostró Amazon si la cuenta estaba en pesos), `fx{rate, source}` (tasa usada para convertir), `offers[]` (otras ofertas de Amazon: `price, currency, shipping, condition, seller, shipsFrom, origin, delivery`), `debug{}` (texto de la caja de compra leída).

**Datos del usuario**: `status` (`buy`\|`bought`\|`planned`), `pick` (0–3 estrellas), `qty` (1–20), `notes`, `targetPrice` (US$), `watts` (consumo manual), `tags{}` (correcciones manuales de especificaciones de compatibilidad), `edited{campo: fecha}` (campos editados a mano que el actualizador no debe pisar), `paid{}` (precio pagado, 3.5).

**Historial**: `history[]` = `{t, price, shipping, importFees, source?}` (máx. 120 puntos; se agrega un punto si cambió precio/envío o pasaron >12 h).

**Comercios**: `stores[]` (15.4).

### 15.4 Fila de comercio (`product.stores[]`)

| Campo | Notas |
|---|---|
| `store` | clave de tienda (catálogo actual en 15.4; nuevo en 8.2) |
| `url` | enlace a la ficha en esa tienda (validado contra el dominio de la tienda) |
| `price` | número en la moneda de la tienda |
| `currency` | `USD` \| `COP` |
| `shipping` | envío a Miami (solo tiendas de EE. UU.) |
| `listPrice` | precio «antes» (oferta si es mayor que `price`) |
| `note` | texto libre |
| `fetchedAt` | última lectura (null = escrito a mano) |
| `prev{price, at}` | precio anterior (para ▲/▼) |
| `error` | error de la última lectura (se conserva el último precio) |

La fila de **Amazon del mismo destino del producto no se guarda**: se deriva del propio producto.

### 15.5 Precio pagado (`product.paid`)

`total` (US$, fijo en el total del armado), `price`, `qty`, `currency`, `shipping`, `importFees`, `date` (AAAA-MM-DD), `orderId` (`114-…`), `items` (artículos en el pedido), `source` (`'pedido'` \| `'manual'`), `exact` (false si se repartieron envío/cargos entre varios artículos), `by` (`'asin'` \| `'nombre'` — por nombre = revisar), `matchedTitle`, `original{currency:'COP', amount, rate}` (si se pagó/escribió en pesos), `at`.

### 15.6 Ajustes (`settings`, globales)

| Clave | Por defecto | Significado |
|---|---|---|
| `trm` | 3160 (actual 3188) | COP por US$ |
| `threshold` | 200 | Umbral libre de IVA (US$) |
| `iva` | 0.19 | IVA estimado si Amazon no da los cargos |
| `miamiTax` | 0.07 | Sales tax Miami-Dade (6 % FL + 1 % condado) |
| `psuMargin` | 1.3 | Fuente recomendada = consumo × margen |
| `staleDays` | 3 (actual 1) | «Precio desactualizado» después de N días |
| ~~`refreshMinutes`~~ | — | Reemplazado: «Actualizar todo» omite lo leído bien hoy (máx. 1 vez al día); «Forzar actualización» relee todo |

Más el `budget` del armado activo (se edita en el mismo formulario).

### 15.7 Datos derivados (calculados, no guardados)

- **Etiquetas de compatibilidad** (`detectTags`): socket, sockets, tdp, memType, formFactor, m2Slots, sataPorts, coolerMaxMm, heightMm, sticks, capacityGb, psuWatts, has12v2x6, needs12v2x6, count, joules, outlets, capacityW, vpr, interface, pcie, dram, dramType, nand, controller, heatsink, readMBs, writeMBs, tbw. Se detectan del título/specs/viñetas; `tags` del usuario manda.
- **Características para filtrar/ordenar/comparar** (`FEATURES`, sección 9).
- **Costo de línea** (`lineCost`): qty, price, subtotal, shipping, importFees, total, overThreshold, feesSource (`amazon`\|`estimado`\|`editado`\|`local`\|`tax-miami`), ivaIfOver.
- **Totales del armado** (`totals`), **revisiones** (`checks`), **consumo** (`estimateWatts`), **datos faltantes** (`missingFields`), **oferta** (`isDeal`), **filas de comercio comparables** (`storeRows`, `shownStores`).

## 16. Inconsistencias del modelo actual

Para que el rediseño las tenga presentes (el modelo de la sección 7 las resuelve):

1. **El producto mezcla tres cosas**: el artículo (ficha), su oferta en Amazon (precio/envío/vendedor) y la decisión del usuario en un armado (estado, estrellas, cantidad). Si el mismo ASIN está en dos armados se duplica todo.
2. **Dos formas de «estar en otra tienda»**: un producto manual con `store` texto libre + `url` de Newegg, **o** una fila en `stores[]`. Los productos que solo existen en EE. UU. son «manuales» con `salesTax: true`.
3. **La fila de Amazon es implícita** para el destino del producto (sale del producto) y **explícita** para el otro destino (`stores[]` con `amazon-us`/`amazon-co`).
4. **Tres nombres para el destino**: `market` (`co`/`miami`), `region` (`co`/`us`) y `STORES[x].region` (`co`/`us`/sin región para Mercado Libre).
5. **Campos que cambian de significado según destino**: `shipping` es envío a Colombia o a Miami; `importFees` son cargos de importación o sales tax editado; `shipsToCO` solo aplica a Colombia.
6. **Monedas**: el producto siempre se guarda en US$ (lo de COP se convierte y se guarda aparte en `displayed`/`fx`); las filas de comercio pueden estar en COP; lo pagado tiene `original` en COP.
7. **Especificaciones en tres capas con nombres distintos**: `specs` crudas (EN/ES), etiquetas detectadas (`capacityGb`, `m2Slots`) y características (`capacity`, `m2`), más correcciones manuales en `tags` como texto. El formulario de corrección solo existe para algunas categorías (monitor, periféricos y accesorios no tienen; el protector de picos sí).
8. **Subtipos escondidos**: «Cables y accesorios» contiene protector de picos, cable DisplayPort/HDMI/SATA/USB, otros; cada subtipo tiene especificaciones propias pero no es una categoría.
9. **Historial solo para Amazon**: las tiendas solo guardan el precio anterior (`prev`).
10. **`listPrice`** existe a nivel producto y a nivel fila de comercio.
11. **Comparación desigual**: la tabla con escala de colores, «Gana en» y marcar para comparar solo existe en *Cables y accesorios*; las demás categorías tienen una tabla simple. La guía «i» solo existe para cables DisplayPort.
12. **Comparación entre tiendas no equivalente**: Amazon a Medellín incluye envío + importación; las tiendas de EE. UU. comparan precio + envío a Miami + tax **sin el costo de traer de Miami a Colombia** (no existe ese dato). Mercado Libre es precio local en COP. El «más bajo» compara bases distintas.
13. **El umbral de US$200 se evalúa por producto** (supuesto «un pedido por producto»), no por envío real.
14. **Ajustes mezclan** globales (TRM, IVA…) y del armado (presupuesto).
15. **Etiquetas de estado con textos distintos** según el lugar: «Por comprar/Comprar», «Ya comprado/Comprado», «Planeado (después)/Planeado».
16. **Ofertas de Amazon (`offers[]`)** son otra lista de precios separada de los comercios.
17. Campo huérfano en los datos: `genKey` (112 productos), no lo usa el código.

## 17. Inventario de vistas actuales

> Describe la app **actual**. En el rediseño aplican los requisitos de la parte A (R1–R25).

### 17.1 Barra superior
- Marca «Armador PC · amazon.com → Colombia».
- **Selector de armado** + menú: Nuevo, Duplicar, Renombrar, Eliminar (debe quedar uno), Copiar como Markdown, Exportar JSON, Importar JSON, Restaurar datos de ejemplo (destructivo).
- **Sesión de Amazon** (estado): «Conectar Amazon» / «Pulsa el marcador en Amazon · N en espera» / «Amazon conectado · N en curso»; muestra dirección de entrega en la ayuda; clic = abrir/enfocar pestaña.
- **Conector** (instalar marcador).
- **Actualizar todo (N)** / «Todo al día» / «↻ 3/12…» con ayuda de qué entra.
- **Actualizar precios** / «Precios 5/20…».
- **Ajustes**.

### 17.2 Panel lateral (resumen)
1. **Vista general por categorías**: las 12 categorías con su ícono y nombre; cada una muestra su estado (por comprar, comprado, planeado, vacío), si lo elegido es ★★★ fijo, si tiene error, y lo elegido (nombre corto y estrellas); al pulsarla se va a esa categoría.
2. **Indicadores**: compatibilidad (con nº esenciales) y consumo/fuente; clic abre la sección correspondiente.
3. **Total por comprar**: cifra principal, nº de productos, ≈ COP y TRM, desglose (subtotal, envío, impuestos), presupuesto, notas (N pedidos separados, N ≥ US$200 · IVA / todos < US$200, N sin precio, N sin decidir).
4. Secciones plegables (se recuerda cuáles están abiertas):
   - **Productos por comprar**: foto, categoría, decisión, señales, título (ir), cantidad × precio, envío, impuestos (est.), total con desglose, Quitar. Vacío: «No hay nada por comprar».
   - **Costo del armado completo**: botón Precio pagado (N sin registrar); grupos Por comprar / Ya comprado / Planeado con sus productos y montos (pagado fijo o «(hoy)»); Total del armado; resumen de fijos.
   - **Consumo eléctrico** (sección 12).
5. **Compatibilidad y compra**: lo que requiere atención visible, lo correcto plegado; contadores por nivel; clic = ir a la categoría.

### 17.3 Lista de categorías (contenido principal)
Por categoría: ícono, nombre, «varios», botón «i» (si hay guía), resumen de lo elegido o «Sin elegir»/«Opcional», contador de ★★★, «error»/«revisar», Desmarcar N (comparar), **Comparar N**. Resalte temporal al llegar desde otro lugar.

**Elegido (tarjeta de producto)**: foto, título (enlace), señales, estrellas, «Revisado hace X» y avisos de entrega; **caja de precio** (Total en destino o «Hoy en destino» si comprado; desglose; ≈ COP; «Registrar lo que pagaste»; si hay pagado: Pagado · fecha, COP original/pedido, «Hoy en Amazon» + ▲/▼); acciones Detalles, Actualizar / Vincular con Amazon / Leyendo…, Quitar del armado, Ver en Amazon; **tabla de comercios** (logo, nombre, subtítulo, «este producto», precio comparable, ▲/▼, desglose, Oferta + antes, Más bajo, ≈ US$, error).

Vacío: «Elige una de las opciones de abajo» / «Pega abajo un enlace de amazon.com para agregar opciones».

**Opciones (plegable «Opciones (N de M): cambiar o agregar»)**:
- Herramientas (si hay 2+): buscar (nombre, marca, vendedor, tienda, ASIN), Ordenar (General: Decisión, Precio total, Calificación, Reseñas, Nombre, Fecha agregada; Características: las numéricas comunes) + sentido (Menor→mayor, A→Z, Más recientes, Más estrellas…), Decisión (todas, ★+, ★★+, ★★★), Mostrar (Todas, Con precio, Con precio y envío confirmado), Total hasta US$, Sin IVA (< US$200), En oferta, filtros por características con conteos, «Mostrando N de M · Quitar filtros», ayuda de marcado.
- **Tarjeta de opción**: marcar para comparar (accesorios), foto, título, línea de especificaciones (resalta la que ordena/filtra), total con desglose, diferencia vs elegida o «elegido», señales, estrellas, comercios compactos (logo + precio, más bajo, %), acciones: Cambiar a este / Elegido ✓ (o Agregar/Quitar en «varios»), Actualizar, Detalles, Ver en Amazon.
- Ninguna coincide: mensaje + Quitar filtros.
- **Agregar**: campo de enlace (amazon.com, amzn.to, a.co), Agregar, Buscar en Amazon ↗, + Manual; mensaje de error en línea. Al agregar aparece de inmediato «Leyendo ASIN con tu sesión…».

### 17.4 Detalles del producto (modal)
- Encabezado con título; foto; señales; tabla de costo (producto, envío a destino, cargos/sales tax con fuente, total + COP, pagado con ▲/▼ y Registrar/Editar, tasa usada, vendedor/envía, disponibilidad, entrega a, última lectura, faltan).
- Estado, Decisión (con ayuda), Cantidad, Precio objetivo, Consumo (placeholder con el automático), Enlace de Amazon (si no tiene, para vincular).
- **Datos del producto** (editables con marca «editado»): título, foto (URL), precio, envío, cargos, vendedor, disponibilidad, ¿envía a Colombia? (sin confirmar/sí/no), tienda (manuales), **destino del envío** (Colombia/Miami). Nota de reglas de edición. «Descartar ediciones y actualizar con Amazon».
- **Comercios**: una fila por cada tienda: enlace, precio (US$ o COP), envío y «antes» (tiendas EE. UU.), total con tax, oferta, nota, estado (leído hace X / escrito a mano / error). La de su destino en Amazon dice «Es este producto».
- **Datos para compatibilidad** (por categoría; placeholder con lo detectado o «no detectado»).
- Notas, Historial de precio (línea), Diagnóstico de la última lectura (plegado), Ofertas para Colombia (condición, vendedor, envía/origen, precio, envío, entrega; no nuevas atenuadas), Características (viñetas), Especificaciones (tabla).
- Pie: Eliminar opción (confirmación), Abrir en Amazon, Actualizar con mi sesión, Guardar.

### 17.5 Producto manual (modal)
Nombre*, Estado, Decisión, Precio (US$), Tienda, Enlace (si es de Amazon se lee con la sesión), Imagen, Cantidad. Cancelar / Agregar.

### 17.6 Precio pagado (modal)
Lista de lo comprado (uno o todos): producto + origen del dato, Hoy en Amazon, Pagado (monto + US$/COP), Fecha. «Leer de mis pedidos de Amazon» con progreso («Leyendo facturas 3/10…», «Encontrados N de M (K pedidos revisados)»). Cancelar / Guardar.

### 17.7 Comparar (modal) — ver sección 13.

### 17.8 Actualizar precios (modal)
Explicación; una fila por **Amazon (entrega: …)** y por **cada tienda/dominio**: logo, nombre, progreso (barra, «Leyendo 3/8…», «✓ 8/8», «6/8 · 2 con error», «Cancelado», «Abre la tienda y pulsa ahí el marcador»), primer error, acción (Conectar Amazon / Abrir o Ir a {tienda} ↗). Nota de productos del otro destino omitidos. Tabla «Cambiaron de precio» (producto, tienda, antes, ahora ▲/▼) o «Ningún precio cambió». Pie: Cancelar lo pendiente / Seguir en segundo plano / Listo. El botón superior sigue mostrando el avance.

### 17.9 Resumen de cambios (modal minimizable + barra inferior)
Tras actualizar con la sesión: indicadores (productos con cambios, bajaron, subieron, meta alcanzada, cambios en envío); por producto: categoría, título (enlace), ASIN, foto, meta alcanzada, Precio antes → ahora (± monto y %; «Disponible»/«Sin precio»), Envío a Colombia, Cargos, ¿Envía a Colombia?, Disponibilidad, Vendedor, «Amazon reemplazó tus ediciones en…». Minimizar (queda una barra «Resumen de cambios: N productos · Ver resumen · ✕»), Cerrar.

### 17.10 Otros modales
- **Conector**: escritorio = botón arrastrable «➕ Armador PC» a la barra de marcadores, pasos, código para copiar. Celular = copiar código corto, pasos (guardar favorito «pcb», abrir Amazon, sitio para computadoras, escribir «pcb» en la barra), nota de la app de Amazon. «Listo, ya lo instalé».
- **Ajustes**: presupuesto del armado, TRM, umbral IVA, IVA estimado, sales tax Miami, margen de fuente, días para precio viejo, minutos para no re-consultar (con ayudas).
- **Guía** (por categoría).
- **Markdown** (vista del texto copiado: tabla con Pieza, Producto, Estado, Decisión, Total en CO, Precio, Envío CO, Cargos, < $200; totales por comprar/comprado/planeado, decididos, consumo).
- Diálogos nativos actuales: confirmar eliminar opción/armado/restaurar, nombre de armado, confirmar «¿Agregar al armado?» cuando llega un producto por enlace.

### 17.11 Panel del conector (dentro de Amazon y de las tiendas)
Flotante, aislado del estilo de la página, minimizable y cerrable.
- **Amazon**: estado (Conectado al armador / Sin armador + «Conectar con el armador ↗»), cuenta y «entrega: …» (o «No detecté sesión iniciada»), contadores (actualizados, en curso, errores), progreso de lectura de pedidos, último error.
- **En la ficha de un producto**: «Leyendo este producto…» → título, precio (oferta), envío a CO, cargos (o «no informados»), total, vendedor, envía a Colombia (sí/no/sin confirmar), avisos (sin entrega a Colombia, no es nuevo) y **«¿En qué categoría lo agrego?»** con las 12 categorías (una sugerida). Confirmación «✓ Agregado a …» / «✓ Enviado. Revisa la pestaña del armador».
- **Tiendas**: «● {Tienda} conectado al armador · deja esta pestaña abierta» o «Vuelve al armador y pulsa $ Actualizar precios», precios leídos/en curso/errores, último error; en una ficha muestra el precio que leería y «pega este enlace en Detalles → Comercios».
- Página puente para celular: «Abriendo amazon.com en esta pestaña…» + ayuda si se abre la app de Amazon.

### 17.12 Notificaciones breves (toasts)
Informativas y de error, 3–10 s. Ejemplos de casos: conectado (entrega), marcador desactualizado, sin sesión iniciada, pestaña cerrada con N en espera, conector sin respuesta, agregado/actualizado, precio cambió, actualizado con faltantes, ediciones conservadas/reemplazadas, destino no coincide, resumen de «Actualizar todo» (actualizados, omitidos por destino, omitidos por recientes, cambiaron, con error, incompletos), precios actualizados, fijo marcado (y «el armado usa otra opción»), armado duplicado/importado, Markdown copiado, no se pudo guardar, enlace que no es de la tienda.

## 18. Flujos actuales

> Flujos actuales; los de actualizar se unifican en los tres niveles de R7.

1. **Primera vez**: instalar marcador (Conector) → Conectar Amazon → en Amazon pulsar el marcador → conectado.
2. **Agregar opción**: (a) pegar enlace en la categoría → aparece de inmediato → se completa con la sesión; (b) en Amazon, pulsar el marcador en la ficha → elegir categoría; (c) + Manual; (d) Buscar en Amazon ↗ (abre en otra pestaña la búsqueda del texto escrito o del nombre de la categoría; en la ficha elegida se pulsa el marcador y se elige la categoría).
3. **Elegir / cambiar / quitar** opción (una pieza vs varios).
4. **Decidir** con estrellas.
5. **Actualizar uno** (↻) o **Actualizar todo** (solo lo pendiente y del destino de la sesión, primero lo de más estrellas) → Resumen de cambios.
6. **Actualizar precios** de todos los comercios → abrir cada tienda y pulsar el marcador → avance → cambios.
7. **Cambiar de destino**: cambiar la dirección en Amazon, recargar, pulsar marcador, actualizar el otro grupo.
8. **Editar datos a mano** y regla de conservación (Amazon solo los reemplaza si encuentra precio con envío a Colombia confirmado).
9. **Vincular** un manual con Amazon (conserva el estado).
10. **Registrar compra**: marcar Ya comprado → modal Precio pagado → leer de pedidos o escribir.
11. **Comparar** opciones (filtrar → comparar → elegir desde la tabla).
12. **Gestionar armados**: crear, duplicar para probar otra configuración, renombrar, eliminar, exportar/importar, copiar Markdown, restaurar ejemplo.
13. **Ajustar** TRM, impuestos, márgenes, presupuesto.
14. **Celular**: instalar marcador corto, conectar con «Sitio para computadoras».

## 19. Estados del sistema, errores y mensajes

| Situación | Qué pasa hoy |
|---|---|
| Sin sesión | Lo pedido queda **en espera**; el botón de sesión lo cuenta |
| Pestaña de Amazon abierta sin marcador | «Pulsa el marcador en Amazon» |
| Pestaña cerrada | Lo enviado vuelve a espera (aviso) |
| Conector no responde 90 s | Los pedidos en curso fallan con instrucción de recargar |
| Marcador desactualizado | Aviso persistente; leer pedidos se bloquea |
| Sesión no iniciada en Amazon | Aviso: envíos/cargos pueden no ser de la cuenta |
| Sesión entrega en otro destino | Producto **omitido sin tocarlo** con instrucción |
| CAPTCHA / verificación de tienda | Error «resuélvela en esta pestaña y reintenta» |
| La ficha no mostró precio | Fila de comercio con error; se conserva el último precio |
| Enlace no válido | «No encontré un producto en ese enlace…» |
| Producto leyendo | Tarjeta en estado cargando; botón deshabilitado |
| Datos faltantes | Chip «Faltan N datos» + en detalles |
| Total parcial | Asterisco y explicación |
| Guardado falla | Aviso de error (el guardado es automático, sin botón) |
| Lectura de pedidos | Progreso; tope 5 min |

## 20. Preferencias locales, persistencia y escala real

**Guardado**: automático en el servidor tras cada cambio (sin botón «Guardar» global; los modales sí tienen Guardar).
**Preferencias del navegador** (no viajan entre dispositivos): secciones laterales abiertas, vista de opciones por categoría (orden, sentido y filtros; la búsqueda no se guarda), opciones marcadas para comparar, «conector instalado».
**Escala real** (datos actuales, 1 armado, 221 productos):

| Categoría | Opciones | Elegidas |
|---|---|---|
| Almacenamiento | **158** | 1 |
| GPU | **42** | 0 |
| Cables y accesorios | 12 | 3 |
| Monitor | 2 | 2 |
| CPU, disipador, placa, RAM, caja, ventiladores, fuente | 1 c/u | 1 c/u |
| Periféricos | 0 | 0 |

- 153 productos con destino Miami, 115 manuales, 12 con precio pagado, 144 con filas de comercio (Newegg 111, Walmart 64, Amazon USA 48, B&H 35, Mercado Libre 26, Target 16, Best Buy 4).
- Historial de hasta 120 puntos por producto; títulos de Amazon muy largos (>150 caracteres); fotos de Amazon o ninguna (se usa el ícono de la categoría).

## 21. Restricciones técnicas

- Abrir pestañas (Amazon, tiendas) **solo dentro de un clic**: cualquier acción que lea datos debe empezar con un gesto del usuario.
- La comunicación depende de que **la pestaña de Amazon/tienda siga abierta**; en Android puede pausarse.
- El marcador se instala **arrastrándolo** (escritorio) o **pegando código** en un favorito (Android); se ejecuta escribiendo su nombre en la barra.
- Las imágenes vienen de dominios de Amazon (`media-amazon`); productos sin imagen usan ícono de categoría.
- El panel del conector vive dentro de páginas ajenas: debe ser autocontenido y no depender de los estilos de la app.
- Tema claro y oscuro automáticos (hoy). Accesibilidad existente a conservar: diálogos nativos, estrellas con `aria-pressed`, desglose de costo como botón con teclado/táctil, regiones `aria-live` para avance y avisos, Escape cierra el desglose.
- Repintado frecuente durante lecturas en lote: no perder foco ni lo escrito en buscadores/campos de enlace.
- Sin dependencias de ejecución; HTML/CSS/JS estáticos servidos por el servidor local.

---

# Parte D — Calidad

## 22. Revisión de buenas prácticas de UX/UI por sección

Revisa en **cada sección** del rediseño las buenas prácticas vigentes de UX y UI, y documenta la decisión que tomes. Esta sección no dice cómo resolverlo: lista criterios y riesgos que ya se observan.

**Base para todas las secciones:**
- las 10 heurísticas de usabilidad de Nielsen;
- WCAG 2.2 nivel AA: contraste, foco visible, tamaño mínimo de objetivos táctiles, información que no dependa solo del color, teclado y lector de pantalla;
- terminología consistente (hoy un mismo estado tiene varias etiquetas, ver 16);
- comportamiento adaptable entre escritorio y celular;
- tema claro y oscuro;
- microcopy en español de Colombia.

| Sección | Qué revisar |
|---|---|
| Navegación y barra superior | Jerarquía de las acciones globales; estado de conexión siempre visible (Amazon con su destino de entrega y cada tienda); acciones destructivas separadas; gestión de varios armados |
| Vista general por categorías | Que se pueda escanear de un vistazo; estado, fijo y error distinguibles sin depender solo del color; acceso directo a cada categoría; categorías vacías u opcionales |
| Resumen y costos | Jerarquía de cifras; divulgación progresiva del desglose; diferencia visible entre exacto, estimado y parcial; moneda, tasa y regla de impuesto aplicada; presupuesto; números alineados y comparables; totales por tienda; US$ y COP juntos |
| Lista de opciones (hasta 150+ por categoría) | Búsqueda, filtros facetados con conteos, orden (incluido valor por dinero); filtros activos visibles y fáciles de quitar; estados vacíos; rendimiento con listas largas; conservar el foco, lo escrito y la posición al repintar; selección única frente a múltiple; descartar y recuperar |
| Tarjeta de producto y de opción | Densidad y prioridad de la información; acción principal clara; títulos muy largos; productos sin imagen; señales sin saturar; tienda de compra visible |
| Tabla producto × tienda | Buenas prácticas de tablas de datos: encabezados, alineación numérica, edición en línea, campos opcionales, validación de URL por dominio con mensaje claro, destino y moneda de cada tienda evidentes, estado por fila, más bajo y oferta identificables, uso en celular |
| Actualizar (fila, producto, general) | Visibilidad del estado del sistema: en espera, en curso, listo, error; avance y cancelación; seguir trabajando mientras actualiza; errores accionables; agrupar por tienda la apertura de pestañas; resumen de cambios al terminar; no perder el contexto |
| Historial y gráfica de precios | Buenas prácticas de visualización de datos: escala y ejes, varias series distinguibles sin depender solo del color, leyenda, detalle de cada punto con puntero y en pantallas táctiles, referencias (objetivo, pagado, ofertas), alternativa en tabla accesible, casos con pocos datos |
| Comparar | Tablas comparativas: encabezados fijos, resaltar diferencias, ocultar filas iguales o vacías, escala que no dependa solo del color, muchas columnas en celular, elegir desde la comparación |
| Umbral por pedido | Mostrar claramente qué productos superan el umbral y cuánto suman en impuestos |
| Alertas | Configuración simple; diferenciar alertas nuevas de las vistas; evitar ruido |
| Compatibilidad y compra | Severidad clara; mensajes accionables que lleven a la causa; lo correcto sin hacer ruido |
| Detalles del producto y formularios | Agrupación de campos; valores detectados frente a manuales; marcas de «editado»; validación en línea; guardar y cancelar; prevención de errores; confirmación o deshacer en acciones destructivas (hoy se usan diálogos nativos del navegador) |
| Precio pagado | Edición en tabla; lo leído de los pedidos frente a lo escrito a mano; coincidencias «por nombre» para revisar; montos en US$ y COP |
| Ajustes, tiendas y reglas de impuesto | Agrupar globales y del armado; explicar el efecto de cada valor; vigencia y fuente de cada regla; valores por defecto; agregar tiendas |
| Conector y su panel en Amazon/tiendas | Onboarding de la instalación del marcador (escritorio y Android); explicar por qué hace falta; estado mínimo y claro dentro de páginas ajenas; marcador desactualizado; cambio de dirección de entrega en Amazon |
| Notificaciones | Duración y legibilidad; regiones aria-live; que lo importante no quede solo en un aviso temporal |
| Celular | Objetivos táctiles; tablas y comparaciones anchas; modales; flujo de conexión en Android |

## 23. Lista de verificación

**Requisitos (parte A)**
- [ ] R1–R13 (Debe) cubiertos en el diseño.
- [ ] R14–R20 (Debería) cubiertos o con espacio previsto.
- [ ] R21–R25 (Podría) evaluados.
- [ ] Decisiones del usuario (D1–D7, sección 6) aplicadas.

**Dominio (parte B)**
- [ ] Tienda = comercio + destino: Amazon Colombia y Amazon USA separadas; Mercado Libre solo Colombia en COP.
- [ ] Tabla producto × tienda con todos los campos opcionales, total en destino y, si aplica, puesto en Colombia.
- [ ] Monedas: US$ principal con COP al lado, TRM con fecha, reglas de impuesto con vigencia.
- [ ] 12 categorías con nombre e ícono, y vista general por categorías con estado, fijo y error.
- [ ] Especificaciones por categoría (9) con filtros dinámicos, orden, edición manual, origen del dato y valor por dinero.
- [ ] Subtipos de accesorios (protector de picos, cables de video) y sus especificaciones.
- [ ] Estado (3), decisión (4 niveles) y todas las señales (10.3).
- [ ] Totales, presupuesto, pedidos sobre el umbral y totales por tienda.
- [ ] Precio pagado: lectura de pedidos, reparto, manual US$/COP, cambio desde la compra.
- [ ] Compatibilidad (11) y consumo (12) completos.
- [ ] Las cinco formas de comparar (13), iguales en todas las categorías; guías por categoría.
- [ ] Actualizar en tres niveles, con espera accionable y resumen de cambios.
- [ ] Historial y gráfica de precio por tienda.

**App actual (parte C), que no se pierda**
- [ ] Conector: instalar (escritorio y Android), conectar, en espera, en curso, desactualizado, destino de entrega, panel dentro de Amazon y de las tiendas, agregar un producto desde Amazon.
- [ ] Edición manual con marcas y regla de reemplazo; vincular un producto manual con una tienda.
- [ ] Ofertas de vendedores, especificaciones, viñetas, diagnóstico de la lectura.
- [ ] Armados: crear, duplicar, renombrar, eliminar, exportar e importar JSON, Markdown, restaurar.
- [ ] Ajustes globales y presupuesto por armado.
- [ ] Escritorio y celular, claro y oscuro, listas de 150+ opciones.

**Calidad (parte D)**
- [ ] Revisión de buenas prácticas documentada para cada sección (22).
