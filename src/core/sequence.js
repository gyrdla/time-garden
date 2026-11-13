// A day in order, not by the clock: the steps picked for a day are put in a row inside four
// slices (morning, noon, evening, night) and their times are worked out from the user's own
// measured durations. Steps with a fixed hour (an appointment, the 21:00 shower) stay put and
// the row flows around them. What does not fit in its slice is flagged; the user decides.

import { isoDate, fromIso, MIN } from './time.js';
import { agenda, dayTray, smartEstimate } from './planner.js';

export const SLICES = [
  { id: 'morning', label: 'Sabah', from: 6, to: 12 },
  { id: 'noon', label: 'Öğle', from: 12, to: 17 },
  { id: 'evening', label: 'Akşam', from: 17, to: 21 },
  { id: 'night', label: 'Gece', from: 21, to: 24 },
];
export const DEFAULT_MIN = 30;
const sliceIx = (id) => Math.max(0, SLICES.findIndex((s) => s.id === id));

/** The slice a moment falls in (before 06:00 counts as night). */
export function sliceAt(ts) {
  const h = new Date(ts).getHours();
  return (SLICES.find((s) => h >= s.from && h < s.to) || SLICES[3]).id;
}

/**
 * Lay out the day.
 * ctx: { tasks, routines, routineLog, projects, sessions, events, running? (taskId timed now) }
 * Returns slices: [{ ...slice, start, end, rows:[{ kind:'step'|'fixed', ... }], overflowMs }]
 * A step row: { task, start, end, minutes, guessed, overflow, running }.
 */
export function sequenceDay(iso, ctx, now = Date.now()) {
  const day0 = fromIso(iso), isToday = iso === isoDate(now), isPast = iso < isoDate(now);
  const at = (h) => day0 + h * 60 * MIN;
  const curSlice = isToday ? sliceIx(sliceAt(now)) : -1;
  // Unsliced steps go to the slice that is on now (today) or to the morning.
  const homeSlice = (t) => (t.slice ? sliceIx(t.slice) : Math.max(0, curSlice));
  const queue = dayTray(iso, ctx.tasks, ctx.projects)
    .map((t) => ({ t, s: homeSlice(t) }))
    .sort((a, b) => a.s - b.s || (a.t.seq ?? 1e9) - (b.t.seq ?? 1e9) || a.t.createdAt - b.t.createdAt);
  const fixed = agenda([day0, at(24)], ctx.tasks, ctx.routines, ctx.routineLog, ctx.projects).filter((i) => !i.done && !i.parallel);
  return SLICES.map((sl, ix) => {
    const start = at(sl.from), end = at(sl.to);
    // Past slices of today count from their start; the slice on now counts from now.
    let cursor = ix === curSlice ? Math.max(now, start) : start;
    const rows = fixed.filter((f) => f.start >= start && f.start < end).map((f) => ({ kind: 'fixed', item: f, start: f.start, end: f.end }));
    for (const { t } of queue.filter((q) => q.s === ix)) {
      const est = smartEstimate(t, ctx.tasks, ctx.sessions || [], ctx.events || []);
      const minutes = est?.minutes || t.estimateMin || DEFAULT_MIN;
      const running = ctx.running === t.id;
      let s = running ? Math.min(cursor, now) : cursor;
      // Flow around fixed items: a step never starts inside one.
      for (let moved = true; moved && !running;) {
        moved = false;
        for (const f of fixed) if (s < f.end && s + minutes * MIN > f.start) { s = f.end; moved = true; }
      }
      const e = Math.max(s + minutes * MIN, running ? now : 0);
      rows.push({ kind: 'step', task: t, start: s, end: e, minutes, guessed: !est || est.source === 'project', running, overflow: e > end, past: !isPast && isToday && e < now });
      cursor = e;
    }
    rows.sort((a, b) => a.start - b.start);
    const steps = rows.filter((r) => r.kind === 'step');
    const last = steps.length ? Math.max(...steps.map((r) => r.end)) : start;
    return { ...sl, start, end, rows, overflowMs: Math.max(0, last - end) };
  });
}

/** The ordering that results from moving one step up or down; it may cross into the next slice. */
export function moveStep(slices, taskId, dir) {
  const flat = slices.flatMap((sl) => sl.rows.filter((r) => r.kind === 'step').map((r) => ({ id: r.task.id, slice: sl.id })));
  const i = flat.findIndex((x) => x.id === taskId);
  if (i < 0) return flat;
  const me = flat[i], j = i + dir, other = flat[j];
  const six = sliceIx(me.slice);
  if (!other || other.slice !== me.slice) {
    // At the edge of its slice: step into the neighbouring slice instead of swapping.
    const ns = SLICES[six + dir];
    if (ns) me.slice = ns.id;
    flat.splice(i, 1);
    const k = dir < 0 ? (flat.map((x) => x.slice).lastIndexOf(me.slice) + 1) : flat.findIndex((x) => x.slice === me.slice);
    flat.splice(k < 0 ? (dir < 0 ? 0 : flat.length) : k, 0, me);
    return flat;
  }
  [flat[i], flat[j]] = [other, me];
  return flat;
}
