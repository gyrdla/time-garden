// Plan: the "team of one" screen, separate from time tracking.
// Day as a 24-hour clock, week / month / year as circles, projects as gardens and tables.
// Tasks can be picked for a day and dragged onto the clock or onto a date.

import { $, $$, esc, icon, toast, haptic, catColor, fmtLongDate, fmtMonth, fmtMonthName, WEEKDAYS, weekTitle, toLocalInput, fromLocalInput } from './dom.js';
import * as store from '../core/store.js';
import * as P from '../core/planner.js';
import { CATEGORIES, ValidationError, isPaused } from '../core/tracker.js';
import { dayRange, isoDate, fromIso, fmtDur, fmtTime, fmtClock, fmtLive, clipAll, sessionActive, sessionElapsed, MIN } from '../core/time.js';
import { periodRange, shiftPeriod } from '../core/analytics.js';
import { openSheet, closeSheet, run } from './sheets.js';
import { renderPlanDial } from './dial.js';
import { fileToImage, makeCover } from './camera.js';

let tab = 'day';
let dayAnchor = Date.now();
let openProject = null;
const collapsed = new Set();

const AREAS = ['Bilim', 'İçerik', 'Yazılım', 'İş arama', 'Kişisel'];
const act = (p) => Promise.resolve(p).catch((e) => toast(e instanceof ValidationError ? e.message : 'Kaydedilemedi. Lütfen tekrar dene.'));
const whenText = (ts) => `${new Date(ts).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(ts)}`;
const dayText = (iso) => new Date(fromIso(iso)).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' });
const projColor = (id) => catColor(store.getProject(id)?.category);
const allTemplates = () => [...store.userTemplates(), ...P.TEMPLATES];
const todayIso = () => isoDate(Date.now());
const plan = (ts) => P.dayPlan(ts, store.state.tasks, store.state.routines, store.state.routineLog, store.state.projects);

const deerNow = () => P.deer(store.state.tasks, store.state.routineLog, store.state.settings.deer?.fed || 0);

