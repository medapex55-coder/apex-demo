// Local persistence (localStorage key gtoc.v1). Same shapes as replica/schema.sql.
// The test suite runs the app with ?test=1 so it never touches real data.
const KEY = /[?&]test=1/.test(location.search) ? 'gtoc.test' : 'gtoc.v1';
const MAX_DECISIONS = 2000;
const MAX_HAND_LOGS = 300; // replayable hands kept across all sessions

export const EMPTY_PROGRESS = () => ({ xp: 0, days: {}, badges: {}, bestCombo: 0, counts: { decisions: 0, postflop: 0, multiway: 0, ko: 0 } });

const DEFAULT = {
  settings: { units: 'bb', gridMode: 'full', cellNumbers: false, fourColor: true, openStyle: 'standard' },
  sessions: [],
  drills: [],
  progress: EMPTY_PROGRESS(),
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT);
    const s = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT), ...s,
      settings: { ...DEFAULT.settings, ...(s.settings || {}) },
      progress: { ...EMPTY_PROGRESS(), ...(s.progress || {}) },
    };
  } catch {
    return structuredClone(DEFAULT);
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
}

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => fn(state));

export const getSettings = () => state.settings;
export function setSetting(k, v) { state.settings[k] = v; save(); emit(); }

export const getSessions = () => state.sessions;
export function saveSession(sess) {
  const i = state.sessions.findIndex((s) => s.id === sess.id);
  if (i >= 0) state.sessions[i] = sess; else state.sessions.unshift(sess);
  // Cap stored decisions and replayable hands across sessions (newest kept).
  let n = 0, logs = 0;
  for (const s of state.sessions) {
    n += s.decisions.length;
    if (n > MAX_DECISIONS) s.decisions = s.decisions.slice(0, Math.max(0, s.decisions.length - (n - MAX_DECISIONS)));
    logs += (s.handsLog || []).length;
    if (logs > MAX_HAND_LOGS) s.handsLog = s.handsLog.slice(0, Math.max(0, s.handsLog.length - (logs - MAX_HAND_LOGS)));
  }
  save();
}
export function clearSessions() { state.sessions = []; save(); emit(); }

export const getProgress = () => state.progress;
export function saveProgress(p) { state.progress = p; save(); emit(); }

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
