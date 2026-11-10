// @ts-check
// Llamadas al servidor local.

async function json(r) {
  const body = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 409) throw new Error(body.error || `Error ${r.status}`);
  return { status: r.status, body };
}

export async function getStore() {
  const r = await fetch('/api/store');
  if (r.status === 404) return (await json(await fetch('/api/store/reset', { method: 'POST' }))).body;
  return (await json(r)).body;
}

/** @returns {Promise<{ rev: number, conflict?: false } | { conflict: true, current: any }>} */
export async function putStore(state, { force = false } = {}) {
  const { status, body } = await json(await fetch(`/api/store${force ? '?force=1' : ''}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state) }));
  if (status === 409) return { conflict: true, current: body.current };
  return { rev: body.rev };
}

export const resetStore = async () => (await json(await fetch('/api/store/reset', { method: 'POST' }))).body;
export const connectorVersion = async () => (await json(await fetch('/api/connector/version'))).body.version;
export const connectorCode = async () => (await fetch('/api/connector')).text();
export const trm = async () => (await json(await fetch('/api/trm'))).body;
export const resolveShort = async (url) => (await json(await fetch(`/api/resolve?url=${encodeURIComponent(url)}`))).body.url;
