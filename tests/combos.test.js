import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../src/core/combos.js';
import * as P from '../src/core/planner.js';
import { ValidationError } from '../src/core/tracker.js';

const at = (d, h = 12, m = 0) => new Date(2026, 10, d, h, m).getTime();
const lab = P.newProject({ name: 'GYRDLAB', area: 'Dikiş' }), sm = P.newProject({ name: 'GYRDLA', area: 'Sosyal medya' });
const T = (p, title, o = {}) => ({ ...P.newTask({ projectId: p.id, title }, at(10)), ...o });

test('a combo needs two steps', () => {
  assert.throws(() => K.newCombo({ title: 'x', steps: [{ kind: 'task', ref: 'a' }] }), ValidationError);
});

test('combo counts steps done in order across projects and habits; a missed day breaks it', () => {
  const shower = P.newRoutine({ title: 'Akşam duş + saç', time: '21:00', status: 'active' }, at(10, 8));
  const makeup = P.newRoutine({ title: 'Sabah makyaj', time: '09:00', status: 'acquired' }, at(10, 8));
  const shoot = T(sm, 'Çekim', { plannedDay: '2026-11-12' });
  const edit = T(sm, 'Edit', { plannedDay: '2026-11-13' });
  const c = { ...K.newCombo({ title: 'Hazırlık', repeat: true, steps: [{ kind: 'habit', ref: shower.id }, { kind: 'habit', ref: makeup.id }, { kind: 'task', ref: shoot.id }, { kind: 'task', ref: edit.id }] }, at(11, 8)) };
  const log = (r, d, h) => ({ id: r.id + d, routineId: r.id, date: `2026-11-${d}`, slot: 0, doneAt: at(d, h) });
  let ctx = { tasks: [shoot, edit], routines: [shower, makeup], routineLog: [log(shower, 11, 21)] };
  let pr = K.comboProgress(c, ctx, at(11, 22));
  assert.deepEqual([pr.count, pr.status, pr.next, pr.info[1].due], [1, 'running', 1, '2026-11-11']);   // makeup due the same day (already past 09:00 still that day)
  ctx = { ...ctx, routineLog: [...ctx.routineLog, log(makeup, 12, 9)] };
  pr = K.comboProgress(c, ctx, at(12, 10));
  assert.deepEqual([pr.count, pr.status], [1, 'running']);                                                // makeup done a day after its day → restarts at 1
  const done = { ...shoot, done: true, doneAt: at(12, 15) };
  ctx = { ...ctx, tasks: [done, edit] };
  pr = K.comboProgress(c, ctx, at(12, 16));
  assert.deepEqual([pr.count, pr.best, pr.next], [2, 2, 3]);
  pr = K.comboProgress(c, ctx, at(14, 10));                                                               // edit was planned for the 13th
  assert.deepEqual([pr.status, pr.count], ['broken', 0]);
  ctx = { ...ctx, tasks: [done, { ...edit, done: true, doneAt: at(13, 11) }] };
  pr = K.comboProgress(c, ctx, at(14, 10));
  assert.deepEqual([pr.status, pr.count, pr.next], ['done', 3, -1]);
  assert.equal(K.comboBonus([{ runs: [{ n: 4 }, { n: 3 }] }, { runs: [] }]), 7);
});

test('a step without a planned day never breaks the combo, it just waits', () => {
  const a = T(lab, 'Kıyafeti dik', { done: true, doneAt: at(11) }), b = T(sm, 'Kıyafet çekimi');
  const c = K.newCombo({ title: 'Dikim', steps: [{ kind: 'task', ref: a.id }, { kind: 'task', ref: b.id }] }, at(10));
  const pr = K.comboProgress(c, { tasks: [a, b], routines: [], routineLog: [] }, at(25));
  assert.deepEqual([pr.status, pr.count, pr.next], ['running', 1, 1]);
});

test('suggestions: sequences from the user\'s own records', () => {
  const S = (name, d, h, m = 30) => ({ id: name + d + h, name, category: 'Kişisel', startedAt: at(d, h), endedAt: at(d, h, m), pauses: [] });
  const sessions = [S('Duş', 9, 21), S('Makyaj', 10, 9), S('Çekim', 10, 11), S('Duş', 11, 21), S('Makyaj', 12, 9), S('Çekim', 12, 11), S('Kitap', 13, 10)];
  assert.deepEqual(K.sequencesFromRecords(sessions), [{ names: ['Duş', 'Makyaj', 'Çekim'], days: 2 }]);
  assert.deepEqual(K.sequencesFromRecords(sessions.slice(0, 3)), []);                            // seen on one day only
});

test('backups keep combos and drop broken ones', async () => {
  const { normalizeImport } = await import('../src/core/migrate.js');
  const ok = { id: 'c1', title: 'x', steps: [{ kind: 'task', ref: 'a' }, { kind: 'habit', ref: 'b' }], runStart: '2026-11-01', runs: [{ n: 3 }], createdAt: 1 };
  const out = normalizeImport({ app: 'time-garden', schema: 6, sessions: [], combos: [ok, { id: 'c2', steps: [{ kind: 'task', ref: 'a' }] }, { id: 'c3', steps: [{ kind: 'x', ref: 'a' }, { kind: 'task', ref: 'b' }] }] });
  assert.deepEqual(out.combos.map((c) => c.id), ['c1']);
});

test('after starting again, a day planned before the new run does not break it', () => {
  const a = T(lab, 'A', { plannedDay: '2026-11-12' }), b = T(sm, 'B');
  const c = { ...K.newCombo({ title: 'x', steps: [{ kind: 'task', ref: a.id }, { kind: 'task', ref: b.id }] }, at(10)), runStart: '2026-11-14' };
  assert.equal(K.comboProgress(c, { tasks: [a, b], routines: [], routineLog: [] }, at(15)).status, 'running');
  assert.equal(K.comboProgress(c, { tasks: [{ ...a, done: true, doneAt: at(15) }, b], routines: [], routineLog: [] }, at(15)).count, 1);
});
