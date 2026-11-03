// Push / fold equilibrium (Nash, chip EV) at 15bb and less, where the user
// has no chart: each seat first in goes all-in or folds, and each later seat
// calls the all-in or folds (the pot is then heads-up, as in the engine).
// Solved by fictitious play over the 169 hand classes: every round, each
// player's best response to the others' average strategies, then the
// averages move towards it. Equities: data/preflop-equity.js; card removal:
// the number of combo pairs of two classes that share no card.
import { CLASSES, COMBOS } from './cards.js';
import { PREFLOP_EQUITY } from '../data/preflop-equity.js';

export const PUSH_FOLD_STACK = 15; // at or below this depth (no chart there)
const n = 169;
const BLINDS = [0, 0, 0, 0, 0.5, 1];
const ROUNDS = 400;

let EQ = null, PC = null; // EQ[a * n + b]: a's equity vs b; PC: combo pairs sharing no card
function tables() {
  if (EQ) return;
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  EQ = new Float64Array(n * n);
  let k = 0;
  for (let a = 0; a < n; a++) {
    for (let b = a; b < n; b++, k += 2) {
      const v = (A.indexOf(PREFLOP_EQUITY[k]) * 64 + A.indexOf(PREFLOP_EQUITY[k + 1])) / 4000;
      EQ[a * n + b] = v; EQ[b * n + a] = 1 - v;
    }
  }
  PC = new Float64Array(n * n);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      let c = 0;
      for (const i of CLASSES[a].combos) {
        const [x, y] = COMBOS[i];
        for (const j of CLASSES[b].combos) { const [u, v] = COMBOS[j]; if (x !== u && x !== v && y !== u && y !== v) c++; }
      }
      PC[a * n + b] = c;
    }
  }
}

// For hero class a: weight of villain classes in s (Σ PC·s) and their equity-weighted sum (Σ PC·s·EQ).
function against(s, out, outEq) {
  for (let a = 0; a < n; a++) {
    let w = 0, e = 0;
    for (let b = 0; b < n; b++) { const x = PC[a * n + b] * s[b]; w += x; e += x * EQ[a * n + b]; }
    out[a] = w; outEq[a] = e;
  }
}

const cache = new Map();

// push[i][a]: how often seat i (LJ..SB) first in goes all-in with class a;
// call[i][j][a]: how often seat j calls i's all-in with class a.
export function pushFoldNash(stack) {
  if (cache.has(stack)) return cache.get(stack);
  tables();
  const S = stack;
  const push = [0, 1, 2, 3, 4].map(() => new Float64Array(n).fill(0.5));
  const call = [0, 1, 2, 3, 4].map(() => [0, 1, 2, 3, 4, 5].map(() => new Float64Array(n).fill(0.3)));
  const tot = new Float64Array(n);
  for (let a = 0; a < n; a++) { let w = 0; for (let b = 0; b < n; b++) w += PC[a * n + b]; tot[a] = w; }
  const W = new Float64Array(n), E = new Float64Array(n);
  const brPush = push.map(() => new Float64Array(n));
  const brCall = call.map((row) => row.map(() => new Float64Array(n)));
  const callW = call.map((row) => row.map(() => new Float64Array(n)));
  const callE = call.map((row) => row.map(() => new Float64Array(n)));
  const dead = (i, j) => BLINDS.reduce((s, b, k) => s + (k === i || k === j ? 0 : b), 0);
  for (let t = 0; t < ROUNDS; t++) {
    // Callers vs each pusher.
    for (let i = 0; i < 5; i++) {
      against(push[i], W, E);
      for (let j = i + 1; j < 6; j++) {
        const pot = 2 * S + dead(i, j);
        for (let b = 0; b < n; b++) {
          const ev = W[b] > 0 ? (E[b] / W[b]) * pot - S : -Infinity;
          brCall[i][j][b] = ev > -BLINDS[j] ? 1 : 0;
        }
      }
    }
    // Pushers vs the callers behind them.
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 6; j++) against(call[i][j], callW[i][j], callE[i][j]);
    for (let i = 0; i < 5; i++) {
      for (let a = 0; a < n; a++) {
        let reach = 1, ev = 0;
        for (let j = i + 1; j < 6; j++) {
          const w = callW[i][j][a];
          const c = w / tot[a];
          if (c > 0) ev += reach * c * ((callE[i][j][a] / w) * (2 * S + dead(i, j)) - S);
          reach *= 1 - c;
        }
        ev += reach * (1.5 - BLINDS[i]); // everyone folds: the blinds
        brPush[i][a] = ev > -BLINDS[i] ? 1 : 0;
      }
    }
    const step = 1 / (t + 2);
    for (let i = 0; i < 5; i++) {
      for (let a = 0; a < n; a++) push[i][a] += (brPush[i][a] - push[i][a]) * step;
      for (let j = i + 1; j < 6; j++) for (let a = 0; a < n; a++) call[i][j][a] += (brCall[i][j][a] - call[i][j][a]) * step;
    }
  }
  // The averages keep a trace of the first rounds (they start at 0.5): a hand
  // the equilibrium always or never plays ends within 3% of it, snapped.
  const snap = (s) => { for (let a = 0; a < n; a++) s[a] = s[a] > 0.97 ? 1 : s[a] < 0.03 ? 0 : s[a]; };
  for (let i = 0; i < 5; i++) { snap(push[i]); for (let j = i + 1; j < 6; j++) snap(call[i][j]); }
  const res = { stack, push, call };
  cache.set(stack, res);
  return res;
}

// Share of all combos in a class strategy (for summaries).
export const comboShare = (s) => CLASSES.reduce((x, c) => x + s[c.id] * c.combos.length, 0) / 1326;
