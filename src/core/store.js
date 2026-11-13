// Application state: an in-memory copy of the local database plus the only code
// that writes to it. UI modules subscribe and re-render; they never touch db.js.

import * as db from './db.js';
import * as tracker from './tracker.js';
import { migrateV1, normalizeImport, SCHEMA } from './migrate.js';
import * as planner from './planner.js';
import * as cardsLib from './cards.js';
import * as combosLib from './combos.js';
import { balancedWeeks } from './balance.js';
import { isoDate } from './time.js';

const LEGACY_KEY = 'tg-data';
const log = (...a) => { if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') console.debug('[tg]', ...a); };

export const state = {
  ready: false,
  persistent: true, // false when IndexedDB is unavailable and data lives only in memory
  sessions: [],
  events: [],
  pages: new Map(),
  projects: [],
  tasks: [],
  routines: [],
  routineLog: [],
  assets: [],
  cards: [],
  combos: [],
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
    const [sessions, events, pages, projects, tasks, routines, routineLog, assets, cards, combos, kv] = await Promise.all([
      ...db.DATA_STORES.map((s) => db.getAll(s)), db.getAll('kv'),
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
      load({ sessions, events, pages, projects, tasks, routines, routineLog, assets, cards, combos, settings: meta.settings || {} });
      if (meta.schema < SCHEMA) await db.put('kv', { key: 'schema', value: SCHEMA });
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
  state.projects = [...(d.projects || [])];
  state.tasks = [...(d.tasks || [])];
  state.routines = [...(d.routines || [])];
  state.routineLog = [...(d.routineLog || [])];
  state.cards = [...(d.cards || [])].map(cardsLib.upgradeCard).sort((a, b) => b.createdAt - a.createdAt);
  state.combos = [...(d.combos || [])].sort((a, b) => a.createdAt - b.createdAt);
  state.assets = [...(d.assets || [])].sort((a, b) => a.createdAt - b.createdAt);
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
/** Paused parallel records that can still be picked up: those of the running session, or from today if none runs. */
export function pausedEvents(now = Date.now()) {
  const cur = state.sessions.find((s) => s.endedAt == null);
  const dayStart = new Date(new Date(now).toDateString()).getTime();
  return state.events.filter((e) => e.paused && (cur ? e.sessionId === cur.id : e.endedAt >= dayStart));
}
/** Time already spent on a parallel record's earlier stretches in the same session (or today). */
export function stretchesMs(ev, now = Date.now()) {
  const dayStart = new Date(new Date(now).toDateString()).getTime();
  return state.events.filter((e) => e.id !== ev.id && e.endedAt != null && e.label === ev.label && (ev.sessionId ? e.sessionId === ev.sessionId : e.endedAt >= dayStart))
    .reduce((n, e) => n + (e.endedAt - e.startedAt), 0);
}
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
  if (input.taskId) s.taskId = input.taskId;
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
  // Paused parallel records of this session are finished with it.
  for (const e of pausedEvents()) r.events.push({ ...e, paused: false, updatedAt: Date.now() });
  upsert(state.sessions, r.session);
  r.events.forEach((e) => upsert(state.events, e));
  emit('sessions');
  return write(db.batch([{ store: 'sessions', put: r.session }, ...r.events.map((e) => ({ store: 'events', put: e }))])).then(() => r.session);
}

export function startSecondary(input) {
  const e = tracker.startEvent({ ...input, sessionId: activeSession()?.id ?? null });
  if (input.taskId) e.taskId = input.taskId;
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

export function pauseSecondary(id) {
  const cur = getEvent(id);
  if (!cur) return Promise.resolve();
  const e = tracker.pauseEvent(cur);
  upsert(state.events, e); emit('events');
  return write(db.put('events', e));
}

export function resumeSecondary(id) {
  const cur = getEvent(id);
  if (!cur) return Promise.resolve();
  const { old, next } = tracker.resumeEvent(cur, activeSession()?.id ?? null);
  upsert(state.events, old); upsert(state.events, next); emit('events');
  return write(db.batch([{ store: 'events', put: old }, { store: 'events', put: next }]));
}

/** End a paused record for good. */
export function dropPaused(id) {
  const cur = getEvent(id);
  if (!cur || !cur.paused) return Promise.resolve();
  const e = { ...cur, paused: false, updatedAt: Date.now() };
  upsert(state.events, e); emit('events');
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

// ── planner ────────────────────────────────────────────────────────────────
const byId = (list, id) => list.find((r) => r.id === id) || null;
export const getProject = (id) => byId(state.projects, id);
export const getTask = (id) => byId(state.tasks, id);
export const getRoutine = (id) => byId(state.routines, id);
export const lifeProject = () => state.projects.find((p) => p.life) || null;

/** "Hayatım": the one place for everyday things that are not projects. Created on first use. */
export function ensureLife() {
  const cur = lifeProject();
  if (cur) return Promise.resolve(cur);
  const p = planner.newProject({ name: 'Hayatım', area: 'Hayatım', category: 'Kişisel', life: true });
  state.projects.push(p); emit('plan');
  return write(db.put('projects', p)).then(() => p);
}

/** Turn a one-off life task into a habit for the chain; the task itself is removed. */
export function taskToHabit(id) {
  const t = getTask(id);
  if (!t) return Promise.resolve(null);
  return addRoutine({ title: t.title, category: t.category || 'Kişisel', estimateMin: t.estimateMin || 30 }).then((r) => removeTask(id).then(() => r));
}
function putIn(list, rec) { const i = list.findIndex((r) => r.id === rec.id); if (i >= 0) list[i] = rec; else list.push(rec); }

export function addProject(input) {
  const p = planner.newProject(input);
  state.projects.push(p); emit('plan');
  return write(db.put('projects', p)).then(() => p);
}

export function updateProject(id, patch) {
  const cur = getProject(id);
  if (!cur) return Promise.resolve();
  const p = { ...planner.newProject({ ...cur, ...patch }), id, createdAt: cur.createdAt, archived: 'archived' in patch ? !!patch.archived : cur.archived };
  putIn(state.projects, p); emit('plan');
  return write(db.put('projects', p));
}

/** Deleting a project deletes its tasks. Tracked time stays in the time records. */
export function removeProject(id) {
  const gone = state.tasks.filter((t) => t.projectId === id);
  state.projects = state.projects.filter((p) => p.id !== id);
  state.tasks = state.tasks.filter((t) => t.projectId !== id);
  const cops = dropFromCombos('task', new Set(gone.map((t) => t.id)));
  emit('plan');
  return write(db.batch([{ store: 'projects', del: id }, ...gone.map((t) => ({ store: 'tasks', del: t.id })), ...cops]));
}

export function addTask(input) {
  const order = Math.max(-1, ...state.tasks.filter((t) => t.projectId === input.projectId && (t.parentId || null) === (input.parentId || null)).map((t) => t.order)) + 1;
  const t = planner.newTask({ order, ...input });
  state.tasks.push(t); emit('plan');
  return write(db.put('tasks', t)).then(() => t);
}

export function addSteps(parent, steps, opts) {
  const startOrder = Math.max(-1, ...state.tasks.filter((t) => t.projectId === parent.projectId && (t.parentId || null) === (parent.id || null)).map((t) => t.order)) + 1;
  const made = planner.buildSteps(parent, steps, { ...opts, startOrder });
  state.tasks.push(...made); emit('plan');
  return write(db.batch(made.map((t) => ({ store: 'tasks', put: t })))).then(() => made);
}

export function updateTask(id, patch) {
  const cur = getTask(id);
  if (!cur) return Promise.resolve();
  const t = planner.editTask(cur, patch, state.tasks);
  putIn(state.tasks, t); emit('plan');
  return write(db.put('tasks', t));
}

/** Save the order of a day's row: [{ id, slice }] → seq and slice of each step. */
export function setDayOrder(list) {
  const out = [];
  list.forEach((x, i) => {
    const cur = getTask(x.id);
    if (!cur || (cur.seq === i && cur.slice === x.slice)) return;
    const t = planner.editTask(cur, { seq: i, slice: x.slice }, state.tasks);
    putIn(state.tasks, t); out.push(t);
  });
  if (!out.length) return Promise.resolve();
  emit('plan');
  return write(db.batch(out.map((t) => ({ store: 'tasks', put: t }))));
}

/** Tick a step. Ticking a parent ticks every step under it. Returns what this unlocked. */
export function setTaskDone(id, done) {
  const cur = getTask(id);
  if (!cur) return Promise.resolve({ unlocked: [] });
  const now = Date.now();
  const targets = [cur, ...planner.descendants(state.tasks, id)].filter((t) => t.done !== done)
    .map((t) => ({ ...t, done, doneAt: done ? now : null, updatedAt: now }));
  targets.forEach((t) => putIn(state.tasks, t));
  emit('plan');
  const unlocked = done ? planner.unlockedBy(id, state.tasks) : [];
  return write(db.batch(targets.map((t) => ({ store: 'tasks', put: t })))).then(settleCombos).then(() => ({ unlocked }));
}

/** Deleting a task deletes its sub-steps and releases anything that was waiting on them. */
export function removeTask(id) {
  const gone = new Set([id, ...planner.descendants(state.tasks, id).map((t) => t.id)]);
  const freed = state.tasks.filter((t) => !gone.has(t.id) && gone.has(t.dependsOn)).map((t) => ({ ...t, dependsOn: null }));
  state.tasks = state.tasks.filter((t) => !gone.has(t.id));
  freed.forEach((t) => putIn(state.tasks, t));
  const cops = dropFromCombos('task', gone);
  emit('plan');
  return write(db.batch([...[...gone].map((g) => ({ store: 'tasks', del: g })), ...freed.map((t) => ({ store: 'tasks', put: t })), ...cops]));
}

/**
 * Start tracking a task. With nothing running it becomes the primary activity. While something
 * runs, `mode` says what to do: 'main' (this becomes the primary, the running one carries on
 * alongside), 'parallel' (this runs alongside) or 'replace' (finish the running one first).
 */
export async function startTask(id, mode = null) {
  const t = getTask(id);
  if (!t) return;
  const p = getProject(t.projectId);
  const input = { name: t.title, category: t.category || p?.category || 'Diğer', taskId: id };
  if (!activeSession()) return start(input);
  if (mode === 'parallel') return startSecondary({ label: t.title, taskId: id });
  if (mode === 'replace') { await finish(); return start(input); }
  if (mode === 'main') return swapToMain(input);
  throw new tracker.ValidationError('NEEDS_MODE');
}

/** The running primary steps aside: it continues as a parallel record and `input` becomes the primary. */
export async function swapToMain(input, now = Date.now()) {
  const cur = activeSession();
  if (!cur) return start(input);
  const carry = tracker.startEvent({ label: cur.name, attention: 'active' }, now);
  if (cur.taskId) carry.taskId = cur.taskId;
  const open = openEvents();
  const fin = tracker.finishSession(cur, [], now);
  const next = tracker.startSession(input, now);
  if (input.taskId) next.taskId = input.taskId;
  carry.sessionId = next.id;
  const moved = open.map((e) => ({ ...e, sessionId: next.id, updatedAt: now }));
  upsert(state.sessions, fin.session); upsert(state.sessions, next);
  [carry, ...moved].forEach((e) => upsert(state.events, e));
  emit('sessions');
  return write(db.batch([{ store: 'sessions', put: fin.session }, { store: 'sessions', put: next }, ...[carry, ...moved].map((e) => ({ store: 'events', put: e }))]));
}

/** A parallel record that was really the main work becomes a primary activity with the same times. */
export function eventToSession(id, category = 'Çalışma') {
  const e = getEvent(id);
  if (!e) return Promise.resolve(null);
  const t = e.taskId && getTask(e.taskId), p = t && getProject(t.projectId);
  const now = Date.now();
  const s = { id: tracker.uid(), name: e.label, category: t?.category || p?.category || category, startedAt: e.startedAt, endedAt: e.endedAt ?? now,
    pauses: [], note: e.note || '', source: e.source, createdAt: e.createdAt, updatedAt: now };
  if (e.taskId) s.taskId = e.taskId;
  state.events = state.events.filter((x) => x.id !== id);
  upsert(state.sessions, s); emit('sessions');
  return write(db.batch([{ store: 'events', del: id }, { store: 'sessions', put: s }])).then(() => s);
}

/** A new habit starts right away only if nothing is being built; otherwise it waits in the queue. */
export function addRoutine(input) {
  const busy = state.routines.some((r) => r.status === 'active');
  const r = planner.newRoutine({ ...input, status: busy ? 'queued' : 'active' });
  state.routines.push(r); emit('plan');
  return write(db.put('routines', r)).then(() => r);
}

export function updateRoutine(id, patch) {
  const cur = getRoutine(id);
  if (!cur) return Promise.resolve();
  const r = { ...planner.newRoutine({ ...cur, status: cur.status || 'acquired', ...patch }), id, createdAt: cur.createdAt,
    startedAt: cur.startedAt ?? null, acquiredAt: cur.acquiredAt ?? null, active: 'active' in patch ? !!patch.active : cur.active };
  putIn(state.routines, r); emit('plan');
  return write(db.put('routines', r));
}

/** Declare the habit being built as established; the next one in the queue becomes active. */
export function acquireHabit(id) {
  const changed = planner.acquireHabit(state.routines, id);
  changed.forEach((r) => putIn(state.routines, r));
  emit('plan');
  return write(db.batch(changed.map((r) => ({ store: 'routines', put: r })))).then(() => changed);
}

export function removeRoutine(id) {
  const cur = getRoutine(id);
  const logs = state.routineLog.filter((l) => l.routineId === id);
  state.routines = state.routines.filter((r) => r.id !== id);
  state.routineLog = state.routineLog.filter((l) => l.routineId !== id);
  const ops = [{ store: 'routines', del: id }, ...logs.map((l) => ({ store: 'routineLog', del: l.id })), ...dropFromCombos('habit', new Set([id]))];
  if (cur?.status === 'active') {
    // The chain never stands empty: the next habit in line takes its place.
    const next = planner.habitChain(state.routines, state.routineLog).queued[0];
    if (next) { const promoted = { ...next, status: 'active', startedAt: Date.now() }; putIn(state.routines, promoted); ops.push({ store: 'routines', put: promoted }); }
  }
  emit('plan');
  return write(db.batch(ops));
}

/** Tick one occurrence of a habit. `slot` is which time of day (0 = first). */
export function setRoutineDone(routineId, date, done, slot = 0) {
  const n = Number(slot) || 0, id = n ? `${routineId}|${date}|${n}` : `${routineId}|${date}`;
  state.routineLog = state.routineLog.filter((l) => l.id !== id);
  const rec = { id, routineId, date, slot: n, doneAt: Date.now() };
  if (done) state.routineLog.push(rec);
  emit('plan');
  return write(done ? db.put('routineLog', rec) : db.del('routineLog', id)).then(settleCombos);
}

export const BALANCE_BONUS = 5;
/** Food earned by balanced weeks (every area with a target reached it). */
export function deerBonus(now = Date.now()) {
  return balancedWeeks({ sessions: state.sessions, routines: state.routines, routineLog: state.routineLog, targets: state.settings.targets || {} }, now).length * BALANCE_BONUS
    + combosLib.comboBonus(state.combos);
}

/** Give the deer one piece of food, if there is any. Returns the state before and after. */
export function feedDeer() {
  const fed = state.settings.deer?.fed || 0, bonus = deerBonus();
  const before = planner.deer(state.tasks, state.routineLog, fed, bonus);
  if (before.food < 1) throw new tracker.ValidationError('Yem yok. Bir adım tamamlayınca yem kazanırsın.');
  return setSetting('deer', { ...(state.settings.deer || {}), fed: fed + 1 }).then(() => ({ before, after: planner.deer(state.tasks, state.routineLog, fed + 1, bonus) }));
}

export const userTemplates = () => state.settings.templates || [];
export function saveTemplate(taskId) {
  const tpl = planner.templateFromTask(getTask(taskId), state.tasks);
  return setSetting('templates', [...userTemplates().filter((t) => t.name !== tpl.name), tpl]);
}

// ── user images (stickers, washi textures, folder covers) ──────────────────
export const assetsOf = (kind) => state.assets.filter((a) => a.kind === kind);
export const getAsset = (id) => state.assets.find((a) => a.id === id) || null;

export function addAsset(kind, dataUrl) {
  if (!['sticker', 'washi', 'cover'].includes(kind) || !/^data:image\//.test(dataUrl || '')) throw new tracker.ValidationError('Görsel okunamadı.');
  const a = { id: tracker.uid(), kind, dataUrl, createdAt: Date.now() };
  state.assets.push(a); emit('assets');
  return write(db.put('assets', a)).then(() => a);
}

/** Pages that used the image keep their place but lose the picture. */
export function removeAsset(id) {
  state.assets = state.assets.filter((a) => a.id !== id);
  const cleared = state.projects.filter((p) => p.cover === `asset:${id}`).map((p) => ({ ...p, cover: null }));
  cleared.forEach((p) => { state.projects[state.projects.findIndex((x) => x.id === p.id)] = p; });
  emit('assets');
  return write(db.batch([{ store: 'assets', del: id }, ...cleared.map((p) => ({ store: 'projects', put: p }))]));
}

// ── studio cards ───────────────────────────────────────────────────────────
export const getCard = (id) => state.cards.find((c) => c.id === id) || null;
export const cardsOf = (kind) => state.cards.filter((c) => c.kind === kind);

export function addCard(input) {
  const c = cardsLib.newCard(input);
  state.cards.unshift(c); emit('cards');
  return write(db.put('cards', c)).then(() => c);
}

export function updateCard(id, patch) {
  const cur = getCard(id);
  if (!cur) return Promise.resolve();
  const c = cardsLib.editCard(cur, patch);
  state.cards[state.cards.findIndex((x) => x.id === id)] = c; emit('cards');
  return write(db.put('cards', c)).then(() => c);
}

/** Removing a card removes its links; the cards it was linked with stay. */
export function removeCard(id) {
  const freed = state.cards.filter((c) => c.id !== id && (c.links || []).includes(id)).map((c) => ({ ...c, links: c.links.filter((x) => x !== id), updatedAt: Date.now() }));
  state.cards = state.cards.filter((c) => c.id !== id).map((c) => freed.find((f) => f.id === c.id) || c);
  emit('cards');
  return write(db.batch([{ store: 'cards', del: id }, ...freed.map((c) => ({ store: 'cards', put: c }))]));
}

function putCards(list) {
  list.forEach((c) => { state.cards[state.cards.findIndex((x) => x.id === c.id)] = c; });
  emit('cards');
  return write(db.batch(list.map((c) => ({ store: 'cards', put: c }))));
}

/** Link two cards (many-to-many). Linking twice does nothing. */
export function linkCards(a, b) {
  if (a === b || cardsLib.areLinked(state.cards, a, b)) return Promise.resolve(false);
  const c = getCard(a);
  if (!c || !getCard(b)) return Promise.resolve(false);
  return putCards([{ ...c, links: [...(c.links || []), b], updatedAt: Date.now() }]).then(() => true);
}

export function unlinkCards(a, b) {
  const changed = [a, b].map(getCard).filter((c) => c && (c.links || []).includes(c.id === a ? b : a))
    .map((c) => ({ ...c, links: c.links.filter((x) => x !== (c.id === a ? b : a)), updatedAt: Date.now() }));
  return changed.length ? putCards(changed) : Promise.resolve();
}

/** Add or remove a card from a project (a card can be in several projects). */
export function setCardProject(id, projectId, on) {
  const c = getCard(id);
  if (!c) return Promise.resolve(false);
  const has = (c.projectIds || []).includes(projectId);
  if (has === on) return Promise.resolve(false);
  return putCards([{ ...c, projectIds: on ? [...c.projectIds, projectId] : c.projectIds.filter((x) => x !== projectId), updatedAt: Date.now() }]).then(() => true);
}

/**
 * Turn an idea into a task of a project. The task keeps the idea's tutorials and
 * inspiration. keep=true leaves the post-it in the studio (linked to the task and project);
 * keep=false removes it.
 */
export async function ideaToTask(id, projectId, { keep = true } = {}) {
  const c = getCard(id);
  if (!c) return null;
  const linked = cardsLib.linksOf(state.cards, id);
  const t = await addTask({ projectId, title: (c.title || c.text).split('\n')[0].slice(0, 160), how: c.title ? c.text : (c.text.includes('\n') ? c.text : ''),
    cardIds: keep ? [id, ...linked] : linked });
  if (keep) await setCardProject(id, projectId, true);
  else await removeCard(id);
  return t;
}

// ── settings ───────────────────────────────────────────────────────────────
export function setSetting(key, value) {
  state.settings = { ...state.settings, [key]: value };
  emit('settings');
  return write(db.put('kv', { key: 'settings', value: state.settings }));
}

// ── combos ─────────────────────────────────────────────────────────────────
export const getCombo = (id) => byId(state.combos, id);
const comboCtx = () => ({ tasks: state.tasks, routines: state.routines, routineLog: state.routineLog });
export const comboProgress = (c, now = Date.now()) => combosLib.comboProgress(c, comboCtx(), now);

/** Save a combo. Its order is its own; it does not link the project steps ("starts after"). */
export function addCombo(input) {
  const c = combosLib.newCombo(input);
  state.combos.push(c);
  emit('plan');
  return write(db.put('combos', c)).then(() => c);
}

export function updateCombo(id, patch) {
  const cur = getCombo(id);
  if (!cur) return Promise.resolve();
  const steps = patch.steps ?? cur.steps;
  if (steps.length < 2) return Promise.reject(new tracker.ValidationError('Bir combo en az iki adımdan oluşur.'));
  const c = { ...cur, ...('title' in patch ? { title: String(patch.title || '').trim().slice(0, 80) || 'Combo' } : {}), ...('repeat' in patch ? { repeat: !!patch.repeat } : {}), ...('windowMin' in patch ? { windowMin: combosLib.windowOf(patch.windowMin) } : {}), steps, updatedAt: Date.now() };
  putIn(state.combos, c);
  emit('plan');
  return write(db.put('combos', c)).then(() => c);
}

export function removeCombo(id) {
  state.combos = state.combos.filter((c) => c.id !== id);
  emit('plan');
  return write(db.del('combos', id));
}

/**
 * Start the combo again from its first step today. In a repeating combo the task steps are
 * opened again (their measured time stays); habit steps simply count from today.
 */
export function restartCombo(id) {
  const cur = getCombo(id);
  if (!cur) return Promise.resolve();
  const now = Date.now(), c = { ...cur, runStart: isoDate(now), updatedAt: now };
  const reopened = cur.repeat ? cur.steps.filter((s) => s.kind === 'task').map((s) => getTask(s.ref)).filter((t) => t?.done)
    .map((t) => ({ ...t, done: false, doneAt: null, plannedDay: null, scheduledAt: null, updatedAt: now })) : [];
  reopened.forEach((t) => putIn(state.tasks, t));
  putIn(state.combos, c);
  emit('plan');
  return write(db.batch([{ store: 'combos', put: c }, ...reopened.map((t) => ({ store: 'tasks', put: t }))]));
}

/** Record finished runs once (they feed the deer). */
function settleCombos() {
  const now = Date.now(), changed = [];
  for (const c of state.combos) {
    const pr = combosLib.comboProgress(c, comboCtx(), now);
    if (pr.status !== 'done' || (c.runs || []).some((r) => r.start === c.runStart)) continue;
    const n = { ...c, runs: [...(c.runs || []), { start: c.runStart, at: now, n: pr.count }], updatedAt: now };
    putIn(state.combos, n); changed.push(n);
  }
  if (!changed.length) return;
  emit('plan');
  return write(db.batch(changed.map((c) => ({ store: 'combos', put: c }))));
}

function dropFromCombos(kind, refs) {
  const ops = [];
  state.combos = state.combos.flatMap((c) => {
    const steps = c.steps.filter((s) => !(s.kind === kind && refs.has(s.ref)));
    if (steps.length === c.steps.length) return [c];
    if (steps.length < 2) { ops.push({ store: 'combos', del: c.id }); return []; }
    const n = { ...c, steps, updatedAt: Date.now() }; ops.push({ store: 'combos', put: n }); return [n];
  });
  return ops;
}

// ── backup / restore ───────────────────────────────────────────────────────
export function exportData() {
  return {
    app: 'time-garden', schema: SCHEMA, exportedAt: new Date().toISOString(),
    sessions: state.sessions, events: state.events, pages: [...state.pages.values()],
    projects: state.projects, tasks: state.tasks, routines: state.routines, routineLog: state.routineLog, assets: state.assets, cards: state.cards, combos: state.combos, settings: state.settings,
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
  return { sessions: next.sessions.length, events: next.events.length, pages: next.pages.length, projects: next.projects.length, tasks: next.tasks.length };
}
