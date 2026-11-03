// Runs the solver off the page and keeps the last solution here, where the
// page fetches its nodes on demand (a turn solution is far too big to send).
// A turn is solved in parallel: river workers, one per spare core.
// In:  { type: 'solve', id, root, ranges, ...solve options }
//      { type: 'path', id, solveId, key }  the solved nodes from the start down to key
// Out: progress, done (no nodes), path (nodes), error.
import { createSolver, solveWith } from './solver.js';
import { createParallelSolver } from './solver-parallel.js';

let current = null; // { id, solver, cache: Map key -> nodes }

self.onmessage = async (e) => {
  const { type, id } = e.data;
  try {
    if (type === 'solve') {
      const { root, ranges, ...opts } = e.data;
      current?.solver.close?.();
      current = null;
      const t0 = Date.now();
      const cores = Math.max(1, (self.navigator?.hardwareConcurrency || 2) - 1);
      // Flop: simplified turns (absTurn). Turn and flop run on several workers.
      const flop = root.street === 1;
      const solver = root.street <= 2 && cores > 1 ? await createParallelSolver(root, ranges, Math.min(cores, 8), { flop }) : createSolver(root, ranges, { flop });
      const res = await solveWith(solver, {
        ...opts, keep: true,
        onProgress: (iterations, exploitability, ms) => self.postMessage({ id, type: 'progress', iterations, exploitability, ms }),
      });
      current = { id, solver, cache: new Map() };
      self.postMessage({ id, type: 'done', exploitability: res.exploitability, iterations: res.iterations, tree: res.tree, ms: Date.now() - t0 });
    } else if (type === 'path') {
      if (!current || current.id !== e.data.solveId) throw new Error('solution gone');
      const { key } = e.data;
      let nodes = current.cache.get(key);
      if (!nodes) {
        nodes = await current.solver.path(key);
        current.cache.set(key, nodes);
      }
      self.postMessage({ id, type: 'path', nodes });
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err.message || err) });
  }
};
