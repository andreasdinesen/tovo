/* Fase 7: gentagelser og kalenderfeed.
 *
 * Accepten er, at en aftale kl. 9 staar kl. 9 - ogsaa paa den anden side af
 * sommertidsskiftet. Det er den fejl, en UTC-konvertering laver, og den kan
 * ikke ses i marts, hvis man kun tester i august.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, opretBruger, naesteDato } from './hjaelp.mjs';

let srv;
let a;
let b;
let feed;

const linjer = (ics) => ics.split('\r\n');
const felt = (ics, navn) => linjer(ics).filter((l) => l.startsWith(navn));

before(async () => {
  srv = await startServer();
  a = await opretBruger(srv, 'andreas');
  await a.klient.kald('POST', '/api/v1/settings', { allow_registration: true });
  b = await opretBruger(srv, 'bo');
});
after(() => srv.stop());

test('gentagelse: naeste forekomst opstaar FOERST naar den nuvaerende lukkes', async () => {
  const r = await a.klient.kald('POST', '/api/v1/capture',
    { text: 'statusmoede @Nordvind ~30m !every monday at 9' });
  const opgave = r.data.item;
  assert.ok(opgave.recurrenceRule, 'reglen skal gemmes ved fangst');
  assert.equal(opgave.recurrenceRule.freq, 'week');

  const foer = (await a.klient.kald('GET', '/api/v1/items?kind=task')).data.items;
  assert.equal(foer.length, 1, 'kun ÉN aaben forekomst ad gangen');

  const luk = await a.klient.kald('POST', `/api/v1/tasks/${opgave.id}/complete`, {});
  assert.equal(luk.data.item.status, 'done');
  assert.ok(luk.data.next, 'naeste forekomst skal komme med i svaret');

  const efter = (await a.klient.kald('GET', '/api/v1/items?kind=task')).data.items;
  assert.equal(efter.length, 2);
  const ny = efter.find((t) => t.id === luk.data.next.id);
  assert.equal(ny.status, 'open');
  assert.equal(ny.estimateMinutes, 30, 'estimatet arves - det er den samme opgave igen');
  assert.equal(ny.projectId, opgave.projectId, 'gentagelser maa ligge under et projekt');
  assert.equal(ny.dueTime, '09:00');
  assert.ok(ny.dueDate > luk.data.item.dueDate || !luk.data.item.dueDate);

  // Den lukkede beholder ikke reglen - ellers ville en genaabning lave endnu en.
  assert.equal(luk.data.item.recurrenceRule, null);
  const genaabn = await a.klient.kald('POST', `/api/v1/tasks/${opgave.id}/complete`, { done: false });
  assert.ok(!genaabn.data.next, 'en genaabning skaber ingen forekomst');
  const nu = (await a.klient.kald('GET', '/api/v1/items?kind=task')).data.items;
  assert.equal(nu.length, 2, 'en genaabning maa ikke skabe en tredje');
});

test('feedet kraever et gyldigt token - alt andet er 404', async () => {
  const r = await a.klient.kald('POST', '/api/v1/ical', {});
  feed = r.data.feed;
  assert.match(feed.url, /\/ical\/[A-Za-z0-9_-]{16,}\.ics$/);

  // Samme kald igen giver SAMME feed - ellers ville hvert klik paa "kopiér"
  // efterlade et doedt abonnement i Outlook.
  const igen = await a.klient.kald('POST', '/api/v1/ical', {});
  assert.equal(igen.data.feed.token, feed.token);

  for (const url of [`${srv.base}/ical/${'x'.repeat(32)}.ics`,
    `${srv.base}/ical/${feed.token.slice(0, -1)}.ics`]) {
    const res = await fetch(url);
    assert.equal(res.status, 404, url);
  }
  // Og en anden brugers feed findes ikke for B.
  const bs = await b.klient.kald('GET', '/api/v1/ical');
  assert.equal(bs.data.feed, null);
});

test('en aftale kl. 9 staar kl. 9 - ogsaa efter sommertidsskiftet', async () => {
  // Den klassiske fejl: konverteres tiden til UTC ved eksporten, ligger
  // aftalen en time forkert paa den anden side af skiftet. Derfor to
  // datoer - én i sommertid og én i vintertid.
  // 15. juli er ALTID sommertid, 15. januar altid vintertid - uanset hvornaar
  // testen koeres. Datoerne regnes frem, saa de aldrig ligger i fortiden.
  const sDato = naesteDato(15, 7);
  const vDato = naesteDato(15, 1);
  const sommer = await a.klient.kald('POST', '/api/v1/capture', { text: `sommermoede !${sDato.tekst} kl 9` });
  const vinter = await a.klient.kald('POST', '/api/v1/capture', { text: `vintermoede !${vDato.tekst} kl 9` });
  assert.equal(sommer.data.item.dueTime, '09:00');
  assert.equal(vinter.data.item.dueTime, '09:00');

  const ics = await (await fetch(feed.url)).text();
  const starter = felt(ics, 'DTSTART');
  assert.ok(starter.some((l) => l === `DTSTART;TZID=Europe/Copenhagen:${sDato.ics}T090000`),
    `sommertid mangler: ${starter.join(' | ')}`);
  assert.ok(starter.some((l) => l === `DTSTART;TZID=Europe/Copenhagen:${vDato.ics}T090000`),
    `vintertid mangler: ${starter.join(' | ')}`);
  // Ingen Z-suffiks paa DTSTART: det ville betyde UTC.
  for (const l of starter) assert.doesNotMatch(l, /\dZ$/, `${l} er konverteret til UTC`);
});

test('varigheden er estimatet - ellers en time', async () => {
  const lDato = naesteDato(20, 6);
  const med = await a.klient.kald('POST', '/api/v1/capture', { text: `lang opgave !${lDato.tekst} kl 10 ~2,5t` });
  const ics = await (await fetch(feed.url)).text();
  const i = linjer(ics).findIndex((l) => l.includes('lang opgave'));
  const blok = linjer(ics).slice(i - 4, i + 6).join('\n');
  assert.match(blok, new RegExp(`DTSTART;TZID=Europe/Copenhagen:${lDato.ics}T100000`));
  assert.match(blok, new RegExp(`DTEND;TZID=Europe/Copenhagen:${lDato.ics}T123000`), '2,5 t efter kl. 10 er 12:30');
  assert.ok(med.data.item.estimateMinutes === 150);

  const uden = linjer(ics).findIndex((l) => l.includes('sommermoede'));
  const blok2 = linjer(ics).slice(uden - 4, uden + 6).join('\n');
  assert.match(blok2, new RegExp(`DTEND;TZID=Europe/Copenhagen:${naesteDato(15, 7).ics}T100000`),
    'uden estimat: en time');
});

test('VALARM kun paa begivenheder MED klokkeslaet', async () => {
  await a.klient.kald('POST', '/api/v1/capture', { text: 'heldagsting !5/9' });
  const ics = await (await fetch(feed.url)).text();
  const dele = ics.split('BEGIN:VEVENT').slice(1);
  const heldag = dele.find((d) => d.includes('heldagsting'));
  const medTid = dele.find((d) => d.includes('sommermoede'));
  assert.match(heldag, /DTSTART;VALUE=DATE:20260905/);
  assert.doesNotMatch(heldag, /BEGIN:VALARM/, 'en heldagspost ville ringe ved midnat');
  assert.match(medTid, /BEGIN:VALARM/);
  assert.match(medTid, /TRIGGER:-PT15M/);
});

test('VEVENT - ikke VTODO - og linjer foldet ved 75 oktetter paa BYTES', async () => {
  const lang = 'Migrering af telefonisystemet på hovedkontoret i Bjerringbro med æ, ø og å';
  await a.klient.kald('POST', '/api/v1/capture', { text: `${lang} !6/9 kl 8` });
  const ics = await (await fetch(feed.url)).text();

  assert.match(ics, /BEGIN:VEVENT/);
  assert.doesNotMatch(ics, /VTODO/, 'Outlook haandterer VTODO daarligt');

  for (const l of linjer(ics)) {
    assert.ok(Buffer.byteLength(l) <= 75, `linjen er ${Buffer.byteLength(l)} oktetter: ${l}`);
  }
  // Foldningen skal kunne LAESES tilbage: fortsaettelseslinjer begynder med
  // et mellemrum, og teksten skal vaere hel igen, naar de saettes sammen.
  const samlet = ics.replace(/\r\n /g, '');
  // Kommaet er ESCAPET i iCal (RFC 5545), saa sammenligningen skal ske mod den
  // escapede form - ellers tester man sin egen misforstaaelse.
  assert.ok(samlet.includes(lang.replace(',', '\\,')), 'titlen overlevede ikke foldningen');
  assert.ok(samlet.includes('å'), 'de danske tegn overlevede byte-foldningen');
});

test('beskrivelsen indeholder BEGGE veje ind: opgaven og start-linket', async () => {
  const opgaver = (await a.klient.kald('GET', '/api/v1/items?kind=task')).data.items;
  const en = opgaver.find((t) => t.title === 'sommermoede');
  const link = (await a.klient.kald('POST', `/api/v1/tasks/${en.id}/link`, {})).data.link;

  const ics = await (await fetch(feed.url)).text();
  const blok = ics.split('BEGIN:VEVENT').find((d) => d.includes('sommermoede')).replace(/\r\n /g, '');
  assert.match(blok, /Open in tovo: http/);
  assert.ok(blok.includes(link.token), 'start-linket skal kunne klikkes fra kalenderaftalen');
  assert.match(blok, /URL:http/);
});

test('feedet viser kun AABNE opgaver med en dato - og aldrig en andens', async () => {
  const opgaver = (await a.klient.kald('GET', '/api/v1/items?kind=task')).data.items;
  const en = opgaver.find((t) => t.title === 'heldagsting');
  await a.klient.kald('POST', `/api/v1/tasks/${en.id}/complete`, {});

  const ics = await (await fetch(feed.url)).text();
  assert.doesNotMatch(ics, /heldagsting/, 'en afsluttet opgave hoerer ikke i kalenderen');

  // Uden dato er der ikke noget at vise.
  await a.klient.kald('POST', '/api/v1/capture', { text: 'uden dato' });
  assert.doesNotMatch(await (await fetch(feed.url)).text(), /uden dato/);

  // B's opgaver kan aldrig havne i A's feed.
  await b.klient.kald('POST', '/api/v1/capture', { text: 'bos hemmelighed !7/9' });
  assert.doesNotMatch(await (await fetch(feed.url)).text(), /hemmelighed/);
});

test('et projektfeed indeholder kun det projekt', async () => {
  const p = (await a.klient.kald('GET', '/api/v1/state')).data.projects[0];
  const projektFeed = (await a.klient.kald('POST', '/api/v1/ical', { projectId: p.id })).data.feed;
  assert.notEqual(projektFeed.token, feed.token, 'projektfeedet er sit eget abonnement');

  const ics = await (await fetch(projektFeed.url)).text();
  assert.match(ics, /X-WR-CALNAME/);
  assert.doesNotMatch(ics, /sommermoede/, 'sommermoede har intet projekt');
});

test('ét .ics til én opgave - og den kraever login', async () => {
  const opgaver = (await a.klient.kald('GET', '/api/v1/items?kind=task')).data.items;
  const en = opgaver.find((t) => t.title === 'sommermoede');
  const res = await fetch(`${srv.base}/api/v1/tasks/${en.id}/ics`, { headers: { Cookie: a.klient.cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/calendar/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="tovo-/);
  const ics = await res.text();
  assert.equal(ics.split('BEGIN:VEVENT').length - 1, 1, 'kun den ene opgave');

  const uden = await fetch(`${srv.base}/api/v1/tasks/${en.id}/ics`);
  assert.equal(uden.status, 401);
  const bs = await fetch(`${srv.base}/api/v1/tasks/${en.id}/ics`, { headers: { Cookie: b.klient.cookie } });
  assert.equal(bs.status, 404, 'en anden brugers opgave findes ikke');
});

test('et tilbagekaldt feed er vaek med det samme', async () => {
  assert.equal((await fetch(feed.url)).status, 200);
  const r = await a.klient.kald('DELETE', '/api/v1/ical', {});
  assert.equal(r.status, 200);
  assert.equal((await fetch(feed.url)).status, 404);
});
