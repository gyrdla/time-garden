// Bottom sheets: the Create menu, new/edit forms for primary sessions and secondary events.

import { $, $$, esc, icon, toast, toLocalInput, fromLocalInput } from './dom.js';
import * as store from '../core/store.js';
import { CATEGORIES, ValidationError } from '../core/tracker.js';
import { isoDate } from '../core/time.js';
import { openDay } from './nav.js';

const backdrop = () => $('#sheet');
const body = () => $('#sheetBody');

export function closeSheet() { backdrop().hidden = true; body().innerHTML = ''; }

export function openSheet(title, html) {
  body().innerHTML = `<div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn sm" data-close aria-label="Kapat">${icon('close')}</button></div>${html}`;
  backdrop().hidden = false;
  $('[data-close]', body()).onclick = closeSheet;
}

export function bindSheets() {
  backdrop().addEventListener('click', (e) => { if (e.target === backdrop()) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !backdrop().hidden) closeSheet(); });
}

export async function run(fn, okText) {
  const err = $('.form-error', body());
  try {
    await fn();
    closeSheet();
    if (okText) toast(okText);
  } catch (e) {
    if (e instanceof ValidationError) { if (err) err.textContent = e.message; else toast(e.message); } else { console.error(e); toast('Kaydedilemedi. Lütfen tekrar dene.'); }
  }
}

const catOptions = (sel) => CATEGORIES.map((c) => `<option${c === sel ? ' selected' : ''}>${c}</option>`).join('');
const recentChips = (kind) => {
  const names = store.recentNames(kind, 5);
  return names.length ? `<div class="chips">${names.map((n) => `<button type="button" class="chip" data-fill="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : '';
};
function bindFill(input) {
  $$('[data-fill]', body()).forEach((b) => { b.onclick = () => { input.value = b.dataset.fill; input.focus(); }; });
}

/** The central ＋ button. */
export function openCreateMenu() {
  const active = store.activeSession();
  openSheet('Yeni', `<div class="menu">
    ${active ? '' : `<button data-act="start">${icon('play')}<div><b>Etkinlik başlat</b><small>Sayaç şimdi başlar, sen bitirene kadar ölçer</small></div></button>`}
    <button data-act="secondary">${icon('plus')}<div><b>Paralel kayıt başlat</b><small>${active ? 'Ana etkinlik durmadan, üstüne eklenir' : 'Telefon, müzik gibi aynı anda yaptıkların'}</small></div></button>
    <button data-act="task">${icon('spark')}<div><b>Görev ekle</b><small>Bir projeye yeni adım; istersen saat ver</small></div></button>
    <button data-act="past">${icon('cal')}<div><b>Geçmiş kayıt ekle</b><small>Saatlerini sen girersin, “elle” olarak işaretlenir</small></div></button>
    <button data-act="journal">${icon('book')}<div><b>Bugünün günlük sayfası</b><small>Not, fotoğraf ve çıkartma ekle</small></div></button>
  </div>`);
  const acts = { task: () => import('./plan.js').then((m) => m.openQuickTask()), start: openStart, secondary: () => openSecondary(), past: () => openPast('session'), journal: () => { closeSheet(); openDay(isoDate(Date.now())); } };
  $$('[data-act]', body()).forEach((b) => { b.onclick = () => acts[b.dataset.act](); });
}

export function openStart() {
  openSheet('Etkinlik başlat', `<form id="f">
    <label class="field">Şimdi ne yapıyorsun?<input name="name" required maxlength="120" placeholder="Örn. LabOS geliştirme" autocomplete="off"></label>
    ${recentChips('session')}
    <label class="field">Kategori<select name="category">${catOptions('Çalışma')}</select></label>
    <label class="field">Not (isteğe bağlı)<textarea name="note" rows="2"></textarea></label>
    <p class="form-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn full">${icon('play')}Zamanı başlat</button></div>
  </form>`);
  const f = $('#f', body());
  bindFill(f.name);
  f.name.focus();
  f.onsubmit = (e) => { e.preventDefault(); run(() => store.start({ name: f.name.value, category: f.category.value, note: f.note.value }), 'Zaman ölçümü başladı'); };
}

export function openSecondary(preset = '') {
  openSheet('Paralel kayıt', `<form id="f">
    <label class="field">Aynı anda ne yapıyorsun?<input name="label" required maxlength="120" placeholder="Örn. Instagram" autocomplete="off" value="${esc(preset)}"></label>
    ${recentChips('event')}
    <label class="check"><input type="checkbox" name="bg">Arka planda (müzik gibi; dikkatimi bölmüyor)</label>
    <p class="form-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn full">${icon('play')}Şimdi başlat</button>
    <button type="button" class="btn ghost full" id="toPast">Geçmiş bir paralel kayıt ekle</button></div>
  </form>`);
  const f = $('#f', body());
  bindFill(f.label);
  if (!preset) f.label.focus();
  $('#toPast', body()).onclick = () => openPast('event');
  f.onsubmit = (e) => { e.preventDefault(); run(() => store.startSecondary({ label: f.label.value, attention: f.bg.checked ? 'background' : 'active' }), 'Paralel kayıt başladı'); };
}

