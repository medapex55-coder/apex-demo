// 5-7 card hand evaluator. Returns an int: category << 20 | kickers (4 bits each).
// Categories: 0 high card, 1 pair, 2 two pair, 3 trips, 4 straight, 5 flush,
// 6 full house, 7 quads, 8 straight flush.
import { RANKS } from './cards.js';

export const CATEGORY_NAMES = ['High card', 'Pair', 'Two pair', 'Trips', 'Straight', 'Flush', 'Full house', 'Quads', 'Straight flush'];

const rc = new Uint8Array(13);
const sc = new Uint8Array(4);
const sm = new Uint16Array(4);
const buf = new Int8Array(7);

export function straightHigh(mask) {
  for (let h = 12; h >= 4; h--) {
    const m = 0x1f << (h - 4);
    if ((mask & m) === m) return h;
  }
  if ((mask & 0x100f) === 0x100f) return 3; // wheel
  return -1;
}

function topRanks(mask, n, excl1 = -1, excl2 = -1) {
  let v = 0, k = 0;
  for (let r = 12; r >= 0 && k < n; r--) {
    if ((mask & (1 << r)) && r !== excl1 && r !== excl2) { v = (v << 4) | r; k++; }
  }
  return v << (4 * (n - k));
}

export function evalCards(cards, n) {
  rc.fill(0); sc.fill(0); sm.fill(0);
  let all = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i], r = c >> 2, s = c & 3;
    rc[r]++; sc[s]++; sm[s] |= 1 << r; all |= 1 << r;
  }
  let fs = -1;
  for (let s = 0; s < 4; s++) if (sc[s] >= 5) fs = s;
  if (fs >= 0) {
    const sf = straightHigh(sm[fs]);
    if (sf >= 0) return (8 << 20) | (sf << 16);
  }
  let q = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = rc[r];
    if (k === 4) q = r;
    else if (k === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
    else if (k === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
  }
  if (q >= 0) return (7 << 20) | (q << 16) | (topRanks(all, 1, q) << 12);
  if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) {
    const pr = Math.max(t2, p1);
    return (6 << 20) | (t1 << 16) | (pr << 12);
  }
  if (fs >= 0) return (5 << 20) | topRanks(sm[fs], 5);
  const st = straightHigh(all);
  if (st >= 0) return (4 << 20) | (st << 16);
  if (t1 >= 0) return (3 << 20) | (t1 << 16) | (topRanks(all, 2, t1) << 8);
  if (p1 >= 0 && p2 >= 0) return (2 << 20) | (p1 << 16) | (p2 << 12) | (topRanks(all, 1, p1, p2) << 8);
  if (p1 >= 0) return (1 << 20) | (p1 << 16) | (topRanks(all, 3, p1) << 4);
  return topRanks(all, 5);
}

export function evalHand(a, b, board) {
  buf[0] = a; buf[1] = b;
  for (let i = 0; i < board.length; i++) buf[i + 2] = board[i];
  return evalCards(buf, board.length + 2);
}

// Postflop hand categories, strongest first. Used for filters and heuristics.
export const MADE = ['Straight flush', 'Quads', 'Full house', 'Flush', 'Straight', 'Set', 'Trips', 'Two pair', 'Overpair', 'Top pair', 'Middle pair', 'Weak pair', 'Ace high', 'Nothing'];
export const DRAWS = ['Flush draw', 'Open-ended', 'Gutshot'];
// French display names; the English names above stay the internal keys.
const CAT_FR = {
  'Straight flush': 'Quinte flush', Quads: 'Carré', 'Full house': 'Full', Flush: 'Couleur', Straight: 'Quinte', Set: 'Brelan (set)',
  Trips: 'Brelan (trips)', 'Two pair': 'Double paire', Overpair: 'Overpair', 'Top pair': 'Top paire', 'Middle pair': 'Paire moyenne',
  'Weak pair': 'Petite paire', 'Ace high': 'Hauteur As', Nothing: 'Rien', 'Flush draw': 'Tirage couleur', 'Open-ended': 'Tirage quinte bilatéral', Gutshot: 'Tirage ventral',
};
export const catFr = (c) => CAT_FR[c] || c;

function outRanks(mask) {
  let outs = 0;
  for (let r = 0; r < 13; r++) {
    if (mask & (1 << r)) continue;
    if (straightHigh(mask | (1 << r)) >= 0) outs++;
  }
  return outs;
}

export function classify(a, b, board) {
  const v = evalHand(a, b, board);
  const cat = v >> 20;
  const ra = a >> 2, rb = b >> 2;
  const bRanks = [...new Set(board.map((c) => c >> 2))].sort((x, y) => y - x);
  let made;
  if (cat === 8) made = 'Straight flush';
  else if (cat === 7) made = 'Quads';
  else if (cat === 6) made = 'Full house';
  else if (cat === 5) made = 'Flush';
  else if (cat === 4) made = 'Straight';
  else if (cat === 3) made = ra === rb && bRanks.includes(ra) ? 'Set' : 'Trips';
  else {
    const hits = [ra, rb].filter((r) => bRanks.includes(r));
    if (ra === rb) {
      if (ra > bRanks[0]) made = 'Overpair';
      else if (bRanks.length > 1 && ra > bRanks[1]) made = 'Middle pair';
      else made = 'Weak pair';
    } else if (hits.length === 2) made = 'Two pair';
    else if (hits.length === 1) {
      const h = hits[0];
      made = h === bRanks[0] ? 'Top pair' : h === bRanks[1] ? 'Middle pair' : 'Weak pair';
    } else if (ra === 12 || rb === 12) made = 'Ace high';
    else made = 'Nothing';
  }
  let draw = null;
  if (board.length < 5 && cat < 4) {
    const suits = [0, 0, 0, 0];
    board.forEach((c) => suits[c & 3]++);
    const fd = [a & 3, b & 3].some((s) => suits[s] + ((a & 3) === s) + ((b & 3) === s) >= 4);
    if (fd) draw = 'Flush draw';
    else {
      let boardMask = 0;
      board.forEach((c) => { boardMask |= 1 << (c >> 2); });
      const withHand = boardMask | (1 << ra) | (1 << rb);
      const outs = outRanks(withHand) - outRanks(boardMask);
      if (outs >= 2) draw = 'Open-ended';
      else if (outs === 1) draw = 'Gutshot';
    }
  }
  return { made, draw, cat, value: v };
}

export function describeValue(v) {
  const cat = v >> 20;
  const top = RANKS[(v >> 16) & 15];
  return `${CATEGORY_NAMES[cat]} (${top})`;
}
