/* Browserudvidelsen: markér tekst i Edge -> hoejreklik -> timeren koerer.
 *
 * Udvidelsen kalder POST /api/v1/capture med {raw: true, start: true} og en
 * capture-noegle. Testene gaar den samme vej - med en rigtig noegle, ikke en
 * session - for det er den vej, udvidelsen har.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, opretBruger } from './hjaelp.mjs';

let srv;
let a;
let noegle;

before(async () => {
  srv = await startServer();
  a = (await opretBruger(srv, 'andreas')).klient;         // foerste = admin
  await a.kald('POST', '/api/v1/settings', { allow_registration: true });
  noegle = (await a.kald('POST', '/api/v1/keys', { name: 'Edge', scope: 'capture' })).data.key;
});
after(() => srv.stop());

const send = (tekst, ekstra = {}, n = noegle) =>
  a.kald('POST', '/api/v1/capture', { text: tekst, raw: true, start: true, ...ekstra },
    { noegle: n, udenCookie: true });

test('markeringen bliver titlen ORDRET - # og @ er ikke syntaks her', async () => {
  const r = await send('  Incident #4512 @ Nordvind\n  ~2t  printer ');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.item.title, 'Incident #4512 @ Nordvind ~2t printer');
  assert.equal(r.data.item.projectId, null);
  assert.deepEqual(r.data.item.tagIds, []);
  assert.equal(r.data.item.estimateMinutes ?? null, null);
  assert.equal(r.data.created, true);
  assert.equal(r.data.timer.entry.taskId, r.data.item.id, 'timeren koerer paa den nye opgave');

  const s = await a.kald('GET', '/api/v1/state');
  assert.equal(s.data.projects.length, 0, 'intet projekt oprettet af @');
  assert.equal(s.data.tags.length, 0, 'intet maerkat oprettet af #');
});

test('samme markering igen genbruger den aabne opgave - ingen dublet', async () => {
  const foer = await send('SAG-1001 Opsaetning af server');
  const igen = await send('sag-1001   opsaetning af SERVER');
  assert.equal(igen.data.created, false);
  assert.equal(foer.data.alreadyRunning, false);
  assert.equal(igen.data.alreadyRunning, true, 'udvidelsen skal kunne sige »already running«');
  assert.equal(igen.data.item.id, foer.data.item.id);
  const s = await a.kald('GET', '/api/v1/items?kind=task');
  const ens = s.data.items.filter((t) => t.title.toLowerCase() === 'sag-1001 opsaetning af server');
  assert.equal(ens.length, 1);
  assert.equal(igen.data.timer.entry.id, foer.data.timer.entry.id,
    'uret koerte allerede paa opgaven - det samme ur koerer videre, ingen 0-minutters post');
});

test('en ny markering stopper den koerende timer - der er stadig kun én', async () => {
  const foerste = await send('Foerste opgave');
  const anden = await send('Anden opgave');
  assert.equal(anden.data.timer.entry.taskId, anden.data.item.id);
  const nu = await a.kald('GET', '/api/v1/timer/current');
  assert.equal(nu.data.timer.entry.taskId, anden.data.item.id);
  assert.notEqual(nu.data.timer.entry.taskId, foerste.data.item.id);
});

test('en afsluttet opgave genopstaar ikke - der oprettes en ny', async () => {
  const r = await send('Afsluttet sag');
  const item = { ...r.data.item, status: 'done' };
  const gem = await a.kald('POST', '/api/v1/items', item);
  assert.equal(gem.status, 200, JSON.stringify(gem.data));
  const ny = await send('Afsluttet sag');
  assert.equal(ny.data.created, true);
  assert.notEqual(ny.data.item.id, r.data.item.id);
});

test('uden start oprettes opgaven, men timeren roeres ikke', async () => {
  const foer = await a.kald('GET', '/api/v1/timer/current');
  const r = await send('Kun gem den', { start: false });
  assert.equal(r.data.timer, null);
  const efter = await a.kald('GET', '/api/v1/timer/current');
  assert.equal(efter.data.timer.entry.taskId, foer.data.timer.entry.taskId);
});

test('tom markering afvises', async () => {
  const r = await send('   \n ');
  assert.equal(r.status, 400);
});

test('en read-noegle kan ikke starte noget', async () => {
  const laes = (await a.kald('POST', '/api/v1/keys', { name: 'laes', scope: 'read' })).data.key;
  const r = await send('Maa ikke oprettes', {}, laes);
  assert.equal(r.status, 403);
});

test('en anden brugers noegle genbruger ALDRIG andreas\' opgave', async () => {
  const b = (await opretBruger(srv, 'bente')).klient;
  const bNoegle = (await b.kald('POST', '/api/v1/keys', { name: 'b', scope: 'capture' })).data.key;
  const r = await b.kald('POST', '/api/v1/capture',
    { text: 'Foerste opgave', raw: true, start: true }, { noegle: bNoegle, udenCookie: true });
  assert.equal(r.data.created, true, 'bente faar sin egen opgave');
  const aState = await a.kald('GET', '/api/v1/items?kind=task');
  assert.ok(!aState.data.items.some((t) => t.id === r.data.item.id));
});

/* --- download fra Settings ------------------------------------------------ */

