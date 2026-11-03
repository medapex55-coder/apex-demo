// Postflop solver: Discounted CFR (Brown & Sandholm 2019) on the heads-up
// subgame that starts at a postflop state, with the engine's own bet tree
// (legalActions / applyAction), so every solved node has the same key as the
// Study node it replaces. The ranges come from the tree above (the user's
// charts preflop). Values are in bb, relative to the subgame's start: what a
// player gets back from the pot minus what they put in after the start.
// Pure module: runs in a Web Worker (solver-worker.js) as well as in a page.
import { COMBOS } from './cards.js';
import { evalHand } from './evaluator.js';
import { legalActions, applyAction, stateKey, actionKey, alive, pot } from './game.js';

const N = 1326;

// Card removal sums: for weights w over combos, total and per-card sums let
// "weight of the combos that share no card with combo i" be computed in O(1).
function cardSums(w) {
  const card = new Float64Array(52);
  let total = 0;
  for (let i = 0; i < N; i++) {
    const x = w[i];
    if (!x) continue;
    total += x;
    card[COMBOS[i][0]] += x; card[COMBOS[i][1]] += x;
  }
  return { total, card };
}
const free = (s, w, i) => s.total - s.card[COMBOS[i][0]] - s.card[COMBOS[i][1]] + w[i];

// River showdown order: the live combos sorted by hand value.
function showdownOrder(board, live) {
  const val = new Int32Array(N);
  const ids = [];
  for (let i = 0; i < N; i++) if (live[i]) { val[i] = evalHand(COMBOS[i][0], COMBOS[i][1], board); ids.push(i); }
  ids.sort((a, b) => val[a] - val[b]);
  return { val, ids };
}

// For each combo of one player: opponent weight it beats and it loses to,
// counting only combos that share no card with it.
function winLose(order, w, outWin, outLose) {
  const { val, ids } = order;
  const card = new Float64Array(52);
  let tot = 0;
  for (let a = 0; a < ids.length;) {
    let b = a;
    while (b < ids.length && val[ids[b]] === val[ids[a]]) b++;
    for (let k = a; k < b; k++) { const i = ids[k]; outWin[i] = tot - card[COMBOS[i][0]] - card[COMBOS[i][1]]; }
    for (let k = a; k < b; k++) { const i = ids[k], x = w[i]; tot += x; card[COMBOS[i][0]] += x; card[COMBOS[i][1]] += x; }
    a = b;
  }
  card.fill(0); tot = 0;
  for (let b = ids.length; b > 0;) {
    let a = b - 1;
    while (a > 0 && val[ids[a - 1]] === val[ids[b - 1]]) a--;
    for (let k = a; k < b; k++) { const i = ids[k]; outLose[i] = tot - card[COMBOS[i][0]] - card[COMBOS[i][1]]; }
    for (let k = a; k < b; k++) { const i = ids[k], x = w[i]; tot += x; card[COMBOS[i][0]] += x; card[COMBOS[i][1]] += x; }
    b = a;
  }
}

// The game tree from a state, with the engine's actions. players: [first, second] seats.
function buildTree(st, players, inv0, stats) {
  if (st.terminal) {
    const put = players.map((p) => st.invested[p] - inv0[p]);
    stats.terminals++;
    if (st.terminal === 'fold') return { kind: 'fold', win: players.indexOf(st.winner), put, pot: pot(st) };
    return { kind: 'show', put, pot: pot(st) };
  }
  if (st.toAct < 0 || st.needBoard) {
    // All-in before the river: not a river subgame (the turn solver deals cards).
    if (st.street === 3) return buildTree({ ...st, terminal: 'showdown' }, players, inv0, stats);
    throw new Error('river subgame only');
  }
  const actions = legalActions(st);
  const node = {
    kind: 'act', p: players.indexOf(st.toAct), key: stateKey(st), actions,
    put: players.map((p) => st.invested[p] - inv0[p]),
    children: actions.map((a) => buildTree(applyAction(st, a), players, inv0, stats)),
    regret: null, sum: null,
  };
  node.regret = new Float64Array(actions.length * N);
  node.sum = new Float64Array(actions.length * N);
  stats.nodes++;
  return node;
}

