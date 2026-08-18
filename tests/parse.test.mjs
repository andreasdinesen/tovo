/* Den delte parser og varighedsregningen.
 *
 * Tre fejl i dodas parser blev fundet af en test og ikke af oejet, og de er
 * alle tre repraesenteret herunder: trim-foer-maal, markoerer uden guard
 * foran, og en gren der spiser tekst uden en modtager (doda F1).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parse = require('../app/shared/parse.js');
const beregn = require('../app/shared/beregn.js');

const NU = new Date('2026-08-18T10:00:00');           // en tirsdag
const tolk = (t) => parse.tolkFangst(t, { now: NU });

test('varighed: dansk decimalkomma er ikke valgfrit', () => {
  assert.equal(beregn.parseVarighed('1,5t'), 90);
  assert.equal(beregn.parseVarighed('1.5t'), 90);
  assert.equal(beregn.parseVarighed('6,1'), 366, 'et bart tal er TIMER');
  assert.equal(beregn.parseVarighed('90m'), 90);
  assert.equal(beregn.parseVarighed('1t30m'), 90);
  assert.equal(beregn.parseVarighed('1:30'), 90);
  assert.equal(beregn.parseVarighed('45 minutter'), 45);
  assert.equal(beregn.parseVarighed('2 hours'), 120);
  // En naiv parseFloat laeser "1,5" som 1 og taber en halv time hver gang.
  assert.notEqual(beregn.parseVarighed('1,5t'), 60);
});

test('varighed: det der ikke er en varighed, skal sige nej', () => {
  for (const t of ['', 'x', '0', '0m', '2 pizzaer', '-3t', 'i morgen']) {
    assert.equal(beregn.parseVarighed(t), null, `"${t}" burde ikke tolkes`);
  }
  // Et aar er en tastefejl, ikke et estimat.
  assert.equal(beregn.parseVarighed('99999t'), null);
});

test('formatVarighed skriver engelsk - og decimal til afstemning', () => {
  assert.equal(beregn.formatVarighed(90), '1h 30m');
  assert.equal(beregn.formatVarighed(60), '1h');
  assert.equal(beregn.formatVarighed(45), '45m');
  assert.equal(beregn.formatVarighed(0), '0m');
  assert.equal(beregn.formatVarighed(366, { form: 'decimal' }), '6.1h');
});

test('~ er ESTIMAT i tovo, ikke udskudt dato som i doda', () => {
  const r = tolk('+ opsaetning af server @Nordvind ~2,5t !fredag');
  assert.equal(r.title, 'opsaetning af server');
  assert.equal(r.project, 'Nordvind');
  assert.equal(r.estimateMinutes, 150);
  assert.equal(r.due.dato, '2026-08-21');
  assert.equal(r.defer, undefined, 'defer-grenen skal vaere FJERNET, ikke bare ubrugt');
});

test('# er tag, @ og / er projekt', () => {
  const r = tolk('migrering #internt #haster @Nordvind');
  assert.deepEqual(r.tags, ['internt', 'haster']);
  assert.equal(r.project, 'Nordvind');
  assert.equal(tolk('opgave /Andet').project, 'Andet');
  assert.equal(tolk('opgave /"Nordvind TRIO 11"').project, 'Nordvind TRIO 11');
});

test('en markoer kraever linjestart eller mellemrum foran sig', () => {
  // Uden guarden bliver en mailadresse til et projekt og et anker til et tag.
  const r = tolk('ring til nogen@eksempel.dk om https://dr.dk/nyheder#sport');
  assert.equal(r.project, null);
  assert.deepEqual(r.tags, []);
  assert.equal(r.title, 'ring til nogen@eksempel.dk om https://dr.dk/nyheder#sport');
});

test('tag og projekt skal klaebe til markoeren - ellers er det almindelig tekst', () => {
  // "kurset i C # og F": trimmer man vaerdien og maaler laengden paa den
  // utrimmede, spises et tegn for meget og titlen bliver "kurset i C g F".
  const r = tolk('kurset i C # og F');
  assert.equal(r.title, 'kurset i C # og F');
  assert.deepEqual(r.tags, []);
});

test('en varighed, der ikke kan tolkes, BLIVER staaende i titlen', () => {
  // Det er hele pointen fra doda 2026-08-18: alt uden en modtager skal enten
  // blive i teksten eller afvises hoejlydt. Det maa aldrig bare forsvinde.
  const r = tolk('noget ~2 pizzaer');
  assert.equal(r.estimateMinutes, null);
  assert.match(r.title, /~2 pizzaer/);
  assert.equal(r.warnings.length, 1);
});

test('en dato, der ikke kan tolkes, bliver ogsaa staaende', () => {
  const r = tolk('opgave !naar himlen falder ned');
  assert.equal(r.due, null);
  assert.match(r.title, /naar himlen falder ned/);
  assert.equal(r.warnings.length, 1);
});

test('gentagelser gemmes som regel allerede nu - motoren kommer i fase 7', () => {
  const r = tolk('+ statusmoede /"Nordvind TRIO 11" !every monday at 9');
  assert.equal(r.project, 'Nordvind TRIO 11');
  assert.ok(r.recurrenceRule, 'reglen skal gemmes, ellers taber vi den ved fangst');
  assert.equal(r.recurrenceRule.freq, 'week');
  assert.equal(r.recurrenceRule.time, '09:00');
  assert.match(r.recurrenceText, /Monday/);
  assert.equal(r.due, null, 'en gentagelse er ikke en engangsdato');
});

test('beskrivelsen skilles fra med // eller et linjeskift', () => {
  assert.equal(tolk('skriv rapport // husk bilag').note, 'husk bilag');
  assert.equal(tolk('skriv rapport\nhusk bilag').note, 'husk bilag');
  // Mellemrummene omkring // er det, der redder en URL.
  assert.equal(tolk('se https://dr.dk/x').note, '');
});

test('datoer regnes i lokal tid paa (aar, maaned, dag)', () => {
  assert.equal(tolk('x !i dag').due.dato, '2026-08-18');
  assert.equal(tolk('x !i morgen').due.dato, '2026-08-19');
  assert.equal(tolk('x !tomorrow').due.dato, '2026-08-19');
  assert.equal(tolk('x !3/9').due.dato, '2026-09-03');
  assert.equal(tolk('x !in 2 weeks').due.dato, '2026-09-01');
  // Klokkeslaet hoerer til datoen, ikke til titlen.
  const r = tolk('x !i morgen kl 9.30');
  assert.equal(r.due.tid, '09:30');
  assert.equal(r.title, 'x');
});

test('fjernMarkoer fjerner PRAECIS ét kendt token', () => {
  const t = 'opgave @Nordvind #internt';
  assert.equal(parse.fjernMarkoer(t, '@/', 'Nordvind'), 'opgave #internt');
  assert.equal(parse.fjernMarkoer(t, '#', 'internt'), 'opgave @Nordvind');
  // En vaerdi, der ikke staar der, maa ikke aendre noget.
  assert.equal(parse.fjernMarkoer(t, '#', 'findesikke'), t);
});

test('gentagelse: interval OG ugedag - formen tovo tilfoejede', () => {
  // dodas parser kan ikke "every 2 weeks on friday", og feltets egen
  // pladsholder foreslaar "every 2 weeks". Uden formen svarede den bare nej.
  const r = parse.tolkGentagelse('every 2 weeks on friday', NU);
  assert.equal(r.freq, 'week');
  assert.equal(r.interval, 2);
  assert.deepEqual(r.weekdays, [5]);

  assert.deepEqual(parse.tolkGentagelse('every 3 weeks on monday and thursday', NU).weekdays, [1, 4]);
  assert.equal(parse.tolkGentagelse('hver anden uge på fredag', NU).interval, 2);
  assert.equal(parse.tolkGentagelse('every 2 weeks on friday at 14', NU).time, '14:00');
  assert.equal(parse.tolkGentagelse('every! 2 weeks on monday', NU).mode, 'completion');

  // `weeks?` og ikke `week|weeks`: i en alternation vinder foerste traef, saa
  // "week|weeks" matcher kun "week" af "weeks" og efterlader et "s", der
  // aldrig kan blive en ugedag. Fejlen er TAVS.
  assert.ok(parse.tolkGentagelse('every 2 weeks on friday', NU), 'alternationen maa ikke spise s-et');
  assert.equal(parse.tolkGentagelse('every 2 weeks on vroevl', NU), null);

  // De gamle former skal stadig virke uaendret.
  assert.deepEqual(parse.tolkGentagelse('every friday', NU).weekdays, [5]);
  assert.equal(parse.tolkGentagelse('every 3 days', NU).freq, 'day');
  assert.equal(parse.tolkGentagelse('every month on the 20th', NU).monthday, 20);
});

test('naeste forekomst respekterer interval OG ugedag', () => {
  const regel = parse.tolkGentagelse('every 2 weeks on friday', NU);
  // NU er tirsdag 18/8-2026. Fredag i denne uge er den 21.; med interval 2
  // regnet fra ankeruge skal den ramme en fredag hver anden uge.
  const foerste = parse.naesteForekomst(regel, '2026-08-18');
  assert.match(foerste, /^2026-08-(21|28)$/);
  const naeste = parse.naesteForekomst(regel, foerste);
  const dage = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  assert.equal(dage(foerste, naeste), 14, 'to uger frem, ikke én');
});
