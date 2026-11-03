// Study's solver panel: solve the current street of a heads-up postflop spot
// (the river for now) in a Web Worker, show the progress, then the solution's
// quality. The solution replaces the model through engine/solutions.js.
import { h, num } from './dom.js';
import { replay, alive, stateKey } from '../engine/game.js';
import { rangesOf } from '../engine/strategy.js';
import { addSolution } from '../engine/solutions.js';

const TARGET = 0.3; // stop below 0.3% of the pot
const fr = (x, d) => num(x, d).replace('.', ',');
const MAX_ITERS = 1500;
let worker = null;
let job = null; // { id, key, iterations, exploitability }
let nextId = 1;
let rerender = () => {};

// The state at the start of the street (right after its card), where a solve starts.
function streetRoot(st) {
  let k = st.history.length - 1;
  while (k >= 0 && st.history[k].kind !== 'deal') k--;
  return replay(st.history.slice(0, k + 1), st.cfg);
}

const solvable = (st) => st.street === 3 && alive(st).length === 2;

function start(root) {
  worker ??= new Worker(new URL('../engine/solver-worker.js', import.meta.url), { type: 'module' });
  const id = nextId++;
  job = { id, key: stateKey(root), iterations: 0, exploitability: null };
  worker.onmessage = (e) => {
    const m = e.data;
    if (!job || m.id !== job.id) return;
    if (m.type === 'progress') { job.iterations = m.iterations; job.exploitability = m.exploitability; rerender(); }
    else if (m.type === 'done') { job = null; addSolution(m, root.street); rerender(); }
    else { job = { ...job, error: m.message }; rerender(); }
  };
  worker.postMessage({ id, root, ranges: rangesOf(root), target: TARGET, maxIters: MAX_ITERS });
  rerender();
}

function stop() {
  worker?.terminate();
  worker = null;
  job = null;
  rerender();
}

export function solverPanel(node, onChange) {
  rerender = onChange;
  const st = node.st;
  if (st.street === 0) return null;
  const title = h('div.panel-title', 'Solver');
  if (node.solved) {
    const m = node.solved;
    return h('section.panel.solver-panel.solved', { 'aria-label': 'Solver' }, title,
      h('p.small', h('strong', 'Stratégie résolue (CFR).'), ` Équilibre calculé pour les ranges qui arrivent ici, issues de tes charts au preflop. Les EV affichées sont celles de la solution.`),
      h('p.small.muted', `Exploitabilité ${fr(m.exploitability, 2)} % du pot · ${m.iterations} itérations · ${fr(m.ms / 1000, 1)} s`));
  }
  if (!solvable(st)) {
    const why = alive(st).length > 2 ? 'Le solver travaille en heads-up : ce pot multiway reste sur le modèle Spotwise.'
      : 'Le solver de flop et de turn arrive bientôt : pour l\'instant, cette street suit le modèle Spotwise (approximation, pas un calcul d\'équilibre).';
    return h('section.panel.solver-panel', { 'aria-label': 'Solver' }, title, h('p.small.muted', why));
  }
  const root = streetRoot(st);
  const key = stateKey(root);
  if (job && job.key === key) {
    return h('section.panel.solver-panel', { 'aria-label': 'Solver', 'aria-busy': 'true' }, title,
      job.error ? h('p.small.neg', 'Le calcul a échoué : ' + job.error)
        : h('p.small', h('span.spinner.sm'), ` Calcul de l'équilibre… ${job.iterations} itérations`,
          job.exploitability != null ? ` · exploitabilité ${fr(job.exploitability, 2)} % du pot` : ''),
      h('button.btn.ghost.sm', { type: 'button', on: { click: stop } }, 'Arrêter'));
  }
  return h('section.panel.solver-panel', { 'aria-label': 'Solver' }, title,
    h('p.small.muted', 'Cette river suit le modèle Spotwise. Le solver calcule l\'équilibre (CFR) pour cette river, avec les ranges qui arrivent ici (tes charts au preflop) et les tailles de mise de l\'arbre. Quelques secondes.'),
    job ? h('p.small.muted', 'Un autre calcul est en cours.') : null,
    h('button.btn.primary.sm', { type: 'button', disabled: !!job, on: { click: () => start(root) } }, 'Résoudre la river'));
}
