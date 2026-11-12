// Time-tracking state transitions. Pure functions over plain records:
// they return new/updated records and never touch storage or the DOM.
//
// Session (primary activity)
//   { id, name, category, startedAt, endedAt|null, pauses:[{start,end|null}], note,
//     source:'timer'|'manual', createdAt, updatedAt }
// Event (secondary / concurrent activity; may overlap sessions and each other)
//   { id, sessionId|null, label, attention:'active'|'background', startedAt, endedAt|null,
//     note, source:'timer'|'manual', createdAt, updatedAt }
//
// source:'timer'  → both ends were stamped by the clock while it happened (measured)
// source:'manual' → the user typed or edited the times (entered by hand)

export const CATEGORIES = ['Çalışma', 'Öğrenme', 'Kişisel', 'Sosyal', 'Dinlenme', 'Uyku', 'Ev işleri', 'Diğer'];

export class ValidationError extends Error {}

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function cleanName(v, what) {
  const s = String(v ?? '').trim();
  if (!s) throw new ValidationError(`${what} boş olamaz.`);
  return s.slice(0, 120);
}

function cleanCategory(c) {
  return CATEGORIES.includes(c) ? c : 'Diğer';
}

export function startSession({ name, category, note = '' }, now = Date.now()) {
  return {
    id: uid(), name: cleanName(name, 'Etkinlik adı'), category: cleanCategory(category),
    startedAt: now, endedAt: null, pauses: [], note: String(note || ''),
    source: 'timer', createdAt: now, updatedAt: now,
  };
}

export function isPaused(session) {
  const last = session.pauses[session.pauses.length - 1];
  return !!last && last.end == null;
}

export function pauseSession(session, now = Date.now()) {
  if (session.endedAt != null || isPaused(session)) return session;
  return { ...session, pauses: [...session.pauses, { start: now, end: null }], updatedAt: now };
}

export function resumeSession(session, now = Date.now()) {
  if (!isPaused(session)) return session;
  const pauses = session.pauses.map((p, i) => (i === session.pauses.length - 1 ? { ...p, end: now } : p));
  return { ...session, pauses, updatedAt: now };
}

/** Finish a session. Open pause is closed at `now`; returns the session plus closed events. */
export function finishSession(session, openEvents = [], now = Date.now()) {
  const pauses = session.pauses.map((p) => (p.end == null ? { ...p, end: now } : p));
  return {
    session: { ...session, pauses, endedAt: now, updatedAt: now },
    events: openEvents.filter((e) => e.endedAt == null).map((e) => ({ ...e, endedAt: now, updatedAt: now })),
  };
}

export function startEvent({ label, attention = 'active', sessionId = null, note = '' }, now = Date.now()) {
  return {
    id: uid(), sessionId, label: cleanName(label, 'Paralel kayıt adı'),
    attention: attention === 'background' ? 'background' : 'active',
    startedAt: now, endedAt: null, note: String(note || ''),
    source: 'timer', createdAt: now, updatedAt: now,
  };
}

export function endEvent(ev, now = Date.now()) {
  return ev.endedAt != null ? ev : { ...ev, endedAt: now, updatedAt: now };
}

function checkSpan(startedAt, endedAt, now) {
  if (!Number.isFinite(startedAt)) throw new ValidationError('Başlangıç saati geçersiz.');
  if (startedAt > now) throw new ValidationError('Başlangıç gelecekte olamaz.');
  if (endedAt != null) {
    if (!Number.isFinite(endedAt)) throw new ValidationError('Bitiş saati geçersiz.');
    if (endedAt <= startedAt) throw new ValidationError('Bitiş, başlangıçtan sonra olmalı.');
    if (endedAt > now) throw new ValidationError('Bitiş gelecekte olamaz.');
  }
}

/** A finished primary activity entered after the fact. */
export function manualSession({ name, category, startedAt, endedAt, note = '' }, now = Date.now()) {
  if (endedAt == null) throw new ValidationError('Bitiş saati gerekli.');
  checkSpan(startedAt, endedAt, now);
  return {
    id: uid(), name: cleanName(name, 'Etkinlik adı'), category: cleanCategory(category),
    startedAt, endedAt, pauses: [], note: String(note || ''),
    source: 'manual', createdAt: now, updatedAt: now,
  };
}

export function manualEvent({ label, attention = 'active', startedAt, endedAt, sessionId = null, note = '' }, now = Date.now()) {
  if (endedAt == null) throw new ValidationError('Bitiş saati gerekli.');
  checkSpan(startedAt, endedAt, now);
  return {
    id: uid(), sessionId, label: cleanName(label, 'Paralel kayıt adı'),
    attention: attention === 'background' ? 'background' : 'active',
    startedAt, endedAt, note: String(note || ''),
    source: 'manual', createdAt: now, updatedAt: now,
  };
}

/**
 * Edit a session. Changing a timestamp marks the record as manually entered and
 * trims/drops pauses that no longer fit inside the new span.
 */
export function editSession(session, patch, now = Date.now()) {
  const next = { ...session };
  if ('name' in patch) next.name = cleanName(patch.name, 'Etkinlik adı');
  if ('category' in patch) next.category = cleanCategory(patch.category);
  if ('note' in patch) next.note = String(patch.note || '');
  const timeChanged = ('startedAt' in patch && patch.startedAt !== session.startedAt)
    || ('endedAt' in patch && patch.endedAt !== session.endedAt);
  if (timeChanged) {
    if ('startedAt' in patch) next.startedAt = patch.startedAt;
    if ('endedAt' in patch) next.endedAt = patch.endedAt;
    checkSpan(next.startedAt, next.endedAt, now);
    const hi = next.endedAt ?? Infinity;
    next.pauses = session.pauses
      .map((p) => ({ start: Math.max(p.start, next.startedAt), end: p.end == null ? null : Math.min(p.end, hi) }))
      .filter((p) => p.start < hi && (p.end == null || p.end > p.start));
    next.source = 'manual';
  }
  next.updatedAt = now;
  return next;
}

export function editEvent(ev, patch, now = Date.now()) {
  const next = { ...ev };
  if ('label' in patch) next.label = cleanName(patch.label, 'Paralel kayıt adı');
  if ('attention' in patch) next.attention = patch.attention === 'background' ? 'background' : 'active';
  if ('note' in patch) next.note = String(patch.note || '');
  const timeChanged = ('startedAt' in patch && patch.startedAt !== ev.startedAt)
    || ('endedAt' in patch && patch.endedAt !== ev.endedAt);
  if (timeChanged) {
    if ('startedAt' in patch) next.startedAt = patch.startedAt;
    if ('endedAt' in patch) next.endedAt = patch.endedAt;
    checkSpan(next.startedAt, next.endedAt, now);
    next.source = 'manual';
  }
  next.updatedAt = now;
  return next;
}

/** Pausing a parallel record ends this stretch and remembers it can be picked up again. */
export function pauseEvent(ev, now = Date.now()) {
  return ev.endedAt != null ? ev : { ...ev, endedAt: now, paused: true, updatedAt: now };
}

/** Picking it up again starts a new stretch with the same name, attention, task and session. */
export function resumeEvent(ev, sessionId, now = Date.now()) {
  const next = startEvent({ label: ev.label, attention: ev.attention, sessionId }, now);
  if (ev.taskId) next.taskId = ev.taskId;
  return { old: { ...ev, paused: false, updatedAt: now }, next };
}
