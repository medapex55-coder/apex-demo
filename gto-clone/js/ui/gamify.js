// Game layer of the UI: level badge, XP bar, the player chip in the top bar,
// and the celebrations (level up, badge, daily goal).
import { h, toast } from './dom.js';
import { getProgress } from '../store.js';
import { levelOf, streakOf, today, DAILY_GOAL, BADGES } from '../data/progress.js';

export function LevelBadge(lvl, size = '') {
  return h('span.level-badge' + (size ? '.' + size : ''), { title: `Niveau ${lvl.n} · ${lvl.name}`, 'aria-label': `Niveau ${lvl.n}` }, String(lvl.n));
}

export function XpBar(xp, { label = true } = {}) {
  const lvl = levelOf(xp);
  return h('div.xp',
    h('div.xp-track', { role: 'progressbar', 'aria-label': 'Expérience', 'aria-valuemin': '0', 'aria-valuemax': String(lvl.to - lvl.from), 'aria-valuenow': String(xp - lvl.from) },
      h('span.xp-fill', { style: { width: Math.round(Math.min(1, lvl.pct) * 100) + '%' } })),
    label ? h('div.xp-label', h('span', `${xp - lvl.from} / ${lvl.to - lvl.from} XP`), h('span.muted', `prochain niveau : ${levelOf(lvl.to).name}`)) : null);
}

export function DailyRing(done, goal = DAILY_GOAL, size = 34) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r;
  const pct = Math.min(1, done / goal);
  return h('span.daily-ring', {
    title: `Objectif du jour : ${Math.min(done, goal)}/${goal} décisions`,
    html: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg${pct >= 1 ? ' done' : ''}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg><b>${pct >= 1 ? '✓' : done}</b>`,
  });
}

export function PlayerChip() {
  const p = getProgress();
  const lvl = levelOf(p.xp);
  const streak = streakOf(p);
  return h('a.player-chip', { href: '#/stats', title: 'Ta progression' },
    LevelBadge(lvl, 'sm'),
    h('span.pc-main', h('span.pc-name', `${lvl.icon} ${lvl.name}`), XpBar(p.xp, { label: false })),
    h('span.pc-streak' + (streak ? '.on' : ''), { title: `${streak} jour${streak > 1 ? 's' : ''} d'affilée avec l'objectif atteint` }, '🔥', h('b', streak)),
    DailyRing(p.days[today()] || 0));
}

export function badgeList(earned) {
  return BADGES.map((b) => h('div.badge-card' + (earned[b.id] ? '.on' : ''), { title: b.desc },
    h('span.badge-icon', b.icon), h('strong', b.name), h('span.small.muted', earned[b.id] ? `Débloqué le ${earned[b.id].split('-').reverse().join('/')}` : b.desc)));
}

// Level up: a short full-screen burst. Badges and the daily goal: a toast.
export function celebrate({ levelUp, badges = [], goalReached } = {}) {
  if (levelUp) {
    const burst = h('div.celebrate', { role: 'status', 'aria-live': 'polite' },
      h('div.confetti', Array.from({ length: 28 }, (_, i) => h('i', { style: { '--i': i, '--x': `${(i * 37) % 100}%`, '--d': `${(i % 7) * 60}ms` } }))),
      h('div.celebrate-card', h('div.small.muted', 'Niveau supérieur !'), LevelBadge(levelUp, 'xl'), h('h2', `${levelUp.icon} ${levelUp.name}`)));
    document.body.append(burst);
    setTimeout(() => burst.remove(), 2600);
  }
  badges.forEach((b, k) => setTimeout(() => toast(`${b.icon} Badge débloqué : ${b.name}`), 300 + k * 2600));
  if (goalReached) setTimeout(() => toast('🎉 Objectif du jour atteint !'), levelUp ? 2700 : 200);
}
