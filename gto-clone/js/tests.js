// In-browser test suite (no Node on this machine, so no Playwright).
// Unit tests for the engine, then flow tests that drive the real app in an
// iframe using roles and labels. Open /tests.html; results land in #summary.
import { parseCard, COMBOS, CLASS_BY_NAME, comboIndex } from './engine/cards.js';
import { evalHand, classify } from './engine/evaluator.js';
import { rangeEquity, weightedMean } from './engine/equity.js';
import { levelOf, streakOf } from './data/progress.js';
import { playSessions, abi } from './data/playsessions.js';
import { initialState, applyAction, legalActions, foldTo, dealBoard, replay, POS, alive, isIP } from './engine/game.js';
import { analyze, comboFreqs, overallFreqs, rangeCombos, setOpenStyle, rangeScale } from './engine/strategy.js';
import { icmEquities, bubbleFactor, requiredEquity } from './engine/icm.js';
import { gradeDecision } from './ui/practice.js';
import { parseFile } from './data/parsers.js';
import { extractDecisions } from './data/decisions.js';
import { analyzeDecisions, keyMetric, practiceSpotKey, spotKey, liveAction } from './data/leaks.js';
import { contributions, handResult, equityShare, handFlags, handRecord, results as handTotals, hudTotals } from './data/handstats.js';

