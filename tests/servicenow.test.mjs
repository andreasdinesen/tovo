/* ServiceNow-importen.
 *
 * ALLE data her er opdigtede. Repoet er offentligt, og et rigtigt kundenavn
 * eller sagsnummer maa aldrig staa i koden - heller ikke som eksempel.
 * Kunderne hedder Nordvind og Bjergby; sagerne SAG-INC…/SAG-RITM….
 *
 * Modulet er verificeret mod en rigtig eksport (31 raekker, 16 kolonner), men
 * det er formen, der er genskabt her - ikke indholdet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseCsv } = require('../app/shared/toggl.js');
const sn = require('../app/shared/servicenow.js');

/* Hovedet er ServiceNows eget, ordret - inklusive punktum-praefikserne. */
const HOVED = '"company","short_description","u_subcategory","number","priority","state",'
  + '"sys_created_on","sys_updated_on","due_date","follow_up","assigned_to",'
  + '"company.u_customer_id","parent","parent.short_description","sys_class_name",'
  + '"ref_u_csi_register.u_release"';

function csv(...raekker) {
  return [HOVED, ...raekker].join('\n');
}
const raekke = (o = {}) => [
  o.company ?? 'Nordvind A/S',
  o.title ?? 'Omstillingen svarer ikke',
  o.sub ?? 'Trio',
  o.number ?? 'SAG-INC0000001',
  o.priority ?? '4 - Low',
  o.state ?? 'On hold',
  o.created ?? '2026-09-09 14:55:18',
  '2026-09-11 09:06:43',
  o.due ?? '',
  '', 'Andreas Dinesen', '10000001',
  o.parent ?? '', '',
  o.klasse ?? 'Incident', '',
].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');

const laes = (tekst) => sn.laesEksport(parseCsv(tekst));

/* ------------------------------------------------------------ laesningen */

test('en almindelig eksport laeses', () => {
  const r = laes(csv(raekke(), raekke({ number: 'SAG-INC0000002', company: 'Bjergby Kommune' })));
  assert.deepEqual(r.advarsler, []);
  assert.equal(r.opgaver.length, 2);
  assert.equal(r.opgaver[0].number, 'SAG-INC0000001');
  assert.equal(r.opgaver[0].company, 'Nordvind A/S');
  assert.equal(r.opgaver[0].subcategory, 'Trio');
});

test('forfaldsdatoen mister sit klokkeslaet', () => {
  // En forfaldsdato i ServiceNow er en DATO. Et klokkeslaet ville lave en
  // kalenderaftale ud af noget, der ikke er en aftale.
  const r = laes(csv(raekke({ due: '2026-08-24 08:10:14' })));
  assert.equal(r.opgaver[0].dueDate, '2026-08-24');
  assert.equal(laes(csv(raekke({ due: '' }))).opgaver[0].dueDate, null);
});

test('en raekke uden Number springes over OG taelles', () => {
  /* Uden nummer kan raekken ikke genkendes ved naeste import, og saa ville den
     blive oprettet igen hver gang. Det er vaerre end at lade den ligge - men
     tavshed om det er vaerst. */
  const r = laes(csv(raekke(), raekke({ number: '' })));
  assert.equal(r.opgaver.length, 1);
  assert.match(r.advarsler.join(' '), /1 række uden Number/);
});

test('mangler Number-kolonnen helt, siges det - der gaettes ikke', () => {
  const r = sn.laesEksport([['company', 'short_description'], ['Nordvind A/S', 'noget']]);
  assert.equal(r.opgaver.length, 0);
  assert.match(r.advarsler[0], /number/i);
});

test('kolonnerne genkendes uanset raekkefoelge', () => {
  const r = sn.laesEksport([
    ['state', 'number', 'sys_class_name', 'short_description', 'company'],
    ['New', 'SAG-INC0000009', 'Incident', 'Bagvendt', 'Nordvind A/S'],
  ]);
  assert.equal(r.opgaver[0].number, 'SAG-INC0000009');
  assert.equal(r.opgaver[0].title, 'Bagvendt');
});

