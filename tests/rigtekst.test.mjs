/* Kopiér som rig tekst (RUNE-ERFARINGER §9e).
 *
 * Browser-panelet kan ikke skrive til systemets udklipsholder, saa proeven
 * maaler det, der kan maales: den BYGGEDE html og tekst (hentet ud af den
 * samlede app.js og koert paa syntetiske tal), og at kopierRigTekst() giver
 * begge formater videre - ad hovedvejen og ad reserven over http.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tovoBeregn = require('../app/shared/beregn.js');
const app = readFileSync(new URL('../app/public/app.js', import.meta.url), 'utf8');

function hent(navn) {
  const m = app.match(new RegExp(`^(?:async )?function ${navn}\\([\\s\\S]*?^}$`, 'm'));
  assert.ok(m, `${navn}() findes ikke i den byggede flade`);
  return m[0];
}
const konstanter = [...app.matchAll(/^const MAIL_\w+ = .*;$/gm)].map((m) => m[0]).join('\n');
const byggere = new Function('tovoBeregn', `${konstanter}
  ${['esc', 'mailTabelHtml', 'tsvLinje', 'tsvTabel', 'mailOverskrift', 'mailAfsnit',
    'rapportRigTekst', 'kundeRigTekst'].map(hent).join('\n')}
  return { rapportRigTekst, kundeRigTekst };`)(tovoBeregn);

const RAPPORT = {
  from: '2026-09-14',
  to: '2026-09-15',
  report: {
    total: 330, onProjects: 300, adhoc: 30, norm: 888, projects: [{
      name: 'Nordvind <drift>', minutter: 300,
      tasks: [{ title: 'Opsæt\tkø', estimateMinutes: 240, minutter: 300, completedIPerioden: true }],
    }],
  },
  timesheet: {
    dage: ['2026-09-14', '2026-09-15'],
    caseRows: [{ case: 'SAG-1001', dage: { '2026-09-14': 210, '2026-09-15': 90 }, total: 300 },
      { case: '', dage: { '2026-09-15': 30 }, total: 30 }],
    rows: [{ case: 'SAG-1001', project: 'Nordvind <drift>', title: 'Opsæt\tkø', dage: { '2026-09-14': 210, '2026-09-15': 90 }, total: 300 }],
    perDay: { '2026-09-14': 210, '2026-09-15': 120 },
    total: 330,
  },
};

test('rapporten: en mail-tabel med inline-stil og intet, en mail smider vaek', () => {
  const { html } = byggere.rapportRigTekst(RAPPORT, true);
  assert.equal((html.match(/<table\b/g) || []).length, 3, 'sag/dag, opgave/dag og projektet');
  assert.doesNotMatch(html, /class=|<style|var\(--/, 'klasser og temafarver overlever ikke en mail');
  assert.doesNotMatch(html, /<drift>/, 'navne skal escapes');
  assert.match(html, /Nordvind &lt;drift&gt;/);
  // Hver celle baerer sin egen stil, og talkolonnerne er hoejrestillede.
  const celler = html.match(/<t[dh]\b[^>]*>/g);
  assert.ok(celler.every((c) => /style="[^"]*border:1px solid/.test(c)), 'en celle uden kant');
  assert.match(html, /text-align:right;">3,5<\/td>/, 'decimaltimer, hoejrestillet');
  assert.match(html, /font-weight:bold[^>]*>5,5<\/td>/, 'totalraekken er fed');
  assert.match(html, /\(no case number\)/);
});

test('rapporten: ren tekst er tabulator-separeret til et regneark', () => {
  const { tekst } = byggere.rapportRigTekst(RAPPORT, true);
  const linjer = tekst.split('\n');
  assert.ok(linjer.includes('Case\t09-14\t09-15\tTotal'), linjer.join('\n'));
  assert.ok(linjer.includes('SAG-1001\t3,5\t1,5\t5'));
  assert.ok(linjer.includes('Total\t3,5\t2\t5,5'));
  // Tabulatoren i opgavens titel maa ikke flytte cellerne.
  const opgave = linjer.find((l) => l.startsWith('SAG-1001\tNordvind'));
  assert.equal(opgave.split('\t').length, 3 + 2 + 1, opgave);
  assert.match(opgave, /Opsæt kø/);
  // Og formatet foelger rapportens valg.
  assert.ok(byggere.rapportRigTekst(RAPPORT, false).tekst.includes('SAG-1001\t3h 30m\t1h 30m\t5h'));
});

test('kundevisningen: samme tal som arket, i begge formater', () => {
  const { html, tekst } = byggere.kundeRigTekst(
    { name: 'Nordvind', customer: 'Nordvind A/S' },
    [{ id: 'b', title: 'Anden', position: 2, status: 'done', estimateMinutes: 60 },
      { id: 'a', title: 'Første', position: 1, status: 'open' }],
    { estimat: 60, forbrugt: 150, ramme: 120, resterende: -30 },
    { a: 90, b: 60 },
  );
  assert.doesNotMatch(html, /class=|var\(--/);
  assert.equal((html.match(/<table\b/g) || []).length, 2, 'opgaverne og rammen');
  const linjer = tekst.split('\n');
  assert.deepEqual(linjer.slice(0, 6), ['Nordvind', 'Nordvind A/S', '',
    'Task\tStatus\tEstimated\tSpent', 'Første\tIn progress\t—\t1h 30m', 'Anden\tDone\t1h\t1h']);
  assert.ok(linjer.includes('Remaining\t0m'), 'et overskredet budget viser 0, som arket');
});

/* ── selve skrivningen ───────────────────────────────────────────────────── */
function skriver({ sikker, clipboardFejler }) {
  const log = { item: null, skrevet: null, synkront: false, setData: {}, felt: null };
  let lytter = null;
  class ClipboardItem { constructor(d) { log.item = d; } }
  const navigator = { clipboard: { async write(items) {
    if (clipboardFejler) throw new Error('NotAllowedError');
    log.skrevet = items;
  } } };
  const document = {
    body: { appendChild(el) { log.felt = el; } },
    createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove() { log.fjernet = true; } }),
    addEventListener: (t, f) => { if (t === 'copy') lytter = f; },
    removeEventListener: (t, f) => { if (lytter === f) lytter = null; },
    execCommand: (k) => {
      if (k !== 'copy' || !lytter) return false;
      lytter({ clipboardData: { setData: (type, v) => { log.setData[type] = v; } }, preventDefault() {} });
      return true;
    },
  };
  const window = { isSecureContext: sikker };
  const kopier = new Function('window', 'navigator', 'document', 'ClipboardItem', 'Blob', `
    ${hent('kopierRigTekst')}\n${hent('kopierMedHaendelse')}\nreturn kopierRigTekst;`)(
    window, navigator, document, ClipboardItem, Blob);
  return { kopier, log, harLytter: () => !!lytter };
}

