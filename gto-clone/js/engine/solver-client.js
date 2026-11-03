// The solver worker with promises, for pages that solve several streets in
// a row (hand analysis): solve a street, then fetch its solved nodes by key.
export function solverClient() {
  const worker = new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'module' });
  let next = 1;
  const waiting = new Map();
  worker.onmessage = (e) => {
    const m = e.data, w = waiting.get(m.id);
    if (!w) return;
    if (m.type === 'progress') { w.progress?.(m); return; }
    waiting.delete(m.id);
    if (m.type === 'error') w.reject(new Error(m.message)); else w.resolve(m);
  };
  const call = (msg, progress) => {
    const id = next++;
    const promise = new Promise((resolve, reject) => waiting.set(id, { resolve, reject, progress }));
    worker.postMessage({ ...msg, id });
    return { id, promise };
  };
  return {
    // Resolves with { solveId, exploitability, iterations, ms } once the worker holds the solution.
    async solve(root, ranges, opts, progress) {
      const { id, promise } = call({ type: 'solve', root, ranges, ...opts }, progress);
      return { solveId: id, ...(await promise) };
    },
    // The solved nodes from the street's start down to key.
    async path(solveId, key) { return (await call({ type: 'path', solveId, key }).promise).nodes; },
    close() {
      worker.terminate();
      for (const w of waiting.values()) w.reject(new Error('arrêté'));
      waiting.clear();
    },
  };
}