// ── the light game layer ───────────────────────────────────────────────────
function burst(el) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = el.getBoundingClientRect();
  for (let i = 0; i < 9; i++) {
    const p = document.createElement('i');
    p.className = 'petal';
    const a = (i / 9) * 2 * Math.PI, d = 26 + Math.random() * 22;
    p.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d).toFixed(0)}px;--h:${Math.round(300 + Math.random() * 60)}`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 700);
  }
}

async function toggleTask(id, el) {
  const t = store.getTask(id);
  if (!t) return;
  const { tasks } = store.state;
  const was = P.isDone(t, tasks), before = P.stage(P.progress(tasks, t.projectId).pct).name, food0 = deerNow().food;
  if (!was) burst(el);
  try {
    const { unlocked } = await store.setTaskDone(id, !was);
    if (was) return;
    haptic(15);
    const pr = P.progress(store.state.tasks, t.projectId), st = P.stage(pr.pct), gained = deerNow().food - food0;
    const bits = [`${pr.done}/${pr.total} adım`];
    bits.push('hazineye eklendi');
    if (gained > 0) bits.push(`＋${gained} yem`);
    if (st.name !== before) bits.push(`${st.icon} ${store.getProject(t.projectId)?.name || 'Proje'} artık ${st.name}`);
    if (unlocked.length) bits.push(`Sıradaki açıldı: ${unlocked[0].title}`);
    toast(bits.join(' · '));
  } catch { toast('Kaydedilemedi. Lütfen tekrar dene.'); }
}

function startTask(id) {
  act(Promise.resolve().then(() => store.startTask(id)).then(() => { haptic(); toast('Zaman ölçümü başladı'); }));
}

/** After a tracked session ends: say how long it really took and offer to tick the step. */
export function afterFinish(session) {
  if (!session) return;
  const ms = sessionElapsed(session), t = session.taskId && store.getTask(session.taskId);
  if (!t) { toast(`Kaydedildi · ${fmtDur(ms)}`); return; }
  const total = P.actualMs(t.id, store.state.sessions, store.state.events);
  const hist = P.historyEstimate(t.title, store.state.sessions, store.state.events);
  openSheet('Adım ölçüldü', `<p class="measure"><b>${esc(t.title)}</b><span>${fmtDur(ms)}</span></p>
    <ul class="legend one"><li><span>Bu oturum</span><span>${fmtDur(ms)}</span></li><li><span>Bu adıma toplam</span><span>${fmtDur(total)}</span></li>
    <li><span>Tahminin</span><span>${t.estimateMin ? `${t.estimateMin} dk` : '—'}</span></li>${hist ? `<li><span>Bu iş sende genelde</span><span>${hist.minutes} dk (${hist.samples} kayıt)</span></li>` : ''}</ul>
    <div class="sheet-actions" style="margin-top:var(--s4)">${P.isDone(t, store.state.tasks) ? '' : '<button class="btn full" id="mDone">Adım tamamlandı</button>'}
    ${t.estimateMin ? '' : `<button class="btn ghost full" id="mEst">Tahmini ${Math.max(1, Math.round(total / MIN))} dk olarak kaydet</button>`}
    <button class="btn ghost full" id="mLater">Sonra devam edeceğim</button></div>`);
  const b = () => $('#sheetBody');
  const done = $('#mDone', b()), est = $('#mEst', b());
  if (done) done.onclick = () => { closeSheet(); toggleTask(t.id, $('#navAdd')); };
  if (est) est.onclick = () => run(() => store.updateTask(t.id, { estimateMin: Math.max(1, Math.round(total / MIN)) }), 'Tahmin kaydedildi');
  $('#mLater', b()).onclick = closeSheet;
}

function liveBar(now) {
  const s = store.activeSession();
  if (!s) return '';
  const t = s.taskId && store.getTask(s.taskId), open = store.openEvents();
  const over = t?.estimateMin ? Math.min(100, Math.round((sessionElapsed(s, now) / (t.estimateMin * MIN)) * 100)) : null;
  return `<section class="card plan-live${isPaused(s) ? ' paused' : ''}"><div class="pl-top"><span class="pulse"></span><div><b>${esc(s.name)}</b>
      <small>${isPaused(s) ? 'Duraklatıldı' : 'Ölçülüyor'}${t?.estimateMin ? ` · tahmin ${t.estimateMin} dk` : ''}${open.length ? ` · aynı anda: ${open.map((e) => `${esc(e.label)} <span data-since="${e.startedAt}">${fmtLive(now - e.startedAt)}</span>`).join(', ')}` : ''}</small></div>
      <strong id="planClock">${fmtClock(sessionElapsed(s, now))}</strong></div>
    ${over != null ? `<div class="stack"><i style="--c:var(--accent-2);width:${over}%"></i></div>` : ''}
    <div class="live-actions"><button class="btn ghost sm" id="plPause">${isPaused(s) ? 'Devam et' : 'Duraklat'}</button><button class="btn sm" id="plFinish">${icon('stop')}Bitir</button></div></section>`;
}

function bindLive(root) {
  const p = $('#plPause', root), f = $('#plFinish', root);
  if (p) p.onclick = () => act(store.togglePause());
  if (f) f.onclick = () => { haptic(20); act(store.finish().then(afterFinish)); };
}

export function tickPlan() {
  const s = store.activeSession(), el = $('#planClock');
  if (s && el) el.textContent = fmtClock(sessionElapsed(s));
  const now = Date.now();
  $$('#planScreen [data-since]').forEach((n) => { n.textContent = fmtLive(now - Number(n.dataset.since)); });
}

/** The deer card: finished steps become food, feeding makes the deer grow. */
function deerCard(now) {
  const { tasks, routineLog } = store.state;
  const d = deerNow(), today = plan(now), streak = P.streak(tasks, routineLog, now);
  return `<section class="card deer"><div class="deer-pen"><img id="deerImg" src="assets/deer.gif" alt="Geyiğim" style="--size:${d.size.toFixed(2)}" draggable="false">
      <button class="chest" id="openChest" aria-label="Hazine sandığı: ${P.treasure(tasks, store.state.routines).count} biten görev"><img src="assets/chest.webp" alt="" draggable="false"><span>${P.treasure(tasks, store.state.routines).count}</span></button></div>
    <div class="deer-info"><div class="card-head"><h2>${d.stage} geyik</h2><span class="chip${streak ? '' : ' quiet'}">${streak ? `${streak} gün seri` : 'Seri yok'}</span></div>
      <div class="stack"><i style="--c:var(--accent-2);width:${d.next ? Math.round(d.next.pct * 100) : 100}%"></i></div>
      <p>${d.next ? `${d.next.need} yem sonra ${d.next.name}` : 'En büyük hâline ulaştı'} · bugün ${today.done}/${today.total}</p>
      <button class="btn sm" id="feedDeer"${d.food ? '' : ' disabled'}>${d.food ? `Besle · ${d.food} yem` : 'Yem yok'}</button>
      ${d.food ? '' : '<small class="deer-tip">Her tamamlanan adım bir yem kazandırır.</small>'}</div></section>`;
}

/** The treasure chest: every finished step lives here, grouped by project. */
function openChest() {
  const { tasks, routines, sessions, events } = store.state, t = P.treasure(tasks, routines);
  const groups = new Map();
  for (const st of t.steps) { if (!groups.has(st.projectId)) groups.set(st.projectId, []); groups.get(st.projectId).push(st); }
  const day = (ts) => (ts ? new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : '');
  const total = t.steps.reduce((n, st) => n + P.actualMs(st.id, sessions, events), 0);
  openSheet('Hazine sandığı', `<div class="chest-head"><img src="assets/chest.webp" alt=""><div><b>${t.count} biten görev</b><small>${total ? `${fmtDur(total)} ölçülmüş emek` : 'Tamamladığın her adım burada birikir'}${t.habits.length ? ` · ${t.habits.length} kazanılmış alışkanlık` : ''}</small></div></div>
    ${t.habits.length ? `<h2 class="section-h area-h">Kazanılan alışkanlıklar</h2><div class="tray">${t.habits.map((h) => `<span class="chip">✓ ${esc(h.title)} · ${day(h.acquiredAt)}</span>`).join('')}</div>` : ''}
    ${[...groups].map(([pid, list]) => `<h2 class="section-h area-h">${esc(store.getProject(pid)?.name || 'Proje')} · ${list.length}</h2><ul class="loot">${list.map((st) => { const ms = P.actualMs(st.id, sessions, events); const parent = st.parentId && store.getTask(st.parentId);
      return `<li><span class="gem" style="--c:${projColor(pid)}"></span><div><b>${esc(st.title)}</b><small>${day(st.doneAt)}${parent ? ` · ${esc(parent.title)}` : ''}${ms ? ` · ${fmtDur(ms)}` : ''}</small></div><button class="btn ghost sm" data-undo="${st.id}">Geri al</button></li>`; }).join('')}</ul>`).join('')
      || '<p class="empty-note">Sandık henüz boş. İlk adımı tamamlayınca buraya düşer.</p>'}`);
  $$('[data-undo]', body()).forEach((b) => { b.onclick = () => act(store.setTaskDone(b.dataset.undo, false).then(() => { toast('Görev projesine geri döndü'); openChest(); })); });
}

function bindDeer(root) {
  const chest = $('#openChest', root);
  if (chest) chest.onclick = openChest;
  const b = $('#feedDeer', root);
  if (!b) return;
  b.onclick = () => {
    const img = $('#deerImg', root);
    burst(img);
    haptic(15);
    act(store.feedDeer().then(({ before, after }) => {
      const now = $('#deerImg');
      if (now) { now.classList.remove('fed'); void now.offsetWidth; now.classList.add('fed'); }
      toast(after.stage !== before.stage ? `Geyiğin büyüdü: artık ${after.stage}` : (after.next ? `Afiyet olsun · ${after.next.need} yem sonra ${after.next.name}` : 'Afiyet olsun'));
    }));
  };
}

// ── shared pieces ──────────────────────────────────────────────────────────
function dayCircle(ts, now, { selected = false } = {}) {
  const d = plan(ts), iso = isoDate(ts), all = d.total > 0 && d.done >= d.total;
  const lvl = Math.min(1, d.total / 6).toFixed(2);
  return `<button class="day-cell plan-cell${d.total ? ' has' : ''}${iso === isoDate(now) ? ' today' : ''}${selected ? ' sel' : ''}" style="--lvl:${lvl}" data-day="${ts}" data-dropday="${iso}"
    aria-label="${new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}, ${d.total} plan">${new Date(ts).getDate()}${d.total ? `<span class="cnt">${all ? '✓' : d.total}</span>` : ''}</button>`;
}

function weekRow(now, selectedIso) {
  const [ws] = periodRange('week', dayAnchor);
  return `<div class="cal-grid">${WEEKDAYS.map((w) => `<div class="weekday">${w}</div>`).join('')}${WEEKDAYS.map((_, i) => {
    const d = new Date(ws); d.setDate(d.getDate() + i);
    return dayCircle(d.getTime(), now, { selected: isoDate(d.getTime()) === selectedIso });
  }).join('')}</div>`;
}

/** A draggable chip for a task: drop it on the clock for a time, or on a day for a date. */
const chip = (t) => `<span class="drag-chip" data-drag="${t.id}" style="--c:${projColor(t.projectId)}"><span class="grip" aria-hidden="true">⠿</span><button data-task="${t.id}">${esc(t.title)}${t.estimateMin ? ` · ${t.estimateMin} dk` : ''}</button></span>`;

function waitingTasks() {
  const { tasks, projects } = store.state;
  return projects.filter((p) => !p.archived).map((p) => P.nextStep(tasks, p.id)).filter((t) => t && t.scheduledAt == null && !t.plannedDay);
}

function waitingTray(title, hint) {
  const w = waitingTasks();
  return `<section class="block"><div class="block-head"><h2>${title}</h2></div>
    ${w.length ? `<div class="tray">${w.map(chip).join('')}</div><p class="hint left">${hint}</p>`
    : `<p class="empty-note">${store.state.projects.length ? 'Her projenin sıradaki adımı bir güne yerleşmiş.' : 'Önce Projeler sekmesinden bir proje ekle.'}</p>`}</section>`;
}

// ── drag & drop ────────────────────────────────────────────────────────────
function bindDrag(root) {
  $$('[data-drag]', root).forEach((el) => {
    const grip = $('.grip', el) || el;
    grip.addEventListener('pointerdown', (e) => {
      const t = store.getTask(el.dataset.drag);
      if (!t) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      document.body.appendChild(ghost);
      let target = null, hot = null;
      const label = (txt) => { ghost.innerHTML = `<b>${esc(t.title)}</b><small>${txt}</small>`; };
      const move = (ev) => {
        ghost.style.transform = `translate(${ev.clientX}px,${ev.clientY}px)`;
        if (hot) hot.classList.remove('drop-hot');
        hot = null; target = null;
        const dial = $('#planDial');
        if (dial) {
          const r = dial.getBoundingClientRect(), dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2), dist = Math.hypot(dx, dy);
          if (dist < r.width * 0.5 && dist > r.width * 0.1) {
            const m = P.angleToMinutes(dx, dy);
            target = { minutes: m }; hot = dial.closest('.dial-wrap'); hot.classList.add('drop-hot');
            label(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')} · bırak`);
            return;
          }
        }
        ghost.style.visibility = 'hidden';
        const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-dropday]');
        ghost.style.visibility = '';
        if (under) { target = { day: under.dataset.dropday }; hot = under; hot.classList.add('drop-hot'); label(`${dayText(under.dataset.dropday)} · bırak`); }
        else label('Saate ya da bir güne sürükle');
      };
      const end = (ev) => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end);
        if (grip.hasPointerCapture(ev.pointerId)) grip.releasePointerCapture(ev.pointerId);
        ghost.remove();
        if (hot) hot.classList.remove('drop-hot');
        if (ev.type !== 'pointerup' || !target) return;
        haptic(12);
        if ('minutes' in target) {
          const ts = dayRange(dayAnchor)[0] + target.minutes * MIN;
          act(store.updateTask(t.id, { scheduledAt: ts }).then(() => toast(`${t.title} → ${whenText(ts)}`)));
        } else if (t.scheduledAt != null) {
          const old = new Date(t.scheduledAt), d = new Date(fromIso(target.day));
          const ts = new Date(d.getFullYear(), d.getMonth(), d.getDate(), old.getHours(), old.getMinutes()).getTime();
          act(store.updateTask(t.id, { scheduledAt: ts }).then(() => toast(`${t.title} → ${whenText(ts)}`)));
        } else {
          act(store.updateTask(t.id, { plannedDay: target.day }).then(() => toast(`${t.title} → ${dayText(target.day)} (saat bekliyor)`)));
        }
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
      move(e);
    });
  });
}

