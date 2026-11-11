import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../src/core/time.js';
import * as K from '../src/core/tracker.js';
import { migrateV1, normalizeImport } from '../src/core/migrate.js';
import { analyze, periodRange, peakWindow } from '../src/core/analytics.js';

const at = (h, m = 0, day = 10) => new Date(2026, 10, day, h, m).getTime();
const min = (ms) => Math.round(ms / T.MIN);
const DAY10 = [at(0), at(0, 0, 11)];

test('union merges overlapping and touching intervals', () => {
  assert.deepEqual(T.union([[5, 9], [0, 3], [2, 6], [9, 10], [20, 21]]), [[0, 10], [20, 21]]);
});

test('subtract and intersect', () => {
  assert.deepEqual(T.subtract([[0, 10]], [[2, 3], [5, 7]]), [[0, 2], [3, 5], [7, 10]]);
  assert.deepEqual(T.intersect([[0, 5], [8, 12]], [[3, 9]]), [[3, 5], [8, 9]]);
  assert.deepEqual(T.subtract([[0, 10]], [[-5, 20]]), []);
});

test('the brief example: 60 min of LabOS with overlaps is 60 min elapsed, not 150', () => {
  const lab = { id: 's', name: 'LabOS', category: 'Çalışma', startedAt: at(10), endedAt: at(11), pauses: [], source: 'timer' };
  const ev = (label, a, b, attention = 'active') => ({ id: label, sessionId: 's', label, attention, startedAt: a, endedAt: b });
  const events = [
    ev('Instagram', at(10, 10), at(10, 22)),
    ev('Tarayıcı', at(10, 25), at(10, 43)),
    ev('Müzik', at(10), at(11), 'background'),
  ];
  const s = T.summarize([lab], events, DAY10, at(12));
  assert.equal(min(s.primaryMs), 60);
  assert.equal(min(s.uniqueMs), 60);
  assert.equal(min(s.secondaryMs), 90); // 12 + 18 + 60, reported separately
  assert.equal(min(s.concurrentMs), 60);
  assert.equal(min(s.secondaryOnlyMs), 0);
  assert.equal(min(s.focusMs), 30); // 60 − 12 − 18; background music does not take attention
  assert.equal(min(s.byLabel.Instagram.overlapMs), 12);
  assert.equal(min(s.byCategory['Çalışma']), 60);
});

test('pauses are excluded from elapsed and reported as paused time', () => {
  const s = { id: 'a', name: 'x', category: 'Çalışma', startedAt: at(9), endedAt: at(10), pauses: [{ start: at(9, 20), end: at(9, 35) }] };
  assert.equal(min(T.sessionElapsed(s)), 45);
  const sum = T.summarize([s], [], DAY10, at(12));
  assert.equal(min(sum.primaryMs), 45);
  assert.equal(min(sum.pausedMs), 15);
});

test('a running session is measured from timestamps, whatever happened in between', () => {
  const s = K.startSession({ name: 'LabOS', category: 'Çalışma' }, at(10));
  // Simulates reload / background / device sleep: nothing ticks, we just ask later.
  assert.equal(min(T.sessionElapsed(JSON.parse(JSON.stringify(s)), at(13, 30))), 210);
  const paused = K.pauseSession(s, at(10, 30));
  assert.equal(min(T.sessionElapsed(paused, at(15))), 30);
  const resumed = K.resumeSession(paused, at(11));
  assert.equal(min(T.sessionElapsed(resumed, at(11, 15))), 45);
});

test('finishing closes the open pause and every open secondary event', () => {
  let s = K.startSession({ name: 'LabOS', category: 'Çalışma' }, at(10));
  const e1 = K.startEvent({ label: 'Instagram', sessionId: s.id }, at(10, 10));
  const e2 = K.endEvent(K.startEvent({ label: 'Safari', sessionId: s.id }, at(10, 12)), at(10, 20));
  s = K.pauseSession(s, at(10, 50));
  const r = K.finishSession(s, [e1, e2], at(11));
  assert.equal(r.session.endedAt, at(11));
  assert.equal(r.session.pauses[0].end, at(11));
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].endedAt, at(11));
  assert.equal(min(T.sessionElapsed(r.session)), 50);
});

test('sessions crossing midnight are split by day', () => {
  const s = { id: 'n', name: 'Uyku', category: 'Uyku', startedAt: at(23), endedAt: at(7, 0, 11), pauses: [] };
  assert.equal(min(T.summarize([s], [], DAY10, at(12, 0, 11)).primaryMs), 60);
  assert.equal(min(T.summarize([s], [], [at(0, 0, 11), at(0, 0, 12)], at(12, 0, 11)).primaryMs), 420);
});

test('two overlapping primaries never count wall time twice', () => {
  const a = { id: 'a', name: 'A', category: 'Çalışma', startedAt: at(9), endedAt: at(11), pauses: [] };
  const b = { id: 'b', name: 'B', category: 'Öğrenme', startedAt: at(10), endedAt: at(12), pauses: [] };
  const s = T.summarize([a, b], [], DAY10, at(13));
  assert.equal(min(s.primaryMs), 180);
  assert.equal(min(s.uniqueMs), 180);
});

test('coverage reports unrecorded gaps inside the recorded span', () => {
  const a = { id: 'a', name: 'A', category: 'Çalışma', startedAt: at(9), endedAt: at(10), pauses: [] };
  const b = { id: 'b', name: 'B', category: 'Çalışma', startedAt: at(11), endedAt: at(12), pauses: [] };
  const c = T.coverage([a, b], [], DAY10, at(13));
  assert.equal(min(c.spanMs), 180);
  assert.equal(min(c.gapMs), 60);
});

