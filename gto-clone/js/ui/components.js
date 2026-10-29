import { h, modal, pct } from './dom.js';
import { RANKS, SUITS, SUIT_SYM, CLASSES } from '../engine/cards.js';

export const roleVar = (role) => `var(--act-${role})`;

export function PlayingCard(c, size = 'md') {
  if (c == null) return h('span.pcard.' + size + '.back', { 'aria-label': 'Hidden card' });
  const r = RANKS[c >> 2], s = SUITS[c & 3];
  return h('span.pcard.' + size + '.suit-' + s, { 'aria-label': r + ' of ' + { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }[s] },
    h('b', r === 'T' ? '10' : r), h('i', SUIT_SYM[s]));
}

export function FreqBar(parts, { height = 10, labels = false } = {}) {
  // parts: [{role, freq, label}]
  return h('div.freqbar', { style: { height: height + 'px' }, role: 'img', 'aria-label': parts.filter((p) => p.freq > 0.005).map((p) => `${p.label} ${pct(p.freq)}`).join(', ') },
    parts.filter((p) => p.freq > 0.001).map((p) => h('span', { style: { flexBasis: p.freq * 100 + '%', background: roleVar(p.role) }, title: `${p.label}: ${pct(p.freq, 1)}` },
      labels && p.freq > 0.12 ? pct(p.freq) : '')));
}

const heatColor = (t) => {
  // 0 -> danger-ish red, 0.5 -> neutral, 1 -> green; works on dark bg
  const x = Math.max(0, Math.min(1, t));
  const hue = x * 130;
  return `hsl(${hue} 55% ${28 + x * 10}%)`;
};

// cells: array(169) of { weight, freqs, heat, text }
export function RangeGrid({ cells, roles, order, mode = 'strategy', gridMode = 'full', selected, hover, filterAction = -1, dim, marks, showNumbers, onHover, onSelect, label = 'Range grid', size = '' }) {
  const grid = h('div.rgrid' + (size ? '.' + size : ''), { role: 'grid', 'aria-label': label });
  CLASSES.forEach((c, idx) => {
    const cell = cells[idx];
    const empty = !cell || cell.weight < 0.005;
    const el = h('button.cell', {
      type: 'button',
      'aria-label': c.name + (empty ? ': not in range' : mode === 'strategy' ? ': ' + order.map((k) => `${roles[k].label} ${pct(cell.freqs[k])}`).join(', ') : ': ' + (cell.text || '')),
      class: [selected === idx && 'selected', hover === idx && 'hovered', dim && dim(idx) && 'dimmed', empty && 'empty'].filter(Boolean).join(' '),
      on: {
        mouseenter: () => onHover?.(idx),
        focus: () => onHover?.(idx),
        click: () => onSelect?.(idx),
        keydown: (e) => {
          const map = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 13, ArrowUp: -13 };
          if (map[e.key]) { e.preventDefault(); grid.children[Math.max(0, Math.min(168, idx + map[e.key]))]?.focus(); }
        },
      },
    });
    if (!empty) {
      const hgt = gridMode === 'weight' ? Math.max(6, cell.weight * 100) : 100;
      if (mode === 'strategy') {
        const bars = h('span.bars', { style: { height: hgt + '%' } });
        for (const k of order) {
          let f = cell.freqs[k];
          if (filterAction >= 0 && k !== filterAction) { bars.append(h('span.seg.ghost', { style: { flexBasis: f * 100 + '%' } })); continue; }
          if (f > 0.001) bars.append(h('span.seg', { style: { flexBasis: f * 100 + '%', background: roleVar(roles[k].role) } }));
        }
        el.append(bars);
      } else if (mode === 'range') {
        el.append(h('span.bars', { style: { height: Math.max(6, cell.weight * 100) + '%' } }, h('span.seg', { style: { flexBasis: '100%', background: 'var(--accent)' } })));
      } else {
        el.append(h('span.bars', { style: { height: hgt + '%' } }, h('span.seg', { style: { flexBasis: '100%', background: heatColor(cell.heat) } })));
      }
    }
    el.append(h('span.lbl', c.name));
    const mk = marks?.(idx);
    if (mk) el.append(h('span.mark.mark-' + mk, { title: mk }));
    if (!empty && (showNumbers || mode !== 'strategy') && cell.text) el.append(h('span.val', cell.text));
    grid.append(el);
  });
  return grid;
}

export function cardPicker({ title, count, used = [], initial = [], onDone }) {
  let picked = initial.slice();
  const body = h('div.picker');
  const render = () => {
    body.replaceChildren(
      h('p.muted', `Pick ${count} card${count > 1 ? 's' : ''}. ${picked.length}/${count} selected.`),
      h('div.picker-grid', SUITS.split('').map((s, si) => h('div.picker-row', [...RANKS].reverse().map((r) => {
        const c = RANKS.indexOf(r) * 4 + si;
        const isUsed = used.includes(c);
        const on = picked.includes(c);
        return h('button.pick' + (on ? '.on' : ''), {
          type: 'button', disabled: isUsed, 'aria-pressed': on ? 'true' : 'false',
          on: { click: () => { picked = on ? picked.filter((x) => x !== c) : picked.length < count ? [...picked, c] : picked; render(); } },
        }, PlayingCard(c, 'sm'));
      })))),
      h('div.row.gap.end',
        h('button.btn.ghost', { type: 'button', on: { click: () => { picked = []; render(); } } }, 'Clear'),
        h('button.btn.secondary', { type: 'button', on: { click: () => { picked = randomCards(count, used); render(); } } }, 'Random'),
        h('button.btn.primary', { type: 'button', disabled: picked.length !== count, on: { click: () => { m.close(); onDone(picked); } } }, 'Confirm')),
    );
  };
  render();
  const m = modal(title, body);
  return m;
}

export function randomCards(n, used = []) {
  const out = [];
  while (out.length < n) {
    const c = Math.floor(Math.random() * 52);
    if (!used.includes(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

export function Tabs(items, active, onPick) {
  return h('div.tabs', { role: 'tablist' }, items.map((it, i) => h('button.tab' + (it.id === active ? '.active' : ''), {
    type: 'button', role: 'tab', 'aria-selected': it.id === active ? 'true' : 'false',
    on: { click: () => onPick(it.id) },
  }, it.label, it.hotkey ? h('kbd', it.hotkey) : null)));
}

export function Segmented(name, options, value, onPick) {
  return h('div.segmented', { role: 'radiogroup', 'aria-label': name }, options.map((o) => h('button' + (o.value === value ? '.on' : ''), {
    type: 'button', role: 'radio', 'aria-checked': o.value === value ? 'true' : 'false',
    on: { click: () => onPick(o.value) },
  }, o.label)));
}

export function StatTile(label, value, sub) {
  return h('div.stat', h('div.stat-label', label), h('div.stat-value', value), sub ? h('div.stat-sub', sub) : null);
}

export function Logo() {
  return h('span.logo', { 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="3" width="8" height="8" rx="2" fill="var(--act-bet-m)"/><rect x="13" y="3" width="8" height="8" rx="2" fill="var(--act-call)"/><rect x="3" y="13" width="8" height="8" rx="2" fill="var(--act-fold)"/><rect x="13" y="13" width="8" height="8" rx="2" fill="var(--accent)"/></svg>' });
}
