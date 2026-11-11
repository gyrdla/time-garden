// Plan: the "team of one" screen. Day agenda (plan next to what was really tracked),
// week overview with routines, and projects broken down into nested steps.

import { $, $$, esc, icon, toast, haptic, catColor, fmtLongDate, WEEKDAYS, toLocalInput, fromLocalInput } from './dom.js';
import * as store from '../core/store.js';
import * as P from '../core/planner.js';
import { CATEGORIES, ValidationError } from '../core/tracker.js';
import { dayRange, isoDate, fmtDur, fmtTime, clipAll, sessionActive, MIN } from '../core/time.js';
import { periodRange } from '../core/analytics.js';
import { openSheet, closeSheet, run } from './sheets.js';
import { go } from './nav.js';

let tab = 'day';
let dayAnchor = Date.now();
let openProject = null;
const collapsed = new Set();

const HOUR = 56; // px per hour in the agenda
const AREAS = ['Bilim', 'İçerik', 'Yazılım', 'İş arama', 'Kişisel'];
const act = (p) => Promise.resolve(p).catch((e) => toast(e instanceof ValidationError ? e.message : 'Kaydedilemedi. Lütfen tekrar dene.'));
const whenText = (ts) => `${new Date(ts).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(ts)}`;
const projColor = (id) => catColor(store.getProject(id)?.category);
const allTemplates = () => [...store.userTemplates(), ...P.TEMPLATES];

// ── completing things (the light game layer) ───────────────────────────────
async function toggleTask(id) {
  const t = store.getTask(id);
  if (!t) return;
  const { tasks } = store.state;
  const was = P.isDone(t, tasks), before = P.stage(P.progress(tasks, t.projectId).pct).name;
  try {
    const { unlocked } = await store.setTaskDone(id, !was);
    if (was) return;
    haptic(15);
    const pr = P.progress(store.state.tasks, t.projectId), st = P.stage(pr.pct);
    const bits = [`${pr.done}/${pr.total} adım`];
    if (st.name !== before) bits.push(`${st.icon} ${store.getProject(t.projectId)?.name || 'Proje'} artık ${st.name}`);
    if (unlocked.length) bits.push(`Sıradaki açıldı: ${unlocked[0].title}`);
    toast(bits.join(' · '));
  } catch { toast('Kaydedilemedi. Lütfen tekrar dene.'); }
}

function startTask(id) {
  act(Promise.resolve().then(() => store.startTask(id)).then(() => { haptic(); toast('Zaman ölçümü başladı'); go('home'); }));
}

// ── day ────────────────────────────────────────────────────────────────────
function gameStrip(now) {
  const { tasks, routineLog, routines } = store.state;
  const today = dayRange(now), items = P.agenda(today, tasks, routines, routineLog, store.state.projects);
  const doneToday = P.doneOn(isoDate(now), tasks, routineLog);
  const planned = items.length, plannedDone = items.filter((i) => i.done).length;
  const streak = P.streak(tasks, routineLog, now);
  const pct = planned ? Math.round((plannedDone / planned) * 100) : 0;
  return `<section class="card game"><div class="card-head"><h2>${planned ? `Bugünün planı ${plannedDone}/${planned}` : 'Bugün için plan yok'}</h2>
    <span class="chip${streak ? '' : ' quiet'}">${streak ? `${streak} gün seri` : 'Seri başlamadı'}</span></div>
    <div class="stack"><i style="--c:var(--accent-2);width:${pct}%"></i></div>
    <p>${doneToday ? `Bugün ${doneToday} adım tamamlandı.` : 'İlk adımı tamamlayınca burada birikir.'}</p></section>`;
}

