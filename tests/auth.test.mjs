/* Fase 0: login, registrering og adgangsstyring. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './hjaelp.mjs';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test('foerste bruger bliver admin, og setup lukker bagefter', async () => {
  const foer = await srv.klient().kald('GET', '/api/public-config');
  assert.equal(foer.data.needsSetup, true);
  assert.equal(foer.data.allowRegistration, true, 'foerste registrering skal altid vaere aaben');

  const a = srv.klient();
  const r = await a.kald('POST', '/api/register', { username: 'Andreas', password: 'hemmeligt123' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.isAdmin, true);
  assert.equal(r.data.user.username, 'andreas', 'brugernavne gemmes i lowercase');

  const efter = await srv.klient().kald('GET', '/api/public-config');
  assert.equal(efter.data.needsSetup, false);
  // Uden allow_registration er serveren lukket - og linket skjules i UI'et.
  assert.equal(efter.data.allowRegistration, false);
});

test('registrering er lukket, indtil admin aabner den', async () => {
  const b = srv.klient();
  const afvist = await b.kald('POST', '/api/register', { username: 'bo', password: 'hemmeligt123' });
  assert.equal(afvist.status, 403);
  assert.equal(afvist.data.error, 'registration_closed');

  // Kun admin maa aabne.
  const a = srv.klient();
  await a.kald('POST', '/api/login', { username: 'andreas', password: 'hemmeligt123' });
  const aabn = await a.kald('POST', '/api/v1/settings', { allow_registration: true });
  assert.equal(aabn.status, 200);
  assert.equal(aabn.data.global.allowRegistration, true);

  const ok = await b.kald('POST', '/api/register', { username: 'bo', password: 'hemmeligt123' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.isAdmin, false, 'kun den foerste bruger er admin');
});

test('en almindelig bruger kan ikke aendre serverens indstillinger', async () => {
  const b = srv.klient();
  await b.kald('POST', '/api/login', { username: 'bo', password: 'hemmeligt123' });
  const r = await b.kald('POST', '/api/v1/settings', { allow_registration: false });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'admin_only');

  // Egne indstillinger maa han gerne saette.
  const egen = await b.kald('POST', '/api/v1/settings', { rounding: '15' });
  assert.equal(egen.status, 200);
  assert.equal(egen.data.settings.rounding, '15');
});

test('dubletter afvises uanset store bogstaver', async () => {
  const a = srv.klient();
  await a.kald('POST', '/api/login', { username: 'andreas', password: 'hemmeligt123' });
  await a.kald('POST', '/api/v1/settings', { allow_registration: true });
  const r = await srv.klient().kald('POST', '/api/register', { username: 'BO', password: 'hemmeligt123' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'username_taken');
});

test('forkert kodeord giver 401 med en laesbar besked', async () => {
  const r = await srv.klient().kald('POST', '/api/login', { username: 'bo', password: 'forkert12345' });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'bad_credentials');
  assert.match(r.data.message, /^[A-Z].* /, 'beskeden skal vaere en saetning, ikke koden om igen');
});

test('alle fejlsvar har en KODE og en BESKED', async () => {
  // Formreglen gaelder alle ruter - ogsaa dem, nogen tilfoejer om et halvt aar.
  // En test pr. rute laaser kun det, der allerede er skrevet ned (doda).
  const proever = [
    ['GET', '/api/v1/items?kind=ukendt', undefined, {}],
    ['GET', '/api/v1/items/0123456789abcdef', undefined, {}],
    ['POST', '/api/v1/items', { kind: 'ukendt' }, {}],
    ['GET', '/api/findes-ikke', undefined, {}],
  ];
  const k = srv.klient();
  await k.kald('POST', '/api/login', { username: 'bo', password: 'hemmeligt123' });
  for (const [m, sti, krop] of proever) {
    const r = await k.kald(m, sti, krop);
    assert.ok(r.status >= 400, `${m} ${sti} skulle fejle`);
    assert.match(r.data.error, /^[a-z][a-z0-9_]*$/,
      `${m} ${sti}: "${r.data.error}" er ikke en kode, en klient kan forgrene paa`);
    assert.ok(r.data.message && r.data.message.length > 5, `${m} ${sti} mangler en laesbar besked`);
  }
});

test('kodeordsskift kraever en session - en noegle er ikke nok', async () => {
  const r = await srv.klient().kald('POST', '/api/password', { current: 'x', next: 'hemmeligt123' });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'session_required');
});

test('POST uden application/json afvises (CSRF-barrieren)', async () => {
  const res = await fetch(`${srv.base}/api/login`, { method: 'POST', body: 'username=x' });
  assert.equal(res.status, 415);
});
