// Ilustraciones de línea por categoría (48×48, heredan currentColor).
const svg = (body) => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  cpu: svg(`<rect x="12" y="12" width="24" height="24" rx="3"/><rect x="18" y="18" width="12" height="12" rx="1.5" fill="currentColor" fill-opacity=".18"/>
    <path d="M17 12V6M24 12V6M31 12V6M17 42v-6M24 42v-6M31 42v-6M12 17H6M12 24H6M12 31H6M42 17h-6M42 24h-6M42 31h-6"/>`),
  cooler: svg(`<rect x="8" y="8" width="14" height="30" rx="2"/><rect x="26" y="8" width="14" height="30" rx="2"/>
    <path d="M8 14h14M8 20h14M8 26h14M8 32h14M26 14h14M26 20h14M26 26h14M26 32h14"/><path d="M12 38v4M18 38v4M30 38v4M36 38v4M10 42h28"/>`),
  motherboard: svg(`<rect x="6" y="6" width="36" height="36" rx="3"/><rect x="12" y="12" width="12" height="12" rx="1.5" fill="currentColor" fill-opacity=".18"/>
    <path d="M29 11v16M33 11v16"/><rect x="11" y="30" width="26" height="4" rx="1"/><path d="M11 38h8M24 38h13"/>`),
  ram: svg(`<path d="M5 16h38v14H5z"/><path d="M5 30v4h16l2 2h2l2-2h16v-4"/>
    <rect x="9" y="19" width="6" height="8" fill="currentColor" fill-opacity=".18"/><rect x="18" y="19" width="6" height="8" fill="currentColor" fill-opacity=".18"/>
    <rect x="27" y="19" width="6" height="8" fill="currentColor" fill-opacity=".18"/><rect x="36" y="19" width="4" height="8" fill="currentColor" fill-opacity=".18"/>`),
  gpu: svg(`<rect x="4" y="12" width="40" height="22" rx="3"/><circle cx="15" cy="23" r="6.5"/><circle cx="33" cy="23" r="6.5"/>
    <path d="M15 19.5v7M11.5 23h7M33 19.5v7M29.5 23h7"/><path d="M10 34v4h14v-4"/>`),
  storage: svg(`<rect x="4" y="17" width="40" height="14" rx="2"/><rect x="9" y="20" width="9" height="8" fill="currentColor" fill-opacity=".18"/>
    <rect x="21" y="20" width="9" height="8" fill="currentColor" fill-opacity=".18"/><path d="M34 21h5M34 24h5M34 27h5"/><circle cx="41" cy="24" r="0.5"/>`),
  psu: svg(`<rect x="5" y="10" width="38" height="28" rx="3"/><circle cx="20" cy="24" r="9"/><circle cx="20" cy="24" r="2" fill="currentColor"/>
    <path d="M20 15v18M11 24h18M14 18l12 12M26 18L14 30"/><path d="M34 16h5M34 21h5M34 26h5"/><rect x="33" y="30" width="6" height="4" rx="1"/>`),
  case: svg(`<rect x="11" y="4" width="26" height="40" rx="3"/><path d="M11 40h26"/><circle cx="31" cy="9" r="1.5" fill="currentColor"/>
    <circle cx="24" cy="18" r="5"/><circle cx="24" cy="31" r="5"/><path d="M15 44v-2M33 44v-2"/>`),
  fans: svg(`<rect x="6" y="6" width="36" height="36" rx="5"/><circle cx="24" cy="24" r="3.5" fill="currentColor" fill-opacity=".25"/>
    <path d="M24 20.5c0-6 3-10 8-10-1 5-4 8-8 10zM27.5 24c6 0 10 3 10 8-5-1-8-4-10-8zM24 27.5c0 6-3 10-8 10 1-5 4-8 8-10zM20.5 24c-6 0-10-3-10-8 5 1 8 4 10 8z"/>`),
  accessories: svg(`<path d="M6 34c8 0 8-20 18-20s10 20 18 20"/><rect x="2" y="30" width="8" height="10" rx="1.5"/><rect x="38" y="30" width="8" height="10" rx="1.5"/>
    <path d="M4 40v3M8 40v3M40 40v3M44 40v3"/>`),
  monitor: svg(`<rect x="4" y="7" width="40" height="26" rx="2"/><path d="M18 41h12M24 33v8"/><path d="M9 12h12" stroke-opacity=".5"/>`),
  peripherals: svg(`<rect x="3" y="20" width="28" height="16" rx="2"/><path d="M7 25h2M12 25h2M17 25h2M22 25h2M27 25h0M9 31h14"/>
    <rect x="35" y="16" width="10" height="20" rx="5"/><path d="M40 16v6"/>`),
  // Logo de Amazon (la «a» con la sonrisa en flecha), para los enlaces a la ficha.
  amazon: `<svg class="amz-logo" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M13.6 10.1c0 1 .03 1.8-.47 2.7-.4.72-1.05 1.17-1.77 1.17-.98 0-1.56-.75-1.56-1.86 0-2.19 1.96-2.59 3.8-2.59v.58zm2.58 6.24a.53.53 0 0 1-.6.06c-.85-.7-1-1.03-1.47-1.7-1.4 1.43-2.4 1.86-4.22 1.86-2.15 0-3.83-1.33-3.83-3.99 0-2.08 1.13-3.5 2.73-4.19 1.39-.61 3.33-.72 4.81-.89v-.33c0-.61.05-1.33-.31-1.86-.31-.47-.91-.67-1.44-.67-.98 0-1.85.5-2.06 1.54-.05.23-.21.46-.44.47l-2.5-.27c-.21-.05-.44-.22-.38-.54C6.5 2.82 9.24 1.9 11.7 1.9c1.26 0 2.9.33 3.9 1.29 1.26 1.18 1.14 2.75 1.14 4.46v4.04c0 1.22.5 1.75.98 2.4.16.24.2.52-.01.7-.53.44-1.47 1.26-1.99 1.72l-.01-.01z"/>
    <path fill="#f90" d="M20.9 18.1C18.4 20 14.8 21 11.7 21c-4.36 0-8.28-1.6-11.25-4.28-.23-.21-.03-.5.26-.34 3.2 1.86 7.15 2.98 11.24 2.98 2.75 0 5.78-.57 8.57-1.76.42-.18.77.28.38.5z"/>
    <path fill="#f90" d="M21.94 16.92c-.32-.41-2.1-.2-2.9-.1-.25.03-.28-.18-.06-.34 1.42-1 3.75-.71 4.02-.37.27.34-.07 2.68-1.4 3.8-.21.17-.4.08-.31-.15.3-.75.97-2.43.65-2.84z"/>
  </svg>`,
};

