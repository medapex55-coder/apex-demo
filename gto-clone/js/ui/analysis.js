// Hand analysis: paste a Winamax replayer link, the hand is read, replayed in
// the engine, each heads-up postflop street where the hero acts is solved
// (flop optional: it takes minutes), and every hero decision is graded and
// explained against the same strategy as Study (charts, Nash, solver, model).
import { h, mount, pct, num } from './dom.js';
import { FreqBar, PlayingCard } from './components.js';
import { POS, STREETS, actionLabel, actionRole, actionKey, pot, toCallOf, stateKey } from '../engine/game.js';
import { analyze, rangesOf, comboFreqs, comboEVs } from '../engine/strategy.js';
import { parseCard, comboIndex } from '../engine/cards.js';
import { addNodes } from '../engine/solutions.js';
import { solverClient } from '../engine/solver-client.js';
import { fetchWinamaxHand } from '../data/winamax.js';
import { replayHand } from '../data/handanalysis.js';
import { studyLink } from '../data/leaks.js';
import { gradeDecision, explain } from './practice.js';
import { SETTINGS } from './solverpanel.js';

const GRADE_TEXT = { best: 'Meilleur coup', correct: 'Correct', inaccuracy: 'Imprécision', wrong: 'Erreur', blunder: 'Grosse erreur' };
const fr = (x, d = 1) => num(x, d).replace('.', ',');
const ui = { link: '', solveFlop: true, running: false, error: null, hand: null, rep: null, progress: {}, results: null };
let root = null;
let client = null;

export function renderAnalysis(el) {
  root = el;
  render();
}

async function run() {
  if (ui.running) return;
  Object.assign(ui, { running: true, error: null, hand: null, rep: null, progress: {}, results: null });
  render();
  try {
    const hand = await fetchWinamaxHand(ui.link.trim());
    ui.hand = hand;
    const rep = replayHand(hand);
    ui.rep = rep;
    render();
    const hero = comboIndex(...hand.heroCards.map(parseCard));
    const heroSteps = rep.steps.filter((s) => s.hero);
    // Heads-up postflop streets where the hero acts: solved in order, each from
    // the ranges the previous solution leaves.
    const streets = [1, 2, 3].filter((s) => (s > 1 || ui.solveFlop) && heroSteps.some((x) => x.street === s && x.heads === 2));
    for (const s of streets) {
      const first = rep.steps.find((x) => x.street === s);
      if (!first || first.st.toAct < 0) continue;
      const { name, start, time, ...opts } = SETTINGS[s];
      ui.progress[s] = { iterations: 0, ms: 0 };
      render();
      client ??= solverClient();
      const res = await client.solve(first.st, rangesOf(first.st), opts, (m) => { ui.progress[s] = m; render(); });
      const meta = { street: s, exploitability: res.exploitability, iterations: res.iterations, ms: res.ms };
      ui.progress[s] = { ...meta, done: true };
      const next = rep.steps.find((x) => x.street > s);
      const keys = [...heroSteps.filter((x) => x.street === s).map((x) => stateKey(x.st)), ...(next ? [stateKey(next.st)] : [])];
      for (const key of keys) addNodes(await client.path(res.solveId, key), meta);
      render();
    }
    ui.results = heroSteps.map((step) => {
      const node = analyze(step.st);
      const k = node.actions.findIndex((a) => actionKey(a) === actionKey(step.act));
      return { step, node, k, g: gradeDecision(node, hero, k), f: comboFreqs(node, hero), ev: comboEVs(node, hero), why: explain(node, hero) };
    });
  } catch (err) {
    ui.error = err.message || String(err);
  }
  ui.running = false;
  render();
}

function stop() {
  client?.close();
  client = null;
  ui.running = false;
  ui.error = 'Analyse arrêtée.';
  render();
}

