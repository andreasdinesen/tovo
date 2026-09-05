/* Panelets »Opdater tovo«-script - koert, ikke laest.
 *
 * Scriptet HIVES UD AF DEN UDGIVNE YAML og koeres mod en lokal arkivserver.
 * En afskrift ville bevise, at afskriften er rigtig; det er runen, panelet
 * laeser.
 *
 * Baggrund: Sagu laa nede i ti timer paa tre fejl i netop den her vej -
 * fast /tmp-sti delt mellem samtidige koersler, `rm -rf app` foer `mv`, og
 * `mv` fra /tmp som er en KOPI over to filsystemer. tovo havde alle tre, plus
 * en fjerde: startsnoren blev hentet ubetinget FOER kilde.js-grenen, saa hvert
 * tryk paa knappen nedgraderede appen og hentede den saa frem igen.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));

/* YAML'en laeses med den samme PyYAML, build'et skriver den med. */
function scriptFraRunen(blok) {
  return execFileSync('python3', ['-c',
    `import yaml,sys; sys.stdout.write(yaml.safe_load(open("${join(rod, 'runes/tovo.yaml')}"))["gameskill"]["${blok}"]["script"])`,
  ], { encoding: 'utf8' });
}

let srv;
let port;
let forsink = 0;      // ms, til samtidighedsproeven
let kald = 0;         // hvor mange gange arkivet blev hentet
let svarKode = 200;
let arkiv;

