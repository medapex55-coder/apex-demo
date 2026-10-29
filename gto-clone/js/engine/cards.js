// Card primitives. A card is an int 0..51: rank * 4 + suit.
export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';
export const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };

export const rankOf = (c) => c >> 2;
export const suitOf = (c) => c & 3;
export const parseCard = (s) => RANKS.indexOf(s[0]) * 4 + SUITS.indexOf(s[1]);
export const cardStr = (c) => RANKS[c >> 2] + SUITS[c & 3];

// All 1326 two-card combos, higher card int first.
export const COMBOS = [];
export const COMBO_INDEX = new Int16Array(52 * 52).fill(-1);
for (let a = 51; a >= 0; a--) {
  for (let b = a - 1; b >= 0; b--) {
    COMBO_INDEX[a * 52 + b] = COMBO_INDEX[b * 52 + a] = COMBOS.length;
    COMBOS.push([a, b]);
  }
}
export const comboIndex = (a, b) => COMBO_INDEX[a * 52 + b];
export const comboStr = (i) => cardStr(COMBOS[i][0]) + cardStr(COMBOS[i][1]);

// Combos containing each card (51 each).
export const CARD_COMBOS = Array.from({ length: 52 }, () => []);
COMBOS.forEach(([a, b], i) => { CARD_COMBOS[a].push(i); CARD_COMBOS[b].push(i); });

// The 169 hand classes in 13x13 grid order (row-major, aces top-left).
export const CLASSES = [];
export const CLASS_OF_COMBO = new Uint8Array(1326);
export const CLASS_BY_NAME = {};
for (let row = 0; row < 13; row++) {
  for (let col = 0; col < 13; col++) {
    const r1 = 12 - row, r2 = 12 - col;
    let name, hi, lo, pair = false, suited = false;
    if (row === col) { pair = true; hi = lo = r1; name = RANKS[r1] + RANKS[r1]; }
    else if (col > row) { suited = true; hi = r1; lo = r2; name = RANKS[hi] + RANKS[lo] + 's'; }
    else { hi = r2; lo = r1; name = RANKS[hi] + RANKS[lo] + 'o'; }
    const combos = [];
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = 0; s2 < 4; s2++) {
        if (pair && s2 <= s1) continue;
        if (suited && s1 !== s2) continue;
        if (!pair && !suited && s1 === s2) continue;
        combos.push(comboIndex(hi * 4 + s1, lo * 4 + s2));
      }
    }
    const cls = { id: CLASSES.length, name, row, col, hi, lo, pair, suited, combos };
    combos.forEach((i) => { CLASS_OF_COMBO[i] = cls.id; });
    CLASS_BY_NAME[name] = cls;
    CLASSES.push(cls);
  }
}

export function comboBlocked(i, dead) {
  const [a, b] = COMBOS[i];
  return dead[a] || dead[b];
}

export function deadMask(cards) {
  const m = new Uint8Array(52);
  cards.forEach((c) => { m[c] = 1; });
  return m;
}
