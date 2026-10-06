/* Timer fra andre paa et projekts budget.
 *
 * Andre konsulenter leverer timer paa det samme budget. De skal taelle med i
 * projektets Spent og Left - og ALDRIG i din egen uge, dag eller timeseddel.
 * Den anden halvdel er den, der let gaar tabt: laegger nogen dem ind som
 * tidsposter "fordi det var nemmest", ser du ud til at have arbejdet 60 timer.
 *
 * Testdataene ligger med vilje skaevt (7t30m, 22m), saa en afrunding til hele
 * timer eller kvarter ville kunne ses.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, opretBruger } from './hjaelp.mjs';

const require = createRequire(import.meta.url);
const beregn = require('../app/shared/beregn.js');

let srv;
let a;
let b;
let projektId;
let iDag;

before(async () => {
  srv = await startServer();
  a = (await opretBruger(srv, 'andreas')).klient;     // foerste = admin
  await a.kald('POST', '/api/v1/settings', { allow_registration: true });
  b = (await opretBruger(srv, 'bo')).klient;
  const t = await a.kald('POST', '/api/v1/capture', { text: 'opsaetning @Nordvind' });
  const state = (await a.kald('GET', '/api/v1/state')).data;
  projektId = state.projects[0].id;
  iDag = state.today;
  await a.kald('PATCH', `/api/v1/items/${projektId}`, { budgetHours: 40 });
  // Dine egne 2 timer.
  await a.kald('POST', '/api/v1/entries', { taskId: t.data.item.id, date: iDag, text: '2t' });
});
after(() => srv.stop());

test('andres timer taeller i projektets Spent og Left', async () => {
  const r1 = await a.kald('POST', `/api/v1/projects/${projektId}/other-hours`,
    { date: iDag, time: '7t30m', who: 'Kollega K', note: 'uge 40' });
  assert.equal(r1.status, 201);
  assert.equal(r1.data.line.minutes, 450);
  assert.equal(r1.data.line.who, 'Kollega K');
  const r2 = await a.kald('POST', `/api/v1/projects/${projektId}/other-hours`, { time: '22m' });
  assert.equal(r2.status, 201);
  assert.equal(r2.data.line.date, iDag, 'uden dato er det i dag');

  const d = (await a.kald('GET', `/api/v1/projects/${projektId}`)).data;
  assert.equal(d.rollup.egne, 120);
  assert.equal(d.rollup.andre, 472);
  assert.equal(d.rollup.forbrugt, 592, 'Spent er dine OG andres');
  assert.equal(d.rollup.resterende, 40 * 60 - 592);
  assert.equal(d.rollup.procent, Math.round((592 / 2400) * 100));
  assert.equal(beregn.minutterFraAndre(d.project), 472, 'projektlisten bruger den samme funktion');
});

test('... men ALDRIG i din egen uge eller dag', async () => {
  const d = (await a.kald('GET', `/api/v1/report?from=${iDag}&to=${iDag}`)).data;
  assert.equal(d.report.total, 120, 'kun dine egne 2 timer');
  const s = (await a.kald('GET', '/api/v1/state')).data;
  assert.equal(s.todayMinutes, 120);
});

test('en linje kan slettes - og en forkert varighed afvises', async () => {
  const fejl = await a.kald('POST', `/api/v1/projects/${projektId}/other-hours`, { time: 'en del' });
  assert.equal(fejl.status, 400);
  const nul = await a.kald('POST', `/api/v1/projects/${projektId}/other-hours`, { time: '0' });
  assert.equal(nul.status, 400, 'nul timer er ikke en leverance');

  const p = (await a.kald('GET', `/api/v1/projects/${projektId}`)).data.project;
  const kort = p.otherHours.find((x) => x.minutes === 22);
  const slet = await a.kald('DELETE', `/api/v1/projects/${projektId}/other-hours/${kort.id}`);
  assert.equal(slet.status, 200);
  assert.equal(slet.data.project.otherHours.length, 1);
  const igen = await a.kald('DELETE', `/api/v1/projects/${projektId}/other-hours/${kort.id}`);
  assert.equal(igen.status, 404);
});

test('at rette projektet (navn, budget) roerer ikke listen', async () => {
  await a.kald('PATCH', `/api/v1/items/${projektId}`, { name: 'Nordvind 2', budgetHours: 50.5 });
  const p = (await a.kald('GET', `/api/v1/projects/${projektId}`)).data.project;
  assert.equal(p.otherHours.length, 1);
  assert.equal(p.otherHours[0].minutes, 450);
});

test('en anden bruger faar 404 - baade ved at laegge til og ved at slette', async () => {
  const p = (await a.kald('GET', `/api/v1/projects/${projektId}`)).data.project;
  const til = await b.kald('POST', `/api/v1/projects/${projektId}/other-hours`, { time: '1t' });
  assert.equal(til.status, 404);
  const af = await b.kald('DELETE', `/api/v1/projects/${projektId}/other-hours/${p.otherHours[0].id}`);
  assert.equal(af.status, 404);
  const efter = (await a.kald('GET', `/api/v1/projects/${projektId}`)).data.project;
  assert.equal(efter.otherHours.length, 1, 'A-s liste er uroert');
});

test('hvidlisten renser linjerne, ogsaa naar de kommer som et helt felt', async () => {
  const r = await a.kald('POST', '/api/v1/items', {
    kind: 'project', name: 'Renset',
    otherHours: [
      { minutes: 90, who: 'X', date: 'ikke en dato', hemmelig: 'faar ikke lov' },
      { minutes: 0, who: 'nul' },
      'en streng',
    ],
  });
  assert.equal(r.data.item.otherHours.length, 1);
  const x = r.data.item.otherHours[0];
  assert.equal(x.minutes, 90);
  assert.equal(x.date, null);
  assert.ok(x.id, 'en linje uden id faar et');
  assert.equal(x.hemmelig, undefined);
});

test('rollup uden andres timer er som foer', () => {
  const m = beregn.opret({
    items: (kind) => (kind === 'project' ? [{ id: 'p', budgetHours: 1 }] : []),
    entries: () => [],
    settings: () => ({}),
  });
  const r = m.rollupProjekt('p', 0);
  assert.equal(r.andre, 0);
  assert.equal(r.forbrugt, 0);
  assert.equal(r.resterende, 60);
});
