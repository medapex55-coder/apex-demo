// A real hand (data/winamax.js) replayed in the engine, so every decision is
// a Study node: seats mapped to the 6-max table (data/decisions.js), the
// effective stack between the hero and the biggest other stack (at the nearest
// Study depth, like Leakfinder), and the real
// bet sizes added as custom sizes of the player who used them (Study's "⋯"
// sizes) when the engine has nothing close. Antes are left out (the engine
// plays blinds only) and the hand is played in chip EV.
import { initialState, applyAction, legalActions, dealBoard, pot, alive } from '../engine/game.js';
import { parseCard } from '../engine/cards.js';
import { seatMap, stackBucket } from './decisions.js';

const AGGRESSIVE = new Set(['bet', 'raise', 'allin']);
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

export function replayHand(hand) {
  const map = seatMap(hand);
  if (!map) throw new Error('Table impossible à ramener au 6-max (moins de 3 joueurs ou bouton inconnu).');
  const seatOf = new Map(hand.seats.map((s) => [s.name, s.seat]));
  const pos = (name) => map.get(seatOf.get(name));
  const heroSeat = hand.seats.find((s) => s.name === hand.hero);
  if (!heroSeat) throw new Error('Le joueur de la main n\'est pas assis à la table.');
  const others = hand.seats.filter((s) => s.name !== hand.hero && s.chips > 0);
  const eff = Math.min(heroSeat.chips, Math.max(...others.map((s) => s.chips))) / hand.bb;
  const stack = stackBucket(eff); // a Study depth, so the decision opens in Study as is
  const base = { stack, open: stack < 37.5 ? '2' : '2.5', ko: false, stage: '100' };
  const present = new Set(map.values());
  const players = {};
  const added = new Set();
  for (let attempt = 0; attempt < 15; attempt++) {
    const cfg = Object.keys(players).length ? { ...base, players: structuredClone(players) } : base;
    const r = tryReplay(hand, cfg, pos, present, added);
    if (!r.need) return { ...r, cfg, heroPos: map.get(heroSeat.seat), stackBB: eff, map, pos };
    const { p, level, value } = r.need;
    added.add(`${p}|${level}|${value}`);
    const s = (players[p] ||= { sizes: {} });
    s.sizes[level] = [...new Set([...(s.sizes[level] || []), value])].sort((a, b) => a - b);
  }
  throw new Error('Tailles de mise impossibles à reproduire.');
}

// One pass. need: a size the engine lacks (then the caller adds it and starts over).
function tryReplay(hand, cfg, pos, present, added) {
  let st = initialState(cfg);
  const steps = [];
  for (const street of hand.streets) {
    if (st.terminal) break;
    if (street.name !== 'preflop') {
      const cards = street.board.slice(st.board.length).map(parseCard);
      if (!st.needBoard || !cards.length) break;
      st = dealBoard(st, cards);
      while (st.needBoard && street.board.length > st.board.length) st = dealBoard(st, street.board.slice(st.board.length, st.board.length + st.needBoard).map(parseCard));
    }
    for (const a of street.actions) {
      if (st.terminal || st.toAct < 0 || st.needBoard) break;
      const p = pos(a.name);
      // Seats nobody sits in (short-handed tables) fold their turn.
      while (st.street === 0 && st.toAct !== p && st.toAct >= 0 && !present.has(st.toAct)) st = applyAction(st, legalActions(st).find((x) => x.type === 'fold'));
      if (st.toAct !== p) {
        if (a.type === 'fold') continue; // a second early player on the same 6-max seat
        return { steps, st, unsupported: 'Ordre des actions impossible à reproduire au 6-max.' };
      }
      const acts = legalActions(st);
      let act;
      if (a.type === 'fold') act = acts.find((x) => x.type === 'fold') || acts.find((x) => x.type === 'check');
      else if (a.type === 'check') act = acts.find((x) => x.type === 'check');
      else if (a.type === 'call') act = acts.find((x) => x.type === 'call') || acts.find((x) => x.type === 'check');
      else {
        const to = a.amount / hand.bb;
        const agg = acts.filter((x) => AGGRESSIVE.has(x.type));
        if (!agg.length) act = acts.find((x) => x.type === 'call');
        else {
          act = agg.reduce((b, x) => (Math.abs(x.to - to) < Math.abs(b.to - to) ? x : b));
          const allin = agg.find((x) => x.type === 'allin');
          if (allin && to >= allin.to * 0.95) act = allin;
          const tol = st.street === 0 && st.raiseLevel === 0 ? 0.3 : 0.12;
          if (act.type !== 'allin' && Math.abs(act.to - to) > tol * to) {
            const need = st.street === 0 ? { p, level: st.raiseLevel + 1, value: round(to, 1) }
              : st.currentBet === 0 ? { p, level: 'post', value: round(to / pot(st), 2) }
                : { p, level: 'raise', value: round(to / st.currentBet, 2) };
            if (!added.has(`${need.p}|${need.level}|${need.value}`)) return { need };
          }
        }
      }
      if (!act) return { steps, st, unsupported: `Action « ${a.type} » impossible à reproduire.` };
      steps.push({ st, p, act, real: a, hero: a.name === hand.hero, street: st.street, heads: alive(st).length });
      st = applyAction(st, act);
    }
  }
  return { steps, st };
}
