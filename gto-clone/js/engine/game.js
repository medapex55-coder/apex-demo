// 6-max NLHE game tree, blinds 0.5/1. The effective stack and the first-in open
// size come from the spot config (cfg). Preflop becomes heads-up as soon as a
// second player voluntarily enters (everyone else folds), so every postflop
// spot is heads-up.
import { cardStr } from './cards.js';

export const POS = ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
export const STACKS = [200, 100, 80, 70, 50, 40, 30, 25, 20, 15, 10];
export const OPEN_SIZES = ['limp', '2', '2.5', '4.5']; // '2.5' means the SB opens 3.5
export const DEFAULT_CFG = Object.freeze({ stack: 100, open: '2.5' });
export const SHOVE_STACK = 20; // at or below this depth, preflop all-in becomes a strategy
export const STREETS = ['Preflop', 'Flop', 'Turn', 'River'];
const POSTFLOP_ORDER = [4, 5, 0, 1, 2, 3]; // SB first

const round = (x) => Math.round(x * 10) / 10;

export function initialState(cfg = DEFAULT_CFG) {
  return {
    cfg,
    limpers: [],
    street: 0,
    board: [],
    invested: [0, 0, 0, 0, 0.5, 1],
    streetBet: [0, 0, 0, 0, 0.5, 1],
    folded: [false, false, false, false, false, false],
    acted: [false, false, false, false, false, false],
    toAct: 0,
    currentBet: 1,
    raiseLevel: 0,
    streetRaises: 0,
    lastAggr: -1,
    prevAggr: -1,
    locked: false,
    needBoard: 0,
    terminal: null,
    winner: -1,
    history: [],
  };
}

const clone = (st) => ({
  ...st,
  board: st.board.slice(),
  invested: st.invested.slice(),
  streetBet: st.streetBet.slice(),
  folded: st.folded.slice(),
  acted: st.acted.slice(),
  limpers: st.limpers.slice(),
  history: st.history.slice(),
});

export const pot = (st) => st.invested.reduce((a, b) => a + b, 0);
export const remaining = (st, p) => st.cfg.stack - st.invested[p];
export const alive = (st) => POS.map((_, i) => i).filter((i) => !st.folded[i]);
export const toCallOf = (st, p) => Math.max(0, Math.min(st.currentBet - st.streetBet[p], remaining(st, p)));

export function opponentOf(st, p) {
  const others = alive(st).filter((i) => i !== p);
  if (others.length === 1) return others[0];
  if (st.lastAggr >= 0 && st.lastAggr !== p) return st.lastAggr;
  return -1; // several opponents: treat as a random hand
}

// In position = acts last postflop.
export function isIP(st, p) {
  const o = opponentOf(st, p);
  if (o < 0) return p === 3;
  return POSTFLOP_ORDER.indexOf(p) > POSTFLOP_ORDER.indexOf(o);
}

function preflopSizes(st, p) {
  const opener = st.lastAggr;
  if (st.raiseLevel === 0) {
    // Iso-raise: the base open size plus 1bb for each player who limped before.
    if (st.limpers.length) return round((st.cfg.open === 'limp' ? 2 : +st.cfg.open) + st.limpers.length);
    if (st.cfg.open === '2.5' && p === 4) return 3.5;
    return st.cfg.open === 'limp' ? 2.5 : +st.cfg.open;
  }
  if (st.raiseLevel === 1) {
    const open = st.currentBet;
    const ip = POSTFLOP_ORDER.indexOf(p) > POSTFLOP_ORDER.indexOf(opener);
    return round(open * (ip ? 3 : 4));
  }
  if (st.raiseLevel === 2) return round(Math.round(st.currentBet * 2.3 * 2) / 2);
  return st.cfg.stack;
}