function bindCommon(root) {
  bindLive(root); bindDrag(root); bindDeer(root);
  $$('[data-day]', root).forEach((b) => { b.onclick = () => { dayAnchor = Number(b.dataset.day); tab = 'day'; renderPlan(); }; });
  $$('[data-task]', root).forEach((b) => { b.onclick = () => openTask(b.dataset.task); });
  $$('[data-start]', root).forEach((b) => { b.onclick = () => startTask(b.dataset.start); });
  $$('[data-today]', root).forEach((b) => { b.onclick = () => pickDay(b.dataset.today, isoDate(tab === 'day' ? dayAnchor : Date.now())); });
  $$('[data-unpick]', root).forEach((b) => { b.onclick = () => act(store.updateTask(b.dataset.unpick, { plannedDay: null })); });
}

function pickDay(id, iso) {
  const t = store.getTask(id);
  if (!t) return;
  haptic();
  act(store.updateTask(id, { plannedDay: iso }).then(() => toast(`${t.title} → ${iso === todayIso() ? 'bugün' : dayText(iso)} için seçildi`)));
}

// ── day ────────────────────────────────────────────────────────────────────
function dayItems() {
  const { tasks, routines, routineLog, projects } = store.state;
  return P.layout(P.agenda(dayRange(dayAnchor), tasks, routines, routineLog, projects));
}

function dayView(now) {
  const items = dayItems(), iso = isoDate(dayAnchor), isToday = iso === isoDate(now);
  const clash = P.conflicts(items), tray = P.dayTray(iso, store.state.tasks, store.state.projects);
  const next = isToday ? items.find((i) => !i.done && i.end > now) : null;
  const centre = !items.length ? ['Boş', tray.length ? 'saat ver' : 'plan yok'] : next ? [fmtTime(next.start), esc(next.title)] : [`${items.filter((i) => i.done).length}/${items.length}`, 'tamamlandı'];
  const color = (i) => (i.kind === 'routine' ? 'var(--accent-2)' : projColor(i.projectId));
  const row = (i) => `<div class="flow-item plan-row${i.done ? ' is-done' : ''}"${i.kind === 'task' && !i.done ? ` data-drag="${i.id}"` : ''}><span class="bar-c" style="--c:${color(i)}"></span>
    <button class="grow" data-kind="${i.kind}" data-id="${i.id}" data-slot="${i.slot || 0}"><b>${i.done ? '✓ ' : ''}${esc(i.title)}</b><small>${fmtTime(i.start)}–${fmtTime(i.end)}${i.kind === 'routine' ? ' · rutin' : ` · ${esc(store.getProject(i.projectId)?.name || '')}`}${i.parallel ? ' · aynı anda' : ''}${i.blocked ? ' · bekliyor' : ''}</small></button>
    <span class="row-acts">${i.kind === 'task' && !i.done ? '<span class="grip" aria-label="Sürükle">⠿</span>' : ''}${i.done ? '' : (i.kind === 'task' ? `<button class="icon-btn sm" data-start="${i.id}" aria-label="Başlat">${icon('play')}</button>` : `<button class="icon-btn sm" data-rdone="${i.id}" data-slot="${i.slot || 0}" aria-label="Tamamla">✓</button>`)}</span></div>`;
  const [ws, we] = periodRange('week', dayAnchor);
  return `${liveBar(now)}${isToday ? deerCard(now) : ''}
    <div class="period-nav"><button class="icon-btn sm" id="planPrev" aria-label="Önceki hafta">${icon('back')}</button><div><b>${fmtLongDate(dayAnchor)}</b><small>${isToday ? 'Bugün' : weekTitle(ws, we)}</small></div><button class="icon-btn sm" id="planNext" aria-label="Sonraki hafta">${icon('next')}</button></div>
    ${weekRow(now, iso)}
    ${clash.length ? `<p class="warn">Aynı saate denk gelen ${clash.length} çift var: ${clash.slice(0, 2).map(([a, b]) => `“${esc(a.title)}” ile “${esc(b.title)}”`).join(', ')}. Birlikte yapılabiliyorsa görevi “aynı anda yapılabilir” olarak işaretle.</p>` : ''}
    <section class="card"><div class="dial-wrap plan-dial"><svg id="planDial" class="dial" role="img" aria-label="Günün 24 saatlik planı"></svg>
      <div class="dial-center"><strong>${centre[0]}</strong><small>${centre[1]}</small></div></div>
      <p class="card-note">Dış halka plan, iç ince halka ölçülen zaman. Görevi ⠿ tutamağından sürükleyip saatin üstüne bırak.</p></section>
    <section class="block"><div class="block-head"><h2>${isToday ? 'Bugün için seçilenler' : 'Bu gün için seçilenler'}</h2></div>
      ${tray.length ? `<div class="tray">${tray.map((t) => `<span class="drag-chip" data-drag="${t.id}" style="--c:${projColor(t.projectId)}"><span class="grip" aria-hidden="true">⠿</span><button data-task="${t.id}">${esc(t.title)}${t.estimateMin ? ` · ${t.estimateMin} dk` : ''}</button><button class="mini" data-start="${t.id}" aria-label="Başlat">${icon('play')}</button><button class="mini" data-unpick="${t.id}" aria-label="Günden çıkar">×</button></span>`).join('')}</div><p class="hint left">Saat vermek için saatin üstüne sürükle; saat vermeden de başlatabilirsin.</p>`
      : '<p class="empty-note">Saat bekleyen seçili görev yok.</p>'}</section>
    ${items.length ? `<section class="block"><div class="block-head"><h2>Saatli olanlar</h2></div><div class="flow day-list">${items.map(row).join('')}</div></section>` : ''}
    <section class="block"><div class="block-head"><h2>Projelerde sıradaki adımlar</h2></div>
      ${waitingTasks().length ? `<div class="flow">${waitingTasks().map((t) => `<div class="flow-item plan-row" data-drag="${t.id}"><span class="bar-c" style="--c:${projColor(t.projectId)}"></span>
        <button class="grow" data-task="${t.id}"><b>${esc(t.title)}</b><small>${esc(store.getProject(t.projectId)?.name || '')}${t.estimateMin ? ` · ${t.estimateMin} dk` : ''}</small></button>
        <span class="row-acts"><span class="grip" aria-label="Sürükle">⠿</span><button class="btn ghost sm" data-today="${t.id}">${isToday ? 'Bugün için seç' : 'Bu güne seç'}</button></span></div>`).join('')}</div>`
      : `<p class="empty-note">${store.state.projects.length ? 'Her projenin sıradaki adımı bir güne yerleşmiş.' : 'Önce Projeler sekmesinden bir proje ekle.'}</p>`}
    </section>`;
}

