// Planner logic: projects → nested tasks (steps), chains, routines, agenda and suggestions.
// Pure functions over plain records; suggestions are offered, never applied automatically.
//
// Project  { id, name, area, category, note, archived, createdAt, updatedAt }
// Task     { id, projectId, parentId|null, title, how, estimateMin|null, scheduledAt|null,
//            dependsOn|null, parallel, done, doneAt|null, order, createdAt, updatedAt }
// Routine  { id, title, projectId|null, category, days:[0..6 Mon..Sun], time:'HH:MM',
//            estimateMin, parallel, active, createdAt }
// RoutineLog { id:`${routineId}|${isoDate}`, routineId, date, doneAt }

import { sessionActive, eventInterval, total, union, isoDate, dayRange, MIN, DAY } from './time.js';
import { peakWindow } from './analytics.js';
import { uid, ValidationError, CATEGORIES } from './tracker.js';

const norm = (s) => String(s || '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
const DEFAULT_MIN = 30;

// ── record constructors ────────────────────────────────────────────────────
function need(v, what) {
  const s = String(v ?? '').trim();
  if (!s) throw new ValidationError(`${what} boş olamaz.`);
  return s.slice(0, 160);
}
const minutes = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, 24 * 60) : null; };

export function newProject({ name, area = '', category = 'Çalışma', note = '' }, now = Date.now()) {
  return { id: uid(), name: need(name, 'Proje adı'), area: String(area || '').trim().slice(0, 60) || 'Genel',
    category: CATEGORIES.includes(category) ? category : 'Diğer', note: String(note || ''), archived: false, createdAt: now, updatedAt: now };
}

export function newTask({ projectId, parentId = null, title, how = '', estimateMin = null, scheduledAt = null, dependsOn = null, parallel = false, order = 0, plannedDay = null }, now = Date.now()) {
  if (!projectId) throw new ValidationError('Görev bir projeye bağlı olmalı.');
  return { id: uid(), projectId, parentId, title: need(title, 'Görev adı'), how: String(how || ''), estimateMin: minutes(estimateMin),
    scheduledAt: Number.isFinite(scheduledAt) ? scheduledAt : null, plannedDay: Number.isFinite(scheduledAt) ? isoDate(scheduledAt) : (plannedDay || null), dependsOn, parallel: !!parallel, done: false, doneAt: null, order, createdAt: now, updatedAt: now };
}

export function editTask(task, patch, tasks, now = Date.now()) {
  const next = { ...task };
  if ('title' in patch) next.title = need(patch.title, 'Görev adı');
  if ('how' in patch) next.how = String(patch.how || '');
  if ('estimateMin' in patch) next.estimateMin = minutes(patch.estimateMin);
  if ('plannedDay' in patch) next.plannedDay = /^\d{4}-\d{2}-\d{2}$/.test(patch.plannedDay || '') ? patch.plannedDay : null;
  if ('scheduledAt' in patch) {
    next.scheduledAt = Number.isFinite(patch.scheduledAt) ? patch.scheduledAt : null;
    if (next.scheduledAt != null) next.plannedDay = isoDate(next.scheduledAt);
  }
  if ('parallel' in patch) next.parallel = !!patch.parallel;
  if ('dependsOn' in patch) {
    const dep = patch.dependsOn || null;
    if (dep && wouldCycle(task.id, dep, tasks)) throw new ValidationError('Bu bağlantı bir döngü oluşturur.');
    next.dependsOn = dep;
  }
  next.updatedAt = now;
  return next;
}

export function newRoutine({ title, projectId = null, category = 'Kişisel', days = [0, 1, 2, 3, 4, 5, 6], time = '09:00', estimateMin = 30, parallel = false }, now = Date.now()) {
  const d = [...new Set((days || []).map(Number).filter((n) => n >= 0 && n <= 6))].sort();
  if (!d.length) throw new ValidationError('En az bir gün seç.');
  if (!/^\d{2}:\d{2}$/.test(time)) throw new ValidationError('Saat geçersiz.');
  return { id: uid(), title: need(title, 'Rutin adı'), projectId, category: CATEGORIES.includes(category) ? category : 'Diğer',
    days: d, time, estimateMin: minutes(estimateMin) || DEFAULT_MIN, parallel: !!parallel, active: true, createdAt: now };
}

