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
