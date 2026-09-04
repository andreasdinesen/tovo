/* app/kilde.js - serveren henter sin egen kode ved opstart.
 *
 * Alt herinde koerer UDEN net. `nyesteTag()` tager sin hente-funktion som
 * argument netop for det: GitHubs svar sprojtes ind, ogsaa de forkerte.
 *
 * Den vigtigste egenskab kan ikke ses i en enkelt assertion, saa den staar
 * her: **en fejl maa aldrig kunne forhindre serveren i at starte.** tovo er
 * flerbruger - en netvaerksfejl paa Hjorten maa ikke kunne tage dagen fra
 * flere mennesker paa en gang.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const kilde = require('../app/kilde.js');

/* ------------------------------------------------------------ KODE_VERSION */

test('tom KODE_VERSION betyder nyeste - ikke en fejl', () => {
  // Standarden for "goer det normale" skal vaere ingenting.
  assert.deepEqual(kilde.oensket(''), { laast: false, tekst: 'seneste' });
  assert.deepEqual(kilde.oensket('  '), { laast: false, tekst: 'seneste' });
});

test('et tal laaser, ordene godtages stadig', () => {
  assert.equal(kilde.oensket('22').laast, true);
  assert.equal(kilde.oensket('22').version, 22);
  assert.equal(kilde.oensket('seneste').laast, false);
  assert.equal(kilde.oensket('latest').laast, false);
});

test('noget, der ikke er et tal, afvises HOEJLYDT - ikke tolkes', () => {
  // "v22" og "22.1" ser rigtige ud. Blev de tolkt, ville tovo goere noget
  // andet end det, der stod i panelet - uden at sige det.
  for (const daarlig of ['v22', '22.1', 'nyeste', '-1']) {
    const r = kilde.oensket(daarlig);
    assert.equal(r.laast, false, daarlig);
    assert.ok(r.fejl, `${daarlig} burde give en advarsel`);
  }
});

/* --------------------------------------------------------------- tag-listen */

test('v9 staar efter v80 alfabetisk - der SKAL regnes paa hele listen', async () => {
  /* Den faelde, doda meldte: tager man liste[0] fra GitHub, ruller hver
     server tilbage til v9 ved naeste genstart. GitHub sorterer ikke tags
     numerisk. tovo er paa v23 og er forbi, hvor det bider - men listen her
     er sorteret praecis som GitHub ville goere det. */
  const svar = [{ name: 'v9' }, { name: 'v8' }, { name: 'v23' }, { name: 'v22' },
    { name: 'v10' }, { name: 'v1' }];
  assert.equal(await kilde.nyesteTag(async () => svar), 23);
});

test('der bladres, til en side ikke er fuld', async () => {
  const side1 = Array.from({ length: 100 }, (_, i) => ({ name: `v${i + 1}` }));
  const side2 = [{ name: 'v140' }, { name: 'v101' }];
  const sider = [side1, side2];
  let kald = 0;
  const hent = async () => sider[kald++] || [];
  assert.equal(await kilde.nyesteTag(hent), 140);
  assert.equal(kald, 2, 'skulle hente praecis to sider');
});

test('en liste uden vN-tag er en fejl, ikke et gaet', async () => {
  await assert.rejects(() => kilde.nyesteTag(async () => [{ name: 'udgivelse-3' }]));
});

/* ------------------------------------------------------------ hvad ligger der */

function lavApp(felter = {}) {
  const rod = mkdtempSync(join(tmpdir(), 'tovo-kilde-'));
  const app = join(rod, 'app');
  mkdirSync(join(app, 'public'), { recursive: true });
  mkdirSync(join(app, 'shared'), { recursive: true });
  for (const [sti, indhold] of Object.entries(felter)) {
    writeFileSync(join(app, sti), indhold);
  }
  return { rod, app };
}

test('uden maerke laeses versionen ud af index.html', () => {
  /* Uden det fallback ville hver eksisterende server hente koden igen ved
     foerste genstart - ogsaa naar den allerede var den rigtige. Ingen server,
     der er installeret FOER v23, har et maerke. */
  const { rod, app } = lavApp({ 'public/index.html': '<script src="app.js?v=21"></script>' });
  assert.equal(kilde.installeret(app).version, 21);
  assert.equal(kilde.installeret(app).kilde, 'install');
  rmSync(rod, { recursive: true, force: true });
});

test('maerket vinder over index.html', () => {
  const { rod, app } = lavApp({
    'public/index.html': '<script src="app.js?v=21"></script>',
    '.kode-version': JSON.stringify({ version: 23, kilde: 'github' }),
  });
  assert.equal(kilde.installeret(app).version, 23);
  rmSync(rod, { recursive: true, force: true });
});

test('ingen app er ikke et nedbrud - der er bare intet at sammenligne med', () => {
  const { rod, app } = lavApp({});
  assert.equal(kilde.installeret(app), null);
  rmSync(rod, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ traeet */

/* Alle de moduler, tovos server.js require'r ved indlaesning. Mangler ét,
   doer serveren med MODULE_NOT_FOUND ved opstart. */
const HEL_APP = {
  'server.js': '', 'public/app.js': '', 'shared/parse.js': '',
  'shared/beregn.js': '', 'shared/planner.js': '', 'oauth.js': '',
  'mcp.js': '', 'webauthn.js': '', 'sagu.js': '', 'totp.js': '', 'qr.js': '',
};

test('en hel app med det rigtige stempel godtages', () => {
  const { rod, app } = lavApp({
    ...HEL_APP, 'public/index.html': '<script src="app.js?v=23"></script>',
  });
  assert.doesNotThrow(() => kilde.tjekTrae(app, 23));
  rmSync(rod, { recursive: true, force: true });
});

test('mangler ET af de moduler, server.js require\'r, byttes der ikke', () => {
  /* Den fejl, en blind kopi af dodas kortere liste ville lade passere:
     traeet ser komplet ud, og serveren doer foerst ved opstart. */
  for (const udeladt of ['totp.js', 'qr.js', 'sagu.js', 'mcp.js', 'oauth.js',
    'webauthn.js', 'shared/beregn.js', 'shared/planner.js']) {
    const felter = { ...HEL_APP, 'public/index.html': '<script src="app.js?v=23"></script>' };
    delete felter[udeladt];
    const { rod, app } = lavApp(felter);
    assert.throws(() => kilde.tjekTrae(app, 23), new RegExp(udeladt.replace('.', '\\.')),
      `${udeladt} manglede, men traeet blev godtaget`);
    rmSync(rod, { recursive: true, force: true });
  }
});

test('en tag, der baerer et ANDET versionsstempel, byttes ikke ind', () => {
  /* Er en tag flyttet oven paa en anden commit, er koden ikke det, den
     udgiver sig for. Hellere koere videre paa det kendte end at starte noget,
     ingen kan navngive. */
  const { rod, app } = lavApp({
    ...HEL_APP, 'public/index.html': '<script src="app.js?v=19"></script>',
  });
  assert.throws(() => kilde.tjekTrae(app, 23), /v23 indeholder kode stemplet v19/);
  rmSync(rod, { recursive: true, force: true });
});

test('en index.html uden versionsstempel godtages ikke', () => {
  const { rod, app } = lavApp({ ...HEL_APP, 'public/index.html': '<html></html>' });
  assert.throws(() => kilde.tjekTrae(app, 23), /intet versionsstempel/);
  rmSync(rod, { recursive: true, force: true });
});
