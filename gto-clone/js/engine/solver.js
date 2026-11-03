// Postflop solver: Discounted CFR (Brown & Sandholm 2019) on the heads-up
// subgame that starts at a postflop state, with the engine's own bet tree
// (legalActions / applyAction), so every solved node has the same key as the
// Study node it replaces. The ranges come from the tree above (the user's
// charts preflop). From the turn, every river card is dealt (a chance node).
// Values are in bb, relative to the subgame's start: what a player gets back
// from the pot minus what they put in after the start.
// Pure module: runs in a Web Worker (solver-worker.js) as well as in a page.
// Speed: no allocation while iterating (buffers per tree depth), and each
// player's loops run only over the combos in their range that the board
// leaves alive (node.ix[0], node.ix[1]).
import { COMBOS } from './cards.js';
import { evalHand } from './evaluator.js';
import { legalActions, applyAction, dealBoard, stateKey, actionKey, alive, pot } from './game.js';

const N = 1326;
const C0 = Int8Array.from(COMBOS, (c) => c[0]);
const C1 = Int8Array.from(COMBOS, (c) => c[1]);

// Card removal: the opponent's total weight and weight per card, so "weight of
// the combos that share no card with combo i" is total - card[a] - card[b] + w[i].
const CS = new Float64Array(52);
function cardSums(w, ix) {
  CS.fill(0);
  let total = 0;
  for (let j = 0; j < ix.length; j++) {
    const i = ix[j], x = w[i];
    if (!x) continue;
    total += x; CS[C0[i]] += x; CS[C1[i]] += x;
  }
  return total;
}

// Showdown order on a full board: the combos sorted by hand value, with the
// end of each group of equal value.
function showdownOrder(board, ix) {
  const val = new Int32Array(N);
  const ids = Array.from(ix);
  for (const i of ids) val[i] = evalHand(C0[i], C1[i], board);
  ids.sort((a, b) => val[a] - val[b]);
  const ends = new Int32Array(ids.length);
  for (let b = ids.length - 1; b >= 0; b--) ends[b] = b + 1 < ids.length && val[ids[b + 1]] === val[ids[b]] ? ends[b + 1] : b + 1;
  return { ids: Int16Array.from(ids), ends };
}

// For each combo: opponent weight it beats (outWin) and loses to (outLose),
// counting only combos that share no card with it.
const WC = new Float64Array(52);
function winLose(order, w, outWin, outLose) {
  const { ids, ends } = order;
  const n = ids.length;
  WC.fill(0);
  let tot = 0;
  for (let a = 0; a < n;) {
    const b = ends[a];
    for (let k = a; k < b; k++) { const i = ids[k]; outWin[i] = tot - WC[C0[i]] - WC[C1[i]]; }
    for (let k = a; k < b; k++) { const i = ids[k], x = w[i]; tot += x; WC[C0[i]] += x; WC[C1[i]] += x; }
    a = b;
  }
  WC.fill(0); tot = 0;
  let b = n;
  while (b > 0) {
    let a = b - 1;
    while (a > 0 && ends[a - 1] === b) a--;
    for (let k = a; k < b; k++) { const i = ids[k]; outLose[i] = tot - WC[C0[i]] - WC[C1[i]]; }
    for (let k = a; k < b; k++) { const i = ids[k], x = w[i]; tot += x; WC[C0[i]] += x; WC[C1[i]] += x; }
    b = a;
  }
}

const without = (ix, c) => ix.filter((i) => C0[i] !== c && C1[i] !== c);
function union(a, b) {
  const s = new Uint8Array(N);
  for (const i of a) s[i] = 1;
  for (const i of b) s[i] = 1;
  const out = [];
  for (let i = 0; i < N; i++) if (s[i]) out.push(i);
  return Int16Array.from(out);
}


// Everything a tree needs: players (seats of player 0, who acts first, and 1),
// the reaches at the start (each player's range without the board), the
// combos in each range (ix0) and the build context.
// opts.stopAtChance: chance nodes keep no children (the parallel solver's
// coordinator: workers own the rivers). opts.cards: build only these river cards.
export function setup(root, ranges, opts = {}) {
  if (root.street < 2 || root.needBoard || root.toAct < 0) throw new Error('turn or river subgame only');
  if (alive(root).length !== 2) throw new Error('heads-up only');
  const players = [root.toAct, alive(root).find((p) => p !== root.toAct)];
  const onBoard = (i) => root.board.includes(C0[i]) || root.board.includes(C1[i]);
  const reach0 = players.map((p) => { const r = new Float64Array(N); for (let i = 0; i < N; i++) if (!onBoard(i)) r[i] = ranges[p][i]; return r; });
  const ix0 = reach0.map((r) => { const a = []; for (let i = 0; i < N; i++) if (r[i] > 0) a.push(i); return Int16Array.from(a); });
  const stats = { nodes: 0, terminals: 0, chance: 0, combos: ix0.map((a) => a.length) };
  const ctx = { players, inv0: root.invested.slice(), stats, orders: new Map(), ix: new Map(), maxActions: 1, chances: [], ...opts };
  return { players, reach0, ix0, ctx, pot0: pot(root) };
}

