import { h, mount, pct, num } from './dom.js';
import { PlayingCard, FreqBar, RangeGrid, Segmented, StatTile } from './components.js';
import { COMBOS, comboIndex, comboStr, cardStr } from '../engine/cards.js';
import { evalHand } from '../engine/evaluator.js';
import { pickWeighted } from '../engine/rng.js';
import {
  POS, STREETS, initialState, applyAction, dealBoard, foldTo, legalActions, actionLabel, actionRole,
  aggression, pot, remaining, alive, toCallOf,
} from '../engine/game.js';
import { analyze, comboFreqs, comboEVs, classSummary } from '../engine/strategy.js';
import { saveSession, uid, getSettings } from '../store.js';

export const DRILLS = [
  { id: 'rfi', name: 'Open raising', desc: 'Folded to you before the flop. Open or fold.', heroes: [0, 1, 2, 3, 4], mode: 'spot' },
  { id: 'vsopen', name: 'Facing an open', desc: 'Someone raised first in. Fold, call or 3-bet.', heroes: [1, 2, 3, 4, 5], mode: 'spot' },
  { id: 'vs3bet', name: 'Facing a 3-bet', desc: 'You opened and got re-raised.', heroes: [0, 1, 2, 3, 4], mode: 'spot' },
  { id: 'srp', name: 'BTN vs BB on the flop', desc: 'Single-raised pot, first flop decision.', heroes: [3, 5], mode: 'spot' },
  { id: 'full', name: 'Full hands', desc: 'Six-handed from the deal to showdown.', heroes: [0, 1, 2, 3, 4, 5], mode: 'full' },
];

const DEFAULT_CFG = { drill: 'rfi', hero: 'any', difficulty: 'standard', rng: 'off', timebank: 0, pause: 'always', autoNext: true, closeOnly: true };

const P = {
  cfg: { ...DEFAULT_CFG },
  session: null,
  hand: null,
  feedback: null,
  timer: null,
  timeLeft: 0,
  busy: false,
};
let root = null;

export function renderPractice(el) {
  root = el;
  render();
}

function render() {
  if (!root) return;
  if (!P.session) { mount(root, setupView()); return; }
  mount(root, h('div.practice', tableView(), sideView()));
}

// ---------- setup ----------
function setupView() {
  const c = P.cfg;
  const drill = DRILLS.find((d) => d.id === c.drill);
  const set = (k) => (v) => { c[k] = v; if (k === 'drill') c.hero = 'any'; render(); };
  const field = (label, control) => h('div.field', h('div.field-label', label), control);
  return h('div.setup',
    h('div.setup-head', h('h1', 'Practice'), h('p.muted', 'Pick a drill, play the spot, and see how your choice compares with the strategy.')),
    h('div.drills', DRILLS.map((d) => h('button.drill' + (d.id === c.drill ? '.on' : ''), {
      type: 'button', 'aria-pressed': d.id === c.drill ? 'true' : 'false', on: { click: () => set('drill')(d.id) },
    }, h('strong', d.name), h('span.muted.small', d.desc), h('span.pill', d.mode === 'full' ? 'Full hand' : 'Single spot')))),
    h('div.panel.setup-opts',
      field('Your position', Segmented('Position', [{ value: 'any', label: 'Any' }, ...drill.heroes.map((p) => ({ value: p, label: POS[p] }))], c.hero, set('hero'))),
      field('Difficulty', Segmented('Difficulty', [{ value: 'standard', label: 'Exact sizes' }, { value: 'simple', label: 'Simple' }], c.difficulty, set('difficulty'))),
      field('RNG', Segmented('RNG', [{ value: 'off', label: 'Off' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }], c.rng, set('rng'))),
      field('Time per decision', Segmented('Timebank', [{ value: 0, label: 'No limit' }, { value: 7, label: '7s' }, { value: 15, label: '15s' }, { value: 25, label: '25s' }], c.timebank, set('timebank'))),
      field('Stop after', Segmented('Pause', [{ value: 'always', label: 'Every decision' }, { value: 'mistakes', label: 'Mistakes only' }], c.pause, set('pause'))),
      field('Hands', h('label.check', h('input', { type: 'checkbox', checked: c.closeOnly, on: { change: (e) => { c.closeOnly = e.target.checked; } } }), ' Favour close decisions')),
      field('', h('label.check', h('input', { type: 'checkbox', checked: c.autoNext, on: { change: (e) => { c.autoNext = e.target.checked; } } }), ' Deal the next hand automatically')),
      h('div.row.end', h('button.btn.primary.lg', { type: 'button', on: { click: startSession } }, 'Start session'))));
}

