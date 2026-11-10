// @ts-check
// Plantillas HTML con escape automático y un «morph» que aplica el HTML nuevo sobre el DOM existente
// sin reemplazarlo: conserva el foco, lo escrito en los campos, la selección y el scroll interno durante
// los repintados frecuentes (lecturas en lote, brief §21).

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
/** Marca HTML ya seguro (no se escapa). */
export const raw = (s) => new Raw(String(s ?? ''));

const part = (v) => {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
};
/** Plantilla: `html\`<b>${texto}</b>\`` escapa los valores; arreglos y raw() se insertan tal cual. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}

const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') || n.id || null : null);

/** Aplica `markup` como hijos de `root`. */
export function morph(root, markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(markup);
  patchChildren(root, tpl.content);
}

function patchChildren(parent, next) {
  const want = [...next.childNodes];
  const keyed = new Map();
  for (const n of parent.childNodes) { const k = keyOf(n); if (k) keyed.set(k, n); }
  let idx = 0;
  for (const nb of want) {
    const k = keyOf(nb);
    const cur = parent.childNodes[idx] || null;
    let match = null;
    if (k) { const m = keyed.get(k); if (m && m.nodeName === nb.nodeName) { match = m; keyed.delete(k); } }
    else if (cur && !keyOf(cur) && cur.nodeType === nb.nodeType && cur.nodeName === nb.nodeName) match = cur;
    if (match) {
      if (match !== cur) parent.insertBefore(match, cur);
      patchNode(match, nb);
    } else parent.insertBefore(nb, cur);
    idx++;
  }
  while (parent.childNodes.length > idx) parent.removeChild(parent.lastChild);
}

function patchNode(a, b) {
  if (a.nodeType === 3 || a.nodeType === 8) { if (a.data !== b.data) a.data = b.data; return; }
  if (a.nodeType !== 1) return;
  // Atributos
  for (const { name } of [...a.attributes]) {
    if (!b.hasAttribute(name) && !(name === 'open' && a.nodeName === 'DETAILS')) a.removeAttribute(name);
  }
  for (const { name, value } of [...b.attributes]) {
    if (name === 'open' && a.nodeName === 'DETAILS' && !b.hasAttribute('data-force-open')) continue;
    if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  }
  const focused = a === document.activeElement;
  if (a.nodeName === 'INPUT' || a.nodeName === 'TEXTAREA' || a.nodeName === 'SELECT') {
    if (a.type === 'checkbox' || a.type === 'radio') { const c = b.hasAttribute('checked'); if (a.checked !== c) a.checked = c; }
    else if (!focused) {
      const v = b.nodeName === 'SELECT' ? null : b.getAttribute('value') ?? (b.nodeName === 'TEXTAREA' ? b.textContent : '');
      if (v != null && a.value !== v) a.value = v;
    }
    if (a.nodeName === 'TEXTAREA') return;
  }
  if (a.hasAttribute('data-morph-skip')) return;
  patchChildren(a, b);
  if (a.nodeName === 'SELECT' && !focused) {
    const sel = [...b.options].findIndex((o) => o.hasAttribute('selected'));
    if (sel >= 0 && a.selectedIndex !== sel) a.selectedIndex = sel;
  }
}

/** Atributos booleanos en plantillas: `${attr('checked', x)}`. */
export const attr = (name, on) => raw(on ? ` ${name}` : '');