before(async () => {
  /* Et arkiv som GitHubs: <repo>-<ref>/app/... plus en fil, der IKKE findes i
     den gamle app - saa vi kan se, at der faktisk blev byttet. */
  const b = mkdtempSync(join(tmpdir(), 'tovo-arkiv-'));
  mkdirSync(join(b, 'tovo-23/app/public'), { recursive: true });
  writeFileSync(join(b, 'tovo-23/app/server.js'), '// ny server\n');
  writeFileSync(join(b, 'tovo-23/app/kilde.js'), '// ny kilde\n');
  writeFileSync(join(b, 'tovo-23/app/public/index.html'), '<script src="app.js?v=23">');
  execFileSync('tar', ['czf', join(b, 'a.tar.gz'), '-C', b, 'tovo-23']);
  arkiv = readFileSync(join(b, 'a.tar.gz'));
  rmSync(b, { recursive: true, force: true });

  srv = createServer((req, res) => {
    kald += 1;
    const send = () => {
      if (svarKode !== 200) { res.writeHead(svarKode); res.end('nej'); return; }
      res.writeHead(200, { 'content-type': 'application/gzip' });
      res.end(arkiv);
    };
    if (forsink) setTimeout(send, forsink); else send();
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  port = srv.address().port;
});

after(() => srv.close());

/* Scriptet peger paa codeload over https. Til proeven skiftes PRAECIS to ting:
   modulet og adressen. Alt andet - laasen, raekkefoelgen, omdoebningerne - er
   runens egne linjer. */
function lokalt(script) {
  return script
    .replace('require("https")', 'require("http")')
    .replace(/https:\/\/codeload\.github\.com\/\S+?"/, `http://127.0.0.1:${port}/a.tar.gz"`);
}

function nyArbejdsmappe({ medKilde }) {
  const d = mkdtempSync(join(tmpdir(), 'tovo-opd-'));
  mkdirSync(join(d, 'app/public'), { recursive: true });
  writeFileSync(join(d, 'app/server.js'), '// GAMMEL server\n');
  writeFileSync(join(d, 'app/gammel-fil.js'), '// findes ikke i den nye udgave\n');
  if (medKilde) writeFileSync(join(d, 'app/kilde.js'), 'process.exit(0);\n');
  return d;
}

function koer(script, cwd) {
  return new Promise((ok) => {
    const p = spawn('sh', ['-c', script], { cwd, encoding: 'utf8' });
    let ud = '';
    p.stdout.on('data', (d) => { ud += d; });
    p.stderr.on('data', (d) => { ud += d; });
    p.on('close', (kode) => ok({ kode, ud }));
  });
}

/* ------------------------------------------------------ raekkefoelgen */

test('kilde.js-grenen tages FOERST - startsnoren hentes ikke', async () => {
  /* Fejlen i v23: startsnoren blev hentet ubetinget foer forgreningen, saa
     hvert tryk nedgraderede appen til runens tag og hentede den frem igen.
     Slog nettet fejl i andet trin, blev appen liggende paa den gamle udgave.
     Dommen er derfor: arkivserveren maa ikke faa ET eneste kald. */
  const d = nyArbejdsmappe({ medKilde: true });
  kald = 0;
  const r = await koer(lokalt(scriptFraRunen('update')), d);
  assert.equal(r.kode, 0, r.ud);
  assert.equal(kald, 0, 'startsnoren blev hentet - appen blev nedgraderet');
  assert.match(readFileSync(join(d, 'app/server.js'), 'utf8'), /GAMMEL/,
    'app/ blev byttet, selv om kilde.js skulle klare det');
  rmSync(d, { recursive: true, force: true });
});

/* ------------------------------------------------------- else-grenen */

test('uden kilde.js hentes startsnoren - og app/ er hel bagefter', async () => {
  const d = nyArbejdsmappe({ medKilde: false });
  kald = 0; svarKode = 200;
  const r = await koer(lokalt(scriptFraRunen('update')), d);
  assert.equal(r.kode, 0, r.ud);
  assert.equal(kald, 1);
  assert.match(readFileSync(join(d, 'app/server.js'), 'utf8'), /ny server/);
  assert.ok(existsSync(join(d, 'app/kilde.js')), 'kilde.js kom med');
  rmSync(d, { recursive: true, force: true });
});

test('filer, der er slettet i den nye udgave, bliver ikke liggende', () => {
  /* Det, `rm -rf app` var der for (Beanledger v30). At FLYTTE hele den gamle
     app vaek loeser det samme uden at efterlade et vindue uden app/. */
  const d = nyArbejdsmappe({ medKilde: false });
  return koer(lokalt(scriptFraRunen('update')), d).then((r) => {
    assert.equal(r.kode, 0, r.ud);
    assert.ok(!existsSync(join(d, 'app/gammel-fil.js')),
      'en fil fra den gamle udgave overlevede byttet');
    rmSync(d, { recursive: true, force: true });
  });
});

test('intet efterlades i arbejdsmappen', async () => {
  const d = nyArbejdsmappe({ medKilde: false });
  await koer(lokalt(scriptFraRunen('update')), d);
  assert.deepEqual(readdirSync(d).filter((n) => n !== 'app'), [],
    'der laa rester tilbage');
  rmSync(d, { recursive: true, force: true });
});

/* ------------------------------------------------------------- laasen */

test('to samtidige koersler: praecis EEN kommer igennem', async () => {
  /* Uden forsinkelsen bestaar proeven ved et tilfaelde, naar hentningen er
     hurtig nok: den foerste er faerdig, foer den anden begynder. */
  const d = nyArbejdsmappe({ medKilde: false });
  kald = 0; svarKode = 200; forsink = 400;
  const script = lokalt(scriptFraRunen('update'));
  const [a, b] = await Promise.all([koer(script, d), koer(script, d)]);
  forsink = 0;

  const ok = [a, b].filter((r) => r.kode === 0);
  const nej = [a, b].filter((r) => r.kode !== 0);
  assert.equal(ok.length, 1, `begge kom igennem:\n${a.ud}\n---\n${b.ud}`);
  assert.equal(nej.length, 1);
  assert.match(nej[0].ud, /en anden opdatering er allerede i gang/);
  // Og appen er hel bagefter - ikke halvt byttet.
  assert.match(readFileSync(join(d, 'app/server.js'), 'utf8'), /ny server/);
  assert.ok(!existsSync(join(d, '.tovo-laas')), 'laasen blev ikke frigivet');
  rmSync(d, { recursive: true, force: true });
});

test('en fejlet hentning frigiver laasen - knappen maa ikke doe', async () => {
  /* Nettet blinker, eller taggen mangler. Det er den ALMINDELIGE fejl, og en
     laas, der overlever den, goer knappen doed for altid. */
  const d = nyArbejdsmappe({ medKilde: false });
  svarKode = 500;
  const r = await koer(lokalt(scriptFraRunen('update')), d);
  svarKode = 200;
  assert.notEqual(r.kode, 0, 'en 500 burde faelde scriptet');
  assert.ok(!existsSync(join(d, '.tovo-laas')), 'laasen blev liggende');
  // Og den gamle app staar der endnu - vi bytter aldrig til noget halvt.
  assert.match(readFileSync(join(d, 'app/server.js'), 'utf8'), /GAMMEL/);
  rmSync(d, { recursive: true, force: true });
});

/* ------------------------------------------------------------ beskeden */

test('scriptet siger til sidst, at serveren skal genstartes', async () => {
  /* Panelets app-update skifter FILER og genstarter ikke. Sagu koerte ti timer
     paa gammel kode oven paa nye filer, fordi ingen sagde det. */
  const d = nyArbejdsmappe({ medKilde: false });
  const r = await koer(lokalt(scriptFraRunen('update')), d);
  const linjer = r.ud.trimEnd().split('\n');
  assert.match(r.ud, /GENSTART TOVO NU\./);
  assert.equal(linjer[linjer.length - 1], '============================================',
    'beskeden stod ikke sidst - den druknede i det, der kom bagefter');
  rmSync(d, { recursive: true, force: true });
});

test('startup rydder en strandet laas', () => {
  // `trap` naar ikke at koere ved et haardt drab.
  const s = scriptFraRunen('update');
  assert.ok(s.includes("trap 'rm -rf .tovo-laas"), 'ingen trap');
  const start = execFileSync('python3', ['-c',
    `import yaml,sys; sys.stdout.write(yaml.safe_load(open("${join(rod, 'runes/tovo.yaml')}"))["gameskill"]["startup"]["command"])`,
  ], { encoding: 'utf8' });
  assert.match(start, /if \[ -d \.tovo-laas \]/);
});
