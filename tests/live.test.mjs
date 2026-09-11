/* Live-stroemmen: serveren siger til, naar noget aendrer sig.
 *
 * Den vigtigste proeve her er ISOLATIONEN. tovo er flerbruger, og en stroem,
 * der vinkede til alle, ville fortaelle den ene bruger, hvornaar den anden
 * arbejder - hvornaar de moeder, og hvornaar de holder op. Det er ikke
 * opgavedata, men det er stadig noget, man ikke skal kunne se.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, opretBruger } from './hjaelp.mjs';

let srv;
let a;
let b;

before(async () => {
  srv = await startServer();
  a = await opretBruger(srv, 'andreas');
  // Registrering lukker efter foerste bruger - aabn den igen.
  await a.klient.kald('POST', '/api/v1/settings', { allow_registration: true });
  b = await opretBruger(srv, 'bodil');
});
after(() => srv.stop());

/**
 * Aabner en SSE-stroem og samler beskederne.
 *
 * `fetch` ville ogsaa kunne, men raa http giver adgang til svarhovederne
 * FOER kroppen kommer - og det er dem, en proxy laeser.
 */
function lyt(klient) {
  return new Promise((ok, nej) => {
    const req = http.get(`${srv.base}/api/v1/stream`, {
      headers: { Cookie: klient.cookie, Accept: 'text/event-stream' },
    }, (res) => {
      const beskeder = [];
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (d) => {
        buffer += d;
        for (const blok of buffer.split('\n\n')) {
          const m = /^event: (\S+)/m.exec(blok);
          if (m) beskeder.push(m[1]);
        }
      });
      ok({
        status: res.statusCode,
        headers: res.headers,
        beskeder,
        get raa() { return buffer; },
        luk: () => req.destroy(),
      });
    });
    req.on('error', nej);
  });
}

/* SSE har ingen kvittering: man ved foerst, at et vink ER kommet, naar det er
   der. Vi giver det et oejeblik og maaler saa. */
const vent = (ms) => new Promise((r) => setTimeout(r, ms));

test('stroemmen svarer med de hoveder, en proxy skal se', async () => {
  const s = await lyt(a.klient);
  assert.equal(s.status, 200);
  assert.match(s.headers['content-type'], /text\/event-stream/);
  // no-transform: ellers maa et mellemled gerne pakke om og buffre.
  assert.match(s.headers['cache-control'], /no-transform/);
  // nginx og flere proxyer buffrer uden den her - og saa kommer vinkene i
  // klumper, eller slet ikke.
  assert.equal(s.headers['x-accel-buffering'], 'no');
  s.luk();
});

test('uden login er der ingen stroem', async () => {
  const tom = srv.klient();
  const s = await lyt(tom);
  assert.equal(s.status, 401);
  s.luk();
});

test('en aendring vinker til ens EGEN aabne fane', async () => {
  const s = await lyt(a.klient);
  await vent(50);
  await a.klient.kald('POST', '/api/v1/capture', { text: 'noget nyt' });
  await vent(200);
  assert.ok(s.beskeder.length >= 1, `ingen vink: ${JSON.stringify(s.raa)}`);
  s.luk();
});

test('en anden brugers aendring vinker IKKE - heller ikke at der SKETE noget', async () => {
  /* Uden user_id-grupperingen ville Bodil kunne se, hvornaar Andreas rykker
     paa noget. Det er ikke hendes data, men det er stadig hans dag. */
  const sB = await lyt(b.klient);
  await vent(50);
  await a.klient.kald('POST', '/api/v1/capture', { text: 'andreas arbejder' });
  await vent(250);
  assert.deepEqual(sB.beskeder, [], `Bodil saa Andreas arbejde: ${JSON.stringify(sB.raa)}`);
  sB.luk();
});

test('en timer startet et sted vinker til de andre faner', async () => {
  /* Selve grunden til det hele: start en timer paa telefonen, og se den
     dukke op paa computeren. To stroemme = to faner hos samme bruger. */
  const fane1 = await lyt(a.klient);
  const fane2 = await lyt(a.klient);
  await vent(50);
  const opg = await a.klient.kald('POST', '/api/v1/capture', { text: 'opgave til timeren' });
  await vent(150);
  const foer1 = fane1.beskeder.length;
  const foer2 = fane2.beskeder.length;

  await a.klient.kald('POST', '/api/v1/timer/start', { taskId: opg.data.item.id });
  await vent(250);
  assert.ok(fane1.beskeder.length > foer1, 'fane 1 fik intet vink');
  assert.ok(fane2.beskeder.length > foer2, 'fane 2 fik intet vink');
  await a.klient.kald('POST', '/api/v1/timer/stop', {});
  fane1.luk(); fane2.luk();
});

test('en lukket fane ryddes - ellers vokser serveren for hver genindlaesning', async () => {
  const s = await lyt(a.klient);
  await vent(80);
  const med = await a.klient.kald('GET', '/api/v1/state');
  assert.ok(med.data.liveListeners >= 1, 'stroemmen blev ikke talt med');
  s.luk();
  await vent(250);
  const uden = await a.klient.kald('GET', '/api/v1/state');
  assert.equal(uden.data.liveListeners, 0, 'den lukkede fane blev liggende');
});
