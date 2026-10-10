/* Den faelles tastaturregel (doda, tovo, qlk, sagu - 10-10-2026).
 *
 * Tasterne kan ikke proeves gennem browser-panelet (tom `e.key`), saa
 * proeven koerer de RIGTIGE funktioner fra den byggede flade mod en lille
 * attrap: raekkens taster, »paa en raekke«-vaernet og genvejslisten.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const app = readFileSync(join(rod, 'app/public/app.js'), 'utf8');
const guide = readFileSync(join(rod, 'app/parts/pd_guide.js'), 'utf8');

function hent(navn) {
  const m = app.match(new RegExp(`^(?:async )?function ${navn}\\([\\s\\S]*?^}$`, 'm'));
  assert.ok(m, `${navn}() findes ikke i den byggede flade`);
  return m[0];
}

/* En raekke, der kan svare paa closest('[data-keynav] [data-row]'). */
function raekke(id, { timer = true } = {}) {
  const r = {
    dataset: { id }, fokus: 0,
    focus() { this.fokus += 1; },
    closest: (q) => (q === '[data-keynav] [data-row]' ? r : null),
    querySelector: (q) => (q === '[data-start]' && timer ? {} : null),
  };
  return r;
}

function haendelse(key, mod = {}) {
  return {
    key, metaKey: false, ctrlKey: false, altKey: false, ...mod,
    stoppet: 0, forhindret: 0,
    preventDefault() { this.forhindret += 1; }, stopPropagation() { this.stoppet += 1; },
  };
}

function raekkeTastMed(raekker) {
  const kald = [];
  const document = { querySelectorAll: () => raekker };
  const fn = new Function('document', 'kald', `
    const aabnOpgave = (id) => kald.push(['aabn', id]);
    const skiftFaerdig = (id) => kald.push(['faerdig', id]);
    const skiftTimerPaaRaekke = (el, id) => kald.push(['timer', id]);
    const vaelgProjektFor = (id) => kald.push(['flyt', id]);
    ${hent('naboRaekke')}\n${hent('raekkeTast')}\nreturn raekkeTast;`)(document, kald);
  return { raekkeTast: fn, kald };
}

test('j og k flytter til naeste og forrige raekke - med omslag', () => {
  const r = [raekke('a'), raekke('b'), raekke('c')];
  const { raekkeTast } = raekkeTastMed(r);
  const e = haendelse('j');
  assert.equal(raekkeTast(e, r[0], 'a'), true);
  assert.equal(r[1].fokus, 1);
  assert.equal(e.forhindret, 1);
  assert.equal(e.stoppet, 1, 'raekken ejer tasten - ellers naar den »skriv bare«');
  raekkeTast(haendelse('k'), r[0], 'a');
  assert.equal(r[2].fokus, 1, 'k fra den foerste lander paa den sidste');
  raekkeTast(haendelse('j'), r[2], 'c');
  assert.equal(r[0].fokus, 1, 'j fra den sidste lander paa den foerste');
});

test('t starter uret - men kun paa en raekke, der HAR en timerknap', () => {
  const med = raekke('a');
  const uden = raekke('b', { timer: false });
  const { raekkeTast, kald } = raekkeTastMed([med, uden]);
  assert.equal(raekkeTast(haendelse('t'), med, 'a'), true);
  const e = haendelse('t');
  assert.equal(raekkeTast(e, uden, 'b'), false, 'en faerdig opgave har intet ur');
  assert.equal(e.stoppet, 0, 'en ubrugt tast maa ikke stoppes');
  assert.deepEqual(kald, [['timer', 'a']]);
});

test('⌘↵ og Ctrl+↵ er stadig timeren, Enter aabner, mellemrum er udfoert, m flytter', () => {
  const r = raekke('a');
  const { raekkeTast, kald } = raekkeTastMed([r]);
  raekkeTast(haendelse('Enter', { metaKey: true }), r, 'a');
  raekkeTast(haendelse('Enter', { ctrlKey: true }), r, 'a');
  raekkeTast(haendelse('Enter'), r, 'a');
  raekkeTast(haendelse(' '), r, 'a');
  raekkeTast(haendelse('m'), r, 'a');
  assert.deepEqual(kald, [['timer', 'a'], ['timer', 'a'], ['aabn', 'a'], ['faerdig', 'a'], ['flyt', 'a']]);
});