function startSession() {
  P.session = {
    id: uid(), startedAt: new Date().toISOString(), drill: P.cfg.drill, config: { ...P.cfg },
    hands: 0, decisionsCount: 0, mistakes: 0, scoreSum: 0, evLoss: 0, decisions: [],
  };
  dealHand();
}

function endSession() {
  stopTimer();
  if (P.session && P.session.decisionsCount) saveSession({ ...P.session, endedAt: new Date().toISOString() });
  const had = P.session?.decisionsCount;
  P.session = null; P.hand = null; P.feedback = null;
  if (had) location.hash = '#/stats'; else render();
}

// ---------- dealing ----------
function shuffledDeck() {
  const d = [...Array(52).keys()];
  for (let i = 51; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

function interestWeights(node, p, dead) {
  const w = node.ranges[p];
  return Array.from({ length: 1326 }, (_, i) => {
    const [a, b] = COMBOS[i];
    if (w[i] <= 0 || dead[a] || dead[b]) return 0;
    if (!P.cfg.closeOnly || p !== node.actor) return w[i];
    const f = comboFreqs(node, i);
    const mx = Math.max(...f);
    const fold = node.actions.findIndex((x) => x.type === 'fold');
    let k = mx < 0.85 ? 5 : 1;
    if (fold >= 0 && f[fold] > 0.98) k *= 0.08;
    return w[i] * k;
  });
}

function sampleCombo(node, p, used) {
  const dead = new Uint8Array(52);
  used.forEach((c) => { dead[c] = 1; });
  const i = pickWeighted(interestWeights(node, p, dead));
  return i < 0 ? null : COMBOS[i].slice();
}

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

function dealHand() {
  stopTimer();
  const drill = DRILLS.find((d) => d.id === P.cfg.drill);
  const hero = P.cfg.hero === 'any' ? rand(drill.heroes) : P.cfg.hero;
  const hand = { hero, hands: Array(6).fill(null), boardCards: [], st: initialState(), decisions: [], over: false, mode: drill.mode, result: null };
  P.feedback = null;
  P.hand = hand;
  let st = initialState();
  if (drill.id === 'full') {
    const deck = shuffledDeck();
    for (let p = 0; p < 6; p++) hand.hands[p] = [deck.pop(), deck.pop()].sort((a, b) => b - a);
    hand.boardCards = deck.slice(0, 5);
    hand.st = st;
    P.session.hands++;
    advance();
    return;
  }
  if (drill.id === 'rfi') st = foldTo(st, hero);
  else if (drill.id === 'vsopen') {
    const opener = rand([0, 1, 2, 3, 4].filter((p) => p < hero));
    st = foldTo(st, opener);
    st = applyAction(st, legalActions(st).find((a) => a.type === 'raise'));
    st = foldTo(st, hero);
  } else if (drill.id === 'vs3bet') {
    const villain = rand([1, 2, 3, 4, 5].filter((p) => p > hero));
    st = foldTo(st, hero);
    st = applyAction(st, legalActions(st).find((a) => a.type === 'raise'));
    st = foldTo(st, villain);
    st = applyAction(st, legalActions(st).find((a) => a.type === 'raise' || a.type === 'allin'));
  } else if (drill.id === 'srp') {
    st = foldTo(st, 3);
    st = applyAction(st, legalActions(st).find((a) => a.type === 'raise'));
    st = foldTo(st, 5);
    st = applyAction(st, legalActions(st).find((a) => a.type === 'call'));
    const deck = shuffledDeck();
    st = dealBoard(st, deck.slice(0, 3));
  }
  hand.st = st;
  P.session.hands++;
  // Spot drills: villain acts first if needed (BTN hero on the flop).
  if (st.toAct !== hero) {
    const vn = analyze(st);
    const v = st.toAct;
    hand.hands[v] = sampleCombo(vn, v, st.board);
    const k = pickWeighted(comboFreqs(vn, comboIndex(...hand.hands[v])));
    hand.st = applyAction(st, vn.actions[k]);
  }
  const node = analyze(hand.st);
  const used = [...hand.st.board, ...(hand.hands.flat().filter((x) => x != null))];
  hand.hands[hero] = sampleCombo(node, hero, used) || COMBOS[0].slice();
  const opp = alive(hand.st).find((p) => p !== hero && !hand.hands[p]);
  if (opp != null && alive(hand.st).length === 2) hand.hands[opp] = sampleCombo(node, opp, [...used, ...hand.hands[hero]]);
  startDecision();
  render();
}

// Full-hand mode: run bots until it's the hero's turn or the hand ends.
function advance() {
  const hand = P.hand;
  if (!hand) return;
  let st = hand.st;
  let guard = 0;
  while (!st.terminal && guard++ < 50) {
    if (st.needBoard) { st = dealBoard(st, hand.boardCards.slice(st.board.length, st.board.length + st.needBoard)); continue; }
    if (st.toAct === hand.hero || st.folded[hand.hero]) break;
    const node = analyze(st);
    const p = st.toAct;
    const k = pickWeighted(comboFreqs(node, comboIndex(...hand.hands[p])));
    st = applyAction(st, node.actions[Math.max(0, k)]);
  }
  hand.st = st;
  if (st.terminal || st.folded[hand.hero]) finishHand();
  else startDecision();
  render();
}

function finishHand() {
  const hand = P.hand;
  stopTimer();
  hand.over = true;
  const st = hand.st;
  const live = alive(st);
  if (hand.mode === 'full') {
    if (live.length === 1) hand.result = `${POS[live[0]]} wins ${num(pot(st))}bb`;
    else {
      let board = st.board.slice();
      if (board.length < 5) board = [...board, ...hand.boardCards.slice(board.length, 5)];
      const vals = live.map((p) => evalHand(hand.hands[p][0], hand.hands[p][1], board));
      const best = Math.max(...vals);
      const winners = live.filter((_, k) => vals[k] === best);
      hand.result = `${winners.map((p) => POS[p]).join(' & ')} win${winners.length > 1 ? '' : 's'} ${num(pot(st))}bb at showdown`;
      hand.showdown = true;
    }
  }
  saveSession({ ...P.session });
  if (P.cfg.autoNext && !P.feedback?.pausing) setTimeout(() => { if (P.hand === hand) dealHand(); }, 1400);
}

// ---------- decisions ----------
function startDecision() {
  const hand = P.hand;
  hand.rng = P.cfg.rng !== 'off' ? 1 + Math.floor(Math.random() * 100) : null;
  stopTimer();
  if (P.cfg.timebank) {
    P.timeLeft = P.cfg.timebank;
    P.timer = setInterval(() => {
      P.timeLeft -= 1;
      const t = root?.querySelector('.timer');
      if (t) { t.textContent = P.timeLeft + 's'; t.classList.toggle('low', P.timeLeft <= 3); }
      if (P.timeLeft <= 0) {
        stopTimer();
        const acts = legalActions(hand.st);
        const k = acts.findIndex((a) => a.type === 'check');
        heroAct(k >= 0 ? k : acts.findIndex((a) => a.type === 'fold'), true);
      }
    }, 1000);
  }
}
function stopTimer() { if (P.timer) clearInterval(P.timer); P.timer = null; }

function rngAction(f, actions, roll, dir) {
  const order = actions.map((_, k) => k).sort((x, y) => aggression(actions[x]) - aggression(actions[y]));
  if (dir === 'low') order.reverse();
  let cum = 0;
  for (const k of order) { cum += f[k]; if (roll / 100 <= cum + 1e-9) return k; }
  return order[order.length - 1];
}

export function gradeDecision(node, i, k, roll, dir) {
  const f = comboFreqs(node, i);
  const ev = comboEVs(node, i);
  const Pt = pot(node.st);
  const maxK = f.indexOf(Math.max(...f));
  const bestK = roll ? rngAction(f, node.actions, roll, dir) : maxK;
  const fc = f[k];
  const good = ev.filter((_, j) => f[j] >= 0.05);
  const bestEV = good.length ? Math.max(...good) : ev[maxK];
  let loss = fc >= 0.05 ? 0 : Math.max(0, bestEV - ev[k]);
  if (fc < 0.05) loss = Math.max(loss, (1 - fc / 0.05) * 0.03 * Pt);
  let grade, score;
  if (k === bestK) { grade = 'best'; score = 1; }
  else if (fc >= 0.035) { grade = 'correct'; score = 0.5 + 0.5 * fc / f[maxK]; }
  else if (fc > 0.001) { grade = 'inaccuracy'; score = 0; }
  else if (loss / Pt < 0.05) { grade = 'wrong'; score = -0.3; }
  else { grade = 'blunder'; score = -Math.min(1, 0.3 + (2 * loss) / Pt); }
  return { f, ev, bestK, maxK, grade, score, loss };
}

// Plain-language reason behind the numbers: equity vs. the price, and the hand.
function explain(node, i) {
  const st = node.st;
  const eq = node.equity(st.toAct)[i];
  const call = toCallOf(st, st.toAct);
  const parts = [];
  const info = node.info?.[i];
  if (info) parts.push(`You have ${info.made.toLowerCase()}${info.draw ? ' with a ' + info.draw.toLowerCase() : ''}.`);
  if (Number.isFinite(eq)) parts.push(`Your equity against their range is ${pct(eq)}.`);
  if (call > 0) parts.push(`Calling costs ${num(call)}bb into ${num(pot(st))}bb, so you need about ${pct(call / (pot(st) + call))} to break even before position and future bets.`);
  return parts.join(' ');
}

function simpleGroups(node) {
  const groups = [
    { label: 'Fold', ks: [] }, { label: 'Check / Call', ks: [] }, { label: 'Bet / Raise', ks: [] },
  ];
  node.actions.forEach((a, k) => {
    const g = a.type === 'fold' ? 0 : a.type === 'check' || a.type === 'call' ? 1 : 2;
    groups[g].ks.push(k);
  });
  return groups.filter((g) => g.ks.length);
}

function heroAct(k, timedOut = false) {
  const hand = P.hand;
  if (!hand || hand.over || P.feedback?.pausing || k < 0) return;
  stopTimer();
  const st = hand.st;
  const node = analyze(st);
  const i = comboIndex(...hand.hands[hand.hero]);
  const g = gradeDecision(node, i, k, hand.rng, P.cfg.rng);
  const units = getSettings().units;
  const labels = node.actions.map((a) => actionLabel(st, a, units));
  const rec = {
    t: new Date().toISOString(), drill: P.cfg.drill, pos: POS[hand.hero], hand: comboStr(i), board: st.board.map(cardStr).join(''),
    street: STREETS[st.street], chosen: labels[k], best: labels[g.bestK], grade: g.grade, score: g.score, evLoss: g.loss, pot: pot(st),
    freqs: node.actions.map((a, j) => ({ label: labels[j], role: actionRole(st, a), f: g.f[j] })), timedOut,
    why: explain(node, i),
  };
  const s = P.session;
  s.decisionsCount++;
  s.scoreSum += g.score;
  s.evLoss += g.loss;
  if (!['best', 'correct'].includes(g.grade)) s.mistakes++;
  s.decisions.unshift(rec);
  hand.decisions.push(rec);
  const mistake = !['best', 'correct'].includes(g.grade);
  const pausing = P.cfg.pause === 'always' || mistake;
  P.feedback = { rec, node, pausing, heroIdx: i };
  hand.st = applyAction(st, node.actions[k]);
  if (hand.mode === 'spot') { finishHand(); render(); return; }
  if (pausing) { render(); return; }
  render();
  setTimeout(() => { if (P.hand === hand) advance(); }, 500);
}

function continueAfterFeedback() {
  const hand = P.hand;
  if (!P.feedback) return;
  P.feedback = { ...P.feedback, pausing: false };
  if (hand.over || hand.mode === 'spot') { dealHand(); return; }
  advance();
}

// ---------- views ----------
const SEAT_SPOTS = [[50, 92], [9, 70], [9, 26], [50, 6], [91, 26], [91, 70]]; // % positions, hero first

function tableView() {
  const hand = P.hand;
  const st = hand.st;
  const showAll = hand.over && (hand.showdown || hand.mode === 'spot');
  const seats = POS.map((_, k) => {
    const p = (hand.hero + k) % 6;
    const [x, y] = SEAT_SPOTS[k];
    const folded = st.folded[p];
    const cards = hand.hands[p];
    const faceUp = p === hand.hero || (showAll && !folded && cards);
    const bet = st.streetBet[p];
    return h('div.seat' + (folded ? '.folded' : '') + (st.toAct === p && !hand.over ? '.acting' : '') + (p === hand.hero ? '.hero' : ''), { style: { left: x + '%', top: y + '%' } },
      h('div.seat-cards', folded ? null : (faceUp && cards ? cards.map((c) => PlayingCard(c, p === hand.hero ? 'lg' : 'sm')) : [PlayingCard(null, 'sm'), PlayingCard(null, 'sm')])),
      h('div.seat-plate', h('strong', POS[p]), h('span.mono', num(remaining(st, p)) + 'bb'), p === 3 ? h('span.dealer', { title: 'Dealer' }, 'D') : null),
      bet > 0 ? h('div.bet-chip', num(bet)) : null);
  });
  const hero = hand.hero;
  const myTurn = !hand.over && st.toAct === hero && !P.feedback?.pausing;
  let bar;
  if (myTurn) {
    const node = analyze(st);
    const units = getSettings().units;
    if (P.cfg.difficulty === 'simple') {
      const i = comboIndex(...hand.hands[hero]);
      const f = comboFreqs(node, i);
      bar = simpleGroups(node).map((g, n) => {
        const k = g.ks.reduce((b, x) => (f[x] > f[b] ? x : b), g.ks[0]);
        return h('button.act.big', { type: 'button', style: { '--c': `var(--act-${actionRole(st, node.actions[k])})` }, on: { click: () => heroAct(k) } }, g.label, h('kbd', String(n + 1)));
      });
    } else {
      bar = node.actions.map((a, k) => h('button.act.big', { type: 'button', style: { '--c': `var(--act-${actionRole(st, a)})` }, on: { click: () => heroAct(k) } }, actionLabel(st, a, units), h('kbd', String(k + 1))));
    }
  } else if (P.feedback?.pausing || hand.over) {
    bar = [h('button.btn.primary.lg', { type: 'button', on: { click: continueAfterFeedback } }, hand.over || hand.mode === 'spot' ? 'Next hand' : 'Continue', h('kbd', 'Space'))];
  } else bar = [h('span.muted', 'Waiting for the other players…')];

  return h('section.table-area', { 'aria-label': 'Poker table' },
    h('div.table-top', h('span.pill', DRILLS.find((d) => d.id === P.cfg.drill).name), h('span.pill', STREETS[st.street]),
      hand.rng ? h('span.dice', { title: 'RNG roll' }, '🎲 ' + hand.rng) : null,
      P.cfg.timebank && myTurn ? h('span.timer', P.timeLeft + 's') : null,
      h('span.grow'), h('button.btn.ghost.sm', { type: 'button', on: { click: endSession } }, 'End session')),
    h('div.felt-wrap', h('div.felt',
      h('div.felt-center', h('div.board', st.board.map((c) => PlayingCard(c, 'md'))), h('div.pot', 'Pot ', h('strong', num(pot(st)) + 'bb')),
        hand.result ? h('div.result', hand.result) : null),
      seats)),
    h('div.action-bar', { role: 'group', 'aria-label': 'Your actions' }, bar));
}

const GRADE_TEXT = { best: 'Best move', correct: 'Correct', inaccuracy: 'Inaccuracy', wrong: 'Wrong move', blunder: 'Blunder' };

function sideView() {
  const s = P.session;
  const score = s.decisionsCount ? s.scoreSum / s.decisionsCount : 0;
  const fb = P.feedback;
  const order = (fr) => fr.map((x, k) => k).sort((a, b) => b - a);
  return h('aside.practice-side',
    h('div.stats-row', StatTile('Score', pct(score, 0)), StatTile('Hands', s.hands), StatTile('Mistakes', s.mistakes), StatTile('EV lost', num(s.evLoss, 2) + 'bb')),
    fb ? h('section.panel.feedback.grade-' + fb.rec.grade, { 'aria-live': 'polite' },
      h('div.row.between', h('strong.grade', GRADE_TEXT[fb.rec.grade]), h('span.mono', fb.rec.evLoss > 0.005 ? '−' + num(fb.rec.evLoss, 2) + 'bb' : '±0bb')),
      h('p.small', 'You chose ', h('strong', fb.rec.chosen), fb.rec.grade !== 'best' ? [' · best was ', h('strong', fb.rec.best)] : null, fb.rec.timedOut ? ' (time ran out)' : ''),
      fb.rec.why ? h('p.small.why', fb.rec.why) : null,
      h('div.small.muted', `Strategy for ${fb.rec.hand}:`),
      FreqBar(order(fb.rec.freqs).map((k) => ({ role: fb.rec.freqs[k].role, label: fb.rec.freqs[k].label, freq: fb.rec.freqs[k].f })), { height: 16, labels: true }),
      h('ul.freq-list', fb.rec.freqs.map((x) => h('li', h('span.swatch', { style: { background: `var(--act-${x.role})` } }), x.label, h('span.mono', pct(x.f, 1))))),
      learnGrid(fb)) : h('section.panel', h('p.muted', 'Make a decision to see how it compares with the strategy.')),
    h('section.panel', h('div.panel-title', 'This session'),
      s.decisions.length ? h('ol.decision-log', s.decisions.slice(0, 12).map((d) => h('li',
        h('span.grade-dot.grade-' + d.grade, { title: GRADE_TEXT[d.grade] }), h('span.mono', d.hand), h('span', d.pos + ' · ' + d.street), h('span.grow.muted.small', d.chosen), h('span.mono.small', d.evLoss > 0.005 ? '−' + num(d.evLoss, 2) : '')))) : h('p.muted.small', 'No decisions yet.')));
}

function learnGrid(fb) {
  const node = fb.node;
  const summ = classSummary(node);
  const units = getSettings().units;
  const roles = node.actions.map((a) => ({ role: actionRole(node.st, a), label: actionLabel(node.st, a, units) }));
  const order = node.actions.map((_, k) => k).sort((x, y) => aggression(node.actions[y]) - aggression(node.actions[x]));
  const sel = summ.findIndex((c) => c.cls.combos.includes(fb.heroIdx));
  return h('details.learn', h('summary', 'Show the whole range'), RangeGrid({ cells: summ, roles, order, size: 'xs', selected: sel, label: 'Range strategy at this decision' }));
}

export function practiceKey(e) {
  if (!P.session || e.target.matches('input, select, textarea')) return false;
  const hand = P.hand;
  if (e.key === ' ' || e.key === 'Enter') {
    if (P.feedback?.pausing || hand?.over) { e.preventDefault(); continueAfterFeedback(); return true; }
  }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 9 && hand && !hand.over && hand.st.toAct === hand.hero && !P.feedback?.pausing) {
    const node = analyze(hand.st);
    if (P.cfg.difficulty === 'simple') {
      const g = simpleGroups(node)[n - 1];
      if (g) {
        const f = comboFreqs(node, comboIndex(...hand.hands[hand.hero]));
        heroAct(g.ks.reduce((b, x) => (f[x] > f[b] ? x : b), g.ks[0]));
      }
    } else if (n <= node.actions.length) heroAct(n - 1);
    return true;
  }
  return false;
}

export const practiceActive = () => !!P.session;
export function leavePractice() { stopTimer(); }
