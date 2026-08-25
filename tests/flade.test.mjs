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
