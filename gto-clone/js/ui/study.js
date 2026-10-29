import { h, mount, pct, num, toast } from './dom.js';
import { RangeGrid, FreqBar, PlayingCard, Tabs, Segmented, cardPicker, randomCards } from './components.js';
import { CLASSES, COMBOS, cardStr, parseCard } from '../engine/cards.js';
import { MADE, DRAWS } from '../engine/evaluator.js';
import { weightedMean } from '../engine/equity.js';
import {
  POS, STREETS, replay, applyAction, dealBoard, foldTo, legalActions, actionLabel, actionRole,
  aggression, pot, toCallOf, remaining, opponentOf, alive, actionKey,
} from '../engine/game.js';
import {
  analyze, isCached, classSummary, overallFreqs, comboFreqs, comboEVs, classAverage, rangeCombos,
} from '../engine/strategy.js';
import { getSettings, setSetting } from '../store.js';

const ui = {
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
  const m = location.hash.match(/[?&]l=([^&]*)/);
  if (m) ui.history = decodeLine(m[1]);
  render();
}

function setHistory(hist) {
  ui.history = hist;
  ui.filterAction = -1;
  ui.filterCat = null;
  ui.bucket = null;
  history.replaceState(null, '', '#/study' + (hist.length ? '?l=' + encodeLine(hist) : ''));
  render();
}

// The line lives in the URL so a refresh or a shared link reopens the spot.
// Format: "3R2.5_4F_5C_d2c7dKs" = seat + action key, or d + board cards.
function encodeLine(hist) {
  return hist.map((e) => (e.kind === 'deal' ? 'd' + e.cards.map(cardStr).join('') : e.p + actionKey(e.act))).join('_');
}

function decodeLine(str) {
  let st = replay([]);
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
  const st = replay(ui.history);
  const decision = !st.terminal && !st.needBoard && st.toAct >= 0;
  const head = spotBar(st);
  if (decision && !isCached(st)) {
    mount(root, head, h('div.study-main', h('div.panel.loading', { 'aria-busy': 'true' }, h('div.spinner'), 'Computing strategy…')));
    setTimeout(() => { analyze(st); if (stateKeyNow() === st.history.length) render(); }, 20);
    return;
  }
  if (!decision) {
    mount(root, head, h('div.study-main', nonDecision(st)));
    return;
  }
  const node = analyze(st);
  mount(root, head, h('div.study-main',
    h('section.study-left', { 'aria-label': 'Strategy view' }, toolbar(node), mainView(node)),
    h('aside.study-side', infoBox(node), actionsTable(node), handDetail(node), categoryFilters(node))));
}
const stateKeyNow = () => ui.history.length;

// ---------- spot bar / action line ----------
function spotBar(st) {
  const units = getSettings().units;
  const chips = [];
  let replaySt = replay([]);
  ui.history.forEach((e, i) => {
    if (e.kind === 'deal') {
      chips.push(h('button.chip.board', { type: 'button', title: 'Change board', on: { click: () => setHistory(ui.history.slice(0, i)) } },
        h('span.chip-pos', STREETS[e.street]), h('span.cards', e.cards.map((c) => PlayingCard(c, 'xs')))));
      replaySt = dealBoard(replaySt, e.cards);
    } else {
      const role = actionRole(replaySt, e.act);
      if (e.act.type !== 'fold' || replaySt.street > 0 || replaySt.raiseLevel > 0) {
        chips.push(h('button.chip', { type: 'button', title: 'Go back to this decision', on: { click: () => setHistory(ui.history.slice(0, i)) } },
          h('span.chip-pos', POS[e.p]), h('span.chip-act', { style: { color: `var(--act-${role})` } }, actionLabel(replaySt, e.act, units))));
      }
      replaySt = applyAction(replaySt, e.act);
    }
  });
  if (st.terminal) {
    chips.push(h('span.chip.current', st.terminal === 'fold' ? `${POS[st.winner]} wins the pot` : 'Showdown'));
  } else if (st.needBoard) {
    chips.push(h('span.chip.current', h('span.chip-pos', STREETS[st.street]), h('span.muted', 'choose cards')));
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
        chips.push(h('button.chip.future', { type: 'button', title: `Fold to ${POS[p]}`, on: { click: () => setHistory(foldTo(st, p).history) } }, POS[p]));
      }
    }
  }
  return h('header.spotbar',
    h('div.spot-format', h('span.pill', 'Cash'), h('span.pill', '6-max'), h('span.pill', '100bb'), h('span.pill.muted', 'demo strategies')),
    h('nav.line', { 'aria-label': 'Action line' },
      h('button.chip.root', { type: 'button', title: 'Reset to the start', on: { click: () => setHistory([]) } }, '⟲'),
      chips));
}

