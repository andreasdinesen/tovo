/* Broen til Sagu - serversiden.
 *
 * Der er ingen Sagu at proeve imod her, og det er med vilje: det, der
 * faktisk sker i drift, er FEJLSTIERNE (ikke forbundet, forkert noegle,
 * adresse der ikke svarer) plus den regel, der betyder mest - at noeglen
 * aldrig forlader serveren.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, opretBruger } from './hjaelp.mjs';

const require = createRequire(import.meta.url);
const saguModul = require('../app/sagu.js');

let srv;
let a;
let b;

before(async () => {
  srv = await startServer();
  a = await opretBruger(srv, 'andreas');                 // foerste = admin
  await a.klient.kald('POST', '/api/v1/settings', { allow_registration: true });
  b = await opretBruger(srv, 'bo');
});
after(() => srv.stop());

test('en Sagu-adresse genkendes paa sin form - og kun paa den rigtige vaert', () => {
  const u = 'https://sagu.example.com/#note-0123456789abcdef0123456789abcdef';
  assert.equal(saguModul.idFraUrl(u), '0123456789abcdef0123456789abcdef');
  assert.equal(saguModul.idFraUrl('https://sagu.example.com/#note-kort'), null);
  assert.equal(saguModul.idFraUrl('onenote:https://d.docs.live.net/x/N.one#Ops'), null);
  assert.equal(saguModul.erSaguUrl(u, 'https://sagu.example.com'), true);
  // Samme form, FREMMED vaert: maa ikke tegnes som "vores" note.
  assert.equal(saguModul.erSaguUrl(u, 'https://andet.example.com'), false);
});

test('uforbundet: ruterne svarer paent i stedet for at kaste', async () => {
  const s = await a.klient.kald('GET', '/api/v1/sagu');
  assert.equal(s.status, 200);
  assert.equal(s.data.connected, false);
  assert.deepEqual(s.data.notebooks, []);

  const soeg = await a.klient.kald('GET', '/api/v1/sagu/search?q=noget');
  assert.equal(soeg.status, 400);
  assert.match(soeg.data.message, /Connect Sagu/i);
  // Koden skal vaere en KODE, en klient kan forgrene paa.
  assert.match(soeg.data.error, /^[a-z][a-z0-9_]*$/);
});

test('en adresse med en sti afvises - den ville lande midt i alle vores URLer', async () => {
  for (const url of ['https://sagu.example.com/noget', 'ikke en url', 'ftp://sagu.example.com']) {
    const r = await a.klient.kald('POST', '/api/v1/sagu', { url, key: 'x' });
    assert.equal(r.status, 400, url);
    assert.equal(r.data.error, 'bad_url');
  }
});

test('foerste forbindelse UDEN noegle afvises', async () => {
  const r = await a.klient.kald('POST', '/api/v1/sagu', { url: 'https://sagu.example.com' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'no_key');
});

test('en adresse der ikke svarer ruller tilbage - intet bliver haengende', async () => {
  // 127.0.0.1:1 svarer aldrig. Forbindelsen maa ikke gemmes halvt.
  const r = await a.klient.kald('POST', '/api/v1/sagu', { url: 'http://127.0.0.1:1', key: 'hemmelig' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'bad_key');
  const s = await a.klient.kald('GET', '/api/v1/sagu');
  assert.equal(s.data.connected, false, 'en fejlet forbindelse maa ikke se forbundet ud');
  assert.equal(s.data.url, '', 'adressen blev rullet tilbage');
});

test('NOEGLEN FORLADER ALDRIG SERVEREN - hverken i settings eller i eksporten', async () => {
  // Plant en noegle direkte, som en vellykket forbindelse ville have gjort.
  await a.klient.kald('POST', '/api/v1/settings', { sagu_key: 'meget-hemmelig-noegle' });

  const s = await a.klient.kald('GET', '/api/v1/settings');
  assert.equal(s.status, 200);
  assert.ok(!('sagu_key' in s.data.settings), 'sagu_key maa ikke vaere i settings-svaret');
  assert.ok(!JSON.stringify(s.data).includes('meget-hemmelig'), 'noeglen laekkede i settings');

  const e = await a.klient.kald('GET', '/api/v1/export');
  assert.equal(e.status, 200);
  assert.ok(!JSON.stringify(e.data).includes('meget-hemmelig'),
    'noeglen laekkede i JSON-eksporten - den fil kan man komme til at sende videre');

  // ... men serveren kan stadig laese den, ellers kunne broen ikke virke.
  const g = await a.klient.kald('GET', '/api/v1/sagu');
  assert.equal(g.data.connected, false, 'kun noegle uden adresse er ikke en forbindelse');
});

test('en ukendt notesbog kan ikke vaelges', async () => {
  const r = await a.klient.kald('POST', '/api/v1/sagu/notebook', { id: 'findes-ikke' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'unknown_notebook');
});

/* ------------------------------------------------------------- /changes */

