// Solved nodes from the solver, by state key: { actions, freqs, evs, meta }.
// analyze() uses them in place of the model, so Study, Practice and the
// ranges further down the tree all follow the solution. They last for the
// session (a solve takes seconds to minutes and depends on the ranges above it).
// A big solution (a turn) stays in the solver's worker: its provider fetches
// the nodes on the way to a state when Study opens it.
const solved = new Map();
const listeners = new Set();
let provider = null; // { prefix, meta, fetch(key) -> Promise }

export const solutionAt = (key) => solved.get(key) || null;

export function addNodes(nodes, meta) {
  for (const n of nodes) solved.set(n.key, { ...n, meta });
  for (const f of listeners) f();
}
// res: a solver result with every node ({ nodes, exploitability, iterations, ms }).
export const addSolution = (res, street) => addNodes(res.nodes, { street, exploitability: res.exploitability, iterations: res.iterations, ms: res.ms });

export const onSolution = (f) => listeners.add(f);

export const setProvider = (p) => { provider = p; };
// The provider that can fill this state's node, when it isn't loaded yet.
export function pendingAt(key) {
  if (!provider || solved.has(key) || provider.missing.has(key)) return null;
  return key === provider.prefix || key.startsWith(provider.prefix + '|') ? provider : null;
}
