// Programme: book 1h or 2h training slots in a weekly calendar. Each slot is
// filled with the spots to fix from Leakfinder (most urgent first) or, when
// "random" is ticked, with all of them in random order. A slot launches a
// Practice session on those spots.
import { h, mount, pct, modal } from './dom.js';
import { Segmented } from './components.js';
import { getSlots } from '../store.js';
import { spotsToFix, planSlots, addSlot, removeSlot, overlaps, slotStart, slotEnd, SPOT_MINUTES } from '../data/program.js';
import { startProgram } from './practice.js';

const DAY = 86400e3;
const ui = { week: 0 }; // weeks from the current one
let root = null;
let spots = null; // spots to fix, computed once per visit (the analysis takes a moment)

const pad = (n) => String(n).padStart(2, '0');
const localKey = (d, hour) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
const dayLabel = (d) => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const timeLabel = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const whenLabel = (s) => `${dayLabel(new Date(slotStart(s)))} · ${timeLabel(slotStart(s))} → ${timeLabel(slotEnd(s))}`;

// The calendar shows 7 days from today (then the next 7, and so on).
function firstDay(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset * 7);
  return d;
}

export function renderProgram(el) {
  root = el;
  spots = spotsToFix();
  render();
}

function urgencyTag(i, n) {
  const k = n <= 1 ? 0 : Math.floor((3 * i) / n);
  return h('span.urgency.u' + k, ['Urgent', 'Important', 'À revoir'][k]);
}