function dayView(now) {
  const range = dayRange(dayAnchor);
  const { tasks, routines, routineLog, sessions, projects } = store.state;
  const items = P.layout(P.agenda(range, tasks, routines, routineLog, projects));
  const actual = sessions.flatMap((s) => clipAll(sessionActive(s, now), range).map((iv) => ({ iv, s })));
  const hourOf = (ts) => (ts - range[0]) / 3_600_000;
  const all = [...items.map((i) => [i.start, i.end]), ...actual.map((a) => a.iv)];
  const h0 = Math.max(0, Math.min(7, Math.floor(Math.min(...all.map((x) => hourOf(x[0])), 7))));
  const h1 = Math.min(24, Math.max(22, Math.ceil(Math.max(...all.map((x) => hourOf(x[1])), 22))));
  const y = (ts) => (Math.max(h0, Math.min(h1, hourOf(ts))) - h0) * HOUR;
  const isToday = isoDate(dayAnchor) === isoDate(now);

  let grid = '';
  for (let h = h0; h <= h1; h++) grid += `<div class="ag-hour" style="top:${(h - h0) * HOUR}px"><span>${String(h % 24).padStart(2, '0')}:00</span></div>`;
  const blocks = items.map((i) => {
    const top = y(i.start), height = Math.max(30, y(i.end) - top - 2);
    return `<button class="ag-item${height < 40 ? ' short' : ''}${i.done ? ' done' : ''}${i.kind === 'routine' ? ' routine' : ''}${i.parallel ? ' par' : ''}" data-kind="${i.kind}" data-id="${i.id}"
      style="top:${top}px;height:${height}px;--col:${i.col};--cols:${i.cols};--c:${i.kind === 'routine' ? 'var(--accent-2)' : projColor(i.projectId)}">
      <b>${i.done ? '✓ ' : ''}${esc(i.title)}</b><small>${fmtTime(i.start)}–${fmtTime(i.end)}${i.kind === 'routine' ? ' · rutin' : ''}${i.parallel ? ' · aynı anda' : ''}${i.blocked ? ' · bekliyor' : ''}</small></button>`;
  }).join('');
  const real = actual.map(({ iv, s }) => `<i class="ag-real" title="${esc(s.name)}" style="top:${y(iv[0])}px;height:${Math.max(3, y(iv[1]) - y(iv[0]))}px;--c:${catColor(s.category)}"></i>`).join('');
  const nowLine = isToday && hourOf(now) >= h0 && hourOf(now) <= h1 ? `<div class="ag-now" style="top:${y(now)}px"></div>` : '';
  const clash = P.conflicts(items);

  const waiting = projects.filter((p) => !p.archived).map((p) => P.nextStep(tasks, p.id)).filter((t) => t && t.scheduledAt == null);
  return `${isToday ? gameStrip(now) : ''}
    <div class="period-nav"><button class="icon-btn sm" id="planPrev" aria-label="Önceki gün">${icon('back')}</button><div><b>${fmtLongDate(dayAnchor)}</b><small>${isToday ? 'Bugün' : 'Solda plan, sağ şeritte ölçülen zaman'}</small></div><button class="icon-btn sm" id="planNext" aria-label="Sonraki gün">${icon('next')}</button></div>
    ${clash.length ? `<p class="warn">Aynı saate denk gelen ${clash.length} çift var: ${clash.slice(0, 2).map(([a, b]) => `“${esc(a.title)}” ile “${esc(b.title)}”`).join(', ')}. Birlikte yapılabiliyorsa görevi “aynı anda yapılabilir” olarak işaretle.</p>` : ''}
    <div class="agenda" style="height:${(h1 - h0) * HOUR + 12}px">${grid}${blocks}${real}${nowLine}</div>
    <p class="hint">Solda planladıkların, sağdaki ince şeritte gerçekten ölçülen zaman.</p>
    <section class="block"><div class="block-head"><h2>Sırada bekleyenler</h2></div>
      ${waiting.length ? `<div class="flow">${waiting.map((t) => `<div class="flow-item plan-row"><span class="bar-c" style="--c:${projColor(t.projectId)}"></span>
        <button class="grow" data-task="${t.id}"><b>${esc(t.title)}</b><small>${esc(store.getProject(t.projectId)?.name || '')}${t.estimateMin ? ` · ${t.estimateMin} dk` : ''}</small></button>
        <button class="btn ghost sm" data-task="${t.id}">Saat ver</button></div>`).join('')}</div>`
      : `<p class="empty-note">${projects.length ? 'Her projenin sıradaki adımı takvimde.' : 'Önce Projeler sekmesinden bir proje ekle.'}</p>`}
    </section>`;
}

function bindDay(root) {
  $('#planPrev', root).onclick = () => { const d = new Date(dayAnchor); d.setDate(d.getDate() - 1); dayAnchor = d.getTime(); renderPlan(); };
  $('#planNext', root).onclick = () => { const d = new Date(dayAnchor); d.setDate(d.getDate() + 1); dayAnchor = d.getTime(); renderPlan(); };
  $$('.ag-item', root).forEach((b) => {
    b.onclick = () => (b.dataset.kind === 'task' ? openTask(b.dataset.id) : openRoutineDay(b.dataset.id, isoDate(dayAnchor)));
  });
  $$('[data-task]', root).forEach((b) => { b.onclick = () => openTask(b.dataset.task); });
}

