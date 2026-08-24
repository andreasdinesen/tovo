/* Totrinsbekraeftelse (RUNE-ERFARINGER §9d).
 *
 * ── Dommeren skal vaere UAFHAENGIG ────────────────────────────────────────
 *
 * En test, hvor man selv har skrevet begge sider, kan bekraefte at man er
 * konsekvent - aldrig at man har RET. For TOTP findes dommeren i standarden:
 * RFC 6238 har testvektorer med en kendt hemmelighed og kendte koder til
 * bestemte tidsstempler. De er skrevet af nogen andre.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, opretBruger } from './hjaelp.mjs';

const require = createRequire(import.meta.url);
const totp = require('../app/totp.js');
const qr = require('../app/qr.js');

/* RFC 6238, Appendix B: hemmeligheden er ASCII "12345678901234567890".
   Tabellen dér er 8-cifret; vi bruger 6, altsaa de sidste seks. */
const RFC_HEM = totp.base32(Buffer.from('12345678901234567890', 'ascii'));

test('RFC 6238s EGNE testvektorer - dommeren er standarden', () => {
  // [unix-tid, 8-cifret kode fra RFC'ens SHA1-raekke]
  const vektorer = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [tid, otte] of vektorer) {
    const forventet = otte.slice(-6);
    const faktisk = totp.kodeFor(RFC_HEM, Math.floor(tid / 30));
    assert.equal(faktisk, forventet, `t=${tid} skulle give ${forventet}`);
  }
});

test('base32 uden polstring - en otpauth-URI taaler ikke =', () => {
  for (let n = 1; n <= 20; n++) {
    const s = totp.base32(Buffer.alloc(n, 0xab));
    assert.ok(!s.includes('='), `${n} bytes gav polstring`);
    assert.match(s, /^[A-Z2-7]+$/);
  }
  // Rundtur: det, appen skriver af, skal give de samme bytes.
  const raa = Buffer.from('12345678901234567890', 'ascii');
  assert.deepEqual(totp.fraBase32(totp.base32(raa)), raa);
  // Folk skriver af med mellemrum og smaa bogstaver.
  const hem = totp.base32(raa);
  const rodet = hem.toLowerCase().replace(/(....)/g, '$1 ');
  assert.deepEqual(totp.fraBase32(rodet), raa);
});

test('ét vindue til hver side - og ikke mere', () => {
  const hem = totp.nyHemmelighed();
  const nu = 1700000000000;
  const c = Math.floor(nu / 1000 / 30);
  assert.equal(totp.tjek(hem, totp.kodeFor(hem, c), nu), c, 'nu');
  assert.equal(totp.tjek(hem, totp.kodeFor(hem, c - 1), nu), c - 1, 'vinduet foer');
  assert.equal(totp.tjek(hem, totp.kodeFor(hem, c + 1), nu), c + 1, 'vinduet efter');
  assert.equal(totp.tjek(hem, totp.kodeFor(hem, c - 2), nu), null, 'to vinduer tilbage maa IKKE gaelde');
  assert.equal(totp.tjek(hem, totp.kodeFor(hem, c + 2), nu), null, 'to vinduer frem maa IKKE gaelde');
  assert.equal(totp.tjek(hem, '12345', nu), null, 'fem cifre er ikke en kode');
  assert.equal(totp.tjek(hem, '', nu), null);
});

test('otpauth: udstederen staar BAADE i stien og som parameter', () => {
  const uri = totp.otpauth('ABCDEFGH', 'andreas', 'tovo');
  assert.match(uri, /^otpauth:\/\/totp\/tovo:andreas\?/);
  assert.match(uri, /issuer=tovo/);
  assert.match(uri, /algorithm=SHA1/, 'apps regner med SHA1');
  assert.ok(!uri.includes('='.repeat(2)));
});

