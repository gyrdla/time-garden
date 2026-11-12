import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../src/core/balance.js';
import * as P from '../src/core/planner.js';

const at = (h, m = 0, day = 11) => new Date(2026, 10, day, h, m).getTime();
const min = (ms) => Math.round(ms / 60000);
const WEEK = [at(0, 0, 9), at(0, 0, 16)];
const S = (name, category, a, b) => ({ id: name + a, name, category, startedAt: a, endedAt: b, pauses: [] });

test('balance: measured + ticked habits against a weekly target, and when each area was last done', () => {
  const sessions = [S('LabOS', 'Çalışma', at(10), at(13)), S('Kahve', 'Sosyal', at(18, 0, 10), at(19, 0, 10))];
  const clean = P.newRoutine({ title: 'Ev toplama', category: 'Ev işleri', estimateMin: 20 }, at(8, 0, 9));
  const log = [{ id: 'a', routineId: clean.id, date: '2026-11-10', doneAt: at(9, 0, 10) }, { id: 'b', routineId: clean.id, date: '2026-11-11', doneAt: at(9) }];
  const rows = B.balance(WEEK, { sessions, routines: [clean], routineLog: log, targets: { Sosyal: 360, 'Ev işleri': 120, Çalışma: 1200 } }, at(20));
  const by = Object.fromEntries(rows.map((r) => [r.cat, r]));
  assert.deepEqual([min(by.Sosyal.actualMs), min(by.Sosyal.targetMs), Math.round(by.Sosyal.pct * 100)], [60, 360, 17]);
  assert.deepEqual([min(by['Ev işleri'].measuredMs), min(by['Ev işleri'].tickedMs), min(by['Ev işleri'].targetMs)], [0, 40, 120]);
  assert.equal(by.Sosyal.lastAt, at(19, 0, 10));
  assert.equal(min(B.targetMs(420, [at(0), at(0, 0, 12)])), 60);              // 7 h a week = 1 h a day
  assert.equal(B.balance(WEEK, { sessions: [], routines: [], routineLog: [], targets: {} }).length, 0);
});

test('review: what was planned, what got done, what was missed', () => {
  const proj = P.newProject({ name: 'X' });
  const done = { ...P.newTask({ projectId: proj.id, title: 'Çekim', scheduledAt: at(10), estimateMin: 60 }), done: true, doneAt: at(11) };
  const missed = P.newTask({ projectId: proj.id, title: 'Mail', scheduledAt: at(9), estimateMin: 30 });
  const later = P.newTask({ projectId: proj.id, title: 'Kurgu', scheduledAt: at(21), estimateMin: 30 });
  const breakfast = P.newRoutine({ title: 'Kahvaltı', time: '08:00', estimateMin: 20 }, at(7, 0, 10));
  const r = B.review(WEEK, { tasks: [done, missed, later], routines: [breakfast], routineLog: [{ id: 'k', routineId: breakfast.id, date: '2026-11-10' }], projects: [proj] }, at(12));
  assert.deepEqual([r.planned, r.done, r.upcoming], [4, 2, 5]);                // 10 & 11 breakfast, Çekim, Mail | Kurgu + breakfasts 12–15
  assert.deepEqual(r.missed.map((i) => i.title), ['Mail', 'Kahvaltı']);
  assert.equal(min(r.doneMs), 80);
});

test('skipping cost comes only from the user\'s own sessions', () => {
  // mail: after 1 day it takes 15 min, after 2 → 30, after 3 → 45 (+ noise)
  const sessions = [];
  let t = at(9, 0, 1);
  for (const [gap, dur] of [[0, 20], [1, 15], [3, 46], [1, 16], [2, 29], [1, 14], [3, 44]]) {
    t += gap * 86_400_000; sessions.push(S('Mail kontrol', 'Çalışma', t, t + dur * 60000)); t += dur * 60000;
  }
  const m = B.gapModel('mail KONTROL', sessions);
  assert.ok(m && m.samples === 6);
  assert.ok(Math.abs(min(m.at(1)) - 15) <= 2 && Math.abs(min(m.at(3)) - 45) <= 2, `${min(m.at(1))} / ${min(m.at(3))}`);
  assert.equal(min(m.at(10)), min(m.at(3)));                                   // never extrapolates past what was seen
  const n = B.neglect(sessions, t + 3 * 86_400_000);
  assert.equal(n.length, 1);
  assert.ok(Math.abs(min(n[0].extraMs) - 30) <= 3 && !n[0].beyondData);
  assert.equal(B.gapModel('Mail kontrol', sessions.slice(0, 4)), null);       // too few gaps → no claim at all
  const flat = [0, 1, 3, 1, 2].map((g, i) => S('Okuma', 'Öğrenme', at(9, 0, 1 + i * 2), at(9, 30, 1 + i * 2)));
  assert.equal(B.gapModel('Okuma', flat), null);                              // no growth → nothing shown
});
