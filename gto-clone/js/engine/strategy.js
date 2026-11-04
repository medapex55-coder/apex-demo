// Strategy generator. Not a solver: first-in opens come from the user's charts
// (data/open-charts.js), other preflop spots from a hand-strength ordering and
// position thresholds, postflop from equity vs. the opponent's
// range, draws and range advantage. Every node's ranges are the parent's
// ranges times the frequency of the action taken, so the tree is consistent.
import { CLASSES, COMBOS, CLASS_OF_COMBO, deadMask } from './cards.js';
import { classify } from './evaluator.js';
import { rangeEquity, weightedMean } from './equity.js';
import { hashStr } from './rng.js';
import { OPEN_CHARTS } from '../data/open-charts.js';
import { OPEN_CHARTS_50, BB_CHARTS_50, BB_CODES } from '../data/charts-50.js';
import { OPEN_CHARTS_25, OPEN_CHARTS_20, BB_CHARTS_25, BB_CHARTS_20 } from '../data/charts-short.js';
import { stageBubbleFactor } from './icm.js';
import { solutionAt, onSolution } from './solutions.js';
import { pushFoldNash, PUSH_FOLD_STACK } from './pushfold.js';
import {
  POS, legalActions, stateKey, replay, actionKey, pot, toCallOf, isIP, opponentOf, remaining, alive, SHOVE_STACK, isHU, seatCfg, jamOption,
} from './game.js';

// Tournament pressure. ICM: the bubble factor (BF) says how much more a chip
// lost costs than a chip won; the ranges that face aggression shrink by
// BF^-0.8 (BF 1.5 -> about 28% narrower). The BF comes from your own ICM
// scenario when you set one, else from the typical spot of the stage.
// Bounties pay you for calling and isolating, so KO formats widen them.
const KO_BONUS = { 100: 0.1, 50: 0.12, 25: 0.15, 10: 0.15, semi: 0.15, ft: 0.15, hu: 0.1 };
export const spotBubbleFactor = (cfg) => cfg.bf ?? stageBubbleFactor(cfg.stage || '100');
// Covering (Practice option): cfg.big = the seat that covers everyone,
// cfg.short = the seat everyone covers. The player who covers risks only part
// of the stack (half the ICM pressure) and can win the bounty (1.5x the KO
// bonus); the covered player risks busting (1.3x the pressure) and can't win
// the coverer's bounty. In chip EV (no ICM, no bounty) it changes nothing.
export function coverOf(cfg, p) {
  if (p == null) return null;
  if (cfg.big != null) return p === cfg.big ? 'covers' : 'covered';
  if (cfg.short != null) return p === cfg.short ? 'covered' : 'covers';
  return null;
}
export function rangeScale(cfg, p) {
  const s = cfg.stage || '100';
  const cover = coverOf(cfg, p);
  const bf = spotBubbleFactor(cfg);
  const BF = cover ? 1 + (bf - 1) * (cover === 'covers' ? 0.5 : 1.3) : bf;
  const ko = cfg.ko ? KO_BONUS[s] * (cover === 'covers' ? 1.5 : cover === 'covered' ? 0 : 1) : 0;
  return BF ** -0.8 * (1 + ko);
}
const HU_OPEN = 0.8; // heads-up, the button (SB) opens most hands

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const ramp = (x, lo, hi) => clamp((x - lo) / (hi - lo));
// 1 for hands stronger (lower percentile) than T, blending over +-w.
const within = (pc, T, w = 0.015) => clamp((T + w - pc) / (2 * w));

// --- preflop hand ordering (Chen-style score, our own tie-breaks) ---
function score(c) {
  const v = (r) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  if (c.pair) return Math.max(6.5, v(c.hi) * 2 + 1) + c.hi * 0.01;
  let s = v(c.hi);
  if (c.suited) s += 2;
  if (c.suited && c.hi === 12) s += 1.5; // suited wheel aces play well
  const gap = c.hi - c.lo - 1;
  s -= gap <= 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && c.hi < 10) s += 1;
  return s + c.hi * 0.01 + c.lo * 0.002;
}
export const PERCENTILE = new Float32Array(169);
{
  const sorted = CLASSES.slice().sort((a, b) => score(b) - score(a));
  let cum = 0;
  for (const c of sorted) {
    PERCENTILE[c.id] = (cum + c.combos.length / 2) / 1326;
    cum += c.combos.length;
  }
}

