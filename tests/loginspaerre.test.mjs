/* Login-spaerringen mod ENDEPUNKTET - med en forfalsket X-Forwarded-For.
 *
 * Indtil 2026-09-16 tog `clientIp` den FOERSTE vaerdi i headeren. Den vaelger
 * klienten selv, og spaerringens spand er `login:<ip>:<bruger>` - saa en ny
 * opdigtet adresse forrest ved hvert forsoeg gav en ny spand hver gang, og
 * kodeord kunne proeves uden loft.
 *
 * Testen koerer mod den rigtige server. Forbindelsen kommer fra 127.0.0.1,
 * altsaa »bag en proxy«, og headeren laeses bagfra (app/klientip.js). En
 * enhedstest af modulet kan ikke se, om serveren faktisk bruger det.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, opretBruger } from './hjaelp.mjs';

let srv;
before(async () => {
  srv = await startServer();
  await opretBruger(srv, 'spaerret', 'rigtigtkodeord1');
});
after(() => srv.stop());

async function loginMed(xff, password = 'forkert-kodeord') {
  const res = await fetch(`${srv.base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff },
    body: JSON.stringify({ username: 'spaerret', password }),
  });
  return res.status;
}

test('en ny forfalsket adresse forrest ved hvert forsoeg gaar IKKE uden om spaerringen', async () => {
  const svar = [];
  for (let i = 1; i <= 20; i += 1) {
    // »198.51.100.i« er klientens eget paafund; »203.0.113.50« er det, proxyen saa.
    svar.push(await loginMed(`198.51.100.${i}, 203.0.113.50`));
  }
  assert.deepEqual(svar.slice(0, 15), Array(15).fill(401), 'de foerste 15 er almindelige fejl');
  assert.deepEqual(svar.slice(15), Array(5).fill(429), `spaerringen skal ramme: ${svar.join(',')}`);

  // Heller ikke det rigtige kodeord slipper igennem, naar spanden er fuld.
  assert.equal(await loginMed('198.51.100.99, 203.0.113.50', 'rigtigtkodeord1'), 429);
});

test('spanden er pr. klient - en anden adresse bag samme proxy er ikke spaerret', async () => {
  // Uden den her kunne en regel, der gav ALLE samme noegle, bestaa proeven ovenfor.
  assert.equal(await loginMed('198.51.100.1, 203.0.113.51'), 401);
  assert.equal(await loginMed('203.0.113.52', 'rigtigtkodeord1'), 200);
});
