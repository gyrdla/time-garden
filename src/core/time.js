// Pure interval maths for Time Garden. No DOM, no storage — safe to unit test.
// An interval is [startMs, endMs) with end > start.

export const MIN = 60_000;
export const DAY = 86_400_000;

/** Local-midnight range for the day containing `ts`. */
export function dayRange(ts) {
  const d = new Date(ts);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return [start, end];
}

export function isoDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local noon-safe parse of YYYY-MM-DD → midnight timestamp. */
export function fromIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function clip(iv, range) {
  const s = Math.max(iv[0], range[0]);
  const e = Math.min(iv[1], range[1]);
  return e > s ? [s, e] : null;
}

export function clipAll(ivs, range) {
  const out = [];
  for (const iv of ivs) {
    const c = clip(iv, range);
    if (c) out.push(c);
  }
  return out;
}

/** Merge overlapping/touching intervals. Returns a new sorted list. */
export function union(ivs) {
  const sorted = ivs.filter((iv) => iv[1] > iv[0]).map((iv) => [iv[0], iv[1]]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push(iv);
  }
  return out;
}

export function total(ivs) {
  return ivs.reduce((n, iv) => n + (iv[1] - iv[0]), 0);
}

/** a ∩ b, both treated as sets (unioned first). */
export function intersect(a, b) {
  const A = union(a), B = union(b), out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    const s = Math.max(A[i][0], B[j][0]);
    const e = Math.min(A[i][1], B[j][1]);
    if (e > s) out.push([s, e]);
    if (A[i][1] < B[j][1]) i++; else j++;
  }
  return out;
}

/** a − b, both treated as sets. */
export function subtract(a, b) {
  const A = union(a), B = union(b), out = [];
  for (const [s0, e] of A) {
    let s = s0;
    for (const [bs, be] of B) {
      if (be <= s) continue;
      if (bs >= e) break;
      if (bs > s) out.push([s, bs]);
      s = Math.max(s, be);
      if (s >= e) break;
    }
    if (s < e) out.push([s, e]);
  }
  return out;
}

/** Intervals in which a primary session was actually running (pauses removed). */
export function sessionActive(session, now = Date.now()) {
  const end = session.endedAt ?? now;
  if (!(end > session.startedAt)) return [];
  const pauses = (session.pauses || []).map((p) => [p.start, p.end ?? end]);
  return subtract([[session.startedAt, end]], pauses);
}

/** Paused intervals of a session, clipped to the session span. */
export function sessionPaused(session, now = Date.now()) {
  const end = session.endedAt ?? now;
  if (!(end > session.startedAt)) return [];
  return clipAll(union((session.pauses || []).map((p) => [p.start, p.end ?? end])), [session.startedAt, end]);
}

export function eventInterval(ev, now = Date.now()) {
  const end = ev.endedAt ?? now;
  return end > ev.startedAt ? [ev.startedAt, end] : null;
}

/** Elapsed active milliseconds of one session. */
export function sessionElapsed(session, now = Date.now()) {
  return total(sessionActive(session, now));
}

/**
 * Summarise a time range without double counting.
 *
 * primaryMs      time a primary activity was running (set union)
 * secondaryMs    plain sum of every secondary event's own length (may exceed wall time)
 * concurrentMs   wall time where a secondary event overlapped a running primary
 * secondaryOnlyMs wall time covered only by secondary events
 * uniqueMs       wall time covered by anything (primary ∪ secondary) — the "elapsed" figure
 * focusMs        primary time with no attention-taking secondary event on top
 * pausedMs       time primary sessions spent paused
 */
export function summarize(sessions, events, range, now = Date.now()) {
  const primaryIvs = [], pausedIvs = [], evIvs = [], activeEvIvs = [];
  const byCategory = {}, byLabel = {}, bySource = { timer: 0, manual: 0 };
  let secondaryMs = 0;

  for (const s of sessions) {
    const act = clipAll(sessionActive(s, now), range);
    if (!act.length) {
      pausedIvs.push(...clipAll(sessionPaused(s, now), range));
      continue;
    }
    primaryIvs.push(...act);
    pausedIvs.push(...clipAll(sessionPaused(s, now), range));
    const ms = total(act);
    const cat = s.category || 'Diğer';
    byCategory[cat] = (byCategory[cat] || 0) + ms;
    bySource[s.source === 'timer' ? 'timer' : 'manual'] += ms;
  }
  for (const e of events) {
    const iv = eventInterval(e, now);
    const c = iv && clip(iv, range);
    if (!c) continue;
    evIvs.push(c);
    if (e.attention !== 'background') activeEvIvs.push(c);
    const ms = c[1] - c[0];
    secondaryMs += ms;
    const row = byLabel[e.label] || (byLabel[e.label] = { ms: 0, overlapMs: 0, background: e.attention === 'background' });
    row.ms += ms;
  }
  const P = union(primaryIvs), E = union(evIvs);
  for (const e of events) {
    const iv = eventInterval(e, now);
    const c = iv && clip(iv, range);
    if (c) byLabel[e.label].overlapMs += total(intersect([c], P));
  }
  const primaryMs = total(P);
  const focusMs = total(subtract(P, activeEvIvs));
  return {
    primaryMs,
    secondaryMs,
    concurrentMs: total(intersect(P, E)),
    secondaryOnlyMs: total(subtract(E, P)),
    uniqueMs: total(union([...P, ...E])),
    focusMs,
    dividedMs: primaryMs - focusMs,
    pausedMs: total(subtract(pausedIvs, P)),
    byCategory,
    byLabel,
    bySource,
    primaryIntervals: P,
  };
}

/** Wall-clock span of recorded data inside `range` and how much of it is unrecorded. */
export function coverage(sessions, events, range, now = Date.now()) {
  const all = [];
  for (const s of sessions) all.push(...clipAll(sessionActive(s, now), range), ...clipAll(sessionPaused(s, now), range));
  for (const e of events) { const iv = eventInterval(e, now); const c = iv && clip(iv, range); if (c) all.push(c); }
  const u = union(all);
  if (!u.length) return { spanMs: 0, gapMs: 0, first: null, last: null };
  const first = u[0][0], last = u[u.length - 1][1];
  return { spanMs: last - first, gapMs: last - first - total(u), first, last };
}

export function fmtDur(ms) {
  const m = Math.round(ms / MIN);
  const h = Math.floor(m / 60);
  return h ? `${h} sa ${m % 60} dk` : `${m} dk`;
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
