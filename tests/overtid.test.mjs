/* Overtid (v39): et flag paa tidsposten.
 *
 * Overtiden taeller MED i totalen - den er arbejdstid - men skal kunne ses for
 * sig, fordi den registreres paa en saerlig maade i det andet system.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, opretBruger } from './hjaelp.mjs';

let srv;
let k;
let opgave;
const dag = '2026-03-02'; // en mandag

before(async () => {
  srv = await startServer();
  k = (await opretBruger(srv, 'andreas')).klient;
  const r = await k.kald('POST', '/api/v1/capture', { text: 'nattevagt @Nordvind' });
  opgave = r.data.item.id;
  await k.kald('PATCH', `/api/v1/items/${opgave}`, { caseNumber: 'SAG-3000' });
});
after(() => srv.stop());

test('en post er ikke overtid, medmindre man siger det', async () => {
  const r = await k.kald('POST', '/api/v1/entries', { taskId: opgave, date: dag, text: '9-12' });
  assert.equal(r.data.entry.overtime, false);
});

test('overtid gemmes, og taeller baade i totalen og for sig', async () => {
  const r = await k.kald('POST', '/api/v1/entries', {
    taskId: opgave, date: dag, text: '18-20', overtime: true,
  });
  assert.equal(r.data.entry.overtime, true);

  const d = (await k.kald('GET', `/api/v1/report?from=${dag}&to=${dag}`)).data;
  assert.equal(d.report.total, 300, '3t almindelig + 2t overtid');
  assert.equal(d.report.overtime, 120);
  assert.equal(d.timesheet.total, 300, 'hovedsedlen beholder overtiden');
  assert.equal(d.timesheet.overtime.total, 120);
  assert.equal(d.timesheet.overtime.caseRows[0].case, 'SAG-3000');
  assert.equal(d.timesheet.overtime.caseRows[0].dage[dag], 120);
  assert.equal(d.timesheet.overtime.rows.length, 1);
});

test('flaget kan saettes og fjernes paa en eksisterende post - uden at roere tiden', async () => {
  const poster = (await k.kald('GET', `/api/v1/entries?from=${dag}&to=${dag}`)).data.entries;
  const morgen = poster.find((e) => !e.overtime);
  const p1 = (await k.kald('PATCH', `/api/v1/entries/${morgen.id}`, { overtime: true })).data.entry;
  assert.equal(p1.overtime, true);
  assert.equal(p1.startedAt, morgen.startedAt);
  assert.equal(p1.stoppedAt, morgen.stoppedAt);
  // En PATCH uden flaget beholder det.
  const p2 = (await k.kald('PATCH', `/api/v1/entries/${morgen.id}`, { note: 'x' })).data.entry;
  assert.equal(p2.overtime, true);
  const p3 = (await k.kald('PATCH', `/api/v1/entries/${morgen.id}`, { overtime: false })).data.entry;
  assert.equal(p3.overtime, false);
});

test('fortrydelsen af en sletning gendanner overtiden', async () => {
  const poster = (await k.kald('GET', `/api/v1/entries?from=${dag}&to=${dag}`)).data.entries;
  const ot = poster.find((e) => e.overtime);
  const slettet = (await k.kald('DELETE', `/api/v1/entries/${ot.id}`)).data.deleted;
  assert.equal(slettet.overtime, true);
  const igen = (await k.kald('POST', '/api/v1/entries', slettet)).data.entry;
  assert.deepEqual(igen, slettet);
});

test('et koerende ur kan markeres som overtid', async () => {
  const start = (await k.kald('POST', '/api/v1/timer/start', { taskId: opgave })).data.timer.entry;
  const p = (await k.kald('PATCH', `/api/v1/entries/${start.id}`, { overtime: true })).data.entry;
  assert.equal(p.overtime, true);
  assert.equal(p.stoppedAt, null, 'uret koerer stadig');
  await k.kald('POST', '/api/v1/timer/stop', {});
});
