import { h, mount, pct } from './dom.js';
import { StatTile, Segmented } from './components.js';
import { getDecisions, getTournaments } from '../data/datastore.js';
import { getSessions } from '../store.js';
import {
  analyzeDecisions, verdict, SCEN, STACK_GROUPS, spotTitle, spotStory, keyMetric, liveAction,
} from '../data/leaks.js';

const filter = { type: 'all', scen: 'all', group: 'all', show: 'all', minN: 1 };
const open = new Set();
let tab = 'spots';
let root;

const ACT_ROLE = { fold: 'fold', call: 'call', raise: 'bet-m', allin: 'allin' };
const GRADE_TEXT = { best: 'Best', correct: 'Correct', inaccuracy: 'Inaccuracy', wrong: 'Wrong', blunder: 'Blunder' };
const VERDICT_TEXT = { weak: 'Leak', strong: 'Strength', ok: 'Okay', thin: 'Too few hands' };
const fmt = (t) => (Number.isFinite(t) ? new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');

export function renderLeaks(el) {
  root = el;
  mount(root, h('div.panel.loading', h('div.spinner'), 'Analysing your hands…'));
  setTimeout(render, 20);
}

function render() {
  const tabs = Segmented('Leakfinder view', [{ value: 'spots', label: 'My spots' }, { value: 'live', label: 'Live action' }], tab, (v) => { tab = v; render(); });
  mount(root, h('div.leaks-page',
    h('div.row.between.wrap', h('h1', 'Leakfinder'), tabs),
    tab === 'live' ? liveView() : spotsView()));
}

// ---------- My spots ----------
function spotsView() {
  const all = getDecisions();
  if (!all.length) {
    return h('div.empty-state',
      h('p.muted', 'Import your tournaments (with their hand histories) in My Data first. Leakfinder then checks every preflop decision you made against the Study strategy.'),
      h('a.btn.primary', { href: '#/data' }, 'Go to My Data'));
  }
  const types = new Map(getTournaments().map((t) => [t.tid, t.type]));
  const decisions = all.filter((d) => filter.type === 'all' || types.get(d.t) === filter.type);
  const { spots, covered, notCovered } = analyzeDecisions(decisions);
  const shown = spots
    .filter((s) => (filter.scen === 'all' || s.sc === filter.scen) && (filter.group === 'all' || s.group === filter.group) && s.n >= filter.minN)
    .filter((s) => filter.show === 'all' || verdict(s) === filter.show)
    .sort((a, b) => order(a) - order(b) || a.avg - b.avg || b.n - a.n);
  const tot = spots.reduce((a, s) => ({ n: a.n + s.n, score: a.score + s.score, m: a.m + s.mistakes }), { n: 0, score: 0, m: 0 });
  const weak = spots.filter((s) => verdict(s) === 'weak').sort((a, b) => a.avg - b.avg || b.n - a.n);
  const strong = spots.filter((s) => verdict(s) === 'strong').sort((a, b) => b.avg - a.avg || b.n - a.n);
  const sel = (label, key, opts) => h('label.pick-field', label, h('select', { on: { change: (e) => { filter[key] = e.target.value === 'all' || isNaN(+e.target.value) ? e.target.value : +e.target.value; render(); } } },
    opts.map(([v, l]) => h('option', { value: String(v), selected: filter[key] === v }, l))));

  return [
    h('p.muted', 'Every preflop decision from your hand histories is replayed as a Study spot and compared with what the strategy does with the same cards. The "target" is how often the strategy would have played that way with exactly the hands you were dealt.'),
    h('div.stats-row.wide',
      StatTile('Decisions checked', covered, notCovered ? `${notCovered} not covered (multiway, cold 4-bets…)` : null),
      StatTile('Score', pct(tot.score / Math.max(1, tot.n), 0)),
      StatTile('Mistake rate', pct(tot.m / Math.max(1, tot.n), 1)),
      StatTile('Leaks', h('span.neg', weak.length)),
      StatTile('Strengths', h('span.pos', strong.length))),
    weak.length || strong.length ? h('div.coach-grid',
      h('section.panel.coach.coach-weak', h('div.panel-title', 'Fix these first'),
        weak.length ? weak.slice(0, 3).map(coachItem) : h('p.muted.small', 'No clear leak yet. Good sign!')),
      h('section.panel.coach.coach-strong', h('div.panel-title', 'What you already do well'),
        strong.length ? strong.slice(0, 3).map(coachItem) : h('p.muted.small', 'No clear strength yet: play more hands.'))) : null,
    h('div.row.gap.wrap.filters',
      sel('Tournaments', 'type', [['all', 'All'], ['vanilla', 'Vanilla'], ['ko', 'KO'], ['mystery', 'Mystery KO']]),
      sel('Spot', 'scen', [['all', 'All'], ...Object.entries(SCEN)]),
      sel('Stack', 'group', [['all', 'All'], ...STACK_GROUPS.map((g) => [g.id, g.id])]),
      sel('Show', 'show', [['all', 'All'], ['weak', 'Leaks only'], ['strong', 'Strengths only']]),
      sel('Min. hands', 'minN', [[1, '1'], [3, '3'], [5, '5'], [10, '10']])),
    h('div.table-wrap', h('table.data.leaks',
      h('thead', h('tr', h('th', 'Spot'), h('th', 'Stack'), h('th', 'Hands'), h('th', 'You vs target'), h('th', 'Verdict'), h('th', 'Score'))),
      h('tbody', shown.flatMap((s) => {
        const v = verdict(s);
        const m = keyMetric(s);
        const isOpen = open.has(s.key);
        const row = h('tr.spot-row.v-' + v, { tabindex: '0', 'aria-expanded': isOpen ? 'true' : 'false', on: { click: () => toggle(s.key), keydown: (e) => { if (e.key === 'Enter') toggle(s.key); } } },
          h('td', h('strong', spotTitle(s)), h('div.small.muted', spotStory(s))),
          h('td.mono', s.group), h('td.mono', s.n),
          h('td', m ? meter(m) : '–'),
          h('td', h('span.verdict.verdict-' + v, VERDICT_TEXT[v])),
          h('td.mono', pct(s.avg, 0)));
        return isOpen ? [row, h('tr.detail', h('td', { colspan: '6' }, spotDetail(s)))] : [row];
      })))),
    shown.length ? null : h('p.muted', 'No spot matches these filters.'),
  ];
}

const order = (s) => ({ weak: 0, ok: 1, thin: 2, strong: 3 }[verdict(s)]);
function toggle(k) { open.has(k) ? open.delete(k) : open.add(k); render(); }

// "Defend: you 28% · target 41% — not enough"
function metricLine(m) {
  return [h('strong', m.label + ': '), 'you ', h('strong.mono', pct(m.you, 0)), ' · target ', h('strong.mono', pct(m.target, 0)), ' — ',
    h('span.' + (m.dir === 'ok' ? 'pos' : 'neg'), m.word + (m.dir === 'ok' ? '' : ` (${m.diff > 0 ? '+' : '−'}${Math.round(Math.abs(m.diff) * 100)} pts)`))];
}

function meter(m) {
  return h('div.meter-cell',
    h('div.small', metricLine(m)),
    h('div.meter', { role: 'img', 'aria-label': `${m.label}: you ${pct(m.you, 0)}, target ${pct(m.target, 0)}` },
      h('span.meter-you.' + m.dir, { style: { width: pct(m.you, 1) } }),
      h('span.meter-target', { style: { left: pct(m.target, 1) } })));
}

function coachItem(s) {
  const m = keyMetric(s);
  return h('div.coach-item',
    h('div.row.between', h('strong', spotTitle(s)), h('span.small.muted', `${s.group} · ${s.n} hands`)),
    m ? h('div.small', metricLine(m)) : null,
    m ? h('p.small.tip', m.tip) : null);
}

function spotDetail(s) {
  const m = keyMetric(s);
  return h('div.spot-detail',
    m ? h('p.tip', m.tip) : null,
    h('div.row.gap.wrap',
      h('div', h('div.small.muted', 'What you did'), mix(s.you, s.n)),
      h('div', h('div.small.muted', 'What the strategy does with the same hands'), mix(s.gto, s.n))),
    handList(s));
}

function mix(m, n) {
  return h('div.mix', ['raise', 'allin', 'call', 'fold'].filter((a) => m[a] / n > 0.005).map((a) =>
    h('span', { style: { flexBasis: (m[a] / n) * 100 + '%', background: `var(--act-${ACT_ROLE[a]})` }, title: `${a} ${pct(m[a] / n, 0)}` }, m[a] / n >= 0.15 ? `${a} ${pct(m[a] / n, 0)}` : '')));
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

// ---------- Live action ----------
const STATUS = {
  learned: ['Learned', 'pos', 'In your tournaments you now play this spot like the strategy.'],
  progress: ['In progress', 'warn', 'Better, but still some mistakes in your tournaments. Train it again.'],
  notyet: ['Not learned yet', 'neg', 'Your tournament play in this spot still differs a lot from the strategy. Train it again.'],
  thin: ['Too few hands yet', 'muted', 'You played this spot fewer than 3 times since training. Wait for more tournaments.'],
  waiting: ['Not played since', 'muted', 'No tournament hand in this spot since you trained it. Import your next tournaments in My Data.'],
  postflop: ['Postflop', 'muted', 'Leakfinder reads preflop only for now, so this spot can\'t be checked against your tournaments yet.'],
};

function liveView() {
  const report = liveAction(getSessions(), getDecisions(), getTournaments());
  if (!report.length) {
    return h('div.empty-state',
      h('p.muted', 'Live action tracks the spots you train in Practice. Train a spot (for example BB vs BTN at 50bb), then play and import your tournaments in My Data: this page shows whether the training shows up at the tables.'),
      h('a.btn.primary', { href: '#/practice' }, 'Go to Practice'));
  }
  const count = (st) => report.filter((r) => r.status === st).length;
  return [
    h('p.muted', 'For each spot you trained in Practice: your training sessions, then every tournament hand you played in that spot after the first session. Imported tournaments are matched by the date and time the hands were played.'),
    h('div.stats-row.wide',
      StatTile('Spots trained', report.length),
      StatTile('Learned', h('span.pos', count('learned'))),
      StatTile('In progress', count('progress')),
      StatTile('Not learned yet', h('span.neg', count('notyet'))),
      StatTile('Waiting for hands', count('waiting') + count('thin'))),
    h('div.la-list', report.map(liveCard)),
  ];
}

function liveCard(r) {
  const [label, tone, note] = STATUS[r.status];
  const p = r.practice;
  const m = r.after && r.after.n ? keyMetric(r.after) : null;
  const mb = r.before && r.before.n >= 3 ? keyMetric(r.before) : null;
  return h('section.panel.la-card.la-' + r.status,
    h('div.row.between.wrap',
      h('div', h('h2.la-title', r.key ? `${spotTitle(r)} · ${r.group}` : r.label), r.key ? h('div.small.muted', spotStory(r)) : null),
      h('span.status-pill.' + tone, label)),
    h('div.la-cols',
      h('div.la-block',
        h('div.panel-title', 'Training in Practice'),
        h('p.small', `${r.sessions.length} session${r.sessions.length > 1 ? 's' : ''} · ${p.n} decision${p.n > 1 ? 's' : ''} · practice score `, h('strong', pct(Math.max(0, p.avg), 0)), ` · ${p.mistakes} mistake${p.mistakes === 1 ? '' : 's'}`),
        h('ul.la-sessions', r.sessions.map((s) => h('li.small', h('span.mono', fmt(s.start)), ` — ${s.n} decision${s.n > 1 ? 's' : ''}, score ${pct(Math.max(0, s.score / s.n), 0)}`)))),
      h('div.la-block',
        h('div.panel-title', `In tournaments since ${fmt(r.first)}`),
        r.after && r.after.n ? [
          h('p.small', `${r.after.n} hand${r.after.n > 1 ? 's' : ''} in ${r.tournaments.length} tournament${r.tournaments.length > 1 ? 's' : ''} · score `, h('strong', pct(r.after.avg, 0)), ` · ${r.after.mistakes} mistake${r.after.mistakes === 1 ? '' : 's'}`),
          m ? h('p.small', metricLine(m)) : null,
          mb ? h('p.small.muted', `Before training (${r.before.n} hands): ${mb.label.toLowerCase()} ${pct(mb.you, 0)} vs target ${pct(mb.target, 0)}, score ${pct(r.before.avg, 0)} → now ${pct(r.after.avg, 0)}.`) : null,
          h('table.data.compact',
            h('thead', h('tr', h('th', 'Played'), h('th', 'Tournament'), h('th', 'Hands'), h('th', 'Mistakes'))),
            h('tbody', r.tournaments.map((t) => h('tr', h('td.mono', t.date ? fmt(new Date(t.date).getTime()) : '–'), h('td', t.name), h('td.mono', t.n), h('td.mono' + (t.mistakes ? '.neg' : ''), t.mistakes))))),
        ] : null,
        h('p.small.tip', m && ['notyet', 'progress'].includes(r.status) ? m.tip : note))));
}
