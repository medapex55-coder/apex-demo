import { h, mount, pct, num } from './dom.js';
import { PlayingCard, FreqBar, RangeGrid, Segmented, StatTile } from './components.js';
import { COMBOS, CLASSES, CLASS_OF_COMBO, comboIndex, comboStr, cardStr } from '../engine/cards.js';
import { evalHand, catFr } from '../engine/evaluator.js';
import { pickWeighted } from '../engine/rng.js';
import {
  POS, STREETS, initialState, applyAction, dealBoard, foldTo, legalActions, actionLabel, actionRole,
  aggression, pot, remaining, alive, toCallOf, STACKS,
} from '../engine/game.js';
import { analyze, comboFreqs, comboEVs, classSummary, chartCode, chartCodeAt, chartBlend, getOpenStyle, rangesOf, chartDepth, bbChart, bbCode, pushFoldSpot, liveLine } from '../engine/strategy.js';
import { saveSession, uid, getSettings, getProgress } from '../store.js';
import { practiceSpotKey, studyLink, spotState } from '../data/leaks.js';
import { markSlotDone } from '../data/program.js';
import { recordDecision, recordSession, today, DAILY_GOAL, levelOf } from '../data/progress.js';
import { celebrate, XpBar, DailyRing, LevelBadge } from './gamify.js';
import { HandRow, showHandReplay } from './handreplay.js';

export const DRILLS = [
  { id: 'rfi', name: 'Ouverture', icon: '🚪', desc: 'Tout le monde a foldé jusqu\'à toi avant le flop. Ouvre ou couche-toi.', heroes: [0, 1, 2, 3, 4], mode: 'spot' },
  { id: 'vsopen', name: 'Face à un open', icon: '🛡️', desc: 'Un joueur a relancé en premier. Fold, call ou 3-bet.', heroes: [1, 2, 3, 4, 5], mode: 'spot' },
  { id: 'bb50', name: 'Défense BB (tes charts)', icon: '🧱', desc: 'Tes charts BB à 50, 25 ou 20bb : face à un open, au limp de la SB et à sa limp-relance.', heroes: [5], mode: 'spot' },
  { id: 'vs3bet', name: 'Face à un 3-bet', icon: '⚔️', desc: 'Tu as ouvert et tu te fais relancer.', heroes: [0, 1, 2, 3, 4], mode: 'spot' },
  { id: 'srp', name: 'BTN vs BB au flop', icon: '🎯', desc: 'Pot relancé une fois, première décision au flop.', heroes: [3, 5], mode: 'spot' },
  { id: 'postflop', name: 'Postflop', icon: '🃏', desc: 'Pot relancé ou 3-bet : joue flop, turn et river jusqu\'à la fin du coup.', heroes: [0, 1, 2, 3, 4, 5], mode: 'full' },
  { id: 'multiway', name: 'Multiway', icon: '👥', desc: 'Un open payé par plusieurs joueurs : joue le coup à 3 ou 4 dès le flop.', heroes: [0, 1, 2, 3, 4, 5], mode: 'full' },
  { id: 'full', name: 'Mains complètes', icon: '♠️', desc: 'À six joueurs, de la donne jusqu\'à l\'abattage.', heroes: [0, 1, 2, 3, 4, 5], mode: 'full' },
  { id: 'mix', name: 'Spots aléatoires', icon: '🎲', desc: 'Aucun réglage : sur 10 mains, un mélange d\'ouvertures, de défenses, de 3-bets, de BB, de postflop et de multiway, positions et stacks au hasard.', heroes: [0, 1, 2, 3, 4, 5], mode: 'mix' },
  // Launched from Programme only: the spots to fix from Leakfinder.
  { id: 'program', name: 'Programme', icon: '📅', desc: 'Tes spots à corriger, planifiés dans Programme.', heroes: [0, 1, 2, 3, 4, 5], mode: 'spot', hidden: true },
  // Opened from Leakfinder's « Étudier » button: one spot to fix.
  { id: 'target', name: 'Spot ciblé', icon: '🎯', desc: 'Un spot à corriger ouvert depuis Leakfinder.', heroes: [0, 1, 2, 3, 4, 5], mode: 'spot', hidden: true },
];
const FIELD_STAGES = [['100', 'Début'], ['50', '50 %'], ['25', '25 %'], ['10', '10 %'], ['semi', 'Demi-finale'], ['ft', 'Table finale']];

export const LEVELS = [
  { value: 'easy', label: 'Facile', desc: 'Trois boutons (fold, call, relance), des mains aux décisions nettes. Toute action que la stratégie joue au moins 20 % du temps est acceptée.' },
  { value: 'medium', label: 'Moyen', desc: 'Les tailles exactes et surtout des décisions serrées. Une action mixte jouée assez souvent compte comme correcte.' },
  { value: 'gto', label: 'GTO max', desc: 'Tailles exactes, presque que des mains mixtes, et le dé (RNG) décide : seule l\'action tirée est le meilleur coup, toute autre est une imprécision.' },
];
// Where the villain can sit for each drill: the opener (vs open), the 3-bettor
// (vs 3-bet), the opener the BB defends against (BB charts: the seats its depth has charts for).
// (postflop, multiway: the villain is a player in the pot with you).
const VILLAINS = { vsopen: [0, 1, 2, 3, 4], vs3bet: [1, 2, 3, 4, 5], bb50: [0, 1, 2, 3, 4], postflop: [0, 1, 2, 3, 4, 5], multiway: [0, 1, 2, 3, 4, 5] };
const villainOk = (drill, hero, v) => (drill === 'vsopen' ? v < hero : drill === 'vs3bet' ? v > hero : v !== hero);
const CLASH = {
  vsopen: 'Le vilain doit parler avant toi : choisis une position plus tôt.',
  vs3bet: 'Le vilain doit parler après toi : choisis une position plus tard.',
  postflop: 'Le vilain ne peut pas être à ta place.', multiway: 'Le vilain ne peut pas être à ta place.',
};
const NO_VILLAIN = {
  rfi: 'Personne n\'a encore joué : tu ouvres face à toute la table. Pour cibler un vilain, choisis « Face à un open » ou « Face à un 3-bet ».',
  srp: 'Toujours BTN contre BB : le vilain est l\'autre joueur.',
  full: 'Main complète à six : tous les joueurs sont là.',
};
const COVERS = [{ value: 'equal', label: 'Stacks égaux' }, { value: 'hero', label: 'Tu couvres' }, { value: 'villain', label: 'Le vilain te couvre' }];
// cfg.big: the hero covers everyone; cfg.short: everyone covers the hero.
const coverCfg = (cover, hero) => (cover === 'hero' ? { big: hero } : cover === 'villain' ? { short: hero } : {});
const rngMode = () => (P.cfg.level === 'gto' && P.cfg.rng === 'off' ? 'high' : P.cfg.rng);
const HANDS_PER_SPOT = 10; // Programme: hands on a spot before the next one
const SPOT_DRILLS = new Set(['program', 'target']); // drills that train Leakfinder spots
// « Spots aléatoires »: each block of 10 hands deals every kind of spot, in a
// random order, with random seats, stack, open size, format and field stage.
export const MIX_BAG = ['rfi', 'rfi', 'vsopen', 'vsopen', 'bb50', 'vs3bet', 'srp', 'postflop', 'multiway', 'full'];
const MIX_STACKS = [100, 100, 80, 70, 50, 50, 40, 30, 25, 20, 15];
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function mixCfg(drill) {
  const r = Math.random();
  return {
    ...P.cfg, drill, hero: 'any', villain: 'any',
    cover: r < 0.6 ? 'equal' : r < 0.8 ? 'hero' : 'villain',
    stack: rand(MIX_STACKS), open: rand(['2', '2.5', '2.5']), bbDepth: rand([50, 50, 25, 20]),
    format: Math.random() < 0.25 ? 'ko' : 'vanilla',
    stage: Math.random() < 0.5 ? '100' : rand(['50', '25', '10', 'semi', 'ft']),
    multiway: Math.random() < 0.3,
  };
}