// --- the user's open charts (first in, LJ..SB) ---
// Style: 'standard' opens Raise + Tightfie, 'tight' drops Tightfie,
// 'loose' adds Loosifie. The off-style action on a flex hand keeps a small
// frequency so the trainer grades it as acceptable, not a mistake.
let openStyle = 'standard';
const FLEX = 0.15;
export const getOpenStyle = () => openStyle;
export function setOpenStyle(s) {
  if (s === openStyle) return;
  openStyle = s;
  cache.clear();
}

// Which chart set a stack plays: the nearest depth among 20, 25, 50 and 100bb.
export const chartDepth = (stack) => (stack < 22.5 ? 20 : stack < 37.5 ? 25 : stack < 75 ? 50 : 100);
// Close enough to the chart's depth to use its all-ins and the BB's charts
// (shorter than that, the model's shoving ranges apply).
export const chartFits = (stack) => stack >= 0.8 * chartDepth(stack) && stack <= 1.4 * chartDepth(stack);
// Between two chart depths (25-50bb, 50-100bb) the charts are blended: each
// hand's frequencies move in a straight line from the lower chart (t = 0) to
// the upper one (t = 1). 30bb is 80% the 25bb chart, 40bb 60% the 50bb one.
export function chartBlend(stack) {
  if (stack > 25 && stack < 50) return { lo: 25, hi: 50, t: (stack - 25) / 25 };
  if (stack > 50 && stack < 100) return { lo: 50, hi: 100, t: (stack - 50) / 50 };
  return null;
}
const OPEN_BY_DEPTH = { 20: OPEN_CHARTS_20, 25: OPEN_CHARTS_25, 50: OPEN_CHARTS_50, 100: OPEN_CHARTS };
// The BB's charts at each depth, and the open size they are made for.
const BB_BY_DEPTH = { 20: { open: '2', charts: BB_CHARTS_20 }, 25: { open: '2', charts: BB_CHARTS_25 }, 50: { open: '2.5', charts: BB_CHARTS_50 } };

export function chartCodeAt(p, cls, depth) {
  const ch = OPEN_BY_DEPTH[depth][POS[p]];
  return ch ? ch[cls.row][cls.col] : null;
}
export const chartCode = (p, cls, stack = 100) => chartCodeAt(p, cls, chartDepth(stack));

const mix = (a, b, t) => Object.fromEntries(['raise', 'limp', 'fold', 'jam'].map((k) => [k, (1 - t) * (a[k] || 0) + t * (b[k] || 0)]));
// First-in frequencies of a hand: its chart, or the blend of the two charts around the stack.
export function openFreqs(p, cls, stack) {
  const b = chartBlend(stack);
  if (!b) return codeFreqs(chartCode(p, cls, stack));
  return mix(codeFreqs(chartCodeAt(p, cls, b.lo)), codeFreqs(chartCodeAt(p, cls, b.hi)), b.t);
}

// The BB's chart at one depth for this spot, or null: vs a limp from the SB,
// vs a single open (not an all-in) with nobody else in, and vs the SB's
// limp-reraise or limp-shove after the BB raised.
function bbChartAt(st, depth) {
  const set = BB_BY_DEPTH[depth];
  if (!set) return null;
  const sbLimp = st.limpers.length === 1 && st.limpers[0] === 4;
  if (st.raiseLevel === 0) return sbLimp ? set.charts.vsLimp || null : null;
  if (st.raiseLevel === 1 && !st.limpers.length) {
    const o = st.lastAggr;
    return remaining(st, o) > 0 && alive(st).every((i) => i === 5 || i === o) ? set.charts[POS[o]] || null : null;
  }
  if (st.raiseLevel === 2 && sbLimp && st.lastAggr === 4) return (remaining(st, 4) <= 0 && set.charts.vsLimpShove) || set.charts.vsLimp3bet || null;
  return null;
}

