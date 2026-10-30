import { h, mount } from './ui/dom.js';
import { Logo, Segmented, RangeGrid, FreqBar, PlayingCard, StatTile, Tabs } from './ui/components.js';
import { renderStudy, studyKey, rerenderStudy } from './ui/study.js';
import { renderPractice, practiceKey, leavePractice } from './ui/practice.js';
import { renderStats } from './ui/stats.js';
import { renderMyData } from './ui/mydata.js';
import { renderLeaks } from './ui/leakfinder.js';
import { getSettings, setSetting } from './store.js';
import { CLASSES } from './engine/cards.js';
import { setOpenStyle } from './engine/strategy.js';

setOpenStyle(getSettings().openStyle || 'standard');

const ROUTES = {
  study: { label: 'Étude', render: renderStudy, key: studyKey },
  practice: { label: 'Entraînement', render: renderPractice, key: practiceKey },
  stats: { label: 'Stats', render: renderStats },
  data: { label: 'Mes données', render: renderMyData },
  leaks: { label: 'Leakfinder', render: renderLeaks },
  design: { label: 'Design', render: renderDesign, hidden: true },
};

const app = document.getElementById('app');
let current = null;

function route() {
  const name = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'study';
  const r = ROUTES[name] ? name : 'study';
  if (current === 'practice' && r !== 'practice') leavePractice();
  current = r;
  const main = h('main#view', { tabindex: '-1' });
  mount(app, topNav(r), main);
  ROUTES[r].render(main);
  document.title = `${ROUTES[r].label} · Spotwise`;
}

function topNav(active) {
  return h('header.topnav',
    h('a.brand', { href: '#/study' }, Logo(), h('span', 'Spotwise')),
    h('nav', { 'aria-label': 'Navigation principale' }, Object.entries(ROUTES).filter(([, r]) => !r.hidden).map(([id, r]) =>
      h('a.navtab' + (id === active ? '.active' : ''), { href: '#/' + id, 'aria-current': id === active ? 'page' : null }, r.label))),
    h('span.grow'),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Réglages', title: 'Réglages', on: { click: openSettings } },
      h('span', { html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>' })));
}

function openSettings() {
  const s = getSettings();
  const body = h('div.settings');
  const draw = () => body.replaceChildren(
    h('div.field', h('div.field-label', 'Tailles de mise (postflop)'), Segmented('Unités de mise', [{ value: 'bb', label: 'Big blinds' }, { value: 'pct', label: '% du pot' }], s.units, (v) => { setSetting('units', v); draw(); refresh(); })),
    h('div.field', h('div.field-label', 'Charts d\'open (first in)'), Segmented('Style d\'open', [{ value: 'tight', label: 'Tight' }, { value: 'standard', label: 'Standard' }, { value: 'loose', label: 'Loose' }], s.openStyle, (v) => { setSetting('openStyle', v); setOpenStyle(v); draw(); refresh(); })),
    h('div.field', h('div.field-label', 'Cases de la grille'), Segmented('Mode de grille', [{ value: 'full', label: 'Pleine hauteur' }, { value: 'weight', label: 'Selon le poids dans la range' }], s.gridMode, (v) => { setSetting('gridMode', v); draw(); refresh(); })),
    h('label.check', h('input', { type: 'checkbox', checked: s.cellNumbers, on: { change: (e) => { setSetting('cellNumbers', e.target.checked); refresh(); } } }), ' Afficher les chiffres dans les cases'),
    h('p.muted.small', 'Les opens first in suivent tes charts. Tous les autres spots sont générés par des règles simples pour l\'entraînement, pas par un solveur.'),
  );
  draw();
  const wrap = h('div.overlay.drawer-wrap', { on: { mousedown: (e) => { if (e.target === wrap) close(); } } },
    h('aside.drawer', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Réglages' },
      h('div.modal-head', h('h2', 'Réglages'), h('button.icon-btn', { type: 'button', 'aria-label': 'Fermer', on: { click: () => close() } }, '✕')), body));
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() { wrap.remove(); document.removeEventListener('keydown', onKey); }
  document.addEventListener('keydown', onKey);
  document.body.append(wrap);
  wrap.querySelector('button')?.focus();
}

function refresh() {
  if (current === 'study') rerenderStudy();
}

document.addEventListener('keydown', (e) => {
  if (document.querySelector('.overlay')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const r = ROUTES[current];
  if (r?.key && r.key(e)) e.preventDefault();
});

window.addEventListener('hashchange', route);
route();

// ---------- design system page (#/design) ----------
function renderDesign(el) {
  const demoCells = CLASSES.map((c, i) => ({ weight: (i % 7) / 6, freqs: [0.5, 0.3, 0.2] }));
  const roles = [{ role: 'bet-m', label: 'Raise' }, { role: 'call', label: 'Call' }, { role: 'fold', label: 'Fold' }];
  mount(el, h('div.design-page',
    h('h1', 'Design system'),
    h('section.panel', h('div.panel-title', 'Buttons'), h('div.row.gap.wrap',
      h('button.btn.primary', 'Primary'), h('button.btn.secondary', 'Secondary'), h('button.btn.ghost', 'Ghost'), h('button.btn.primary', { disabled: true }, 'Disabled'), h('button.btn.primary.sm', 'Small'), h('button.btn.primary.lg', 'Large'))),
    h('section.panel', h('div.panel-title', 'Action colours'), h('div.row.gap.wrap',
      ['fold', 'call', 'bet-s', 'bet-m', 'bet-l', 'allin'].map((r) => h('button.act', { style: { '--c': `var(--act-${r})` } }, r)))),
    h('section.panel', h('div.panel-title', 'Frequency bar'), FreqBar([{ role: 'bet-m', label: 'Raise', freq: 0.55 }, { role: 'call', label: 'Call', freq: 0.25 }, { role: 'fold', label: 'Fold', freq: 0.2 }], { height: 16, labels: true })),
    h('section.panel', h('div.panel-title', 'Cards'), h('div.row.gap', [51, 46, 41, 36].map((c) => PlayingCard(c, 'lg')), PlayingCard(null, 'lg'), [51, 46].map((c) => PlayingCard(c, 'sm')))),
    h('section.panel', h('div.panel-title', 'Tabs & segmented'), Tabs([{ id: 'a', label: 'Strategy', hotkey: '1' }, { id: 'b', label: 'Ranges', hotkey: '2' }], 'a', () => {}), Segmented('demo', [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }], 1, () => {})),
    h('section.panel', h('div.panel-title', 'Stat tiles'), h('div.stats-row', StatTile('Score', '82%'), StatTile('Hands', '120'), StatTile('EV lost', '3.2bb'))),
    h('section.panel', h('div.panel-title', 'Range grid'), RangeGrid({ cells: demoCells, roles, order: [0, 1, 2], gridMode: 'weight', size: 'sm' }))));
}
