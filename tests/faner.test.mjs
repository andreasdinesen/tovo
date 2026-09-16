/* Fanerne i indstillingerne (RUNE-ERFARINGER §9f).
 *
 * Opdelingen flyttede femten afsnit rundt i én stor skabelon, og en blok, der
 * ryger ved et uheld, ser ud som ingenting. Proeven koerer den RIGTIGE
 * `settingsHtml()` fra den byggede flade og taeller afsnit og id'er mod det,
 * siden havde FOER fanerne (maalt paa v30). Og `visFane()` koeres mod en lille
 * DOM-attrap: fald tilbage, husk valget, skjul resten.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const app = readFileSync(join(rod, 'app/public/app.js'), 'utf8');
const guide = readFileSync(join(rod, 'app/parts/pd_guide.js'), 'utf8');
const ruter = (await import('node:module')).createRequire(import.meta.url)('../app/shared/ruter.js');

function hent(navn) {
  const m = app.match(new RegExp(`^(?:async )?function ${navn}\\([\\s\\S]*?^}$`, 'm'));
  assert.ok(m, `${navn}() findes ikke i den byggede flade`);
  return m[0];
}

/* Siden foer fanerne: 15 overskrifter og 24 id'er (med en forbundet app og
   som administrator - saa er alle de betingede afsnit med). */
const AFSNIT_FOER = ['What you can set here', 'Capture syntax', 'Your working day', 'Appearance',
  'Account', 'Claude and other clients', 'Access keys', 'Connected apps', 'Calendar',
  'Two-factor', 'Passkeys', 'Sagu', 'Case numbers', 'Your data', 'This server'];
const IDER_FOER = ['dagForm', 'dagSlut', 'dagStart', 'dagTimer', 'dataEksport', 'dataToggl',
  'icalAlarm', 'icalCopy', 'icalCreate', 'icalRevoke', 'icalUrl', 'keyAdd', 'keyName',
  'keyScope', 'mcpCopy', 'mcpUrl', 'pkAdd', 'pwCur', 'pwForm', 'pwNew', 'saguKort',
  'setCaseUrl', 'setReg', 'totpKort'];

async function tegn(isAdmin, feed) {
  const state = { user: { username: 'eksempel', isAdmin }, settings: {}, config: {}, today: '2026-09-16', dayStatus: null };
  const svar = {
    '/api/v1/passkeys': { credentials: [{ id: 'p1', name: 'Nøgle' }], blocked: null },
    '/api/v1/ical': { feed: feed ? { url: 'https://eksempel.invalid/ical/x.ics' } : null, alarm: 15 },
    '/api/v1/keys': { keys: [{ id: 'k1', name: 'CLI', scope: 'full', prefix: 'ab' }],
      connections: [{ id: 'c1', name: 'Claude' }], mcpUrl: 'https://eksempel.invalid/mcp' },
  };
  const fn = new Function('state', 'api', 'nuvaerendeTema', 'BESKRIVELSER', `
    ${hent('esc')}\n${hent('visTidspunkt')}\n${hent('dagTimerNu')}\n${hent('vindueNu')}
    ${hent('settingsHtml')}\nreturn settingsHtml;`)(
    state, async (_m, sti) => svar[sti], () => 'auto', { settings: 'x' });
  return fn();
}

/* Et groft, men tilstraekkeligt, blik paa strukturen: hvilken fane staar hver overskrift i? */
function struktur(html) {
  const ud = { afsnit: [], ider: new Set(), faner: [], knapper: [], udenFane: [] };
  let dybde = 0;
  let fane = null;
  let faneDybde = -1;
  for (const m of html.matchAll(/<(\/?)(div|h2)\b([^>]*)>([^<]*)/g)) {
    const [, luk, tag, attr, tekst] = m;
    if (tag === 'div') {
      if (luk) { dybde -= 1; if (dybde === faneDybde) { fane = null; faneDybde = -1; } continue; }
      const f = attr.match(/class="fane" data-fane="(\w+)"/);
      if (f) { assert.equal(fane, null, 'en fane inde i en fane'); fane = f[1]; faneDybde = dybde; ud.faner.push(fane); }
      dybde += 1;
    } else if (!luk) {
      ud.afsnit.push(tekst.trim());
      if (!fane) ud.udenFane.push(tekst.trim());
    }
  }
  assert.equal(dybde, 0, 'div-tags gaar ikke op');
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) ud.ider.add(m[1]);
  for (const m of html.matchAll(/class="fanebtn"[^>]*data-fane="(\w+)"/g)) ud.knapper.push(m[1]);
  return ud;
}