// ── week ───────────────────────────────────────────────────────────────────
function weekView(now) {
  const [ws] = periodRange('week', dayAnchor);
  const { tasks, routines, routineLog, projects } = store.state;
  const days = WEEKDAYS.map((name, i) => {
    const d = new Date(ws); d.setDate(d.getDate() + i);
    const r = dayRange(d.getTime());
    return { name, ts: r[0], items: P.agenda(r, tasks, routines, routineLog, projects) };
  });
  const [, we] = periodRange('week', dayAnchor);
  return `<div class="period-nav"><button class="icon-btn sm" id="planPrev" aria-label="Önceki hafta">${icon('back')}</button><div><b>${new Date(ws).getDate()} – ${new Date(we - 1).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}</b><small>Haftalık plan</small></div><button class="icon-btn sm" id="planNext" aria-label="Sonraki hafta">${icon('next')}</button></div>
    <div class="week-plan">${days.map((d) => `<button class="wp-day${isoDate(d.ts) === isoDate(now) ? ' today' : ''}" data-day="${d.ts}">
      <span class="wp-date"><small>${d.name}</small><b>${new Date(d.ts).getDate()}</b></span>
      <span class="wp-items">${d.items.length ? d.items.map((i) => `<span class="wp-item${i.done ? ' done' : ''}" style="--c:${i.kind === 'routine' ? 'var(--accent-2)' : projColor(i.projectId)}">${fmtTime(i.start)} ${esc(i.title)}${i.kind === 'routine' ? ' ↻' : ''}</span>`).join('') : '<span class="wp-empty">boş</span>'}</span></button>`).join('')}</div>
    <section class="block"><div class="block-head"><h2>Rutinler</h2><button class="btn ghost sm" id="addRoutine">＋ Rutin</button></div>
      ${routines.length ? `<div class="flow">${routines.map((r) => `<button class="flow-item" data-routine="${r.id}"><span class="bar-c" style="--c:var(--accent-2)"></span>
        <div><b>${esc(r.title)}${r.active ? '' : '<span class="tag">kapalı</span>'}</b><small>${r.days.length === 7 ? 'Her gün' : r.days.map((x) => WEEKDAYS[x]).join(', ')} · ${r.time} · ${r.estimateMin} dk</small></div><span class="dur">↻</span></button>`).join('')}</div>`
      : '<p class="empty-note">Her hafta tekrarlayan işlerini rutin olarak ekle; takvimde kendiliğinden görünür.</p>'}
    </section>`;
}

function bindWeek(root) {
  const shift = (n) => { const d = new Date(dayAnchor); d.setDate(d.getDate() + 7 * n); dayAnchor = d.getTime(); renderPlan(); };
  $('#planPrev', root).onclick = () => shift(-1);
  $('#planNext', root).onclick = () => shift(1);
  $$('[data-day]', root).forEach((b) => { b.onclick = () => { dayAnchor = Number(b.dataset.day); setTab('day'); }; });
  $('#addRoutine', root).onclick = () => openRoutine();
  $$('[data-routine]', root).forEach((b) => { b.onclick = () => openRoutine(b.dataset.routine); });
}

// ── projects ───────────────────────────────────────────────────────────────
function projectsView() {
  const { projects, tasks, sessions, events } = store.state;
  const live = projects.filter((p) => !p.archived);
  if (!live.length && !projects.length) {
    return `<p class="empty-note" style="margin-bottom:var(--s4)">Her projen burada ayrı bir bahçe. Projeyi ekle, görevlerini yaz, sihirli değnekle adımlara böl.</p>
      <button class="btn full" id="addProject">${icon('plus')}İlk projeni ekle</button>`;
  }
  const areas = [...new Set(live.map((p) => p.area))];
  const card = (p) => {
    const pr = P.progress(tasks, p.id), st = P.stage(pr.pct), next = P.nextStep(tasks, p.id);
    const spent = P.projectActualMs(p.id, tasks, sessions, events);
    return `<button class="card project" data-project="${p.id}"><div class="card-head"><h2><span class="stage" title="${st.name}">${st.icon}</span>${esc(p.name)}</h2><span class="chip quiet">${st.name}</span></div>
      <div class="stack"><i style="--c:${catColor(p.category)};width:${Math.round(pr.pct * 100)}%"></i></div>
      <p>${pr.total ? `${pr.done}/${pr.total} adım` : 'Henüz adım yok'}${spent ? ` · ${fmtDur(spent)} çalışıldı` : ''}${next ? ` · sıradaki: ${esc(next.title)}` : ''}</p></button>`;
  };
  const archived = projects.filter((p) => p.archived);
  return `${areas.map((a) => `<h2 class="section-h area-h">${esc(a)}</h2>${live.filter((p) => p.area === a).map(card).join('')}`).join('')}
    <button class="btn ghost full" id="addProject">${icon('plus')}Proje ekle</button>
    ${archived.length ? `<h2 class="section-h area-h">Arşiv</h2>${archived.map(card).join('')}` : ''}`;
}

