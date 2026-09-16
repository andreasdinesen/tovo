/* Direkte adresser til siderne (RUNE-ERFARINGER §9g).
 *
 * Adresserne staar ét sted (app/shared/ruter.js), men bruges to: fladen
 * skriver dem i adresselinjen, og SERVEREN afgoer ud fra den samme liste,
 * hvilke stier der svarer med index.html. Den vigtigste proeve er derfor ikke
 * opslagene, men at hver side i menuen HAR en adresse - og at serveren
 * faktisk svarer paa dem, naar man genindlaeser.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startServer, opretBruger } from './hjaelp.mjs';

const require = createRequire(import.meta.url);
const ruter = require('../app/shared/ruter.js');
const kerne = readFileSync(new URL('../app/parts/p1_core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../app/public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app/public/app.js', import.meta.url), 'utf8');

/* Siderne, som de staar i VIEWS i p1_core.js. */
function sidernesIder() {
  return [...kerne.matchAll(/\{\s*id:\s*'(\w+)',\s*label:/g)].map((m) => m[1]);
}

test('hver side i appen har en adresse', () => {
  const ider = sidernesIder();
  assert.ok(ider.length >= 7, `fandt kun ${ider.length} sider - er moensteret gaaet i stykker?`);
  const uden = ider.filter((id) => !ruter.stiFor({ view: id }));
  assert.deepEqual(uden, [], 'sider uden adresse kan ikke bogmaerkes');
});

test('adressen foerer tilbage til den samme tilstand', () => {
  for (const id of sidernesIder()) assert.deepEqual(ruter.laesSti(ruter.stiFor({ view: id })), { view: id });
  const eks = [
    [{ view: 'projects', project: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' }, '/projects/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'],
    [{ view: 'projects', project: '__uden' }, '/projects/__uden'],
    [{ view: 'tags', tag: 'Ab-12' }, '/tags/Ab-12'],
    [{ view: 'settings', fane: 'account' }, '/settings/account'],
  ];
  for (const [t, sti] of eks) {
    assert.equal(ruter.stiFor(t), sti);
    assert.deepEqual(ruter.laesSti(sti), t);
  }
  // Et projekt paa en anden side end Projects foelger ikke med i adressen.
  assert.equal(ruter.stiFor({ view: 'report', project: 'abc' }), '/report');
  assert.equal(ruter.stiFor({ view: 'settings', fane: 'ukendt' }), '/settings');
});

test('forsiden er Today', () => {
  for (const sti of ['/', '', '/index.html']) assert.deepEqual(ruter.laesSti(sti), { view: 'today' });
});

test('stavemaader man selv ville skrive', () => {
  assert.equal(ruter.laesSti('/Report').view, 'report');
  assert.equal(ruter.laesSti('/projects/').view, 'projects');
  assert.equal(ruter.laesSti('/mærkater').view, 'tags');
  assert.equal(ruter.laesSti('/m%C3%A6rkater').view, 'tags');
  assert.equal(ruter.laesSti('/indstillinger/Account').fane, 'account');
  // Id'et er ikke en stavemaade: store bogstaver bevares.
  assert.equal(ruter.laesSti('/PROJECTS/AbC').project, 'AbC');
});

test('ukendte stier er ukendte - ikke appen', () => {
  for (const sti of ['/reports', '/app.jsx', '/styl.css', '/api/items', '/oauth/authorize',
    '/projects/a/b', '/projects/<x>', '/settings/foo', '/today/abc', '/%E0%A4%A']) {
    assert.equal(ruter.laesSti(sti), null, sti);
  }
});

test('index.html henter alt med absolutte adresser', () => {
  // Paa /projects/<id> ville `app.js?v=` blive slaaet op som /projects/app.js.
  const rel = [...index.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('/'));
  assert.deepEqual(rel, []);
  assert.match(app, /serviceWorker\.register\('\/sw\.js'\)/);
});

/* ── mod den rigtige server ──────────────────────────────────────────────── */
let srv;
before(async () => { srv = await startServer(); await opretBruger(srv, 'ruter'); });
after(() => srv.stop());

const hent = (sti, init) => fetch(srv.base + sti, init);

test('serveren svarer med appen paa hver kendt sti', async () => {
  const stier = [...sidernesIder().map((id) => ruter.stiFor({ view: id })),
    '/projects/a1b2c3', '/tags/x-1', '/settings/account', '/settings/server', '/Rapport'];
  for (const sti of stier) {
    const r = await hent(sti);
    assert.equal(r.status, 200, sti);
    assert.match(r.headers.get('content-type'), /text\/html/, sti);
    assert.match(await r.text(), /<script src="\/app\.js\?v=\d+"><\/script>/, sti);
    assert.equal(r.headers.get('cache-control'), 'no-store', sti);
  }
  assert.equal((await hent('/report', { method: 'HEAD' })).status, 200);
});

test('og 404 paa alt andet - ingen catch-all', async () => {
  for (const sti of ['/reports', '/styl.css', '/app.jsx', '/settings/foo', '/projects/a/b']) {
    assert.equal((await hent(sti)).status, 404, sti);
  }
  // De rigtige filer findes stadig.
  for (const sti of ['/sw.js', '/style.css', '/manifest.webmanifest', '/icon.svg']) {
    assert.equal((await hent(sti)).status, 200, sti);
  }
});

test('manifestet peger paa den side, genvejen blev lavet fra - og kun paa en kendt', async () => {
  const start = async (q) => (await (await hent(`/manifest.webmanifest?start=${encodeURIComponent(q)}`)).json());
  const m = await start('/Report');
  assert.equal(m.start_url, '/report');
  assert.equal(m.scope, '/');
  assert.equal(m.name, 'tovo');
  assert.equal((await start('/projects/abc')).start_url, '/projects/abc');
  for (const ond of ['https://eksempel.invalid/', '//eksempel.invalid', '/api/v1/state', 'javascript:alert(1)']) {
    assert.equal((await start(ond)).start_url, '/', ond);
  }
});

/* ── service workeren med de nye stier ───────────────────────────────────
 *
 * Browser-panelet kan ikke registrere en service worker, saa den koeres her
 * med attrapper: sw.js' egen fetch-haandtering, hentet ud af filen.
 */
function koerSw({ net }) {
  const kode = readFileSync(new URL('../app/public/sw.js', import.meta.url), 'utf8');
  const lyttere = {};
  const cache = new Map();
  const selfObj = {
    location: { origin: 'https://eksempel.invalid', href: 'https://eksempel.invalid/sw.js' },
    addEventListener: (t, f) => { lyttere[t] = f; },
    skipWaiting() {}, clients: { claim() {} },
  };
  const norm = (u) => new URL(typeof u === 'string' ? u : u.url, selfObj.location.href).href;
  const caches = {
    open: async () => ({
      addAll: async (l) => { for (const u of l) cache.set(norm(u), `cache:${new URL(norm(u)).pathname}`); },
      put: async (r, s) => { cache.set(norm(r), s); },
    }),
    match: async (r) => cache.get(norm(r)),
    keys: async () => [], delete: async () => true,
  };
  const fetchAttrap = async (r) => { if (!net) throw new TypeError('offline'); return `net:${new URL(norm(r)).pathname}`; };
  new Function('self', 'caches', 'fetch', kode)(selfObj, caches, fetchAttrap);
  return {
    async installer() { let p; lyttere.install({ waitUntil: (x) => { p = x; } }); await p; },
    async hent(sti, method = 'GET') {
      let svar = null;
      lyttere.fetch({ request: { url: `https://eksempel.invalid${sti}`, method }, respondWith: (p) => { svar = p; } });
      return svar ? await svar : 'ikke-opsnappet';
    },
  };
}

test('service workeren: en side-adresse offline faar appen fra cachen', async () => {
  const sw = koerSw({ net: false });
  await sw.installer();
  assert.equal(await sw.hent('/projects/abc'), 'cache:/', 'navigation offline -> den cachede forside');
  assert.equal(await sw.hent('/settings/account'), 'cache:/');
  const v = readFileSync(new URL('../app/public/sw.js', import.meta.url), 'utf8').match(/^const VERSION = (\d+);/m)[1];
  assert.equal(await sw.hent(`/app.js?v=${v}`), 'cache:/app.js', 'den versionerede app.js ligger i cachen');
  assert.equal(await sw.hent('/api/v1/state'), 'ikke-opsnappet', 'data maa aldrig komme fra cachen');
});

test('service workeren: online er siden altid frisk fra nettet', async () => {
  const sw = koerSw({ net: true });
  await sw.installer();
  assert.equal(await sw.hent('/report'), 'net:/report');
});

test('hver adresse i precache-listen svarer 200 - én 404 draeber hele installationen', async () => {
  const kode = readFileSync(new URL('../app/public/sw.js', import.meta.url), 'utf8');
  const version = kode.match(/^const VERSION = (\d+);/m)[1];
  const liste = kode.match(/const PRECACHE = \[([\s\S]*?)\];/)[1]
    .match(/['`]([^'`]+)['`]/g).map((s) => s.slice(1, -1).replace('${VERSION}', version).replace(/^\.\//, '/'));
  assert.ok(liste.length >= 5);
  for (const sti of liste) assert.equal((await hent(sti)).status, 200, sti);
});