test('med en modifikator er bogstavet ikke raekkens - og et ukendt bogstav heller ikke', () => {
  const r = raekke('a');
  const { raekkeTast, kald } = raekkeTastMed([r, raekke('b')]);
  for (const e of [haendelse('j', { ctrlKey: true }), haendelse('m', { metaKey: true }),
    haendelse('t', { altKey: true }), haendelse('z')]) {
    assert.equal(raekkeTast(e, r, 'a'), false, e.key);
    assert.equal(e.stoppet + e.forhindret, 0, e.key);
  }
  assert.deepEqual(kald, []);
});

test('»skriv bare« traekker sig, naar fokus ELLER maalet er en raekke', () => {
  const lav = (aktiv) => new Function('document', `${hent('paaRaekke')}\nreturn paaRaekke;`)(
    { activeElement: aktiv });
  const r = raekke('a');
  const body = { closest: () => null };
  assert.equal(lav(r)({ target: r }), true);
  assert.equal(lav(body)({ target: r }), true, 'raekken kan vaere tegnet om - maalet husker den');
  assert.equal(lav(body)({ target: body }), false, 'uden raekke gaar bogstaverne til soegefeltet');
  assert.equal(lav(null)({ target: null }), false);
});

test('»skriv bare« spoerger paaRaekke, foer den sender bogstavet til feltet', () => {
  const i = app.indexOf('if (paaRaekke(e)) return;');
  const j = app.indexOf('omni.value += e.key;');
  assert.ok(i > 0 && j > i);
  assert.ok(!app.includes("closest('[data-keynav-letters]')"), 'den gamle undtagelse er vaek');
});

test('? fanges i capture-fasen og stopper udbredelsen - foer raekken og »skriv bare«', () => {
  const m = app.match(/document\.addEventListener\('keydown', \(e\) => \{\n  if \(!state\.user \|\| e\.key !== '\?'\) return;[\s\S]*?\n\}, true\);/);
  assert.ok(m, '?-handleren findes ikke med capture: true');
  assert.match(m[0], /e\.stopPropagation\(\);\n  visGenveje\(\);/);
});

test('genvejslisten: tre grupper i den faelles raekkefoelge med de nye taster', () => {
  const lav = (platform) => new Function('navigator', `${hent('modTast')}\n${app.match(/^const GENVEJ_MOD[\s\S]*?^\];$/m)[0]}\nreturn GENVEJE;`)(
    platform === null ? undefined : { platform });
  const mac = lav('MacIntel');
  assert.deepEqual(mac.map(([g]) => g), ['Anywhere', 'In the search field', 'In a list']);
  const taster = (liste, gruppe) => liste.find(([g]) => g === gruppe)[1].map(([t]) => t);
  assert.ok(taster(mac, 'Anywhere').includes('?'));
  assert.ok(taster(mac, 'Anywhere').includes('⌘K'));
  for (const t of ['j / k', 't / ⌘↵', 'm', 'Space', 'Enter', 'Esc']) {
    assert.ok(taster(mac, 'In a list').includes(t), t);
  }
  assert.ok(!mac.flatMap(([, l]) => l.map(([t]) => t)).includes('/'), '/ er projekt-praefikset, ikke en genvej');
  const pc = lav('Win32');
  assert.ok(taster(pc, 'Anywhere').includes('Ctrl+K'));
  assert.ok(taster(pc, 'In a list').includes('t / Ctrl+↵'));
  assert.ok(!JSON.stringify(pc).includes('⌘'), 'ingen ⌘ uden for Mac');
  assert.ok(taster(lav(null), 'Anywhere').includes('Ctrl+K'), 'uden navigator: Ctrl');
});

test('guiden og oversigten tegner den SAMME liste', () => {
  assert.match(guide, /genvejeHtml\('shortcuts'\)/);
  assert.match(hent('visGenveje'), /genvejeHtml\('data genvejstabel'\)/);
});
