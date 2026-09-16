/* Vagter paa den byggede flade.
 *
 * Nogle fejl kan ikke fanges af en enhedstest, fordi de ikke er logik: de er
 * et forkert kaldsted eller et navn, der ikke findes. De lever kun i den
 * samlede `app/public/app.js`, og de viser sig foerst i en browser - ofte kun
 * paa en telefon. Vagterne her laeser den byggede fil som tekst.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const app = readFileSync(join(rod, 'app/public/app.js'), 'utf8');

/*
 * Under mobilgraensen er BODY rullekassen - `html, body { height: 100% }`
 * plus `overflow-x: hidden` i @media goer den til det. Saa gaar
 * `window.scrollTo()` ingen steder, og brugeren bliver staaende i den gamle
 * rulleposition, naar han skifter side.
 *
 * `tilToppen()` saetter alle tre. Vagten her siger fra, hvis nogen skriver
 * det bare `window.scrollTo` tilbage - fejlen er tavs, og den er fundet to
 * gange nu: doda v61, og her.
 */
test('ingen bar window.scrollTo uden for tilToppen()', () => {
  const linjer = app.split('\n');
  const start = linjer.findIndex((l) => l.includes('function tilToppen()'));
  assert.ok(start > -1, 'tilToppen() findes ikke i den byggede flade');

  const syndere = [];
  linjer.forEach((linje, i) => {
    if (!linje.includes('window.scrollTo(')) return;
    // De tre linjer inde i selve hjaelperen er dem, der SKAL vaere der.
    if (i > start && i <= start + 4) return;
    if (linje.trim().startsWith('*')) return;   // omtale i en kommentar
    syndere.push(`linje ${i + 1}: ${linje.trim()}`);
  });

  assert.deepEqual(syndere, [],
    'brug tilToppen() - window.scrollTo() rammer ikke BODY paa mobil');
});

/* ── Den klaebende bjaelke maa ikke kunne komme i svingninger ────────────────
 *
 * Bjaelken ligger i FLOW, saa naar den folder sig sammen, bliver dokumentet
 * kortere med praecis det, den krymper. Er der mindre tilbage at rulle i end
 * det, klipper browseren rullepositionen - og hvis den dermed havner under
 * taersklen, folder bjaelken sig ud igen, dokumentet vokser, og forfra. Det
 * er den flimren, doda meldte ("som om den gaar i hak").
 *
 * Vi proever ikke taersklerne hver for sig, men EGENSKABEN: uanset sidens
 * hoejde og hvor meget bjaelken krymper, skal tilstanden falde til ro.
 */
