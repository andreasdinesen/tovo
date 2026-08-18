/* Fase 5: Planner-import og GENIMPORT.
 *
 * Planen kalder genimport-testen den vigtigste i hele projektet, og det er
 * den: importér, saet estimater, registrér tid, ret noget i Planner,
 * genimportér - og assertér at tovos egne felter er uroerte. Uden den er
 * "importen oedelaegger ikke noget" en paastand.
 *
 * Kolonnenavnene herunder er verificeret mod en rigtig eksport (2026-08-18),
 * inklusive de efterstillede mellemrum i overskrifterne.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, opretBruger } from './hjaelp.mjs';

const require = createRequire(import.meta.url);
const planner = require('../app/shared/planner.js');
const beregn = require('../app/shared/beregn.js');

const HOVED = ['Opgave-id', 'Opgavenavn ', 'Bucket', 'Mål', 'Status', 'Prioritet', 'Tildelt til',
  'Oprettet af', 'Oprettelsesdato', 'Forfaldsdato', 'Startdato', 'Er tilbagevendende', 'Forsinket',
  'Fuldføringsdato', 'Færdiggjort af', 'Afsluttede tjeklisteelementer', 'Tjeklisteelementer',
  'Mærkater', 'Noter'];

/** Bygger et ark som det, laesXlsx() leverer. */
function eksport(opgaver, opt = {}) {
  const raekker = opgaver.map((o) => {
    const r = new Array(HOVED.length).fill('');
    r[0] = o.id; r[1] = o.navn; r[2] = o.bucket || ''; r[4] = o.status || 'Ikke startet';
    r[5] = o.prioritet || 'Mellem'; r[9] = o.forfald || ''; r[13] = o.fuldfoert || '';
    r[15] = o.tjekliste ? `0/${o.tjekliste.split(';').length}` : '';
    r[16] = o.tjekliste || ''; r[18] = o.noter === undefined ? '' : o.noter;
    return r;
  });
  return {
    Plan: [['Abonnement-id', 'Navn på plan ', 'Dato for eksport '],
      [opt.planId || 'pln1', opt.planNavn || 'Nordvind - TRIO 11', '2026-08-18']],
    'Konsoliderede data': [HOVED, ...raekker],
    Buckets: [['Bucket-id', 'Bucket-navn '], ['b1', 'Backlog']],
  };
}

test('kolonnegenkendelsen taaler de rigtige overskrifter', () => {
  const kort = planner.kolonneKort(HOVED);
  assert.equal(kort.plannerTaskId, 0);
  assert.equal(kort.title, 1, 'overskriften har et efterstillet mellemrum');
  assert.equal(kort.section, 2);
  assert.equal(kort.status, 4, 'kolonnen hedder Status - ikke Fremdrift, som planen gaettede');
  assert.equal(kort.note, 18, 'beskrivelsen hedder Noter - ikke Beskrivelse');
  // Den vigtigste: praefiksmatch, ikke "indeholder". Ellers bliver
  // underopgaverne til taelleren "0/3".
  assert.equal(kort.checklist, 16);
  assert.notEqual(kort.checklist, 15);
});

test('arkvalg: konsoliderede foretraekkes, ellers opgaver + buckets', () => {
  assert.deepEqual(planner.vaelgArk(['Plan', 'Konsoliderede data', 'Opgaver', 'Buckets']),
    { ark: 'Konsoliderede data', buckets: null });
  assert.deepEqual(planner.vaelgArk(['Plan', 'Opgaver', 'Buckets']),
    { ark: 'Opgaver', buckets: 'Buckets' });
  assert.equal(planner.vaelgArk(['Plan', 'Brugere']), null);
});

test('uden Opgave-id stopper importen HOEJLYDT', () => {
  // Hele genimport-modellen hviler paa den kolonne. Fortsaetter man uden,
  // laver hver eneste import dubletter - og det opdages foerst efter tre.
  const uden = eksport([{ id: 'a', navn: 'x' }]);
  uden['Konsoliderede data'][0] = HOVED.map((h, i) => (i === 0 ? 'Noget andet' : h));
  assert.throws(() => planner.laesEksport(uden), /Opgave-id/);
});

