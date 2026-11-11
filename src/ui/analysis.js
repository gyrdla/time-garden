// Analysis: day / week / month / year. Everything shown is computed from records;
// when there is no data the screen says so instead of filling space.

import { $, $$, esc, icon, catColor, fmtFullDate, fmtMonth, fmtMonthName, WEEKDAYS, weekTitle } from './dom.js';
import * as store from '../core/store.js';
import { fmtDur, fmtTime } from '../core/time.js';
import { analyze, shiftPeriod, peakWindow } from '../core/analytics.js';
import { renderDial } from './dial.js';
import { flowHtml, bindFlow } from './home.js';

let kind = 'day';
let anchor = Date.now();

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function title(a) {
  const [s, e] = a.range;
  if (kind === 'day') return [fmtFullDate(s), 'Günlük'];
  if (kind === 'week') return [weekTitle(s, e), 'Haftalık'];
  if (kind === 'month') return [fmtMonth(s), 'Aylık'];
  return [String(new Date(s).getFullYear()), 'Yıllık'];
}

function delta(cur, prev, label) {
  if (!prev) return `<em>${label}: kayıt yok</em>`;
  const d = cur - prev;
  if (Math.abs(d) < 60_000) return `<em>${label} ile aynı</em>`;
  return `<em>${label} göre ${d > 0 ? '+' : '−'}${fmtDur(Math.abs(d))}</em>`;
}