// The game tree from a state, with the engine's actions and, before the
// river, a chance node that deals the river cards. ix: [combos of player 0, of player 1].
export function buildTree(st, ctx, ix) {
  const node = buildNode(st, ctx, ix);
  node.key = stateKey(st);
  return node;
}
function buildNode(st, ctx, ix) {
  const { players, inv0, stats } = ctx;
  if (st.terminal) {
    const put = players.map((p) => st.invested[p] - inv0[p]);
    stats.terminals++;
    if (st.terminal === 'fold') return { kind: 'fold', win: players.indexOf(st.winner), put, pot: pot(st), ix };
    const bk = st.board.join();
    if (!ctx.orders.has(bk)) ctx.orders.set(bk, showdownOrder(st.board, union(ix[0], ix[1])));
    return { kind: 'show', put, pot: pot(st), ix, order: ctx.orders.get(bk) };
  }
  if (st.needBoard) {
    if (st.needBoard !== 1 || st.street !== 3) throw new Error('turn or river subgame only');
    stats.chance++;
    // Given both hands, the river comes from the 52 - 4 board - 4 hole cards.
    const node = { kind: 'chance', kids: [], ix, share: 1 / (52 - st.board.length - 4), index: ctx.chances.length, state: st };
    ctx.chances.push(node);
    if (ctx.stopAtChance) return node;
    for (let c = 0; c < 52; c++) {
      if (st.board.includes(c) || (ctx.cards && !ctx.cards.has(c))) continue;
      const key = st.board.join() + ',' + c;
      if (!ctx.ix.has(key)) ctx.ix.set(key, [without(ix[0], c), without(ix[1], c)]);
      node.kids.push({ card: c, node: buildTree(dealBoard(st, [c]), ctx, ctx.ix.get(key)) });
    }
    return node;
  }
  const actions = legalActions(st);
  const node = {
    kind: 'act', p: players.indexOf(st.toAct), actions, ix,
    put: players.map((p) => st.invested[p] - inv0[p]),
    children: actions.map((a) => buildTree(applyAction(st, a), ctx, ix)),
    regret: new Float32Array(actions.length * N),
    sum: new Float32Array(actions.length * N),
  };
  ctx.maxActions = Math.max(ctx.maxActions, actions.length);
  stats.nodes++;
  return node;
}

