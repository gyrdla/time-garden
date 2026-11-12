// Life balance: weekly targets per area against what really happened, what was planned
// against what got done, and — only from the user's own records — what skipping costs.
// Pure functions; nothing here guesses when there is no data.

import { summarize, sessionActive, total, isoDate, fromIso, dayRange, DAY, MIN } from './time.js';
import { agenda } from './planner.js';

const norm = (s) => String(s || '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');

/** A weekly target (minutes) scaled to the length of `range`. */
export function targetMs(weeklyMin, range) {
  return (Number(weeklyMin) || 0) * MIN * ((range[1] - range[0]) / (7 * DAY));
}

/**
 * Per area: measured time (sessions), habit occurrences ticked without a timer (counted at
 * their planned length and reported separately), the target for this range, and when the
 * area was last worked on.
 */
export function balance(range, { sessions, routines, routineLog, targets = {} }, now = Date.now()) {
  const measured = summarize(sessions, [], range, now).byCategory;
  const ticked = {};
  const from = isoDate(range[0]), to = isoDate(range[1] - 1);
  const byId = new Map(routines.map((r) => [r.id, r]));
  for (const l of routineLog) {
    if (l.date < from || l.date > to) continue;
    const r = byId.get(l.routineId);
    if (r) ticked[r.category || 'Diğer'] = (ticked[r.category || 'Diğer'] || 0) + (r.estimateMin || 0) * MIN;
  }
  const last = {};
  for (const s of sessions) {
    const end = s.endedAt ?? now;
    if (end <= now && (!last[s.category] || end > last[s.category])) last[s.category] = end;
  }
  for (const l of routineLog) {
    const r = byId.get(l.routineId), t = l.doneAt || fromIso(l.date);
    if (r && (!last[r.category] || t > last[r.category])) last[r.category] = t;
  }
  const cats = new Set([...Object.keys(targets).filter((c) => targets[c] > 0), ...Object.keys(measured), ...Object.keys(ticked)]);
  return [...cats].map((cat) => {
    const target = targetMs(targets[cat] || 0, range), m = measured[cat] || 0, t = ticked[cat] || 0;
    return { cat, measuredMs: m, tickedMs: t, actualMs: m + t, targetMs: target, pct: target ? (m + t) / target : null, lastAt: last[cat] || null };
  }).sort((a, b) => (b.targetMs - a.targetMs) || (b.actualMs - a.actualMs));
}

/** Everything that had a time in the plan in `range` (up to now): done, missed, still to come. */
export function review(range, { tasks, routines, routineLog, projects }, now = Date.now()) {
  const out = { planned: 0, done: 0, missed: [], upcoming: 0, plannedMs: 0, doneMs: 0 };
  for (let d = range[0]; d < range[1]; d = dayRange(d + DAY / 2)[1]) {
    for (const i of agenda(dayRange(d), tasks, routines, routineLog, projects)) {
      if (i.start < range[0] || i.start >= range[1]) continue;
      if (i.end > now && !i.done) { out.upcoming++; continue; }
      out.planned++; out.plannedMs += i.end - i.start;
      if (i.done) { out.done++; out.doneMs += i.end - i.start; } else out.missed.push(i);
    }
  }
  out.missed.sort((a, b) => b.start - a.start);
  return out;
}

/**
 * How the length of an activity grows with the days left between doing it, fitted to the
 * user's own finished sessions of that name. Needs at least `min` gaps of different lengths;
 * returns null otherwise, or when the data shows no growth.
 */
export function gapModel(name, sessions, min = 4) {
  const key = norm(name);
  const runs = sessions.filter((s) => s.endedAt != null && norm(s.name) === key).sort((a, b) => a.startedAt - b.startedAt);
  const pts = [];
  for (let i = 1; i < runs.length; i++) {
    const gap = (runs[i].startedAt - runs[i - 1].endedAt) / DAY, ms = total(sessionActive(runs[i]));
    if (gap >= 0 && ms >= MIN) pts.push([gap, ms]);
  }
  if (pts.length < min) return null;
  const gaps = pts.map((p) => p[0]), lo = Math.min(...gaps), hi = Math.max(...gaps);
  if (hi - lo < 1) return null;
  const n = pts.length, mx = gaps.reduce((a, b) => a + b, 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  const slope = pts.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / pts.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  if (!(slope > 0)) return null;
  const at = (g) => Math.max(MIN, my + slope * (Math.min(g, hi) - mx));
  return { name: runs[runs.length - 1].name, samples: n, maxGap: hi, perDayMs: slope, at, lastEnd: runs[runs.length - 1].endedAt, daily: at(Math.max(lo, 1)) };
}

/** Activities the data says get longer when skipped, with what doing them now would likely take. */
export function neglect(sessions, now = Date.now()) {
  const names = [...new Set(sessions.filter((s) => s.endedAt != null).map((s) => norm(s.name)))];
  const out = [];
  for (const key of names) {
    const m = gapModel(key, sessions);
    if (!m) continue;
    const gap = (now - m.lastEnd) / DAY;
    out.push({ ...m, gapDays: gap, nowMs: m.at(gap), extraMs: Math.max(0, m.at(gap) - m.daily), beyondData: gap > m.maxGap });
  }
  return out.sort((a, b) => b.extraMs - a.extraMs);
}
