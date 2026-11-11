// Calendar: month / week / year views over tracked time. Tapping a day opens its journal page.

import { $, $$, esc, catColor, fmtMonth, fmtMonthName, WEEKDAYS } from './dom.js';
import * as store from '../core/store.js';
import { dayRange, summarize, fmtDur, isoDate, DAY } from '../core/time.js';
import { periodRange, shiftPeriod } from '../core/analytics.js';
import { openDay } from './nav.js';
import { weekTitle } from './dom.js';

let mode = 'month';
let anchor = Date.now();

const daySum = (ts, now) => summarize(store.state.sessions, store.state.events, dayRange(ts), now);
const level = (ms) => Math.min(1, ms / (8 * 3_600_000)).toFixed(2); // 8 tracked hours = full tint

function monthView(now) {
  const d = new Date(anchor), y = d.getFullYear(), m = d.getMonth();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
  let cells = WEEKDAYS.map((w) => `<div class="weekday">${w}</div>`).join('') + '<div></div>'.repeat(offset);
  const today = isoDate(now);
  for (let i = 1; i <= days; i++) {
    const ts = new Date(y, m, i).getTime(), iso = isoDate(ts);
    const ms = ts > now ? 0 : daySum(ts, now).uniqueMs;
    cells += `<button class="day-cell${ms ? ' has' : ''}${iso === today ? ' today' : ''}" style="--lvl:${level(ms)}" data-day="${iso}" aria-label="${i} ${fmtMonthName(ts)}${ms ? ', ' + fmtDur(ms) : ''}">${i}${store.getPage(iso) ? '<span class="mark"></span>' : ''}</button>`;
  }
  $('#periodTitle').textContent = fmtMonth(anchor);
  $('#periodSub').textContent = 'Renk: kayıtlı süre · Nokta: günlük sayfası';
  return `<div class="cal-grid">${cells}</div>`;
}

function weekView(now) {
  const [ws, we] = periodRange('week', anchor);
  const today = isoDate(now);
  const cells = WEEKDAYS.map((w) => `<div class="weekday">${w}</div>`).join('') + WEEKDAYS.map((name, i) => {
    const d = new Date(ws); d.setDate(d.getDate() + i);
    const ts = d.getTime(), iso = isoDate(ts), ms = ts > now ? 0 : daySum(ts, now).uniqueMs;
    return `<button class="day-cell${ms ? ' has' : ''}${iso === today ? ' today' : ''}" style="--lvl:${level(ms)}" data-day="${iso}" aria-label="${name} ${d.getDate()}${ms ? ', ' + fmtDur(ms) : ''}">${d.getDate()}${store.getPage(iso) ? '<span class="mark"></span>' : ''}</button>`;
  }).join('') + WEEKDAYS.map((_, i) => {
    const d = new Date(ws); d.setDate(d.getDate() + i);
    const ms = d.getTime() > now ? 0 : daySum(d.getTime(), now).uniqueMs;
    return `<div class="weekday under">${ms ? (ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)}:${String(Math.round((ms % 3_600_000) / 60_000) % 60).padStart(2, '0')}` : fmtDur(ms)) : '—'}</div>`;
  }).join('');
  const last = new Date(we - 1);
  $('#periodTitle').textContent = weekTitle(ws, we);
  $('#periodSub').textContent = String(last.getFullYear());
  return `<div class="cal-grid">${cells}</div>`;
}

function yearView(now) {
  const y = new Date(anchor).getFullYear();
  $('#periodTitle').textContent = String(y);
  $('#periodSub').textContent = 'Her nokta bir gün';
  return `<div class="year-grid">${Array.from({ length: 12 }, (_, m) => {
    const n = new Date(y, m + 1, 0).getDate(), first = new Date(y, m, 1).getTime();
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;
    const dots = '<span></span>'.repeat(offset) + Array.from({ length: n }, (_, i) => {
      const ts = new Date(y, m, i + 1).getTime(), ms = ts > now ? 0 : daySum(ts, now).uniqueMs;
      return `<i class="${ms ? 'has' : ''}" style="--lvl:${level(ms)}"></i>`;
    }).join('');
    return `<button class="year-month" data-month="${first}"><b>${fmtMonthName(first)}</b><div class="year-days">${dots}</div></button>`;
  }).join('')}</div>`;
}

export function renderCalendar() {
  const now = Date.now();
  const content = $('#calendarContent');
  content.innerHTML = mode === 'month' ? monthView(now) : mode === 'week' ? weekView(now) : yearView(now);
  $$('[data-day]', content).forEach((b) => { b.onclick = () => openDay(b.dataset.day); });
  $$('[data-month]', content).forEach((b) => { b.onclick = () => { anchor = Number(b.dataset.month); setMode('month'); }; });

  const range = periodRange(mode, anchor);
  const s = summarize(store.state.sessions, store.state.events, range, now);
  const title = { month: 'Ay özeti', week: 'Hafta özeti', year: 'Yıl özeti' }[mode];
  const cats = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]);
  $('#calendarSummary').innerHTML = `<div class="card-head"><h2>${title}</h2><span class="chip quiet">${fmtDur(s.uniqueMs)} kayıtlı</span></div>`
    + (cats.length
      ? `<div class="stack">${cats.map(([c, ms]) => `<i style="--c:${catColor(c)};width:${(ms / s.primaryMs) * 100}%"></i>`).join('')}</div>
         <ul class="legend">${cats.map(([c, ms]) => `<li><span class="dot" style="--c:${catColor(c)}"></span><span>${esc(c)}</span><span>%${Math.round((ms / s.primaryMs) * 100)}</span></li>`).join('')}</ul>`
      : '<p>Bu dönemde kayıt yok.</p>');
}

function setMode(m) {
  // Keep "today" in view when the period on screen contains it; otherwise stay where the user navigated.
  const [s, e] = periodRange(mode, anchor), now = Date.now();
  if (m !== mode) anchor = now >= s && now < e ? now : s;
  mode = m;
  $$('#calendarModes button').forEach((b) => b.classList.toggle('selected', b.dataset.mode === m));
  renderCalendar();
}

export function bindCalendar() {
  $$('#calendarModes button').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
  $('#prevPeriod').onclick = () => { anchor = shiftPeriod(mode, anchor, -1); renderCalendar(); };
  $('#nextPeriod').onclick = () => { anchor = shiftPeriod(mode, anchor, 1); renderCalendar(); };
}