// The CFR machinery on a tree built with ctx. A chance node with node.ext set
// (the parallel coordinator) returns those values instead of visiting rivers.
export function makeKernel(ctx) {
  const win = new Float64Array(N), lose = new Float64Array(N);

  // Buffers per depth of the recursion: a node at depth d writes only these.
  // Reach buffers are per player (r[q], w[q]) and only ever written at that
  // player's combos, so every other entry stays 0 for the card-removal sums.
  const F = () => new Float64Array(N);
  const pools = [];
  const pool = (d) => pools[d] ??= {
    out: F(), r: [F(), F()], w: [F(), F()], vals: Array.from({ length: ctx.maxActions }, () => new Float64Array(N)),
  };
  const sigs = [];
  const sigAt = (d) => sigs[d] ??= new Float64Array(ctx.maxActions * N);

  // Counterfactual values of player p's combos at a terminal, given the opponent's reach.
  function terminal(node, p, opp, out) {
    const mine = node.ix[p];
    const tot = cardSums(opp, node.ix[1 - p]);
    if (node.kind === 'fold') {
      const u = (node.win === p ? node.pot : 0) - node.put[p];
      for (let j = 0; j < mine.length; j++) { const i = mine[j]; out[i] = u * (tot - CS[C0[i]] - CS[C1[i]] + opp[i]); }
      return out;
    }
    winLose(node.order, opp, win, lose);
    const uW = node.pot - node.put[p], uL = -node.put[p], uT = node.pot / 2 - node.put[p];
    for (let j = 0; j < mine.length; j++) {
      const i = mine[j];
      const tie = tot - CS[C0[i]] - CS[C1[i]] + opp[i] - win[i] - lose[i];
      out[i] = uW * win[i] + uL * lose[i] + uT * tie;
    }
    return out;
  }

  // Current strategy of the acting player from positive regrets (uniform when none).
  function current(node, sig) {
    const n = node.actions.length, R = node.regret, ix = node.ix[node.p];
    for (let j = 0; j < ix.length; j++) {
      const i = ix[j];
      let s = 0;
      for (let k = 0; k < n; k++) { const r = R[k * N + i]; if (r > 0) s += r; }
      for (let k = 0; k < n; k++) { const r = R[k * N + i]; sig[k * N + i] = s > 0 ? (r > 0 ? r / s : 0) : 1 / n; }
    }
    return sig;
  }
  // Average strategy of the acting player (over all iterations, weighted).
  function average(node, sig) {
    const n = node.actions.length, S = node.sum, ix = node.ix[node.p];
    for (let j = 0; j < ix.length; j++) {
      const i = ix[j];
      let s = 0;
      for (let k = 0; k < n; k++) s += S[k * N + i];
      for (let k = 0; k < n; k++) sig[k * N + i] = s > 0 ? S[k * N + i] / s : 1 / n;
    }
    return sig;
  }

  // Chance node: each river card, with both reaches cut to the combos it leaves alive.
  function chance(node, p, d, own, opp, visit) {
    const P = pool(d), out = P.out, mine = node.ix[p], theirs = node.ix[1 - p], wo = P.w[p], wt = P.w[1 - p];
    if (node.ext) { for (let j = 0; j < mine.length; j++) { const i = mine[j]; out[i] = node.ext[i]; } return out; }
    for (let j = 0; j < mine.length; j++) out[mine[j]] = 0;
    for (const { card, node: kid } of node.kids) {
      for (let j = 0; j < mine.length; j++) { const i = mine[j]; wo[i] = C0[i] === card || C1[i] === card ? 0 : own[i]; }
      for (let j = 0; j < theirs.length; j++) { const i = theirs[j]; wt[i] = C0[i] === card || C1[i] === card ? 0 : opp[i]; }
      const v = visit(kid, d + 1, wo, wt);
      const km = kid.ix[p];
      for (let j = 0; j < km.length; j++) { const i = km[j]; out[i] += v[i] * node.share; }
    }
    return out;
  }

  // One CFR pass for player p: returns p's counterfactual values; updates p's regrets
  // and average strategy (weighted by p's reach and the DCFR discount).
  function cfr(node, p, own, opp, t, d) {
    if (node.kind === 'chance') return chance(node, p, d, own, opp, (kid, dd, o1, o2) => cfr(kid, p, o1, o2, t, dd));
    const P = pool(d), out = P.out;
    if (node.kind !== 'act') return terminal(node, p, opp, out);
    const n = node.actions.length, R = node.regret, S = node.sum, sig = current(node, sigAt(d));
    const mine = node.ix[p];
    if (node.p === p) {
      const r = P.r[p];
      for (let k = 0; k < n; k++) {
        for (let j = 0; j < mine.length; j++) { const i = mine[j]; r[i] = own[i] * sig[k * N + i]; }
        const v = cfr(node.children[k], p, r, opp, t, d + 1), vk = P.vals[k];
        for (let j = 0; j < mine.length; j++) { const i = mine[j]; vk[i] = v[i]; }
      }
      const pos = t ** 1.5 / (t ** 1.5 + 1), neg = 0.5, ws = (t / (t + 1)) ** 2;
      for (let j = 0; j < mine.length; j++) {
        const i = mine[j];
        let v = 0;
        for (let k = 0; k < n; k++) v += sig[k * N + i] * P.vals[k][i];
        out[i] = v;
        for (let k = 0; k < n; k++) {
          const q = k * N + i, x = R[q];
          R[q] = (x > 0 ? x * pos : x * neg) + P.vals[k][i] - v;
          S[q] = S[q] * ws + own[i] * sig[q];
        }
      }
    } else {
      const theirs = node.ix[1 - p], r = P.r[1 - p];
      for (let j = 0; j < mine.length; j++) out[mine[j]] = 0;
      for (let k = 0; k < n; k++) {
        for (let j = 0; j < theirs.length; j++) { const i = theirs[j]; r[i] = opp[i] * sig[k * N + i]; }
        const v = cfr(node.children[k], p, own, r, t, d + 1);
        for (let j = 0; j < mine.length; j++) { const i = mine[j]; out[i] += v[i]; }
      }
    }
    return out;
  }

  // Values with the average strategies; best: p plays a best response instead.
  function evaluate(node, p, opp, best, d) {
    if (node.kind === 'chance') return chance(node, p, d, opp, opp, (kid, dd, _o, o2) => evaluate(kid, p, o2, best, dd));
    const P = pool(d), out = P.out;
    if (node.kind !== 'act') return terminal(node, p, opp, out);
    const n = node.actions.length, sig = average(node, sigAt(d)), mine = node.ix[p];
    if (node.p === p) {
      for (let k = 0; k < n; k++) {
        const v = evaluate(node.children[k], p, opp, best, d + 1), vk = P.vals[k];
        for (let j = 0; j < mine.length; j++) { const i = mine[j]; vk[i] = v[i]; }
      }
      for (let j = 0; j < mine.length; j++) {
        const i = mine[j];
        let v = best ? -Infinity : 0;
        for (let k = 0; k < n; k++) v = best ? Math.max(v, P.vals[k][i]) : v + sig[k * N + i] * P.vals[k][i];
        out[i] = v;
      }
    } else {
      const theirs = node.ix[1 - p], r = P.r[1 - p];
      for (let j = 0; j < mine.length; j++) out[mine[j]] = 0;
      for (let k = 0; k < n; k++) {
        for (let j = 0; j < theirs.length; j++) { const i = theirs[j]; r[i] = opp[i] * sig[k * N + i]; }
        const v = evaluate(node.children[k], p, r, best, d + 1);
        for (let j = 0; j < mine.length; j++) { const i = mine[j]; out[i] += v[i]; }
      }
    }
    return out;
  }

  // One step of a solution path: the node's average strategy and, per action,
  // the EV (bb, from this node on) of each of the actor's combos. childValues(k,
  // q, opp) gives the actor's values below action k (evaluate, or the
  // parallel version).
  function stepOf(node, reach, freqsOut) {
    const q = node.p, n = node.actions.length;
    const sig = average(node, new Float64Array(n * N));
    const freqs = node.actions.map(() => new Float32Array(N).fill(1 / n));
    for (const i of node.ix[q]) for (let k = 0; k < n; k++) freqs[k][i] = sig[k * N + i];
    const opp = reach[1 - q], tot = cardSums(opp, node.ix[1 - q]);
    const mass = new Float64Array(N);
    for (const i of node.ix[q]) mass[i] = tot - CS[C0[i]] - CS[C1[i]] + opp[i];
    freqsOut.push(freqs);
    return { q, freqs, opp, mass };
  }
  const evOf = (node, step, v) => {
    const e = new Float32Array(N);
    for (const i of node.ix[step.q]) e[i] = step.mass[i] > 1e-9 ? v[i] / step.mass[i] + node.put[step.q] : 0;
    return e;
  };
  const leads = (key, node) => key === node.key || key.startsWith(node.key + '|');
  const cutCard = (reach, card) => { for (const r of reach) for (let i = 0; i < N; i++) if (C0[i] === card || C1[i] === card) r[i] = 0; };

  // The solved nodes from node down to the one with this key (reach: fresh
  // copies of both players' reaches at node). Stops at a chance node with no
  // children (returned as at, with the reaches there).
  function pathFrom(node, key, reach) {
    const out = [];
    while (node && node.kind !== 'fold' && node.kind !== 'show') {
      if (node.kind === 'chance') {
        const kid = node.kids.find((k) => leads(key, k.node));
        if (!kid) return { nodes: out, at: node, reach };
        cutCard(reach, kid.card);
        node = kid.node;
        continue;
      }
      const st = stepOf(node, reach, []);
      const evs = node.children.map((c) => evOf(node, st, evaluate(c, st.q, st.opp, false, 0)));
      out.push({ key: node.key, actions: node.actions.map(actionKey), freqs: st.freqs, evs });
      if (node.key === key) break;
      const k = node.children.findIndex((c) => leads(key, c));
      if (k < 0) break;
      for (const i of node.ix[st.q]) reach[st.q][i] *= st.freqs[k][i];
      node = node.children[k];
    }
    return { nodes: out, at: null, reach };
  }

  return { cfr, evaluate, current, average, pathFrom, stepOf, evOf, leads, cutCard, maxActions: () => ctx.maxActions };
}