function render() {
  if (!root || !location.hash.startsWith('#/analysis')) return; // the page may have been left mid-solve
  mount(root, h('div.analysis-page',
    h('div.setup-head', h('h1', 'Analyse de main'),
      h('p.muted', 'Colle le lien du replayer Winamax d\'une main. Spotwise la lit, la rejoue sur sa table 6-max, résout chaque street jouée à deux, puis note et explique chacune de tes décisions avec la même référence que dans Étude.')),
    h('section.panel.analysis-form',
      h('label.field-label', { for: 'hh-link' }, 'Lien du replayer'),
      h('div.row.gap.wrap',
        h('input.text.grow#hh-link', {
          type: 'url', value: ui.link, placeholder: 'https://www.winamax.fr/replayer/replayer.html?2026-…', 'aria-label': 'Lien du replayer Winamax',
          on: { input: (e) => { ui.link = e.target.value; }, keydown: (e) => { if (e.key === 'Enter') run(); } },
        }),
        ui.running ? h('button.btn.ghost', { type: 'button', on: { click: stop } }, 'Arrêter')
          : h('button.btn.primary', { type: 'button', on: { click: run } }, 'Analyser')),
      h('label.check.small', h('input', { type: 'checkbox', checked: ui.solveFlop, disabled: ui.running, on: { change: (e) => { ui.solveFlop = e.target.checked; } } }),
        ' Résoudre aussi le flop (2 à 4 minutes ; sinon le flop suit le modèle)')),
    ui.error ? h('section.panel.warn', h('strong', 'Impossible d\'analyser cette main'), h('p.small', ui.error)) : null,
    ui.hand && ui.rep ? summary() : null,
    Object.keys(ui.progress).length ? progressPanel() : null,
    ui.results ? timeline() : null,
    ui.rep ? caveats() : null));
}

function summary() {
  const { hand, rep } = ui;
  const rows = hand.seats.filter((s) => s.chips > 0).map((s) => ({ s, p: rep.pos(s.name) })).sort((a, b) => a.p - b.p);
  const board = hand.streets.at(-1)?.board || [];
  return h('section.panel',
    h('div.panel-title', `${hand.tournament}${hand.buyin != null ? ' · ' + fr(hand.buyin, 2).replace(',00', '') + ' €' : ''}${hand.ko ? ' · KO' : ''} · ${hand.sb}/${hand.bb}${hand.ante ? ' ante ' + hand.ante : ''}`),
    h('table.table.small', h('tbody', rows.map(({ s, p }) => h('tr' + (s.name === hand.hero ? '.hero-row' : ''),
      h('td', h('strong', POS[p])), h('td', s.name === hand.hero ? 'Toi (' + s.name + ')' : s.name),
      h('td.mono', fr(s.chips / hand.bb) + 'bb'),
      h('td', (s.name === hand.hero ? hand.heroCards : hand.shown[s.name] || []).map((c) => PlayingCard(parseCard(c), 'sm'))))))),
    board.length ? h('div.row.gap', h('span.small.muted', 'Board'), h('div.board', board.map((c) => PlayingCard(parseCard(c), 'sm')))) : null,
    hand.winners.length ? h('p.small.muted', 'Gagnant : ' + hand.winners.map((w) => `${w.name === hand.hero ? 'toi' : w.name} (${fr(w.amount / hand.bb)}bb)`).join(', ')) : null,
    rep.unsupported ? h('p.small.neg', rep.unsupported + ' L\'analyse s\'arrête là.') : null);
}

function progressPanel() {
  return h('section.panel', h('div.panel-title', 'Solver'),
    h('ul.small', Object.entries(ui.progress).map(([s, m]) => h('li',
      h('strong', STREETS[s]), ' : ',
      m.done ? `résolu · exploitabilité ${fr(m.exploitability, 2)} % du pot · ${m.iterations} itérations · ${fr(m.ms / 1000)} s`
        : [h('span.spinner.sm'), ` calcul… ${m.iterations || 0} itérations · ${Math.round((m.ms || 0) / 1000)} s${Number.isFinite(m.exploitability) ? ' · exploitabilité ' + fr(m.exploitability, 2) + ' %' : ''}`]))));
}

// Every action of the hand, street by street; the hero's decisions in full.
function timeline() {
  const { rep, hand } = ui;
  const byStep = new Map(ui.results.map((r) => [r.step, r]));
  const out = [];
  let street = -1;
  for (const step of rep.steps) {
    if (step.street !== street) {
      street = step.street;
      out.push(h('h2.analysis-street', STREETS[street], step.st.board.length ? h('span.board', step.st.board.map((c) => PlayingCard(c, 'sm'))) : null,
        h('span.small.muted', ` · pot ${fr(pot(step.st))}bb`)));
    }
    const r = byStep.get(step);
    out.push(r ? decision(r) : h('p.small', h('strong', POS[step.p]), ' ', step.real.name, ' : ', actionLabel(step.st, step.act)));
  }
  const score = ui.results.reduce((a, r) => a + r.g.loss, 0);
  return h('section.analysis-timeline',
    h('div.panel', h('div.row.between', h('strong', `${ui.results.length} décision${ui.results.length > 1 ? 's' : ''} de ${hand.hero}`),
      h('span.mono', score > 0.005 ? `EV perdue : −${fr(score, 2)}bb` : 'Aucune perte d\'EV'))),
    out);
}

