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
  const routine = P.newRoutine({ title: 'Sabah planı', days: [2], time: '09:00', estimateMin: 15 }, at(8, 0, 1)); // Wednesday
  const other = P.newRoutine({ title: 'Pazartesi işi', days: [0], time: '09:00' }, at(8, 0, 1));
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
  const img = normalizeImport({ app: 'time-garden', schema: 4, sessions: [], assets: [{ id: 'a', kind: 'sticker', dataUrl: 'data:image/png;base64,AA' }, { id: 'b', kind: 'sticker', dataUrl: 'javascript:1' }, { id: 'c', kind: 'x', dataUrl: 'data:image/png;base64,AA' }] });
  assert.deepEqual(img.assets.map((a) => a.id), ['a']);
  assert.equal(P.newProject({ name: 'X', cover: 'preset:zebra' }).cover, 'preset:zebra');
  assert.equal(P.newProject({ name: 'X', cover: 'url(evil)' }).cover, null);
});

test('pick for a day without a time, then give it a time', () => {
  const t = mk({ title: 'Kapak görseli', plannedDay: '2026-11-11' });
  assert.equal(t.plannedDay, '2026-11-11');
  assert.deepEqual(P.dayTray('2026-11-11', [t]).map((x) => x.title), ['Kapak görseli']);
  assert.equal(P.dayPlan(at(12), [t], [], []).total, 1);
  const timed = P.editTask(t, { scheduledAt: at(16, 0, 12) }, [t]);
  assert.equal(timed.plannedDay, '2026-11-12');
  assert.equal(P.dayTray('2026-11-11', [timed]).length, 0);
  assert.equal(P.dayPlan(at(12, 0, 12), [timed], [], []).tasks, 1);
  assert.equal(P.editTask(timed, { scheduledAt: null, plannedDay: null }, [timed]).plannedDay, null);
});

test('clock angle to time of day', () => {
  assert.equal(P.angleToMinutes(0, -10), 0);          // top = 00:00
  assert.equal(P.angleToMinutes(10, 0), 6 * 60);      // right = 06:00
  assert.equal(P.angleToMinutes(0, 10), 12 * 60);     // bottom = 12:00
  assert.equal(P.angleToMinutes(-10, 0), 18 * 60);    // left = 18:00
  assert.equal(P.angleToMinutes(-0.01, -10), 0);      // just before midnight snaps to 00:00
  assert.equal(P.angleToMinutes(Math.sin(Math.PI * 14.26 / 12), -Math.cos(Math.PI * 14.26 / 12)), 14 * 60 + 15);
});

test('the deer earns food from finished steps and grows when fed; table compares plan and measured time', () => {
  const a = mk({ title: 'A', estimateMin: 30 }), a1 = mk({ title: 'A1', parentId: a.id, estimateMin: 20 }), a2 = mk({ title: 'A2', parentId: a.id, estimateMin: 40 });
  const tasks = [a, { ...a1, done: true, doneAt: at(9) }, a2];
  const d0 = P.deer(tasks, [], 0);
  assert.deepEqual([d0.earned, d0.food, d0.stage, d0.next.need], [1, 1, 'Minik', 3]);
  const d1 = P.deer(tasks, [{}, {}, {}], 3);          // 4 earned, 3 already fed
  assert.deepEqual([d1.food, d1.stage, d1.next.name, d1.next.need], [1, 'Yavru', 'Genç', 5]);
  assert.ok(d1.size > d0.size);
  assert.equal(P.deer([], [], 5).food, 0);            // never negative after un-ticking a step
  assert.equal(P.deer(tasks, [], 60).next, null);
  const sessions = [{ id: 's', taskId: a1.id, name: 'A1', category: 'Çalışma', startedAt: at(9), endedAt: at(9, 25), pauses: [] }];
  const tb = P.projectTable(proj.id, tasks, sessions, []);
  assert.deepEqual(tb.rows.map((r) => [r.task.title, r.depth, r.estimateMin, r.actualMs / 60000, r.done]), [['A', 0, 60, 25, false], ['A1', 1, 20, 25, true], ['A2', 1, 40, 0, false]]);
  assert.equal(tb.estimateMin, 60);
  assert.equal(tb.actualMs / 60000, 25);
});