// Weight of all (combo, combo) pairs that share no card: the normaliser of range values.
export function pairWeight(reach0, ix0) {
  const tot = cardSums(reach0[1], ix0[1]);
  let x = 0;
  for (const i of ix0[0]) x += reach0[0][i] * (tot - CS[C0[i]] - CS[C1[i]] + reach0[1][i]);
  return x;
}

export function createSolver(root, ranges) {
  const { players, reach0, ix0, ctx, pot0 } = setup(root, ranges);
  const tree = buildTree(root, ctx, ix0);
  const K = makeKernel(ctx);
  const pairs = pairWeight(reach0, ix0);
  const rangeValue = (p, cfv) => { let x = 0; for (const i of ix0[p]) x += reach0[p][i] * cfv[i]; return x / pairs; };

  let t = 0;
  return {
    stats: ctx.stats, players, pot0,
    // Run more iterations (alternating updates).
    run(iters) {
      for (let k = 0; k < iters; k++) {
        t++;
        K.cfr(tree, 0, reach0[0], reach0[1], t, 0);
        K.cfr(tree, 1, reach0[1], reach0[0], t, 0);
      }
      return t;
    },
    get iterations() { return t; },
    // Exploitability of the average strategies, in % of the pot at the start:
    // how much a perfect opponent would win on average against them.
    exploitability() {
      const br0 = rangeValue(0, K.evaluate(tree, 0, reach0[1], true, 0));
      const br1 = rangeValue(1, K.evaluate(tree, 1, reach0[0], true, 0));
      return Math.max(0, (br0 + br1 - pot0) / 2) / pot0 * 100;
    },
    // The solved nodes from the start down to the node with this key, with
    // the average strategy and the EV of each action per combo.
    path(key) { return K.pathFrom(tree, key, reach0.map((r) => r.slice())).nodes; },
    // Every solved node (small trees: a river).
    result() {
      const nodes = [];
      (function walk(node, reach) {
        if (node.kind === 'chance') {
          for (const kid of node.kids) { const r = reach.map((x) => x.slice()); K.cutCard(r, kid.card); walk(kid.node, r); }
          return;
        }
        if (node.kind !== 'act') return;
        const st = K.stepOf(node, reach, []);
        const evs = node.children.map((c) => K.evOf(node, st, K.evaluate(c, st.q, st.opp, false, 0)));
        nodes.push({ key: node.key, actions: node.actions.map(actionKey), freqs: st.freqs, evs });
        node.children.forEach((c, k) => {
          const r = reach.map((x) => x.slice());
          for (const i of node.ix[st.q]) r[st.q][i] *= st.freqs[k][i];
          walk(c, r);
        });
      })(tree, reach0.map((r) => r.slice()));
      return nodes;
    },
  };
}

