// Parallel turn solver: the coordinator keeps the turn's decisions; river
// workers (solver-sub.js) each own some river cards of every chance node.
// An iteration for player p: a forward pass gives the reaches at each chance
// node (the turn strategies don't change until the pass updates them, after
// their subtrees), the workers run CFR on their rivers at the same time, and
// the turn nodes are updated with the summed values (kernel chance nodes
// return node.ext). Same results as the single-thread solver, several times
// faster on a multi-core machine.
import { setup, buildTree, makeKernel, pairWeight } from './solver.js';
import { actionKey, dealBoard, stateKey } from './game.js';

const N = 1326;

// A worker with request / response by id.
function rpc(worker) {
  let next = 1;
  const waiting = new Map();
  worker.onmessage = (e) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data);
  };
  return {
    call(msg) {
      const id = next++;
      return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); worker.postMessage({ ...msg, id }); });
    },
    close: () => worker.terminate(),
  };
}

export async function createParallelSolver(root, ranges, workers) {
  const { reach0, ix0, ctx, pot0, players } = setup(root, ranges, { stopAtChance: true });
  const tree = buildTree(root, ctx, ix0);
  const K = makeKernel(ctx);
  const chances = ctx.chances;
  const cards = [];
  for (let c = 0; c < 52; c++) if (!root.board.includes(c)) cards.push(c);
  const W = Math.max(1, Math.min(workers, cards.length));
  const subs = Array.from({ length: W }, () => rpc(new Worker(new URL('./solver-sub.js', import.meta.url), { type: 'module' })));
  const owner = new Map(cards.map((c, k) => [c, k % W]));
  const inits = await Promise.all(subs.map((s, w) => s.call({ type: 'init', root, ranges, cards: cards.filter((_, k) => k % W === w) })));
  const stats = { ...ctx.stats, workers: W, nodes: ctx.stats.nodes + inits.reduce((a, r) => a + r.stats.nodes, 0) };
  const pairs = pairWeight(reach0, ix0);
  const rangeValue = (p, cfv) => { let x = 0; for (const i of ix0[p]) x += reach0[p][i] * cfv[i]; return x / pairs; };

  // Reaches at the chance nodes below node (avg: average strategies, else current ones).
  function collect(node, p, own, opp, avg, list) {
    if (node.kind === 'chance') { list[node.index] = [Float64Array.from(own), Float64Array.from(opp)]; return; }
    if (node.kind !== 'act') return;
    const n = node.actions.length;
    const sig = (avg ? K.average : K.current)(node, new Float64Array(n * N));
    const q = node.p, ix = node.ix[q];
    node.children.forEach((c, k) => {
      const r = new Float64Array(N);
      const from = q === p ? own : opp;
      for (let j = 0; j < ix.length; j++) { const i = ix[j]; r[i] = from[i] * sig[k * N + i]; }
      if (q === p) collect(c, p, r, opp, avg, list); else collect(c, p, own, r, avg, list);
    });
  }
  // Workers' values summed per chance node, set as node.ext.
  async function fill(msg) {
    const res = await Promise.all(subs.map((s) => s.call(msg)));
    chances.forEach((c, j) => {
      if (!res[0].values[j]) return;
      const ext = new Float64Array(N);
      for (const r of res) { const v = r.values[j]; for (let i = 0; i < N; i++) ext[i] += v[i]; }
      c.ext = ext;
    });
  }
  const clear = () => { for (const c of chances) c.ext = null; };

  async function pass(p, t) {
    const list = [];
    collect(tree, p, reach0[p], reach0[1 - p], false, list);
    await fill({ type: 'cfr', p, t, reach: list });
    K.cfr(tree, p, reach0[p], reach0[1 - p], t, 0);
    clear();
  }
  // Player p's values below node with the average strategies (or a best response).
  async function evaluate(node, p, opp, best) {
    const list = [];
    collect(node, p, opp, opp, true, list);
    if (list.length) await fill({ type: 'eval', p, best, reach: chances.map((_, j) => list[j]?.[1] || null) });
    const v = Float64Array.from(K.evaluate(node, p, opp, best, 0));
    clear();
    return v;
  }

  let t = 0;
  return {
    stats, players, pot0,
    async run(iters) {
      for (let k = 0; k < iters; k++) { t++; await pass(0, t); await pass(1, t); }
      return t;
    },
    get iterations() { return t; },
    async exploitability() {
      const br0 = rangeValue(0, await evaluate(tree, 0, reach0[1], true));
      const br1 = rangeValue(1, await evaluate(tree, 1, reach0[0], true));
      return Math.max(0, (br0 + br1 - pot0) / 2) / pot0 * 100;
    },
    // The solved nodes from the start down to key: turn nodes here, river
    // nodes from the worker that owns the river card.
    async path(key) {
      const out = [];
      const reach = reach0.map((r) => r.slice());
      let node = tree;
      while (node.kind === 'act') {
        const st = K.stepOf(node, reach, []);
        const evs = [];
        for (const c of node.children) evs.push(K.evOf(node, st, await evaluate(c, st.q, st.opp, false)));
        out.push({ key: node.key, actions: node.actions.map(actionKey), freqs: st.freqs, evs });
        if (node.key === key) return out;
        const k = node.children.findIndex((c) => K.leads(key, c));
        if (k < 0) return out;
        for (const i of node.ix[st.q]) reach[st.q][i] *= st.freqs[k][i];
        node = node.children[k];
      }
      if (node.kind === 'chance') {
        const card = cards.find((c) => K.leads(key, { key: stateKey(dealBoard(node.state, [c])) }));
        if (card == null) return out;
        const r = await subs[owner.get(card)].call({ type: 'path', index: node.index, card, key, reach });
        out.push(...r.nodes);
      }
      return out;
    },
    result() { throw new Error('parallel solver: use path'); },
    close() { for (const s of subs) s.close(); },
  };
}
