// Home: project chains — steps in different projects that wait on each other, as a branching
// tree of small cards (sewing → garment shoot → edit, and sewing → styling → … → portfolio).

import { $, $$, esc, toast } from './dom.js';
import * as store from '../core/store.js';
import { projectChains } from '../core/chains.js';
import { descendants } from '../core/planner.js';
import { openSheet, closeSheet, run } from './sheets.js';
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

let moving = null; // id of a card being moved: the next card tapped becomes what it waits for

export function renderChains() {
  const el = $('#chainCard');
  if (!el) return;
  const list = projectChains(store.state.tasks);
  el.classList.toggle('moving', !!moving);
  el.innerHTML = `<div class="block-head"><h2>Proje zincirleri</h2><span class="grow"></span><button class="btn ghost sm" id="chainNew">＋ Zincir kur</button></div>
    ${moving ? `<div class="ch-moving"><span>“${esc(store.getTask(moving)?.title || '')}” hangi kartın ardından gelsin? Karta dokun.</span><button class="chip" id="chMoveCancel">Vazgeç</button></div>` : ''}
    ${list.length ? list.map((c) => `<div class="chain">
      <div class="ch-head"><b>${esc(c.root.task.title)}</b><span>${c.done}/${c.total} adım</span></div>
      <div class="ch-bar"><i style="width:${Math.round((c.done / c.total) * 100)}%"></i></div>
      <div class="ch-tree">${nodeHtml(c.root)}</div></div>`).join('')
    : '<p class="empty-note">Bir projedeki adım başka bir projedeki adımı bekliyorsa (dikiş bitmeden kombin videosu olmaz) burada dallanan bir zincir olarak görünür.</p>'}`;
  $('#chainNew', el).onclick = () => openNext(null);
  const cancel = $('#chMoveCancel', el);
  if (cancel) cancel.onclick = () => { moving = null; renderChains(); };
  $$('[data-chopen]', el).forEach((b) => { b.onclick = () => (moving ? moveTo(b.dataset.chopen) : openCardMenu(b.dataset.chopen)); });
  $$('[data-chadd]', el).forEach((b) => { b.onclick = () => openNext(b.dataset.chadd); });
}

function moveTo(target) {
  const id = moving;
  moving = null;
  if (target === id) { renderChains(); return; }
  store.updateTask(id, { dependsOn: target }).then(() => toast('Taşındı')).catch((e) => { toast(e instanceof ValidationError ? e.message : 'Kaydedilemedi.'); renderChains(); });
}

/** Take a card out of its chain; whatever waited on it now waits on the card before it. */
export async function unchain(id) {
  const t = store.getTask(id);
  if (!t) return;
  for (const k of store.state.tasks.filter((x) => x.dependsOn === id)) await store.updateTask(k.id, { dependsOn: t.dependsOn || null });
  await store.updateTask(id, { dependsOn: null });
}

