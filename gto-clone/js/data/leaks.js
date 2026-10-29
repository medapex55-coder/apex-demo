// Leakfinder: rebuild each imported decision as a Study spot, compare the
// hero's action with the strategy for that hand class, and aggregate by spot.
import { initialState, applyAction, legalActions, foldTo, POS, actionKey } from '../engine/game.js';
import { analyze } from '../engine/strategy.js';
import { CLASS_OF_COMBO, CLASSES, comboIndex, parseCard } from '../engine/cards.js';

export const SCEN = {
  RFI: 'First in',
  VL: 'Facing limp(s)',
  VO: 'Facing an open',
  VS: 'Facing an open shove',
  V3: 'Facing a 3-bet',
};

export const STACK_GROUPS = [
  { id: '≤15bb', test: (s) => s <= 15 },
  { id: '20–25bb', test: (s) => s >= 20 && s <= 25 },
  { id: '30–40bb', test: (s) => s >= 30 && s <= 40 },
  { id: '50–80bb', test: (s) => s >= 50 && s <= 80 },
  { id: '100bb+', test: (s) => s >= 100 },
];
export const stackGroup = (s) => STACK_GROUPS.find((g) => g.test(s))?.id || s + 'bb';

const find = (st, type) => legalActions(st).find((a) => a.type === type);
const aggressive = (st, allin) => (allin ? find(st, 'allin') || find(st, 'raise') : find(st, 'raise') || find(st, 'allin'));

// Rebuild the engine state where the hero decides. Returns null if the tree can't express it.
export function spotState(d) {
  const cfg = { stack: d.s, open: d.o || '2.5' };
  let st = initialState(cfg);
  try {
    if (d.sc === 'RFI') st = foldTo(st, d.hp);
    else if (d.sc === 'VL') {
      for (const lp of d.lp) {
        st = foldTo(st, lp);
        const limp = find(st, 'call');
        if (!limp) return null;
        st = applyAction(st, limp);
      }
      st = foldTo(st, d.hp);
    } else if (d.sc === 'VO' || d.sc === 'VS') {
      st = foldTo(st, d.vp);
      const r = aggressive(st, d.sc === 'VS');
      if (!r || (d.sc === 'VS' && r.type !== 'allin')) return null;
      st = foldTo(applyAction(st, r), d.hp);
    } else if (d.sc === 'V3') {
      st = foldTo(st, d.hp);
      st = applyAction(st, find(st, 'raise'));
      st = foldTo(st, d.vp);
      const r = aggressive(st, d.r3);
      if (!r) return null;
      st = applyAction(st, r);
    }
  } catch { return null; }
  return st.toAct === d.hp && !st.terminal ? st : null;
}

function grade(freqs, k) {
  const max = Math.max(...freqs);
  const fc = k >= 0 ? freqs[k] : 0;
  if (k >= 0 && fc === max) return { grade: 'best', score: 1 };
  if (fc >= 0.035) return { grade: 'correct', score: 0.5 + 0.5 * fc / max };
  if (fc > 0.001) return { grade: 'inaccuracy', score: 0 };
  if (max < 0.9) return { grade: 'wrong', score: -0.3 };
  return { grade: 'blunder', score: -1 };
}

const ACTION_OF = { fold: ['fold'], check: ['check'], call: ['call'], raise: ['raise', 'allin'], allin: ['allin', 'raise'] };
const GROUP_OF = { fold: 'fold', check: 'call', call: 'call', bet: 'raise', raise: 'raise', allin: 'allin' };

export function analyzeDecisions(decisions) {
  const spots = new Map();
  let covered = 0, notCovered = 0;
  for (const d of decisions) {
    const st = spotState(d);
    if (!st) { notCovered++; continue; }
    const node = analyze(st);
    const cards = d.c.match(/../g).map(parseCard);
    const ci = comboIndex(cards[0], cards[1]);
    if (ci < 0) { notCovered++; continue; }
    const freqs = node.actions.map((_, k) => node.freqs[k][ci]);
    let k = -1;
    for (const t of ACTION_OF[d.a] || []) { k = node.actions.findIndex((a) => a.type === t); if (k >= 0) break; }
    const g = grade(freqs, k);
    covered++;
    const vill = d.sc === 'VL' ? d.lp.map((p) => POS[p]).join('+') : d.vp != null ? POS[d.vp] : '';
    const key = spotKey(d.sc, POS[d.hp], vill, d.s);
    if (!spots.has(key)) spots.set(key, { key, sc: d.sc, hero: POS[d.hp], vill, group: stackGroup(d.s), hands: [] });
    const gto = { fold: 0, call: 0, raise: 0, allin: 0 };
    node.actions.forEach((a, j) => { gto[GROUP_OF[a.type]] += freqs[j]; });
    spots.get(key).hands.push({
      d, cls: CLASSES[CLASS_OF_COMBO[ci]].name, grade: g.grade, score: g.score, you: GROUP_OF[d.a] || 'fold', gto, freqs,
      labels: node.actions.map((a) => a.type === 'call' && st.raiseLevel === 0 ? 'limp' : a.type), link: studyLink(st),
    });
  }
  return { spots: [...spots.values()].map((sp) => aggregate(sp, sp.hands)), covered, notCovered };
}