// The BB's chart(s) for this spot, or null: { title, raiseLabel, parts:
// [{ chart, depth, w }], blend }. 6-max, chip-EV spots only (with bounties or
// ICM pressure the model's adjusted ranges apply). One chart at its open size
// (2.5bb at 50bb, 2bb at 25 and 20bb) from 0.8x to 1.4x its depth; between 25
// and 50bb the two charts blended, for a 2 or 2.5bb open, when both cover the spot.
export function bbChart(st) {
  const { cfg } = st;
  if (st.street !== 0 || st.toAct !== 5 || isHU(st)) return null;
  if (Math.abs(rangeScale(cfg) - 1) > 0.005) return null;
  const b = chartBlend(cfg.stack);
  if (b && b.hi === 50) {
    if (cfg.open !== '2' && cfg.open !== '2.5') return null;
    const lo = bbChartAt(st, 25), hi = bbChartAt(st, 50);
    if (!lo || !hi) return null;
    const raiseLabel = lo.raiseLabel === hi.raiseLabel ? lo.raiseLabel : 'Raise';
    return { title: hi.title, raiseLabel, blend: b, parts: [{ chart: lo, depth: 25, w: 1 - b.t }, { chart: hi, depth: 50, w: b.t }] };
  }
  const depth = chartDepth(cfg.stack);
  if (!BB_BY_DEPTH[depth] || cfg.open !== BB_BY_DEPTH[depth].open || !chartFits(cfg.stack)) return null;
  const ch = bbChartAt(st, depth);
  return ch ? { title: ch.title, raiseLabel: ch.raiseLabel, blend: null, parts: [{ chart: ch, depth, w: 1 }] } : null;
}
// Push/fold equilibrium spots (engine/pushfold.js): 15bb and less, 6-max, chip
// EV, no limper; first in (push or fold), or facing a first-in all-in.
export function pushFoldSpot(st) {
  const { cfg } = st;
  if (st.street !== 0 || isHU(st) || cfg.stack > PUSH_FOLD_STACK || st.limpers.length || st.toAct < 0) return null;
  if (Math.abs(rangeScale(cfg) - 1) > 0.005) return null;
  const p = st.toAct;
  if (st.raiseLevel === 0 && p <= 4) return { kind: 'push', i: p, nash: pushFoldNash(cfg.stack) };
  if (st.raiseLevel === 1 && remaining(st, st.lastAggr) <= 0 && p > st.lastAggr) return { kind: 'call', i: st.lastAggr, j: p, nash: pushFoldNash(cfg.stack) };
  return null;
}

// The chart's code for a hand when one chart applies (null when blended).
export const bbCode = (spot, cls) => (spot.parts.length === 1 ? spot.parts[0].chart.grid[cls.row][cls.col] : null);
// The BB's frequencies for a hand: raise counts every aggressive action, jam
// the all-in part, light the 3bet-light part.
export function bbFreqs(spot, cls) {
  const f = { raise: 0, call: 0, jam: 0, light: 0 };
  for (const { chart, w } of spot.parts) {
    const code = chart.grid[cls.row][cls.col], c = BB_CODES[code];
    f.raise += w * c.raise; f.call += w * c.call; f.jam += w * (c.jam || 0);
    if (code === 'B') f.light += w;
  }
  return f;
}

// raise counts every aggressive action, jam the all-in part of it (A, a).
export function codeFreqs(code) {
  switch (code) {
    case 'R': return { raise: 1, limp: 0, fold: 0 };
    case 'M': return { raise: 0, limp: 1, fold: 0 };
    case 'H': return { raise: 0.5, limp: 0.5, fold: 0 };
    case 'm': return { raise: 0, limp: 0.5, fold: 0.5 };
    case 'A': return { raise: 1, limp: 0, fold: 0, jam: 1 };
    case 'a': return { raise: 0.5, limp: 0.5, fold: 0, jam: 0.5 };
    case 'L':
      if (openStyle === 'loose') return { raise: 1 - FLEX, limp: 0, fold: FLEX };
      if (openStyle === 'tight') return { raise: 0, limp: 0, fold: 1 };
      return { raise: FLEX, limp: 0, fold: 1 - FLEX };
    case 'T':
      if (openStyle === 'loose') return { raise: 1, limp: 0, fold: 0 };
      if (openStyle === 'tight') return { raise: FLEX, limp: 0, fold: 1 - FLEX };
      return { raise: 1 - FLEX, limp: 0, fold: FLEX };
    case 'X': {
      const t = codeFreqs('T');
      return { raise: 0.5 + 0.5 * t.raise, limp: 0, fold: 0.5 * t.fold };
    }
    default: return { raise: 0, limp: 0, fold: 1 };
  }
}

