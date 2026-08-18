/* Fase 8: MCP-serveren.
 *
 * Vaerktoejerne skal give NOEJAGTIG de samme tal som webappen - det er hele
 * grunden til, at beregn.js findes. Og en ny klient mod eksisterende
 * funktioner er en gratis integrationstest: i doda afsloerede den to fejl,
 * webappen tilfaeldigvis ikke ramte (§9a).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { startServer, opretBruger } from './hjaelp.mjs';

let srv;
let a;
let b;
let noegle;
let laesenoegle;
let opgaveId;
let projektId;

/** Ét JSON-RPC-kald. */
async function rpc(metode, params, opts = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (opts.noegle !== null) h.Authorization = `Bearer ${opts.noegle || noegle}`;
  const res = await fetch(`${srv.base}/mcp`, {
    method: opts.metode || 'POST',
    headers: Object.assign(h, opts.headers || {}),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: metode, params: params || {} }),
  });
  return { status: res.status, headers: res.headers, data: await res.json().catch(() => null) };
}

const kald = (navn, args, opts) => rpc('tools/call', { name: navn, arguments: args || {} }, opts);
const tekst = (r) => r.data.result.content[0].text;

before(async () => {
  srv = await startServer();
  a = await opretBruger(srv, 'andreas');
  await a.klient.kald('POST', '/api/v1/settings', { allow_registration: true });
  b = await opretBruger(srv, 'bo');
  noegle = (await a.klient.kald('POST', '/api/v1/keys', { name: 'test', scope: 'full' })).data.key;
  laesenoegle = (await a.klient.kald('POST', '/api/v1/keys', { name: 'kun laes', scope: 'read' })).data.key;
});
after(() => srv.stop());

test('FAELDE 1: 401 uden noegle baerer WWW-Authenticate med resource_metadata', async () => {
  // Hele indgangen er den header. Uden den kan claude.ai ikke opdage
  // autorisationsserveren og opgiver forbindelsen - uden at noget ser i
  // stykker ud.
  const r = await rpc('initialize', {}, { noegle: null });
  assert.equal(r.status, 401);
  const h = r.headers.get('www-authenticate');
  assert.match(h, /^Bearer realm="tovo"/);
  assert.match(h, /resource_metadata="http[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/);
});

test('FAELDE 2: begge .well-known-former svarer', async () => {
  for (const sti of ['/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/mcp']) {
    const res = await fetch(srv.base + sti);
    assert.equal(res.status, 200, sti);
    const d = await res.json();
    assert.ok(d.resource || d.issuer, sti);
  }
});

test('FAELDE 3: de offentlige ruter er laesbare paa tvaers af oprindelser', async () => {
  // CORS-headeren alene er ikke nok: Cross-Origin-Resource-Policy fra den
  // faelles securityHeaders ville faa browseren til at afvise svaret
  // ALLIGEVEL. Derfor gaar de her udenom.
  const res = await fetch(`${srv.base}/.well-known/oauth-authorization-server`);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('cross-origin-resource-policy'), null,
    'CORP maa ikke saettes paa en offentlig OAuth-rute');
});

test('protokollen: initialize, ping, notifikationer og ukendt metode', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-03-26' });
  assert.equal(init.data.result.protocolVersion, '2025-03-26', 'klientens version accepteres, naar vi kender den');
  assert.equal(init.data.result.serverInfo.name, 'tovo');
  assert.match(init.data.result.instructions, /never invent ids/i);

  const gammel = await rpc('initialize', { protocolVersion: '1999-01-01' });
  assert.equal(gammel.data.result.protocolVersion, '2025-06-18', 'ukendt version falder tilbage til vores egen');

  assert.deepEqual((await rpc('ping')).data.result, {});

  // Notifikationer besvares med 202 og TOM krop.
  const n = await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${noegle}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(n.status, 202);
  assert.equal(await n.text(), '');

  const ukendt = await rpc('findes/ikke');
  assert.equal(ukendt.data.error.code, -32601, 'protokolfejl er en JSON-RPC-fejl');
});

test('GET og DELETE svarer 405 - der er ingen SSE-stroem', async () => {
  for (const metode of ['GET', 'DELETE']) {
    const res = await fetch(`${srv.base}/mcp`, { method: metode, headers: { Authorization: `Bearer ${noegle}` } });
    assert.equal(res.status, 405, metode);
    assert.equal(res.headers.get('allow'), 'POST');
  }
});

test('Origin fra et fremmed site afvises (DNS-rebinding)', async () => {
  const r = await rpc('ping', {}, { headers: { Origin: 'https://ondt.example' } });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'bad_origin');
});

test('vaerktoejerne bruger SAMME parser som appen', async () => {
  const r = await kald('capture', { text: 'opsaetning af server @Nordvind ~2,5t !fredag #internt' });
  const t = tekst(r);
  assert.match(t, /Created: opsaetning af server/);
  assert.match(t, /Project: Nordvind/);
  assert.match(t, /Estimate: 2h 30m/, '~2,5t skal give 150 minutter - som i webappen');
  assert.match(t, /Due: /);
  opgaveId = r.data.result.structuredContent.item.id;

  const state = await a.klient.kald('GET', '/api/v1/state');
  projektId = state.data.projects[0].id;
  assert.equal(state.data.projects[0].name, 'Nordvind', 'projektet blev oprettet af fangsten');
  assert.equal(state.data.tags.length, 1);
});