const INDHOLD = { html: '<table><tr><td>1</td></tr></table>', tekst: 'a\tb\n' };

test('https: ClipboardItem oprettes SYNKRONT i klikket, med begge formater', async () => {
  const s = skriver({ sikker: true });
  const loefte = s.kopier(INDHOLD);
  // Foer det foerste await: Safari godtager kun en item fra selve klikket.
  assert.ok(s.log.item, 'ClipboardItem blev ikke oprettet i klikket');
  assert.equal(await loefte, true);
  assert.deepEqual(Object.keys(s.log.item).sort(), ['text/html', 'text/plain']);
  const html = await (await s.log.item['text/html']).text();
  const tekst = await (await s.log.item['text/plain']).text();
  assert.equal(html, INDHOLD.html);
  assert.equal(tekst, INDHOLD.tekst);
  assert.equal((await s.log.item['text/html']).type, 'text/html');
});

test('http: copy-haendelsen baerer begge formater, og lytteren fjernes igen', async () => {
  const s = skriver({ sikker: false });
  assert.equal(await s.kopier(INDHOLD), true);
  assert.equal(s.log.item, null, 'ingen ClipboardItem uden secure context');
  assert.deepEqual(s.log.setData, { 'text/html': INDHOLD.html, 'text/plain': INDHOLD.tekst });
  assert.equal(s.harLytter(), false);
  assert.equal(s.log.fjernet, true, 'det skjulte felt skal vaek igen');
});

test('naegtet tilladelse: reserven tager over', async () => {
  const s = skriver({ sikker: true, clipboardFejler: true });
  assert.equal(await s.kopier(INDHOLD), true);
  assert.equal(s.log.setData['text/html'], INDHOLD.html);
});