function bindDay(root) {
  const now = Date.now(), range = dayRange(dayAnchor);
  const items = dayItems().map((i) => ({ ...i, color: i.kind === 'routine' ? 'var(--accent-2)' : projColor(i.projectId), label: `${esc(i.title)} ${fmtTime(i.start)}–${fmtTime(i.end)}` }));
  const actual = store.state.sessions.flatMap((s) => clipAll(sessionActive(s, now), range).map((iv) => ({ iv, color: catColor(s.category) })));
  renderPlanDial($('#planDial', root), items, actual, range, now);
  const shift = (n) => { const d = new Date(dayAnchor); d.setDate(d.getDate() + 7 * n); dayAnchor = d.getTime(); renderPlan(); };
  $('#planPrev', root).onclick = () => shift(-1);
  $('#planNext', root).onclick = () => shift(1);
  $$('[data-kind]', root).forEach((b) => { b.onclick = () => (b.dataset.kind === 'task' ? openTask(b.dataset.id) : openRoutineDay(b.dataset.id, isoDate(dayAnchor), Number(b.dataset.slot) || 0)); });
  $$('[data-rdone]', root).forEach((b) => { b.onclick = () => { haptic(15); burst(b); act(store.setRoutineDone(b.dataset.rdone, isoDate(dayAnchor), true, Number(b.dataset.slot) || 0)); }; });
}

// ── week / month / year ────────────────────────────────────────────────────
function weekView(now) {
  const [ws, we] = periodRange('week', dayAnchor), { routines } = store.state;
  let total = 0, done = 0;
  for (let i = 0; i < 7; i++) { const d = new Date(ws); d.setDate(d.getDate() + i); const p = plan(d.getTime()); total += p.total; done += p.done; }
  return `${liveBar(now)}<div class="period-nav"><button class="icon-btn sm" id="planPrev" aria-label="Önceki hafta">${icon('back')}</button><div><b>${weekTitle(ws, we)}</b><small>${total ? `${done}/${total} tamamlandı` : 'Bu hafta plan yok'}</small></div><button class="icon-btn sm" id="planNext" aria-label="Sonraki hafta">${icon('next')}</button></div>
    ${weekRow(now, null)}
    <p class="hint">Yuvarlağın içindeki sayı o günün planı. Güne dokununca saat kadranı açılır.</p>
    ${waitingTray('Güne yerleştir', 'Görevi ⠿ tutamağından sürükleyip bir günün üstüne bırak.')}
    ${habitSection()}`;
}

/** The habit chain: established → the one being built → the queue (locked). */
function habitSection() {
  const { routines, routineLog } = store.state, c = P.habitChain(routines, routineLog);
  const when = (r) => `${r.days.length === 7 ? 'her gün' : r.days.map((x) => WEEKDAYS[x]).join(' ')} · ${P.routineTimes(r).join(' + ')}`;
  const node = (r, kind, extra = '') => `<button class="habit ${kind}${r.active ? '' : ' off'}" data-routine="${r.id}"><span class="h-dot"${kind === 'now' ? ` style="--p:${Math.round(c.progress.pct * 100)}"` : ''}>${kind === 'done' ? '✓' : kind === 'now' ? `${c.progress.done}` : '🔒'}</span><b>${esc(r.title)}</b><small>${extra || when(r)}</small></button>`;
  const chain = [...c.acquired.map((r) => node(r, 'done', r.active ? '' : 'duraklatıldı')),
    ...(c.current ? [node(c.current, 'now', `${c.progress.done}/${c.progress.target} gün`)] : []),
    ...c.queued.map((r, i) => node(r, 'wait', i === 0 ? 'sırada' : `${i + 1}. sırada`))].join('<i class="h-link"></i>');
  const ready = c.current && c.progress.ready ? `<div class="card habit-ready"><p><b>“${esc(c.current.title)}”</b> ${c.progress.done} gün yapıldı. Alışkanlık oldu mu?</p>
      <div class="field-row"><button class="btn sm" id="habitWin">Evet, kazandım</button><button class="btn ghost sm" id="habitMore">7 gün daha</button></div></div>` : '';
  return `<section class="block"><div class="block-head"><h2>Alışkanlık zinciri</h2><button class="btn ghost sm" id="addRoutine">＋ ${c.current ? 'Sıraya ekle' : 'Alışkanlık'}</button></div>
    ${ready}
    ${routines.length ? `<div class="habits">${chain}</div>
      <p class="hint left">${c.current ? `Şu an yalnızca “${esc(c.current.title)}” üzerinde çalışıyorsun; ${c.progress.target} gün yapınca sıradaki açılır.` : (c.queued.length ? '' : 'Yeni bir alışkanlık ekleyebilirsin.')} Kazandıkların takvimde kalır; dokunup gününü, saatini esnetebilirsin.</p>`
    : '<p class="empty-note">Tek seferde tek alışkanlık: birini ekle, kazanana kadar onunla kal; sonra sıradaki açılır.</p>'}
    </section>`;
}

