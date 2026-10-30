import { h, mount, pct, num, toast } from './dom.js';
import { RangeGrid, FreqBar, PlayingCard, Tabs, Segmented, cardPicker, randomCards } from './components.js';
import { CLASSES, COMBOS, cardStr, parseCard } from '../engine/cards.js';
import { MADE, DRAWS, catFr } from '../engine/evaluator.js';
import { weightedMean } from '../engine/equity.js';
import {
  POS, STREETS, replay, applyAction, dealBoard, foldTo, legalActions, actionLabel, actionRole,
  aggression, pot, toCallOf, remaining, opponentOf, alive, actionKey, STACKS, OPEN_SIZES, DEFAULT_CFG, STAGES,
} from '../engine/game.js';

const OPEN_LABELS = { limp: 'Limp 1bb', 2: '2bb', 2.5: '2.5bb (SB 3.5)', 4.5: '4.5bb' };
const STAGE_LABELS = { 100: 'Début (100 %)', 50: '50 % restants', 25: '25 % restants', 10: '10 % restants', semi: 'Demi-finale', ft: 'Table finale', hu: 'Heads-up' };
import {
  analyze, isCached, classSummary, overallFreqs, comboFreqs, comboEVs, classAverage, rangeCombos,
  chartCode, codeFreqs, getOpenStyle, setOpenStyle,
} from '../engine/strategy.js';
import { getSettings, setSetting } from '../store.js';
import { TAG_NAMES } from '../data/open-charts.js';
import { scenarioReport, requiredEquity, riskPremium, STAGE_SCENARIOS, stageBubbleFactor, MAX_PLAYERS } from '../engine/icm.js';

const ui = {
  cfg: DEFAULT_CFG,
  // Your own ICM table: stacks (you first) and prizes. When set, its bubble
  // factor replaces the stage's typical one.
  icm: { custom: false, stacks: [25, 30, 18, 40, 22, 15], payouts: [32, 22, 16, 12, 10, 8] },
  history: [],
  tab: 'strategy',
  metric: 'strategy',
  selected: null,
  hover: null,
  filterAction: -1,
  filterCat: null,
  bucket: null,
  sort: { col: 'weight', dir: -1 },
};
let root = null;

export function renderStudy(el) {
  root = el;
  const q = (k) => (location.hash.match(new RegExp(`[?&]${k}=([^&]*)`)) || [])[1];
  const stack = +q('s'), open = q('o'), stage = q('fs');
  if (STACKS.includes(stack) || OPEN_SIZES.includes(open) || q('f') || STAGES.includes(stage)) {
    ui.cfg = {
      stack: STACKS.includes(stack) ? stack : ui.cfg.stack,
      open: OPEN_SIZES.includes(open) ? open : ui.cfg.open,
      ko: q('f') === 'ko',
      stage: STAGES.includes(stage) ? stage : DEFAULT_CFG.stage,
    };
  }
  const ic = parseList((q('ic') || '').replace(/-/g, ' ')), ip = parseList((q('ip') || '').replace(/-/g, ' '));
  if (ic.length >= 2 && ip.length) ui.icm = { custom: true, stacks: ic, payouts: ip };
  applyIcm();
  if (q('l')) ui.history = decodeLine(q('l'));
  render();
}

// "25 30 18,5 40" or "25; 30; 18" -> numbers (a comma inside a number is a decimal comma).
function parseList(s) {
  return String(s).replace(/,\s/g, ' ').split(/[\s;/]+/).filter(Boolean)
    .flatMap((t) => ((t.match(/,/g) || []).length > 1 ? t.split(',') : [t]))
    .map((t) => parseFloat(t.replace(',', '.'))).filter((x) => Number.isFinite(x) && x >= 0);
}

// The custom scenario's bubble factor goes into the spot config (and the cache key).
function applyIcm() {
  const { bf, ...rest } = ui.cfg;
  ui.cfg = ui.icm.custom ? { ...rest, bf: scenarioReport(ui.icm.stacks, ui.icm.payouts).bf } : rest;
}

