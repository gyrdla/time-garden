// Schema versions and conversions. Pure — no storage access here.
//
// v1  the original localStorage blob  { activities, pages, theme, sessions?, currentSession? }
// v2  IndexedDB records               { sessions, events, pages, settings }
// v3  + planner                       { projects, tasks, routines, routineLog }
// v4  + user images                   { assets }

import { fromIso } from './time.js';
import { CATEGORIES, uid } from './tracker.js';

export const SCHEMA = 4;

function hm(iso, clock) {
  const [h, m] = String(clock || '00:00').split(':').map(Number);
  return fromIso(iso) + (h * 60 + m) * 60_000;
}

function legacyContexts(contexts, sessionId, fallbackEnd) {
  return (contexts || []).filter((c) => c && c.label && Number.isFinite(c.startedAt)).map((c) => ({
    id: uid(), sessionId, label: String(c.label), attention: 'active',
    startedAt: c.startedAt, endedAt: c.endedAt ?? fallbackEnd, note: '',
    source: 'timer', createdAt: c.startedAt, updatedAt: c.startedAt,
  }));
}

/** Convert a v1 blob into v2 records. Never mutates its input. */
export function migrateV1(old) {
  const out = { schema: SCHEMA, sessions: [], events: [], pages: [], projects: [], tasks: [], routines: [], routineLog: [], assets: [], settings: { theme: 'pearl' } };
  if (!old || typeof old !== 'object') return out;
  const cat = (c) => (CATEGORIES.includes(c) ? c : 'Diğer');
  const live = new Map((old.sessions || []).filter((s) => s && s.id).map((s) => [s.id, s]));

  for (const a of old.activities || []) {
    if (!a || !a.date) continue;
    const s = live.get(a.id);
    if (s && Number.isFinite(s.startedAt) && Number.isFinite(s.endedAt) && s.endedAt > s.startedAt) {
      // Recorded by the old live timer: exact start/end, but only the total paused time was kept.
      const pauses = [];
      const paused = Math.max(0, s.pausedTotal || 0);
      const tail = s.pausedAt && s.pausedAt < s.endedAt ? s.pausedAt : s.endedAt;
      if (paused > 0) pauses.push({ start: Math.max(s.startedAt, tail - paused), end: tail });
      if (tail < s.endedAt) pauses.push({ start: tail, end: s.endedAt });
      out.sessions.push({
        id: a.id, name: a.name || 'Adsız etkinlik', category: cat(a.category),
        startedAt: s.startedAt, endedAt: s.endedAt, pauses, pausesEstimated: paused > 0,
        note: '', source: 'timer', createdAt: s.startedAt, updatedAt: s.endedAt,
      });
      out.events.push(...legacyContexts(s.contexts, a.id, s.endedAt));
    } else {
      const startedAt = hm(a.date, a.start);
      let endedAt = hm(a.date, a.end);
      if (Number.isFinite(a.durationMinutes) && a.durationMinutes > 0) endedAt = startedAt + a.durationMinutes * 60_000;
      if (!(endedAt > startedAt)) continue;
      const id = a.id || uid();
      out.sessions.push({
        id, name: a.name || 'Adsız etkinlik', category: cat(a.category),
        startedAt, endedAt, pauses: [], note: a.memo === 'Canlı zaman oturumu' ? '' : String(a.memo || ''),
        source: 'manual', createdAt: startedAt, updatedAt: startedAt,
      });
      out.events.push(...legacyContexts(a.contexts, id, endedAt));
    }
  }

  const cur = old.currentSession;
  if (cur && Number.isFinite(cur.startedAt)) {
    const pauses = [];
    const paused = Math.max(0, cur.pausedTotal || 0);
    const anchor = cur.pausedAt || cur.startedAt + paused;
    if (paused > 0) pauses.push({ start: Math.max(cur.startedAt, anchor - paused), end: anchor });
    if (cur.pausedAt) pauses.push({ start: cur.pausedAt, end: null });
    const id = cur.id || uid();
    out.sessions.push({
      id, name: cur.name || 'Adsız etkinlik', category: cat(cur.category),
      startedAt: cur.startedAt, endedAt: null, pauses, pausesEstimated: paused > 0,
      note: '', source: 'timer', createdAt: cur.startedAt, updatedAt: cur.startedAt,
    });
    out.events.push(...legacyContexts(cur.contexts, id, null));
  }

  for (const [date, p] of Object.entries(old.pages || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && p) {
      out.pages.push({ date, note: p.note || '', items: p.items || '', draw: p.draw || '', updatedAt: Date.now() });
    }
  }
  if (typeof old.theme === 'string') out.settings.theme = old.theme;
  return out;
}

/** Validate and normalise anything a user might import (v1 or v2 backup). */
export function normalizeImport(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Dosya bir Time Garden yedeği değil.');
  if (Array.isArray(raw.activities) && !raw.schema) return migrateV1(raw);
  if (raw.app !== 'time-garden' || !Array.isArray(raw.sessions)) throw new Error('Dosya bir Time Garden yedeği değil.');
  if (raw.schema > SCHEMA) throw new Error('Bu yedek daha yeni bir sürümle alınmış.');
  const okSpan = (r) => r && typeof r.id === 'string' && Number.isFinite(r.startedAt) && (r.endedAt == null || r.endedAt > r.startedAt);
  return {
    schema: SCHEMA,
    sessions: raw.sessions.filter((s) => okSpan(s) && typeof s.name === 'string').map((s) => ({ ...s, pauses: Array.isArray(s.pauses) ? s.pauses : [] })),
    events: (raw.events || []).filter((e) => okSpan(e) && typeof e.label === 'string'),
    pages: (raw.pages || []).filter((p) => p && /^\d{4}-\d{2}-\d{2}$/.test(p.date)),
    projects: (raw.projects || []).filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string'),
    tasks: (raw.tasks || []).filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string' && typeof t.projectId === 'string'),
    routines: (raw.routines || []).filter((r) => r && typeof r.id === 'string' && typeof r.title === 'string' && Array.isArray(r.days)),
    assets: (raw.assets || []).filter((a) => a && typeof a.id === 'string' && ['sticker', 'washi', 'cover'].includes(a.kind) && /^data:image\//.test(a.dataUrl || '')),
    routineLog: (raw.routineLog || []).filter((l) => l && typeof l.id === 'string' && typeof l.routineId === 'string'),
    settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : {},
  };
}
