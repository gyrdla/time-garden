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
  const v = C.newCard({ kind: 'inspire', url: 'youtu.be/dQw4w9WgXcQ', ideaId: i.id });
  assert.equal(v.url, 'https://youtu.be/dQw4w9WgXcQ');
  const t = C.newCard({ kind: 'tuto', title: 'Glitch efekti', url: 'https://youtu.be/dQw4w9WgXcQ', projectId: 'p1' });
  assert.deepEqual(C.linkedTo([i, v, t], { ideaId: i.id }).map((c) => c.kind), ['inspire']);
  assert.deepEqual(C.linkedTo([i, v, t], { projectId: 'p1' }).map((c) => c.kind), ['tuto']);
  const moved = C.editCard(i, { projectId: 'p1', ideaId: 'x' });
  assert.deepEqual([moved.id, moved.projectId, moved.ideaId, moved.kind], [i.id, 'p1', null, 'idea']);
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