function setHistory(hist) {
  ui.history = hist;
  ui.filterAction = -1;
  ui.filterCat = null;
  ui.bucket = null;
  const params = [];
  if (ui.cfg.stack !== DEFAULT_CFG.stack) params.push('s=' + ui.cfg.stack);
  if (ui.cfg.open !== DEFAULT_CFG.open) params.push('o=' + ui.cfg.open);
  if (ui.cfg.ko) params.push('f=ko');
  if (ui.cfg.stage !== DEFAULT_CFG.stage) params.push('fs=' + ui.cfg.stage);
  if (ui.icm.custom) params.push('ic=' + ui.icm.stacks.join('-'), 'ip=' + ui.icm.payouts.join('-'));
  if (hist.length) params.push('l=' + encodeLine(hist));
  history.replaceState(null, '', '#/study' + (params.length ? '?' + params.join('&') : ''));
  render();
}

// Changing the stack, open size or format keeps as much of the line as still
// exists. Going in or out of heads-up starts over: the seats are different.
function setCfg(patch) {
  const line = encodeLine(ui.history);
  const seatsChange = 'stage' in patch && (patch.stage === 'hu') !== (ui.cfg.stage === 'hu');
  ui.cfg = { ...ui.cfg, ...patch };
  setHistory(line && !seatsChange ? decodeLine(line) : []);
}

// The line lives in the URL so a refresh or a shared link reopens the spot.
// Format: "3R2.5_4F_5C_d2c7dKs" = seat + action key, or d + board cards.
function encodeLine(hist) {
  return hist.map((e) => (e.kind === 'deal' ? 'd' + e.cards.map(cardStr).join('') : e.p + actionKey(e.act))).join('_');
}

function decodeLine(str) {
  let st = replay([], ui.cfg);
  for (const tok of str.split('_')) {
    if (tok[0] === 'd') {
      const cards = (tok.slice(1).match(/../g) || []).map(parseCard);
      if (cards.length !== st.needBoard || cards.some((c) => c < 0 || st.board.includes(c))) break;
      st = dealBoard(st, cards);
    } else {
      const act = legalActions(st).find((a) => +tok[0] === st.toAct && actionKey(a) === tok.slice(1));
      if (!act) break;
      st = applyAction(st, act);
    }
  }
  return st.history;
}

function render() {
  if (!root) return;
  const st = replay(ui.history, ui.cfg);
  const decision = !st.terminal && !st.needBoard && st.toAct >= 0;
  const head = spotBar(st);
  if (decision && !isCached(st)) {
    mount(root, head, h('div.study-main', h('div.panel.loading', { 'aria-busy': 'true' }, h('div.spinner'), 'Calcul de la stratégie…')));
    setTimeout(() => { analyze(st); if (stateKeyNow() === st.history.length) render(); }, 20);
    return;
  }
  if (!decision) {
    mount(root, head, h('div.study-main', nonDecision(st)));
    return;
  }
  const node = analyze(st);
  mount(root, head, h('div.study-main',
    h('section.study-left', { 'aria-label': 'Vue stratégie' }, toolbar(node), mainView(node)),
    h('aside.study-side', infoBox(node), icmPanel(), chartPanel(node), actionsTable(node), handDetail(node), categoryFilters(node))));
}
const stateKeyNow = () => ui.history.length;

