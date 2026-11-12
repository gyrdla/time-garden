import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/core/cards.js';
import { ValidationError } from '../src/core/tracker.js';
import { normalizeImport } from '../src/core/migrate.js';
import * as P from '../src/core/planner.js';
import * as B from '../src/core/balance.js';

test('video links become embeds', () => {
  const y = C.parseVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10');
  assert.deepEqual([y.provider, y.id, y.ratio], ['youtube', 'dQw4w9WgXcQ', 16 / 9]);
  assert.match(y.embed, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.equal(C.parseVideo('https://youtu.be/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.equal(C.parseVideo('https://youtube.com/shorts/abcDEF12345').ratio, 9 / 16);
  assert.equal(C.parseVideo('https://www.tiktok.com/@user/video/7301234567890123456?lang=tr').embed, 'https://www.tiktok.com/embed/v2/7301234567890123456');
  assert.equal(C.parseVideo('https://www.instagram.com/reel/C9xYz_AbCd/').embed, 'https://www.instagram.com/reel/C9xYz_AbCd/embed');
  assert.equal(C.parseVideo('https://instagram.com/p/C9xYz_AbCd').ratio, 4 / 5);
  assert.equal(C.parseVideo('https://vimeo.com/123456789').embed, 'https://player.vimeo.com/video/123456789');
  assert.equal(C.parseVideo('https://example.com/video'), null);
  assert.equal(C.parseVideo('javascript:alert(1)'), null);
  assert.equal(C.parseVideo('nonsense'), null);
});

test('cards validate by kind and keep links', () => {
  assert.throws(() => C.newCard({ kind: 'idea', text: '  ' }), ValidationError);
  assert.throws(() => C.newCard({ kind: 'inspire', url: '' }), ValidationError);
  assert.throws(() => C.newCard({ kind: 'inspire', url: 'javascript:alert(1)' }), ValidationError);
  assert.throws(() => C.newCard({ kind: 'tuto', url: 'https://youtu.be/dQw4w9WgXcQ' }), ValidationError);
  const i = C.newCard({ kind: 'idea', text: 'Kahve reels', color: 'pink' });
  const i2 = C.newCard({ kind: 'idea', text: 'Laboratuvar vlog' });
  const v = C.newCard({ kind: 'inspire', url: 'youtu.be/dQw4w9WgXcQ', links: [i.id] });
  assert.equal(v.url, 'https://youtu.be/dQw4w9WgXcQ');
  // one tutorial used by two ideas, and in two projects
  const t = { ...C.newCard({ kind: 'tuto', title: 'Glitch efekti', projectIds: ['p1', 'p2'] }), links: [i.id, i2.id] };
  const g2 = { ...C.newCard({ kind: 'tuto', title: 'Ses geçişi' }) };
  const i3 = { ...i, links: [g2.id] };                                     // the idea also uses a second tutorial (stored on the idea)
  const all = [i3, i2, v, t, g2];
  assert.deepEqual(C.linkedTo(all, { cardId: i.id }).map((c) => c.id).sort(), [v.id, t.id, g2.id].sort());
  assert.deepEqual(C.linkedTo(all, { cardId: t.id }).map((c) => c.id).sort(), [i.id, i2.id].sort());
  assert.deepEqual(C.linksOf(all, g2.id), [i.id]);                         // read from the other side
  assert.ok(C.areLinked(all, t.id, i2.id) && !C.areLinked(all, v.id, i2.id));
  assert.deepEqual(C.linkedTo(all, { projectId: 'p2' }).map((c) => c.id), [t.id]);
  const old = { id: 'o', kind: 'tuto', title: 'Eski', projectId: 'p1', ideaId: i.id, createdAt: 1, updatedAt: 1 };
  const up = C.upgradeCard(old);
  assert.deepEqual([up.projectIds, up.links, 'projectId' in up], [['p1'], [i.id], false]);
  const moved = C.editCard(old, { projectIds: ['p1', 'p3'] });
  assert.deepEqual([moved.id, moved.projectIds, moved.links], ['o', ['p1', 'p3'], [i.id]]);
  const back = normalizeImport({ app: 'time-garden', schema: 5, sessions: [], cards: [i, { id: 'bad', kind: 'x' }] });
  assert.deepEqual(back.cards.map((c) => c.id), [i.id]);
});

test('the deer gets 5 food for every week in which every area reached its target', () => {
  const at = (d, h) => new Date(2026, 10, d, h).getTime();
  const S = (cat, d, h, hrs) => ({ id: cat + d + h, name: 'x', category: cat, startedAt: at(d, h), endedAt: at(d, h + hrs), pauses: [] });
  const sessions = [S('Sosyal', 3, 18, 2), S('Çalışma', 3, 9, 6), S('Sosyal', 10, 18, 1), S('Çalışma', 10, 9, 6)];
  const targets = { Sosyal: 120, Çalışma: 300 };
  const weeks = B.balancedWeeks({ sessions, routines: [], routineLog: [], targets }, at(12, 12));
  assert.deepEqual(weeks, ['2026-11-02']);                           // week of 9 Nov: Sosyal only 1 h of 2
  assert.equal(P.deer([], [], 0, weeks.length * 5).food, 5);
  assert.deepEqual(B.balancedWeeks({ sessions, routines: [], routineLog: [], targets: {} }, at(12, 12)), []);
});

test('a task reaches its own cards and, through an idea, the idea\'s tutorials', () => {
  const idea = C.newCard({ kind: 'idea', text: 'Track 10 akım videosu' });
  const tuto = { ...C.newCard({ kind: 'tuto', title: 'Stutter effect' }), links: [idea.id] };
  const vid = C.newCard({ kind: 'inspire', url: 'https://youtu.be/dQw4w9WgXcQ' });
  const proj = P.newProject({ name: 'GYRDLA' });
  const t = P.newTask({ projectId: proj.id, title: 'x', cardIds: [idea.id, idea.id, 'gone'] });
  assert.deepEqual(t.cardIds, [idea.id, 'gone']);
  assert.deepEqual(C.cardsOfTask([idea, tuto, vid], t).map((c) => c.id), [idea.id, tuto.id]);
  const t2 = P.editTask(t, { cardIds: [vid.id, tuto.id] }, [t]);
  assert.deepEqual(C.cardsOfTask([idea, tuto, vid], t2).map((c) => c.kind), ['inspire', 'tuto']);
  // the post-it removed: the task still has the tutorial because it was copied over
  assert.deepEqual(C.cardsOfTask([tuto], { cardIds: [tuto.id] }).map((c) => c.title), ['Stutter effect']);
});
