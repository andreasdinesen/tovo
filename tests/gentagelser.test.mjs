/* Gentagne opgaver (Recurring).
 *
 * Det, der kan gaa galt uden at nogen ser det:
 *  1. Datoregningen: 31/1 + 1 maaned, og en fast plan, der kaeder sig ned til
 *     den 28. for altid efter februar.
 *  2. Reglen om ÉN aaben forekomst - ellers formerer en glemt opgave sig.
 *  3. Isolationen: en anden brugers skabelon svarer 404.
 *  4. »Undo« efter en afslutning skal stille planen tilbage OG fjerne den
 *     naeste forekomst, den lige lavede.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, opretBruger } from './hjaelp.mjs';

const require = createRequire(import.meta.url);
const B = require('../app/shared/beregn.js');

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const omDage = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

test('plusInterval klemmer maanedens dag og regner uger og aar', () => {
  assert.equal(B.plusInterval('2027-01-31', 1, 'month'), '2027-02-28');
  assert.equal(B.plusInterval('2028-01-31', 1, 'month'), '2028-02-29');
  assert.equal(B.plusInterval('2027-11-15', 3, 'month'), '2028-02-15');
  assert.equal(B.plusInterval('2027-03-01', 2, 'week'), '2027-03-15');
  assert.equal(B.plusInterval('2028-02-29', 1, 'year'), '2029-02-28');
  assert.equal(B.plusInterval('2027-03-01', -7, 'day'), '2027-02-22');
});

test('fast plan regnes fra ankeret - den 31. bliver den 31.', () => {
  const r = { schedule: 'fixed', every: 1, unit: 'month', anchor: '2027-01-31', nextDue: '2027-02-28' };
  assert.equal(B.gentagNaeste(r, '2027-02-27'), '2027-03-31');
});

test('fast plan: for sent springer de forpassede over, foer tid rykker ét skridt', () => {
  const r = { schedule: 'fixed', every: 3, unit: 'month', anchor: '2027-01-15', nextDue: '2027-01-15' };
  assert.equal(B.gentagNaeste(r, '2027-01-10'), '2027-04-15', 'foer tid');
  assert.equal(B.gentagNaeste(r, '2027-05-01'), '2027-07-15', 'en hel periode for sent');
});

test('efter udfoert: udfoert + interval', () => {
  const r = { schedule: 'completion', every: 3, unit: 'month', nextDue: '2027-01-15' };
  assert.equal(B.gentagNaeste(r, '2027-02-10'), '2027-05-10');
});

test('oprettelsesdag og tilstand', () => {
  const r = { nextDue: '2027-03-10', leadDays: 7 };
  assert.equal(B.gentagOprettes(r), '2027-03-03');
  assert.equal(B.gentagTilstand(r, '2027-03-02', false), 'waiting');
  assert.equal(B.gentagTilstand(r, '2027-03-03', false), 'due');
  assert.equal(B.gentagTilstand(r, '2027-03-03', true), 'open');
  assert.equal(B.gentagTilstand({ ...r, paused: true }, '2027-03-03', false), 'paused');
  assert.equal(B.gentagBeskriv({ every: 3, unit: 'month' }), 'Every 3 months · fixed schedule');
});

let srv;
let a;
let b;

before(async () => {
  srv = await startServer();
  a = (await opretBruger(srv, 'andreas')).klient;           // foerste = admin
  await a.kald('POST', '/api/v1/settings', { allow_registration: true });
  b = (await opretBruger(srv, 'bente')).klient;
});
after(() => srv.stop());

test('en skabelon langt ude opretter ingen opgave - én inden for varslingen goer', async () => {
  const fjern = await a.kald('POST', '/api/v1/recurring',
    { title: 'Aarlig gennemgang', every: 1, unit: 'year', nextDue: omDage(60), leadDays: 7 });
  assert.equal(fjern.status, 200, JSON.stringify(fjern.data));
  assert.equal(fjern.data.created, null);
  assert.equal(fjern.data.recurring.state, 'waiting');

  const naer = await a.kald('POST', '/api/v1/recurring',
    { title: 'Skift kodeord', every: 3, unit: 'month', nextDue: omDage(5), leadDays: 7, estimateMinutes: '30m' });
  assert.equal(naer.status, 200);
  assert.ok(naer.data.created, 'opgaven skal oprettes med det samme');
  assert.equal(naer.data.created.dueDate, omDage(5));
  assert.equal(naer.data.created.recurringId, naer.data.recurring.id);
  assert.equal(naer.data.created.estimateMinutes, 30);
  assert.equal(naer.data.recurring.state, 'open');

  // Én aaben forekomst: listen koerer motoren igen og laver ikke en til.
  await a.kald('GET', '/api/v1/recurring');
  const opgaver = (await a.kald('GET', '/api/v1/items?kind=task')).data.items
    .filter((t) => t.recurringId === naer.data.recurring.id);
  assert.equal(opgaver.length, 1);

  const nu = await a.kald('POST', `/api/v1/recurring/${naer.data.recurring.id}/now`);
  assert.equal(nu.status, 409, 'Create now med en aaben forekomst');
});

test('afslutning ruller planen, og Undo stiller den tilbage', async () => {
  const r = await a.kald('POST', '/api/v1/recurring',
    { title: 'Timeregistrering', every: 1, unit: 'week', nextDue: omDage(2), leadDays: 30, schedule: 'fixed' });
  const id = r.data.recurring.id;
  const foerste = r.data.created;
  assert.ok(foerste);

  const luk = await a.kald('POST', `/api/v1/tasks/${foerste.id}/complete`, { done: true });
  assert.equal(luk.status, 200);
  // leadDays 30 > en uge: den naeste kommer straks.
  assert.ok(luk.data.recurring, 'den naeste forekomst');
  assert.equal(luk.data.recurring.dueDate, omDage(9));

  let liste = (await a.kald('GET', '/api/v1/recurring')).data.recurring;
  let s = liste.find((x) => x.id === id);
  assert.equal(s.nextDue, omDage(9));
  assert.equal(s.lastDone, omDage(0));

  await a.kald('POST', `/api/v1/tasks/${foerste.id}/complete`, { done: false });
  liste = (await a.kald('GET', '/api/v1/recurring')).data.recurring;
  s = liste.find((x) => x.id === id);
  assert.equal(s.nextDue, omDage(2), 'planen er tilbage');
  assert.equal(s.taskId, foerste.id);
  const naeste = await a.kald('GET', `/api/v1/items/${luk.data.recurring.id}`);
  assert.equal(naeste.status, 404, 'den naeste forekomst er fjernet igen');
});

test('en slettet forekomst er sprunget over - planen rulles uden lastDone', async () => {
  const r = await a.kald('POST', '/api/v1/recurring',
    { title: 'Spring over', every: 1, unit: 'month', nextDue: omDage(1), leadDays: 3 });
  await a.kald('DELETE', `/api/v1/items/${r.data.created.id}`);
  const s = (await a.kald('GET', '/api/v1/recurring')).data.recurring.find((x) => x.id === r.data.recurring.id);
  assert.equal(s.lastDone, null);
  assert.ok(s.nextDue > omDage(1));
  assert.equal(s.task, null);
});

test('pause: ingen opgave, og Create now siger hvorfor', async () => {
  const r = await a.kald('POST', '/api/v1/recurring',
    { title: 'Pauset', every: 1, unit: 'month', nextDue: omDage(40), leadDays: 0, paused: true });
  assert.equal(r.data.created, null);
  const nu = await a.kald('POST', `/api/v1/recurring/${r.data.recurring.id}/now`);
  assert.equal(nu.status, 409);
  const igen = await a.kald('PATCH', `/api/v1/recurring/${r.data.recurring.id}`, { paused: false });
  assert.equal(igen.data.recurring.state, 'waiting');
  const nu2 = await a.kald('POST', `/api/v1/recurring/${r.data.recurring.id}/now`);
  assert.equal(nu2.status, 200);
  assert.equal(nu2.data.created.dueDate, omDage(40));
});

test('validering: titel og dato skal med', async () => {
  assert.equal((await a.kald('POST', '/api/v1/recurring', { nextDue: omDage(3) })).status, 400);
  assert.equal((await a.kald('POST', '/api/v1/recurring', { title: 'x' })).status, 400);
  assert.equal((await a.kald('POST', '/api/v1/recurring', { title: 'x', nextDue: omDage(3), unit: 'fortnight' })).status, 400);
});

test('isolation: en anden brugers skabelon findes ikke', async () => {
  const r = await a.kald('POST', '/api/v1/recurring',
    { title: 'Hemmelig', every: 1, unit: 'month', nextDue: omDage(50) });
  const id = r.data.recurring.id;
  assert.equal((await b.kald('PATCH', `/api/v1/recurring/${id}`, { title: 'stjaalet' })).status, 404);
  assert.equal((await b.kald('POST', `/api/v1/recurring/${id}/now`)).status, 404);
  assert.equal((await b.kald('DELETE', `/api/v1/items/${id}`)).status, 404);
  const bs = (await b.kald('GET', '/api/v1/recurring')).data.recurring;
  assert.equal(bs.length, 0);
  // Og et fremmed projekt kan ikke saettes paa.
  const p = (await a.kald('POST', '/api/v1/items', { kind: 'project', name: 'Nordvind' })).data.item;
  const fremmed = await b.kald('POST', '/api/v1/recurring',
    { title: 'x', nextDue: omDage(3), projectId: p.id });
  assert.equal(fremmed.status, 404);
});
