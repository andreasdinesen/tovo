/* Forventede timer pr. dag - og hvor meget af dagen der er gaaet.
 *
 * DAGEN er tallet; ugen regnes af den (dag x 5). Foer laa sandheden i en
 * ugenorm, som blev delt med 5 - to tal, der kunne pege hver sin vej.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const beregn = require('../app/shared/beregn.js');

const ISO = '2026-09-11';                       // en fredag
const kl = (t, m = 0) => Math.floor(new Date(2026, 8, 11, t, m, 0).getTime() / 1000);

function lav({ dag = 7.4, fra = '08:00', til = '16:00', poster = [] } = {}) {
  return beregn.opret({
    items: () => [],
    entries: () => poster,
    settings: () => ({ expectedDayHours: dag, workdayStart: fra, workdayEnd: til }),
  });
}
/** En post paa ISO-dagen, `min` minutter lang. */
const post = (startTime, min) => ({ id: 'e', taskId: 't', startedAt: startTime, stoppedAt: startTime + min * 60 });

test('forventningen er dagens timer - i minutter', () => {
  assert.equal(lav({ dag: 7.4 }).dagsstatus(ISO, kl(12)).forventet, 444);
  assert.equal(lav({ dag: 8 }).dagsstatus(ISO, kl(12)).forventet, 480);
});

test('foer arbejdsdagen er intet forfaldent - ellers er man bagud hver morgen', () => {
  const d = lav().dagsstatus(ISO, kl(6));
  assert.equal(d.andelGaaet, 0);
  assert.equal(d.forventetNu, 0);
  assert.equal(d.diffNu, 0, 'kl. 6 er man hverken foran eller bagud');
});

test('midt paa dagen er halvdelen forfalden', () => {
  const d = lav().dagsstatus(ISO, kl(12));
  assert.equal(d.andelGaaet, 0.5);
  assert.equal(d.forventetNu, 222);
});

test('efter fyraften er hele dagen forfalden - og ikke mere', () => {
  for (const t of [16, 20, 23]) {
    const d = lav().dagsstatus(ISO, kl(t));
    assert.equal(d.andelGaaet, 1, `kl. ${t}`);
    assert.equal(d.forventetNu, d.forventet, `kl. ${t}`);
  }
});

test('registreret tid holdes op mod BEGGE tal', () => {
  // 3 timer registreret kl. 12, hvor 3,7 t er forfaldent af 7,4 t.
  const b = lav({ poster: [post(kl(9), 180)] });
  const d = b.dagsstatus(ISO, kl(12));
  assert.equal(d.registreret, 180);
  assert.equal(d.diffNu, 180 - 222, 'stillingen NU');
  assert.equal(d.diffDag, 180 - 444, 'hele dagens regnskab');
  assert.equal(d.rest, 264, 'hvad der mangler for at naa dagen');
});

test('resten bliver aldrig negativ', () => {
  // Mere end dagens forventning: »minus en time tilbage« er ikke en rest.
  const b = lav({ poster: [post(kl(8), 600)] });
  assert.equal(b.dagsstatus(ISO, kl(20)).rest, 0);
  assert.ok(b.dagsstatus(ISO, kl(20)).diffDag > 0, 'men man er foran');
});

test('et vindue uden laengde tager ikke dagsvisningen med sig', () => {
  /*
   * Start LIG slut, paa selve slaget: `(nu - fra) / 0` er 0/0 = NaN, og NaN
   * overlever baade Math.max og Math.min. Hele dagskortet ville vise "NaN".
   *
   * Foerste udgave af den her proeve brugte et OMVENDT vindue (16-08) - men
   * negativ divideret med negativ er et paent tal, saa den bestod ogsaa uden
   * vaernet og maalte ingenting. Sabotagen afsloerede det.
   */
  const d = lav({ fra: '08:00', til: '08:00' }).dagsstatus(ISO, kl(8));
  assert.ok(Number.isFinite(d.andelGaaet), `andelGaaet blev ${d.andelGaaet}`);
  assert.ok(Number.isFinite(d.forventetNu), `forventetNu blev ${d.forventetNu}`);
  assert.ok(Number.isFinite(d.diffNu), `diffNu blev ${d.diffNu}`);

  // Og et omvendt vindue skal ogsaa svare - bare ikke med NaN.
  const o = lav({ fra: '16:00', til: '08:00' }).dagsstatus(ISO, kl(12));
  assert.ok(Number.isFinite(o.andelGaaet));
});

test('ugenormen REGNES af dagen - den er ikke sit eget tal', () => {
  const uge = (dag) => {
    const fra = Math.floor(new Date(2026, 8, 7).getTime() / 1000);   // mandag
    return lav({ dag }).ugerapport(fra, fra + 7 * 86400, kl(23));
  };
  assert.equal(uge(7.4).norm, 444 * 5);
  assert.equal(uge(8).norm, 480 * 5);
  // Nul forventning = ingen sammenligning, ikke en division med nul.
  assert.equal(uge(0).norm, 0);
  assert.equal(uge(0).overNorm, null);
});

test('midt i ugen maales mod det FORFALDNE - ikke mod hele ugen', () => {
  /* Ellers er man 17 timer bagud hver tirsdag, og saa holder man op med at
     kigge paa tallet. */
  const fra = Math.floor(new Date(2026, 8, 7).getTime() / 1000);      // mandag
  const r = lav().ugerapport(fra, fra + 7 * 86400, kl(12));           // fredag kl. 12
  // Man-tors er passeret (4 x 444) + halvdelen af fredag (222).
  assert.equal(r.normTilNu, 4 * 444 + 222);
  assert.ok(r.normTilNu < r.norm, 'ugen er ikke forbi');
});

test('naar perioden er ovre, er de to sammenligninger den samme', () => {
  const fra = Math.floor(new Date(2026, 8, 7).getTime() / 1000);
  const efter = Math.floor(new Date(2026, 8, 20).getTime() / 1000);   // ugen efter
  const r = lav().ugerapport(fra, fra + 7 * 86400, efter);
  assert.equal(r.normTilNu, r.norm);
  assert.equal(r.overNormTilNu, r.overNorm);
});

test('weekender forventer intet', () => {
  const fra = Math.floor(new Date(2026, 8, 7).getTime() / 1000);
  const r = lav().ugerapport(fra, fra + 7 * 86400, kl(23));
  const lør = r.days.find((d) => d.weekday === 6);
  const man = r.days.find((d) => d.weekday === 1);
  assert.equal(lør.norm, 0, 'en tom loerdag skal ikke skulle forklares');
  assert.equal(man.norm, 444);
});
