// Study's solver panel: solve a heads-up postflop street (river; turn with
// every river; flop with simplified turns) in Web Workers, show the progress, then the solution's
// quality. The worker keeps the solution; Study loads its nodes on demand
// through the provider registered in engine/solutions.js.
import { h, num } from './dom.js';
import { replay, alive, stateKey } from '../engine/game.js';
import { rangesOf } from '../engine/strategy.js';
import { addNodes, setProvider } from '../engine/solutions.js';

const fr = (x, d) => num(x, d).replace('.', ',');
// Solve settings per street. The river is solved in seconds; the turn deals
// every river and stops at its target or its time limit (the exploitability,
// a full best response, is measured every 20 s there). The flop plays its
// turns in a simplified way (one 2/3-pot bet and all-in) and checks the
// river down: only its flop nodes are kept, the turn is solved afterwards.
export const SETTINGS = {
  3: { name: 'la river', start: 'de la river', target: 0.3, maxIters: 1500, every: 25, time: 'quelques secondes' },
  2: { name: 'la turn', start: 'de la turn', target: 0.5, maxIters: 100000, every: 5, timeLimit: 180000, checkEvery: 20000, time: '1 à 3 minutes' },
  1: { name: 'le flop', start: 'du flop', target: 1, maxIters: 100000, every: 5, timeLimit: 240000, checkEvery: 30000, time: '2 à 4 minutes' },
};
const FROM = { 1: 'le flop', 2: 'la turn', 3: 'la river' };
let worker = null;
let job = null; // { id, key, iterations, exploitability, ms }
let nextId = 1;
const waiting = new Map(); // request id -> { resolve, reject }
let rerender = () => {};

// The state at the start of the street (right after its card), where a solve starts.
function streetRoot(st) {
  let k = st.history.length - 1;
  while (k >= 0 && st.history[k].kind !== 'deal') k--;
  return replay(st.history.slice(0, k + 1), st.cfg);
}

const solvable = (st) => SETTINGS[st.street] && alive(st).length === 2;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../engine/solver-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (waiting.has(m.id)) {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.type === 'path') w.resolve(m.nodes); else w.reject(new Error(m.message));
      return;
    }
    if (!job || m.id !== job.id) return;
    if (m.type === 'progress') { Object.assign(job, { iterations: m.iterations, exploitability: m.exploitability, ms: m.ms }); rerender(); }
    else if (m.type === 'done') done(job, m);
    else { job.error = m.message; rerender(); }
  };
  return worker;
}

// The solve is over: the worker holds the solution; register how to fetch it.
function done(j, m) {
  const meta = { street: j.street, exploitability: m.exploitability, iterations: m.iterations, ms: m.ms };
  const inflight = new Map();
  const provider = {
    prefix: j.key, meta, missing: new Set(),
    fetch(key) {
      if (inflight.has(key)) return inflight.get(key);
      const id = nextId++;
      const p = new Promise((resolve, reject) => waiting.set(id, { resolve, reject }))
        .then((nodes) => {
          if (!nodes.some((n) => n.key === key)) provider.missing.add(key);
          addNodes(nodes, meta);
        })
        .catch(() => { setProvider(null); })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      worker.postMessage({ type: 'path', id, solveId: j.id, key });
      return p;
    },
  };
  job = null;
  setProvider(provider);
  // Load the street's first node right away, then show it.
  provider.fetch(j.key).then(() => rerender());
}

function start(root) {
  const { name, start: _s, time, ...opts } = SETTINGS[root.street];
  setProvider(null); // the worker drops its previous solution
  const id = nextId++;
  job = { id, key: stateKey(root), street: root.street, iterations: 0, exploitability: null, ms: 0 };
  getWorker().postMessage({ type: 'solve', id, root, ranges: rangesOf(root), ...opts });
  rerender();
}

function stop() {
  worker?.terminate();
  worker = null;
  for (const w of waiting.values()) w.reject(new Error('stopped'));
  waiting.clear();
  job = null;
  setProvider(null);
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
      h('p.small', h('strong', `Stratégie résolue (CFR, depuis ${FROM[m.street]}).`), ' Équilibre calculé pour les ranges qui arrivent ici, issues de tes charts au preflop. Les EV affichées sont celles de la solution.'),
      m.street === 1 ? h('p.small.muted', 'Au flop, la suite est simplifiée pour tenir dans le navigateur : à la turn une seule taille (2/3 du pot) et le tapis, la river jouée jusqu\'à l\'abattage. Pour la turn exacte, résous-la une fois arrivé dessus.') : null,
      h('p.small.muted', `Exploitabilité ${fr(m.exploitability, 2)} % du pot · ${m.iterations} itérations · ${fr(m.ms / 1000, 1)} s`));
  }
  if (!solvable(st)) {
    return h('section.panel.solver-panel', { 'aria-label': 'Solver' }, title,
      h('p.small.muted', 'Le solver travaille en heads-up : ce pot multiway reste sur le modèle Spotwise (approximation, pas un calcul d\'équilibre).'));
  }
  const root = streetRoot(st);
  const key = stateKey(root);
  const s = SETTINGS[root.street];
  if (job && job.key === key) {
    const ex = Number.isFinite(job.exploitability) ? ` · exploitabilité ${fr(job.exploitability, 2)} % du pot` : '';
    return h('section.panel.solver-panel', { 'aria-label': 'Solver', 'aria-busy': 'true' }, title,
      job.error ? h('p.small.neg', 'Le calcul a échoué : ' + job.error)
        : h('p.small', h('span.spinner.sm'), ` Calcul de l'équilibre… ${job.iterations} itérations · ${Math.round(job.ms / 1000)} s${ex}`),
      h('button.btn.ghost.sm', { type: 'button', on: { click: stop } }, 'Arrêter'));
  }
  return h('section.panel.solver-panel', { 'aria-label': 'Solver' }, title,
    h('p.small.muted', `Cette street suit le modèle Spotwise. Le solver calcule l'équilibre (CFR) depuis le début ${s.start}${root.street === 2 ? ', toutes les rivers comprises' : ''}, avec les ranges qui arrivent ici (tes charts au preflop) et les tailles de mise de l'arbre. Durée : ${s.time}.`),
    root.street === 1 ? h('p.small.muted', 'Au flop, la turn est jouée simplement (2/3 du pot ou tapis) et la river jusqu\'à l\'abattage : un arbre complet ne tiendrait pas dans le navigateur.') : null,
    job ? h('p.small.muted', 'Un autre calcul est en cours.') : null,
    h('button.btn.primary.sm', { type: 'button', disabled: !!job, on: { click: () => start(root) } }, `Résoudre ${s.name}`));
}
