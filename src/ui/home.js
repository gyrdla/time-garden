// Home: live timer, today's 24-hour dial, today's flow, week preview.

import { $, $$, esc, icon, toast, haptic, catColor, fmtLongDate, WEEKDAYS } from './dom.js';
import * as store from '../core/store.js';
import { isPaused, ValidationError } from '../core/tracker.js';
import { dayRange, summarize, sessionElapsed, sessionActive, eventInterval, clip, clipAll, total, fmtDur, fmtClock, fmtLive, fmtTime, isoDate, DAY } from '../core/time.js';
import { periodRange } from '../core/analytics.js';
import { renderDial } from './dial.js';
import { openStart, openSecondary, openPast, openEditSession, openEditEvent } from './sheets.js';
import { openDay } from './nav.js';
import { afterFinish } from './plan.js';

function act(promise) {
  Promise.resolve(promise).catch((e) => toast(e instanceof ValidationError ? e.message : 'Kaydedilemedi. Lütfen tekrar dene.'));
}

function renderLive() {
  const card = $('#liveCard'), s = store.activeSession(), now = Date.now();
  const open = store.openEvents();
  const chips = open.map((e) => `<button class="chip running" data-end="${e.id}">${esc(e.label)} · <span data-since="${e.startedAt}">${fmtLive(now - e.startedAt)}</span><span class="x" aria-label="Bitir">×</span></button>`).join('');
  const sub = `<div class="live-sub"><div class="chips">${chips}<button class="chip add" id="addSecondary">＋ Paralel</button></div></div>`;

  if (!s) {
    card.className = 'card live';
    card.innerHTML = `<p class="idle-title">Şu an ne yapıyorsun?</p><p class="idle-sub">Başlat'a bas, bitirdiğinde durdur. Süreyi saat ölçer, sen yazmazsın.</p>
      <button class="btn full" id="startBtn">${icon('play')}Etkinlik başlat</button>${sub}`;
    $('#startBtn').onclick = openStart;
  } else {
    const paused = isPaused(s);
    card.className = 'card live' + (paused ? ' paused' : '');
    card.innerHTML = `<div class="live-top"><div><p class="live-name">${esc(s.name)}</p>
      <p class="live-meta"><span class="pulse"></span>${paused ? 'Duraklatıldı' : 'Sürüyor'} · ${fmtTime(s.startedAt)}'den beri · ${esc(s.category)}</p></div>
      <button class="icon-btn sm" id="editLive" aria-label="Düzenle">✎</button></div>
      <p class="live-clock" id="liveClock">${fmtClock(sessionElapsed(s, now))}</p>
      <div class="live-actions"><button class="btn ghost" id="pauseBtn">${icon(paused ? 'play' : 'pause')}${paused ? 'Devam et' : 'Duraklat'}</button>
      <button class="btn" id="finishBtn">${icon('stop')}Bitir</button></div>${sub}`;
    $('#editLive').onclick = () => openEditSession(s.id);
    $('#pauseBtn').onclick = () => { haptic(); act(store.togglePause()); };
    $('#finishBtn').onclick = () => { haptic(20); act(store.finish().then(afterFinish)); };
  }
  $$('[data-end]', card).forEach((b) => { b.onclick = () => act(store.endSecondary(b.dataset.end)); });
  const more = $('#addSecondary');
  if (more) more.onclick = () => openSecondary();
}

function renderToday() {
  const now = Date.now(), range = dayRange(now);
  const { sessions, events } = store.state;
  const sum = summarize(sessions, events, range, now);
  $('#todayTitle').textContent = `Bugün · ${fmtLongDate(now)}`;
  $('#todayRemain').textContent = `Kalan gün ${fmtDur(range[1] - now)}`;
  renderDial($('#dial'), sessions, events, range, now);
  $('#dialValue').textContent = fmtDur(sum.uniqueMs);
  $('#dialLabel').textContent = `günün %${Math.round((sum.uniqueMs / DAY) * 100)}'i kayıtlı`;
  const cats = Object.entries(sum.byCategory).sort((a, b) => b[1] - a[1]);
  $('#todayLegend').innerHTML = cats.length
    ? cats.map(([c, ms]) => `<li><span class="dot" style="--c:${catColor(c)}"></span><span>${esc(c)}</span><span>${fmtDur(ms)}</span></li>`).join('')
      + (sum.secondaryMs ? `<li><span class="dot" style="--c:var(--secondary)"></span><span>Paralel</span><span>${fmtDur(sum.secondaryMs)}</span></li>` : '')
    : '<li class="empty">Bugün henüz kayıt yok.</li>';
  $('#todayStats').innerHTML = `<div class="stat"><b>${fmtDur(sum.primaryMs)}</b><small>Ana etkinlik</small></div>
    <div class="stat"><b>${fmtDur(sum.focusMs)}</b><small>Tek başına odak</small></div>
    <div class="stat"><b>${fmtDur(sum.concurrentMs)}</b><small>Aynı anda</small></div>`;
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

function renderFlow() {
  const el = $('#todayFlow');
  el.innerHTML = flowHtml(dayRange(Date.now())) || '<p class="empty-note">Gün boş bir sayfa. Bir etkinlik başlatınca burada belirir.</p>';
  bindFlow(el);
}

function renderWeek() {
  const now = Date.now(), [ws] = periodRange('week', now);
  const { sessions, events } = store.state;
  const days = WEEKDAYS.map((name, i) => {
    const d = new Date(ws); d.setDate(d.getDate() + i);
    const r = dayRange(d.getTime());
    return { name, ts: r[0], iso: isoDate(r[0]), ms: r[0] > now ? 0 : summarize(sessions, events, r, now).uniqueMs, page: !!store.getPage(isoDate(r[0])) };
  });
  const max = Math.max(...days.map((d) => d.ms), 1);
  $('#weekStrip').innerHTML = days.map((d) => `<button class="week-cell${d.iso === isoDate(now) ? ' today' : ''}" data-day="${d.iso}" aria-label="${d.name} ${new Date(d.ts).getDate()}, ${fmtDur(d.ms)}">
    <span>${d.name}</span><b>${new Date(d.ts).getDate()}</b><span class="fill"><i style="height:${Math.round((d.ms / max) * 100)}%"></i></span><span>${d.page ? '✎' : '&nbsp;'}</span></button>`).join('');
  $$('[data-day]', $('#weekStrip')).forEach((b) => { b.onclick = () => openDay(b.dataset.day); });
}

export function renderHome() {
  renderLive(); renderToday(); renderFlow(); renderWeek();
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
  $$('[data-since]', root).forEach((n) => { n.textContent = fmtLive(now - Number(n.dataset.since)); });
}

export function bindHome() {
  $('#addPast').onclick = () => openPast('session');
}
