// Combos: routine chains that help build habits — chunk habits, life items and the project
// steps they lead into (shower + hair → makeup → shoot → edit), done in order.
//
// Combo { id, title, repeat, steps:[{ kind:'task'|'habit', ref }], runStart:'YYYY-MM-DD',
//         runs:[{ at, n }], createdAt, updatedAt }
//
// The counter grows with every step done in order. With a time limit the whole combo must be
// done within it, counted from the first step; otherwise it breaks when the next step's planned
// day has passed. A step done too late restarts the count from that step.

import { uid, ValidationError } from './tracker.js';
import { isoDate, fromIso, DAY } from './time.js';
import { routineTimes } from './planner.js';

const norm = (s) => String(s || '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');

export function newCombo({ title, repeat = false, steps = [], windowMin = null }, now = Date.now()) {
  const st = (steps || []).filter((x) => x && ['task', 'habit'].includes(x.kind) && typeof x.ref === 'string');
  if (st.length < 2) throw new ValidationError('Bir combo en az iki adımdan oluşur.');
  const t = String(title || '').trim().slice(0, 80);
  return { id: uid(), title: t || 'Combo', repeat: !!repeat, steps: st, windowMin: windowOf(windowMin), runStart: isoDate(now), runs: [], createdAt: now, updatedAt: now };
}

/** A time limit for the whole combo, in minutes (null: no limit, the planned days decide). */
export function windowOf(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 7 * 24 * 60) : null;
}

/** The first day on or after `fromIso` on which a habit is planned. */
function habitDay(r, from) {
  for (let i = 0; i < 14; i++) {
    const ts = fromIso(from) + i * DAY + DAY / 2, d = new Date(ts);
    if (r.days.includes((d.getDay() + 6) % 7)) return isoDate(ts);
  }
  return null;
}

/** Done time and due day of each step in the current run. */
function stepInfo(combo, { tasks, routines, routineLog }) {
  const taskBy = new Map(tasks.map((t) => [t.id, t])), habitBy = new Map(routines.map((r) => [r.id, r]));
  let prevAt = fromIso(combo.runStart), prevDay = combo.runStart;
  return combo.steps.map((s) => {
    if (s.kind === 'task') {
      const t = taskBy.get(s.ref);
      if (!t) return { step: s, missing: true };
      // A day planned before this run began is stale (the run was restarted after it): no due day.
      const day = t.scheduledAt != null ? isoDate(t.scheduledAt) : (t.plannedDay || null);
      const due = day && day >= combo.runStart ? day : null;
      const doneAt = t.done ? (t.doneAt || prevAt) : null;
      if (doneAt) { prevAt = Math.max(prevAt, doneAt); prevDay = isoDate(prevAt); }
      return { step: s, title: t.title, projectId: t.projectId, due, doneAt };
    }
    const r = habitBy.get(s.ref);
    if (!r) return { step: s, missing: true };
    const need = routineTimes(r).length;
    // The day counts once every time of the habit is ticked, on or after the previous step.
    const byDay = new Map();
    for (const l of routineLog) if (l.routineId === r.id && l.date >= prevDay) byDay.set(l.date, [...(byDay.get(l.date) || []), l]);
    const day = [...byDay.keys()].sort().find((d) => new Set(byDay.get(d).map((l) => l.slot || 0)).size >= need);
    const doneAt = day ? Math.max(...byDay.get(day).map((l) => l.doneAt || fromIso(day))) : null;
    const due = r.status === 'queued' ? null : habitDay(r, prevDay);
    if (doneAt) { prevAt = Math.max(prevAt, doneAt); prevDay = isoDate(prevAt); }
    return { step: s, title: r.title, habit: true, queued: r.status === 'queued', due, doneAt };
  });
}

/**
 * Where a combo stands now.
 * count   steps done in a row without a break (the combo multiplier)
 * status  'running' | 'broken' | 'done'
 * next    index of the step to do next (or -1 when done)
 */
export function comboProgress(combo, ctx, now = Date.now()) {
  const today = isoDate(now), info = stepInfo(combo, ctx), win = combo.windowMin ? combo.windowMin * 60_000 : null;
  let count = 0, best = 0, status = 'running', next = -1, since = null;
  for (let i = 0; i < info.length; i++) {
    const x = info[i];
    if (x.doneAt) {
      // With a time limit the clock starts at the first step; a step done too late starts it again.
      const late = win ? (since != null && x.doneAt - since > win) : (x.due && isoDate(x.doneAt) > x.due);
      if (late || since == null) since = x.doneAt;
      count = late ? 1 : count + 1;
      best = Math.max(best, count);
      continue;
    }
    next = i;
    if (win ? (since != null && now - since > win) : (x.due && x.due < today)) { status = 'broken'; count = 0; }
    break;
  }
  if (next === -1) status = 'done';
  const endsAt = win && since != null && status === 'running' ? since + win : null;
  return { info, count, best, status, next, total: info.length, endsAt };
}

/** Food the deer got from finished combo runs: one per step of each finished run. */
export const comboBonus = (combos) => combos.reduce((n, c) => n + (c.runs || []).reduce((m, r) => m + (r.n || 0), 0), 0);

// ── suggestions ────────────────────────────────────────────────────────────

/**
 * Activities the user tracked one after another (within `gapH` hours) on at least `minDays`
 * different days. Returns chains of activity names with the number of days they were seen.
 */
export function sequencesFromRecords(sessions, { minDays = 2, gapH = 14 } = {}) {
  const runs = sessions.filter((s) => s.endedAt != null).sort((a, b) => a.startedAt - b.startedAt);
  const pairs = new Map();
  for (let i = 1; i < runs.length; i++) {
    const a = runs[i - 1], b = runs[i];
    if (norm(a.name) === norm(b.name) || b.startedAt - a.endedAt > gapH * 3_600_000) continue;
    const k = `${norm(a.name)}→${norm(b.name)}`;
    const e = pairs.get(k) || { a: a.name, b: b.name, days: new Set() };
    e.days.add(isoDate(a.startedAt));
    pairs.set(k, e);
  }
  const good = [...pairs.values()].filter((p) => p.days.size >= minDays);
  const next = new Map(good.map((p) => [norm(p.a), p]));
  const starts = good.filter((p) => !good.some((q) => norm(q.b) === norm(p.a)));
  const out = [];
  for (const s of starts) {
    const names = [s.a], seen = new Set([norm(s.a)]);
    let days = s.days.size;
    for (let p = s; p && !seen.has(norm(p.b)); p = next.get(norm(p.b))) { names.push(p.b); seen.add(norm(p.b)); days = Math.min(days, p.days.size); }
    out.push({ names, days });
  }
  return out.sort((a, b) => b.names.length - a.names.length || b.days - a.days);
}

/** Ready-made combo shapes, offered as starting points and labelled as such. */
export const COMBO_TEMPLATES = [
  { title: 'Hazırlık combosu', repeat: true, steps: ['Akşam duş + saç', 'Sabah makyaj', 'Çekim', 'Edit', 'Paylaş ve klasörle'] },
];
