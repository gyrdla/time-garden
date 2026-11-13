import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../src/core/sequence.js';
import * as P from '../src/core/planner.js';

const at = (h, m = 0) => new Date(2026, 10, 13, h, m).getTime();
const proj = P.newProject({ name: 'GYRDLAB' });
const T = (title, o = {}) => ({ ...P.newTask({ projectId: proj.id, title, plannedDay: '2026-11-13', estimateMin: 30 }, at(1)), ...o });

test('steps flow in order, past slices from their start, the current one from now, around fixed items', () => {
  const a = T('Mail', { slice: 'morning', seq: 0 }), b = T('Çekim', { slice: 'noon', seq: 1, estimateMin: 40 }), c = T('Edit', { slice: 'noon', seq: 2, estimateMin: 90 });
  const shower = P.newRoutine({ title: 'Duş', time: '13:00', estimateMin: 30, status: 'active' }, at(1));
  const sl = Q.sequenceDay('2026-11-13', { tasks: [a, b, c], routines: [shower], routineLog: [], projects: [proj] }, at(12, 10));
  const morning = sl[0].rows, noon = sl[1].rows;
  assert.deepEqual([morning[0].start, morning[0].end], [at(6), at(6, 30)]);                // past slice: from 06:00
  assert.equal(noon[0].start, at(12, 10));                                                   // current slice: from now
  assert.equal(noon[1].kind, 'fixed');                                                        // 13:00 shower in the way…
  assert.equal(noon[2].start, at(13, 30));                                                    // …edit goes after it
  assert.equal(noon[2].end, at(15));
  assert.equal(sl[1].overflowMs, 0);
});

test('what does not fit its slice is flagged; moving crosses slice edges', () => {
  const a = T('Uzun iş', { slice: 'evening', seq: 0, estimateMin: 230 }), b = T('Kısa', { slice: 'evening', seq: 1 });
  const sl = Q.sequenceDay('2026-11-14', { tasks: [{ ...a, plannedDay: '2026-11-14' }, { ...b, plannedDay: '2026-11-14' }], routines: [], routineLog: [], projects: [proj] }, at(9));
  assert.equal(sl[2].rows[0].overflow, false);
  assert.equal(sl[2].rows[1].overflow, true);
  assert.equal(sl[2].overflowMs, 20 * 60_000);
  assert.deepEqual(Q.moveStep(sl, b.id, -1).map((x) => x.id), [b.id, a.id]);
  assert.deepEqual(Q.moveStep(sl, b.id, 1), [{ id: a.id, slice: 'evening' }, { id: b.id, slice: 'night' }]);
  assert.deepEqual(Q.moveStep(sl, a.id, -1), [{ id: a.id, slice: 'noon' }, { id: b.id, slice: 'evening' }]);
});