/* Laeser en stored-zip (metode 0) - det er den eneste slags, tovo skriver. */
function laesZip(buf) {
  const filer = new Map();
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    assert.equal(buf.readUInt16LE(p + 8), 0, 'metode 0');
    const stoerrelse = buf.readUInt32LE(p + 18);
    const navnLaengde = buf.readUInt16LE(p + 26);
    const ekstra = buf.readUInt16LE(p + 28);
    const navn = buf.subarray(p + 30, p + 30 + navnLaengde).toString('utf8');
    const start = p + 30 + navnLaengde + ekstra;
    filer.set(navn, buf.subarray(start, start + stoerrelse));
    p = start + stoerrelse;
  }
  return filer;
}

test('udvidelsen kan hentes som zip - med denne tovos adresse, men ALDRIG en noegle', async () => {
  const res = await fetch(`${srv.base}/api/v1/extension.zip`, {
    headers: { Cookie: a.cookie, 'X-Forwarded-Host': 'tovo.example.com', 'X-Forwarded-Proto': 'https' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  const filer = laesZip(Buffer.from(await res.arrayBuffer()));

  const { readFileSync } = await import('node:fs');
  const rod = new URL('../app/udvidelse/', import.meta.url);
  for (const navn of ['manifest.json', 'baggrund.js', 'faelles.js', 'indstillinger.html',
    'indstillinger.js', 'ikoner/ikon-16.png', 'ikoner/ikon-128.png']) {
    const i = filer.get(`tovo-udvidelse/${navn}`);
    assert.ok(i, `${navn} mangler i zip'en`);
    assert.ok(i.equals(readFileSync(new URL(navn, rod))), `${navn} er ikke byte-identisk`);
  }
  const forvalg = JSON.parse(filer.get('tovo-udvidelse/forvalg.json').toString('utf8'));
  assert.deepEqual(forvalg, { url: 'https://tovo.example.com' });
  for (const [navn, indhold] of filer) {
    assert.ok(!indhold.toString('latin1').includes('tovo_'.concat(noegle.slice(5))),
      `${navn} indeholder en noegle`);
  }
});

test('zip\'en kraever login', async () => {
  const res = await fetch(`${srv.base}/api/v1/extension.zip`);
  assert.equal(res.status, 401);
});

/* --- udvidelsens egen kode mod en for gammel tovo ---------------------------
 *
 * v31 paa Hjorten svarede 200 paa {raw, start}, oprettede opgaven gennem den
 * almindelige fangst og startede INTET. Udvidelsen meldte »Timer started«.
 * Her koeres faelles.js selv - i en vm med en falsk fetch - mod de to svar.
 */
async function faelles(svar) {
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const kode = readFileSync(new URL('../app/udvidelse/faelles.js', import.meta.url), 'utf8');
  const ctx = vm.createContext({
    URL,
    fetch: async (u) => ({
      ok: true, status: 200,
      json: async () => (u.endsWith('/api/public-config') ? svar.config : svar.capture),
    }),
  });
  vm.runInContext(kode, ctx);
  return ctx;
}

test('udvidelsen siger fra, naar tovo er for gammel til at starte uret', async () => {
  const gammel = await faelles({
    config: { version: 31 },
    // Praecis hvad v31 svarer: en fangst uden `created`, uden timer.
    capture: { item: { title: 'Track 1C' }, nye: [], warnings: [], timer: null },
  });
  await assert.rejects(gammel.kaldCapture('https://x', 'tovo_k', { text: 'Track 1C', start: true }),
    /too old/);
  await assert.rejects(gammel.tjekVersion('https://x'), /too old/);

  const ny = await faelles({ config: { version: 32 }, capture: { item: {}, created: true, timer: {} } });
  await ny.tjekVersion('https://x');
  const r = await ny.kaldCapture('https://x', 'tovo_k', { text: 'Track 1C', start: true });
  assert.equal(r.created, true);
});
