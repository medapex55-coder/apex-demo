// A river worker of the parallel solver: it owns some river cards of every
// chance node of a turn tree and runs CFR on those rivers when the
// coordinator (solver-parallel.js) sends the reaches at each chance node.
// In:  init { root, ranges, cards }            build the rivers
//      cfr  { p, t, reach: [[own, opp], ...] } one pass, per chance node
//      eval { p, best, reach: [opp, ...] }      values with the average strategies
//      path { index, card, key, reach: [r0, r1] } solved nodes down to key
// Out: { id, values: [Float64Array, ...] } or { id, nodes } or { id, error }.
import { setup, buildTree, makeKernel } from './solver.js';

let chances = null, K = null;

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const { ctx, ix0 } = setup(m.root, m.ranges, { cards: new Set(m.cards), flop: m.flop });
      // The coordinator's chance nodes, in the same order (same tree, same build).
      const top = setup(m.root, m.ranges, { stopAtChance: true, flop: m.flop });
      buildTree(m.root, top.ctx, top.ix0);
      chances = top.ctx.chances.map((c) => buildTree(c.state, ctx, ix0));
      K = makeKernel(ctx);
      self.postMessage({ id: m.id, stats: ctx.stats });
    } else if (m.type === 'cfr') {
      const values = chances.map((c, j) => Float64Array.from(K.cfr(c, m.p, m.reach[j][0], m.reach[j][1], m.t, 0)));
      self.postMessage({ id: m.id, values }, values.map((v) => v.buffer));
    } else if (m.type === 'eval') {
      // Only the chance nodes below the evaluated node get a reach.
      const values = chances.map((c, j) => (m.reach[j] ? Float64Array.from(K.evaluate(c, m.p, m.reach[j], m.best, 0)) : null));
      self.postMessage({ id: m.id, values }, values.filter(Boolean).map((v) => v.buffer));
    } else if (m.type === 'path') {
      const c = chances[m.index];
      const kid = c.kids.find((k) => k.card === m.card);
      if (!kid) throw new Error('no such river');
      K.cutCard(m.reach, m.card);
      self.postMessage({ id: m.id, nodes: K.pathFrom(kid.node, m.key, m.reach).nodes });
    }
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err.message || err) });
  }
};