export function legalActions(st) {
  if (st.terminal || st.needBoard || st.toAct < 0) return [];
  const p = st.toAct;
  const call = toCallOf(st, p);
  const rem = remaining(st, p);
  const acts = [];
  const P = pot(st);
  if (st.street === 0) {
    if (call > 0) acts.push({ type: 'fold' });
    if (call === 0) acts.push({ type: 'check' });
    // Limping first in: always allowed for the SB, for every seat when the open size is "limp".
    else if (st.raiseLevel > 0 || st.limpers.length || p === 4 || st.cfg.open === 'limp') acts.push({ type: 'call', amount: call });
    const firstIn = st.raiseLevel === 0 && !st.limpers.length;
    if (st.raiseLevel <= 3 && rem > call && !(firstIn && st.cfg.open === 'limp')) {
      let to = Math.min(preflopSizes(st, p), st.streetBet[p] + rem);
      // A re-raise that commits almost half the stack goes all-in instead.
      if (st.raiseLevel >= 1 && to >= (st.streetBet[p] + rem) * 0.45) to = st.streetBet[p] + rem;
      const allin = to >= st.streetBet[p] + rem;
      acts.push({ type: allin ? 'allin' : 'raise', to, level: st.raiseLevel + 1 });
    }
    // 20bb and shorter: shoving is always an option, next to the raise or limp.
    const jam = st.streetBet[p] + rem;
    if (st.cfg.stack <= SHOVE_STACK && st.raiseLevel <= 3 && rem > call && !acts.some((a) => a.type === 'allin')) {
      acts.push({ type: 'allin', to: jam, level: st.raiseLevel + 1 });
    }
    return acts;
  }
  if (call === 0) {
    acts.push({ type: 'check' });
    const seen = new Set();
    for (const f of [0.33, 0.75]) {
      let b = round(P * f);
      let type = 'bet';
      if (b >= rem * 0.67) { b = rem; type = 'allin'; }
      if (seen.has(b)) continue;
      seen.add(b);
      acts.push({ type, to: b, frac: f });
    }
    return acts;
  }
  acts.push({ type: 'fold' });
  acts.push({ type: 'call', amount: call });
  if (rem > call) {
    const to = round(st.currentBet * 3);
    if (st.streetRaises >= 2 || to >= (st.streetBet[p] + rem) * 0.6) acts.push({ type: 'allin', to: st.streetBet[p] + rem });
    else acts.push({ type: 'raise', to });
  }
  return acts;
}

function nextActor(st, from) {
  const order = st.street === 0 ? [0, 1, 2, 3, 4, 5] : POSTFLOP_ORDER;
  const start = order.indexOf(from);
  for (let k = 1; k <= 6; k++) {
    const p = order[(start + k) % 6];
    if (st.folded[p] || remaining(st, p) <= 0) continue;
    if (!st.acted[p] || st.streetBet[p] < st.currentBet) return p;
  }
  return -1;
}

function endStreet(st) {
  const live = alive(st);
  st.prevAggr = st.lastAggr;
  st.street += 1;
  st.streetBet = [0, 0, 0, 0, 0, 0];
  st.acted = [false, false, false, false, false, false];
  st.currentBet = 0;
  st.streetRaises = 0;
  st.lastAggr = -1;
  if (st.street === 4) { st.terminal = 'showdown'; st.toAct = -1; st.street = 3; return; }
  st.needBoard = st.street === 1 ? 3 : 1;
  const canAct = live.filter((p) => remaining(st, p) > 0);
  st.toAct = canAct.length >= 2 ? POSTFLOP_ORDER.find((p) => canAct.includes(p)) : -1;
}

