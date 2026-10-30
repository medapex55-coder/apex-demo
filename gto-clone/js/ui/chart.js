// Cumulative winnings chart (bb over hands): an area for the real result
// (green above zero, red below), three thinner lines for EV, showdown and
// non-showdown, labels at the line ends, a legend that hides or shows each
// line, and a crosshair tooltip.
import { h } from './dom.js';

export const SERIES = [
  { key: 'net', label: 'Gains', color: 'var(--series-net)', width: 2.5 },
  { key: 'ev', label: 'Gains EV (all-in)', short: 'EV', color: 'var(--series-ev)', dash: '6 4', width: 1.75 },
  { key: 'sd', label: 'Showdown', short: 'SD', color: 'var(--series-sd)', width: 1.75 },
  { key: 'nsd', label: 'Sans showdown', short: 'Sans SD', color: 'var(--series-nsd)', width: 1.75 },
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
const signed = (v) => `${v >= 0 ? '+' : ''}${(Math.round(v * 10) / 10).toFixed(1).replace('.', ',')} bb`;
const short = (v) => `${v >= 0 ? '+' : ''}${Math.round(v)}`;
let uid = 0;

// Downsample to ~700 points, keeping each bucket's lowest and highest real
// result so swings never vanish from long histories.
function thin(curve) {
  if (curve.length <= 900) return curve;
  const size = Math.ceil(curve.length / 350);
  const out = [curve[0]];
  for (let i = 1; i < curve.length; i += size) {
    const b = curve.slice(i, i + size);
    const lo = b.reduce((m, p) => (p.net < m.net ? p : m), b[0]);
    const hi = b.reduce((m, p) => (p.net > m.net ? p : m), b[0]);
    out.push(...(lo.i < hi.i ? [lo, hi] : lo === hi ? [lo] : [hi, lo]));
  }
  if (out[out.length - 1] !== curve[curve.length - 1]) out.push(curve[curve.length - 1]);
  return out;
}

export function WinningsChart(curve) {
  const id = 'wc' + uid++;
  const hidden = new Set();
  const pts = thin(curve);
  const last = curve[curve.length - 1];
  const box = h('div.wchart-box');
  const legend = h('div.legend', { role: 'group', 'aria-label': 'Courbes affichées' });

  const drawLegend = () => legend.replaceChildren(...SERIES.map((s) => h('button.legend-item' + (hidden.has(s.key) ? '.off' : ''), {
    type: 'button', 'aria-pressed': hidden.has(s.key) ? 'false' : 'true', title: hidden.has(s.key) ? 'Afficher la courbe' : 'Masquer la courbe',
    on: { click: () => { hidden.has(s.key) ? hidden.delete(s.key) : (hidden.size < SERIES.length - 1 && hidden.add(s.key)); drawLegend(); draw(); } },
  }, h('span.legend-line' + (s.dash ? '.dashed' : ''), { style: { '--c': s.color } }), s.label, h('span.legend-val.mono', short(last[s.key]) + ' bb'))));

  function draw() {
    const shown = SERIES.filter((s) => !hidden.has(s.key));
    const W = 800, H = 340, L = 56, R = 110, T = 18, B = 34;
    const n = Math.max(1, last.i);
    let lo = 0, hi = 0;
    for (const p of pts) for (const s of shown) { lo = Math.min(lo, p[s.key]); hi = Math.max(hi, p[s.key]); }
    const ys = niceStep(hi - lo || 10, 5);
    lo = Math.floor(lo / ys) * ys;
    hi = Math.ceil(hi / ys) * ys || ys;
    if (hi === lo) hi = lo + ys;
    const x = (i) => L + (i / n) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const xs = niceStep(n, 6);

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'wchart', role: 'img', 'aria-label': `Courbe des gains sur ${n} mains : ${signed(last.net)}` });
    const defs = el('defs');
    const grad = (gid, color, top) => {
      const g = el('linearGradient', { id: gid, x1: 0, x2: 0, y1: top ? 0 : 1, y2: top ? 1 : 0 });
      g.append(el('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': 0.28 }), el('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0.02 }));
      return g;
    };
    const y0 = y(0);
    const clip = (cid, y1, y2) => { const c = el('clipPath', { id: cid }); c.append(el('rect', { x: L, y: y1, width: W - L - R, height: Math.max(0, y2 - y1) })); return c; };
    defs.append(grad(id + 'up', 'var(--series-net)', true), grad(id + 'dn', 'var(--series-nsd)', false), clip(id + 'ca', T, y0), clip(id + 'cb', y0, H - B));
    svg.append(defs);

    // Grid and axes.
    for (let v = lo; v <= hi + 1e-9; v += ys) {
      if (Math.abs(v) > 1e-9) svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }));
      svg.append(el('text', { x: L - 10, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, Math.round(v)));
    }
    for (let i = xs; i < n; i += xs) svg.append(el('text', { x: x(i), y: H - 12, 'text-anchor': 'middle', class: 'tick' }, Math.round(i)));
    svg.append(el('text', { x: L - 10, y: T - 6, 'text-anchor': 'end', class: 'axis-name' }, 'bb'));
    svg.append(el('text', { x: W - R, y: H - 12, 'text-anchor': 'end', class: 'axis-name' }, 'mains'));

    // Area of the real result, green above zero and red below.
    if (!hidden.has('net')) {
      const line = pts.map((p) => `${x(p.i).toFixed(1)},${y(p.net).toFixed(1)}`).join(' ');
      const area = `${x(pts[0].i).toFixed(1)},${y0.toFixed(1)} ${line} ${x(last.i).toFixed(1)},${y0.toFixed(1)}`;
      svg.append(el('polygon', { points: area, fill: `url(#${id}up)`, 'clip-path': `url(#${id}ca)` }));
      svg.append(el('polygon', { points: area, fill: `url(#${id}dn)`, 'clip-path': `url(#${id}cb)` }));
    }
    svg.append(el('line', { x1: L, x2: W - R, y1: y0, y2: y0, class: 'zero' }));
    // Thin lines first, the real result on top.
    for (const s of [...shown].reverse()) {
      svg.append(el('polyline', {
        points: pts.map((p) => `${x(p.i).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join(' '),
        fill: 'none', stroke: s.color, 'stroke-width': s.width, 'stroke-dasharray': s.dash || '', 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        opacity: s.key === 'net' ? 1 : 0.9,
      }));
    }
    // End dots and labels, nudged apart so they never overlap.
    const ends = shown.map((s) => ({ s, y: y(last[s.key]), v: last[s.key] })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 18) ends[i].y = ends[i - 1].y + 18;
    for (const e of ends) {
      svg.append(el('circle', { cx: x(last.i), cy: y(e.v), r: 3.5, fill: e.s.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
      const g = el('g', { class: 'end-tag' });
      g.append(el('rect', { x: W - R + 8, y: e.y - 9, width: R - 12, height: 18, rx: 4, fill: 'var(--surface-2)', stroke: e.s.color, 'stroke-width': 1 }));
      g.append(el('text', { x: W - R + 14, y: e.y + 4, class: 'end-label' }, `${e.s.short || e.s.label} ${short(e.v)}`));
      svg.append(g);
    }

    // Crosshair tooltip.
    const cross = el('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' });
    const dots = shown.map((s) => el('circle', { r: 4.5, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }));
    const hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
    svg.append(cross, ...dots, hit);
    const tip = h('div.chart-tip', { hidden: true });
    hit.addEventListener('mousemove', (ev) => {
      const bb = svg.getBoundingClientRect();
      const px = ((ev.clientX - bb.left) / bb.width) * W;
      const i = Math.max(0, Math.min(n, Math.round(((px - L) / (W - L - R)) * n)));
      const p = curve[Math.min(curve.length - 1, i)];
      for (const a of ['x1', 'x2']) cross.setAttribute(a, x(p.i));
      cross.setAttribute('visibility', 'visible');
      shown.forEach((s, k) => { dots[k].setAttribute('cx', x(p.i)); dots[k].setAttribute('cy', y(p[s.key])); dots[k].setAttribute('visibility', 'visible'); });
      tip.hidden = false;
      tip.replaceChildren(h('div.tip-head', `Main ${p.i}`),
        ...[...shown].sort((a, b) => p[b.key] - p[a.key]).map((s) => h('div.tip-row',
          h('span', h('span.legend-line' + (s.dash ? '.dashed' : ''), { style: { '--c': s.color } }), s.label),
          h('span.mono' + (p[s.key] >= 0 ? '.pos' : '.neg'), signed(p[s.key])))));
      const left = (x(p.i) / W) * bb.width;
      tip.style.left = (left > bb.width / 2 ? left - 212 : left + 12) + 'px';
    });
    hit.addEventListener('mouseleave', () => {
      tip.hidden = true;
      cross.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
    });
    box.replaceChildren(svg, tip);
  }

  drawLegend();
  draw();
  return h('figure.wchart-wrap', legend, box);
}
