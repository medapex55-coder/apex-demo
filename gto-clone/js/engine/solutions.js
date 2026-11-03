// Solved nodes from the solver, by state key: { actions, freqs, evs, meta }.
// analyze() uses them in place of the model, so Study, Practice and the
// ranges further down the tree all follow the solution. They last for the
// session (a solve takes seconds and depends on the ranges above it).
const solved = new Map();
const listeners = new Set();

export const solutionAt = (key) => solved.get(key) || null;

// res: the solver's output ({ nodes, exploitability, iterations, ms }).
export function addSolution(res, street) {
  const meta = { street, exploitability: res.exploitability, iterations: res.iterations, ms: res.ms };
  for (const n of res.nodes) solved.set(n.key, { ...n, meta });
  for (const f of listeners) f();
}

export const onSolution = (f) => listeners.add(f);