export function applyAction(st0, act) {
  const st = clone(st0);
  const p = st.toAct;
  const label = actionLabel(st0, act);
  const wasOpen = st.raiseLevel >= 1;
  const prevAggr = st.lastAggr;
  if (st.street === 0 && act.type === 'call' && st.raiseLevel === 0) st.limpers.push(p);
  if (act.type === 'fold') st.folded[p] = true;
  else if (act.type === 'call') {
    const put = toCallOf(st, p);
    st.streetBet[p] += put; st.invested[p] += put;
  } else if (act.type === 'bet' || act.type === 'raise' || act.type === 'allin') {
    const put = act.to - st.streetBet[p];
    st.streetBet[p] = act.to; st.invested[p] += put;
    if (act.to > st.currentBet) {
      st.currentBet = act.to;
      st.lastAggr = p;
      st.streetRaises += 1;
      if (st.street === 0) st.raiseLevel += 1;
      st.acted = st.acted.map((_, i) => i === p ? true : false);
    }
  }
  st.acted[p] = true;
  st.history.push({ kind: 'act', p, street: st.street, act, label });

  // Several players may limp; the pot goes heads-up once someone calls or
  // re-raises a raise (the raiser and that player stay in).
  if (st.street === 0 && !st.locked && wasOpen && act.type !== 'fold') {
    POS.forEach((_, i) => { if (i !== p && i !== prevAggr) st.folded[i] = true; });
    st.locked = true;
  }
  const live = alive(st);
  if (live.length === 1) { st.terminal = 'fold'; st.winner = live[0]; st.toAct = -1; return st; }
  const nxt = nextActor(st, p);
  if (nxt >= 0) st.toAct = nxt;
  else endStreet(st);
  return st;
}

export function dealBoard(st0, cards) {
  const st = clone(st0);
  st.board.push(...cards);
  st.needBoard = 0;
  st.history.push({ kind: 'deal', street: st.street, cards: cards.slice() });
  if (st.toAct < 0) {
    // All-in: run the board out.
    if (st.street === 3) { st.terminal = 'showdown'; return st; }
    st.street += 1;
    st.needBoard = 1;
  }
  return st;
}

// Fold every player before `target` in an unopened pot.
export function foldTo(st0, target) {
  let st = st0;
  while (!st.terminal && !st.needBoard && st.toAct !== target && st.toAct >= 0) {
    const acts = legalActions(st);
    const f = acts.find((a) => a.type === 'fold');
    if (!f) break;
    st = applyAction(st, f);
  }
  return st;
}

export function replay(history, cfg = DEFAULT_CFG) {
  let st = initialState(cfg);
  for (const h of history) st = h.kind === 'deal' ? dealBoard(st, h.cards) : applyAction(st, h.act);
  return st;
}

export function actionKey(act) {
  if (act.type === 'fold') return 'F';
  if (act.type === 'check') return 'X';
  if (act.type === 'call') return 'C';
  return (act.type === 'allin' ? 'A' : 'R') + act.to;
}

export function stateKey(st) {
  return `${st.cfg.stack}bb/${st.cfg.open}#` + st.history.map((h) => h.kind === 'deal' ? '/' + h.cards.map(cardStr).join('') : POS[h.p] + ':' + actionKey(h.act)).join('|');
}

export function actionLabel(st, act, units = 'bb') {
  const P = pot(st);
  const fmt = (to) => {
    if (units === 'pct' && st.street > 0) {
      const add = to - st.currentBet;
      return Math.round((add / (P + (st.currentBet - st.streetBet[st.toAct]))) * 100) + '%';
    }
    return +to.toFixed(1) + '';
  };
  switch (act.type) {
    case 'fold': return 'Fold';
    case 'check': return 'Check';
    case 'call': return st.street === 0 && st.raiseLevel === 0 ? 'Limp' : 'Call ' + +act.amount.toFixed(1);
    case 'allin': return 'All-in ' + +act.to.toFixed(1);
    case 'bet': return 'Bet ' + fmt(act.to);
    case 'raise':
      if (st.street === 0) return ['Raise', 'Raise', '3-bet', '4-bet', '5-bet'][act.level] + ' ' + act.to;
      return 'Raise ' + fmt(act.to);
    default: return act.type;
  }
}

// Colour role for an action, from passive to aggressive.
export function actionRole(st, act) {
  if (act.type === 'fold') return 'fold';
  if (act.type === 'check' || act.type === 'call') return 'call';
  if (act.type === 'allin') return 'allin';
  if (st.street === 0) return act.level >= 3 ? 'bet-l' : 'bet-m';
  if (act.type === 'raise') return 'bet-l';
  return act.frac && act.frac < 0.5 ? 'bet-s' : 'bet-m';
}

export function aggression(act) {
  return { fold: 0, check: 1, call: 1, bet: 2, raise: 3, allin: 4 }[act.type] + (act.to ? act.to / 1000 : 0);
}