test('en lukket tilstand giver status done - ogsaa selv om filteret burde have fanget den', () => {
  assert.equal(laes(csv(raekke({ state: 'Resolved' }))).opgaver[0].lukket, true);
  assert.equal(laes(csv(raekke({ state: 'Closed Complete' }))).opgaver[0].lukket, true);
  assert.equal(laes(csv(raekke({ state: 'On hold' }))).opgaver[0].lukket, false);
});

test('en beskrivelse i HTML bliver til tekst', () => {
  const medNote = sn.laesEksport([
    ['number', 'short_description', 'description'],
    ['SAG-INC0000010', 'Titel', '<p>Foerste afsnit.</p><p>Andet &amp; sidste.<br>Linje to.</p>'],
  ]);
  assert.equal(medNote.opgaver[0].note, 'Foerste afsnit.\n\nAndet & sidste.\nLinje to.');
});

test('linjeskift inde i et felt knaekker ikke filen', () => {
  // Tilfoejer man description-kolonnen i ServiceNow, kommer der linjeskift.
  const tekst = 'number,short_description,description\n'
    + '"SAG-INC0000011","Titel","linje 1\nlinje 2"\n';
  const r = laes(tekst);
  assert.equal(r.opgaver.length, 1);
  assert.equal(r.opgaver[0].note, 'linje 1\nlinje 2');
});

/* ------------------------------------------------------------- fletningen */

const somOprettet = (nye, projekter, tags, ekstra = {}) => nye.map((n, i) => ({
  id: `opg${i}`,
  snNumber: n.number,
  title: n.felter.title,
  caseNumber: n.felter.caseNumber,
  projectId: (projekter.find((p) => p.name === n.kilde.company) || {}).id || null,
  dueDate: n.felter.dueDate,
  status: n.felter.status,
  tagIds: [(tags.find((t) => t.name === n.kilde.subcategory) || {}).id].filter(Boolean),
  ...ekstra,
}));

function foersteImport(tekst) {
  const r = laes(tekst);
  const f = sn.sammenlign(r.opgaver, [], { projects: [], tags: [] });
  const projekter = f.projekter.map((p, i) => ({ id: `p${i}`, name: p.name }));
  const tags = f.tags.map((t, i) => ({ id: `t${i}`, name: t.name }));
  return { r, f, projekter, tags };
}

test('kunden bliver et PROJEKT og underkategorien et TAG', () => {
  const { f } = foersteImport(csv(
    raekke({ company: 'Nordvind A/S', sub: 'Trio' }),
    raekke({ number: 'SAG-INC0000002', company: 'Bjergby Kommune', sub: 'Trio' }),
  ));
  assert.deepEqual(f.projekter.map((p) => p.name), ['Nordvind A/S', 'Bjergby Kommune']);
  assert.deepEqual(f.tags.map((t) => t.name), ['Trio'], 'det samme tag laves kun én gang');
});

test('DEN SAMME FIL IGEN opretter ingenting', () => {
  // Selve spoergsmaalet: en genimport maa ikke lave dubletter.
  const tekst = csv(raekke(), raekke({ number: 'SAG-INC0000002', company: 'Bjergby Kommune' }));
  const { r, f, projekter, tags } = foersteImport(tekst);
  const findes = somOprettet(f.nye, projekter, tags);

  const igen = sn.sammenlign(r.opgaver, findes, { projects: projekter, tags });
  assert.equal(igen.nye.length, 0, 'der blev oprettet dubletter');
  assert.equal(igen.opdaterede.length, 0);
  assert.equal(igen.uaendrede.length, 2);
  assert.equal(igen.projekter.length, 0, 'projektet blev lavet igen');
  assert.equal(igen.tags.length, 0);
});