function monthView(now) {
  const d = new Date(dayAnchor), y = d.getFullYear(), m = d.getMonth();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
  let cells = WEEKDAYS.map((w) => `<div class="weekday">${w}</div>`).join('') + '<div></div>'.repeat(offset);
  for (let i = 1; i <= days; i++) cells += dayCircle(new Date(y, m, i).getTime(), now);
  return `${liveBar(now)}<div class="period-nav"><button class="icon-btn sm" id="planPrev" aria-label="Önceki ay">${icon('back')}</button><div><b>${fmtMonth(dayAnchor)}</b><small>Aylık plan</small></div><button class="icon-btn sm" id="planNext" aria-label="Sonraki ay">${icon('next')}</button></div>
    <div class="cal-grid">${cells}</div>
    ${waitingTray('Güne yerleştir', 'Görevi ⠿ tutamağından sürükleyip bir günün üstüne bırak.')}`;
}

function yearView(now) {
  const y = new Date(dayAnchor).getFullYear();
  return `${liveBar(now)}<div class="period-nav"><button class="icon-btn sm" id="planPrev" aria-label="Önceki yıl">${icon('back')}</button><div><b>${y}</b><small>Her nokta bir gün; dolu olanlarda plan var</small></div><button class="icon-btn sm" id="planNext" aria-label="Sonraki yıl">${icon('next')}</button></div>
    <div class="year-grid">${Array.from({ length: 12 }, (_, m) => {
    const n = new Date(y, m + 1, 0).getDate(), first = new Date(y, m, 1).getTime(), offset = (new Date(y, m, 1).getDay() + 6) % 7;
    let count = 0;
    const dots = '<span></span>'.repeat(offset) + Array.from({ length: n }, (_, i) => {
      const t = plan(new Date(y, m, i + 1).getTime()).tasks; count += t;
      return `<i class="${t ? 'has' : ''}" style="--lvl:${Math.min(1, t / 4).toFixed(2)}"></i>`;
    }).join('');
    return `<button class="year-month" data-month="${first}"><b>${fmtMonthName(first)}</b><div class="year-days">${dots}</div><small>${count ? `${count} görev` : '&nbsp;'}</small></button>`;
  }).join('')}</div>`;
}

function bindPeriod(root, kind) {
  const step = (n) => { dayAnchor = shiftPeriod(kind, dayAnchor, n); renderPlan(); };
  $('#planPrev', root).onclick = () => step(-1);
  $('#planNext', root).onclick = () => step(1);
  $$('[data-month]', root).forEach((b) => { b.onclick = () => { dayAnchor = Number(b.dataset.month); tab = 'month'; renderPlan(); }; });
  const add = $('#addRoutine', root);
  if (add) add.onclick = () => openRoutine();
  $$('[data-routine]', root).forEach((b) => { b.onclick = () => openRoutine(b.dataset.routine); });
  const win = $('#habitWin', root), more = $('#habitMore', root);
  const cur = P.habitChain(store.state.routines, store.state.routineLog).current;
  if (win) win.onclick = () => { burst(win); haptic(20); act(store.acquireHabit(cur.id).then((ch) => toast(ch[1] ? `Kazandın! Sıradaki açıldı: ${ch[1].title}` : 'Kazandın! Yeni bir alışkanlık ekleyebilirsin'))); };
  if (more) more.onclick = () => act(store.updateRoutine(cur.id, { targetDays: (cur.targetDays || P.HABIT_DAYS) + 7 }));
}

// ── projects ───────────────────────────────────────────────────────────────
const LIFE_CATS = ['Kişisel', 'Ev işleri', 'Sosyal', 'Çalışma', 'Öğrenme', 'Dinlenme'];
let lifeCat = LIFE_CATS[0];
const fmtMin = (m) => (m ? fmtDur(m * MIN) : '—');

export const COVERS = [['pearl', 'Sedef'], ['croc', 'Siyah deri'], ['dalmatian', 'Benekli'], ['zebra', 'Zebra'], ['fawn', 'Ceylan'], ['metal', 'Metal'], ['tiger', 'Kaplan']];

/** CSS for a project's folder: a ready-made folder picture, or the user's own photo cut to a folder shape. */
function coverStyle(cover) {
  const [type, id] = String(cover || 'preset:pearl').split(':');
  const asset = type === 'asset' ? store.getAsset(id) : null;
  if (asset) return { cls: 'custom', style: `background-image:url(${asset.dataUrl})` };
  const preset = COVERS.some((c) => c[0] === id) ? id : 'pearl';
  return { cls: '', style: `background-image:url(assets/folders/${preset}.webp)` };
}

function projectsView() {
  const { tasks, sessions, events } = store.state;
  const projects = store.state.projects.filter((p) => !p.life);
  const live = projects.filter((p) => !p.archived);
  const lifeTop = lifeCard();
  if (!projects.length) {
    return `${lifeTop}<p class="empty-note" style="margin:var(--s4) 0">Her projen burada ayrı bir klasör. Projeyi ekle, görevlerini yaz, değnekle adımlara böl, sonra günlere ve saatlere yerleştir.</p>
      <button class="btn full" id="addProject">${icon('plus')}İlk projeni ekle</button>`;
  }
  const areas = [...new Set(live.map((p) => p.area))];
  const folder = (p) => {
    const pr = P.progress(tasks, p.id), st = P.stage(pr.pct), spent = P.projectActualMs(p.id, tasks, sessions, events), c = coverStyle(p.cover);
    return `<button class="folder" data-project="${p.id}" aria-label="${esc(p.name)}, ${pr.done}/${pr.total} adım. Kapağı değiştirmek için basılı tut.">
      <span class="folder-img ${c.cls}" style="${c.style}"></span>
      <b>${esc(p.name)}</b><small>${st.icon} ${pr.total ? `${pr.done}/${pr.total} adım` : 'adım yok'}${spent ? ` · ${fmtDur(spent)}` : ''}</small>
      <span class="folder-bar"><i style="width:${Math.round(pr.pct * 100)}%"></i></span></button>`;
  };
  const archived = projects.filter((p) => p.archived);
  return `${deerCard(Date.now())}${lifeTop}${areas.map((a) => `<h2 class="section-h area-h">${esc(a)}</h2><div class="folders">${live.filter((p) => p.area === a).map(folder).join('')}</div>`).join('')}
    <p class="hint">Klasöre dokununca açılır; kapağını değiştirmek için basılı tut.</p>
    <button class="btn ghost full" id="addProject">${icon('plus')}Proje ekle</button>
    ${archived.length ? `<h2 class="section-h area-h">Arşiv</h2><div class="folders">${archived.map(folder).join('')}</div>` : ''}`;
}

/** "Hayatım": everyday things that are not a project, grouped by area. */
function lifeCard() {
  const p = store.lifeProject(), { tasks } = store.state;
  const open = p ? tasks.filter((t) => t.projectId === p.id && !P.isDone(t, tasks)) : [];
  const by = {};
  for (const t of open) by[t.category || 'Kişisel'] = (by[t.category || 'Kişisel'] || 0) + 1;
  return `<section class="card life" id="openLife"><div class="card-head"><h2>Hayatım</h2><span class="chip quiet">${open.length ? `${open.length} açık iş` : 'boş'}</span></div>
    <p>Kahvaltı, ev, arkadaşlar, mail… proje olmayan her şey burada. Düzenli yapmak istediklerini buradan alışkanlık zincirine gönderebilirsin.</p>
    ${Object.keys(by).length ? `<div class="tray" style="margin-top:var(--s2)">${Object.entries(by).map(([c, n]) => `<span class="chip"><span class="dot" style="--c:${catColor(c)}"></span>${esc(c)} · ${n}</span>`).join('')}</div>` : ''}</section>`;
}

