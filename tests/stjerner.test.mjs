/* Stjernemarkerede opgaver.
 *
 * Tre ting kan gaa i stykker uden at nogen ser det:
 *
 *  1. Raekkefoelgen. `starredSeq` ER listen. Foerste udgave skrev `now()` dér,
 *     og fordi `now()` er SEKUNDER, fik tre opgaver markeret lige efter
 *     hinanden det samme tal - hvorefter listen stod i omvendt orden.
 *     Testen herunder er den, der fangede det, og den skal blive ved med at
 *     kunne det: markér i en anden orden end du opretter i.
 *  2. Hvidlisten. `starred` er et nyt felt paa opgaven, og Planner-fletningen
 *     baerer alt uden for FLETTEFELTER over uroert. Det skal PROEVES, ikke
 *     antages: det er samme fejl som estimatet, der forsvandt ved genimport.
 *  3. Isolationen. En anden brugers opgave skal svare 404 - ikke 403 og
 *     bestemt ikke 200.
 *
 * Testene oprettes med vilje i OMVENDT raekkefoelge af den, listen skal staa
 * i (RUNE-ERFARINGER, doda v74): ellers beviser de kun, at listen ikke blev
 * rodet rundt.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, opretBruger } from './hjaelp.mjs';

let srv;
let k;

const opret = async (tekst) => (await k.kald('POST', '/api/v1/capture', { text: tekst })).data.item;
const stjerner = async () => (await k.kald('GET', '/api/v1/state')).data.starred;

before(async () => {
  srv = await startServer();
  k = (await opretBruger(srv, 'andreas')).klient;
});
after(() => srv.stop());

test('stjernen saettes, staar i /state og kan tages af igen', async () => {
  const t = await opret('opsaetning @Nordvind');
  assert.equal(t.starred, undefined, 'en ny opgave har ingen stjerne');
  assert.deepEqual(await stjerner(), []);

  const paa = await k.kald('POST', `/api/v1/tasks/${t.id}/star`, { starred: true });
  assert.equal(paa.status, 200);
  assert.equal(paa.data.item.starred, true);
  assert.ok(paa.data.item.starredSeq > 0, 'serveren skal tildele et loebenummer');

  const liste = await stjerner();
  assert.equal(liste.length, 1);
  assert.equal(liste[0].id, t.id);
  assert.equal(liste[0].title, 'opsaetning');
  assert.ok(liste[0].projectId, 'projektet skal med, saa baandet kan vise hvor opgaven hoerer til');
  // Kun det, de to visninger bruger. Hele opgaven ville sende noter og links
  // med ved hvert eneste state-kald.
  assert.deepEqual(Object.keys(liste[0]).sort(), ['id', 'projectId', 'title']);

  const af = await k.kald('POST', `/api/v1/tasks/${t.id}/star`, { starred: false });
  assert.equal(af.data.item.starred, false);
  assert.deepEqual(await stjerner(), []);
});

test('raekkefoelgen er den, man markerede i - ikke den, opgaverne blev oprettet i', async () => {
  const sidst = await opret('C sidst markeret');
  const midt = await opret('B i midten');
  const foerst = await opret('A foerst markeret');

  // Omvendt af oprettelsen: en test, der markerer i samme orden som den
  // opretter, kan ikke se en sortering, der slet ikke findes.
  for (const t of [foerst, midt, sidst]) {
    await k.kald('POST', `/api/v1/tasks/${t.id}/star`, { starred: true });
  }
  assert.deepEqual((await stjerner()).map((t) => t.title),
    ['A foerst markeret', 'B i midten', 'C sidst markeret']);

  // Tages stjernen af og paa igen, rykker opgaven BAGEST. Den er markeret
  // paa ny, og listen er »i den orden, du markerede dem«.
  await k.kald('POST', `/api/v1/tasks/${foerst.id}/star`, { starred: false });
  await k.kald('POST', `/api/v1/tasks/${foerst.id}/star`, { starred: true });
  assert.deepEqual((await stjerner()).map((t) => t.title),
    ['B i midten', 'C sidst markeret', 'A foerst markeret']);

  for (const t of [foerst, midt, sidst]) {
    await k.kald('POST', `/api/v1/tasks/${t.id}/star`, { starred: false });
  }
});

test('en afsluttet opgave falder ud af listen - men beholder sin stjerne', async () => {
  const t = await opret('noget der bliver faerdigt');
  await k.kald('POST', `/api/v1/tasks/${t.id}/star`, { starred: true });
  assert.equal((await stjerner()).length, 1);

  await k.kald('POST', `/api/v1/tasks/${t.id}/complete`, { done: true });
  assert.deepEqual(await stjerner(), [], 'en genvej til noget, der er gjort faerdigt, er ingen genvej');
  assert.equal((await k.kald('GET', `/api/v1/items/${t.id}`)).data.item.starred, true,
    'stjernen bliver paa opgaven, saa den er der igen, hvis man aabner den paany');

  await k.kald('POST', `/api/v1/tasks/${t.id}/complete`, { done: false });
  assert.equal((await stjerner()).length, 1, 'aabnes den igen, er genvejen tilbage');
  await k.kald('POST', `/api/v1/tasks/${t.id}/star`, { starred: false });
});

test('loftet paa tyve - listen er en genvej, ikke en opgaveliste mere', async () => {
  const lavede = [];
  for (let i = 0; i < 23; i++) {
    const t = await opret(`loft ${String(i).padStart(2, '0')}`);
    await k.kald('POST', `/api/v1/tasks/${t.id}/star`, { starred: true });
    lavede.push(t);
  }
  const liste = await stjerner();
  assert.equal(liste.length, 20);
  // De AELDSTE markeringer bliver - listen skaeres i enden, saa den ikke
  // flytter sig under fingeren, hver gang man markerer noget nyt.
  assert.equal(liste[0].title, 'loft 00');
  assert.equal(liste[19].title, 'loft 19');

  for (const t of lavede) await k.kald('POST', `/api/v1/tasks/${t.id}/star`, { starred: false });
});

test('"false" som streng slaar stjernen FRA - en klient sender ikke altid en boolean', async () => {
  const t = await opret('typetjek');
  await k.kald('POST', `/api/v1/tasks/${t.id}/star`, { starred: true });
  // Den vej ind, der ikke gaar gennem /star: et raat felt i en PATCH.
  const r = await k.kald('PATCH', `/api/v1/items/${t.id}`, { starred: 'false' });
  assert.equal(r.data.item.starred, false, 'strengen "false" maa ikke blive til true');
  await k.kald('POST', `/api/v1/tasks/${t.id}/star`, { starred: false });
});

test('stjernen overlever en genimport fra Planner', async () => {
  const skabt = await k.kald('POST', '/api/v1/items', {
    kind: 'task', title: 'fra Planner', plannerTaskId: 'PT-1', status: 'open',
  });
  const id = skabt.data.item.id;
  await k.kald('POST', `/api/v1/tasks/${id}/star`, { starred: true });
  const foer = (await k.kald('GET', `/api/v1/items/${id}`)).data.item;

  // Genimporten gemmer den FLETTEDE opgave gennem samme bulk-rute som
  // importruden bruger. Felter uden for hvidlisten baeres uaendret med.
  const { opret: _ignore, ...uden } = {};
  const planner = require$fletteFelter(foer);
  await k.kald('POST', '/api/v1/items/bulk', { items: [planner] });

  const efter = (await k.kald('GET', `/api/v1/items/${id}`)).data.item;
  assert.equal(efter.title, 'fra Planner (rettet i Planner)');
  assert.equal(efter.starred, true, 'stjernen er tovos egen og maa ikke roeres af en import');
  // `starredSeq`, ikke `starredAt`: feltet blev et LOEBENUMMER, da
  // sorteringsfaelden blev rettet (2026-09-16), men proeven blev staaende paa
  // det gamle navn. Begge sider var derfor `undefined`, og den groenne
  // assertion sagde intet om det, den paastod at vogte.
  assert.ok(foer.starredSeq > 0, 'loebenummeret skal findes, foer det kan staa stille');
  assert.equal(efter.starredSeq, foer.starredSeq, 'og loebenummeret - listens raekkefoelge - skal staa stille');
  await k.kald('POST', `/api/v1/tasks/${id}/star`, { starred: false });
});

/** Det, Planner-fletningen leverer: den eksisterende opgave + hvidlistens felter. */
function require$fletteFelter(eksisterende) {
  return Object.assign({}, eksisterende, { title: 'fra Planner (rettet i Planner)' });
}

test('en anden brugers opgave svarer 404 - ikke 403, som ville bekraefte id\'et', async () => {
  // Foerste bruger er admin, og registreringen lukker sig selv bagefter.
  await k.kald('POST', '/api/v1/settings', { allow_registration: true });
  const anden = (await opretBruger(srv, 'kollega')).klient;
  const min = await opret('min egen');
  const r = await anden.kald('POST', `/api/v1/tasks/${min.id}/star`, { starred: true });
  assert.equal(r.status, 404);
  assert.deepEqual((await anden.kald('GET', '/api/v1/state')).data.starred, []);
  assert.equal((await k.kald('GET', `/api/v1/items/${min.id}`)).data.item.starred, undefined);
});
