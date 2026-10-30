// Winamax gateway: reads a folder of hand histories straight from the disk
// (File System Access API, Chrome and Edge) and imports only what is new.
// The folder handle is kept in IndexedDB so it survives a reload; the browser
// still decides when to ask the user to allow access again.
import { importFiles, getGateway, setGateway } from './datastore.js';

const DB = /[?&]test=1/.test(location.search) ? 'spotwise-gateway-test' : 'spotwise-gateway';
const STORE = 'handles';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}

export const gatewaySupported = () => typeof window.showDirectoryPicker === 'function';

export async function savedFolder() {
  try { return (await idbDo('readonly', (s) => s.get('winamax'))) || null; } catch { return null; }
}

export async function pickFolder() {
  const dir = await window.showDirectoryPicker({ id: 'spotwise-winamax', mode: 'read' });
  await idbDo('readwrite', (s) => s.put(dir, 'winamax'));
  setGateway({ ...getGateway(), folder: dir.name, seen: {} });
  return dir;
}

export async function forgetFolder() {
  try { await idbDo('readwrite', (s) => s.delete('winamax')); } catch { /* nothing stored */ }
  setGateway({ seen: {}, folder: null, last: null });
}

// ask = true only from a click: the browser shows its permission prompt.
export async function hasAccess(dir, ask = false) {
  const opts = { mode: 'read' };
  if ((await dir.queryPermission(opts)) === 'granted') return true;
  if (!ask) return false;
  return (await dir.requestPermission(opts)) === 'granted';
}

async function* walk(dir, path = '', depth = 0) {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && /\.txt$/i.test(name)) yield [path + name, handle];
    else if (handle.kind === 'directory' && depth < 3) yield* walk(handle, `${path}${name}/`, depth + 1);
  }
}

// Reads the files that are new or changed since the last pass (a running
// tournament's file grows, so it is read again; its hands merge by number).
export async function syncFolder(dir) {
  const g = getGateway();
  const seen = { ...(g.seen || {}) };
  const files = [];
  let total = 0;
  for await (const [path, handle] of walk(dir)) {
    total++;
    const f = await handle.getFile();
    const sig = `${f.size}:${f.lastModified}`;
    if (seen[path] === sig) continue;
    files.push({ name: path, text: await f.text(), path, sig });
  }
  const report = files.length ? importFiles(files, { source: 'winamax' }) : null;
  for (const f of files) seen[f.path] = f.sig;
  setGateway({ ...g, folder: dir.name, seen, last: new Date().toISOString() });
  return { total, read: files.length, report };
}

// Background sync while the site is open: on start and every 2 minutes, only
// when the browser already allows access (no prompt without a click).
let timer = null;
const listeners = new Set();
export const onGatewaySync = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function startAutoSync() {
  if (!gatewaySupported() || timer) return;
  const tick = async () => {
    const dir = await savedFolder();
    if (!dir || !(await hasAccess(dir))) return;
    try {
      const res = await syncFolder(dir);
      if (res.report) listeners.forEach((fn) => fn(res));
    } catch { /* folder moved or unplugged: try again next tick */ }
  };
  tick();
  timer = setInterval(tick, 120000);
}