// ---------- spot bar / action line ----------
function spotBar(st) {
  const units = getSettings().units;
  const chips = [];
  let replaySt = replay([], ui.cfg);
  ui.history.forEach((e, i) => {
    if (e.kind === 'deal') {
      chips.push(h('button.chip.board', { type: 'button', title: 'Changer le board', on: { click: () => setHistory(ui.history.slice(0, i)) } },
        h('span.chip-pos', STREETS[e.street]), h('span.cards', e.cards.map((c) => PlayingCard(c, 'xs')))));
      replaySt = dealBoard(replaySt, e.cards);
    } else {
      const role = actionRole(replaySt, e.act);
      if (e.act.type !== 'fold' || replaySt.street > 0 || replaySt.raiseLevel > 0) {
        chips.push(h('button.chip', { type: 'button', title: 'Revenir à cette décision', on: { click: () => setHistory(ui.history.slice(0, i)) } },
          h('span.chip-pos', POS[e.p]), h('span.chip-act', { style: { color: `var(--act-${role})` } }, actionLabel(replaySt, e.act, units))));
      }
      replaySt = applyAction(replaySt, e.act);
    }
  });
  if (st.terminal) {
    chips.push(h('span.chip.current', st.terminal === 'fold' ? `${POS[st.winner]} remporte le pot` : 'Showdown'));
  } else if (st.needBoard) {
    chips.push(h('span.chip.current', h('span.chip-pos', STREETS[st.street]), h('span.muted', 'choisis les cartes')));
  } else {
    const acts = legalActions(st);
    chips.push(h('div.chip.current', h('span.chip-pos', POS[st.toAct]),
      h('span.chip-actions', acts.map((a) => h('button.act-btn', {
        type: 'button', style: { '--c': `var(--act-${actionRole(st, a)})` },
        on: { click: () => setHistory([...ui.history, { kind: 'act', p: st.toAct, act: a }]) },
      }, actionLabel(st, a, units))))));
    // Unopened pot: jump straight to a later position.
    if (st.street === 0 && st.raiseLevel === 0) {
      for (let p = st.toAct + 1; p < 5; p++) {
        chips.push(h('button.chip.future', { type: 'button', title: `Fold jusqu'au ${POS[p]}`, on: { click: () => setHistory(foldTo(st, p).history) } }, POS[p]));
      }
    }
  }
  return h('header.spotbar',
    h('div.spot-format', h('span.pill', ui.cfg.stage === 'hu' ? 'Heads-up' : '6-max'),
      h('label.pick-field', 'Format',
        h('select', { 'aria-label': 'Format du tournoi', on: { change: (e) => setCfg({ ko: e.target.value === 'ko' }) } },
          [['classic', 'Classique'], ['ko', 'KO (bounty)']].map(([v, l]) => h('option', { value: v, selected: (v === 'ko') === !!ui.cfg.ko }, l)))),
      h('label.pick-field', 'Field restant',
        h('select', { 'aria-label': 'Field restant', on: { change: (e) => setCfg({ stage: e.target.value }) } },
          STAGES.map((s) => h('option', { value: s, selected: s === ui.cfg.stage }, STAGE_LABELS[s])))),
      h('label.pick-field', 'Stack',
        h('select', { 'aria-label': 'Stack effectif', on: { change: (e) => setCfg({ stack: +e.target.value }) } },
          STACKS.map((s) => h('option', { value: String(s), selected: s === ui.cfg.stack }, s + 'bb')))),
      h('label.pick-field', 'Open',
        h('select', { 'aria-label': 'Taille d\'open', on: { change: (e) => setCfg({ open: e.target.value }) } },
          OPEN_SIZES.map((o) => h('option', { value: o, selected: o === ui.cfg.open }, o === '2.5' && ui.cfg.stage === 'hu' ? '2.5bb' : OPEN_LABELS[o]))))),
    h('nav.line', { 'aria-label': 'Ligne d\'action' },
      h('button.chip.root', { type: 'button', title: 'Revenir au début', on: { click: () => setHistory([]) } }, '⟲'),
      chips));
}

function nonDecision(st) {
  if (st.needBoard) {
    const n = st.needBoard;
    const name = STREETS[st.street];
    const pick = (cards) => setHistory([...ui.history, { kind: 'deal', street: st.street, cards }]);
    return h('div.panel.center-panel',
      h('h2', `Distribuer le ${name.toLowerCase()}`),
      h('p.muted', `${alive(st).map((p) => POS[p]).join(' vs ')} · pot ${num(pot(st))}bb`),
      st.board.length ? h('div.board', st.board.map((c) => PlayingCard(c, 'md'))) : null,
      h('div.row.gap.center',
        h('button.btn.primary', { type: 'button', on: { click: () => cardPicker({ title: `Choisir le ${name.toLowerCase()}`, count: n, used: st.board, onDone: pick }) } }, `Choisir le ${name.toLowerCase()}`),
        h('button.btn.secondary', { type: 'button', on: { click: () => pick(randomCards(n, st.board)) } }, 'Au hasard')));
  }
  return h('div.panel.center-panel',
    h('h2', st.terminal === 'fold' ? `${POS[st.winner]} remporte le coup` : 'Showdown'),
    h('p.muted', `Pot final ${num(pot(st))}bb. Reviens en arrière dans la ligne ci-dessus pour étudier une autre branche.`),
    h('button.btn.secondary', { type: 'button', on: { click: () => setHistory(ui.history.slice(0, -1)) } }, 'Revenir d\'un cran'));
}

