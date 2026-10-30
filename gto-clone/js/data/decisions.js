// Turn parsed hands into the hero's preflop decisions, described in the terms
// of the Study tree (6-max seats, stack bucket, scenario). Tables with more
// seats map their early positions to LJ. Spots the tree doesn't model
// (multiway, cold 4-bets, heads-up tables) are counted as "not covered".
import { STACKS } from '../engine/game.js';

// Seat -> Study seat index (0 LJ, 1 HJ, 2 CO, 3 BTN, 4 SB, 5 BB).
export function seatMap(hand) {
  const live = hand.seats.filter((s) => s.chips > 0).map((s) => s.seat).sort((a, b) => a - b);
  if (live.length < 3) return null;
  const bi = live.indexOf(hand.button);
  if (bi < 0) return null;
  const order = [...live.slice(bi + 1), ...live.slice(0, bi + 1)]; // SB, BB, ..., BTN
  const map = new Map();
  map.set(order[0], 4);
  map.set(order[1], 5);
  map.set(order[order.length - 1], 3);
  const middle = order.slice(2, -1); // early → late
  middle.forEach((s, i) => {
    const fromEnd = middle.length - 1 - i;
    map.set(s, fromEnd === 0 ? 2 : fromEnd === 1 ? 1 : 0);
  });
  return map;
}

export function stackBucket(bb) {
  let best = STACKS[0];
  for (const s of STACKS) if (Math.abs(Math.log(s / bb)) < Math.abs(Math.log(best / bb))) best = s;
  return best;
}

function openCfg(sizeBB) {
  if (!sizeBB) return '2.5';
  if (sizeBB < 2.25) return '2';
  if (sizeBB >= 3.75) return '4.5';
  return '2.5';
}

const heroAct = (a, stackChips) => {
  if (a.type === 'raise' || a.type === 'bet') return a.allin || a.to >= stackChips * 0.9 ? 'allin' : 'raise';
  if (a.type === 'call') return a.allin ? 'call' : 'call';
  return a.type; // fold, check
};

// Returns { decisions: [...], skipped: n }
export function extractDecisions(hand) {
  const out = [];
  if (!hand.hero || !hand.cards || !hand.pre.length) return { decisions: out, skipped: 0 };
  const map = seatMap(hand);
  if (!map) return { decisions: out, skipped: 1 };
  const bySeatName = new Map(hand.seats.map((s) => [s.name, s]));
  const pos = (name) => map.get(bySeatName.get(name)?.seat);
  const chips = (name) => bySeatName.get(name)?.chips || 0;
  const hero = hand.hero;
  const hp = pos(hero);
  const bb = hand.bb || 1;
  const others = hand.seats.filter((s) => s.name !== hero && s.chips > 0);
  const base = { h: hand.id, t: hand.tid, at: hand.at || null, c: hand.cards, hp };

  let raises = [], limpers = [], coldCallers = 0, heroActs = 0, skipped = 0;
  for (const a of hand.pre) {
    if (a.name === hero) {
      heroActs++;
      const act = heroAct(a, chips(hero));
      if (heroActs === 1) {
        if (!raises.length && !limpers.length) {
          if (hp === 5) break; // walk
          const eff = Math.min(chips(hero), Math.max(...others.map((o) => o.chips))) / bb;
          out.push({ ...base, sc: 'RFI', s: stackBucket(eff), o: openCfg(act === 'raise' ? a.to / bb : 0), a: act });
        } else if (!raises.length) {
          const lp = limpers.map(pos);
          if (new Set(lp).size !== lp.length || lp.some((x) => x >= hp && hp !== 5)) { skipped++; break; }
          const eff = Math.min(chips(hero), Math.max(...limpers.map(chips))) / bb;
          out.push({ ...base, sc: 'VL', lp, s: stackBucket(eff), o: 'limp', a: act });
        } else if (raises.length === 1 && !coldCallers && !limpers.length) {
          const r = raises[0];
          const vp = pos(r.name);
          if (vp == null || vp >= hp) { skipped++; break; }
          const eff = Math.min(chips(hero), chips(r.name)) / bb;
          out.push({ ...base, sc: r.allin ? 'VS' : 'VO', vp, s: stackBucket(eff), o: openCfg(r.to / bb), a: act });
        } else { skipped++; break; }
      } else if (heroActs === 2) {
        // Hero opened and faces exactly one re-raise.
        const first = out[0];
        if (first && first.sc === 'RFI' && first.a === 'raise' && raises.length === 2 && raises[0].name === hero && !coldCallers) {
          const r = raises[1];
          const vp = pos(r.name);
          if (vp != null && vp > hp) out.push({ ...base, sc: 'V3', vp, s: first.s, o: first.o, a: act, r3: r.allin });
        }
        break;
      }
      if (act === 'raise' || act === 'allin') raises.push({ name: hero, to: a.to, allin: act === 'allin' });
      if (act === 'fold') break;
      continue;
    }
    if (a.type === 'raise' || a.type === 'bet') raises.push({ name: a.name, to: a.to, allin: a.allin });
    else if (a.type === 'call') { if (raises.length) coldCallers++; else limpers.push(a.name); }
  }
  return { decisions: out, skipped };
}