const blok = app.match(/\/\* <<rullelogik>>[\s\S]*?\/\* <<\/rullelogik>> \*\//);
const logik = new Function(`${blok ? blok[0] : ''}
  return { skalFoldes, RULLET_TIL, RULLET_FRA, RULLET_PLADS };`)();

/*
 * Browserens opfoersel - og den ene detalje, der er hele fejlen.
 *
 * Foerste udgave af denne model klippede `y` PERMANENT ned ved hver runde.
 * Saa faldt alt til ro af sig selv, og testen bestod ogsaa paa den gamle,
 * fejlbehaeftede logik. Den maalte ingenting.
 *
 * I en browser bliver positionen GENSKABT, naar dokumentet vokser igen -
 * enten af scroll-anchoring eller af en finger, der stadig ruller. Derfor er
 * `yOensket` fast, og klipningen regnes forfra hver runde. Det er dén
 * drivkraft, der goer svingningen mulig.
 */
function koerTilRo(docAaben, krymper, vh, yOensket) {
  let rullet = false;
  for (let i = 0; i < 50; i++) {
    const plads = Math.max(0, (rullet ? docAaben - krymper : docAaben) - vh);
    const y = Math.min(yOensket, plads);
    const naeste = logik.skalFoldes(rullet, y, plads);
    if (naeste === rullet) return { rullet, y, skift: i };
    rullet = naeste;
  }
  return null;   // naaede aldrig ro = svingninger
}

test('bjaelken falder til ro paa enhver sidehoejde', () => {
  const vh = 812;
  const urolige = [];
  // Bjaelken krymper 20-80 px; sider fra tomme til meget lange.
  for (let krymper = 20; krymper <= 80; krymper += 5) {
    for (let doc = vh; doc <= vh + 1200; doc += 7) {
      for (const startY of [0, 5, 50, 130, 400, 5000]) {
        if (!koerTilRo(doc, krymper, vh, startY)) {
          urolige.push(`doc=${doc} krymper=${krymper} startY=${startY}`);
        }
      }
    }
  }
  assert.deepEqual(urolige.slice(0, 5), [], 'bjaelken svinger');
});

/* Doda-sessionens egen faelde: med to taerskler ALENE foldede bjaelken sig
   aldrig paa en kort side, og maalingen "0 skift, ingen flimmer" lignede en
   sejr. Fejlen var vaek, fordi funktionen var vaek. Derfor ogsaa denne. */
test('paa en lang side folder bjaelken sig faktisk', () => {
  const ro = koerTilRo(4000, 60, 812, 500);
  assert.ok(ro, 'naaede ikke ro');
  assert.equal(ro.rullet, true, 'bjaelken foldede sig ikke paa en lang side');
});

test('paa en kort side folder den sig aldrig - det er forsikringen', () => {
  // 29 px at rulle i: praecis doda-tilfaeldet.
  const ro = koerTilRo(812 + 29, 60, 812, 9999);
  assert.ok(ro, 'naaede ikke ro');
  assert.equal(ro.rullet, false);
});

test('afstanden mellem taersklerne er stoerre end det, bjaelken krymper', () => {
  // Maalt paa doda: 60 px. Er afstanden mindre, kan tilklipningen naa forbi.
  assert.ok(logik.RULLET_TIL - logik.RULLET_FRA > 60,
    `afstanden er kun ${logik.RULLET_TIL - logik.RULLET_FRA} px`);
});

/* ── Filnavne og print ───────────────────────────────────────────────────────
 *
 * Funktionerne hentes UD af den byggede fil og koeres - en afskrift ville
 * kun bevise, at afskriften er rigtig.
 */
function hentFunktion(navn) {
  const m = app.match(new RegExp(`^function ${navn}\\([\\s\\S]*?^}$`, 'm'));
  assert.ok(m, `${navn}() findes ikke i den byggede flade`);
  return m[0];
}
const css = readFileSync(join(rod, 'app/public/style.css'), 'utf8');
const rensFilnavn = new Function(`${hentFunktion('rensFilnavn')}\nreturn rensFilnavn;`)();

test('rensFilnavn beholder é, ü og ø - og fjerner det, et filnavn ikke taaler', () => {
  assert.equal(rensFilnavn('Café Über/Ørken: 1'), 'Café-Über-Ørken-1');
  assert.equal(rensFilnavn('tovo-report-2026-09-14'), 'tovo-report-2026-09-14', 'datoen skal staa urort');
  assert.equal(rensFilnavn(null), '');
});

/*
 * PDF-titlen er browserens forslag til filnavn. Et projektnavn med `/` eller
 * `:` gik lige igennem til document.title (kundevisningen og ugerapporten),
 * mens .xlsx og .ics blev renset. Proeven koerer den RIGTIGE printArk() med
 * en DOM-stub og ser, hvad der landede i titlen.
 */
test('printArk renser titlen - uanset hvilken kalder der glemte det', () => {
  const dok = {
    title: 'tovo',
    body: { appendChild() {} },
    getElementById: () => null,
    createElement: () => ({}),
  };
  const vindue = { addEventListener() {}, removeEventListener() {}, print() {} };
  const printArk = new Function('document', 'window', 'setTimeout', 'rensFilnavn',
    `${hentFunktion('printArk')}\nreturn printArk;`)(dok, vindue, () => {}, rensFilnavn);

  printArk('<p></p>', 'tovo-Nordvind/Café: Ü-2026-09-16');
  assert.equal(dok.title, 'tovo-Nordvind-Café-Ü-2026-09-16');
});

/*
 * Ugerapportens projekttabeller skal have de SAMME kolonnekanter. Den
 * egentlige maaling (getBoundingClientRect) kraever en browser; her vogtes
 * de to dele, der tilsammen giver den: den faelles <colgroup> paa HVER
 * projekttabel og `table-layout: fixed` i print-CSS'en.
 */
test('ugerapportens projekttabeller har faelles kolonnebredder og fast layout', () => {
  const kolonner = app.match(/^const PROJEKTTABEL_KOLONNER = .*$/m);
  assert.ok(kolonner, 'PROJEKTTABEL_KOLONNER findes ikke i den byggede flade');
  const rapportArkHtml = new Function('esc', 'rapportDecimal', 'tovoBeregn',
    `${kolonner[0]}\n${hentFunktion('rapportArkHtml')}\nreturn rapportArkHtml;`)(
    (s) => String(s), () => true, { formatDecimal: String, formatVarighed: String });

  const html = rapportArkHtml({
    from: '2026-09-14',
    to: '2026-09-20',
    timesheet: null,
    report: {
      total: 120, onProjects: 120, adhoc: 0, norm: 0,
      projects: [
        { name: 'Nordvind', minutter: 60, tasks: [{ title: 'Kort', estimateMinutes: 30, minutter: 60 }] },
        { name: 'N'.repeat(200), minutter: 60, tasks: [{ title: 'x'.repeat(300), minutter: 60 }] },
      ],
    },
  });
  const tabeller = html.match(/<table[^>]*>\s*<colgroup>.*?<\/colgroup>/g) || [];
  assert.equal(tabeller.length, 2, 'hver projekttabel skal have sin <colgroup>');
  for (const t of tabeller) {
    assert.match(t, /class="projekttabel"/);
    assert.deepEqual(t.match(/width:\s*\d+%/g), ['width:60%', 'width:20%', 'width:20%']);
  }

  const print = css.slice(css.indexOf('@media print'));
  assert.match(print, /\.printsheet table\.projekttabel \{ table-layout: fixed; \}/,
    'uden fast layout regner hver tabel sine egne bredder - colgroup alene er et forslag');
  assert.match(print, /table\.projekttabel td \{ overflow-wrap: break-word; \}/);
});