test('/changes giver det, der er aendret - og ALDRIG en anden brugers', async () => {
  const foer = Math.floor(Date.now() / 1000);
  await new Promise((r) => setTimeout(r, 1100));

  const min = (await a.klient.kald('POST', '/api/v1/items',
    { kind: 'task', title: 'min opgave' })).data.item;
  await b.klient.kald('POST', '/api/v1/items', { kind: 'task', title: 'bos opgave' });

  const r = await a.klient.kald('GET', `/api/v1/changes?since=${foer}`);
  assert.equal(r.status, 200);
  const titler = r.items ? [] : r.data.items.map((i) => i.title);
  assert.ok(titler.includes('min opgave'));
  assert.ok(!titler.includes('bos opgave'), 'en anden brugers aendringer maa aldrig komme med');
  assert.ok(r.data.now >= foer);

  // En bloed sletning skal meldes som SLETTET, ikke bare forsvinde.
  await a.klient.kald('DELETE', `/api/v1/items/${min.id}`);
  const efter = await a.klient.kald('GET', `/api/v1/changes?since=${foer}`);
  assert.ok(efter.data.deleted.includes(min.id), 'sletningen skal kunne ses af den, der foelger med');
  assert.ok(!efter.data.items.some((i) => i.id === min.id));
});

test('en ugyldig "since" afvises med en kode, ikke med et krak', async () => {
  const r = await a.klient.kald('GET', '/api/v1/changes?since=i-gaar');
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'bad_since');
});

/*
 * Notesbogen: standarden skal ANVENDES, ikke bare gemmes.
 *
 * Meldt fra brug: en note oprettet fra en opgave landede uden notesbog,
 * selv om indstillingen stod og pegede paa én. Serveren LAESTE
 * `notebookId`, modulet BRUGTE den - men ingen af kaldsstederne sendte den
 * nogensinde. Kaeden var brudt i sidste led.
 *
 * Testen kigger derfor paa det, der ryger AF STED til Sagu, ikke paa hvad
 * indstillingen indeholder. En falsk Sagu er nok: det, der skal bevises, er
 * hvad tovo SENDER.
 */
test('en ny note faar brugerens valgte notesbog - ogsaa naar klienten ikke siger noget', async () => {
  const http = await import('node:http');
  const set = [];
  const falskSagu = http.createServer((req, res) => {
    let krop = '';
    req.on('data', (d) => { krop += d; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/api/v1/state') {
        res.end(JSON.stringify({ counts: { notes: 0 },
          notebooks: [{ id: 'bog-1', name: 'Tovo - noter' }] }));
        return;
      }
      if (req.url === '/api/v1/notes' && req.method === 'POST') {
        set.push(JSON.parse(krop || '{}'));
        res.end(JSON.stringify({ note: { id: 'a'.repeat(32) } }));
        return;
      }
      res.end('{}');
    });
  });
  await new Promise((ok) => falskSagu.listen(0, '127.0.0.1', ok));
  const port = falskSagu.address().port;

  try {
    const f = await a.klient.kald('POST', '/api/v1/sagu',
      { url: `http://127.0.0.1:${port}`, key: 'noegle' });
    assert.equal(f.status, 200, 'forbindelsen skal lykkes mod den falske Sagu');

    // Brugeren vaelger sin notesbog.
    const v = await a.klient.kald('POST', '/api/v1/sagu/notebook', { id: 'bog-1' });
    assert.equal(v.status, 200);

    // Klienten siger INTET om notesbog - som paletten og opgaveruden goer.
    const r = await a.klient.kald('POST', '/api/v1/sagu/note', { title: 'En note' });
    assert.equal(r.status, 200);
    assert.equal(set.length, 1);
    assert.equal(set[0].notebookId, 'bog-1',
      'noten skal lande i den notesbog, indstillingen peger paa');

    // ... og siger klienten det UDTRYKKELIGT, vinder det. Det mest
    // specifikke skriver sidst.
    await a.klient.kald('POST', '/api/v1/sagu/note', { title: 'To', notebookId: 'bog-1' });
    assert.equal(set[1].notebookId, 'bog-1');
  } finally {
    await new Promise((ok) => falskSagu.close(ok));
    await a.klient.kald('POST', '/api/v1/sagu/disconnect', {});
  }
});