export const spotKey = (sc, hero, vill, stack) => `${sc}|${hero}|${vill}|${stackGroup(stack)}`;

// Totals for a spot from a list of graded hands (all of them, or a time slice).
export function aggregate(meta, hands) {
  const sp = { ...meta, hands, n: hands.length, score: 0, mistakes: 0, you: { fold: 0, call: 0, raise: 0, allin: 0 }, gto: { fold: 0, call: 0, raise: 0, allin: 0 } };
  for (const x of hands) {
    sp.score += x.score;
    if (!['best', 'correct'].includes(x.grade)) sp.mistakes++;
    sp.you[x.you]++;
    for (const a in x.gto) sp.gto[a] += x.gto[a];
  }
  sp.avg = sp.n ? sp.score / sp.n : 0;
  sp.mistakeRate = sp.n ? sp.mistakes / sp.n : 0;
  return sp;
}

// ---------- plain language ----------
export function spotTitle(sp) {
  return {
    RFI: `${sp.hero} first in`,
    VL: `${sp.hero} vs ${sp.vill} limp${sp.vill.includes('+') ? 's' : ''}`,
    VO: `${sp.hero} vs ${sp.vill} open`,
    VS: `${sp.hero} vs ${sp.vill} shove`,
    V3: `${sp.hero} open, ${sp.vill} 3-bets`,
  }[sp.sc] || sp.key;
}

export function spotStory(sp) {
  return {
    RFI: `Everyone folded to you in the ${sp.hero}. You can open or fold.`,
    VL: `You are in the ${sp.hero} and ${sp.vill.replace(/\+/g, ' and ')} limped (just called the big blind).`,
    VO: `You are in the ${sp.hero} and the ${sp.vill} raised first.`,
    VS: `You are in the ${sp.hero} and the ${sp.vill} went all-in first.`,
    V3: `You opened from the ${sp.hero} and the ${sp.vill} re-raised (3-bet).`,
  }[sp.sc] || '';
}

// The one number a beginner should watch in each spot. "target" is what the
// strategy plays with the exact same hands you were dealt, so the two compare.
const METRIC = {
  RFI: { label: 'Open', acts: ['raise', 'allin', 'call'], low: (s) => `You fold hands that should be opened from the ${s.hero}. Open more.`, high: (s) => `You open hands that should be folded from the ${s.hero}. Fold the weakest ones.` },
  VL: { label: 'Raise over the limp', acts: ['raise', 'allin'], low: () => 'You let limpers see a cheap flop. Raise more to isolate them.', high: () => 'You raise too many hands over limps. Fold or check the weakest ones.' },
  VO: { label: 'Defend', acts: ['call', 'raise', 'allin'], low: (s) => `You fold too often against the ${s.vill} open. Defend more by calling or 3-betting.`, high: (s) => `You play too many hands against the ${s.vill} open. Fold the weakest ones.` },
  VS: { label: 'Call the shove', acts: ['call'], low: (s) => `You fold too much against the ${s.vill} shove. Call wider.`, high: (s) => `You call the ${s.vill} shove too light. Fold the weakest calls.` },
  V3: { label: 'Continue vs 3-bet', acts: ['call', 'raise', 'allin'], low: () => 'You give up too often after being 3-bet. Call or 4-bet more of your opens.', high: () => 'You continue too often against 3-bets. Fold your weakest opens.' },
};
export const ON_TARGET = 0.05;

export function keyMetric(sp) {
  const m = METRIC[sp.sc];
  if (!m || !sp.n) return null;
  const you = m.acts.reduce((a, k) => a + sp.you[k], 0) / sp.n;
  const target = m.acts.reduce((a, k) => a + sp.gto[k], 0) / sp.n;
  const diff = you - target;
  const dir = Math.abs(diff) < ON_TARGET ? 'ok' : diff < 0 ? 'low' : 'high';
  const word = { ok: 'about right', low: 'not enough', high: 'too much' }[dir];
  const badHands = sp.n >= 3 && (sp.avg < 0.4 || sp.mistakeRate > 0.3);
  const tip = dir !== 'ok' ? m[dir](sp) : badHands
    ? `You play this spot about as often as the strategy, but not with the right hands. Click the spot in the table to see which hands to swap.`
    : 'Your frequency here matches the strategy. Keep it up.';
  return { label: m.label, you, target, diff, dir, word, tip };
}

// ---------- practice ↔ tournaments ----------
// The Leakfinder key of a Practice decision (preflop spots the tournament
// import can also produce). Null for postflop or spots it doesn't model.
export function practiceSpotKey(st) {
  if (st.street !== 0) return null;
  const hero = st.toAct;
  const acts = st.history.filter((e) => e.kind === 'act' && e.act.type !== 'fold');
  const raises = acts.filter((e) => e.act.type === 'raise' || e.act.type === 'allin');
  const stack = st.cfg?.stack ?? 100;
  if (!raises.length) {
    const lp = acts.filter((e) => e.act.type === 'call').map((e) => POS[e.p]);
    return lp.length ? spotKey('VL', POS[hero], lp.join('+'), stack) : spotKey('RFI', POS[hero], '', stack);
  }
  if (acts.length !== raises.length) return null; // limps or cold calls before
  if (raises.length === 1 && raises[0].p !== hero) return spotKey(raises[0].act.type === 'allin' ? 'VS' : 'VO', POS[hero], POS[raises[0].p], stack);
  if (raises.length === 2 && raises[0].p === hero) return spotKey('V3', POS[hero], POS[raises[1].p], stack);
  return null;
}

