// Replay of a training hand: every street with every action, your decisions
// graded in place with the strategy, the board and the result.
import { h, modal, pct, num } from './dom.js';
import { PlayingCard, FreqBar } from './components.js';
import { POS, STREETS } from '../engine/game.js';
import { parseCard } from '../engine/cards.js';

const GRADE_TEXT = { best: 'Meilleur coup', correct: 'Correct', inaccuracy: 'Imprécision', wrong: 'Erreur', blunder: 'Grosse erreur' };
const cards = (s, size = 'sm') => (s ? s.match(/../g).map((c) => PlayingCard(parseCard(c), size)) : []);
const STAGE = { 100: 'début', 50: '50 % restants', 25: '25 % restants', 10: '10 % restants', semi: 'demi-finale', ft: 'table finale', hu: 'heads-up' };

// A short line for lists: hero cards, position, result.
export function handSummary(log) {
  const bad = log.decisions.filter((d) => !['best', 'correct'].includes(d.grade)).length;
  return { bad, text: `${POS[log.hero]} · ${log.decisions.length} décision${log.decisions.length > 1 ? 's' : ''}${bad ? ` · ${bad} erreur${bad > 1 ? 's' : ''}` : ' · sans faute'}` };
}

export function HandRow(log, onOpen) {
  const s = handSummary(log);
  return h('button.hand-row' + (s.bad ? '.has-err' : '.clean'), { type: 'button', on: { click: () => onOpen(log) }, title: 'Revoir la main' },
    h('span.hand-cards', cards(log.cards[log.hero], 'xs')),
    h('span.grow', h('strong', s.text), log.result ? h('span.small.muted', ' · ' + log.result) : null),
    h('span.hand-grades', log.decisions.map((d) => h('span.grade-dot.grade-' + d.grade, { title: GRADE_TEXT[d.grade] }))),
    h('span.small', 'Revoir ›'));
}

export function showHandReplay(log, title = 'Détail de la main') {
  const decisions = log.decisions.slice();
  const streets = [];
  for (const e of log.history) {
    if (e.d) { streets.push({ s: e.s, board: e.d, rows: [] }); continue; }
    if (!streets.length || streets[streets.length - 1].s !== e.s) streets.push({ s: e.s, board: null, rows: [] });
    const mine = e.p === log.hero;
    const dec = mine ? decisions.shift() : null;
    streets[streets.length - 1].rows.push({ ...e, mine, dec });
  }
  const opp = log.shown ? log.cards.map((c, p) => (c && p !== log.hero ? { p, c } : null)).filter(Boolean) : [];
  const body = h('div.replay',
    h('div.replay-head',
      h('div', h('div.small.muted', 'Toi'), h('div.row.gap', h('strong', POS[log.hero]), h('span.hand-cards', cards(log.cards[log.hero], 'md')))),
      h('div.replay-tags',
        h('span.pill', log.cfg.stack + 'bb'),
        h('span.pill', log.cfg.ko ? 'KO' : 'Vanilla'),
        log.cfg.stage && log.cfg.stage !== '100' ? h('span.pill', STAGE[log.cfg.stage]) : null,
        log.cfg.multiway ? h('span.pill', 'Multiway') : null,
        h('span.pill.muted', new Date(log.t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })))),
    streets.map((st) => h('section.replay-street',
      h('div.replay-street-head', h('strong', STREETS[st.s]), st.board ? h('span.hand-cards', cards(st.board, 'sm')) : null),
      h('ol.replay-actions', st.rows.map((r) => h('li' + (r.mine ? '.mine' : ''),
        h('span.ra-pos', POS[r.p]), h('span.ra-act', r.l),
        r.dec ? decisionBox(r.dec) : null))))),
    opp.length ? h('div.replay-show', h('span.small.muted', 'Abattage : '), opp.map((o) => h('span.row.gap', h('strong', POS[o.p]), h('span.hand-cards', cards(o.c, 'xs'))))) : null,
    h('div.replay-result', log.result || 'Décision notée.', log.pot ? h('span.muted', ` · pot ${num(log.pot)}bb`) : null));
  modal(title, body);
}

function decisionBox(d) {
  const order = d.freqs.map((_, k) => k).sort((a, b) => d.freqs[b].f - d.freqs[a].f);
  return h('div.ra-decision.grade-' + d.grade,
    h('div.row.between', h('strong.grade', GRADE_TEXT[d.grade]), h('span.mono.small', d.evLoss > 0.005 ? '−' + num(d.evLoss, 2) + 'bb' : '±0bb')),
    d.grade !== 'best' ? h('div.small', 'Le meilleur coup était ', h('strong', d.best)) : null,
    FreqBar(order.map((k) => ({ role: d.freqs[k].role, label: d.freqs[k].label, freq: d.freqs[k].f })), { height: 12, labels: true }),
    h('div.small.muted', order.filter((k) => d.freqs[k].f > 0.005).map((k) => `${d.freqs[k].label} ${pct(d.freqs[k].f, 0)}`).join(' · ')),
    d.why ? h('p.small.why', d.why) : null,
    d.link ? h('a.small', { href: d.link }, 'Ouvrir ce spot dans Étude') : null);
}
