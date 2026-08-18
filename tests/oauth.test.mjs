/* Fase 8: OAuth 2.1 til claude.ai's connectors.
 *
 * §9a's otte flow-tests, plus faelde 4 - den dyreste i hele OAuth-arbejdet,
 * som slap forbi baade 18 integrationstests og en manuel klik-igennem i doda:
 * `form-action 'self'` haandhaeves OGSAA paa den omdirigering, indsendelsen
 * foerer til. Derfor bruger testen her en RIGTIG fremmed redirect_uri.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { startServer, opretBruger } from './hjaelp.mjs';

const FREMMED = 'https://claude.ai/api/mcp/auth_callback';
const b64u = (b) => Buffer.from(b).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

let srv;
let a;
let klient;
let klient2;

/** PKCE-par. */
function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, udfordring: b64u(sha256(verifier)) };
}

async function registrer(navn, redirect = FREMMED) {
  const res = await fetch(`${srv.base}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: navn, redirect_uris: [redirect] }),
  });
  assert.equal(res.status, 201, `registrering fejlede: ${res.status}`);
  return res.json();
}

function autoriserUrl(k, p, opt = {}) {
  const q = new URLSearchParams({
    client_id: k.client_id,
    redirect_uri: opt.redirect || FREMMED,
    response_type: 'code',
    scope: opt.scope || 'full',
    state: 'xyz123',
    code_challenge: p.udfordring,
    code_challenge_method: 'S256',
  });
  return `${srv.base}/oauth/authorize?${q}`;
}

/** Henter samtykkesiden og udfoerer den - som en browser ville. */
async function godkend(k, p, opt = {}) {
  const url = autoriserUrl(k, p, opt);
  const side = await fetch(url, { headers: { Cookie: a.klient.cookie } });
  assert.equal(side.status, 200, 'samtykkesiden');
  const html = await side.text();
  const bevis = html.match(/name="bevis" value="([^"]+)"/)[1];

  const felter = new URLSearchParams(new URL(url).search);
  felter.set('bevis', opt.bevis || bevis);
  felter.set('godkend', opt.afvis ? 'nej' : 'ja');
  const svar = await fetch(`${srv.base}/oauth/authorize`, {
    method: 'POST',
    headers: { Cookie: a.klient.cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: felter.toString(),
    redirect: 'manual',
  });
  return { svar, csp: side.headers.get('content-security-policy'), html };
}

const kode = (svar) => new URL(svar.headers.get('location')).searchParams.get('code');

async function byt(krop) {
  const res = await fetch(`${srv.base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(krop),
  });
  return { status: res.status, data: await res.json() };
}

before(async () => {
  srv = await startServer();
  a = await opretBruger(srv, 'andreas');
  klient = await registrer('Claude');
  klient2 = await registrer('En anden klient');
});
after(() => srv.stop());

