// Period analysis built on time.js. Pure: give it records and a clock, get numbers.
// Nothing here estimates or fills gaps — empty periods come back as zeros.

import { summarize, coverage, clipAll, sessionActive, total, DAY } from './time.js';

const startOfDay = (ts) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const addDays = (ts, n) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };

/** [start, end) of the day/week/month/year containing `anchor`. Weeks start on Monday. */
export function periodRange(kind, anchor) {
  const d = new Date(anchor);
  if (kind === 'day') return [startOfDay(anchor), addDays(anchor, 1)];
  if (kind === 'week') { const s = addDays(anchor, -((d.getDay() + 6) % 7)); return [s, addDays(s, 7)]; }
  if (kind === 'month') return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()];
  return [new Date(d.getFullYear(), 0, 1).getTime(), new Date(d.getFullYear() + 1, 0, 1).getTime()];
}

/** Anchor timestamp of the neighbouring period. */
export function shiftPeriod(kind, anchor, dir) {
  const d = new Date(anchor);
  if (kind === 'day') return addDays(anchor, dir);
  if (kind === 'week') return addDays(anchor, 7 * dir);
  if (kind === 'month') return new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime();
  return new Date(d.getFullYear() + dir, 0, 1).getTime();
}

/** Sub-ranges for the bar chart: days for week/month, months for year. */
export function buckets(kind, range) {
  const out = [];
  if (kind === 'year') {
    const y = new Date(range[0]).getFullYear();
    for (let m = 0; m < 12; m++) out.push([new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime()]);
  } else if (kind !== 'day') {
    for (let s = range[0]; s < range[1]; s = addDays(s, 1)) out.push([s, addDays(s, 1)]);
  }
  return out;
}

export function analyze(kind, anchor, sessions, events, now = Date.now()) {
  const range = periodRange(kind, anchor);
  const prevRange = periodRange(kind, shiftPeriod(kind, anchor, -1));
  const sum = summarize(sessions, events, range, now);
  const prev = summarize(sessions, events, prevRange, now);
  const series = buckets(kind, range).map((r) => {
    const s = summarize(sessions, events, r, now);
    return { range: r, primaryMs: s.primaryMs, focusMs: s.focusMs, uniqueMs: s.uniqueMs, byCategory: s.byCategory };
  });
  const cov = kind === 'day' ? coverage(sessions, events, range, now) : null;

  // Hour-of-day histogram of primary time (which hours hold the most tracked work).
  const hours = new Array(24).fill(0);
  for (const s of sessions) {
    for (const [a, b] of clipAll(sessionActive(s, now), range)) {
      let t = a;
      while (t < b) {
        const d = new Date(t);
        const next = Math.min(b, new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime());
        hours[d.getHours()] += next - t;
        t = next;
      }
    }
  }

  const activities = {};
  for (const s of sessions) {
    const ms = total(clipAll(sessionActive(s, now), range));
    if (!ms) continue;
    const row = activities[s.name] || (activities[s.name] = { ms: 0, count: 0, category: s.category });
    row.ms += ms; row.count += 1;
  }

  const activeDays = series.filter((b) => b.uniqueMs > 0).length;
  return { kind, range, prevRange, sum, prev, series, coverage: cov, hours, activities, activeDays, hasData: sum.uniqueMs > 0 };
}

/** Best contiguous window of `width` hours by tracked primary time, or null without data. */
export function peakWindow(hours, width = 3) {
  let best = -1, at = 0;
  for (let h = 0; h + width <= 24; h++) {
    const v = hours.slice(h, h + width).reduce((a, b) => a + b, 0);
    if (v > best) { best = v; at = h; }
  }
  return best > 0 ? { from: at, to: at + width, ms: best } : null;
}

export { DAY };