const DEFAULT_CFG = {
  drill: 'rfi', hero: 'any', villain: 'any', cover: 'equal', stack: 100, open: '2.5', format: 'vanilla', stage: '100', multiway: false, bbDepth: 50,
  level: 'medium', rng: 'off', timebank: 0, pause: 'always', autoNext: true,
};
// The engine config of a drill: format, field stage, multiway pots.
// The BB drill plays the spots its charts are made for, at the chosen depth.
const BB_DRILL = {
  50: { stack: 50, open: '2.5', note: 'open 2.5bb (SB 3.5bb)', spots: ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'limp', 'limp3bet'] },
  25: { stack: 25, open: '2', note: 'open 2bb (SB 3bb)', spots: ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'limp', 'limp3bet', 'limpshove'] },
  20: { stack: 20, open: '2', note: 'open 2bb', spots: ['LJ', 'HJ'] },
};
const bbDrill = (c) => BB_DRILL[c.bbDepth] || BB_DRILL[50];
const SB_SPOT = (s) => s === 'SB' || s.startsWith('limp');
const villainsOf = (c) => (c.drill === 'bb50' ? [0, 1, 2, 3, 4].filter((p) => bbDrill(c).spots.some((s) => (p === 4 ? SB_SPOT(s) : s === POS[p]))) : VILLAINS[c.drill]);
const gameCfg = (c) => c.drill === 'bb50' ? { stack: bbDrill(c).stack, open: bbDrill(c).open, ko: false, stage: '100', multiway: false } : ({ stack: c.stack, open: c.open, ko: c.format === 'ko', stage: c.stage, multiway: c.drill === 'multiway' || (c.drill === 'full' && c.multiway) });

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
  const hand = P.hand;
  // Back from another page: leavePractice stopped the clock of the pending decision.
  if (P.session && hand && !P.timer && !hand.over && !hand.st.needBoard && hand.st.toAct === hand.hero && !P.feedback?.pausing) startTimer();
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
  const set = (k) => (v) => { c[k] = v; if (k === 'drill') { c.hero = 'any'; c.villain = 'any'; P.program = null; } render(); };
  const field = (label, control) => h('div.field', h('div.field-label', label), control);
  const villains = villainsOf(c);
  const clash = villains && c.hero !== 'any' && c.villain !== 'any' && !villainOk(c.drill, c.hero, c.villain);
  const level = LEVELS.find((l) => l.value === c.level);
  const chipEV = c.drill === 'bb50' || (c.format === 'vanilla' && c.stage === '100');
  const t = c.drill === 'target' ? P.program?.spots[0] : null; // spot opened from Leakfinder
  const mix = c.drill === 'mix';
  return h('div.setup',
    h('div.setup-head', h('h1', 'Entraînement'), h('p.muted', 'Choisis un exercice, joue le spot et compare ton choix à la stratégie. La référence est la même que dans Étude : tes charts quand il y en a un pour le spot, sinon le modèle Spotwise.')),
    t ? h('section.panel.target-spot',
      h('div.row.between', h('div', h('div.small.muted', '🎯 Spot à corriger, ouvert depuis Leakfinder'), h('h2', t.title)),
        h('button.btn.ghost.sm', { type: 'button', on: { click: () => set('drill')('rfi') } }, 'Choisir un autre exercice')),
      h('p.small', t.story),
      t.metric ? h('p.small.muted', `${t.metric.label} : toi ${Math.round(t.metric.you * 100)} %, cible ${Math.round(t.metric.target * 100)} %. ${t.metric.tip}`) : null,
      h('p.small.muted', 'Toutes les mains de la session se jouent dans ce spot. Règle la difficulté puis clique sur « Commencer la session ».')) : null,
    t ? null : h('div.drills', DRILLS.filter((d) => !d.hidden).map((d) => h('button.drill' + (d.id === c.drill ? '.on' : ''), {
      type: 'button', title: d.name, 'aria-pressed': d.id === c.drill ? 'true' : 'false', on: { click: () => set('drill')(d.id) },
    }, h('span.drill-icon', { 'aria-hidden': 'true' }, d.icon), h('strong', d.name), h('span.muted.small', d.desc), h('span.pill', d.mode === 'full' ? 'Main complète' : d.mode === 'mix' ? 'Tout au hasard' : 'Spot unique')))),
    h('div.panel.setup-opts',
      field('Difficulté', h('div', Segmented('Difficulté', LEVELS.map(({ value, label }) => ({ value, label })), c.level, set('level')), h('p.small.muted', level.desc))),
      mix ? field('Spots', h('p.small.muted', 'Tout est tiré au hasard à chaque main : le type de spot (sur 10 mains : 2 ouvertures, 2 face à un open, 1 défense BB, 1 face à un 3-bet, 1 BTN vs BB au flop, 1 postflop, 1 multiway, 1 main complète), ta position, le vilain, le stack, la taille d\'open, le format et le field.')) : null,
      t || mix ? null : field('Ta position', Segmented('Position', [{ value: 'any', label: 'Toutes' }, ...drill.heroes.map((p) => ({ value: p, label: POS[p] }))], c.hero, set('hero'))),
      t || mix ? null : field('Position du vilain', villains
        ? h('div', Segmented('Position du vilain', [{ value: 'any', label: 'Toutes' }, ...villains.map((p) => ({ value: p, label: POS[p] }))], c.villain, set('villain')),
          clash ? h('p.small.neg', CLASH[c.drill]) : null)
        : h('p.small.muted', NO_VILLAIN[c.drill])),
      t || mix ? null : field('Tapis', h('div',
        h('div.radio-row', { role: 'radiogroup', 'aria-label': 'Tapis' }, COVERS.map((o) => h('label.check',
          h('input', { type: 'radio', name: 'cover', value: o.value, checked: c.cover === o.value, on: { change: () => set('cover')(o.value) } }), ' ', o.label))),
        c.drill === 'rfi' && c.cover !== 'equal' ? h('p.small.muted', 'En ouverture, ton chart s\'applique tel quel : le tapis compte dès qu\'un vilain relance ou paie.') : null,
        c.cover !== 'equal' && chipEV ? h('p.small.muted', 'En Vanilla au début du tournoi, couvrir ou être couvert ne change pas la stratégie (pas d\'ICM, pas de prime). Choisis KO ou un field plus avancé pour voir la différence.') : null)),
      t ? field('Spot', h('p.small.muted', 'Position, vilain, stack, taille d\'open et format : ceux du spot de Leakfinder.')) : c.drill === 'bb50' ? field('Profondeur', h('div', Segmented('Profondeur', [50, 25, 20].map((d) => ({ value: d, label: d + 'bb' })), bbDrill(c).stack, (v) => { c.bbDepth = v; c.villain = 'any'; render(); }),
        h('p.small.muted', `${bbDrill(c).stack}bb, ${bbDrill(c).note}, Vanilla en début de tournoi : les réglages de tes charts.${bbDrill(c).stack === 20 ? ' À 20bb, tu as des charts BB contre LJ et HJ.' : ''}`))) : null,
      t || mix || c.drill === 'bb50' ? null : field('Format', Segmented('Format', [{ value: 'vanilla', label: 'Vanilla' }, { value: 'ko', label: 'KO (bounty)' }], c.format, set('format'))),
      t || mix || c.drill === 'bb50' ? null : field('Field restant', Segmented('Field restant', FIELD_STAGES.map(([value, label]) => ({ value, label })), c.stage, set('stage'))),
      c.drill === 'full' ? field('Multiway', h('label.check', h('input', { type: 'checkbox', checked: c.multiway, on: { change: (e) => { c.multiway = e.target.checked; } } }), ' Autoriser les coups à 3 joueurs ou plus')) : null,
      t || mix || c.drill === 'bb50' ? null : field('Stack effectif', h('label.pick-field', h('select', { 'aria-label': 'Stack effectif', on: { change: (e) => { c.stack = +e.target.value; } } },
        STACKS.map((s) => h('option', { value: String(s), selected: s === c.stack }, s + 'bb'))))),
      t || mix || c.drill === 'bb50' ? null : field('Taille d\'open', Segmented('Taille d\'open', [{ value: '2', label: '2bb' }, { value: '2.5', label: '2.5bb' }, { value: '4.5', label: '4.5bb' }], c.open, set('open'))),
      field('RNG', h('div', Segmented('RNG', [{ value: 'off', label: 'Désactivé' }, { value: 'high', label: 'Haut' }, { value: 'low', label: 'Bas' }], c.rng, set('rng')),
        c.level === 'gto' && c.rng === 'off' ? h('p.small.muted', 'En GTO max, le RNG est activé (Haut).') : null)),
      field('Temps par décision', Segmented('Timebank', [{ value: 0, label: 'Illimité' }, { value: 7, label: '7s' }, { value: 15, label: '15s' }, { value: 25, label: '25s' }], c.timebank, set('timebank'))),
      field('S\'arrêter après', Segmented('Pause', [{ value: 'always', label: 'Chaque décision' }, { value: 'mistakes', label: 'Les erreurs seulement' }], c.pause, set('pause'))),
      field('', h('label.check', h('input', { type: 'checkbox', checked: c.autoNext, on: { change: (e) => { c.autoNext = e.target.checked; } } }), ' Distribuer la main suivante automatiquement')),
      h('div.row.end', h('button.btn.primary.lg', { type: 'button', disabled: clash, on: { click: startSession } }, 'Commencer la session'))));
}