test('habit chain: one at a time, the next unlocks only when the current one is established', () => {
  const water = P.newRoutine({ title: 'Su iç', status: 'active', targetDays: 3 }, at(8, 0, 1));
  const walk = P.newRoutine({ title: 'Yürüyüş', status: 'queued' }, at(8, 1, 1));
  const read = P.newRoutine({ title: 'Kitap', status: 'queued' }, at(8, 2, 1));
  const old = { ...P.newRoutine({ title: 'Eski rutin' }, at(8, 0, 1)), status: undefined };   // made before the chain existed
  let all = [walk, water, read, old];
  const log = (r, day) => ({ id: `${r.id}|2026-11-${String(day).padStart(2, '0')}`, routineId: r.id, date: `2026-11-${String(day).padStart(2, '0')}` });
  let c = P.habitChain(all, [log(water, 2), log(water, 3), log(walk, 3)]);
  assert.equal(c.current.title, 'Su iç');
  assert.deepEqual(c.queued.map((r) => r.title), ['Yürüyüş', 'Kitap']);
  assert.deepEqual(c.acquired.map((r) => r.title), ['Eski rutin']);
  assert.deepEqual([c.progress.done, c.progress.target, c.progress.ready], [2, 3, false]);
  // only the active and established habits are on the calendar
  assert.deepEqual(P.agenda(DAY11, [], all, []).map((i) => i.title).sort(), ['Eski rutin', 'Su iç']);
  assert.deepEqual(P.acquireHabit(all, walk.id), []);                       // a queued habit cannot jump the line
  c = P.habitChain(all, [log(water, 2), log(water, 3), log(water, 5)]);
  assert.equal(c.progress.ready, true);
  const changed = P.acquireHabit(all, water.id, at(9, 0, 6));
  assert.deepEqual(changed.map((r) => [r.title, r.status]), [['Su iç', 'acquired'], ['Yürüyüş', 'active']]);
  all = all.map((r) => changed.find((x) => x.id === r.id) || r);
  c = P.habitChain(all, [log(walk, 3), log(walk, 7)]);
  assert.equal(c.current.title, 'Yürüyüş');
  assert.equal(c.progress.done, 1);                                          // days before it became active do not count
  assert.deepEqual(c.acquired.map((r) => r.title), ['Eski rutin', 'Su iç']);
  assert.deepEqual(P.agenda(DAY11, [], all, []).map((i) => i.title).sort(), ['Eski rutin', 'Su iç', 'Yürüyüş']);
});

test('treasure holds every finished step, newest first, and habits that were built', () => {
  const a = mk({ title: 'A' }), a1 = { ...mk({ title: 'A1', parentId: a.id }), done: true, doneAt: at(9) }, b = { ...mk({ title: 'B' }), done: true, doneAt: at(10) }, c = mk({ title: 'C' });
  const built = { ...P.newRoutine({ title: 'Su iç', status: 'active' }, at(8, 0, 1)), status: 'acquired', acquiredAt: at(9) };
  const t = P.treasure([a, a1, b, c], [built, P.newRoutine({ title: 'Sıradaki', status: 'queued' })]);
  assert.deepEqual(t.steps.map((x) => x.title), ['B', 'A1']);
  assert.deepEqual(t.habits.map((x) => x.title), ['Su iç']);
  assert.equal(t.count, 2);
});

test('a habit appears only from its start day; twice-a-day habits need both to count the day', () => {
  const care = P.newRoutine({ title: 'Ağız bakımı', times: ['22:00', '08:00'], status: 'active', targetDays: 2 }, at(12, 0, 11));
  assert.deepEqual(care.times, ['08:00', '22:00']);
  assert.equal(P.agenda([at(0, 0, 10), at(0, 0, 11)], [], [care], []).length, 0);            // the day before it started
  const day = P.agenda(DAY11, [], [care], [{ id: 'x', routineId: care.id, date: '2026-11-11', slot: 1 }]);
  assert.deepEqual(day.map((i) => [new Date(i.start).getHours(), i.slot, i.done]), [[8, 0, false], [22, 1, true]]);
  const log = (d, slot) => ({ id: `${d}${slot}`, routineId: care.id, date: `2026-11-${d}`, slot });
  let c = P.habitChain([care], [log(11, 0), log(12, 0), log(12, 1)]);
  assert.deepEqual([c.progress.done, c.progress.ready], [1, false]);                          // the 11th had only the morning
  c = P.habitChain([care], [log(11, 0), log(11, 1), log(12, 0), log(12, 1)]);
  assert.deepEqual([c.progress.done, c.progress.ready], [2, true]);
  assert.throws(() => P.newRoutine({ title: 'x', times: ['25:99'] }), ValidationError);
});