function nonDecision(st) {
  if (st.needBoard) {
    const n = st.needBoard;
    const name = STREETS[st.street];
    const pick = (cards) => setHistory([...ui.history, { kind: 'deal', street: st.street, cards }]);
    return h('div.panel.center-panel',
      h('h2', `Deal the ${name.toLowerCase()}`),
      h('p.muted', `${alive(st).map((p) => POS[p]).join(' vs ')} · pot ${num(pot(st))}bb`),
      st.board.length ? h('div.board', st.board.map((c) => PlayingCard(c, 'md'))) : null,
      h('div.row.gap.center',
        h('button.btn.primary', { type: 'button', on: { click: () => cardPicker({ title: `Choose the ${name.toLowerCase()}`, count: n, used: st.board, onDone: pick }) } }, `Pick ${name.toLowerCase()}`),
        h('button.btn.secondary', { type: 'button', on: { click: () => pick(randomCards(n, st.board)) } }, 'Random')));
  }
  return h('div.panel.center-panel',
    h('h2', st.terminal === 'fold' ? `${POS[st.winner]} takes it down` : 'Showdown'),
    h('p.muted', `Final pot ${num(pot(st))}bb. Step back in the line above to study another branch.`),
    h('button.btn.secondary', { type: 'button', on: { click: () => setHistory(ui.history.slice(0, -1)) } }, 'Back one step'));
}