const toTime = (s) => (s ? new Date(s).getTime() : NaN);

// Older Practice records have no spot key; first-in drills can still be placed (they were 100bb).
export function recordKey(rec) {
  if (rec.spot !== undefined) return rec.spot;
  if (rec.drill === 'rfi' && rec.street === 'Preflop') return spotKey('RFI', rec.pos, '', 100);
  return null;
}

// For every spot trained in Practice: the training sessions, then how the
// tournament hands played in that spot after the first training compare.
export function liveAction(sessions, decisions, tournaments) {
  const tour = new Map(tournaments.map((t) => [t.tid, t]));
  const when = (d) => toTime(d.at || tour.get(d.t)?.startedAt || tour.get(d.t)?.date);
  const trained = new Map();
  for (const s of sessions) {
    for (const rec of s.decisions || []) {
      const key = recordKey(rec);
      const label = key || (rec.street !== 'Preflop' ? `${rec.pos} ${rec.street.toLowerCase()} (${rec.drill === 'srp' ? 'BTN vs BB' : 'postflop'})` : null);
      if (!label) continue;
      if (!trained.has(label)) trained.set(label, { key, label, sessions: new Map(), first: Infinity, last: 0 });
      const tr = trained.get(label);
      const t = toTime(rec.t);
      tr.first = Math.min(tr.first, t);
      tr.last = Math.max(tr.last, t);
      if (!tr.sessions.has(s.id)) tr.sessions.set(s.id, { start: toTime(s.startedAt) || t, n: 0, score: 0, mistakes: 0 });
      const ss = tr.sessions.get(s.id);
      ss.n++;
      ss.score += rec.score;
      if (!['best', 'correct'].includes(rec.grade)) ss.mistakes++;
    }
  }
  const { spots } = trained.size ? analyzeDecisions(decisions) : { spots: [] };
  const byKey = new Map(spots.map((sp) => [sp.key, sp]));
  return [...trained.values()].map((tr) => {
    const sess = [...tr.sessions.values()].sort((a, b) => a.start - b.start);
    const practice = sess.reduce((a, x) => ({ n: a.n + x.n, score: a.score + x.score, mistakes: a.mistakes + x.mistakes }), { n: 0, score: 0, mistakes: 0 });
    const out = { ...tr, sessions: sess, practice: { ...practice, avg: practice.score / practice.n } };
    if (!tr.key) return { ...out, status: 'postflop' };
    const [sc, hero, vill, group] = tr.key.split('|');
    const meta = { key: tr.key, sc, hero, vill, group };
    const all = byKey.get(tr.key)?.hands || [];
    const after = aggregate(meta, all.filter((x) => when(x.d) >= tr.first));
    const before = aggregate(meta, all.filter((x) => !(when(x.d) >= tr.first)));
    const tids = [...new Set(after.hands.map((x) => x.d.t))];
    const v = verdict(after);
    const status = !after.n ? 'waiting' : v === 'thin' ? 'thin' : v === 'strong' ? 'learned' : v === 'weak' ? 'notyet' : 'progress';
    return {
      ...out, ...meta, after, before, status,
      tournaments: tids.map((tid) => {
        const hs = after.hands.filter((x) => x.d.t === tid);
        const t = tour.get(tid);
        return { tid, name: t?.name || `#${tid}`, date: t?.startedAt || t?.date, n: hs.length, mistakes: hs.filter((x) => !['best', 'correct'].includes(x.grade)).length };
      }),
    };
  }).sort((a, b) => b.last - a.last);
}

// Strengths and weaknesses. Small samples stay neutral.
export function verdict(sp) {
  if (sp.n < 3) return 'thin';
  if (sp.avg < 0.4 || sp.mistakeRate > 0.3) return 'weak';
  const m = keyMetric(sp);
  if (m && Math.abs(m.diff) >= 0.15) return 'weak'; // clearly too tight or too loose
  if (sp.avg >= 0.75 && sp.mistakeRate <= 0.15) return 'strong';
  return 'ok';
}

// Biggest frequency gap, e.g. "raise 20% less than the strategy".
export function biggestGap(sp) {
  let best = null;
  for (const a of ['fold', 'call', 'raise', 'allin']) {
    const diff = (sp.you[a] - sp.gto[a]) / sp.n;
    if (!best || Math.abs(diff) > Math.abs(best.diff)) best = { action: a, diff };
  }
  return best;
}

export function studyLink(st) {
  const line = st.history.map((e) => e.p + actionKey(e.act)).join('_');
  return `#/study?s=${st.cfg.stack}&o=${st.cfg.open}${line ? '&l=' + line : ''}`;
}