function wouldCycle(id, dep, tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (let cur = dep, n = 0; cur && n < 1000; n++) {
    if (cur === id) return true;
    cur = byId.get(cur)?.dependsOn;
  }
  return false;
}

// ── tree ───────────────────────────────────────────────────────────────────
export function childrenOf(tasks, projectId, parentId = null) {
  return tasks.filter((t) => t.projectId === projectId && (t.parentId || null) === parentId).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export function descendants(tasks, id) {
  const out = [];
  const walk = (pid) => { for (const t of tasks) if (t.parentId === pid) { out.push(t); walk(t.id); } };
  walk(id);
  return out;
}

const hasChildren = (tasks, id) => tasks.some((t) => t.parentId === id);

/** Leaves are the things you actually do; a parent is done when all its leaves are. */
export function leaves(tasks, projectId) {
  return tasks.filter((t) => t.projectId === projectId && !hasChildren(tasks, t.id));
}

export function isDone(task, tasks) {
  const kids = tasks.filter((t) => t.parentId === task.id);
  return kids.length ? kids.every((k) => isDone(k, tasks)) : task.done;
}

export function progress(tasks, projectId) {
  const l = leaves(tasks, projectId);
  const done = l.filter((t) => t.done).length;
  return { done, total: l.length, pct: l.length ? done / l.length : 0 };
}

const STAGES = [[0, 'Tohum', '🌰'], [0.01, 'Filiz', '🌱'], [0.34, 'Fidan', '🌿'], [0.67, 'Tomurcuk', '🌷'], [1, 'Çiçek', '🌸']];
/** Garden stage for a project: grows with the share of finished steps. */
export function stage(pct) {
  let cur = STAGES[0];
  for (const s of STAGES) if (pct >= s[0]) cur = s;
  return { name: cur[1], icon: cur[2] };
}

export function isBlocked(task, tasks) {
  if (!task.dependsOn) return false;
  const dep = tasks.find((t) => t.id === task.dependsOn);
  return !!dep && !isDone(dep, tasks);
}

/** The first open, unblocked step of a project in list order — "what is next". */
export function nextStep(tasks, projectId) {
  const walk = (parentId) => {
    for (const t of childrenOf(tasks, projectId, parentId)) {
      if (isDone(t, tasks)) continue;
      if (hasChildren(tasks, t.id)) { const n = walk(t.id); if (n) return n; continue; }
      if (!isBlocked(t, tasks)) return t;
    }
    return null;
  };
  return walk(null);
}

/** Tasks that were waiting for `taskId` and are now free to start. */
export function unlockedBy(taskId, tasks) {
  return tasks.filter((t) => t.dependsOn === taskId && !isDone(t, tasks) && !isBlocked(t, tasks));
}

// ── measured time ──────────────────────────────────────────────────────────
/** Time actually tracked against a task (primary sessions + secondary events started from it). */
export function actualMs(taskId, sessions, events, now = Date.now()) {
  let ms = 0;
  for (const s of sessions) if (s.taskId === taskId) ms += total(sessionActive(s, now));
  for (const e of events) if (e.taskId === taskId) { const iv = eventInterval(e, now); if (iv) ms += iv[1] - iv[0]; }
  return ms;
}

/** Wall-clock time spent on a whole project: overlapping work (shoot + makeup) is counted once. */
export function projectActualMs(projectId, tasks, sessions, events, now = Date.now()) {
  const ids = new Set(tasks.filter((t) => t.projectId === projectId).map((t) => t.id));
  const ivs = [];
  for (const s of sessions) if (ids.has(s.taskId)) ivs.push(...sessionActive(s, now));
  for (const e of events) if (ids.has(e.taskId)) { const iv = eventInterval(e, now); if (iv) ivs.push(iv); }
  return total(union(ivs));
}

/**
 * How long this kind of work has really taken before: the median of finished tracked
 * sessions/events with the same name. Returns null when there is no history — never a guess.
 */
export function historyEstimate(title, sessions, events) {
  const key = norm(title);
  if (!key) return null;
  const durs = [];
  for (const s of sessions) if (s.endedAt != null && norm(s.name) === key) { const ms = total(sessionActive(s)); if (ms >= MIN) durs.push(ms); }
  for (const e of events) if (e.endedAt != null && norm(e.label) === key) durs.push(e.endedAt - e.startedAt);
  if (!durs.length) return null;
  durs.sort((a, b) => a - b);
  const mid = durs.length >> 1;
  const median = durs.length % 2 ? durs[mid] : (durs[mid - 1] + durs[mid]) / 2;
  return { minutes: Math.max(1, Math.round(median / MIN)), samples: durs.length };
}

/** Hours of day in which this category has actually been worked, over the last `days` days. */
export function categoryHours(category, sessions, now = Date.now(), days = 28) {
  const hours = new Array(24).fill(0), from = now - days * DAY;
  for (const s of sessions) {
    if (s.category !== category) continue;
    for (const [a, b] of sessionActive(s, now)) {
      let t = Math.max(a, from);
      while (t < b) {
        const d = new Date(t);
        const next = Math.min(b, new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime());
        hours[d.getHours()] += next - t;
        t = next;
      }
    }
  }
  return hours;
}

// ── agenda ─────────────────────────────────────────────────────────────────
const taskSpan = (t) => [t.scheduledAt, t.scheduledAt + (t.estimateMin || DEFAULT_MIN) * MIN];

/** Everything planned for a day: scheduled tasks plus routine occurrences, sorted by start. */
export function agenda(range, tasks, routines, routineLog, projects = []) {
  const items = [];
  const live = new Set(projects.filter((p) => !p.archived).map((p) => p.id));
  for (const t of tasks) {
    if (t.scheduledAt == null || (projects.length && !live.has(t.projectId))) continue;
    const [s, e] = taskSpan(t);
    if (s < range[1] && e > range[0]) items.push({ kind: 'task', id: t.id, title: t.title, start: s, end: e, parallel: t.parallel, done: isDone(t, tasks), projectId: t.projectId, blocked: isBlocked(t, tasks) });
  }
  const d = new Date(range[0]), dow = (d.getDay() + 6) % 7, iso = isoDate(range[0]);
  const done = new Set(routineLog.filter((l) => l.date === iso).map((l) => l.routineId));
  for (const r of routines) {
    if (!r.active || !r.days.includes(dow)) continue;
    const [h, m] = r.time.split(':').map(Number);
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
    items.push({ kind: 'routine', id: r.id, title: r.title, start: s, end: s + r.estimateMin * MIN, parallel: r.parallel, done: done.has(r.id), projectId: r.projectId, date: iso });
  }
  return items.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Tasks picked for a day that have no clock time yet ("chosen for today"). */
export function dayTray(iso, tasks, projects = []) {
  const live = new Set(projects.filter((p) => !p.archived).map((p) => p.id));
  return tasks.filter((t) => t.plannedDay === iso && t.scheduledAt == null && !isDone(t, tasks) && (!projects.length || live.has(t.projectId)));
}

/** What a calendar cell needs to know about a day's plan. */
export function dayPlan(ts, tasks, routines, routineLog, projects = []) {
  const items = agenda(dayRange(ts), tasks, routines, routineLog, projects);
  const tray = dayTray(isoDate(ts), tasks, projects).length;
  const taskItems = items.filter((i) => i.kind === 'task');
  return { total: items.length + tray, tasks: taskItems.length + tray, done: items.filter((i) => i.done).length, items };
}

/** Clock position → minutes of the day (00:00 at the top, clockwise), snapped. */
export function angleToMinutes(dx, dy, snap = 15) {
  const frac = ((Math.atan2(dx, -dy) / (2 * Math.PI)) + 1) % 1;
  return (Math.round((frac * 1440) / snap) * snap) % 1440;
}

/** Side-by-side columns for overlapping items (calendar layout). Adds col / cols to each item. */
export function layout(items) {
  const out = items.map((i) => ({ ...i, col: 0, cols: 1 }));
  let group = [], groupEnd = -Infinity;
  const flush = () => { const n = Math.max(...group.map((g) => g.col)) + 1; group.forEach((g) => { g.cols = n; }); group = []; };
  for (const it of out) {
    if (group.length && it.start >= groupEnd) flush();
    const used = new Set(group.filter((g) => g.end > it.start).map((g) => g.col));
    let c = 0; while (used.has(c)) c++;
    it.col = c; group.push(it); groupEnd = Math.max(groupEnd, it.end);
  }
  if (group.length) flush();
  return out;
}

/** Overlaps that are a real clash: two items at once where neither is marked "can run alongside". */
export function conflicts(items) {
  const out = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (b.start >= a.end) break;
    if (!a.parallel && !b.parallel && !a.done && !b.done) out.push([a, b]);
  }
  return out;
}

function isFree(start, end, busy) {
  return !busy.some((b) => !b.parallel && !b.done && b.start < end && b.end > start);
}

/**
 * Time suggestions for a task. Each is {kind, ts, why}; the user picks one or types their own.
 *  chain  right after the task it depends on
 *  peak   the hours this category is really worked in (from tracked history)
 *  free   the next gap in the plan
 */
export function suggestSlots(task, ctx, now = Date.now()) {
  const { tasks, routines, routineLog, sessions, category } = ctx;
  const len = (task.estimateMin || DEFAULT_MIN) * MIN, out = [];
  const others = tasks.filter((t) => t.id !== task.id);
  const busyOn = (ts) => agenda(dayRange(ts), others, routines, routineLog);
  const ok = (ts) => task.parallel || isFree(ts, ts + len, busyOn(ts));
  const round = (ts) => Math.ceil(ts / (15 * MIN)) * 15 * MIN;

  const dep = task.dependsOn && tasks.find((t) => t.id === task.dependsOn);
  if (dep && dep.scheduledAt != null) {
    const ts = Math.max(taskSpan(dep)[1], round(now));
    out.push({ kind: 'chain', ts, why: `“${dep.title}” bitince` });
  }
  const peak = peakWindow(categoryHours(category, sessions, now), Math.max(1, Math.min(4, Math.ceil(len / 3_600_000))));
  if (peak) {
    for (let add = 0; add < 7; add++) {
      const d = new Date(now); const ts = new Date(d.getFullYear(), d.getMonth(), d.getDate() + add, peak.from).getTime();
      if (ts > now && ok(ts)) { out.push({ kind: 'peak', ts, why: `${category} için en çok çalıştığın saatler` }); break; }
    }
  }
  for (let ts = round(now + 5 * MIN), n = 0; n < 4 * 24 * 3; ts += 15 * MIN, n++) {
    const h = new Date(ts).getHours();
    if (h < 8 || h >= 22) continue;
    if (ok(ts)) { out.push({ kind: 'free', ts, why: 'Plandaki ilk boşluk' }); break; }
  }
  const seen = new Set();
  return out.filter((s) => (seen.has(s.ts) ? false : seen.add(s.ts)));
}

// ── light game layer ───────────────────────────────────────────────────────
/** Steps finished on a given day (tasks + routines). */
export function doneOn(iso, tasks, routineLog) {
  return tasks.filter((t) => t.done && t.doneAt && isoDate(t.doneAt) === iso).length + routineLog.filter((l) => l.date === iso).length;
}

/** Consecutive days with at least one finished step, ending today (or yesterday if today is still empty). */
export function streak(tasks, routineLog, now = Date.now()) {
  const days = new Set([...tasks.filter((t) => t.done && t.doneAt).map((t) => isoDate(t.doneAt)), ...routineLog.map((l) => l.date)]);
  let n = 0;
  const d = new Date(now);
  if (!days.has(isoDate(d.getTime()))) d.setDate(d.getDate() - 1);
  while (days.has(isoDate(d.getTime()))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

const stepPoints = (t) => 10 + Math.min(20, Math.round((t.estimateMin || 0) / 10));

/** Garden points: every finished step and routine counts; longer steps count a little more. */
export function score(tasks, routineLog) {
  const xp = tasks.filter((t) => t.done && !tasks.some((k) => k.parentId === t.id)).reduce((n, t) => n + stepPoints(t), 0) + routineLog.length * 5;
  let level = 1, floor = 0, need = 60;
  while (xp >= floor + need) { floor += need; level++; need = 60 + (level - 1) * 30; }
  return { xp, level, into: xp - floor, need };
}

/** Plan vs measured for one project, one row per task in tree order. */
export function projectTable(projectId, tasks, sessions, events, now = Date.now()) {
  const rows = [];
  const walk = (parentId, depth) => {
    for (const t of childrenOf(tasks, projectId, parentId)) {
      const leaf = !tasks.some((k) => k.parentId === t.id);
      const subtree = [t, ...descendants(tasks, t.id)];
      const est = leaf ? (t.estimateMin || 0) : subtree.filter((x) => !tasks.some((k) => k.parentId === x.id)).reduce((n, x) => n + (x.estimateMin || 0), 0);
      const ms = subtree.reduce((n, x) => n + actualMs(x.id, sessions, events, now), 0);
      rows.push({ task: t, depth, leaf, estimateMin: est, actualMs: ms, done: isDone(t, tasks), blocked: isBlocked(t, tasks) });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  const top = rows.filter((r) => r.depth === 0);
  return { rows, estimateMin: top.reduce((n, r) => n + r.estimateMin, 0), actualMs: projectActualMs(projectId, tasks, sessions, events, now) };
}

// ── breaking work down ─────────────────────────────────────────────────────
// Each step: [title, detail level 1-3, default minutes, can run alongside other work]
export const TEMPLATES = [
  { id: 'cekim', name: 'İçerik çekimi', match: ['çekim', 'video', 'reels', 'reel', 'tiktok', 'ugc', 'içerik', 'vlog'], steps: [
    ['Fikri ve mesajı netleştir', 1, 15], ['Referans ve örnek topla', 3, 20], ['Çekim listesi / senaryo yaz', 1, 30], ['Kıyafet ve aksesuar seç', 2, 15],
    ['Makyaj ve saç', 1, 40, true], ['Mekânı ve ışığı kur', 2, 20], ['Ses ve kamera testi', 3, 10], ['Çekim', 1, 60], ['Dosyaları aktar ve yedekle', 3, 10],
    ['Kurgu', 1, 60], ['Kapak görseli', 2, 15], ['Açıklama ve etiketler', 2, 15], ['Yayınla', 1, 10]] },
  { id: 'yazi', name: 'Yazı / bülten', match: ['yazı', 'substack', 'makale', 'blog', 'bülten', 'metin'], steps: [
    ['Ana fikri tek cümleyle yaz', 1, 10], ['Kaynak ve not topla', 2, 30], ['İskelet çıkar', 2, 20], ['İlk taslak', 1, 60], ['Ara ver, sonra tekrar oku', 3, 15],
    ['Düzenle ve kısalt', 1, 40], ['Görsel hazırla', 2, 20], ['Başlık ve özet', 2, 10], ['Yayınla', 1, 10]] },
  { id: 'yazilim', name: 'Yazılım özelliği', match: ['kod', 'özellik', 'feature', 'bug', 'uygulama', 'app', 'ekran', 'modül', 'labos'], steps: [
    ['Ne yapacağını ve bitti ölçütünü yaz', 1, 15], ['Mevcut kodu incele', 2, 20], ['Arayüzü / akışı çiz', 2, 30], ['Veri modelini belirle', 3, 20], ['Kodla', 1, 90],
    ['Test yaz ve çalıştır', 2, 30], ['Telefonda dene', 1, 15], ['Commit ve yayın', 1, 10], ['Notları güncelle', 3, 10]] },
  { id: 'basvuru', name: 'İş başvurusu', match: ['başvuru', 'ilan', 'cv', 'iş', 'mülakat', 'ön yazı'], steps: [
    ['İlanı oku, anahtar beklentileri çıkar', 1, 15], ['Şirketi araştır', 2, 20], ['CV’yi ilana göre uyarla', 1, 30], ['Ön yazı yaz', 1, 30],
    ['Portföy bağlantılarını kontrol et', 3, 10], ['Başvuruyu gönder', 1, 10], ['Takip tarihi koy', 2, 5]] },
  { id: 'arastirma', name: 'Araştırma', match: ['araştırma', 'literatür', 'makale oku', 'deney', 'analiz', 'proje fikri', 'hipotez'], steps: [
    ['Soruyu netleştir', 1, 15], ['Kaynak ara ve listele', 1, 45], ['Oku ve not çıkar', 1, 90], ['Bulguları tabloya dök', 2, 30], ['Boşlukları ve sonraki soruyu yaz', 2, 20],
    ['Bir uzmana / kaynağa danış', 3, 20], ['Özet yaz', 1, 30]] },
  { id: 'genel', name: 'Genel', match: [], steps: [
    ['Ne lazım, listele', 2, 10], ['Hazırlık yap', 1, 15], ['İlk küçük adımı at', 1, 20], ['Asıl işi yap', 1, 45], ['Kontrol et', 2, 10], ['Bitir ve kapat', 1, 10], ['Bir sonraki adımı not et', 3, 5]] },
];

export function matchTemplate(title, templates = TEMPLATES) {
  const t = norm(title);
  let best = null, score = 0;
  for (const tpl of templates) {
    const s = (tpl.match || []).filter((k) => t.includes(k)).length + (norm(tpl.name) === t ? 5 : 0);
    if (s > score) { best = tpl; score = s; }
  }
  return best || templates.find((x) => x.id === 'genel') || templates[0];
}

/** Steps of a template at a detail level (1 = few big steps … 3 = every small step). */
export function templateSteps(tpl, level = 2) {
  return tpl.steps.filter((s) => (s[1] || 1) <= level).map((s) => ({ title: s[0], estimateMin: s[2] || null, parallel: !!s[3] }));
}

/** Turn pasted lines into steps. "Kurgu 45dk" or "Kurgu - 1 sa" carry their own duration. */
export function parseLines(text) {
  return String(text || '').split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).map((raw) => {
    const parallel = /\(paralel\)|∥/i.test(raw);
    const l = raw.replace(/\s*(\(paralel\)|∥)\s*/gi, ' ').trim();
    const m = l.match(/^(.*?)[\s,–-]+(\d+(?:[.,]\d+)?)\s*(dk|dakika|sa|saat)\.?$/i);
    if (!m || !m[1].trim()) return { title: l, estimateMin: null, parallel };
    const n = parseFloat(m[2].replace(',', '.'));
    return { title: m[1].trim(), estimateMin: Math.round(/^sa/i.test(m[3]) ? n * 60 : n), parallel };
  }).filter((s) => s.title);
}

/** The editable text form of steps, the inverse of parseLines. */
export function stepsToText(steps) {
  return steps.map((s) => `${s.title}${s.estimateMin ? ` ${s.estimateMin} dk` : ''}${s.parallel ? ' (paralel)' : ''}`).join('\n');
}

/** Build child tasks for `parent` from steps; optionally chain them so each waits for the previous. */
export function buildSteps(parent, steps, { chain = true, startOrder = 0 } = {}, now = Date.now()) {
  const out = [];
  let prev = null;
  steps.forEach((s, i) => {
    const t = newTask({ projectId: parent.projectId, parentId: parent.id ?? null, title: s.title, estimateMin: s.estimateMin, parallel: s.parallel, order: startOrder + i, dependsOn: chain && prev && !s.parallel ? prev : null }, now + i);
    if (!s.parallel) prev = t.id;
    out.push(t);
  });
  return out;
}

/** Save a task's direct steps as a reusable template (the user's own way of doing this work). */
export function templateFromTask(task, tasks) {
  const kids = childrenOf(tasks, task.projectId, task.id);
  if (!kids.length) throw new ValidationError('Şablon için önce adımlara böl.');
  return { id: 'u-' + uid(), name: task.title, match: [norm(task.title)], user: true, steps: kids.map((k) => [k.title, 1, k.estimateMin || null, k.parallel]) };
}