// ---------- toolbar ----------
function toolbar(node) {
  const tabs = Tabs([
    { id: 'strategy', label: 'Strategy', hotkey: '1' },
    { id: 'ranges', label: 'Ranges', hotkey: '2' },
    { id: 'summary', label: 'Summary', hotkey: '3' },
  ], ui.tab, (t) => { ui.tab = t; render(); });
  const right = ui.tab === 'strategy'
    ? Segmented('Metric', [{ value: 'strategy', label: 'Strategy' }, { value: 'equity', label: 'Equity' }, { value: 'ev', label: 'EV' }], ui.metric, (m) => { ui.metric = m; render(); })
    : null;
  const clear = (ui.filterAction >= 0 || ui.filterCat || ui.bucket)
    ? h('button.btn.ghost.sm', { type: 'button', on: { click: clearFilters } }, 'Clear filters ', h('kbd', 'P'))
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
      h('div.range-head', h('strong', POS[p] + (p === a ? ' (to act)' : '')),
        h('span.muted', `${num(rangeCombos(w), 0)} combos`), h('span.muted', `EQ ${pct(weightedMean(eq, w), 1)}`)),
      RangeGrid({ cells: summ, roles: [], order: [], mode: 'range', dim, size: 'sm', label: `${POS[p]} range` }),
      h('button.btn.ghost.sm', { type: 'button', on: { click: () => copyRange(p, w) } }, 'Copy range'));
  });
  return h('div',
    h('div.row.gap.wrap', h('span.muted', 'Equity bucket:'), buckets.map((b) => h('button.btn.sm' + (ui.bucket && ui.bucket[0] === b[0] ? '.primary' : '.secondary'), {
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
  navigator.clipboard?.writeText(parts.join(',')).then(() => toast(`${POS[p]} range copied`), () => toast('Clipboard unavailable'));
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
    h('thead', h('tr', h('th', 'Hand'), th('combos', 'Combos'), h('th', 'Strategy'), th('eq', 'EQ'), th('ev', 'EV (bb)'), th('evp', 'EV / pot'))),
    h('tbody', rows.map((r) => h('tr', { on: { click: () => { ui.selected = r.cls.id; ui.tab = 'strategy'; render(); } } },
      h('td.mono', r.cls.name), h('td', num(r.combos, 1)),
      h('td', FreqBar(orderOf(node).map((k) => ({ ...rs[k], freq: r.freqs[k] })), { height: 8 })),
      h('td', pct(r.eq, 1)), h('td', num(r.ev, 2)), h('td', pct(r.evp, 0)))))));
}

// ---------- side panels ----------
function infoBox(node) {
  const st = node.st, p = node.actor;
  const P = pot(st), call = toCallOf(st, p);
  const rem = Math.min(...alive(st).map((x) => remaining(st, x)));
  return h('section.panel.infobox', { 'aria-label': 'Spot info' },
    h('div.row.between', h('strong', `${POS[p]} to act`), h('span.pill', STREETS[st.street])),
    st.board.length ? h('div.board', st.board.map((c) => PlayingCard(c, 'sm'))) : null,
    h('dl.kv',
      h('dt', 'Pot'), h('dd', num(P) + 'bb'),
      h('dt', 'To call'), h('dd', call ? num(call) + 'bb' : '–'),
      h('dt', 'Pot odds'), h('dd', call ? pct(call / (P + call), 1) : '–'),
      h('dt', 'Eff. stack'), h('dd', num(rem) + 'bb'),
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
  if (idx == null) { box.append(h('div.panel-title', 'Hand'), h('p.muted', 'Hover or click a hand in the grid.')); return box; }
  const cls = CLASSES[idx];
  const w = node.ranges[node.actor];
  const rs = roles(node);
  const order = orderOf(node);
  const live = cls.combos.filter((i) => !node.dead[COMBOS[i][0]] && !node.dead[COMBOS[i][1]]);
  const inRange = live.filter((i) => w[i] > 0.001);
  box.append(h('div.panel-title.row.between', h('span', cls.name, ui.selected === idx ? h('span.pill', 'pinned') : null), h('span.muted', `${inRange.length}/${live.length} combos in range`)));
  if (!inRange.length) { box.append(h('p.muted', 'Not in this player\'s range at this point.')); return box; }
  const eq = node.equity(node.actor);
  if (node.st.street === 0) {
    const i = inRange[0];
    const f = comboFreqs(node, i), ev = comboEVs(node, i);
    box.append(FreqBar(order.map((k) => ({ ...rs[k], freq: f[k] })), { height: 16, labels: true }),
      h('table.mini', h('tbody', order.map((k) => h('tr', h('td', h('span.swatch', { style: { background: `var(--act-${rs[k].role})` } }), ' ', rs[k].label), h('td.mono', pct(f[k], 1)), h('td.mono.muted', 'EV ' + num(ev[k], 2)))))),
      h('p.muted.small', `Equity ${pct(classAverage(eq, node, node.actor, cls), 1)} · weight ${pct(w[i], 0)}`));
  } else {
    box.append(h('div.combo-list', inRange.slice(0, 16).map((i) => {
      const f = comboFreqs(node, i);
      const info = node.info?.[i];
      return h('div.combo-row',
        h('span.cards', COMBOS[i].map((c) => PlayingCard(c, 'xs'))),
        FreqBar(order.map((k) => ({ ...rs[k], freq: f[k] })), { height: 10 }),
        h('span.mono.small', pct(eq[i], 0)),
        h('span.small.muted', info ? info.made + (info.draw ? ' + ' + info.draw : '') : ''));
    })));
  }
  return box;
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
  return h('section.panel', { 'aria-label': 'Hand categories' },
    h('div.panel-title', 'Hand categories'),
    h('ul.cats', rows.map((c) => h('li', h('button.cat-row' + (ui.filterCat === c ? '.on' : ''), {
      type: 'button', 'aria-pressed': ui.filterCat === c ? 'true' : 'false',
      on: { click: () => { ui.filterCat = ui.filterCat === c ? null : c; render(); } },
    }, h('span.grow', c), h('span.catbar', h('span', { style: { width: (share[c] / tot) * 100 + '%' } })), h('span.mono.small', pct(share[c] / tot, 1)))))));
}

// ---------- hotkeys ----------
export function studyKey(e) {
  if (e.target.matches('input, select, textarea')) return false;
  if (e.key === '1') { ui.tab = 'strategy'; render(); return true; }
  if (e.key === '2') { ui.tab = 'ranges'; render(); return true; }
  if (e.key === '3') { ui.tab = 'summary'; render(); return true; }
  if (e.key === 'p' || e.key === 'P') { clearFilters(); return true; }
  if (e.key === 'Backspace' && ui.history.length) { setHistory(ui.history.slice(0, -1)); return true; }
  if (e.key === ' ' && !e.target.matches('button')) { setSetting('units', getSettings().units === 'bb' ? 'pct' : 'bb'); render(); return true; }
  return false;
}

export function rerenderStudy() { render(); }