// ---------- toolbar ----------
function toolbar(node) {
  const tabs = Tabs([
    { id: 'strategy', label: 'Stratégie', hotkey: '1' },
    { id: 'ranges', label: 'Ranges', hotkey: '2' },
    { id: 'summary', label: 'Résumé', hotkey: '3' },
  ], ui.tab, (t) => { ui.tab = t; render(); });
  const right = ui.tab === 'strategy'
    ? Segmented('Mesure', [{ value: 'strategy', label: 'Stratégie' }, { value: 'equity', label: 'Équité' }, { value: 'ev', label: 'EV' }], ui.metric, (m) => { ui.metric = m; render(); })
    : null;
  const clear = (ui.filterAction >= 0 || ui.filterCat || ui.bucket)
    ? h('button.btn.ghost.sm', { type: 'button', on: { click: clearFilters } }, 'Effacer les filtres ', h('kbd', 'P'))
    : null;
  return h('div.toolbar', tabs, h('div.row.gap', clear, right));
}
function clearFilters() { ui.filterAction = -1; ui.filterCat = null; ui.bucket = null; render(); }

function roles(node) {
  const units = getSettings().units;
  return node.actions.map((a) => ({ role: actionRole(node.st, a), label: actionLabel(node.st, a, units) }));
}
const orderOf = (node) => node.actions.map((a, k) => k).sort((x, y) => aggression(node.actions[y]) - aggression(node.actions[x]));

function catDim(node) {
  if (!ui.filterCat || !node.info) return null;
  const w = node.ranges[node.actor];
  return (idx) => !CLASSES[idx].combos.some((i) => w[i] > 0 && node.info[i] && (node.info[i].made === ui.filterCat || node.info[i].draw === ui.filterCat));
}

function evOfCombo(node, i) {
  const f = comboFreqs(node, i), ev = comboEVs(node, i);
  return f.reduce((s, x, k) => s + x * ev[k], 0);
}

function mainView(node) {
  const s = getSettings();
  if (ui.tab === 'ranges') return rangesView(node);
  if (ui.tab === 'summary') return summaryView(node);
  const summ = classSummary(node);
  let cells = summ, mode = 'strategy';
  if (ui.metric === 'equity') {
    const eq = node.equity(node.actor);
    cells = summ.map((c) => { const v = classAverage(eq, node, node.actor, c.cls); return { ...c, heat: v, text: Number.isFinite(v) ? Math.round(v * 100) + '' : '' }; });
    mode = 'heat';
  } else if (ui.metric === 'ev') {
    const P = pot(node.st);
    const evs = new Float32Array(1326).fill(NaN);
    const w = node.ranges[node.actor];
    for (let i = 0; i < 1326; i++) if (w[i] > 0) evs[i] = evOfCombo(node, i);
    cells = summ.map((c) => { const v = classAverage(evs, node, node.actor, c.cls); return { ...c, heat: (v / P + 0.1) / 0.9, text: Number.isFinite(v) ? v.toFixed(1) : '' }; });
    mode = 'heat';
  }
  const dimCat = catDim(node);
  return h('div.grid-wrap', RangeGrid({
    cells, roles: roles(node), order: orderOf(node), mode, gridMode: s.gridMode, showNumbers: s.cellNumbers,
    selected: ui.selected, hover: ui.hover, filterAction: ui.filterAction, dim: dimCat,
    label: `${POS[node.actor]} strategy`,
    marks: isFirstIn(node) ? (i) => { const k = chartCode(node.actor, CLASSES[i]); return 'LTXH'.includes(k) ? k : null; } : null,
    onHover: (i) => { if (ui.hover !== i) { ui.hover = i; refreshDetail(node); } },
    onSelect: (i) => { ui.selected = ui.selected === i ? null : i; render(); },
  }));
}

function refreshDetail(node) {
  const old = root.querySelector('.hand-detail');
  if (old) old.replaceWith(handDetail(node));
  root.querySelectorAll('.cell.hovered').forEach((c) => c.classList.remove('hovered'));
  const cell = root.querySelector('.study-left .rgrid')?.children[ui.hover];
  cell?.classList.add('hovered');
}

