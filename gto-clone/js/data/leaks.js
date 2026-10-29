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
    const key = `${d.sc}|${POS[d.hp]}|${vill}|${stackGroup(d.s)}`;
    if (!spots.has(key)) {
      spots.set(key, {
        key, sc: d.sc, hero: POS[d.hp], vill, group: stackGroup(d.s), n: 0, score: 0, mistakes: 0,
        you: { fold: 0, call: 0, raise: 0, allin: 0 }, gto: { fold: 0, call: 0, raise: 0, allin: 0 }, hands: [],
      });
    }
    const sp = spots.get(key);
    sp.n++;
    sp.score += g.score;
    if (!['best', 'correct'].includes(g.grade)) sp.mistakes++;
    sp.you[GROUP_OF[d.a] || 'fold'] += 1;
    node.actions.forEach((a, j) => { sp.gto[GROUP_OF[a.type]] += freqs[j]; });
    sp.hands.push({
      d, cls: CLASSES[CLASS_OF_COMBO[ci]].name, grade: g.grade, freqs,
      labels: node.actions.map((a) => a.type === 'call' && st.raiseLevel === 0 ? 'limp' : a.type), link: studyLink(st),
    });
  }
  const list = [...spots.values()].map((sp) => ({ ...sp, avg: sp.score / sp.n, mistakeRate: sp.mistakes / sp.n }));
  return { spots: list, covered, notCovered };
}

// Strengths and weaknesses. Small samples stay neutral.
export function verdict(sp) {
  if (sp.n < 3) return 'thin';
  if (sp.avg < 0.4 || sp.mistakeRate > 0.3) return 'weak';
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