function render() {
  if (!root) return;
  const slots = getSlots();
  const plan = planSlots(slots, spots);
  const now = Date.now();
  const upcoming = slots.filter((s) => !s.done && slotEnd(s) > now).sort((a, b) => slotStart(a) - slotStart(b));
  const past = slots.filter((s) => s.done || slotEnd(s) <= now).sort((a, b) => slotStart(b) - slotStart(a));
  mount(root, h('div.program-page',
    h('div.setup-head', h('h1', 'Programme'),
      h('p.muted', `Réserve des créneaux d'une ou deux heures. Chaque créneau est rempli tout seul avec tes spots à corriger de Leakfinder, du plus urgent au moins urgent (un spot par ${SPOT_MINUTES} minutes), ou avec tous ces spots au hasard si tu coches l'option.`)),
    spots.length ? null : h('div.panel.warn',
      h('strong', 'Aucun spot à corriger pour l\'instant'),
      h('p.small', 'Le programme se remplit avec les points faibles de Leakfinder. Importe tes tournois avec leurs historiques de mains dans Mes données : tes créneaux se rempliront dès qu\'un point faible apparaît.'),
      h('div.row.gap', h('a.btn.secondary.sm', { href: '#/data' }, 'Mes données'), h('a.btn.ghost.sm', { href: '#/leaks' }, 'Leakfinder'))),
    calendar(slots, plan),
    h('div.two-col',
      h('section.panel', h('div.panel-title', 'Prochains créneaux'),
        upcoming.length ? h('ul.slot-list', upcoming.map((s) => slotCard(s, plan.get(s.id) || []))) : h('p.small.muted', 'Aucun créneau réservé. Clique sur une heure libre du calendrier.')),
      h('section.panel', h('div.panel-title', `Spots à corriger (${spots.length})`),
        spots.length ? h('ol.fix-list', spots.map((sp, i) => h('li',
          h('div.row.between', h('strong', sp.title), urgencyTag(i, spots.length)),
          h('div.small.muted', sp.metric ? `${sp.metric.label} : toi ${pct(sp.metric.you, 0)}, cible ${pct(sp.metric.target, 0)}` : sp.story),
          h('div.small.muted', `${sp.n} mains · score ${pct(sp.avg, 0)} · ${sp.mistakes} erreurs`)))) : h('p.small.muted', 'Rien pour l\'instant.'))),
    past.length ? h('section.panel', h('div.panel-title', 'Créneaux passés'),
      h('ul.slot-list', past.slice(0, 10).map((s) => h('li.slot-card.past',
        h('div', h('strong', whenLabel(s)), h('div.small.muted', s.done ? `Fait : ${s.done.decisions} décisions, score ${pct(s.done.score, 0)}` : 'Pas joué')),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Supprimer le créneau', on: { click: () => { removeSlot(s.id); render(); } } }, '✕'))))) : null));
  const body = root.querySelector('.cal-body');
  if (body) body.scrollTop = ui.scroll ?? 15 * 36; // evening hours in view; kept across re-renders
  body?.addEventListener('scroll', () => { ui.scroll = body.scrollTop; });
}

function calendar(slots, plan) {
  const start = firstDay(ui.week);
  const days = [...Array(7)].map((_, i) => new Date(start.getTime() + i * DAY + 2 * 3600e3)).map((d) => { d.setHours(0, 0, 0, 0); return d; });
  const now = Date.now();
  const cells = [h('div.cal-corner')];
  days.forEach((d, col) => {
    cells.push(h('div.cal-day' + (d.toDateString() === new Date().toDateString() ? '.today' : ''), { style: { gridColumn: col + 2, gridRow: 1 } }, dayLabel(d)));
    for (let hr = 0; hr < 24; hr++) {
      const key = localKey(d, hr);
      const t = new Date(key).getTime();
      const busy = overlaps(slots, t, 1);
      const pastCell = t + 3600e3 <= now;
      cells.push(busy || pastCell
        ? h('div.cal-cell' + (pastCell ? '.past' : ''), { style: { gridColumn: col + 2, gridRow: hr + 2 } })
        : h('button.cal-cell.free', {
          type: 'button', style: { gridColumn: col + 2, gridRow: hr + 2 }, 'aria-label': `Réserver ${dayLabel(d)} à ${hr}h`,
          on: { click: () => bookDialog(key) },
        }));
    }
  });
  for (let hr = 0; hr < 24; hr++) cells.push(h('div.cal-hour', { style: { gridColumn: 1, gridRow: hr + 2 } }, `${pad(hr)}:00`));
  for (const s of slots) {
    const t = slotStart(s);
    const col = days.findIndex((d) => d.toDateString() === new Date(t).toDateString());
    if (col < 0 || col > 6) continue;
    const hr = new Date(t).getHours();
    const list = plan.get(s.id) || [];
    const state = s.done ? '.done' : slotEnd(s) <= now ? '.missed' : t <= now ? '.live' : '';
    cells.push(h('button.cal-slot' + state, {
      type: 'button', style: { gridColumn: col + 2, gridRow: `${hr + 2} / span ${Math.min(s.hours, 24 - hr)}` },
      'aria-label': `Créneau ${whenLabel(s)}`, on: { click: () => slotDialog(s, list) },
    }, h('strong', `${timeLabel(t)} · ${s.hours}h`),
    h('span.small', s.done ? 'Fait' : s.random ? 'Aléatoire' : list.length ? list.map((x) => x.title.split(' · ')[0]).join(', ') : 'À remplir')));
  }
  const end = new Date(start.getTime() + 6 * DAY);
  return h('section.panel.cal',
    h('div.row.between.cal-head',
      h('button.btn.ghost.sm', { type: 'button', 'aria-label': '7 jours précédents', on: { click: () => { ui.week--; render(); } } }, '◀'),
      h('strong', `Du ${start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} au ${end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`),
      h('div.row.gap',
        ui.week ? h('button.btn.ghost.sm', { type: 'button', on: { click: () => { ui.week = 0; render(); } } }, 'Aujourd\'hui') : null,
        h('button.btn.ghost.sm', { type: 'button', 'aria-label': '7 jours suivants', on: { click: () => { ui.week++; render(); } } }, '▶'))),
    h('div.cal-body', h('div.cal-grid', cells)));
}

function slotCard(s, list) {
  const live = slotStart(s) <= Date.now();
  return h('li.slot-card' + (live ? '.live' : ''),
    h('div.grow',
      h('div.row.gap', h('strong', whenLabel(s)), live ? h('span.badge.pos', 'En cours') : null, s.random ? h('span.pill', 'Aléatoire') : null),
      h('div.small.muted', list.length ? list.map((x) => x.title).join(' · ') : 'Pas encore de spot à corriger.')),
    h('button.btn.primary.sm', { type: 'button', disabled: !list.length, on: { click: () => launch(s, list) } }, 'Lancer'));
}

function launch(s, list) {
  startProgram({ slotId: s.id, spots: list, random: s.random, until: slotEnd(s) });
  location.hash = '#/practice';
}

function bookDialog(key) {
  const d = { hours: 1, random: false };
  const t = new Date(key).getTime();
  const body = h('div.book');
  const dlg = modal(`Réserver ${dayLabel(new Date(t))} à ${timeLabel(t)}`, body);
  const draw = () => {
    const slots = getSlots();
    const twoFree = !overlaps(slots, t, 2) && new Date(t).getHours() < 23;
    if (!twoFree) d.hours = 1;
    const preview = planSlots([...slots, { id: 'new', start: key, hours: d.hours, random: d.random, done: null }], spots).get('new') || [];
    body.replaceChildren(
      h('div.field', h('div.field-label', 'Durée'),
        Segmented('Durée', [{ value: 1, label: '1 heure' }, ...(twoFree ? [{ value: 2, label: '2 heures' }] : [])], d.hours, (v) => { d.hours = v; draw(); })),
      h('label.check', h('input', { type: 'checkbox', checked: d.random, on: { change: (e) => { d.random = e.target.checked; draw(); } } }),
        ' M\'entraîner sur tous les spots à corriger, au hasard'),
      h('div.panel-title', d.random ? 'Tous tes spots à corriger, mélangés' : 'Spots prévus, du plus urgent au moins urgent'),
      preview.length ? h('ol.small', preview.map((x) => h('li', x.title))) : h('p.small.muted', 'Aucun spot à corriger pour l\'instant : le créneau se remplira quand Leakfinder en trouvera.'),
      h('div.row.end.gap',
        h('button.btn.ghost', { type: 'button', on: { click: () => dlg.close() } }, 'Annuler'),
        h('button.btn.primary', { type: 'button', on: { click: () => { addSlot({ start: key, hours: d.hours, random: d.random }); dlg.close(); render(); } } }, 'Réserver')));
  };
  draw();
}

function slotDialog(s, list) {
  const now = Date.now();
  const body = h('div.book',
    h('p', s.random ? 'Tous tes spots à corriger, dans un ordre aléatoire.' : 'Les spots les plus urgents d\'abord, 10 mains sur chacun puis le suivant.'),
    s.done ? h('p.small.pos', `Fait : ${s.done.decisions} décisions, score ${pct(s.done.score, 0)}.`) : null,
    list.length ? h('ol.small', list.map((x) => h('li', h('strong', x.title), h('div.muted', x.story)))) : h('p.small.muted', 'Aucun spot à corriger pour l\'instant.'),
    h('div.row.end.gap',
      h('button.btn.ghost', { type: 'button', on: { click: () => { removeSlot(s.id); dlg.close(); render(); } } }, 'Supprimer le créneau'),
      !s.done && slotEnd(s) > now ? h('button.btn.primary', { type: 'button', disabled: !list.length, on: { click: () => { dlg.close(); launch(s, list); } } }, 'Lancer l\'entraînement') : null));
  const dlg = modal(whenLabel(s), body);
}
