/* Fase 3: start-links. Den fase, der goer Toggl overfloedig.
 *
 * Et start-link er en adresse UDEN login, hvor adressen selv er
 * hemmeligheden. Derfor er det ogsaa den flade, hvor en fejl er dyrest -
 * og hvor svaret paa alt forkert skal vaere 404, aldrig 401 eller 403.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { startServer, opretBruger } from './hjaelp.mjs';

let srv;
let a;
let b;
let opgave;
let projekt;
let link;

before(async () => {
  srv = await startServer();
  a = await opretBruger(srv, 'andreas');
  await a.klient.kald('POST', '/api/v1/settings', { allow_registration: true });
  b = await opretBruger(srv, 'bo');
  const r = await a.klient.kald('POST', '/api/v1/capture', { text: 'opsaetning @Nordvind ~4t' });
  opgave = r.data.item;
  projekt = (await a.klient.kald('GET', '/api/v1/state')).data.projects[0];
  const l = await a.klient.kald('POST', `/api/v1/tasks/${opgave.id}/link`, {});
  link = l.data.link;
});
after(() => srv.stop());

test('linket laves server-side og vises kun til ejeren', async () => {
  assert.match(link.url, /\/s\/[A-Za-z0-9_-]{16,}$/);
  assert.equal(link.mode, 'toggle', 'toggle er standard: samme link starter og stopper');

  // Samme opgave to gange giver SAMME link - ellers ville hvert klik paa
  // "kopiér" lave et nyt token, og de gamle ville hobe sig op i OneNote.
  const igen = await a.klient.kald('POST', `/api/v1/tasks/${opgave.id}/link`, {});
  assert.equal(igen.data.link.token, link.token);

  // B maa ikke kunne faa et link til A's opgave.
  const bs = await b.klient.kald('POST', `/api/v1/tasks/${opgave.id}/link`, {});
  assert.equal(bs.status, 404);

  // Og opgavens eget svar baerer linket, saa UI'et ved, at det findes.
  const item = await a.klient.kald('GET', `/api/v1/items/${opgave.id}`);
  assert.equal(item.data.link.token, link.token);
  const bsItem = await b.klient.kald('GET', `/api/v1/items/${opgave.id}`);
  assert.equal(bsItem.status, 404);
});

test('et klik starter timeren - uden session og uden cookie', async () => {
  const res = await fetch(link.url);        // ingen cookie overhovedet
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /The timer is running/);
  assert.match(html, /opsaetning/, 'siden viser opgavens navn');
  assert.match(html, /Nordvind/, 'og projektet');
  assert.match(html, /Stop the timer/);

  const nu = await a.klient.kald('GET', '/api/v1/timer/current');
  assert.equal(nu.data.timer.taskTitle, 'opsaetning');
  assert.equal(nu.data.timer.entry.source, 'link', 'kilden skal sige, hvor tiden kom fra');
});

test('kvitteringssiden har INGEN JavaScript ud over tema-scriptet', async () => {
  // Ingen JS betyder ingen inline-script-diskussion med CSP'en overhovedet
  // (§9a del 4). Tema-scriptet er det ENE, og det er ordret det samme som i
  // index.html, saa serverens eksisterende sha256 daekker det.
  const res = await fetch(link.url, { headers: { 'Sec-Purpose': 'prefetch' } });
  const html = await res.text();
  const scripts = html.match(/<script[^>]*>/g) || [];
  assert.equal(scripts.length, 1, 'kun tema-scriptet');
  assert.match(scripts[0], /data-theme-init/);
  assert.doesNotMatch(html, /<script src=/);
  assert.doesNotMatch(html, /onclick=/i);
  // Stop-knappen er en almindelig formular.
  assert.match(html, /<form method="post">/);
  // Udseendet arves af SPA'ens stylesheet med det samme versionsnummer.
  assert.match(html, /<link rel="stylesheet" href="\/style\.css\?v=\d+">/);

  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' 'sha256-/, 'hashen daekker tema-scriptet');
  assert.match(csp, /form-action 'self'/);
});

test('en forhaandshentning maa ikke starte noget', async () => {
  // GET aendrer noget - det er prisen for ét klik fra OneNote. Klienter, der
  // selv siger, at de bare kigger, faar siden uden handlingen.
  await a.klient.kald('POST', '/api/v1/timer/stop', {});
  for (const header of [{ 'Sec-Purpose': 'prefetch' }, { Purpose: 'prefetch' }, { 'X-Purpose': 'preview' }]) {
    const res = await fetch(link.url, { headers: header });
    assert.equal(res.status, 200);
    const nu = await a.klient.kald('GET', '/api/v1/timer/current');
    assert.equal(nu.data.timer, null, `${JSON.stringify(header)} startede en timer`);
  }
  const head = await fetch(link.url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal((await a.klient.kald('GET', '/api/v1/timer/current')).data.timer, null);
});

test('samme link stopper igen - og stop-knappen POSTer', async () => {
  await fetch(link.url);
  assert.ok((await a.klient.kald('GET', '/api/v1/timer/current')).data.timer);

  const igen = await fetch(link.url);
  const html = await igen.text();
  assert.match(html, /Stopped after/);
  // Siden maa ikke sige "the timer keeps running", naar den lige er stoppet.
  assert.doesNotMatch(html, /timer keeps running/);
  assert.match(html, /Nothing is running/);
  assert.doesNotMatch(html, /Stop the timer/, 'ingen stop-knap paa noget, der ikke koerer');
  assert.equal((await a.klient.kald('GET', '/api/v1/timer/current')).data.timer, null);

  // Og knappen paa siden gaar samme vej.
  await fetch(link.url);
  const post = await fetch(link.url, { method: 'POST' });
  assert.equal(post.status, 200);
  assert.match(await post.text(), /Stopped after/);
  assert.equal((await a.klient.kald('GET', '/api/v1/timer/current')).data.timer, null);
});

test('mode: start starter altid - den stopper aldrig', async () => {
  const r = await a.klient.kald('POST', '/api/v1/capture', { text: 'anden opgave' });
  const l = await a.klient.kald('POST', `/api/v1/tasks/${r.data.item.id}/link`, { mode: 'start' });
  assert.equal(l.data.link.mode, 'start');
  await fetch(l.data.link.url);
  const foerste = (await a.klient.kald('GET', '/api/v1/timer/current')).data.timer;
  await fetch(l.data.link.url);
  const anden = (await a.klient.kald('GET', '/api/v1/timer/current')).data.timer;
  assert.ok(anden, 'et start-link maa ikke stoppe noget');
  assert.notEqual(anden.entry.id, foerste.entry.id, 'den gamle post lukkes, en ny begynder');
  await a.klient.kald('POST', '/api/v1/timer/stop', {});
});

test('alt forkert giver 404 - aldrig 401 eller 403', async () => {
  const proever = [
    `${srv.base}/s/${'x'.repeat(32)}`,                    // findes ikke
    `${srv.base}/s/${link.token.slice(0, -1)}`,           // én tegn kortere
    `${srv.base}/s/${link.token}x`,                       // én tegn laengere
  ];
  for (const url of proever) {
    const res = await fetch(url);
    assert.equal(res.status, 404, url);
    const html = await res.text();
    assert.match(html, /Not found/);
    assert.doesNotMatch(html, /opsaetning/, 'siden maa ikke roebe noget om opgaven');
  }
  // En laengde uden for det tilladte rammer slet ikke ruten.
  assert.equal((await fetch(`${srv.base}/s/kort`)).status, 404);
});

test('en anden INDLOGGET bruger faar 404', async () => {
  // Isolationstestens punkt: B skal ikke kunne betjene A's link fra sin egen
  // browser. Uden session er adressen legitimationen - det er dens formaal -
  // men en fremmed session er noget andet end ingen session.
  const res = await fetch(link.url, { headers: { Cookie: b.klient.cookie } });
  assert.equal(res.status, 404);
  assert.equal((await a.klient.kald('GET', '/api/v1/timer/current')).data.timer, null);
});

test('et tilbagekaldt token er vaek med det samme', async () => {
  const r = await a.klient.kald('DELETE', `/api/v1/tasks/${opgave.id}/link`);
  assert.equal(r.status, 200);
  assert.equal((await fetch(link.url)).status, 404);
  assert.equal((await a.klient.kald('DELETE', `/api/v1/tasks/${opgave.id}/link`)).status, 404);

  // Et nyt link til samme opgave er et NYT token - det gamle vaekkes ikke.
  const nyt = await a.klient.kald('POST', `/api/v1/tasks/${opgave.id}/link`, {});
  assert.notEqual(nyt.data.link.token, link.token);
  link = nyt.data.link;
});

test('opslaget scanner aldrig datasaettet', () => {
  // Kalender- og link-endepunkter uden login polles af fremmede klienter.
  // Planen er beviset: SEARCH paa primaernoeglen, ikke SCAN.
  const db = new DatabaseSync(path.join(srv.dataDir, 'tovo.db'));
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM start_tokens WHERE token = ? AND revoked_at IS NULL')
    .all('x');
  db.close();
  const tekst = plan.map((r) => r.detail).join(' ');
  assert.match(tekst, /SEARCH/);
  assert.doesNotMatch(tekst, /SCAN/);
});

test('bulk: hele projektet som markdown, klar til OneNote', async () => {
  await a.klient.kald('POST', '/api/v1/capture', { text: 'tredje opgave @Nordvind' });
  const r = await a.klient.kald('POST', `/api/v1/projects/${projekt.id}/links`, {});
  assert.equal(r.status, 200);
  assert.ok(r.data.links.length >= 2);
  for (const l of r.data.links) {
    assert.ok(r.data.markdown.includes(`- [${l.title}](${l.url})`),
      `markdown mangler linjen for "${l.title}"`);
  }
  // Linkene skal VIRKE, ikke bare se rigtige ud.
  const res = await fetch(r.data.links[0].url);
  assert.equal(res.status, 200);
  await a.klient.kald('POST', '/api/v1/timer/stop', {});

  // B faar ikke A's projekt.
  assert.equal((await b.klient.kald('POST', `/api/v1/projects/${projekt.id}/links`, {})).status, 404);
});
