import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/core/planner.js';
import { ValidationError } from '../src/core/tracker.js';
import { normalizeImport } from '../src/core/migrate.js';

const at = (h, m = 0, day = 11) => new Date(2026, 10, day, h, m).getTime();
const DAY11 = [at(0), at(0, 0, 12)];
const proj = P.newProject({ name: 'GYRDLAB Reels', area: 'İçerik', category: 'Çalışma' }, at(8));
const mk = (o) => P.newTask({ projectId: proj.id, ...o }, at(8));

test('breakdown: template is matched by title and scales with detail level', () => {
  assert.equal(P.matchTemplate('Kahve reels çekimi').id, 'cekim');
  assert.equal(P.matchTemplate('Substack yazısı').id, 'yazi');
  assert.equal(P.matchTemplate('bambaşka bir şey').id, 'genel');
  const few = P.templateSteps(P.matchTemplate('çekim'), 1), all = P.templateSteps(P.matchTemplate('çekim'), 3);
  assert.ok(few.length < all.length);
  assert.ok(few.some((s) => s.title === 'Makyaj ve saç' && s.parallel));
});

test('breakdown: steps are chained in order, parallel steps stay free', () => {
  const parent = mk({ title: 'Reels çekimi' });
  const steps = P.buildSteps(parent, P.templateSteps(P.matchTemplate(parent.title), 1));
  const titles = steps.map((s) => s.title);
  assert.deepEqual(titles.slice(0, 4), ['Fikri ve mesajı netleştir', 'Çekim listesi / senaryo yaz', 'Makyaj ve saç', 'Çekim']);
  assert.equal(steps[0].dependsOn, null);
  assert.equal(steps[1].dependsOn, steps[0].id);
  assert.equal(steps[2].dependsOn, null);            // makyaj: can run alongside
  assert.equal(steps[3].dependsOn, steps[1].id);     // çekim waits for the script, not for makeup
  assert.ok(steps.every((s) => s.parentId === parent.id));
});

test('pasted lines become steps with durations; text form round-trips', () => {
  const steps = P.parseLines('1. Işık kur 20 dk\n- Makyaj 40dk (paralel)\nÇekim - 1,5 sa\nSadece başlık\n\n');
  assert.deepEqual(steps, [
    { title: 'Işık kur', estimateMin: 20, parallel: false }, { title: 'Makyaj', estimateMin: 40, parallel: true },
    { title: 'Çekim', estimateMin: 90, parallel: false }, { title: 'Sadece başlık', estimateMin: null, parallel: false }]);
  assert.deepEqual(P.parseLines(P.stepsToText(steps)), steps);
});

test('progress counts leaf steps; parents are done when their steps are', () => {
  const a = mk({ title: 'A' }), a1 = mk({ title: 'A1', parentId: a.id }), a2 = mk({ title: 'A2', parentId: a.id }), b = mk({ title: 'B' });
  let tasks = [a, a1, a2, b];
  assert.deepEqual(P.progress(tasks, proj.id), { done: 0, total: 3, pct: 0 });
  assert.equal(P.stage(0).name, 'Tohum');
  tasks = tasks.map((t) => (t.id === a1.id || t.id === a2.id ? { ...t, done: true } : t));
  assert.equal(P.isDone(tasks[0], tasks), true);
  assert.equal(P.progress(tasks, proj.id).done, 2);
  assert.equal(P.stage(2 / 3).name, 'Fidan');
  assert.equal(P.stage(1).name, 'Çiçek');
});

test('chains: blocked until the predecessor is done, then unlocked; cycles are refused', () => {
  const a = mk({ title: 'Senaryo', order: 0 }), b = mk({ title: 'Çekim', order: 1, dependsOn: a.id }), c = mk({ title: 'Kurgu', order: 2, dependsOn: b.id });
  let tasks = [a, b, c];
  assert.equal(P.isBlocked(b, tasks), true);
  assert.equal(P.nextStep(tasks, proj.id).id, a.id);
  assert.throws(() => P.editTask(a, { dependsOn: c.id }, tasks), ValidationError);
  tasks = tasks.map((t) => (t.id === a.id ? { ...t, done: true, doneAt: at(9) } : t));
  assert.deepEqual(P.unlockedBy(a.id, tasks).map((t) => t.title), ['Çekim']);
  assert.equal(P.nextStep(tasks, proj.id).id, b.id);
});