// ---------- ranges tab ----------
function rangesView(node) {
  const st = node.st;
  const a = node.actor;
  const o = opponentOf(st, a);
  const players = o >= 0 ? [a, o] : [a];
  const buckets = [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1.01]];
  const panels = players.map((p) => {
    const w = node.ranges[p];
    const eq = node.equity(p);
    const summ = classSummary(node, p);
    const dim = ui.bucket ? (idx) => { const v = classAverage(eq, node, p, CLASSES[idx]); return !(v >= ui.bucket[0] && v < ui.bucket[1]); } : null;
    return h('div.range-panel',
      h('div.range-head', h('strong', POS[p] + (p === a ? ' (à jouer)' : '')),
        h('span.muted', `${num(rangeCombos(w), 0)} combos`), h('span.muted', `EQ ${pct(weightedMean(eq, w), 1)}`)),
      RangeGrid({ cells: summ, roles: [], order: [], mode: 'range', dim, size: 'sm', label: `${POS[p]} range` }),
      h('button.btn.ghost.sm', { type: 'button', on: { click: () => copyRange(p, w) } }, 'Copier la range'));
  });
  return h('div',
    h('div.row.gap.wrap', h('span.muted', 'Tranche d\'équité :'), buckets.map((b) => h('button.btn.sm' + (ui.bucket && ui.bucket[0] === b[0] ? '.primary' : '.secondary'), {
      type: 'button', on: { click: () => { ui.bucket = ui.bucket && ui.bucket[0] === b[0] ? null : b; render(); } },
    }, `${b[0] * 100}–${Math.min(100, b[1] * 100)}%`))),
    h('div.ranges', panels));
}

function copyRange(p, w) {
  const parts = [];
  for (const c of CLASSES) {
    const live = c.combos.filter((i) => w[i] > 0);
    if (!live.length) continue;
    const avg = live.reduce((s, i) => s + w[i], 0) / c.combos.length;
    if (avg > 0.005) parts.push(avg > 0.995 ? c.name : `${c.name}:${avg.toFixed(3)}`);
  }
  navigator.clipboard?.writeText(parts.join(',')).then(() => toast(`Range ${POS[p]} copiée`), () => toast('Presse-papiers indisponible'));
}

// ---------- summary tab ----------
function summaryView(node) {
  const eq = node.equity(node.actor);
  const w = node.ranges[node.actor];
  const P = pot(node.st);
  const rs = roles(node);
  const rows = classSummary(node).filter((c) => c.weight > 0.005).map((c) => {
    const evs = new Float32Array(1326).fill(NaN);
    for (const i of c.cls.combos) if (w[i] > 0) evs[i] = evOfCombo(node, i);
    const ev = classAverage(evs, node, node.actor, c.cls);
    return { ...c, eq: classAverage(eq, node, node.actor, c.cls), ev, evp: ev / P };
  });
  const { col, dir } = ui.sort;
  rows.sort((x, y) => ((x[col] ?? 0) - (y[col] ?? 0)) * dir || x.cls.id - y.cls.id);
  const th = (id, label) => h('th', { 'aria-sort': col === id ? (dir > 0 ? 'ascending' : 'descending') : 'none' },
    h('button.th-btn', { type: 'button', on: { click: () => { ui.sort = { col: id, dir: col === id ? -dir : -1 }; render(); } } }, label, col === id ? (dir > 0 ? ' ▲' : ' ▼') : ''));
  return h('div.table-wrap', h('table.data',
    h('thead', h('tr', h('th', 'Main'), th('combos', 'Combos'), h('th', 'Stratégie'), th('eq', 'EQ'), th('ev', 'EV (bb)'), th('evp', 'EV / pot'))),
    h('tbody', rows.map((r) => h('tr', { on: { click: () => { ui.selected = r.cls.id; ui.tab = 'strategy'; render(); } } },
      h('td.mono', r.cls.name), h('td', num(r.combos, 1)),
      h('td', FreqBar(orderOf(node).map((k) => ({ ...rs[k], freq: r.freqs[k] })), { height: 8 })),
      h('td', pct(r.eq, 1)), h('td', num(r.ev, 2)), h('td', pct(r.evp, 0)))))));
}

// ---------- side panels ----------
const dec = (x, d = 2) => x.toFixed(d).replace('.', ',');
const pctFr = (x, d = 1) => dec(x * 100, d) + ' %';

