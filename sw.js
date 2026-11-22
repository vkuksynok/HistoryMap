/* service worker — offline cache for the History Atlas */
const SHELL = 'histmap-shell-v32';
const TILES = 'histmap-tiles-v1';
const shellFiles = [
  './', './index.html', './css/style.css',
  './js/i18n.js', './js/projection.js', './js/data.js', './js/data_uk.js', './js/data_de.js', './js/data_es.js', './js/data_pt.js', './js/data_sv.js', './js/data_fi.js', './js/data_fr.js', './js/data_it.js', './js/data_no.js', './js/data_da.js',
  './js/map.js', './js/timeline.js',
  './js/app.js', './js/territories.js', './js/cities.js', './js/tours.js',
  './js/overlay.js', './js/editor.js',
  './manifest.webmanifest', './icon192.png', './icon512.png'
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(SHELL).then(c => c.addAll(shellFiles)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== SHELL && k !== TILES).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/tiles/')) {
    // cache-first for tiles
    ev.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(ev.request);
        if (hit) return hit;
        const resp = await fetch(ev.request);
        if (resp.ok) cache.put(ev.request, resp.clone());
        return resp;
      })
    );
  } else {
    // network-first for app files (updates apply instantly; offline falls back)
    ev.respondWith(
      fetch(ev.request).then(r => {
        if (r.ok && ev.request.method === 'GET') {
          const clone = r.clone();
          caches.open(SHELL).then(c => c.put(ev.request, clone));
        }
        return r;
      }).catch(() => caches.match(ev.request, { ignoreSearch: url.pathname === '/' || url.pathname.endsWith('.html') }))
    );
  }
});
