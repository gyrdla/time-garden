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

const thumbCache = new Map();

/** Up to three small pictures and one tape taken from a day's journal page, for the mini leaf. */
function pageThumbs(page) {
  if (!page || !page.items) return { minis: [], tape: '' };
  const key = `${page.date}|${page.updatedAt}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const t = document.createElement('template');
  t.innerHTML = page.items;
  const minis = [];
  for (const n of t.content.querySelectorAll('.sticker, img')) {
    if (minis.length >= 3) break;
    if (n.tagName === 'IMG') {
      const src = n.dataset.asset ? store.getAsset(n.dataset.asset)?.dataUrl : n.getAttribute('src');
      if (src && /^data:image\//.test(src)) minis.push(`<img src="${src}" alt="">`);
    } else if (n.textContent.trim()) minis.push(esc(n.textContent.trim().slice(0, 2)));
  }
  let tape = '';
  const tp = t.content.querySelector('.washi-tape, .washi-object');
  if (tp) {
    const cls = [...tp.classList].find((c) => c.startsWith('w-'));
    const asset = tp.dataset.asset && store.getAsset(tp.dataset.asset);
    tape = cls ? `<i class="lf-tape ${cls}"></i>` : `<i class="lf-tape" style="${asset ? `background-image:url(${asset.dataUrl})` : 'background:#efc5d8'}"></i>`;
  }
  const out = { minis, tape };
  thumbCache.set(key, out);
  return out;
}

const short = (ms) => (ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)}:${String(Math.round((ms % 3_600_000) / 60_000) % 60).padStart(2, '0')}` : fmtDur(ms));

/** One day as a miniature calendar leaf showing what is on its journal page. */
function leafCell(ts, now) {
  const d = new Date(ts), iso = isoDate(ts), page = store.getPage(iso);
  const ms = ts > now ? 0 : daySum(ts, now).uniqueMs, th = pageThumbs(page);
  return `<button class="day-cell leaf${ms ? ' has' : ''}${iso === isoDate(now) ? ' today' : ''}${page ? ' page' : ''}" style="--lvl:${level(ms)}" data-day="${iso}" aria-label="${d.getDate()} ${fmtMonthName(ts)}${ms ? ', ' + fmtDur(ms) : ''}${page ? ', günlük sayfası var' : ''}">
    <small>${WEEKDAYS[(d.getDay() + 6) % 7]}</small><b>${d.getDate()}</b>${th.tape}${th.minis.map((m, i) => `<span class="lf-m p${i}">${m}</span>`).join('')}
    ${page && !th.minis.length && !th.tape ? '<span class="mark"></span>' : ''}<em>${ms ? short(ms) : ''}</em></button>`;
}

function monthView(now) {
  const d = new Date(anchor), y = d.getFullYear(), m = d.getMonth();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
  let cells = WEEKDAYS.map((w) => `<div class="weekday">${w}</div>`).join('') + '<div></div>'.repeat(offset);
  for (let i = 1; i <= days; i++) cells += leafCell(new Date(y, m, i).getTime(), now);
  $('#periodTitle').textContent = fmtMonth(anchor);
  $('#periodSub').textContent = 'Her yaprak o günün günlük sayfası';
  return `<div class="cal-grid leaves">${cells}</div>`;
}

function weekView(now) {
  const [ws, we] = periodRange('week', anchor);
  const cells = WEEKDAYS.map((_, i) => { const d = new Date(ws); d.setDate(d.getDate() + i); return leafCell(d.getTime(), now); }).join('');
  $('#periodTitle').textContent = weekTitle(ws, we);
  $('#periodSub').textContent = String(new Date(we - 1).getFullYear());
  return `<div class="cal-grid leaves week">${cells}</div>`;
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
  $$('[data-month]', content).forEach((b) => { b.onclick = () => setMode('month', Number(b.dataset.month)); });

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

function setMode(m, goTo = null) {
  // An explicit target (a month tapped in the year view) wins. Otherwise keep "today" in view
  // when the period on screen contains it, and stay where the user navigated when it does not.
  const [s, e] = periodRange(mode, anchor), now = Date.now();
  if (goTo != null) anchor = goTo;
  else if (m !== mode) anchor = now >= s && now < e ? now : s;
  mode = m;
  $$('#calendarModes button').forEach((b) => b.classList.toggle('selected', b.dataset.mode === m));
  renderCalendar();
}

export function bindCalendar() {
  $$('#calendarModes button').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
  $('#prevPeriod').onclick = () => { anchor = shiftPeriod(mode, anchor, -1); renderCalendar(); };
  $('#nextPeriod').onclick = () => { anchor = shiftPeriod(mode, anchor, 1); renderCalendar(); };
}
