// Project chains: steps in different projects that wait on each other ("starts after"), shown
// as a branching tree. One step can open several others (sewing → garment shoot and styling).

import { isDone, isBlocked } from './planner.js';

/**
 * Trees of linked steps that span at least two projects and are not all done.
 * Node { task, state:'done'|'ready'|'waiting', kids:[Node] }; tree { root, total, done, projects }.
 */
export function projectChains(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t])), kids = new Map();
  for (const t of tasks) if (t.dependsOn && byId.has(t.dependsOn)) kids.set(t.dependsOn, [...(kids.get(t.dependsOn) || []), t]);
  const out = [];
  for (const r of tasks.filter((t) => kids.has(t.id) && !(t.dependsOn && byId.has(t.dependsOn)))) {
    const all = [], seen = new Set();
    const build = (t) => {
      seen.add(t.id); all.push(t);
      const st = isDone(t, tasks) ? 'done' : isBlocked(t, tasks) ? 'waiting' : 'ready';
      return { task: t, state: st, kids: (kids.get(t.id) || []).filter((k) => !seen.has(k.id)).sort((a, b) => a.createdAt - b.createdAt).map(build) };
    };
    const root = build(r), done = all.filter((t) => isDone(t, tasks)).length, projects = new Set(all.map((t) => t.projectId));
    if (projects.size >= 2 && done < all.length) out.push({ root, total: all.length, done, projects: [...projects] });
  }
  return out.sort((a, b) => a.root.task.createdAt - b.root.task.createdAt);
}
