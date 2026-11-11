// Puente en la pestaña del armador: window.postMessage (página) ↔ puerto 'app' (service worker de la extensión).
// Página → { pcbExt: 'to', msg } · puente → { pcbExt: 'from', msg }. Si el service worker se reinicia, reconecta solo
// y avisa con 'ext-ready' (el armador reenvía lo pendiente). Si la extensión se recarga, este puente queda huérfano
// y calla: la extensión inyecta uno nuevo.
(() => {
  // Solo en el armador: los patrones de localhost y *.ts.net también cubren otras apps.
  const isApp = () => !!document.querySelector('meta[name="armador-pc"]');
  // Un solo puente vivo por pestaña (el manifiesto y la reinyección al instalar pueden cargarlo dos veces).
  if (window.__pcbBridge?.alive()) return;
  window.__pcbBridge = { alive: () => !dead && !!chrome.runtime?.id };
  let port = null;
  let dead = false;
  let delay = 500;
  let ping = 0;
  const toPage = (msg) => window.postMessage({ pcbExt: 'from', msg }, location.origin);
  const ready = () => toPage({ type: 'ext-ready', extVersion: chrome.runtime.getManifest().version });

  function connect() {
    if (dead || port || !isApp()) return;
    try {
      port = chrome.runtime.connect({ name: 'app' });
    } catch {
      dead = true; // contexto invalidado: la extensión se recargó o se quitó
      removeEventListener('message', onMessage);
      clearInterval(ping);
      return;
    }
    port.onMessage.addListener(toPage);
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // leerlo evita «Unchecked runtime.lastError» (p. ej. al pasar a la caché atrás/adelante)
      port = null;
      if (dead) return;
      toPage({ type: 'ext-lost' });
      setTimeout(connect, delay);
      delay = Math.min(delay * 2, 5000);
    });
    delay = 500;
    ready();
  }
  function onMessage(e) {
    if (e.source !== window || e.origin !== location.origin || e.data?.pcbExt !== 'to') return;
    const msg = e.data.msg;
    if (msg?.type === 'probe') { if (port) ready(); else connect(); return; }
    if (!port) connect();
    try { port?.postMessage(msg); } catch { /* reconecta solo */ }
  }
  addEventListener('message', onMessage);
  // Latido: mantiene vivo el service worker mientras el armador está abierto.
  ping = setInterval(() => { try { port?.postMessage({ type: 'ping' }); } catch { /* reconecta solo */ } }, 20000);
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', connect, { once: true }); else connect();
})();