test('intet afsnit og intet id faldt ud ved opdelingen', async () => {
  const a = struktur(await tegn(true, false));
  const b = struktur(await tegn(true, true));
  assert.deepEqual(a.afsnit, a.afsnit.filter((x) => AFSNIT_FOER.includes(x)));
  assert.deepEqual([...new Set(a.afsnit)].sort(), [...AFSNIT_FOER].sort());
  assert.deepEqual([...new Set([...a.ider, ...b.ider])].sort(), IDER_FOER);
});

test('hvert afsnit staar i en fane, og hver fane har en knap', async () => {
  const s = struktur(await tegn(true, true));
  assert.deepEqual(s.udenFane, ['What you can set here'], 'kun indgangen staar over fanerne');
  assert.deepEqual(s.faner, ['general', 'account', 'connections', 'data', 'server']);
  assert.deepEqual(s.knapper, s.faner);
  // Og ruteren kender dem alle, saa /settings/<fane> ikke giver 404.
  assert.deepEqual(ruter.FANER, s.faner);
});

test('en almindelig bruger ser hverken server-fanen eller dens knap', async () => {
  const s = struktur(await tegn(false, true));
  assert.ok(!s.faner.includes('server'));
  assert.ok(!s.knapper.includes('server'));
  assert.ok(!s.ider.has('setReg'));
});

test('gem-knappen i »Your working day« samler kun felter fra sin egen fane', async () => {
  const html = await tegn(true, true);
  const general = html.slice(html.indexOf('class="fane" data-fane="general"'), html.indexOf('class="fane" data-fane="account"'));
  for (const id of ['dagForm', 'dagTimer', 'dagStart', 'dagSlut']) assert.ok(general.includes(`id="${id}"`), id);
  // Én gem-knap pr. formular - ingen knap, der gemmer paa tvaers.
  assert.equal((html.match(/type="submit"/g) || []).length, 2);
});

/* ── visFane() mod en DOM-attrap ─────────────────────────────────────────── */
function attrap(faner, gemt) {
  const el = (fane) => ({
    dataset: { fane }, hidden: false, attr: {},
    klasser: new Set(),
    classList: { toggle(k, paa) { this.ejer.klasser[paa ? 'add' : 'delete'](k); } },
    setAttribute(k, v) { this.attr[k] = v; },
  });
  const sider = faner.map(el);
  const knapper = faner.map(el);
  for (const x of [...sider, ...knapper]) x.classList.ejer = x;
  const lager = { tovo_settings_fane: gemt };
  const kald = { top: 0, synk: [] };
  const dok = { querySelectorAll: (q) => (q.endsWith('.fanebtn') ? knapper : sider) };
  const ls = { getItem: (k) => lager[k] ?? null, setItem: (k, v) => { lager[k] = v; } };
  const state = { settingsFane: null };
  const visFane = new Function('document', 'localStorage', 'state', 'synkAdresse', 'tilToppen', `
    const FANE_NOEGLE = 'tovo_settings_fane';\n${hent('visFane')}\nreturn visFane;`)(
    dok, ls, state, (e) => kald.synk.push(e), () => { kald.top += 1; });
  return { visFane, sider, knapper, lager, kald, state };
}

test('visFane viser én, husker den, og retter adressen uden et nyt skridt', () => {
  const t = attrap(['general', 'account', 'data'], null);
  t.visFane('account', true);
  assert.deepEqual(t.sider.map((x) => x.hidden), [true, false, true]);
  assert.deepEqual(t.knapper.map((x) => x.klasser.has('on')), [false, true, false]);
  assert.equal(t.knapper[1].attr['aria-selected'], 'true');
  assert.equal(t.lager.tovo_settings_fane, 'account');
  assert.equal(t.state.settingsFane, 'account');
  assert.deepEqual(t.kald.synk, [true], 'et faneskift ERSTATTER adressen');
  assert.equal(t.kald.top, 1, 'til toppen ved faneskift');
});

test('en gemt fane, brugeren ikke har, falder tilbage til den foerste', () => {
  const t = attrap(['general', 'account'], 'server');
  t.visFane('server');
  assert.deepEqual(t.sider.map((x) => x.hidden), [false, true], 'ellers staar siden tom');
  assert.equal(t.state.settingsFane, 'general');
  assert.equal(t.kald.top, 0, 'foerste optegning ruller ikke');
});

test('guidens genveje til indstillingerne vaelger en fane, der findes', () => {
  const maal = [...guide.matchAll(/\['settings(?:\/(\w+))?', 'Open Settings'\]/g)];
  assert.ok(maal.length >= 3, 'moensteret fandt ingen genveje');
  for (const m of maal) assert.ok(ruter.FANER.includes(m[1]), `genvej uden fane: ${m[0]}`);
});