test('bucket-id oversaettes til navn, naar arket ikke er det konsoliderede', () => {
  const e = eksport([{ id: 'a', navn: 'x', bucket: 'b1' }]);
  delete e['Konsoliderede data'];
  e.Opgaver = [HOVED, [...new Array(HOVED.length).fill('')]];
  e.Opgaver[1][0] = 'a'; e.Opgaver[1][1] = 'x'; e.Opgaver[1][2] = 'b1'; e.Opgaver[1][4] = 'Ikke startet';
  const r = planner.laesEksport(e);
  assert.equal(r.tasks[0].section, 'Backlog');
});

test('status og datoer laeses som de faktisk staar', () => {
  const r = planner.laesEksport(eksport([
    { id: '1', navn: 'a', status: 'Ikke startet' },
    { id: '2', navn: 'b', status: 'I gang' },
    { id: '3', navn: 'c', status: 'Fuldført', fuldfoert: '2026-08-14' },
    { id: '4', navn: 'd', status: 'Noget nyt fra Microsoft', forfald: '2026-09-01' },
  ]));
  assert.deepEqual(r.tasks.map((t) => t.status), ['open', 'doing', 'done', 'open']);
  assert.equal(r.tasks[2].completedAt, '2026-08-14');
  assert.equal(r.tasks[3].dueDate, '2026-09-01');
  // En ukendt status maa ikke faelde importen - kun advare.
  assert.match(r.warnings.join(' '), /Unknown status/);
  // Serienumre taales, selv om den rigtige eksport bruger ISO-tekst.
  assert.equal(planner.laesDato('46252'), '2026-08-18', 'serienummer = dage siden 1899-12-30');
});

test('tjeklisteelementer bliver til underopgaver, ikke til taelleren', () => {
  const r = planner.laesEksport(eksport([{ id: '1', navn: 'a', tjekliste: 'Et;To;Tre' }]));
  assert.deepEqual(r.tasks[0].checklist, ['Et', 'To', 'Tre']);
});

test('Noter genkendes som estimater - men kun som et FORSLAG', () => {
  const tal = planner.laesEksport(eksport([
    { id: '1', navn: 'a', noter: '6,1' }, { id: '2', navn: 'b', noter: '19,6' },
    { id: '3', navn: 'c', noter: '5,2' },
  ])).tasks;
  const ja = planner.noterLignerEstimater(tal);
  assert.equal(ja.ligner, true);
  assert.equal(ja.antal, 3);
  assert.equal(beregn.parseVarighed(tal[0].note), 366, '6,1 timer = 366 minutter');

  const prosa = planner.laesEksport(eksport([
    { id: '1', navn: 'a', noter: 'Husk at spoerge til deres overvaagning' },
    { id: '2', navn: 'b', noter: 'Aftalt med Jens' },
  ])).tasks;
  assert.equal(planner.noterLignerEstimater(prosa).ligner, false);
});

/* ---------------------------------------------------------- genimport */

let srv;
let k;
let projekt;

before(async () => {
  srv = await startServer();
  k = (await opretBruger(srv, 'andreas')).klient;
});
after(() => srv.stop());

