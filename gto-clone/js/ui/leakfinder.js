import { h, mount, pct } from './dom.js';
import { StatTile, Segmented } from './components.js';
import { WinningsChart } from './chart.js';
import { getDecisions, getTournaments, getHandRecords } from '../data/datastore.js';
import { getSessions } from '../store.js';
import { hudTotals, results } from '../data/handstats.js';
import {
  analyzeDecisions, verdict, SCEN, STACK_GROUPS, spotTitle, spotStory, keyMetric, liveAction,
} from '../data/leaks.js';

const filter = { type: 'all', scen: 'all', group: 'all', show: 'all', minN: 1 };
const open = new Set();
let tab = 'stats';
let hudTab = 'preflop';
let root;

const ACT_ROLE = { fold: 'fold', call: 'call', raise: 'bet-m', allin: 'allin' };
const ACT_TEXT = { fold: 'fold', call: 'call', raise: 'raise', allin: 'tapis', check: 'check', limp: 'limp' };
const GRADE_TEXT = { best: 'Meilleur coup', correct: 'Correct', inaccuracy: 'Imprécision', wrong: 'Erreur', blunder: 'Grosse erreur' };
const VERDICT_TEXT = { weak: 'Point faible', strong: 'Point fort', ok: 'Correct', thin: 'Trop peu de mains' };
const fmt = (t) => (Number.isFinite(t) ? new Date(t).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

export function renderLeaks(el) {
  root = el;
  mount(root, h('div.panel.loading', h('div.spinner'), 'Analyse de tes mains…'));
  setTimeout(render, 20);
}

function render() {
  const tabs = Segmented('Vue Leakfinder', [{ value: 'stats', label: 'Stats' }, { value: 'spots', label: 'Mes spots' }, { value: 'live', label: 'Live action' }], tab, (v) => { tab = v; render(); });
  mount(root, h('div.leaks-page',
    h('div.row.between.wrap', h('h1', 'Leakfinder'), tabs),
    tab === 'live' ? liveView() : tab === 'stats' ? statsView() : spotsView()));
}

// ---------- Stats (HUD) ----------
// [lo, hi] = the zone counted as good (green); a little outside is yellow, further is red.
const HUD = {
  preflop: { label: 'Preflop', stats: [
    { k: 'VPIP', name: 'VPIP', lo: 21, hi: 27, why: 'Mains où tu mets de l\'argent volontairement (call ou relance) avant le flop.' },
    { k: 'PFR', name: 'PFR', lo: 16, hi: 22, why: 'Mains où tu relances avant le flop.' },
    { k: 'RFI', name: 'RFI', lo: 26, hi: 36, why: 'Quand tout le monde a foldé jusqu\'à toi (hors BB) : à quelle fréquence tu ouvres.' },
    { k: '3B', name: '3BET', lo: 7, hi: 11, why: 'Face à un open sans caller : à quelle fréquence tu relances (3-bet).' },
    { k: 'SQZ', name: 'SQUEEZE', lo: 6, hi: 11, why: 'Face à un open suivi d\'un ou plusieurs calls : à quelle fréquence tu relances.' },
    { k: '4B', name: '4BET', lo: 15, hi: 25, why: 'Face à un 3-bet : à quelle fréquence tu relances encore.' },
    { k: 'F3B', name: 'FOLD TO 3BET', lo: 40, hi: 55, why: 'Après ton open, face à un 3-bet : à quelle fréquence tu te couches.' },
  ] },
  postflop: { label: 'Postflop', stats: [
    { k: 'CB', name: 'CBET FLOP', lo: 50, hi: 70, why: 'Tu as relancé avant le flop : à quelle fréquence tu mises au flop (continuation bet).' },
    { k: 'FCB', name: 'FOLD TO CBET', lo: 35, hi: 50, why: 'Tu as payé avant le flop et le relanceur mise au flop : à quelle fréquence tu te couches.' },
    { k: 'WTSD', name: 'WTSD', lo: 25, hi: 32, why: 'Quand tu vois le flop, à quelle fréquence tu vas jusqu\'à l\'abattage.' },
    { k: 'WSD', name: 'W$SD', lo: 50, hi: 58, why: 'Quand tu vas à l\'abattage, à quelle fréquence tu gagnes de l\'argent.' },
    { k: 'WWSF', name: 'WWSF', lo: 44, hi: 52, why: 'Quand tu vois le flop, à quelle fréquence tu gagnes le pot (avec ou sans abattage).' },
    { k: 'AF', name: 'AF', lo: 2, hi: 3.5, ratio: true, why: 'Facteur d\'agression après le flop : (mises + relances) ÷ calls.' },
  ] },
  bvb: { label: 'BvB', stats: [
    { k: 'SBO', name: 'SB OPEN', lo: 35, hi: 55, why: 'Tout le monde a foldé jusqu\'à toi en SB : à quelle fréquence tu relances.' },
    { k: 'SBL', name: 'SB LIMP', lo: 10, hi: 40, why: 'Même situation : à quelle fréquence tu complètes (limp). Tes ranges SB en contiennent.' },
    { k: 'BBF_SB', name: 'BB FOLD VS SB', lo: 25, hi: 40, why: 'En BB, quand la SB ouvre : à quelle fréquence tu te couches.' },
    { k: 'BB3_SB', name: 'BB 3BET VS SB', lo: 12, hi: 20, why: 'En BB, quand la SB ouvre : à quelle fréquence tu relances.' },
  ] },
  threebet: { label: '3bet pot', stats: [
    { k: 'CB3', name: 'CBET 3BET POT', lo: 55, hi: 75, why: 'Tu as fait le 3-bet et il a été payé : à quelle fréquence tu mises au flop.' },
    { k: 'FCB3', name: 'FOLD TO CBET 3BP', lo: 30, hi: 45, why: 'Tu as payé un 3-bet et le relanceur mise au flop : à quelle fréquence tu te couches.' },
  ] },
  general: { label: 'Général', stats: [
    { k: 'ATS', name: 'STEAL', lo: 35, hi: 50, why: 'Ouverture depuis CO, BTN ou SB quand tout le monde a foldé (vol des blindes).' },
    { k: 'FBS', name: 'FOLD BB VS STEAL', lo: 30, hi: 45, why: 'En BB face à un vol (open CO, BTN ou SB) : à quelle fréquence tu te couches.' },
    { k: 'B3S', name: 'BB 3BET VS STEAL', lo: 10, hi: 16, why: 'En BB face à un vol : à quelle fréquence tu relances.' },
    { k: 'LIMP', name: 'LIMP', lo: 0, hi: 8, why: 'Quand tout le monde a foldé jusqu\'à toi : à quelle fréquence tu limpes au lieu d\'ouvrir.' },
  ] },
  graph: { label: 'Graphique', stats: [] },
};

function tone(def, v, opp) {
  if (!opp || Number.isNaN(v)) return 'none';
  if (v >= def.lo && v <= def.hi) return 'good';
  const margin = def.ratio ? 0.75 : Math.max(3, (def.hi - def.lo) / 2);
  return v >= def.lo - margin && v <= def.hi + margin ? 'near' : 'off';
}

function statsView() {
  const types = new Map(getTournaments().map((t) => [t.tid, t.type]));
  const recs = getHandRecords().filter((r) => filter.type === 'all' || types.get(r.t) === filter.type);
  if (!recs.length) {
    return h('div.empty-state',
      h('p.muted', 'Importe tes tournois avec leurs historiques de mains dans Mes données : Leakfinder calcule alors tes stats (VPIP, PFR, 3-bet…) et les compare à des zones cibles.'),
      h('a.btn.primary', { href: '#/data' }, 'Aller à Mes données'));
  }
  const tot = hudTotals(recs);
  const tabsEl = h('div.hud-tabs', { role: 'tablist', 'aria-label': 'Catégories de stats' },
    Object.entries(HUD).map(([id, g]) => h('button', { type: 'button', role: 'tab', 'aria-selected': id === hudTab ? 'true' : 'false', on: { click: () => { hudTab = id; render(); } } }, g.label.toUpperCase())));
  let body;
  if (hudTab === 'graph') body = WinningsChart(results(recs).curve);
  else {
    const r = results(recs);
    body = h('div.hud-grid',
      hudTab === 'general' ? [
        hudTile('MAINS', String(r.hands), 'none', 'Mains importées avec tes cartes.'),
        hudTile('BB/100', (r.bb100 >= 0 ? '+' : '') + r.bb100.toFixed(1).replace('.', ','), r.bb100 >= 0 ? 'good' : 'off', 'Big blinds gagnées pour 100 mains.'),
        hudTile('EV BB/100', (r.ev100 >= 0 ? '+' : '') + r.ev100.toFixed(1).replace('.', ','), r.ev100 >= 0 ? 'good' : 'off', 'Même chose, en remplaçant le résultat des tapis par ta part d\'équité.'),
      ] : null,
      HUD[hudTab].stats.map((d) => {
        const s = tot[d.k];
        if (d.ratio) {
          const v = tot.AF.value;
          return hudTile(d.name, Number.isFinite(v) ? v.toFixed(1).replace('.', ',') : v === Infinity ? '∞' : '–', tone(d, v, tot.AF.opp), d.why, `Cible ${d.lo}–${String(d.hi).replace(".", ",")}`, tot.AF.opp);
        }
        const v = s ? (s.hit / s.opp) * 100 : NaN;
        return hudTile(d.name, Number.isFinite(v) ? Math.round(v) : '–', tone(d, v, s?.opp >= 10 ? s.opp : 0), d.why, `Cible ${d.lo}–${d.hi} %`, s?.opp || 0);
      }));
  }
  return [
    h('p.muted', 'Tes statistiques calculées sur toutes les mains importées. Vert : dans la zone cible. Jaune : un peu en dehors. Rouge : loin de la cible. Gris : moins de 10 occasions, pas encore fiable.'),
    h('div.row.gap.wrap.filters', typeSelect()),
    h('section.hud', tabsEl, body),
  ];
}

function hudTile(name, value, t, why, target, opp) {
  return h('div.hud-stat', { title: why },
    h('div.name', name),
    h('div.val.' + t, value),
    target ? h('div.sub', `${target} · ${plural(opp, 'occasion', 'occasions')}`) : null,
    h('div.why', why));
}

function typeSelect() {
  return h('label.pick-field', 'Tournois', h('select', { on: { change: (e) => { filter.type = e.target.value; render(); } } },
    [['all', 'Tous'], ['vanilla', 'Vanilla'], ['ko', 'KO'], ['mystery', 'Mystery KO']].map(([v, l]) => h('option', { value: v, selected: filter.type === v }, l))));
}

// ---------- My spots ----------
function spotsView() {
  const all = getDecisions();
  if (!all.length) {
    return h('div.empty-state',
      h('p.muted', 'Importe d\'abord tes tournois (avec leurs historiques de mains) dans Mes données. Leakfinder compare ensuite chacune de tes décisions préflop à la stratégie de l\'Étude.'),
      h('a.btn.primary', { href: '#/data' }, 'Aller à Mes données'));
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
    h('p.muted', 'Chaque décision préflop de tes historiques est rejouée comme un spot de l\'Étude et comparée à ce que fait la stratégie avec les mêmes cartes. La « cible », c\'est la fréquence à laquelle la stratégie aurait joué ainsi avec exactement les mains que tu as reçues.'),
    h('div.stats-row.wide',
      StatTile('Décisions analysées', covered, notCovered ? `${notCovered} non couvertes (multiway, 4-bet à froid…)` : null),
      StatTile('Score', pct(tot.score / Math.max(1, tot.n), 0)),
      StatTile('Taux d\'erreur', pct(tot.m / Math.max(1, tot.n), 1)),
      StatTile('Points faibles', h('span.neg', weak.length)),
      StatTile('Points forts', h('span.pos', strong.length))),
    weak.length || strong.length ? h('div.coach-grid',
      h('section.panel.coach.coach-weak', h('div.panel-title', 'À corriger en premier'),
        weak.length ? weak.slice(0, 3).map(coachItem) : h('p.muted.small', 'Pas de point faible net pour l\'instant. Bon signe !')),
      h('section.panel.coach.coach-strong', h('div.panel-title', 'Ce que tu fais déjà bien'),
        strong.length ? strong.slice(0, 3).map(coachItem) : h('p.muted.small', 'Pas encore de point fort net : joue plus de mains.'))) : null,
    h('div.row.gap.wrap.filters',
      typeSelect(),
      sel('Spot', 'scen', [['all', 'Tous'], ...Object.entries(SCEN)]),
      sel('Stack', 'group', [['all', 'Tous'], ...STACK_GROUPS.map((g) => [g.id, g.id])]),
      sel('Afficher', 'show', [['all', 'Tout'], ['weak', 'Points faibles'], ['strong', 'Points forts']]),
      sel('Mains min.', 'minN', [[1, '1'], [3, '3'], [5, '5'], [10, '10']])),
    h('div.table-wrap', h('table.data.leaks',
      h('thead', h('tr', h('th', 'Spot'), h('th', 'Stack'), h('th', 'Mains'), h('th', 'Toi vs cible'), h('th', 'Verdict'), h('th', 'Score'))),
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
    shown.length ? null : h('p.muted', 'Aucun spot ne correspond à ces filtres.'),
  ];
}

const order = (s) => ({ weak: 0, ok: 1, thin: 2, strong: 3 }[verdict(s)]);
function toggle(k) { open.has(k) ? open.delete(k) : open.add(k); render(); }

// « Défense : toi 28 % · cible 41 % — pas assez »
function metricLine(m) {
  return [h('strong', m.label + ' : '), 'toi ', h('strong.mono', pct(m.you, 0)), ' · cible ', h('strong.mono', pct(m.target, 0)), ' — ',
    h('span.' + (m.dir === 'ok' ? 'pos' : 'neg'), m.word + (m.dir === 'ok' ? '' : ` (${m.diff > 0 ? '+' : '−'}${Math.round(Math.abs(m.diff) * 100)} pts)`))];
}

function meter(m) {
  return h('div.meter-cell',
    h('div.small', metricLine(m)),
    h('div.meter', { role: 'img', 'aria-label': `${m.label} : toi ${pct(m.you, 0)}, cible ${pct(m.target, 0)}` },
      h('span.meter-you.' + m.dir, { style: { width: pct(m.you, 1) } }),
      h('span.meter-target', { style: { left: pct(m.target, 1) } })));
}

function coachItem(s) {
  const m = keyMetric(s);
  return h('div.coach-item',
    h('div.row.between', h('strong', spotTitle(s)), h('span.small.muted', `${s.group} · ${plural(s.n, 'main', 'mains')}`)),
    m ? h('div.small', metricLine(m)) : null,
    m ? h('p.small.tip', m.tip) : null);
}

function spotDetail(s) {
  const m = keyMetric(s);
  return h('div.spot-detail',
    m ? h('p.tip', m.tip) : null,
    h('div.row.gap.wrap',
      h('div', h('div.small.muted', 'Ce que tu as fait'), mix(s.you, s.n)),
      h('div', h('div.small.muted', 'Ce que fait la stratégie avec les mêmes mains'), mix(s.gto, s.n))),
    handList(s));
}

function mix(m, n) {
  return h('div.mix', ['raise', 'allin', 'call', 'fold'].filter((a) => m[a] / n > 0.005).map((a) =>
    h('span', { style: { flexBasis: (m[a] / n) * 100 + '%', background: `var(--act-${ACT_ROLE[a]})` }, title: `${ACT_TEXT[a]} ${pct(m[a] / n, 0)}` }, m[a] / n >= 0.15 ? `${ACT_TEXT[a]} ${pct(m[a] / n, 0)}` : '')));
}

function handList(s) {
  return h('table.data.compact',
    h('thead', h('tr', h('th', ''), h('th', 'Main'), h('th', 'Cartes'), h('th', 'Toi'), h('th', 'Stratégie'), h('th', ''))),
    h('tbody', s.hands.slice(0, 60).map((x) => h('tr',
      h('td', h('span.grade-dot.grade-' + x.grade, { title: GRADE_TEXT[x.grade] })),
      h('td.mono', x.cls), h('td.mono', x.d.c), h('td', ACT_TEXT[x.d.a] || x.d.a),
      h('td.small', x.labels.map((l, i) => x.freqs[i] > 0.005 ? `${ACT_TEXT[l] || l} ${pct(x.freqs[i], 0)}` : null).filter(Boolean).join(' · ')),
      h('td', h('a.small', { href: x.link }, 'Ouvrir dans Étude'))))));
}

// ---------- Live action ----------
const STATUS = {
  learned: ['Assimilé', 'pos', 'Dans tes tournois, tu joues maintenant ce spot comme la stratégie.'],
  progress: ['En progrès', 'warn', 'Mieux, mais encore des erreurs en tournoi. Retravaille-le.'],
  notyet: ['Pas encore assimilé', 'neg', 'En tournoi, ton jeu dans ce spot s\'écarte encore beaucoup de la stratégie. Retravaille-le.'],
  thin: ['Trop peu de mains', 'muted', 'Tu as joué ce spot moins de 3 fois depuis l\'entraînement. Attends d\'autres tournois.'],
  waiting: ['Pas rejoué depuis', 'muted', 'Aucune main de tournoi dans ce spot depuis ton entraînement. Importe tes prochains tournois dans Mes données.'],
  postflop: ['Postflop', 'muted', 'Leakfinder ne lit que le préflop pour l\'instant : ce spot ne peut pas encore être comparé à tes tournois.'],
};

function liveView() {
  const report = liveAction(getSessions(), getDecisions(), getTournaments());
  if (!report.length) {
    return h('div.empty-state',
      h('p.muted', 'Live action suit les spots que tu travailles dans Entraînement. Entraîne-toi sur un spot (par exemple BB vs BTN à 50bb), puis joue et importe tes tournois dans Mes données : cette page montre si l\'entraînement se voit à la table.'),
      h('a.btn.primary', { href: '#/practice' }, 'Aller à Entraînement'));
  }
  const count = (st) => report.filter((r) => r.status === st).length;
  return [
    h('p.muted', 'Pour chaque spot travaillé dans Entraînement : tes sessions d\'entraînement, puis toutes les mains de tournoi jouées dans ce spot après la première session. Les tournois importés sont rattachés selon la date et l\'heure où les mains ont été jouées.'),
    h('div.stats-row.wide',
      StatTile('Spots travaillés', report.length),
      StatTile('Assimilés', h('span.pos', count('learned'))),
      StatTile('En progrès', count('progress')),
      StatTile('Pas encore assimilés', h('span.neg', count('notyet'))),
      StatTile('En attente de mains', count('waiting') + count('thin'))),
    h('div.la-list', report.map(liveCard)),
  ];
}

function liveCard(r) {
  const [label, tone2, note] = STATUS[r.status];
  const p = r.practice;
  const m = r.after && r.after.n ? keyMetric(r.after) : null;
  const mb = r.before && r.before.n >= 3 ? keyMetric(r.before) : null;
  return h('section.panel.la-card.la-' + r.status,
    h('div.row.between.wrap',
      h('div', h('h2.la-title', r.key ? `${spotTitle(r)} · ${r.group}` : r.label), r.key ? h('div.small.muted', spotStory(r)) : null),
      h('span.status-pill.' + tone2, label)),
    h('div.la-cols',
      h('div.la-block',
        h('div.panel-title', 'Entraînement'),
        h('p.small', `${plural(r.sessions.length, 'session', 'sessions')} · ${plural(p.n, 'décision', 'décisions')} · score `, h('strong', pct(Math.max(0, p.avg), 0)), ` · ${plural(p.mistakes, 'erreur', 'erreurs')}`),
        h('ul.la-sessions', r.sessions.map((s) => h('li.small', h('span.mono', fmt(s.start)), ` — ${plural(s.n, 'décision', 'décisions')}, score ${pct(Math.max(0, s.score / s.n), 0)}`)))),
      h('div.la-block',
        h('div.panel-title', `En tournoi depuis le ${fmt(r.first)}`),
        r.after && r.after.n ? [
          h('p.small', `${plural(r.after.n, 'main', 'mains')} dans ${plural(r.tournaments.length, 'tournoi', 'tournois')} · score `, h('strong', pct(r.after.avg, 0)), ` · ${plural(r.after.mistakes, 'erreur', 'erreurs')}`),
          m ? h('p.small', metricLine(m)) : null,
          mb ? h('p.small.muted', `Avant l'entraînement (${plural(r.before.n, 'main', 'mains')}) : ${mb.label.toLowerCase()} ${pct(mb.you, 0)} pour une cible de ${pct(mb.target, 0)}, score ${pct(r.before.avg, 0)} → maintenant ${pct(r.after.avg, 0)}.`) : null,
          h('table.data.compact',
            h('thead', h('tr', h('th', 'Joué le'), h('th', 'Tournoi'), h('th', 'Mains'), h('th', 'Erreurs'))),
            h('tbody', r.tournaments.map((t) => h('tr', h('td.mono', t.date ? fmt(new Date(t.date).getTime()) : '–'), h('td', t.name), h('td.mono', t.n), h('td.mono' + (t.mistakes ? '.neg' : ''), t.mistakes))))),
        ] : null,
        h('p.small.tip', m && ['notyet', 'progress'].includes(r.status) ? m.tip : note))));
}