function taskRow(t, depth) {
  const { tasks, sessions, events } = store.state;
  if (P.isDone(t, tasks)) return ''; // finished steps live in the treasure chest
  const kids = P.childrenOf(tasks, t.projectId, t.id), done = P.isDone(t, tasks), blocked = !done && P.isBlocked(t, tasks);
  const spent = P.actualMs(t.id, sessions, events), dep = t.dependsOn && store.getTask(t.dependsOn);
  const when = t.scheduledAt != null ? whenText(t.scheduledAt) : (t.plannedDay ? `${t.plannedDay === todayIso() ? 'bugün' : dayText(t.plannedDay)} (saat yok)` : '');
  const meta = [kids.length ? `${kids.filter((k) => P.isDone(k, tasks)).length}/${kids.length} adım` : '', t.estimateMin ? `${t.estimateMin} dk` : '', spent ? `ölçülen ${fmtDur(spent)}` : '',
    t.category && store.getProject(t.projectId)?.life ? esc(t.category) : '', when, blocked && dep ? `bekliyor: ${esc(dep.title)}` : (dep ? `sonra: ${esc(dep.title)}` : ''), t.parallel ? 'aynı anda' : ''].filter(Boolean).join(' · ');
  const isOpen = !collapsed.has(t.id), picked = t.plannedDay === todayIso();
  return `<li class="t-row${done ? ' done' : ''}${blocked ? ' blocked' : ''}" style="--d:${Math.min(depth, 4)}">
      <button class="t-check" data-toggle="${t.id}" role="checkbox" aria-checked="${done}" aria-label="${done ? 'Geri al' : 'Tamamla'}: ${esc(t.title)}">${done ? '✓' : ''}</button>
      <button class="t-main" data-task="${t.id}"><b>${esc(t.title)}</b>${meta ? `<small>${meta}</small>` : ''}${t.how ? `<small class="how">${esc(t.how)}</small>` : ''}</button>
      <span class="t-acts">${kids.length ? `<button data-fold="${t.id}" aria-label="${isOpen ? 'Kapat' : 'Aç'}">${isOpen ? '▾' : '▸'}</button>` : (done ? '' : `<button data-start="${t.id}" aria-label="Başlat">${icon('play')}</button>`)}
      ${done || kids.length ? '' : `<button data-today="${t.id}" class="${picked ? 'on' : ''}" aria-label="Bugün için seç" aria-pressed="${picked}">☀</button>`}
      ${done ? '' : `<button data-break="${t.id}" aria-label="Adımlara böl">${icon('spark')}</button>`}</span>
    </li>${isOpen ? kids.map((k) => taskRow(k, depth + 1)).join('') : ''}`;
}

function projectDetail(p, now) {
  const { tasks, sessions, events } = store.state;
  const pr = P.progress(tasks, p.id), st = P.stage(pr.pct), roots = P.childrenOf(tasks, p.id, null);
  const planned = P.leaves(tasks, p.id).reduce((n, t) => n + (t.estimateMin || 0), 0), spent = P.projectActualMs(p.id, tasks, sessions, events);
  return `${liveBar(now)}<div class="period-nav"><button class="icon-btn sm" id="projBack" aria-label="Projelere dön">${icon('back')}</button><div><b>${esc(p.name)}</b><small>${esc(p.area)} · ${esc(p.category)}</small></div>${p.life ? '<span style="width:36px"></span>' : '<button class="icon-btn sm" id="projEdit" aria-label="Projeyi düzenle">✎</button>'}</div>
    <section class="card game"><div class="card-head"><h2><span class="stage">${st.icon}</span>${st.name}</h2><span class="chip quiet">${pr.done}/${pr.total} adım</span></div>
      <div class="stack"><i style="--c:${catColor(p.category)};width:${Math.round(pr.pct * 100)}%"></i></div>
      <p>Tahmin ${fmtMin(planned)} · Ölçülen ${spent ? fmtDur(spent) : '—'}</p>${p.note ? `<p>${esc(p.note)}</p>` : ''}</section>
    <ul class="tree">${roots.map((t) => taskRow(t, 0)).join('') || `<li class="empty-note">${pr.total ? 'Bu projedeki tüm adımlar bitti ve hazine sandığında.' : 'Bu projede henüz görev yok. Aşağıya yaz ya da adımlara böl.'}</li>`}</ul>
    ${pr.done ? `<p class="hint left">Biten ${pr.done} adım hazine sandığında duruyor.</p>` : ''}
    ${p.life ? `<div class="chips" id="lifeCats">${LIFE_CATS.map((c, i) => `<button type="button" class="chip${i === 0 ? ' chosen' : ''}" data-cat="${esc(c)}"><span class="dot" style="--c:${catColor(c)}"></span>${esc(c)}</button>`).join('')}</div>` : ''}
    <form class="quick-add" id="quickAdd"><input name="title" placeholder="${p.life ? 'Örn. Arkadaşımı ara, Çamaşır, Mail' : 'Yeni görev yaz, Enter\'a bas'}" maxlength="160" autocomplete="off" aria-label="Yeni görev"><button class="icon-btn sm" aria-label="Ekle">${icon('plus')}</button></form>
    ${p.life ? '' : `<button class="btn ghost full" id="projBreak">${icon('spark')}Projeyi adımlara böl</button>`}`;
}