test('DEN VIGTIGSTE: genimport roerer aldrig estimat, tid, links eller kommentarer', async () => {
  // 1. Foerste import.
  const foerste = planner.laesEksport(eksport([
    { id: 'p1', navn: 'Opsaetning', bucket: 'Backlog', tjekliste: 'Et;To' },
    { id: 'p2', navn: 'Migrering', bucket: 'Backlog', forfald: '2026-09-01' },
  ]));
  const sam1 = planner.sammenlign(foerste.tasks, [], { sections: [] });
  assert.equal(sam1.nye.length, 2);

  const p = (await k.kald('POST', '/api/v1/items', {
    kind: 'project',
    name: foerste.plan.name,
    plannerPlanId: foerste.plan.id,
    sections: sam1.sektioner.map((s, i) => ({ id: s.id, name: s.name, position: i })),
  })).data.item;

  const nye = sam1.nye.map((n) => Object.assign(planner.flet(n.planner, n.felter, null), { projectId: p.id }));
  await k.kald('POST', '/api/v1/items/bulk', { items: nye });

  let opgaver = (await k.kald('GET', `/api/v1/projects/${p.id}`)).data.tasks;
  assert.equal(opgaver.length, 2);
  const opsaetning = opgaver.find((t) => t.plannerTaskId === 'p1');

  // 2. tovos EGNE data oven paa: estimat, tid, link, kommentar, prioritet.
  await k.kald('PATCH', `/api/v1/items/${opsaetning.id}`, {
    estimateMinutes: 240,
    priority: 'high',
    links: [{ url: 'onenote:https://d.docs.live.net/x/Noter.one#Opsaetning', label: 'OneNote' }],
  });
  await k.kald('POST', '/api/v1/entries', { taskId: opsaetning.id, date: '2026-08-17', text: '2,5t' });
  await k.kald('POST', `/api/v1/tasks/${opsaetning.id}/comments`, { text: 'aftalt med kunden' });
  const linkFoer = (await k.kald('POST', `/api/v1/tasks/${opsaetning.id}/link`, {})).data.link.token;

  // 3. Planen aendrer sig: titel, status, forfaldsdato, ny opgave, én vaek.
  const anden = planner.laesEksport(eksport([
    { id: 'p1', navn: 'Opsaetning af server', bucket: 'Up next', status: 'I gang', forfald: '2026-09-05', tjekliste: 'Et;To;Tre' },
    { id: 'p3', navn: 'Ny opgave fra Planner', bucket: 'Backlog' },
  ]));
  opgaver = (await k.kald('GET', `/api/v1/projects/${p.id}`)).data.tasks;
  const projektNu = (await k.kald('GET', `/api/v1/items/${p.id}`)).data.item;
  const sam2 = planner.sammenlign(anden.tasks, opgaver, { sections: projektNu.sections });

  assert.equal(sam2.nye.length, 1, 'p3 er ny');
  assert.equal(sam2.opdaterede.length, 1, 'p1 er aendret');
  assert.equal(sam2.forsvundne.length, 1, 'p2 er vaek fra Planner');
  assert.equal(sam2.forsvundne[0].plannerTaskId, 'p2');
  assert.deepEqual(Object.keys(sam2.opdaterede[0].aendringer).sort(),
    ['dueDate', 'sectionId', 'status', 'title']);

  const skal = sam2.opdaterede.map((o) => Object.assign(planner.flet(o.planner, o.felter, o.task), { projectId: p.id }))
    .concat(sam2.nye.map((n) => Object.assign(planner.flet(n.planner, n.felter, null), { projectId: p.id })));
  await k.kald('POST', '/api/v1/items/bulk', { items: skal });

  // 4. Det, importen SKULLE aendre:
  const efter = (await k.kald('GET', `/api/v1/items/${opsaetning.id}`)).data;
  assert.equal(efter.item.title, 'Opsaetning af server');
  assert.equal(efter.item.status, 'doing');
  assert.equal(efter.item.dueDate, '2026-09-05');

  // 5. Og alt det, den ALDRIG maa roere:
  assert.equal(efter.item.estimateMinutes, 240, 'estimatet er tovos eget');
  assert.equal(efter.item.priority, 'high', 'prioritet sat i tovo overlever');
  assert.equal(efter.item.links.length, 1, 'links overlever');
  assert.match(efter.item.links[0].url, /^onenote:/);
  assert.equal(efter.link.token, linkFoer, 'start-linket i OneNote virker stadig');

  const poster = (await k.kald('GET', `/api/v1/entries?task=${opsaetning.id}`)).data.entries;
  assert.equal(poster.length, 1, 'tidsposten er der');
  assert.equal((poster[0].stoppedAt - poster[0].startedAt) / 60, 150);

  const kommentarer = (await k.kald('GET', `/api/v1/tasks/${opsaetning.id}/comments`)).data.comments;
  assert.equal(kommentarer.length, 1);
  assert.equal(kommentarer[0].text, 'aftalt med kunden');

  // 6. Den forsvundne er ikke roert af sig selv - valget er brugerens.
  const p2 = (await k.kald('GET', `/api/v1/items/${sam2.forsvundne[0].id}`)).data.item;
  assert.equal(p2.status, 'open');
});

