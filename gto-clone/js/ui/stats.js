import { h, mount, pct, num } from './dom.js';
import { StatTile, FreqBar } from './components.js';
import { getSessions, clearSessions, getProgress } from '../store.js';
import { DRILLS } from './practice.js';
import { levelOf, streakOf, today, DAILY_GOAL, BADGES } from '../data/progress.js';
import { LevelBadge, XpBar, DailyRing, badgeList } from './gamify.js';
import { HandRow, showHandReplay } from './handreplay.js';

const GRADES = ['best', 'correct', 'inaccuracy', 'wrong', 'blunder'];
const GRADE_TEXT = { best: 'Meilleur coup', correct: 'Correct', inaccuracy: 'Imprécision', wrong: 'Erreur', blunder: 'Grosse erreur' };
const open = new Set();

// Player card: level, XP, streak, daily goal and badges.
function progressHeader() {
  const p = getProgress();
  const lvl = levelOf(p.xp);
  const streak = streakOf(p);
  const doneToday = p.days[today()] || 0;
  const earned = BADGES.filter((b) => p.badges[b.id]).length;
  return [
    h('section.panel.hero-card',
      LevelBadge(lvl, 'xl'),
      h('div.grow',
        h('div.small.muted', `Niveau ${lvl.n}`),
        h('h1.hero-name', `${lvl.icon} ${lvl.name}`),
        XpBar(p.xp),
        h('div.hero-stats',
          h('span', h('b', p.xp), ' XP au total'),
          h('span', h('b', p.counts.decisions), ' décisions'),
          h('span', 'meilleur combo ', h('b', p.bestCombo)),
          h('span', h('b', `${earned}/${BADGES.length}`), ' badges'))),
      h('div.hero-side',
        h('div.streak-big' + (streak ? '.on' : ''), h('span', '🔥'), h('b', streak), h('span.small', streak > 1 ? 'jours d\'affilée' : 'jour d\'affilée')),
        h('div.goal', DailyRing(doneToday, DAILY_GOAL, 64), h('span.small.muted', doneToday >= DAILY_GOAL ? 'Objectif du jour atteint !' : `Objectif du jour : ${DAILY_GOAL - doneToday} décision${DAILY_GOAL - doneToday > 1 ? 's' : ''} restante${DAILY_GOAL - doneToday > 1 ? 's' : ''}`)))),
    h('section.panel', h('div.panel-title', 'Badges'), h('div.badge-grid', badgeList(p.badges))),
  ];
}

export function renderStats(el) {
  const sessions = getSessions();
  if (!sessions.length) {
    mount(el, h('div.stats-page', progressHeader(),
      h('div.empty-state', h('h2', 'Aucune session pour l\'instant'),
        h('p.muted', 'Joue quelques mains dans Entraînement : chaque décision te rapporte de l\'XP.'),
        h('a.btn.primary', { href: '#/practice' }, 'Aller à Entraînement'))));
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
    progressHeader(),
    h('div.row.between', h('h2', 'Tes stats d\'entraînement'), h('button.btn.ghost.sm', { type: 'button', on: { click: () => { if (confirm('Supprimer tout l\'historique d\'entraînement de cet appareil ? (ton XP et tes badges sont gardés)')) { clearSessions(); renderStats(el); } } } }, 'Effacer l\'historique')),
    h('div.stats-row.wide',
      StatTile('Score', pct(score, 0), 'moyenne de toutes les décisions'),
      StatTile('Mains', hands), StatTile('Décisions', dec),
      StatTile('Taux d\'erreur', pct(mistakes / Math.max(1, dec), 1)),
      StatTile('EV perdue', num(ev, 1) + 'bb', num(ev / Math.max(1, hands), 2) + 'bb par main')),
    h('div.two-col',
      h('section.panel', h('div.panel-title', 'Qualité des décisions'),
        FreqBar(GRADES.map((g) => ({ role: { best: 'call', correct: 'bet-s', inaccuracy: 'bet-m', wrong: 'bet-l', blunder: 'allin' }[g], label: GRADE_TEXT[g], freq: counts[g] / Math.max(1, all.length) })), { height: 18, labels: true }),
        h('ul.legend', GRADES.map((g) => h('li', h('span.grade-dot.grade-' + g), GRADE_TEXT[g], h('span.mono', counts[g]))))),
      h('section.panel', h('div.panel-title', 'Par exercice'),
        h('table.data', h('thead', h('tr', h('th', 'Exercice'), h('th', 'Décisions'), h('th', 'Score'), h('th', 'Erreurs'), h('th', 'EV perdue'))),
          h('tbody', byDrill.map((r) => h('tr', h('td', `${r.d.icon} ${r.d.name}`), h('td', r.n), h('td', pct(r.score, 0)), h('td', r.mistakes), h('td', num(r.ev, 2) + 'bb'))))))),
    h('section.panel', h('div.panel-title', 'Sessions'),
      h('ul.sessions', sessions.map((s) => {
        const isOpen = open.has(s.id);
        const sc = s.scoreSum / Math.max(1, s.decisionsCount);
        const d = DRILLS.find((x) => x.id === s.drill);
        const logs = s.handsLog || [];
        return h('li.session' + (isOpen ? '.open' : ''),
          h('button.session-head', { type: 'button', 'aria-expanded': isOpen ? 'true' : 'false', on: { click: () => { isOpen ? open.delete(s.id) : open.add(s.id); renderStats(el); } } },
            h('span', isOpen ? '▾' : '▸'), h('strong', d ? `${d.icon} ${d.name}` : s.drill),
            s.config?.format === 'ko' ? h('span.pill', 'KO') : null,
            h('span.muted.small', new Date(s.startedAt).toLocaleString('fr-FR')), h('span.grow'),
            h('span.small', `${s.hands} mains`), h('span.small', `score ${pct(sc, 0)}`), s.xp ? h('span.small.xp-gain', `+${s.xp} XP`) : null, h('span.small.mono', `−${num(s.evLoss, 2)}bb`)),
          isOpen ? h('div.session-body',
            logs.length ? h('div.hand-list', h('div.panel-title', 'Mains jouées · clique pour revoir le détail'),
              logs.map((log, k) => HandRow(log, () => showHandReplay(log, `Main ${logs.length - k}`)))) : h('p.small.muted', 'Les mains de cette session ne sont pas enregistrées (session ancienne).'),
            h('details', h('summary.small', 'Toutes les décisions'),
              h('table.data.compact', h('thead', h('tr', h('th', ''), h('th', 'Main'), h('th', 'Spot'), h('th', 'Board'), h('th', 'Toi'), h('th', 'Meilleur'), h('th', 'EV perdue'))),
                h('tbody', s.decisions.map((x) => h('tr', h('td', h('span.grade-dot.grade-' + x.grade, { title: GRADE_TEXT[x.grade] })), h('td.mono', x.hand), h('td', x.pos + ' · ' + x.street),
                  h('td.mono', x.board || '–'), h('td', x.chosen), h('td', x.best), h('td.mono', x.evLoss > 0.005 ? num(x.evLoss, 2) : '0'))))))) : null);
      })))));
}