// ICM and bubble factor: the stage's typical spot, or your own table.
function icmPanel() {
  const stage = ui.cfg.stage || '100';
  const sc = STAGE_SCENARIOS[stage];
  const custom = ui.icm.custom;
  const bf = custom ? ui.cfg.bf : stageBubbleFactor(stage);
  const narrower = 1 - bf ** -0.8;
  const setMode = (m) => {
    ui.icm = { ...ui.icm, custom: m === 'custom' };
    applyIcm();
    setHistory(ui.history);
  };
  const body = [
    Segmented('Scénario ICM', [{ value: 'stage', label: 'Typique du stade' }, { value: 'custom', label: 'Ma table' }], custom ? 'custom' : 'stage', setMode),
    h('div.icm-bf',
      h('div', h('div.small.muted', 'Bubble factor'), h('div.icm-big.' + (bf >= 1.3 ? 'neg' : bf > 1.05 ? 'warn' : 'pos'), dec(bf))),
      h('div', h('div.small.muted', 'Équité pour payer un tapis à 50/50'), h('div.icm-big', pctFr(requiredEquity(bf))), h('div.small.muted', `risk premium +${pctFr(riskPremium(bf))}`))),
    h('p.small', bf > 1.005
      ? `Perdre un jeton te coûte ${dec(bf)} fois plus que ne te rapporte un jeton gagné. Tes ranges face à une relance ou un tapis sont donc ${Math.round(narrower * 100)} % plus serrées${ui.cfg.ko ? ', puis élargies par les primes (KO)' : ''}.`
      : `Un jeton perdu coûte autant qu'un jeton gagné : pas d'ajustement ICM${ui.cfg.ko ? ' (les primes KO élargissent quand même tes ranges)' : ''}.`),
  ];
  if (!custom) body.push(h('p.small.muted', sc.label));
  else body.push(...customIcm());
  return h('section.panel.icm-panel', { 'aria-label': 'ICM et bubble factor' }, h('div.panel-title', 'ICM & bubble factor'), body);
}

function customIcm() {
  const { stacks, payouts } = ui.icm;
  const update = (key) => (e) => {
    const list = parseList(e.target.value);
    if (key === 'stacks' && (list.length < 2 || list.length > MAX_PLAYERS || list.some((x) => x <= 0))) { toast(`Entre de 2 à ${MAX_PLAYERS} tapis, tous supérieurs à 0`); return; }
    if (key === 'payouts' && !list.some((x) => x > 0)) { toast('Entre au moins un prix'); return; }
    ui.icm = { ...ui.icm, [key]: list };
    applyIcm();
    setHistory(ui.history);
  };
  const r = scenarioReport(stacks, payouts);
  const share = (x) => (r.pool ? x / r.pool : 0);
  return [
    h('label.field.icm-input', h('span.small.muted', 'Tapis en bb (toi en premier)'),
      h('input.text', { type: 'text', value: stacks.join(' '), placeholder: '25 30 18 40 22 15', on: { change: update('stacks') } })),
    h('label.field.icm-input', h('span.small.muted', 'Prix du 1er au dernier payé (€ ou %)'),
      h('input.text', { type: 'text', value: payouts.join(' '), placeholder: '32 22 16 12 10 8', on: { change: update('payouts') } })),
    h('table.data.compact.icm-table',
      h('thead', h('tr', h('th', ''), h('th', 'Tapis'), h('th', 'Jetons'), h('th', 'Équité ICM'), h('th', { title: 'Ton bubble factor si tu joues un tapis contre ce joueur' }, 'BF'))),
      h('tbody', stacks.map((s, i) => h('tr' + (i === 0 ? '.me' : ''),
        h('td', i === 0 ? 'Toi' : 'J' + (i + 1)), h('td.mono', dec(s, s % 1 ? 1 : 0)), h('td.mono', pctFr(s / r.chips)),
        h('td.mono', pctFr(share(r.eq[i]))),
        h('td.mono', i === 0 ? '–' : dec(r.vs[i - 1].bf)))))),
    h('p.small.muted', `Bubble factor utilisé : la moyenne contre les ${stacks.length - 1} adversaires. Le « Stack » en haut règle toujours la profondeur du spot étudié.`),
  ];
}

