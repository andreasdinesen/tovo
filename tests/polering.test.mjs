/* Fase 9: huller, eksport og Toggl-import.
 *
 * Eksporten er den, doda F9 advarer om: "man kan eksportere" er en paastand,
 * indtil der findes en test - og en eksportfil, brugeren maaske deler
 * videre, maa ikke baere hemmeligheder.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, opretBruger } from './hjaelp.mjs';

const require = createRequire(import.meta.url);
const beregn = require('../app/shared/beregn.js');
const toggl = require('../app/shared/toggl.js');

let srv;
let k;
let iDag;

before(async () => {
  srv = await startServer();
  k = (await opretBruger(srv, 'andreas')).klient;
  iDag = (await k.kald('GET', '/api/v1/state')).data.today;
});
after(() => srv.stop());

test('hullerne er dem MELLEM registreringerne - ikke morgenen', async () => {
  const a = await k.kald('POST', '/api/v1/capture', { text: 'formiddag @Nordvind' });
  const b = await k.kald('POST', '/api/v1/capture', { text: 'eftermiddag @Nordvind' });
  await k.kald('POST', '/api/v1/entries', { taskId: a.data.item.id, date: iDag, text: '9-10.30' });
  await k.kald('POST', '/api/v1/entries', { taskId: b.data.item.id, date: iDag, text: '12.45-15' });

  const d = (await k.kald('GET', `/api/v1/entries?from=${iDag}&to=${iDag}`)).data;
  assert.equal(d.gaps.length, 1, 'ét hul: mellem 10:30 og 12:45');
  assert.deepEqual(d.gaps[0], { fra: '10:30', til: '12:45', minutter: 135 });

  // Tiden FOER dagens foerste post er ikke et hul - det er morgen, og et
  // "hul" der begynder ved midnat ville vaere stoej hver eneste dag.
  assert.ok(!d.gaps.some((h) => h.fra === '00:00'));
});

test('smaa mellemrum er frokost og kaffe - ikke glemt tid', async () => {
  const c = await k.kald('POST', '/api/v1/capture', { text: 'lige efter' });
  await k.kald('POST', '/api/v1/entries', { taskId: c.data.item.id, date: iDag, text: '15.10-16' });
  const d = (await k.kald('GET', `/api/v1/entries?from=${iDag}&to=${iDag}`)).data;
  assert.equal(d.gaps.length, 1, 'de ti minutter mellem 15:00 og 15:10 taeller ikke');
});

test('huller spoerges kun om for ÉN dag', async () => {
  const d = (await k.kald('GET', `/api/v1/entries?from=${iDag}&to=2026-12-31`)).data;
  assert.deepEqual(d.gaps, [], 'et hul hen over en periode betyder ingenting');
});

test('hullerne regnes af det samme modul som resten', () => {
  // beregn.js er ét sted - ogsaa for det her tal.
  const b = beregn.opret({
    items: () => [],
    entries: () => [
      { taskId: 't', startedAt: beregn.tidspunkt('2026-08-18', '09:00'), stoppedAt: beregn.tidspunkt('2026-08-18', '10:00') },
      { taskId: 't', startedAt: beregn.tidspunkt('2026-08-18', '13:00'), stoppedAt: beregn.tidspunkt('2026-08-18', '14:00') },
    ],
    settings: () => ({}),
  });
  assert.deepEqual(b.hullerPaaDag('2026-08-18'), [{ fra: '10:00', til: '13:00', minutter: 180 }]);
  // Overlappende poster giver ikke et negativt hul.
  const o = beregn.opret({
    items: () => [],
    entries: () => [
      { taskId: 't', startedAt: beregn.tidspunkt('2026-08-18', '09:00'), stoppedAt: beregn.tidspunkt('2026-08-18', '12:00') },
      { taskId: 't', startedAt: beregn.tidspunkt('2026-08-18', '10:00'), stoppedAt: beregn.tidspunkt('2026-08-18', '11:00') },
    ],
    settings: () => ({}),
  });
  assert.deepEqual(o.hullerPaaDag('2026-08-18'), []);
});

test('eksporten indeholder alt - og INGEN hemmeligheder', async () => {
  // Hemmelighederne foerst, saa de har en chance for at slippe med.
  const opgave = (await k.kald('GET', '/api/v1/items?kind=task')).data.items[0];
  const link = (await k.kald('POST', `/api/v1/tasks/${opgave.id}/link`, {})).data.link;
  const feed = (await k.kald('POST', '/api/v1/ical', {})).data.feed;
  const noegle = (await k.kald('POST', '/api/v1/keys', { name: 'test', scope: 'full' })).data.key;

  const res = await fetch(`${srv.base}/api/v1/export`, { headers: { Cookie: k.cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="tovo-\d{4}-\d{2}-\d{2}\.json"/);
  const raa = await res.text();
  const d = JSON.parse(raa);

  assert.equal(d.tovo, 1);
  assert.ok(d.items.length >= 3, 'opgaver og projekter er med');
  assert.ok(d.entries.length >= 3, 'tidsposterne er med');
  assert.ok(d.entries[0].startedAt > 0);

  // En eksportfil kan blive delt videre. Et start-link eller kalender-token i
  // den ville give adgang til at starte timere og laese deadlines (doda F9).
  assert.ok(!raa.includes(link.token), 'start-tokenet maa ikke vaere i eksporten');
  assert.ok(!raa.includes(feed.token), 'kalender-tokenet maa ikke vaere i eksporten');
  assert.ok(!raa.includes(noegle), 'adgangsnoeglen maa ikke vaere i eksporten');
  assert.ok(!raa.includes('scrypt$'), 'kodeordshashen maa ikke vaere i eksporten');
});

test('eksporten naar kun EGNE data', async () => {
  await k.kald('POST', '/api/v1/settings', { allow_registration: true });
  const b = await opretBruger(srv, 'bo');
  await b.klient.kald('POST', '/api/v1/capture', { text: 'bos hemmelige opgave' });

  const res = await fetch(`${srv.base}/api/v1/export`, { headers: { Cookie: k.cookie } });
  const raa = await res.text();
  assert.ok(!raa.includes('bos hemmelige'), 'en anden brugers data maa aldrig komme med');

  const bs = await fetch(`${srv.base}/api/v1/export`, { headers: { Cookie: b.klient.cookie } });
  const bd = JSON.parse(await bs.text());
  assert.equal(bd.items.length, 1);
  assert.equal(bd.user, 'bo');
});

test('"import" er en femte kilde, saa historik kan kendes fra egen tid', async () => {
  const opgave = (await k.kald('GET', '/api/v1/items?kind=task')).data.items[0];
  const r = await k.kald('POST', '/api/v1/entries', {
    taskId: opgave.id,
    startedAt: beregn.tidspunkt('2026-01-06', '09:00'),
    stoppedAt: beregn.tidspunkt('2026-01-06', '11:00'),
    source: 'import',
  });
  assert.equal(r.data.entry.source, 'import');
  // En ukendt kilde falder tilbage til manuel frem for at faelde kaldet.
  const u = await k.kald('POST', '/api/v1/entries', {
    taskId: opgave.id, date: iDag, text: '30m', source: 'noget-vroevl',
  });
  assert.equal(u.data.entry.source, 'manuel');
});

/* ------------------------------------------------------ Toggl-CSV */


