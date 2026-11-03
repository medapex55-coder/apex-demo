// Runs the solver off the page: { id, root, ranges, target, maxIters } in,
// progress messages and the solution out.
import { solve } from './solver.js';

self.onmessage = (e) => {
  const { id, root, ranges, target, maxIters } = e.data;
  try {
    const t0 = Date.now();
    const res = solve(root, ranges, {
      target, maxIters,
      onProgress: (iterations, exploitability) => self.postMessage({ id, type: 'progress', iterations, exploitability }),
    });
    self.postMessage({ id, type: 'done', ...res, ms: Date.now() - t0 });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err.message || err) });
  }
};