function infoBox(node) {
  const st = node.st, p = node.actor;
  const P = pot(st), call = toCallOf(st, p);
  const rem = Math.min(...alive(st).map((x) => remaining(st, x)));
  return h('section.panel.infobox', { 'aria-label': 'Infos du spot' },
    h('div.row.between', h('strong', `${POS[p]} doit jouer`), h('span.pill', STREETS[st.street])),
    st.board.length ? h('div.board', st.board.map((c) => PlayingCard(c, 'sm'))) : null,
    h('dl.kv',
      h('dt', 'Pot'), h('dd', num(P) + 'bb'),
      h('dt', 'À payer'), h('dd', call ? num(call) + 'bb' : '–'),
      h('dt', 'Cote du pot'), h('dd', call ? pct(call / (P + call), 1) : '–'),
      h('dt', 'Stack eff.'), h('dd', num(rem) + 'bb'),
      h('dt', 'SPR'), h('dd', num(rem / P, 1))));
}

function actionsTable(node) {
  const { freqs, combos } = overallFreqs(node);
  const rs = roles(node);
  return h('section.panel', { 'aria-label': 'Actions' },
    h('div.panel-title', 'Actions'),
    FreqBar(orderOf(node).map((k) => ({ ...rs[k], freq: freqs[k] })), { height: 14, labels: true }),
    h('ul.actions', orderOf(node).map((k) => h('li', h('button.action-row' + (ui.filterAction === k ? '.on' : ''), {
      type: 'button', 'aria-pressed': ui.filterAction === k ? 'true' : 'false',
      on: { click: () => { ui.filterAction = ui.filterAction === k ? -1 : k; render(); } },
    }, h('span.swatch', { style: { background: `var(--act-${rs[k].role})` } }), h('span.grow', rs[k].label),
      h('span.mono', pct(freqs[k], 1)), h('span.mono.muted', num(combos[k], 0) + ' c'))))));
}

function handDetail(node) {
  const idx = ui.selected ?? ui.hover;
  const box = h('section.panel.hand-detail', { 'aria-live': 'polite' });
  if (idx == null) { box.append(h('div.panel-title', 'Main'), h('p.muted', 'Survole ou clique une main dans la grille.')); return box; }
  const cls = CLASSES[idx];
  const w = node.ranges[node.actor];
  const rs = roles(node);
  const order = orderOf(node);
  const live = cls.combos.filter((i) => !node.dead[COMBOS[i][0]] && !node.dead[COMBOS[i][1]]);
  const inRange = live.filter((i) => w[i] > 0.001);
  box.append(h('div.panel-title.row.between', h('span', cls.name, ui.selected === idx ? h('span.pill', 'épinglée') : null), h('span.muted', `${inRange.length}/${live.length} combos dans la range`)));
  if (!inRange.length) { box.append(h('p.muted', 'Pas dans la range de ce joueur à ce moment.')); return box; }
  const eq = node.equity(node.actor);
  if (node.st.street === 0) {
    const i = inRange[0];
    const f = comboFreqs(node, i), ev = comboEVs(node, i);
    box.append(FreqBar(order.map((k) => ({ ...rs[k], freq: f[k] })), { height: 16, labels: true }),
      h('table.mini', h('tbody', order.map((k) => h('tr', h('td', h('span.swatch', { style: { background: `var(--act-${rs[k].role})` } }), ' ', rs[k].label), h('td.mono', pct(f[k], 1)), h('td.mono.muted', 'EV ' + num(ev[k], 2)))))),
      h('p.muted.small', `Équité ${pct(classAverage(eq, node, node.actor, cls), 1)} · poids ${pct(w[i], 0)}`),
      isFirstIn(node) && TAG_NAMES[chartCode(node.actor, cls)] ? h('p.small.tag-note', 'Dans ton chart : ', h('strong', TAG_NAMES[chartCode(node.actor, cls)])) : null);
  } else {
    box.append(h('div.combo-list', inRange.slice(0, 16).map((i) => {
      const f = comboFreqs(node, i);
      const info = node.info?.[i];
      return h('div.combo-row',
        h('span.cards', COMBOS[i].map((c) => PlayingCard(c, 'xs'))),
        FreqBar(order.map((k) => ({ ...rs[k], freq: f[k] })), { height: 10 }),
        h('span.mono.small', pct(eq[i], 0)),
        h('span.small.muted', info ? catFr(info.made) + (info.draw ? ' + ' + catFr(info.draw) : '') : ''));
    })));
  }
  return box;
}

const isFirstIn = (node) => node.st.street === 0 && node.st.raiseLevel === 0 && node.actor <= 4 && node.st.cfg.stage !== 'hu';