// Share of all combos a seat opens (raise only), used to size the defence.
function openWidth(p, stack) {
  if (p === 5) return 0.18; // BB isolating a limp
  if (!OPEN_CHARTS[POS[p]]) return 0.4;
  let s = 0;
  for (const c of CLASSES) s += openFreqs(p, c, stack).raise * c.combos.length;
  return s / 1326;
}

// At 20bb and shorter, part of the raising range moves all-in: 20% at 20bb,
// all of it from 12bb. First in, premiums (TT+, AK, AQs) keep a small raise to
// trap until about 10bb.
function shoveShare(c, stack, firstIn) {
  if (stack > SHOVE_STACK) return 0;
  let s = clamp((22 - stack) / 10);
  const premium = (c.pair && c.hi >= 8) || (c.hi === 12 && c.lo === 11) || (c.hi === 12 && c.lo === 10 && c.suited);
  if (firstIn && premium) s *= clamp((16 - stack) / 6);
  return s;
}

function preflopClassFreqs(st, actions, range) {
  const p = st.toAct;
  const rl = st.raiseLevel;
  const out = CLASSES.map(() => new Array(actions.length).fill(0));
  const idx = (t) => actions.findIndex((a) => a.type === t);
  const iF = idx('fold'), iC = idx('call');
  // sizes: the aggressive actions, smallest first (several when the player
  // has custom sizings; the all-in counts as one when it is just the biggest).
  // iR: where the raising frequency is computed, then split across sizes.
  // iA: a separate all-in option next to a raise (see jamOption).
  const short = jamOption(st) && idx('raise') >= 0;
  const sizes = actions.map((_, j) => j).filter((j) => actions[j].type === 'raise' || (actions[j].type === 'allin' && !short));
  const iR = sizes.length ? sizes[0] : -1;
  const iA = short ? idx('allin') : -1;
  const firstIn = rl === 0 && st.limpers.length === 0;
  const limped = st.limpers.includes(p);
  const facingLimp = rl === 0 && st.limpers.length > 0;
  // Facing an all-in with no raise left: call with the top of the range,
  // wider as stacks get shorter (better price relative to the stack).
  // k scales every range that faces a limp or a raise (ICM tightens, bounties widen).
  const k = rangeScale(st.cfg, p);
  const hu = isHU(st);
  const shoveCall = Math.min(0.6, (0.025 + 2 / st.cfg.stack) * k);
  const facingShove = rl >= 1 && iR < 0 && st.lastAggr >= 0 && remaining(st, st.lastAggr) <= 0;
  const width = (q) => (hu && q === 4 ? HU_OPEN : openWidth(q, st.cfg.stack));
  const pf = pushFoldSpot(st);
  const bbc = pf ? null : bbChart(st);
  // Players who already called the open (multiway spots only).
  const callers = rl === 1 ? alive(st).filter((i) => i !== p && i !== st.lastAggr && st.streetBet[i] >= st.currentBet).length : 0;
  for (const c of CLASSES) {
    const pc = PERCENTILE[c.id];
    let raise = 0, call = 0;
    let jam = null; // the all-in part of raise when a chart says it
    if (pf) {
      // Push/fold equilibrium: all-in or fold first in, call or fold facing it.
      if (pf.kind === 'push') raise = jam = pf.nash.push[pf.i][c.id];
      else call = pf.nash.call[pf.i][pf.j][c.id];
    } else if (bbc) {
      ({ raise, call, jam } = bbFreqs(bbc, c)); // the BB's chart(s)
    } else if (rl === 0 && p <= 4 && !facingLimp) {
      // First in: the user's chart (heads-up, the button opens most hands).
      // With the "limp" open size, the raising range limps.
      const f = hu && p === 4 ? { raise: within(pc, HU_OPEN, 0.03), limp: 0 } : openFreqs(p, c, st.cfg.stack);
      if (st.cfg.open === 'limp') {
        // Limp mode: the raising range limps, except the part that shoves at 20bb and less.
        raise = iR >= 0 ? f.raise * shoveShare(c, st.cfg.stack, true) : 0;
        call = f.raise - raise + f.limp;
      } else {
        raise = f.raise; call = f.limp;
        if (!hu && chartFits(st.cfg.stack)) jam = f.jam || 0; // the chart's own all-ins (25bb, 20bb)
      }
    } else if (facingLimp && p !== 5) {
      raise = within(pc, 0.12 * k); // isolate the top
      call = Math.max(0, within(pc, 0.2 * k) - raise); // over-limp the next band
    } else if (rl === 0) {
      raise = within(pc, 0.18 * k); // BB vs a limp: isolate the top, check the rest
    } else if (facingShove) {
      call = within(pc, shoveCall, 0.01);
    } else if (rl === 1) {
      const o = width(st.lastAggr);
      let V, C;
      if (limped) { V = 0.03; C = 0.6; } // limp-call wide, limp-raise the nuts
      else if (p === 5) { V = o * 0.22; C = Math.min(hu ? 0.8 : 0.62, 0.12 + o * 1.05); }
      else if (p === 4) { V = o * 0.32; C = V + o * 0.1; }
      else { V = o * 0.2; C = o * 0.55; }
      V *= k; C = Math.min(0.9, C * k * 0.85 ** callers); // cold-callers already in: call tighter
      const bluff = !limped && c.suited && pc > C && pc < C + 0.12 ? 0.4 : 0;
      raise = within(pc, V) + bluff;
      call = Math.max(0, within(pc, C) - within(pc, V));
    } else if (rl === 2) {
      const o = width(p);
      const C = o * (isIP(st, p) ? 0.55 : 0.42) * k;
      const bluff = c.suited && c.hi === 12 && pc > C && pc < o ? 0.5 : 0;
      raise = within(pc, 0.03 * k, 0.008) + bluff;
      call = Math.max(0, within(pc, C) - within(pc, 0.03 * k, 0.008));
    } else if (rl === 3) {
      raise = within(pc, 0.02 * k, 0.006);
      call = Math.max(0, within(pc, 0.045 * k, 0.01) - raise);
    } else {
      call = within(pc, 0.03 * k, 0.008);
    }
    if (iR < 0) { call += raise; raise = 0; }
    if (iC < 0) call = 0;
    raise = clamp(raise); call = clamp(call, 0, 1 - raise);
    const f = out[c.id];
    if (iR >= 0) f[iR] = raise;
    if (iA >= 0) {
      const sh = jam ?? raise * shoveShare(c, st.cfg.stack, firstIn);
      f[iA] = sh;
      f[iR] = raise - sh;
    }
    if (iC >= 0) f[iC] = call;
    const rest = 1 - raise - call;
    if (iF >= 0) f[iF] = rest;
    else if (iC >= 0) f[iC] += rest;
    else f[0] += rest;
  }
  // Weight of each hand class in the player's range at this point.
  const w = CLASSES.map((c) => c.combos.reduce((a, i) => a + range[i], 0));
  const loose = seatCfg(st.cfg, p).loose ?? 50;
  if (loose !== 50) applyLoose(out, actions, w, 2 ** ((loose - 50) / 50));
  if (sizes.length > 1) splitSizes(out, sizes, w);
  return out;
}