test('genoprettelseskoder kan skrives af fra papir', () => {
  const koder = totp.nyeKoder(10);
  assert.equal(koder.length, 10);
  assert.equal(new Set(koder).size, 10, 'ti forskellige');
  for (const k of koder) {
    assert.match(k, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    // 0/O og 1/I maa ikke forekomme - de kan ikke skelnes paa papir.
    assert.ok(!/[01OI]/.test(k), `${k} indeholder et tegn, man kan gaette forkert`);
  }
  // Hashen taaler smaa bogstaver og manglende bindestreg: folk taster af.
  const k = koder[0];
  assert.equal(totp.hashKode(k), totp.hashKode(k.toLowerCase().replace('-', ' ')));
});

/* ------------------------------------------------------------ serveren */

let srv;
let a;

before(async () => {
  srv = await startServer();
  a = await opretBruger(srv, 'andreas');
});
after(() => srv.stop());

test('opsaetningen slaar IKKE til af sig selv', async () => {
  const s0 = await a.klient.kald('GET', '/api/v1/totp');
  assert.equal(s0.data.enabled, false);
  assert.equal(s0.data.pending, false);

  const op = await a.klient.kald('POST', '/api/v1/totp/setup', {});
  assert.equal(op.status, 200);
  assert.match(op.data.secret, /^[A-Z2-7]+$/);
  assert.match(op.data.uri, /^otpauth:\/\/totp\/tovo:andreas\?/);

  const s1 = await a.klient.kald('GET', '/api/v1/totp');
  assert.equal(s1.data.enabled, false, 'en scannet kode er ikke en bekraeftet kode');
  assert.equal(s1.data.pending, true, 'men opsaetningen er paabegyndt');

  // En forkert kode maa ikke slaa den til.
  const forkert = await a.klient.kald('POST', '/api/v1/totp/enable', { code: '000000' });
  assert.equal(forkert.status, 400);
  assert.equal((await a.klient.kald('GET', '/api/v1/totp')).data.enabled, false);
});

test('QR-SVGEN kommer fra ENDEPUNKTET og indeholder den rigtige adresse', async () => {
  const op = await a.klient.kald('POST', '/api/v1/totp/setup', {});
  const svg = op.data.svg;
  assert.match(svg, /^<svg /);
  assert.match(svg, /shape-rendering="crispEdges"/, 'uden den udtvaerer browseren modulerne');

  /*
   * Den fejl, §9d beskriver: `tilSvg(lavQr(uri))` giver et OBJEKT, og koden
   * kommer til at indeholde "[object Object]". Den ser helt rigtig ud.
   *
   * Proeven er, at svarets SVG skal have SAMME stoerrelse som en kode, der
   * er bygget af adressen. En 15-tegns "[object Object]" bliver en lille
   * version 2; adressen kraever mange flere moduler.
   */
  const forventet = qr.tilSvg(op.data.uri, { px: 220 });
  const stoerrelse = (s) => (s.match(/viewBox="0 0 (\d+)/) || [])[1];
  assert.equal(stoerrelse(svg), stoerrelse(forventet),
    'svarets QR har en anden stoerrelse end adressens - fik tilSvg et objekt?');
  const objektKode = qr.tilSvg(String({}), { px: 220 });
  assert.notEqual(stoerrelse(svg), stoerrelse(objektKode),
    'svarets QR har samme stoerrelse som "[object Object]"');
});

test('hele vejen: slaa til, log ind med kode, og genoprettelseskoden virker EN gang', async () => {
  const op = await a.klient.kald('POST', '/api/v1/totp/setup', {});
  const hem = op.data.secret;
  const kode = totp.kodeFor(hem, Math.floor(Date.now() / 1000 / 30));

  const til = await a.klient.kald('POST', '/api/v1/totp/enable', { code: kode });
  assert.equal(til.status, 200);
  assert.equal(til.data.recoveryCodes.length, 10, 'koderne vises EN gang');
  const genopret = til.data.recoveryCodes[0];

  /*
   * En FRISK klient - altsaa en ny cookie-krukke, som en anden browser.
   * Det er dét, der goer proeven aegte: vi vil se, om der bliver udstedt en
   * session, foer andet trin er klaret.
   */
  const frisk = srv.klient();
  const halvt = await frisk.kald('POST', '/api/login',
    { username: 'andreas', password: 'hemmeligt123' });
  assert.equal(halvt.status, 200);
  assert.equal(halvt.data.needsCode, true);
  assert.ok(!halvt.data.user, 'ingen bruger udleveres, foer andet trin er klaret');
  assert.equal(frisk.cookie, '',
    'GATEN skal ligge FOER sessionen - ellers er totrinsbekraeftelsen en formalitet');
  // ... og uden cookie kan man ikke naa noget som helst.
  assert.equal((await frisk.kald('GET', '/api/v1/state')).status, 401);

  // Forkert kode: afvist, og fladen skal vide, at feltet skal BLIVE staaende.
  const galt = await frisk.kald('POST', '/api/login',
    { username: 'andreas', password: 'hemmeligt123', code: '000000' });
  assert.equal(galt.status, 401);
  assert.equal(galt.data.error, 'bad_code');
  assert.equal(galt.data.needsCode, true);
  assert.equal(frisk.cookie, '');

  // Engangskoden virker.
  const nuKode = totp.kodeFor(hem, Math.floor(Date.now() / 1000 / 30) + 1);
  const medKode = await frisk.kald('POST', '/api/login',
    { username: 'andreas', password: 'hemmeligt123', code: nuKode });
  assert.equal(medKode.status, 200);
  assert.equal(medKode.data.user.username, 'andreas');
  assert.ok(frisk.cookie.startsWith('tovo_session='), 'NU skal der vaere en session');

  // Genoprettelseskoden virker - og kun EN gang.
  const frisk2 = srv.klient();
  const ok = await frisk2.kald('POST', '/api/login',
    { username: 'andreas', password: 'hemmeligt123', code: genopret });
  assert.equal(ok.status, 200, 'en mistet telefon maa ikke laase ejeren ude for altid');

  const frisk3 = srv.klient();
  const igen = await frisk3.kald('POST', '/api/login',
    { username: 'andreas', password: 'hemmeligt123', code: genopret });
  assert.equal(igen.status, 401, 'en brugt genoprettelseskode maa ikke kunne gaa om');

  assert.equal((await a.klient.kald('GET', '/api/v1/totp')).data.recoveryLeft, 9);
});

test('den SAMME engangskode kan ikke bruges to gange', async () => {
  /*
   * Vinduet BRAENDES. `tjek()` returnerer det vindue, koden kom fra, og
   * serveren gemmer tallet - ellers kan en opsnappet kode bruges igen inden
   * for det halve minut (§9d).
   *
   * Egen bruger, saa proeven ikke afhaenger af raekkefoelgen ovenfor.
   */
  await a.klient.kald('POST', '/api/v1/settings', { allow_registration: true });
  const b = await opretBruger(srv, 'bo');
  const op = await b.klient.kald('POST', '/api/v1/totp/setup', {});
  const hem = op.data.secret;
  const kode = totp.kodeFor(hem, Math.floor(Date.now() / 1000 / 30));
  await b.klient.kald('POST', '/api/v1/totp/enable', { code: kode });

  // Den kode, opsaetningen brugte, er nu braendt.
  const f1 = srv.klient();
  const igen = await f1.kald('POST', '/api/login',
    { username: 'bo', password: 'hemmeligt123', code: kode });
  assert.equal(igen.status, 401, 'koden fra opsaetningen maa ikke ogsaa kunne logge ind');
  assert.match(igen.data.message, /already been used/i);

  // Naeste vindues kode virker - og DEN kan saa heller ikke gaa om.
  const naeste = totp.kodeFor(hem, Math.floor(Date.now() / 1000 / 30) + 1);
  const f2 = srv.klient();
  assert.equal((await f2.kald('POST', '/api/login',
    { username: 'bo', password: 'hemmeligt123', code: naeste })).status, 200);
  const f3 = srv.klient();
  const tredje = await f3.kald('POST', '/api/login',
    { username: 'bo', password: 'hemmeligt123', code: naeste });
  assert.equal(tredje.status, 401, 'samme kode, samme vindue - skal afvises');
  assert.equal(f3.cookie, '');
});

test('HEMMELIGHEDEN forlader aldrig serveren gennem settings eller eksport', async () => {
  const s = await a.klient.kald('GET', '/api/v1/settings');
  assert.ok(!('totp_secret' in s.data.settings), 'hemmeligheden maa ikke staa i settings');
  assert.ok(!('totp_last' in s.data.settings));
  const e = await a.klient.kald('GET', '/api/v1/export');
  const tekst = JSON.stringify(e.data);
  assert.ok(!tekst.includes('totp_secret'),
    'kan den laeses ud af en eksportfil, er hele totrinsbekraeftelsen pynt');
});
