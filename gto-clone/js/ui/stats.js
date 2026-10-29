import { h, mount, pct, num } from './dom.js';
import { StatTile, FreqBar } from './components.js';
import { getSessions, clearSessions } from '../store.js';
import { DRILLS } from './practice.js';

const GRADES = ['best', 'correct', 'inaccuracy', 'wrong', 'blunder'];
const GRADE_TEXT = { best: 'Best', correct: 'Correct', inaccuracy: 'Inaccuracy', wrong: 'Wrong', blunder: 'Blunder' };
const open = new Set();

export function renderStats(el) {
  const sessions = getSessions();
  if (!sessions.length) {
    mount(el, h('div.empty-state', h('h1', 'No sessions yet'),
      h('p.muted', 'Play a few hands in Practice and your results will show up here.'),
      h('a.btn.primary', { href: '#/practice' }, 'Go to Practice')));
    return;
  }
  const all = sessions.flatMap((s) => s.decisions);
  const dec = sessions.reduce((a, s) => a + s.decisionsCount, 0);
  const hands = sessions.reduce((a, s) => a + s.hands, 0);
  const score = sessions.reduce((a, s) => a + s.scoreSum, 0) / Math.max(1, dec);
  const ev = sessions.reduce((a, s) => a + s.evLoss, 0);
  const mistakes = sessions.reduce((a, s) => a + s.mistakes, 0);
  const counts = Object.fromEntries(GRADES.map((g) => [g, all.filter((d) => d.grade === g).length]));

  const byDrill = DRILLS.map((d) => {
    const ss = sessions.filter((s) => s.drill === d.id);
    const n = ss.reduce((a, s) => a + s.decisionsCount, 0);
    return { d, n, score: ss.reduce((a, s) => a + s.scoreSum, 0) / Math.max(1, n), ev: ss.reduce((a, s) => a + s.evLoss, 0), mistakes: ss.reduce((a, s) => a + s.mistakes, 0) };
  }).filter((r) => r.n);

  mount(el, h('div.stats-page',
    h('div.row.between', h('h1', 'Your stats'), h('button.btn.ghost.sm', { type: 'button', on: { click: () => { if (confirm('Delete all practice history on this device?')) { clearSessions(); renderStats(el); } } } }, 'Clear history')),
    h('div.stats-row.wide',
      StatTile('Score', pct(score, 0), 'average across all decisions'),
      StatTile('Hands', hands), StatTile('Decisions', dec),
      StatTile('Mistake rate', pct(mistakes / Math.max(1, dec), 1)),
      StatTile('EV lost', num(ev, 1) + 'bb', num(ev / Math.max(1, hands), 2) + 'bb per hand')),
    h('div.two-col',
      h('section.panel', h('div.panel-title', 'Decision quality'),
        FreqBar(GRADES.map((g) => ({ role: { best: 'call', correct: 'bet-s', inaccuracy: 'bet-m', wrong: 'bet-l', blunder: 'allin' }[g], label: GRADE_TEXT[g], freq: counts[g] / Math.max(1, all.length) })), { height: 18, labels: true }),
        h('ul.legend', GRADES.map((g) => h('li', h('span.grade-dot.grade-' + g), GRADE_TEXT[g], h('span.mono', counts[g]))))),
      h('section.panel', h('div.panel-title', 'By drill'),
        h('table.data', h('thead', h('tr', h('th', 'Drill'), h('th', 'Decisions'), h('th', 'Score'), h('th', 'Mistakes'), h('th', 'EV lost'))),
          h('tbody', byDrill.map((r) => h('tr', h('td', r.d.name), h('td', r.n), h('td', pct(r.score, 0)), h('td', r.mistakes), h('td', num(r.ev, 2) + 'bb'))))))),
    h('section.panel', h('div.panel-title', 'Sessions'),
      h('ul.sessions', sessions.map((s) => {
        const isOpen = open.has(s.id);
        const sc = s.scoreSum / Math.max(1, s.decisionsCount);
        return h('li.session' + (isOpen ? '.open' : ''),
          h('button.session-head', { type: 'button', 'aria-expanded': isOpen ? 'true' : 'false', on: { click: () => { isOpen ? open.delete(s.id) : open.add(s.id); renderStats(el); } } },
            h('span', isOpen ? '▾' : '▸'), h('strong', DRILLS.find((d) => d.id === s.drill)?.name || s.drill),
            h('span.muted.small', new Date(s.startedAt).toLocaleString()), h('span.grow'),
            h('span.small', `${s.hands} hands`), h('span.small', `score ${pct(sc, 0)}`), h('span.small.mono', `−${num(s.evLoss, 2)}bb`)),
          isOpen ? h('table.data.compact', h('thead', h('tr', h('th', ''), h('th', 'Hand'), h('th', 'Spot'), h('th', 'Board'), h('th', 'You'), h('th', 'Best'), h('th', 'EV loss'))),
            h('tbody', s.decisions.map((d) => h('tr', h('td', h('span.grade-dot.grade-' + d.grade, { title: GRADE_TEXT[d.grade] })), h('td.mono', d.hand), h('td', d.pos + ' · ' + d.street),
              h('td.mono', d.board || '–'), h('td', d.chosen), h('td', d.best), h('td.mono', d.evLoss > 0.005 ? num(d.evLoss, 2) : '0'))))) : null);
      })))));
}
