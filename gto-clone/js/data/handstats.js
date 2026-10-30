// Per-hand numbers for My Data (winnings, all-in EV, showdown) and the HUD
// stats in Leakfinder (VPIP, PFR, 3-bet…). Each parsed hand is boiled down to
// a small record at import time; the totals are summed from those records.
import { seatMap } from './decisions.js';
import { parseCard } from '../engine/cards.js';
import { evalHand } from '../engine/evaluator.js';
import { mulberry32, hashStr } from '../engine/rng.js';

const r2 = (x) => Math.round(x * 100) / 100;

// Chips each player put in the pot (antes, blinds, bets), minus uncalled bets.
export function contributions(hand) {
  const c = {};
  const add = (n, x) => { c[n] = (c[n] || 0) + x; };
  for (const p of hand.posts || []) if (p.kind === 'ante') add(p.name, p.amount);
  hand.streets.forEach((acts, s) => {
    const st = {};
    if (s === 0) for (const p of hand.posts || []) if (p.kind !== 'ante') st[p.name] = (st[p.name] || 0) + p.amount;
    for (const a of acts) {
      if (a.type === 'call' || a.type === 'bet') st[a.name] = (st[a.name] || 0) + a.amount;
      else if (a.type === 'raise') st[a.name] = a.to;
    }
    for (const n in st) add(n, st[n]);
  });
  for (const n in hand.returned || {}) add(n, -hand.returned[n]);
  return c;
}

// Hero's share of the pot over every runout (ties split). Exact when 1 or 2
// cards are to come, sampled (seeded, so imports are repeatable) otherwise.
export function equityShare(hero, opps, board, seed = 1) {
  const known = new Set([...hero, ...opps.flat(), ...board]);
  const deck = [];
  for (let c = 0; c < 52; c++) if (!known.has(c)) deck.push(c);
  const need = 5 - board.length;
  let share = 0, n = 0;
  const run = (b) => {
    const hv = evalHand(hero[0], hero[1], b);
    let best = hv, ties = 1;
    for (const o of opps) {
      const v = evalHand(o[0], o[1], b);
      if (v > best) { best = v; ties = 0; break; }
      if (v === hv) ties++;
    }
    if (best === hv && ties) share += 1 / ties;
    n++;
  };
  if (need === 0) run(board);
  else if (need === 1) for (const a of deck) run([...board, a]);
  else if (need === 2) for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) run([...board, deck[i], deck[j]]);
  else {
    const rand = mulberry32(seed);
    for (let k = 0; k < 2500; k++) {
      const pick = deck.slice();
      const b = board.slice();
      for (let i = 0; i < need; i++) b.push(pick.splice(Math.floor(rand() * pick.length), 1)[0]);
      run(b);
    }
  }
  return n ? share / n : 0;
}

// Hero's result in big blinds, the all-in adjusted result, and whether it went to showdown.
export function handResult(hand) {
  const H = hand.hero;
  const bb = hand.bb || 1;
  const c = contributions(hand);
  const mine = c[H] || 0;
  const net = (hand.collected?.[H] || 0) - mine;
  const folded = new Set(hand.streets.flat().filter((a) => a.type === 'fold').map((a) => a.name));
  const sd = !!hand.showdown && !folded.has(H);
  let ev = net, v = 0;
  // All-in before the river: the money went in on the last street with action.
  let last = -1;
  hand.streets.forEach((acts, s) => { if (acts.length) last = s; });
  if (sd && last >= 0 && last < 3 && hand.cards) {
    const opps = Object.keys(hand.shown || {}).filter((n) => n !== H && !folded.has(n));
    const live = Object.keys(c).filter((n) => n !== H && !folded.has(n) && c[n] > 0);
    if (opps.length && opps.length >= live.length) {
      const toCards = (s) => s.match(/../g).map(parseCard);
      const board = (hand.board || []).slice(0, last === 0 ? 0 : last + 2).map(parseCard);
      const eq = equityShare(toCards(hand.cards), opps.map((n) => toCards(hand.shown[n])), board, hashStr(String(hand.id)));
      const pot = Object.values(c).reduce((a, x) => a + Math.min(x, mine), 0);
      ev = eq * pot - mine;
      v = (pot / bb) ** 2 * eq * (1 - eq);
    }
  }
  return { net: r2(net / bb), ev: r2(ev / bb), sd, v: r2(v) };
}

