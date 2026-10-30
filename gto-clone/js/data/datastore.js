// My Data storage: imported tournaments, the hero's preflop decisions, one
// small record per hand, and the import sessions — kept in this browser only
// (localStorage key gtoc.data.v1).
import { parseFile } from './parsers.js';
import { extractDecisions } from './decisions.js';
import { handRecord } from './handstats.js';

const KEY = /[?&]test=1/.test(location.search) ? 'gtoc.data.test' : 'gtoc.data.v1';
const EMPTY = () => ({ tournaments: {}, decisions: {}, hands: {}, sessions: [], screenNames: [] });
let db = load();

function load() {
  try { return { ...EMPTY(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return EMPTY(); }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
  catch { return false; }
}

export const getTournaments = () => Object.values(db.tournaments).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.tid.localeCompare(a.tid));
export const getDecisions = () => Object.values(db.decisions).flat();
export const getHandRecords = () => Object.values(db.hands).flat().sort((a, b) => (a.at || '').localeCompare(b.at || '') || String(a.h).localeCompare(String(b.h)));
export const getImportSessions = () => db.sessions.slice().reverse();
export const getScreenNames = () => db.screenNames;
export function setScreenNames(list) { db.screenNames = list; Object.values(db.tournaments).forEach(derive); save(); }
export function setType(key, type) { if (db.tournaments[key]) { db.tournaments[key].type = type; db.tournaments[key].typeSet = true; save(); } }
export function removeTournament(key) { delete db.tournaments[key]; delete db.decisions[key]; delete db.hands[key]; save(); }
export function clearAll() { db = { ...EMPTY(), screenNames: db.screenNames }; save(); }

function tour(room, tid) {
  const key = `${room}:${tid}`;
  if (!db.tournaments[key]) db.tournaments[key] = { key, room, tid, name: `${room} #${tid}`, type: 'vanilla', files: [] };
  return db.tournaments[key];
}

// Place and prize from the summary's player list when the "You ..." lines don't say.
function derive(t) {
  if ((t.place == null || t.prize == null) && t.rows?.length && db.screenNames.length) {
    for (const row of t.rows) {
      const m = row.match(/^\s*(\d+): (.+?)(?: \[\d+\])? \([^)]*\),\s*(.*)$/);
      if (!m || !db.screenNames.includes(m[2])) continue;
      if (/still playing/.test(m[3])) { t.running = true; break; }
      if (t.place == null) t.place = +m[1];
      if (t.prize == null) t.prize = m[3] ? (parseFloat(m[3].replace(/[^\d.]/g, '')) || 0) : 0;
      break;
    }
  }
  t.cost = (t.buyin || 0) + (t.reentryCost || (t.buyin || 0) * (t.reentries || 0));
  t.bounties = (t.bounty || 0) + (t.hhBounty || 0);
  t.winnings = (t.prize || 0) + t.bounties;
  t.profit = t.winnings - t.cost;
}

// files: [{name, text}] -> report. Each call is one import session.
export function importFiles(files) {
  const sid = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const report = { ok: 0, errors: [], tournaments: new Set(), decisions: 0, skipped: 0, hands: 0, session: sid };
  for (const f of files) {
    const res = parseFile(f.text);
    if (res.error) { report.errors.push(`${f.name} : ${res.error}`); continue; }
    if (res.summary) {
      const s = res.summary;
      const t = tour(s.room, s.tid);
      const keepType = t.typeSet ? t.type : null;
      Object.assign(t, s, { files: [...new Set([...t.files, 'summary'])] });
      if (keepType) t.type = keepType;
      t.session = t.session || sid;
      report.tournaments.add(t.key);
    } else {
      const hh = res.hands;
      if (!hh.tid) { report.errors.push(`${f.name} : aucune main trouvée`); continue; }
      const t = tour(hh.room, hh.tid);
      t.session = t.session || sid;
      if (hh.hero && !db.screenNames.includes(hh.hero)) db.screenNames.push(hh.hero);
      if (hh.isKO && !t.typeSet && t.type === 'vanilla') t.type = 'ko';
      if (!t.name || t.name.startsWith(hh.room + ' #')) t.name = hh.hands[0]?.name || t.name;
      const decisions = [];
      let skipped = 0;
      for (const hand of hh.hands) {
        const r = extractDecisions(hand);
        decisions.push(...r.decisions);
        skipped += r.skipped;
      }
      db.decisions[t.key] = decisions;
      db.hands[t.key] = hh.hands.map(handRecord).filter(Boolean).map((r) => ({ ...r, s: sid }));
      t.handsCount = hh.hands.length;
      t.hhBounty = hh.hands.reduce((a, h) => a + (h.bounty || 0), 0);
      t.files = [...new Set([...t.files, 'hands'])];
      report.decisions += decisions.length;
      report.hands += hh.hands.length;
      report.skipped += skipped;
      report.tournaments.add(t.key);
    }
    report.ok++;
  }
  if (report.ok) db.sessions.push({ id: sid, at: new Date().toISOString(), files: report.ok, hands: report.hands, keys: [...report.tournaments] });
  Object.values(db.tournaments).forEach(derive);
  report.saved = save();
  return report;
}