test('timeren gennem MCP er den samme timer', async () => {
  const start = await kald('start_timer', { id: opgaveId });
  assert.match(tekst(start), /Timer running on: opsaetning af server/);

  // Webappen ser den samme koerende timer - der er kun én.
  const via = await a.klient.kald('GET', '/api/v1/timer/current');
  assert.equal(via.data.timer.entry.taskId, opgaveId);
  assert.equal(via.data.timer.entry.source, 'mcp', 'kilden fortaeller, hvor tiden kom fra');

  assert.match(tekst(await kald('current_timer')), /running for/);
  assert.match(tekst(await kald('stop_timer')), /Stopped after/);
  assert.match(tekst(await kald('stop_timer')), /No timer was running/);
});

test('log_time er den vigtigste - og den forstaar dansk decimalkomma', async () => {
  const r = await kald('log_time', { id: opgaveId, time: '1,5t', date: '2026-08-17', note: 'bagudrettet' });
  assert.match(tekst(r), /Logged 1h 30m on 2026-08-17/);
  const poster = (await a.klient.kald('GET', `/api/v1/entries?task=${opgaveId}`)).data.entries;
  const den = poster.find((p) => p.note === 'bagudrettet');
  assert.equal((den.stoppedAt - den.startedAt) / 60, 90);
  assert.equal(den.source, 'mcp');

  const interval = await kald('log_time', { id: opgaveId, time: '9-11.30', date: '2026-08-17' });
  assert.match(tekst(interval), /Logged 2h 30m/);

  const vroevl = await kald('log_time', { id: opgaveId, time: 'noget vroevl' });
  assert.equal(vroevl.data.result.isError, true, 'en vaerktoejsfejl er IKKE en protokolfejl');
  assert.match(vroevl.data.result.content[0].text, /9-11\.30/, 'fejlen skal vise hvad der VIRKER');
  assert.equal(vroevl.data.error, undefined);
});

test('week_report giver NOEJAGTIG samme tal som webappen', async () => {
  // Beanledger v28: to sandheder er den fejl, der skal forhindres. Rapporten
  // fra MCP og fra API'et regnes af det samme modul paa de samme data.
  const via = (await a.klient.kald('GET', '/api/v1/report?from=2026-08-17&to=2026-08-23')).data.report;
  const r = await kald('week_report', { from: '2026-08-17', to: '2026-08-23' });
  const mcpRapport = r.data.result.structuredContent.report;
  assert.equal(mcpRapport.total, via.total);
  assert.equal(mcpRapport.adhoc, via.adhoc);
  assert.equal(mcpRapport.onProjects, via.onProjects);
  assert.deepEqual(mcpRapport.days.map((d) => d.minutter), via.days.map((d) => d.minutter));
  assert.match(tekst(r), /in total/);
});

test('project_status svarer paa de tre niveauer', async () => {
  await a.klient.kald('PATCH', `/api/v1/items/${projektId}`, { budgetHours: 10, customer: 'Nordvind A/S' });
  const r = await kald('project_status', { id: projektId });
  const t = tekst(r);
  assert.match(t, /Nordvind — Nordvind A\/S/);
  assert.match(t, /Estimated: 2h 30m/);
  assert.match(t, /Budget: 10h/);
  assert.match(t, /Spent: 4h/);
  assert.match(t, /Left: 6h/);

  const via = (await a.klient.kald('GET', `/api/v1/projects/${projektId}`)).data.rollup;
  assert.equal(r.data.result.structuredContent.rollup.forbrugt, via.forbrugt);
});

test('set_estimate, update_task og complete_task', async () => {
  assert.match(tekst(await kald('set_estimate', { id: opgaveId, estimate: '4t' })), /Estimate on .*: 4h/);
  assert.equal((await kald('set_estimate', { id: opgaveId, estimate: 'aeblegroed' })).data.result.isError, true);

  assert.match(tekst(await kald('update_task', { id: opgaveId, title: 'ny titel', priority: 'high' })), /Updated: ny titel/);
  const item = (await a.klient.kald('GET', `/api/v1/items/${opgaveId}`)).data.item;
  assert.equal(item.priority, 'high');
  assert.equal(item.estimateMinutes, 240);

  const gentaget = await kald('capture', { text: 'ugentligt @Nordvind !every monday at 9' });
  const gid = gentaget.data.result.structuredContent.item.id;
  const luk = await kald('complete_task', { id: gid });
  assert.match(tekst(luk), /Next occurrence: /, 'gentagelsen virker ogsaa gennem MCP');
  assert.match(tekst(await kald('complete_task', { id: gid })), /Already done/);
});