// Diagrama de un chasis abierto; cada grupo [data-cat] se colorea según el estado de la pieza.
export const RIG = `
<svg class="rig" viewBox="0 0 300 380" role="img" aria-label="Diagrama del PC">
  <g data-cat="case" class="part"><rect x="6" y="6" width="288" height="368" rx="14"/><title>Caja</title></g>
  <g data-cat="fans" class="part">
    <circle cx="34" cy="82" r="20"/><circle cx="34" cy="136" r="20"/><circle cx="34" cy="190" r="20"/><circle cx="262" cy="64" r="18"/>
    <path d="M34 72v20M24 82h20M34 126v20M24 136h20M34 180v20M24 190h20M262 55v18M253 64h18" class="detail"/><title>Ventiladores</title>
  </g>
  <g data-cat="motherboard" class="part"><rect x="66" y="26" width="178" height="224" rx="6"/><title>Placa madre</title></g>
  <g data-cat="cpu" class="part"><rect x="104" y="58" width="44" height="44" rx="4"/><title>Procesador</title></g>
  <g data-cat="cooler" class="part"><rect x="96" y="44" width="60" height="72" rx="6" class="overlay"/>
    <path d="M100 56h52M100 66h52M100 76h52M100 86h52M100 96h52M100 106h52" class="detail"/><title>Disipador</title></g>
  <g data-cat="ram" class="part"><rect x="176" y="40" width="9" height="84" rx="2"/><rect x="190" y="40" width="9" height="84" rx="2"/>
    <rect x="204" y="40" width="9" height="84" rx="2" class="ghost"/><rect x="218" y="40" width="9" height="84" rx="2" class="ghost"/><title>Memoria RAM</title></g>
  <g data-cat="storage" class="part"><rect x="96" y="132" width="70" height="12" rx="2"/><rect x="206" y="298" width="72" height="22" rx="3"/><rect x="206" y="326" width="72" height="22" rx="3"/><title>Almacenamiento</title></g>
  <g data-cat="gpu" class="part"><rect x="72" y="160" width="190" height="42" rx="6"/>
    <circle cx="120" cy="181" r="14" class="detail"/><circle cx="204" cy="181" r="14" class="detail"/><title>Tarjeta gráfica</title></g>
  <g data-cat="accessories" class="part"><path d="M160 138c20 0 30 140 60 160" class="cable"/><path d="M150 300c-20-20-20-60 0-100" class="cable"/><title>Cables y accesorios</title></g>
  <g data-cat="psu" class="part"><rect x="22" y="290" width="160" height="66" rx="6"/><circle cx="92" cy="323" r="22" class="detail"/><title>Fuente de poder</title></g>
</svg>`;

