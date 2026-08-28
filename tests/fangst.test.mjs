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
  /*
   * Datoen REGNES, den skrives ikke af.
   *
   * Testen stod med '2026-08-21' - den dag den blev skrevet var det naeste
   * fredag. Koert paa en fredag eller senere er det en ANDEN dato, og testen
   * blev roed uden at noget var i stykker. En test, der kun bestaar bestemte
   * ugedage, er stoej: naeste gang den lyser roedt, tror man paa den ét
   * sekund og holder saa op med at tro paa suiten.
   */
  const naesteFredag = (() => {
    const d = new Date();
    /*
     * INGEN `|| 7`. Parserens regel er "naeste forekomst, I DAG hvis i dag er
     * fredag" (parse.js:162, et dokumenteret valg - DESIGN.md §3).
     *
     * Her stod `|| 7`, og saa forventede testen naeste uges fredag. Den var
     * groen i en uge, fordi det kun er om FREDAGEN, de to svar er forskellige.
     * At regne datoen i stedet for at skrive den af fjernede den haardkodede
     * dato, men smuglede en formodning om BETYDNINGEN ind. Laes reglen af
     * kilden - gaet den ikke ud fra, hvad der foeles rigtigt.
     */
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  assert.equal(r.data.item.dueDate, naesteFredag);
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

  const p = await k.kald('GET', '/api/v1/search?q=nord');
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
  // Tidsstemplet er det, visningen daterer kommentaren med. Uden det kan
  // raekkefoelgen kun gaettes, og "hvornaar aftalte vi det?" kan ikke besvares.
  for (const c of r.data.comments) {
    assert.ok(c.createdAt > 0, 'en kommentar uden tidsstempel kan ikke dateres');
    assert.ok(Math.abs(c.createdAt - Math.floor(Date.now() / 1000)) < 120, 'stemplet skal vaere nu');
  }
  assert.ok(r.data.comments[0].createdAt <= r.data.comments[1].createdAt);

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

test('kolonner hoerer til PROJEKTET - to projekter kan have hver sine', async () => {
  // Tavlens kolonner er projektets sektioner. Laa de globalt, ville en
  // Planner-import kunne aendre faserne i et projekt, den intet har med at
  // goere.
  const a = (await k.kald('POST', '/api/v1/items', {
    kind: 'project',
    name: 'Med Planner-faser',
    sections: [{ id: 's1', name: 'Backlog', position: 0 }, { id: 's2', name: 'In progress', position: 1 }],
  })).data.item;
  const b = (await k.kald('POST', '/api/v1/items', {
    kind: 'project',
    name: 'Med egne faser',
    sections: [{ id: 'x1', name: 'Venter paa kunden', position: 0 }],
  })).data.item;

  assert.deepEqual(a.sections.map((s) => s.name), ['Backlog', 'In progress']);
  assert.deepEqual(b.sections.map((s) => s.name), ['Venter paa kunden']);

  // En aendring i det ene roerer ikke det andet.
  await k.kald('PATCH', `/api/v1/items/${b.id}`, {
    sections: [{ id: 'x1', name: 'Venter', position: 0 }, { id: 'x2', name: 'Faktureret', position: 1 }],
  });
  const aIgen = (await k.kald('GET', `/api/v1/items/${a.id}`)).data.item;
  assert.deepEqual(aIgen.sections.map((s) => s.name), ['Backlog', 'In progress']);

  // En sektion uden navn falder fra - en navnloes kolonne er ikke en kolonne.
  const c = await k.kald('PATCH', `/api/v1/items/${b.id}`, {
    sections: [{ id: 'x1', name: 'Venter', position: 0 }, { id: 'x3', name: '  ', position: 1 }],
  });
  assert.equal(c.data.item.sections.length, 1);
});

test('en flytning paa tavlen nummererer BEGGE kolonner om', async () => {
  const p = (await k.kald('POST', '/api/v1/items', {
    kind: 'project',
    name: 'Tavle',
    sections: [{ id: 'k1', name: 'Til', position: 0 }, { id: 'k2', name: 'Fra', position: 1 }],
  })).data.item;
  const opgaver = [];
  for (const navn of ['en', 'to', 'tre']) {
    const r = await k.kald('POST', '/api/v1/capture', { text: `${navn} kort`, projectId: p.id });
    opgaver.push(r.data.item);
  }
  // Alle tre i "Fra", i raekkefoelge.
  await k.kald('POST', '/api/v1/items/bulk', {
    items: opgaver.map((t, i) => ({ ...t, sectionId: 'k2', position: i })),
  });

  // Laes dem FRISKE igen. Tavlen gør det samme (den henter projektet efter
  // hver flytning) - og med forældede objekter ville sectionId fra foer
  // blive skrevet tilbage. Det var min egen testfejl foerste gang.
  const friske = (await k.kald('GET', `/api/v1/projects/${p.id}`)).data.tasks
    .sort((a, b) => a.position - b.position);
  const flyttet = friske.find((t) => t.title === 'to kort');
  const tilbage = friske.filter((t) => t.title !== 'to kort');
  await k.kald('POST', '/api/v1/items/bulk', {
    items: [
      { ...flyttet, sectionId: 'k1', position: 0 },
      ...tilbage.map((t, i) => ({ ...t, position: i })),
    ],
  });

  const efter = (await k.kald('GET', `/api/v1/projects/${p.id}`)).data.tasks;
  const iKolonne = (id) => efter.filter((t) => t.sectionId === id).sort((a, b) => a.position - b.position);
  assert.deepEqual(iKolonne('k1').map((t) => t.title), ['to kort']);
  assert.deepEqual(iKolonne('k2').map((t) => t.title), ['en kort', 'tre kort']);
  // Positionerne er 0, 1 - et loebenummer uden huller. Efterlades der huller,
  // driver raekkefoelgen efter et par flytninger (doda F3).
  assert.deepEqual(iKolonne('k2').map((t) => t.position), [0, 1]);
  assert.deepEqual(iKolonne('k1').map((t) => t.position), [0]);
});

test('% starter timeren med det samme - og kun naar det staar alene', async () => {
  const r = await k.kald('POST', '/api/v1/capture', { text: '% ring til kunden @Nordvind ~30m' });
  assert.equal(r.data.item.title, 'ring til kunden', 'flaget maa ikke staa i titlen');
  assert.equal(r.data.item.estimateMinutes, 30);
  assert.ok(r.data.timer, 'timeren skal koere paa den nye opgave');
  assert.equal(r.data.timer.entry.taskId, r.data.item.id);

  // Den gaar gennem den SAMME startTimer som alle andre veje: en koerende
  // timer stoppes automatisk, saa der kun er én.
  const anden = await k.kald('POST', '/api/v1/capture', { text: 'straks i gang %' });
  assert.equal(anden.data.timer.entry.taskId, anden.data.item.id);
  const nu = await k.kald('GET', '/api/v1/timer/current');
  assert.equal(nu.data.timer.taskTitle, 'straks i gang');
  const alle = (await k.kald('GET', '/api/v1/entries')).data.entries.filter((e) => !e.stoppedAt);
  assert.equal(alle.length, 1, 'der maa kun koere ÉN');
  await k.kald('POST', '/api/v1/timer/stop', {});

  // Uden flaget starter der ingenting.
  const uden = await k.kald('POST', '/api/v1/capture', { text: 'helt almindelig opgave' });
  assert.equal(uden.data.timer, null);
  assert.equal((await k.kald('GET', '/api/v1/timer/current')).data.timer, null);
});

test('% i almindelig tekst er almindelig tekst', async () => {
  // "100% faerdig" og "5%rabat" maa ikke saette en timer i gang. Reglen er,
  // at tegnet skal have mellemrum (eller linjeslut) paa BEGGE sider.
  for (const tekst of ['100% faerdig', 'giv 5%rabat', 'tjek 50%50 fordelingen']) {
    const r = await k.kald('POST', '/api/v1/capture', { text: tekst });
    assert.equal(r.data.timer, null, `"${tekst}" startede en timer`);
    assert.equal(r.data.item.title, tekst, `"${tekst}" blev aendret`);
  }
});

test('syntaks i en titel, man RETTER, virker ligesom ved oprettelsen', async () => {
  const ny = await k.kald('POST', '/api/v1/capture', { text: 'status moede' });
  const id = ny.data.item.id;

  // Skriv "#Ai" ind i titlen paa en opgave, der allerede findes.
  const r = await k.kald('POST', `/api/v1/tasks/${id}/syntax`, { text: 'status moede #Ai' });
  assert.equal(r.data.item.title, 'status moede', 'markoeren maa ikke blive staaende i titlen');
  assert.deepEqual(r.data.nye, [{ kind: 'tag', name: 'Ai' }], 'maerkatet oprettes');
  assert.equal(r.data.item.tagIds.length, 1);

  const tags = (await k.kald('GET', '/api/v1/tags')).data.tags;
  assert.ok(tags.some((t) => t.name === 'Ai' && t.count === 1));
});

test('et maerkat LAEGGES TIL - de gamle ryger ikke', async () => {
  const opgaver = (await k.kald('GET', '/api/v1/items?kind=task')).data.items;
  const en = opgaver.find((t) => t.title === 'status moede');
  const r = await k.kald('POST', `/api/v1/tasks/${en.id}/syntax`, { text: 'status moede #internt' });
  assert.equal(r.data.item.tagIds.length, 2, 'skriver man #internt, mener man ikke at #Ai skal vaek');
});

test('hele syntaksen virker ved redigering - undtagen %', async () => {
  const ny = await k.kald('POST', '/api/v1/capture', { text: 'ren opgave' });
  const r = await k.kald('POST', `/api/v1/tasks/${ny.data.item.id}/syntax`,
    // Et projektnavn med mellemrum SKAL i anfoerselstegn - ellers tager
    // parseren kun det foerste ord, og resten bliver staaende i titlen.
    { text: 'ren opgave @"Nyt projekt" :SAG-9 ~90m !3/9' });
  assert.equal(r.data.item.title, 'ren opgave');
  assert.equal(r.data.item.caseNumber, 'SAG-9');
  assert.equal(r.data.item.estimateMinutes, 90);
  assert.equal(r.data.item.dueDate, '2026-09-03');
  assert.ok(r.data.item.projectId, 'projektet blev oprettet og sat');
  assert.equal(r.data.nye[0].name, 'Nyt projekt');

  // `%` har ingen modtager ved en REDIGERING: at starte en timer er en
  // handling ved oprettelsen. Saa bliver tegnet staaende, og svaret siger det.
  const medProcent = await k.kald('POST', `/api/v1/tasks/${ny.data.item.id}/syntax`,
    { text: 'ren opgave %' });
  assert.match(medProcent.data.item.title, /%$/, 'tegnet maa ikke bare forsvinde');
  assert.deepEqual(medProcent.data.ignored, ['%']);
  assert.equal((await k.kald('GET', '/api/v1/timer/current')).data.timer, null, 'og der maa ikke starte en timer');
});

test('syntaksen har det sidste ord over rudens tomme felter', async () => {
  // Fejlen der var: ruden gemte sit TOMME sagsfelt oven paa det, ":SAG-77"
  // i titlen lige havde sat. Det man skriver, er det mest specifikke.
  const ny = await k.kald('POST', '/api/v1/capture', { text: 'rydde op' });
  await k.kald('PATCH', `/api/v1/items/${ny.data.item.id}`, { caseNumber: '' });
  const r = await k.kald('POST', `/api/v1/tasks/${ny.data.item.id}/syntax`,
    { text: 'rydde op :SAG-77 ~45m' });
  assert.equal(r.data.item.caseNumber, 'SAG-77');
  assert.equal(r.data.item.estimateMinutes, 45);
});

/* ------------------------------------------------------- kopi af en opgave */

test('en kopi baerer det, der beskriver ARBEJDET - og intet af historikken', async () => {
  const p = (await k.kald('POST', '/api/v1/items', { kind: 'project', name: 'Kopiprojekt' })).data.item;
  const tag = (await k.kald('POST', '/api/v1/items', { kind: 'tag', name: 'drift' })).data.item;
  const org = (await k.kald('POST', '/api/v1/items', {
    kind: 'task',
    title: 'Opsaetning af server',
    note: 'husk at spoerge til overvaagningen',
    projectId: p.id,
    sectionId: 'sek-0-backlog',
    estimateMinutes: 240,
    priority: 'high',
    dueDate: '2026-09-01',
    dueTime: '09:00',
    caseNumber: 'SAG-77',
    tagIds: [tag.id],
    links: [{ url: 'onenote:https://d.docs.live.net/x/Noter.one#Ops', label: 'OneNote' }],
    plannerTaskId: 'p1',
    recurrenceRule: { type: 'weekly', weekday: 1, mode: 'plan' },
  })).data.item;

  // Historik paa originalen: tid, kommentar, start-link - og den er afsluttet.
  await k.kald('POST', '/api/v1/entries', { taskId: org.id, date: '2026-08-17', text: '2,5t' });
  await k.kald('POST', `/api/v1/tasks/${org.id}/comments`, { text: 'aftalt med kunden' });
  const orgLink = (await k.kald('POST', `/api/v1/tasks/${org.id}/link`, {})).data.link.token;
  await k.kald('POST', `/api/v1/tasks/${org.id}/complete`, {});

  const kopi = (await k.kald('POST', `/api/v1/tasks/${org.id}/duplicate`, {})).data.item;

  // MED: alt der beskriver selve arbejdet.
  assert.equal(kopi.title, 'Opsaetning af server (copy)');
  assert.equal(kopi.note, 'husk at spoerge til overvaagningen');
  assert.equal(kopi.projectId, p.id);
  assert.equal(kopi.sectionId, 'sek-0-backlog', 'kopien lander i samme kolonne');
  assert.equal(kopi.estimateMinutes, 240);
  assert.equal(kopi.priority, 'high');
  assert.equal(kopi.dueDate, '2026-09-01');
  assert.equal(kopi.dueTime, '09:00');
  assert.equal(kopi.caseNumber, 'SAG-77');
  assert.deepEqual(kopi.tagIds, [tag.id]);
  assert.equal(kopi.links.length, 1);

  // UDEN: historikken, og alt der ville goere to opgaver til den samme.
  assert.notEqual(kopi.id, org.id);
  assert.equal(kopi.status, 'open', 'kopien er aaben, ogsaa selv om originalen er afsluttet');
  assert.ok(!kopi.completedAt, 'kopien har ikke arvet et fuldfoerelses-stempel');
  assert.ok(!kopi.recurrenceRule, 'to opgaver, der begge formerer sig, opdages foerst en uge senere');
  assert.ok(!kopi.plannerTaskId, 'ellers er en genimport tvetydig, og den ene ser forsvundet ud');

  const poster = (await k.kald('GET', '/api/v1/entries?from=2020-01-01&to=2030-01-01')).data.entries;
  assert.equal(poster.filter((e) => e.taskId === kopi.id).length, 0, 'kopien har ingen tid paa sig');
  assert.equal(poster.filter((e) => e.taskId === org.id).length, 1, 'originalens tid staar uroert');

  const kom = (await k.kald('GET', `/api/v1/tasks/${kopi.id}/comments`)).data.comments;
  assert.equal(kom.length, 0, 'kommentarer er historik om det, der ER sket');

  const nytLink = (await k.kald('POST', `/api/v1/tasks/${kopi.id}/link`, {})).data.link.token;
  assert.notEqual(nytLink, orgLink, 'to opgaver med samme token ville dele ur');

  // Originalen maa ikke vaere roert af at blive kopieret.
  const orgNu = (await k.kald('GET', `/api/v1/items/${org.id}`)).data.item;
  assert.equal(orgNu.status, 'done');
  assert.equal(orgNu.plannerTaskId, 'p1');
  assert.ok(orgNu.recurrenceRule);
});

test('kopien kan faa sin egen titel med det samme', async () => {
  const org = (await k.kald('POST', '/api/v1/items', { kind: 'task', title: 'Grundopsaetning' })).data.item;
  const kopi = (await k.kald('POST', `/api/v1/tasks/${org.id}/duplicate`,
    { title: 'Grundopsaetning - kunde 2' })).data.item;
  assert.equal(kopi.title, 'Grundopsaetning - kunde 2');
});

test('duplicate paa noget, der ikke er en opgave, giver 404', async () => {
  const p = (await k.kald('POST', '/api/v1/items', { kind: 'project', name: 'Ikke en opgave' })).data.item;
  assert.equal((await k.kald('POST', `/api/v1/tasks/${p.id}/duplicate`, {})).status, 404);
});
