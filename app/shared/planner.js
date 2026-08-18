/* tovo - Planner-eksporten: arkvalg, kolonnegenkendelse, mapning og fletning.
 *
 * Modulet faar RAA raekker ind (arknavn -> array af celler) og kender hverken
 * zip, XML eller databasen. Selve laesningen af .xlsx-filen sker i browseren
 * (app/parts/p6_planner.js), fordi den bruger DecompressionStream og
 * DOMParser - men ALT det, der kan goere skade, ligger her, hvor det kan
 * testes uden en browser.
 *
 * Verificeret mod en rigtig eksport 2026-08-18. Tre ting, planen antog
 * forkert, og som koden derfor goer anderledes:
 *   - der er INGEN sharedStrings-fil; cellerne er t="str" med teksten i <v>
 *   - datoer er ISO-tekst ("2026-05-12"), ikke serienumre
 *   - statuskolonnen hedder "Status" og beskrivelsen "Noter" - ikke
 *     "Fremdrift" og "Beskrivelse"
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.tovoPlanner = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /*
   * Kolonnegenkendelse er PRAEFIKSMATCH paa et trimmet, lowercased navn -
   * ikke lighed. To grunde, begge maalt paa en rigtig fil:
   *   - overskrifterne har efterstillede mellemrum ("Opgavenavn ")
   *   - Planner har oversat og aendret navne foer
   *
   * Og praefiks, ikke "indeholder": arket har BAADE "Tjeklisteelementer" og
   * "Afsluttede tjeklisteelementer" (sidstnaevnte er en taeller som "0/3").
   * Et indeholder-match ville goere underopgaverne til teksten "0/3".
   */
  const KOLONNER = {
    plannerTaskId: (n) => n.includes('opgave-id'),
    title: (n) => n.startsWith('opgavenavn'),
    // "Bucket" i det konsoliderede ark er et navn; i Opgaver-arket et id.
    section: (n) => n === 'bucket' || n.startsWith('bucket-navn'),
    status: (n) => n.startsWith('status') || n.startsWith('fremdrift'),
    dueDate: (n) => n.startsWith('forfaldsdato'),
    note: (n) => n.startsWith('noter') || n.startsWith('beskrivelse'),
    checklist: (n) => n.startsWith('tjekliste'),
    priority: (n) => n.startsWith('prioritet'),
    completedAt: (n) => n.startsWith('fuldføringsdato') || n.startsWith('fuldfoeringsdato'),
  };

  /* Kun ét statusord er set i virkeligheden ("Ikke startet"). De to andre er
     kvalificerede gaet, saa mapningen er TOLERANT: en ukendt status bliver
     til "open" frem for at faelde hele importen. */
  const STATUS = {
    'ikke startet': 'open', 'not started': 'open',
    'i gang': 'doing', 'in progress': 'doing',
    'fuldført': 'done', 'fuldfoert': 'done', 'completed': 'done',
  };

  const PRIORITET = {
    lav: 'low', low: 'low',
    mellem: 'medium', medium: 'medium',
    vigtig: 'high', important: 'high', presserende: 'high', urgent: 'high',
  };

  /**
   * Felterne en GENIMPORT maa opdatere. Alt andet er tovos eget.
   *
   * Skrevet som en HVIDLISTE, ikke en sortliste: en sortliste glemmer det
   * felt, nogen tilfoejer om et halvt aar, og saa forsvinder et estimat, en
   * bruger har sat, uden at nogen opdager det.
   */
  const FLETTEFELTER = ['title', 'sectionId', 'status', 'dueDate', 'note', 'completedAt'];

  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

  /**
   * Vaelger arket. "Konsoliderede data" foretraekkes: buckets er allerede
   * oploest til navne dér, saa der er intet id-opslag at lave.
   */
  function vaelgArk(arknavne) {
    const kons = arknavne.find((n) => norm(n).includes('konsoliderede'));
    if (kons) return { ark: kons, buckets: null };
    const opgaver = arknavne.find((n) => norm(n).includes('opgaver'));
    if (!opgaver) return null;
    return { ark: opgaver, buckets: arknavne.find((n) => norm(n).includes('bucket')) || null };
  }

  /** Overskriftsraekken -> {felt: kolonneindeks}. */
  function kolonneKort(hoved) {
    const ud = {};
    hoved.forEach((raa, i) => {
      const n = norm(raa);
      if (!n) return;
      for (const [felt, passer] of Object.entries(KOLONNER)) {
        if (ud[felt] === undefined && passer(n)) ud[felt] = i;
      }
    });
    return ud;
  }

  /** Datoer er ISO-tekst i eksporten. Et serienummer taales som fallback. */
  function laesDato(raa) {
    const t = String(raa == null ? '' : raa).trim();
    if (!t) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
    if (/^\d+(\.\d+)?$/.test(t)) {
      // Dage siden 1899-12-30. Regnes i UTC og formateres som ren dato -
      // ellers flytter en tidszone datoen en dag.
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    return null;
  }

  /**
   * Laeser hele eksporten.
   *
   * @param {object} ark  {arknavn: [[celle, ...], ...]} - foerste raekke er
   *   overskrifterne
   * @returns {{plan, tasks, warnings}}
   */
  function laesEksport(ark) {
    const navne = Object.keys(ark);
    const valg = vaelgArk(navne);
    const warnings = [];
    if (!valg) {
      throw new Error('This file has no "Opgaver" or "Konsoliderede data" sheet. '
        + 'Export the plan from Planner again with all sheets included.');
    }

    const raekker = ark[valg.ark] || [];
    if (raekker.length < 2) throw new Error(`The sheet "${valg.ark}" has no rows.`);
    const kort = kolonneKort(raekker[0]);

    if (kort.plannerTaskId === undefined) {
      // Uden den kolonne kan en genimport ikke genkende en opgave, og hele
      // modellen falder. Stop hellere end at importere dubletter for evigt.
      throw new Error('The export has no "Opgave-id" column. Without it a re-import '
        + 'cannot recognise the tasks it already brought in, so every import would '
        + 'create duplicates. Export the plan again with all columns.');
    }
    if (kort.title === undefined) throw new Error('The export has no "Opgavenavn" column.');

    /*
     * Buckets-arket laeses ALTID, ogsaa naar opgaverne kommer fra det
     * konsoliderede ark.
     *
     * To ting kommer ud af det, og kun den foerste var her foer:
     *  1. bucket-id -> navn, saa sektionen ikke hedder et raat id, naar
     *     opgaverne laeses fra Opgaver-arket.
     *  2. HELE listen af buckets i planens egen raekkefoelge. Uden den
     *     kan kolonnerne kun udledes af de buckets, der TILFAELDIGVIS har
     *     en opgave i sig - saa en tom bucket i Planner bliver aldrig en
     *     kolonne i tovo, og raekkefoelgen bliver "den, opgaverne stod i".
     *     Det var praecis fejlen: en plan med alt i "Backlog" gav én kolonne.
     */
    const bucketArk = navne.find((n) => norm(n).includes('bucket'));
    let buckets = null;
    let bucketNavne = [];
    if (bucketArk && ark[bucketArk] && ark[bucketArk].length > 1) {
      const b = ark[bucketArk];
      const bk = b[0].map(norm);
      const iId = bk.findIndex((n) => n.startsWith('bucket-id'));
      const iNavn = bk.findIndex((n) => n.startsWith('bucket-navn'));
      if (iNavn >= 0) {
        bucketNavne = b.slice(1)
          .map((r) => String(r[iNavn] || '').trim())
          .filter((n, i, alle) => n && alle.indexOf(n) === i);
      }
      if (iId >= 0 && iNavn >= 0) {
        buckets = new Map(b.slice(1).map((r) => [String(r[iId] || '').trim(), String(r[iNavn] || '').trim()]));
      }
    }

    const celle = (r, felt) => (kort[felt] === undefined ? '' : String(r[kort[felt]] == null ? '' : r[kort[felt]]).trim());

    const tasks = [];
    const set = new Set();
    for (const r of raekker.slice(1)) {
      const id = celle(r, 'plannerTaskId');
      const titel = celle(r, 'title');
      if (!id || !titel) continue;
      if (set.has(id)) { warnings.push(`The task "${titel}" appears twice in the export.`); continue; }
      set.add(id);

      let sektion = celle(r, 'section');
      if (buckets && buckets.has(sektion)) sektion = buckets.get(sektion);

      const statusRaa = norm(celle(r, 'status'));
      if (statusRaa && !(statusRaa in STATUS)) {
        warnings.push(`Unknown status "${celle(r, 'status')}" — treated as not started.`);
      }

      tasks.push({
        plannerTaskId: id,
        title: titel,
        section: sektion || '',
        status: STATUS[statusRaa] || 'open',
        dueDate: laesDato(celle(r, 'dueDate')),
        completedAt: laesDato(celle(r, 'completedAt')),
        note: celle(r, 'note'),
        priority: PRIORITET[norm(celle(r, 'priority'))] || null,
        // Tjeklisteelementer er ";"-separerede. Et element, der SELV
        // indeholder et semikolon, kan ikke reddes - det staar i formatet.
        checklist: celle(r, 'checklist').split(';').map((x) => x.trim()).filter(Boolean),
      });
    }

    // Plan-arket giver planens id og navn. Uden det kan projektet stadig
    // laves - men saa kan to eksporter ikke kendes fra hinanden.
    const planArk = navne.find((n) => norm(n) === 'plan');
    let plan = { id: null, name: null, exportedAt: null };
    if (planArk && ark[planArk] && ark[planArk].length > 1) {
      const h = ark[planArk][0].map(norm);
      const v = ark[planArk][1];
      const find = (praefiks) => {
        const i = h.findIndex((n) => n.startsWith(praefiks));
        return i >= 0 ? String(v[i] || '').trim() : null;
      };
      plan = {
        id: find('abonnement-id') || find('plan-id'),
        name: find('navn på plan') || find('navn paa plan'),
        exportedAt: laesDato(find('dato for eksport')),
      };
    }

    return { plan, tasks, warnings, buckets: bucketNavne };
  }

  /**
   * Ser Noter-kolonnen ud som estimater?
   *
   * I den foerste rigtige eksport stod der et rent tal med dansk
   * decimalkomma (6,1 · 19,6) paa hver eneste opgave - altsaa timer. Andreas
   * siger, at det ikke altid vil vaere saadan. Derfor: taeller efter og lader
   * BRUGEREN bestemme. Aldrig automatik - en heuristik, der stiltiende
   * skriver i estimatfeltet, opdages foerst tre uger senere i en rapport.
   */
  function noterLignerEstimater(tasks) {
    const medNoter = tasks.filter((t) => t.note);
    if (!medNoter.length) return { ligner: false, antal: 0, af: 0 };
    const tal = medNoter.filter((t) => erRentTal(t.note));
    return { ligner: tal.length >= Math.ceil(medNoter.length / 2), antal: tal.length, af: medNoter.length };
  }

  /** Et rent tal (dansk eller engelsk decimaltegn) - altsaa timer, ikke prosa. */
  const erRentTal = (s) => /^\d+([.,]\d+)?$/.test(String(s == null ? '' : s).trim());

  /**
   * Sammenligner eksporten med det, der allerede er i tovo.
   *
   * @param {array} planner  fra laesEksport().tasks
   * @param {array} findes   tovos opgaver i projektet
   * @param {object} [opt]   {sections: [{id, name}], noterSomEstimat: bool}
   * @returns {{nye, opdaterede, forsvundne, sektioner}}
   */
  function sammenlign(planner, findes, opt) {
    const o = opt || {};
    const kendte = new Map(findes.filter((t) => t.plannerTaskId).map((t) => [t.plannerTaskId, t]));
    const sektioner = (o.sections || []).slice();
    const sektionId = (navn) => {
      if (!navn) return null;
      const fundet = sektioner.find((s) => norm(s.name) === norm(navn));
      if (fundet) return fundet.id;
      const ny = { id: `sek-${sektioner.length}-${norm(navn).replace(/[^a-z0-9]+/g, '-')}`, name: navn, position: sektioner.length, ny: true };
      sektioner.push(ny);
      return ny.id;
    };

    /*
     * ALLE planens buckets bliver kolonner - ogsaa de tomme, og i planens
     * egen raekkefoelge.
     *
     * Ellers kan kolonnerne kun udledes af de buckets, der tilfaeldigvis har
     * en opgave i sig: en plan, hvor alt ligger i "Backlog", giver ÉN kolonne,
     * og de faser, man har lavet for at kunne flytte noget derhen, findes
     * ikke. Det er ogsaa det, der giver den rigtige raekkefoelge - ellers
     * staar kolonnerne i den orden, opgaverne tilfaeldigvis blev laest i.
     *
     * Kaldes FOER opgaverne, saa navnene allerede er kendte, naar de slaas op.
     */
    for (const navn of (o.buckets || [])) sektionId(navn);

    const nye = [];
    const opdaterede = [];
    for (const p of planner) {
      const felter = {
        title: p.title,
        sectionId: sektionId(p.section),
        status: p.status,
        dueDate: p.dueDate,
        note: p.note,
        completedAt: p.completedAt ? Math.floor(new Date(`${p.completedAt}T12:00:00`).getTime() / 1000) : null,
      };
      const eksisterende = kendte.get(p.plannerTaskId);
      if (!eksisterende) {
        nye.push({ planner: p, felter });
        continue;
      }

      /*
       * Et RENT TAL i Noter er timer, ikke en beskrivelse.
       *
       * Blev det brugt som estimat ved importen, blev det med vilje ikke
       * gemt som beskrivelse - og saa staar opgaven her med note "" mod
       * eksportens "6,1". Uden denne linje er hver eneste genimport
       * "4 opgaver skal opdateres", og et tryk paa knappen skriver tallet
       * ind i beskrivelsen og omgoer reglen TAVST.
       *
       * Feltet udelades helt frem for at blive sammenlignet: `flet` skriver
       * kun det, der staar i `felter`, saa tovos egen beskrivelse - hvis
       * brugeren selv har skrevet en - bliver ogsaa staaende.
       */
      if (erRentTal(p.note)) delete felter.note;
      // KUN hvidlistens felter sammenlignes og skrives. Estimat, tidsposter,
      // kommentarer, links, projektramme og prioritet sat i tovo er tovos.
      const aendringer = {};
      for (const felt of FLETTEFELTER) {
        /*
         * Et felt, der IKKE staar i `felter`, er bevidst udeladt (se
         * tal-i-Noter ovenfor) og maa ikke laeses som "sat til ingenting".
         * Uden dette tjek bliver en udeladelse til en aendring, der
         * SLETTER - og det er den farligste slags, fordi den ser ud som
         * en almindelig opdatering i forhaandsvisningen.
         */
        if (!Object.prototype.hasOwnProperty.call(felter, felt)) continue;
        const nu = eksisterende[felt] === undefined ? null : eksisterende[felt];
        const ny = felter[felt] === undefined ? null : felter[felt];
        if ((nu || null) !== (ny || null)) aendringer[felt] = { fra: nu, til: ny };
      }
      if (Object.keys(aendringer).length) opdaterede.push({ task: eksisterende, planner: p, felter, aendringer });
    }

    const iEksporten = new Set(planner.map((p) => p.plannerTaskId));
    const forsvundne = findes.filter((t) => t.plannerTaskId && !iEksporten.has(t.plannerTaskId));

    return { nye, opdaterede, forsvundne, sektioner };
  }

  /**
   * Bygger det objekt, der skal gemmes.
   *
   * @param {object} [eksisterende] ved genimport - felter uden for
   *   hvidlisten baeres UAENDRET med over.
   */
  function flet(planner, felter, eksisterende, opt) {
    const o = opt || {};
    if (!eksisterende) {
      const ny = Object.assign({ kind: 'task', plannerTaskId: planner.plannerTaskId }, felter);
      // Prioritet og estimat saettes KUN ved oprettelsen. Derefter er de
      // tovos egne, og en genimport maa ikke roere dem.
      if (planner.priority) ny.priority = planner.priority;
      if (o.noterSomEstimat && o.estimatMinutter) {
        ny.estimateMinutes = o.estimatMinutter;
        // Et tal er ikke en beskrivelse. Bruges Noter som estimat, skal det
        // ikke OGSAA staa som opgavens tekst.
        ny.note = '';
      }
      return ny;
    }
    const ud = Object.assign({}, eksisterende);
    for (const felt of FLETTEFELTER) ud[felt] = felter[felt];
    return ud;
  }

  return {
    laesEksport, sammenlign, flet, vaelgArk, kolonneKort, laesDato,
    noterLignerEstimater, FLETTEFELTER, KOLONNER, STATUS, PRIORITET,
  };
}));
