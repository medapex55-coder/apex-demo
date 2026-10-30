// Cumulative winnings chart (bb over hands) with a crosshair tooltip.
import { h } from './dom.js';

export const SERIES = [
  { key: 'net', label: 'Gains', color: 'var(--series-net)' },
  { key: 'ev', label: 'Gains EV (all-in)', short: 'EV', color: 'var(--series-ev)', dash: '6 4' },
  { key: 'sd', label: 'Showdown', short: 'SD', color: 'var(--series-sd)' },
  { key: 'nsd', label: 'Sans showdown', short: 'Sans SD', color: 'var(--series-nsd)' },
];

function niceStep(range, ticks) {
  const raw = range / ticks;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || p * 10;
}

const svgNS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, text) {
  const e = document.createElementNS(svgNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}
const signed = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} bb`;

export function WinningsChart(curve) {
  const W = 800, H = 340, L = 52, R = 96, T = 14, B = 30;
  // Keep at most ~600 points so long histories stay light.
  const step = Math.max(1, Math.ceil(curve.length / 600));
  const pts = curve.filter((_, i) => i % step === 0 || i === curve.length - 1);
  const n = Math.max(1, curve[curve.length - 1].i);
  let lo = 0, hi = 0;
  for (const p of pts) for (const s of SERIES) { lo = Math.min(lo, p[s.key]); hi = Math.max(hi, p[s.key]); }
  const ys = niceStep(hi - lo || 10, 6);
  lo = Math.floor(lo / ys) * ys;
  hi = Math.ceil(hi / ys) * ys || ys;
  const x = (i) => L + (i / n) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const xs = niceStep(n, 8);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'wchart', role: 'img', 'aria-label': 'Courbe des gains en big blinds au fil des mains' });
  for (let v = lo; v <= hi + 1e-9; v += ys) {
    svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: Math.abs(v) < 1e-9 ? 'zero' : 'grid' }));
    svg.append(el('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, Math.round(v)));
  }
  for (let i = 0; i <= n; i += xs) svg.append(el('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'tick' }, Math.round(i)));
  const ends = [];
  for (const s of SERIES) {
    svg.append(el('polyline', {
      points: pts.map((p) => `${x(p.i).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join(' '),
      fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-dasharray': s.dash || '', 'stroke-linejoin': 'round',
    }));
    const last = pts[pts.length - 1];
    ends.push({ s, y: y(last[s.key]), v: last[s.key] });
  }
  // Direct labels at the right end, nudged apart so they never overlap.
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  for (const e of ends) svg.append(el('text', { x: W - R + 8, y: e.y + 4, class: 'end-label' }, `${e.s.short || e.s.label} ${Math.round(e.v)}`));

  const cross = el('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' });
  const dots = SERIES.map((s) => el('circle', { r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }));
  const hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
  svg.append(cross, ...dots, hit);
  const tip = h('div.chart-tip', { hidden: true });
  hit.addEventListener('mousemove', (ev) => {
    const box = svg.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(n, Math.round(((px - L) / (W - L - R)) * n)));
    const p = curve[Math.min(curve.length - 1, i)];
    cross.setAttribute('x1', x(p.i));
    cross.setAttribute('x2', x(p.i));
    cross.setAttribute('visibility', 'visible');
    SERIES.forEach((s, k) => {
      dots[k].setAttribute('cx', x(p.i));
      dots[k].setAttribute('cy', y(p[s.key]));
      dots[k].setAttribute('visibility', 'visible');
    });
    tip.hidden = false;
    tip.replaceChildren(h('strong', `Main ${p.i}`), ...SERIES.map((s) => h('div.row.between', h('span', h('span.legend-line' + (s.dash ? '.dashed' : ''), { style: { '--c': s.color } }), s.label), h('span.mono', signed(p[s.key])))));
    tip.style.left = Math.min((x(p.i) / W) * box.width + 12, box.width - 200) + 'px';
  });
  hit.addEventListener('mouseleave', () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
  });

  return h('figure.wchart-wrap',
    h('div.legend', SERIES.map((s) => h('span.legend-item', h('span.legend-line' + (s.dash ? '.dashed' : ''), { style: { '--c': s.color } }), s.label))),
    h('div.wchart-box', svg, tip));
}
