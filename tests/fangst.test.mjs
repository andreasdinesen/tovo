/* Fase 1 gennem det RIGTIGE API: fangst, soegning, links, kommentarer.
 *
 * Testene gaar gennem HTTP mod en koerende server - ikke direkte i
 * funktionerne. Det er den vej, brugeren og en kommende MCP-klient gaar, og
 * det er dér, fejlene har vist sig i de andre runer (doda F4).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, opretBruger } from './hjaelp.mjs';

let srv;
let k;      // klienten for bruger A

before(async () => {
  srv = await startServer();
  k = (await opretBruger(srv, 'andreas')).klient;
});
after(() => srv.stop());

test('+ opretter opgave OG projekt paa én linje', async () => {
  const r = await k.kald('POST', '/api/v1/capture',
    { text: '+ opsaetning af server @Nordvind ~2,5t !fredag' });
  assert.equal(r.status, 200);
  assert.equal(r.data.item.title, 'opsaetning af server');
  assert.equal(r.data.item.estimateMinutes, 150);
  assert.equal(r.data.item.dueDate, '2026-08-21');
  assert.equal(r.data.item.status, 'open');
  assert.deepEqual(r.data.nye, [{ kind: 'project', name: 'Nordvind' }]);

  const s = await k.kald('GET', '/api/v1/state');
  assert.equal(s.data.projects.length, 1);
  assert.equal(s.data.projects[0].name, 'Nordvind');
});

test('et projekt, der findes, genbruges - der laves ikke en dublet', async () => {
  const r = await k.kald('POST', '/api/v1/capture', { text: 'migrering @nordvind #internt' });
  assert.equal(r.data.nye.length, 1, 'kun taget er nyt');
  assert.equal(r.data.nye[0].kind, 'tag');
  const s = await k.kald('GET', '/api/v1/state');
  assert.equal(s.data.projects.length, 1, 'navnet matches uden hensyn til store bogstaver');
  assert.equal(s.data.tags.length, 1);
});

test('konteksten baerer, men et eksplicit @projekt vinder over den', async () => {
  const s = await k.kald('GET', '/api/v1/state');
  const nordvind = s.data.projects[0].id;

  const i = await k.kald('POST', '/api/v1/capture', { text: 'uden markoer', projectId: nordvind });
  assert.equal(i.data.item.projectId, nordvind, 'staar man i et projekt, lander opgaven der');

  const p2 = await k.kald('POST', '/api/v1/capture', { text: 'x @Andet', projectId: nordvind });
  const s2 = await k.kald('GET', '/api/v1/state');
  const andet = s2.data.projects.find((p) => p.name === 'Andet');
  assert.equal(p2.data.item.projectId, andet.id, 'teksten vinder over siden, man staar paa');
});

test('tom fangst afvises med en laesbar besked', async () => {
  const r = await k.kald('POST', '/api/v1/capture', { text: '   ' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /^[a-z][a-z0-9_]*$/);
});

test('soegning finder baade opgaver og projekter', async () => {
  const r = await k.kald('GET', '/api/v1/search?q=server');
  assert.equal(r.data.tasks.length, 1);
  assert.equal(r.data.tasks[0].title, 'opsaetning af server');

  const p = await k.kald('GET', '/api/v1/search?q=grund');
  assert.equal(p.data.projects.length, 1);

  // Staar man i et projekt, soeger feltet KUN der - og saa er projekter ikke
  // et resultat, man kan hoppe til.
  const s = await k.kald('GET', '/api/v1/state');
  const andet = s.data.projects.find((x) => x.name === 'Andet');
  const kun = await k.kald('GET', `/api/v1/search?q=server&project=${andet.id}`);
  assert.equal(kun.data.tasks.length, 0);
  assert.equal(kun.data.projects.length, 0);
});

test('onenote:-links kan gemmes og overlever hentningen', async () => {
  // Hele grunden til at tovo findes: opgaverne bor i OneNote.
  const ny = await k.kald('POST', '/api/v1/capture', { text: 'opgave med link' });
  const id = ny.data.item.id;
  const onenote = 'onenote:https://d.docs.live.net/abc/Noter.one#Nordvind&section-id=42';
  const r = await k.kald('PATCH', `/api/v1/items/${id}`, {
    links: [
      { url: onenote, label: 'OneNote-siden' },
      { url: 'https://dr.dk', label: '' },
      { url: 'javascript:alert(1)', label: 'ondt' },
      { url: 'data:text/html,<script>x</script>', label: 'ogsaa ondt' },
    ],
  });
  const links = r.data.item.links;
  assert.equal(links.length, 2, 'kun http(s) og onenote: slipper igennem');
  assert.equal(links[0].url, onenote, 'onenote-URL-en maa ikke saniteres vaek');
  assert.equal(links[0].label, 'OneNote-siden');
  assert.equal(links[1].label, 'dr.dk', 'uden etiket bruges adressen');

  const igen = await k.kald('GET', `/api/v1/items/${id}`);
  assert.equal(igen.data.item.links[0].url, onenote);
});

test('kommentarer haenger paa opgaven og kommer i raekkefoelge', async () => {
  const ny = await k.kald('POST', '/api/v1/capture', { text: 'opgave med kommentar' });
  const id = ny.data.item.id;
  await k.kald('POST', `/api/v1/tasks/${id}/comments`, { text: 'foerste' });
  await k.kald('POST', `/api/v1/tasks/${id}/comments`, { text: 'anden' });
  const r = await k.kald('GET', `/api/v1/tasks/${id}/comments`);
  assert.deepEqual(r.data.comments.map((c) => c.text), ['foerste', 'anden']);

  const tom = await k.kald('POST', `/api/v1/tasks/${id}/comments`, { text: '  ' });
  assert.equal(tom.status, 400);
});

test('afslutning stempler completedAt - og fortryd fjerner det igen', async () => {
  const ny = await k.kald('POST', '/api/v1/capture', { text: 'opgave der skal lukkes' });
  const id = ny.data.item.id;

  const luk = await k.kald('POST', `/api/v1/tasks/${id}/complete`, {});
  assert.equal(luk.data.item.status, 'done');
  assert.ok(luk.data.item.completedAt > 0);

  const aabn = await k.kald('POST', `/api/v1/tasks/${id}/complete`, { done: false });
  assert.equal(aabn.data.item.status, 'open');
  assert.equal(aabn.data.item.completedAt, null, 'et stempel, der bliver staaende, lyver i logbogen');
});

test('hvidlisten: ukendte felter falder fra, kendte overlever en delvis PATCH', async () => {
  // Det er forsikringen, fase 5 hviler paa: en opdatering af titlen maa ikke
  // kunne skrive estimatet vaek, og en klient maa ikke kunne smugle felter ind.
  const ny = await k.kald('POST', '/api/v1/capture', { text: 'opgave ~3t' });
  const id = ny.data.item.id;
  const r = await k.kald('PATCH', `/api/v1/items/${id}`,
    { title: 'ny titel', hemmeligtFelt: 'skal vaek', status: 'noget-vroevl' });
  assert.equal(r.data.item.title, 'ny titel');
  assert.equal(r.data.item.estimateMinutes, 180, 'estimatet skal overleve');
  assert.equal(r.data.item.hemmeligtFelt, undefined, 'ukendte felter gemmes ikke');
  assert.equal(r.data.item.status, 'open', 'en ukendt status falder tilbage til open');
});

test('position er et loebenummer - ikke et tidsstempel', async () => {
  // Skriver man now() i sorteringsfeltet, ser listen rigtig ud (tidsstempler
  // sorterer kronologisk), og manuel sortering er umulig bagefter (doda F3).
  const r = await k.kald('GET', '/api/v1/items?kind=project');
  const positioner = r.data.items.map((p) => p.position).sort((a, b) => a - b);
  assert.deepEqual(positioner, [0, 1]);
});