function startSession() {
  P.session = {
    id: uid(), startedAt: new Date().toISOString(), drill: P.cfg.drill, config: { ...P.cfg },
    hands: 0, mixBag: [], decisionsCount: 0, mistakes: 0, scoreSum: 0, evLoss: 0, decisions: [], handsLog: [], combo: 0, xp: 0,
    program: P.program ? { slotId: P.program.slotId, spots: P.program.spots.map((s) => s.title), random: P.program.random } : undefined,
  };
  dealHand();
}

// Programme: a booked slot trains its planned spots (most urgent first, in
// blocks of HANDS_PER_SPOT hands) or all the spots to fix at random.
export function startProgram({ slotId, spots, random, until }) {
  if (P.session) endSession(true);
  P.program = { slotId, spots, random, until, prevDrill: SPOT_DRILLS.has(P.cfg.drill) ? 'rfi' : P.cfg.drill };
  P.cfg = { ...P.cfg, drill: 'program', hero: 'any', villain: 'any' };
  startSession();
}

// Leakfinder « Étudier »: preload one spot; the session starts from the setup screen.
export function prepareSpot(target) {
  if (P.session) endSession(true);
  P.program = { slotId: null, spots: [target], random: false, prevDrill: SPOT_DRILLS.has(P.cfg.drill) ? 'rfi' : P.cfg.drill };
  P.cfg = { ...P.cfg, drill: 'target', hero: 'any', villain: 'any' };
}

