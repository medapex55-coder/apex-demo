// In-browser test suite (no Node on this machine, so no Playwright).
// Unit tests for the engine, then flow tests that drive the real app in an
// iframe using roles and labels. Open /tests.html; results land in #summary.
import { parseCard, COMBOS, CLASS_BY_NAME, comboIndex } from './engine/cards.js';
import { evalHand, classify } from './engine/evaluator.js';
import { rangeEquity } from './engine/equity.js';
import { initialState, applyAction, legalActions, foldTo, dealBoard, replay, POS } from './engine/game.js';
import { analyze, comboFreqs, overallFreqs, rangeCombos } from './engine/strategy.js';
import { gradeDecision } from './ui/practice.js';

const results = [];
async function test(id, name, fn) {
  try { await fn(); results.push({ id, name, ok: true }); }
  catch (e) { results.push({ id, name, ok: false, err: e.message }); }
}
const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a.toFixed(3)} not within ${tol} of ${b}`);
const cs = (s) => s.match(/../g).map(parseCard);
const ev = (hand, board) => { const [a, b] = cs(hand); return evalHand(a, b, cs(board)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const act = (st, type) => applyAction(st, legalActions(st).find((a) => a.type === type || (type === 'raise' && a.type === 'allin')));

// ---------- engine ----------
await test('U01', 'straight flush beats quads', () => assert(ev('AhKh', 'QhJhTh2c2d') > ev('2h2s', 'QhJhTh2c2d')));
await test('U02', 'wheel is a straight, below a six-high straight', () => {
  assert(ev('Ah2c', '3d4s5h9cKd') >> 20 === 4, 'wheel category');
  assert(ev('6h2c', '3d4s5h9cKd') > ev('Ah2c', '3d4s5h9cKd'), '6-high beats wheel');
});
await test('U03', 'flush beats straight; full house beats flush', () => {
  assert(ev('2h7h', 'AhKh9h8c6d') > ev('Tc7c', 'AhKh9h8c6d'), 'flush > straight');
  assert(ev('9s9d', '9hAhAs4h2c') > ev('Kh3h', '9hAhAs4h2c'), 'boat > flush');
});
await test('U04', 'two trips make a full house with the higher trips', () => {
  const v = ev('KcKd', 'KhQsQdQc2h');
  assert(v >> 20 === 6 && ((v >> 16) & 15) === 11, 'kings full');
});
await test('U05', 'kicker decides pairs', () => assert(ev('AsKd', 'Ah9c7d4s2h') > ev('AdQh', 'Ah9c7d4s2h')));
await test('U06', 'classify: set, overpair, top pair, flush draw, open-ended', () => {
  const c = (h, b) => { const [x, y] = cs(h); return classify(x, y, cs(b)); };
  assert(c('7s7d', '7hKc2d').made === 'Set', 'set');
  assert(c('QsQd', 'Jh7c2d').made === 'Overpair', 'overpair');
  assert(c('KsTd', 'Kh7c2d').made === 'Top pair', 'top pair');
  assert(c('As5s', 'Ks9s2d').draw === 'Flush draw', 'flush draw');
  assert(c('9c8d', 'Th7s2d').draw === 'Open-ended', 'oesd');
});
await test('U07', 'equity: AA vs KK preflop is about 82%', () => {
  const vill = new Float32Array(1326);
  CLASS_BY_NAME.KK.combos.forEach((i) => { vill[i] = 1; });
  const eq = rangeEquity(vill, [], 7);
  const aa = CLASS_BY_NAME.AA.combos.map((i) => eq[i]).reduce((a, b) => a + b) / 6;
  near(aa, 0.82, 0.08, 'AA vs KK');
});
await test('U08', 'equity: river is exact and blocked combos are NaN', () => {
  const board = cs('AhKhQh2c3d');
  const vill = new Float32Array(1326);
  vill[comboIndex(...cs('JhTh'))] = 1;
  const eq = rangeEquity(vill, board, 1);
  assert(eq[comboIndex(...cs('AsAd'))] === 0, 'set of aces loses to royal');
  assert(Number.isNaN(eq[comboIndex(...cs('Ah2s'))]), 'board-blocked combo is NaN');
});
await test('U09', 'game: everyone folds to the BB, hand over', () => {
  const st = foldTo(initialState(), 5);
  assert(st.terminal === 'fold' && POS[st.winner] === 'BB', 'BB wins');
});
await test('U10', 'game: BTN open, BB call needs a flop, BB acts first', () => {
  let st = act(foldTo(initialState(), 3), 'raise');
  st = act(foldTo(st, 5), 'call');
  assert(st.needBoard === 3, 'needs 3 cards');
  st = dealBoard(st, cs('2c7dKs'));
  assert(POS[st.toAct] === 'BB', 'BB first postflop');
});
await test('U11', 'game: a 3-bet makes the pot heads-up', () => {
  let st = act(initialState(), 'raise'); // UTG opens
  st = act(foldTo(st, 2), 'raise'); // CO 3-bets
  assert(st.folded.filter((f) => !f).length === 2 && POS[st.toAct] === 'UTG', 'UTG vs CO only');
});
await test('U12', 'game: all-in runs out to showdown', () => {
  let st = act(initialState(), 'raise');
  st = act(foldTo(st, 5), 'raise'); // BB 3-bet
  st = act(st, 'raise'); // 4-bet
  st = act(st, 'raise'); // jam
  st = act(st, 'call');
  st = dealBoard(st, cs('2c7dKs'));
  st = dealBoard(st, cs('9h'));
  st = dealBoard(st, cs('Jd'));
  assert(st.terminal === 'showdown', 'showdown after river');
});
await test('U13', 'strategy: every combo sums to 1 at preflop and flop nodes', () => {
  let st = act(foldTo(initialState(), 3), 'raise');
  st = act(foldTo(st, 5), 'call');
  st = dealBoard(st, cs('Td9s4h'));
  for (const s of [initialState(), st]) {
    const n = analyze(s);
    for (let i = 0; i < 1326; i += 7) {
      if (n.dead[COMBOS[i][0]] || n.dead[COMBOS[i][1]]) continue;
      const sum = comboFreqs(n, i).reduce((a, b) => a + b, 0);
      near(sum, 1, 1e-4, 'freq sum');
    }
  }
});
await test('U14', 'strategy: AA always opens, 72o never opens UTG; BTN opens wider than UTG', () => {
  const utg = analyze(initialState());
  const r = utg.actions.findIndex((a) => a.type === 'raise');
  assert(comboFreqs(utg, CLASS_BY_NAME.AA.combos[0])[r] === 1, 'AA');
  assert(comboFreqs(utg, CLASS_BY_NAME['72o'].combos[0])[r] === 0, '72o');
  const btn = analyze(foldTo(initialState(), 3));
  assert(overallFreqs(btn).freqs[1] > overallFreqs(utg).freqs[1], 'BTN wider');
});
await test('U15', 'ranges: BB range after calling equals its calling frequencies', () => {
  let st = act(foldTo(initialState(), 3), 'raise');
  st = foldTo(st, 5);
  const n = analyze(st);
  const k = n.actions.findIndex((a) => a.type === 'call');
  const expected = n.freqs[k].reduce((a, b) => a + b, 0);
  const after = analyze(act(st, 'call'));
  near(rangeCombos(after.ranges[5]), expected, 0.5, 'combo count');
});
await test('U16', 'grading: the top-frequency action is best; a 0% action is wrong or blunder', () => {
  const n = analyze(initialState());
  const i = CLASS_BY_NAME['72o'].combos[0];
  const f = comboFreqs(n, i);
  const top = f.indexOf(Math.max(...f));
  assert(gradeDecision(n, i, top, null).grade === 'best', 'best');
  const bad = gradeDecision(n, i, 1 - top, null);
  assert(['wrong', 'blunder'].includes(bad.grade) && bad.loss > 0, 'mistake with EV loss');
});
await test('U17', 'replay is deterministic: same line, same strategy', () => {
  const st = act(foldTo(initialState(), 2), 'raise');
  const again = replay(st.history);
  assert(analyze(st) === analyze(again), 'cached node reused');
});

// ---------- flows in the real app ----------
const frame = document.getElementById('frame');
const load = (hash) => new Promise((res) => { frame.onload = () => setTimeout(res, 300); frame.src = 'index.html?t=' + Date.now() + hash; });
const doc = () => frame.contentDocument;
const errors = [];
const byRole = (role, name) => [...doc().querySelectorAll(role === 'button' ? 'button, a.btn' : `[role="${role}"]`)]
  .find((el) => [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent].some((s) => s && s.trim().startsWith(name)));
async function waitFor(fn, ms = 4000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(50); }
  throw new Error('timed out waiting');
}

await load('#/study');
frame.contentWindow.addEventListener('error', (e) => errors.push(e.message));

await test('F01-H1', 'study preflop: fold to BTN, open, see BB defend', async () => {
  byRole('button', 'Fold to BTN').click();
  await sleep(100);
  byRole('button', 'Raise 2.5').click();
  await sleep(100);
  [...doc().querySelectorAll('.act-btn')].find((b) => b.textContent === 'Fold').click();
  await sleep(100);
  const info = await waitFor(() => doc().querySelector('[aria-label="Spot info"]'));
  assert(info.textContent.includes('BB to act'), 'BB to act');
});
await test('F01-E1', 'back: clicking an earlier chip rewinds the line', async () => {
  byRole('button', 'Go back to this decision').click();
  await sleep(150);
  assert(doc().querySelector('[aria-label="Spot info"]').textContent.includes('BTN to act'), 'BTN to act again');
});
await test('F02-H1', 'postflop: call, deal a random flop, get a flop strategy', async () => {
  byRole('button', 'Raise 2.5').click(); await sleep(100);
  [...doc().querySelectorAll('.act-btn')].find((b) => b.textContent === 'Fold').click(); await sleep(100);
  byRole('button', 'Call').click(); await sleep(100);
  byRole('button', 'Random').click();
  const info = await waitFor(() => doc().querySelector('[aria-label="Spot info"]'));
  assert(info.textContent.includes('Flop'), 'on the flop');
  assert(doc().querySelector('[aria-label="Hand categories"]'), 'category filters present');
});
await test('F02-E1', 'refresh mid-flow keeps the spot', async () => {
  const before = doc().querySelector('[aria-label="Action line"]').textContent;
  await load(frame.contentWindow.location.hash);
  await waitFor(() => doc().querySelector('[aria-label="Spot info"]'));
  assert(doc().querySelector('[aria-label="Action line"]').textContent === before, 'same line after reload');
});
await test('F03-H1', 'filter: clicking an action row dims other actions; P clears', async () => {
  const row = doc().querySelector('.action-row');
  row.click(); await sleep(100);
  assert(doc().querySelector('.action-row[aria-pressed="true"]'), 'pressed');
  doc().body.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
  await sleep(100);
  assert(!doc().querySelector('.action-row[aria-pressed="true"]'), 'cleared');
});
await test('F04-H1', 'ranges tab shows both players', async () => {
  doc().body.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
  await sleep(600);
  assert(doc().querySelectorAll('.range-panel').length === 2, 'two panels');
});
await test('F05-H1', 'trainer spot drill: start, act, get graded', async () => {
  await load('#/practice');
  byRole('button', 'Facing an open').click();
  byRole('button', 'Start session').click();
  const btn = await waitFor(() => doc().querySelector('[aria-label="Your actions"] button'));
  btn.click();
  const g = await waitFor(() => doc().querySelector('.feedback .grade'));
  assert(/Best|Correct|Inaccuracy|Wrong|Blunder/.test(g.textContent), 'graded');
});
await test('F05-E1', 'double click on an action records one decision', async () => {
  byRole('button', 'Next hand').click();
  const btn = await waitFor(() => doc().querySelector('[aria-label="Your actions"] button.act'));
  btn.click(); btn.click();
  await sleep(200);
  const items = doc().querySelectorAll('.decision-log li').length;
  assert(items === 2, `expected 2 decisions, got ${items}`);
});
await test('F05-E2', 'keyboard only: digit keys act, space deals next', async () => {
  doc().body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  await waitFor(() => doc().querySelector('[aria-label="Your actions"] button.act'));
  doc().body.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
  await waitFor(() => doc().querySelectorAll('.decision-log li').length === 3);
});
await test('F06-H1', 'full hand mode plays to the end', async () => {
  byRole('button', 'End session').click();
  await load('#/practice');
  byRole('button', 'Full hands').click();
  byRole('button', 'Start session').click();
  for (let n = 0; n < 12; n++) {
    const b = await waitFor(() => doc().querySelector('[aria-label="Your actions"] button'), 6000);
    if (/Next hand/.test(b.textContent)) return;
    b.click();
    await sleep(700);
  }
  throw new Error('hand did not finish in 12 actions');
});
await test('F07-H1', 'stats list saved sessions and expand', async () => {
  byRole('button', 'End session').click();
  await sleep(300);
  await load('#/stats');
  const head = await waitFor(() => doc().querySelector('.session-head'));
  head.click(); await sleep(100);
  assert(doc().querySelector('.session.open table'), 'expanded table');
});
await test('X01', 'no uncaught errors during flows', () => assert(!errors.length, errors.join('; ')));
await test('X02', 'every grid cell has an accessible name', async () => {
  await load('#/study');
  const cells = await waitFor(() => doc().querySelectorAll('[role="grid"] .cell').length === 169 && doc().querySelectorAll('[role="grid"] .cell'));
  assert([...cells].every((c) => c.getAttribute('aria-label')), 'labels');
});

const pass = results.filter((r) => r.ok).length;
document.getElementById('summary').textContent = `${pass}/${results.length} passed`;
document.getElementById('summary').className = pass === results.length ? 'pass' : 'fail';
document.getElementById('out').append(...results.map((r) => {
  const li = document.createElement('li');
  li.className = r.ok ? 'pass' : 'fail';
  li.textContent = `${r.ok ? 'PASS' : 'FAIL'} ${r.id} ${r.name}${r.ok ? '' : ' — ' + r.err}`;
  return li;
}));
window.__results = results;
