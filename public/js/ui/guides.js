// @ts-check
// Guías de referencia por categoría (botón «Guía»). La estructura admite una guía en cualquier categoría.
import { html } from './dom.js';
import { on, openDialog } from './ui.js';

export const GUIDES = {
  accessories: {
    label: 'Guía: clases de cable DisplayPort',
    title: 'Clases de cable DisplayPort (certificación VESA)',
    body: () => html`<div class="tbl-wrap"><table>
      <thead><tr><th>Clase</th><th>Modo DP</th><th class="r">Bruto / útil</th><th class="r">1080p 8 / 10 bits</th><th class="r">1440p 8 / 10 bits</th><th class="r">4K 8 / 10 bits</th></tr></thead>
      <tbody>
        <tr><td><strong>DP8K</strong></td><td>DP 1.4 · HBR3</td><td class="r num">32,4 / ~25,9 Gbps</td><td class="r num">~400 / ~330 Hz</td><td class="r num">~250 / ~200 Hz</td><td class="r num">~120 / ~97 Hz</td></tr>
        <tr><td><strong>DP40</strong></td><td>DP 2.1 · UHBR10</td><td class="r num">40 / ~38,7 Gbps</td><td class="r num">~550 / ~465 Hz</td><td class="r num">~350 / ~290 Hz</td><td class="r num">~175 / ~140 Hz</td></tr>
        <tr><td><strong>DP54</strong></td><td>DP 2.1 · UHBR13.5</td><td class="r num">54 / ~52,2 Gbps</td><td class="r num">~690 / ~585 Hz</td><td class="r num">~450 / ~375 Hz</td><td class="r num">~230 / ~185 Hz</td></tr>
        <tr><td><strong>DP80</strong></td><td>DP 2.1 · UHBR20</td><td class="r num">80 / ~77,4 Gbps</td><td class="r num">~880 / ~770 Hz</td><td class="r num">~610 / ~515 Hz</td><td class="r num">~320 / ~265 Hz</td></tr>
      </tbody></table></div>
      <ul style="margin:0;padding-left:18px;font-size:13px;display:flex;flex-direction:column;gap:4px">
        <li>Hz máximos aproximados <strong>sin compresión</strong> (RGB 4:4:4, temporización CVT-RB2). Cada monitor varía unos Hz.</li>
        <li><strong>DSC</strong> (compresión visualmente sin pérdida, hasta ~3:1) estira cualquier fila si la tarjeta y el monitor lo soportan.</li>
        <li>El cable no sube el límite: manda el puerto más lento de la cadena.</li>
        <li>DP80, DP54 y DP40 sirven también en puertos DP 1.4. Busca el sello <strong>VESA Certified</strong>.</li>
        <li>Para comparar usa los filtros <strong>Certificación</strong> y <strong>Ancho de banda</strong>.</li>
      </ul>`,
  },
  storage: {
    label: 'Guía: NAND y DRAM',
    title: 'Discos: NAND y DRAM',
    body: () => html`<ul style="margin:0;padding-left:18px;font-size:13px;display:flex;flex-direction:column;gap:6px">
      <li><strong>TLC</strong> (3 bits por celda) es lo habitual en discos de gama media y alta. <strong>QLC</strong> (4 bits) suele ser más barata y con menor durabilidad (TBW) y escritura sostenida.</li>
      <li><strong>Con DRAM</strong>: el controlador tiene caché propia para la tabla de direcciones. <strong>Sin DRAM (HMB)</strong>: usa una parte de la RAM del PC; rinde bien en uso normal, pero cae más en cargas largas.</li>
      <li><strong>TBW</strong> es la garantía de escritura del fabricante; compáralo entre discos de la misma capacidad.</li>
      <li><strong>PCIe 5.0</strong> necesita una ranura M.2 Gen5 en la placa; en una Gen4 trabaja a velocidad Gen4.</li>
      <li>Los datos salen de la ficha; si un valor está mal, corrígelo en Datos para compatibilidad: lo manual manda.</li>
    </ul>`,
  },
};
on('guide', (el) => {
  const g = GUIDES[el.dataset.cat];
  if (!g) return;
  openDialog(() => html`<div class="dlg-h"><h2 id="dlg-title">${g.title}</h2><button class="btn btn-g btn-s" data-act="close-dialog" aria-label="Cerrar">✕</button></div><div class="dlg-b">${g.body()}</div>`);
});