// HUD counters: for each stat, present = the hero had the chance, 1 = did it.
export function handFlags(hand) {
  const H = hand.hero;
  const f = {};
  const map = seatMap(hand);
  if (!H || !map) return f;
  const seatOf = new Map(hand.seats.map((s) => [s.name, s.seat]));
  const pos = (n) => map.get(seatOf.get(n));
  const hp = pos(H);
  const set = (k, hit) => { if (!(k in f)) f[k] = hit ? 1 : 0; };

  // ---- preflop ----
  let raises = 0, cold = 0, limpers = 0, firstRaiser = null, lastRaiser = null, heroActs = 0, heroFolded = false;
  for (const a of hand.streets[0]) {
    const aggr = a.type === 'raise' || a.type === 'bet';
    if (a.name === H) {
      heroActs++;
      if (heroActs === 1) {
        set('VPIP', a.type === 'call' || aggr);
        set('PFR', aggr);
        if (!raises && !limpers && hp !== 5) {
          set('RFI', aggr);
          set('LIMP', a.type === 'call');
          if (hp >= 2 && hp <= 4) set('ATS', aggr);
          if (hp === 4) { set('SBO', aggr); set('SBL', a.type === 'call'); }
        }
        if (raises === 1 && !cold) set('3B', aggr);
        if (raises === 1 && cold) set('SQZ', aggr);
        if (hp === 5 && raises === 1 && !cold && !limpers) {
          const op = pos(firstRaiser);
          if (op === 4) { set('BBF_SB', a.type === 'fold'); set('BB3_SB', aggr); }
          if (op >= 2 && op <= 4) { set('FBS', a.type === 'fold'); set('B3S', aggr); }
        }
      } else {
        if (aggr || a.type === 'call') f.VPIP = 1;
        if (aggr) f.PFR = 1;
      }
      if (raises >= 2 && lastRaiser !== H) {
        set('4B', aggr);
        if (firstRaiser === H) set('F3B', a.type === 'fold');
      }
      if (a.type === 'fold') { heroFolded = true; break; }
    }
    if (aggr) { raises++; cold = 0; if (!firstRaiser) firstRaiser = a.name; lastRaiser = a.name; }
    else if (a.type === 'call' && a.name !== H) { if (raises) cold++; else limpers++; }
  }
  if (!heroActs) return {}; // a walk
  if (heroFolded || !(hand.board || []).length) return f;

  // ---- postflop ----
  const res = { sd: !!hand.showdown && !hand.streets.flat().some((a) => a.name === H && a.type === 'fold'), won: (hand.collected?.[H] || 0) > 0 };
  set('WTSD', res.sd);
  set('WWSF', res.won);
  if (res.sd) set('WSD', res.won);
  const flop = hand.streets[1];
  const three = raises === 2;
  const cb = three ? 'CB3' : raises === 1 ? 'CB' : null;
  const fcb = three ? 'FCB3' : raises === 1 ? 'FCB' : null;
  if (cb && lastRaiser === H) {
    const firstHero = flop.findIndex((a) => a.name === H);
    if (firstHero >= 0 && !flop.slice(0, firstHero).some((a) => a.type === 'bet' || a.type === 'raise')) set(cb, flop[firstHero].type === 'bet');
  } else if (fcb && lastRaiser && (!three || firstRaiser === H)) {
    const b = flop.findIndex((a) => a.type === 'bet' || a.type === 'raise');
    if (b >= 0 && flop[b].name === lastRaiser && flop[b].type === 'bet') {
      const reply = flop.slice(b + 1).find((a) => a.name === H || a.type === 'raise');
      if (reply && reply.name === H) set(fcb, reply.type === 'fold');
    }
  }
  let ag = 0, ca = 0;
  for (const acts of hand.streets.slice(1)) for (const a of acts) if (a.name === H) { if (a.type === 'bet' || a.type === 'raise') ag++; else if (a.type === 'call') ca++; }
  if (ag) f.ag = ag;
  if (ca) f.ca = ca;
  return f;
}

// The record kept for each imported hand.
export function handRecord(hand) {
  if (!hand.hero || !hand.cards) return null;
  const r = handResult(hand);
  return { h: hand.id, t: hand.tid, at: hand.at || null, n: r.net, e: r.ev, sd: r.sd ? 1 : 0, v: r.v, f: handFlags(hand) };
}

// ---------- totals ----------
// Normal CDF (Abramowitz–Stegun), for "how many players run better".
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export function results(recs) {
  const n = recs.length;
  let net = 0, ev = 0, sd = 0, nsd = 0, v = 0;
  const curve = [{ i: 0, net: 0, ev: 0, sd: 0, nsd: 0 }];
  recs.forEach((r, i) => {
    net += r.n; ev += r.e; v += r.v;
    if (r.sd) sd += r.n; else nsd += r.n;
    curve.push({ i: i + 1, net, ev, sd, nsd });
  });
  const per100 = (x) => (n ? (x / n) * 100 : 0);
  const luck = net - ev;
  const z = v > 0 ? luck / Math.sqrt(v) : 0;
  return {
    hands: n, net, ev, sd, nsd, luck,
    bb100: per100(net), ev100: per100(ev), sd100: per100(sd), nsd100: per100(nsd), luck100: per100(luck),
    z, runBetter: 1 - phi(z), curve,
  };
}

export const RUN_ZONES = [
  { id: 'terrible', from: -Infinity, to: -2 },
  { id: 'bad', from: -2, to: -1 },
  { id: 'neutral', from: -1, to: 1 },
  { id: 'good', from: 1, to: 2 },
  { id: 'sun', from: 2, to: Infinity },
];
export const runZone = (z) => RUN_ZONES.find((r) => z >= r.from && z < r.to).id;
export function reliability(hands) {
  if (hands < 1000) return 'verylow';
  if (hands < 5000) return 'low';
  if (hands < 20000) return 'medium';
  if (hands < 50000) return 'good';
  return 'high';
}

export function hudTotals(recs) {
  const t = {};
  let ag = 0, ca = 0;
  for (const r of recs) {
    for (const k in r.f) {
      if (k === 'ag') { ag += r.f.ag; continue; }
      if (k === 'ca') { ca += r.f.ca; continue; }
      t[k] = t[k] || { opp: 0, hit: 0 };
      t[k].opp++;
      t[k].hit += r.f[k];
    }
  }
  t.AF = { value: ca ? ag / ca : ag ? Infinity : NaN, opp: ag + ca };
  return t;
}
