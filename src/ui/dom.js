// Small DOM helpers shared by all screens.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;

let toastTimer = 0;
export function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

export function haptic(ms = 12) {
  try { navigator.vibrate?.(ms); } catch { /* not supported (iOS Safari) */ }
}

const CAT_VARS = {
  'Çalışma': '--cat-work', 'Öğrenme': '--cat-learn', 'Kişisel': '--cat-personal', 'Sosyal': '--cat-social',
  'Dinlenme': '--cat-rest', 'Uyku': '--cat-sleep', 'Ev işleri': '--cat-home', 'Diğer': '--cat-other',
};
export const catColor = (c) => `var(${CAT_VARS[c] || '--cat-other'})`;

const TR = 'tr-TR';
export const fmtLongDate = (ts) => new Date(ts).toLocaleDateString(TR, { day: 'numeric', month: 'long', weekday: 'long' });
export const fmtFullDate = (ts) => new Date(ts).toLocaleDateString(TR, { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
export const fmtMonth = (ts) => new Date(ts).toLocaleDateString(TR, { month: 'long', year: 'numeric' });
export const fmtMonthName = (ts) => new Date(ts).toLocaleDateString(TR, { month: 'long' });
export const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

/** timestamp ⇄ value of <input type="datetime-local"> */
export function toLocalInput(ts) {
  const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v) {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/** "9 – 15 Kasım" or, across months, "26 Eki – 1 Kas". */
export function weekTitle(start, end) {
  const a = new Date(start), b = new Date(end - 1);
  if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.getDate()} ${fmtMonthName(b.getTime())}`;
  const short = (d) => d.toLocaleDateString(TR, { day: 'numeric', month: 'short' });
  return `${short(a)} – ${short(b)}`;
}