test('agenda: tasks and routines on the day; overlapping items sit side by side', () => {
  const shoot = { ...mk({ title: 'Çekim', estimateMin: 60, scheduledAt: at(14) }) };
  const makeup = { ...mk({ title: 'Makyaj', estimateMin: 40, scheduledAt: at(14), parallel: true }) };
  const edit = { ...mk({ title: 'Kurgu', estimateMin: 60, scheduledAt: at(14, 30) }) };
  const routine = P.newRoutine({ title: 'Sabah planı', days: [2], time: '09:00', estimateMin: 15 }); // Wednesday
  const other = P.newRoutine({ title: 'Pazartesi işi', days: [0], time: '09:00' });
  const items = P.agenda(DAY11, [shoot, makeup, edit], [routine, other], []);
  assert.deepEqual(items.map((i) => i.title), ['Sabah planı', 'Makyaj', 'Çekim', 'Kurgu']);
  const laid = P.layout(items);
  assert.equal(laid[0].cols, 1);
  assert.deepEqual(laid.slice(1).map((i) => i.cols), [3, 3, 3]);
  assert.equal(new Set(laid.slice(1).map((i) => i.col)).size, 3);
  // Makeup overlapping the shoot is fine (parallel); the edit overlapping the shoot is a clash.
  const clash = P.conflicts(items);
  assert.equal(clash.length, 1);
  assert.deepEqual(clash[0].map((i) => i.title).sort(), ['Kurgu', 'Çekim'].sort());
  const done = P.agenda(DAY11, [], [routine], [{ id: 'x', routineId: routine.id, date: '2026-11-11' }]);
  assert.equal(done[0].done, true);
});

test('estimates come from tracked history only', () => {
  const s = (name, a, b) => ({ id: name + a, name, category: 'Çalışma', startedAt: a, endedAt: b, pauses: [] });
  const sessions = [s('Kurgu', at(9), at(9, 40)), s('kurgu ', at(11), at(12)), s('Kurgu', at(15), at(15, 50)), s('Başka', at(16), at(17))];
  assert.deepEqual(P.historyEstimate('KURGU', sessions, []), { minutes: 50, samples: 3 });
  assert.equal(P.historyEstimate('Hiç yapılmamış', sessions, []), null);
  const tasks = [{ id: 't1', projectId: 'p' }, { id: 't2', projectId: 'p' }];
  const shoot = { ...sessions[0], taskId: 't1' }, makeup = { taskId: 't2', startedAt: at(9), endedAt: at(9, 30) };
  assert.equal(P.projectActualMs('p', tasks, [shoot], [makeup]) / 60000, 40); // overlap counted once, not 70
  assert.equal(P.actualMs('t1', [{ ...sessions[0], taskId: 't1' }], [{ taskId: 't1', startedAt: at(9), endedAt: at(9, 10) }]) / 60000, 50);
});

test('slot suggestions: after the chain, in the hours the category is really worked, or the next gap', () => {
  const sessions = [10, 9, 8].map((day) => ({ id: 'd' + day, name: 'x', category: 'Çalışma', startedAt: at(10, 0, day), endedAt: at(12, 0, day), pauses: [] }));
  const script = mk({ title: 'Senaryo', estimateMin: 30, scheduledAt: at(13) });
  const busy = mk({ title: 'Toplantı', estimateMin: 120, scheduledAt: at(9, 30) });
  const shoot = mk({ title: 'Çekim', estimateMin: 60, dependsOn: script.id });
  const ctx = { tasks: [script, busy, shoot], routines: [], routineLog: [], sessions, category: 'Çalışma' };
  const out = P.suggestSlots(shoot, ctx, at(9));
  const by = Object.fromEntries(out.map((s) => [s.kind, s.ts]));
  assert.equal(by.chain, at(13, 30));
  assert.equal(by.peak, at(10, 0, 12));   // today's 10:00 is taken by the meeting → tomorrow
  assert.equal(by.free, at(11, 30));      // first gap after the meeting
  const none = P.suggestSlots(mk({ title: 'Yeni' }), { ...ctx, sessions: [], tasks: [] }, at(9));
  assert.deepEqual(none.map((s) => s.kind), ['free']);
});

test('streak counts consecutive days with a finished step', () => {
  const t = (day) => ({ done: true, doneAt: at(10, 0, day) });
  assert.equal(P.streak([t(11), t(10), t(9), t(7)], [], at(20)), 3);
  assert.equal(P.streak([t(10), t(9)], [], at(8)), 2);       // today still empty: streak not broken yet
  assert.equal(P.streak([t(8)], [{ date: '2026-11-11' }], at(20)), 1);
  assert.equal(P.streak([], [], at(20)), 0);
  assert.equal(P.doneOn('2026-11-11', [t(11), t(10)], [{ date: '2026-11-11' }]), 2);
});

test('user template from a broken-down task; planner data survives backup import', () => {
  const parent = mk({ title: 'Haftalık vlog' });
  const kids = P.buildSteps(parent, P.parseLines('Çek 30 dk\nKurgula 60 dk'));
  const tpl = P.templateFromTask(parent, [parent, ...kids]);
  assert.equal(P.matchTemplate('haftalık vlog', [tpl, ...P.TEMPLATES]).id, tpl.id);
  assert.deepEqual(P.templateSteps(tpl, 1).map((s) => s.estimateMin), [30, 60]);
  assert.throws(() => P.templateFromTask(kids[0], [parent, ...kids]), ValidationError);
  const back = normalizeImport({ app: 'time-garden', schema: 3, sessions: [], projects: [proj, { bad: 1 }], tasks: [parent, ...kids], routines: [], routineLog: [] });
  assert.equal(back.projects.length, 1);
  assert.equal(back.tasks.length, 3);
  assert.deepEqual(normalizeImport({ app: 'time-garden', schema: 2, sessions: [] }).tasks, []);
});
