// Theme switching and backup / restore.

import { $, $$, toast } from './dom.js';
import * as store from '../core/store.js';
import { VERSION } from '../version.js';

const THEMES = ['pearl', 'white', 'lavender', 'sunset', 'nature', 'minimal'];

export function applyTheme() {
  const t = THEMES.includes(store.state.settings.theme) ? store.state.settings.theme : 'pearl';
  document.body.dataset.theme = t;
  $$('[data-theme]', $('#themeGrid')).forEach((b) => b.classList.toggle('chosen', b.dataset.theme === t));
  const bg = getComputedStyle(document.body).getPropertyValue('--bg-solid').trim();
  $('meta[name="theme-color"]').setAttribute('content', bg || '#ffffff');
  try { localStorage.setItem('tg-theme', t); } catch { /* private mode */ }
}

export function renderThemes() {
  applyTheme();
  const { sessions, events, pages, projects, tasks } = store.state;
  $('#storageInfo').textContent = store.state.persistent
    ? `Kayıtların hesap olmadan, yalnızca bu cihazda tutulur: ${sessions.length} etkinlik, ${events.length} paralel kayıt, ${pages.size} günlük sayfası, ${projects.length} proje, ${tasks.length} görev.`
    : 'Bu tarayıcı kalıcı depolamaya izin vermiyor (gizli sekme olabilir). Kayıtlar sayfa kapanınca silinir.';
  $('#versionInfo').textContent = `Time Garden ${VERSION} · veri şeması 3`;
}

export function bindThemes() {
  $$('[data-theme]', $('#themeGrid')).forEach((b) => {
    b.onclick = () => { store.setSetting('theme', b.dataset.theme).catch(() => {}); applyTheme(); };
  });
  $('#exportData').onclick = () => {
    const blob = new Blob([JSON.stringify(store.exportData(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `time-garden-yedek-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#importData').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const raw = JSON.parse(await f.text());
      if (!confirm('Bu cihazdaki kayıtların yerine yedektekiler gelecek. Devam edilsin mi?')) return;
      const n = await store.importData(raw);
      applyTheme(); renderThemes();
      toast(`Geri yüklendi: ${n.sessions} etkinlik, ${n.pages} sayfa`);
    } catch (err) {
      toast(err instanceof SyntaxError ? 'Dosya okunamadı.' : err.message || 'Geri yüklenemedi.');
    }
  };
}
