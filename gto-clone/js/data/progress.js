// Progression: XP for every training decision, levels, a daily goal with a
// streak of days, and badges. Kept with the training data (store.js).
import { getProgress, saveProgress } from '../store.js';

export const LEVELS = [
  { xp: 0, name: 'Poisson', icon: '🐟' },
  { xp: 100, name: 'Débutant', icon: '🌱' },
  { xp: 250, name: 'Amateur', icon: '🎲' },
  { xp: 500, name: 'Habitué', icon: '🃏' },
  { xp: 900, name: 'Régulier', icon: '♠️' },
  { xp: 1500, name: 'Grinder', icon: '⚙️' },
  { xp: 2400, name: 'Requin', icon: '🦈' },
  { xp: 3600, name: 'Crusher', icon: '💥' },
  { xp: 5200, name: 'High roller', icon: '💎' },
  { xp: 7500, name: 'Légende', icon: '👑' },
];
const AFTER_LAST = 3000; // XP per level after "Légende"

export function levelOf(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].xp) i++;
  if (i === LEVELS.length - 1 && xp >= LEVELS[i].xp + AFTER_LAST) {
    const extra = Math.floor((xp - LEVELS[i].xp) / AFTER_LAST);
    const from = LEVELS[i].xp + extra * AFTER_LAST;
    return { n: i + 1 + extra, ...LEVELS[i], name: `${LEVELS[i].name} ${extra + 1}`, from, to: from + AFTER_LAST, pct: (xp - from) / AFTER_LAST };
  }
  const from = LEVELS[i].xp;
  const to = LEVELS[i + 1]?.xp ?? from + AFTER_LAST;
  return { n: i + 1, ...LEVELS[i], from, to, pct: (xp - from) / (to - from) };
}

export const XP_BY_GRADE = { best: 10, correct: 6, inaccuracy: 2, wrong: 1, blunder: 0 };
export const COMBO_STEP = 5; // +10 XP every 5 good decisions in a row
export const DAILY_GOAL = 25; // decisions a day

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => dayKey();

// Days in a row where the daily goal was reached, ending today (or yesterday
// when today's goal isn't reached yet, so the streak isn't lost in the morning).
export function streakOf(p, now = new Date()) {
  const d = new Date(now);
  if ((p.days[dayKey(d)] || 0) < DAILY_GOAL) d.setDate(d.getDate() - 1);
  let n = 0;
  while ((p.days[dayKey(d)] || 0) >= DAILY_GOAL) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export const BADGES = [
  { id: 'first', icon: '🎬', name: 'Première main', desc: 'Prendre ta première décision.', test: (p) => p.counts.decisions >= 1 },
  { id: 'd100', icon: '💯', name: 'Centurion', desc: '100 décisions à l\'entraînement.', test: (p) => p.counts.decisions >= 100 },
  { id: 'd1000', icon: '🏋️', name: 'Grinder', desc: '1 000 décisions à l\'entraînement.', test: (p) => p.counts.decisions >= 1000 },
  { id: 'combo10', icon: '🔥', name: 'En feu', desc: '10 bonnes décisions d\'affilée.', test: (p) => p.bestCombo >= 10 },
  { id: 'combo25', icon: '☄️', name: 'Inarrêtable', desc: '25 bonnes décisions d\'affilée.', test: (p) => p.bestCombo >= 25 },
  { id: 'streak3', icon: '📅', name: 'Régularité', desc: 'Objectif du jour atteint 3 jours de suite.', test: (p) => streakOf(p) >= 3 },
  { id: 'streak7', icon: '🗓️', name: 'Semaine parfaite', desc: 'Objectif du jour atteint 7 jours de suite.', test: (p) => streakOf(p) >= 7 },
  { id: 'postflop50', icon: '🃏', name: 'Après le flop', desc: '50 décisions postflop.', test: (p) => p.counts.postflop >= 50 },
  { id: 'mw20', icon: '👥', name: 'Multiway', desc: '20 décisions dans des coups à 3 joueurs ou plus.', test: (p) => p.counts.multiway >= 20 },
  { id: 'ko20', icon: '🎯', name: 'Chasseur de primes', desc: '20 décisions en format KO.', test: (p) => p.counts.ko >= 20 },
  { id: 'perfect', icon: '✨', name: 'Sans faute', desc: 'Une session de 20 décisions ou plus sans erreur.', test: (p) => !!p.perfect },
  { id: 'level5', icon: '⭐', name: 'Niveau 5', desc: 'Atteindre le niveau Régulier.', test: (p) => levelOf(p.xp).n >= 5 },
  { id: 'import', icon: '📥', name: 'Analyste', desc: 'Importer un tournoi dans Mes données.', test: (p) => !!p.imported },
  { id: 'itm', icon: '💰', name: 'Dans l\'argent', desc: 'Importer un tournoi terminé dans les places payées.', test: (p) => !!p.itm },
];

function unlock(p) {
  const fresh = [];
  for (const b of BADGES) if (!p.badges[b.id] && b.test(p)) { p.badges[b.id] = today(); fresh.push(b); }
  return fresh;
}

// One training decision. combo = good decisions in a row, this one included.
export function recordDecision({ grade, street, multiway, ko }, combo) {
  const p = structuredClone(getProgress());
  const before = levelOf(p.xp);
  const good = grade === 'best' || grade === 'correct';
  let gained = XP_BY_GRADE[grade] ?? 0;
  const comboBonus = good && combo > 0 && combo % COMBO_STEP === 0 ? 10 : 0;
  gained += comboBonus;
  p.xp += gained;
  p.counts.decisions++;
  if (street && street !== 'Preflop') p.counts.postflop++;
  if (multiway) p.counts.multiway++;
  if (ko) p.counts.ko++;
  p.bestCombo = Math.max(p.bestCombo, combo);
  const day = today();
  p.days[day] = (p.days[day] || 0) + 1;
  const goalReached = p.days[day] === DAILY_GOAL;
  const after = levelOf(p.xp);
  const badges = unlock(p);
  saveProgress(p);
  return { gained, comboBonus, levelUp: after.n > before.n ? after : null, badges, goalReached };
}

export function recordSession(session) {
  if (session.decisionsCount < 20 || session.mistakes) return [];
  const p = structuredClone(getProgress());
  p.perfect = true;
  const badges = unlock(p);
  saveProgress(p);
  return badges;
}

// From My Data: tournaments imported, and whether any finished in the money.
export function recordImport({ tournaments, itm }) {
  if (!tournaments) return [];
  const p = structuredClone(getProgress());
  p.imported = true;
  if (itm) p.itm = true;
  const badges = unlock(p);
  saveProgress(p);
  return badges;
}
