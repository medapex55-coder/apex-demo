// Play sessions: tournaments grouped by when they were played, not by when
// they were imported. A session opens with its first tournament and takes
// every tournament that starts within the next 10 hours, so a night that runs
// from 17:00 to 05:00 stays one session.
export const SESSION_HOURS = 10;

const time = (s) => (s ? new Date(s).getTime() : NaN);

// tournaments: [{tid, startedAt?, date?, ...}], hands: [{t: tid, at}].
// Returns sessions newest first: {start, end, tours}, and the tournaments
// with no time at all in a last group with start null.
export function playSessions(tournaments, hands = [], hours = SESSION_HOURS) {
  const first = new Map(), last = new Map();
  for (const r of hands) {
    const x = time(r.at);
    if (!Number.isFinite(x)) continue;
    if (!(first.get(r.t) <= x)) first.set(r.t, x);
    if (!(last.get(r.t) >= x)) last.set(r.t, x);
  }
  const timed = [], untimed = [];
  for (const t of tournaments) {
    const start = Number.isFinite(time(t.startedAt)) ? time(t.startedAt) : first.get(t.tid) ?? time(t.date && t.date + 'T00:00:00');
    if (Number.isFinite(start)) timed.push({ t, start, end: Math.max(start, last.get(t.tid) ?? start) });
    else untimed.push(t);
  }
  timed.sort((a, b) => a.start - b.start);
  const out = [];
  let cur = null;
  for (const x of timed) {
    if (!cur || x.start - cur.start > hours * 3600e3) out.push(cur = { start: x.start, end: x.end, tours: [] });
    cur.tours.push(x.t);
    cur.end = Math.max(cur.end, x.end);
  }
  out.reverse();
  if (untimed.length) out.push({ start: null, end: null, tours: untimed });
  return out;
}

// Average buy-in of the finished tournaments (re-entries not counted). The
// summary's buy-in, else the one read from the hand history.
const buyinOf = (t) => (Number.isFinite(t.buyin) ? t.buyin : t.hhBuyin);
export function abi(tournaments) {
  const done = tournaments.filter((t) => !t.running && Number.isFinite(buyinOf(t)));
  return done.length ? done.reduce((a, t) => a + buyinOf(t), 0) / done.length : NaN;
}
