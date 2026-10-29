// Tournament file parsers. Everything runs in the browser; nothing is uploaded.
// One tournament = two files: a summary (results) and a hand history (hands).
// PokerStars summaries were checked against real files. The PokerStars hand
// history and both Winamax formats follow the rooms' published layouts and
// may need fixes on real files. PMU and Betclic aren't supported yet.

export function money(s) {
  if (s == null) return 0;
  const m = String(s).replace(/\s/g, '').replace(/[€$£]|EUR|USD/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

export function detect(text) {
  const head = text.slice(0, 600);
  if (/PokerStars Tournament #\d+/.test(head)) return { room: 'PokerStars', kind: 'summary' };
  if (/PokerStars Hand #\d+: Tournament #\d+/.test(head)) return { room: 'PokerStars', kind: 'hands' };
  if (/Winamax Poker - Tournament summary/i.test(head)) return { room: 'Winamax', kind: 'summary' };
  if (/Winamax Poker - .*Tournament "/.test(head)) return { room: 'Winamax', kind: 'hands' };
  if (/PMU|Betclic/i.test(head)) return { room: /PMU/i.test(head) ? 'PMU' : 'Betclic', kind: 'unsupported' };
  return null;
}

export function guessType(text, buyinParts) {
  if (/myst/i.test(text)) return 'mystery';
  if (/knock-?out|bounty|\bKO\b|progressive/i.test(text) || buyinParts >= 3) return 'ko';
  return 'vanilla';
}

// ---------- PokerStars ----------
function parseStarsSummary(text) {
  const lines = text.split(/\r?\n/);
  const tid = text.match(/PokerStars Tournament #(\d+)/)[1];
  const buyLine = (text.match(/Buy-In: ([^\n]+?)\s*(?:EUR|USD)?\s*$/m) || [])[1] || '';
  const parts = buyLine.split('/').map(money).filter((x) => x > 0);
  const buyin = parts.reduce((a, b) => a + b, 0);
  const nameLines = [];
  for (let i = 1; i < lines.length && !/^Buy-In:/.test(lines[i]); i++) if (lines[i].trim()) nameLines.push(lines[i].trim());
  const reentry = text.match(/You made (\d+) re-entries for a total of ([^\s.]+(?:\.\d+)?)/);
  const place = text.match(/You finished in (\d+)(?:st|nd|rd|th) place/);
  const received = text.match(/received ([€$]?[\d.,]+\s*€?)/);
  const started = text.match(/Tournament started (\d{4})\/(\d{2})\/(\d{2})/);
  const game = (text.match(/PokerStars Tournament #\d+, ([^\n]+)/) || [])[1] || "Hold'em";
  return {
    room: 'PokerStars', tid,
    name: [nameLines.join(' · '), `${game.trim()} ${parts.map((x) => '€' + x.toFixed(2)).join('+')}`].filter(Boolean).join(' · '),
    buyin,
    buyinParts: parts.length,
    reentries: reentry ? +reentry[1] : 0,
    reentryCost: reentry ? money(reentry[2]) : 0,
    players: +((text.match(/^(\d+) players/m) || [])[1] || 0),
    prizePool: money((text.match(/Total Prize Pool: ([^\n]+)/) || [])[1]),
    place: place ? +place[1] : null,
    prize: received ? money(received[1]) : null,
    date: started ? `${started[1]}-${started[2]}-${started[3]}` : null,
    finished: /You finished/.test(text),
    rows: lines.filter((l) => /^\s*\d+: /.test(l)),
    type: guessType(nameLines.join(' '), parts.length),
  };
}

function parseStarsHands(text) {
  const hands = [];
  for (const block of text.split(/\n\s*\n(?=PokerStars Hand #)/)) {
    const head = block.match(/PokerStars Hand #(\d+): Tournament #(\d+),[^\n]*?\(([\d,]+)\/([\d,]+)\)/);
    if (!head) continue;
    const table = block.match(/^Table '[^']*' (\d+)-max Seat #(\d+) is the button/m);
    const seats = [];
    for (const m of block.matchAll(/^Seat (\d+): (.+?) \((\d+) in chips[^)]*\)/gm)) seats.push({ seat: +m[1], name: m[2], chips: +m[3] });
    const dealt = block.match(/^Dealt to (.+?) \[(\S\S) (\S\S)\]/m);
    const pre = sectionLines(block, '*** HOLE CARDS ***').map((l) => {
      const m = l.match(/^(.+?): (folds|checks|calls|bets|raises)(?: ([\d,]+))?(?: to ([\d,]+))?( and is all-in)?/);
      return m && { name: m[1], type: m[2].replace(/s$/, ''), amount: +(m[3] || '0').replace(/,/g, ''), to: +(m[4] || m[3] || '0').replace(/,/g, ''), allin: !!m[5] };
    }).filter(Boolean);
    const hero = dealt && dealt[1];
    let bounty = 0;
    if (hero) {
      for (const m of block.matchAll(/^(.+?) wins (?:the |a )?(?:mystery )?(?:bounty )?(?:of )?([€$]?[\d.,]+ ?€?)(?: bounty)? for (?:eliminating|splitting)/gim)) {
        if (m[1] === hero) bounty += money(m[2]);
      }
    }
    hands.push({
      id: head[1], tid: head[2], bb: +head[4].replace(/,/g, ''), max: table ? +table[1] : 9, button: table ? +table[2] : 0,
      seats, hero, cards: dealt ? dealt[2] + dealt[3] : null, pre, bounty,
    });
  }
  return { room: 'PokerStars', tid: hands[0]?.tid, hands, hero: hands.find((x) => x.hero)?.hero || null, isKO: /bounty/i.test(text) };
}

// Lines after a "*** X ***" marker, up to the next marker.
function sectionLines(block, marker) {
  const i = block.indexOf(marker);
  if (i < 0) return [];
  const rest = block.slice(i + marker.length).split(/\r?\n/);
  const out = [];
  for (const l of rest) {
    if (/^\*\*\* /.test(l)) break;
    if (l.trim()) out.push(l.trim());
  }
  return out;
}

// ---------- Winamax ----------
function parseWinamaxSummary(text) {
  const head = text.match(/Tournament summary : (.+?)\((\d+)\)/);
  const buyLine = (text.match(/^Buy-In : ([^\n]+)/m) || [])[1] || '';
  const parts = buyLine.split('+').map(money).filter((x) => x > 0);
  const place = text.match(/You finished in (\d+)/);
  const won = text.match(/You won ([^\n]+)/);
  let prize = 0, bounty = 0;
  if (won) {
    const bm = won[1].match(/Bounty\s*:?\s*([\d.,]+)/i);
    bounty = bm ? money(bm[1]) : 0;
    prize = money(won[1].replace(/\+?\s*Bounty.*$/i, ''));
  }
  const started = text.match(/Tournament started (\d{4})\/(\d{2})\/(\d{2})/);
  const type = (text.match(/^Type : ([^\n]+)/m) || [])[1] || '';
  return {
    room: 'Winamax', tid: head ? head[2] : null, name: head ? head[1].trim() : 'Winamax tournament',
    buyin: parts.reduce((a, b) => a + b, 0), buyinParts: parts.length, reentries: +((text.match(/re-?entr[^\d]*(\d+)/i) || [])[1] || 0), reentryCost: 0,
    players: +((text.match(/Registered players : (\d+)/) || [])[1] || 0),
    prizePool: money((text.match(/Prizepool : ([^\n]+)/i) || [])[1]),
    place: place ? +place[1] : null, prize, bounty,
    date: started ? `${started[1]}-${started[2]}-${started[3]}` : null,
    finished: !!place, rows: [],
    type: guessType(`${head ? head[1] : ''} ${type}`, parts.length),
  };
}

function parseWinamaxHands(text) {
  const hands = [];
  for (const block of text.split(/\n\s*\n(?=Winamax Poker - )/)) {
    const head = block.match(/^Winamax Poker - .*?Tournament "(.+?)".*?HandId: #([\d-]+).*?\(([\d/]+)\)/m);
    if (!head) continue;
    const blinds = head[3].split('/').map(Number);
    const table = block.match(/^Table: '.*?\((\d+)\)#?\d*' (\d+)-max .*?Seat #(\d+) is the button/m);
    const seats = [];
    for (const m of block.matchAll(/^Seat (\d+): (.+?) \((\d+)(?:, [^)]*)?\)/gm)) seats.push({ seat: +m[1], name: m[2], chips: +m[3] });
    const dealt = block.match(/^Dealt to (.+?) \[(\S\S) (\S\S)\]/m);
    const names = seats.map((s) => s.name).sort((a, b) => b.length - a.length);
    const pre = sectionLines(block, '*** PRE-FLOP ***').map((l) => {
      const name = names.find((n) => l.startsWith(n + ' '));
      if (!name) return null;
      const m = l.slice(name.length + 1).match(/^(folds|checks|calls|bets|raises)(?: ([\d.]+))?(?: to ([\d.]+))?( and is all-in)?/);
      return m && { name, type: m[1].replace(/s$/, ''), amount: +(m[2] || 0), to: +(m[3] || m[2] || 0), allin: !!m[4] };
    }).filter(Boolean);
    hands.push({
      id: head[2], tid: table ? table[1] : null, name: head[1], bb: blinds[blinds.length - 1], max: table ? +table[2] : 6, button: table ? +table[3] : 0,
      seats, hero: dealt && dealt[1], cards: dealt ? dealt[2] + dealt[3] : null, pre, bounty: 0,
    });
  }
  return { room: 'Winamax', tid: hands[0]?.tid, hands, hero: hands.find((x) => x.hero)?.hero || null, isKO: /bounty|KO/i.test(text) };
}

export function parseFile(text) {
  const d = detect(text);
  if (!d) return { error: 'Format not recognised' };
  if (d.kind === 'unsupported') return { error: `${d.room} files aren't supported yet — send me one and I'll add it` };
  try {
    if (d.room === 'PokerStars') return d.kind === 'summary' ? { summary: parseStarsSummary(text) } : { hands: parseStarsHands(text) };
    return d.kind === 'summary' ? { summary: parseWinamaxSummary(text) } : { hands: parseWinamaxHands(text) };
  } catch (e) {
    return { error: 'Could not read this file: ' + e.message };
  }
}
