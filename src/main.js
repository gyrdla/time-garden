// Time Garden entry point: wires storage, screens and the PWA shell together.

import * as store from './core/store.js';
import { $, toast } from './ui/dom.js';
import { view, register, go, refresh, bindNav } from './ui/nav.js';
import { renderHome, tickHome, bindHome } from './ui/home.js';
import { renderCalendar, bindCalendar } from './ui/calendar.js';
import { renderAnalysis, bindAnalysis } from './ui/analysis.js';
import { renderJournal, bindJournal } from './ui/journal.js';
import { renderThemes, bindThemes, applyTheme } from './ui/themes.js';
import { VERSION } from './version.js';
import { bindSheets, openCreateMenu } from './ui/sheets.js';
import { renderPlan, bindPlan, tickPlan } from './ui/plan.js';

// Paint the last theme immediately so there is no flash before the database opens.
try { const t = localStorage.getItem('tg-theme'); if (t) document.body.dataset.theme = t; } catch { /* private mode */ }

register('home', renderHome);
register('calendar', renderCalendar);
register('analysis', renderAnalysis);
register('journal', renderJournal);
register('theme', renderThemes);
register('plan', renderPlan);

async function boot() {
  store.setErrorHandler(() => toast('Kaydedilemedi. Depolama dolu olabilir; yedek almanı öneririm.'));
  bindNav(); bindSheets(); bindHome(); bindCalendar(); bindAnalysis(); bindJournal(); bindThemes(); bindPlan();
  $('#navAdd').onclick = openCreateMenu;

  $('#homeVersion').textContent = `Time Garden ${VERSION}`;

  await store.init();
  applyTheme();
  if (!store.state.persistent) toast('Bu tarayıcıda kalıcı depolama kapalı; kayıtlar saklanmayacak.');

  // Data changes re-render the visible screen. The journal manages its own DOM while editing.
  store.subscribe((what) => { if (view.screen !== 'journal' || what === 'init') refresh(); });
  go('home');

  // The clock is derived from timestamps, so these only repaint; they never "count".
  setInterval(() => { if (document.hidden) return; if (view.screen === 'home') tickHome(); else if (view.screen === 'plan') tickPlan(); }, 1000);
  setInterval(() => { if (!document.hidden && view.screen === 'home') renderHome(); }, 30_000);
  const wake = () => { if (!document.hidden && view.screen !== 'journal') refresh(); };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('pageshow', wake);
  window.addEventListener('focus', wake);
}

// Behave like an app, not a web page: no pinch zoom (double-tap zoom is switched off in CSS).
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
boot().catch((e) => { console.error(e); toast('Uygulama başlatılamadı. Sayfayı yenilemeyi dene.'); });

if ('serviceWorker' in navigator) {
  // When a new version takes over, reload once so the page never runs old code against new files.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').then((r) => r.update()).catch(() => {}));
}
