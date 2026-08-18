/* Fase 6: ugerapporten.
 *
 * Accepten er, at en uge med blandede projekt- og ad hoc-timer giver en
 * rapport, hvis tal stemmer med en MANUEL optaelling. Derfor regnes den
 * facit i testen selv - ikke ved at kalde den samme funktion igen.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, opretBruger } from './hjaelp.mjs';

const require = createRequire(import.meta.url);
const beregn = require('../app/shared/beregn.js');

let srv;
let k;
let mandag;
let projektId;

/** Mandagen i indevaerende uge - rapportens standardperiode. */
function ugensMandag() {
  const d = new Date();
  const ugedag = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - (ugedag - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const plusDage = (iso, n) => {
  const [aa, mm, dd] = iso.split('-').map(Number);
  const d = new Date(aa, mm - 1, dd + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

before(async () => {
  srv = await startServer();
  k = (await opretBruger(srv, 'andreas')).klient;
  mandag = ugensMandag();

  // To projektopgaver og én ad hoc.
  const a = await k.kald('POST', '/api/v1/capture', { text: 'opsaetning @Nordvind ~4t' });
  const b = await k.kald('POST', '/api/v1/capture', { text: 'migrering @Nordvind ~2t' });
  const c = await k.kald('POST', '/api/v1/capture', { text: 'mail og smaating' });
  projektId = (await k.kald('GET', '/api/v1/state')).data.projects[0].id;

  // Mandag: 4t + 1t (en almindelig dag). Tirsdag: 3,5t. Onsdag: 20m (tynd).
  //
  // Mandagen var foerst 2t + 1t, og saa blev den markeret som tynd - med
  // rette: en dagsnorm paa 37/5 = 7,4 t goer 3 timer til under halvdelen.
  // Det var testdataene, der var misvisende, ikke reglen.
  await k.kald('POST', '/api/v1/entries', { taskId: a.data.item.id, date: mandag, text: '9-13' });
  await k.kald('POST', '/api/v1/entries', { taskId: c.data.item.id, date: mandag, text: '13-14' });
  await k.kald('POST', '/api/v1/entries', { taskId: b.data.item.id, date: plusDage(mandag, 1), text: '3,5t' });
  await k.kald('POST', '/api/v1/entries', { taskId: a.data.item.id, date: plusDage(mandag, 2), text: '20m' });

  // Én opgave afsluttes i perioden.
  await k.kald('POST', `/api/v1/tasks/${b.data.item.id}/complete`, {});
  await k.kald('POST', '/api/v1/settings', { norm_week_hours: 37 });
});
after(() => srv.stop());

test('tallene stemmer med en manuel optaelling', async () => {
  const d = (await k.kald('GET', `/api/v1/report?from=${mandag}&to=${plusDage(mandag, 6)}`)).data;
  const r = d.report;

  // Manuel facit: 240 + 60 + 210 + 20 = 530 minutter.
  assert.equal(r.total, 530);
  assert.equal(r.entries, 4);
  // Ad hoc er "mail og smaating" = 60. Resten er projekt.
  assert.equal(r.adhoc, 60);
  assert.equal(r.onProjects, 470);
  assert.equal(r.adhoc + r.onProjects, r.total, 'fordelingen skal gaa op i totalen');

  // Grupperingen: ét projekt + ad hoc-gruppen.
  const nordvind = r.projects.find((p) => p.name === 'Nordvind');
  assert.equal(nordvind.minutter, 470);
  assert.equal(nordvind.tasks.find((t) => t.title === 'opsaetning').minutter, 260);
  assert.equal(nordvind.tasks.find((t) => t.title === 'migrering').minutter, 210);
  assert.equal(r.projects.find((p) => p.projectId === null).minutter, 60);

  // Sum af raekker = projektets total = rapportens total. Kan en kunde ikke
  // laegge tallene sammen selv og faa det samme, er rapporten ubrugelig.
  for (const p of r.projects) {
    assert.equal(p.tasks.reduce((n, t) => n + t.minutter, 0), p.minutter, `${p.name} stemmer ikke`);
  }
  assert.equal(r.projects.reduce((n, p) => n + p.minutter, 0), r.total);
});

test('estimat mod forbrug pr. opgave - og hvad der blev AFSLUTTET i perioden', async () => {
  const d = (await k.kald('GET', `/api/v1/report?from=${mandag}&to=${plusDage(mandag, 6)}`)).data;
  const nordvind = d.report.projects.find((p) => p.name === 'Nordvind');
  const migrering = nordvind.tasks.find((t) => t.title === 'migrering');
  assert.equal(migrering.estimateMinutes, 120);
  assert.equal(migrering.minutter, 210, '90 minutter over estimatet');
  assert.equal(migrering.completedIPerioden, true);
  assert.equal(nordvind.tasks.find((t) => t.title === 'opsaetning').completedIPerioden, false);
  assert.equal(d.report.completed, 1);
});

test('dage med paafaldende faa timer fremhaeves - tomme dage gaettes der ikke paa', async () => {
  const d = (await k.kald('GET', `/api/v1/report?from=${mandag}&to=${plusDage(mandag, 6)}`)).data;
  const dage = d.report.days;
  assert.equal(dage.length, 7);
  assert.equal(dage[0].minutter, 300);
  assert.equal(dage[2].minutter, 20);
  assert.equal(dage[2].tynd, true, '20 minutter paa en hverdag er glemt registrering');
  assert.equal(dage[0].tynd, false, '5 timer paa en dag er ikke paafaldende');
  // En weekenddag uden timer er ikke paafaldende.
  assert.equal(dage[5].tom, false);
  assert.equal(dage[6].tom, false);
  assert.equal(dage[3].tom, true, 'en tom hverdag er derimod vaerd at se');
});

test('normtid og sammenligning med forrige periode', async () => {
  const d = (await k.kald('GET', `/api/v1/report?from=${mandag}&to=${plusDage(mandag, 6)}`)).data;
  assert.equal(d.report.norm, 37 * 60);
  assert.equal(d.report.overNorm, 530 - 37 * 60, 'forskellen maa gerne vaere negativ');
  // Forrige uge er tom - og saa er sammenligningen 0, ikke en fejl.
  assert.equal(d.previous.total, 0);
  assert.equal(d.previous.days.length, 7);
});

test('perioden er halvaaben: to naboperioder taeller hverken dobbelt eller taber', async () => {
  const uge1 = (await k.kald('GET', `/api/v1/report?from=${mandag}&to=${plusDage(mandag, 2)}`)).data.report;
  const uge2 = (await k.kald('GET', `/api/v1/report?from=${plusDage(mandag, 3)}&to=${plusDage(mandag, 6)}`)).data.report;
  const hele = (await k.kald('GET', `/api/v1/report?from=${mandag}&to=${plusDage(mandag, 6)}`)).data.report;
  assert.equal(uge1.total + uge2.total, hele.total);
});

test('rapportens tal er de SAMME som beregn.js giver frontenden', async () => {
  // Igen Beanledger v28: to sandheder er fejlen, der skal forhindres.
  // Skaeve tider, saa afrundingen faktisk kan ses.
  await k.kald('POST', '/api/v1/entries', {
    taskId: (await k.kald('GET', '/api/v1/items?kind=task')).data.items[0].id,
    date: plusDage(mandag, 4), text: '22m',
  });
  const opgaver = (await k.kald('GET', '/api/v1/items?kind=task')).data.items;
  const projekter = (await k.kald('GET', '/api/v1/items?kind=project')).data.items;
  const poster = (await k.kald('GET', '/api/v1/entries')).data.entries;

  for (const afrunding of [0, 15]) {
    await k.kald('POST', '/api/v1/settings', { rounding: afrunding });
    const server = (await k.kald('GET', `/api/v1/report?from=${mandag}&to=${plusDage(mandag, 6)}`)).data.report;
    const b = beregn.opret({
      items: (kind) => ({ task: opgaver, project: projekter }[kind] || []),
      entries: () => poster,
      settings: () => ({ rounding: afrunding, normWeekHours: 37 }),
    });
    const [aa, mm, dd] = mandag.split('-').map(Number);
    const fra = Math.floor(new Date(aa, mm - 1, dd).getTime() / 1000);
    const lokal = b.ugerapport(fra, fra + 7 * 86400);
    assert.equal(lokal.total, server.total, `total afviger ved afrunding ${afrunding}`);
    assert.equal(lokal.adhoc, server.adhoc);
    assert.equal(lokal.onProjects, server.onProjects);
    assert.deepEqual(lokal.days.map((x) => x.minutter), server.days.map((x) => x.minutter));
  }
  await k.kald('POST', '/api/v1/settings', { rounding: 0 });
});

test('sagsnummer: opgavens eget, ellers projektets', async () => {
  const p = (await k.kald('GET', '/api/v1/state')).data.projects[0];
  await k.kald('PATCH', `/api/v1/items/${p.id}`, { caseNumber: 'SAG-1000' });

  const arvet = await k.kald('POST', '/api/v1/capture', { text: 'arver sagen @Nordvind' });
  const eget = await k.kald('POST', '/api/v1/capture', { text: 'egen sag @Nordvind :SAG-2000' });
  assert.equal(eget.data.item.caseNumber, 'SAG-2000');
  assert.equal(arvet.data.item.caseNumber, '');

  await k.kald('POST', '/api/v1/entries', { taskId: arvet.data.item.id, date: mandag, text: '1t' });
  await k.kald('POST', '/api/v1/entries', { taskId: eget.data.item.id, date: mandag, text: '30m' });

  const d = (await k.kald('GET', `/api/v1/report?from=${mandag}&to=${plusDage(mandag, 6)}`)).data;
  const sager = Object.fromEntries(d.report.cases.map((c) => [c.case, c.minutter]));
  // Saetter man projektets nummer, arver ALLE dets opgaver det - ogsaa dem,
  // der laa der i forvejen. Det er meningen: ét projekt er tit én sag.
  // (Min foerste forventning var 60, og det var testen der var forkert.)
  assert.ok(sager['SAG-1000'] >= 60, 'projektets opgaver skal ligge paa projektets sag');
  assert.equal(sager['SAG-2000'], 30, 'et eget nummer vinder over projektets');
  assert.ok(sager['(no case number)'] > 0, 'det uden sag skal ogsaa staa der - ellers stemmer totalen ikke');

  // Arven laeses ved OPSLAGET, ikke skrevet ind i opgaven: den arvede opgave
  // har stadig et tomt felt, men staar paa sagen i rapporten.
  const raekke = d.timesheet.rows.find((x) => x.title === 'arver sagen');
  assert.equal(raekke.case, 'SAG-1000');

  // Summen af sagerne SKAL vaere rapportens total. Ellers kan en afstemning
  // ikke bruges til noget.
  assert.equal(d.report.cases.reduce((n, c) => n + c.minutter, 0), d.report.total);
});

test('timesedlen: timer pr. dag pr. opgave, med sagsnummer', async () => {
  const d = (await k.kald('GET', `/api/v1/report?from=${mandag}&to=${plusDage(mandag, 6)}`)).data;
  const ts = d.timesheet;
  assert.equal(ts.dage.length, 7);
  assert.ok(ts.rows.length >= 3);

  const arvet = ts.rows.find((r) => r.title === 'arver sagen');
  assert.equal(arvet.case, 'SAG-1000');
  assert.equal(arvet.dage[mandag], 60);
  assert.equal(arvet.total, 60);

  // Kolonnesummerne skal kunne laegges sammen til totalen - ellers kan en
  // timeseddel ikke afstemmes med sig selv.
  const sumAfDage = ts.dage.reduce((n, iso) => n + ts.perDay[iso], 0);
  assert.equal(sumAfDage, ts.total);
  assert.equal(ts.rows.reduce((n, r) => n + r.total, 0), ts.total);
  // Og den skal stemme med rapportens egen total.
  assert.equal(ts.total, d.report.total);
});

test('timesedlen har én raekke pr. opgave - ikke pr. tidspost', async () => {
  const opgaver = (await k.kald('GET', '/api/v1/items?kind=task')).data.items;
  const en = opgaver.find((t) => t.title === 'arver sagen');
  await k.kald('POST', '/api/v1/entries', { taskId: en.id, date: plusDage(mandag, 1), text: '45m' });
  await k.kald('POST', '/api/v1/entries', { taskId: en.id, date: plusDage(mandag, 1), text: '15m' });

  const ts = (await k.kald('GET', `/api/v1/report?from=${mandag}&to=${plusDage(mandag, 6)}`)).data.timesheet;
  const raekker = ts.rows.filter((r) => r.title === 'arver sagen');
  assert.equal(raekker.length, 1, 'to poster paa samme dag bliver ÉN celle');
  assert.equal(raekker[0].dage[plusDage(mandag, 1)], 60, '45m + 15m = 1t i den ene celle');
  assert.equal(raekker[0].total, 120);
});

test('sagen pr. DAG - den opgoerelse, timerne skrives af fra', async () => {
  const opgaver = (await k.kald('GET', '/api/v1/items?kind=task')).data.items;
  const paaSagen = opgaver.filter((t) => t.caseNumber === 'SAG-2000');
  // Samme sag, to forskellige dage.
  await k.kald('POST', '/api/v1/entries', { taskId: paaSagen[0].id, date: plusDage(mandag, 2), text: '2t' });

  const ts = (await k.kald('GET', `/api/v1/report?from=${mandag}&to=${plusDage(mandag, 6)}`)).data.timesheet;
  const sag = ts.caseRows.find((c) => c.case === 'SAG-2000');
  assert.equal(sag.dage[mandag], 30, 'mandagens tal paa sagen');
  assert.equal(sag.dage[plusDage(mandag, 2)], 120, 'onsdagens tal paa sagen');
  assert.equal(sag.total, 150);

  // Summen af dagene paa en sag SKAL vaere sagens total, og summen af
  // sagerne skal vaere ugens total. Kan de to ikke afstemmes, kan
  // opgoerelsen ikke bruges til at registrere efter.
  for (const c of ts.caseRows) {
    assert.equal(Object.values(c.dage).reduce((n, m) => n + m, 0), c.total, `${c.case} stemmer ikke`);
  }
  assert.equal(ts.caseRows.reduce((n, c) => n + c.total, 0), ts.total);
  assert.equal(ts.caseRows.reduce((n, c) => n + c.total, 0), ts.rows.reduce((n, x) => n + x.total, 0),
    'pr. sag og pr. opgave skal give det samme');

  // Det UDEN sagsnummer staar nederst - men det staar der.
  const uden = ts.caseRows[ts.caseRows.length - 1];
  assert.equal(uden.case, '', 'raekken uden sagsnummer hoerer nederst');
  assert.ok(uden.total > 0);
});

test('decimaltimer: 3h 30m skrives 3,5 - og totalen regnes paa MINUTTERNE', () => {
  const b = beregn;
  assert.equal(b.formatDecimal(210), '3,5');
  assert.equal(b.formatDecimal(15), '0,25');
  assert.equal(b.formatDecimal(60), '1');
  assert.equal(b.formatDecimal(1), '0,02');
  assert.equal(b.formatDecimal(0), '0');
  assert.equal(b.formatDecimal(423), '7,05');
  // Dansk komma - det er sådan tallet skal skrives i det andet system.
  assert.ok(!b.formatDecimal(210).includes('.'));

  /*
   * Summen af AFRUNDEDE decimaler er ikke altid den afrundede sum:
   * 3 x 3h 20m viser 3,33 + 3,33 + 3,33 = 9,99, men totalen er 10.
   * Derfor regnes totalerne paa minutterne og formateres til sidst - og
   * derfor staar der i UI'et, at decimalerne er en VISNING.
   */
  const dele = [200, 200, 200];
  const visteLagtSammen = dele.reduce((n, m) => n + Number(b.formatDecimal(m).replace(',', '.')), 0);
  const rigtigTotal = Number(b.formatDecimal(dele.reduce((n, m) => n + m, 0)).replace(',', '.'));
  assert.equal(rigtigTotal, 10);
  assert.notEqual(visteLagtSammen, rigtigTotal, 'det er derfor totalen skal regnes paa minutterne');
});