// The user's open chart for this seat: its zones and the style that decides
// how the flex zones (Loosifie / Tightfie) are played.
function chartPanel(node) {
  if (!isFirstIn(node)) return null;
  const p = node.actor;
  const share = {};
  for (const c of CLASSES) {
    const k = chartCode(p, c);
    share[k] = (share[k] || 0) + c.combos.length / 1326;
  }
  const open = node.actions.find((a) => a.type === 'raise' || a.type === 'allin');
  const raiseLabel = open ? `Raise ${open.to}` : 'Limp (taille d\'open)';
  const rows = p === 4
    ? [[raiseLabel, 'R', 'var(--act-bet-m)'], ['Raise / Limp', 'H', null], ['Limp', 'M', 'var(--act-call)'], ['Fold', 'F', 'var(--act-fold)']]
    : [[raiseLabel, 'R', 'var(--act-bet-m)'], ['Raise / Tightfie', 'X', null], ['Tightfie', 'T', 'var(--tag-tight)'], ['Loosifie', 'L', 'var(--tag-loose)'], ['Fold', 'F', 'var(--act-fold)']];
  const style = getOpenStyle();
  return h('section.panel.chart-panel', { 'aria-label': 'Ton chart d\'open' },
    h('div.panel-title', `Ton chart · ${POS[p]} first in`),
    node.st.cfg.stack !== 100 ? h('p.small.muted', `Tes charts sont faits pour 100bb ; à ${node.st.cfg.stack}bb ils sont appliqués tels quels.`) : null,
    h('ul.chart-rows', rows.filter(([, k]) => share[k]).map(([label, k, color]) => h('li',
      color ? h('span.swatch', { style: { background: color } }) : h('span.swatch.mark-' + k),
      label, h('span.mono', pct(share[k], 1))))),
    p === 4 ? null : Segmented('Style d\'open', [
      { value: 'tight', label: 'Tight' }, { value: 'standard', label: 'Standard' }, { value: 'loose', label: 'Loose' },
    ], style, (v) => { setSetting('openStyle', v); setOpenStyle(v); render(); }),
    p === 4 ? null : h('p.small.muted', style === 'tight' ? 'Tight : les mains Tightfie se couchent.' : style === 'loose' ? 'Loose : les mains Loosifie s\'ouvrent aussi.' : 'Standard : les mains Tightfie s\'ouvrent, les Loosifie se couchent.'));
}

function categoryFilters(node) {
  if (!node.info) return null;
  const w = node.ranges[node.actor];
  const share = {};
  let tot = 0;
  for (let i = 0; i < 1326; i++) {
    const inf = node.info[i];
    if (!inf || w[i] <= 0) continue;
    tot += w[i];
    share[inf.made] = (share[inf.made] || 0) + w[i];
    if (inf.draw) share[inf.draw] = (share[inf.draw] || 0) + w[i];
  }
  const rows = [...MADE, ...DRAWS].filter((c) => share[c] > 0);
  return h('section.panel', { 'aria-label': 'Catégories de mains' },
    h('div.panel-title', 'Catégories de mains'),
    h('ul.cats', rows.map((c) => h('li', h('button.cat-row' + (ui.filterCat === c ? '.on' : ''), {
      type: 'button', 'aria-pressed': ui.filterCat === c ? 'true' : 'false',
      on: { click: () => { ui.filterCat = ui.filterCat === c ? null : c; render(); } },
    }, h('span.grow', catFr(c)), h('span.catbar', h('span', { style: { width: (share[c] / tot) * 100 + '%' } })), h('span.mono.small', pct(share[c] / tot, 1)))))));
}

// ---------- hotkeys ----------
export function studyKey(e) {
  if (e.target.matches?.('input, select, textarea')) return false;
  if (e.key === '1') { ui.tab = 'strategy'; render(); return true; }
  if (e.key === '2') { ui.tab = 'ranges'; render(); return true; }
  if (e.key === '3') { ui.tab = 'summary'; render(); return true; }
  if (e.key === 'p' || e.key === 'P') { clearFilters(); return true; }
  if (e.key === 'Backspace' && ui.history.length) { setHistory(ui.history.slice(0, -1)); return true; }
  if (e.key === ' ' && !e.target.matches?.('button')) { setSetting('units', getSettings().units === 'bb' ? 'pct' : 'bb'); render(); return true; }
  return false;
}

export function rerenderStudy() { render(); }
