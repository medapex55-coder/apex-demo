// Programme: training slots booked in a calendar (1 or 2 hours), each filled
// automatically with the spots Leakfinder marks as weak, most urgent first.
import { getDecisions, getTournaments } from './datastore.js';
import { analyzeDecisions, verdict, spotTitle, spotStory, keyMetric } from './leaks.js';
import { getSlots, saveSlots, uid } from '../store.js';

export const SPOT_MINUTES = 30; // one spot per half hour of a slot
const HOUR = 3600e3;

export const slotStart = (s) => new Date(s.start).getTime();
export const slotEnd = (s) => slotStart(s) + s.hours * HOUR;

// How urgent a weak spot is: the worse the score and the more hands it
// comes up in, the sooner it is worth training.
export const urgencyOf = (sp) => (1 - sp.avg) * Math.sqrt(sp.n);

// Weak spots from Leakfinder, most urgent first, with what Practice needs
// to rebuild them (one of the real decisions: seats, stack, open size).
export function rankSpots(spots) {
  return spots.filter((s) => verdict(s) === 'weak').map(spotTarget).sort((a, b) => b.urgency - a.urgency);
}

// A Leakfinder spot as Practice trains it (Programme, or "Étudier").
export function spotTarget(s) {
  const { sc, hp, vp, lp, s: stack, o, ko, r3 } = s.hands[0].d;
  return {
    key: s.key, title: `${spotTitle(s)} · ${s.group}`, story: spotStory(s), n: s.n, avg: s.avg, mistakes: s.mistakes,
    urgency: urgencyOf(s), metric: keyMetric(s), d: { sc, hp, vp, lp, s: stack, o, ko, r3 },
  };
}

export function spotsToFix() {
  const ko = new Map(getTournaments().map((t) => [t.tid, t.type === 'ko' || t.type === 'mystery']));
  const decisions = getDecisions().map((d) => ({ ...d, ko: ko.get(d.t) }));
  return decisions.length ? rankSpots(analyzeDecisions(decisions).spots) : [];
}

// The spots of each upcoming slot. Slots are filled in time order: the most
// urgent spots go to the next slot, the following ones to the slot after,
// and the list starts over when it runs out. A "random" slot gets them all.
export function planSlots(slots, spots, now = Date.now()) {
  const plan = new Map();
  let i = 0;
  for (const s of slots.filter((x) => !x.done && slotEnd(x) > now).sort((a, b) => slotStart(a) - slotStart(b))) {
    if (s.random) { plan.set(s.id, spots.slice()); continue; }
    const pick = [];
    for (let j = 0; j < (s.hours * 60) / SPOT_MINUTES && spots.length; j++) pick.push(spots[(i++) % spots.length]);
    plan.set(s.id, [...new Set(pick)]);
  }
  return plan;
}

export const overlaps = (slots, start, hours) => slots.some((s) => slotStart(s) < start + hours * HOUR && start < slotEnd(s));

// start: local "YYYY-MM-DDTHH:00".
export function addSlot({ start, hours, random }) {
  const t = new Date(start).getTime();
  if (overlaps(getSlots(), t, hours)) return null;
  const slot = { id: uid(), start, hours, random: !!random, done: null };
  saveSlots([...getSlots(), slot]);
  return slot;
}
export const removeSlot = (id) => saveSlots(getSlots().filter((s) => s.id !== id));
export function markSlotDone(id, summary) {
  saveSlots(getSlots().map((s) => (s.id === id ? { ...s, done: summary } : s)));
}