function taskRow(t, depth) {
  const { tasks, sessions, events } = store.state;
  const kids = P.childrenOf(tasks, t.projectId, t.id), done = P.isDone(t, tasks), blocked = !done && P.isBlocked(t, tasks);
  const spent = P.actualMs(t.id, sessions, events);
  const dep = t.dependsOn && store.getTask(t.dependsOn);
  const meta = [
    kids.length ? `${kids.filter((k) => P.isDone(k, tasks)).length}/${kids.length} adım` : '',
    t.estimateMin ? `${t.estimateMin} dk` : '', spent ? `ölçülen ${fmtDur(spent)}` : '',
    t.scheduledAt != null ? whenText(t.scheduledAt) : '', blocked && dep ? `bekliyor: ${esc(dep.title)}` : (dep ? `sonra: ${esc(dep.title)}` : ''), t.parallel ? 'aynı anda' : '',
  ].filter(Boolean).join(' · ');
  const isOpen = !collapsed.has(t.id);
  return `<li class="t-row${done ? ' done' : ''}${blocked ? ' blocked' : ''}" style="--d:${Math.min(depth, 4)}">
      <button class="t-check" data-toggle="${t.id}" role="checkbox" aria-checked="${done}" aria-label="${done ? 'Geri al' : 'Tamamla'}: ${esc(t.title)}">${done ? '✓' : ''}</button>
      <button class="t-main" data-task="${t.id}"><b>${esc(t.title)}</b>${meta ? `<small>${meta}</small>` : ''}${t.how ? `<small class="how">${esc(t.how)}</small>` : ''}</button>
      <span class="t-acts">${kids.length ? `<button data-fold="${t.id}" aria-label="${isOpen ? 'Kapat' : 'Aç'}">${isOpen ? '▾' : '▸'}</button>` : (done ? '' : `<button data-start="${t.id}" aria-label="Başlat">${icon('play')}</button>`)}
      ${done ? '' : `<button data-break="${t.id}" aria-label="Adımlara böl">${icon('spark')}</button>`}</span>
    </li>${isOpen ? kids.map((k) => taskRow(k, depth + 1)).join('') : ''}`;
}

function projectDetail(p) {
  const { tasks, sessions, events } = store.state;
  const pr = P.progress(tasks, p.id), st = P.stage(pr.pct), roots = P.childrenOf(tasks, p.id, null);
  const planned = P.leaves(tasks, p.id).reduce((n, t) => n + (t.estimateMin || 0), 0);
  const spent = P.projectActualMs(p.id, tasks, sessions, events);
  return `<div class="period-nav"><button class="icon-btn sm" id="projBack" aria-label="Projelere dön">${icon('back')}</button><div><b>${esc(p.name)}</b><small>${esc(p.area)} · ${esc(p.category)}</small></div><button class="icon-btn sm" id="projEdit" aria-label="Projeyi düzenle">✎</button></div>
    <section class="card game"><div class="card-head"><h2><span class="stage">${st.icon}</span>${st.name}</h2><span class="chip quiet">${pr.done}/${pr.total} adım</span></div>
      <div class="stack"><i style="--c:${catColor(p.category)};width:${Math.round(pr.pct * 100)}%"></i></div>
      <p>Planlanan ${planned ? fmtDur(planned * MIN) : '—'} · Ölçülen ${spent ? fmtDur(spent) : '—'}</p>${p.note ? `<p>${esc(p.note)}</p>` : ''}</section>
    <ul class="tree">${roots.map((t) => taskRow(t, 0)).join('') || '<li class="empty-note">Bu projede henüz görev yok. Aşağıya yaz ya da adımlara böl.</li>'}</ul>
    <form class="quick-add" id="quickAdd"><input name="title" placeholder="Yeni görev yaz, Enter'a bas" maxlength="160" autocomplete="off" aria-label="Yeni görev"><button class="icon-btn sm" aria-label="Ekle">${icon('plus')}</button></form>
    <button class="btn ghost full" id="projBreak">${icon('spark')}Projeyi adımlara böl</button>`;
}

