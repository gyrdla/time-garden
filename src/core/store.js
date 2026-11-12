// Application state: an in-memory copy of the local database plus the only code
// that writes to it. UI modules subscribe and re-render; they never touch db.js.

import * as db from './db.js';
import * as tracker from './tracker.js';
import { migrateV1, normalizeImport, SCHEMA } from './migrate.js';
import * as planner from './planner.js';
import * as cardsLib from './cards.js';
import { balancedWeeks } from './balance.js';

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
    const [sessions, events, pages, projects, tasks, routines, routineLog, assets, cards, kv] = await Promise.all([
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
      load({ sessions, events, pages, projects, tasks, routines, routineLog, assets, cards, settings: meta.settings || {} });
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
  state.cards = [...(d.cards || [])].sort((a, b) => b.createdAt - a.createdAt);
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
  emit('plan');
  return write(db.batch([{ store: 'projects', del: id }, ...gone.map((t) => ({ store: 'tasks', del: t.id }))]));
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
  return write(db.batch(targets.map((t) => ({ store: 'tasks', put: t })))).then(() => ({ unlocked }));
}

/** Deleting a task deletes its sub-steps and releases anything that was waiting on them. */
export function removeTask(id) {
  const gone = new Set([id, ...planner.descendants(state.tasks, id).map((t) => t.id)]);
  const freed = state.tasks.filter((t) => !gone.has(t.id) && gone.has(t.dependsOn)).map((t) => ({ ...t, dependsOn: null }));
  state.tasks = state.tasks.filter((t) => !gone.has(t.id));
  freed.forEach((t) => putIn(state.tasks, t));
  emit('plan');
  return write(db.batch([...[...gone].map((g) => ({ store: 'tasks', del: g })), ...freed.map((t) => ({ store: 'tasks', put: t }))]));
}

/** Start tracking a task: as the primary activity, or alongside the running one if it is marked parallel. */
export function startTask(id) {
  const t = getTask(id);
  if (!t) return Promise.resolve();
  const p = getProject(t.projectId);
  if (activeSession()) {
    if (!t.parallel) throw new tracker.ValidationError('Şu an başka bir etkinlik sürüyor. Önce onu bitir ya da bu görevi “aynı anda yapılabilir” olarak işaretle.');
    return startSecondary({ label: t.title, taskId: id });
  }
  return start({ name: t.title, category: t.category || p?.category || 'Diğer', taskId: id });
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
  const ops = [{ store: 'routines', del: id }, ...logs.map((l) => ({ store: 'routineLog', del: l.id }))];
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
  return write(done ? db.put('routineLog', rec) : db.del('routineLog', id));
}

export const BALANCE_BONUS = 5;
/** Food earned by balanced weeks (every area with a target reached it). */
export function deerBonus(now = Date.now()) {
  return balancedWeeks({ sessions: state.sessions, routines: state.routines, routineLog: state.routineLog, targets: state.settings.targets || {} }, now).length * BALANCE_BONUS;
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

/** Removing an idea keeps the videos and tutorials that were attached to it. */
export function removeCard(id) {
  const freed = state.cards.filter((c) => c.ideaId === id).map((c) => ({ ...c, ideaId: null, updatedAt: Date.now() }));
  state.cards = state.cards.filter((c) => c.id !== id).map((c) => freed.find((f) => f.id === c.id) || c);
  emit('cards');
  return write(db.batch([{ store: 'cards', del: id }, ...freed.map((c) => ({ store: 'cards', put: c }))]));
}

/** Turn an idea into a task of a project; the post-it stays, linked to that project. */
export function ideaToTask(id, projectId) {
  const c = getCard(id);
  if (!c) return Promise.resolve(null);
  return addTask({ projectId, title: (c.title || c.text).split('\n')[0].slice(0, 160), how: c.title ? c.text : '' })
    .then((t) => updateCard(id, { projectId }).then(() => t));
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
    sessions: state.sessions, events: state.events, pages: [...state.pages.values()],
    projects: state.projects, tasks: state.tasks, routines: state.routines, routineLog: state.routineLog, assets: state.assets, cards: state.cards, settings: state.settings,
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
