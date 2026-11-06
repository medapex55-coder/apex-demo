// Backup of everything the site keeps in this browser, to move it to another
// address or computer (browser storage belongs to one web address).
import { STORE_KEY } from '../store.js';
import { DATA_KEY } from './datastore.js';

const APP = 'spotwise-backup';

export function exportBackup() {
  return JSON.stringify({ app: APP, version: 1, at: new Date().toISOString(), training: localStorage.getItem(STORE_KEY), hands: localStorage.getItem(DATA_KEY) });
}

// Replaces the stored data; throws with a readable message and changes nothing
// if the file is wrong or doesn't fit. The caller reloads the page after it.
export function importBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch { throw new Error('Ce fichier n\'est pas une sauvegarde lisible.'); }
  if (b?.app !== APP) throw new Error('Ce fichier n\'est pas une sauvegarde du site.');
  const parts = [[STORE_KEY, b.training], [DATA_KEY, b.hands]];
  for (const [, v] of parts) {
    if (v == null) continue;
    try { JSON.parse(v); } catch { throw new Error('Cette sauvegarde est abîmée.'); }
  }
  const before = parts.map(([k]) => localStorage.getItem(k));
  try {
    for (const [k, v] of parts) if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  } catch {
    parts.forEach(([k], i) => { if (before[i] == null) localStorage.removeItem(k); else localStorage.setItem(k, before[i]); });
    throw new Error('Stockage du navigateur plein : rien n\'a été modifié.');
  }
}