function bindProjects(root) {
  const add = $('#addProject', root);
  if (add) add.onclick = () => openProjectSheet();
  $$('[data-project]', root).forEach((b) => { b.onclick = () => { openProject = b.dataset.project; renderPlan(); window.scrollTo(0, 0); }; });
  if (!openProject) return;
  const p = store.getProject(openProject);
  $('#projBack', root).onclick = () => { openProject = null; renderPlan(); };
  $('#projEdit', root).onclick = () => openProjectSheet(p.id);
  $('#projBreak', root).onclick = () => openBreakdown({ projectId: p.id, id: null, title: p.name });
  $('#quickAdd', root).onsubmit = (e) => {
    e.preventDefault();
    const f = e.target, title = f.title.value;
    if (!title.trim()) return;
    act(store.addTask({ projectId: p.id, title }).then(() => { const i = $('#quickAdd input'); if (i) i.focus(); }));
  };
  $$('[data-toggle]', root).forEach((b) => { b.onclick = () => toggleTask(b.dataset.toggle); });
  $$('[data-task]', root).forEach((b) => { b.onclick = () => openTask(b.dataset.task); });
  $$('[data-start]', root).forEach((b) => { b.onclick = () => startTask(b.dataset.start); });
  $$('[data-break]', root).forEach((b) => { b.onclick = () => openBreakdown(store.getTask(b.dataset.break)); });
  $$('[data-fold]', root).forEach((b) => { b.onclick = () => { const id = b.dataset.fold; if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); renderPlan(); }; });
}

// ── screen ─────────────────────────────────────────────────────────────────
export function renderPlan() {
  const now = Date.now(), body = $('#planBody');
  $$('#planTabs button').forEach((b) => b.classList.toggle('selected', b.dataset.tab === tab));
  if (tab === 'day') { body.innerHTML = dayView(now); bindDay(body); }
  else if (tab === 'week') { body.innerHTML = weekView(now); bindWeek(body); }
  else {
    const p = openProject && store.getProject(openProject);
    if (!p) openProject = null;
    body.innerHTML = p ? projectDetail(p) : projectsView();
    bindProjects(body);
  }
}

function setTab(t) { tab = t; renderPlan(); }

export function bindPlan() {
  $$('#planTabs button').forEach((b) => { b.onclick = () => { if (b.dataset.tab === 'projects' && tab === 'projects') openProject = null; setTab(b.dataset.tab); }; });
}

/** Remaining planned items for today — shown on Home. */
export function upNextHtml(now = Date.now()) {
  const { tasks, routines, routineLog, projects } = store.state;
  const items = P.agenda(dayRange(now), tasks, routines, routineLog, projects).filter((i) => !i.done).slice(0, 3);
  return items.map((i) => `<div class="flow-item plan-row"><span class="bar-c" style="--c:${i.kind === 'routine' ? 'var(--accent-2)' : projColor(i.projectId)}"></span>
    <button class="grow" data-up-kind="${i.kind}" data-up="${i.id}"><b>${esc(i.title)}</b><small>${fmtTime(i.start)}–${fmtTime(i.end)}${i.kind === 'routine' ? ' · rutin' : ` · ${esc(store.getProject(i.projectId)?.name || '')}`}</small></button>
    ${i.kind === 'task' ? `<button class="icon-btn sm" data-up-start="${i.id}" aria-label="Başlat">${icon('play')}</button>` : `<button class="icon-btn sm" data-up-done="${i.id}" aria-label="Tamamla">✓</button>`}</div>`).join('');
}

export function bindUpNext(root) {
  $$('[data-up]', root).forEach((b) => { b.onclick = () => (b.dataset.upKind === 'task' ? openTask(b.dataset.up) : openRoutineDay(b.dataset.up, isoDate(Date.now()))); });
  $$('[data-up-start]', root).forEach((b) => { b.onclick = () => startTask(b.dataset.upStart); });
  $$('[data-up-done]', root).forEach((b) => { b.onclick = () => { haptic(15); act(store.setRoutineDone(b.dataset.upDone, isoDate(Date.now()), true)); }; });
}