// Looser or tighter than the baseline (Study "⋯" slider): the share of the
// range that continues is multiplied by m (0.5 at 0, 2 at 100). Looser adds
// the best hands that folded (as calls, or raises when calling isn't an
// option); tighter folds the weakest continuing hands. With no fold
// available (BB vs a limp), it moves hands between check and raise instead.
function applyLoose(out, actions, w, m) {
  const find = (t) => actions.findIndex((a) => a.type === t);
  const iF = find('fold');
  const passive = iF >= 0 ? iF : find('check');
  const aggr = actions.findIndex((a) => a.type === 'raise' || a.type === 'allin');
  const target = iF >= 0 && find('call') >= 0 ? find('call') : aggr;
  if (passive < 0 || target < 0) return;
  let S = 0, W = 0;
  for (const c of CLASSES) { S += w[c.id] * (1 - out[c.id][passive]); W += w[c.id]; }
  let delta = clamp(S * m, 0, W) - S;
  const order = CLASSES.slice().sort((a, b) => PERCENTILE[a.id] - PERCENTILE[b.id]);
  if (delta < 0) order.reverse();
  for (const c of order) {
    if (Math.abs(delta) < 1e-9) break;
    const f = out[c.id], wc = w[c.id];
    if (!wc) continue;
    if (delta > 0) {
      const d = Math.min(f[passive], delta / wc);
      f[passive] -= d; f[target] += d; delta -= d * wc;
    } else {
      // Fold calls before raises, then the rest of the aggressive actions.
      for (const j of [target, ...actions.map((_, j) => j)]) {
        if (j === passive || !f[j]) continue;
        const d = Math.min(f[j], -delta / wc);
        f[j] -= d; f[passive] += d; delta += d * wc;
        if (delta > -1e-9) break;
      }
    }
  }
}