// Marcas de las tiendas (24×24, colores de cada marca) para la tabla de comercios.
const amazonMark = `<path fill="#232f3e" d="M13.6 10.1c0 1 .03 1.8-.47 2.7-.4.72-1.05 1.17-1.77 1.17-.98 0-1.56-.75-1.56-1.86 0-2.19 1.96-2.59 3.8-2.59v.58zm2.58 6.24a.53.53 0 0 1-.6.06c-.85-.7-1-1.03-1.47-1.7-1.4 1.43-2.4 1.86-4.22 1.86-2.15 0-3.83-1.33-3.83-3.99 0-2.08 1.13-3.5 2.73-4.19 1.39-.61 3.33-.72 4.81-.89v-.33c0-.61.05-1.33-.31-1.86-.31-.47-.91-.67-1.44-.67-.98 0-1.85.5-2.06 1.54-.05.23-.21.46-.44.47l-2.5-.27c-.21-.05-.44-.22-.38-.54C6.5 2.82 9.24 1.9 11.7 1.9c1.26 0 2.9.33 3.9 1.29 1.26 1.18 1.14 2.75 1.14 4.46v4.04c0 1.22.5 1.75.98 2.4.16.24.2.52-.01.7-.53.44-1.47 1.26-1.99 1.72l-.01-.01z"/>
  <path fill="#f90" d="M20.9 18.1C18.4 20 14.8 21 11.7 21c-4.36 0-8.28-1.6-11.25-4.28-.23-.21-.03-.5.26-.34 3.2 1.86 7.15 2.98 11.24 2.98 2.75 0 5.78-.57 8.57-1.76.42-.18.77.28.38.5z"/>
  <path fill="#f90" d="M21.94 16.92c-.32-.41-2.1-.2-2.9-.1-.25.03-.28-.18-.06-.34 1.42-1 3.75-.71 4.02-.37.27.34-.07 2.68-1.4 3.8-.21.17-.4.08-.31-.15.3-.75.97-2.43.65-2.84z"/>`;
const logo = (body, bg = '#fff') => `<svg class="slogo" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="${bg}"/>${body}</svg>`;
export const STORE_LOGOS = {
  'amazon-co': logo(`<g transform="translate(2.4 1.6) scale(.8)">${amazonMark}</g>`),
  'amazon-us': logo(`<g transform="translate(2.4 1.6) scale(.8)">${amazonMark}</g>`),
  newegg: logo('<ellipse cx="12" cy="12.6" rx="6.6" ry="8" fill="#f68b1e"/><path d="M9.2 16V10.4m0 1.6c.5-1.3 1.5-1.9 2.6-1.9 1.4 0 2.2.9 2.2 2.5V16" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>', '#14396b'),
  bestbuy: logo('<path d="M4 7.5 13.5 4.2 20 10.7v8.6H4z" fill="#ffe000"/><circle cx="7.4" cy="10.3" r="1.3" fill="#0046be"/><path d="M9.6 13.6h7.2M9.6 16.4h5" stroke="#0a0a0a" stroke-width="1.5" stroke-linecap="round"/>', '#0046be'),
  microcenter: logo('<path d="M4.5 17.5V7.2l3.8 6 3.8-6v10.3" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M20 9.2a3.6 3.6 0 1 0 0 6.4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>', '#d0202e'),
  mercadolibre: logo('<ellipse cx="12" cy="12" rx="8.6" ry="6.2" fill="#fff" stroke="#2d3277" stroke-width="1.4"/><path d="M5.6 11.4c1.5.8 2.6.6 4.1-.7l1.6-1.3c.6-.5 1.4-.5 2 0l4.9 3.6M8.4 13.4l1.4 1.1m.6-2.2 2 1.6m0-2.6 2 1.6" fill="none" stroke="#2d3277" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>', '#ffe600'),
};