// ── sheets ─────────────────────────────────────────────────────────────────
const body = () => $('#sheetBody');
const catOptions = (sel) => CATEGORIES.map((c) => `<option${c === sel ? ' selected' : ''}>${c}</option>`).join('');

function openProjectSheet(id = null) {
  const p = id ? store.getProject(id) : null;
  const areas = [...new Set([...store.state.projects.map((x) => x.area), ...AREAS])];
  openSheet(p ? 'Projeyi düzenle' : 'Yeni proje', `<form id="f">
    <label class="field">Proje adı<input name="name" required maxlength="160" value="${esc(p?.name || '')}" autocomplete="off"></label>
    <label class="field">Alan<input name="area" list="areas" maxlength="60" value="${esc(p?.area || '')}" placeholder="Örn. İçerik" autocomplete="off"><datalist id="areas">${areas.map((a) => `<option value="${esc(a)}">`).join('')}</datalist></label>
    <label class="field">Zaman kategorisi (sayaçta bu renkle görünür)<select name="category">${catOptions(p?.category || 'Çalışma')}</select></label>
    <label class="field">Not<textarea name="note" rows="2">${esc(p?.note || '')}</textarea></label>
    <p class="form-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn full">Kaydet</button>
    ${p ? `<button type="button" class="btn ghost full" id="arch">${p.archived ? 'Arşivden çıkar' : 'Arşivle'}</button><button type="button" class="btn danger full" id="del">Projeyi sil</button>` : ''}</div></form>`);
  const f = $('#f', body());
  if (!p) f.name.focus();
  f.onsubmit = (e) => {
    e.preventDefault();
    const input = { name: f.name.value, area: f.area.value, category: f.category.value, note: f.note.value };
    run(() => (p ? store.updateProject(p.id, input) : store.addProject(input).then((np) => { openProject = np.id; tab = 'projects'; renderPlan(); })), p ? 'Güncellendi' : 'Proje eklendi');
  };
  if (p) {
    $('#arch', body()).onclick = () => run(() => store.updateProject(p.id, { archived: !p.archived }), p.archived ? 'Arşivden çıkarıldı' : 'Arşivlendi');
    $('#del', body()).onclick = () => {
      const n = store.state.tasks.filter((t) => t.projectId === p.id).length;
      if (confirm(`“${p.name}” ve içindeki ${n} görev silinsin mi? Ölçülen zaman kayıtların silinmez.`)) run(() => { openProject = null; return store.removeProject(p.id); }, 'Silindi');
    };
  }
}