// Synthetic PokerStars files (made up for the tests, same layout as the real ones).
const PS_SUMMARY = `PokerStars Tournament #111, No Limit Hold'em
Buy-In: €4.50/€0.50 EUR
100 players
Total Prize Pool: €450.00 EUR
Tournament started 2026/10/19 1:00:00 CET [2026/10/18 19:00:00 ET]

  1: Alice (France), €100.00 (22.22%)
  2: Hero (France), €60.00 (13.33%)
You finished in 2nd place and received €60.00.
You made 1 re-entries for a total of €5.00.
`;
const PS_HANDS = `PokerStars Hand #1001: Tournament #111, €4.50+€0.50 EUR Hold'em No Limit - Level I (10/20) - 2026/10/19 1:00:00 CET [2026/10/18 19:00:00 ET]
Table '111 1' 9-max Seat #6 is the button
Seat 1: P1 (1500 in chips)
Seat 2: P2 (1500 in chips)
Seat 3: P3 (1500 in chips)
Seat 4: P4 (1500 in chips)
Seat 5: Hero (1500 in chips)
Seat 6: P6 (1500 in chips)
Seat 7: P7 (1500 in chips)
Seat 8: P8 (1500 in chips)
Seat 9: P9 (1500 in chips)
P7: posts small blind 10
P8: posts big blind 20
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
P9: folds
P1: folds
P2: folds
P3: folds
P4: folds
Hero: raises 30 to 50
P6: folds
P7: folds
P8: raises 100 to 150
Hero: raises 1350 to 1500 and is all-in
P8: folds
*** SUMMARY ***
Total pot 320

PokerStars Hand #1002: Tournament #111, €4.50+€0.50 EUR Hold'em No Limit - Level V (100/200) - 2026/10/19 1:40:00 CET [2026/10/18 19:40:00 ET]
Table '111 1' 9-max Seat #6 is the button
Seat 3: P3 (9000 in chips)
Seat 6: P6 (2000 in chips)
Seat 7: P7 (5000 in chips)
Seat 8: Hero (2000 in chips)
P7: posts small blind 100
Hero: posts big blind 200
*** HOLE CARDS ***
Dealt to Hero [Qs Qh]
P3: folds
P6: raises 1800 to 2000 and is all-in
P7: folds
Hero: calls 1800 and is all-in
*** FLOP *** [2c 7d 9h]
*** SUMMARY ***
Hero wins €1.25 for eliminating P6 and their own bounty increases by €1.25 to €3.75
`;

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
  let st = act(initialState(), 'raise'); // LJ opens
  st = act(foldTo(st, 2), 'raise'); // CO 3-bets
  assert(st.folded.filter((f) => !f).length === 2 && POS[st.toAct] === 'LJ', 'LJ vs CO only');
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
await test('U14', 'strategy: AA always opens, 72o never opens LJ; BTN opens wider than LJ', () => {
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

await test('U18', 'open charts: first-in spots follow the user charts', () => {
  const at = (p, name) => {
    const n = analyze(foldTo(initialState(), p));
    const f = comboFreqs(n, CLASS_BY_NAME[name].combos[0]);
    return Object.fromEntries(n.actions.map((a, k) => [a.type === 'call' ? 'limp' : a.type, f[k]]));
  };
  assert(at(0, 'K5s').fold === 1, 'LJ folds K5s');
  assert(at(1, 'K6s').raise === 1, 'HJ raises K6s');
  assert(at(3, 'K2s').raise === 1 && at(3, 'K2o').fold === 1, 'BTN raises K2s, folds K2o');
  assert(at(2, 'A5o').raise > 0 && at(2, 'A5o').raise < 0.5, 'CO A5o is Loosifie: mostly fold in standard');
  const sbAA = at(4, 'AA');
  assert(sbAA.raise === 0.5 && sbAA.limp === 0.5, 'SB AA raise/limp 50/50');
  assert(at(4, 'T5o').fold === 1 && at(4, '72s').limp === 1, 'SB folds T5o, limps 72s');
});
await test('U19', 'open style: tight folds Tightfie, loose opens Loosifie', () => {
  const raiseOf = (p, name) => {
    const n = analyze(foldTo(initialState(), p));
    return comboFreqs(n, CLASS_BY_NAME[name].combos[0])[n.actions.findIndex((a) => a.type === 'raise')];
  };
  setOpenStyle('tight');
  const tight = raiseOf(1, 'QTo'); // HJ QTo is a Raise/Tightfie split
  setOpenStyle('standard');
  const std = raiseOf(0, 'K6s'); // LJ K6s is Loosifie
  setOpenStyle('loose');
  const loose = raiseOf(0, 'K6s');
  setOpenStyle('standard');
  assert(tight < 0.7, 'tight cuts the split cell');
  assert(std < 0.5 && loose > 0.8, 'loose opens Loosifie');
});
await test('U20', 'SB limp: BB gets check or iso-raise, then a flop', () => {
  let st = foldTo(initialState(), 4);
  st = act(st, 'call');
  assert(legalActions(st).map((a) => a.type).join() === 'check,raise', 'BB options');
  st = act(st, 'check');
  assert(st.needBoard === 3, 'limped pot goes to the flop');
});

await test('U21', 'stack: 20bb spots use 20bb and big re-raises go all-in', () => {
  const cfg = { stack: 20, open: '2.5' };
  let st = act(foldTo(initialState(cfg), 3), 'raise'); // BTN opens 2.5
  st = foldTo(st, 5);
  const threeBet = legalActions(st).find((a) => a.type === 'raise' || a.type === 'allin');
  assert(threeBet.type === 'allin' && threeBet.to === 20, '3-bet becomes a 20bb shove');
  st = applyAction(st, threeBet);
  const n = analyze(st);
  assert(n.actions.map((a) => a.type).join() === 'fold,call', 'BTN can only fold or call');
  const callK = n.actions.findIndex((a) => a.type === 'call');
  assert(comboFreqs(n, CLASS_BY_NAME.AA.combos[0])[callK] === 1, 'AA calls the shove');
  assert(analyze(initialState(cfg)).key !== analyze(initialState()).key, 'different stack, different node');
});
await test('U22', 'open sizes: 2bb, 4.5bb and limp first in', () => {
  const opener = (open) => legalActions(initialState({ stack: 100, open })).map((a) => a.type + (a.to || '')).join();
  assert(opener('2') === 'fold,raise2', '2bb open');
  assert(opener('4.5') === 'fold,raise4.5', '4.5bb open');
  assert(opener('limp') === 'fold,call', 'limp only');
  const limpCfg = { stack: 100, open: 'limp' };
  const n = analyze(initialState(limpCfg));
  assert(comboFreqs(n, CLASS_BY_NAME.AA.combos[0])[1] === 1, 'LJ limps its raising range');
  let st = act(initialState(limpCfg), 'call'); // LJ limps
  st = act(foldTo(st, 2), 'raise'); // CO isolates
  st = foldTo(st, 0);
  assert(POS[st.toAct] === 'LJ', 'back to the limper');
  st = act(st, 'call');
  assert(st.folded.filter((f) => !f).length === 2, 'heads-up LJ vs CO once the limper calls');
});
await test('U23', 'iso sizing: base open + 1bb per limper', () => {
  const cfg = { stack: 100, open: '2' };
  let st = foldTo(initialState(cfg), 1);
  st = applyAction(st, { type: 'call', amount: 1 }); // HJ limps
  st = foldTo(st, 3); // CO folds
  assert(legalActions(st).find((a) => a.type === 'raise').to === 3, 'one limper: 2 + 1 = 3');
  let st2 = applyAction(initialState(cfg), { type: 'call', amount: 1 }); // LJ limps
  st2 = applyAction(st2, { type: 'call', amount: 1 }); // HJ over-limps
  assert(legalActions(st2).find((a) => a.type === 'raise').to === 4, 'two limpers: 2 + 1 + 1 = 4');
});
await test('U24', 'all-in strategy at 20bb and less', () => {
  const kinds = (stack) => legalActions(foldTo(initialState({ stack, open: '2.5' }), 3)).map((a) => a.type).join();
  assert(kinds(25) === 'fold,raise', 'no shove option at 25bb');
  assert(kinds(20) === 'fold,raise,allin', 'shove option at 20bb');
  const n = analyze(foldTo(initialState({ stack: 12, open: '2.5' }), 3));
  const iA = n.actions.findIndex((a) => a.type === 'allin');
  const f = comboFreqs(n, CLASS_BY_NAME.A5o.combos[0]);
  assert(f[iA] === 1, 'BTN 12bb shoves A5o');
  const n20 = analyze(foldTo(initialState({ stack: 20, open: '2.5' }), 3));
  const f20 = comboFreqs(n20, CLASS_BY_NAME.A5o.combos[0]);
  assert(f20[n20.actions.findIndex((a) => a.type === 'allin')] < 0.3, 'at 20bb most of it still min-raises');
});

await test('D01', 'PokerStars summary: buy-in, players, prize pool, place, prize, re-entry', () => {
  const s = parseFile(PS_SUMMARY).summary;
  assert(s.tid === '111' && s.buyin === 5 && s.players === 100 && s.prizePool === 450, 'header fields');
  assert(s.place === 2 && s.prize === 60 && s.reentries === 1 && s.reentryCost === 5, 'result fields');
});
await test('D02', 'PokerStars hands: seats, hero cards, preflop actions, bounty', () => {
  const hh = parseFile(PS_HANDS).hands;
  assert(hh.tid === '111' && hh.hands.length === 2 && hh.hero === 'Hero', 'two hands, hero found');
  const [h1, h2] = hh.hands;
  assert(h1.bb === 20 && h1.cards === 'AhKd' && h1.pre.length === 11, 'hand 1 parsed');
  assert(h1.pre[9].allin === true && h1.pre[8].allin === false, 'all-in flag');
  assert(h2.bounty === 1.25, 'bounty collected');
});
await test('D03', 'decisions: 9-max seats map to Study seats and scenarios', () => {
  const [h1, h2] = parseFile(PS_HANDS).hands.hands;
  const d1 = extractDecisions(h1).decisions;
  assert(d1.length === 2, 'open then facing a 3-bet');
  assert(d1[0].sc === 'RFI' && POS[d1[0].hp] === 'CO' && d1[0].a === 'raise' && d1[0].s === 80, 'CO opens at 75bb (80 bucket)');
  assert(d1[1].sc === 'V3' && POS[d1[1].vp] === 'BB' && d1[1].a === 'allin', 'shoves over the BB 3-bet');
  const d2 = extractDecisions(h2).decisions;
  assert(d2.length === 1 && d2[0].sc === 'VS' && POS[d2[0].vp] === 'BTN' && d2[0].s === 10 && d2[0].a === 'call', 'BB calls a 10bb BTN shove');
});
await test('D04', 'leakfinder grades rebuilt spots', () => {
  const ds = parseFile(PS_HANDS).hands.hands.flatMap((x) => extractDecisions(x).decisions);
  const r = analyzeDecisions(ds);
  assert(r.covered === 3 && r.notCovered === 0, `all 3 decisions rebuilt (${r.covered}/${r.notCovered})`);
  const vs = r.spots.find((s) => s.sc === 'VS');
  assert(vs.hands[0].grade === 'best', 'QQ calling a 10bb shove is best');
});

await test('D05', 'hands keep their time; plain-language metric compares you with the target', () => {
  const hands = parseFile(PS_HANDS).hands.hands;
  assert(hands[1].at === '2026-10-19T01:40:00', `hand time ${hands[1].at}`);
  const ds = hands.flatMap((x) => extractDecisions(x).decisions);
  const vs = analyzeDecisions(ds).spots.find((s) => s.sc === 'VS');
  const m = keyMetric(vs);
  assert(m.label === 'Call du tapis' && m.you === 1 && m.target > 0.95 && m.dir === 'ok', `metric ${JSON.stringify(m)}`);
  const fake = { sc: 'VO', hero: 'BB', vill: 'BTN', n: 10, you: { fold: 7, call: 3, raise: 0, allin: 0 }, gto: { fold: 4.5, call: 4.5, raise: 1, allin: 0 } };
  const m2 = keyMetric(fake);
  assert(m2.label === 'Défense' && Math.abs(m2.you - 0.3) < 1e-9 && Math.abs(m2.target - 0.55) < 1e-9 && m2.dir === 'low' && /couches trop souvent/.test(m2.tip), 'BB defends 30% vs 55% target: not enough');
});
await test('D06', 'a Practice spot gets the same key as the tournament spot', () => {
  let st = foldTo(initialState({ stack: 50, open: '2.5' }), 3);
  assert(practiceSpotKey(st) === spotKey('RFI', 'BTN', '', 50), 'BTN first in at 50bb');
  st = foldTo(act(st, 'raise'), 5);
  assert(practiceSpotKey(st) === spotKey('VO', 'BB', 'BTN', 50), `BB vs BTN open: ${practiceSpotKey(st)}`);
  assert(practiceSpotKey(st) === 'VO|BB|BTN|50–80bb', 'key format');
});
await test('D07', 'live action: only tournament hands played after the training count', () => {
  const ds = parseFile(PS_HANDS).hands.hands.flatMap((x) => extractDecisions(x).decisions);
  const key = spotKey('VS', 'BB', 'BTN', 10);
  const sess = (t) => [{ id: 's1', startedAt: t, decisions: [{ t, spot: key, score: 1, grade: 'best', street: 'Preflop' }] }];
  const before = liveAction(sess('2026-10-19T00:30:00'), ds, [])[0];
  assert(before.after.n === 1 && before.before.n === 0 && before.status === 'thin', `trained before the hand: ${before.status}`);
  const later = liveAction(sess('2026-10-19T02:00:00'), ds, [])[0];
  assert(later.after.n === 0 && later.before.n === 1 && later.status === 'waiting', `trained after the hand: ${later.status}`);
});

// Two more hands: an all-in on the flop that loses (AA vs a runner-runner king), and a fold in the BB to a BTN steal.
const PS_HANDS2 = `PokerStars Hand #2001: Tournament #333, €4.50+€0.50 EUR Hold'em No Limit - Level II (50/100) - 2026/10/20 21:00:00 CET [2026/10/20 15:00:00 ET]
Table '333 1' 6-max Seat #3 is the button
Seat 1: V1 (5000 in chips)
Seat 2: V2 (5000 in chips)
Seat 3: Hero (3000 in chips)
Seat 4: V4 (5000 in chips)
Seat 5: V5 (5000 in chips)
Seat 6: V6 (5000 in chips)
V1: posts the ante 10
V2: posts the ante 10
Hero: posts the ante 10
V4: posts the ante 10
V5: posts the ante 10
V6: posts the ante 10
V4: posts small blind 50
V5: posts big blind 100
*** HOLE CARDS ***
Dealt to Hero [Ah Ad]
V6: folds
V1: folds
V2: folds
Hero: raises 150 to 250
V4: folds
V5: calls 150
*** FLOP *** [Kc 7d 2s]
V5: bets 300
Hero: raises 2440 to 2740 and is all-in
V5: calls 2440
*** TURN *** [Kc 7d 2s] [Kd]
*** RIVER *** [Kc 7d 2s Kd] [Ks]
*** SHOW DOWN ***
V5: shows [Kh 9h] (four of a kind, Kings)
Hero: shows [Ah Ad] (a full house, Kings full of Aces)
V5 collected 6090 from pot
*** SUMMARY ***
Total pot 6090 | Rake 0

PokerStars Hand #2002: Tournament #333, €4.50+€0.50 EUR Hold'em No Limit - Level II (50/100) - 2026/10/20 21:02:00 CET [2026/10/20 15:02:00 ET]
Table '333 1' 6-max Seat #4 is the button
Seat 1: V1 (5000 in chips)
Seat 2: V2 (5000 in chips)
Seat 4: V4 (5000 in chips)
Seat 5: V5 (5000 in chips)
Seat 6: Hero (3000 in chips)
V5: posts small blind 50
Hero: posts big blind 100
*** HOLE CARDS ***
Dealt to Hero [7c 2d]
V1: folds
V2: folds
V4: raises 150 to 250
V5: folds
Hero: folds
Uncalled bet (150) returned to V4
V4 collected 250 from pot
*** SUMMARY ***
Total pot 250 | Rake 0
`;
await test('D08', 'full hand parse: streets, board, antes, uncalled bet, collected, showdown', () => {
  const [a, b] = parseFile(PS_HANDS2).hands.hands;
  assert(a.streets.map((s) => s.length).join() === '6,3,0,0', `streets ${a.streets.map((s) => s.length)}`);
  assert(a.board.join(' ') === 'Kc 7d 2s Kd Ks' && a.showdown && a.shown.V5 === 'Kh9h' && a.collected.V5 === 6090, 'board, showdown, collected');
  assert(a.posts.filter((p) => p.kind === 'ante').length === 6, 'antes');
  assert(b.returned.V4 === 150 && b.collected.V4 === 250 && !b.showdown, 'uncalled bet back');
  const c = contributions(a);
  assert(c.Hero === 3000 && c.V5 === 3000 && c.V4 === 60, `contributions ${JSON.stringify(c)}`);
});
await test('D09', 'result in bb and all-in EV: AA all-in on the flop loses but is ahead in EV', () => {
  const [a, b] = parseFile(PS_HANDS2).hands.hands;
  const r = handResult(a);
  assert(r.net === -30 && r.sd, `net ${r.net}`);
  const eq = equityShare([parseCard('Ah'), parseCard('Ad')], [[parseCard('Kh'), parseCard('9h')]], ['Kc', '7d', '2s'].map(parseCard));
  near(eq, 808 / 990, 0.001, 'AA vs K9 on K72: 808 of 990 runouts');
  near(r.ev, (eq * 6090 - 3000) / 100, 0.01, 'EV = equity × pot − invested');
  const rb = handResult(b);
  assert(rb.net === -1 && rb.ev === -1 && !rb.sd, 'BB fold loses 1bb, no showdown');
  const tot = handTotals([handRecord(a), handRecord(b)]);
  assert(tot.hands === 2 && Math.abs(tot.nsd - -1) < 1e-9 && Math.abs(tot.sd - -30) < 1e-9 && tot.luck < 0 && tot.runBetter > 0.5, 'totals: unlucky');
});
await test('D10', 'HUD counters: RFI and steal from the BTN, fold in the BB to a steal', () => {
  const [a, b] = parseFile(PS_HANDS2).hands.hands;
  const fa = handFlags(a), fb = handFlags(b);
  assert(fa.VPIP === 1 && fa.PFR === 1 && fa.RFI === 1 && fa.ATS === 1 && !('CB' in fa), `hand 1 ${JSON.stringify(fa)}`);
  assert(fa.WTSD === 1 && fa.WSD === 0 && fa.WWSF === 0 && fa.ag === 1, 'showdown counters');
  assert(fb.VPIP === 0 && fb.FBS === 1 && fb.B3S === 0 && !('RFI' in fb), `hand 2 ${JSON.stringify(fb)}`);
  const t = hudTotals([handRecord(a), handRecord(b)]);
  assert(t.VPIP.opp === 2 && t.VPIP.hit === 1 && t.FBS.hit === 1, 'totals');
});
const share = (node, type) => { const o = overallFreqs(node); return node.actions.reduce((a, x, k) => a + (x.type === type ? o.freqs[k] : 0), 0); };
const bbVsBtn = (cfg) => { let st = foldTo(initialState({ stack: 30, open: '2.5', ...cfg }), 3); st = foldTo(act(st, 'raise'), 5); return analyze(st); };
await test('U25', 'KO widens the BB defence, the final table tightens it', () => {
  const base = 1 - share(bbVsBtn({}), 'fold');
  const ko = 1 - share(bbVsBtn({ ko: true }), 'fold');
  const ft = 1 - share(bbVsBtn({ stage: 'ft' }), 'fold');
  assert(ko > base + 0.02 && ft < base - 0.02, `defend: base ${base.toFixed(3)}, KO ${ko.toFixed(3)}, final table ${ft.toFixed(3)}`);
});
await test('U26', 'heads-up: SB (button) opens wide first, BB acts first after the flop', () => {
  let st = initialState({ stack: 40, open: '2.5', stage: 'hu' });
  assert(st.toAct === 4 && legalActions(st).find((a) => a.type === 'raise').to === 2.5, 'SB to act, opens 2.5');
  assert(share(analyze(st), 'fold') < 0.3, `SB folds ${share(analyze(st), 'fold').toFixed(2)}`);
  st = act(act(st, 'raise'), 'call');
  st = dealBoard(st, cs('2c7dKs'));
  assert(st.toAct === 5, 'BB first on the flop');
});
await test('U27', 'ICM equity (Malmuth-Harville): 3 players, checked by hand', () => {
  const eq = icmEquities([50, 30, 20], [50, 30, 20]);
  // P1: 1st 0.5, 2nd 0.3*(5/7)+0.2*(5/8) = 0.3393, 3rd 0.1607 -> 25 + 10.18 + 3.21
  near(eq[0], 38.393, 0.01, 'big stack');
  near(eq.reduce((a, b) => a + b, 0), 100, 1e-9, 'whole prize pool shared');
  const hu = icmEquities([1, 1], [60, 40]);
  assert(Math.abs(hu[0] - 50) < 1e-9 && Math.abs(hu[1] - 50) < 1e-9, 'equal stacks heads-up');
});
await test('U28', 'bubble factor: 1 heads-up and winner-takes-all, above 1 on the bubble', () => {
  near(bubbleFactor([20, 20], [60, 40], 0, 1), 1, 1e-9, 'heads-up');
  near(bubbleFactor([10, 20, 30], [100], 0, 2), 1, 1e-9, 'winner takes all');
  const bubble = bubbleFactor([20, 20, 20, 20], [50, 30, 20], 0, 1);
  assert(bubble > 1.3, `4 left, 3 paid: BF ${bubble.toFixed(2)}`);
  near(requiredEquity(1.5), 0.6, 1e-9, 'BF 1.5 needs 60% to call');
  assert(rangeScale({ stage: '100', bf: 2 }) < rangeScale({ stage: '100' }) - 0.3, 'a custom BF of 2 tightens the ranges');
});
await test('U29', 'multiway: an open and two cold-calls see a 3-way flop with a sensible equity', () => {
  let st = initialState({ stack: 40, open: '2.5', multiway: true });
  st = act(st, 'raise'); // LJ opens
  st = act(st, 'call'); // HJ calls
  st = act(st, 'fold'); // CO
  st = act(st, 'call'); // BTN calls
  st = act(act(st, 'fold'), 'fold'); // blinds fold
  assert(st.needBoard === 3 && alive(st).length === 3, `3 players on the flop (${alive(st).map((p) => POS[p])})`);
  st = dealBoard(st, cs('Kd8s3c'));
  const node = analyze(st);
  const avg = weightedMean(node.equity(st.toAct), node.ranges[st.toAct]);
  assert(node.actions.length >= 2 && avg > 0.2 && avg < 0.5, `3-way equity ${avg.toFixed(3)}`);
  assert(!isIP(st, st.toAct), 'first to act is out of position');
});
await test('U30', 'levels and the daily streak', () => {
  assert(levelOf(0).n === 1 && levelOf(250).n === 3 && levelOf(7500).name === 'Légende', 'levels');
  assert(levelOf(10600).n === 11 && levelOf(10600).name === 'Légende 2', 'after the last level');
  near(levelOf(175).pct, 0.5, 1e-9, 'halfway from 100 to 250');
  const d = (k) => { const x = new Date(2026, 9, 30 - k); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const p = { days: { [d(1)]: 30, [d(2)]: 25, [d(3)]: 10, [d(0)]: 3 } };
  assert(streakOf(p, new Date(2026, 9, 30)) === 2, 'yesterday and the day before count, today not yet');
});
await test('U31', '50bb charts: opens and every BB spot follow the user charts', () => {
  const cfg = { stack: 50, open: '2.5' };
  const f = (st, name) => {
    const n = analyze(st);
    const fr = comboFreqs(n, CLASS_BY_NAME[name].combos[0]);
    return Object.fromEntries(n.actions.map((a, k) => [a.type, fr[k]]));
  };
  assert(f(foldTo(initialState(cfg), 0), 'A9o').raise < 0.5 && f(foldTo(initialState(), 0), 'A9o').fold === 1, 'LJ A9o is Loosifie at 50bb, a fold at 100bb');
  assert(f(foldTo(initialState(cfg), 4), 'K6o').raise === 1, 'SB raises K6o at 50bb');
  const vsOpen = (p) => foldTo(act(foldTo(initialState(cfg), p), 'raise'), 5);
  assert(f(vsOpen(0), 'K7s').raise === 1 && f(vsOpen(0), 'AQs').call === 1, 'BB vs LJ: K7s 3bet light, AQs call');
  assert(f(vsOpen(3), 'A2o').raise === 1 && f(vsOpen(3), 'T5o').fold === 1, 'BB vs BTN: A2o 3bet light, T5o fold');
  assert(f(vsOpen(4), 'Q7o').raise === 1 && f(vsOpen(4), '83s').fold === 1, 'BB vs SB: Q7o 3bet, 83s fold');
  let st = act(foldTo(initialState(cfg), 4), 'call'); // SB limps
  assert(f(st, 'Q2o').raise === 1 && f(st, 'K5s').check === 1, 'BB vs limp: Q2o raise, K5s check');
  st = act(act(st, 'raise'), 'raise'); // BB raises 3.5, SB re-raises
  assert(f(st, 'AKs').allin === 1 && f(st, 'AA').call === 1 && f(st, 'KTo').fold === 1, 'vs limp-reraise: AKs shove, AA call, KTo fold');
  assert(f(foldTo(act(foldTo(initialState({ ...cfg, stack: 100 }), 3), 'raise'), 5), 'K4o').raise !== 1, 'no 50bb chart at 100bb');
});
await test('U32', 'play sessions: 10h windows keep a 17h-5h night together; ABI', () => {
  const t = (tid, startedAt, buyin) => ({ tid, startedAt, buyin });
  const list = [
    t('1', '2026-10-30T17:00:00', 5), t('2', '2026-10-30T23:30:00', 10), t('3', '2026-10-31T02:30:00', 3),
    t('4', '2026-10-31T17:05:00', 20), t('5', '2026-11-01T03:30:00', 2), { tid: '6' },
  ];
  const hands = [{ t: '3', at: '2026-10-31T05:00:00' }, { t: '7', at: '2026-10-31T06:00:00' }];
  const s = playSessions(list, hands);
  assert(s.map((x) => x.tours.map((y) => y.tid).join('')).join('|') === '5|4|123|6', s.map((x) => x.tours.map((y) => y.tid).join('')).join('|'));
  assert(new Date(s[2].end).getHours() === 5 && s[3].start === null, 'night ends at the last hand, no-date group last');
  near(abi(list.slice(0, 3)), 6, 1e-9, 'ABI (5+10+3)/3');
  assert(Number.isNaN(abi([])), 'no ABI without tournaments');
});
await test('U33', 'player profile: looseness widens or narrows a range, custom sizes add actions', () => {
  const btn = (players) => analyze(foldTo(initialState({ stack: 100, open: '2.5', stage: '100', players }), 3));
  const base = 1 - share(btn(), 'fold');
  const loose = 1 - share(btn({ 3: { loose: 100 } }), 'fold');
  const tight = 1 - share(btn({ 3: { loose: 0 } }), 'fold');
  near(loose, Math.min(1, base * 2), 0.01, `loose 100 doubles the opens (${base.toFixed(3)} -> ${loose.toFixed(3)})`);
  near(tight, base / 2, 0.01, `tight 0 halves them (${tight.toFixed(3)})`);
  const two = btn({ 3: { sizes: { 1: [3.5] } } });
  assert(two.actions.map((a) => a.type + (a.to || '')).join() === 'fold,raise2.5,raise3.5', 'added size next to the default');
  const AA = comboFreqs(two, CLASS_BY_NAME.AA.combos[0]), Q7 = comboFreqs(two, CLASS_BY_NAME.Q7s.combos[0]);
  assert(AA[2] === 1 && Q7[1] > 0.5, 'strong hands take the big size, weaker ones the small');
  near(1 - share(two, 'fold'), base, 1e-6, 'same opening range');
  const repl = btn({ 3: { sizes: { 1: [2.2] }, keep: { 1: false } } });
  assert(repl.actions.map((a) => a.type + (a.to || '')).join() === 'fold,raise2.2', 'replaced size');
  let st = act(foldTo(initialState({ stack: 100, open: '2.5', players: { 5: { sizes: { post: [1.5] } } } }), 3), 'raise');
  st = act(foldTo(st, 5), 'call');
  st = dealBoard(st, ['As', '7d', '2c'].map(parseCard));
  const n = analyze(st);
  assert(n.actions.length === 4 && n.actions[3].frac === 1.5, 'BB gets a 150% overbet postflop');
  const f = n.actions.map((_, k) => overallFreqs(n).freqs[k]);
  near(f.reduce((a, b) => a + b, 0), 1, 1e-6, 'frequencies sum to 1');
});

// ---------- flows in the real app ----------
const frame = document.getElementById('frame');
const load = (hash) => new Promise((res) => { frame.onload = () => setTimeout(res, 300); frame.src = 'index.html?test=1&t=' + Date.now() + hash; });
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
  byRole('button', 'Fold jusqu\'au BTN').click();
  await sleep(100);
  byRole('button', 'Raise 2.5').click();
  await sleep(100);
  [...doc().querySelectorAll('.act-btn')].find((b) => b.textContent === 'Fold').click();
  await sleep(100);
  const info = await waitFor(() => doc().querySelector('[aria-label="Infos du spot"]'));
  assert(info.textContent.includes('BB doit jouer'), 'BB doit jouer');
});
await test('F01-E1', 'back: clicking an earlier chip rewinds the line', async () => {
  byRole('button', 'Revenir à cette décision').click();
  await sleep(150);
  assert(doc().querySelector('[aria-label="Infos du spot"]').textContent.includes('BTN doit jouer'), 'BTN doit jouer again');
});
await test('F02-H1', 'postflop: call, deal a random flop, get a flop strategy', async () => {
  byRole('button', 'Raise 2.5').click(); await sleep(100);
  [...doc().querySelectorAll('.act-btn')].find((b) => b.textContent === 'Fold').click(); await sleep(100);
  byRole('button', 'Call').click(); await sleep(100);
  byRole('button', 'Au hasard').click();
  const info = await waitFor(() => doc().querySelector('[aria-label="Infos du spot"]'));
  assert(info.textContent.includes('Flop'), 'on the flop');
  assert(doc().querySelector('[aria-label="Catégories de mains"]'), 'category filters present');
});
await test('F02-E1', 'refresh mid-flow keeps the spot', async () => {
  const before = doc().querySelector('[aria-label="Ligne d\'action"]').textContent;
  await load(frame.contentWindow.location.hash);
  await waitFor(() => doc().querySelector('[aria-label="Infos du spot"]'));
  assert(doc().querySelector('[aria-label="Ligne d\'action"]').textContent === before, 'same line after reload');
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
  byRole('button', 'Face à un open').click();
  byRole('button', 'Commencer la session').click();
  const btn = await waitFor(() => doc().querySelector('[aria-label="Tes actions"] button'));
  btn.click();
  const g = await waitFor(() => doc().querySelector('.feedback .grade'));
  assert(/Meilleur coup|Correct|Imprécision|Erreur|Grosse erreur/.test(g.textContent), 'graded');
});
await test('F05-E1', 'double click on an action records one decision', async () => {
  byRole('button', 'Main suivante').click();
  const btn = await waitFor(() => doc().querySelector('[aria-label="Tes actions"] button.act'));
  btn.click(); btn.click();
  await sleep(200);
  const items = doc().querySelectorAll('.decision-log li').length;
  assert(items === 2, `expected 2 decisions, got ${items}`);
});
await test('F05-E2', 'keyboard only: digit keys act, space deals next', async () => {
  doc().body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  await waitFor(() => doc().querySelector('[aria-label="Tes actions"] button.act'));
  doc().body.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
  await waitFor(() => doc().querySelectorAll('.decision-log li').length === 3);
});
await test('F06-H1', 'full hand mode plays to the end', async () => {
  byRole('button', 'Terminer la session').click();
  await load('#/practice');
  byRole('button', 'Mains complètes').click();
  byRole('button', 'Commencer la session').click();
  for (let n = 0; n < 12; n++) {
    const b = await waitFor(() => doc().querySelector('[aria-label="Tes actions"] button'), 6000);
    if (/Main suivante/.test(b.textContent)) return;
    b.click();
    await sleep(700);
  }
  throw new Error('hand did not finish in 12 actions');
});
await test('F07-H1', 'stats list saved sessions and expand', async () => {
  byRole('button', 'Terminer la session').click();
  await sleep(300);
  await load('#/stats');
  const head = await waitFor(() => doc().querySelector('.session-head'));
  head.click(); await sleep(100);
  assert(doc().querySelector('.session.open table'), 'expanded table');
});
await test('F08-H1', 'practice at 50bb: the stack choice reaches the table', async () => {
  await load('#/practice');
  const sel = await waitFor(() => doc().querySelector('select[aria-label="Stack effectif"]'));
  sel.value = '50'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  byRole('button', 'Commencer la session').click();
  const btn = await waitFor(() => doc().querySelector('[aria-label="Tes actions"] button.act'));
  assert([...doc().querySelectorAll('.table-top .pill')].some((p) => p.textContent === '50bb'), '50bb pill');
  btn.click();
  await waitFor(() => doc().querySelector('.feedback .grade'));
  byRole('button', 'Terminer la session').click();
  await sleep(300);
});
await test('F09-H1', 'leakfinder live action lists the trained spot', async () => {
  await load('#/leaks');
  const tab = await waitFor(() => [...doc().querySelectorAll('button')].find((b) => b.textContent === 'Live action'));
  tab.click();
  const card = await waitFor(() => [...doc().querySelectorAll('.la-card .la-title')].find((t) => /first in · 50–80bb/.test(t.textContent)));
  assert(card, 'card for the 50bb first-in spot');
});
await test('F10-H1', 'my data: an import is a session with a recap, a run meter and HUD stats', async () => {
  await load('#/data');
  const ds = await frame.contentWindow.eval(`import('${new URL('js/data/datastore.js', frame.contentWindow.location.href).href}')`);
  ds.clearAll();
  const r1 = ds.importFiles([{ name: 'h.txt', text: PS_HANDS2 }]);
  const r2 = ds.importFiles([{ name: 'h-copy.txt', text: PS_HANDS2 }]);
  const r3 = ds.importFiles([{ name: 'h-other.txt', text: PS_HANDS2 + '\n' }]);
  assert(r1.ok === 1 && r1.newHands === 2 && r1.newTournaments === 1, 'first import');
  assert(r2.ok === 0 && r2.duplicates.length === 1, 'same file again: skipped');
  assert(r3.ok === 1 && r3.newHands === 0 && r3.newTournaments === 0, 'same hands in another file: merged');
  assert(ds.getTournaments().length === 1 && ds.getHandRecords().length === 2 && ds.getImportSessions().length === 1, 'no duplicate tournament, hand or session');
  await load('#/data');
  const sess = await waitFor(() => doc().querySelector('.import-session'));
  assert(/1 tournoi/.test(sess.textContent) && /2 mains/.test(sess.textContent) && /ABI 5,00/.test(sess.textContent), `recap: ${sess.querySelector('.recap').textContent}`);
  assert(doc().querySelector('.run-bar .run-marker') && doc().querySelector('svg.wchart polyline'), 'run meter and graph');
  await load('#/leaks');
  await waitFor(() => doc().querySelectorAll('.hud-stat').length >= 7);
  const vpip = [...doc().querySelectorAll('.hud-stat')].find((s) => s.querySelector('.name').textContent === 'VPIP');
  assert(vpip.querySelector('.val').textContent === '50', `VPIP ${vpip.querySelector('.val').textContent}`);
  ds.clearAll();
});
// Play a drill until a hand is finished and listed, answering every decision.
async function playUntilHandListed(drillName) {
  await load('#/practice');
  byRole('button', drillName).click();
  byRole('button', 'Commencer la session').click();
  for (let n = 0; n < 40; n++) {
    if (doc().querySelector('.hand-row')) return;
    const b = await waitFor(() => doc().querySelector('[aria-label="Tes actions"] button'), 8000);
    b.click();
    await sleep(400);
  }
  throw new Error('no hand finished');
}
await test('F11-H1', 'postflop drill: decisions after the flop, XP gained, hand listed', async () => {
  await playUntilHandListed('Postflop');
  const log = [...doc().querySelectorAll('.decision-log li')].map((li) => li.textContent).join(' ');
  assert(/Flop|Turn|River/.test(log), `postflop decisions: ${log.slice(0, 80)}`);
  assert(/\+\d+ XP/.test(doc().querySelector('.progress-strip').textContent), 'XP shown');
});
await test('F11-H2', 'played hand opens a street-by-street replay', async () => {
  doc().querySelector('.hand-row').click();
  const rep = await waitFor(() => doc().querySelector('.replay'));
  assert(rep.querySelectorAll('.replay-street').length >= 2 && rep.querySelector('.ra-decision'), 'streets and graded decision');
  doc().querySelector('.modal-head button').click();
  byRole('button', 'Terminer la session').click();
  await sleep(300);
});
await test('F12-H1', 'multiway drill: three or more players see the flop', async () => {
  await playUntilHandListed('Multiway');
  doc().querySelector('.hand-row').click();
  const rep = await waitFor(() => doc().querySelector('.replay'));
  const pre = rep.querySelector('.replay-street');
  const inPot = [...pre.querySelectorAll('li')].filter((li) => !/Fold/.test(li.querySelector('.ra-act').textContent)).map((li) => li.querySelector('.ra-pos').textContent);
  assert(new Set(inPot).size >= 3, `players in: ${[...new Set(inPot)].join(',')}`);
  doc().querySelector('.modal-head button').click();
  byRole('button', 'Terminer la session').click();
  await sleep(300);
});
await test('F13-H1', 'progression page shows the level, XP and badges', async () => {
  await load('#/stats');
  await waitFor(() => doc().querySelector('.hero-card'));
  assert(doc().querySelectorAll('.badge-card.on').length >= 1 && doc().querySelector('.player-chip .level-badge'), 'badge earned, player chip');
});
await test('F14-H1', 'BB 50bb drill: the BB plays its 50bb chart, explained', async () => {
  await load('#/practice');
  byRole('button', 'Défense BB 50bb').click();
  byRole('button', 'Commencer la session').click();
  for (let n = 0; n < 4; n++) {
    const btn = await waitFor(() => doc().querySelector('[aria-label="Tes actions"] button.act'));
    btn.click();
    const why = await waitFor(() => doc().querySelector('.feedback .why'));
    assert(/Ton chart 50bb \(BB vs/.test(why.textContent), why.textContent);
    byRole('button', 'Main suivante').click();
  }
  byRole('button', 'Terminer la session').click();
});
await test('F15-H1', 'study ⋯: make the BTN loose and add a 3.5bb open', async () => {
  await load('#/study');
  byRole('button', 'Fold jusqu\'au BTN').click();
  await sleep(100);
  byRole('button', 'Profil et sizings du BTN').click();
  const pop = await waitFor(() => doc().querySelector('.popover'));
  const slider = pop.querySelector('input[type="range"]');
  slider.value = '80';
  slider.dispatchEvent(new Event('change', { bubbles: true }));
  const input = await waitFor(() => doc().querySelector('.popover [aria-label="Nouveau sizing Open (ou raise sur limp)"]'));
  input.value = '3.5';
  [...doc().querySelectorAll('.popover button')].find((b) => b.textContent === 'Ajouter').click();
  await waitFor(() => [...doc().querySelectorAll('.act-btn')].some((b) => b.textContent === 'Raise 3.5'));
  assert(/pp=/.test(frame.contentWindow.location.hash) && doc().querySelector('.chip-dots.on'), 'saved in the link, chip marked');
  doc().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await sleep(50);
  assert(!doc().querySelector('.popover'), 'Escape closes');
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