test('validation: empty names, reversed and future times are rejected', () => {
  assert.throws(() => K.startSession({ name: '   ' }), K.ValidationError);
  assert.throws(() => K.manualSession({ name: 'x', startedAt: at(11), endedAt: at(10) }, at(12)), K.ValidationError);
  assert.throws(() => K.manualSession({ name: 'x', startedAt: at(11), endedAt: at(13) }, at(12)), K.ValidationError);
  assert.equal(K.manualSession({ name: 'x', category: 'yok', startedAt: at(9), endedAt: at(10) }, at(12)).category, 'Diğer');
});

test('editing timestamps marks the record manual and trims pauses', () => {
  let s = K.startSession({ name: 'LabOS', category: 'Çalışma' }, at(10));
  s = K.resumeSession(K.pauseSession(s, at(10, 40)), at(10, 55));
  s = K.finishSession(s, [], at(11)).session;
  assert.equal(s.source, 'timer');
  const renamed = K.editSession(s, { name: 'LabOS geliştirme' }, at(12));
  assert.equal(renamed.source, 'timer');
  const e = K.editSession(s, { endedAt: at(10, 45) }, at(12));
  assert.equal(e.source, 'manual');
  assert.deepEqual(e.pauses, [{ start: at(10, 40), end: at(10, 45) }]);
  assert.equal(min(T.sessionElapsed(e)), 40);
});

test('v1 localStorage data migrates without loss', () => {
  const old = {
    theme: 'white',
    activities: [
      { id: 'm1', date: '2026-11-10', name: 'Kitap', start: '09:00', end: '10:30', category: 'Öğrenme', memo: 'not' },
      { id: 'l1', date: '2026-11-10', name: 'LabOS', start: '10:00', end: '11:00', category: 'Çalışma', durationMinutes: 50, memo: 'Canlı zaman oturumu' },
    ],
    sessions: [{ id: 'l1', name: 'LabOS', category: 'Çalışma', startedAt: at(10), endedAt: at(11), pausedAt: null, pausedTotal: 10 * T.MIN,
      contexts: [{ label: 'Instagram', startedAt: at(10, 10), endedAt: at(10, 22) }] }],
    currentSession: { id: 'c1', name: 'Yazı', category: 'Kişisel', startedAt: at(14), pausedAt: at(14, 30), pausedTotal: 0, contexts: [{ label: 'Müzik', startedAt: at(14), endedAt: null }] },
    pages: { '2026-11-10': { note: 'merhaba', items: '<div></div>', draw: '' } },
  };
  const m = migrateV1(old);
  assert.equal(m.sessions.length, 3);
  const manual = m.sessions.find((s) => s.id === 'm1');
  assert.equal(manual.source, 'manual');
  assert.equal(min(T.sessionElapsed(manual)), 90);
  const live = m.sessions.find((s) => s.id === 'l1');
  assert.equal(live.source, 'timer');
  assert.equal(min(T.sessionElapsed(live)), 50);
  assert.equal(live.pausesEstimated, true);
  const cur = m.sessions.find((s) => s.id === 'c1');
  assert.equal(cur.endedAt, null);
  assert.equal(K.isPaused(cur), true);
  assert.equal(m.events.length, 2);
  assert.equal(m.events.find((e) => e.label === 'Müzik').endedAt, null);
  assert.equal(m.pages[0].note, 'merhaba');
  assert.equal(m.settings.theme, 'white');
  assert.deepEqual(migrateV1(null).sessions, []);
});

test('import accepts v1 and v2 backups and rejects anything else', () => {
  assert.throws(() => normalizeImport({ foo: 1 }));
  assert.throws(() => normalizeImport({ app: 'time-garden', schema: 99, sessions: [] }));
  assert.equal(normalizeImport({ activities: [], pages: {} }).schema, 2);
  const ok = normalizeImport({ app: 'time-garden', schema: 2, sessions: [
    { id: 'a', name: 'A', startedAt: 1, endedAt: 5 }, { id: 'bad', name: 'B', startedAt: 9, endedAt: 2 }], events: [] });
  assert.equal(ok.sessions.length, 1);
});

test('period analysis: week buckets, previous-period comparison, peak hours', () => {
  const s1 = { id: 'a', name: 'LabOS', category: 'Çalışma', startedAt: at(10), endedAt: at(12), pauses: [] }; // Tue 10 Nov
  const s2 = { id: 'b', name: 'LabOS', category: 'Çalışma', startedAt: at(10, 0, 3), endedAt: at(11, 0, 3), pauses: [] }; // previous week
  const a = analyze('week', at(12), [s1, s2], [], at(13));
  assert.deepEqual(periodRange('week', at(12)), [at(0, 0, 9), at(0, 0, 16)]);
  assert.equal(a.series.length, 7);
  assert.equal(min(a.series[1].primaryMs), 120);
  assert.equal(min(a.sum.primaryMs), 120);
  assert.equal(min(a.prev.primaryMs), 60);
  assert.equal(a.activeDays, 1);
  assert.equal(a.activities.LabOS.count, 1);
  assert.deepEqual(peakWindow(a.hours, 2), { from: 10, to: 12, ms: 120 * T.MIN });
  assert.equal(peakWindow(new Array(24).fill(0)), null);
  assert.equal(analyze('year', at(12), [], [], at(13)).hasData, false);
});