// Current strategy from positive regrets (uniform when none).
function strategy(node, live, out) {
  const n = node.actions.length;
  for (let i = 0; i < N; i++) {
    if (!live[i]) continue;
    let s = 0;
    for (let k = 0; k < n; k++) { const r = node.regret[k * N + i]; if (r > 0) s += r; }
    for (let k = 0; k < n; k++) { const r = node.regret[k * N + i]; out[k * N + i] = s > 0 ? (r > 0 ? r / s : 0) : 1 / n; }
  }
  return out;
}
function average(node, live, out) {
  const n = node.actions.length;
  for (let i = 0; i < N; i++) {
    if (!live[i]) continue;
    let s = 0;
    for (let k = 0; k < n; k++) s += node.sum[k * N + i];
    for (let k = 0; k < n; k++) out[k * N + i] = s > 0 ? node.sum[k * N + i] / s : 1 / n;
  }
  return out;
}

export function createSolver(root, ranges, opts = {}) {
  if (root.street !== 3) throw new Error('river subgame only');
  const players = [root.toAct, alive(root).find((p) => p !== root.toAct)];
  if (alive(root).length !== 2) throw new Error('heads-up only');
  const board = root.board;
  const dead = new Uint8Array(52);
  for (const c of board) dead[c] = 1;
  const live = new Uint8Array(N);
  for (let i = 0; i < N; i++) live[i] = dead[COMBOS[i][0]] || dead[COMBOS[i][1]] ? 0 : 1;
  const reach0 = players.map((p) => { const r = new Float64Array(N); for (let i = 0; i < N; i++) r[i] = live[i] ? ranges[p][i] : 0; return r; });
  const stats = { nodes: 0, terminals: 0 };
  const tree = buildTree(root, players, root.invested.slice(), stats);
  const order = showdownOrder(board, live);
  const win = new Float64Array(N), lose = new Float64Array(N);
  const pot0 = pot(root);

  // Counterfactual values of player p's combos at a terminal, given the opponent's reach.
  function terminal(node, p, opp, out) {
    if (node.kind === 'fold') {
      const s = cardSums(opp);
      const u = (node.win === p ? node.pot : 0) - node.put[p];
      for (let i = 0; i < N; i++) out[i] = live[i] ? u * free(s, opp, i) : 0;
      return out;
    }
    winLose(order, opp, win, lose);
    const s = cardSums(opp);
    const uW = node.pot - node.put[p], uL = -node.put[p], uT = node.pot / 2 - node.put[p];
    for (let i = 0; i < N; i++) {
      if (!live[i]) { out[i] = 0; continue; }
      const tie = free(s, opp, i) - win[i] - lose[i];
      out[i] = uW * win[i] + uL * lose[i] + uT * tie;
    }
    return out;
  }

  // One CFR pass for player p: returns p's counterfactual values; updates p's regrets
  // and average strategy (weighted by p's reach and the DCFR discount).
  function cfr(node, p, own, opp, t) {
    const out = new Float64Array(N);
    if (node.kind !== 'act') return terminal(node, p, opp, out);
    const n = node.actions.length;
    const sig = strategy(node, live, new Float64Array(n * N));
    if (node.p === p) {
      const vals = [];
      for (let k = 0; k < n; k++) {
        const r = new Float64Array(N);
        for (let i = 0; i < N; i++) r[i] = own[i] * sig[k * N + i];
        vals.push(cfr(node.children[k], p, r, opp, t));
      }
      for (let i = 0; i < N; i++) { let v = 0; for (let k = 0; k < n; k++) v += sig[k * N + i] * vals[k][i]; out[i] = v; }
      const pos = t ** 1.5 / (t ** 1.5 + 1), neg = 0.5, ws = (t / (t + 1)) ** 2;
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < N; i++) {
          if (!live[i]) continue;
          const j = k * N + i;
          const r = node.regret[j];
          node.regret[j] = (r > 0 ? r * pos : r * neg) + vals[k][i] - out[i];
          node.sum[j] = node.sum[j] * ws + own[i] * sig[j];
        }
      }
    } else {
      for (let k = 0; k < n; k++) {
        const r = new Float64Array(N);
        for (let i = 0; i < N; i++) r[i] = opp[i] * sig[k * N + i];
        const v = cfr(node.children[k], p, own, r, t);
        for (let i = 0; i < N; i++) out[i] += v[i];
      }
    }
    return out;
  }

  // Values with the average strategies; best: p plays a best response instead.
  // record: store per-action values at p's nodes (for EVs).
  function evaluate(node, p, opp, best, record) {
    const out = new Float64Array(N);
    if (node.kind !== 'act') return terminal(node, p, opp, out);
    const n = node.actions.length;
    const avg = average(node, live, new Float64Array(n * N));
    if (node.p === p) {
      const vals = node.children.map((c) => evaluate(c, p, opp, best, record));
      for (let i = 0; i < N; i++) {
        let v = best ? -Infinity : 0;
        for (let k = 0; k < n; k++) v = best ? Math.max(v, vals[k][i]) : v + avg[k * N + i] * vals[k][i];
        out[i] = live[i] ? v : 0;
      }
      if (record) {
        const s = cardSums(opp);
        node.ev = vals.map((v) => {
          const e = new Float32Array(N);
          for (let i = 0; i < N; i++) { const m = live[i] ? free(s, opp, i) : 0; e[i] = m > 1e-9 ? v[i] / m + node.put[p] : 0; }
          return e;
        });
      }
    } else {
      for (let k = 0; k < n; k++) {
        const r = new Float64Array(N);
        for (let i = 0; i < N; i++) r[i] = opp[i] * avg[k * N + i];
        const v = evaluate(node.children[k], p, r, best, record);
        for (let i = 0; i < N; i++) out[i] += v[i];
      }
    }
    return out;
  }

  // Weight of all (combo, combo) pairs that share no card: the normaliser of range values.
  const pairs = (() => { const s = cardSums(reach0[1]); let x = 0; for (let i = 0; i < N; i++) if (reach0[0][i]) x += reach0[0][i] * free(s, reach0[1], i); return x; })();
  const rangeValue = (p, cfv) => { let x = 0; for (let i = 0; i < N; i++) x += reach0[p][i] * cfv[i]; return x / pairs; };

  let t = 0;
  return {
    stats, players, pot0,
    // Run more iterations (alternating updates).
    run(iters) {
      for (let k = 0; k < iters; k++) {
        t++;
        cfr(tree, 0, reach0[0], reach0[1], t);
        cfr(tree, 1, reach0[1], reach0[0], t);
      }
      return t;
    },
    get iterations() { return t; },
    // Exploitability of the average strategies, in % of the pot at the start:
    // how much a perfect opponent would win on average against them.
    exploitability() {
      const br0 = rangeValue(0, evaluate(tree, 0, reach0[1], true, false));
      const br1 = rangeValue(1, evaluate(tree, 1, reach0[0], true, false));
      return Math.max(0, (br0 + br1 - pot0) / 2) / pot0 * 100;
    },
    // The solution: for every decision node, its key, the actions, the average
    // strategy and the EV (bb, from that node on) of each action per combo.
    result() {
      evaluate(tree, 0, reach0[1], false, true);
      evaluate(tree, 1, reach0[0], false, true);
      const nodes = [];
      (function walk(node) {
        if (node.kind !== 'act') return;
        const n = node.actions.length;
        const avg = average(node, live, new Float64Array(n * N));
        nodes.push({
          key: node.key, actions: node.actions.map(actionKey),
          freqs: node.actions.map((_, k) => Float32Array.from(avg.subarray(k * N, (k + 1) * N))),
          evs: node.ev,
        });
        node.children.forEach(walk);
      })(tree);
      return nodes;
    },
  };
}

// Solve until the exploitability is below target (% of the pot) or the
// iteration budget runs out. onProgress(iterations, exploitability).
export function solve(root, ranges, { target = 0.3, maxIters = 1000, every = 25, onProgress } = {}) {
  const s = createSolver(root, ranges);
  let expl = Infinity;
  while (s.iterations < maxIters) {
    s.run(every);
    expl = s.exploitability();
    onProgress?.(s.iterations, expl);
    if (expl <= target) break;
  }
  return { nodes: s.result(), exploitability: expl, iterations: s.iterations, tree: s.stats };
}