test('registrering: kun https (og localhost), ingen hemmelighed', async () => {
  assert.match(klient.client_id, /^tovo-client-/);
  assert.equal(klient.token_endpoint_auth_method, 'none', 'offentlig klient - PKCE er sikkerheden');
  assert.deepEqual(klient.redirect_uris, [FREMMED]);

  const daarlig = await fetch(`${srv.base}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'ondt', redirect_uris: ['http://ondt.example/cb'] }),
  });
  assert.equal(daarlig.status, 400, 'http udefra maa ikke registreres');
});

test('FAELDE 4: samtykkesidens form-action faar klientens origin med', async () => {
  const p = pkce();
  const { csp, svar } = await godkend(klient, p);
  // Uden dette ville browseren blokere HELE POST'en, naar den svarer 302 til
  // et fremmed domaene - og der ville ske INTET: ingen navigation, ingen
  // serverlog, kun ERR_ABORTED.
  assert.match(csp, /form-action 'self' https:\/\/claude\.ai/);
  assert.equal(svar.status, 302);
  assert.match(svar.headers.get('location'), /^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?/);
  assert.equal(new URL(svar.headers.get('location')).searchParams.get('state'), 'xyz123');
});

test('samtykkesiden er uden JavaScript og arver appens udseende', async () => {
  const p = pkce();
  const side = await fetch(autoriserUrl(klient, p), { headers: { Cookie: a.klient.cookie } });
  const html = await side.text();
  const scripts = html.match(/<script[^>]*>/g) || [];
  assert.equal(scripts.length, 1, 'kun tema-scriptet');
  assert.match(scripts[0], /data-theme-init/);
  assert.match(html, /<link rel="stylesheet" href="\/style\.css\?v=\d+">/);
  assert.match(html, /<form method="post">/);
  assert.match(side.headers.get('content-security-policy'), /script-src 'self' 'sha256-/);
});

test('uden session sendes man til login og tilbage - kun til den ene sti', async () => {
  const p = pkce();
  const res = await fetch(autoriserUrl(klient, p), { redirect: 'manual' });
  assert.equal(res.status, 302);
  const maal = res.headers.get('location');
  assert.match(maal, /^\/\?next=/);
  assert.match(decodeURIComponent(maal), /next=\/oauth\/authorize\?/);
});

test('koden er ENGANGSBRUG og bundet til klienten', async () => {
  const p = pkce();
  const { svar } = await godkend(klient, p);
  const c = kode(svar);

  const foerste = await byt({
    grant_type: 'authorization_code', code: c, client_id: klient.client_id,
    redirect_uri: FREMMED, code_verifier: p.verifier,
  });
  assert.equal(foerste.status, 200);
  assert.equal(foerste.data.token_type, 'Bearer');
  assert.ok(foerste.data.access_token.startsWith('tovo_'));

  const anden = await byt({
    grant_type: 'authorization_code', code: c, client_id: klient.client_id,
    redirect_uri: FREMMED, code_verifier: p.verifier,
  });
  assert.equal(anden.data.error, 'invalid_grant', 'samme kode to gange');
});

test('en kode udstedt til klient A kan ikke indloeses af klient B', async () => {
  const p = pkce();
  const { svar } = await godkend(klient, p);
  const r = await byt({
    grant_type: 'authorization_code', code: kode(svar), client_id: klient2.client_id,
    redirect_uri: FREMMED, code_verifier: p.verifier,
  });
  assert.equal(r.data.error, 'invalid_grant');
});

test('PKCE: forkert verifier duer ikke', async () => {
  const p = pkce();
  const { svar } = await godkend(klient, p);
  const r = await byt({
    grant_type: 'authorization_code', code: kode(svar), client_id: klient.client_id,
    redirect_uri: FREMMED, code_verifier: pkce().verifier,
  });
  assert.equal(r.data.error, 'invalid_grant');

  // Og plain er ikke en mulighed: OAuth 2.1 kraever S256.
  const q = new URLSearchParams({
    client_id: klient.client_id, redirect_uri: FREMMED, response_type: 'code',
    code_challenge: 'x'.repeat(43), code_challenge_method: 'plain',
  });
  const side = await fetch(`${srv.base}/oauth/authorize?${q}`, { headers: { Cookie: a.klient.cookie } });
  assert.equal(side.status, 400);
  assert.match(await side.text(), /PKCE with S256/);
});

test('refresh ROTERER: den gamle doer, naar den nye foedes', async () => {
  const p = pkce();
  const { svar } = await godkend(klient, p);
  const foerste = (await byt({
    grant_type: 'authorization_code', code: kode(svar), client_id: klient.client_id,
    redirect_uri: FREMMED, code_verifier: p.verifier,
  })).data;

  const fornyet = await byt({
    grant_type: 'refresh_token', refresh_token: foerste.refresh_token, client_id: klient.client_id,
  });
  assert.equal(fornyet.status, 200);
  assert.notEqual(fornyet.data.refresh_token, foerste.refresh_token);

  const igen = await byt({
    grant_type: 'refresh_token', refresh_token: foerste.refresh_token, client_id: klient.client_id,
  });
  assert.equal(igen.data.error, 'invalid_grant', 'en stjaalet kopi kan kun bruges én gang');
});

test('access-tokenet UDLOEBER - ogsaa selv om det ser gyldigt ud', async () => {
  const p = pkce();
  const { svar } = await godkend(klient, p);
  const t = (await byt({
    grant_type: 'authorization_code', code: kode(svar), client_id: klient.client_id,
    redirect_uri: FREMMED, code_verifier: p.verifier,
  })).data;

  const virker = await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.access_token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(virker.status, 200);

  // Flyt uret i databasen ved siden af - WAL taaler to processer.
  const db = new DatabaseSync(path.join(srv.dataDir, 'tovo.db'));
  db.prepare('UPDATE tokens SET expires_at = ? WHERE client_id IS NOT NULL')
    .run(Math.floor(Date.now() / 1000) - 10);
  db.close();

  const udloebet = await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.access_token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(udloebet.status, 401, 'uden udloebstjekket i OPSLAGET lever det evigt');
});

test('afvisning meldes tilbage til klienten', async () => {
  const p = pkce();
  const { svar } = await godkend(klient, p, { afvis: true });
  assert.equal(svar.status, 302);
  const maal = new URL(svar.headers.get('location'));
  assert.equal(maal.searchParams.get('error'), 'access_denied');
  assert.equal(maal.searchParams.get('state'), 'xyz123', 'state skal med, ellers venter klienten for evigt');
});

test('CSRF: samtykkeformularen kraever sit eget bevis', async () => {
  const p = pkce();
  const { svar } = await godkend(klient, p, { bevis: 'forkert' });
  assert.equal(svar.status, 400);
  assert.match(await svar.text(), /stale/);
});

test('scope: en read-forbindelse kan kun laese', async () => {
  const p = pkce();
  const { svar } = await godkend(klient, p, { scope: 'read' });
  const t = (await byt({
    grant_type: 'authorization_code', code: kode(svar), client_id: klient.client_id,
    redirect_uri: FREMMED, code_verifier: p.verifier,
  })).data;
  assert.equal(t.scope, 'read');

  const liste = await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.access_token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const navne = (await liste.json()).result.tools.map((x) => x.name);
  assert.ok(navne.includes('week_report'));
  assert.ok(!navne.includes('capture'));
});

test('forbindelsen kan tilbagekaldes - og en registrering er ikke en forbindelse', async () => {
  const p = pkce();
  const { svar } = await godkend(klient, p);
  const t = (await byt({
    grant_type: 'authorization_code', code: kode(svar), client_id: klient.client_id,
    redirect_uri: FREMMED, code_verifier: p.verifier,
  })).data;

  const foer = (await a.klient.kald('GET', '/api/v1/keys')).data;
  assert.ok(foer.connections.some((c) => c.id === klient.client_id));
  // Klient 2 har registreret sig, men aldrig faaet et ja - den maa IKKE staa
  // paa listen som en forbindelse.
  assert.ok(!foer.connections.some((c) => c.id === klient2.client_id),
    'en registrering er ikke en forbindelse');
  // Og OAuth-tokens hoerer ikke under brugerens egne noegler.
  assert.ok(!foer.keys.some((k) => k.name.startsWith('connector:')));

  await a.klient.kald('DELETE', `/api/v1/connections/${klient.client_id}`);
  const doed = await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.access_token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(doed.status, 401);

  const efter = (await a.klient.kald('GET', '/api/v1/keys')).data;
  assert.ok(!efter.connections.some((c) => c.id === klient.client_id));
});
