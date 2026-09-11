/* tovo - ServiceNow-eksporten: kolonnegenkendelse, mapning og fletning.
 *
 * Modulet faar RAA raekker ind (array af celler, foerste raekke er hovedet) og
 * kender hverken filer, http eller databasen. Selve laesningen af CSV-teksten
 * sker med `tovoToggl.parseCsv` - den er en rigtig RFC 4180-maskine og
 * haandterer citater, escapede citater og linjeskift inde i et felt.
 *
 * ── Hvorfor CSV og ikke JSON ──────────────────────────────────────────────
 *
 * ServiceNow kan eksportere begge. JSON'en har 145 felter mod CSV'ens 16 - og
 * er alligevel den daarligste kilde: referencefelter staar som **sys_id**.
 * `company` er "2452dd26db8736004f15fb261d96196d", `state` er "-30", og
 * `u_subcategory` er en GUID. De kan kun slaas op inde i ServiceNow selv.
 *
 * CSV'en er LISTEVISNINGEN, og dér har ServiceNow allerede oploest dem til
 * laesbare navne ("Nordvind A/S", "On hold", "Trio"). Faerre felter, men de
 * rigtige. Eksemplerne er opdigtede: repoet er offentligt.
 *
 * Vil man have beskrivelsen med, er vejen at tilfoeje kolonnen i sin
 * ServiceNow-visning - ikke at skifte format.
 *
 * Verificeret mod en rigtig eksport 2026-09-11 (31 raekker, 16 kolonner).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.tovoServiceNow = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

  /**
   * Kolonnerne. PRAEFIKSMATCH, som i Planner- og Toggl-importen.
   *
   * ServiceNow saetter et punktum-praefiks paa opslagsfelter
   * (`company.u_customer_id`, `parent.short_description`), og en visning kan
   * hedde noget lidt andet fra instans til instans. Et praefiksmatch taaler
   * det; en liste af noejagtige navne goer ikke.
   */
  const KOLONNER = {
    number: (n) => n === 'number' || n === 'task_effective_number',
    title: (n) => n === 'short_description',
    company: (n) => n === 'company',
    subcategory: (n) => n === 'u_subcategory' || n === 'subcategory',
    state: (n) => n === 'state',
    created: (n) => n === 'sys_created_on' || n === 'opened_at',
    due: (n) => n === 'due_date',
    klasse: (n) => n === 'sys_class_name',
    parent: (n) => n === 'parent',
    /* Beskrivelsen er valgfri: den staar ikke i standardvisningen, men den
       kan tilfoejes, og saa skal den med. */
    note: (n) => n === 'description' || n === 'u_description',
  };

  /**
   * Tilstande, der betyder AFSLUTTET.
   *
   * Andreas' filter er `State != Resolved`, saa de burde ikke vaere i filen -
   * men et filter kan aendres, og en opgave, der ER lukket i ServiceNow, maa
   * ikke lande som aaben i tovo.
   */
  const LUKKEDE = new Set(['resolved', 'closed', 'closed complete', 'closed incomplete',
    'closed skipped', 'cancelled', 'canceled', 'lukket', 'afsluttet']);

  /**
   * Felterne en GENIMPORT maa opdatere. Alt andet er tovos eget.
   *
   * Hvidliste, ikke sortliste - samme regel som Planner-importen. En
   * sortliste glemmer det felt, nogen tilfoejer om et halvt aar, og saa
   * forsvinder et estimat, nogen har sat, uden at det opdages.
   *
   * Bemaerk hvad der IKKE staar her: estimateMinutes, links, note fra tovo,
   * sectionId, position. Og tidsposter og kommentarer er slet ikke felter paa
   * opgaven - de kan importen slet ikke naa.
   */
  const FLETTEFELTER = ['title', 'caseNumber', 'projectId', 'dueDate', 'status', 'tagIds'];

  function kolonneKort(hoved) {
    const kort = {};
    (hoved || []).forEach((raa, i) => {
      const n = norm(raa);
      for (const [navn, passer] of Object.entries(KOLONNER)) {
        if (kort[navn] === undefined && passer(n)) kort[navn] = i;
      }
    });
    return kort;
  }

  /**
   * "2026-09-09 14:55:18" -> "2026-09-09".
   *
   * Klokkeslaettet kastes vaek med vilje: en forfaldsdato i ServiceNow er en
   * dato, og et tidspunkt ville lave en kalenderaftale ud af noget, der ikke
   * er en aftale.
   */
  function laesDato(raa) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raa || '').trim());
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  /** `<p>tekst</p>` -> `tekst`. Beskrivelsen er HTML, hvis den er med. */
  function afHtml(raa) {
    return String(raa || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Raa raekker -> opgaver, som tovo kan forstaa.
   *
   * Raekker uden et `number` springes over og TAELLES. En raekke uden nummer
   * kan ikke matches ved en genimport, og saa ville den blive oprettet igen
   * hver gang - det er vaerre end at lade den ligge.
   */
  function laesEksport(raekker) {
    const r = (raekker || []).filter((x) => x && x.some((c) => String(c).trim()));
    if (!r.length) return { opgaver: [], advarsler: ['Filen er tom.'], kort: {} };

    const kort = kolonneKort(r[0]);
    const mangler = ['number', 'title'].filter((k) => kort[k] === undefined);
    if (mangler.length) {
      return {
        opgaver: [],
        kort,
        advarsler: [`Kolonnerne ${mangler.join(' og ')} mangler. `
          + 'Eksportér listevisningen som CSV med mindst Number og Short description.'],
      };
    }

    const celle = (raekke, navn) => (kort[navn] === undefined ? '' : String(raekke[kort[navn]] || '').trim());
    const opgaver = [];
    const advarsler = [];
    let udenNummer = 0;
    const set = new Set();

    for (const raekke of r.slice(1)) {
      const number = celle(raekke, 'number');
      if (!number) { udenNummer += 1; continue; }
      /* Den samme sag to gange i én fil: den sidste vinder, og det siges.
         Stille sammenlaegning ville skjule en eksport, der er gaaet galt. */
      if (set.has(number)) advarsler.push(`${number} står to gange i filen — den sidste blev brugt.`);
      set.add(number);

      const tilstand = celle(raekke, 'state');
      opgaver.push({
        number,
        title: celle(raekke, 'title') || number,
        company: celle(raekke, 'company'),
        subcategory: celle(raekke, 'subcategory'),
        klasse: celle(raekke, 'klasse'),
        parent: celle(raekke, 'parent'),
        state: tilstand,
        lukket: LUKKEDE.has(norm(tilstand)),
        dueDate: laesDato(celle(raekke, 'due')),
        createdAt: laesDato(celle(raekke, 'created')),
        note: afHtml(celle(raekke, 'note')),
      });
    }
    if (udenNummer) {
      advarsler.push(`${udenNummer} ${udenNummer === 1 ? 'række' : 'rækker'} uden Number `
        + 'blev sprunget over — uden det kan de ikke genkendes ved næste import.');
    }
    return { opgaver, advarsler, kort };
  }

  /**
   * Hvad ville en import goere?
   *
   * Svarer UDEN at aendre noget, saa ruden kan vise det, foer der trykkes.
   *
   * Matchet sker paa `snNumber` - et felt, importen ejer - og ALDRIG paa
   * `caseNumber`, selv om de baerer samme vaerdi. Sagsnummeret kan rettes i
   * haanden, og saa ville den samme sag blive oprettet en gang til ved naeste
   * import. Samme regel som Planners `plannerTaskId`.
   *
   * @param sn           opgaver fra laesEksport()
   * @param eksisterende tovos egne opgaver
   * @param opt.projects eksisterende projekter [{id, name}]
   * @param opt.tags     eksisterende maerkater [{id, name}]
   */
  function sammenlign(sn, eksisterende, opt) {
    const o = opt || {};
    const kendte = new Map((eksisterende || []).filter((t) => t.snNumber).map((t) => [t.snNumber, t]));

    const projekter = (o.projects || []).slice();
    const maerkater = (o.tags || []).slice();

    const projektId = (navn) => {
      if (!navn) return null;
      const fundet = projekter.find((p) => norm(p.name) === norm(navn));
      if (fundet) return fundet.id;
      const ny = { id: `nyt-projekt-${projekter.length}`, name: navn, ny: true };
      projekter.push(ny);
      return ny.id;
    };
    const tagId = (navn) => {
      if (!navn) return null;
      const fundet = maerkater.find((t) => norm(t.name) === norm(navn));
      if (fundet) return fundet.id;
      const ny = { id: `nyt-tag-${maerkater.length}`, name: navn, ny: true };
      maerkater.push(ny);
      return ny.id;
    };

    const nye = [];
    const opdaterede = [];
    const uaendrede = [];

    for (const s of sn) {
      const felter = {
        title: s.title,
        caseNumber: s.number,
        projectId: projektId(s.company),
        dueDate: s.dueDate,
        status: s.lukket ? 'done' : 'open',
        tagIds: [tagId(s.subcategory)].filter(Boolean),
      };
      const findes = kendte.get(s.number);
      if (!findes) {
        nye.push({ number: s.number, felter, note: s.note, kilde: s });
        continue;
      }
      /* Kun hvidlistede felter sammenlignes. Rettede man titlen i tovo, SKAL
         den rettes tilbage ved en genimport - ServiceNow er kilden til den -
         men et estimat er tovos eget og naevnes slet ikke her. */
      const aendringer = [];
      for (const felt of FLETTEFELTER) {
        const foer = felt === 'tagIds' ? (findes.tagIds || []).join(',') : (findes[felt] == null ? '' : findes[felt]);
        const efter = felt === 'tagIds' ? (felter.tagIds || []).join(',') : (felter[felt] == null ? '' : felter[felt]);
        if (String(foer) !== String(efter)) aendringer.push(felt);
      }
      if (aendringer.length) opdaterede.push({ id: findes.id, number: s.number, felter, aendringer, kilde: s, task: findes });
      else uaendrede.push({ id: findes.id, number: s.number });
    }

    /*
     * Tidligere importerede opgaver, der IKKE er i filen.
     *
     * Andreas' eksport filtrerer `State != Resolved`, saa en loest sag falder
     * ud af den. Men et filter kan ogsaa vaere aendret, eller eksporten kan
     * vaere en anden udvaelgelse - og saa ville en automatisk afslutning lukke
     * opgaver, der stadig loeber. Derfor RAPPORTERES de kun; det er ruden, der
     * spoerger, og brugeren, der vaelger.
     */
    const iFilen = new Set(sn.map((s) => s.number));
    const forsvundne = [];
    for (const [number, t] of kendte) {
      if (iFilen.has(number)) continue;
      if (t.status === 'done') continue;          // allerede lukket - ikke et spoergsmaal
      forsvundne.push({ id: t.id, number, title: t.title, task: t });
    }

    return {
      nye,
      opdaterede,
      uaendrede,
      forsvundne,
      projekter: projekter.filter((p) => p.ny),
      tags: maerkater.filter((t) => t.ny),
    };
  }

  /**
   * Bygger den opgave, der skal GEMMES.
   *
   * ── Hvorfor den her funktion overhovedet findes ───────────────────────────
   *
   * `/api/v1/items/bulk` gemmer en HEL opgave, ikke en delvis. Sender man et
   * bart objekt med kun de importerede felter, slettes alt andet: estimatet,
   * noten, kolonnen, linkene. Det saa rigtigt ud fra begge ender og blev
   * foerst fanget, da en rigtig import blev koert i browseren - en enhedstest
   * paa `sammenlign` kan ikke se et forkert kaldssted.
   *
   * Derfor: den eksisterende opgave er GRUNDEN, og kun hvidlistens felter
   * skrives oven paa den.
   *
   * @param felter        fra sammenlign()
   * @param eksisterende  tovos opgave, eller null ved en ny
   * @param opt.number    ServiceNow-nummeret (matchefeltet)
   * @param opt.note      beskrivelsen - kun ved OPRETTELSEN
   */
  function flet(felter, eksisterende, opt) {
    const o = opt || {};
    if (!eksisterende) {
      const ny = Object.assign({ kind: 'task', snNumber: o.number }, felter);
      /* Beskrivelsen skrives kun én gang. Ved en genimport ville den
         overskrive det, man selv har skrevet i noten. */
      if (o.note) ny.note = o.note;
      return ny;
    }
    const ud = Object.assign({}, eksisterende, { kind: 'task', snNumber: o.number || eksisterende.snNumber });
    for (const felt of FLETTEFELTER) ud[felt] = felter[felt];
    return ud;
  }

  /** Luk en opgave UDEN at kaste resten af den vaek. Samme faelde som flet(). */
  function luk(eksisterende, nu) {
    return Object.assign({}, eksisterende, {
      kind: 'task', status: 'done', completedAt: nu || Math.floor(Date.now() / 1000),
    });
  }

  return { KOLONNER, FLETTEFELTER, LUKKEDE, kolonneKort, laesDato, afHtml, laesEksport, sammenlign, flet, luk };
}));
