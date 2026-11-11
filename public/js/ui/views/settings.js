// @ts-check
// Ajustes: lo del armado (presupuesto) separado de lo global (TRM, destinos, impuestos con vigencia y fuente,
// casillero, tiendas, cálculos, alertas, conector, apariencia y datos).
import { html, raw } from '../dom.js';
import { icon, chip, seg } from '../components.js';
import { intCO, n2, copRaw, usd, cop } from '../format.js';
import { ui, on, rerender, toast } from '../ui.js';
import * as store from '../../state/store.js';
import * as api from '../../services/api.js';
import * as link from '../../services/connector-link.js';
import { prefsGet, prefsSet, applyTheme } from '../../state/prefs.js';
import { ruleActive } from '../../domain/tax.js';
import { connectionsList, extensionBanner, originsOfState } from '../connections.js';

let connectorHref = '';
let loaderHref = '';
let extensionDir = '';
async function loadConnector() {
  if (connectorHref) return;
  api.connectorInfo().then((r) => { extensionDir = r.extensionDir || ''; rerender(); }).catch(() => {});
  const code = await api.connectorCode();
  connectorHref = 'javascript:' + encodeURIComponent(code);
  // En Android el marcador completo llega dañado: uno corto carga el conector desde el armador (solo por https/Tailscale).
  loaderHref = `javascript:void((()=>{const s=document.createElement('script');s.src='${location.origin}/api/connector?t='+Date.now();s.onerror=()=>alert('Armador PC: no pude cargar el conector. Revisa que el computador y Tailscale estén encendidos.');document.head.append(s)})())`;
  rerender();
}
on('copy-code', async (el) => {
  const text = el.dataset.which === 'short' ? loaderHref : connectorHref;
  try { await navigator.clipboard.writeText(text); toast('Código copiado.'); } catch { toast('No pude copiar: selecciona el texto y cópialo.', { error: true }); }
});
on('bookmarklet-click', (el, e) => { e.preventDefault(); toast('Arrástrame a la barra de marcadores; no se usa con clic aquí.'); });
on('copy-ext-dir', async () => {
  try { await navigator.clipboard.writeText(extensionDir); toast('Ruta copiada.'); } catch { toast('No pude copiar: selecciona la ruta y cópiala.', { error: true }); }
});
on('connector-ok', () => { prefsSet({ connectorInstalled: true }); toast('Listo. Abre Amazon y pulsa el marcador para conectar.'); rerender(); });
on('theme', (el) => { prefsSet({ theme: el.dataset.value }); applyTheme(); rerender(); });
on('density', (el) => { prefsSet({ density: el.dataset.value }); applyTheme(); rerender(); });

const SECTIONS = [['armado', 'Presupuesto', 'SOLO ESTE ARMADO'], ['moneda', 'Moneda y TRM', 'GLOBALES'], ['destinos', 'Destinos'], ['impuestos', 'Impuestos por destino'], ['casillero', 'Casillero Miami → Colombia'], ['tiendas', 'Tiendas'], ['calculos', 'Cálculos y lectura'], ['alertas', 'Alertas'], ['conector', 'Conector'], ['apariencia', 'Apariencia'], ['datos', 'Datos']];
const TAX_MODE = { 'import-co': 'cargos de la tienda o estimados', 'sales-tax': 'sales tax del destino', included: 'incluido en el precio' };
const READ = { amazon: 'sesión de Amazon', tab: 'pestaña propia + marcador', manual: 'solo manual' };