const HOVED = 'User,Email,Client,Project,Task,Description,Billable,Start date,Start time,'
  + 'End date,End time,Duration,Tags,Amount ()';

test('CSV: kommaer og anfoerselstegn INDE i et felt flytter ikke kolonnerne', () => {
  // "Migrering, del 2" er en helt almindelig beskrivelse. En split(',') ville
  // flytte alle foelgende kolonner én til venstre - og datoen ville lande i
  // tidsfeltet uden at nogen opdagede det.
  const csv = `${HOVED}\n`
    + 'A,a@b.dk,,Nordvind,,"Migrering, del 2",No,2026-08-17,09:00:00,2026-08-17,11:30:00,02:30:00,,0\n';
  const r = toggl.laesToggl(csv);
  assert.equal(r.poster.length, 1);
  assert.equal(r.poster[0].title, 'Migrering, del 2');
  assert.equal(r.poster[0].project, 'Nordvind');
  assert.equal(r.poster[0].start, '09:00');
  assert.equal(r.poster[0].minutter, 150);
});

test('CSV: dobbelt anfoerselstegn i en tekst', () => {
  const csv = `${HOVED}\n`
    + 'A,a@b.dk,,P,,"Han sagde ""nej"" til det",No,2026-08-17,09:00:00,2026-08-17,10:00:00,01:00:00,,0\n';
  assert.equal(toggl.laesToggl(csv).poster[0].title, 'Han sagde "nej" til det');
});

test('Toggl: Description foretraekkes, Task bruges naar den er tom', () => {
  const csv = `${HOVED}\n`
    + 'A,a@b.dk,,P,Opgavenavn,,No,2026-08-17,09:00:00,2026-08-17,10:00:00,01:00:00,,0\n';
  assert.equal(toggl.laesToggl(csv).poster[0].title, 'Opgavenavn');
});

test('Toggl: raekker uden brugbar tid springes over - hoejlydt', () => {
  const csv = `${HOVED}\n`
    + 'A,a@b.dk,,P,,Uden dato,No,ikke-en-dato,09:00:00,,,,,0\n'
    + 'A,a@b.dk,,P,,Uden tid,No,2026-08-17,,,,,,0\n'
    + 'A,a@b.dk,,P,,God,No,2026-08-17,09:00:00,2026-08-17,10:00:00,01:00:00,,0\n';
  const r = toggl.laesToggl(csv);
  assert.equal(r.poster.length, 1);
  assert.equal(r.advarsler.length, 2, 'de sprungne raekker skal SIGES - ikke forsvinde');
});

test('Toggl: en fil, der ikke er en detaljeret rapport, afvises med en vej videre', () => {
  assert.throws(() => toggl.laesToggl('noget,helt,andet\n1,2,3\n'), /Reports → Detailed/);
});

test('Toggl: varigheden laeses af Duration, og sekunder rundes', () => {
  assert.equal(toggl.togglVarighed('02:30:00'), 150);
  assert.equal(toggl.togglVarighed('00:00:45'), 1, '45 sekunder er ét minut, ikke nul');
  assert.equal(toggl.togglVarighed('00:00:20'), 0);
  assert.equal(toggl.togglVarighed('vroevl'), null);
});
