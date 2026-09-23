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