// Solve until the exploitability is below target (% of the pot), the iteration
// budget or the time limit (ms) runs out. The exploitability (a full best
// response, about one iteration's work) is measured every checkEvery ms
// (0: after every batch). onProgress(iterations, exploitability, ms).
// keep: return the solver itself (its nodes come from solver.path) instead of every node.
// Works with createSolver or the parallel solver (async run / exploitability).
export async function solveWith(s, { target = 0.3, maxIters = 1000, every = 25, timeLimit = Infinity, checkEvery = 0, keep = false, onProgress } = {}) {
  const t0 = Date.now();
  let expl = Infinity, last = t0;
  while (s.iterations < maxIters) {
    await s.run(every);
    const now = Date.now(), over = now - t0 >= timeLimit || s.iterations >= maxIters;
    if (!checkEvery || over || now - last >= checkEvery) { expl = await s.exploitability(); last = Date.now(); }
    onProgress?.(s.iterations, expl, Date.now() - t0);
    if (expl <= target || over) break;
  }
  const done = { exploitability: expl, iterations: s.iterations, tree: s.stats };
  return keep ? { ...done, solver: s } : { ...done, nodes: await s.result() };
}

// The same, synchronous, with the single-thread solver (tests, small trees).
export function solve(root, ranges, { target = 0.3, maxIters = 1000, every = 25, timeLimit = Infinity, checkEvery = 0, keep = false, onProgress } = {}) {
  const s = createSolver(root, ranges);
  const t0 = Date.now();
  let expl = Infinity, last = t0;
  while (s.iterations < maxIters) {
    s.run(every);
    const now = Date.now(), over = now - t0 >= timeLimit || s.iterations >= maxIters;
    if (!checkEvery || over || now - last >= checkEvery) { expl = s.exploitability(); last = Date.now(); }
    onProgress?.(s.iterations, expl, Date.now() - t0);
    if (expl <= target || over) break;
  }
  const done = { exploitability: expl, iterations: s.iterations, tree: s.stats };
  return keep ? { ...done, solver: s } : { ...done, nodes: s.result() };
}
