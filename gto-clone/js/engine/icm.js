// ICM (Independent Chip Model) and bubble factor.
//
// ICM turns stacks into a share of the prize pool: each player's chance to
// finish 1st is stack / total chips, then the same again among the players
// left for 2nd, and so on (Malmuth-Harville). Equity = sum of
// P(place) x prize. Computed exactly over subsets of players, so up to 14.
//
// Bubble factor (hero vs one opponent, all-in for the smaller stack):
//   BF = ($EV now - $EV if hero loses) / ($EV if hero wins - $EV now)
// 1 = chips are worth the same won or lost (cash game). Above 1, losing a
// chip costs more than winning one brings, so you need more equity to call.

export const MAX_PLAYERS = 14;

// Equity of each player (same unit as the payouts).
export function icmEquities(stacks, payouts) {
  const n = stacks.length;
  if (n > MAX_PLAYERS) throw new Error(`ICM limité à ${MAX_PLAYERS} joueurs`);
  const pays = payouts.slice(0, n);
  const paid = pays.length;
  const total = stacks.reduce((a, b) => a + b, 0);
  const eq = new Array(n).fill(0);
  if (!paid || total <= 0) return eq;
  const size = 1 << n;
  const chips = new Float64Array(size); // chips of the players in the mask
  const prob = new Float64Array(size); // P(the mask's players take the top places, in any order)
  const count = new Uint8Array(size);
  prob[0] = 1;
  for (let m = 1; m < size; m++) {
    const low = 31 - Math.clz32(m & -m);
    chips[m] = chips[m & (m - 1)] + stacks[low];
    count[m] = count[m & (m - 1)] + 1;
    if (count[m] > paid) continue;
    for (let j = 0; j < n; j++) {
      if (!(m & (1 << j))) continue;
      const prev = m ^ (1 << j);
      if (!prob[prev]) continue;
      const left = total - chips[prev];
      if (left <= 0) continue;
      const p = prob[prev] * stacks[j] / left; // j finishes at place count[m]
      prob[m] += p;
      eq[j] += p * pays[count[m] - 1];
    }
  }
  return eq;
}

// Same, after stacks may have dropped to 0: busted players take the lowest
// places still open (shared if several bust in the same hand).
export function icmAfter(stacks, payouts) {
  const n = stacks.length;
  const alive = stacks.map((s, i) => [s, i]).filter(([s]) => s > 0);
  const out = new Array(n).fill(0);
  const bust = n - alive.length;
  if (bust) {
    const share = payouts.slice(alive.length, n).reduce((a, b) => a + b, 0) / bust;
    stacks.forEach((s, i) => { if (s <= 0) out[i] = share; });
  }
  const eq = icmEquities(alive.map(([s]) => s), payouts.slice(0, alive.length));
  alive.forEach(([, i], k) => { out[i] = eq[k]; });
  return out;
}

export function bubbleFactor(stacks, payouts, hero, vill) {
  const e = Math.min(stacks[hero], stacks[vill]);
  if (e <= 0) return 1;
  const now = icmAfter(stacks, payouts)[hero];
  const win = stacks.slice(); win[hero] += e; win[vill] -= e;
  const lose = stacks.slice(); lose[hero] -= e; lose[vill] += e;
  const gain = icmAfter(win, payouts)[hero] - now;
  const loss = now - icmAfter(lose, payouts)[hero];
  return gain > 1e-12 ? loss / gain : 1;
}

// Equity needed to call an even all-in (no dead money): BF / (1 + BF).
export const requiredEquity = (bf) => bf / (1 + bf);
// Risk premium = that minus the 50% a chip-EV player needs.
export const riskPremium = (bf) => requiredEquity(bf) - 0.5;

// The hero (index 0) against every other player.
export function scenarioReport(stacks, payouts) {
  const eq = icmAfter(stacks, payouts);
  const pool = payouts.slice(0, stacks.length).reduce((a, b) => a + b, 0);
  const chips = stacks.reduce((a, b) => a + b, 0);
  const vs = stacks.map((s, i) => (i === 0 ? null : { i, stack: s, bf: bubbleFactor(stacks, payouts, 0, i) })).filter(Boolean);
  const bf = vs.length ? vs.reduce((a, x) => a + x.bf, 0) / vs.length : 1;
  return { eq, pool, chips, vs, bf };
}

// Typical spots for each "field left" choice, all stacks equal.
// The early stages are far from the money: ICM barely matters there, so a
// small fixed factor stands in for a full-field computation.
export const STAGE_SCENARIOS = {
  100: { label: 'Loin des places payées : les jetons valent quasiment leur valeur en chips.', bf: 1 },
  50: { label: 'Encore loin de l\'argent : légère prudence (facteur estimé).', bf: 1.03 },
  25: { label: 'L\'argent approche : un peu plus de prudence (facteur estimé).', bf: 1.08 },
  10: { label: 'Proche de la bulle d\'un gros field : facteur estimé. Pour ton cas exact, entre ta table dans « Ma table ».', bf: 1.5 },
  semi: { label: 'Demi-finale : 12 joueurs, tous payés.', players: 12, payouts: [22, 15, 11, 9, 8, 7, 6, 5.5, 5, 3.8, 3.8, 3.8] },
  ft: { label: 'Table finale : 6 joueurs.', players: 6, payouts: [32, 22, 16, 12, 10, 8] },
  hu: { label: 'Heads-up : 2 joueurs, l\'ICM ne change rien (BF = 1).', players: 2, payouts: [60, 40] },
};

const cache = {};
export function stageBubbleFactor(stage = '100') {
  const sc = STAGE_SCENARIOS[stage] || STAGE_SCENARIOS[100];
  if (sc.bf) return sc.bf;
  if (!(stage in cache)) cache[stage] = scenarioReport(new Array(sc.players).fill(20), sc.payouts).bf;
  return cache[stage];
}