test('duplicate_task gaar gennem SAMME funktion som webappens knap', async () => {
  const org = (await a.klient.kald('POST', '/api/v1/items', {
    kind: 'task', title: 'Kopi via MCP', estimateMinutes: 90, caseNumber: 'SAG-9',
  })).data.item;
  await a.klient.kald('POST', '/api/v1/entries', { taskId: org.id, date: '2026-08-17', text: '1t' });

  const svar = await kald('duplicate_task', { id: org.id });
  assert.match(tekst(svar), /Copied: Kopi via MCP \(copy\)/);
  const kopi = svar.data.result.structuredContent
    ? svar.data.result.structuredContent.item
    : JSON.parse(svar.data.result.content.find((c) => c.type === 'text' && c.text.startsWith('{')).text).item;
  assert.equal(kopi.estimateMinutes, 90);
  assert.equal(kopi.caseNumber, 'SAG-9');
  assert.equal(kopi.status, 'open');

  // Den vigtigste: MCP maa ikke tage tidsposterne med, naar webappen ikke goer.
  const poster = (await a.klient.kald('GET', '/api/v1/entries?from=2020-01-01&to=2030-01-01')).data.entries;
  assert.equal(poster.filter((e) => e.taskId === kopi.id).length, 0);

  assert.match(tekst(await kald('duplicate_task', { id: 'findesikke000000' })), /No task with id/);
});

test('scopes: en laesenoegle kan hverken se eller kalde skrive-vaerktoejer', async () => {
  const liste = await rpc('tools/list', {}, { noegle: laesenoegle });
  const navne = liste.data.result.tools.map((t) => t.name);
  assert.ok(navne.includes('week_report'));
  assert.ok(!navne.includes('start_timer'), 'listen viser kun det, noeglen maa');
  assert.ok(!navne.includes('capture'));

  // ... men listen er en hjaelp, ikke en spaerring: haandhaev igen ved kaldet.
  const forsoeg = await kald('start_timer', { id: opgaveId }, { noegle: laesenoegle });
  assert.equal(forsoeg.data.result.isError, true);
  assert.match(forsoeg.data.result.content[0].text, /cannot write/);

  const alle = await rpc('tools/list', {});
  assert.equal(alle.data.result.tools.length, 13);
  assert.ok(!navne.includes('duplicate_task'), 'en kopi er en skrivning');
});

test('en noegle naar kun SIN egen brugers data', async () => {
  const bsNoegle = (await b.klient.kald('POST', '/api/v1/keys', { name: 'bo', scope: 'full' })).data.key;
  const soeg = await kald('search', { query: 'ny titel' }, { noegle: bsNoegle });
  assert.match(tekst(soeg), /No matches/, 'B kan ikke soege i A-s opgaver');

  const forsoeg = await kald('start_timer', { id: opgaveId }, { noegle: bsNoegle });
  assert.equal(forsoeg.data.result.isError, true);
  assert.match(forsoeg.data.result.content[0].text, /No task with id/);

  const projekter = await kald('list_projects', {}, { noegle: bsNoegle });
  assert.match(tekst(projekter), /No projects yet/);
});

test('noegler kan tilbagekaldes - og virker med det samme ikke mere', async () => {
  const ny = await a.klient.kald('POST', '/api/v1/keys', { name: 'kortvarig', scope: 'full' });
  assert.equal((await rpc('ping', {}, { noegle: ny.data.key })).status, 200);
  await a.klient.kald('DELETE', `/api/v1/keys/${ny.data.id}`);
  assert.equal((await rpc('ping', {}, { noegle: ny.data.key })).status, 401);
});

test('en connector kan ikke administrere sig selv', async () => {
  // §9a: kodeordsskift og noegleadministration skal blive paa requireUser.
  // Ellers er én laekket noegle nok til at give sig selv varig adgang.
  for (const [metode, sti] of [['GET', '/api/v1/keys'], ['POST', '/api/v1/keys'], ['POST', '/api/password']]) {
    const res = await fetch(srv.base + sti, {
      method: metode,
      headers: { Authorization: `Bearer ${noegle}`, 'Content-Type': 'application/json' },
      body: metode === 'POST' ? '{}' : undefined,
    });
    assert.equal(res.status, 401, `${metode} ${sti} maa ikke kunne naas med en noegle`);
    assert.equal((await res.json()).error, 'session_required');
  }
});

test('JSON-RPC-batch virker', async () => {
  // doda opdagede foerst her, at body-laeseren afviste arrays - saa batch
  // kunne aldrig virke.
  const res = await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${noegle}` },
    body: JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]),
  });
  const d = await res.json();
  assert.ok(Array.isArray(d));
  assert.equal(d.length, 2);
  assert.equal(d[0].id, 1);
  assert.ok(d[1].result.tools.length);
});

test('OAuth-tokens ligger i den EKSISTERENDE noegletabel - og udloeber', async () => {
  const db = new DatabaseSync(path.join(srv.dataDir, 'tovo.db'));
  const raekker = db.prepare('SELECT client_id, expires_at FROM tokens WHERE user_id IS NOT NULL').all();
  db.close();
  // Endnu ingen OAuth-tokens, men strukturen er der: haandlavede noegler har
  // hverken klient eller udloeb.
  assert.ok(raekker.every((r) => r.client_id === null && r.expires_at === null));
});
