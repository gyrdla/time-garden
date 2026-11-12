// Home: live timer, today's 24-hour dial, today's flow, week preview.

import { $, $$, esc, icon, toast, haptic, catColor, fmtLongDate, WEEKDAYS } from './dom.js';
import * as store from '../core/store.js';
import { isPaused, ValidationError } from '../core/tracker.js';
import { dayRange, summarize, sessionElapsed, sessionActive, eventInterval, clip, clipAll, total, fmtDur, fmtClock, fmtLive, fmtTime, isoDate, DAY } from '../core/time.js';
import { renderDial } from './dial.js';
import { openStart, openSecondary, openPast, openEditSession, openEditEvent } from './sheets.js';
import { openDay } from './nav.js';
import { afterFinish } from './plan.js';
import { todayLoad } from '../core/planner.js';
import { renderStudio } from './studio.js';
import { renderCombos } from './combos.js';
import { renderChains } from './chains.js';

function act(promise) {
  Promise.resolve(promise).catch((e) => toast(e instanceof ValidationError ? e.message : 'Kaydedilemedi. Lütfen tekrar dene.'));
}

function renderLive() {
  const card = $('#liveCard'), s = store.activeSession(), now = Date.now();
  const open = store.openEvents();

  if (!s) {
    card.className = 'card live compact';
    card.innerHTML = `<div class="live-row"><span class="idle-title">Şu an ne yapıyorsun?</span>
      <button class="btn sm" id="startBtn">${icon('play')}Başlat</button><button class="chip add" id="addSecondary">＋ Paralel</button></div>${parallelHtml(now)}`;
    $('#startBtn').onclick = openStart;
  } else {
    const paused = isPaused(s);
    card.className = 'card live compact' + (paused ? ' paused' : '');
    card.innerHTML = `<div class="live-row"><span class="pulse"></span><button class="live-name" id="editLive">${esc(s.name)}<small>${paused ? 'duraklatıldı' : `${fmtTime(s.startedAt)}'den beri`}</small></button>
      <span class="live-clock" id="liveClock">${fmtClock(sessionElapsed(s, now))}</span>
      <button class="mini-btn" id="pauseBtn" aria-label="${paused ? 'Devam et' : 'Duraklat'}">${icon(paused ? 'play' : 'pause')}</button>
      <button class="mini-btn stop" id="finishBtn" aria-label="Bitir">${icon('stop')}</button></div>
      ${parallelHtml(now)}<div class="chips"><button class="chip add" id="addSecondary">＋ Paralel</button></div>`;
    $('#editLive').onclick = () => openEditSession(s.id);
    $('#pauseBtn').onclick = () => { haptic(); act(store.togglePause()); };
    $('#finishBtn').onclick = () => { haptic(20); act(store.finish().then(afterFinish)); };
  }
  bindParallel(card);
  const more = $('#addSecondary');
  if (more) more.onclick = () => openSecondary();
}

function renderToday() {
  const now = Date.now(), range = dayRange(now);
  const st = store.state, { sessions, events } = st;
  const sum = summarize(sessions, events, range, now);
  $('#todayTitle').textContent = fmtLongDate(now);
  renderDial($('#dial'), sessions, events, range, now);
  $('#dialValue').textContent = fmtDur(sum.uniqueMs);
  $('#dialLabel').textContent = 'kayıtlı';
  const L = todayLoad(st.tasks, st.routines, st.routineLog, st.projects, sessions, events, now);
  const fits = L.ms <= L.leftMs;
  $('#todayStats').innerHTML = `<li><span>Kalan</span><b>${fmtDur(L.leftMs)}</b></li>
    <li><span>Plan</span><b>${L.count ? `≈ ${fmtDur(L.ms)}` : '—'}</b>${L.count ? `<em class="${fits ? 'ok' : 'over'}">${fits ? 'sığıyor' : `${fmtDur(L.ms - L.leftMs)} fazla`}</em>` : ''}</li>
    ${L.next ? `<li class="next"><span>Sırada</span><b>${esc(L.next.title)}</b><em>${fmtTime(L.next.start)}</em></li>` : (L.picked ? `<li class="next"><span>Seçili</span><b>${L.picked} görev</b></li>` : '')}`;
  const cats = Object.entries(sum.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4);
  $('#todayLegend').innerHTML = cats.map(([c, ms]) => `<span><i class="dot" style="--c:${catColor(c)}"></i>${esc(c)} ${fmtDur(ms)}</span>`).join('');
}

/** Every parallel record that is running or paused, each with its own pause / resume and finish. */
export function parallelHtml(now = Date.now()) {
  const list = [...store.openEvents(), ...store.pausedEvents(now)];
  if (!list.length) return '';
  return `<ul class="par-list">${list.map((e) => {
    const base = store.stretchesMs(e, now), running = e.endedAt == null;
    const time = running ? `<span data-since="${e.startedAt}" data-base="${base}">${fmtLive(base + now - e.startedAt)}</span>` : fmtLive(base + e.endedAt - e.startedAt);
    return `<li class="${running ? 'run' : 'held'}"><span class="pulse"></span><b>${esc(e.label)}</b><span class="t">${time}</span>
      <button class="mini-btn" data-${running ? 'ppause' : 'presume'}="${e.id}" aria-label="${running ? 'Duraklat' : 'Devam et'}: ${esc(e.label)}">${icon(running ? 'pause' : 'play')}</button>
      <button class="mini-btn" data-pend="${e.id}" data-held="${running ? '' : '1'}" aria-label="Bitir: ${esc(e.label)}">${icon('stop')}</button></li>`;
  }).join('')}</ul>`;
}

export function bindParallel(root) {
  $$('[data-ppause]', root).forEach((b) => { b.onclick = () => { haptic(); act(store.pauseSecondary(b.dataset.ppause)); }; });
  $$('[data-presume]', root).forEach((b) => { b.onclick = () => { haptic(); act(store.resumeSecondary(b.dataset.presume)); }; });
  $$('[data-pend]', root).forEach((b) => { b.onclick = () => { haptic(12); act(b.dataset.held ? store.dropPaused(b.dataset.pend) : store.endSecondary(b.dataset.pend)); }; });
}

const tag = (r) => (r.source === 'manual' ? '<span class="tag">elle</span>' : '');

/** Timeline rows for one day; used by Home and by the Analysis day view. */
export function flowHtml(range, now = Date.now()) {
  const { sessions, events } = store.state;
  const inDay = (iv) => iv && clip(iv, range);
  const rows = [];
  const used = new Set();
  for (const s of sessions) {
    if (!inDay([s.startedAt, s.endedAt ?? now])) continue;
    const ms = total(clipAll(sessionActive(s, now), range));
    rows.push(`<button class="flow-item" data-session="${s.id}"><span class="bar-c" style="--c:${catColor(s.category)}"></span>
      <div><b>${esc(s.name)}${tag(s)}</b><small>${fmtTime(s.startedAt)} – ${s.endedAt ? fmtTime(s.endedAt) : 'sürüyor'} · ${esc(s.category)}</small></div><span class="dur">${fmtDur(ms)}</span></button>`);
    for (const e of store.eventsOf(s.id)) { used.add(e.id); rows.push(eventRow(e, now)); }
  }
  for (const e of events) if (!used.has(e.id) && inDay(eventInterval(e, now))) rows.push(eventRow(e, now));
  return rows.join('');
}

function eventRow(e, now) {
  return `<button class="flow-item sub" data-event="${e.id}"><span class="bar-c"></span>
    <div><b>${esc(e.label)}${tag(e)}${e.attention === 'background' ? '<span class="tag">arka plan</span>' : ''}</b><small>${fmtTime(e.startedAt)} – ${e.endedAt ? fmtTime(e.endedAt) : 'sürüyor'}</small></div><span class="dur"${e.endedAt ? '' : ` data-since="${e.startedAt}"`}>${e.endedAt ? fmtDur(e.endedAt - e.startedAt) : fmtLive(now - e.startedAt)}</span></button>`;
}

export function bindFlow(root) {
  $$('[data-session]', root).forEach((b) => { b.onclick = () => openEditSession(b.dataset.session); });
  $$('[data-event]', root).forEach((b) => { b.onclick = () => openEditEvent(b.dataset.event); });
}

let flowOpen = false;
try { flowOpen = localStorage.getItem('tg-flow-open') === '1'; } catch { /* private mode */ }

function renderFlow() {
  const el = $('#todayFlow'), range = dayRange(Date.now());
  const n = store.state.sessions.filter((x) => x.startedAt < range[1] && (x.endedAt ?? Date.now()) > range[0]).length;
  $('#flowCount').textContent = n ? `${n} kayıt` : 'boş';
  $('#flowToggle').setAttribute('aria-expanded', String(flowOpen));
  $('#flowToggle .fold-ic').textContent = flowOpen ? '▾' : '▸';
  el.hidden = !flowOpen;
  if (!flowOpen) return;
  el.innerHTML = flowHtml(range) || '<p class="empty-note">Gün boş bir sayfa. Bir etkinlik başlatınca burada belirir.</p>';
  bindFlow(el);
}

export function renderHome() {
  renderLive(); renderToday(); renderCombos(); renderChains(); renderStudio(); renderFlow();
}

/** Called every second while Home is visible: only the cheap, changing bits. */
export function tickHome() {
  const s = store.activeSession(), el = $('#liveClock');
  if (s && el) el.textContent = fmtClock(sessionElapsed(s));
  tickSince($('#homeScreen'));
}

/** Repaint every running duration (elements carrying data-since) under `root`. */
export function tickSince(root) {
  const now = Date.now();
  $$('[data-since]', root).forEach((n) => { n.textContent = fmtLive(Number(n.dataset.base || 0) + now - Number(n.dataset.since)); });
}

export function bindHome() {
  $('#addPast').onclick = () => openPast('session');
  $('#flowToggle').onclick = () => { flowOpen = !flowOpen; try { localStorage.setItem('tg-flow-open', flowOpen ? '1' : '0'); } catch { /* private mode */ } renderFlow(); };
}