export function openPast(kind = 'session', day = null) {
  const now = Date.now();
  let end = now, start = now - 3_600_000;
  if (day && day !== isoDate(now)) { const [y, m, d] = day.split('-').map(Number); start = new Date(y, m - 1, d, 9).getTime(); end = new Date(y, m - 1, d, 10).getTime(); }
  const isEvent = kind === 'event';
  openSheet('Geçmiş kayıt ekle', `<form id="f">
    <div class="segmented"><button type="button" data-kind="session" class="${isEvent ? '' : 'selected'}">Ana etkinlik</button><button type="button" data-kind="event" class="${isEvent ? 'selected' : ''}">Paralel kayıt</button></div>
    <label class="field">${isEvent ? 'Aynı anda ne yaptın?' : 'Ne yaptın?'}<input name="name" required maxlength="120" autocomplete="off"></label>
    ${recentChips(isEvent ? 'event' : 'session')}
    <div class="field-row"><label class="field">Başlangıç<input type="datetime-local" name="start" required value="${toLocalInput(start)}"></label>
    <label class="field">Bitiş<input type="datetime-local" name="end" required value="${toLocalInput(end)}"></label></div>
    ${isEvent ? '<label class="check"><input type="checkbox" name="bg">Arka planda (dikkatimi bölmüyor)</label>' : `<label class="field">Kategori<select name="category">${catOptions('Çalışma')}</select></label>`}
    <label class="field">Not (isteğe bağlı)<textarea name="note" rows="2"></textarea></label>
    <p class="form-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn full">Kaydı ekle</button></div>
  </form>`);
  const f = $('#f', body());
  bindFill(f.name);
  $$('[data-kind]', body()).forEach((b) => { b.onclick = () => openPast(b.dataset.kind, day); });
  f.onsubmit = (e) => {
    e.preventDefault();
    const span = { startedAt: fromLocalInput(f.start.value), endedAt: fromLocalInput(f.end.value), note: f.note.value };
    run(() => (isEvent
      ? store.addManualEvent({ ...span, label: f.name.value, attention: f.bg.checked ? 'background' : 'active' })
      : store.addManualSession({ ...span, name: f.name.value, category: f.category.value })), 'Kayıt eklendi');
  };
}

export function openEditSession(id) {
  const s = store.getSession(id);
  if (!s) return;
  const running = s.endedAt == null;
  openSheet('Etkinliği düzenle', `<form id="f">
    <label class="field">Ad<input name="name" required maxlength="120" value="${esc(s.name)}"></label>
    <label class="field">Kategori<select name="category">${catOptions(s.category)}</select></label>
    <div class="field-row"><label class="field">Başlangıç<input type="datetime-local" name="start" required value="${toLocalInput(s.startedAt)}"></label>
    ${running ? '<label class="field">Bitiş<input disabled value="Sürüyor"></label>' : `<label class="field">Bitiş<input type="datetime-local" name="end" required value="${toLocalInput(s.endedAt)}"></label>`}</div>
    <label class="field">Not<textarea name="note" rows="2">${esc(s.note || '')}</textarea></label>
    <p class="hint">${s.source === 'timer' ? 'Sayaçla ölçüldü. Saatleri değiştirirsen “elle girildi” olarak işaretlenir.' : 'Saatleri elle girildi.'}${s.pausesEstimated ? ' Eski sürümden aktarıldı; mola zamanları yaklaşık.' : ''}</p>
    <p class="form-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn full">Kaydet</button><button type="button" class="btn danger full" id="del">Etkinliği sil</button></div>
  </form>`);
  const f = $('#f', body());
  // Inputs have minute precision: only send a timestamp if the user actually changed it.
  const startWas = f.start.value, endWas = f.end?.value;
  f.onsubmit = (e) => {
    e.preventDefault();
    const patch = { name: f.name.value, category: f.category.value, note: f.note.value };
    if (f.start.value !== startWas) patch.startedAt = fromLocalInput(f.start.value);
    if (!running && f.end.value !== endWas) patch.endedAt = fromLocalInput(f.end.value);
    run(() => store.updateSession(id, patch), 'Güncellendi');
  };
  $('#del', body()).onclick = () => {
    const n = store.eventsOf(id).length;
    if (confirm(`“${s.name}” silinsin mi?${n ? ` Bağlı ${n} paralel kayıt silinmez, bağımsız kalır.` : ''}`)) run(() => store.removeSession(id), 'Silindi');
  };
}

export function openEditEvent(id) {
  const ev = store.getEvent(id);
  if (!ev) return;
  const running = ev.endedAt == null;
  openSheet('Paralel kaydı düzenle', `<form id="f">
    <label class="field">Ad<input name="label" required maxlength="120" value="${esc(ev.label)}"></label>
    <div class="field-row"><label class="field">Başlangıç<input type="datetime-local" name="start" required value="${toLocalInput(ev.startedAt)}"></label>
    ${running ? '<label class="field">Bitiş<input disabled value="Sürüyor"></label>' : `<label class="field">Bitiş<input type="datetime-local" name="end" required value="${toLocalInput(ev.endedAt)}"></label>`}</div>
    <label class="check"><input type="checkbox" name="bg"${ev.attention === 'background' ? ' checked' : ''}>Arka planda (dikkatimi bölmüyor)</label>
    <p class="form-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn full">Kaydet</button><button type="button" class="btn danger full" id="del">Kaydı sil</button></div>
  </form>`);
  const f = $('#f', body());
  const startWas = f.start.value, endWas = f.end?.value;
  f.onsubmit = (e) => {
    e.preventDefault();
    const patch = { label: f.label.value, attention: f.bg.checked ? 'background' : 'active' };
    if (f.start.value !== startWas) patch.startedAt = fromLocalInput(f.start.value);
    if (!running && f.end.value !== endWas) patch.endedAt = fromLocalInput(f.end.value);
    run(() => store.updateEvent(id, patch), 'Güncellendi');
  };
  $('#del', body()).onclick = () => { if (confirm(`“${ev.label}” silinsin mi?`)) run(() => store.removeEvent(id), 'Silindi'); };
}
