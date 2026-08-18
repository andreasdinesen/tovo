/* Fase 2: timeren, den manuelle registrering og summerne.
 *
 * Den vigtigste test herunder er den sidste: frontendens tal mod serverens
 * paa de SAMME data. Beanledger v28 er hele grunden til, at beregn.js findes -
 * to udregninger er to sandheder, og forskellen opdages foerst i en rapport,
 * en kunde kigger paa.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { startServer, opretBruger } from './hjaelp.mjs';

const require = createRequire(import.meta.url);
// PRAECIS det modul, browseren faar serveret i app.js.
const beregn = require('../app/shared/beregn.js');

let srv;
let k;
let opgaveA;
let opgaveB;
let projekt;

before(async () => {
  srv = await startServer();
  k = (await opretBruger(srv, 'andreas')).klient;
  const a = await k.kald('POST', '/api/v1/capture', { text: 'opsaetning @Nordvind ~4t' });
  opgaveA = a.data.item;
  const b = await k.kald('POST', '/api/v1/capture', { text: 'migrering @Nordvind ~2t' });
  opgaveB = b.data.item;
  projekt = (await k.kald('GET', '/api/v1/state')).data.projects[0];
  await k.kald('PATCH', `/api/v1/items/${projekt.id}`, { budgetHours: 10 });
});
after(() => srv.stop());

test('start stopper den koerende og starter en ny', async () => {
  const en = await k.kald('POST', '/api/v1/timer/start', { taskId: opgaveA.id });
  assert.equal(en.status, 200);
  assert.equal(en.data.timer.taskTitle, 'opsaetning');
  assert.equal(en.data.stopped, null);

  const to = await k.kald('POST', '/api/v1/timer/start', { taskId: opgaveB.id });
  assert.equal(to.data.timer.taskTitle, 'migrering');
  assert.ok(to.data.stopped, 'den foerste skal vaere stoppet automatisk');
  assert.ok(to.data.stopped.stoppedAt > 0);
});

test('databasen - ikke applikationslogikken - haandhaever ÉN koerende timer', () => {
  // Det unikke indeks er reglen. Applikationslogikken er bekvemmeligheden,
  // og den holder ikke, naar to faner trykker start i samme sekund.
  const db = new DatabaseSync(path.join(srv.dataDir, 'tovo.db'));
  const bruger = db.prepare('SELECT id FROM users LIMIT 1').get().id;
  assert.throws(() => {
    db.prepare(`INSERT INTO time_entries (id, user_id, task_id, started_at, stopped_at, note, source)
                VALUES ('snyd', ?, ?, 1, NULL, '', 'timer')`).run(bruger, opgaveA.id);
  }, /UNIQUE|constraint/i);
  db.close();
});

test('en koerende timer overlever, at serveren lukkes', async () => {
  // "Start en timer, luk browseren, aabn igen - den koerer stadig."
  // Timeren gemmer STARTTIDSPUNKTET, ikke en taeller (doda F8).
  const foer = await k.kald('GET', '/api/v1/timer/current');
  assert.ok(foer.data.timer, 'der skal koere en timer foer genstarten');

  const dataDir = srv.dataDir;
  const cookie = k.cookie;
  srv.stop(true);
  srv = await startServer({}, dataDir);
  k = srv.klient();

  const res = await fetch(`${srv.base}/api/v1/timer/current`, { headers: { Cookie: cookie } });
  const d = await res.json();
  assert.equal(res.status, 200);
  assert.ok(d.timer, 'timeren koerer stadig efter en genstart');
  assert.equal(d.timer.taskTitle, 'migrering');

  // Genskab klienten med den gamle session, saa resten af testene kan koere.
  k.kald = ((oprindelig) => (m, sti, krop, opts = {}) =>
    oprindelig(m, sti, krop, { ...opts, headerCookie: cookie }))(k.kald);
  const svar = await fetch(`${srv.base}/api/v1/timer/stop`,
    { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(svar.status, 200);
  globalThis.__cookie = cookie;
});

const iDagIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Klient bundet til den session, der overlevede genstarten. */
function kald(metode, sti, krop) {
  const h = { Cookie: globalThis.__cookie };
  if (krop !== undefined) h['Content-Type'] = 'application/json';
  return fetch(srv.base + sti, {
    method: metode, headers: h, body: krop === undefined ? undefined : JSON.stringify(krop),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
}

test('manuel registrering paa en vilkaarlig dato', async () => {
  const iForgaars = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const r = await kald('POST', '/api/v1/entries',
    { taskId: opgaveA.id, date: iForgaars, text: '1,5t' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.entry.source, 'manuel');
  assert.equal((r.data.entry.stoppedAt - r.data.entry.startedAt) / 60, 90);

  // Et interval skal lande PRAECIS der, hvor der staar.
  const i = await kald('POST', '/api/v1/entries',
    { taskId: opgaveB.id, date: iForgaars, text: '9-11.30' });
  const start = new Date(i.data.entry.startedAt * 1000);
  assert.equal(start.getHours(), 9);
  assert.equal(start.getMinutes(), 0);
  assert.equal((i.data.entry.stoppedAt - i.data.entry.startedAt) / 60, 150);

  const vroevl = await kald('POST', '/api/v1/entries',
    { taskId: opgaveA.id, date: iForgaars, text: '11-9' });
  assert.equal(vroevl.status, 400);
  assert.match(vroevl.data.message, /9-11\.30/, 'fejlen skal vise, hvad der VIRKER');
});

test('enhver post kan rettes og slettes - ogsaa timerens', async () => {
  const alle = (await kald('GET', '/api/v1/entries')).data.entries;
  const fraTimeren = alle.find((e) => e.source === 'timer');
  assert.ok(fraTimeren, 'timeren har lavet mindst én post');

  const rettet = await kald('PATCH', `/api/v1/entries/${fraTimeren.id}`,
    { stoppedAt: fraTimeren.startedAt + 3600, note: 'rettet i haanden' });
  assert.equal((rettet.data.entry.stoppedAt - rettet.data.entry.startedAt) / 60, 60);
  assert.equal(rettet.data.entry.source, 'timer', 'kilden bevares, saa rapporten kan sige hvor tallet kom fra');

  const slettet = await kald('DELETE', `/api/v1/entries/${fraTimeren.id}`);
  assert.equal(slettet.status, 200);
  assert.equal(slettet.data.deleted.id, fraTimeren.id, 'posten sendes med tilbage, saa fortryd kan gendanne den');

  // Fortryd: den samme post ind igen - med sit eget id OG sin egen kilde.
  // Kommer den tilbage som "manuel", lyver rapportens kilde-maerkning efter
  // en fortrudt sletning.
  const p = slettet.data.deleted;
  const gendannet = await kald('POST', '/api/v1/entries', {
    id: p.id, taskId: p.taskId, startedAt: p.startedAt, stoppedAt: p.stoppedAt, source: p.source,
  });
  assert.equal(gendannet.status, 200);
  assert.equal(gendannet.data.entry.id, p.id, 'samme post, ikke en ny');
  assert.equal(gendannet.data.entry.source, 'timer', 'kilden skal overleve en fortrydelse');
  assert.equal(gendannet.data.entry.startedAt, p.startedAt);
  assert.equal(gendannet.data.entry.stoppedAt, p.stoppedAt);
});

test('afrunding aendrer VISNINGEN, aldrig den gemte post', async () => {
  const foer = (await kald('GET', '/api/v1/entries')).data;
  const raaMinutter = foer.entries.map((e) => Math.round(((e.stoppedAt || 0) - e.startedAt) / 60));

  await kald('POST', '/api/v1/settings', { rounding: 15 });
  const efter = (await kald('GET', '/api/v1/entries')).data;
  assert.equal(efter.rounding, 15);
  assert.deepEqual(
    efter.entries.map((e) => Math.round(((e.stoppedAt || 0) - e.startedAt) / 60)),
    raaMinutter,
    'de gemte tidspunkter er uroerte - afrunding er en visningsregel',
  );

  const p = await kald('GET', `/api/v1/projects/${projekt.id}`);
  for (const m of Object.values(p.data.spent)) {
    assert.equal(m % 15, 0, 'summerne er afrundet ved visningen');
  }
  await kald('POST', '/api/v1/settings', { rounding: 0 });
});

test('advarsel naar timeren har koert for laenge', async () => {
  await kald('POST', '/api/v1/timer/start', { taskId: opgaveA.id });
  const normal = (await kald('GET', '/api/v1/timer/current')).data.timer;
  assert.equal(normal.tooLong, false);

  // Uret flyttes i databasen ved siden af - WAL taaler to processer. Nogle
  // ting kan ikke provokeres gennem API'et (doda F4).
  const db = new DatabaseSync(path.join(srv.dataDir, 'tovo.db'));
  db.prepare('UPDATE time_entries SET started_at = ? WHERE stopped_at IS NULL')
    .run(Math.floor(Date.now() / 1000) - 9 * 3600);
  db.close();

  const advaret = (await kald('GET', '/api/v1/timer/current')).data.timer;
  assert.equal(advaret.tooLong, true);
  assert.ok(advaret.minutes >= 8 * 60);
  await kald('POST', '/api/v1/timer/stop', {});
});

test('FRONTENDENS tal er serverens tal - samme modul, samme data', async () => {
  // Testen henter de RAA data gennem API'et og regner med det samme modul,
  // browseren faar serveret. Er de to uenige, findes der to sandheder.
  //
  // SKAEVE tider er ikke pynt. Foerste udgave af testen brugte kun 60, 90 og
  // 150 minutter - alle sammen hele kvarter - og bestod derfor OGSAA, da
  // serverens afrunding blev saboteret med vilje. En test, hvis data ligger
  // paa griddet, kan ikke se en afrundingsfejl.
  await kald('POST', '/api/v1/entries', { taskId: opgaveA.id, date: iDagIso(), text: '22m' });
  await kald('POST', '/api/v1/entries', { taskId: opgaveB.id, date: iDagIso(), text: '7m' });

  const state = (await kald('GET', '/api/v1/state')).data;
  const opgaver = (await kald('GET', '/api/v1/items?kind=task')).data.items;
  const projekter = (await kald('GET', '/api/v1/items?kind=project')).data.items;
  const poster = (await kald('GET', '/api/v1/entries')).data.entries;

  for (const afrunding of [0, 5, 15]) {
    await kald('POST', '/api/v1/settings', { rounding: afrunding });
    const b = beregn.opret({
      items: (kind) => ({ task: opgaver, project: projekter }[kind] || []),
      entries: () => poster,
      settings: () => ({ rounding: afrunding }),
    });
    const server = (await kald('GET', `/api/v1/projects/${projekt.id}`)).data;

    assert.equal(b.rollupProjekt(projekt.id).forbrugt, server.rollup.forbrugt,
      `forbrugt er ikke det samme tal ved afrunding ${afrunding}`);
    assert.equal(b.rollupProjekt(projekt.id).estimat, server.rollup.estimat);
    assert.equal(b.rollupProjekt(projekt.id).ramme, server.rollup.ramme);
    assert.equal(b.rollupProjekt(projekt.id).procent, server.rollup.procent);
    for (const t of opgaver) {
      assert.equal(b.forbrugPaaOpgave(t.id), server.spent[t.id],
        `forbrug paa "${t.title}" er ikke det samme tal ved afrunding ${afrunding}`);
    }
  }
  await kald('POST', '/api/v1/settings', { rounding: 0 });
  assert.ok(state.todayMinutes >= 0);
});

test('rollup svarer paa de tre niveauer - og siger til, naar estimaterne sprænger rammen', async () => {
  const lille = await kald('POST', '/api/v1/items', { kind: 'project', name: 'Lille ramme', budgetHours: 1 });
  await kald('POST', '/api/v1/capture', { text: 'stor opgave ~5t' });
  const opgaver = (await kald('GET', '/api/v1/items?kind=task')).data.items;
  const stor = opgaver.find((t) => t.title === 'stor opgave');
  await kald('PATCH', `/api/v1/items/${stor.id}`, { projectId: lille.data.item.id });

  const r = (await kald('GET', `/api/v1/projects/${lille.data.item.id}`)).data.rollup;
  assert.equal(r.estimat, 300);
  assert.equal(r.ramme, 60);
  assert.equal(r.estimatOverRamme, true, 'den tidlige advarsel: mere arbejde end der er solgt');
  assert.equal(r.forbrugt, 0);
  assert.equal(r.resterende, 60);

  // Uden en ramme er der intet at vaere over - og saa skal der staa null,
  // ikke et tal, der ligner en sandhed.
  const uden = await kald('POST', '/api/v1/items', { kind: 'project', name: 'Uden ramme' });
  const u = (await kald('GET', `/api/v1/projects/${uden.data.item.id}`)).data.rollup;
  assert.equal(u.ramme, 0);
  assert.equal(u.procent, null);
  assert.equal(u.resterende, null);
});
