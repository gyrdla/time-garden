import test from 'node:test';
import assert from 'node:assert/strict';
import { projectChains } from '../src/core/chains.js';
import * as P from '../src/core/planner.js';

test('project chains branch across projects and show what waits', () => {
  const lab = P.newProject({ name: 'GYRDLAB' }), sm = P.newProject({ name: 'GYRDLA' }), site = P.newProject({ name: 'Site' });
  let n = 0; const T = (p, title, dep) => ({ ...P.newTask({ projectId: p.id, title, dependsOn: dep?.id || null }, ++n) });
  const sew = T(lab, 'Kürklü kıyafeti dik'), shoot = T(sm, 'Kıyafet çekimi', sew), edit = T(sm, 'Edit', shoot), style = T(lab, 'Kombin', sew), folio = T(site, 'Portfolyo', style);
  const lone = T(sm, 'A'), lone2 = T(sm, 'B', lone);                       // one project only: not a chain
  const [c, ...rest] = projectChains([sew, shoot, edit, style, folio, lone, lone2]);
  assert.equal(rest.length, 0);
  assert.deepEqual([c.total, c.done, c.projects.length], [5, 0, 3]);
  assert.deepEqual(c.root.kids.map((k) => k.task.title), ['Kıyafet çekimi', 'Kombin']);
  assert.deepEqual([c.root.state, c.root.kids[0].state], ['ready', 'waiting']);
  const done = projectChains([{ ...sew, done: true }, shoot, edit, style, folio])[0];
  assert.deepEqual([done.done, done.root.state, done.root.kids[0].state, done.root.kids[0].kids[0].state], [1, 'done', 'ready', 'waiting']);
  assert.equal(projectChains([sew, shoot, edit, style, folio].map((t) => ({ ...t, done: true }))).length, 0);
});
