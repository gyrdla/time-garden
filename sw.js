// Time Garden service worker: precache the app shell, serve it offline.
// Bump VERSION on every release so installed apps pick up the new files.
const VERSION = 'time-garden-v2.0.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icon.svg',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './styles/tokens.css', './styles/app.css', './styles/journal.css',
  './src/main.js',
  './src/core/time.js', './src/core/tracker.js', './src/core/analytics.js', './src/core/migrate.js', './src/core/db.js', './src/core/store.js',
  './src/ui/dom.js', './src/ui/nav.js', './src/ui/dial.js', './src/ui/home.js', './src/ui/sheets.js', './src/ui/calendar.js', './src/ui/analysis.js', './src/ui/journal.js', './src/ui/themes.js',
  './fonts/dm-sans-latin-400-normal.woff2', './fonts/dm-sans-latin-ext-400-normal.woff2',
  './fonts/dm-sans-latin-500-normal.woff2', './fonts/dm-sans-latin-ext-500-normal.woff2',
  './fonts/dm-sans-latin-700-normal.woff2', './fonts/dm-sans-latin-ext-700-normal.woff2',
  './fonts/caveat-latin-500-normal.woff2', './fonts/caveat-latin-ext-500-normal.woff2',
  './fonts/parisienne-latin-400-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
