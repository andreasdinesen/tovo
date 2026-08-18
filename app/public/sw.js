'use strict';
/* tovo - service worker.
 *
 * VERSION stemples af build_rune.py og er den SAMME som APP_VERSION. Uden
 * det hober hver udgivelse sig op i browserens cache, og en gammel app.js
 * kan serveres i det uendelige (RUNE-ERFARINGER §5).
 *
 * Den roerer KUN GET. En SW, der opsnapper POST'er og gemmer dem, sender dem
 * i vilkaarlig raekkefoelge og kan ikke fortaelle brugeren, hvad der skete -
 * offline-koe staar med vilje uden for tovos omfang (doda F6).
 */

const VERSION = 10;
const CACHE = `tovo-v${VERSION}`;

// PRAECIS de adresser, index.html henter. Peger de et andet sted hen, ligger
// der to kopier af appen i cachen, og den ene bliver aldrig ryddet.
const PRECACHE = [
  './',
  `./style.css?v=${VERSION}`,
  `./app.js?v=${VERSION}`,
  './icon.svg',
  './icon-192.png',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  // De gamle versioners cacher ryddes her - det er hele grunden til, at
  // navnet baerer versionsnummeret.
  e.waitUntil(caches.keys()
    .then((navne) => Promise.all(navne.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => {
  if (e.data === 'ryd') caches.keys().then((navne) => navne.forEach((n) => caches.delete(n)));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Data, kalenderfeed og start-links skal ALTID vaere friske. En cachet
  // ugerapport er en forkert ugerapport.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ical/')
    || url.pathname.startsWith('/s/') || url.pathname.startsWith('/oauth/')
    || url.pathname === '/mcp') return;

  // Versionerede filer kan ikke aendre sig: cache-foerst er sikkert, og det
  // er dét, der goer appen brugbar paa en daarlig forbindelse.
  if (url.search.startsWith('?v=')) {
    e.respondWith(caches.match(req).then((fundet) => fundet || fetch(req).then((svar) => {
      const kopi = svar.clone();
      caches.open(CACHE).then((c) => c.put(req, kopi));
      return svar;
    })));
    return;
  }

  // Resten (navigation): net foerst, cache som net under.
  e.respondWith(fetch(req).catch(() => caches.match(req).then((f) => f || caches.match('./'))));
});