function decision(r) {
  const { step, node, k, g, f, ev } = r;
  const st = step.st;
  const best = g.bestK;
  const call = toCallOf(st, step.p);
  const source = node.solved ? `Solver (CFR depuis ${['', 'le flop', 'la turn', 'la river'][node.solved.street]}, exploitabilité ${fr(node.solved.exploitability, 2)} % du pot)`
    : st.street > 0 ? 'Modèle Spotwise (street non résolue)' : 'Préflop : tes charts, Nash tapis/fold ou modèle (voir l\'explication)';
  const bad = ['inaccuracy', 'wrong', 'blunder'].includes(g.grade);
  return h('article.panel.decision-card.grade-border-' + g.grade,
    h('div.row.between',
      h('div', h('strong', `${POS[step.p]} · ${STREETS[st.street]}`), h('span.small.muted', call ? ` · à payer ${fr(call)}bb` : '')),
      h('div.row.gap', h('span.grade-dot.grade-' + g.grade), h('strong.grade', GRADE_TEXT[g.grade]),
        h('span.mono.small', g.loss > 0.005 ? `−${fr(g.loss, 2)}bb` : '±0bb'))),
    h('p', 'Tu as joué : ', h('strong', actionLabel(st, step.act)),
      step.real.type === 'bet' || step.real.type === 'raise' ? h('span.small.muted', ` (réel : ${fr(step.real.amount / ui.hand.bb)}bb)`) : null),
    FreqBar(node.actions.map((a, j) => ({ role: actionRole(st, a), freq: f[j], label: actionLabel(st, a) })), { height: 12, labels: true }),
    h('table.table.small', h('thead', h('tr', h('th', 'Action'), h('th', 'Fréquence'), h('th', 'EV'))),
      h('tbody', node.actions.map((a, j) => h('tr' + (j === k ? '.chosen' : '') + (j === best ? '.best' : ''),
        h('td', actionLabel(st, a), j === k ? ' ← ton choix' : '', j === best && j !== k ? ' ← meilleur' : ''),
        h('td.mono', pct(f[j], 1)), h('td.mono', fr(ev[j], 2) + 'bb'))))),
    bad ? h('p', h('strong', 'À jouer plutôt : '), `${actionLabel(st, node.actions[best])} (${pct(f[best], 0)} du temps, EV ${fr(ev[best], 2)}bb contre ${fr(ev[k], 2)}bb pour ton choix).`) : null,
    h('p.small', r.why),
    h('p.small.muted', source),
    h('a.btn.ghost.sm', { href: studyLink(st) }, 'Ouvrir dans Étude'));
}

function caveats() {
  const { rep, hand } = ui;
  const sized = rep.cfg.players ? Object.entries(rep.cfg.players).map(([p, s]) => `${POS[p]} ${Object.entries(s.sizes).map(([l, v]) => v.map((x) => (l === 'post' ? Math.round(x * 100) + ' %' : l === 'raise' ? x + '×' : x + 'bb')).join(', ')).join(', ')}`).join(' ; ') : '';
  return h('section.panel', h('div.panel-title', 'Comment la main est rejouée'),
    h('ul.small.muted',
      h('li', `Stack effectif : ${fr(rep.stackBB)}bb, joué à ${rep.cfg.stack}bb (profondeur d'Étude la plus proche).`),
      hand.ante ? h('li', `Les antes (${hand.ante}) ne sont pas dans l'arbre : le pot de départ est un peu plus petit qu'en vrai.`) : null,
      h('li', `Calcul en chip EV${hand.ko ? ' : les primes (KO) ne sont pas comptées' : ''}.`),
      sized ? h('li', `Tailles réelles ajoutées à l'arbre : ${sized}.`) : null,
      h('li', 'Les mises proches d\'une taille de l\'arbre (à 12 % près) y sont ramenées. Les pots à trois joueurs ou plus suivent le modèle Spotwise.'),
      ui.solveFlop ? h('li', 'Au flop, la turn est simplifiée dans le calcul (2/3 du pot ou tapis) ; la turn et la river sont ensuite résolues exactement.') : null));
}