test('matchet sker paa snNumber - ikke paa sagsnummeret, man kan rette', () => {
  /* Samme regel som Planners plannerTaskId. Retter man sagsnummeret i
     haanden, ville et match paa caseNumber oprette sagen en gang til. */
  const tekst = csv(raekke());
  const { r, f, projekter, tags } = foersteImport(tekst);
  const findes = somOprettet(f.nye, projekter, tags);
  findes[0].caseNumber = 'noget-andet-i-haanden';

  const igen = sn.sammenlign(r.opgaver, findes, { projects: projekter, tags });
  assert.equal(igen.nye.length, 0, 'et rettet sagsnummer gav en dublet');
  assert.equal(igen.opdaterede.length, 1, 'sagsnummeret skal rettes tilbage');
  assert.deepEqual(igen.opdaterede[0].aendringer, ['caseNumber']);
});

test('en genimport roerer ALDRIG tovos egne felter', () => {
  /* Den vigtigste regel i hele importen. Hvidliste, ikke sortliste. */
  const tekst = csv(raekke());
  const { r, f, projekter, tags } = foersteImport(tekst);
  const findes = somOprettet(f.nye, projekter, tags, {
    estimateMinutes: 150, links: ['onenote:noget'], sectionId: 'kolonne-2',
    note: 'min egen note', position: 7,
  });

  const aendret = JSON.parse(JSON.stringify(r.opgaver));
  aendret[0].title = 'Rettet i ServiceNow';
  const igen = sn.sammenlign(aendret, findes, { projects: projekter, tags });

  assert.deepEqual(igen.opdaterede[0].aendringer, ['title']);
  for (const eget of ['estimateMinutes', 'links', 'sectionId', 'note', 'position']) {
    assert.ok(!(eget in igen.opdaterede[0].felter), `${eget} ville blive overskrevet`);
  }
});

test('en sag, der er VAEK fra filen, lukkes ikke - der spoerges', () => {
  /* Filteret er "State != Resolved", saa en loest sag falder ud af eksporten.
     Men et filter kan ogsaa vaere aendret, og saa ville en automatisk
     afslutning lukke noget, der stadig loeber. */
  const tekst = csv(raekke(), raekke({ number: 'SAG-INC0000002' }));
  const { r, f, projekter, tags } = foersteImport(tekst);
  const findes = somOprettet(f.nye, projekter, tags);

  const uden = sn.sammenlign([r.opgaver[0]], findes, { projects: projekter, tags });
  assert.equal(uden.forsvundne.length, 1);
  assert.equal(uden.forsvundne[0].number, 'SAG-INC0000002');
  assert.equal(uden.opdaterede.length, 0, 'den blev lukket af sig selv');
});

test('en allerede afsluttet opgave spoerges der ikke om igen', () => {
  const tekst = csv(raekke());
  const { r, f, projekter, tags } = foersteImport(tekst);
  const findes = somOprettet(f.nye, projekter, tags);
  findes[0].status = 'done';
  assert.equal(sn.sammenlign([], findes, { projects: projekter, tags }).forsvundne.length, 0);
});

test('en opgave, tovo ikke har importeret, roeres aldrig', () => {
  // Uden snNumber er den ikke importens - heller ikke selv om den mangler i filen.
  const egen = [{ id: 'min', title: 'Skrevet i tovo', status: 'open' }];
  const ud = sn.sammenlign([], egen, { projects: [], tags: [] });
  assert.deepEqual(ud.forsvundne, []);
  assert.equal(ud.opdaterede.length, 0);
});

test('den samme sag to gange i én fil siges der til om', () => {
  const r = laes(csv(raekke(), raekke({ title: 'Samme sag igen' })));
  assert.match(r.advarsler.join(' '), /står to gange/);
});

/* --------------------------------------------------------------- flet() */

/*
 * Den fejl, der slap gennem alle proeverne ovenfor.
 *
 * `sammenlign` var rigtig; KALDSSTEDET sendte et bart objekt til
 * /items/bulk, som gemmer en HEL opgave - og saa forsvandt estimat, note,
 * kolonne og links. En enhedstest paa sammenlign kan ikke se det. Fundet ved
 * at koere en rigtig import i browseren og kigge paa opgaven bagefter.
 *
 * Derfor gaar alt nu gennem flet(), og derfor staar proeverne her.
 */