// Several raise sizes: the raising range is ranked by hand strength and cut
// into equal slices, the strongest slice taking the biggest size.
function splitSizes(out, sizes, w) {
  const order = CLASSES.slice().sort((a, b) => PERCENTILE[a.id] - PERCENTILE[b.id]);
  const first = sizes[0];
  const mass = (c) => out[c.id][first] * (w[c.id] || c.combos.length);
  const total = order.reduce((a, c) => a + mass(c), 0);
  if (total <= 0) return;
  let cum = 0;
  for (const c of order) {
    const m = mass(c);
    if (!m) continue;
    const q = (cum + m / 2) / total;
    cum += m;
    const k = sizes[sizes.length - 1 - Math.min(sizes.length - 1, Math.floor(q * sizes.length))];
    if (k !== first) { out[c.id][k] += out[c.id][first]; out[c.id][first] = 0; }
  }
}

const DRAW_SCORE = { 'Flush draw': 0.65, 'Open-ended': 0.55, Gutshot: 0.25 };

function noise(i, seed) {
  let h = Math.imul(i + 1, 2654435761) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function prune(f) {
  for (let k = 0; k < f.length; k++) if (f[k] < 0.02) f[k] = 0;
  const s = f.reduce((a, b) => a + b, 0);
  if (s <= 0) { f[0] = 1; return f; }
  for (let k = 0; k < f.length; k++) f[k] /= s;
  return f;
}

function postflopFreqs(node) {
  const { st, actions } = node;
  const p = st.toAct;
  const eqShare = node.equity(p);
  // Bet and raise thresholds are tuned heads-up. Multiway, the equity is
  // turned back into a heads-up-like number, a bit lower (betting into
  // several players needs a stronger hand). Calls keep the true pot share.
  const n = alive(st).length;
  const eq = n > 2 ? eqShare.map((e) => Math.max(0, e ** (1 / (n - 1)) - 0.04 * (n - 2))) : eqShare;
  const w = node.ranges[p];
  const adv = weightedMean(eq, w);
  const ip = isIP(st, p);
  const aggr = st.prevAggr === p;
  const street = st.street;
  const call = toCallOf(st, p);
  const P = pot(st);
  const seed = hashStr(node.key);
  const freqs = actions.map(() => new Float32Array(1326));
  node.info = new Array(1326);
  for (let i = 0; i < 1326; i++) {
    const [a, b] = COMBOS[i];
    if (node.dead[a] || node.dead[b]) continue;
    const e = eq[i];
    const cl = classify(a, b, st.board);
    node.info[i] = cl;
    const d = street === 3 ? 0 : DRAW_SCORE[cl.draw] || 0;
    const jitter = (noise(i, seed) - 0.5) * 0.18;
    let f;
    if (call === 0) {
      const bias = (aggr ? 0.12 : -0.1) + (ip ? 0.04 : -0.04) + (adv - 0.5) * 0.8;
      const value = ramp(e, 0.6 - bias * 0.5, 0.82);
      const trap = !ip && e > 0.92 ? 0.25 : 0;
      const bluffBase = street === 3 ? (e < 0.2 ? 0.45 : 0) : d * 0.75 + (e < 0.3 ? 0.15 : 0);
      const bluff = clamp(bluffBase * clamp(0.6 + bias * 1.5, 0, 1.2));
      const bet = clamp(value * (1 - trap) + (1 - value) * bluff + jitter);
      const polar = ramp(e, 0.78, 0.93);
      const denom = value + (1 - value) * bluff;
      let big = denom > 0 ? (value * polar + (1 - value) * bluff * (street >= 2 ? 0.7 : 0.3)) / denom : 0;
      if (street === 1 && adv > 0.55) big *= 0.6;
      big = clamp(big + jitter * 0.5);
      // big (0..1) picks the size: between two neighbouring sizes when there are several.
      const n = actions.length - 1, x = big * (n - 1);
      f = [1 - bet, ...actions.slice(1).map((_, j) => bet * (n === 1 ? 1 : Math.max(0, 1 - Math.abs(x - j))))];
    } else {
      const po = call / (P + call);
      const R = street === 3 ? 1 : ip ? 1 : 0.92;
      const eff = eqShare[i] * R + d * 0.12;
      const cont = ramp(eff + jitter * 0.3, po - 0.05, po + 0.08);
      const hasRaise = actions.length >= 3;
      let raise = 0;
      if (hasRaise) {
        const facingBig = actions.length === 3 && actions[2].type === 'allin';
        const raiseV = ramp(e, facingBig ? 0.88 : 0.84, facingBig ? 0.97 : 0.95) * 0.65;
        const raiseB = facingBig ? 0 : (street < 3 ? d * 0.3 : e < 0.12 ? 0.08 : 0) * (1 - cont);
        raise = clamp(raiseV * cont + raiseB);
      }
      const callF = clamp(cont - raise, 0, 1 - raise);
      // Several raise sizes (custom multipliers): the strongest hands take the biggest.
      const nr = actions.length - 2, x = ramp(e, 0.84, 0.97) * (nr - 1);
      f = hasRaise ? [1 - raise - callF, callF, ...actions.slice(2).map((_, j) => raise * (nr === 1 ? 1 : Math.max(0, 1 - Math.abs(x - j))))] : [1 - callF, callF];
    }
    prune(f);
    for (let k = 0; k < f.length; k++) freqs[k][i] = f[k];
  }
  return freqs;
}

// --- node analysis with cache ---
const cache = new Map();
const MAX_CACHE = 300;

function makeNode(st, ranges) {
  const key = stateKey(st);
  const node = {
    key,
    st,
    ranges,
    actor: st.toAct,
    actions: legalActions(st),
    dead: deadMask(st.board),
    freqs: null,
    info: null,
    _eq: {},
    // Share of the pot each combo wins. Multiway (postflop), the chance to beat
    // every opponent is approximated by multiplying the equity against each one.
    equity(p) {
      if (this._eq[p]) return this._eq[p];
      const others = alive(this.st).filter((i) => i !== p);
      if (this.st.street > 0 && others.length > 1) {
        const eq = new Float32Array(1326).fill(1);
        for (const o of others) {
          const e = rangeEquity(this.ranges[o], this.st.board, hashStr(this.key + '#' + p + '>' + o));
          for (let i = 0; i < 1326; i++) eq[i] *= e[i];
        }
        this._eq[p] = eq;
        return eq;
      }
      const o = opponentOf(this.st, p);
      const villW = o >= 0 ? this.ranges[o] : new Float32Array(1326).fill(1);
      this._eq[p] = rangeEquity(villW, this.st.board, hashStr(this.key + '#' + p));
      return this._eq[p];
    },
  };
  return node;
}

export const isCached = (st) => cache.has(stateKey(st));
// A new solution changes nodes and the ranges below them: start over.
onSolution(() => cache.clear());

// Each player's range at this point of the hand (weights per combo), from the
// parent decision's strategy. Works on states waiting for a board too.
export function rangesOf(st) {
  if (st.history.length === 0) return POS.map(() => new Float32Array(1326).fill(1));
  const last = st.history[st.history.length - 1];
  const parent = analyze(replay(st.history.slice(0, -1), st.cfg));
  const ranges = parent.ranges.map((r) => r.slice());
  if (last.kind === 'act') {
    const ai = parent.actions.findIndex((a) => actionKey(a) === actionKey(last.act));
    const f = parent.freqs && ai >= 0 ? parent.freqs[ai] : null;
    if (f) {
      const r = ranges[last.p];
      const prev = r.slice();
      let sum = 0;
      for (let i = 0; i < 1326; i++) { r[i] *= f[i]; sum += r[i]; }
      // An action the strategy never takes (e.g. a min-raise where it only
      // shoves or folds) would leave an empty range and NaN equities below.
      // Keep the hands closest to taking it instead, with a floor so it's never empty.
      if (!(sum > 0.5)) { const mx = Math.max(...f); for (let i = 0; i < 1326; i++) r[i] = prev[i] * Math.max(mx > 0 ? f[i] / mx : 0, 0.02); }
    }
  } else {
    const dead = deadMask(last.cards);
    for (const r of ranges) for (let i = 0; i < 1326; i++) { const [a, b] = COMBOS[i]; if (dead[a] || dead[b]) r[i] = 0; }
  }
  return ranges;
}

// A line the strategy really plays: every action in it is taken by at least
// half a combo of its player's range (at 15bb, a min-raise is not: it shoves or folds).
export function liveLine(st) {
  const hist = st.history;
  for (let k = 0; k < hist.length; k++) {
    const e = hist[k];
    if (e.kind !== 'act') continue;
    const parent = analyze(replay(hist.slice(0, k), st.cfg));
    const ai = parent.actions.findIndex((a) => actionKey(a) === actionKey(e.act));
    const f = parent.freqs && ai >= 0 ? parent.freqs[ai] : null;
    if (!f) continue;
    const w = parent.ranges[e.p];
    let s = 0;
    for (let i = 0; i < 1326; i++) s += f[i] * w[i];
    if (!(s > 0.5)) return false;
  }
  return true;
}

export function analyze(st) {
  const key = stateKey(st);
  if (cache.has(key)) return cache.get(key);
  const node = makeNode(st, rangesOf(st));
  if (node.actions.length) {
    if (st.street === 0) {
      const cf = preflopClassFreqs(st, node.actions, node.ranges[st.toAct]);
      node.freqs = node.actions.map((_, k) => {
        const arr = new Float32Array(1326);
        for (let i = 0; i < 1326; i++) arr[i] = cf[CLASS_OF_COMBO[i]][k];
        return arr;
      });
    } else {
      node.freqs = postflopFreqs(node);
    }
    // A solver solution for this node replaces the model (same actions).
    const sol = solutionAt(key);
    if (sol && sol.actions.join() === node.actions.map(actionKey).join()) {
      node.freqs = sol.freqs;
      node.evs = sol.evs;
      node.solved = sol.meta;
    }
  }
  cache.set(key, node);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return node;
}

// Strategy for one combo: array of frequencies per action.
export function comboFreqs(node, i) {
  return node.actions.map((_, k) => node.freqs[k][i]);
}

// Estimated EV (bb) of each action for combo i. A simple model of pot equity,
// realisation and fold equity, consistent with the generated strategy.
export function comboEVs(node, i) {
  if (node.evs) return node.actions.map((_, k) => node.evs[k][i]); // solved: exact EVs
  const st = node.st, p = st.toAct;
  const e = node.equity(p)[i];
  const P = pot(st);
  const call = toCallOf(st, p);
  const ip = isIP(st, p);
  const R = st.street === 3 ? 1 : st.street === 0 ? (ip ? 0.92 : 0.78) : ip ? 1 : 0.9;
  return node.actions.map((a) => {
    if (a.type === 'fold') return 0;
    if (a.type === 'check') return e * P * R;
    if (a.type === 'call') return e * (P + call) * R - call;
    const add = a.to - st.streetBet[p];
    const raiseBy = a.to - st.currentBet;
    const fe = clamp(0.85 * raiseBy / (P + raiseBy));
    const e2 = e > 0.8 ? e * 0.95 : e * 0.7;
    return fe * P + (1 - fe) * (e2 * (P + add + raiseBy) * R - add);
  });
}

// Aggregate a node by hand class for the 13x13 grid.
export function classSummary(node, p = node.actor) {
  const w = node.ranges[p];
  return CLASSES.map((c) => {
    let wsum = 0, live = 0;
    const f = node.actions.map(() => 0);
    for (const i of c.combos) {
      const [a, b] = COMBOS[i];
      if (node.dead[a] || node.dead[b]) continue;
      live++;
      wsum += w[i];
      if (node.freqs && p === node.actor) for (let k = 0; k < f.length; k++) f[k] += w[i] * node.freqs[k][i];
    }
    if (wsum > 0) for (let k = 0; k < f.length; k++) f[k] /= wsum;
    return { cls: c, weight: live ? wsum / live : 0, combos: wsum, live, freqs: f };
  });
}

export function overallFreqs(node) {
  const w = node.ranges[node.actor];
  const tot = node.actions.map(() => 0);
  let sum = 0;
  for (let i = 0; i < 1326; i++) {
    if (w[i] <= 0) continue;
    sum += w[i];
    for (let k = 0; k < tot.length; k++) tot[k] += w[i] * node.freqs[k][i];
  }
  return { freqs: tot.map((x) => (sum > 0 ? x / sum : 0)), combos: tot, total: sum };
}

export function rangeCombos(w) {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i];
  return s;
}

export function classAverage(values, node, p, cls) {
  const w = node.ranges[p];
  let s = 0, t = 0;
  for (const i of cls.combos) {
    if (w[i] > 0 && !Number.isNaN(values[i])) { s += values[i] * w[i]; t += w[i]; }
  }
  return t > 0 ? s / t : NaN;
}
