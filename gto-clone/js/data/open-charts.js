// The user's preflop open charts, 6-max 100bb deep (provided 2026-10-29).
// 13x13, rows and columns A..2, suited above the diagonal, offsuit below.
// Codes:
//   R raise              F fold
//   L "Loosifie": add these when playing looser
//   T "Tightfie": drop these when playing tighter
//   X split cell, half raise / half Tightfie
//   SB only: M limp, H split cell, half raise / half limp
// Split cells are read as 50/50 from the screenshots; adjust here if needed.
export const OPEN_CHARTS = {
  LJ: [
    'RRRRRRRRRRRRX',
    'RRRRRRXXLFFFF',
    'RRRRRRLFFFFFF',
    'RXLRRRLFFFFFF',
    'RLLLRRRFFFFFF',
    'FFFFFRRLFFFFF',
    'FFFFFFRXFFFFF',
    'FFFFFFFRLFFFF',
    'FFFFFFFFRLFFF',
    'FFFFFFFFFRFFF',
    'FFFFFFFFFFXFF',
    'FFFFFFFFFFFLF',
    'FFFFFFFFFFFFL',
  ],
  HJ: [
    'RRRRRRRRRRRRR',
    'RRRRRRRRRXLFF',
    'RRRRRRRLLFFFF',
    'RRRRRRRLFFFFF',
    'RRXXRRRXFFFFF',
    'XFFFLRRRLFFFF',
    'LFFFFFRRXFFFF',
    'FFFFFFFRXFFFF',
    'FFFFFFFFRLFFF',
    'FFFFFFFFFRLFF',
    'FFFFFFFFFFRFF',
    'FFFFFFFFFFFRF',
    'FFFFFFFFFFFFX',
  ],
  CO: [
    'RRRRRRRRRRRRR',
    'RRRRRRRRRRRRX',
    'RRRRRRRRRRXLF',
    'RRRRRRRRXLFFF',
    'RRRRRRRRXFFFF',
    'RXLLXRRRRFFFF',
    'RFFFFLRRRLFFF',
    'XFFFFFFRRXFFF',
    'FFFFFFFFRRLFF',
    'LFFFFFFFFRRFF',
    'FFFFFFFFFFRFF',
    'FFFFFFFFFFFRF',
    'FFFFFFFFFFFFR',
  ],
  BTN: [
    'RRRRRRRRRRRRR',
    'RRRRRRRRRRRRR',
    'RRRRRRRRRRRRR',
    'RRRRRRRRRRRRX',
    'RRRRRRRRRRRXL',
    'RRRRRRRRRRFFF',
    'RRRRRRRRRRLFF',
    'RRLLLLXRRRRFF',
    'RXFFFFFLRRRLF',
    'RLFFFFFFFRRRF',
    'RFFFFFFFFFRXF',
    'RFFFFFFFFFFRF',
    'XFFFFFFFFFFFR',
  ],
  SB: [
    'HRRRRRRMMMMMM',
    'HHRRRRMMMMMMM',
    'RRRRRMMMMMMMM',
    'RRMRRMMMMMMMM',
    'RMMMRRMMMMMMM',
    'MMMMRRHMMMMMM',
    'MMMMMRMHMMMMM',
    'MMMMMMRMMRRMM',
    'MMMMMMMMMMRRM',
    'MMMMFFMMMMMRR',
    'MMMMFFFFFMMMM',
    'MMMFFFFFFFFMM',
    'MMMFFFFFFFFFM',
  ],
};

export const TAG_NAMES = { L: 'Loosifie', T: 'Tightfie', X: 'Raise / Tightfie', H: 'Raise / Limp' };