test('en tredje import uden aendringer skriver INGENTING', async () => {
  // Idempotens: koerer man den samme fil igen, skal forhaandsvisningen sige
  // nul opdaterede. Ellers ville hver import roere alle raekker og gemme et
  // nyt updated_at - og "hvad er der aendret siden sidst" blev ubrugeligt.
  const e = planner.laesEksport(eksport([
    { id: 'p1', navn: 'Opsaetning af server', bucket: 'Up next', status: 'I gang', forfald: '2026-09-05' },
    { id: 'p3', navn: 'Ny opgave fra Planner', bucket: 'Backlog' },
  ]));
  const p = (await k.kald('GET', '/api/v1/items?kind=project')).data.items[0];
  const opgaver = (await k.kald('GET', `/api/v1/projects/${p.id}`)).data.tasks;
  const sam = planner.sammenlign(e.tasks, opgaver, { sections: p.sections });
  assert.equal(sam.nye.length, 0);
  assert.equal(sam.opdaterede.length, 0, 'intet at opdatere, naar intet er aendret');
});

test('Noter-som-estimat gaelder kun NYE opgaver - og teksten bliver ikke ogsaa beskrivelse', () => {
  const e = planner.laesEksport(eksport([{ id: 'n1', navn: 'Med timer', noter: '6,1' }]));
  const sam = planner.sammenlign(e.tasks, [], { sections: [] });
  const ny = planner.flet(sam.nye[0].planner, sam.nye[0].felter, null,
    { noterSomEstimat: true, estimatMinutter: beregn.parseVarighed('6,1') });
  assert.equal(ny.estimateMinutes, 366);
  assert.equal(ny.note, '', 'et tal er ikke en beskrivelse');

  // Ved genimport af den samme opgave roeres estimatet ikke, uanset hvad
  // der staar i Noter.
  const eksisterende = { id: 'x', plannerTaskId: 'n1', estimateMinutes: 999, title: 'Med timer' };
  const sam2 = planner.sammenlign(e.tasks, [eksisterende], { sections: [] });
  if (sam2.opdaterede.length) {
    const flettet = planner.flet(sam2.opdaterede[0].planner, sam2.opdaterede[0].felter, eksisterende);
    assert.equal(flettet.estimateMinutes, 999);
  }
});

test('hvidlisten er hvidliste - et nyt felt kan ikke smutte med', () => {
  // Reglen skrevet som en test: tilfoejer nogen et felt til modellen, kommer
  // det IKKE automatisk med i en genimport.
  assert.deepEqual(planner.FLETTEFELTER,
    ['title', 'sectionId', 'status', 'dueDate', 'note', 'completedAt']);
  const eksisterende = {
    id: 'x', plannerTaskId: 'p9', title: 'gammel', estimateMinutes: 60,
    links: [{ url: 'https://x.dk' }], tagIds: ['t1'], budgetHours: 5, nytFeltFraFremtiden: 'bevares',
  };
  const flettet = planner.flet({ plannerTaskId: 'p9' }, { title: 'ny', status: 'done' }, eksisterende);
  assert.equal(flettet.title, 'ny');
  assert.equal(flettet.estimateMinutes, 60);
  assert.equal(flettet.tagIds[0], 't1');
  assert.equal(flettet.nytFeltFraFremtiden, 'bevares');
});
