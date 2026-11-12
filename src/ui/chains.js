// Home: project chains — steps in different projects that wait on each other, as a branching
// tree of small cards (sewing → garment shoot → edit, and sewing → styling → … → portfolio).

import { $, $$, esc, toast } from './dom.js';
import * as store from '../core/store.js';
import { projectChains } from '../core/chains.js';
import { descendants } from '../core/planner.js';
import { openSheet, run } from './sheets.js';
import { openTask } from './plan.js';
import { ValidationError } from '../core/tracker.js';

const STATE = { done: '✓', ready: 'sırada', waiting: 'bekliyor' };

function areaOf(t) {
  const p = store.getProject(t.projectId);
  if (!p) return '';
  return p.life ? `Hayatım · ${t.category || 'Kişisel'}` : (p.area ? `${p.name} · ${p.area}` : p.name);
}

function nodeHtml(n) {
  const card = `<div class="ch-card ${n.state}"><button type="button" class="sq ${n.state}" data-chopen="${n.task.id}">
      <span class="sq-top">${STATE[n.state]}</span><b>${esc(n.task.title)}</b><small>${esc(areaOf(n.task))}</small></button>
      <button type="button" class="ch-add" data-chadd="${n.task.id}" aria-label="“${esc(n.task.title)}” bitince başlayacak adım ekle">＋</button></div>`;
  if (!n.kids.length) return `<div class="ch-node">${card}</div>`;
  return `<div class="ch-node">${card}<div class="ch-kids${n.kids.length > 1 ? ' fork' : ''}">${n.kids.map((k) => `<div class="ch-branch"><span class="ch-arrow" aria-hidden="true">→</span>${nodeHtml(k)}</div>`).join('')}</div></div>`;
}

export function renderChains() {
  const el = $('#chainCard');
  if (!el) return;
  const list = projectChains(store.state.tasks);
  el.innerHTML = `<div class="block-head"><h2>Proje zincirleri</h2><span class="grow"></span><button class="btn ghost sm" id="chainNew">＋ Zincir kur</button></div>
    ${list.length ? list.map((c) => `<div class="chain">
      <div class="ch-head"><b>${esc(c.root.task.title)}</b><span>${c.done}/${c.total} adım</span></div>
      <div class="ch-bar"><i style="width:${Math.round((c.done / c.total) * 100)}%"></i></div>
      <div class="ch-tree">${nodeHtml(c.root)}</div></div>`).join('')
    : '<p class="empty-note">Bir projedeki adım başka bir projedeki adımı bekliyorsa (dikiş bitmeden kombin videosu olmaz) burada dallanan bir zincir olarak görünür.</p>'}`;
  $('#chainNew', el).onclick = () => openNext(null);
  $$('[data-chopen]', el).forEach((b) => { b.onclick = () => openTask(b.dataset.chopen); });
  $$('[data-chadd]', el).forEach((b) => { b.onclick = () => openNext(b.dataset.chadd); });
}

function taskOptions(exclude = new Set(), sel = '') {
  const { projects, tasks } = store.state;
  const ps = [...projects.filter((p) => !p.life && !p.archived), ...projects.filter((p) => p.life)];
  return ps.map((p) => {
    const l = tasks.filter((t) => t.projectId === p.id && !t.done && !exclude.has(t.id)).sort((a, b) => a.order - b.order);
    return l.length ? `<optgroup label="${esc(p.life ? 'Hayatım' : `${p.name}${p.area ? ` · ${p.area}` : ''}`)}">${l.map((t) => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${t.parentId ? '· ' : ''}${esc(t.title)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}

function projectOptions() {
  const ps = [...store.state.projects.filter((p) => !p.life && !p.archived), ...store.state.projects.filter((p) => p.life)];
  return `${ps.map((p) => `<option value="${p.id}">${esc(p.life ? 'Hayatım' : `${p.name}${p.area ? ` · ${p.area}` : ''}`)}</option>`).join('')}${store.lifeProject() ? '' : '<option value="__life">Hayatım</option>'}`;
}

/** Add a step that starts when `afterId` is done. A step can open several next steps (branches). */
export function openNext(afterId) {
  const after = afterId && store.getTask(afterId);
  if (!store.state.projects.length) { toast('Önce Plan › Projeler’de bir proje aç.'); return; }
  openSheet(after ? 'Sonraki adım' : 'Zincir kur', `<form id="chf">
    ${after ? `<p class="hint" style="text-align:left;margin-top:0">“${esc(after.title)}” bitince başlayacak adım. Bir adımdan birden fazla dal çıkabilir.</p>`
      : `<label class="field">Bu bitince<select name="after" required><option value="">Adım seç…</option>${taskOptions()}</select></label>`}
    <label class="field">Yeni adım<input name="title" maxlength="160" placeholder="Örn. Kombin çekimi" autocomplete="off"></label>
    <label class="field">Hangi projede<select name="proj">${projectOptions()}</select></label>
    <div class="field"><span>ya da var olan bir adımı bağla</span><select name="existing"><option value="">—</option>${taskOptions(new Set(after ? [after.id, ...descendants(store.state.tasks, after.id).map((x) => x.id)] : []))}</select></div>
    <p class="form-error" role="alert"></p><button class="btn full">Zincire ekle</button></form>`);
  const f = $('#chf', $('#sheetBody'));
  f.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const dep = after ? after.id : f.after.value;
      if (!dep) throw new ValidationError('Hangi adımdan sonra geleceğini seç.');
      if (f.existing.value) {
        if (f.existing.value === dep) throw new ValidationError('Bir adım kendini bekleyemez.');
        return store.updateTask(f.existing.value, { dependsOn: dep });
      }
      const title = f.title.value.trim();
      if (!title) throw new ValidationError('Yeni adımın adını yaz ya da var olan bir adım seç.');
      const pid = f.proj.value === '__life' ? (await store.ensureLife()).id : f.proj.value;
      return store.addTask({ projectId: pid, title, dependsOn: dep });
    }, 'Zincire eklendi');
  };
}