test('flet() paa en EKSISTERENDE opgave beholder alt, importen ikke ejer', () => {
  const findes = {
    id: 'opg1', kind: 'task', snNumber: 'SAG-INC0000001',
    title: 'Gammel titel', caseNumber: 'SAG-INC0000001', projectId: 'p0',
    dueDate: null, status: 'open', tagIds: ['t0'],
    // tovos egne - maa ALDRIG forsvinde
    estimateMinutes: 150, note: 'min egen note', sectionId: 'kol-2',
    links: ['onenote:noget'], position: 7, priority: 'high',
  };
  const ud = sn.flet(
    { title: 'Ny titel', caseNumber: 'SAG-INC0000001', projectId: 'p0', dueDate: null, status: 'open', tagIds: ['t0'] },
    findes, { number: 'SAG-INC0000001' },
  );
  assert.equal(ud.title, 'Ny titel', 'ServiceNow er kilden til titlen');
  assert.equal(ud.id, 'opg1', 'uden id ville der blive oprettet en ny');
  for (const [felt, vaerdi] of Object.entries({
    estimateMinutes: 150, note: 'min egen note', sectionId: 'kol-2', position: 7, priority: 'high',
  })) {
    assert.equal(ud[felt], vaerdi, `${felt} blev kastet vaek`);
  }
  assert.deepEqual(ud.links, ['onenote:noget']);
});

test('flet() paa en NY opgave saetter matchefeltet og beskrivelsen', () => {
  const ud = sn.flet({ title: 'Ny', status: 'open' }, null,
    { number: 'SAG-INC0000002', note: 'fra ServiceNow' });
  assert.equal(ud.kind, 'task');
  assert.equal(ud.snNumber, 'SAG-INC0000002');
  assert.equal(ud.note, 'fra ServiceNow');
  assert.ok(!('id' in ud), 'en ny opgave maa ikke baere et id');
});

test('beskrivelsen skrives KUN ved oprettelsen', () => {
  // Ellers ville en genimport overskrive det, man selv har skrevet i noten.
  const findes = { id: 'opg1', snNumber: 'SAG-INC0000001', note: 'min egen note', title: 'x' };
  const ud = sn.flet({ title: 'y' }, findes, { number: 'SAG-INC0000001', note: 'fra ServiceNow' });
  assert.equal(ud.note, 'min egen note');
});

test('luk() afslutter UDEN at kaste resten af opgaven vaek', () => {
  const findes = {
    id: 'opg1', kind: 'task', snNumber: 'SAG-INC0000001', title: 'Titel',
    estimateMinutes: 150, links: ['onenote:noget'], sectionId: 'kol-2',
  };
  const ud = sn.luk(findes, 1789000000);
  assert.equal(ud.status, 'done');
  assert.equal(ud.completedAt, 1789000000);
  assert.equal(ud.estimateMinutes, 150, 'estimatet forsvandt ved lukningen');
  assert.deepEqual(ud.links, ['onenote:noget']);
  assert.equal(ud.title, 'Titel');
});

test('sammenlign baerer den eksisterende opgave med, saa flet() KAN kaldes', () => {
  /* Uden `task` paa svaret har kaldsstedet ikke noget at flette paa - og saa
     er man tilbage ved det bare objekt. */
  const tekst = csv(raekke(), raekke({ number: 'SAG-INC0000002' }));
  const { r, f, projekter, tags } = foersteImport(tekst);
  const findes = somOprettet(f.nye, projekter, tags, { estimateMinutes: 90 });

  const aendret = JSON.parse(JSON.stringify(r.opgaver));
  aendret[0].title = 'Rettet';
  const igen = sn.sammenlign(aendret, findes, { projects: projekter, tags });
  assert.ok(igen.opdaterede[0].task, 'opdaterede baerer ikke opgaven med');
  assert.equal(igen.opdaterede[0].task.estimateMinutes, 90);

  const kun = sn.sammenlign([r.opgaver[0]], findes, { projects: projekter, tags });
  assert.ok(kun.forsvundne[0].task, 'forsvundne baerer ikke opgaven med - luk() ville slette den');
});
