// Range-vs-range equity with shared runouts.
// For each runout every combo is evaluated once, the villain range is sorted,
// and each hero combo reads its win/tie share from prefix sums, then card
// conflicts (combos sharing a card) are removed exactly.
import { COMBOS, CARD_COMBOS } from './cards.js';
import { evalHand } from './evaluator.js';
import { mulberry32 } from './rng.js';

function runoutsFor(board, rand) {
  const dead = new Uint8Array(52);
  board.forEach((c) => { dead[c] = 1; });
  const need = 5 - board.length;
  if (need === 0) return [[]];
  const live = [];
  for (let c = 0; c < 52; c++) if (!dead[c]) live.push(c);
  if (need === 1) return live.map((c) => [c]);
  const n = need === 2 ? 36 : 40;
  const out = [];
  for (let k = 0; k < n; k++) {
    const pick = [];
    while (pick.length < need) {
      const c = live[Math.floor(rand() * live.length)];
      if (!pick.includes(c)) pick.push(c);
    }
    out.push(pick);
  }
  return out;
}

function lowerBound(arr, n, v) {
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
  return lo;
}
function upperBound(arr, n, v) {
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; }
  return lo;
}

// heroW / villW: Float32Array(1326) weights. Returns Float32Array(1326) of
// equity for every live combo (NaN for combos blocked by the board).
export function rangeEquity(villW, board, seed) {
  const rand = mulberry32(seed);
  const runouts = runoutsFor(board, rand);
  const sum = new Float64Array(1326);
  const cnt = new Float64Array(1326);
  const vals = new Int32Array(1326);
  const order = new Int32Array(1326);
  const sortedVals = new Int32Array(1326);
  const prefix = new Float64Array(1327);
  const full = new Array(5);
  const dead = new Uint8Array(52);

  for (const ro of runouts) {
    dead.fill(0);
    let n = 0;
    for (const c of board) { full[n++] = c; dead[c] = 1; }
    for (const c of ro) { full[n++] = c; dead[c] = 1; }
    const fb = full.slice(0, n);
    let m = 0;
    for (let i = 0; i < 1326; i++) {
      const [a, b] = COMBOS[i];
      if (dead[a] || dead[b]) { vals[i] = -1; continue; }
      vals[i] = evalHand(a, b, fb);
      if (villW[i] > 0) order[m++] = i;
    }
    const ord = Array.from(order.subarray(0, m)).sort((x, y) => vals[x] - vals[y]);
    prefix[0] = 0;
    for (let k = 0; k < m; k++) {
      sortedVals[k] = vals[ord[k]];
      prefix[k + 1] = prefix[k] + villW[ord[k]];
    }
    const total = prefix[m];
    for (let i = 0; i < 1326; i++) {
      const v = vals[i];
      if (v < 0) continue;
      const lo = lowerBound(sortedVals, m, v);
      const hi = upperBound(sortedVals, m, v);
      let below = prefix[lo], tie = prefix[hi] - prefix[lo], tot = total;
      const [a, b] = COMBOS[i];
      const la = CARD_COMBOS[a], lb = CARD_COMBOS[b];
      for (let k = 0; k < la.length; k++) {
        const j = la[k], w = villW[j];
        if (w > 0 && vals[j] >= 0) { tot -= w; if (vals[j] < v) below -= w; else if (vals[j] === v) tie -= w; }
      }
      for (let k = 0; k < lb.length; k++) {
        const j = lb[k];
        if (j === i) continue;
        const w = villW[j];
        if (w > 0 && vals[j] >= 0) { tot -= w; if (vals[j] < v) below -= w; else if (vals[j] === v) tie -= w; }
      }
      // Weight each runout by the villain weight still live on it: a runout
      // that blocks most of the range is that much less likely.
      if (tot > 1e-9) { sum[i] += below + tie / 2; cnt[i] += tot; }
    }
  }
  const eq = new Float32Array(1326);
  for (let i = 0; i < 1326; i++) eq[i] = cnt[i] > 0 ? sum[i] / cnt[i] : NaN;
  return eq;
}

export function weightedMean(values, weights) {
  let s = 0, w = 0;
  for (let i = 0; i < values.length; i++) {
    if (weights[i] > 0 && !Number.isNaN(values[i])) { s += values[i] * weights[i]; w += weights[i]; }
  }
  return w > 0 ? s / w : NaN;
}
