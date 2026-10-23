/* Fletning af to opgaver (v41): POST /api/v1/tasks/:id/merge {into}.
 *
 * Til dubletten fra ServiceNow-importen: en sag lavet i haanden OG importeret.
 * Den egne flettes ind i den importerede - og timerne maa ikke forsvinde.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, opretBruger } from './hjaelp.mjs';

let srv;
let a;
let b;

before(async () => {
  srv = await startServer();
  a = (await opretBruger(srv, 'andreas')).klient;
  await a.kald('POST', '/api/v1/settings', { allow_registration: true });
  b = (await opretBruger(srv, 'bente')).klient;
});
after(() => srv.stop());

async function opgave(k, tekst) {
  return (await k.kald('POST', '/api/v1/capture', { text: tekst })).data.item;
}

test('timer, start-link, kommentar og underopgave flyttes - og dubletten forsvinder', async () => {
  const egen = await opgave(a, 'min egen udgave ~2t');
  const importeret = await opgave(a, 'Fra ServiceNow');
  await a.kald('PATCH', `/api/v1/items/${egen.id}`, { note: 'egne noter', links: [{ url: 'onenote:x', label: 'OneNote' }] });
  await a.kald('POST', '/api/v1/entries', { taskId: egen.id, date: '2026-03-02', text: '9-11' });
  await a.kald('POST', '/api/v1/entries', { taskId: egen.id, date: '2026-03-03', text: '1t', overtime: true });
  await a.kald('POST', `/api/v1/tasks/${egen.id}/comments`, { text: 'aftalt med kunden' });
  const under = await opgave(a, 'underopgave');
  await a.kald('PATCH', `/api/v1/items/${under.id}`, { parentTaskId: egen.id });
  const link = (await a.kald('POST', `/api/v1/tasks/${egen.id}/link`, {})).data.link;

  const r = await a.kald('POST', `/api/v1/tasks/${egen.id}/merge`, { into: importeret.id });
  assert.equal(r.status, 200);
  assert.equal(r.data.movedEntries, 2);

  // Timerne staar nu paa den importerede - ogsaa overtidsflaget.
  const poster = (await a.kald('GET', `/api/v1/entries?task=${importeret.id}`)).data.entries;
  assert.equal(poster.length, 2);
  assert.ok(poster.some((e) => e.overtime), 'overtiden gik tabt i fletningen');
  assert.equal((await a.kald('GET', `/api/v1/entries?task=${egen.id}`)).data.entries.length, 0);

  // Tovos egne felter fulgte med, fordi den importerede ikke havde dem.
  const ny = r.data.item;
  assert.equal(ny.title, 'Fra ServiceNow', 'importens titel bestemmer');
  assert.equal(ny.estimateMinutes, 120);
  assert.equal(ny.note, 'egne noter');
  assert.deepEqual(ny.links.map((l) => l.url), ['onenote:x']);

  const kommentarer = (await a.kald('GET', `/api/v1/tasks/${importeret.id}/comments`)).data.comments;
  assert.deepEqual(kommentarer.map((c) => c.text), ['aftalt med kunden']);
  const alle = (await a.kald('GET', '/api/v1/items?kind=task')).data.items;
  assert.equal(alle.find((t) => t.id === under.id).parentTaskId, importeret.id);
  assert.ok(!alle.some((t) => t.id === egen.id), 'dubletten blev staaende');

  // Linket i OneNote starter nu uret paa den importerede.
  const s = await fetch(`${srv.base}/s/${link.token}`);
  assert.equal(s.status, 200);
  const koerer = (await a.kald('GET', `/api/v1/entries?task=${importeret.id}`)).data.entries
    .find((e) => !e.stoppedAt);
  assert.ok(koerer, 'start-linket doede med den gamle opgave');
  await a.kald('POST', '/api/v1/timer/stop', {});
});

test('noter laegges sammen, naar begge har én', async () => {
  const egen = await opgave(a, 'egen');
  const imp = await opgave(a, 'importeret');
  await a.kald('PATCH', `/api/v1/items/${egen.id}`, { note: 'min' });
  await a.kald('PATCH', `/api/v1/items/${imp.id}`, { note: 'fra ServiceNow', estimateMinutes: 30 });
  const r = await a.kald('POST', `/api/v1/tasks/${egen.id}/merge`, { into: imp.id });
  assert.equal(r.data.item.note, 'fra ServiceNow\n\nmin');
  assert.equal(r.data.item.estimateMinutes, 30, 'den nyes estimat bevares');
});

test('en opgave kan ikke flettes ind i sig selv', async () => {
  const t = await opgave(a, 'alene');
  const r = await a.kald('POST', `/api/v1/tasks/${t.id}/merge`, { into: t.id });
  assert.equal(r.status, 400);
});

test('en anden bruger kan hverken flette fra eller ind i andreas\' opgaver', async () => {
  const hans = await opgave(a, 'andreas har den');
  await a.kald('POST', '/api/v1/entries', { taskId: hans.id, date: '2026-03-02', text: '1t' });
  const hendes = await opgave(b, 'bente har den');

  assert.equal((await b.kald('POST', `/api/v1/tasks/${hans.id}/merge`, { into: hendes.id })).status, 404);
  assert.equal((await b.kald('POST', `/api/v1/tasks/${hendes.id}/merge`, { into: hans.id })).status, 404);
  assert.equal((await a.kald('GET', `/api/v1/entries?task=${hans.id}`)).data.entries.length, 1,
    'andreas\' timer blev flyttet af en anden');
});