export function settingsView(section) {
  loadConnector();
  const st = store.get();
  const env = store.env();
  const s = st.settings;
  const b = store.build();
  const trm = s.fx.trm;
  const dests = s.destinations;
  const rule = (id) => s.taxRules.find((r) => r.id === id);
  const th = rule('co-exempt')?.threshold;
  const fld = (label, path, value, { type = 'num', hint = '', scale = 0, w = '200px', placeholder = '' } = {}) => html`<label class="fld" style="flex:0 1 ${w}">${label}<input class="input${type === 'num' ? ' num' : ''}" data-change="setting" data-path="${path}" data-type="${type}"${raw(scale ? ` data-scale="${scale}"` : '')} value="${value ?? ''}" placeholder="${placeholder}" ${raw(type === 'num' ? 'inputmode="decimal"' : '')}>${hint ? html`<small>${hint}</small>` : ''}</label>`;
  const counts = {};
  for (const p of Object.values(st.products)) for (const o of p.offers) counts[o.store] = (counts[o.store] || 0) + 1;
  const storesOf = (d) => Object.values(st.stores).filter((x) => x.destination === d).map((x) => x.name).join(', ');
  const rulesOf = (d) => s.taxRules.filter((r) => r.dest === d).length;
  const pct = (r) => (r == null ? null : +(r * 100).toFixed(2));
  const pickupRate = rule('pickup-sales')?.rate;

  const ruleRow = (r) => {
    const destName = r.dest === 'locker' ? 'Colombia · casillero' : dests[r.dest]?.name || r.dest;
    const val = r.kind === 'exemption' ? `hasta US$${n2(r.threshold).replace('.00', '')}` : r.kind === 'entry' ? `IVA ${pct(r.rate)} % + arancel ${pct(r.duty)} %` : r.rate == null ? 'sin dato' : `${String(pct(r.rate + (r.surtax || 0))).replace('.', ',')} %`;
    const vig = r.from || r.until ? `${r.from ? `desde ${r.from}` : ''}${r.until ? ` hasta ${r.until}` : ''}` : 'vigente';
    const active = ruleActive(r);
    return html`<tr${raw(ui.editRule === r.id ? ' style="background:var(--sel)"' : '')} data-key="rule-${r.id}"><td><strong>${destName}</strong></td><td>${r.label}</td><td class="num">${val}</td><td>${r.base}</td><td>${r.condition}</td><td class="num">${active ? vig : html`<span style="color:var(--warn)">fuera de vigencia</span>`}</td><td>${r.source}${r.note ? html`<div class="muted" style="font-size:12px">${r.note}</div>` : ''}</td>
      <td><button class="btn btn-s ${ui.editRule === r.id ? '' : 'btn-g'}" aria-expanded="${ui.editRule === r.id}" data-act="rule-edit" data-rule="${r.id}">${ui.editRule === r.id ? 'Cerrar' : r.rate == null && r.kind === 'sales' ? 'Completar' : 'Editar'}</button></td></tr>
      ${ui.editRule === r.id ? html`<tr data-key="rule-edit-${r.id}"><td colspan="8" style="background:var(--sel);padding:16px 20px;border-bottom:1px solid var(--line-strong)">
        <form data-submit="rule-save" data-rule="${r.id}" class="edit-grid" aria-label="Editar regla ${r.label}">
          <label class="fld span2">Nombre<input class="input sm" name="label" value="${r.label}"></label>
          ${r.kind === 'exemption' ? html`<label class="fld">Umbral (US$)<input class="input sm num" name="threshold" value="${r.threshold ?? ''}"></label>` : ''}
          ${r.kind !== 'exemption' ? html`<label class="fld">Tasa (%)<input class="input sm num" name="rate" value="${pct(r.rate) ?? ''}" placeholder="sin dato"></label>` : ''}
          ${r.kind === 'sales' ? html`<label class="fld">Surtax (%)<input class="input sm num" name="surtax" value="${pct(r.surtax) ?? ''}"></label><label class="fld">Tope del surtax por artículo (US$)<input class="input sm num" name="cap" value="${r.cap ?? ''}"></label>` : ''}
          ${r.kind === 'entry' ? html`<label class="fld">Arancel (%)<input class="input sm num" name="duty" value="${pct(r.duty) ?? ''}"></label>` : ''}
          <label class="fld">Base<input class="input sm" name="base" value="${r.base || ''}"></label>
          <label class="fld span2">Condición<input class="input sm" name="condition" value="${r.condition || ''}"></label>
          <label class="fld">Vigente desde<input class="input sm num" type="date" name="from" value="${r.from || ''}"></label>
          <label class="fld">Vigente hasta<input class="input sm num" type="date" name="until" value="${r.until || ''}"><small>Vacío = sigue vigente.</small></label>
          <label class="fld span2">Fuente<input class="input sm" name="source" value="${r.source || ''}"></label>
          <label class="fld span4">Nota<input class="input sm" name="note" value="${r.note || ''}"></label>
          <div class="span4 flex"><span style="font-size:13px;color:var(--acc-ink);display:inline-flex;gap:6px;align-items:center">${icon('info')}Al guardar se recalculan los productos y el desglose nombra esta regla.</span><div class="grow"></div><button type="button" class="btn btn-s" data-act="rule-edit" data-rule="${r.id}">Cancelar</button><button class="btn btn-s btn-p">Guardar regla</button></div>
        </form></td></tr>` : ''}`;
  };

  const sec = {
    armado: html`<section id="armado" class="card pad form-row"><div style="flex:1 1 100%"><h2>Presupuesto de «${b.name}»</h2><p class="muted" style="margin:4px 0 0;font-size:13px">Se compara solo con lo que falta por comprar. Cada armado tiene el suyo.</p></div>
      <label class="fld" style="flex:0 1 220px">Presupuesto (US$)<input class="input num" inputmode="decimal" data-change="budget" value="${b.budget?.amount ?? ''}" placeholder="sin presupuesto"><small>${b.budget ? `≈ ${cop(b.budget.amount, trm)}` : ''}</small></label></section>`,
    moneda: html`<section id="moneda" class="card pad form-row"><div style="flex:1 1 100%"><h2>Moneda y TRM</h2><p class="muted" style="margin:4px 0 0;font-size:13px">US$ es la moneda principal; COP aparece al lado. Lo que una tienda cobra en COP se guarda en COP.</p></div>
      ${fld('TRM (COP por US$)', 'fx.trm', trm)}
      ${fld('Fecha de la TRM', 'fx.date', s.fx.date, { type: 'text' })}
      <div class="fld">Origen<div class="flex">${chip(s.fx.source === 'auto' ? 'Automática (oficial)' : 'Manual', s.fx.source === 'auto' ? 'ok' : '')}<button class="btn btn-s" data-act="trm-auto">${icon('refresh')}Traer la TRM oficial</button></div><small>datos.gov.co · Superintendencia Financiera</small></div>
      <div style="flex:1 1 100%;display:flex;flex-wrap:wrap;gap:8px 16px;font-size:13px;padding-top:12px;border-top:1px solid var(--line-2)"><span class="muted">Ejemplo con esta TRM:</span><span class="num">US$100.00 ≈ ${cop(100, trm)}</span><span class="num">COP 689.900 ≈ ${usd(689900 / trm)}</span><span class="muted">· Si cambias la TRM se recalculan los equivalentes; lo pagado conserva la tasa del día de la compra.</span></div></section>`,
    destinos: html`<section id="destinos" class="card" style="padding:0"><div style="padding:20px 20px 12px"><h2>Destinos de envío</h2><p class="muted" style="margin:4px 0 0;font-size:13px">Cada tienda entrega en un solo destino. Las reglas de impuesto y el casillero se cuelgan del destino.</p></div>
      <div class="dest-grid" style="padding:0 20px 20px">
        <div class="box"><div class="row" style="align-items:center"><strong>${dests.co.name}</strong>${chip('Destino final')}</div>${fld('Ciudad y código postal', 'destinations.co.place', dests.co.place, { type: 'text', w: '100%' })}<div class="muted" style="font-size:12px">Tiendas: ${storesOf('co')} · ${rulesOf('co')} reglas</div></div>
        <div class="box"><div class="row" style="align-items:center"><strong>${dests['us-mia'].name}</strong>${chip(s.locker.enabled ? 'Con casillero' : 'Sin casillero', s.locker.enabled ? 'acc' : '')}</div>${fld('ZIP', 'destinations.us-mia.place', dests['us-mia'].place, { type: 'text', w: '100%', hint: 'Debe coincidir con «Entregar en» de Amazon USA.' })}<div class="muted" style="font-size:12px">Tiendas: ${storesOf('us-mia')} · ${rulesOf('us-mia')} regla</div></div>
        <div class="box ${pickupRate == null ? 'warn' : ''}"><div class="row" style="align-items:center"><strong>${dests['us-pickup'].name}</strong>${pickupRate == null ? chip('Falta la tasa', 'warn') : chip(`${pct(pickupRate)} %`)}</div>${fld('Sede de Micro Center', 'destinations.us-pickup.place', dests['us-pickup'].place, { type: 'text', w: '100%', placeholder: 'ej. Miami, FL' })}
          <label class="fld">Sales tax de la sede (%)<input class="input num" inputmode="decimal" data-change="pickup-rate" value="${pct(pickupRate) ?? ''}" placeholder="ej. 7,0"><small>Sin envío. El precio es el de la sede elegida en la tienda.</small></label></div>
      </div></section>`,
    impuestos: html`<section id="impuestos" class="card" style="padding:0"><div style="padding:20px 20px 12px"><h2>Impuestos por destino</h2><p class="muted" style="margin:4px 0 0;font-size:13px">Cada desglose nombra la regla que aplicó. Las reglas cambian: revisa vigencia y fuente antes de comprar.</p></div>
      <div style="margin:0 20px 14px;padding:14px;border-radius:10px;background:var(--surface-2)" class="flex"><div style="flex:1 1 320px"><strong>Umbral de exención en Colombia</strong><div class="muted" style="font-size:13px">Por envío. Un pedido por producto.</div></div>
        ${seg('Umbral', [['200', 'US$200'], ['50', 'US$50'], ['other', th !== 200 && th !== 50 ? `US$${th}` : 'Otro']], th === 200 || th === 50 ? String(th) : 'other', 'threshold')}${chip('Confirmar antes de comprar', 'warn')}</div>
      <div class="tbl-wrap"><table style="min-width:920px"><thead><tr><th>Destino</th><th>Regla</th><th>Valor</th><th>Base</th><th>Condición</th><th>Vigencia</th><th>Fuente</th><th></th></tr></thead><tbody>${s.taxRules.map(ruleRow)}</tbody></table></div></section>`,
    casillero: html`<section id="casillero" class="card pad form-row"><div style="flex:1 1 100%" class="row"><div><h2>Casillero Miami → Colombia</h2><p class="muted" style="margin:4px 0 0;font-size:13px">Con esto, las tiendas de Miami muestran también el total puesto en Colombia. Es una referencia: la tienda sugerida usa el total en destino.</p></div>
        <label class="chk" style="font-weight:500"><input type="checkbox" data-change="setting" data-path="locker.enabled"${raw(s.locker.enabled ? ' checked' : '')} style="width:18px;height:18px">Activado</label></div>
      <div class="fld">Unidad${seg('Unidad', [['lb', 'Libra'], ['kg', 'Kilo']], s.locker.unit, 'setting-set', ' data-path="locker.unit"')}</div>
      ${fld(`Tarifa (US$/${s.locker.unit})`, 'locker.rate', s.locker.rate, { w: '160px' })}${fld('Mínimo por envío (US$)', 'locker.min', s.locker.min, { w: '160px' })}${fld('Días', 'locker.days', s.locker.days, { type: 'text', w: '160px' })}
      <p class="muted" style="flex:1 1 100%;margin:0;font-size:12px">Productos sin peso: el total puesto en Colombia queda parcial y se pide el peso. Impuesto de entrada sobre el umbral: regla «Impuesto de entrada» (IVA ${pct(rule('locker-entry')?.rate)} % + arancel ${pct(rule('locker-entry')?.duty)} %).</p></section>`,
    tiendas: html`<section id="tiendas" class="card" style="padding:0"><div style="padding:20px 20px 12px" class="row"><div><h2>Tiendas</h2><p class="muted" style="margin:4px 0 0;font-size:13px">Tienda = comercio + destino. Si un comercio vende a dos destinos, son dos tiendas.</p></div><button class="btn btn-p btn-s" data-act="store-new" aria-expanded="${ui.newStore}">+ Agregar tienda</button></div>
      <div class="tbl-wrap"><table style="min-width:860px"><thead><tr><th>Tienda</th><th>Comercio</th><th>Destino (fijo)</th><th>Moneda</th><th>Impuesto</th><th>Cómo se lee</th><th class="r">Filas</th><th></th></tr></thead><tbody>
        ${Object.values(st.stores).map((x) => html`<tr><td><strong>${x.name}</strong>${x.note ? html`<div class="src">${x.note}</div>` : ''}${x.warranty || x.returns ? html`<div class="src">${[x.warranty && `Garantía: ${x.warranty}`, x.returns && `Devoluciones: ${x.returns}`].filter(Boolean).join(' · ')}</div>` : ''}</td><td>${st.merchants[x.merchant]?.name || x.merchant}</td><td>${dests[x.destination]?.short}${x.destination === 'us-mia' ? ` ${dests['us-mia'].place}` : ''}</td><td>${x.currency}</td><td>${TAX_MODE[x.taxMode]}</td><td>${READ[st.merchants[x.merchant]?.readMode] || 'solo manual'}${st.merchants[x.merchant]?.domain ? html`<div class="src">${st.merchants[x.merchant].domain}</div>` : ''}</td><td class="r num">${counts[x.key] || 0}</td><td>${x.custom ? html`<button class="btn btn-s btn-g" data-act="store-delete" data-store="${x.key}" aria-label="Quitar ${x.name}">${icon('trash')}</button>` : ''}</td></tr>`)}
      </tbody></table></div>
      ${ui.newStore ? html`<form data-submit="store-save" aria-labelledby="h-nt" class="edit-grid" style="margin:16px 20px 20px;padding:16px;border:1px solid var(--line-strong);border-radius:10px">
        <div class="span4 row" style="align-items:center"><h3 id="h-nt" style="font-size:15px">Nueva tienda</h3><span class="muted" style="font-size:12px">Todo opcional salvo nombre, destino y moneda</span></div>
        <label class="fld">Nombre visible<input class="input sm" name="name" placeholder="Tienda local Medellín" required></label>
        <label class="fld">Comercio<select class="input sm" name="merchant"><option value="__new">Nuevo comercio…</option>${Object.values(st.merchants).map((m) => html`<option value="${m.key}">${m.name}</option>`)}</select></label>
        <label class="fld">Dominio<input class="input sm" name="domain" placeholder="tienda.com.co"><small>Los enlaces de esta tienda se validan contra este dominio.</small></label>
        <label class="fld">Cómo se lee<select class="input sm" name="readMode" disabled><option>Solo manual</option></select><small>Las tiendas nuevas se escriben a mano.</small></label>
        <label class="fld">Destino<select class="input sm" name="destination">${Object.values(dests).map((d) => html`<option value="${d.key}">${d.name}</option>`)}</select></label>
        <label class="fld">Moneda<select class="input sm" name="currency"><option>COP</option><option>USD</option></select></label>
        <label class="fld">Regla de impuesto<select class="input sm" name="taxMode"><option value="included">Incluido en el precio</option><option value="import-co">Importación Colombia</option><option value="sales-tax">Sales tax del destino</option></select></label>
        <span></span>
        <label class="fld span2">Garantía<input class="input sm" name="warranty" placeholder="ej. aplica en Colombia, 3 años"></label>
        <label class="fld span2">Devoluciones<input class="input sm" name="returns" placeholder="ej. 30 días"></label>
        <div class="span4 flex"><span style="font-size:13px;color:var(--warn)">El destino y la moneda quedan fijos. Para vender a otro destino, crea otra tienda del mismo comercio.</span><div class="grow"></div><button type="button" class="btn btn-s" data-act="store-new">Cancelar</button><button class="btn btn-s btn-p">Agregar tienda</button></div>
      </form>` : ''}</section>`,
    calculos: html`<section id="calculos" class="card pad form-row" style="align-items:flex-start"><div style="flex:1 1 100%"><h2>Cálculos y lectura</h2></div>
      ${fld('Margen de la fuente', 'psuMargin', s.psuMargin, { hint: 'Fuente recomendada = consumo × margen, en pasos de 50 W.', w: '240px' })}
      ${fld('Precio viejo después de (días)', 'staleDays', s.staleDays, { hint: 'Marca la lectura como desactualizada.', w: '240px' })}
      <p class="muted" style="flex:1 1 100%;margin:0;font-size:13px">«Actualizar armado» lee cada fila como máximo una vez al día; «Forzar actualización» las relee todas.</p></section>`,
    alertas: html`<section id="alertas" class="card pad form-row" style="align-items:flex-start"><div style="flex:1 1 100%" class="row"><div><h2>Alertas</h2><p class="muted" style="margin:4px 0 0;font-size:13px">El precio objetivo y las condiciones se configuran en cada producto. Aquí decides cuándo y cómo avisar.</p></div><a class="btn btn-s" href="#/alertas">Ver alertas · ${st.alertEvents.filter((a) => !a.seen).length} nuevas</a></div>
      <fieldset style="flex:1 1 300px;border:0;margin:0;padding:0;display:flex;flex-direction:column;gap:8px"><legend style="font-size:13px;font-weight:600;margin-bottom:6px">Cuándo avisar</legend>
        ${[['onRefresh', 'Al terminar una actualización, en el resumen de cambios'], ['badge', 'Contador en la campana hasta que la veas'], ['repeat', 'Repetir una alerta ya vista si el precio vuelve a bajar']].map(([k, t]) => html`<label class="chk"><input type="checkbox" data-change="setting" data-path="alerts.${k}"${raw(s.alerts[k] ? ' checked' : '')}>${t}</label>`)}</fieldset>
      <div style="flex:1 1 300px" class="stack">${fld('Ignorar bajadas menores a (US$)', 'alerts.minDrop', s.alerts.minDrop, { hint: 'Evita ruido por centavos y por cambios de TRM.', w: '100%' })}</div></section>`,
    conector: html`<section id="conector" class="card pad stack"><div><h2>Conector «Armador PC»</h2><p class="muted" style="margin:4px 0 0;font-size:13px">Las tiendas bloquean las consultas desde el servidor, así que se leen con tu navegador y tu sesión. El armador no ve tus cookies ni tu contraseña.</p></div>
      ${extensionBanner()}
      <div class="dest-grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">
        <div class="box ${link.ext.present ? '' : 'warn'}"><div class="flex" style="gap:8px"><strong>Extensión de Chrome (escritorio)</strong>${link.ext.present ? (link.ext.ready ? chip(`Instalada · v${link.ext.extVersion || '?'}`, 'ok', { ico: 'check' }) : chip('Reconectando', 'warn', { ico: 'clock' })) : chip('No detectada', 'warn', { ico: 'warn' })}</div>
          <span style="font-size:13px">Se carga sola en Amazon y en cada tienda (no hay que pulsar nada), abre las pestañas que hagan falta en segundo plano y se reconecta si recargas la tienda o el armador.</span>
          <ol style="margin:0;padding-left:18px;font-size:13px;display:flex;flex-direction:column;gap:4px">
            <li>Abre <code>chrome://extensions</code> (escríbelo en la barra de direcciones).</li>
            <li>Activa el interruptor «Modo de desarrollador» (Developer mode), arriba a la derecha.</li>
            <li>Pulsa el botón para cargar una extensión sin empaquetar (en inglés, «Load unpacked») y elige esta carpeta:</li>
          </ol>
          <div class="flex" style="flex-wrap:nowrap"><input class="input sm num" readonly value="${extensionDir || 'carpeta extension del proyecto'}" aria-label="Carpeta de la extensión"><button type="button" class="btn" data-act="copy-ext-dir"${raw(extensionDir ? '' : ' disabled')}>Copiar</button></div>
          <span class="muted" style="font-size:12px">Luego recarga esta página. Cuando el conector cambie, aquí aparece «Recargar extensión» (no hace falta volver a instalarla).</span>
          ${link.ext.present ? html`<div><button class="btn btn-s" data-act="ext-reload">${icon('refresh')}Recargar extensión</button></div>` : ''}</div>
        <div class="box"><strong>Cómo se usa</strong>
          <ul style="margin:0;padding-left:18px;font-size:13px;display:flex;flex-direction:column;gap:4px">
            <li>«Actualizar armado» conecta solo cada tienda que haga falta.</li>
            <li>«Conectar» abre la tienda en una pestaña en segundo plano (o usa una que ya tengas abierta).</li>
            <li>«Verificar» descarga la portada de la tienda con tu sesión y dice si hay CAPTCHA, bloqueo o sesión cerrada.</li>
            <li>«Ver pestaña» te lleva a ella para iniciar sesión o resolver una verificación; al recargarla se reconecta sola.</li>
            <li>Para agregar un producto desde Amazon, pulsa el ícono de la extensión en su ficha.</li>
          </ul>
          <span class="muted" style="font-size:12px">Para leer Amazon USA, cambia «Entregar en» a Miami ${dests['us-mia'].place} dentro de Amazon: la extensión lo detecta al recargar.</span></div>
      </div>
      <div class="stack" style="gap:8px;padding-top:12px;border-top:1px solid var(--line-2)">
        <div class="row" style="align-items:center"><h3 style="margin:0;font-size:15px">Conexiones por tienda</h3><span class="muted" style="font-size:12px">Versión del conector: ${link.appConnectorVersion || '…'}</span></div>
        ${connectionsList(env, originsOfState(st, env))}
      </div>
      <details class="box"><summary><strong>Alternativa: marcador del navegador</strong> <span class="muted" style="font-size:12px">(sin extensión, p. ej. Android; más frágil: se pierde al recargar la tienda o el armador)</span></summary>
        ${link.outdated() && !link.ext.present ? html`<div class="banner" role="alert">${icon('warn')}<span><strong>El marcador instalado está desactualizado.</strong> La lectura de pedidos queda bloqueada hasta que lo reinstales. Bórralo de la barra y arrastra el nuevo.</span></div>` : ''}
        <div class="dest-grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-top:10px">
          <div class="box"><strong>Escritorio (Chrome en Windows)</strong>
            <ol style="margin:0;padding-left:18px;font-size:13px;display:flex;flex-direction:column;gap:4px"><li>Muestra la barra de marcadores (Ctrl+Mayús+B).</li><li>Arrastra este botón a la barra (si ya tenías uno, reemplázalo).</li><li>En Amazon o en cada tienda, pulsa el marcador.</li></ol>
            ${connectorHref ? html`<a class="bookmarklet" href="${connectorHref}" draggable="true" data-act="bookmarklet-click">+ Armador PC</a>` : html`<span class="muted">Preparando el marcador…</span>`}
            <span class="muted" style="font-size:12px">Arrastra, no hagas clic. ¿No puedes arrastrar? <button class="btn-link" data-act="copy-code" data-which="full">Copiar código</button> y pégalo como URL de un marcador nuevo.</span></div>
          <div class="box"><strong>Celular Android (Chrome)</strong>
            <ol style="margin:0;padding-left:18px;font-size:13px;display:flex;flex-direction:column;gap:4px"><li>Copia el código corto (solo funciona con el armador abierto por https, p. ej. Tailscale).</li><li>Guarda un favorito con el nombre «pcb» y pega el código como dirección.</li><li>Abre amazon.com en Chrome (no en la app de Amazon) y activa «Sitio para computadoras».</li><li>Escribe «pcb» en la barra y toca el favorito.</li></ol>
            <div class="flex" style="flex-wrap:nowrap"><input class="input sm num" readonly value="${loaderHref ? loaderHref.slice(0, 60) + '…' : ''}" aria-label="Código corto del marcador"><button type="button" class="btn" data-act="copy-code" data-which="short">Copiar</button></div>
            <span class="muted" style="font-size:12px">Si se abre la app de Amazon: Ajustes de Android → Apps → Amazon Shopping → Abrir de forma predeterminada → desactiva «Abrir vínculos compatibles».</span></div>
        </div>
        <div style="margin-top:10px"><button class="btn btn-s" data-act="connector-ok">Listo, ya instalé el marcador</button></div>
      </details></section>`,
    apariencia: html`<section id="apariencia" class="card pad form-row"><div style="flex:1 1 100%"><h2>Apariencia</h2><p class="muted" style="margin:4px 0 0;font-size:13px">Se guarda en este navegador; el celular puede tener otra.</p></div>
      <div class="fld">Tema${seg('Tema', [['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']], prefsGet().theme, 'theme')}</div>
      <div class="fld">Densidad de las listas${seg('Densidad', [['comfortable', 'Cómoda'], ['compact', 'Compacta']], prefsGet().density, 'density')}</div>
      <div class="muted" style="font-size:12px;flex:1 1 260px">Formatos: US$1,234.56 · COP 3.188.000 · fechas 9-nov-2026</div></section>`,
    datos: html`<section id="datos" class="card pad flex" style="gap:12px"><div style="flex:1 1 100%"><h2>Datos</h2><p class="muted" style="margin:4px 0 0;font-size:13px">Se guarda solo después de cada cambio (con copias de seguridad automáticas en el servidor).</p></div>
      <button class="btn" data-act="export-json">Exportar JSON</button><button class="btn" data-act="import-json">Importar JSON</button><button class="btn" data-act="copy-markdown">Copiar como Markdown</button>
      <div class="box err" style="flex:1 1 100%;margin-top:8px;flex-direction:row;flex-wrap:wrap;align-items:center"><div style="flex:1 1 320px"><strong style="color:var(--err)">Restaurar datos de ejemplo</strong><div class="muted" style="font-size:13px">Reemplaza todos tus armados. Te pedimos confirmar y puedes exportar antes.</div></div><button class="btn btn-danger" data-act="restore-seed">Restaurar…</button></div></section>`,
  };
  return html`<div class="wrap">
    <nav aria-label="Ruta" class="crumbs"><a href="#/">${b.name}</a> / Ajustes</nav><h1>Ajustes</h1>
    <div class="layout" style="gap:24px">
      <nav class="side" aria-label="Secciones de ajustes" style="flex:1 1 200px;max-width:220px;position:sticky;top:72px;align-self:flex-start">
        ${SECTIONS.map(([id, label, group]) => html`${group ? html`<span class="lbl">${group}</span>` : ''}<a href="#/ajustes/${id}"${raw(section === id ? ' aria-current="page"' : '')}>${label}${id === 'conector' && link.outdated() ? html` <span class="chip c-warn sm">1</span>` : ''}</a>`)}
      </nav>
      <div style="flex:999 1 720px;min-width:0" class="stack">${SECTIONS.map(([id]) => sec[id])}</div>
    </div></div>`;
}
