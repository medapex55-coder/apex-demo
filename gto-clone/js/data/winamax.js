// Winamax replayer links: https://www.winamax.fr/replayer/replayer.html?2026-<64 hex>
// The replayer loads the hand as JSON from poker-assets.winamax.fr (public,
// readable from any page); the path splits the id like the replayer does:
// 2026-abcd… -> 2026/ab/cd/abcd…
const BASE = 'https://poker-assets.winamax.fr/replayer/hand/';

export function handIdFromLink(link) {
  const m = /(20\d{2}-[0-9a-f]{64})/i.exec(String(link || ''));
  return m ? m[1].toLowerCase() : null;
}

export function handUrl(id) {
  const m = /^(\d+)-([0-9a-f]{2})([0-9a-f]{2})(.*)$/.exec(id);
  return m ? `${BASE}${m[1]}/${m[2]}/${m[3]}/${m[2]}${m[3]}${m[4]}` : null;
}

export async function fetchWinamaxHand(link) {
  const id = handIdFromLink(link);
  if (!id) throw new Error('Ce lien n\'est pas un lien de replayer Winamax (il doit contenir 2026-… suivi de 64 caractères).');
  const res = await fetch(handUrl(id));
  if (!res.ok) throw new Error(`Winamax ne renvoie pas cette main (erreur ${res.status}).`);
  return parseWinamaxHand(await res.json());
}

const TYPES = { fold: 'fold', check: 'check', call: 'call', bet: 'bet', raise: 'raise' };

// The replayer JSON as a plain hand: blinds and ante in chips, seats with
// their stacks before the hand, the button seat, and per street the board and
// the actions (amount: chips put in for a call, the street total for a bet or raise).
export function parseWinamaxHand(json) {
  const d = (Array.isArray(json) ? json[0] : json)?.CUR?.DATAS;
  if (!d) throw new Error('Format de main inconnu.');
  const g = d.GAME;
  const [ante, sb, bb] = String(g.BETTING).split('-').map(Number);
  const seats = d.SEATS.map((s) => ({ seat: +s.SEAT_ID, name: s.PLAYER.LOGIN, chips: +s.PLAYER.MONEY, bounty: s.PLAYER.BOUNTY != null ? +s.PLAYER.BOUNTY : null }));
  const streets = [];
  for (const r of d.ROUNDS) {
    const name = { 'pre-flop': 'preflop', flop: 'flop', turn: 'turn', river: 'river' }[r.ROUND];
    if (!name) continue;
    streets.push({
      name, board: r.BOARD || [],
      actions: (r.ACTIONS || []).filter((a) => TYPES[a.ACTION]).map((a) => ({ name: a.LOGIN, type: TYPES[a.ACTION], amount: +a.AMOUNT })),
    });
  }
  const res = d.RESULT || {};
  return {
    id: (Array.isArray(json) ? json[0] : json).CUR.HAND_ID,
    tournament: g.PNAME || g.NAME, type: g.TYPE, buyin: g.PBUYIN != null ? +g.PBUYIN + (+g.PFEE || 0) : null,
    ko: d.THEME === 'spaceko' || seats.some((s) => s.bounty != null),
    ante, sb, bb, button: +g.DEALER, seats,
    hero: d.PLAYER_LOGIN, heroCards: d.POCKET_CARDS || [],
    streets,
    winners: (res.WINNERS || []).map((w) => ({ name: w.LOGIN, amount: +w.AMOUNT, cards: w.HAND })),
    shown: Object.fromEntries([...(res.WINNERS || []), ...(res.LOOSERS || [])].filter((p) => p.HAND).map((p) => [p.LOGIN, p.HAND])),
    date: res.DATE ? new Date(+res.DATE * 1000) : null,
  };
}