function openCardMenu(id) {
  const t = store.getTask(id);
  if (!t) return;
  const waitsOn = t.dependsOn && store.getTask(t.dependsOn);
  openSheet(t.title, `<p class="hint" style="text-align:left;margin-top:0">${esc(areaOf(t))}${waitsOn ? ` · “${esc(waitsOn.title)}” bitince başlıyor` : ' · zincirin başı'}</p><div class="menu">
    <button id="cmNext">＋<div><b>Ardına adım ekle</b><small>Bu bitince başlayacak adım ya da yeni bir dal</small></div></button>
    <button id="cmMove">↪<div><b>Başka kartın ardına taşı</b><small>Yanlış yere eklediysen</small></div></button>
    <button id="cmOut">✕<div><b>Zincirden çıkar</b><small>Adım projesinde kalır, silinmez</small></div></button>
    <button id="cmOpen">✎<div><b>Adımı aç</b><small>Başlat, gün seç, ayrıntılar</small></div></button></div>`);
  const b = $('#sheetBody');
  $('#cmNext', b).onclick = () => openNext(id);
  $('#cmMove', b).onclick = () => { closeSheet(); moving = id; renderChains(); $('#chainCard')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  $('#cmOut', b).onclick = () => run(() => unchain(id), 'Zincirden çıkarıldı');
  $('#cmOpen', b).onclick = () => openTask(id);
}

const projects = () => [...store.state.projects.filter((p) => !p.life && !p.archived), ...store.state.projects.filter((p) => p.life)];
const pName = (p) => (p.life ? 'Hayatım' : p.name);

/**
 * Add steps by tapping: type a name, tap the project, "Ekle". The sheet stays open so the
 * chain can be written in one go: the next step follows the one just added, or branches from
 * the same card. Existing steps can be linked by tapping them.
 */
export function openNext(afterId) {
  if (!store.state.projects.length) { toast('Önce Plan › Projeler’de bir proje aç.'); return; }
  let after = afterId, proj = (afterId && store.getTask(afterId)?.projectId) || projects()[0].id;
  const trail = afterId ? [afterId] : []; // cards placed in this sheet, to branch from
  const draw = () => {
    const a = after && store.getTask(after);
    const exclude = new Set(a ? [a.id, ...descendants(store.state.tasks, a.id).map((x) => x.id)] : []);
    const open = store.state.tasks.filter((t) => !t.done && !exclude.has(t.id));
    openSheet(a ? `“${a.title}” bitince` : 'Zincirin ilk adımı', `<div class="chq">
      <input class="ts-title" id="chTitle" maxlength="160" placeholder="${a ? 'Sonraki adım' : 'İlk adım'}" autocomplete="off" enterkeyhint="done">
      <div class="chips" id="chProj">${projects().map((p) => `<button type="button" class="chip${p.id === proj ? ' chosen' : ''}" data-p="${p.id}">${esc(pName(p))}</button>`).join('')}</div>
      <button class="btn full" id="chAdd">Ekle</button>
      ${trail.filter((x) => x !== after && store.getTask(x)).length ? `<div class="ch-branch-pick"><span>↳ Dal çıkar:</span><div class="chips">${trail.filter((x) => x !== after && store.getTask(x)).map((x) => `<button type="button" class="chip quiet" data-br="${x}">${esc(store.getTask(x).title)}</button>`).join('')}</div></div>` : ''}
      <details class="ch-exist"><summary>ya da var olan bir adımı seç</summary>${projects().map((p) => {
        const l = open.filter((t) => t.projectId === p.id);
        return l.length ? `<p class="ch-exist-h">${esc(pName(p))}</p><div class="chips">${l.map((t) => `<button type="button" class="chip" data-t="${t.id}">${esc(t.title)}</button>`).join('')}</div>` : '';
      }).join('')}</details>
      ${a ? '<button type="button" class="btn ghost full" data-close>Bitti</button>' : ''}</div>`);
    const b = $('#sheetBody');
    $$('#chProj [data-p]', b).forEach((x) => { x.onclick = () => { proj = x.dataset.p; $$('#chProj .chip', b).forEach((c) => c.classList.toggle('chosen', c === x)); }; });
    const placed = (t, msg) => {
      // Next time: continue after this one; any card placed here can still take a branch.
      if (!trail.includes(t.id)) trail.push(t.id);
      after = t.id; proj = t.projectId; toast(msg); draw();
      setTimeout(() => $('#chTitle')?.focus(), 60);
    };
    const add = () => {
      const title = $('#chTitle', b).value.trim();
      if (!title) { $('#chTitle', b).focus(); return; }
      const go = proj === '__life' ? store.ensureLife().then((p) => p.id) : Promise.resolve(proj);
      go.then((pid) => store.addTask({ projectId: pid, title, dependsOn: after || null })).then((t) => placed(t, after ? 'Zincire eklendi' : 'İlk adım hazır; şimdi ardından geleni yaz'))
        .catch(() => toast('Kaydedilemedi. Lütfen tekrar dene.'));
    };
    $('#chAdd', b).onclick = add;
    $('#chTitle', b).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    $$('[data-br]', b).forEach((x) => { x.onclick = () => { after = x.dataset.br; draw(); setTimeout(() => $('#chTitle')?.focus(), 60); }; });
    $$('[data-t]', b).forEach((x) => {
      x.onclick = () => {
        const t = store.getTask(x.dataset.t);
        if (!after) { placed(t, 'İlk adım seçildi; şimdi ardından geleni yaz'); return; }
        store.updateTask(t.id, { dependsOn: after }).then(() => placed(store.getTask(t.id), 'Zincire bağlandı'))
          .catch((e) => toast(e instanceof ValidationError ? e.message : 'Kaydedilemedi.'));
      };
    });
  };
  draw();
}
