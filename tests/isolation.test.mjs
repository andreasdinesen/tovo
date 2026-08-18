/* Isolationstesten. Koeres i HVER fase, ikke kun én gang.
 *
 * Brugere maa ikke kunne se hinandens data. Admin er INGEN undtagelse: admin
 * driver appen (adgang, registrering, backup) og ser ikke andres opgaver.
 *
 * doda kunne ikke laane os den her: doda er en én-brugers app, hvor
 * godkend() henter brugeren med "SELECT ... FROM users LIMIT 1". Hele
 * user_id-laget er skrevet fra bunden i tovo, og saa er testen ikke en
 * formalitet - den er beviset.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, opretBruger } from './hjaelp.mjs';

let srv;
let a;      // admin
let b;      // almindelig bruger
let aProjekt;
let aOpgave;

before(async () => {
  srv = await startServer();
  a = await opretBruger(srv, 'andreas');                 // foerste = admin
  await a.klient.kald('POST', '/api/v1/settings', { allow_registration: true });
  b = await opretBruger(srv, 'bo');
  assert.equal(a.user.isAdmin, true);
  assert.equal(b.user.isAdmin, false);

  const p = await a.klient.kald('POST', '/api/v1/items',
    { kind: 'project', name: 'Kundeprojekt', customer: 'Acme', budgetHours: 40 });
  aProjekt = p.data.item;
  const o = await a.klient.kald('POST', '/api/v1/items',
    { kind: 'task', title: 'Opsaetning', projectId: aProjekt.id, estimateMinutes: 120 });
  aOpgave = o.data.item;
});

after(() => srv.stop());

test('A ser sine egne ting', async () => {
  const r = await a.klient.kald('GET', '/api/v1/items?kind=task');
  assert.equal(r.data.items.length, 1);
  assert.equal(r.data.items[0].title, 'Opsaetning');
  const et = await a.klient.kald('GET', `/api/v1/items/${aOpgave.id}`);
  assert.equal(et.status, 200);
});

test('B faar 404 paa A-s opgave - baade GET, PATCH og DELETE', async () => {
  for (const [metode, krop] of [['GET'], ['PATCH', { title: 'kapret' }], ['DELETE']]) {
    const r = await b.klient.kald(metode, `/api/v1/items/${aOpgave.id}`, krop);
    // 404, aldrig 403: en 403 ville bekraefte, at id'et findes.
    assert.equal(r.status, 404, `${metode} gav ${r.status}`);
    assert.equal(r.data.error, 'not_found');
  }
  // Og A-s opgave er uroert.
  const stadig = await a.klient.kald('GET', `/api/v1/items/${aOpgave.id}`);
  assert.equal(stadig.data.item.title, 'Opsaetning');
});

test('B-s lister og state indeholder intet af A-s', async () => {
  const items = await b.klient.kald('GET', '/api/v1/items');
  assert.equal(items.data.items.length, 0);
  const s = await b.klient.kald('GET', '/api/v1/state');
  assert.equal(s.data.projects.length, 0);
  assert.equal(s.data.counts.tasks, 0);
});

test('B kan ikke overskrive A-s element ved at gaette id-et', async () => {
  // Et POST med et kendt id maa ikke kunne kapre raekken. Vagten ligger i
  // gemItem selv, ikke i ruten.
  const r = await b.klient.kald('POST', '/api/v1/items',
    { id: aOpgave.id, kind: 'task', title: 'kapret' });
  assert.equal(r.status, 404);
  const stadig = await a.klient.kald('GET', `/api/v1/items/${aOpgave.id}`);
  assert.equal(stadig.data.item.title, 'Opsaetning');
});

test('bulk kan heller ikke naa en andens data', async () => {
  const r = await b.klient.kald('POST', '/api/v1/items/bulk',
    { items: [{ id: aProjekt.id, kind: 'project', name: 'kapret' }] });
  assert.equal(r.status, 404);
  const stadig = await a.klient.kald('GET', `/api/v1/items/${aProjekt.id}`);
  assert.equal(stadig.data.item.name, 'Kundeprojekt');
});

test('et DELVIST objekt kan aldrig gemmes som et helt', async () => {
  // Bulk er den farlige: en importrutine kan oedelaegge hundredvis af poster
  // paa én gang, stille (Kokkeri §4).
  const r = await a.klient.kald('POST', '/api/v1/items/bulk',
    { items: [{ id: aOpgave.id, kind: 'task', title: 'kun titlen', partial: true }] });
  assert.equal(r.status, 400);
  const stadig = await a.klient.kald('GET', `/api/v1/items/${aOpgave.id}`);
  assert.equal(stadig.data.item.estimateMinutes, 120, 'estimatet maa ikke vaere skrevet vaek');
});

test('bulk ruller HELE partiet tilbage, hvis én raekke fejler', async () => {
  const foer = (await a.klient.kald('GET', '/api/v1/items?kind=task')).data.items.length;
  const r = await a.klient.kald('POST', '/api/v1/items/bulk', {
    items: [
      { kind: 'task', title: 'god raekke' },
      { kind: 'ukendt', title: 'daarlig raekke' },
    ],
  });
  assert.equal(r.status, 400);
  const efter = (await a.klient.kald('GET', '/api/v1/items?kind=task')).data.items.length;
  assert.equal(efter, foer, 'den gode raekke maa ikke vaere gemt alene');
});

test('sletning er bloed og svarer 200 - ikke 404 paa noget, der lykkedes', async () => {
  // doda v8: opdaterItem sluttede med hentItem, som filtrerer slettede fra,
  // saa en vellykket sletning svarede 404. Fejlen laa der i otte udgivelser.
  const ny = await a.klient.kald('POST', '/api/v1/items', { kind: 'tag', name: 'internt' });
  const slet = await a.klient.kald('DELETE', `/api/v1/items/${ny.data.item.id}`);
  assert.equal(slet.status, 200);
  assert.equal(slet.data.ok, true);
  const igen = await a.klient.kald('GET', `/api/v1/items/${ny.data.item.id}`);
  assert.equal(igen.status, 404, 'slettede elementer er vaek for laeseren');
  const anden = await a.klient.kald('DELETE', `/api/v1/items/${ny.data.item.id}`);
  assert.equal(anden.status, 404, 'anden sletning findes ikke');
});

test('en adgangsnoegle giver kun adgang til SIN egen brugers data', async () => {
  // Noeglen faar user_id i tovo. Uden det ville den ramme "foerste bruger i
  // tabellen", som i doda - og saa var flerbruger-isolationen en illusion.
  const { key } = await lavNoegle(b);
  const mine = await b.klient.kald('GET', '/api/v1/items', undefined, { noegle: key, udenCookie: true });
  assert.equal(mine.status, 200);
  assert.equal(mine.data.items.length, 0);
  const andres = await b.klient.kald('GET', `/api/v1/items/${aOpgave.id}`, undefined,
    { noegle: key, udenCookie: true });
  assert.equal(andres.status, 404);
});

/* Noegler faar sit eget endepunkt i fase 8 (MCP). Indtil da laves den direkte
   i databasen ved siden af - WAL taaler to processer, og det er den samme
   vej, doda bruger til at flytte uret i sine tests. */
async function lavNoegle(bruger) {
  const { DatabaseSync } = await import('node:sqlite');
  const crypto = await import('node:crypto');
  const path = await import('node:path');
  const db = new DatabaseSync(path.join(srv.dataDir, 'tovo.db'));
  const hemmelig = crypto.randomBytes(32).toString('base64url');
  const key = `tovo_${hemmelig}`;
  const hash = crypto.createHash('sha256').update(key, 'utf8').digest('hex');
  db.prepare(`INSERT INTO tokens (id, user_id, name, hash, prefix, scope, created_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run(crypto.randomBytes(16).toString('hex'), bruger.user.id, 'test', hash,
      hemmelig.slice(0, 6), 'full', Math.floor(Date.now() / 1000));
  db.close();
  return { key };
}