export function openTask(id) {
  const t = store.getTask(id);
  if (!t) return;
  const { tasks, sessions, events, routines, routineLog } = store.state;
  const p = store.getProject(t.projectId), hist = P.historyEstimate(t.title, sessions, events), spent = P.actualMs(t.id, sessions, events);
  const exclude = new Set([t.id, ...P.descendants(tasks, t.id).map((x) => x.id)]);
  const deps = tasks.filter((x) => x.projectId === t.projectId && !exclude.has(x.id));
  const kids = P.childrenOf(tasks, t.projectId, t.id).length;
  const slots = P.suggestSlots(t, { tasks, routines, routineLog, sessions, category: p?.category || 'Diğer' });
  openSheet('Görev', `<form id="f">
    <label class="field">Ne?<input name="title" required maxlength="160" value="${esc(t.title)}" autocomplete="off"></label>
    <label class="field">Nasıl? (yöntem, malzeme, not)<textarea name="how" rows="2" placeholder="Örn. doğal ışık, 9:16, üç plan">${esc(t.how)}</textarea></label>
    <label class="field">Tahmini süre (dakika)<input name="est" type="number" inputmode="numeric" min="1" max="1440" value="${t.estimateMin ?? ''}" placeholder="30"></label>
    ${hist ? `<div class="chips"><button type="button" class="chip" data-est="${hist.minutes}">Bu iş sende genelde ${hist.minutes} dk sürüyor (${hist.samples} kayıt)</button></div>` : ''}
    <label class="field">Ne zaman?<input name="when" type="datetime-local" value="${t.scheduledAt != null ? toLocalInput(t.scheduledAt) : ''}"></label>
    <div class="chips">${slots.map((s) => `<button type="button" class="chip" data-slot="${s.ts}">${whenText(s.ts)} · ${esc(s.why)}</button>`).join('')}${t.scheduledAt != null ? '<button type="button" class="chip" data-slot="">Saati kaldır</button>' : ''}</div>
    <label class="field">Zincir: şu bitince başlasın<select name="dep"><option value="">— bağımsız —</option>${deps.map((x) => `<option value="${x.id}"${x.id === t.dependsOn ? ' selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" name="par"${t.parallel ? ' checked' : ''}>Başka bir işle aynı anda yapılabilir (çekim sırasında makyaj gibi)</label>
    ${spent ? `<p class="hint">Bu göreve şimdiye kadar ölçülen: ${fmtDur(spent)}</p>` : ''}
    <p class="form-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn full">Kaydet</button>
    <div class="field-row"><button type="button" class="btn ghost" id="tStart">${icon('play')}Başlat</button><button type="button" class="btn ghost" id="tBreak">${icon('spark')}Adımlara böl</button></div>
    <button type="button" class="btn ghost full" id="tSub">＋ Alt adım ekle</button>
    ${kids ? '<button type="button" class="btn ghost full" id="tTpl">Bu adımları şablon olarak kaydet</button>' : ''}
    <button type="button" class="btn danger full" id="del">Görevi sil</button></div></form>`);
  const f = $('#f', body());
  $$('[data-est]', body()).forEach((b) => { b.onclick = () => { f.est.value = b.dataset.est; }; });
  $$('[data-slot]', body()).forEach((b) => { b.onclick = () => { f.when.value = b.dataset.slot ? toLocalInput(Number(b.dataset.slot)) : ''; }; });
  const patch = () => ({ title: f.title.value, how: f.how.value, estimateMin: f.est.value, scheduledAt: f.when.value ? fromLocalInput(f.when.value) : null, dependsOn: f.dep.value || null, parallel: f.par.checked });
  f.onsubmit = (e) => { e.preventDefault(); run(() => store.updateTask(t.id, patch()), 'Kaydedildi'); };
  $('#tStart', body()).onclick = () => run(() => store.updateTask(t.id, patch()).then(() => store.startTask(t.id)).then(() => go('home')), 'Zaman ölçümü başladı');
  $('#tBreak', body()).onclick = () => openBreakdown(store.getTask(t.id));
  $('#tSub', body()).onclick = () => {
    const title = prompt('Alt adım:');
    if (title && title.trim()) run(() => store.addTask({ projectId: t.projectId, parentId: t.id, title }), 'Alt adım eklendi');
  };
  if (kids) $('#tTpl', body()).onclick = () => run(() => store.saveTemplate(t.id), 'Şablon kaydedildi; aynı adlı işlerde önerilir');
  $('#del', body()).onclick = () => {
    const n = P.descendants(tasks, t.id).length;
    if (confirm(`“${t.title}”${n ? ` ve ${n} alt adımı` : ''} silinsin mi?`)) run(() => store.removeTask(t.id), 'Silindi');
  };
}

/** Break a task (or a whole project, when parent.id is null) into steps. */
export function openBreakdown(parent) {
  if (!parent) return;
  const tpls = allTemplates();
  let tpl = P.matchTemplate(parent.title, tpls), level = 2;
  openSheet('Adımlara böl', `<form id="f">
    <p class="hint" style="text-align:left;margin-top:0">“${esc(parent.title)}” için adımlar. Listeyi istediğin gibi düzenle: her satır bir adım, sonuna “30 dk” ya da “(paralel)” yazabilirsin.</p>
    <label class="field">İş türü<select name="tpl">${tpls.map((x) => `<option value="${x.id}"${x.id === tpl.id ? ' selected' : ''}>${esc(x.name)}${x.user ? ' (senin şablonun)' : ''}</option>`).join('')}</select></label>
    <div class="segmented" id="lvl"><button type="button" data-l="1">Az adım</button><button type="button" data-l="2" class="selected">Orta</button><button type="button" data-l="3">Çok ayrıntılı</button></div>
    <label class="field">Adımlar<textarea name="steps" rows="9" spellcheck="false"></textarea></label>
    <label class="check"><input type="checkbox" name="chain" checked>Zincirle: her adım bir öncekini beklesin</label>
    <p class="form-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn full">${icon('spark')}Adımları ekle</button></div>
    <p class="hint">Adımlar hazır iş akışı şablonlarından ve senin kaydettiğin şablonlardan gelir; yapay zekâ kullanılmıyor.</p></form>`);
  const f = $('#f', body());
  const fill = () => { f.steps.value = P.stepsToText(P.templateSteps(tpl, tpl.user ? 3 : level)); };
  fill();
  f.tpl.onchange = () => { tpl = tpls.find((x) => x.id === f.tpl.value) || tpl; fill(); };
  $$('#lvl button', body()).forEach((b) => { b.onclick = () => { level = Number(b.dataset.l); $$('#lvl button', body()).forEach((x) => x.classList.toggle('selected', x === b)); fill(); }; });
  f.onsubmit = (e) => {
    e.preventDefault();
    const steps = P.parseLines(f.steps.value);
    if (!steps.length) { $('.form-error', body()).textContent = 'En az bir adım yaz.'; return; }
    run(() => store.addSteps({ projectId: parent.projectId, id: parent.id }, steps, { chain: f.chain.checked }).then(() => { if (parent.id) collapsed.delete(parent.id); }), `${steps.length} adım eklendi`);
  };
}

export function openQuickTask() {
  const projects = store.state.projects.filter((p) => !p.archived);
  if (!projects.length) { closeSheet(); tab = 'projects'; go('plan'); openProjectSheet(); toast('Önce bir proje ekle'); return; }
  openSheet('Görev ekle', `<form id="f">
    <label class="field">Proje<select name="project">${projects.map((p) => `<option value="${p.id}"${p.id === openProject ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <label class="field">Ne?<input name="title" required maxlength="160" autocomplete="off"></label>
    <p class="form-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn full">Ekle ve ayrıntıları aç</button></div></form>`);
  const f = $('#f', body());
  f.title.focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { const t = await store.addTask({ projectId: f.project.value, title: f.title.value }); openTask(t.id); }
    catch (err) { $('.form-error', body()).textContent = err instanceof ValidationError ? err.message : 'Kaydedilemedi.'; }
  };
}

function openRoutine(id = null) {
  const r = id ? store.getRoutine(id) : null;
  openSheet(r ? 'Rutini düzenle' : 'Yeni rutin', `<form id="f">
    <label class="field">Ne?<input name="title" required maxlength="160" value="${esc(r?.title || '')}" autocomplete="off"></label>
    <div class="days" role="group" aria-label="Günler">${WEEKDAYS.map((d, i) => `<label><input type="checkbox" name="d${i}"${!r || r.days.includes(i) ? ' checked' : ''}><span>${d}</span></label>`).join('')}</div>
    <div class="field-row"><label class="field">Saat<input type="time" name="time" required value="${r?.time || '09:00'}"></label>
    <label class="field">Süre (dk)<input type="number" inputmode="numeric" name="est" min="1" max="1440" value="${r?.estimateMin || 30}"></label></div>
    <label class="check"><input type="checkbox" name="par"${r?.parallel ? ' checked' : ''}>Başka bir işle aynı anda yapılabilir</label>
    ${r ? `<label class="check"><input type="checkbox" name="active"${r.active ? ' checked' : ''}>Etkin</label>` : ''}
    <p class="form-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn full">Kaydet</button>${r ? '<button type="button" class="btn danger full" id="del">Rutini sil</button>' : ''}</div></form>`);
  const f = $('#f', body());
  if (!r) f.title.focus();
  f.onsubmit = (e) => {
    e.preventDefault();
    const input = { title: f.title.value, days: WEEKDAYS.map((_, i) => i).filter((i) => f['d' + i].checked), time: f.time.value, estimateMin: f.est.value, parallel: f.par.checked };
    run(() => (r ? store.updateRoutine(r.id, { ...input, active: f.active.checked }) : store.addRoutine(input)), 'Kaydedildi');
  };
  if (r) $('#del', body()).onclick = () => { if (confirm(`“${r.title}” rutini silinsin mi?`)) run(() => store.removeRoutine(r.id), 'Silindi'); };
}

function openRoutineDay(id, date) {
  const r = store.getRoutine(id);
  if (!r) return;
  const done = store.state.routineLog.some((l) => l.id === `${id}|${date}`);
  openSheet(r.title, `<div class="menu">
    <button id="rDone">${icon('spark')}<div><b>${done ? 'Bugün için geri al' : 'Tamamlandı olarak işaretle'}</b><small>${r.time} · ${r.estimateMin} dk · rutin</small></div></button>
    <button id="rEdit">${icon('cal')}<div><b>Rutini düzenle</b><small>Günler, saat, süre</small></div></button></div>`);
  $('#rDone', body()).onclick = () => { haptic(15); run(() => store.setRoutineDone(id, date, !done), done ? 'Geri alındı' : 'Rutin tamamlandı'); };
  $('#rEdit', body()).onclick = () => openRoutine(id);
}
