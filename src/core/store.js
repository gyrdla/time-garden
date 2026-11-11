// Application state: an in-memory copy of the local database plus the only code
// that writes to it. UI modules subscribe and re-render; they never touch db.js.

import * as db from './db.js';
import * as tracker from './tracker.js';
import { migrateV1, normalizeImport, SCHEMA } from './migrate.js';

const LEGACY_KEY = 'tg-data';
const log = (...a) => { if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') console.debug('[tg]', ...a); };

export const state = {
  ready: false,
  persistent: true, // false when IndexedDB is unavailable and data lives only in memory
  sessions: [],
  events: [],
  pages: new Map(),
  settings: { theme: 'pearl' },
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } }

let onError = (e) => console.error(e);
export function setErrorHandler(fn) { onError = fn; }

function write(promise) {
  if (!state.persistent) return Promise.resolve();
  return promise.catch((e) => { onError(e); throw e; });
}

export async function init() {
  try {
    const [sessions, events, pages, kv] = await Promise.all([
      db.getAll('sessions'), db.getAll('events'), db.getAll('pages'), db.getAll('kv'),
    ]);
    const meta = Object.fromEntries(kv.map((r) => [r.key, r.value]));
    if (!meta.schema) {
      // First run on this database: bring over anything the old localStorage build saved.
      let legacy = null;
      try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch { legacy = null; }
      const m = migrateV1(legacy);
      await db.replaceAll(m);
      await db.put('kv', { key: 'schema', value: SCHEMA });
      await db.put('kv', { key: 'migratedFromV1', value: legacy ? new Date().toISOString() : null });
      // The old blob is left in place on purpose, as a fallback copy.
      load(m);
      log('migrated', m.sessions.length, 'sessions');
    } else {
      load({ sessions, events, pages, settings: meta.settings || {} });
    }
  } catch (e) {
    console.error(e);
    state.persistent = false;
    let legacy = null;
    try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch { legacy = null; }
    load(migrateV1(legacy));
  }
  state.ready = true;
  if (state.persistent && navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  emit('init');
}

function load(d) {
  state.sessions = [...(d.sessions || [])].sort((a, b) => a.startedAt - b.startedAt);
  state.events = [...(d.events || [])].sort((a, b) => a.startedAt - b.startedAt);
  state.pages = new Map((d.pages || []).map((p) => [p.date, p]));
  state.settings = { theme: 'pearl', ...(d.settings || {}) };
}

function upsert(list, rec) {
  const i = list.findIndex((r) => r.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
  list.sort((a, b) => a.startedAt - b.startedAt);
}

// ── queries ────────────────────────────────────────────────────────────────
export const activeSession = () => state.sessions.find((s) => s.endedAt == null) || null;
export const openEvents = () => state.events.filter((e) => e.endedAt == null);
export const eventsOf = (sessionId) => state.events.filter((e) => e.sessionId === sessionId);
export const getSession = (id) => state.sessions.find((s) => s.id === id) || null;
export const getEvent = (id) => state.events.find((e) => e.id === id) || null;

/** Names used before, most recent first — for quick entry. */
export function recentNames(kind, limit = 6) {
  const src = kind === 'event' ? state.events.map((e) => e.label) : state.sessions.map((s) => s.name);
  return [...new Set(src.reverse())].slice(0, limit);
}

// ── tracking commands ──────────────────────────────────────────────────────
export function start(input) {
  if (activeSession()) throw new tracker.ValidationError('Zaten süren bir ana etkinlik var.');
  const s = tracker.startSession(input);
  upsert(state.sessions, s);
  emit('sessions');
  return write(db.put('sessions', s));
}

export function togglePause() {
  const cur = activeSession();
  if (!cur) return Promise.resolve();
  const s = tracker.isPaused(cur) ? tracker.resumeSession(cur) : tracker.pauseSession(cur);
  upsert(state.sessions, s);
  emit('sessions');
  return write(db.put('sessions', s));
}

export function finish() {
  const cur = activeSession();
  if (!cur) return Promise.resolve(null);
  const r = tracker.finishSession(cur, openEvents());
  upsert(state.sessions, r.session);
  r.events.forEach((e) => upsert(state.events, e));
  emit('sessions');
  return write(db.batch([{ store: 'sessions', put: r.session }, ...r.events.map((e) => ({ store: 'events', put: e }))])).then(() => r.session);
}

export function startSecondary(input) {
  const e = tracker.startEvent({ ...input, sessionId: activeSession()?.id ?? null });
  upsert(state.events, e);
  emit('events');
  return write(db.put('events', e));
}

export function endSecondary(id) {
  const cur = getEvent(id);
  if (!cur) return Promise.resolve();
  const e = tracker.endEvent(cur);
  upsert(state.events, e);
  emit('events');
  return write(db.put('events', e));
}

export function addManualSession(input) {
  const s = tracker.manualSession(input);
  upsert(state.sessions, s);
  emit('sessions');
  return write(db.put('sessions', s));
}

export function addManualEvent(input) {
  const host = state.sessions.find((s) => s.startedAt <= input.startedAt && (s.endedAt ?? Infinity) >= input.endedAt);
  const e = tracker.manualEvent({ ...input, sessionId: host?.id ?? null });
  upsert(state.events, e);
  emit('events');
  return write(db.put('events', e));
}

export function updateSession(id, patch) {
  const cur = getSession(id);
  if (!cur) return Promise.resolve();
  const s = tracker.editSession(cur, patch);
  upsert(state.sessions, s);
  emit('sessions');
  return write(db.put('sessions', s));
}

export function updateEvent(id, patch) {
  const cur = getEvent(id);
  if (!cur) return Promise.resolve();
  const e = tracker.editEvent(cur, patch);
  upsert(state.events, e);
  emit('events');
  return write(db.put('events', e));
}

/** Deleting a session keeps its secondary events (they are detached, not lost). */
export function removeSession(id) {
  const detached = eventsOf(id).map((e) => ({ ...e, sessionId: null, updatedAt: Date.now() }));
  state.sessions = state.sessions.filter((s) => s.id !== id);
  detached.forEach((e) => upsert(state.events, e));
  emit('sessions');
  return write(db.batch([{ store: 'sessions', del: id }, ...detached.map((e) => ({ store: 'events', put: e }))]));
}

export function removeEvent(id) {
  state.events = state.events.filter((e) => e.id !== id);
  emit('events');
  return write(db.del('events', id));
}

// ── journal pages (legacy HTML model until the object canvas lands) ────────
export const getPage = (date) => state.pages.get(date) || null;

export function savePage(date, page) {
  const rec = { date, note: page.note || '', items: page.items || '', draw: page.draw || '', updatedAt: Date.now() };
  const empty = !rec.note && !rec.items && !rec.draw;
  if (empty) {
    if (!state.pages.has(date)) return Promise.resolve();
    state.pages.delete(date);
    emit('pages');
    return write(db.del('pages', date));
  }
  state.pages.set(date, rec);
  emit('pages');
  return write(db.put('pages', rec));
}

// ── settings ───────────────────────────────────────────────────────────────
export function setSetting(key, value) {
  state.settings = { ...state.settings, [key]: value };
  emit('settings');
  return write(db.put('kv', { key: 'settings', value: state.settings }));
}

// ── backup / restore ───────────────────────────────────────────────────────
export function exportData() {
  return {
    app: 'time-garden', schema: SCHEMA, exportedAt: new Date().toISOString(),
    sessions: state.sessions, events: state.events, pages: [...state.pages.values()], settings: state.settings,
  };
}

/** Replace everything with a backup. The previous data is kept as one undo copy. */
export async function importData(raw) {
  const next = normalizeImport(raw);
  const previous = exportData();
  if (state.persistent) {
    await db.put('kv', { key: 'beforeLastImport', value: previous });
    await db.replaceAll(next);
  }
  load(next);
  emit('init');
  return { sessions: next.sessions.length, events: next.events.length, pages: next.pages.length };
}
