// Time Garden service worker: precache the app shell, serve it offline.
// Bump VERSION on every release so installed apps pick up the new files.
const VERSION = 'time-garden-v2.7.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icon.svg',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './styles/tokens.css', './styles/app.css', './styles/journal.css', './styles/plan.css', './styles/camera.css',
  './src/main.js', './src/version.js', './assets/deer.gif', './assets/chest.webp', './assets/frames/square.webp', './assets/frames/bookmark.webp',
  './assets/folders/pearl.webp', './assets/folders/croc.webp', './assets/folders/dalmatian.webp', './assets/folders/zebra.webp', './assets/folders/fawn.webp', './assets/folders/metal.webp', './assets/folders/tiger.webp',
  './src/core/time.js', './src/core/tracker.js', './src/core/analytics.js', './src/core/migrate.js', './src/core/db.js', './src/core/store.js', './src/core/planner.js', './src/core/balance.js',
  './src/ui/dom.js', './src/ui/nav.js', './src/ui/dial.js', './src/ui/home.js', './src/ui/sheets.js', './src/ui/calendar.js', './src/ui/analysis.js', './src/ui/journal.js', './src/ui/themes.js', './src/ui/plan.js', './src/ui/camera.js',
  './fonts/dm-sans-latin-400-normal.woff2', './fonts/dm-sans-latin-ext-400-normal.woff2',
  './fonts/dm-sans-latin-500-normal.woff2', './fonts/dm-sans-latin-ext-500-normal.woff2',
  './fonts/dm-sans-latin-700-normal.woff2', './fonts/dm-sans-latin-ext-700-normal.woff2',
  './fonts/caveat-latin-500-normal.woff2', './fonts/caveat-latin-ext-500-normal.woff2',
  './fonts/parisienne-latin-400-normal.woff2',
  './fonts/cormorant-garamond-latin-500-normal.woff2', './fonts/cormorant-garamond-latin-ext-500-normal.woff2',
  './fonts/cormorant-garamond-latin-500-italic.woff2', './fonts/cormorant-garamond-latin-ext-500-italic.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first: when online you always get the newest files; the cache is the offline copy.
// If the network is slow, fall back to the cached copy after a short wait.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    const fresh = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    });
    if (!cached) return fresh.catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    const slow = new Promise((resolve) => setTimeout(() => resolve(cached), 3500));
    return Promise.race([fresh.catch(() => cached), slow]);
  })());
});