function endSession(quiet = false) {
  stopTimer();
  const s = P.session;
  if (s && s.decisionsCount) {
    saveSession({ ...s, endedAt: new Date().toISOString() });
    celebrate({ badges: recordSession(s) });
  }
  if (P.program) {
    if (s?.decisionsCount && P.program.slotId) markSlotDone(P.program.slotId, { sessionId: s.id, at: new Date().toISOString(), decisions: s.decisionsCount, score: s.scoreSum / s.decisionsCount });
    P.cfg = { ...P.cfg, drill: P.program.prevDrill };
    P.program = null;
  }
  const had = s?.decisionsCount;
  P.session = null; P.hand = null; P.feedback = null;
  if (quiet) return;
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
    if (p !== node.actor) return w[i];
    // Which hands come up: clear decisions (Facile), close ones (Moyen),
    // mostly mixed ones (GTO max). Obvious folds are rare everywhere.
    const f = comboFreqs(node, i);
    const mx = Math.max(...f);
    const fold = node.actions.findIndex((x) => x.type === 'fold');
    const lvl = P.cfg.level;
    let k = lvl === 'easy' ? (mx >= 0.85 ? 3 : 0.4) : lvl === 'gto' ? (mx < 0.85 ? 8 : 1) : (mx < 0.85 ? 5 : 1);
    if (fold >= 0 && f[fold] > 0.98) k *= lvl === 'easy' ? 0.15 : 0.08;
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
const actOf = (st, ...types) => legalActions(st).find((a) => types.includes(a.type));
// The opener's or 3-bettor's aggressive action, as often as the strategy plays
// each (raise, or shove when short): null when it never raises here.
function aggrAct(st) {
  const node = analyze(st);
  const w = node.ranges[st.toAct];
  const ks = node.actions.map((a, k) => k).filter((k) => ['raise', 'allin'].includes(node.actions[k].type));
  const ws = ks.map((k) => node.freqs[k].reduce((s, f, i) => s + f * w[i], 0));
  const j = pickWeighted(ws);
  return j < 0 || !(ws[j] > 0.5) ? null : node.actions[ks[j]];
}

// Preflop line that reaches the flop with the hero in the pot: a raised pot
// (30% 3-bet pots) for "postflop", an open with 1 or 2 cold-callers (plus the
// big blind sometimes) for "multiway". Null when the spot can't be built.
function flopLine(st0, kind, heroPick, villain = null) {
  // Seats that must be in the pot: the hero (when fixed) and the villain.
  const need = [heroPick, villain].filter((p) => p !== 'any' && p != null);
  const first = need.length ? Math.min(...need) : 5;
  for (let tries = 0; tries < 60; tries++) {
    let st = st0;
    const openers = (kind === 'multiway' ? [0, 1, 2, 3] : [0, 1, 2, 3, 4]).filter((p) => p <= first);
    if (!openers.length) return null;
    // Heads-up with both seats known: the earlier one opens, the later one calls.
    const opener = kind !== 'multiway' && need.length === 2 ? first : rand(openers);
    st = foldTo(st, opener);
    const open = actOf(st, 'raise');
    if (!open) return null;
    st = applyAction(st, open);
    let inPot = [opener];
    if (kind === 'multiway') {
      const later = [opener + 1, opener + 2, opener + 3, opener + 4, opener + 5].filter((p) => p <= 5);
      const want = new Set([rand(later), rand(later), ...(Math.random() < 0.5 ? [5] : []), ...need.filter((p) => p !== opener)]);
      for (let guard = 0; guard < 8 && !st.needBoard && !st.terminal; guard++) {
        const p = st.toAct;
        const a = want.has(p) ? actOf(st, 'call', 'check') : actOf(st, 'fold', 'check');
        st = applyAction(st, a);
        if (want.has(p)) inPot.push(p);
      }
      if (inPot.length < 3) continue;
    } else {
      const later = need.filter((p) => p > opener);
      const caller = later.length ? later[0] : rand([1, 2, 3, 4, 5].filter((p) => p > opener));
      st = foldTo(st, caller);
      if (Math.random() < 0.3) {
        const three = actOf(st, 'raise');
        if (!three) continue;
        st = foldTo(applyAction(st, three), opener);
        const call = actOf(st, 'call');
        if (!call) continue;
        st = applyAction(st, call);
      } else {
        const call = actOf(st, 'call');
        if (!call) continue;
        st = applyAction(st, call);
      }
      inPot = [opener, caller];
    }
    if (!st.needBoard || inPot.some((p) => remaining(st, p) <= 0)) continue;
    if (need.some((p) => !inPot.includes(p))) continue;
    if (!liveLine(st)) continue; // e.g. a min-raise at 15bb, where the strategy only shoves
    return { st, hero: heroPick === 'any' ? rand(inPot.filter((p) => p !== villain)) : heroPick };
  }
  return null;
}

// Cards for every player still in, drawn from their ranges, then the board.
function dealFromRanges(hand, st) {
  const ranges = rangesOf(st);
  const used = [];
  for (const p of alive(st)) {
    const dead = new Uint8Array(52);
    used.forEach((c) => { dead[c] = 1; });
    const w = Array.from({ length: 1326 }, (_, i) => (dead[COMBOS[i][0]] || dead[COMBOS[i][1]] ? 0 : ranges[p][i]));
    const i = pickWeighted(w);
    hand.hands[p] = (i >= 0 ? COMBOS[i] : COMBOS[0]).slice();
    used.push(...hand.hands[p]);
  }
  hand.boardCards = shuffledDeck().filter((c) => !used.includes(c)).slice(0, 5);
}

// The Programme spot for the next hand, rebuilt as an engine state.
function programSpot() {
  const pr = P.program;
  if (!pr?.spots.length) return null;
  const sp = pr.random ? rand(pr.spots) : pr.spots[Math.floor(P.session.hands / HANDS_PER_SPOT) % pr.spots.length];
  const st = spotState(sp.d);
  return st ? { st, title: sp.title } : null;
}

// The preflop line of a single-spot drill, played the way the strategy plays
// it (the opener raises or shoves as often as it does). Null when the strategy
// never plays this line at these settings.
function spotLine(id, c, st, hero, vil) {
  const take = (s, t) => { const a = s && legalActions(s).find((x) => x.type === t); return a ? applyAction(s, a) : null; };
  const aggr = (s) => { const a = s && aggrAct(s); return a ? applyAction(s, a) : null; };
  if (id === 'rfi') st = foldTo(st, hero);
  else if (id === 'bb50') {
    const spots = bbDrill(c).spots;
    const spot = vil == null ? rand(spots) : vil === 4 ? rand(spots.filter(SB_SPOT)) : POS[vil];
    if (spot.startsWith('limp')) {
      st = take(foldTo(st, 4), 'call'); // SB limps
      if (spot === 'limp3bet') st = take(take(st, 'raise'), 'raise'); // BB raises, SB re-raises
      if (spot === 'limpshove') st = take(take(st, 'raise'), 'allin'); // BB raises, SB shoves
    } else {
      st = take(foldTo(st, POS.indexOf(spot)), 'raise');
      st = st && foldTo(st, 5);
    }
  } else if (id === 'vsopen') {
    const opener = vil ?? rand([0, 1, 2, 3, 4].filter((p) => p < hero));
    st = aggr(foldTo(st, opener)); // short: the opener shoves
    st = st && foldTo(st, hero);
  } else if (id === 'vs3bet') {
    const villain = vil ?? rand([1, 2, 3, 4, 5].filter((p) => p > hero));
    st = take(foldTo(st, hero), 'raise');
    st = aggr(st && foldTo(st, villain));
  } else if (id === 'srp') {
    st = take(foldTo(st, 3), 'raise');
    st = take(st && foldTo(st, 5), 'call');
    st = st && dealBoard(st, shuffledDeck().slice(0, 3));
  }
  // The BB drill plays the spots of your charts as they are.
  return st && !st.terminal && (id === 'bb50' || liveLine(st)) ? st : null;
}

function dealHand() {
  stopTimer();
  // Spots aléatoires: the next spot of the shuffled bag, with random settings.
  let c = P.cfg;
  if (c.drill === 'mix') {
    if (!P.session.mixBag?.length) P.session.mixBag = shuffle([...MIX_BAG]);
    c = mixCfg(P.session.mixBag.pop());
  }
  const drill = DRILLS.find((d) => d.id === c.drill);
  // A chosen villain seat narrows the hero seats it works with.
  const vil = villainsOf(c)?.includes(c.villain) ? c.villain : null;
  const heroes = drill.heroes.filter((p) => vil == null || villainOk(drill.id, p, vil));
  let hero = c.hero === 'any' ? rand(heroes) : c.hero;
  // Programme: the spot (and its stack, open size, format) comes from Leakfinder.
  const prog = SPOT_DRILLS.has(drill.id) ? programSpot() : null;
  if (prog) hero = prog.st.toAct;
  const game = prog ? prog.st.cfg : { ...gameCfg(c), ...coverCfg(c.cover, hero) };
  const hand = { hero, hands: Array(6).fill(null), boardCards: [], st: initialState(game), decisions: [], over: false, mode: drill.mode, result: null, spotTitle: prog?.title, drill: drill.id };
  P.feedback = null;
  P.hand = hand;
  let st = initialState(game);
  if (SPOT_DRILLS.has(drill.id) && !prog) {
    P.session.hands++; hand.over = true; hand.result = 'Ce spot ne peut plus être rejoué : retourne dans Programme.'; render(); return;
  }
  if (drill.id === 'postflop' || drill.id === 'multiway') {
    // With a covering option the hero seat must be fixed before the line.
    let line = flopLine(st, drill.id, c.cover !== 'equal' ? hero : c.hero, vil);
    if (!line && P.cfg.drill === 'mix') { // random stack too short for this line: deal it at 100bb
      c = { ...c, stack: 100 };
      st = initialState({ ...gameCfg(c), ...coverCfg(c.cover, hero) });
      line = flopLine(st, drill.id, c.cover !== 'equal' ? hero : c.hero, vil);
    }
    if (!line) { P.session.hands++; hand.over = true; hand.result = c.stack <= 15 ? `À ${c.stack}bb, la stratégie joue tapis ou fold avant le flop : il n'y a pas de spot postflop. Choisis 20bb ou plus.` : 'Spot impossible à ces réglages : change le stack ou la position.'; render(); return; }
    hand.hero = hero = line.hero;
    dealFromRanges(hand, line.st);
    hand.st = line.st;
    P.session.hands++;
    advance();
    return;
  }
  if (drill.id === 'full') {
    const deck = shuffledDeck();
    for (let p = 0; p < 6; p++) hand.hands[p] = [deck.pop(), deck.pop()].sort((a, b) => b - a);
    hand.boardCards = deck.slice(0, 5);
    hand.st = st;
    P.session.hands++;
    advance();
    return;
  }
  if (prog) st = prog.st;
  else {
    st = spotLine(drill.id, c, st, hero, vil);
    // Spots aléatoires: a line the random stack doesn't play (a min-raise at
    // 15bb, where the strategy shoves or folds) is dealt at 100bb instead.
    if (!st && P.cfg.drill === 'mix') {
      c = { ...c, stack: 100, bbDepth: 50 };
      st = spotLine(drill.id, c, initialState(drill.id === 'bb50' ? gameCfg(c) : { ...gameCfg(c), ...coverCfg(c.cover, hero) }), hero, vil);
    }
    if (!st) {
      P.session.hands++; hand.over = true;
      hand.result = `Ce spot n'existe pas dans la stratégie à ${c.stack}bb (à 15bb et moins, on ouvre à tapis ou on se couche, sans relance) : change le stack ou la position.`;
      render(); return;
    }
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
  if (hand.mode === 'full' && st.folded[hand.hero] && live.length > 1) hand.result = 'Tu es hors du coup.'; // the others' hand isn't played out
  else if (hand.mode === 'full') {
    if (live.length === 1) hand.result = `${POS[live[0]]} gagne ${num(pot(st))}bb`;
    else {
      let board = st.board.slice();
      if (board.length < 5) board = [...board, ...hand.boardCards.slice(board.length, 5)];
      const vals = live.map((p) => evalHand(hand.hands[p][0], hand.hands[p][1], board));
      const best = Math.max(...vals);
      const winners = live.filter((_, k) => vals[k] === best);
      hand.result = `${winners.map((p) => POS[p]).join(' & ')} ${winners.length > 1 ? 'partagent' : 'gagne'} ${num(pot(st))}bb à l'abattage`;
      hand.showdown = true;
    }
  }
  // Keep the hand for the replay ("Revoir").
  if (hand.decisions.length) {
    P.session.handsLog.unshift({
      t: new Date().toISOString(), drill: hand.drill, hero: hand.hero,
      cards: hand.hands.map((c) => (c ? c.map(cardStr).join('') : null)), shown: !!(hand.showdown || hand.mode === 'spot'),
      history: st.history.map((e) => (e.kind === 'deal' ? { s: e.street, d: e.cards.map(cardStr).join('') } : { p: e.p, s: e.street, l: e.label })),
      decisions: hand.decisions, result: hand.result, pot: pot(st),
      cfg: { stack: st.cfg.stack, ko: !!st.cfg.ko, stage: st.cfg.stage, multiway: !!st.cfg.multiway },
    });
  }
  if (P.session.decisionsCount) saveSession({ ...P.session }); // no empty session in Progression
  if (P.cfg.autoNext && !P.feedback?.pausing) setTimeout(() => { if (P.hand === hand) dealHand(); }, 1400);
}

// ---------- decisions ----------
function startDecision() {
  const hand = P.hand;
  hand.rng = rngMode() !== 'off' ? 1 + Math.floor(Math.random() * 100) : null;
  startTimer();
}
function startTimer() {
  const hand = P.hand;
  stopTimer();
  if (P.cfg.timebank) {
    P.timeLeft = P.cfg.timebank;
    P.timer = setInterval(() => {
      if (!root?.isConnected) { stopTimer(); return; } // on another page: no unseen auto-fold, renderPractice restarts it
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

// Grading by difficulty. Moyen: the most played action (or the one the RNG
// picks) is best, any action played 3.5%+ is correct. Facile: actions are
// grouped (fold / check-call / bet-raise) and a group played 50%+ is best,
// 20%+ correct. GTO max: only the RNG's action is best; another action the
// strategy mixes in is an inaccuracy.
export function gradeDecision(node, i, k, roll, dir, level = 'medium') {
  const f = comboFreqs(node, i);
  const ev = comboEVs(node, i);
  const Pt = pot(node.st);
  const maxK = f.indexOf(Math.max(...f));
  const bestK = roll ? rngAction(f, node.actions, roll, dir) : maxK;
  const fc = level === 'easy' ? simpleGroups(node).find((g) => g.ks.includes(k)).ks.reduce((a, j) => a + f[j], 0) : f[k];
  const good = ev.filter((_, j) => f[j] >= 0.05);
  const bestEV = good.length ? Math.max(...good) : ev[maxK];
  let loss = fc >= 0.05 ? 0 : Math.max(0, bestEV - ev[k]);
  if (fc < 0.05) loss = Math.max(loss, (1 - fc / 0.05) * 0.03 * Pt);
  let grade, score;
  if (level === 'easy' && fc >= 0.5) { grade = 'best'; score = 1; }
  else if (level === 'easy' && fc >= 0.2) { grade = 'correct'; score = 0.5 + 0.5 * fc; }
  else if (level === 'easy' && fc > 0.001) { grade = 'inaccuracy'; score = 0; }
  else if (level !== 'easy' && k === bestK) { grade = 'best'; score = 1; }
  else if (level === 'gto' && fc >= 0.035) { grade = 'inaccuracy'; score = 0.2; }
  else if (level !== 'easy' && fc >= 0.035) { grade = 'correct'; score = 0.5 + 0.5 * fc / f[maxK]; }
  else if (fc > 0.001) { grade = 'inaccuracy'; score = 0; }
  else if (loss / Pt < 0.05) { grade = 'wrong'; score = -0.3; }
  else { grade = 'blunder'; score = -Math.min(1, 0.3 + (2 * loss) / Pt); }
  return { f, ev, bestK, maxK, grade, score, loss };
}

// Plain-language reason behind the numbers: equity vs. the price, and the hand.
export function explain(node, i) {
  const st = node.st;
  const eq = node.equity(st.toAct)[i];
  const call = toCallOf(st, st.toAct);
  const parts = [];
  const info = node.info?.[i];
  if (info) parts.push(`Tu as : ${catFr(info.made).toLowerCase()}${info.draw ? ', avec ' + catFr(info.draw).toLowerCase() : ''}.`);
  const players = alive(st).length;
  if (Number.isFinite(eq)) parts.push(players > 2 ? `À ${players} joueurs, ta part estimée du pot est de ${pct(eq)} (la moyenne serait de ${Math.round(100 / players)} %).` : `Ton équité contre sa range est de ${pct(eq)}.`);
  if (call > 0 && st.raiseLevel > 0) parts.push(`Payer coûte ${num(call)}bb pour un pot de ${num(pot(st))}bb : il te faut environ ${pct(call / (pot(st) + call))} d'équité pour être rentable, avant position et mises futures.`);
  const firstIn = st.street === 0 && st.raiseLevel === 0 && !st.limpers.length && st.toAct <= 4 && st.cfg.stage !== 'hu';
  const cls = CLASSES[CLASS_OF_COMBO[i]];
  const mixNote = (b) => `mélangés à ${st.cfg.stack}bb (${Math.round((1 - b.t) * 100)} % / ${Math.round(b.t * 100)} %)`;
  const pf = pushFoldSpot(st);
  if (pf) {
    const s = pf.kind === 'push' ? pf.nash.push[pf.i] : pf.nash.call[pf.i][pf.j];
    parts.push(`Équilibre tapis / fold (Nash, chip EV) à ${st.cfg.stack}bb : ${pf.kind === 'push' ? 'tapis' : 'call'} ${pct(s[cls.id], 0)} du temps avec cette main.`);
  }
  if (firstIn && !pf) {
    const text = (code) => ({
      L: 'Loosifie (ouvre-la quand tu joues plus large)', T: 'Tightfie (jette-la quand tu joues plus serré)',
      X: 'moitié Raise, moitié Tightfie', H: 'raise ou limp, 50/50',
      R: 'toujours raise', A: 'tapis', a: 'tapis ou limp, 50/50', M: 'limp', m: 'limp ou fold, 50/50',
    }[code] || 'fold');
    const flex = (code) => 'LTX'.includes(code);
    const b = chartBlend(st.cfg.stack);
    if (b) {
      const lo = chartCodeAt(st.toAct, cls, b.lo), hi = chartCodeAt(st.toAct, cls, b.hi);
      parts.push(`Tes charts ${b.lo}bb (${text(lo)}) et ${b.hi}bb (${text(hi)}), ${mixNote(b)}.${flex(lo) || flex(hi) ? ` Style : ${getOpenStyle()}.` : ''}`);
    } else {
      const code = chartCode(st.toAct, cls, st.cfg.stack);
      parts.push(`Ton chart ${chartDepth(st.cfg.stack)}bb : ${text(code)}.${flex(code) ? ` Style : ${getOpenStyle()}.` : ''}`);
    }
  }
  const ch = bbChart(st);
  if (ch) {
    const label = ch.raiseLabel.toLowerCase();
    const text = (code) => ({
      R: label, B: '3bet light (relance en bluff)', C: 'call', K: 'check', F: 'fold',
      c: 'call ou fold, 50/50', r: `${label} ou call, 50/50`,
      A: 'tapis', a: 'tapis ou call, 50/50', j: `tapis ou ${label}, 50/50`, n: 'hors de ta range',
      q: st.raiseLevel === 0 ? `check, parfois ${label} (15 %)` : `call, parfois ${label} (15 %)`,
    }[code]);
    const codes = ch.parts.map((pt) => `${pt.depth}bb ${text(pt.chart.grid[cls.row][cls.col])}`);
    parts.push(ch.blend ? `Tes charts BB (${ch.title}) : ${codes.join(', ')}, ${mixNote(ch.blend)}.` : `Ton chart ${ch.parts[0].depth}bb (${ch.title}) : ${text(bbCode(ch, cls))}.`);
  }
  if (st.street === 0 && !firstIn && !ch && !pf) parts.push('Référence : pas de chart pour ce spot, c\'est le modèle Spotwise (le même que dans Étude).');
  return parts.join(' ');
}

function simpleGroups(node) {
  const groups = [
    { label: 'Fold', ks: [] }, { label: 'Check / Call', ks: [] }, { label: 'Mise / Relance', ks: [] },
  ];
  node.actions.forEach((a, k) => {
    const g = a.type === 'fold' ? 0 : a.type === 'check' || a.type === 'call' ? 1 : 2;
    groups[g].ks.push(k);
  });
  return groups.filter((g) => g.ks.length);
}

function heroAct(k, timedOut = false) {
  const hand = P.hand;
  if (!hand || hand.over || hand.st.needBoard || P.feedback?.pausing || k < 0) return;
  stopTimer();
  const st = hand.st;
  const node = analyze(st);
  const i = comboIndex(...hand.hands[hand.hero]);
  const g = gradeDecision(node, i, k, hand.rng, rngMode(), P.cfg.level);
  const units = getSettings().units;
  const labels = node.actions.map((a) => actionLabel(st, a, units));
  const rec = {
    t: new Date().toISOString(), drill: hand.drill, pos: POS[hand.hero], hand: comboStr(i), board: st.board.map(cardStr).join(''),
    street: STREETS[st.street], stack: st.cfg.stack, spot: practiceSpotKey(st), chosen: labels[k], best: labels[g.bestK], grade: g.grade, score: g.score, evLoss: g.loss, pot: pot(st),
    freqs: node.actions.map((a, j) => ({ label: labels[j], role: actionRole(st, a), f: g.f[j] })), timedOut,
    why: explain(node, i),
    // Study can't replay multiway raised pots, so those get no link.
    link: st.cfg.multiway ? null : studyLink(st),
  };
  const s = P.session;
  s.decisionsCount++;
  s.scoreSum += g.score;
  s.evLoss += g.loss;
  const mistake = !['best', 'correct'].includes(g.grade);
  if (mistake) s.mistakes++;
  s.decisions.unshift(rec);
  hand.decisions.push(rec);
  // Progression: XP, combo of good decisions, daily goal, badges.
  s.combo = mistake ? 0 : s.combo + 1;
  const prog = recordDecision({ grade: g.grade, street: rec.street, multiway: alive(st).length > 2, ko: !!st.cfg.ko }, s.combo);
  s.xp += prog.gained;
  celebrate(prog);
  const pausing = P.cfg.pause === 'always' || mistake;
  P.feedback = { rec, node, pausing, heroIdx: i, prog, combo: s.combo };
  hand.st = applyAction(st, node.actions[k]);
  if (hand.mode === 'spot') { finishHand(); render(); return; }
  if (pausing) { render(); return; }
  render();
  setTimeout(() => { if (P.hand === hand) advance(); }, 500);
}

function continueAfterFeedback() {
  const hand = P.hand;
  if (!hand || (!P.feedback && !hand.over)) return; // a hand can end without a decision (hero folded out by a raise, impossible spot)
  if (P.feedback) P.feedback = { ...P.feedback, pausing: false };
  if (hand.over || hand.mode === 'spot') { dealHand(); return; }
  advance();
}

// ---------- views ----------
const SEAT_SPOTS = [[50, 92], [9, 70], [9, 26], [50, 6], [91, 26], [91, 70]]; // % positions, hero first

function tableView() {
  const hand = P.hand;
  const st = hand.st;
  // st.street already moved on while the next card waits to be dealt.
  const street = st.needBoard ? st.street - 1 : st.street;
  const showAll = hand.over && (hand.showdown || hand.mode === 'spot');
  const seats = POS.map((_, k) => {
    const p = (hand.hero + k) % 6;
    const [x, y] = SEAT_SPOTS[k];
    const folded = st.folded[p];
    const cards = hand.hands[p];
    const faceUp = p === hand.hero || (showAll && !folded && cards);
    const bet = st.streetBet[p];
    // The player's last action this street (or his fold), shown big in its action colour.
    const last = folded ? { act: { type: 'fold' }, label: 'Fold' } : [...st.history].reverse().find((e) => e.kind === 'act' && e.p === p && e.street === street);
    const role = last && (last.act.type === 'fold' ? 'fold' : ['check', 'call'].includes(last.act.type) ? 'call' : last.act.type === 'allin' ? 'allin' : 'bet-m');
    const villain = p !== hand.hero && !folded;
    return h('div.seat' + (folded ? '.folded' : '') + (st.toAct === p && !hand.over && !st.needBoard ? '.acting' : '') + (p === hand.hero ? '.hero' : '') + (villain ? '.villain' : ''), { style: { left: x + '%', top: y + '%' } },
      h('div.seat-cards', folded ? null : (faceUp && cards ? cards.map((c) => PlayingCard(c, p === hand.hero ? 'lg' : 'sm')) : [PlayingCard(null, 'sm'), PlayingCard(null, 'sm')])),
      h('div.seat-plate', h('strong', POS[p]), h('span.mono', num(remaining(st, p)) + 'bb'), p === 3 ? h('span.dealer', { title: 'Donneur' }, 'D') : null),
      last ? h('div.seat-action', { style: { '--c': `var(--act-${role})` } }, last.label) : null,
      bet > 0 ? h('div.bet-chip', num(bet) + 'bb') : null);
  });
  const hero = hand.hero;
  const myTurn = !hand.over && st.toAct === hero && !st.needBoard && !P.feedback?.pausing;
  let bar;
  if (myTurn) {
    const node = analyze(st);
    const units = getSettings().units;
    if (P.cfg.level === 'easy') {
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
    bar = [h('button.btn.primary.lg', { type: 'button', on: { click: continueAfterFeedback } }, hand.over || hand.mode === 'spot' ? 'Main suivante' : 'Continuer', h('kbd', 'Espace'))];
  } else bar = [h('span.muted', 'Les autres joueurs réfléchissent…')];

  return h('section.table-area', { 'aria-label': 'Table de poker' },
    h('div.table-top', P.cfg.drill === 'mix' ? h('span.pill', '🎲 Aléatoire') : null, h('span.pill', DRILLS.find((d) => d.id === hand.drill).name), hand.spotTitle ? h('span.pill', hand.spotTitle) : null,
      h('span.pill', STREETS[street]), h('span.pill', st.cfg.stack + 'bb'), h('span.pill', LEVELS.find((l) => l.value === P.cfg.level).label),
      st.cfg.big != null ? h('span.pill', 'Tu couvres') : st.cfg.short != null ? h('span.pill', 'Tu es couvert') : null,
      hand.rng ? h('span.dice', { title: 'RNG roll' }, '🎲 ' + hand.rng) : null,
      P.cfg.timebank && myTurn ? h('span.timer', P.timeLeft + 's') : null,
      h('span.grow'), h('button.btn.ghost.sm', { type: 'button', on: { click: () => endSession() } }, 'Terminer la session')),
    h('div.felt-wrap', h('div.felt',
      h('div.felt-center', h('div.board', st.board.map((c) => PlayingCard(c, 'md'))), h('div.pot', 'Pot ', h('strong', num(pot(st)) + 'bb')),
        hand.result ? h('div.result', hand.result) : null),
      seats)),
    h('div.action-bar', { role: 'group', 'aria-label': 'Tes actions' }, bar),
    P.session.handsLog.length ? h('section.panel.played-hands', h('div.panel-title', 'Mains jouées'),
      h('div.hand-list', P.session.handsLog.slice(0, 15).map((log, k) => HandRow(log, () => showHandReplay(log, `Main ${P.session.handsLog.length - k}`))))) : null);
}

const GRADE_TEXT = { best: 'Meilleur coup', correct: 'Correct', inaccuracy: 'Imprécision', wrong: 'Erreur', blunder: 'Grosse erreur' };

function sideView() {
  const s = P.session;
  const score = s.decisionsCount ? s.scoreSum / s.decisionsCount : 0;
  const fb = P.feedback;
  const order = (fr) => fr.map((x, k) => k).sort((a, b) => b - a);
  const prog = getProgress();
  const lvl = levelOf(prog.xp);
  return h('aside.practice-side',
    h('section.panel.progress-strip',
      LevelBadge(lvl),
      h('div.grow', h('div.row.between', h('strong', `${lvl.icon} ${lvl.name}`), h('span.small.xp-gain', `+${s.xp} XP cette session`)), XpBar(prog.xp, { label: false })),
      h('div.combo' + (s.combo >= 3 ? '.hot' : ''), { title: 'Bonnes décisions d\'affilée' }, h('span', '🔥'), h('b', s.combo)),
      DailyRing(prog.days[today()] || 0, DAILY_GOAL, 40)),
    h('div.stats-row', StatTile('Score', pct(score, 0)), StatTile('Mains', s.hands), StatTile('Erreurs', s.mistakes), StatTile('EV perdue', num(s.evLoss, 2) + 'bb')),
    fb ? h('section.panel.feedback.grade-' + fb.rec.grade, { 'aria-live': 'polite' },
      h('div.row.between', h('strong.grade', GRADE_TEXT[fb.rec.grade]),
        h('span.row.gap', h('span.xp-pop', `+${fb.prog.gained} XP`), fb.prog.comboBonus ? h('span.xp-pop.bonus', `combo ×${fb.combo}`) : null,
          h('span.mono', fb.rec.evLoss > 0.005 ? '−' + num(fb.rec.evLoss, 2) + 'bb' : '±0bb'))),
      h('p.small', 'Tu as choisi ', h('strong', fb.rec.chosen), fb.rec.grade !== 'best' ? [' · le meilleur était ', h('strong', fb.rec.best)] : null, fb.rec.timedOut ? ' (temps écoulé)' : ''),
      fb.rec.why ? h('p.small.why', fb.rec.why) : null,
      h('div.small.muted', `Stratégie pour ${fb.rec.hand} :`),
      FreqBar(order(fb.rec.freqs).map((k) => ({ role: fb.rec.freqs[k].role, label: fb.rec.freqs[k].label, freq: fb.rec.freqs[k].f })), { height: 16, labels: true }),
      h('ul.freq-list', fb.rec.freqs.map((x) => h('li', h('span.swatch', { style: { background: `var(--act-${x.role})` } }), x.label, h('span.mono', pct(x.f, 1))))),
      learnGrid(fb)) : h('section.panel', h('p.muted', 'Prends une décision pour la comparer à la stratégie.')));
}

function learnGrid(fb) {
  const node = fb.node;
  const summ = classSummary(node);
  const units = getSettings().units;
  const roles = node.actions.map((a) => ({ role: actionRole(node.st, a), label: actionLabel(node.st, a, units) }));
  const order = node.actions.map((_, k) => k).sort((x, y) => aggression(node.actions[y]) - aggression(node.actions[x]));
  const sel = summ.findIndex((c) => c.cls.combos.includes(fb.heroIdx));
  return h('details.learn', h('summary', 'Voir toute la range'), RangeGrid({ cells: summ, roles, order, size: 'xs', selected: sel, label: 'Stratégie de la range à cette décision' }));
}

export function practiceKey(e) {
  if (!P.session || e.target.matches?.('input, select, textarea')) return false;
  const hand = P.hand;
  if (e.key === ' ' || e.key === 'Enter') {
    if (P.feedback?.pausing || hand?.over) { e.preventDefault(); continueAfterFeedback(); return true; }
  }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 9 && hand && !hand.over && !hand.st.needBoard && hand.st.toAct === hand.hero && !P.feedback?.pausing) {
    const node = analyze(hand.st);
    if (P.cfg.level === 'easy') {
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