function bindProjects(root) {
  const add = $('#addProject', root);
  if (add) add.onclick = () => openProjectSheet();
  const life = $('#openLife', root);
  if (life) life.onclick = () => act(store.ensureLife().then((lp) => { openProject = lp.id; renderPlan(); window.scrollTo(0, 0); }));
  $$('[data-project]', root).forEach((b) => {
    // Tap opens the project; pressing and holding opens the cover picker instead.
    let timer = 0, held = false, sx = 0, sy = 0;
    const cancel = () => clearTimeout(timer);
    const hold = () => {
      if (held) return;
      held = true; cancel(); haptic(18);
      // The finger is still down: swallow the tap its release would otherwise land on the sheet.
      const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
      const off = () => setTimeout(() => window.removeEventListener('click', swallow, true), 80);
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.addEventListener('pointerup', off, { once: true });
      window.addEventListener('pointercancel', off, { once: true });
      openCoverSheet(b.dataset.project);
    };
    b.addEventListener('pointerdown', (e) => { held = false; sx = e.clientX; sy = e.clientY; cancel(); timer = setTimeout(hold, 450); });
    b.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, cancel);
    // Some browsers report a long press as a context-menu request instead of letting the timer finish.
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); hold(); });
    b.onclick = () => { if (held) { held = false; return; } openProject = b.dataset.project; renderPlan(); window.scrollTo(0, 0); };
  });
  if (!openProject) return;
  const p = store.getProject(openProject);
  $('#projBack', root).onclick = () => { openProject = null; renderPlan(); };
  const pe = $('#projEdit', root);
  if (pe) pe.onclick = () => openProjectSheet(p.id);
  const pb = $('#projBreak', root);
  if (pb) pb.onclick = () => openBreakdown({ projectId: p.id, id: null, title: p.name });
  $$('#lifeCats [data-cat]', root).forEach((b) => {
    b.classList.toggle('chosen', b.dataset.cat === lifeCat);
    b.onclick = () => { lifeCat = b.dataset.cat; $$('#lifeCats [data-cat]', root).forEach((x) => x.classList.toggle('chosen', x === b)); };
  });
  $('#quickAdd', root).onsubmit = (e) => {
    e.preventDefault();
    const title = e.target.title.value;
    if (!title.trim()) return;
    act(store.addTask({ projectId: p.id, title, ...(p.life ? { category: lifeCat } : {}) }).then(() => { const i = $('#quickAdd input'); if (i) i.focus(); }));
  };
  $$('[data-toggle]', root).forEach((b) => { b.onclick = () => toggleTask(b.dataset.toggle, b); });
  $$('[data-break]', root).forEach((b) => { b.onclick = () => openBreakdown(store.getTask(b.dataset.break)); });
  $$('[data-fold]', root).forEach((b) => { b.onclick = () => { const id = b.dataset.fold; if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); renderPlan(); }; });
  $$('.t-acts [data-today]', root).forEach((b) => {
    b.onclick = () => { const t = store.getTask(b.dataset.today); if (t?.plannedDay === todayIso() && t.scheduledAt == null) act(store.updateTask(t.id, { plannedDay: null })); else pickDay(b.dataset.today, todayIso()); };
  });
}

// ── screen ─────────────────────────────────────────────────────────────────
export function renderPlan() {
  const now = Date.now(), body = $('#planBody');
  $$('#planTabs button').forEach((b) => b.classList.toggle('selected', b.dataset.tab === tab));
  if (tab === 'projects') {
    const p = openProject && store.getProject(openProject);
    if (!p) openProject = null;
    body.innerHTML = p ? projectDetail(p, now) : liveBar(now) + projectsView();
    bindCommon(body); bindProjects(body);
    return;
  }
  body.innerHTML = { day: dayView, week: weekView, month: monthView, year: yearView }[tab](now);
  bindCommon(body);
  if (tab === 'day') bindDay(body); else bindPeriod(body, tab);
}

export function bindPlan() {
  $$('#planTabs button').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.tab === 'projects' && tab === 'projects') openProject = null;
      // Coming back to a time view keeps the day you were on.
      tab = b.dataset.tab; renderPlan();
    };
  });
}