function barChart(a) {
  const n = a.series.length, W = 320, H = 132, pad = 16, bw = (W - 8) / n;
  const max = Math.max(...a.series.map((b) => b.primaryMs), 3_600_000);
  let out = `<line class="grid" x1="0" y1="${H - pad}" x2="${W}" y2="${H - pad}"/>`;
  a.series.forEach((b, i) => {
    let y = H - pad;
    const x = 4 + i * bw + bw * 0.18, w = bw * 0.64;
    for (const [c, ms] of Object.entries(b.byCategory).sort((p, q) => q[1] - p[1])) {
      const h = (ms / max) * (H - pad - 8);
      y -= h;
      out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h - 1, 0).toFixed(1)}" rx="${Math.min(3, w / 2)}" fill="${catColor(c)}"/>`;
    }
    const d = new Date(b.range[0]);
    const lbl = kind === 'year' ? fmtMonthName(b.range[0]).slice(0, 3) : kind === 'week' ? WEEKDAYS[i] : (d.getDate() === 1 || d.getDate() % 5 === 0 ? d.getDate() : '');
    if (lbl !== '') out += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 4}">${lbl}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Dönem içi dağılım, en yüksek ${fmtDur(max)}">${out}</svg>`;
}

function facts(a) {
  const out = [];
  const peak = peakWindow(a.hours, 3);
  if (peak) out.push(`Kayıtlı ana etkinlik süren en çok ${String(peak.from).padStart(2, '0')}:00 – ${String(peak.to).padStart(2, '0')}:00 arasında (${fmtDur(peak.ms)}).`);
  const labels = Object.entries(a.sum.byLabel).filter(([, v]) => v.overlapMs > 0 && !v.background).sort((x, y) => y[1].overlapMs - x[1].overlapMs);
  if (labels.length) out.push(`Ana etkinlik sürerken en çok: ${labels.slice(0, 3).map(([n, v]) => `${esc(n)} (${fmtDur(v.overlapMs)})`).join(', ')}.`);
  if (kind !== 'day') {
    const best = [...a.series].sort((x, y) => y.focusMs - x.focusMs)[0];
    if (best && best.focusMs > 0) {
      const when = kind === 'year' ? fmtMonthName(best.range[0]) : new Date(best.range[0]).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
      out.push(`En çok odak süresi: ${when} (${fmtDur(best.focusMs)}).`);
    }
    out.push(`${a.series.length} ${kind === 'year' ? 'aydan' : 'günden'} ${a.activeDays} tanesinde kayıt var.`);
  }
  if (a.coverage && a.coverage.gapMs > 60_000) out.push(`İlk kayıt ${fmtTime(a.coverage.first)}, son kayıt ${fmtTime(a.coverage.last)}; arada ${fmtDur(a.coverage.gapMs)} kayıtsız.`);
  return out;
}

export function renderAnalysis() {
  const now = Date.now(), { sessions, events } = store.state;
  const a = analyze(kind, anchor, sessions, events, now);
  const [t, sub] = title(a);
  $('#analysisTitle').textContent = t;
  $('#analysisSub').textContent = sub;
  const body = $('#analysisBody');
  if (!a.hasData) {
    body.innerHTML = '<p class="empty-note" style="margin-bottom:var(--s4)">Bu dönemde kayıt yok. Zaman kaydettikçe analiz burada oluşur; eksik veriden tahmin üretilmez.</p>';
    return;
  }
  const s = a.sum, prevLabel = { day: 'Dün', week: 'Geçen hafta', month: 'Geçen ay', year: 'Geçen yıl' }[kind];
  const cats = Object.entries(s.byCategory).sort((x, y) => y[1] - x[1]);
  const acts = Object.entries(a.activities).sort((x, y) => y[1].ms - x[1].ms).slice(0, 6);
  const labels = Object.entries(s.byLabel).sort((x, y) => y[1].ms - x[1].ms);
  const maxLabel = Math.max(...labels.map(([, v]) => v.ms), 1);
  const f = facts(a);

  body.innerHTML = `
    <div class="kpis">
      <div class="kpi big"><small>Kayıtlı zaman (çakışmalar bir kez sayılır)</small><b>${fmtDur(s.uniqueMs)}</b>${delta(s.uniqueMs, a.prev.uniqueMs, prevLabel + '’e')}</div>
      <div class="kpi"><small>Ana etkinlik</small><b>${fmtDur(s.primaryMs)}</b></div>
      <div class="kpi"><small>Tek başına odak</small><b>${fmtDur(s.focusMs)}</b><em>ana etkinliğin %${pct(s.focusMs, s.primaryMs)}'i</em></div>
      <div class="kpi"><small>Aynı anda başka iş</small><b>${fmtDur(s.dividedMs)}</b><em>ana etkinliğin %${pct(s.dividedMs, s.primaryMs)}'i</em></div>
      <div class="kpi"><small>Mola (duraklatma)</small><b>${fmtDur(s.pausedMs)}</b></div>
      ${a.coverage ? `<div class="kpi"><small>Kayıtsız (ilk–son kayıt arası)</small><b>${fmtDur(a.coverage.gapMs)}</b></div>` : ''}
      ${s.secondaryOnlyMs ? `<div class="kpi"><small>Yalnızca paralel kayıt</small><b>${fmtDur(s.secondaryOnlyMs)}</b></div>` : ''}
    </div>

    ${kind === 'day' ? `<section class="card"><div class="card-head"><h2>24 saat</h2></div>
      <div class="dial-wrap"><svg id="aDial" class="dial" role="img" aria-label="Günün zaman haritası"></svg><div class="dial-center"><strong>${fmtDur(s.uniqueMs)}</strong><small>kayıtlı</small></div></div>
      <p class="card-note">Dış halka ana etkinlikler, iç pembe halka aynı anda yapılanlar.</p></section>`
    : `<section class="card"><div class="card-head"><h2>${kind === 'year' ? 'Aylara göre' : 'Günlere göre'}</h2><span class="chip quiet">ana etkinlik</span></div>${barChart(a)}</section>`}

    <section class="card"><div class="card-head"><h2>Zaman nereye gitti?</h2></div>
      <div class="stack">${cats.map(([c, ms]) => `<i style="--c:${catColor(c)};width:${pct(ms, s.primaryMs)}%"></i>`).join('')}</div>
      <div class="rows">${cats.map(([c, ms]) => `<div class="row-bar"><span class="lbl"><span class="dot" style="--c:${catColor(c)}"></span><span>${esc(c)}</span></span><span class="trk"><i style="--c:${catColor(c)};width:${pct(ms, cats[0][1])}%"></i></span><span class="val">${fmtDur(ms)} · %${pct(ms, s.primaryMs)}</span></div>`).join('')}</div>
    </section>

    ${acts.length > 1 || kind !== 'day' ? `<section class="card"><div class="card-head"><h2>En çok zaman alanlar</h2></div>
      <div class="rows">${acts.map(([n, v]) => `<div class="row-bar"><span class="lbl"><span class="dot" style="--c:${catColor(v.category)}"></span><span>${esc(n)}</span></span><span class="trk"><i style="--c:${catColor(v.category)};width:${pct(v.ms, acts[0][1].ms)}%"></i></span><span class="val">${fmtDur(v.ms)} · ${v.count}×</span></div>`).join('')}</div></section>` : ''}

    <section class="card"><div class="card-head"><h2>Aynı anda yapılanlar</h2><span class="chip quiet">elle işaretlendi</span></div>
      ${labels.length ? `<div class="rows">${labels.map(([n, v]) => `<div class="row-bar"><span class="lbl"><span class="dot" style="--c:var(--secondary)"></span><span>${esc(n)}</span></span><span class="trk"><i style="--c:var(--secondary);width:${pct(v.ms, maxLabel)}%"></i></span><span class="val">${fmtDur(v.ms)}</span></div>`).join('')}</div>
      <p class="card-note">Toplam ${fmtDur(s.secondaryMs)} paralel kayıt. Bu süreler ana etkinlikle üst üste biner; kayıtlı zamana ayrıca eklenmez.</p>`
      : '<p>Bu dönemde paralel kayıt yok.</p>'}
    </section>

    ${f.length ? `<section class="card"><div class="card-head"><h2>Kayıtlarından çıkanlar</h2></div><ul class="facts">${f.map((x) => `<li>${icon('spark')}<span>${x}</span></li>`).join('')}</ul></section>` : ''}

    <section class="card"><div class="card-head"><h2>Verinin kaynağı</h2></div>
      <div class="stack"><i style="--c:var(--accent-2);width:${pct(s.bySource.timer, s.primaryMs)}%"></i><i style="--c:var(--ink-faint);width:${pct(s.bySource.manual, s.primaryMs)}%"></i></div>
      <ul class="legend"><li><span class="dot" style="--c:var(--accent-2)"></span><span>Sayaçla ölçüldü</span><span>${fmtDur(s.bySource.timer)}</span></li>
      <li><span class="dot" style="--c:var(--ink-faint)"></span><span>Elle girildi</span><span>${fmtDur(s.bySource.manual)}</span></li></ul>
      <p class="card-note">Tahmini veri kullanılmıyor. Paralel kayıtların tümü elle başlatılıp bitirilir.</p>
    </section>

    ${kind === 'day' ? `<section class="block"><div class="block-head"><h2>Günün akışı</h2></div><div class="flow" id="aFlow">${flowHtml(a.range, now)}</div></section>` : ''}`;

  if (kind === 'day') {
    renderDial($('#aDial'), sessions, events, a.range, now);
    bindFlow($('#aFlow'));
  }
}

export function bindAnalysis() {
  $$('#analysisModes button').forEach((b) => {
    b.onclick = () => {
      const [s, e] = analyze(kind, anchor, [], []).range, now = Date.now();
      anchor = now >= s && now < e ? now : s;
      kind = b.dataset.range; $$('#analysisModes button').forEach((x) => x.classList.toggle('selected', x === b)); renderAnalysis(); };
  });
  $('#prevAnalysis').onclick = () => { anchor = shiftPeriod(kind, anchor, -1); renderAnalysis(); };
  $('#nextAnalysis').onclick = () => { anchor = shiftPeriod(kind, anchor, 1); renderAnalysis(); };
}
