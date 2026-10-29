import { h, mount, pct } from './dom.js';
import { StatTile } from './components.js';
import { getDecisions, getTournaments } from '../data/datastore.js';
import { analyzeDecisions, verdict, biggestGap, SCEN, STACK_GROUPS } from '../data/leaks.js';

const filter = { type: 'all', scen: 'all', group: 'all', show: 'all', minN: 1 };
const open = new Set();
let root;

const ACT_ROLE = { fold: 'fold', call: 'call', raise: 'bet-m', allin: 'allin' };
const GRADE_TEXT = { best: 'Best', correct: 'Correct', inaccuracy: 'Inaccuracy', wrong: 'Wrong', blunder: 'Blunder' };

export function renderLeaks(el) {
  root = el;
  const decisions = getDecisions();
  if (!decisions.length) {
    mount(root, h('div.empty-state', h('h1', 'Leakfinder'),
      h('p.muted', 'Import your tournaments (with their hand histories) in My Data first. Leakfinder then checks every preflop decision you made against the Study strategy.'),
      h('a.btn.primary', { href: '#/data' }, 'Go to My Data')));
    return;
  }
  mount(root, h('div.panel.loading', h('div.spinner'), 'Analysing your hands…'));
  setTimeout(() => render(decisions), 20);
}

function render(all) {
  const types = new Map(getTournaments().map((t) => [t.tid, t.type]));
  const decisions = all.filter((d) => filter.type === 'all' || types.get(d.t) === filter.type);
  const { spots, covered, notCovered } = analyzeDecisions(decisions);
  const shown = spots
    .filter((s) => (filter.scen === 'all' || s.sc === filter.scen) && (filter.group === 'all' || s.group === filter.group) && s.n >= filter.minN)
    .filter((s) => filter.show === 'all' || verdict(s) === filter.show)
    .sort((a, b) => order(a) - order(b) || a.avg - b.avg || b.n - a.n);
  const tot = spots.reduce((a, s) => ({ n: a.n + s.n, score: a.score + s.score, m: a.m + s.mistakes }), { n: 0, score: 0, m: 0 });
  const weak = spots.filter((s) => verdict(s) === 'weak').length;
  const strong = spots.filter((s) => verdict(s) === 'strong').length;
  const sel = (label, key, opts) => h('label.pick-field', label, h('select', { on: { change: (e) => { filter[key] = e.target.value === 'all' || isNaN(+e.target.value) ? e.target.value : +e.target.value; render(all); } } },
    opts.map(([v, l]) => h('option', { value: String(v), selected: filter[key] === v }, l))));

  mount(root, h('div.leaks-page',
    h('h1', 'Leakfinder'),
    h('p.muted', 'Each preflop decision from your hand histories is rebuilt as a Study spot (stack, position, action before you) and compared with the strategy for your hand. Red = weak spot, green = strong spot.'),
    h('div.stats-row.wide',
      StatTile('Decisions checked', covered, notCovered ? `${notCovered} spots not covered (multiway, cold 4-bets…)` : null),
      StatTile('Score', pct(tot.score / Math.max(1, tot.n), 0)),
      StatTile('Mistake rate', pct(tot.m / Math.max(1, tot.n), 1)),
      StatTile('Weak spots', h('span.neg', weak)),
      StatTile('Strong spots', h('span.pos', strong))),
    h('div.row.gap.wrap.filters',
      sel('Tournaments', 'type', [['all', 'All'], ['vanilla', 'Vanilla'], ['ko', 'KO'], ['mystery', 'Mystery KO']]),
      sel('Spot', 'scen', [['all', 'All'], ...Object.entries(SCEN)]),
      sel('Stack', 'group', [['all', 'All'], ...STACK_GROUPS.map((g) => [g.id, g.id])]),
      sel('Show', 'show', [['all', 'All'], ['weak', 'Weak only'], ['strong', 'Strong only']]),
      sel('Min. hands', 'minN', [[1, '1'], [3, '3'], [5, '5'], [10, '10']])),
    h('div.table-wrap', h('table.data.leaks',
      h('thead', h('tr', h('th', 'Spot'), h('th', 'Stack'), h('th', 'Hands'), h('th', 'You'), h('th', 'Strategy'), h('th', 'Biggest gap'), h('th', 'Score'), h('th', 'Mistakes'))),
      h('tbody', shown.flatMap((s) => {
        const v = verdict(s);
        const gap = biggestGap(s);
        const isOpen = open.has(s.key);
        const row = h('tr.spot-row.v-' + v, { tabindex: '0', 'aria-expanded': isOpen ? 'true' : 'false', on: { click: () => toggle(s.key), keydown: (e) => { if (e.key === 'Enter') toggle(s.key); } } },
          h('td', h('strong', `${s.hero} · ${SCEN[s.sc]}`), s.vill ? h('div.small.muted', 'vs ' + s.vill) : null),
          h('td.mono', s.group), h('td.mono', s.n),
          h('td', mix(s.you, s.n)), h('td', mix(s.gto, s.n)),
          h('td.small', gap && Math.abs(gap.diff) >= 0.05 ? `${gap.action} ${gap.diff > 0 ? '+' : ''}${Math.round(gap.diff * 100)} pts` : '–'),
          h('td.mono', pct(s.avg, 0)), h('td.mono', pct(s.mistakeRate, 0)));
        return isOpen ? [row, h('tr.detail', h('td', { colspan: '8' }, handList(s)))] : [row];
      })))),
    shown.length ? null : h('p.muted', 'No spot matches these filters.')));
  function toggle(k) { open.has(k) ? open.delete(k) : open.add(k); render(all); }
}

const order = (s) => ({ weak: 0, ok: 1, thin: 2, strong: 3 }[verdict(s)]);

function mix(m, n) {
  return h('div.mix', ['raise', 'allin', 'call', 'fold'].filter((a) => m[a] / n > 0.005).map((a) =>
    h('span', { style: { flexBasis: (m[a] / n) * 100 + '%', background: `var(--act-${ACT_ROLE[a]})` }, title: `${a} ${pct(m[a] / n, 0)}` }, m[a] / n >= 0.15 ? pct(m[a] / n, 0) : '')));
}

function handList(s) {
  return h('table.data.compact',
    h('thead', h('tr', h('th', ''), h('th', 'Hand'), h('th', 'Cards'), h('th', 'You'), h('th', 'Strategy'), h('th', ''))),
    h('tbody', s.hands.slice(0, 60).map((x) => h('tr',
      h('td', h('span.grade-dot.grade-' + x.grade, { title: GRADE_TEXT[x.grade] })),
      h('td.mono', x.cls), h('td.mono', x.d.c), h('td', x.d.a),
      h('td.small', x.labels.map((l, i) => x.freqs[i] > 0.005 ? `${l} ${pct(x.freqs[i], 0)}` : null).filter(Boolean).join(' · ')),
      h('td', h('a.small', { href: x.link }, 'Open in Study'))))));
}