function openCoverSheet(id) {
  const p = store.getProject(id);
  if (!p) return;
  const mine = store.assetsOf('cover');
  const cur = p.cover || 'preset:pearl';
  const tile = (value, style, cls, label, del = '') => `<span class="cover-tile"><button class="cover-pick${value === cur ? ' chosen' : ''}" data-cover="${value}" aria-label="${esc(label)}"><span class="folder-img ${cls}" style="${style}"></span><small>${esc(label)}</small></button>${del}</span>`;
  openSheet(`${p.name} · klasör kapağı`, `<div class="cover-grid">
      ${COVERS.map(([k, label]) => tile(`preset:${k}`, `background-image:url(assets/folders/${k}.webp)`, '', label)).join('')}
      ${mine.map((a, i) => tile(`asset:${a.id}`, `background-image:url(${a.dataUrl})`, 'custom', `Benim ${i + 1}`, `<button class="cover-del" data-del="${a.id}" aria-label="Bu görseli sil">×</button>`)).join('')}
    </div>
    <div class="sheet-actions"><label class="btn full">Kendi görselimi seç<input type="file" id="coverFile" accept="image/*" hidden></label></div>
    <p class="hint">Kendi görsellerin yalnızca bu cihazda saklanır.</p>`);
  $$('[data-cover]', body()).forEach((b) => { b.onclick = () => run(() => store.updateProject(id, { cover: b.dataset.cover }), 'Kapak değişti'); });
  $$('[data-del]', body()).forEach((b) => { b.onclick = () => act(store.removeAsset(b.dataset.del).then(() => openCoverSheet(id))); });
  $('#coverFile', body()).onchange = async (e) => {
    try {
      const a = await store.addAsset('cover', makeCover(await fileToImage(e.target.files[0])));
      await store.updateProject(id, { cover: `asset:${a.id}` });
      closeSheet(); toast('Kapak değişti');
    } catch (err) { toast(err.message || 'Görsel eklenemedi.'); }
  };
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
    ${p?.life ? `<label class="field">Alan<select name="cat">${CATEGORIES.map((c) => `<option${c === (t.category || 'Kişisel') ? ' selected' : ''}>${c}</option>`).join('')}</select></label>` : ''}
    <label class="field">Tahmini süre (dakika)<input name="est" type="number" inputmode="numeric" min="1" max="1440" value="${t.estimateMin ?? ''}" placeholder="30"></label>
    ${hist ? `<div class="chips"><button type="button" class="chip" data-est="${hist.minutes}">Bu iş sende genelde ${hist.minutes} dk sürüyor (${hist.samples} kayıt)</button></div>` : ''}
    <label class="field">Ne zaman? (saatli)<input name="when" type="datetime-local" value="${t.scheduledAt != null ? toLocalInput(t.scheduledAt) : ''}"></label>
    <div class="chips">${slots.map((s) => `<button type="button" class="chip" data-slot="${s.ts}">${whenText(s.ts)} · ${esc(s.why)}</button>`).join('')}${t.scheduledAt != null ? '<button type="button" class="chip" data-slot="">Saati kaldır</button>' : ''}</div>
    <label class="field">Ya da yalnızca gün seç (saat sonra)<input name="day" type="date" value="${t.plannedDay || ''}"></label>
    <div class="chips"><button type="button" class="chip" data-pick="${todayIso()}">Bugün için seç</button><button type="button" class="chip" data-pick="${isoDate(Date.now() + 86_400_000)}">Yarın</button><button type="button" class="chip" data-pick="">Günü kaldır</button></div>
    <label class="field">Zincir: şu bitince başlasın<select name="dep"><option value="">— bağımsız —</option>${deps.map((x) => `<option value="${x.id}"${x.id === t.dependsOn ? ' selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" name="par"${t.parallel ? ' checked' : ''}>Başka bir işle aynı anda yapılabilir (çekim sırasında makyaj gibi)</label>
    ${spent ? `<p class="hint">Bu göreve şimdiye kadar ölçülen: ${fmtDur(spent)}</p>` : ''}
    <p class="form-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn full">Kaydet</button>
    <div class="field-row"><button type="button" class="btn ghost" id="tStart">${icon('play')}Başlat</button><button type="button" class="btn ghost" id="tBreak">${icon('spark')}Adımlara böl</button></div>
    ${p?.life ? '<button type="button" class="btn ghost full" id="tHabit">↻ Düzenli yapmak istiyorum: alışkanlık zincirine gönder</button>' : ''}
    <button type="button" class="btn ghost full" id="tSub">＋ Alt adım ekle</button>
    ${kids ? '<button type="button" class="btn ghost full" id="tTpl">Bu adımları şablon olarak kaydet</button>' : ''}
    <button type="button" class="btn danger full" id="del">Görevi sil</button></div></form>`);
  const f = $('#f', body());
  $$('[data-est]', body()).forEach((b) => { b.onclick = () => { f.est.value = b.dataset.est; }; });
  $$('[data-slot]', body()).forEach((b) => { b.onclick = () => { f.when.value = b.dataset.slot ? toLocalInput(Number(b.dataset.slot)) : ''; }; });
  $$('[data-pick]', body()).forEach((b) => { b.onclick = () => { f.day.value = b.dataset.pick; if (!b.dataset.pick) f.when.value = ''; }; });
  const patch = () => ({ ...(f.cat ? { category: f.cat.value } : {}), title: f.title.value, how: f.how.value, estimateMin: f.est.value, plannedDay: f.day.value || null, scheduledAt: f.when.value ? fromLocalInput(f.when.value) : null, dependsOn: f.dep.value || null, parallel: f.par.checked });
  f.onsubmit = (e) => { e.preventDefault(); run(() => store.updateTask(t.id, patch()), 'Kaydedildi'); };
  $('#tStart', body()).onclick = () => run(() => store.updateTask(t.id, patch()).then(() => store.startTask(t.id)), 'Zaman ölçümü başladı');
  $('#tBreak', body()).onclick = () => openBreakdown(store.getTask(t.id));
  const th = $('#tHabit', body());
  if (th) th.onclick = () => run(() => store.updateTask(t.id, patch()).then(() => store.taskToHabit(t.id)).then((r) => toast(r.status === 'active' ? `“${r.title}” alışkanlık oldu; şimdi onun üzerinde çalışıyorsun` : `“${r.title}” alışkanlık zincirinde sıraya girdi`)));
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
  if (!projects.length) { closeSheet(); tab = 'projects'; import('./nav.js').then((n) => { n.go('plan'); openProjectSheet(); }); toast('Önce bir proje ekle'); return; }
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
  const r = id ? store.getRoutine(id) : null, status = r ? (r.status || 'acquired') : null;
  const willQueue = !r && store.state.routines.some((x) => x.status === 'active');
  const label = { active: 'Şu an üzerinde çalıştığın alışkanlık', queued: 'Sırada bekliyor; öncekini kazanınca açılır', acquired: 'Kazanılmış alışkanlık; gününü ve saatini esnetebilirsin' };
  openSheet(r ? 'Alışkanlık' : 'Yeni alışkanlık', `<form id="f">
    ${r ? `<p class="hint" style="text-align:left;margin-top:0">${label[status]}</p>` : (willQueue ? '<p class="hint" style="text-align:left;margin-top:0">Şu an başka bir alışkanlık üzerinde çalışıyorsun; bu sıraya eklenecek.</p>' : '')}
    <label class="field">Ne?<input name="title" required maxlength="160" value="${esc(r?.title || '')}" autocomplete="off"></label>
    <div class="days" role="group" aria-label="Günler">${WEEKDAYS.map((d, i) => `<label><input type="checkbox" name="d${i}"${!r || r.days.includes(i) ? ' checked' : ''}><span>${d}</span></label>`).join('')}</div>
    <label class="field">Alan (denge halkasında bu alana sayılır)<select name="cat">${CATEGORIES.map((c) => `<option${c === (r?.category || 'Kişisel') ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
    <div class="field"><span>Günde hangi saatlerde? (sabah ve akşam gibi birden fazla olabilir)</span><div class="times" id="times"></div>
      <button type="button" class="chip add" id="addTime">＋ Saat ekle</button></div>
    <label class="field">Her seferi kaç dakika?<input type="number" inputmode="numeric" name="est" min="1" max="1440" value="${r?.estimateMin || 30}"></label>
    ${status === 'acquired' ? '' : `<label class="field">Kaç gün yapınca alışkanlık sayılsın?<input type="number" inputmode="numeric" name="target" min="1" max="365" value="${r?.targetDays || P.HABIT_DAYS}"></label>`}
    <label class="check"><input type="checkbox" name="par"${r?.parallel ? ' checked' : ''}>Başka bir işle aynı anda yapılabilir</label>
    ${status === 'acquired' ? `<label class="check"><input type="checkbox" name="active"${r.active ? ' checked' : ''}>Takvimde göster (kapatınca duraklar)</label>` : ''}
    <p class="form-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn full">Kaydet</button>${r ? '<button type="button" class="btn danger full" id="del">Alışkanlığı sil</button>' : ''}</div></form>`);
  const f = $('#f', body());
  if (!r) f.title.focus();
  const box = $('#times', body());
  const addTime = (v) => {
    if (box.children.length >= 4) return;
    const row = document.createElement('span');
    row.className = 'time-row';
    row.innerHTML = `<input type="time" required value="${v}" aria-label="Saat"><button type="button" aria-label="Bu saati kaldır">×</button>`;
    $('button', row).onclick = () => { if (box.children.length > 1) row.remove(); };
    box.appendChild(row);
  };
  (r ? P.routineTimes(r) : ['09:00']).forEach(addTime);
  $('#addTime', body()).onclick = () => addTime('21:00');
  f.onsubmit = (e) => {
    e.preventDefault();
    const input = { title: f.title.value, days: WEEKDAYS.map((_, i) => i).filter((i) => f['d' + i].checked), times: $$('#times input', body()).map((i) => i.value).filter(Boolean), category: f.cat.value, estimateMin: f.est.value, parallel: f.par.checked };
    if (f.target) input.targetDays = f.target.value;
    run(() => (r ? store.updateRoutine(r.id, { ...input, ...(f.active ? { active: f.active.checked } : {}) }) : store.addRoutine(input)), r ? 'Kaydedildi' : (willQueue ? 'Sıraya eklendi' : 'Alışkanlık başladı'));
  };
  if (r) $('#del', body()).onclick = () => { if (confirm(`“${r.title}” silinsin mi?`)) run(() => store.removeRoutine(r.id), 'Silindi'); };
}

function openRoutineDay(id, date, slot = 0) {
  const r = store.getRoutine(id);
  if (!r) return;
  const logId = slot ? `${id}|${date}|${slot}` : `${id}|${date}`, t = P.routineTimes(r)[slot] || r.time;
  const done = store.state.routineLog.some((l) => l.id === logId);
  openSheet(r.title, `<div class="menu">
    <button id="rDone">${icon('spark')}<div><b>${done ? 'Geri al' : 'Yapıldı olarak işaretle'}</b><small>${t} · ${r.estimateMin} dk · alışkanlık</small></div></button>
    <button id="rEdit">${icon('cal')}<div><b>Alışkanlığı düzenle</b><small>Günler, saatler, süre</small></div></button></div>`);
  $('#rDone', body()).onclick = (e) => { haptic(15); if (!done) burst(e.currentTarget); run(() => store.setRoutineDone(id, date, !done, slot), done ? 'Geri alındı' : 'Yapıldı · ＋1 yem'); };
  $('#rEdit', body()).onclick = () => openRoutine(id);
}
