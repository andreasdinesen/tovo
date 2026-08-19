/* ---- shared/beregn.js ---- */
/* tovo - alle udregninger. Ét sted, to koeresteder.
 *
 * Denne fil koeres BEGGE steder: serveren require'r den, og build_rune.py
 * praeplacerer den i app.js. Webappen og MCP skal give SAMME tal - ellers er
 * der to sandheder, og det er den fejl, hele modulet findes for at forhindre
 * (Beanledger v28).
 *
 * Modulet kender hverken databasen eller frontendens state. Soemmen er de
 * data, kaldsstedet leverer ind - intet andet.
 *
 * **Skriv aldrig en beregning i app/parts/ - heller ikke en lille.**
 *
 * Soemmen mod omverdenen er `opret({items, entries, settings})`. Modulet
 * kender hverken databasen eller frontendens state - kun de tre funktioner,
 * kaldsstedet giver det.
 *
 * NB: planen skrev soemmen som `items(kind)` og `settings()`. Tidsposter fik
 * senere i samme plan deres EGEN tabel (de forespoerges paa tidsinterval og
 * summeres), saa `entries()` er kommet til. Det er den samme tanke: modulet
 * faar data ind og regner - det henter aldrig selv.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.tovoBeregn = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Tolker en varighed til MINUTTER.
   *
   * Forstaar: `2t` `2 timer` `2h` `2 hours` · `90m` `90 min` · `1,5t` `1.5t`
   * `1t30m` `1h 30m` · `1:30` · og et bart tal, der laeses som TIMER.
   *
   * Dansk decimalkomma er ikke valgfrit. `10.000` er ti tusinde og `14,25` er
   * fjorten en kvart - en naiv parseFloat laeser `1,5` som 1 og taber en halv
   * time i hver eneste registrering (§7's num()-laerdom).
   *
   * @returns {number|null} minutter, eller null hvis teksten ikke er en varighed
   */
  function parseVarighed(raa) {
    const t = String(raa == null ? '' : raa).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!t) return null;

    // 1:30 = én time og tredive minutter. Skal staa foer tal-tolkningen,
    // ellers spises "1" og ":30" bliver til ingenting.
    let m = t.match(/^(\d{1,3}):([0-5]\d)$/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);

    // Sammensat: "1t30m", "1 h 30 min", "2 timer 15 minutter".
    m = t.match(/^(\d+)\s*(?:t|h|time(?:r)?|hour(?:s)?)\s*(\d{1,2})\s*(?:m|min(?:ut(?:ter|es?)?)?)?$/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);

    // Ét tal med en enhed. Kommaet skiftes til punktum FOER parseFloat.
    m = t.match(/^(\d+(?:[.,]\d+)?)\s*(t|h|time(?:r)?|hour(?:s)?|m|min(?:ut(?:ter|es?)?)?)?$/);
    if (!m) return null;
    const tal = parseFloat(m[1].replace(',', '.'));
    if (!isFinite(tal) || tal < 0) return null;
    const enhed = m[2] || '';
    // Uden enhed er det TIMER. "~2" betyder to timer, ikke to minutter -
    // ingen skriver et estimat i minutter uden at skrive m.
    const minutter = /^m/.test(enhed) ? tal : tal * 60;
    const rundet = Math.round(minutter);
    // Et estimat paa nul er ikke et estimat, og et paa et aar er en tastefejl.
    if (rundet <= 0 || rundet > 365 * 24 * 60) return null;
    return rundet;
  }

  /**
   * Minutter -> laesbar tekst. Interfacet er engelsk, saa udskriften er det.
   *
   * @param {object} [opt] {lang: 'kort'|'decimal'} - decimal giver "1.5 h",
   *   som er det, en afstemning mod et andet system skal bruge.
   */
  function formatVarighed(minutter, opt) {
    const m = Math.round(Number(minutter) || 0);
    if (m <= 0) return '0m';
    if (opt && opt.form === 'decimal') return `${(m / 60).toFixed(2).replace(/\.?0+$/, '')}h`;
    const t = Math.floor(m / 60);
    const rest = m % 60;
    if (!t) return `${rest}m`;
    if (!rest) return `${t}h`;
    return `${t}h ${rest}m`;
  }

  /**
   * Minutter -> DECIMALTIMER med dansk komma: 3,5 · 0,25 · 7,05.
   *
   * Det er den form, timerne overfoeres i til et andet system - dér skriver
   * man 3,5 og ikke "3h 30m". To decimaler: et kvarter er 0,25, og et minut
   * er 0,02, saa der er ikke noget at hente ved flere.
   *
   * Bemaerk: summen af afrundede decimaler er ikke altid den afrundede sum
   * (3 x 3h 20m = 3,33 + 3,33 + 3,33 = 9,99 mod 10). MINUTTERNE bagved er
   * eksakte, og totalerne regnes paa dem - ikke paa de viste tal.
   */
  function formatDecimal(minutter) {
    const m = Math.round(Number(minutter) || 0);
    const timer = Math.round((m / 60) * 100) / 100;
    return String(timer).replace('.', ',');
  }

  /**
   * Sekunder -> et UR: 0:07 · 12:34 · 1:02:03.
   *
   * formatVarighed skriver "1h 30m", som er rigtigt i en liste og forkert paa
   * en koerende timer: den skal kunne SES taelle. Derfor sekunder her - og
   * kun her, saa der stadig kun findes ét sted, tid bliver til tekst.
   */
  function formatUr(sekunder) {
    const s = Math.max(0, Math.floor(Number(sekunder) || 0));
    const t = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rest = s % 60;
    const to = (n) => String(n).padStart(2, '0');
    return t ? `${t}:${to(m)}:${to(rest)}` : `${m}:${to(rest)}`;
  }

  /* ------------------------------------------------------- tidsrum */

  /**
   * Tolker et manuelt tidsrum: enten et INTERVAL eller en VARIGHED.
   *
   * Forstaar `9-11.30`, `9:00-11:30`, `09-11`, og alt hvad parseVarighed kan
   * (`1,5t`, `90m`, `1t30m`). Det er to forskellige maader at huske den samme
   * time paa, og folk bruger dem i floeng - derfor ét felt, ikke to.
   *
   * @param {string} raa
   * @param {string} isoDato  YYYY-MM-DD, dagen posten hoerer til
   * @returns {{minutter, fra, til}|null} fra/til er "HH:MM" ved et interval,
   *   null ved en ren varighed (saa vaelger kaldsstedet placeringen).
   */
  function parseTidsrum(raa, isoDato) {
    const t = String(raa == null ? '' : raa).trim().toLowerCase().replace(/\s+/g, '');
    if (!t) return null;

    const klokke = (timer, min) => {
      const h = parseInt(timer, 10);
      const m = min === undefined || min === '' ? 0 : parseInt(min, 10);
      if (h > 23 || m > 59) return null;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    // 9-11.30 · 9:00-11:30 · 09.15 - 11.45  (baade . og : som skilletegn)
    const m = t.match(/^(\d{1,2})(?:[.:](\d{2}))?-(\d{1,2})(?:[.:](\d{2}))?$/);
    if (m) {
      const fra = klokke(m[1], m[2]);
      const til = klokke(m[3], m[4]);
      if (!fra || !til) return null;
      const minutter = tilMinutter(til) - tilMinutter(fra);
      // Et interval, der slutter foer det begynder, er en tastefejl - ikke en
      // vagt hen over midnat. Den ville ellers give en negativ dag i en
      // ugesum, og DET er svaert at faa oeje paa.
      if (minutter <= 0) return null;
      return { minutter, fra, til, dato: isoDato || null };
    }

    const minutter = parseVarighed(raa);
    return minutter ? { minutter, fra: null, til: null, dato: isoDato || null } : null;
  }

  function tilMinutter(hhmm) {
    const [h, m] = String(hhmm).split(':');
    return parseInt(h, 10) * 60 + parseInt(m, 10);
  }

  /**
   * Hvor paa dagen lander en post, der kun har en VARIGHED?
   *
   * Efter dagens sidste post, ellers kl. 9. Reglen er et valg, ikke en
   * sandhed - men et valg er noedvendigt: uden det ville tre poster paa
   * samme dag ligge oven i hinanden, og dagsvisningen i fase 9 ville vise
   * tre samtidige stykker arbejde.
   *
   * @param {array} dagensPoster poster PAA den dato, sorteret eller ej
   * @param {string} isoDato
   * @param {number} minutter
   * @returns {{startedAt, stoppedAt}} unix-sekunder i LOKAL tid
   */
  function placerVarighed(dagensPoster, isoDato, minutter) {
    const [aa, mm, dd] = String(isoDato).split('-').map(Number);
    const sidste = (dagensPoster || []).reduce(
      (n, p) => Math.max(n, p.stoppedAt || p.startedAt || 0), 0);
    const kl9 = Math.floor(new Date(aa, mm - 1, dd, 9, 0, 0).getTime() / 1000);
    const start = sidste > kl9 ? sidste : kl9;
    return { startedAt: start, stoppedAt: start + minutter * 60 };
  }

  /** Klokkeslaet paa en dato -> unix-sekunder i LOKAL tid. Aldrig UTC. */
  function tidspunkt(isoDato, hhmm) {
    const [aa, mm, dd] = String(isoDato).split('-').map(Number);
    const [t, m] = String(hhmm).split(':').map(Number);
    return Math.floor(new Date(aa, mm - 1, dd, t, m, 0).getTime() / 1000);
  }

  /* ------------------------------------------------------- afrunding */

  /**
   * Afrunding til naermeste N minutter.
   *
   * Anvendes ved VISNING og i rapporter - aldrig destruktivt paa den gemte
   * post. Den rigtige tid staar altid i databasen, og en aendret regel skal
   * kunne aendre alle tal med tilbagevirkende kraft.
   *
   * En post paa 2 minutter med 15-minutters afrunding bliver til 15, ikke 0:
   * et stykke arbejde, der er registreret, maa ikke kunne runde sig selv vaek.
   */
  function afrund(minutter, regel) {
    const n = Number(regel) || 0;
    const m = Math.round(Number(minutter) || 0);
    if (n <= 1 || m <= 0) return m;
    return Math.max(n, Math.round(m / n) * n);
  }

  /* --------------------------------------------------------- modulet */

  /**
   * @param {object} kilder
   *   items(kind)  -> array af projekter/opgaver/kommentarer/tags
   *   entries()    -> array af tidsposter {id, taskId, startedAt, stoppedAt, source}
   *   settings()   -> {rounding, normWeekHours, timerWarnHours}
   */
  function opret(kilder) {
    const items = (kind) => kilder.items(kind) || [];
    const entries = () => kilder.entries() || [];
    const settings = () => kilder.settings() || {};

    const afrunding = () => Number(settings().rounding) || 0;

    /** Varigheden af ÉN post. En koerende post maales mod nu. */
    function varighed(post, nu) {
      const slut = post.stoppedAt || Math.floor((nu || Date.now()) / 1000);
      return Math.max(0, Math.round((slut - post.startedAt) / 60));
    }

    /** Summen af en raekke poster, med afrunding pr. POST. */
    function sum(poster, nu) {
      const r = afrunding();
      return poster.reduce((n, p) => n + afrund(varighed(p, nu), r), 0);
    }

    function forbrugPaaOpgave(taskId, nu) {
      return sum(entries().filter((e) => e.taskId === taskId), nu);
    }

    function forbrugPaaProjekt(projectId, nu) {
      const iProjektet = new Set(items('task')
        .filter((t) => t.projectId === projectId).map((t) => t.id));
      return sum(entries().filter((e) => iProjektet.has(e.taskId)), nu);
    }

    /**
     * Forbruget paa opgaver UDEN projekt.
     *
     * Ad hoc-arbejde er ikke et projekt med et tomt navn - det er sin egen
     * kategori, og den skal kunne summeres for sig. Ellers kan man ikke
     * svare paa "hvor meget gik der til smaating".
     */
    function forbrugUdenProjekt(nu) {
      const uden = new Set(items('task').filter((t) => !t.projectId).map((t) => t.id));
      return sum(entries().filter((e) => uden.has(e.taskId)), nu);
    }

    /**
     * De TRE niveauer, et projekt skal kunne svare paa (fase 4):
     * summen af opgaveestimater, den manuelle projektramme, og det forbrugte.
     *
     * De er tre forskellige ting, og forskellen mellem dem er hele pointen:
     * naar estimaterne overstiger rammen, er der fundet mere arbejde end der
     * er solgt - og det skal ses, foer timerne er brugt.
     */
    function rollupProjekt(projectId, nu) {
      const opgaver = items('task').filter((t) => t.projectId === projectId);
      const projekt = items('project').find((p) => p.id === projectId) || {};
      const estimat = opgaver.reduce((n, t) => n + (Number(t.estimateMinutes) || 0), 0);
      const ramme = Math.round((Number(projekt.budgetHours) || 0) * 60);
      const forbrugt = forbrugPaaProjekt(projectId, nu);
      return {
        estimat,
        ramme,
        forbrugt,
        // Uden en ramme er der intet at vaere over eller under - saa er
        // resten null frem for et tal, der ligner en sandhed.
        resterende: ramme ? ramme - forbrugt : null,
        procent: ramme ? Math.round((forbrugt / ramme) * 100) : null,
        estimatOverRamme: !!(ramme && estimat > ramme),
        aabne: opgaver.filter((t) => t.status !== 'done').length,
        opgaver: opgaver.length,
      };
    }

    /**
     * Summen i en periode, grupperet pr. projekt og opgave.
     *
     * @param {number} fra  unix-sekunder, med i perioden
     * @param {number} til  unix-sekunder, IKKE med (halvaabent interval, saa
     *   to naboperioder hverken taeller en post to gange eller taber den)
     */
    function sumPeriode(fra, til, nu) {
      const opgaver = new Map(items('task').map((t) => [t.id, t]));
      const projekter = new Map(items('project').map((p) => [p.id, p]));
      const r = afrunding();
      const iPerioden = entries().filter((e) => e.startedAt >= fra && e.startedAt < til);

      const pr = new Map();
      let total = 0;
      for (const e of iPerioden) {
        const minutter = afrund(varighed(e, nu), r);
        total += minutter;
        const opgave = opgaver.get(e.taskId);
        const pid = opgave && opgave.projectId ? opgave.projectId : null;
        if (!pr.has(pid)) {
          const p = pid ? projekter.get(pid) : null;
          pr.set(pid, { projectId: pid, name: p ? p.name : 'Ad hoc', minutter: 0, tasks: new Map() });
        }
        const gruppe = pr.get(pid);
        gruppe.minutter += minutter;
        const nuvaerende = gruppe.tasks.get(e.taskId) || {
          taskId: e.taskId,
          title: opgave ? opgave.title : 'Deleted task',
          minutter: 0,
          estimateMinutes: opgave ? (opgave.estimateMinutes || null) : null,
          completedIPerioden: !!(opgave && opgave.completedAt >= fra && opgave.completedAt < til),
        };
        nuvaerende.minutter += minutter;
        gruppe.tasks.set(e.taskId, nuvaerende);
      }

      return {
        total,
        entries: iPerioden.length,
        projects: [...pr.values()]
          .map((g) => ({ ...g, tasks: [...g.tasks.values()].sort((a, b) => b.minutter - a.minutter) }))
          .sort((a, b) => b.minutter - a.minutter),
      };
    }

    /**
     * Ugerapportens tal.
     *
     * Formaalet er AFSTEMNING mod et andet system og et overblik til en
     * kunde, der spoerger - ikke en integration. Derfor: alt hvad rapporten
     * viser, kommer herfra, saa MCP'ens week_report giver noejagtig samme
     * tal som siden (§9a).
     */
    /**
     * Sagsnummeret paa en opgave: opgavens eget, ellers projektets.
     *
     * Ét projekt er tit én sag. Reglen bor HER, saa rapporten, MCP og
     * webappen ikke kan komme til at arve forskelligt.
     */
    function sagFor(opgave, projekter) {
      if (!opgave) return '';
      if (opgave.caseNumber) return opgave.caseNumber;
      const p = opgave.projectId ? projekter.get(opgave.projectId) : null;
      return (p && p.caseNumber) || '';
    }

    function ugerapport(fra, til, nu) {
      const s = sumPeriode(fra, til, nu);
      const dage = sumPrDag(fra, til, nu);
      const norm = Math.round((Number(settings().normWeekHours) || 0) * 60);

      // Ad hoc = tid paa opgaver uden projekt. Fordelingen er hele
      // pointen for den, der skal forklare sin uge.
      const adhoc = s.projects.find((p) => p.projectId === null);
      const paaProjekt = s.total - (adhoc ? adhoc.minutter : 0);

      // Dage med paafaldende faa timer er dét, der afsloerer glemt
      // registrering. En dag UDEN noget er ikke paafaldende - det kan vaere
      // en fridag; en dag med under en fjerdedel af en normal dag er.
      const dagsnorm = norm ? Math.round(norm / 5) : 0;
      const dagsliste = [];
      for (let t = fra; t < til; t += 86400) {
        const d = new Date(t * 1000);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const minutter = dage.get(iso) || 0;
        const hverdag = d.getDay() >= 1 && d.getDay() <= 5;
        dagsliste.push({
          date: iso,
          weekday: d.getDay(),
          minutter,
          tynd: !!(hverdag && dagsnorm && minutter > 0 && minutter < dagsnorm / 2),
          tom: hverdag && minutter === 0,
        });
      }

      /*
       * Pr. SAG. Det er den opgoerelse, timerne skal afstemmes efter i det
       * andet system - og derfor den, der skal kunne kopieres ud.
       */
      const opgaver = new Map(items('task').map((t) => [t.id, t]));
      const projekter = new Map(items('project').map((p) => [p.id, p]));
      const afrunding2 = afrunding();
      const sager = new Map();
      for (const e of entries()) {
        if (e.startedAt < fra || e.startedAt >= til) continue;
        const opgave = opgaver.get(e.taskId);
        const sag = sagFor(opgave, projekter) || '(no case number)';
        const minutter = afrund(varighed(e, nu), afrunding2);
        if (!sager.has(sag)) sager.set(sag, { case: sag, minutter: 0, tasks: new Map() });
        const g = sager.get(sag);
        g.minutter += minutter;
        const navn = opgave ? opgave.title : 'Deleted task';
        g.tasks.set(e.taskId, {
          taskId: e.taskId, title: navn, minutter: (g.tasks.get(e.taskId) || { minutter: 0 }).minutter + minutter,
        });
      }

      return {
        fra,
        til,
        total: s.total,
        entries: s.entries,
        projects: s.projects,
        cases: [...sager.values()]
          .map((g) => ({ ...g, tasks: [...g.tasks.values()].sort((a, b) => b.minutter - a.minutter) }))
          .sort((a, b) => b.minutter - a.minutter),
        adhoc: adhoc ? adhoc.minutter : 0,
        onProjects: paaProjekt,
        norm,
        // Forskellen mod normtiden er et TAL, ikke en dom. Den kan vaere
        // negativ, og det er i orden.
        overNorm: norm ? s.total - norm : null,
        days: dagsliste,
        // Afsluttet i perioden vs. stadig i gang - de to spoergsmaal er
        // forskellige, og rapporten skal svare paa begge.
        completed: s.projects.reduce((n, p) => n + p.tasks.filter((t) => t.completedIPerioden).length, 0),
      };
    }

    /**
     * HULLERNE paa en dag.
     *
     * Det er den funktion, der afsloerer glemt registrering: mellemrummene
     * mellem det, der ER registreret, fra dagens foerste post til dens
     * sidste. Der gaettes ikke paa en arbejdsdag - kun det, der faktisk staar
     * imellem to registreringer, er et hul. Et hul foer den foerste post er
     * ikke glemt tid; det er morgen.
     *
     * @param {number} mindst  minutter - mindre huller er frokost og kaffe
     * @returns {array} [{fra, til, minutter}] med "HH:MM"
     */
    function hullerPaaDag(isoDato, mindst, nu) {
      const graense = Number(mindst) || 20;
      const start = Math.floor(new Date(`${isoDato}T00:00:00`).getTime() / 1000);
      const dagens = entries()
        .filter((e) => e.startedAt >= start && e.startedAt < start + 86400)
        .slice()
        .sort((a, b) => a.startedAt - b.startedAt);
      if (dagens.length < 2) return [];

      const kl = (unix) => {
        const d = new Date(unix * 1000);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      };

      const huller = [];
      let sidsteSlut = dagens[0].stoppedAt || Math.floor((nu || Date.now()) / 1000);
      for (const e of dagens.slice(1)) {
        const minutter = Math.round((e.startedAt - sidsteSlut) / 60);
        if (minutter >= graense) {
          huller.push({ fra: kl(sidsteSlut), til: kl(e.startedAt), minutter });
        }
        sidsteSlut = Math.max(sidsteSlut, e.stoppedAt || Math.floor((nu || Date.now()) / 1000));
      }
      return huller;
    }

    /**
     * TIMESEDLEN: timer pr. dag pr. opgave, med sagsnummer.
     *
     * Det er den opgoerelse, man skriver af, naar timerne skal ind i et andet
     * system: én raekke pr. opgave, én kolonne pr. dag, og sagsnummeret
     * forrest, fordi det er noeglen dér.
     */
    function timeseddel(fra, til, nu) {
      const opgaver = new Map(items('task').map((t) => [t.id, t]));
      const projekter = new Map(items('project').map((p) => [p.id, p]));
      const r = afrunding();

      const dage = [];
      for (let t = fra; t < til; t += 86400) {
        const d = new Date(t * 1000);
        dage.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      }

      const raekker = new Map();
      for (const e of entries()) {
        if (e.startedAt < fra || e.startedAt >= til) continue;
        const d = new Date(e.startedAt * 1000);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const opgave = opgaver.get(e.taskId);
        const projekt = opgave && opgave.projectId ? projekter.get(opgave.projectId) : null;
        if (!raekker.has(e.taskId)) {
          raekker.set(e.taskId, {
            taskId: e.taskId,
            title: opgave ? opgave.title : 'Deleted task',
            case: sagFor(opgave, projekter),
            project: projekt ? projekt.name : '',
            dage: {},
            total: 0,
          });
        }
        const raekke = raekker.get(e.taskId);
        const minutter = afrund(varighed(e, nu), r);
        raekke.dage[iso] = (raekke.dage[iso] || 0) + minutter;
        raekke.total += minutter;
      }

      const liste = [...raekker.values()].sort((a, b) => String(a.case).localeCompare(String(b.case))
        || String(a.project).localeCompare(String(b.project))
        || b.total - a.total);

      /*
       * SAMME seddel, rullet op paa SAG.
       *
       * Det er den, timerne skrives af fra: i det andet system registreres
       * der pr. dag pr. sagsnummer, ikke pr. opgave. En total for hele ugen
       * kan ikke bruges til det - man skal vide, hvad der gik paa sagen om
       * mandagen.
       */
      const perSag = new Map();
      for (const raekke of liste) {
        const sag = raekke.case || '';
        if (!perSag.has(sag)) perSag.set(sag, { case: sag, dage: {}, total: 0, tasks: [] });
        const g = perSag.get(sag);
        g.tasks.push(raekke.title);
        g.total += raekke.total;
        for (const [iso, m] of Object.entries(raekke.dage)) g.dage[iso] = (g.dage[iso] || 0) + m;
      }
      const sagsliste = [...perSag.values()].sort((a, b) => {
        // Det uden sagsnummer staar NEDERST: det er ikke noget, der skal
        // registreres et andet sted - men det skal med, ellers stemmer
        // totalen ikke.
        if (!a.case !== !b.case) return a.case ? -1 : 1;
        return String(a.case).localeCompare(String(b.case));
      });
      // Kolonnesummerne skal kunne laegges sammen til totalen - ellers kan en
      // timeseddel ikke afstemmes med sig selv.
      const prDag = {};
      for (const iso of dage) prDag[iso] = liste.reduce((n, x) => n + (x.dage[iso] || 0), 0);
      return {
        dage,
        rows: liste,
        caseRows: sagsliste,
        perDay: prDag,
        total: liste.reduce((n, x) => n + x.total, 0),
      };
    }

    /** Minutter pr. dato i perioden - grundlaget for dagsvisningen. */
    function sumPrDag(fra, til, nu) {
      const r = afrunding();
      const dage = new Map();
      for (const e of entries()) {
        if (e.startedAt < fra || e.startedAt >= til) continue;
        const d = new Date(e.startedAt * 1000);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        dage.set(iso, (dage.get(iso) || 0) + afrund(varighed(e, nu), r));
      }
      return dage;
    }

    return {
      varighed, forbrugPaaOpgave, forbrugPaaProjekt, forbrugUdenProjekt, rollupProjekt,
      sumPeriode, sumPrDag, ugerapport, timeseddel, hullerPaaDag, sagFor, afrunding,
    };
  }

  return {
    parseVarighed, formatVarighed, formatDecimal, formatUr, parseTidsrum, placerVarighed,
    tidspunkt, afrund, opret,
  };
}));

/* ---- shared/parse.js ---- */
/* tovo - faelles parser for genvejssyntaks og dansk datosprog.
 *
 * Kopieret fra doda (app/shared/parse.js) og AENDRET paa ét sted: markoererne.
 * Datosproget og gentagelses-motoren staar ordret som i doda - de er
 * gennemtestede, og en omskrivning ville kun koste fejl.
 *
 * Denne fil koeres BEGGE steder: serveren require'r den, og build_rune.py
 * praeplacerer den i app.js. Fangst fra webappen, fra et start-link og fra
 * MCP skal tolke praecis den samme tekst. Retter du noget her, gaelder det
 * alle veje ind i appen.
 *
 * FORSKELLEN FRA DODA, som man skal kende for ikke at kopiere forkert:
 *
 *   doda:  # kontekst   @ // projekt   ! dato/gentagelse   ~ UDSKUDT DATO
 *   tovo:  # tag        @ // projekt   ! dato/gentagelse   ~ ESTIMAT
 *
 * tovo har ingen udskudt dato, saa `~` er genbrugt. Defer-grenen er FJERNET,
 * ikke ladt ligge: en parser, der producerer et felt, modtageren ikke har,
 * taber tekst tavst (doda 2026-08-18).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.tovoParse = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Varighedsregningen bor i beregn.js - ALLE udregninger goer det, saa
     webappen og MCP ikke kan komme til at svare forskelligt. Build'et samler
     app/shared/*.js alfabetisk, saa beregn.js ligger foer denne fil i app.js
     og er defineret, naar `~` skal tolkes. */
  const beregn = (typeof module === 'object' && module.exports)
    ? require('./beregn.js')
    : (typeof self !== 'undefined' ? self.tovoBeregn : this.tovoBeregn);

  /* Parseren er TOSPROGET. Interfacet er engelsk, saa engelsk er det primaere
     sprog - men de danske ord bliver ved med at virke, sa gammel vane og
     aeldre fangster ikke pludselig fejler. Det koster kun opslag i tabellerne.
     Se DESIGN.md §3. */

  const UGEDAGE = {
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
    mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, sun: 7,
    mandag: 1, tirsdag: 2, onsdag: 3, torsdag: 4, fredag: 5, lørdag: 6, lordag: 6, søndag: 7, sondag: 7,
    man: 1, tir: 2, ons: 3, tor: 4, fre: 5, lør: 6, lor: 6, søn: 7, son: 7,
  };

  const MAANEDER = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    januar: 1, februar: 2, marts: 3, maj: 5, juni: 6, juli: 7, oktober: 10,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
    sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12,
  };

  const TALORD = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, a: 1, an: 1,
    en: 1, et: 1, to: 2, tre: 3, fire: 4, fem: 5, seks: 6, syv: 7, otte: 8, ni: 9, ti: 10,
    elleve: 11, tolv: 12, anden: 2, andet: 2, tredje: 3, fjerde: 4, femte: 5,
  };

  /* ------------------------------------------------------------ datoer */

  // Datoer regnes i LOKAL tid og gemmes som YYYY-MM-DD. Aldrig som
  // UTC-tidsstempel - ellers driver "hver mandag kl. 8" hen over
  // sommertidsskiftet (DESIGN.md §4).
  function fmtDato(d) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dag = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${dag}`;
  }

  function isoUgedag(d) {
    const n = d.getDay();
    return n === 0 ? 7 : n;
  }

  function plusDage(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function plusMaaneder(d, n) {
    const maal = new Date(d.getFullYear(), d.getMonth() + n, 1);
    // Klem dagen ned, saa 31. januar + 1 maaned bliver 28./29. februar
    // og ikke smutter over i marts.
    const sidste = new Date(maal.getFullYear(), maal.getMonth() + 1, 0).getDate();
    return new Date(maal.getFullYear(), maal.getMonth(), Math.min(d.getDate(), sidste));
  }

  function sidsteIMaaned(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  }

  function tal(ord) {
    if (/^\d+$/.test(ord)) return parseInt(ord, 10);
    return TALORD[ord] || null;
  }

  function findKlokkeslaet(tekst) {
    // "at 8", "at 8pm", "kl 8", "kl. 8.30", eller et bart "14:30".
    let m = tekst.match(/\b(?:at|kl\.?)\s*(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?\b/i);
    if (!m) m = tekst.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/);
    if (!m) return { tid: null, rest: tekst };
    let t = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const suffiks = (m[3] || '').toLowerCase();
    if (suffiks === 'pm' && t < 12) t += 12;
    if (suffiks === 'am' && t === 12) t = 0;
    if (t > 23 || min > 59) return { tid: null, rest: tekst };
    return {
      tid: `${String(t).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
      rest: (tekst.slice(0, m.index) + ' ' + tekst.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(),
    };
  }

  /**
   * Tolker en dansk datofrase. Returnerer {dato, tid} eller null.
   * Omfanget er bevidst lille - se DESIGN.md §3. Kan en frase ikke tolkes,
   * skal fangsten stadig lykkes; det er kaldsstedets ansvar.
   */
  function tolkDato(frase, nu) {
    const base = nu ? new Date(nu) : new Date();
    const iDag = new Date(base.getFullYear(), base.getMonth(), base.getDate());

    const k = findKlokkeslaet(String(frase || ''));
    const tid = k.tid;
    let t = k.rest.toLowerCase().trim().replace(/\.$/, '');
    if (!t) return tid ? { dato: fmtDato(iDag), tid } : null;

    const svar = (d) => ({ dato: fmtDato(d), tid });

    if (/^(today|i\s?dag)$/.test(t)) return svar(iDag);
    if (/^(tomorrow|tmr|i\s?morgen)$/.test(t)) return svar(plusDage(iDag, 1));
    if (/^(day\s+after\s+tomorrow|(i\s?)?overmorgen)$/.test(t)) return svar(plusDage(iDag, 2));
    if (/^(yesterday|i\s?går)$/.test(t)) return svar(plusDage(iDag, -1));

    if (/^next\s+week$|^næste\s+uge$/.test(t)) return svar(plusDage(iDag, 7));
    if (/^next\s+month$|^næste\s+måned$/.test(t)) return svar(plusMaaneder(iDag, 1));
    if (/^(end\s+of\s+(the\s+)?month|ultimo|sidste\s+dag\s+i)\s*(måneden|denne\s+måned)?$/.test(t)) {
      return svar(sidsteIMaaned(iDag));
    }
    if (/^(start\s+of\s+next\s+month|primo)\s*(måneden|næste\s+måned)?$/.test(t)) {
      const n = plusMaaneder(iDag, 1);
      return svar(new Date(n.getFullYear(), n.getMonth(), 1));
    }
    if (/^(the\s+)?weekend(en)?$/.test(t)) {
      const diff = (6 - isoUgedag(iDag) + 7) % 7;
      return svar(plusDage(iDag, diff === 0 ? 7 : diff));
    }

    // "in 3 days", "in two weeks", "om 3 dage", "om en måned"
    let m = t.match(/^(?:in|om)\s+(\S+)\s+(day|days|week|weeks|month|months|year|years|dag|dage|uge|uger|måned|måneder|år)$/);
    if (m) {
      const n = tal(m[1]);
      if (n === null) return null;
      if (/^(day|dag)/.test(m[2])) return svar(plusDage(iDag, n));
      if (/^(week|uge)/.test(m[2])) return svar(plusDage(iDag, n * 7));
      if (/^(month|måned)/.test(m[2])) return svar(plusMaaneder(iDag, n));
      return svar(plusMaaneder(iDag, n * 12));
    }

    // Ugedag. "monday" = naeste forekomst, i dag hvis i dag er mandag.
    // "next monday" = altid en uge senere end det. Reglen er et valg,
    // ikke en sandhed - den staar dokumenteret i DESIGN.md §3.
    m = t.match(/^(on\s+|this\s+|next\s+|på\s+|næste\s+|nu\s+på\s+)?([a-zæøå]+)$/);
    if (m && UGEDAGE[m[2]]) {
      const maal = UGEDAGE[m[2]];
      let diff = (maal - isoUgedag(iDag) + 7) % 7;
      if (/next|næste/.test(m[1] || '')) diff += 7;
      return svar(plusDage(iDag, diff));
    }

    // 3/9, 3/9-2027, 3/9/2027, 03.09.2027
    m = t.match(/^(\d{1,2})[/.](\d{1,2})(?:[-/.](\d{2,4}))?$/);
    if (m) {
      const dag = parseInt(m[1], 10);
      const maaned = parseInt(m[2], 10);
      if (dag < 1 || dag > 31 || maaned < 1 || maaned > 12) return null;
      let aar = m[3] ? parseInt(m[3], 10) : iDag.getFullYear();
      if (aar < 100) aar += 2000;
      const d = new Date(aar, maaned - 1, dag);
      if (d.getMonth() !== maaned - 1) return null; // fx 31/2
      // Uden aarstal: en dato der allerede er passeret, menes naeste aar.
      if (!m[3] && d < iDag) return svar(new Date(aar + 1, maaned - 1, dag));
      return svar(d);
    }

    // Maanedsnavn i begge ordstillinger: "3 sep" / "3. september" (dansk vane)
    // og "sep 3" / "december 24" (engelsk vane).
    let dag = null;
    let maanedsnavn = null;
    m = t.match(/^(\d{1,2})\.?\s+([a-zæøå]+)\.?(?:,?\s+(\d{4}))?$/);
    if (m) { dag = parseInt(m[1], 10); maanedsnavn = m[2]; }
    else {
      m = t.match(/^([a-zæøå]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\.?(?:,?\s+(\d{4}))?$/);
      if (m) { dag = parseInt(m[2], 10); maanedsnavn = m[1]; }
    }
    if (m && MAANEDER[maanedsnavn]) {
      const maaned = MAANEDER[maanedsnavn];
      const aar = m[3] ? parseInt(m[3], 10) : iDag.getFullYear();
      const d = new Date(aar, maaned - 1, dag);
      if (d.getMonth() !== maaned - 1) return null;
      if (!m[3] && d < iDag) return svar(new Date(aar + 1, maaned - 1, dag));
      return svar(d);
    }

    return null;
  }

  /* ------------------------------------------------------- gentagelser */

  // F1 genkender kun at der ER tale om en gentagelse, sa chippen kan sige det
  // aerligt. Selve grammatikken og motoren bygges i F4.
  function erGentagelse(frase) {
    const t = String(frase || '').trim();
    return /^(every|hvert?)\s*!?\s*\S/i.test(t) || BARE_FORMER.test(t);
  }

  /**
   * Tolker en gentagelsesfrase til en regel.
   *
   * Syntaksen er Todoists (Andreas' valg): et `!` lige efter "every"/"hver"
   * betyder **fra fuldfoerelse** - naeste forekomst opstar foerst, nar den
   * forrige er markeret udfoert. Uden `!` er det en **fast plan**, der
   * forfalder pa sin dato, uanset om den forrige blev lavet.
   *
   * @returns regel-objekt eller null
   */
  // "last workday of the month" er en gentagelse i sig selv - den giver ingen
  // mening som engangsdato, og Todoist tillader den uden "every". Formerne
  // star ÉT sted, sa erGentagelse() og tolkGentagelse() ikke kan komme i utakt.
  const BARE_FORMER = /^(last|first|sidste|første|foerste)\s+(day|dag|workday|weekday|hverdag)\s+(of the|i)\s+(month|måneden|maaneden)$/i;

  function tolkGentagelse(frase, nu) {
    const raa = String(frase || '').trim();
    const m = raa.match(/^(every|hvert?)\s*(!?)\s*(.*)$/i);
    // Uden "every" accepteres kun de bare former - ellers ville "monday"
    // blive laest som en ugentlig gentagelse i stedet for en dato.
    if (!m && !BARE_FORMER.test(raa)) return null;

    const base = nu ? new Date(nu) : new Date();
    const iDag = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    const mode = m && m[2] === '!' ? 'completion' : 'schedule';

    const k = findKlokkeslaet(m ? m[3] : raa);
    const tid = k.tid;
    let t = k.rest.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!t) return null;

    const regel = {
      mode, freq: null, interval: 1, weekdays: null, monthday: null,
      month: null, day: null, time: tid, text: raa, anchor: fmtDato(iDag),
    };

    // "other"/"anden" = hver anden. Ordenstal skrives ogsaa som "2." og "2nd".
    t = t.replace(/^(other|anden|andet)\s+/, '2 ');

    // "15th of the month" SKAL afgoeres foer intervallet trakkes ud - ellers
    // laeses tallet som "hver 15." noget, og dag-i-maaneden forsvinder.
    const dagIMaaned = t.match(/^(?:the\s+|den\s+)?(\d{1,2})[.]?(?:st|nd|rd|th)?\s+(?:of the month|i måneden|i maaneden)$/);
    if (dagIMaaned) {
      const dag = parseInt(dagIMaaned[1], 10);
      if (dag < 1 || dag > 31) return null;
      return Object.assign(regel, { freq: 'month', monthday: dag });
    }

    const antal = t.match(/^(\d+)[.]?(?:st|nd|rd|th)?\s+(.*)$/);
    if (antal) { regel.interval = Math.min(Math.max(parseInt(antal[1], 10), 1), 999); t = antal[2]; }

    // Maanedens sidste/foerste (hver)dag - staar uden "every" i praksis,
    // men vi tillader begge dele.
    if (/^(last|sidste) (workday|weekday|hverdag) (of the |i )?(month|måneden|maaneden)$/.test(t)) {
      return Object.assign(regel, { freq: 'month', monthday: 'lastworkday' });
    }
    if (/^(first|første|foerste) (workday|weekday|hverdag) (of the |i )?(month|måneden|maaneden)$/.test(t)) {
      return Object.assign(regel, { freq: 'month', monthday: 'firstworkday' });
    }
    if (/^(last|sidste) (day|dag) (of the |i )?(month|måneden|maaneden)$/.test(t)) {
      return Object.assign(regel, { freq: 'month', monthday: 'last' });
    }

    /*
     * "2 weeks on friday" - interval OG ugedag.
     *
     * TILFOEJET I TOVO (dodas parser kan det ikke): "hver anden uge paa
     * fredag" er en helt almindelig ting at skrive, og feltets egen
     * pladsholder foreslaar "every 2 weeks". Uden formen svarede den bare
     * nej. Intervallet er allerede trukket ud ovenfor, saa her staar
     * "weeks on friday" tilbage.
     */
    // `weeks?` og ikke `week|weeks`: i en alternation vinder det FOERSTE
    // traef, saa "week|weeks" matcher kun "week" af "weeks" og efterlader et
    // "s", der aldrig kan blive en ugedag. Fejlen er tavs - formen svarer
    // bare nej.
    const ugeMedDag = t.match(/^(?:weeks?|uger?)\s*(?:on|paa|på|den)?\s*(.+)$/);
    if (ugeMedDag) {
      const dele = ugeMedDag[1].split(/\s*(?:,|\band\b|\bog\b)\s*/).filter(Boolean);
      if (dele.length && dele.every((x) => UGEDAGE[x])) {
        const dage = [...new Set(dele.map((x) => UGEDAGE[x]))].sort((a, b) => a - b);
        return Object.assign(regel, { freq: 'week', weekdays: dage });
      }
    }

    // Ugedagsliste: "monday", "mon, thu", "mandag og torsdag"
    const stykker = t.split(/\s*(?:,|\band\b|\bog\b)\s*/).filter(Boolean);
    if (stykker.length && stykker.every((s) => UGEDAGE[s])) {
      const dage = [...new Set(stykker.map((s) => UGEDAGE[s]))].sort((a, b) => a - b);
      return Object.assign(regel, { freq: 'week', weekdays: dage });
    }
    if (/^(weekday|workday|hverdag)e?r?$/.test(t)) {
      return Object.assign(regel, { freq: 'week', weekdays: [1, 2, 3, 4, 5] });
    }
    if (/^(weekend|weekenden)$/.test(t)) {
      return Object.assign(regel, { freq: 'week', weekdays: [6, 7] });
    }

    // "month on the 3rd", "måned den 3.", "3rd of the month", "den 3. i måneden"
    let md = t.match(/^(?:month|måned|maaned)s?\s*(?:on the|den|d\.)\s*(\d{1,2})[.]?(?:st|nd|rd|th)?$/);
    if (!md) md = t.match(/^(?:the\s+|den\s+)?(\d{1,2})[.]?(?:st|nd|rd|th)?\s+(?:of the month|i måneden|i maaneden)$/);
    if (md) {
      const dag = parseInt(md[1], 10);
      if (dag < 1 || dag > 31) return null;
      return Object.assign(regel, { freq: 'month', monthday: dag });
    }

    // "year on 24/12", "år 24/12", "year on december 24"
    const aarlig = t.match(/^(?:year|år|aar)s?\s*(?:on|den|d\.)?\s*(.+)$/);
    if (aarlig) {
      // Foerst rent dag/maaned. tolkDato ville afvise "29/2" i et ikke-skudaar,
      // men for en AARLIG regel er aarstallet uden betydning.
      const dm = aarlig[1].trim().match(/^(\d{1,2})[/.](\d{1,2})$/);
      if (dm) {
        const dd = parseInt(dm[1], 10);
        const mm = parseInt(dm[2], 10);
        if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
        return Object.assign(regel, { freq: 'year', month: mm, day: dd });
      }
      const d = tolkDato(aarlig[1], iDag);
      if (!d) return null;
      const [, m2, d2] = d.dato.split('-').map(Number);
      return Object.assign(regel, { freq: 'year', month: m2, day: d2 });
    }

    if (/^(day|days|dag|dage)$/.test(t)) return Object.assign(regel, { freq: 'day' });
    if (/^(week|weeks|uge|uger)$/.test(t)) {
      // "hver 2. uge" uden ugedag: samme ugedag som i dag.
      return Object.assign(regel, { freq: 'week', weekdays: [isoUgedag(iDag)] });
    }
    if (/^(month|months|måned|måneder|maaned|maaneder)$/.test(t)) {
      return Object.assign(regel, { freq: 'month', monthday: iDag.getDate() });
    }
    if (/^(year|years|år|aar)$/.test(t)) {
      return Object.assign(regel, { freq: 'year', month: iDag.getMonth() + 1, day: iDag.getDate() });
    }

    return null;
  }

  /* ---------------------------------------------------------- motoren */

  function sidsteHverdag(aar, maaned0) {
    const d = new Date(aar, maaned0 + 1, 0);
    while (isoUgedag(d) > 5) d.setDate(d.getDate() - 1);
    return d;
  }

  function foersteHverdag(aar, maaned0) {
    const d = new Date(aar, maaned0, 1);
    while (isoUgedag(d) > 5) d.setDate(d.getDate() + 1);
    return d;
  }

  /** Mandagen i den uge, datoen ligger i. Bruges som fast maalepunkt. */
  function ugeStart(d) {
    return plusDage(d, -(isoUgedag(d) - 1));
  }

  /**
   * Naeste forekomst STRENGT efter `fra`.
   *
   * Al regning sker pa (ar, maned, dag) i lokal tid - aldrig pa
   * millisekunder. Det er dét, der gor, at "hver mandag kl. 8" ikke driver
   * en time hen over sommertidsskiftet (handover §5.6).
   */
  function naesteForekomst(regel, fra) {
    if (!regel || !regel.freq) return null;
    const [fy, fm, fd] = String(fra).split('-').map(Number);
    const efter = new Date(fy, fm - 1, fd);
    const interval = Math.max(regel.interval || 1, 1);

    if (regel.freq === 'day') return fmtDato(plusDage(efter, interval));

    if (regel.freq === 'week') {
      const dage = (regel.weekdays && regel.weekdays.length) ? regel.weekdays : [isoUgedag(efter)];
      const ankerUge = ugeStart(regel.anchor
        ? new Date(...regel.anchor.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))))
        : efter);
      // Gennemloeb dag for dag. Loftet er interval uger + 7 dage, sa selv
      // "hver 52. uge" finder sit svar uden at kunne loebe loebsk.
      for (let i = 1; i <= interval * 7 + 7; i++) {
        const k = plusDage(efter, i);
        if (!dage.includes(isoUgedag(k))) continue;
        const uger = Math.round((ugeStart(k) - ankerUge) / (7 * 86400000));
        if (((uger % interval) + interval) % interval === 0) return fmtDato(k);
      }
      return null;
    }

    if (regel.freq === 'month') {
      // Start i INDEVAERENDE maaned: "hver maaned den 20." set fra den 13.
      // forfalder den 20. i denne maaned, ikke foerst i den naeste.
      for (let i = 0; i <= interval * 2 + 24; i++) {
        const p = new Date(efter.getFullYear(), efter.getMonth() + i, 1);
        // Kun hver interval'te maaned taeller.
        const maanederFra = (p.getFullYear() - efter.getFullYear()) * 12 + (p.getMonth() - efter.getMonth());
        if (maanederFra % interval !== 0) continue;
        let k;
        if (regel.monthday === 'last') k = new Date(p.getFullYear(), p.getMonth() + 1, 0);
        else if (regel.monthday === 'lastworkday') k = sidsteHverdag(p.getFullYear(), p.getMonth());
        else if (regel.monthday === 'firstworkday') k = foersteHverdag(p.getFullYear(), p.getMonth());
        else {
          const sidste = new Date(p.getFullYear(), p.getMonth() + 1, 0).getDate();
          // Den 31. i en maaned med 30 dage klemmes ned til den sidste -
          // aldrig ud i den naeste maaned.
          k = new Date(p.getFullYear(), p.getMonth(), Math.min(regel.monthday || 1, sidste));
        }
        if (k > efter) return fmtDato(k);
      }
      return null;
    }

    if (regel.freq === 'year') {
      for (let i = 0; i <= interval + 1; i++) {
        const aar = efter.getFullYear() + i;
        if ((aar - efter.getFullYear()) % interval !== 0) continue;
        const sidste = new Date(aar, regel.month, 0).getDate();
        const k = new Date(aar, regel.month - 1, Math.min(regel.day, sidste));
        if (k > efter) return fmtDato(k);
      }
      return null;
    }
    return null;
  }

  /** 1st, 2nd, 3rd, 4th … 11th-13th er undtagelserne. Interfacet er engelsk. */
  function ordenstal(n) {
    const r10 = n % 10;
    const r100 = n % 100;
    if (r10 === 1 && r100 !== 11) return `${n}st`;
    if (r10 === 2 && r100 !== 12) return `${n}nd`;
    if (r10 === 3 && r100 !== 13) return `${n}rd`;
    return `${n}th`;
  }

  /** Menneskelig beskrivelse af en regel - den, brugeren ser i chippen. */
  function beskrivGentagelse(regel) {
    if (!regel || !regel.freq) return '';
    const NAVNE = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const n = regel.interval > 1 ? `every ${regel.interval} ` : 'every ';
    let s;
    if (regel.freq === 'day') s = `${n}${regel.interval > 1 ? 'days' : 'day'}`;
    else if (regel.freq === 'week') {
      const d = (regel.weekdays || []).map((x) => NAVNE[x]);
      const alle = (regel.weekdays || []).join(',');
      if (alle === '1,2,3,4,5') s = 'every weekday';
      else if (alle === '6,7') s = 'every weekend';
      else s = `${n}${regel.interval > 1 ? 'weeks on ' : ''}${d.join(' and ')}`;
    } else if (regel.freq === 'month') {
      if (regel.monthday === 'last') s = `${n}${regel.interval > 1 ? 'months, ' : ''}last day of the month`;
      else if (regel.monthday === 'lastworkday') s = `${n}${regel.interval > 1 ? 'months, ' : ''}last workday of the month`;
      else if (regel.monthday === 'firstworkday') s = `${n}${regel.interval > 1 ? 'months, ' : ''}first workday of the month`;
      else s = `${n}${regel.interval > 1 ? 'months ' : 'month '}on the ${ordenstal(regel.monthday)}`;
    } else {
      s = `${n}${regel.interval > 1 ? 'years ' : 'year '}on ${regel.day}/${regel.month}`;
    }
    if (regel.time) s += ` at ${regel.time}`;
    return s + (regel.mode === 'completion' ? ' · from completion' : ' · fixed schedule');
  }

  /* ------------------------------------------------------------ fangst */

  // BAADE @ og / peger paa et projekt. Paletten laerer brugeren "/ projects" i
  // legenden, og saa skal / ogsaa virke midt i en saetning - ellers lover
  // interfacet noget, parseren ikke holder.
  //
  // Det er ufarligt, fordi en markoer SKAL have mellemrum eller linjestart
  // foran sig: "https://dr.dk/nyheder", "3/9" og "and/or" har alle et tegn
  // foer skraastregen og roeres derfor ikke. Samme guard redder
  // "nogen@eksempel.dk" fra at blive laest som et projekt.
  /*
   * `:` er SAGSNUMMER (tovos egen markoer; doda brugte den til omraader).
   *
   * Guarden om mellemrum eller linjestart foran markoeren goer den ufarlig:
   * "kl 9:30", "note: husk" og "https://x.dk" har alle et tegn foer kolonet
   * og roeres derfor ikke. Kun " :SAG-123" og en linje, der BEGYNDER med
   * kolon, laeses som et sagsnummer.
   */
  const MARKOERER = '#@!~/:';

  /**
   * Tolker en fangst-tekst til felter.
   *
   * @param {string} raa      fx "+ opsaetning af server @Nordvind ~2,5t !fredag"
   * @param {object} [opts]   {now: Date|number} til testbarhed
   * @returns {{title, note, tags, project, due, estimateMinutes,
   *            recurrenceRule, recurrenceText, warnings}}
   */
  function tolkFangst(raa, opts) {
    opts = opts || {};
    const ud = {
      title: '', note: '',
      tags: [], project: null,
      due: null, estimateMinutes: null, caseNumber: '', startTimer: false,
      recurrenceRule: null, recurrenceText: null,
      warnings: [],
    };

    let tekst = String(raa == null ? '' : raa).replace(/\r\n/g, '\n');

    // Beskrivelse: alt efter foerste linjeskift, ellers efter foerste " // ".
    // Mellemrummene omkring // er vigtige - ellers spises "https://".
    const nl = tekst.indexOf('\n');
    if (nl >= 0) {
      ud.note = tekst.slice(nl + 1).trim();
      tekst = tekst.slice(0, nl);
    } else {
      const sep = tekst.indexOf(' // ');
      if (sep >= 0) {
        ud.note = tekst.slice(sep + 4).trim();
        tekst = tekst.slice(0, sep);
      }
    }

    /*
     * `%` = start timeren med det samme.
     *
     * Den staar UDEN FOR markoer-loekken, fordi den ikke har en vaerdi efter
     * sig: den er et flag, ikke et felt. Derfor kraeves der ogsaa mellemrum
     * eller linjeslut EFTER tegnet - saa "100% faerdig" og "5%rabat" er
     * almindelig tekst og ikke en timer, der gaar i gang.
     *
     * `/` kunne ikke bruges: den er projektmarkoer i forvejen.
     */
    const flag = tekst.match(/(^|\s)%(?=\s|$)/);
    if (flag) {
      ud.startTimer = true;
      tekst = tekst.replace(/(^|\s)%(?=\s|$)/, '$1');
    }

    // Type-praefiks. tovo har kun opgaver, saa `+` betyder "opret" og
    // ingenting andet - men den skal spises, ellers staar den i titlen.
    const p = tekst.match(/^\s*\+\s*/);
    if (p) tekst = tekst.slice(p[0].length);

    const fundne = [];
    const re = new RegExp(`(^|\\s)([${MARKOERER}])`, 'g');
    let fund;
    while ((fund = re.exec(tekst)) !== null) {
      fundne.push({ pos: fund.index + fund[1].length, tegn: fund[2] });
      re.lastIndex = fund.index + fund[0].length;
    }

    const spis = [];
    for (let i = 0; i < fundne.length; i++) {
      const her = fundne[i];
      const slut = i + 1 < fundne.length ? fundne[i + 1].pos : tekst.length;
      const raat = tekst.slice(her.pos + 1, slut);

      if (her.tegn === '#' || her.tegn === '@' || her.tegn === '/' || her.tegn === ':') {
        // Tag og projekt er ÉT ord, og det skal klaebe DIREKTE til markoeren -
        // medmindre navnet staar i anfoerselstegn: @"Nordvind TRIO 11".
        //
        // Ingen trim her. "kurset i C # og F" er almindelig tekst, ikke taget
        // "og"; og trimmer man foerst og maaler laengden bagefter, rammer
        // fjernelsen ved siden af og spiser tegn ud af titlen (doda F1).
        let vaerdi;
        let laengde;
        const citat = raat.match(/^"([^"]*)"/);
        if (citat) { vaerdi = citat[1].trim(); laengde = citat[0].length; }
        else {
          // Sagsnumre indeholder tit punktum, skraastreg og hash (SAG-12/2026,
          // INC.4711, #4711) - de skal med i ÉT ord. Tags og projekter beholder
          // det snaevre saet, saa "#tag." ikke tager punktummet med.
          const moenster = her.tegn === ':' ? /^[\p{L}\p{N}_\-.\/#]+/u : /^[\p{L}\p{N}_-]+/u;
          const ord = raat.match(moenster);
          vaerdi = ord ? ord[0] : '';
          laengde = vaerdi.length;
        }
        if (!vaerdi) continue;
        if (her.tegn === '#') { if (!ud.tags.includes(vaerdi)) ud.tags.push(vaerdi); }
        else if (her.tegn === ':') ud.caseNumber = vaerdi;
        else ud.project = vaerdi;      // baade @ og /
        spis.push([her.pos, her.pos + 1 + laengde]);
        continue;
      }

      // ! og ~ tager hele frasen frem til naeste markoer, og der maa gerne
      // staa et mellemrum efter markoeren: baade "!i morgen" og "! i morgen".
      const vaerdi = raat.trim();
      if (!vaerdi) continue;

      if (her.tegn === '~') {
        // ~ er ESTIMAT i tovo (i doda er det udskudt dato - se hovedet).
        const minutter = beregn.parseVarighed(vaerdi);
        if (minutter) ud.estimateMinutes = minutter;
        else {
          // Teksten bliver STAAENDE i titlen, naar den ikke kunne tolkes.
          // Et estimat, der forsvinder, er tavst datatab.
          ud.warnings.push(`forstod ikke varigheden "${vaerdi}"`);
          continue;
        }
      } else if (erGentagelse(vaerdi)) {
        // Gentagelsesreglen GEMMES allerede nu (opgaven har feltet), men
        // motoren, der laver naeste forekomst, bygges i fase 7.
        const regel = tolkGentagelse(vaerdi, opts.now);
        if (regel) {
          ud.recurrenceRule = regel;
          ud.recurrenceText = beskrivGentagelse(regel);
        } else {
          ud.warnings.push(`forstod ikke gentagelsen "${vaerdi}"`);
          continue;
        }
      } else {
        const d = tolkDato(vaerdi, opts.now);
        if (d) ud.due = d;
        else {
          ud.warnings.push(`forstod ikke datoen "${vaerdi}"`);
          continue;
        }
      }
      spis.push([her.pos, slut]);
    }

    // Fjern de spiste stykker BAGFRA, saa indeksene holder.
    spis.sort((a, b) => b[0] - a[0]);
    for (const [fra, til] of spis) tekst = tekst.slice(0, fra) + tekst.slice(til);

    ud.title = tekst.replace(/\s+/g, ' ').trim();
    return ud;
  }

  /**
   * Fjerner PRAECIS én markoer med en kendt vaerdi fra en tekst.
   *
   * Bruges naar en titel, der ALLEREDE findes, redigeres: dér ma kun det,
   * der faktisk kunne tolkes, forsvinde. tolkFangst spiser fx `!vigtigt` og
   * noejes med en advarsel - fint i paletten, hvor chippen ses med det samme,
   * men tavst datatab i en titel, man retter.
   *
   * @param {string} tegn  Ét eller flere markoer-tegn, fx '#' eller '@/'.
   */
  function fjernMarkoer(tekst, tegn, vaerdi) {
    if (!tekst || !vaerdi) return tekst;
    const undslip = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Vaerdier med mellemrum staar i anfoerselstegn: /"Sommerhus i Rørvig".
    const v = `(?:"${undslip(vaerdi)}"|${undslip(vaerdi)})`;
    // Samme regel som i tolkFangst: en markoer skal have linjestart eller et
    // mellemrum foran sig, ellers er nogen@eksempel.dk et projekt.
    const re = new RegExp(`(^|\\s)[${undslip(tegn)}]${v}(?=\\s|$)`, 'i');
    return tekst.replace(re, '$1').replace(/\s{2,}/g, ' ').trim();
  }

  return {
    tolkFangst,
    fjernMarkoer,
    MARKOERER,
    tolkDato,
    tolkGentagelse,
    naesteForekomst,
    beskrivGentagelse,
    erGentagelse,
    fmtDato,
    isoUgedag,
    plusDage,
    plusMaaneder,
    sidsteIMaaned,
    UGEDAGE,
    MAANEDER,
  };
}));

/* ---- shared/planner.js ---- */
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

/* ---- shared/toggl.js ---- */
/* tovo - Toggls detaljerede rapport (CSV).
 *
 * Samme deling som Planner-importen: ALT hvad der kan goere skade -
 * CSV-parseren, kolonnegenkendelsen og mapningen - ligger her, hvor det kan
 * testes uden en browser. Selve filvalget og ruden bor i app/parts/.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.tovoToggl = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Toggls detaljerede rapport som CSV.
   *
   * Ingen zip og ingen XML denne gang - men samme princip som Planner-importen:
   * forhaandsvisning foer der skrives, og en kilde (`import`) paa hver post,
   * saa en rapport kan sige, hvor timerne kom fra.
   *
   * CSV-parseren skal kunne haandtere anfoerselstegn og kommaer INDE i felter -
   * en beskrivelse som "Migrering, del 2" er almindelig, og en split(',') ville
   * flytte alle kolonner én til venstre fra og med den raekke.
   */
  function parseCsv(tekst) {
    const raekker = [];
    let felt = '';
    let raekke = [];
    let iCitat = false;
    const t = String(tekst).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (iCitat) {
        if (c === '"') {
          if (t[i + 1] === '"') { felt += '"'; i++; } else iCitat = false;
        } else felt += c;
        continue;
      }
      if (c === '"') { iCitat = true; continue; }
      if (c === ',') { raekke.push(felt); felt = ''; continue; }
      if (c === '\n') { raekke.push(felt); raekker.push(raekke); raekke = []; felt = ''; continue; }
      felt += c;
    }
    if (felt || raekke.length) { raekke.push(felt); raekker.push(raekke); }
    return raekker.filter((r) => r.some((x) => String(x).trim()));
  }

  /** Kolonnenavne fra Toggls eksport - praefiksmatch, som i Planner-importen. */
  const TOGGL = {
    project: (n) => n === 'project',
    task: (n) => n === 'task',
    description: (n) => n.startsWith('description'),
    startDate: (n) => n === 'start date',
    startTime: (n) => n === 'start time',
    endDate: (n) => n === 'end date',
    endTime: (n) => n === 'end time',
    duration: (n) => n === 'duration',
  };

  function togglKolonner(hoved) {
    const ud = {};
    hoved.forEach((raa, i) => {
      const n = String(raa || '').trim().toLowerCase();
      for (const [felt, passer] of Object.entries(TOGGL)) {
        if (ud[felt] === undefined && passer(n)) ud[felt] = i;
      }
    });
    return ud;
  }

  /** "01:30:00" -> 90 minutter. */
  function togglVarighed(raa) {
    const m = String(raa || '').trim().match(/^(\d+):([0-5]\d):([0-5]\d)$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]) + (Number(m[3]) >= 30 ? 1 : 0);
  }

  function laesToggl(tekst) {
    const raekker = parseCsv(tekst);
    if (raekker.length < 2) throw new Error('That file has no rows.');
    const kort = togglKolonner(raekker[0]);
    if (kort.startDate === undefined || kort.startTime === undefined) {
      throw new Error('This does not look like a Toggl detailed report — there is no '
        + '"Start date" and "Start time" column. Export it from Reports → Detailed → CSV.');
    }
    const poster = [];
    const advarsler = [];
    for (const r of raekker.slice(1)) {
      const v = (felt) => (kort[felt] === undefined ? '' : String(r[kort[felt]] || '').trim());
      const dato = v('startDate');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dato)) { advarsler.push(`Skipped a row with the date "${dato}".`); continue; }
      const start = v('startTime').slice(0, 5);
      const slut = v('endTime').slice(0, 5);
      const minutter = togglVarighed(v('duration'));
      if (!/^\d{2}:\d{2}$/.test(start) || (!minutter && !/^\d{2}:\d{2}$/.test(slut))) {
        advarsler.push(`Skipped a row on ${dato} without a usable time.`);
        continue;
      }
      poster.push({
        date: dato,
        start,
        slut: /^\d{2}:\d{2}$/.test(slut) ? slut : null,
        minutter,
        project: v('project'),
        // Beskrivelsen ER opgaven i Toggl. Er den tom, bruges Task-kolonnen.
        title: v('description') || v('task') || 'Untitled',
      });
    }
    return { poster, advarsler };
  }

  return { laesToggl, parseCsv, togglKolonner, togglVarighed, TOGGL };
}));

/* ---- shared/xlsx.js ---- */
/* tovo - skriver en .xlsx uden en eneste pakke.
 *
 * Planner-importen LAESER et zip-arkiv med XML (§6c). Det her er den anden
 * vej: en regnearksfil er de samme fem XML-filer i en zip, og en zip kan
 * skrives uden komprimering (metode 0, "stored"). Saa skal der kun bruges
 * CRC32 - og det er en tabel og tolv linjer.
 *
 * Tallene skrives som TAL, ikke som tekst. Det er hele pointen med at lave en
 * rigtig regnearksfil frem for en CSV: 3,5 skal kunne laegges sammen i Excel,
 * uanset om maskinen staar paa dansk eller engelsk komma.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.tovoXlsx = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TABEL = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = TABEL[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const tekst = (s) => new TextEncoder().encode(s);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Kontroltegn er ikke gyldige i XML 1.0 og faar Excel til at afvise
      // HELE filen med "uleseligt indhold" - uden at sige hvor.
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  }

  /** "A1", "AB12" - kolonnebogstaverne er base-26 uden nul. */
  function celleRef(kolonne, raekke) {
    let n = kolonne + 1;
    let s = '';
    while (n > 0) {
      const rest = (n - 1) % 26;
      s = String.fromCharCode(65 + rest) + s;
      n = Math.floor((n - 1) / 26);
    }
    return `${s}${raekke + 1}`;
  }

  function arkXml(raekker) {
    const ud = raekker.map((raekke, r) => {
      const celler = (raekke || []).map((v, c) => {
        const ref = celleRef(c, r);
        if (v === null || v === undefined || v === '') return '';
        if (typeof v === 'number' && isFinite(v)) {
          return `<c r="${ref}"><v>${v}</v></c>`;
        }
        // inlineStr: ingen sharedStrings-fil at holde i trit med.
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join('');
      return `<row r="${r + 1}">${celler}</row>`;
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + `<sheetData>${ud}</sheetData></worksheet>`;
  }

  /* Arknavne: Excel afviser filen, hvis de indeholder : \ / ? * [ ] eller er
     over 31 tegn. Fejlen kommer foerst, naar brugeren aabner filen. */
  const arknavn = (n, i) => (String(n || `Sheet${i + 1}`)
    .replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`);

  /**
   * @param {array} ark  [{navn, rows: [[celle, ...], ...]}]
   * @returns {Uint8Array} en .xlsx
   */
  function byg(ark) {
    const dele = ark.length ? ark : [{ navn: 'Sheet1', rows: [] }];
    const filer = [
      ['[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + dele.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" `
          + 'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
        + '</Types>'],
      ['_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>'],
      ['xl/workbook.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        + dele.map((a, i) => `<sheet name="${esc(arknavn(a.navn, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
        + '</sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + dele.map((_, i) => `<Relationship Id="rId${i + 1}" `
          + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
          + `Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + '</Relationships>'],
      ...dele.map((a, i) => [`xl/worksheets/sheet${i + 1}.xml`, arkXml(a.rows || [])]),
    ];

    /* Zip'en skrives UDEN komprimering (metode 0). En regnearksfil paa nogle
       kilobyte har intet at hente ved deflate, og saa slipper vi for at gaa
       gennem CompressionStream - som er asynkron og ikke findes alle steder. */
    const lokale = [];
    const centrale = [];
    let offset = 0;

    for (const [navn, indhold] of filer) {
      const navnBytes = tekst(navn);
      const data = tekst(indhold);
      const crc = crc32(data);

      const lokal = new Uint8Array(30 + navnBytes.length + data.length);
      const lv = new DataView(lokal.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);              // version
      lv.setUint16(6, 0x0800, true);          // flag: navnet er UTF-8
      lv.setUint16(8, 0, true);               // metode 0 = stored
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, navnBytes.length, true);
      lokal.set(navnBytes, 30);
      lokal.set(data, 30 + navnBytes.length);
      lokale.push(lokal);

      const central = new Uint8Array(46 + navnBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, navnBytes.length, true);
      cv.setUint32(42, offset, true);
      central.set(navnBytes, 46);
      centrale.push(central);

      offset += lokal.length;
    }

    const centralStart = offset;
    const centralLaengde = centrale.reduce((n, c) => n + c.length, 0);
    const slut = new Uint8Array(22);
    const sv = new DataView(slut.buffer);
    sv.setUint32(0, 0x06054b50, true);
    sv.setUint16(8, filer.length, true);
    sv.setUint16(10, filer.length, true);
    sv.setUint32(12, centralLaengde, true);
    sv.setUint32(16, centralStart, true);

    const samlet = new Uint8Array(centralStart + centralLaengde + 22);
    let p = 0;
    for (const del of lokale.concat(centrale, [slut])) { samlet.set(del, p); p += del.length; }
    return samlet;
  }

  return { byg, crc32, celleRef };
}));

/* ---- p1_core.js ---- */
'use strict';
/* tovo - kerne: opstart, tema, login, app-skal.
   Denne fil samles til public/app.js af build_rune.py. Redigér aldrig app.js.

   NB: interfacet er ENGELSK (som i doda - aeoeaa er besvaerligt at taste),
   men koden, kommentarerne og dokumenterne er dansk. */

const APP_VERSION = 12;

/* Mobilgraensen bor to steder: her og i style.css. Holdes de ikke i trit,
   folder menuknappen sidebaren sammen paa en iPad, hvor CSS'en tror den er
   overlay (RUNE-ERFARINGER §4). */
const SMAL_SKAERM = 900;

/* Opgaver uden projekt er ikke et projekt med tomt navn - de er deres egen
   plads. Id'et er en KONSTANT og ikke en tom streng, saa det aldrig kan
   forveksles med "intet valgt". */
const INTET_PROJEKT = '__uden';
const smalSkaerm = () => window.matchMedia(`(max-width: ${SMAL_SKAERM}px)`).matches;

const state = {
  user: null,
  config: { appName: 'tovo', needsSetup: false, allowRegistration: false, secureContext: false },
  view: 'today',
  today: '',
  settings: {},
  projects: [],
  unassigned: 0,
  tags: [],
  items: [],
  counts: {},
  todayMinutes: 0,
  openProject: null,
  openTag: null,
};

/* ------------------------------------------------------------ hjaelpere */

// crypto.randomUUID() findes KUN i secure contexts. Panelet tilgaas paa
// IP:port over http, hvor alt der opretter id'er ellers doer stille (§4).
function nyId() {
  if (window.crypto && crypto.randomUUID && window.isSecureContext) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.random() * 256 | 0;
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Goer URL'er og [tekst](url) klikbare.
 *
 * Teksten escapes FOERST, og der matches derefter kun paa http(s). Saa kan
 * javascript: og data: aldrig slippe igennem fra en import eller en
 * MCP-klient - og en attribut-udbrydning er umulig, fordi " allerede er
 * blevet &quot; (doda F1).
 *
 * NB: onenote:-links gemmes paa opgaver (fase 1) og bliver med vilje IKKE
 * linkificeret her - de tegnes som et <a href> af link-visningen, hvor
 * skemaet er hvidlistet. Fri tekst maa kun blive til http(s).
 */
function linkify(tekst) {
  let ud = esc(tekst);
  ud = ud.replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^)\s]{1,500})\)/g,
    (_, navn, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${navn}</a>`);
  ud = ud.replace(/(^|[\s(])(https?:\/\/[^\s<]{1,500})/g, (helt, foer, url) => {
    const hale = url.match(/[.,;:!?)]+$/);
    const ren = hale ? url.slice(0, -hale[0].length) : url;
    const vis = ren.replace(/^https?:\/\//, '').slice(0, 60);
    return `${foer}<a href="${ren}" target="_blank" rel="noopener noreferrer">${vis}</a>${hale ? hale[0] : ''}`;
  });
  return ud;
}

/**
 * Et tidsstempel, som et menneske laeser det.
 *
 * "today 14:32" · "yesterday 09:05" · "18 Aug 14:32" · "18 Aug 2025 14:32".
 * Aaret skrives kun, naar det ikke er i aar - ellers stjaeler det plads fra
 * det, man faktisk kigger efter.
 */
/** Date -> YYYY-MM-DD i LOKAL tid. Aldrig toISOString - den er UTC og
    flytter datoen for alle mellem midnat og to om natten. */
function isoDato(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Sagsnummeret, som link hvis der er en skabelon.
 *
 * Skabelonen er en URL med `{case}` i, fx
 * `https://firma.service-now.com/nav_to.do?uri=/task.do?sysparm_query=number={case}`.
 * Kun http(s) tages imod: en skabelon er brugerens egen tekst, men den bliver
 * til et href, og dér maa javascript: aldrig kunne slippe igennem.
 */
function sagHtml(sag) {
  if (!sag) return '';
  const skabelon = (state.settings || {}).case_url || '';
  if (!/^https?:\/\//i.test(skabelon) || !skabelon.includes('{case}')) {
    return `<span class="sagchip">${esc(sag)}</span>`;
  }
  const url = skabelon.replace('{case}', encodeURIComponent(sag));
  return `<a class="sagchip saglink" href="${esc(url)}" target="_blank" rel="noopener noreferrer"
    title="Open ${esc(sag)}" data-stop>${esc(sag)}</a>`;
}

function visTidspunkt(unix) {
  if (!unix) return '';
  const d = new Date(Number(unix) * 1000);
  const kl = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (iso === state.today) return `today ${kl}`;
  const igaar = new Date();
  igaar.setDate(igaar.getDate() - 1);
  const igaarIso = `${igaar.getFullYear()}-${String(igaar.getMonth() + 1).padStart(2, '0')}-${String(igaar.getDate()).padStart(2, '0')}`;
  if (iso === igaarIso) return `yesterday ${kl}`;
  const iAar = d.getFullYear() === new Date().getFullYear();
  const dato = d.toLocaleDateString('en-GB', iAar
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
  return `${dato} ${kl}`;
}

async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    // Saet headers EFTER en evt. merge - en shallow merge har foer slettet
    // Authorization, fordi hele header-objektet blev erstattet (Kokkeri v15).
    opts.headers = { 'Content-Type': 'application/json' };
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    // Browserens egen tekst er ubrugelig for et menneske: Safari siger
    // "Load failed", Chrome "Failed to fetch". Oversaettelsen hoerer hjemme
    // HER - ét sted - og ikke i hvert kaldssted (doda v11).
    //
    // Ingen `status`: den, der skal skelne netvaerksbrud fra afslag, kigger
    // netop paa fravaeret af en status.
    throw Object.assign(new Error('No connection — this needs the network. Try again when you are back.'),
      { offline: true });
  }
  let data = {};
  try { data = await res.json(); } catch { /* tomt svar er i orden */ }
  if (!res.ok) {
    throw Object.assign(new Error(data.message || data.error || `Error ${res.status}`),
      { status: res.status, code: data.error });
  }
  return data;
}

/**
 * Kopiér til udklipsholderen.
 *
 * `navigator.clipboard` kraever et secure context, og panelet tilgaas paa
 * IP:port over http. Uden fallbacken kan brugeren ikke kopiere det link, han
 * kom for at hente - og fejlen er tavs (doda F2).
 */
async function kopier(tekst) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(tekst);
      return true;
    }
  } catch { /* falder igennem til den gamle vej */ }
  try {
    const felt = document.createElement('textarea');
    felt.value = tekst;
    felt.setAttribute('readonly', '');
    felt.style.position = 'fixed';
    felt.style.top = '-1000px';
    document.body.appendChild(felt);
    felt.select();
    const ok = document.execCommand('copy');
    felt.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * ⌘↵ (Ctrl+↵) gemmer en rude.
 *
 * Ligger ét sted, saa alle ruder svarer ens - en genvej, der virker i den
 * ene og ikke i den anden, er vaerre end ingen genvej.
 *
 * Den lyttes paa RUDEN og ikke paa dokumentet: saa gaelder den kun, mens
 * ruden er aaben, og den kan ikke komme til at gemme noget i baggrunden.
 * `capture: true`, saa den naar frem, ogsaa naar et felt selv har en
 * Enter-handler (fx kommentarfeltet).
 */
function bindGemGenvej(host, gem) {
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    e.stopPropagation();
    gem();
  }, true);
}

/**
 * En ja/nej-praeference, der hoerer til BRUGEREN - ikke til browseren.
 *
 * localStorage betyder "husket her". tovo bruges paa baade telefon og
 * desktop, saa en visningsindstilling, der kun gaelder én browser, ligner
 * en indstilling, der ikke virker (meldt af Andreas om liste/kort).
 * `state.settings` hentes allerede ved opstart, saa serveren koster ingen
 * ny rute og intet ekstra kald ved indlaesning - kun ét, naar valget skifter.
 *
 * `gammelLokal` er den localStorage-noegle, vaerdien laa i FOER flytningen.
 * Den laeses som reserve, saa et valg, brugeren tog i gaar, ikke kastes vaek
 * praecis i den version, der skulle goere det bedre.
 */
function brugerFlag(noegle, standard, gammelLokal) {
  const v = (state.settings || {})[noegle];
  if (v === '1') return true;
  if (v === '0') return false;
  if (gammelLokal) {
    try {
      const g = localStorage.getItem(gammelLokal);
      if (g === '1') return true;
      if (g === '0') return false;
    } catch { /* privat tilstand */ }
  }
  return standard;
}

/*
 * Sætter flaget. Opdaterer `state.settings` SYNKRONT, saa kaldsstedet kan
 * tegne om med det samme uden at vente paa en rundtur (~180 ms mod den
 * udgivne server, doda v27). Fejler gemningen, staar valget stadig rigtigt
 * paa skaermen; det er kun "husk det til naeste gang", der gaar tabt.
 */
async function saetBrugerFlag(noegle, vaerdi) {
  const v = vaerdi ? '1' : '0';
  state.settings = Object.assign({}, state.settings, { [noegle]: v });
  try {
    await api('POST', '/api/v1/settings', { [noegle]: v });
  } catch (ex) { toast(`I could not remember that setting: ${ex.message}`); }
}

function toast(besked, handling) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(besked)}</span>`;
  if (handling) {
    const knap = document.createElement('button');
    knap.className = 'toast-action';
    knap.textContent = handling.label;
    knap.addEventListener('click', () => { el.remove(); handling.run(); });
    el.appendChild(knap);
  }
  host.appendChild(el);
  // Fortryd skal kunne naas i ro og mag - 10 sek. er kravet i fase 2.
  setTimeout(() => el.remove(), handling ? 10000 : 3200);
}

/* --------------------------------------------------------------- tema */

function anvendTema(valg) {
  if (valg === 'light' || valg === 'dark') document.documentElement.setAttribute('data-theme', valg);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('tovo_theme', valg); } catch { /* privat tilstand */ }
}

function nuvaerendeTema() {
  try { return localStorage.getItem('tovo_theme') || 'auto'; } catch { return 'auto'; }
}

/* Det tema, man rent faktisk SER. "Follow system" er ikke en tredje farve. */
function visuelTema() {
  const valg = nuvaerendeTema();
  if (valg === 'light' || valg === 'dark') return valg;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/* -------------------------------------------------------------- ikoner */

const ICONS = {
  logo: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.4 2"/>',
  today: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 1.8"/>',
  projects: '<path d="M6.5 20L12 4l5.5 16"/>',
  report: '<path d="M5 19.5h14"/><path d="M7.5 19.5v-6M12 19.5V6M16.5 19.5v-9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6L6 18M18 18l-1.4-1.4M7.4 7.4L6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  play: '<path d="M8.5 6.5l9 5.5-9 5.5z"/>',
  stop: '<rect x="7.5" y="7.5" width="9" height="9" rx="1.5"/>',
  link: '<path d="M10.5 13.5a3.5 3.5 0 005 0l3-3a3.5 3.5 0 00-5-5l-1 1"/><path d="M13.5 10.5a3.5 3.5 0 00-5 0l-3 3a3.5 3.5 0 005 5l1-1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4M17.8 17.8l-1.4-1.4M7.6 7.6L6.2 6.2"/>',
  moon: '<path d="M20 14.6A8.6 8.6 0 019.4 4 8.6 8.6 0 1020 14.6z"/>',
  pin: '<path d="M9 3.5h6l-1 5 3 3.5H7l3-3.5z"/><path d="M12 12v8.5"/>',
  out: '<path d="M14.5 4.5H18a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5h-3.5"/><path d="M4.5 12h10M11 8.5l3.5 3.5-3.5 3.5"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  kalender: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M9 3.5v4M15 3.5v4"/>',
  tags: '<path d="M5 9.5h14M5 14.5h14M10.5 4.5L8.5 19.5M15.5 4.5l-2 15"/>',
};

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* --------------------------------------------------------------- sider */

// Raekkefoelgen her er ogsaa sidebarens.
const VIEWS = [
  { id: 'today', label: 'Today', icon: 'today', group: 1 },
  { id: 'week', label: 'Week', icon: 'kalender', group: 1 },
  { id: 'projects', label: 'Projects', icon: 'projects', group: 1 },
  { id: 'tags', label: 'Tags', icon: 'tags', group: 2 },
  { id: 'report', label: 'Report', icon: 'report', group: 2 },
  // group: 0 = staar IKKE i navigationen. Settings naas fra menuen paa
  // brugerknappen, hvor kontoen i forvejen bor - to indgange til det samme
  // sted er én for meget (§9c).
  { id: 'settings', label: 'Settings', icon: 'settings', group: 0 },
];

const viewById = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];
const BUND = ['today', 'week', 'projects', 'tags'];

const BESKRIVELSER = {
  today: 'What you have registered today, and what is running right now.',
  week: 'The week as a grid — drag in it to log time.',
  tags: 'Your labels, and how much carries each one.',
  projects: 'Estimate, budget and hours spent — per project.',
  report: 'Hours per project and task for a week you choose.',
  settings: 'Appearance, account and access.',
};

/* ------------------------------------------------------------ optegning */

/** Fuld optegning. Kun ved login/logout - ellers mister soegefeltet fokus. */
function render() {
  const root = document.getElementById('root');
  if (!state.user) { root.innerHTML = gateHtml(); bindGate(); return; }
  root.innerHTML = shellHtml();
  bindShell();
  tegnSide();
}

function gateHtml() {
  const setup = state.config.needsSetup;
  return `
  <div class="gate">
    <div class="card">
      <div class="brand">${icon('logo', 26)} tovo</div>
      <p class="lead" style="text-align:center;margin-bottom:22px">
        ${setup ? 'Pick a username and a password, and you are in.' : 'Sign in to continue.'}
      </p>
      <p class="gate-error" id="gateError" hidden></p>
      <form id="gateForm">
        <label class="field"><span>Username</span>
          <input class="input" id="gateUser" autocomplete="username" autocapitalize="none" required></label>
        <label class="field"><span>Password</span>
          <input class="input" id="gatePass" type="password"
            autocomplete="${setup || state.gateNy ? 'new-password' : 'current-password'}" required></label>
        <button class="btn primary" type="submit" style="width:100%">
          ${setup || state.gateNy ? 'Create account' : 'Sign in'}</button>
      </form>
      ${!setup && !state.gateNy && state.config.passkeys && state.config.hasPasskeys ? `
        <div class="gate-or"><span>or</span></div>
        <button class="btn" id="gatePasskey" style="width:100%">Sign in with a passkey</button>` : ''}
      ${gateSkiftHtml(setup)}
    </div>
  </div>`;
}

/* Registreringslinket vises kun, naar serveren faktisk tager imod en ny
   bruger. Ellers ville det foere til en 403, og det er en daarlig maade at
   fortaelle, at serveren er lukket (§3). */
function gateSkiftHtml(setup) {
  if (setup) return '<p class="gate-note">The first account becomes the administrator.</p>';
  if (!state.config.allowRegistration) return '';
  return state.gateNy
    ? '<p class="gate-note"><button class="linkbtn" id="gateSkift">I already have an account</button></p>'
    : '<p class="gate-note"><button class="linkbtn" id="gateSkift">Create an account</button></p>';
}

function bindGate() {
  const form = document.getElementById('gateForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('gateError');
    err.hidden = true;
    try {
      const nyKonto = state.config.needsSetup || state.gateNy;
      const data = await api('POST', nyKonto ? '/api/register' : '/api/login', {
        username: document.getElementById('gateUser').value,
        password: document.getElementById('gatePass').value,
      });
      state.user = data.user;
      state.config.needsSetup = false;
      state.gateNy = false;
      // Kom man fra en connector, skal man tilbage til samtykket - ikke ind
      // i appen. Stien er whitelistet: ellers er login-siden en aaben
      // viderestilling, og det er praecis dér, brugeren er indstillet paa at
      // godkende noget (§9a).
      if (fortsaetTilConnector()) return;
      await hentState();
      render();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  const skift = document.getElementById('gateSkift');
  if (skift) skift.addEventListener('click', () => { state.gateNy = !state.gateNy; render(); });

  const pk = document.getElementById('gatePasskey');
  if (pk) {
    pk.addEventListener('click', async () => {
      const err = document.getElementById('gateError');
      err.hidden = true;
      try {
        const d = await loginMedPasskey();
        state.user = d.user;
        await hentState();
        render();
      } catch (ex) {
        // Brugeren afbroed selv - det er ikke en fejl, der skal vises.
        if (ex.name === 'NotAllowedError') return;
        err.textContent = ex.message || 'The passkey did not work';
        err.hidden = false;
      }
    });
  }
  document.getElementById('gateUser').focus();
}

/* ------------------------------------------------------------ passkeys */

const b64uTilBuf = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const bufTilB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function loginMedPasskey() {
  const o = await api('POST', '/api/webauthn/login/options', {});
  const pk = Object.assign({}, o.publicKey, { challenge: b64uTilBuf(o.publicKey.challenge) });
  const cred = await navigator.credentials.get({ publicKey: pk });
  return api('POST', '/api/webauthn/login/verify', {
    challengeId: o.challengeId,
    id: cred.id,
    clientDataJSON: bufTilB64u(cred.response.clientDataJSON),
    authenticatorData: bufTilB64u(cred.response.authenticatorData),
    signature: bufTilB64u(cred.response.signature),
  });
}

async function opretPasskey(navn) {
  const o = await api('POST', '/api/webauthn/register/options', {});
  const pk = Object.assign({}, o.publicKey, {
    challenge: b64uTilBuf(o.publicKey.challenge),
    user: Object.assign({}, o.publicKey.user, { id: b64uTilBuf(o.publicKey.user.id) }),
    excludeCredentials: (o.publicKey.excludeCredentials || []).map((c) => ({ type: c.type, id: b64uTilBuf(c.id) })),
  });
  const cred = await navigator.credentials.create({ publicKey: pk });
  return api('POST', '/api/webauthn/register/verify', {
    challengeId: o.challengeId,
    name: navn,
    clientDataJSON: bufTilB64u(cred.response.clientDataJSON),
    attestationObject: bufTilB64u(cred.response.attestationObject),
  });
}

/* ------------------------------------------------------------- skallen */

/* Projektlisten i menuen kan foldes ud. Valget huskes - en menu, der falder
   sammen ved hver optegning, er mere til besvaer end til hjaelp. */
function projekterAabne() {
  try { return localStorage.getItem('tovo_nav_projekter') !== '0'; } catch { return true; }
}

function saetProjekterAabne(aabne) {
  try { localStorage.setItem('tovo_nav_projekter', aabne ? '1' : '0'); } catch { /* privat */ }
}

function navHtml() {
  const iNav = VIEWS.filter((v) => v.group > 0);
  const grupper = [...new Set(iNav.map((v) => v.group))];
  const aabne = projekterAabne();
  return grupper.map((g) => `<nav class="nav">${iNav.filter((v) => v.group === g).map((v) => {
    const paaSiden = v.id === state.view ? 'aria-current="page"' : '';
    if (v.id !== 'projects') {
      return `<button class="nav-item" data-view="${v.id}" ${paaSiden}>
        ${icon(v.icon)}<span>${esc(v.label)}</span></button>`;
    }
    // Selve raekken navigerer; chevronen folder ud. To ting i én raekke, men
    // to forskellige maal - derfor to knapper og ikke én.
    return `<div class="nav-med-fold">
        <button class="nav-item" data-view="projects" ${paaSiden}>
          ${icon(v.icon)}<span>${esc(v.label)}</span>
          ${state.projects.length ? `<span class="nav-count">${state.projects.length}</span>` : ''}
        </button>
        ${state.projects.length ? `<button class="foldbtn${aabne ? ' on' : ''}" id="foldProjekter"
          aria-label="${aabne ? 'Hide the projects' : 'Show the projects'}"
          aria-expanded="${aabne ? 'true' : 'false'}">${icon('chevron', 14)}</button>` : ''}
      </div>
      ${aabne && state.projects.length ? `<div class="nav-under">${state.projects.map((p) => `
        <button class="nav-item nav-sub" data-projekt="${esc(p.id)}"
          ${state.view === 'projects' && state.openProject === p.id ? 'aria-current="page"' : ''}>
          <span class="nav-prik"></span><span>${esc(p.name)}</span></button>`).join('')}
        ${state.unassigned ? `<button class="nav-item nav-sub" data-projekt="${INTET_PROJEKT}"
          ${state.view === 'projects' && state.openProject === INTET_PROJEKT ? 'aria-current="page"' : ''}>
          <span class="nav-prik tom"></span><span>No project</span>
          <span class="nav-count">${state.unassigned}</span></button>` : ''}</div>` : ''}`;
  }).join('')}</nav>`).join('');
}

function shellHtml() {
  return `
  <button class="btn navtoggle" id="navToggle" aria-label="Menu">${icon('menu')}</button>
  <div class="backdrop" id="backdrop"></div>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">${icon('logo', 24)} <span style="flex:1">tovo</span>
        <button class="pinbtn" id="pinBtn" aria-label="Hide the menu"
          title="Hide the menu">${icon('pin', 16)}</button></div>
      <div id="navHost">${navHtml()}</div>
      <div class="sidebar-foot">
        <div id="timerHost"></div>
        <button class="nav-item" id="userBtn"
          ${state.view === 'settings' ? 'aria-current="page"' : ''}>${icon('settings')}<span>${esc(state.user.username)}</span></button>
        <div class="foot-row" id="footRow">${versionHtml()}${temaKnapHtml()}</div>
      </div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div class="toprow">
          <div class="stats meta" id="statsHost">${statsHtml()}</div>
        </div>
        <div class="omni-card" id="omniCard">
          <div class="omni-field">
            <span class="omni-icon">${icon('search', 22)}</span>
            <span class="omni-mode" id="omniMode" hidden></span>
            <input class="omni-input" id="omni" autocomplete="off" spellcheck="false"
              placeholder="Search — or start a line with + to create">
          </div>
          <div class="omni-panel" id="omniPanel" hidden></div>
          <div class="omni-legend meta" id="omniLegend"></div>
        </div>
        <div class="omni-chips" id="omniChips"></div>
      </div>
      <div id="pageHost"></div>
    </main>
  </div>
  <nav class="bottomnav" id="bottomNav">
    ${BUND.map((id) => {
    const v = viewById(id);
    return `<button class="bottomnav-item" data-view="${v.id}" ${v.id === state.view ? 'aria-current="page"' : ''}>
        ${icon(v.icon, 21)}<span>${esc(v.label)}</span></button>`;
  }).join('')}
  </nav>`;
}

/*
 * Versionen, altid synlig. Det er SAMME tal som runens version: i panelet -
 * build_rune.py stempler APP_VERSION i index.html og i runen paa én gang.
 *
 * Serveren melder sit eget tal i /api/public-config. Er de to forskellige,
 * er app.js i browserens cache aeldre end den, serveren udleverer - og saa er
 * det dét, brugeren skal vide.
 */
function versionHtml() {
  const server = state.config.version;
  if (server && server !== APP_VERSION) {
    return `<button class="version-line meta version-old" id="versionBtn"
      title="Your browser is running v${APP_VERSION}, but the server has v${server}. Click to reload.">
      v${APP_VERSION} · v${server} available — reload</button>`;
  }
  return `<div class="version-line meta">v${esc(String(APP_VERSION))}</div>`;
}

/* Knappen viser det tema, man skifter TIL - ikke det, man er i. */
function temaKnapHtml() {
  const naeste = visuelTema() === 'dark' ? 'light' : 'dark';
  return `<button class="temabtn" id="temaBtn" data-naeste="${naeste}"
    aria-label="Switch to ${naeste} theme" title="Switch to ${naeste} theme">
    ${icon(naeste === 'dark' ? 'moon' : 'sun', 16)}</button>`;
}

function opdaterTemaKnap() {
  const gammel = document.getElementById('temaBtn');
  if (!gammel) return;
  gammel.outerHTML = temaKnapHtml();
  bindTemaKnap();
}

function bindTemaKnap() {
  const el = document.getElementById('temaBtn');
  if (!el) return;
  el.addEventListener('click', () => {
    anvendTema(el.dataset.naeste);
    opdaterTemaKnap();
    if (state.view === 'settings') tegnSide();
  });
}

function statsHtml() {
  const c = state.counts || {};
  const flertal = (n, ord) => `${n} ${ord}${n === 1 ? '' : 's'}`;
  const dele = [`${c.tasks || 0} open`, flertal(c.projects || 0, 'project')];
  if (c.done) dele.push(`${c.done} done`);
  return dele.map((d) => `<span>${esc(d)}</span>`).join('');
}

function bindNav() {
  document.querySelectorAll('#navHost .nav-item[data-view]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.view));
  });
  document.querySelectorAll('#navHost [data-projekt]').forEach((el) => {
    el.addEventListener('click', () => gaaTil('projects', { project: el.dataset.projekt }));
  });
  const fold = document.getElementById('foldProjekter');
  if (fold) {
    fold.addEventListener('click', () => {
      saetProjekterAabne(!projekterAabne());
      opdaterNav();
    });
  }
}

function opdaterNav() {
  // Taellerne staar i skallen, som render() kun tegner ved login/logout.
  // Uden denne linje blev de staaende paa 0, mens listen viste opgaver -
  // og et tal, der ser rigtigt ud, men er forkert, er vaerre end intet.
  const stats = document.getElementById('statsHost');
  if (stats) stats.innerHTML = statsHtml();
  const host = document.getElementById('navHost');
  if (host) host.innerHTML = navHtml();
  bindNav();
  document.querySelectorAll('.bottomnav-item[data-view]').forEach((el) => {
    el.setAttribute('aria-current', el.dataset.view === state.view ? 'page' : 'false');
  });
  const ub = document.getElementById('userBtn');
  if (ub) ub.setAttribute('aria-current', state.view === 'settings' ? 'page' : 'false');
}

function bindShell() {
  saetNavSkjult(navErSkjult());
  bindNav();
  document.querySelectorAll('.bottomnav-item[data-view]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.view));
  });
  document.getElementById('userBtn').addEventListener('click', visBrugerMenu);
  document.getElementById('pinBtn').addEventListener('click', () => {
    const skjul = !document.body.classList.contains('navskjult');
    saetNavSkjult(skjul);
    if (skjul) document.body.classList.remove('navopen');
  });
  bindTemaKnap();
  const vBtn = document.getElementById('versionBtn');
  if (vBtn) {
    vBtn.addEventListener('click', async () => {
      try {
        if (window.caches) await Promise.all((await caches.keys()).map((n) => caches.delete(n)));
      } catch { /* uden cache-api er der ikke noget at rydde */ }
      location.reload();
    });
  }
  document.getElementById('navToggle').addEventListener('click', () => document.body.classList.toggle('navopen'));
  document.getElementById('backdrop').addEventListener('click', () => document.body.classList.remove('navopen'));
  bindOmni();
  // Timeren tegnes IGEN her. hentState() koerer FOER skallen findes ved
  // opstart, saa #timerHost fandtes ikke, og timeren faldt tilbage til den
  // flydende bjaelke - ogsaa paa en bred skaerm. Symptomet var, at den
  // flyttede sig ved en genindlaesning.
  tegnTimerBjaelke();
}

function gaaTil(view, opt) {
  const skifter = state.view !== view;
  state.view = view;
  /*
   * Projektet nulstilles ALTID, medmindre kaldet selv angiver et.
   *
   * Foer stod der `if (skifter) state.openProject = null`, og saa gjorde
   * "← Projects" inde fra et projekt ingenting: view'et var allerede
   * 'projects', saa der var intet "skift", og det aabne projekt blev
   * staaende. Knappen saa ud til at vaere doed. Naar en tilstand hoerer til
   * en SIDE og ikke til et view, skal den ryddes af den, der navigerer.
   */
  state.openProject = (opt && opt.project !== undefined) ? opt.project : null;
  state.openTag = (opt && opt.tag !== undefined) ? opt.tag : (view === 'tags' ? state.openTag : null);
  document.body.classList.remove('navopen');
  opdaterNav();
  // Feltet arbejder i den side, man staar paa - og skal vise det.
  opdaterOmniKontekst();
  tegnSide();
  // Scroll kun til toppen ved REELT sideskift - ellers kastes brugeren op,
  // hver gang en inline-redigering gentegner samme side (Beanledger v24).
  if (skifter) window.scrollTo(0, 0);
}

async function genindlaes() {
  await hentState();
  opdaterNav();
  await tegnSide();
}

async function hentState() {
  try {
    const d = await api('GET', '/api/v1/state');
    state.user = d.user || state.user;
    state.today = d.today;
    state.settings = d.settings || {};
    state.projects = d.projects || [];
    state.tags = d.tags || [];
    state.unassigned = d.unassigned || 0;
    state.counts = d.counts || {};
    state.todayMinutes = d.todayMinutes || 0;
    // Den koerende timer foelger med hvert state-kald, saa bjaelken er rigtig
    // i enhver visning - ogsaa hvis timeren blev startet fra en anden fane.
    timerState.data = d.timer || null;
    tegnTimerBjaelke();
    if (d.global) state.config.allowRegistration = d.global.allowRegistration;
  } catch (ex) {
    if (ex.status !== 401) toast(ex.message);
  }
}

/* ------------------------------------------------------ sidebaren */

/*
 * Sidebaren kan foldes helt vaek, saa der kun staar en hamburger tilbage.
 * Skjult ligger den som et OVERLAY over indholdet i stedet for at skubbe det -
 * ellers hopper hele siden, hver gang man kigger i menuen (§9c).
 */
function navErSkjult() {
  try { return localStorage.getItem('tovo_nav_skjult') === '1'; } catch { return false; }
}

function saetNavSkjult(skjult) {
  try { localStorage.setItem('tovo_nav_skjult', skjult ? '1' : '0'); } catch { /* privat */ }
  document.body.classList.toggle('navskjult', skjult);
  if (!skjult) document.body.classList.remove('navopen');
  // Popovers haenger fast paa knapper i sidebaren. Foldes den vaek, mens en
  // menu staar aaben, bliver menuen svaevende tilbage over ingenting.
  const menu = document.getElementById('userMenu');
  if (menu) menu.remove();
  const knap = document.getElementById('pinBtn');
  if (knap) {
    const tekst = skjult ? 'Keep the menu open' : 'Hide the menu';
    knap.setAttribute('aria-label', tekst);
    knap.title = tekst;
    knap.classList.toggle('off', skjult);
  }
}

/* --------------------------------------------------- brugermenuen */

function visBrugerMenu() {
  const gammel = document.getElementById('userMenu');
  if (gammel) { gammel.remove(); return; }
  const anker = document.getElementById('userBtn');
  if (!anker) return;

  const host = document.createElement('div');
  host.className = 'usermenu';
  host.id = 'userMenu';
  host.innerHTML = `
    <div class="usermenu-head">
      <div class="usermenu-name">${esc(state.user.username)}</div>
      <div class="meta">${state.user.isAdmin ? 'Administrator' : 'Signed in'}${state.config.secureContext ? '' : ' · plain http'}</div>
    </div>
    <button class="usermenu-item" data-go="settings">${icon('settings', 17)}<span>Settings</span></button>
    <button class="usermenu-item" data-go="shortcuts">${icon('link', 17)}<span>Keyboard shortcuts</span></button>
    <button class="usermenu-item danger" data-go="logout">${icon('out', 17)}<span>Log out</span></button>`;

  const r = anker.getBoundingClientRect();
  host.style.left = `${Math.round(r.left)}px`;
  host.style.bottom = `${Math.round(window.innerHeight - r.top + 8)}px`;
  document.body.appendChild(host);

  const luk = () => host.remove();
  host.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', async () => {
      const hvad = el.dataset.go;
      luk();
      if (hvad === 'settings') gaaTil('settings');
      else if (hvad === 'shortcuts') visGenveje();
      else {
        await api('POST', '/api/logout', {});
        state.user = null;
        render();
      }
    });
  });
  // setTimeout, saa klikket der AABNEDE menuen ikke lukker den med det samme.
  setTimeout(() => {
    document.addEventListener('click', function udenfor(e) {
      if (host.isConnected && !host.contains(e.target) && e.target !== anker) {
        luk();
        document.removeEventListener('click', udenfor);
      }
    });
  }, 0);
}

/* --------------------------------------------------------------- sider */

async function tegnSide() {
  const host = document.getElementById('pageHost');
  if (!host) return;
  const v = viewById(state.view);
  // .page er dodas indholdsbredde (760 px). .main centrerer sine boern, saa
  // uden wrapperen bliver siden shrink-to-fit og staar midt paa skaermen.
  if (state.view === 'settings') {
    host.innerHTML = `<div class="page">${await settingsHtml()}</div>`;
    bindSettings();
    return;
  }
  if (state.view === 'today') { await tegnIDag(); return; }
  if (state.view === 'projects') { await tegnProjekter(); return; }
  if (state.view === 'week') { await tegnKalender(); return; }
  if (state.view === 'tags') { await tegnTags(); return; }
  if (state.view === 'report') { await tegnRapport(); return; }
  host.innerHTML = `<div class="page">
    <h1>${esc(v.label)}</h1>
    <p class="lead">${esc(BESKRIVELSER[v.id] || '')}</p>
    ${tomHtml(v.id)}</div>`;
}

/* Aerlige tomme tilstande. De skal sige hvad der KOMMER, ikke lade som om
   siden er faerdig - fase 0 er skelettet. */
function tomHtml(view) {
  // Kun de sider, der endnu ikke findes. Tomme tilstande for de RIGTIGE sider
  // hoerer hjemme i visningen selv, hvor de kender indholdet.
  const tekst = { report: 'The weekly report arrives in phase 6.' }[view];
  return `<div class="empty"><p>${esc(tekst || '')}</p></div>`;
}

async function settingsHtml() {
  const pk = await api('GET', '/api/v1/passkeys').catch(() => ({ credentials: [], blocked: null }));
  const kal = await api('GET', '/api/v1/ical').catch(() => ({ feed: null, alarm: 15 }));
  const n = await api('GET', '/api/v1/keys').catch(() => ({ keys: [], connections: [], mcpUrl: '' }));
  const tema = nuvaerendeTema();
  const knap = (id, navn) => `<button class="btn ${tema === id ? 'primary' : ''}" data-tema="${id}">${navn}</button>`;
  return `
    <h1>Settings</h1>
    <p class="lead">${esc(BESKRIVELSER.settings)}</p>

    <div class="card">
      <h2>Appearance</h2>
      <div class="row">${knap('auto', 'Follow system')}${knap('light', 'Light')}${knap('dark', 'Dark')}</div>
    </div>

    <div class="card">
      <h2>Account</h2>
      <p class="meta">${esc(state.user.username)}${state.user.isAdmin ? ' · administrator' : ''}</p>
      <form id="pwForm">
        <label class="field"><span>Current password</span>
          <input class="input" id="pwCur" type="password" autocomplete="current-password"></label>
        <label class="field"><span>New password</span>
          <input class="input" id="pwNew" type="password" autocomplete="new-password"></label>
        <button class="btn" type="submit">Change password</button>
      </form>
    </div>

    <div class="card">
      <h2>Claude and other clients</h2>
      <p class="meta">tovo speaks MCP, so Claude can start timers, log time afterwards and read
        the weekly report — with exactly the same numbers you see here.</p>
      <p class="meta startlink-url" id="mcpUrl">${esc(n.mcpUrl)}</p>
      <div class="row">
        <button class="btn" id="mcpCopy">Copy the address</button>
      </div>
      <p class="meta">In <strong>claude.ai</strong> or the desktop app: add it as a custom
        connector and sign in — you will be asked to allow it. In <strong>Claude Code</strong>
        you need a key below instead.</p>

      <h2 style="margin-top:20px">Access keys</h2>
      ${n.keys.length ? `<ul class="plain">${n.keys.map((k) => `
        <li><span class="post-main"><span>${esc(k.name)}</span>
          <span class="meta">${esc(k.scope)} · tovo_${esc(k.prefix)}…
            ${k.last_used_at ? `· last used ${esc(visTidspunkt(k.last_used_at))}` : '· never used'}</span></span>
          <button class="linkbtn" data-noegle="${esc(k.id)}">revoke</button></li>`).join('')}</ul>`
    : '<p class="meta">No keys yet.</p>'}
      <div class="row">
        <input class="input" id="keyName" placeholder="What is it for?" style="flex:1">
        <select class="input" id="keyScope" style="flex:none;width:auto">
          <option value="full">full — read and write</option>
          <option value="read">read only</option>
          <option value="capture">capture only</option>
        </select>
        <button class="btn" id="keyAdd">Create a key</button>
      </div>
      <p class="meta">A key is shown <strong>once</strong>. Only its hash is stored, so a lost
        key cannot be read back — make a new one.</p>

      ${n.connections.length ? `<h2 style="margin-top:20px">Connected apps</h2>
        <ul class="plain">${n.connections.map((c) => `
          <li><span class="post-main"><span>${esc(c.name)}</span>
            <span class="meta">${c.last_used_at ? `last used ${esc(visTidspunkt(c.last_used_at))}` : 'not used yet'}</span></span>
            <button class="linkbtn" data-forbindelse="${esc(c.id)}">disconnect</button></li>`).join('')}</ul>` : ''}
    </div>

    <div class="card">
      <h2>Calendar</h2>
      <p class="meta">Tasks with a date become appointments in your own calendar. The address
        is the secret — anyone who has it can read the feed, and revoking it kills every copy.</p>
      ${kal.feed ? `
        <p class="meta startlink-url" id="icalUrl">${esc(kal.feed.url)}</p>
        <div class="row">
          <button class="btn" id="icalCopy">Copy the address</button>
          <button class="linkbtn" id="icalRevoke">revoke</button>
        </div>`
    : '<div class="row"><button class="btn" id="icalCreate">Create a calendar feed</button></div>'}
      <label class="field" style="margin-top:14px"><span>Reminder before an appointment</span>
        <select class="input" id="icalAlarm">
          ${[['-1', 'No reminder'], ['0', 'At the time'], ['5', '5 minutes before'],
    ['15', '15 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before']]
    .map(([v, n]) => `<option value="${v}"${String(kal.alarm) === v ? ' selected' : ''}>${n}</option>`).join('')}
        </select></label>
      <p class="meta">Reminders are only set on tasks that have a <strong>time</strong> —
        an all-day task would ring at midnight.</p>
      <p class="meta"><strong>Two things worth knowing.</strong> Outlook refreshes a subscribed
        calendar every 3–24 hours on its own schedule, so a task you add now may take a while to
        appear. And on iOS you must turn <strong>“Remove Alarms”</strong> off when you add the
        subscription — otherwise the phone strips the reminders without telling you.</p>
    </div>

    <div class="card">
      <h2>Passkeys</h2>
      ${pk.blocked ? `<p class="meta">${esc(pk.blocked)}</p>` : `
        <p class="meta">A passkey is an extra way in — it never replaces the password.</p>
        <div class="row"><button class="btn" id="pkAdd">Add a passkey</button></div>`}
      ${pk.credentials.length ? `<ul class="plain">${pk.credentials.map((c) => `
        <li>${esc(c.name)} <button class="linkbtn" data-pk="${esc(c.id)}">remove</button></li>`).join('')}</ul>` : ''}
    </div>

    <div class="card">
      <h2>Case numbers</h2>
      <p class="meta">A task can carry the number the hours are booked against in your other
        system — write <code>:SAG-1234</code> when you capture it, or set one on the project so
        every task inherits it.</p>
      <label class="field"><span>Link to open a case</span>
        <input class="input" id="setCaseUrl" placeholder="https://firma.service-now.com/nav_to.do?uri=/task.do?sysparm_query=number={case}"
          value="${esc((state.settings || {}).case_url || '')}"></label>
      <p class="meta">Put <code>{case}</code> where the number goes. Then every case number in
        tovo becomes a link straight into the case. Only http and https are accepted.</p>
    </div>

    <div class="card">
      <h2>Your data</h2>
      <p class="meta">Everything you have, in one open file. Secrets are left out on purpose:
        a start link or the calendar address in a file you pass on would give away access.</p>
      <div class="row">
        <button class="btn" id="dataEksport">Export as JSON</button>
        <button class="btn" id="dataToggl">Import history from Toggl</button>
      </div>
      <p class="meta">For a real backup, use the panel's own — it covers the whole data folder,
        database and all.</p>
    </div>

    ${state.user.isAdmin ? `
    <div class="card">
      <h2>This server</h2>
      <label class="check"><input type="checkbox" id="setReg" ${state.config.allowRegistration ? 'checked' : ''}>
        <span>Let new users sign up</span></label>
      <p class="meta">Users never see each other's data — not even the administrator.</p>
    </div>` : ''}`;
}

function bindSettings() {
  document.querySelectorAll('[data-tema]').forEach((el) => {
    el.addEventListener('click', () => { anvendTema(el.dataset.tema); opdaterTemaKnap(); tegnSide(); });
  });

  const pw = document.getElementById('pwForm');
  if (pw) {
    pw.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/password', {
          current: document.getElementById('pwCur').value,
          next: document.getElementById('pwNew').value,
        });
        toast('Password changed.');
        pw.reset();
      } catch (ex) { toast(ex.message); }
    });
  }

  const add = document.getElementById('pkAdd');
  if (add) {
    add.addEventListener('click', async () => {
      try {
        await opretPasskey('Passkey');
        toast('Passkey added.');
        tegnSide();
      } catch (ex) {
        if (ex.name === 'NotAllowedError') return;
        toast(ex.message || 'The passkey did not work');
      }
    });
  }

  document.querySelectorAll('[data-pk]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await api('DELETE', `/api/v1/passkeys/${encodeURIComponent(el.dataset.pk)}`);
        tegnSide();
      } catch (ex) { toast(ex.message); }
    });
  });

  const caseUrl = document.getElementById('setCaseUrl');
  if (caseUrl) {
    caseUrl.addEventListener('change', async () => {
      const v = caseUrl.value.trim();
      if (v && !/^https?:\/\//i.test(v)) { toast('The link must start with http:// or https://'); return; }
      if (v && !v.includes('{case}')) { toast('The link needs {case} where the number goes.'); return; }
      try {
        await api('POST', '/api/v1/settings', { case_url: v });
        await genindlaes();
        toast(v ? 'Case numbers are links now.' : 'Case links turned off.');
      } catch (ex) { toast(ex.message); }
    });
  }

  const eksport = document.getElementById('dataEksport');
  if (eksport) {
    eksport.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = '/api/v1/export';
      a.download = `tovo-${state.today}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }
  const tg = document.getElementById('dataToggl');
  if (tg) tg.addEventListener('click', aabnTogglImport);

  const mcpCopy = document.getElementById('mcpCopy');
  if (mcpCopy) {
    mcpCopy.addEventListener('click', async () => {
      const url = document.getElementById('mcpUrl').textContent;
      const ok = await kopier(url);
      toast(ok ? 'Address copied.' : `Copy it by hand: ${url}`);
    });
  }
  const keyAdd = document.getElementById('keyAdd');
  if (keyAdd) {
    keyAdd.addEventListener('click', async () => {
      try {
        const d = await api('POST', '/api/v1/keys', {
          name: document.getElementById('keyName').value,
          scope: document.getElementById('keyScope').value,
        });
        // Noeglen vises ÉN gang. Derfor en rude, der bliver staaende, og ikke
        // en toast, der forsvinder efter tre sekunder.
        visNoegle(d.key);
        tegnSide();
      } catch (ex) { toast(ex.message); }
    });
  }
  document.querySelectorAll('[data-noegle]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await api('DELETE', `/api/v1/keys/${el.dataset.noegle}`);
        tegnSide();
        toast('The key stopped working right away.');
      } catch (ex) { toast(ex.message); }
    });
  });
  document.querySelectorAll('[data-forbindelse]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await api('DELETE', `/api/v1/connections/${el.dataset.forbindelse}`);
        tegnSide();
        toast('Disconnected.');
      } catch (ex) { toast(ex.message); }
    });
  });

  const icalCreate = document.getElementById('icalCreate');
  if (icalCreate) {
    icalCreate.addEventListener('click', async () => {
      try {
        await api('POST', '/api/v1/ical', {});
        tegnSide();
        toast('Calendar feed created.');
      } catch (ex) { toast(ex.message); }
    });
  }
  const icalCopy = document.getElementById('icalCopy');
  if (icalCopy) {
    icalCopy.addEventListener('click', async () => {
      const url = document.getElementById('icalUrl').textContent;
      const ok = await kopier(url);
      toast(ok ? 'Address copied — add it as a subscribed calendar.' : `Copy it by hand: ${url}`);
    });
  }
  const icalRevoke = document.getElementById('icalRevoke');
  if (icalRevoke) {
    icalRevoke.addEventListener('click', async () => {
      try {
        await api('DELETE', '/api/v1/ical', {});
        tegnSide();
        toast('The feed is dead. Any calendar still subscribed will stop updating.');
      } catch (ex) { toast(ex.message); }
    });
  }
  const icalAlarm = document.getElementById('icalAlarm');
  if (icalAlarm) {
    icalAlarm.addEventListener('change', async () => {
      try {
        await api('POST', '/api/v1/settings', { ical_alarm: icalAlarm.value });
        toast('Saved. Calendars pick it up at their next refresh.');
      } catch (ex) { toast(ex.message); }
    });
  }

  const reg = document.getElementById('setReg');
  if (reg) {
    reg.addEventListener('change', async () => {
      try {
        const d = await api('POST', '/api/v1/settings', { allow_registration: reg.checked });
        state.config.allowRegistration = d.global.allowRegistration;
        toast(reg.checked ? 'Sign-up is open.' : 'Sign-up is closed.');
      } catch (ex) { toast(ex.message); reg.checked = !reg.checked; }
    });
  }
}

/**
 * Noeglen vises ÉN gang.
 *
 * Kun hashen gemmes, saa den kan aldrig laeses tilbage. Derfor en rude, man
 * selv lukker - og en kopiér-knap med fallback, fordi udklipsholderen
 * kraever et secure context, og panelet tilgaas over http (doda F2).
 */
function visNoegle(noegle) {
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `<div class="modal-card" role="dialog" aria-label="New key">
      <h2>Your new key</h2>
      <p class="meta">This is the only time it is shown. Only its hash is stored.</p>
      <p class="startlink-url" id="nyNoegle">${esc(noegle)}</p>
      <div class="modal-foot">
        <button class="btn primary" id="nkCopy">Copy</button>
        <button class="btn" id="nkClose">Done</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  document.getElementById('nkClose').addEventListener('click', luk);
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });
  document.getElementById('nkCopy').addEventListener('click', async () => {
    const ok = await kopier(noegle);
    toast(ok ? 'Key copied.' : 'Select it and copy it by hand.');
  });
}

/**
 * Service workeren.
 *
 * Registreringen kan IKKE afproeves i Claude Codes browser-panel: den fejler
 * med "An unknown error occurred when fetching the script" - ogsaa mod en
 * helt noegen server. Det er panelet, ikke koden (doda F6). Fejler den, sker
 * der ingenting synligt, og appen virker uaendret.
 */
async function registrerSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');

    /*
     * En web app paa hjemmeskaermen bliver stort set ALDRIG genindlaest: den
     * lukkes ikke, den skjules. Registreringen ovenfor tjekker kun ved
     * sideindlaesning, saa uden det her opdager telefonen aldrig, at der ligger
     * en ny sw.js - og serverer sin egen cache videre i maanedsvis.
     *
     * doda stod paa v33 paa Andreas' telefon, mens serveren koerte v38, og
     * fejl, der var rettet for laengst, blev ved med at vise sig
     * (RUNE-ERFARINGER, 19-08-2026). tovo havde praecis samme mangel.
     */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => { /* offline er fint */ });
    });

    /*
     * Naar en ny service worker tager over, koerer den GAMLE kode stadig i
     * siden - skipWaiting() skifter arbejderen ud, ikke det, brugeren ser.
     * Kun hvis der var en controller i forvejen: ved allerfoerste registrering
     * fyrer controllerchange ogsaa (clients.claim), og saa ville hver ny
     * installation genindlaese sig selv uden grund.
     */
    const havdeStyring = !!navigator.serviceWorker.controller;
    let genindlaeser = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!havdeStyring || genindlaeser) return;
      genindlaeser = true;
      window.location.reload();
    });
  } catch { /* uden SW virker alt stadig */ }
}

/* --------------------------------------------------------------- start */

/**
 * Adressen at vende tilbage til efter login.
 *
 * KUN samtykkesiden accepteres. Alt andet ville goere login-siden til en
 * aaben viderestilling.
 */
function oauthNaeste() {
  try {
    const n = new URLSearchParams(location.search).get('next') || '';
    return n.startsWith('/oauth/authorize?') ? n : null;
  } catch { return null; }
}

function fortsaetTilConnector() {
  const n = oauthNaeste();
  if (!n) return false;
  location.replace(n);
  return true;
}

(async function start() {
  anvendTema(nuvaerendeTema());
  try {
    state.config = await api('GET', '/api/public-config');
    document.title = state.config.appName || 'tovo';
    const me = await api('GET', '/api/me');
    state.user = me.user;
    // Var man allerede logget ind, da connectoren sendte én herhen, skal man
    // slet ikke se appen - kun samtykkesiden.
    if (state.user && fortsaetTilConnector()) return;
    if (state.user) await hentState();
  } catch (ex) {
    document.getElementById('root').innerHTML =
      `<div class="gate"><div class="card"><div class="brand">${icon('logo', 26)} tovo</div>
       <p class="lead" style="text-align:center">Could not reach the server.<br>${esc(ex.message)}</p></div></div>`;
    return;
  }
  render();
  registrerSW();
}());

/* ---- p2_omni.js ---- */
'use strict';
/* tovo - kommandopaletten. Ét felt der baade soeger og opretter.
 *
 * Oprettelse staar ALTID oeverst og kan altid naas med Enter: soegning maa
 * aldrig komme i vejen for fangst. Paletten er dodas, med tovos markoerer.
 */

/* Foerste tegn vaelger en TILSTAND. Pillen i feltet og legenden nedenunder
   viser hvilken, saa man aldrig er i tvivl om, hvad Enter kommer til at goere.

   Legenden skal naevne ALT, parseren kan i den tilstand. Naevner den mindre,
   findes funktionen i praksis ikke - det var praecis derfor "/projekt" laa
   ubrugt i doda indtil v4, selv om paletten lovede det. */
const MODER = {
  '+': {
    id: 'task', pil: '+ New task', ph: 'Task title… try ~2,5t !friday',
    legend: ['@ project', '# tag', ': case', '! date', '~ estimate', '% start now'], enter: 'Create',
  },
  '/': { id: 'project', pil: '/ Projects', ph: 'Find or create a project…', legend: [], enter: 'Open' },
  '#': { id: 'tag', pil: '# Tags', ph: 'Find a tag…', legend: [], enter: 'Open' },
};

const STANDARD_LEGEND = ['+ task', '@ project', '# tag', ': case', '! date', '~ estimate',
  '% start now', '⌘↵ start timer'];

const omniState = {
  mode: null,
  tolket: null,
  resultater: { tasks: [], projects: [] },
  valgt: 0,
  raekker: [],
  soegeTimer: null,
  soegeToken: 0,
};

function omniEl() { return document.getElementById('omni'); }

/* Tolkningen sker LOKALT med den samme parser, serveren bruger. Ingen
   netvaerkskald pr. tastetryk - chipsene skal foelge fingrene, og de kan
   alligevel ikke komme ud af trit med det, der bliver gemt (doda F1). */
function tolkNu(tekst) {
  if (typeof tovoParse === 'undefined') return null;
  return tovoParse.tolkFangst(tekst);
}

/** Det projekt, feltet arbejder i. Staar man i et projekt, hoerer alt til der. */
function omniKontekst() {
  return state.openProject ? state.projects.find((p) => p.id === state.openProject) : null;
}

function saetMode(tegn) {
  omniState.mode = tegn;
  const pille = document.getElementById('omniMode');
  const el = omniEl();
  if (!el) return;
  const m = tegn ? MODER[tegn] : null;
  if (pille) {
    pille.textContent = m ? m.pil : '';
    pille.hidden = !m;
  }
  const k = omniKontekst();
  el.placeholder = m ? m.ph
    : (k ? `Search or add in ${k.name}…` : 'Search — or start a line with + to create');
}

function tegnLegend() {
  const host = document.getElementById('omniLegend');
  if (!host) return;
  const m = omniState.mode ? MODER[omniState.mode] : null;
  const dele = m ? m.legend : STANDARD_LEGEND;
  const k = omniKontekst();
  const kontekst = k ? `<span class="chip">in ${esc(k.name)}</span>` : '';
  host.innerHTML = kontekst + dele.map((d) => `<span>${esc(d)}</span>`).join('');
}

/* Chips under feltet: det, parseren HAR forstaaet. Et navn, der ikke findes
   endnu, skal kunne SES med det samme - men foerst oprettes ved Enter. Ellers
   forsvinder @navn ud af titlen uden at lande et synligt sted, og interfacet
   lyver (doda 2026-08-18). */
function tegnChips() {
  const host = document.getElementById('omniChips');
  if (!host) return;
  const t = omniState.tolket;
  if (!t) { host.innerHTML = ''; return; }
  const kendteP = new Set(state.projects.map((p) => p.name.toLowerCase()));
  const kendteT = new Set((state.tags || []).map((x) => x.name.toLowerCase()));
  const chips = [];
  if (t.project) {
    const ny = !kendteP.has(t.project.toLowerCase());
    chips.push(`<span class="chip">@${esc(t.project)}${ny ? ' — new' : ''}</span>`);
  }
  for (const navn of t.tags) {
    const ny = !kendteT.has(navn.toLowerCase());
    chips.push(`<span class="chip neutral">#${esc(navn)}${ny ? ' — new' : ''}</span>`);
  }
  if (t.startTimer) chips.push('<span class="chip">starts the timer</span>');
  if (t.caseNumber) chips.push(`<span class="chip neutral">${esc(t.caseNumber)}</span>`);
  if (t.estimateMinutes) chips.push(`<span class="chip neutral">~${esc(tovoBeregn.formatVarighed(t.estimateMinutes))}</span>`);
  if (t.due) chips.push(`<span class="chip neutral">${esc(visDato(t.due.dato))}${t.due.tid ? ` ${esc(t.due.tid)}` : ''}</span>`);
  if (t.recurrenceText) chips.push(`<span class="chip neutral">${esc(t.recurrenceText)}</span>`);
  for (const w of t.warnings) chips.push(`<span class="chip neutral">${esc(w)}</span>`);
  host.innerHTML = chips.join('');
}

/**
 * Projekter, der LIGNER det, man er ved at skrive.
 *
 * Uden det siger chippen "@BeanLedg — new", mens "BeanLedger" ligger lige
 * ved siden af - og saa opretter man et projekt nummer to med et
 * stavefejlsnavn uden at opdage det. Foerst praefiks (det man er i gang med
 * at skrive), derefter delstreng.
 */
function lignendeProjekter(navn) {
  const q = String(navn || '').toLowerCase();
  if (!q) return [];
  const alle = state.projects || [];
  if (alle.some((p) => p.name.toLowerCase() === q)) return [];   // praecist match: intet at foreslaa
  const praefiks = alle.filter((p) => p.name.toLowerCase().startsWith(q));
  const delstreng = alle.filter((p) => !praefiks.includes(p) && p.name.toLowerCase().includes(q));
  return praefiks.concat(delstreng).slice(0, 4);
}

/** Skifter det skrevne @navn ud med et rigtigt projektnavn i feltet. */
function vaelgProjektForslag(navn) {
  const el = omniEl();
  if (!el) return;
  const t = omniState.tolket;
  const nyt = /\s/.test(navn) ? `"${navn}"` : navn;
  // Kun DET token, der faktisk staar der, skiftes ud - fjernMarkoer kender
  // den samme regel om mellemrum foran markoeren som parseren selv.
  const uden = tovoParse.fjernMarkoer(el.value, '@/', t && t.project ? t.project : '');
  el.value = `${uden} @${nyt} `.replace(/\s{2,}/g, ' ');
  el.focus();
  opdaterOmni();
}

function visDato(iso) {
  if (!iso) return '';
  if (iso === state.today) return 'today';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* ------------------------------------------------------------ raekker */

function byggRaekker() {
  const el = omniEl();
  const raa = el ? el.value : '';
  const q = raa.trim();
  const raekker = [];
  const k = omniKontekst();

  if (omniState.mode === '/' || omniState.mode === '#') {
    const kilde = omniState.mode === '/' ? state.projects : (state.tags || []);
    const passer = kilde.filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()));
    for (const x of passer.slice(0, 12)) {
      raekker.push({ type: 'goto', mode: omniState.mode, id: x.id, titel: x.name,
        under: omniState.mode === '/' ? 'PROJECT' : 'TAG' });
    }
    // BEGGE tilstande kan oprette. Foer kunne kun `/` det, og `#AI` svarede
    // "Type a name to create one" uden at tilbyde raekken - der stod altsaa en
    // vejledning til noget, man ikke kunne gøre.
    if (q && !kilde.some((x) => x.name.toLowerCase() === q.toLowerCase())) {
      raekker.push(omniState.mode === '/'
        ? { type: 'nyt', navn: q, hvad: 'project' }
        : { type: 'nytTag', navn: q });
    }
    if (!raekker.length) {
      raekker.push({
        type: 'tom',
        titel: omniState.mode === '/' ? 'No projects yet' : 'No tags yet',
        under: 'Type a name to create one',
      });
    }
    return raekker;
  }

  if (q) {
    const t = omniState.tolket;
    const titel = (t && t.title) || q;
    const kunProjekt = t && !t.title && t.project;

    /*
     * "@tovo" alene har ingen titel tilbage - parseren spiste det hele.
     * Foer gav det "there is no text to capture", som er sandt og ubrugeligt:
     * det, brugeren mente, var aabenlyst at oprette eller aabne PROJEKTET.
     * En besked om, at man ikke maa, hoerer kun hjemme, hvor der ikke findes
     * noget fornuftigt at goere.
     */
    if (kunProjekt) {
      const findes = (state.projects || []).find((p) => p.name.toLowerCase() === t.project.toLowerCase());
      if (findes) raekker.push({ type: 'goto', mode: '/', id: findes.id, titel: findes.name, under: 'OPEN PROJECT' });
      else raekker.push({ type: 'nyt', navn: t.project });
    } else {
      raekker.push({
        type: 'fangst',
        titel,
        under: k ? `NEW TASK IN ${k.name.toUpperCase()}` : 'NEW TASK',
      });
    }

    // Skriver man et projektnavn, der ligner et, der findes, saa vis det -
    // FOER resultaterne, fordi det er en rettelse og ikke et opslag.
    if (t && t.project) {
      for (const p of lignendeProjekter(t.project)) {
        raekker.push({ type: 'projektforslag', projekt: p });
      }
    }
  }

  for (const it of omniState.resultater.tasks) raekker.push({ type: 'task', item: it });
  for (const p of omniState.resultater.projects) {
    raekker.push({ type: 'goto', mode: '/', id: p.id, titel: p.name, under: 'PROJECT' });
  }
  if (!raekker.length && q) raekker.push({ type: 'tom', titel: 'No matches', under: 'Enter creates a task' });
  return raekker;
}

function tegnPanel() {
  const panel = document.getElementById('omniPanel');
  if (!panel) return;
  omniState.raekker = byggRaekker();
  if (!omniState.raekker.length) { panel.hidden = true; panel.innerHTML = ''; return; }
  if (omniState.valgt >= omniState.raekker.length) omniState.valgt = 0;

  panel.innerHTML = omniState.raekker.map((r, i) => {
    const valgt = i === omniState.valgt ? ' aria-selected="true"' : '';
    if (r.type === 'task') {
      const it = r.item;
      const projekt = state.projects.find((p) => p.id === it.projectId);
      const under = [projekt ? projekt.name : '', it.dueDate ? visDato(it.dueDate) : '',
        it.estimateMinutes ? `~${tovoBeregn.formatVarighed(it.estimateMinutes)}` : ''].filter(Boolean).join(' · ');
      const koerer = timerState.data && timerState.data.entry.taskId === it.id;
      // Start-knappen SKAL kunne naas herfra: at skulle aabne opgaven for at
      // trykke start er tre klik til noget, der hoerer til ét.
      return `<div class="omni-row${it.status === 'done' ? ' dim' : ''}"${valgt} data-i="${i}" data-raekke>
        ${icon('today')}<span class="omni-row-main">
        <span class="omni-row-title">${esc(it.title)}</span>
        <span class="omni-row-sub">${esc(under || 'no project')}</span></span>
        ${it.status === 'done' ? '' : `<button class="playbtn${koerer ? ' on' : ''}" data-omnistart="${esc(it.id)}"
          title="${koerer ? 'Stop the timer' : 'Start a timer (⌘↵)'}"
          aria-label="${koerer ? 'Stop the timer' : 'Start a timer'}">${icon(koerer ? 'stop' : 'play', 15)}</button>`}
      </div>`;
    }
    if (r.type === 'tom') {
      return `<div class="omni-row empty-row"><span class="omni-row-main">
        <span class="omni-row-title">${esc(r.titel)}</span>
        <span class="omni-row-sub">${esc(r.under)}</span></span></div>`;
    }
    if (r.type === 'goto') {
      return `<button class="omni-row"${valgt} data-i="${i}">
        ${icon(r.mode === '/' ? 'projects' : 'link')}<span class="omni-row-main">
        <span class="omni-row-title">${esc(r.titel)}</span>
        <span class="omni-row-sub">${esc(r.under)}</span></span></button>`;
    }
    if (r.type === 'nyt') {
      return `<button class="omni-row"${valgt} data-i="${i}">
        ${icon('plus')}<span class="omni-row-main">
        <span class="omni-row-title">${esc(r.navn)}</span>
        <span class="omni-row-sub">NEW PROJECT</span></span></button>`;
    }
    if (r.type === 'nytTag') {
      return `<button class="omni-row"${valgt} data-i="${i}">
        ${icon('plus')}<span class="omni-row-main">
        <span class="omni-row-title">${esc(r.navn)}</span>
        <span class="omni-row-sub">NEW TAG</span></span></button>`;
    }
    if (r.type === 'projektforslag') {
      return `<button class="omni-row"${valgt} data-i="${i}">
        ${icon('projects')}<span class="omni-row-main">
        <span class="omni-row-title">${esc(r.projekt.name)}</span>
        <span class="omni-row-sub">EXISTING PROJECT — USE THIS INSTEAD</span></span></button>`;
    }
    return `<button class="omni-row big"${valgt} data-i="${i}">
      <span class="omni-plus">${icon('plus', 20)}</span>
      <span class="omni-row-main"><span class="omni-row-title">${esc(r.titel)}</span></span>
      <span class="omni-badge">${esc(r.under)}</span></button>`;
  }).join('');
  panel.hidden = false;

  panel.querySelectorAll('.omni-row[data-i]').forEach((el) => {
    el.addEventListener('mouseenter', () => { omniState.valgt = Number(el.dataset.i); markerValgt(); });
    el.addEventListener('mousedown', (e) => e.preventDefault());   // behold fokus i feltet
    el.addEventListener('click', () => { omniState.valgt = Number(el.dataset.i); aktiver(); });
  });
  panel.querySelectorAll('[data-omnistart]').forEach((el) => {
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = el.dataset.omnistart;
      const koerer = timerState.data && timerState.data.entry.taskId === id;
      luk();
      if (koerer) await stopTimer();
      else await startTimerPaa(id);
    });
  });
}

function markerValgt() {
  document.querySelectorAll('#omniPanel .omni-row').forEach((el, i) => {
    if (i === omniState.valgt) el.setAttribute('aria-selected', 'true');
    else el.removeAttribute('aria-selected');
  });
}

/* ------------------------------------------------------------ soegning */

function planlaegSoegning() {
  clearTimeout(omniState.soegeTimer);
  const q = omniEl().value.trim();
  if (q.length < 2 || (omniState.mode && omniState.mode !== '+')) {
    omniState.resultater = { tasks: [], projects: [] };
    tegnPanel();
    return;
  }
  omniState.soegeTimer = setTimeout(async () => {
    const token = ++omniState.soegeToken;
    const k = omniKontekst();
    try {
      const d = await api('GET', `/api/v1/search?q=${encodeURIComponent(q)}`
        + (k ? `&project=${encodeURIComponent(k.id)}` : ''));
      // Et AELDRE svar maa aldrig overskrive et nyere - ellers blinker
      // resultaterne tilbage til noget, brugeren er holdt op med at skrive.
      if (token !== omniState.soegeToken) return;
      omniState.resultater = d;
      tegnPanel();
    } catch { /* soegning maa aldrig staa i vejen for fangst */ }
  }, 140);
}

/* ------------------------------------------------------------ handling */

async function aktiver() {
  const raekke = omniState.raekker[omniState.valgt];
  if (!raekke) return;
  if (raekke.type === 'tom') return;
  if (raekke.type === 'projektforslag') { vaelgProjektForslag(raekke.projekt.name); return; }
  if (raekke.type === 'task') { luk(); aabnOpgave(raekke.item.id); return; }
  if (raekke.type === 'goto') {
    luk();
    if (raekke.mode === '/') gaaTil('projects', { project: raekke.id });
    else gaaTil('tags', { tag: raekke.id });
    return;
  }
  if (raekke.type === 'nytTag') {
    try {
      const t = await api('POST', '/api/v1/items', { kind: 'tag', name: raekke.navn });
      luk();
      await genindlaes();
      gaaTil('tags', { tag: t.item.id });
      toast(`Tag “${t.item.name}” created.`);
    } catch (ex) { toast(ex.message); }
    return;
  }
  if (raekke.type === 'nyt') {
    try {
      const p = await api('POST', '/api/v1/items', { kind: 'project', name: raekke.navn, sections: [] });
      luk();
      await genindlaes();
      gaaTil('projects', { project: p.item.id });
      toast(`Project “${p.item.name}” created.`);
    } catch (ex) { toast(ex.message); }
    return;
  }
  await fangstNu();
}

async function fangstNu() {
  const el = omniEl();
  const tekst = el.value.trim();
  if (!tekst) return;
  const k = omniKontekst();
  try {
    const r = await api('POST', '/api/v1/capture', {
      text: tekst,
      projectId: k ? k.id : null,
    });
    luk();
    await genindlaes();
    // Advarsler fra parseren skal SIGES. Et estimat, der ikke blev forstaaet,
    // staar stadig i titlen - og det skal brugeren vide nu, ikke om en uge.
    if (r.warnings && r.warnings.length) toast(r.warnings[0]);
    else if (r.timer) toast(`Added and started: ${r.item.title}`, { label: 'Stop', run: stopTimer });
    else toast(`Added: ${r.item.title}`, { label: 'Open', run: () => aabnOpgave(r.item.id) });
  } catch (ex) {
    toast(ex.message);
  }
}

function luk() {
  const el = omniEl();
  if (el) { el.value = ''; el.blur(); }
  omniState.tolket = null;
  omniState.valgt = 0;
  omniState.resultater = { tasks: [], projects: [] };
  saetMode(null);
  tegnLegend();
  tegnChips();
  const panel = document.getElementById('omniPanel');
  if (panel) { panel.hidden = true; panel.innerHTML = ''; }
}

function opdaterOmni() {
  const el = omniEl();
  if (!el) return;
  // Foerste tegn vaelger tilstand og fjernes fra feltet, saa pillen baerer den.
  if (!omniState.mode && el.value.length === 1 && MODER[el.value]) {
    saetMode(el.value);
    el.value = '';
    tegnLegend();
  }
  omniState.tolket = (!omniState.mode || omniState.mode === '+') ? tolkNu(el.value) : null;
  omniState.valgt = 0;
  tegnChips();
  planlaegSoegning();
  tegnPanel();
}

/*
 * Feltet skal SIGE, hvor det arbejder.
 *
 * Kontekstbevidstheden virkede fra foerste faerd - en fangst inde i et
 * projekt landede rigtigt - men pladsholderen og legenden blev staaende paa
 * den generelle tekst, fordi de kun blev tegnet ved skallens optegning.
 * En funktion, der opfoerer sig anderledes, end interfacet siger, er den
 * slags, brugeren opdager som en fejl, selv naar den goer det rigtige.
 */
function opdaterOmniKontekst() {
  if (!omniEl()) return;
  saetMode(omniState.mode);
  tegnLegend();
}

function bindOmni() {
  const el = omniEl();
  if (!el) return;
  saetMode(null);
  tegnLegend();
  tegnChips();

  el.addEventListener('input', opdaterOmni);
  el.addEventListener('focus', tegnPanel);
  el.addEventListener('blur', () => {
    // Lille forsinkelse, saa et klik paa en raekke naar at blive registreret.
    setTimeout(() => {
      if (document.activeElement === el) return;
      const p = document.getElementById('omniPanel');
      if (p) p.hidden = true;
    }, 150);
  });

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); luk(); return; }
    // Backspace i et TOMT felt forlader tilstanden i stedet for ingenting.
    if (e.key === 'Backspace' && !el.value && omniState.mode) {
      e.preventDefault();
      saetMode(null);
      tegnLegend();
      opdaterOmni();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!omniState.raekker.length) return;
      e.preventDefault();
      const n = omniState.raekker.length;
      omniState.valgt = (omniState.valgt + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      markerValgt();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Cmd/Ctrl+Enter paa en fundet opgave STARTER den i stedet for at
      // aabne den - den hurtige vej fra soegning til registrering.
      const raekke = omniState.raekker[omniState.valgt];
      if ((e.metaKey || e.ctrlKey) && raekke && raekke.type === 'task') {
        const id = raekke.item.id;
        luk();
        startTimerPaa(id);
        return;
      }
      aktiver();
    }
  });
}

/*
 * Genvejene til feltet.
 *
 * Cmd/Ctrl+K aabner det overalt. Og skriver man bare et bogstav, aabner det
 * ogsaa - men undtagelserne er vigtigere end reglen: uden dem stjaeler
 * paletten tastetryk fra ethvert felt i appen.
 */
document.addEventListener('keydown', (e) => {
  if (!state.user) return;
  const omni = omniEl();
  if (!omni) return;

  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    omni.focus();
    omni.select();
    tegnPanel();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (document.querySelector('.modal')) return;
  /*
   * Her afviger tovo fra doda med vilje.
   *
   * doda traekker sig, saa snart fokus staar i en `[data-keynav]`-liste,
   * fordi dodas raekker EJER bogstaverne (n = next, w = waiting, x = slet).
   * tovos raekker bruger kun Enter og mellemrum, saa den samme regel ville
   * betyde, at bogstaver blev aedt: man staar i listen, skriver, og der sker
   * ingenting. Planen siger det modsatte - bogstaver skal kunne skrives i
   * soegefeltet, uanset hvor man staar.
   *
   * Derfor: kun en liste, der SELV siger, at den vil have bogstaverne
   * (`data-keynav-letters`), faar lov at beholde dem. Kommer der en saadan
   * liste i en senere fase, er mekanismen der allerede.
   */
  if (el && el.closest && el.closest('[data-keynav-letters]')) return;

  if (e.key.length !== 1) return;
  e.preventDefault();
  omni.focus();
  omni.value += e.key;
  opdaterOmni();
});

/*
 * Vejen IND i listen er piletaster - aldrig bogstaver.
 *
 * doda havde genveje paa raekkerne, som kun virkede naar en raekke havde
 * fokus, og fokus kunne kun komme fra et klik, der samtidig aabnede opgaven.
 * Genvejene var i praksis uopnaaelige (doda v7). Bogstaver maa ikke foere ind
 * i listen: i en app, hvor man bare kan begynde at skrive, ville det betyde,
 * at man ikke kan fange en opgave, der starter med det bogstav.
 */
document.addEventListener('keydown', (e) => {
  if (!state.user) return;
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (document.querySelector('.modal')) return;

  const raekker = [...document.querySelectorAll('[data-keynav] [data-row]')];
  if (!raekker.length) return;

  const nu = raekker.indexOf(el);
  if (nu < 0) {
    e.preventDefault();
    (e.key === 'ArrowDown' ? raekker[0] : raekker[raekker.length - 1]).focus();
    return;
  }
  e.preventDefault();
  const n = raekker.length;
  raekker[(nu + (e.key === 'ArrowDown' ? 1 : n - 1)) % n].focus();
});

/* Esc slipper listen igen - ellers sidder brugeren fast i en tilstand, hvor
   tasterne betyder noget andet, end de plejer (doda v7). */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const el = document.activeElement;
  if (el && el.closest && el.closest('[data-keynav]')) el.blur();
});

/* ---- p3_opgaver.js ---- */
'use strict';
/* tovo - opgave- og projektvisningerne samt detaljeruden.
 *
 * Ingen udregninger her. Varighed formateres af beregn.js, og alt hvad der
 * ligner en sum, hoerer hjemme dér - ogsaa naar det er ét tal (CLAUDE.md).
 */

const detailState = { id: null };

/* ------------------------------------------------------------ opgaver */

function opgaveRaekke(it, opt) {
  const o = opt || {};
  const projekt = state.projects.find((p) => p.id === it.projectId);
  const dele = [];
  const sag = it.caseNumber || (projekt && projekt.caseNumber) || '';
  if (sag) dele.push(sagHtml(sag));
  if (!o.skjulProjekt && projekt) dele.push(esc(projekt.name));
  if (it.dueDate) {
    const forsinket = it.status !== 'done' && it.dueDate < state.today;
    dele.push(`<span class="${forsinket ? 'overdue' : ''}">${esc(visDato(it.dueDate))}${it.dueTime ? ` ${esc(it.dueTime)}` : ''}</span>`);
  }
  if (it.estimateMinutes) dele.push(`~${esc(tovoBeregn.formatVarighed(it.estimateMinutes))}`);
  for (const id of it.tagIds || []) {
    const tag = (state.tags || []).find((t) => t.id === id);
    if (tag) dele.push(`#${esc(tag.name)}`);
  }
  if ((it.links || []).length) dele.push(`${(it.links || []).length} link${it.links.length > 1 ? 's' : ''}`);

  // Forbrugt tid pr. opgave kommer fra serveren (som regner med beregn.js),
  // ikke fra en optaelling her. En "lille" sum i en visning er stadig en
  // anden sandhed end rapportens.
  const forbrugt = (o.forbrug || {})[it.id];
  if (forbrugt) dele.push(`<span class="post-sum-inline">${esc(tovoBeregn.formatVarighed(forbrugt))}</span>`);
  const koerer = timerState.data && timerState.data.entry.taskId === it.id;

  return `<div class="item-row${it.status === 'done' ? ' dim' : ''}" data-row tabindex="0" data-id="${esc(it.id)}">
    <button class="tick${it.status === 'done' ? ' on' : ''}" data-tick="${esc(it.id)}"
      aria-label="${it.status === 'done' ? 'Reopen' : 'Complete'}"></button>
    <div class="item-main">
      <div class="item-title">${esc(it.title)}</div>
      ${dele.length ? `<div class="item-meta meta">${dele.join(' · ')}</div>` : ''}
    </div>
    ${it.status === 'done' ? '' : `<button class="playbtn${koerer ? ' on' : ''}" data-start="${esc(it.id)}"
      aria-label="${koerer ? 'Stop the timer' : 'Start a timer'}"
      title="${koerer ? 'Stop the timer' : 'Start a timer'}">${icon(koerer ? 'stop' : 'play', 16)}</button>`}
  </div>`;
}

/** Binder en liste af opgaverakker. Kaldes ÉT sted pr. optegning. */
function bindOpgaveListe(host) {
  host.querySelectorAll('[data-fold]').forEach((el) => {
    el.addEventListener('click', () => {
      saetAfsnitAabent(el.dataset.fold, el.getAttribute('aria-expanded') !== 'true');
      tegnSide();
    });
  });
  host.querySelectorAll('[data-start]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const koerer = timerState.data && timerState.data.entry.taskId === el.dataset.start;
      if (koerer) stopTimer();
      else startTimerPaa(el.dataset.start);
    });
  });
  host.querySelectorAll('[data-tick]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      await skiftFaerdig(el.dataset.tick);
    });
  });
  host.querySelectorAll('[data-row]').forEach((el) => {
    el.addEventListener('click', (e) => {
      // Et sagslink er sit eget maal - det maa ikke ogsaa aabne opgaven.
      if (e.target.closest('[data-stop]')) return;
      aabnOpgave(el.dataset.id);
    });
    // Piletasterne foerte hertil; herfra er der tre ting at goere.
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Cmd/Ctrl+Enter starter (eller stopper) timeren paa den raekke, der
        // har fokus - samme genvej som i paletten. En genvej, der kun virker
        // ét sted, er en genvej, man ikke laerer.
        if (e.metaKey || e.ctrlKey) {
          const koerer = timerState.data && timerState.data.entry.taskId === el.dataset.id;
          if (koerer) stopTimer();
          else startTimerPaa(el.dataset.id);
          return;
        }
        aabnOpgave(el.dataset.id);
        return;
      }
      if (e.key === ' ') { e.preventDefault(); skiftFaerdig(el.dataset.id); }
    });
  });
}

async function skiftFaerdig(id) {
  const it = state.items.find((x) => x.id === id);
  const luk = !it || it.status !== 'done';
  try {
    await api('POST', `/api/v1/tasks/${id}/complete`, { done: luk });
    await genindlaes();
    if (luk) toast('Completed.', { label: 'Undo', run: async () => {
      await api('POST', `/api/v1/tasks/${id}/complete`, { done: false });
      await genindlaes();
    } });
  } catch (ex) { toast(ex.message); }
}

/* --------------------------------------------------------------- sider */

async function tegnIDag() {
  const host = document.getElementById('pageHost');
  const [d, p] = await Promise.all([
    api('GET', '/api/v1/items?kind=task'),
    api('GET', `/api/v1/entries?from=${state.today}&to=${state.today}`),
  ]);
  state.items = d.items;
  const aabne = d.items.filter((t) => t.status !== 'done');

  /*
   * Dagens raekkefoelge er et svar paa "hvad skal jeg lave nu".
   *
   * Overskredet foerst, saa det der forfalder i dag, saa det man allerede
   * har roert i dag - og foerst derefter resten. Én liste med alt i ville
   * betyde, at man skal LEDE efter dagens arbejde, og saa er visningen
   * ingen hjaelp.
   */
  const overskredet = aabne.filter((t) => t.dueDate && t.dueDate < state.today);
  const iDag = aabne.filter((t) => t.dueDate === state.today);
  const roertIDag = new Set(p.entries.map((e) => e.taskId));
  const arbejdet = aabne.filter((t) => roertIDag.has(t.id)
    && !overskredet.includes(t) && !iDag.includes(t));
  const resten = aabne.filter((t) => !overskredet.includes(t) && !iDag.includes(t)
    && !arbejdet.includes(t));
  const faerdige = d.items.filter((t) => t.status === 'done' && t.completedAt
    && isoDato(new Date(t.completedAt * 1000)) === state.today);

  host.innerHTML = `<div class="page">
    <div class="row" style="justify-content:space-between;align-items:baseline">
      <h1>Today</h1>
      <button class="btn" id="logManual">${icon('plus', 15)} Log time</button>
    </div>
    <p class="lead">${esc(BESKRIVELSER.today)}</p>

    <div class="card">
      ${dagskortHtml(p, d)}
    </div>

    <div data-keynav>
      ${afsnit('Overdue', overskredet)}
      ${afsnit('Due today', iDag)}
      ${afsnit('Worked on today', arbejdet)}
      ${afsnit('Everything else', resten, { foldbar: true, noegle: 'today-resten' })}
      ${faerdige.length ? afsnit('Done today', faerdige, { foldbar: true, noegle: 'today-faerdige' }) : ''}
    </div>
    ${!d.items.length ? '<div class="empty"><p class="empty-title">Nothing here yet</p>'
      + '<p>Type in the field above to add your first task.</p></div>' : ''}
    <p class="hintline meta">Arrow keys move into the list · Enter opens · ⌘↵ starts the timer
      · Space completes · Esc leaves · ⌘⇧M logs time by hand</p>
  </div>`;
  bindOpgaveListe(host);
  bindPoster(host, d.items);
  document.getElementById('logManual').addEventListener('click', () => aabnManuel());
  // Et hul er et FORSLAG: klikket aabner formularen udfyldt med tidsrummet,
  // saa man kun skal vaelge opgaven. Ingenting gemmes af sig selv.
  host.querySelectorAll('[data-hul]').forEach((el) => {
    el.addEventListener('click', () => aabnManuel(null, { date: state.today, text: el.dataset.hul }));
  });
}

/**
 * Dagens registreringer paa Today - foldbart.
 *
 * Kortet er dagens vigtigste TAL og dagens laengste LISTE i ét. Totalen
 * bliver derfor staaende, ogsaa naar man folder sammen; det er posterne og
 * hullerne, der fylder. Sammenfoldet siger overskriften stadig, hvad der
 * gemmer sig, saa foldningen ikke er blind.
 *
 * Genbruger `data-fold`-mekanikken fra de foldbare opgaveafsnit
 * (`bindOpgaveListe` binder alt med attributten), saa der ikke opstaar to
 * maader at folde paa i samme app.
 */
function dagskortHtml(p, d) {
  const total = esc(tovoBeregn.formatVarighed(state.todayMinutes || 0));
  const huller = p.gaps || [];
  // Standarden foelger LAENGDEN, som de andre foldbare afsnit: en dag med et
  // par poster er ingen stoej, og saa skal man ikke klikke for at se den.
  const aabent = afsnitAabent('today-poster', p.entries.length + huller.length <= 6);

  const dele = [];
  if (p.entries.length) dele.push(`${p.entries.length} ${p.entries.length === 1 ? 'entry' : 'entries'}`);
  if (huller.length) dele.push(`${huller.length} ${huller.length === 1 ? 'gap' : 'gaps'}`);

  return `<h2 class="dagfold-hoved">
      <button class="gruppefold${aabent ? ' on' : ''}" data-fold="today-poster"
        aria-expanded="${aabent ? 'true' : 'false'}"
        title="${aabent ? 'Fold what you registered away' : 'Show what you registered'}">
        ${icon('chevron', 13)}<span>${total} today</span>
      </button>
      ${!aabent && dele.length ? `<span class="group-count">${esc(dele.join(' · '))}</span>` : ''}
    </h2>
    ${!aabent ? '' : `
      ${p.entries.length ? `<ul class="plain posts">${p.entries.map((e) => postRaekke(e, d.items)).join('')}</ul>`
    : '<p class="meta">Nothing logged yet. Start a timer on a task, or log it by hand.</p>'}
      ${huller.length ? `<div class="huller">
        <div class="meta">Gaps between what you registered — this is where forgotten time hides.</div>
        ${huller.map((h) => `<button class="hul" data-hul="${esc(h.fra)}-${esc(h.til)}">
          <span>${esc(h.fra)}–${esc(h.til)}</span>
          <span class="meta">${esc(tovoBeregn.formatVarighed(h.minutter))} unaccounted</span>
        </button>`).join('')}
      </div>` : ''}
      ${p.rounding ? `<p class="meta">Shown rounded to ${p.rounding} minutes — the stored times are exact.</p>` : ''}`}`;
}

/**
 * Et afsnit med opgaver.
 *
 * @param {object} [opt] {forbrug, foldbar, noegle}
 *
 * Et FOLDBART afsnit begynder sammenfoldet, naar listen er lang (over otte).
 * En lang liste under "det andet" er stoej paa en side, der skal svare paa
 * hvad man laver I DAG - men et afsnit med tre punkter er ingen stoej, og
 * saa skal man ikke skulle klikke for at se dem. Valget huskes, saa snart
 * brugeren selv har taget det.
 */
function afsnit(titel, liste, opt) {
  const o = opt || {};
  if (!liste.length) return '';
  if (!o.foldbar) {
    return `<h2 class="group">${esc(titel)}<span class="group-count">${liste.length}</span></h2>
      ${liste.map((it) => opgaveRaekke(it, o)).join('')}`;
  }
  const aabent = afsnitAabent(o.noegle, liste.length <= 8);
  return `<h2 class="group">
      <button class="gruppefold${aabent ? ' on' : ''}" data-fold="${esc(o.noegle)}"
        aria-expanded="${aabent ? 'true' : 'false'}">
        ${icon('chevron', 13)}<span>${esc(titel)}</span>
        <span class="group-count">${liste.length}</span>
      </button>
    </h2>
    ${aabent ? liste.map((it) => opgaveRaekke(it, o)).join('') : ''}`;
}

/* Ogsaa foldningen foelger brugeren: har man foldet dagens registreringer
   sammen paa desktop, skal telefonen ikke folde dem ud igen. */
function afsnitAabent(noegle, standard) {
  return brugerFlag(`fold_${noegle}`, standard, `tovo_fold_${noegle}`);
}

function saetAfsnitAabent(noegle, aabent) {
  saetBrugerFlag(`fold_${noegle}`, aabent);
}

/* Kort eller liste. Kort er rare, naar der er tre projekter; en liste er
   det, der duer, naar der er tredive. Valget huskes. */
function projektListeTilstand() {
  return brugerFlag('view_projects_list', false, 'tovo_projekter_liste');
}

async function tegnProjekter() {
  const host = document.getElementById('pageHost');
  if (state.openProject === INTET_PROJEKT) { await tegnUdenProjekt(); return; }
  if (state.openProject) { await tegnProjekt(state.openProject); return; }
  const [d, poster] = await Promise.all([
    api('GET', '/api/v1/items?kind=task'),
    api('GET', '/api/v1/entries'),
  ]);
  state.items = d.items;
  // Forbrug pr. projekt: posternes minutter lagt paa opgavernes projekt.
  // Formateringen kommer fra beregn.js - her lægges kun tal sammen, som
  // serveren allerede har afrundet.
  const forbrugPrProjekt = {};
  const projektFor = new Map(d.items.map((t) => [t.id, t.projectId || '__uden']));
  for (const e of poster.entries) {
    const pid = projektFor.get(e.taskId);
    if (!pid) continue;
    const minutter = Math.round(((e.stoppedAt || Math.floor(Date.now() / 1000)) - e.startedAt) / 60);
    forbrugPrProjekt[pid] = (forbrugPrProjekt[pid] || 0) + tovoBeregn.afrund(minutter, poster.rounding);
  }

  const somListe = projektListeTilstand();
  host.innerHTML = `<div class="page">
    <div class="row" style="justify-content:space-between;align-items:baseline">
      <h1>Projects</h1>
      <span class="row" style="gap:8px">
        <button class="btn" id="projektVis">${somListe ? 'Cards' : 'List'}</button>
        <button class="btn" id="plannerImport">Import from Planner</button>
      </span>
    </div>
    <p class="lead">${esc(BESKRIVELSER.projects)}</p>
    ${state.projects.length ? (somListe
    ? `<table class="data projektliste">
        <tr><th>Project</th><th>Customer</th><th>Case</th><th class="num">Open</th><th class="num">Spent</th></tr>
        ${state.projects.map((p) => {
      const opgaver = d.items.filter((t) => t.projectId === p.id);
      return `<tr class="projektraekke" data-projekt="${esc(p.id)}">
          <td><strong>${esc(p.name)}</strong></td>
          <td class="meta">${esc(p.customer || '—')}</td>
          <td>${p.caseNumber ? sagHtml(p.caseNumber) : '<span class="meta">—</span>'}</td>
          <td class="num">${opgaver.filter((t) => t.status !== 'done').length}</td>
          <td class="num">${esc(tovoBeregn.formatVarighed(forbrugPrProjekt[p.id] || 0))}</td>
        </tr>`;
    }).join('')}
        ${(() => {
      const uden = d.items.filter((t) => !t.projectId);
      if (!uden.length) return '';
      return `<tr class="projektraekke" data-projekt="${INTET_PROJEKT}">
            <td class="meta">No project</td><td class="meta">—</td><td class="meta">—</td>
            <td class="num">${uden.filter((t) => t.status !== 'done').length}</td>
            <td class="num">${esc(tovoBeregn.formatVarighed(forbrugPrProjekt.__uden || 0))}</td></tr>`;
    })()}
      </table>`
    : `<div class="cards">${state.projects.map((p) => {
      const opgaver = d.items.filter((t) => t.projectId === p.id);
      const aabne = opgaver.filter((t) => t.status !== 'done').length;
      return `<button class="card projectcard" data-projekt="${esc(p.id)}">
        <h2>${esc(p.name)}</h2>
        <div class="meta">${esc(p.customer || 'no customer')}${p.caseNumber ? ` · ${esc(p.caseNumber)}` : ''}
          · ${aabne} open · ${opgaver.length} total</div>
      </button>`;
    }).join('')}${(() => {
      const uden = d.items.filter((t) => !t.projectId);
      if (!uden.length) return '';
      return `<button class="card projectcard uden" data-projekt="${INTET_PROJEKT}">
        <h2>No project</h2>
        <div class="meta">${uden.filter((t) => t.status !== 'done').length} open · ${uden.length} total</div>
      </button>`;
    })()}</div>`) : '<div class="empty"><p class="empty-title">No projects yet</p>'
      + '<p>Type <code>/</code> in the field above to create one.</p></div>'}
  </div>`;
  document.getElementById('projektVis').addEventListener('click', () => {
    // saetBrugerFlag opdaterer state SYNKRONT og gemmer i baggrunden, saa
    // knappen ikke venter paa en rundtur.
    saetBrugerFlag('view_projects_list', !somListe);
    tegnSide();
  });
  document.getElementById('plannerImport').addEventListener('click', () => aabnPlannerImport(null));
  host.querySelectorAll('[data-projekt]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-stop]')) return;      // sagslinket er sit eget maal
      gaaTil('projects', { project: el.dataset.projekt });
    });
  });
}

/**
 * Opgaver uden projekt.
 *
 * De er ikke "et projekt med tomt navn": der er ingen ramme, ingen kunde og
 * intet at rulle op. Derfor sin egen visning frem for at presse dem ind i
 * projektsidens skabelon med fire tomme tal i toppen.
 */
async function tegnUdenProjekt() {
  const host = document.getElementById('pageHost');
  const d = await api('GET', '/api/v1/no-project');
  state.items = d.tasks;
  const aabne = d.tasks.filter((t) => t.status !== 'done');
  const faerdige = d.tasks.filter((t) => t.status === 'done');

  host.innerHTML = `<div class="page">
    <button class="linkbtn" id="tilbage">← Projects</button>
    <h1>No project</h1>
    <p class="lead">Ad hoc — ${esc(tovoBeregn.formatVarighed(d.minutes))} logged on these.
      Give one a project with <code>@name</code> in the field above.</p>
    <div data-keynav>
      ${afsnit('Open', aabne, { forbrug: d.spent })}
      ${faerdige.length ? afsnit('Done', faerdige, { forbrug: d.spent, foldbar: true, noegle: 'uden-faerdige' }) : ''}
    </div>
    ${!d.tasks.length ? '<div class="empty"><p class="empty-title">Nothing here</p>'
      + '<p>Every task belongs to a project.</p></div>' : ''}
    <p class="hintline meta">Arrow keys move into the list · Enter opens · ⌘↵ starts the timer
      · Space completes · Esc leaves</p>
  </div>`;
  document.getElementById('tilbage').addEventListener('click', () => gaaTil('projects'));
  bindOpgaveListe(host);
}

async function tegnProjekt(id) {
  const host = document.getElementById('pageHost');
  let d;
  try {
    d = await api('GET', `/api/v1/projects/${id}`);
  } catch (ex) {
    state.openProject = null;
    toast(ex.message);
    await tegnProjekter();
    return;
  }
  state.items = d.tasks;
  const p = d.project;
  const r = d.rollup;
  const paaTavle = tavleTilstand(p.id);
  const aabne = d.tasks.filter((t) => t.status !== 'done');
  const faerdige = d.tasks.filter((t) => t.status === 'done');
  const sektioner = (p.sections || []).slice().sort((a, b) => a.position - b.position);
  const iSektion = (sid) => aabne.filter((t) => (t.sectionId || null) === sid);

  // Tavlen har brug for mere end en laesebredde - se `.page.bred` i CSS'en.
  host.innerHTML = `<div class="page${paaTavle ? ' bred' : ''}">
    <button class="linkbtn" id="tilbage">← Projects</button>
    <div class="row" style="justify-content:space-between;align-items:baseline">
      <h1>${esc(p.name)}</h1>
      <span class="row" style="gap:8px">
        <button class="btn${paaTavle ? ' primary' : ''}" id="visTavle">${paaTavle ? 'List' : 'Board'}</button>
        <button class="btn" id="projektRet">Edit project</button>
        <button class="btn" id="plannerRe">Re-import</button>
        <button class="btn" id="kundeVis">Customer view</button>
        <button class="btn" id="bulkLinks">Copy start links</button>
      </span>
    </div>
    <p class="lead">${esc(p.customer || 'No customer set')}</p>

    <div class="card">
      <div class="row">
        <div style="flex:1" title="The task estimates added up. It grows as you find more work.">
          <div class="meta">Estimated</div>
          <div class="bigtal">${esc(tovoBeregn.formatVarighed(r.estimat))}</div>
          <div class="meta talforklaring">${r.opgaver} task estimates, added up</div></div>
        <div style="flex:1" title="What you agreed with the customer. You set it by hand.">
          <div class="meta">Budget</div>
          <div class="bigtal">${r.ramme ? esc(tovoBeregn.formatVarighed(r.ramme)) : '—'}</div>
          <div class="meta talforklaring">${r.ramme ? 'what was agreed' : 'not set — Edit project'}</div></div>
        <div style="flex:1" title="Time actually logged on the tasks in this project.">
          <div class="meta">Spent</div>
          <div class="bigtal">${esc(tovoBeregn.formatVarighed(r.forbrugt))}</div>
          <div class="meta talforklaring">logged so far</div></div>
        <div style="flex:1" title="Budget minus spent.">
          <div class="meta">Left</div>
          <div class="bigtal">${r.resterende === null ? '—' : esc(tovoBeregn.formatVarighed(Math.max(0, r.resterende)))}</div>
          <div class="meta talforklaring">${r.ramme ? 'of the budget' : 'needs a budget'}</div></div>
      </div>
      ${r.estimatOverRamme ? '<p class="meta warnline">The estimates add up to more than the budget — '
    + 'that is more work than was sold.</p>' : ''}
      ${r.procent === null ? '' : (r.procent >= 100
    ? `<p class="meta warnline">The budget is used up — ${r.procent}% of it is spent.</p>`
    : (r.procent >= 80 ? `<p class="meta warnline">${r.procent}% of the budget is used.</p>` : ''))}
    </div>

    ${paaTavle ? `<div class="row" style="margin-bottom:10px">
        <button class="linkbtn" id="tvKolonner">Edit columns</button>
        <span class="meta">Drag a card between columns — or use the arrow on the card.</span>
      </div>
      ${tavleHtml(p, d.tasks, d.spent)}
      <p class="hintline meta">Arrow keys move into the board · ← → change column
        · Enter opens · ⌘↵ starts the timer · Space completes · Esc leaves</p>`
    : `<div data-keynav>
      ${sektioner.map((sek) => afsnit(sek.name, iSektion(sek.id), { forbrug: d.spent })).join('')}
      ${afsnit(sektioner.length ? 'No section' : 'Open', iSektion(null), { forbrug: d.spent })}
      ${faerdige.length ? afsnit('Done', faerdige, { forbrug: d.spent, foldbar: true, noegle: `projekt-faerdige-${p.id}` }) : ''}
    </div>`}
    ${!d.tasks.length ? '<div class="empty"><p class="empty-title">No tasks in this project</p>'
      + '<p>The field above adds them here — you are inside the project.</p></div>' : ''}
    <p class="hintline meta">Arrow keys move into the list · Enter opens · ⌘↵ starts the timer
      · Space completes · Esc leaves</p>
  </div>`;
  document.getElementById('tilbage').addEventListener('click', () => gaaTil('projects'));
  // ÉN binding, ikke to. Bindes begge, fyrer hvert klik to gange - og et
  // flueben ville blive sat og fjernet i samme oejeblik.
  if (paaTavle) bindTavle(host, p, d.tasks, d.spent);
  else bindOpgaveListe(host);
  document.getElementById('visTavle').addEventListener('click', () => {
    saetTavleTilstand(p.id, !paaTavle);
    tegnSide();
  });
  document.getElementById('projektRet').addEventListener('click', () => aabnProjektRuden(p));
  document.getElementById('plannerRe').addEventListener('click', () => aabnPlannerImport(p.id));
  document.getElementById('kundeVis').addEventListener('click', () => visKundevisning(p.id));
  document.getElementById('bulkLinks').addEventListener('click', async () => {
    try {
      // Markdown-listen laves paa SERVEREN, saa den ser ens ud, uanset hvem
      // der beder om den - ogsaa en MCP-klient senere.
      const d = await api('POST', `/api/v1/projects/${p.id}/links`, {});
      if (!d.links.length) { toast('No open tasks to link to.'); return; }
      const ok = await kopier(d.markdown);
      toast(ok ? `${d.links.length} links copied as markdown — paste them into OneNote.`
        : 'Could not reach the clipboard. Open a task to copy its link by hand.');
    } catch (ex) { toast(ex.message); }
  });
}

/**
 * Projektets egne felter.
 *
 * Kunden, rammen og navnet kunne indtil nu kun saettes gennem API'et - der
 * var ingen vej i interfacet, og saa findes funktionen ikke.
 */
function aabnProjektRuden(p) {
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
    <div class="modal-card" role="dialog" aria-label="Edit project">
      <h2>Edit project</h2>
      <label class="field"><span>Name</span>
        <input class="input" id="pjName" value="${esc(p.name || '')}"></label>
      <label class="field"><span>Customer</span>
        <input class="input" id="pjKunde" placeholder="Who is it for?" value="${esc(p.customer || '')}"></label>
      <label class="field"><span>Case number</span>
        <input class="input" id="pjSag" placeholder="SAG-1234" value="${esc(p.caseNumber || '')}"></label>
      <p class="meta">Every task in the project inherits this number unless it has its own —
        it is what the hours are booked against in your other system.</p>
      <label class="field"><span>Budget (hours)</span>
        <input class="input" id="pjRamme" inputmode="decimal" placeholder="e.g. 40"
          value="${esc(p.budgetHours || '')}"></label>
      <p class="meta">The <strong>budget</strong> is what you agreed with the customer.
        <strong>Estimated</strong> is your own task estimates added up — when they pass the
        budget, you have found more work than was sold.</p>
      ${p.plannerPlanName ? `<p class="meta">Linked to the Planner plan “${esc(p.plannerPlanName)}”.</p>` : ''}
      <div class="modal-foot">
        <button class="btn primary" id="pjSave" title="⌘↵ / Ctrl+↵">Save <span class="genvejstip">⌘↵</span></button>
        <button class="btn" id="pjClose">Cancel</button>
        <span style="flex:1"></span>
        <button class="btn" id="pjArkiv">${p.archivedAt ? 'Unarchive' : 'Archive'}</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });
  document.getElementById('pjClose').addEventListener('click', luk);

  const gemProjektet = async () => {
    const raa = document.getElementById('pjRamme').value.trim().replace(',', '.');
    if (raa && !(Number(raa) >= 0)) { toast(`"${raa}" is not a number of hours.`); return; }
    try {
      await api('PATCH', `/api/v1/items/${p.id}`, {
        name: document.getElementById('pjName').value,
        customer: document.getElementById('pjKunde').value,
        caseNumber: document.getElementById('pjSag').value.trim(),
        budgetHours: raa ? Number(raa) : null,
      });
      luk();
      await genindlaes();
      toast('Saved.');
    } catch (ex) { toast(ex.message); }
  };
  document.getElementById('pjSave').addEventListener('click', gemProjektet);
  bindGemGenvej(host, gemProjektet);

  document.getElementById('pjArkiv').addEventListener('click', async () => {
    try {
      await api('PATCH', `/api/v1/items/${p.id}`,
        { archivedAt: p.archivedAt ? null : Math.floor(Date.now() / 1000) });
      luk();
      // Et arkiveret projekt er ikke i listen laengere - saa staar man et
      // sted, der ikke findes.
      if (!p.archivedAt) gaaTil('projects');
      await genindlaes();
      toast(p.archivedAt ? 'Unarchived.' : 'Archived.');
    } catch (ex) { toast(ex.message); }
  });

  document.getElementById('pjName').focus();
}

/* ---------------------------------------------------------- detaljeruden */

async function aabnOpgave(id) {
  let it;
  let kommentarer = [];
  let startLink = null;
  try {
    const d = await api('GET', `/api/v1/items/${id}`);
    it = d.item;
    startLink = d.link;
    kommentarer = (await api('GET', `/api/v1/tasks/${id}/comments`)).comments;
  } catch (ex) { toast(ex.message); return; }

  detailState.id = id;
  const projekt = state.projects.find((p) => p.id === it.projectId);
  // Staar der intet paa opgaven, gaelder projektets sagsnummer - og saa skal
  // feltet VISE det som pladsholder frem for at se tomt ud.
  const sagArvet = (!it.caseNumber && projekt && projekt.caseNumber) ? projekt.caseNumber : '';
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
    <div class="modal-card detail" role="dialog" aria-label="Task">
      <div class="detail-head">
        <button class="tick big${it.status === 'done' ? ' on' : ''}" id="dTick"
          aria-label="${it.status === 'done' ? 'Reopen' : 'Complete'}"></button>
        <input class="detail-title input" id="dTitle" value="${esc(it.title)}"
          title="You can write #tag, @project, :case, ~estimate and !date here too">
      </div>

      <div class="tagrow" id="dTags"></div>

      <label class="field"><span>Notes</span>
        <textarea class="input" id="dNote">${esc(it.note || '')}</textarea></label>

      <div class="row">
        <label class="field" style="flex:1"><span>Estimate</span>
          <input class="input" id="dEst" placeholder="2,5t · 90m · 1t30m"
            value="${esc(it.estimateMinutes ? tovoBeregn.formatVarighed(it.estimateMinutes) : '')}"></label>
        <label class="field" style="flex:1"><span>Due</span>
          <input class="input" id="dDue" type="date" value="${esc(it.dueDate || '')}"></label>
        <label class="field" style="flex:1"><span>Case number</span>
          <input class="input" id="dSag" placeholder="${esc(sagArvet ? `${sagArvet} (from the project)` : 'SAG-1234')}"
            value="${esc(it.caseNumber || '')}"></label>
        ${kolonneFeltHtml(projekt, it)}
      </div>

      <div class="meta">${esc(projekt ? projekt.name : 'No project')}</div>

      <label class="field" style="margin-top:12px"><span>Repeats</span>
        <input class="input" id="dGentag" placeholder="every monday at 9 · every 2 weeks · every! friday"
          value="${esc(it.recurrenceRule ? tovoParse.beskrivGentagelse(it.recurrenceRule).split(' · ')[0] : '')}"></label>
      <p class="meta">${it.recurrenceRule
    ? `Now: ${esc(tovoParse.beskrivGentagelse(it.recurrenceRule))}. Clear the field to stop it.`
    : 'Leave it empty for a one-off task.'}
        The estimate is <strong>per time</strong> — each new occurrence starts with the same
        one, and the hours you log add up on each occurrence separately.
        <code>every!</code> counts from when you finish, not from the plan.</p>
      ${it.recurrenceRule ? `<div class="row"><button class="linkbtn" id="dStopGentag">Stop repeating</button>
        <span class="meta">The task stays — only the rule goes away.</span></div>` : ''}
      ${it.dueDate ? `<div class="row" style="margin-top:8px">
        <button class="btn" id="dIcs">Add to calendar</button>
        <span class="meta">One-off .ics — the feed in Settings keeps everything in sync.</span>
      </div>` : ''}

      <h2 style="margin-top:18px">Start link</h2>
      <p class="meta">Paste it into OneNote next to the task. One click starts the timer,
        the next one stops it — no sign-in needed.</p>
      <div class="row">
        <button class="btn" id="dStartLink">${startLink ? 'Copy start link' : 'Create start link'}</button>
        ${startLink ? '<button class="linkbtn" id="dRevoke">revoke</button>' : ''}
      </div>
      ${startLink ? `<p class="meta startlink-url">${esc(startLink.url)}</p>` : ''}

      <h2 style="margin-top:18px">Links</h2>
      <ul class="plain" id="dLinks">${(it.links || []).map((l, i) => `
        <li>${linkHtml(l)}<button class="linkbtn" data-fjernlink="${i}">remove</button></li>`).join('')}</ul>
      <div class="row">
        <input class="input" id="dLinkUrl" placeholder="https://… or onenote:…" style="flex:2">
        <input class="input" id="dLinkLabel" placeholder="Label" style="flex:1">
        <button class="btn" id="dLinkAdd">Add link</button>
      </div>

      <h2 style="margin-top:18px">Comments</h2>
      <ul class="plain kommentarer" id="dComments">${kommentarer.map((c) => `
        <li>
          <span class="kommentar-tid meta" title="${esc(new Date((c.createdAt || 0) * 1000).toLocaleString('en-GB'))}">${esc(visTidspunkt(c.createdAt))}</span>
          <span class="kommentar-tekst">${linkify(c.text)}</span>
        </li>`).join('') || '<li class="meta">No comments yet</li>'}</ul>
      <div class="row">
        <input class="input" id="dComment" placeholder="Write a comment…" style="flex:1">
        <button class="btn" id="dCommentAdd">Add</button>
      </div>

      <div class="modal-foot">
        <button class="btn primary" id="dSave" title="⌘↵ / Ctrl+↵">Save <span class="genvejstip">⌘↵</span></button>
        <button class="btn" id="dStart">${icon('play', 15)} Start timer</button>
        <button class="btn" id="dLog">Log time</button>
        <button class="btn" id="dDuplicate">Duplicate</button>
        <button class="btn" id="dClose">Close</button>
        <span style="flex:1"></span>
        <button class="btn danger" id="dDelete">Delete</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  bindDetalje(host, it, startLink);
}

/**
 * Kolonnen (= projektets sektion) som dropdown i opgaveruden.
 *
 * Den stod foer som "Priority", et felt der blev importeret fra Planner og
 * vist INGEN steder - hverken i listerne eller paa tavlen. Kolonnen er
 * derimod det, tavlen faktisk er bygget af, og kunne kun saettes ved at
 * traekke et kort. Prioriteten bliver stadig gemt og importeret; den er
 * bare ikke laengere det, pladsen bruges paa.
 *
 * Har projektet ingen kolonner, er der intet at vaelge imellem, og feltet
 * udelades helt frem for at staa som en tom dropdown.
 */
function kolonneFeltHtml(projekt, it) {
  const sektioner = ((projekt && projekt.sections) || []).slice()
    .sort((a, b) => a.position - b.position);
  if (!sektioner.length) return '';
  return `<label class="field" style="flex:1"><span>Column</span>
    <select class="input" id="dSektion">
      <option value="">—</option>
      ${sektioner.map((s) => `<option value="${esc(s.id)}"${it.sectionId === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
    </select></label>`;
}

/* Et link tegnes af den HVIDLISTEDE vej - ikke af linkify, som kun tillader
   http(s). onenote: er hele grunden til, at tovo findes: opgaverne bor i
   OneNote, og linket skal kunne klikkes. Serveren har allerede afvist alt
   andet end http, https og onenote (rentLink). */
function linkHtml(l) {
  return `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || l.url)}</a>`;
}

function bindDetalje(host, it, startLink) {
  const luk = () => { host.remove(); detailState.id = null; };

  /*
   * Maerkaterne paa opgaven.
   *
   * De var USYNLIGE i ruden foer: at skrive #Ai i titlen satte faktisk
   * maerkatet, men intet sted i ruden viste det, saa funktionen lignede en,
   * der ikke virkede - og blev meldt som en mangel. Raekken siger nu baade
   * hvad opgaven HAR, og hvordan man tilfoejer mere.
   *
   * Listen holdes LOKALT, indtil der gemmes - samme moenster som
   * kolonneruden. Saa kan flere fjernes i én omgang, og Cancel fortryder
   * dem alle i stedet for at have skrevet undervejs.
   */
  let valgteTags = (it.tagIds || []).slice();
  const tegnTags = () => {
    const raekke = host.querySelector('#dTags');
    if (!raekke) return;
    const chips = valgteTags.map((id) => {
      const tag = (state.tags || []).find((t) => t.id === id);
      if (!tag) return '';
      return `<span class="chip neutral">#${esc(tag.name)}<button class="tagx" data-fjerntag="${esc(id)}"
        aria-label="Take #${esc(tag.name)} off this task" title="Take it off">×</button></span>`;
    }).join('');
    raekke.innerHTML = `${chips}<span class="meta">Write <code>#name</code> in the title to add one.</span>`;
    raekke.querySelectorAll('[data-fjerntag]').forEach((el) => el.addEventListener('click', () => {
      valgteTags = valgteTags.filter((x) => x !== el.dataset.fjerntag);
      tegnTags();
    }));
  };
  tegnTags();

  const felter = () => ({
    title: document.getElementById('dTitle').value,
    note: document.getElementById('dNote').value,
    dueDate: document.getElementById('dDue').value || null,
    caseNumber: document.getElementById('dSag').value.trim(),
    /*
     * Kolonnen findes kun, hvis projektet HAR kolonner. Er feltet der ikke,
     * skal `sectionId` udelades helt og ikke sendes som null: PATCH fletter
     * ind over det gemte (Object.assign), saa et udeladt felt bevares, mens
     * et null ville rydde en sektion, ruden aldrig har vist.
     *
     * `priority` staar her IKKE laengere - af samme grund. Feltet er vaek fra
     * ruden, men Planner importerer stadig prioriteten, og den skal overleve
     * enhver gemning herfra.
     */
    ...(document.getElementById('dSektion')
      ? { sectionId: document.getElementById('dSektion').value || null }
      : {}),
    // Syntaksen i titlen LAEGGER TIL oven paa det her (serveren forener de
    // to), saa et fjernet maerkat forbliver fjernet, medmindre man selv
    // skriver det igen.
    tagIds: valgteTags,
  });

  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  document.getElementById('dClose').addEventListener('click', luk);
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });

  const stopGentag = document.getElementById('dStopGentag');
  if (stopGentag) {
    stopGentag.addEventListener('click', async () => {
      try {
        await api('PATCH', `/api/v1/items/${it.id}`, { recurrenceRule: null });
        luk();
        await genindlaes();
        toast('It no longer repeats. Finishing it now just finishes it.');
      } catch (ex) { toast(ex.message); }
    });
  }

  const gemOpgaven = async () => {
    const f = felter();
    const raa = document.getElementById('dEst').value.trim();
    // Varigheden tolkes af beregn.js - samme funktion som `~` i paletten og
    // som serveren bruger. To tolkninger ville vaere to sandheder.
    if (raa) {
      const m = tovoBeregn.parseVarighed(raa);
      if (!m) { toast(`I did not understand "${raa}" as a duration.`); return; }
      f.estimateMinutes = m;
    } else f.estimateMinutes = null;

    // Gentagelsen tolkes af den SAMME parser som `!every …` i soegefeltet.
    // To tolkninger ville betyde, at det samme skrevne kunne give to regler.
    const raaRegel = document.getElementById('dGentag').value.trim();
    if (raaRegel) {
      const regel = tovoParse.tolkGentagelse(raaRegel);
      if (!regel) {
        toast(`I did not understand "${raaRegel}". Try "every monday at 9" or "every 2 weeks".`);
        return;
      }
      f.recurrenceRule = regel;
    } else f.recurrenceRule = null;
    try {
      /*
       * Staar der SYNTAKS i titlen, skal den virke - ogsaa naar man retter.
       * Serveren tolker den med den samme parser som fangsten og opretter
       * det, der mangler, saa "#Ai" i en titel bliver et maerkat og ikke
       * bare tekst.
       */
      const harSyntaks = typeof tovoParse !== 'undefined'
        && new RegExp(`(^|\\s)[${tovoParse.MARKOERER}]`).test(f.title);
      if (harSyntaks) {
        /*
         * Ruden FOERST, syntaksen bagefter.
         *
         * Den omvendte raekkefoelge var en fejl: `:SAG-77` i titlen satte
         * sagsnummeret, og den efterfoelgende gemning af rudens felter
         * skrev det tomme sagsfelt hen over igen. Det, man lige har skrevet,
         * er det mest specifikke - saa det skal have det sidste ord.
         */
        await api('PATCH', `/api/v1/items/${it.id}`, f);
        const d = await api('POST', `/api/v1/tasks/${it.id}/syntax`, { text: f.title });
        luk();
        await genindlaes();
        const dele = [];
        if (d.nye.length) dele.push(`created ${d.nye.map((n) => `${n.kind === 'tag' ? '#' : '@'}${n.name}`).join(', ')}`);
        if (d.ignored.length) dele.push('% only works when you create a task');
        if (d.warnings.length) dele.push(d.warnings[0]);
        toast(dele.length ? `Saved — ${dele.join(' · ')}` : 'Saved.');
        return;
      }
      await api('PATCH', `/api/v1/items/${it.id}`, f);
      luk();
      await genindlaes();
      toast('Saved.');
    } catch (ex) { toast(ex.message); }
  };
  document.getElementById('dSave').addEventListener('click', gemOpgaven);
  bindGemGenvej(host, gemOpgaven);

  const ics = document.getElementById('dIcs');
  if (ics) {
    ics.addEventListener('click', () => {
      // En almindelig <a download>: browseren henter filen med cookien og
      // aabner den i kalenderen. Ingen blob, intet at rydde op.
      const a = document.createElement('a');
      a.href = `/api/v1/tasks/${it.id}/ics`;
      a.download = `tovo-${it.title.replace(/[^\w-]+/g, '-').slice(0, 40)}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  document.getElementById('dStartLink').addEventListener('click', async () => {
    try {
      // Findes linket, gav serveren det med - saa er der intet at oprette.
      const url = startLink ? startLink.url
        : (await api('POST', `/api/v1/tasks/${it.id}/link`, {})).link.url;
      const ok = await kopier(url);
      toast(ok ? 'Start link copied.' : `Copy it by hand: ${url}`);
      if (!startLink) { luk(); aabnOpgave(it.id); }
    } catch (ex) { toast(ex.message); }
  });

  const tilbagekald = document.getElementById('dRevoke');
  if (tilbagekald) {
    tilbagekald.addEventListener('click', async () => {
      try {
        await api('DELETE', `/api/v1/tasks/${it.id}/link`);
        toast('The link no longer works. Any copy of it is dead.');
        luk();
        aabnOpgave(it.id);
      } catch (ex) { toast(ex.message); }
    });
  }

  document.getElementById('dStart').addEventListener('click', async () => {
    luk();
    await startTimerPaa(it.id);
  });
  document.getElementById('dLog').addEventListener('click', () => { luk(); aabnManuel(it.id); });

  /*
   * Kopien laves paa SERVEREN, saa webappen og MCP tager den samme med.
   * Den nye opgave AABNES bagefter: en kopi laves for at rette i den, og
   * uden at aabne den ville man staa med to ens raekker og skulle finde
   * den rigtige.
   */
  document.getElementById('dDuplicate').addEventListener('click', async () => {
    try {
      const d = await api('POST', `/api/v1/tasks/${it.id}/duplicate`, {});
      luk();
      await genindlaes();
      await aabnOpgave(d.item.id);
      toast('Copied — time, comments and the start link stayed on the original.');
    } catch (ex) { toast(ex.message); }
  });

  document.getElementById('dTick').addEventListener('click', async () => {
    luk();
    await skiftFaerdig(it.id);
  });

  document.getElementById('dDelete').addEventListener('click', async () => {
    try {
      await api('DELETE', `/api/v1/items/${it.id}`);
      luk();
      await genindlaes();
      toast('Deleted.');
    } catch (ex) { toast(ex.message); }
  });

  document.getElementById('dLinkAdd').addEventListener('click', async () => {
    const url = document.getElementById('dLinkUrl').value.trim();
    if (!url) return;
    const links = (it.links || []).concat([{ url, label: document.getElementById('dLinkLabel').value.trim() }]);
    try {
      const d = await api('PATCH', `/api/v1/items/${it.id}`, { links });
      // Serveren afviser alt uden for hvidlisten tavst - saa hvis listen ikke
      // voksede, var linket ikke et, vi tager imod. Sig det.
      if ((d.item.links || []).length === (it.links || []).length) {
        toast('Only http, https and onenote: links can be saved.');
        return;
      }
      luk();
      aabnOpgave(it.id);
    } catch (ex) { toast(ex.message); }
  });

  host.querySelectorAll('[data-fjernlink]').forEach((el) => {
    el.addEventListener('click', async () => {
      const links = (it.links || []).filter((_, i) => i !== Number(el.dataset.fjernlink));
      await api('PATCH', `/api/v1/items/${it.id}`, { links });
      luk();
      aabnOpgave(it.id);
    });
  });

  const tilfoejKommentar = async () => {
    const tekst = document.getElementById('dComment').value.trim();
    if (!tekst) return;
    try {
      await api('POST', `/api/v1/tasks/${it.id}/comments`, { text: tekst });
      luk();
      aabnOpgave(it.id);
    } catch (ex) { toast(ex.message); }
  };
  document.getElementById('dCommentAdd').addEventListener('click', tilfoejKommentar);
  document.getElementById('dComment').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); tilfoejKommentar(); }
  });

  document.getElementById('dTitle').focus();
}

/* ---- p4_timer.js ---- */
'use strict';
/* tovo - timeren, tidsposterne og den manuelle registrering.
 *
 * Ingen udregninger her. Alt hvad der ligner et tal kommer fra beregn.js -
 * ogsaa de smaa. Webappen og MCP skal svare det samme (CLAUDE.md).
 */

/*
 * Timeren staar i SIDEBAREN paa desktop og som en flydende bjaelke paa mobil.
 *
 * Sidebaren er der altid, naar der er plads til den, og det er dér, oejet
 * i forvejen leder efter appens tilstand. Under mobilgraensen (900 px) er
 * sidebaren et overlay, man ikke kan se - og saa ville timeren vaere skjult
 * praecis naar den er mest vaerd. Derfor to placeringer og ét stykke markup.
 *
 * Begge steder ligger UDEN FOR det element, render() skifter ud, og uden for
 * #navHost, som opdaterNav() tegner om. Ellers forsvinder timeren ved hver
 * optegning (doda F8).
 *
 * Og den taeller ud fra STARTTIDSPUNKTET, aldrig ved at laegge et sekund til
 * en variabel: en taeller nulstilles ved hver gentegning og driver, naar
 * fanen har vaeret i baggrunden. `Date.now() - start` er korrekt efter en
 * fuld sideindlaesning, efter en time i baggrunden og paa tvaers af faner.
 */
const timerState = { data: null, tik: null };

function tegnTimerBjaelke() {
  const t = timerState.data;
  const iSidebar = document.getElementById('timerHost');
  const flydende = document.getElementById('timerBar');

  if (!t) {
    if (flydende) flydende.remove();
    if (iSidebar) iSidebar.innerHTML = '';
    document.title = state.config.appName || 'tovo';
    stopTik();
    return;
  }

  const markup = `
    <button class="timerbar-main" id="timerOpen" title="Open the task">
      <span class="timerbar-dot"></span>
      <span class="timerbar-text">
        <span class="timerbar-title">${esc(t.taskTitle)}</span>
        <span class="timerbar-sub meta">${esc(t.projectName || 'no project')}${t.tooLong
    ? ` · over ${esc(tovoBeregn.formatVarighed(t.warnAfterMinutes))}` : ''}</span>
      </span>
      <span class="timerbar-time" id="timerUr">${esc(forloebet(t))}</span>
    </button>
    <button class="btn timerstop" id="timerStop" aria-label="Stop the timer"
      title="Stop the timer">${icon('stop', 15)}<span class="stoptekst"> Stop</span></button>`;

  // Sidebaren, naar den er synlig - ellers den flydende bjaelke.
  if (iSidebar && !smalSkaerm()) {
    if (flydende) flydende.remove();
    iSidebar.innerHTML = `<div class="timerbar itimerhost${t.tooLong ? ' warn' : ''}">${markup}</div>`;
  } else {
    if (iSidebar) iSidebar.innerHTML = '';
    let bar = flydende;
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'timerBar';
      document.body.appendChild(bar);
    }
    bar.className = `timerbar${t.tooLong ? ' warn' : ''}`;
    bar.innerHTML = markup;
  }

  document.getElementById('timerStop').addEventListener('click', stopTimer);
  // HELE feltet - navn, projekt og uret - er ét klik ind i opgaven.
  document.getElementById('timerOpen').addEventListener('click', () => aabnOpgave(t.entry.taskId));
  opdaterUr();
  startTik();
}

/* Krydser vinduet mobilgraensen, skal timeren flytte med. Uden det staar den
   i en sidebar, ingen kan se - eller svaever over en, der er der. */
window.addEventListener('resize', () => { if (timerState.data) tegnTimerBjaelke(); });

/**
 * Den forloebne tid som et ur.
 *
 * Regnet ud fra STARTTIDSPUNKTET ved hver tegning - aldrig ved at laegge et
 * sekund til en taeller. En taeller nulstilles ved hver gentegning og driver,
 * naar fanen har vaeret i baggrunden; det her er korrekt efter en fuld
 * sideindlaesning, efter en time i baggrunden og paa tvaers af faner (F8).
 */
function forloebet(t) {
  return tovoBeregn.formatUr(Date.now() / 1000 - t.entry.startedAt);
}

/**
 * Uret opdateres hvert sekund - men kun URET.
 *
 * Hele bjaelken tegnes IKKE om: en optegning pr. sekund ville rive fokus ud
 * af knapper og lave arbejde for ingenting. Her skiftes ét tekstindhold.
 */
function opdaterUr() {
  const t = timerState.data;
  if (!t) return;
  const gaaet = forloebet(t);
  const ur = document.getElementById('timerUr');
  if (ur) ur.textContent = gaaet;
  // Titlen er den eneste visning, der ogsaa er der, naar fanen ikke er det.
  document.title = `${gaaet} · ${t.taskTitle} — tovo`;
}

function startTik() {
  if (timerState.tik) return;
  timerState.tik = setInterval(() => {
    if (!timerState.data) { stopTik(); return; }
    opdaterUr();
  }, 1000);
}

function stopTik() {
  if (timerState.tik) { clearInterval(timerState.tik); timerState.tik = null; }
}

async function startTimerPaa(taskId) {
  try {
    const d = await api('POST', '/api/v1/timer/start', { taskId });
    timerState.data = d.timer;
    tegnTimerBjaelke();
    if (d.stopped) toast('Stopped the timer that was running.');
    await genindlaes();
  } catch (ex) { toast(ex.message); }
}

async function stopTimer() {
  try {
    await api('POST', '/api/v1/timer/stop', {});
    timerState.data = null;
    tegnTimerBjaelke();
    await genindlaes();
    toast('Timer stopped.');
  } catch (ex) { toast(ex.message); }
}

/* ------------------------------------------------- manuel registrering */

/**
 * Manuel registrering er LIGEVAERDIG med timeren, ikke en noedloesning.
 * Egen knap, egen genvej, og et felt der forstaar begge maader at huske en
 * time paa: et interval (9-11.30) eller en varighed (1,5t).
 */
/**
 * @param {string} [forvalgtOpgave] opgaven, feltet skal staa paa
 * @param {object} [opt] {date, text} til at udfylde forud (kalenderen), eller
 *   {entry} for at RETTE en post, der allerede findes.
 */
function aabnManuel(forvalgtOpgave, opt) {
  const o = opt || {};
  const post = o.entry || null;
  const host = document.createElement('div');
  host.className = 'modal';
  // Ved redigering skal opgaven kunne vaere en, der er afsluttet - ellers
  // kan man ikke rette en tidspost paa noget, man lige har lukket.
  const opgaver = (state.items || []).filter((t) => t.status !== 'done'
    || (post && t.id === post.taskId) || t.id === forvalgtOpgave);
  const start = post ? new Date(post.startedAt * 1000) : null;
  const slut = post && post.stoppedAt ? new Date(post.stoppedAt * 1000) : null;
  const kl = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const forvalgtDato = post ? isoDato(start) : (o.date || state.today);
  // Staar man i et projekt, er det dét, man registrerer paa. Ellers foelger
  // projektet den opgave, der allerede er valgt.
  const forvalgtOpg = opgaver.find((t) => t.id === (post ? post.taskId : forvalgtOpgave));
  const forvalgtProjekt = forvalgtOpg ? (forvalgtOpg.projectId || '__ingen')
    : (state.openProject || '');
  const forvalgtTekst = post
    ? (slut ? `${kl(start)}-${kl(slut)}` : '')
    : (o.text || '');
  if (post) forvalgtOpgave = post.taskId;

  host.innerHTML = `
    <div class="modal-card" role="dialog" aria-label="${post ? 'Edit time' : 'Log time'}">
      <h2>${post ? 'Edit time' : 'Log time'}</h2>
      <p class="meta">${post
    ? `Logged by ${esc(post.source)}${post.stoppedAt ? '' : ' — this one is still running'}.`
    : 'On any date — the timer is not the only way in.'}</p>
      <label class="field"><span>Project</span>
        <select class="input" id="mProject">${projektValg(opgaver, forvalgtProjekt)}</select></label>
      <label class="field"><span>Task</span>
        <select class="input" id="mTask">${opgaveValg(opgaver, forvalgtProjekt, forvalgtOpgave)}</select></label>
      <div class="row">
        <label class="field" style="flex:1"><span>Date</span>
          <input class="input" id="mDate" type="date" value="${esc(forvalgtDato)}"></label>
        <label class="field" style="flex:1"><span>Time</span>
          <input class="input" id="mText" placeholder="9-11.30 · 1,5t · 90m"
            value="${esc(forvalgtTekst)}" autocomplete="off"></label>
      </div>
      <label class="field"><span>Note (optional)</span>
        <input class="input" id="mNote" placeholder="What was it?" value="${esc(post ? post.note : '')}"></label>
      <div class="modal-foot">
        <button class="btn primary" id="mSave" title="⌘↵ / Ctrl+↵">${post ? 'Save' : 'Log it'}
          <span class="genvejstip">⌘↵</span></button>
        <button class="btn" id="mClose">Cancel</button>
        ${post ? '<span style="flex:1"></span><button class="btn danger" id="mDelete">Delete</button>' : ''}
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });
  document.getElementById('mClose').addEventListener('click', luk);

  // Projektet filtrerer opgavelisten. Med tredive opgaver paa tvaers af
  // projekter er en flad liste ubrugelig - man kan ikke se, hvad man vaelger.
  const projektFelt = document.getElementById('mProject');
  projektFelt.addEventListener('change', () => {
    const opgaveFelt = document.getElementById('mTask');
    const valgt = opgaveFelt.value;
    opgaveFelt.innerHTML = opgaveValg(opgaver, projektFelt.value, valgt);
  });

  const gem = async () => {
    const taskId = document.getElementById('mTask').value;
    if (!taskId) { toast('Create a task first — time is always logged on something.'); return; }
    const dato = document.getElementById('mDate').value;
    const tekst = document.getElementById('mText').value;
    try {
      if (post) {
        // Tidsrummet tolkes af beregn.js - samme funktion som serveren
        // bruger ved oprettelse. To tolkninger ville vaere to sandheder.
        const tidsrum = tovoBeregn.parseTidsrum(tekst, dato);
        if (!tidsrum) { toast(`I did not understand "${tekst}". Try 9-11.30, 1,5t or 90m.`); return; }
        const startedAt = tidsrum.fra
          ? tovoBeregn.tidspunkt(dato, tidsrum.fra)
          : tovoBeregn.tidspunkt(dato, `${String(new Date(post.startedAt * 1000).getHours()).padStart(2, '0')}:${String(new Date(post.startedAt * 1000).getMinutes()).padStart(2, '0')}`);
        await api('PATCH', `/api/v1/entries/${post.id}`, {
          taskId,
          startedAt,
          stoppedAt: startedAt + tidsrum.minutter * 60,
          note: document.getElementById('mNote').value,
        });
      } else {
        await api('POST', '/api/v1/entries', {
          taskId, date: dato, text: tekst, note: document.getElementById('mNote').value,
        });
      }
      luk();
      await genindlaes();
      toast(post ? 'Saved.' : 'Logged.');
    } catch (ex) { toast(ex.message); }
  };

  const slet = document.getElementById('mDelete');
  if (slet) {
    slet.addEventListener('click', async () => {
      try {
        const d = await api('DELETE', `/api/v1/entries/${post.id}`);
        luk();
        await genindlaes();
        toast('Entry deleted.', { label: 'Undo', run: async () => {
          const p = d.deleted;
          await api('POST', '/api/v1/entries', {
            id: p.id, taskId: p.taskId, startedAt: p.startedAt, stoppedAt: p.stoppedAt,
            note: p.note, source: p.source,
          });
          await genindlaes();
        } });
      } catch (ex) { toast(ex.message); }
    });
  }
  document.getElementById('mSave').addEventListener('click', gem);
  bindGemGenvej(host, gem);
  document.getElementById('mText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); gem(); }
  });
  document.getElementById('mText').focus();
}

/** Projekterne, der FAKTISK har opgaver at registrere paa - plus "alle". */
function projektValg(opgaver, valgt) {
  const medOpgaver = new Set(opgaver.map((t) => t.projectId || '__ingen'));
  const dele = [`<option value=""${valgt === '' ? ' selected' : ''}>All projects</option>`];
  for (const p of state.projects) {
    if (!medOpgaver.has(p.id)) continue;
    dele.push(`<option value="${esc(p.id)}"${valgt === p.id ? ' selected' : ''}>${esc(p.name)}</option>`);
  }
  if (medOpgaver.has('__ingen')) {
    dele.push(`<option value="__ingen"${valgt === '__ingen' ? ' selected' : ''}>No project</option>`);
  }
  return dele.join('');
}

/**
 * Opgaverne, grupperet under deres projekt.
 *
 * <optgroup> er den native maade at vise gruppen paa - den virker paa mobil,
 * med tastatur og med skaermlaeser, uden en linje JavaScript. Er der valgt et
 * projekt, vises kun dets opgaver, og saa er grupperingen overfloedig.
 */
function opgaveValg(opgaver, projektId, valgtOpgave) {
  const iProjekt = (t) => (t.projectId || '__ingen');
  const filtreret = projektId ? opgaver.filter((t) => iProjekt(t) === projektId) : opgaver;
  const sorter = (a, b) => (a.position || 0) - (b.position || 0);
  const punkt = (t) => `<option value="${esc(t.id)}"${t.id === valgtOpgave ? ' selected' : ''}>${esc(t.title)}</option>`;

  if (!filtreret.length) return '<option value="">No tasks in this project</option>';
  if (projektId) return filtreret.slice().sort(sorter).map(punkt).join('');

  const grupper = [];
  for (const p of state.projects) {
    const dens = filtreret.filter((t) => t.projectId === p.id).sort(sorter);
    if (dens.length) grupper.push(`<optgroup label="${esc(p.name)}">${dens.map(punkt).join('')}</optgroup>`);
  }
  const uden = filtreret.filter((t) => !t.projectId).sort(sorter);
  if (uden.length) grupper.push(`<optgroup label="No project">${uden.map(punkt).join('')}</optgroup>`);
  return grupper.join('');
}

/* Genvejen skal have en modifikator: bare bogstaver aabner soegefeltet, og
   det maa de blive ved med (planens tastaturregel). */
document.addEventListener('keydown', (e) => {
  if (!state.user) return;
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
  if (e.key !== 'm' && e.key !== 'M') return;
  e.preventDefault();
  if (document.querySelector('.modal')) return;
  aabnManuel();
});

/* ------------------------------------------------------- posterne */

function postRaekke(e, opgaver) {
  const opgave = opgaver.find((t) => t.id === e.taskId);
  const projekt = opgave ? state.projects.find((p) => p.id === opgave.projectId) : null;
  const koerer = !e.stoppedAt;
  const minutter = Math.max(0, Math.round(((e.stoppedAt || Math.floor(Date.now() / 1000)) - e.startedAt) / 60));
  const fra = new Date(e.startedAt * 1000);
  const til = e.stoppedAt ? new Date(e.stoppedAt * 1000) : null;
  const kl = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `<li data-post="${esc(e.id)}">
    <span class="post-tid meta">${esc(kl(fra))}–${til ? esc(kl(til)) : 'now'}</span>
    <span class="post-main">
      <span>${esc(opgave ? opgave.title : 'Deleted task')}</span>
      <span class="meta">${esc(projekt ? projekt.name : 'no project')} · ${esc(e.source)}${e.note ? ` · ${esc(e.note)}` : ''}</span>
    </span>
    <span class="post-sum">${esc(tovoBeregn.formatVarighed(minutter))}${koerer ? ' …' : ''}</span>
    <button class="linkbtn" data-slet="${esc(e.id)}">delete</button>
  </li>`;
}

function bindPoster(host, opgaver) {
  host.querySelectorAll('[data-slet]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        const d = await api('DELETE', `/api/v1/entries/${el.dataset.slet}`);
        await genindlaes();
        // Fortryd i 10 sekunder. Posten kom med tilbage fra serveren, saa
        // gendannelsen bruger de rigtige tidspunkter - ikke et gaet.
        toast('Entry deleted.', {
          label: 'Undo',
          run: async () => {
            const p = d.deleted;
            // De PRAECISE tidspunkter tilbage - ikke en tekst, der skal tolkes
            // igen. Vejen gennem "HH:MM" taber sekunderne, og saa er
            // fortrydelsen ikke en fortrydelse.
            await api('POST', '/api/v1/entries', {
              id: p.id, taskId: p.taskId, startedAt: p.startedAt, stoppedAt: p.stoppedAt,
              note: p.note, source: p.source,
            });
            await genindlaes();
          },
        });
      } catch (ex) { toast(ex.message); }
    });
  });
}

/* ---- p5_kunde.js ---- */
'use strict';
/* tovo - kundevisning og print.
 *
 * Den rene udgave af projektsiden: hvad der blev aftalt, hvad der er lavet,
 * og hvad der staar tilbage. Uden interne noter og uden kilde-maerkning -
 * det er tovos eget bogholderi, ikke kundens aerinde.
 *
 * Ingen udregninger her. Tallene kommer fra serverens rollup, som kommer fra
 * beregn.js. Kunden og ugerapporten skal svare det samme.
 */

/**
 * Bygger arket. Bruges BAADE til visningen paa skaermen og til print - ellers
 * ville de to kunne komme til at vise forskellige tal, og det er hele
 * pointen, at de ikke kan (Beanledger v16-v18).
 */
function kundeArkHtml(p, opgaver, rollup, forbrug) {
  const f = tovoBeregn.formatVarighed;
  const idag = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const raekker = opgaver
    .slice()
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((t) => `<tr>
      <td>${esc(t.title)}</td>
      <td>${t.status === 'done' ? 'Done' : 'In progress'}</td>
      <td class="num">${t.estimateMinutes ? esc(f(t.estimateMinutes)) : '—'}</td>
      <td class="num">${esc(f(forbrug[t.id] || 0))}</td>
    </tr>`).join('');

  return `
    <h1>${esc(p.name)}</h1>
    <p class="pkunde">${esc(p.customer || '')}</p>
    <table>
      <thead><tr><th>Task</th><th>Status</th><th class="num">Estimated</th><th class="num">Spent</th></tr></thead>
      <tbody>${raekker}</tbody>
      <tfoot><tr>
        <td><strong>Total</strong></td><td></td>
        <td class="num"><strong>${esc(f(rollup.estimat))}</strong></td>
        <td class="num"><strong>${esc(f(rollup.forbrugt))}</strong></td>
      </tr></tfoot>
    </table>
    ${rollup.ramme ? `<table class="pramme">
      <tr><td>Agreed budget</td><td class="num">${esc(f(rollup.ramme))}</td></tr>
      <tr><td>Spent</td><td class="num">${esc(f(rollup.forbrugt))}</td></tr>
      <tr><td><strong>Remaining</strong></td>
        <td class="num"><strong>${esc(f(Math.max(0, rollup.resterende)))}</strong></td></tr>
    </table>` : ''}
    <p class="pdate">${esc(idag)}</p>`;
}

/** Kundevisningen paa skaermen. Samme ark, samme tal - bare i en rude. */
async function visKundevisning(projektId) {
  let d;
  try {
    d = await api('GET', `/api/v1/projects/${projektId}`);
  } catch (ex) { toast(ex.message); return; }

  const ark = kundeArkHtml(d.project, d.tasks, d.rollup, d.spent);
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `<div class="modal-card kundekort" role="dialog" aria-label="Customer view">
      <div class="kundeark">${ark}</div>
      <div class="modal-foot">
        <button class="btn primary" id="kExcel">Excel</button>
        <button class="btn" id="kPrint">Print / save as PDF</button>
        <button class="btn" id="kClose">Close</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });
  document.getElementById('kClose').addEventListener('click', luk);
  document.getElementById('kPrint').addEventListener('click', () => {
    printArk(ark, `tovo-${d.project.name}-${state.today}`);
  });
  document.getElementById('kExcel').addEventListener('click', () => {
    const t = (m) => excelTimer(m);
    hentExcel([{
      navn: d.project.name,
      rows: [
        [d.project.name, d.project.customer || '', d.project.caseNumber || ''],
        [],
        ['Task', 'Status', 'Estimated (hours)', 'Spent (hours)'],
        ...d.tasks.slice().sort((a, b) => (a.position || 0) - (b.position || 0))
          .map((x) => [x.title, x.status === 'done' ? 'Done' : 'In progress',
            t(x.estimateMinutes), t(d.spent[x.id] || 0)]),
        ['Total', '', t(d.rollup.estimat), t(d.rollup.forbrugt)],
        ...(d.rollup.ramme ? [[], ['Agreed budget (hours)', '', t(d.rollup.ramme), ''],
          ['Remaining (hours)', '', t(Math.max(0, d.rollup.resterende)), '']] : []),
      ],
    }], `tovo-${d.project.name.replace(/[^\w-]+/g, '-')}-${state.today}.xlsx`);
    toast('Excel file downloaded.');
  });
}

/**
 * Print.
 *
 * Arket laegges i #printHost, som ligger i <body> og kun vises i @media
 * print. Titlen bliver browserens forslag til filnavn ved "Gem som PDF" og
 * gendannes paa afterprint.
 *
 * NB til den, der tester: `afterprint` fyrer ALDRIG, naar window.print er
 * stubbet - saa skal titlen saettes tilbage i haanden (Muldbog).
 */
function printArk(html, filnavn) {
  let host = document.getElementById('printHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'printHost';
    host.className = 'printsheet';
    document.body.appendChild(host);
  }
  host.innerHTML = html;
  const gammelTitel = document.title;
  document.title = filnavn;
  const gendan = () => {
    document.title = gammelTitel;
    window.removeEventListener('afterprint', gendan);
  };
  window.addEventListener('afterprint', gendan);
  setTimeout(() => window.print(), 60);
}

/* ---- p6_planner.js ---- */
'use strict';
/* tovo - import fra Microsoft Planner.
 *
 * En .xlsx er et ZIP-arkiv med XML. Der er ingen SheetJS og ingen anden
 * pakke: ~120 linjers egen zip-laeser (central directory -> lokal header ->
 * datastart) og DecompressionStream til hver entry, praecis som Kokkeris
 * Paprika-import (§6c). XML'en laeses med DOMParser - browseren har allerede
 * en, og en hjemmelavet XML-parser er en fejlkilde uden gevinst.
 *
 * ALT hvad der kan goere skade - arkvalg, kolonnegenkendelse, mapning og
 * fletningens hvidliste - ligger i app/shared/planner.js, hvor det kan
 * testes uden en browser. Denne fil laeser kun filen og tegner ruden.
 */

/* ------------------------------------------------------------- zip */

/**
 * Laeser et zip-arkiv til en Map(navn -> Uint8Array).
 *
 * Central directory findes bagfra (End of Central Directory), fordi den er
 * det eneste sted, hvor filnavnene staar samlet. Den lokale header skal
 * stadig laeses for hver entry: dens navne- og extra-laengde er IKKE
 * noedvendigvis den samme som i directory'et, og datastarten ligger efter dem.
 */
async function laesZip(buffer) {
  const b = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 65558; i--) {
    if (b.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That file is not a .xlsx (no zip directory found).');

  const antal = b.getUint16(eocd + 10, true);
  let p = b.getUint32(eocd + 16, true);
  const filer = new Map();
  const tekst = new TextDecoder();

  for (let i = 0; i < antal; i++) {
    if (b.getUint32(p, true) !== 0x02014b50) break;
    const metode = b.getUint16(p + 10, true);
    const komprimeret = b.getUint32(p + 20, true);
    const navnLaengde = b.getUint16(p + 28, true);
    const ekstraLaengde = b.getUint16(p + 30, true);
    const kommentarLaengde = b.getUint16(p + 32, true);
    const lokal = b.getUint32(p + 42, true);
    const navn = tekst.decode(bytes.subarray(p + 46, p + 46 + navnLaengde));

    const lokalNavn = b.getUint16(lokal + 26, true);
    const lokalEkstra = b.getUint16(lokal + 28, true);
    const start = lokal + 30 + lokalNavn + lokalEkstra;
    const raa = bytes.subarray(start, start + komprimeret);

    if (metode === 0) filer.set(navn, raa);
    else if (metode === 8) filer.set(navn, new Uint8Array(await udpak(raa)));
    // Andre metoder findes ikke i en Planner-eksport; springes over frem for
    // at faelde hele importen.

    p += 46 + navnLaengde + ekstraLaengde + kommentarLaengde;
  }
  return filer;
}

async function udpak(raa) {
  const strøm = new Blob([raa]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(strøm).arrayBuffer();
}

/* ------------------------------------------------------------- xlsx */

const XML = (tekst) => new DOMParser().parseFromString(tekst, 'application/xml');

/** "C5" -> 2. Kolonnebogstaverne er base-26 uden nul. */
function kolonneIndeks(ref) {
  const m = String(ref || '').match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const c of m[1]) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * .xlsx -> {arknavn: [[celle, ...], ...]}
 *
 * Den rigtige eksport har INGEN sharedStrings og bruger t="str" med teksten
 * direkte i <v>. `t="s"` (indeks i sharedStrings) og `inlineStr` haandteres
 * ogsaa, saa en aendring hos Microsoft ikke braekker importen.
 */
async function laesXlsx(buffer) {
  const filer = await laesZip(buffer);
  const tekst = new TextDecoder();
  const laes = (navn) => (filer.has(navn) ? tekst.decode(filer.get(navn)) : null);

  const wb = laes('xl/workbook.xml');
  if (!wb) throw new Error('That file is not an Excel workbook.');
  const rels = laes('xl/_rels/workbook.xml.rels');

  // Arkets fil findes gennem r:id i rels - IKKE ved at gaette "sheet1.xml"
  // ud fra raekkefoelgen. De to falder ikke altid sammen.
  const stier = new Map();
  if (rels) {
    for (const r of XML(rels).getElementsByTagName('Relationship')) {
      stier.set(r.getAttribute('Id'), r.getAttribute('Target'));
    }
  }

  const delte = [];
  const ss = laes('xl/sharedStrings.xml');
  if (ss) {
    for (const si of XML(ss).getElementsByTagName('si')) {
      delte.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
    }
  }

  const ark = {};
  const doc = XML(wb);
  let n = 0;
  for (const sh of doc.getElementsByTagName('sheet')) {
    n += 1;
    const navn = sh.getAttribute('name');
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let sti = stier.get(rid) || `worksheets/sheet${n}.xml`;
    sti = sti.replace(/^\/?xl\//, '');
    const xml = laes(`xl/${sti}`);
    if (!xml) continue;

    const raekker = [];
    for (const row of XML(xml).getElementsByTagName('row')) {
      const celler = [];
      for (const c of row.getElementsByTagName('c')) {
        const i = kolonneIndeks(c.getAttribute('r'));
        const t = c.getAttribute('t');
        let vaerdi = '';
        if (t === 'inlineStr') {
          vaerdi = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
        } else {
          const v = c.getElementsByTagName('v')[0];
          vaerdi = v ? v.textContent : '';
          if (t === 's') vaerdi = delte[Number(vaerdi)] || '';
        }
        celler[i] = vaerdi;
      }
      for (let j = 0; j < celler.length; j++) if (celler[j] === undefined) celler[j] = '';
      raekker.push(celler);
    }
    ark[navn] = raekker;
  }
  return ark;
}

/* ------------------------------------------------------------ ruden */

const importState = { data: null, projekt: null, valg: null };

function aabnPlannerImport(projektId) {
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'plannerModal';
  host.innerHTML = `<div class="modal-card" role="dialog" aria-label="Import from Planner">
      <h2>Import from Planner</h2>
      <p class="meta">In Planner: <strong>… → Export plan to Excel</strong>. Then pick the file here.
        Re-importing later updates the tasks — it never touches your estimates or logged time.</p>
      <label class="field"><span>Excel file from Planner</span>
        <input class="input" type="file" id="plFil" accept=".xlsx"></label>
      <div id="plKrop"></div>
      <div class="modal-foot" id="plFod">
        <button class="btn" id="plClose">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  importState.projekt = projektId || null;

  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  document.getElementById('plClose').addEventListener('click', luk);
  document.getElementById('plFil').addEventListener('change', (e) => {
    const fil = e.target.files && e.target.files[0];
    if (fil) forhaandsvis(fil);
  });
}

async function forhaandsvis(fil) {
  const krop = document.getElementById('plKrop');
  krop.innerHTML = '<p class="meta">Reading the file…</p>';
  let eksport;
  try {
    eksport = tovoPlanner.laesEksport(await laesXlsx(await fil.arrayBuffer()));
  } catch (ex) {
    krop.innerHTML = `<p class="gate-error">${esc(ex.message)}</p>`;
    return;
  }

  // Ét projekt pr. plan. Findes planen allerede, er det en GENIMPORT - og
  // saa skal den ramme det samme projekt, ikke lave et nyt ved siden af.
  const projekt = state.projects.find((p) => (eksport.plan.id && p.plannerPlanId === eksport.plan.id))
    || (importState.projekt ? state.projects.find((p) => p.id === importState.projekt) : null);

  let findes = [];
  if (projekt) {
    const d = await api('GET', `/api/v1/projects/${projekt.id}`);
    findes = d.tasks;
  }
  // `buckets` er HELE listen fra planen - ogsaa de tomme. Uden den bliver
  // kun de buckets, der har en opgave i sig, til kolonner.
  const sam = tovoPlanner.sammenlign(eksport.tasks, findes, {
    sections: projekt ? (projekt.sections || []) : [],
    buckets: eksport.buckets || [],
  });
  const noter = tovoPlanner.noterLignerEstimater(eksport.tasks);
  importState.data = { eksport, sam, projekt, noter, findes };

  // En sektion, `sammenlign` har fundet paa, baerer `ny: true`. Resten stod
  // paa projektet i forvejen - ogsaa dem brugeren selv har lavet.
  //
  // Kolonnelisten faar klassen `navne`: den faelles .meta versaliserer, og
  // det maa brugerens EGNE navne ikke - saa kan de ikke genkendes fra
  // Planner.
  const nyeKolonner = sam.sektioner.filter((s) => s.ny).length;

  krop.innerHTML = `
    <div class="card">
      <h2>${esc(eksport.plan.name || fil.name)}</h2>
      <div class="meta">${projekt ? `Re-import into “${esc(projekt.name)}”` : 'This will create a new project'}
        ${eksport.plan.exportedAt ? ` · exported ${esc(eksport.plan.exportedAt)}` : ''}</div>
      <ul class="plain">
        <li><span class="post-sum">${sam.nye.length}</span><span class="post-main">new tasks</span></li>
        <li><span class="post-sum">${sam.opdaterede.length}</span><span class="post-main">to update</span></li>
        <li><span class="post-sum">${sam.forsvundne.length}</span><span class="post-main">gone from Planner</span></li>
        <!-- Kolonnerne kom stiltiende ind: importen skrev dem, men
             forhaandsvisningen naevnte dem ikke, saa man kunne ikke se, om
             planens buckets var laest rigtigt foer BAGEFTER. -->
        <li><span class="post-sum">${nyeKolonner}</span><span class="post-main">new columns${
  sam.sektioner.length > nyeKolonner ? ` (${sam.sektioner.length} in total)` : ''}</span></li>
      </ul>
      ${sam.sektioner.length ? `<p class="meta navne">Columns: ${sam.sektioner.map((s) => esc(s.name)).join(' · ')}</p>` : ''}
    </div>

    ${noter.ligner ? `<label class="check"><input type="checkbox" id="plEstimat" checked>
      <span>The “Noter” column looks like hours (${noter.antal} of ${noter.af} rows are a plain
      number) — set them as estimates on new tasks</span></label>` : ''}

    ${sam.forsvundne.length ? `<label class="field"><span>Tasks that are gone from Planner</span>
      <select class="input" id="plForsvundne">
        <option value="ask">Leave them alone (decide later)</option>
        <option value="archive">Mark them done</option>
        <option value="ignore">Ignore them</option>
      </select></label>` : ''}

    ${eksport.warnings.length ? `<p class="meta">${eksport.warnings.map(esc).join('<br>')}</p>` : ''}
    <p class="meta">Estimates, logged time, comments, links and the budget are never touched by an import.</p>`;

  /*
   * Knappen skal love det, der FAKTISK sker.
   *
   * Den sagde "Update 9 tasks" - eksportens antal - ogsaa naar
   * forhaandsvisningen lige ovenover sagde 0 nye, 0 opdaterede, 0 forsvundne.
   * To tal om samme handling, hvor det ene er forkert.
   */
  const antalOpgaver = sam.nye.length + sam.opdaterede.length;
  let etiket;
  if (!projekt) {
    etiket = `Import ${eksport.tasks.length} task${eksport.tasks.length === 1 ? '' : 's'}`;
  } else {
    const dele = [];
    if (antalOpgaver) dele.push(`${antalOpgaver} task${antalOpgaver === 1 ? '' : 's'}`);
    if (nyeKolonner) dele.push(`${nyeKolonner} column${nyeKolonner === 1 ? '' : 's'}`);
    etiket = dele.length ? `Update ${dele.join(' and ')}` : 'Nothing to change';
  }

  document.getElementById('plFod').innerHTML = `
    <button class="btn primary" id="plGo">${esc(etiket)}</button>
    <button class="btn" id="plClose2">Cancel</button>`;
  document.getElementById('plClose2').addEventListener('click', () => document.getElementById('plannerModal').remove());
  document.getElementById('plGo').addEventListener('click', udfoerImport);
}

async function udfoerImport() {
  const { eksport, sam, projekt, noter } = importState.data;
  const brugNoter = noter.ligner && document.getElementById('plEstimat')
    && document.getElementById('plEstimat').checked;
  const forsvundne = document.getElementById('plForsvundne')
    ? document.getElementById('plForsvundne').value : 'ask';
  const fod = document.getElementById('plFod');
  fod.innerHTML = '<p class="meta" id="plFremdrift">Saving…</p>';

  try {
    // 1. Projektet. Sektionerne foelger med, saa opgaverne har noget at
    //    pege paa, naar de gemmes.
    const projektFelter = {
      kind: 'project',
      name: eksport.plan.name || 'Imported plan',
      plannerPlanId: eksport.plan.id,
      plannerPlanName: eksport.plan.name,
      lastImportAt: Math.floor(Date.now() / 1000),
      sections: sam.sektioner.map((s, i) => ({ id: s.id, name: s.name, position: i })),
    };
    const p = projekt
      ? (await api('PATCH', `/api/v1/items/${projekt.id}`, projektFelter)).item
      : (await api('POST', '/api/v1/items', projektFelter)).item;

    // 2. Opgaverne i portioner à 25 med fremdrift. Bulk-endepunktet gaar
    //    gennem den samme gemItem med den samme vagt mod delvise objekter.
    const alle = [];
    for (const n of sam.nye) {
      alle.push(tovoPlanner.flet(n.planner, n.felter, null, {
        noterSomEstimat: brugNoter,
        estimatMinutter: brugNoter ? tovoBeregn.parseVarighed(n.planner.note) : null,
      }));
    }
    for (const o of sam.opdaterede) alle.push(tovoPlanner.flet(o.planner, o.felter, o.task));
    if (forsvundne === 'archive') {
      for (const t of sam.forsvundne) {
        if (t.status !== 'done') alle.push(Object.assign({}, t, { status: 'done', completedAt: Math.floor(Date.now() / 1000) }));
      }
    }
    for (const t of alle) t.projectId = p.id;

    let gemt = 0;
    for (let i = 0; i < alle.length; i += 25) {
      await api('POST', '/api/v1/items/bulk', { items: alle.slice(i, i + 25) });
      gemt += Math.min(25, alle.length - i);
      const f = document.getElementById('plFremdrift');
      if (f) f.textContent = `Saving… ${gemt} of ${alle.length}`;
    }

    document.getElementById('plannerModal').remove();
    await genindlaes();
    gaaTil('projects', { project: p.id });
    toast(`${sam.nye.length} new, ${sam.opdaterede.length} updated.`);
  } catch (ex) {
    fod.innerHTML = `<p class="gate-error">${esc(ex.message)}</p>`;
  }
}

/* ---- p7_rapport.js ---- */
'use strict';
/* tovo - ugerapporten.
 *
 * Formaalet er AFSTEMNING mod et andet system og et overblik til en kunde,
 * der spoerger. Rapporten skal derfor vaere til at LAESE og KOPIERE - ikke at
 * integrere med. Derfor markdown og print, og ingen eksportformater.
 *
 * Alle tal kommer fra beregn.js, saa MCP'ens week_report (fase 8) svarer
 * noejagtig det samme.
 */

const rapportState = { fra: null, til: null, data: null };

/* Decimaltimer er standard: rapporten er et overfoerselsbilag, ikke en
   laeseoplevelse. Den, der vil se 3h 30m, kan skifte. */
function rapportDecimal() {
  try { return localStorage.getItem('tovo_rapport_decimal') !== '0'; } catch { return true; }
}

function ugeMandag(iso) {
  const [aa, mm, dd] = iso.split('-').map(Number);
  const d = new Date(aa, mm - 1, dd);
  const ugedag = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - (ugedag - 1));
  return isoDato(d);
}

function flytUger(iso, n) {
  const [aa, mm, dd] = iso.split('-').map(Number);
  return isoDato(new Date(aa, mm - 1, dd + n * 7));
}

async function tegnRapport() {
  const host = document.getElementById('pageHost');
  if (!rapportState.fra) {
    rapportState.fra = ugeMandag(state.today);
    rapportState.til = flytUger(rapportState.fra, 1);
    const [aa, mm, dd] = rapportState.til.split('-').map(Number);
    rapportState.til = isoDato(new Date(aa, mm - 1, dd - 1));
  }

  host.innerHTML = '<div class="page"><h1>Report</h1><p class="lead skeleton">Adding it up…</p></div>';
  let d;
  try {
    d = await api('GET', `/api/v1/report?from=${rapportState.fra}&to=${rapportState.til}`);
  } catch (ex) { toast(ex.message); return; }
  rapportState.data = d;

  /*
   * Rapporten har ÉT talformat, og det kan skiftes.
   *
   * Decimaltimer (3,5) er den form, timerne overfoeres i til et andet
   * system; timer og minutter (3h 30m) er den, man laeser. Valget huskes -
   * man skifter ikke frem og tilbage.
   */
  const decimal = rapportDecimal();
  const f = (m) => (decimal ? tovoBeregn.formatDecimal(m) : tovoBeregn.formatVarighed(m));
  const r = d.report;
  const ts = d.timesheet;
  const forrige = d.previous;
  const dagsnavn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const forskel = (a, b) => {
    if (!b) return '';
    const diff = a - b;
    if (!diff) return ' · same as the period before';
    return ` · ${diff > 0 ? '+' : '−'}${f(Math.abs(diff))} vs. the period before`;
  };

  host.innerHTML = `<div class="page">
    <div class="row" style="justify-content:space-between;align-items:baseline">
      <h1>Report</h1>
      <span class="row" style="gap:8px">
        <!-- Etiketten er ikke pynt: et bart "3,5" siger hverken, at knappen
             ER en omskifter, eller hvad den skifter. Den viser det format,
             rapporten staar i NU - som resten af rapportens knapper. -->
        <button class="btn${decimal ? ' primary' : ''}" id="rFormat"
          title="Switch between decimal hours (3,5) and hours and minutes (3h 30m). Decimal hours are what you type into the other system."
          >Format: ${decimal ? '3,5' : '3h 30m'}</button>
        <button class="btn" id="rExcel">Excel</button>
        <button class="btn" id="rMarkdown">Copy as markdown</button>
        <button class="btn" id="rPrint">Print / PDF</button>
      </span>
    </div>

    <div class="row" style="margin-bottom:18px">
      <button class="btn" id="rForrige">← Previous</button>
      <button class="btn" id="rDenne">This week</button>
      <button class="btn" id="rNaeste">Next →</button>
      <label class="field" style="margin:0"><input class="input" type="date" id="rFra" value="${esc(d.from)}"></label>
      <label class="field" style="margin:0"><input class="input" type="date" id="rTil" value="${esc(d.to)}"></label>
    </div>

    <div class="card">
      <div class="row">
        <div style="flex:1"><div class="meta">Total</div><div class="bigtal">${esc(f(r.total))}</div></div>
        <div style="flex:1"><div class="meta">On projects</div><div class="bigtal">${esc(f(r.onProjects))}</div></div>
        <div style="flex:1"><div class="meta">Ad hoc</div><div class="bigtal">${esc(f(r.adhoc))}</div></div>
        <div style="flex:1"><div class="meta">Completed</div><div class="bigtal">${r.completed}</div></div>
      </div>
      <p class="meta">${r.norm ? `Against ${esc(f(r.norm))} normal hours: ${r.overNorm >= 0 ? '+' : '−'}${esc(f(Math.abs(r.overNorm)))}` : 'No normal week set'}${esc(forskel(r.total, forrige.total))}</p>
      ${d.rounding ? `<p class="meta">Rounded to ${d.rounding} minutes for display — the stored times are exact.</p>` : ''}
    </div>

    <h2 class="group">Days</h2>
    <div class="dagsliste">
      ${r.days.map((dag) => `<div class="dag${dag.tynd ? ' tynd' : ''}${dag.tom ? ' tom' : ''}">
        <div class="meta">${dagsnavn[dag.weekday]} ${esc(dag.date.slice(8))}</div>
        <div class="dagsum">${esc(f(dag.minutter))}</div>
        <div class="dagbar" style="height:${Math.min(100, Math.round((dag.minutter / Math.max(60, ...r.days.map((x) => x.minutter))) * 100))}%"></div>
      </div>`).join('')}
    </div>
    ${r.days.some((x) => x.tynd || x.tom) ? `<p class="meta warnline">${
    r.days.filter((x) => x.tynd || x.tom).map((x) => dagsnavn[x.weekday]).join(', ')
  } look thin — that is usually forgotten registration, not a quiet day.</p>` : ''}

    ${ts.caseRows.length ? `<h2 class="group">Per case number, per day<span class="group-count">${ts.caseRows.length}</span></h2>
      <div class="tabelrul">
      <table class="data rapporttabel timeseddel">
        <tr><th>Case</th>
          ${ts.dage.map((iso) => {
    const d = new Date(`${iso}T12:00:00`);
    return `<th class="num">${dagsnavn[d.getDay()]}<span class="meta">${iso.slice(8)}</span></th>`;
  }).join('')}
          <th class="num">Total</th></tr>
        ${ts.caseRows.map((c) => `<tr>
          <td>${c.case ? sagHtml(c.case) : '<span class="meta">(no case number)</span>'}</td>
          ${ts.dage.map((iso) => `<td class="num">${c.dage[iso] ? esc(f(c.dage[iso])) : ''}</td>`).join('')}
          <td class="num"><strong>${esc(f(c.total))}</strong></td>
        </tr>`).join('')}
        <tr><td><strong>Total</strong></td>
          ${ts.dage.map((iso) => `<td class="num"><strong>${ts.perDay[iso] ? esc(f(ts.perDay[iso])) : ''}</strong></td>`).join('')}
          <td class="num"><strong>${esc(f(ts.total))}</strong></td></tr>
      </table>
      </div>
      <p class="meta">This is what you type into the other system: one number per case,
        per day.${decimal ? ' Hours as decimals — 3,5 is three and a half. They are rounded to two '
    + 'places for display; the minutes behind them are exact, and the totals are added up from those.'
    : ''}</p>` : ''}

    ${ts.rows.length ? `<h2 class="group">Per day, per task<span class="group-count">${ts.rows.length}</span></h2>
      <div class="tabelrul">
      <table class="data rapporttabel timeseddel">
        <tr><th>Case</th><th>Task</th>
          ${ts.dage.map((iso) => {
    const d = new Date(`${iso}T12:00:00`);
    return `<th class="num">${dagsnavn[d.getDay()]}<span class="meta">${iso.slice(8)}</span></th>`;
  }).join('')}
          <th class="num">Total</th></tr>
        ${ts.rows.map((raekke) => `<tr>
          <td>${raekke.case ? sagHtml(raekke.case) : '<span class="meta">—</span>'}</td>
          <td>${esc(raekke.title)}${raekke.project ? `<span class="meta"> · ${esc(raekke.project)}</span>` : ''}</td>
          ${ts.dage.map((iso) => `<td class="num">${raekke.dage[iso] ? esc(f(raekke.dage[iso])) : ''}</td>`).join('')}
          <td class="num"><strong>${esc(f(raekke.total))}</strong></td>
        </tr>`).join('')}
        <tr><td colspan="2"><strong>Total</strong></td>
          ${ts.dage.map((iso) => `<td class="num"><strong>${ts.perDay[iso] ? esc(f(ts.perDay[iso])) : ''}</strong></td>`).join('')}
          <td class="num"><strong>${esc(f(ts.total))}</strong></td></tr>
      </table>
      </div>` : ''}

    ${r.projects.length ? r.projects.map((p) => `
      <h2 class="group">${esc(p.name)}<span class="group-count">${esc(f(p.minutter))}</span></h2>
      <table class="data rapporttabel">
        <tr><th>Task</th><th class="num">Estimated</th><th class="num">Spent</th><th>Status</th></tr>
        ${p.tasks.map((t) => `<tr>
          <td>${esc(t.title)}</td>
          <td class="num">${t.estimateMinutes ? esc(f(t.estimateMinutes)) : '—'}</td>
          <td class="num">${esc(f(t.minutter))}</td>
          <td>${t.completedIPerioden ? 'Completed' : 'Still open'}</td>
        </tr>`).join('')}
      </table>`).join('')
    : '<div class="empty"><p class="empty-title">Nothing registered in this period</p>'
      + '<p>Start a timer, or log the hours by hand.</p></div>'}
  </div>`;

  document.getElementById('rForrige').addEventListener('click', () => skiftPeriode(-1));
  document.getElementById('rNaeste').addEventListener('click', () => skiftPeriode(1));
  document.getElementById('rDenne').addEventListener('click', () => {
    rapportState.fra = null;
    tegnRapport();
  });
  for (const id of ['rFra', 'rTil']) {
    document.getElementById(id).addEventListener('change', () => {
      rapportState.fra = document.getElementById('rFra').value;
      rapportState.til = document.getElementById('rTil').value;
      tegnRapport();
    });
  }
  document.getElementById('rFormat').addEventListener('click', () => {
    try { localStorage.setItem('tovo_rapport_decimal', decimal ? '0' : '1'); } catch { /* privat */ }
    tegnRapport();
  });
  document.getElementById('rMarkdown').addEventListener('click', async () => {
    const md = rapportMarkdown(d);
    const ok = await kopier(md);
    toast(ok ? 'Report copied as markdown — paste it into OneNote.' : 'Could not reach the clipboard.');
  });
  document.getElementById('rPrint').addEventListener('click', () => {
    printArk(rapportArkHtml(d), `tovo-report-${d.from}`);
  });
  document.getElementById('rExcel').addEventListener('click', () => {
    // Tre ark: det man skal REGISTRERE efter, det man skal kunne forklare
    // det ud fra, og de raa poster til den, der vil regne selv.
    const dagsHoved = ts.dage.map((iso) => iso.slice(5));
    hentExcel([
      {
        navn: 'Per case per day',
        rows: [
          ['Case', ...dagsHoved, 'Total (hours)'],
          ...ts.caseRows.map((c) => [c.case || '(no case number)',
            ...ts.dage.map((iso) => excelTimer(c.dage[iso])), excelTimer(c.total)]),
          ['Total', ...ts.dage.map((iso) => excelTimer(ts.perDay[iso])), excelTimer(ts.total)],
        ],
      },
      {
        navn: 'Per task per day',
        rows: [
          ['Case', 'Project', 'Task', ...dagsHoved, 'Total (hours)'],
          ...ts.rows.map((x) => [x.case || '', x.project || '', x.title,
            ...ts.dage.map((iso) => excelTimer(x.dage[iso])), excelTimer(x.total)]),
        ],
      },
      {
        navn: 'Per project',
        rows: [
          ['Project', 'Task', 'Estimated (hours)', 'Spent (hours)', 'Status'],
          ...r.projects.flatMap((p) => p.tasks.map((t) => [p.name, t.title,
            excelTimer(t.estimateMinutes), excelTimer(t.minutter),
            t.completedIPerioden ? 'Completed' : 'Still open'])),
        ],
      },
    ], `tovo-${d.from}_${d.to}.xlsx`);
    toast('Excel file downloaded.');
  });
}

function skiftPeriode(n) {
  rapportState.fra = flytUger(rapportState.fra, n);
  rapportState.til = flytUger(rapportState.til, n);
  tegnRapport();
}

/**
 * Markdown til OneNote. Én knap, og formatet er det, man kan LAESE - ikke
 * det, en maskine skal parse.
 */
function rapportMarkdown(d) {
  const f = rapportDecimal() ? tovoBeregn.formatDecimal : tovoBeregn.formatVarighed;
  const r = d.report;
  const linjer = [`# ${d.from} – ${d.to}`, ''];
  linjer.push(`**${f(r.total)}** in total · ${f(r.onProjects)} on projects · ${f(r.adhoc)} ad hoc`);
  if (r.norm) linjer.push(`Against ${f(r.norm)} normal hours: ${r.overNorm >= 0 ? '+' : '−'}${f(Math.abs(r.overNorm))}`);
  linjer.push('');
  const ts = d.timesheet;
  if (ts && ts.caseRows.length) {
    // Sagen pr. dag foerst: det er den, der skal skrives af.
    linjer.push('## Per case number, per day', '');
    linjer.push(`| Case | ${ts.dage.map((iso) => iso.slice(5)).join(' | ')} | Total |`);
    linjer.push(`|---|${ts.dage.map(() => '--:').join('|')}|--:|`);
    for (const c of ts.caseRows) {
      linjer.push(`| ${c.case || '(no case number)'} | `
        + `${ts.dage.map((iso) => (c.dage[iso] ? f(c.dage[iso]) : '')).join(' | ')} | ${f(c.total)} |`);
    }
    linjer.push(`| **Total** | ${ts.dage.map((iso) => (ts.perDay[iso] ? f(ts.perDay[iso]) : '')).join(' | ')} | **${f(ts.total)}** |`);
    linjer.push('');
  }
  if (ts && ts.rows.length) {
    // En markdown-tabel: den kan klistres i OneNote og laeses som den er.
    linjer.push('## Per day, per task', '');
    linjer.push(`| Case | Task | ${ts.dage.map((iso) => iso.slice(5)).join(' | ')} | Total |`);
    linjer.push(`|---|---|${ts.dage.map(() => '--:').join('|')}|--:|`);
    for (const raekke of ts.rows) {
      linjer.push(`| ${raekke.case || '—'} | ${raekke.title} | `
        + `${ts.dage.map((iso) => (raekke.dage[iso] ? f(raekke.dage[iso]) : '')).join(' | ')} | ${f(raekke.total)} |`);
    }
    linjer.push(`| **Total** |  | ${ts.dage.map((iso) => (ts.perDay[iso] ? f(ts.perDay[iso]) : '')).join(' | ')} | **${f(ts.total)}** |`);
    linjer.push('');
  }
  for (const p of r.projects) {
    linjer.push(`## ${p.name} — ${f(p.minutter)}`);
    for (const t of p.tasks) {
      const est = t.estimateMinutes ? ` (est. ${f(t.estimateMinutes)})` : '';
      linjer.push(`- ${t.title}: ${f(t.minutter)}${est}${t.completedIPerioden ? ' ✓ completed' : ''}`);
    }
    linjer.push('');
  }
  return linjer.join('\n');
}

/** Samme tal, samme raekkefoelge - bare til papir. */
function rapportArkHtml(d) {
  const f = rapportDecimal() ? tovoBeregn.formatDecimal : tovoBeregn.formatVarighed;
  const r = d.report;
  return `
    <h1>${esc(d.from)} – ${esc(d.to)}</h1>
    <p class="pkunde">${esc(f(r.total))} in total · ${esc(f(r.onProjects))} on projects
      · ${esc(f(r.adhoc))} ad hoc${r.norm ? ` · norm ${esc(f(r.norm))}` : ''}</p>
    ${d.timesheet && d.timesheet.caseRows.length ? `<table>
        <thead><tr><th>Case</th>
          ${d.timesheet.dage.map((iso) => `<th class="num">${esc(iso.slice(5))}</th>`).join('')}
          <th class="num">Total</th></tr></thead>
        <tbody>${d.timesheet.caseRows.map((c) => `<tr>
          <td>${esc(c.case || '(no case number)')}</td>
          ${d.timesheet.dage.map((iso) => `<td class="num">${c.dage[iso] ? esc(f(c.dage[iso])) : ''}</td>`).join('')}
          <td class="num">${esc(f(c.total))}</td></tr>`).join('')}</tbody>
      </table>` : ''}
    ${d.timesheet && d.timesheet.rows.length ? `<table>
        <thead><tr><th>Case</th><th>Task</th>
          ${d.timesheet.dage.map((iso) => `<th class="num">${esc(iso.slice(5))}</th>`).join('')}
          <th class="num">Total</th></tr></thead>
        <tbody>${d.timesheet.rows.map((raekke) => `<tr>
          <td>${esc(raekke.case || '—')}</td><td>${esc(raekke.title)}</td>
          ${d.timesheet.dage.map((iso) => `<td class="num">${raekke.dage[iso] ? esc(f(raekke.dage[iso])) : ''}</td>`).join('')}
          <td class="num">${esc(f(raekke.total))}</td></tr>`).join('')}</tbody>
      </table>` : ''}
    ${r.projects.map((p) => `
      <table>
        <thead><tr><th>${esc(p.name)}</th><th class="num">Estimated</th><th class="num">Spent</th></tr></thead>
        <tbody>${p.tasks.map((t) => `<tr>
          <td>${esc(t.title)}${t.completedIPerioden ? ' ✓' : ''}</td>
          <td class="num">${t.estimateMinutes ? esc(f(t.estimateMinutes)) : '—'}</td>
          <td class="num">${esc(f(t.minutter))}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td><strong>Total</strong></td><td></td>
          <td class="num"><strong>${esc(f(p.minutter))}</strong></td></tr></tfoot>
      </table>`).join('')}
    <p class="pdate">${esc(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>`;
}

/* ---- p8_kalender.js ---- */
'use strict';
/* tovo - ugekalenderen.
 *
 * Ugen som et gitter: dage hen ad, timer ned ad, og tidsposterne tegnet som
 * blokke dér, hvor de faktisk ligger. Det er den visning, der svarer paa
 * "hvad gik ugen med" uden at man skal laese en liste - og hvor man kan
 * TEGNE en registrering ind i et hul i stedet for at skrive den.
 *
 * Ingen udregninger her ud over gitterets geometri: minutter, summer og
 * formatering kommer fra beregn.js.
 */

const KAL_TIME_PX = 46;          // hoejden paa én time i gitteret
const KAL_SNAP = 15;             // minutter, alt snapper til
const kalState = { fra: null, poster: [], traek: null };

/* ------------------------------------------------------------ datoer */

function kalUgeStart(iso) {
  const [aa, mm, dd] = iso.split('-').map(Number);
  const d = new Date(aa, mm - 1, dd);
  const ugedag = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - (ugedag - 1));
  return isoDato(d);
}

function kalDage(fra) {
  const [aa, mm, dd] = fra.split('-').map(Number);
  return [0, 1, 2, 3, 4, 5, 6].map((n) => {
    const d = new Date(aa, mm - 1, dd + n);
    return { iso: isoDato(d), dato: d };
  });
}

/* Minutter siden midnat for et unix-tidspunkt, i LOKAL tid. */
function minutPaaDagen(unix) {
  const d = new Date(unix * 1000);
  return d.getHours() * 60 + d.getMinutes();
}

/* ------------------------------------------------------------ tegning */

async function tegnKalender() {
  const host = document.getElementById('pageHost');
  if (!kalState.fra) kalState.fra = kalUgeStart(state.today);
  const dage = kalDage(kalState.fra);
  const til = dage[6].iso;

  host.innerHTML = '<div class="page"><h1>Week</h1><p class="lead skeleton">Laying out the week…</p></div>';
  let d;
  try {
    d = await api('GET', `/api/v1/entries?from=${kalState.fra}&to=${til}`);
  } catch (ex) { toast(ex.message); return; }
  kalState.poster = d.entries;
  if (!state.items.length) {
    state.items = (await api('GET', '/api/v1/items?kind=task')).items;
  }

  // Gitterets hoejde faelger indholdet: normalt 7-18, men en post kl. 5 eller
  // 22 maa aldrig ligge uden for det, man kan se.
  let tidligst = 7;
  let senest = 18;
  for (const e of kalState.poster) {
    tidligst = Math.min(tidligst, Math.floor(minutPaaDagen(e.startedAt) / 60));
    const slut = e.stoppedAt ? minutPaaDagen(e.stoppedAt) : minutPaaDagen(Math.floor(Date.now() / 1000));
    senest = Math.max(senest, Math.ceil(slut / 60));
  }
  tidligst = Math.max(0, tidligst);
  senest = Math.min(24, Math.max(senest, tidligst + 6));

  const timer = [];
  for (let t = tidligst; t <= senest; t++) timer.push(t);
  const f = tovoBeregn.formatVarighed;
  const dagSum = (iso) => kalState.poster
    .filter((e) => isoDato(new Date(e.startedAt * 1000)) === iso)
    .reduce((n, e) => n + tovoBeregn.afrund(
      Math.round(((e.stoppedAt || Math.floor(Date.now() / 1000)) - e.startedAt) / 60), d.rounding), 0);
  const ugeSum = dage.reduce((n, dag) => n + dagSum(dag.iso), 0);

  host.innerHTML = `<div class="page kalenderside">
    <div class="row" style="justify-content:space-between;align-items:baseline">
      <h1>Week</h1>
      <span class="row" style="gap:8px">
        <button class="btn" id="kalForrige">←</button>
        <button class="btn" id="kalDenne">This week</button>
        <button class="btn" id="kalNaeste">→</button>
      </span>
    </div>
    <p class="lead">${esc(dage[0].iso)} – ${esc(til)} · <strong>${esc(f(ugeSum))}</strong> in total.
      Drag in the grid to log time, or click a block to change it.</p>

    <div class="kal" style="--timepx:${KAL_TIME_PX}px">
      <div class="kal-hoved">
        <div class="kal-hjoerne"></div>
        ${dage.map((dag) => `<div class="kal-dag${dag.iso === state.today ? ' idag' : ''}">
          <div class="kal-dagnavn">${dag.dato.toLocaleDateString('en-GB', { weekday: 'short' })}
            <span>${dag.dato.getDate()}</span></div>
          <div class="kal-dagsum meta">${esc(f(dagSum(dag.iso)))}</div>
        </div>`).join('')}
      </div>
      <div class="kal-krop">
        <div class="kal-timer">
          ${timer.map((t) => `<div class="kal-time"><span>${String(t).padStart(2, '0')}:00</span></div>`).join('')}
        </div>
        ${dage.map((dag) => `<div class="kal-soejle${dag.iso === state.today ? ' idag' : ''}"
            data-dag="${dag.iso}" data-fra="${tidligst}">
          ${timer.map(() => '<div class="kal-slot"></div>').join('')}
          ${blokkeFor(dag.iso, tidligst).join('')}
        </div>`).join('')}
      </div>
    </div>
    <p class="hintline meta">Drag in an empty column to add time · click a block to edit it
      · ⌘⇧M opens the form instead</p>
  </div>`;

  bindKalender(tidligst);
}

/** Blokkene for én dag, med overlap lagt ved siden af hinanden. */
function blokkeFor(iso, tidligst) {
  const nu = Math.floor(Date.now() / 1000);
  const dagens = kalState.poster
    .filter((e) => isoDato(new Date(e.startedAt * 1000)) === iso)
    .sort((a, b) => a.startedAt - b.startedAt);

  // Overlappende poster deler bredden. Uden det ligger to samtidige
  // registreringer oven i hinanden, og den nederste er usynlig.
  const spor = [];
  for (const e of dagens) {
    const slut = e.stoppedAt || nu;
    let i = spor.findIndex((s) => s.slut <= e.startedAt);
    if (i < 0) { spor.push({ slut }); i = spor.length - 1; } else spor[i].slut = slut;
    e._spor = i;
  }
  const antalSpor = Math.max(1, spor.length);

  return dagens.map((e) => {
    const opgave = state.items.find((t) => t.id === e.taskId);
    const projekt = opgave ? state.projects.find((p) => p.id === opgave.projectId) : null;
    const start = minutPaaDagen(e.startedAt);
    const slutMin = e.stoppedAt ? minutPaaDagen(e.stoppedAt) : minutPaaDagen(nu);
    const minutter = Math.max(10, slutMin - start);
    const top = ((start - tidligst * 60) / 60) * KAL_TIME_PX;
    const hoejde = (minutter / 60) * KAL_TIME_PX;
    const bredde = 100 / antalSpor;
    const koerer = !e.stoppedAt;
    return `<button class="kal-blok${koerer ? ' koerer' : ''}" data-post="${esc(e.id)}"
      style="top:${top}px;height:${Math.max(16, hoejde)}px;left:${e._spor * bredde}%;width:${bredde}%">
      <span class="kal-blok-titel">${esc(opgave ? opgave.title : 'Deleted task')}</span>
      <span class="kal-blok-sub">${esc(projekt ? projekt.name : 'no project')} · ${esc(tovoBeregn.formatVarighed(slutMin - start))}</span>
    </button>`;
  });
}

function bindKalender(tidligst) {
  document.getElementById('kalForrige').addEventListener('click', () => flytUge(-1));
  document.getElementById('kalNaeste').addEventListener('click', () => flytUge(1));
  document.getElementById('kalDenne').addEventListener('click', () => {
    kalState.fra = null;
    tegnKalender();
  });

  document.querySelectorAll('.kal-blok').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const post = kalState.poster.find((p) => p.id === el.dataset.post);
      if (post) aabnManuel(post.taskId, { entry: post });
    });
  });

  /*
   * Traek i en tom soejle = et tidsrum.
   *
   * Pointer-events frem for HTML5 drag & drop: DnD virker ikke paa touch
   * (§4), mens pointer-events er de samme paa mus, pen og finger. Og der
   * oprettes ingenting af traekket selv - det aabner formularen udfyldt, saa
   * en fejlramt finger ikke lige har registreret en time.
   */
  document.querySelectorAll('.kal-soejle').forEach((soejle) => {
    soejle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.kal-blok')) return;
      const r = soejle.getBoundingClientRect();
      kalState.traek = { soejle, fraY: e.clientY - r.top, tilY: e.clientY - r.top, iso: soejle.dataset.dag };
      soejle.setPointerCapture(e.pointerId);
      tegnMarkering(tidligst);
    });
    soejle.addEventListener('pointermove', (e) => {
      if (!kalState.traek || kalState.traek.soejle !== soejle) return;
      kalState.traek.tilY = e.clientY - soejle.getBoundingClientRect().top;
      tegnMarkering(tidligst);
    });
    soejle.addEventListener('pointerup', () => {
      const t = kalState.traek;
      kalState.traek = null;
      const mark = soejle.querySelector('.kal-mark');
      if (mark) mark.remove();
      if (!t) return;
      const fra = snapMinut(Math.min(t.fraY, t.tilY), tidligst);
      let til = snapMinut(Math.max(t.fraY, t.tilY), tidligst);
      // Et klik uden traek er en time - det er den almindelige registrering,
      // og en post paa nul minutter er ingen hjaelp for nogen.
      if (til - fra < KAL_SNAP) til = fra + 60;
      aabnManuel(null, { date: t.iso, text: `${klokke(fra)}-${klokke(til)}` });
    });
  });
}

function snapMinut(y, tidligst) {
  const minutter = tidligst * 60 + (y / KAL_TIME_PX) * 60;
  return Math.max(0, Math.min(24 * 60, Math.round(minutter / KAL_SNAP) * KAL_SNAP));
}

const klokke = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function tegnMarkering(tidligst) {
  const t = kalState.traek;
  if (!t) return;
  let mark = t.soejle.querySelector('.kal-mark');
  if (!mark) {
    mark = document.createElement('div');
    mark.className = 'kal-mark';
    t.soejle.appendChild(mark);
  }
  const fra = snapMinut(Math.min(t.fraY, t.tilY), tidligst);
  const til = Math.max(snapMinut(Math.max(t.fraY, t.tilY), tidligst), fra + KAL_SNAP);
  mark.style.top = `${((fra - tidligst * 60) / 60) * KAL_TIME_PX}px`;
  mark.style.height = `${((til - fra) / 60) * KAL_TIME_PX}px`;
  mark.textContent = `${klokke(fra)}–${klokke(til)}`;
}

function flytUge(n) {
  const [aa, mm, dd] = kalState.fra.split('-').map(Number);
  kalState.fra = isoDato(new Date(aa, mm - 1, dd + n * 7));
  tegnKalender();
}

/* ---- p9_polering.js ---- */
'use strict';
/* tovo - polering: Toggl-import, genvejsoversigt og eksport.
 *
 * Ingen udregninger her. Hullerne, summerne og varighederne kommer fra
 * beregn.js, som de gør alle andre steder.
 */

/* ------------------------------------------------- import fra Toggl */

/* CSV-laesningen og kolonnerne ligger i app/shared/toggl.js, saa de kan
   testes uden en browser. Her er kun ruden. */
const laesToggl = (tekst) => tovoToggl.laesToggl(tekst);

function aabnTogglImport() {
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'togglModal';
  host.innerHTML = `<div class="modal-card" role="dialog" aria-label="Import from Toggl">
      <h2>Import history from Toggl</h2>
      <p class="meta">In Toggl: <strong>Reports → Detailed → Export → CSV</strong>.
        Every row becomes a time entry here, marked as <code>import</code> so a report can
        tell it apart from time you tracked in tovo.</p>
      <label class="field"><span>CSV file from Toggl</span>
        <input class="input" type="file" id="tgFil" accept=".csv,text/csv"></label>
      <div id="tgKrop"></div>
      <div class="modal-foot" id="tgFod"><button class="btn" id="tgClose">Cancel</button></div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  document.getElementById('tgClose').addEventListener('click', luk);
  document.getElementById('tgFil').addEventListener('change', async (e) => {
    const fil = e.target.files && e.target.files[0];
    if (fil) togglForhaandsvis(await fil.text());
  });
}

let togglState = null;

function togglForhaandsvis(tekst) {
  const krop = document.getElementById('tgKrop');
  let d;
  try {
    d = laesToggl(tekst);
  } catch (ex) {
    krop.innerHTML = `<p class="gate-error">${esc(ex.message)}</p>`;
    return;
  }
  togglState = d;
  const projekter = [...new Set(d.poster.map((p) => p.project).filter(Boolean))];
  const nye = projekter.filter((n) => !state.projects.some((p) => p.name.toLowerCase() === n.toLowerCase()));
  const minutter = d.poster.reduce((n, p) => n + (p.minutter
    || (Number(p.slut.slice(0, 2)) * 60 + Number(p.slut.slice(3)) - (Number(p.start.slice(0, 2)) * 60 + Number(p.start.slice(3))))), 0);
  const datoer = d.poster.map((p) => p.date).sort();

  krop.innerHTML = `<div class="card">
      <ul class="plain">
        <li><span class="post-sum">${d.poster.length}</span><span class="post-main">time entries</span></li>
        <li><span class="post-sum">${esc(tovoBeregn.formatVarighed(minutter))}</span><span class="post-main">in total</span></li>
        <li><span class="post-sum">${projekter.length}</span><span class="post-main">projects (${nye.length} new)</span></li>
      </ul>
      <p class="meta">${datoer.length ? `${esc(datoer[0])} – ${esc(datoer[datoer.length - 1])}` : ''}</p>
    </div>
    ${d.advarsler.length ? `<p class="meta">${d.advarsler.slice(0, 5).map(esc).join('<br>')}
      ${d.advarsler.length > 5 ? `<br>…and ${d.advarsler.length - 5} more.` : ''}</p>` : ''}
    <p class="meta">Tasks are matched by name inside the project — a row that matches an
      existing task lands on it instead of creating a second one.</p>`;
  document.getElementById('tgFod').innerHTML = `
    <button class="btn primary" id="tgGo">Import ${d.poster.length} entries</button>
    <button class="btn" id="tgClose2">Cancel</button>`;
  document.getElementById('tgClose2').addEventListener('click', () => document.getElementById('togglModal').remove());
  document.getElementById('tgGo').addEventListener('click', togglImporter);
}

async function togglImporter() {
  const fod = document.getElementById('tgFod');
  fod.innerHTML = '<p class="meta" id="tgFremdrift">Importing…</p>';
  try {
    // 1. Projekterne, én gang.
    const projektId = new Map(state.projects.map((p) => [p.name.toLowerCase(), p.id]));
    for (const navn of [...new Set(togglState.poster.map((p) => p.project).filter(Boolean))]) {
      if (projektId.has(navn.toLowerCase())) continue;
      const p = await api('POST', '/api/v1/items', { kind: 'project', name: navn, sections: [] });
      projektId.set(navn.toLowerCase(), p.item.id);
    }

    // 2. Opgaverne. Navn + projekt er noeglen, saa den samme opgave ikke
    //    bliver oprettet én gang pr. tidspost.
    const alle = (await api('GET', '/api/v1/items?kind=task')).items;
    const opgaveId = new Map(alle.map((t) => [`${t.projectId || ''}|${t.title.toLowerCase()}`, t.id]));
    const skalOprettes = [];
    for (const post of togglState.poster) {
      const pid = post.project ? projektId.get(post.project.toLowerCase()) : null;
      const noegle = `${pid || ''}|${post.title.toLowerCase()}`;
      if (opgaveId.has(noegle) || skalOprettes.some((x) => x.noegle === noegle)) continue;
      skalOprettes.push({ noegle, kind: 'task', title: post.title, projectId: pid, status: 'open' });
    }
    for (let i = 0; i < skalOprettes.length; i += 25) {
      const parti = skalOprettes.slice(i, i + 25).map(({ noegle, ...rest }) => rest);
      const svar = await api('POST', '/api/v1/items/bulk', { items: parti });
      svar.items.forEach((t, j) => opgaveId.set(skalOprettes[i + j].noegle, t.id));
      const f = document.getElementById('tgFremdrift');
      if (f) f.textContent = `Creating tasks… ${Math.min(i + 25, skalOprettes.length)} of ${skalOprettes.length}`;
    }

    // 3. Tidsposterne, én ad gangen - de har hver sit tidsrum.
    let n = 0;
    for (const post of togglState.poster) {
      const pid = post.project ? projektId.get(post.project.toLowerCase()) : null;
      const id = opgaveId.get(`${pid || ''}|${post.title.toLowerCase()}`);
      const startedAt = tovoBeregn.tidspunkt(post.date, post.start);
      const minutter = post.minutter
        || (Number(post.slut.slice(0, 2)) * 60 + Number(post.slut.slice(3))
          - (Number(post.start.slice(0, 2)) * 60 + Number(post.start.slice(3))));
      await api('POST', '/api/v1/entries', {
        taskId: id, startedAt, stoppedAt: startedAt + Math.max(1, minutter) * 60, source: 'import',
      });
      n += 1;
      if (n % 10 === 0) {
        const f = document.getElementById('tgFremdrift');
        if (f) f.textContent = `Importing entries… ${n} of ${togglState.poster.length}`;
      }
    }

    document.getElementById('togglModal').remove();
    await genindlaes();
    toast(`Imported ${n} entries from Toggl.`);
  } catch (ex) {
    fod.innerHTML = `<p class="gate-error">${esc(ex.message)}</p>`;
  }
}

/* ------------------------------------------------- genvejsoversigten */

const GENVEJE = [
  ['⌘K / Ctrl+K', 'Open the search field from anywhere'],
  ['Just type', 'Starts writing in the search field'],
  ['+ text', 'Create a task — @project #tag :case !date ~estimate'],
  ['%', 'Anywhere in the line: create it and start the timer at once'],
  ['Enter', 'Create, or open the selected row'],
  ['⌘↵', 'In a list: start the timer on the selected task'],
  ['⌘↵', 'In a dialog: save and close it'],
  ['↑ ↓', 'Move into the list and around in it'],
  ['Space', 'Complete the task the cursor is on'],
  ['Esc', 'Leave the list, or close what is open'],
  ['⌘⇧M', 'Log time by hand'],
];

function visGenveje() {
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `<div class="modal-card" role="dialog" aria-label="Keyboard shortcuts">
      <h2>Keyboard shortcuts</h2>
      <table class="data genvejstabel">
        ${GENVEJE.map(([t, b]) => `<tr><td><kbd>${esc(t)}</kbd></td><td>${esc(b)}</td></tr>`).join('')}
      </table>
      <p class="meta">Letters never move the cursor into a list — you must be able to type a
        task that begins with any letter.</p>
      <div class="modal-foot"><button class="btn primary" id="gvClose">Close</button></div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  document.getElementById('gvClose').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });
}


/* ------------------------------------------------------ excel-download */

/**
 * Henter en .xlsx ned.
 *
 * Blob + object-URL og et <a download>. URL'en frigives bagefter - ellers
 * ligger filen i hukommelsen, saa laenge fanen er aaben.
 */
function hentExcel(ark, filnavn) {
  const data = tovoXlsx.byg(ark);
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filnavn;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Timer som TAL, ikke tekst.
 *
 * Det er hele grunden til at lave en rigtig regnearksfil frem for en CSV:
 * 3,5 skal kunne laegges sammen i Excel, uanset om maskinen staar paa dansk
 * eller engelsk komma. Excel viser det med maskinens eget komma af sig selv.
 */
const excelTimer = (minutter) => (minutter ? Math.round((minutter / 60) * 100) / 100 : null);

/* ---- pa_tavle.js ---- */
'use strict';
/* tovo - kanban-tavlen paa et projekt.
 *
 * Kolonnerne ER projektets sektioner, og de bor paa projektet - saa to
 * projekter kan have hver sine faser. Buckets fra en Planner-import bliver
 * sektioner, saa en importeret plan staar med sine egne kolonner med det
 * samme.
 *
 * TRAEK OG SLIP med pointer-events, IKKE HTML5 drag & drop: DnD virker ikke
 * paa touch (RUNE-ERFARINGER §4), mens pointerdown/move/up er de samme paa
 * mus, pen og finger. Og der er en vej UDEN at traekke - en menu paa hvert
 * kort - fordi et traek ikke kan naas med tastaturet (doda F3).
 */

const UDEN_SEKTION = '__uden';
const traekState = { aktiv: null };

/* Tavle eller liste PR. PROJEKT - en brugerpraeference, ikke en browser-ting.
   Egen noegle pr. projekt frem for ét JSON-kort: settings-vaerdier er
   afkortet til 2000 tegn, og et kort med mange projekt-id'er ville tavst
   miste de sidste. Noeglen er 43 tegn af de 64, der er plads til. */
function tavleTilstand(projektId) {
  return brugerFlag(`board_${projektId}`, false, `tovo_tavle_${projektId}`);
}

function saetTavleTilstand(projektId, paa) {
  saetBrugerFlag(`board_${projektId}`, paa);
}

/** Kolonnerne: projektets sektioner, plus en til det, der ikke har nogen. */
function tavleKolonner(p, opgaver) {
  const sektioner = (p.sections || []).slice().sort((a, b) => a.position - b.position);
  const kolonner = sektioner.map((s) => ({ id: s.id, navn: s.name }));
  // Kolonnen for "ingen sektion" vises kun, hvis der ER noget i den - ellers
  // er den en tom plads, der aldrig bliver brugt.
  if (opgaver.some((t) => !t.sectionId)) kolonner.unshift({ id: UDEN_SEKTION, navn: 'No column' });
  return kolonner;
}

const iKolonne = (opgaver, id) => opgaver
  .filter((t) => (t.sectionId || UDEN_SEKTION) === id)
  .sort((a, b) => (a.position || 0) - (b.position || 0));

function tavleHtml(p, opgaver, forbrug) {
  const kolonner = tavleKolonner(p, opgaver);
  if (!kolonner.length) {
    return `<div class="empty"><p class="empty-title">No columns yet</p>
      <p>Add the phases this project runs through — they belong to this project alone.</p>
      <div class="row" style="justify-content:center"><button class="btn" id="tvKolonner">Add columns</button></div></div>`;
  }
  // data-keynav: den globale piletast-handler leder efter [data-keynav]
  // [data-row]. Uden den kunne man ikke komme ned i tavlen med tastaturet -
  // listen kunne, og forskellen var usynlig, indtil man proevede.
  return `<div class="tavle" id="tavle" data-keynav>
    ${kolonner.map((k) => {
    const dens = iKolonne(opgaver, k.id);
    const minutter = dens.reduce((n, t) => n + (forbrug[t.id] || 0), 0);
    const estimat = dens.reduce((n, t) => n + (Number(t.estimateMinutes) || 0), 0);
    return `<div class="kolonne" data-kolonne="${esc(k.id)}">
        <div class="kolonne-hoved">
          <span class="kolonne-navn">${esc(k.navn)}</span>
          <span class="kolonne-antal">${dens.length}</span>
        </div>
        <div class="kolonne-sum meta">${estimat ? `est. ${esc(tovoBeregn.formatVarighed(estimat))} · ` : ''}${esc(tovoBeregn.formatVarighed(minutter))}</div>
        <div class="kolonne-kort" data-drop="${esc(k.id)}">
          ${dens.map((t) => kortHtml(t, forbrug)).join('')}
        </div>
      </div>`;
  }).join('')}
  </div>`;
}

function kortHtml(t, forbrug) {
  const koerer = timerState.data && timerState.data.entry.taskId === t.id;
  const dele = [];
  const projekt = state.projects.find((p) => p.id === t.projectId);
  const sag = t.caseNumber || (projekt && projekt.caseNumber) || '';
  if (sag) dele.push(sagHtml(sag));
  if (t.estimateMinutes) dele.push(`~${esc(tovoBeregn.formatVarighed(t.estimateMinutes))}`);
  if (forbrug[t.id]) dele.push(esc(tovoBeregn.formatVarighed(forbrug[t.id])));
  if (t.dueDate) {
    const forsinket = t.status !== 'done' && t.dueDate < state.today;
    dele.push(`<span class="${forsinket ? 'overdue' : ''}">${esc(visDato(t.dueDate))}</span>`);
  }
  return `<div class="kort${t.status === 'done' ? ' dim' : ''}" data-kort="${esc(t.id)}"
    data-row tabindex="0">
    <div class="kort-titel">${esc(t.title)}</div>
    ${dele.length ? `<div class="kort-meta meta">${dele.join(' · ')}</div>` : ''}
    <div class="kort-knapper">
      <button class="tick${t.status === 'done' ? ' on' : ''}" data-tick="${esc(t.id)}"
        aria-label="${t.status === 'done' ? 'Reopen' : 'Complete'}"></button>
      ${t.status === 'done' ? '' : `<button class="playbtn${koerer ? ' on' : ''}" data-start="${esc(t.id)}"
        aria-label="${koerer ? 'Stop the timer' : 'Start a timer'}">${icon(koerer ? 'stop' : 'play', 15)}</button>`}
      <button class="flytbtn" data-flyt="${esc(t.id)}" aria-label="Move to another column"
        title="Move to another column">${icon('chevron', 14)}</button>
    </div>
  </div>`;
}

function bindTavle(host, p, opgaver, forbrug) {
  host.querySelectorAll('[data-tick]').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); skiftFaerdig(el.dataset.tick); });
  });
  host.querySelectorAll('[data-start]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const koerer = timerState.data && timerState.data.entry.taskId === el.dataset.start;
      if (koerer) stopTimer();
      else startTimerPaa(el.dataset.start);
    });
  });
  // Vejen UDEN at traekke. Et traek kan ikke naas med tastaturet, og paa en
  // telefon er en menu ofte hurtigere end at slaebe et kort forbi tre
  // kolonner (doda F3).
  host.querySelectorAll('[data-flyt]').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); visFlytMenu(el, p, opgaver); });
  });

  host.querySelectorAll('[data-kort]').forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Samme genvej som i listerne: ⌘↵ starter uret paa den markerede.
        if (e.metaKey || e.ctrlKey) {
          const koerer = timerState.data && timerState.data.entry.taskId === el.dataset.kort;
          if (koerer) stopTimer();
          else startTimerPaa(el.dataset.kort);
          return;
        }
        aabnOpgave(el.dataset.kort);
        return;
      }
      if (e.key === ' ') { e.preventDefault(); skiftFaerdig(el.dataset.kort); return; }

      /*
       * Venstre og hoejre skifter KOLONNE.
       *
       * Op og ned haandteres af den globale handler, som gaar gennem alle
       * kort i dokumentets raekkefoelge - altsaa kolonne for kolonne. Uden
       * venstre/hoejre skulle man taste sig igennem en hel kolonne for at
       * naa nabokolonnen, og paa en tavle er det den forkerte vej.
       */
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const kolonne = el.closest('.kolonne');
      const alle = [...host.querySelectorAll('.kolonne')];
      const i = alle.indexOf(kolonne);
      const naeste = alle[i + (e.key === 'ArrowRight' ? 1 : -1)];
      if (!naeste) return;
      const her = [...kolonne.querySelectorAll('[data-kort]')].indexOf(el);
      const derovre = [...naeste.querySelectorAll('[data-kort]')];
      if (!derovre.length) return;
      // Er nabokolonnen kortere, lander man paa dens sidste kort - ikke paa
      // ingenting.
      (derovre[Math.min(her, derovre.length - 1)]).focus();
    });
    el.addEventListener('pointerdown', (e) => startTraek(e, el, p, opgaver, forbrug));
  });

  const kolonneKnap = document.getElementById('tvKolonner');
  if (kolonneKnap) kolonneKnap.addEventListener('click', () => aabnKolonneRuden(p));
}

/* ------------------------------------------------------- traek og slip */

/**
 * Et traek begynder foerst efter seks pixels.
 *
 * Uden traeskelen ville hvert klik paa et kort vaere et mikro-traek, og
 * kortet kunne ikke aabnes. Med den er et klik et klik, og et traek er et
 * traek - paa baade mus og finger.
 */
function startTraek(e, el, p, opgaver, forbrug) {
  if (e.target.closest('button')) return;          // knapperne paa kortet ejer deres eget klik
  if (e.button !== undefined && e.button !== 0) return;

  const start = { x: e.clientX, y: e.clientY };
  const kortId = el.dataset.kort;
  let traekker = false;
  let klon = null;
  let plads = null;

  const flyt = (ev) => {
    if (!traekker) {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      traekker = true;
      const r = el.getBoundingClientRect();
      klon = el.cloneNode(true);
      klon.className = 'kort traekkes';
      klon.style.width = `${r.width}px`;
      document.body.appendChild(klon);
      el.classList.add('traekkes-fra');
      plads = document.createElement('div');
      plads.className = 'kort-plads';
      document.body.classList.add('traekker');
    }
    klon.style.left = `${ev.clientX - 20}px`;
    klon.style.top = `${ev.clientY - 16}px`;

    // Maalet findes under fingeren - ikke ud fra hvor traekket begyndte.
    klon.hidden = true;
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    klon.hidden = false;
    const beholder = under && under.closest('[data-drop]');
    if (!beholder) { if (plads.parentElement) plads.remove(); return; }

    const kort = [...beholder.querySelectorAll('[data-kort]')].filter((k) => k !== el);
    const efter = kort.find((k) => ev.clientY < k.getBoundingClientRect().top + k.offsetHeight / 2);
    if (efter) beholder.insertBefore(plads, efter);
    else beholder.appendChild(plads);
  };

  const slut = async () => {
    document.removeEventListener('pointermove', flyt);
    document.removeEventListener('pointerup', slut);
    document.removeEventListener('keydown', afbryd);
    document.body.classList.remove('traekker');
    if (klon) klon.remove();
    el.classList.remove('traekkes-fra');
    if (!traekker) { aabnOpgave(kortId); return; }        // det var et klik
    if (!plads || !plads.parentElement) { tegnSide(); return; }

    const kolonneId = plads.parentElement.dataset.drop;
    const soeskende = [...plads.parentElement.children]
      .filter((n) => n === plads || (n.dataset && n.dataset.kort && n.dataset.kort !== kortId));
    const index = soeskende.indexOf(plads);
    plads.remove();
    await gemFlytning(kortId, kolonneId, index, opgaver);
  };

  // Esc afbryder - ellers sidder man fast i et traek, man ikke vil fuldfoere.
  const afbryd = (ev) => {
    if (ev.key !== 'Escape') return;
    traekker = false;
    slut();
  };

  document.addEventListener('pointermove', flyt);
  document.addEventListener('pointerup', slut);
  document.addEventListener('keydown', afbryd);
}

/**
 * Gemmer flytningen.
 *
 * Hele kolonnen skrives, saa positionerne bliver 0, 1, 2 - et loebenummer og
 * ikke et tidsstempel (doda F3). Bulk-endepunktet gaar gennem den samme
 * gemItem med den samme vagt mod delvise objekter.
 */
async function gemFlytning(kortId, kolonneId, index, opgaver) {
  const opgave = opgaver.find((t) => t.id === kortId);
  if (!opgave) { tegnSide(); return; }
  const nySektion = kolonneId === UDEN_SEKTION ? null : kolonneId;
  const uden = iKolonne(opgaver, kolonneId).filter((t) => t.id !== kortId);
  const ny = uden.slice(0, index).concat([opgave], uden.slice(index));

  const skriv = ny.map((t, i) => Object.assign({}, t, { sectionId: nySektion, position: i }));
  // Den gamle kolonne skal ogsaa nummereres om, ellers efterlader flytningen
  // huller i raekkefoelgen.
  const gammel = opgave.sectionId || UDEN_SEKTION;
  if (gammel !== kolonneId) {
    iKolonne(opgaver, gammel).filter((t) => t.id !== kortId)
      .forEach((t, i) => skriv.push(Object.assign({}, t, { position: i })));
  }
  try {
    await api('POST', '/api/v1/items/bulk', { items: skriv });
    await genindlaes();
  } catch (ex) {
    toast(ex.message);
    tegnSide();
  }
}

/** Menuen paa kortet: samme flytning, uden at traekke. */
function visFlytMenu(anker, p, opgaver) {
  const gammel = document.getElementById('flytMenu');
  if (gammel) gammel.remove();
  const opgave = opgaver.find((t) => t.id === anker.dataset.flyt);
  const kolonner = tavleKolonner(p, opgaver);
  const host = document.createElement('div');
  host.className = 'usermenu';
  host.id = 'flytMenu';
  host.innerHTML = kolonner.map((k) => `<button class="usermenu-item" data-til="${esc(k.id)}">
      <span>${esc(k.navn)}${(opgave.sectionId || UDEN_SEKTION) === k.id ? ' ·' : ''}</span></button>`).join('');
  const r = anker.getBoundingClientRect();
  host.style.left = `${Math.round(Math.min(r.left, window.innerWidth - 220))}px`;
  host.style.bottom = `${Math.round(window.innerHeight - r.top + 6)}px`;
  document.body.appendChild(host);
  host.querySelectorAll('[data-til]').forEach((el) => {
    el.addEventListener('click', async () => {
      host.remove();
      const til = el.dataset.til;
      await gemFlytning(opgave.id, til, iKolonne(opgaver, til).length, opgaver);
    });
  });
  setTimeout(() => {
    document.addEventListener('click', function udenfor(e) {
      if (host.isConnected && !host.contains(e.target) && e.target !== anker) {
        host.remove();
        document.removeEventListener('click', udenfor);
      }
    });
  }, 0);
}

/* ------------------------------------------------------- kolonnerne */

/**
 * Kolonnerne hoerer til PROJEKTET.
 *
 * De gemmes som `sections` paa projektet, saa to projekter kan have hver
 * sine faser - og en Planner-import kan skrive bucket'erne direkte ind uden
 * at roere noget andet projekt.
 */
function aabnKolonneRuden(p) {
  const sektioner = (p.sections || []).slice().sort((a, b) => a.position - b.position);
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `<div class="modal-card" role="dialog" aria-label="Columns">
      <h2>Columns in ${esc(p.name)}</h2>
      <p class="meta">The phases this project runs through. They belong to this project alone —
        another project can have completely different ones. A Planner import writes its buckets
        in here.</p>
      <ul class="plain" id="kolonneListe">
        ${sektioner.map((s, i) => `<li data-sek="${esc(s.id)}">
          <input class="input kolonne-input" value="${esc(s.name)}" data-navn="${esc(s.id)}">
          <button class="linkbtn" data-op="${esc(s.id)}" ${i === 0 ? 'disabled' : ''}>up</button>
          <button class="linkbtn" data-ned="${esc(s.id)}" ${i === sektioner.length - 1 ? 'disabled' : ''}>down</button>
          <button class="linkbtn" data-fjern="${esc(s.id)}">remove</button>
        </li>`).join('')}
      </ul>
      <div class="row">
        <input class="input" id="nyKolonne" placeholder="New column — e.g. In progress" style="flex:1">
        <button class="btn" id="tilfoejKolonne">Add</button>
      </div>
      <p class="meta">Removing a column leaves its tasks in the project, without a column.</p>
      <div class="modal-foot">
        <button class="btn primary" id="kolonneGem" title="⌘↵ / Ctrl+↵">Save <span class="genvejstip">⌘↵</span></button>
        <button class="btn" id="kolonneLuk">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(host);

  // Raekkefoelgen holdes i en lokal liste, saa op/ned kan bruges flere gange
  // foer der gemmes. Knapper og ikke traek: det er den ENE loesning, der
  // virker med mus, tastatur og tommelfinger paa én gang (doda F3).
  let liste = sektioner.map((s) => ({ id: s.id, name: s.name }));
  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });
  document.getElementById('kolonneLuk').addEventListener('click', luk);

  const tegn = () => {
    const ul = document.getElementById('kolonneListe');
    ul.innerHTML = liste.map((s, i) => `<li data-sek="${esc(s.id)}">
        <input class="input kolonne-input" value="${esc(s.name)}" data-navn="${esc(s.id)}">
        <button class="linkbtn" data-op="${esc(s.id)}" ${i === 0 ? 'disabled' : ''}>up</button>
        <button class="linkbtn" data-ned="${esc(s.id)}" ${i === liste.length - 1 ? 'disabled' : ''}>down</button>
        <button class="linkbtn" data-fjern="${esc(s.id)}">remove</button>
      </li>`).join('');
    bind();
  };

  const laesNavne = () => {
    document.querySelectorAll('[data-navn]').forEach((el) => {
      const s = liste.find((x) => x.id === el.dataset.navn);
      if (s) s.name = el.value;
    });
  };

  function bind() {
    document.querySelectorAll('[data-op]').forEach((el) => el.addEventListener('click', () => {
      laesNavne();
      const i = liste.findIndex((s) => s.id === el.dataset.op);
      [liste[i - 1], liste[i]] = [liste[i], liste[i - 1]];
      tegn();
    }));
    document.querySelectorAll('[data-ned]').forEach((el) => el.addEventListener('click', () => {
      laesNavne();
      const i = liste.findIndex((s) => s.id === el.dataset.ned);
      [liste[i + 1], liste[i]] = [liste[i], liste[i + 1]];
      tegn();
    }));
    document.querySelectorAll('[data-fjern]').forEach((el) => el.addEventListener('click', () => {
      laesNavne();
      liste = liste.filter((s) => s.id !== el.dataset.fjern);
      tegn();
    }));
  }
  bind();

  document.getElementById('tilfoejKolonne').addEventListener('click', () => {
    const felt = document.getElementById('nyKolonne');
    const navn = felt.value.trim();
    if (!navn) return;
    laesNavne();
    liste.push({ id: nyId(), name: navn });
    felt.value = '';
    tegn();
    document.getElementById('nyKolonne').focus();
  });

  const gemKolonner = async () => {
    laesNavne();
    try {
      await api('PATCH', `/api/v1/items/${p.id}`, {
        sections: liste.filter((s) => s.name.trim()).map((s, i) => ({ id: s.id, name: s.name.trim(), position: i })),
      });
      luk();
      await genindlaes();
      toast('Columns saved.');
    } catch (ex) { toast(ex.message); }
  };
  document.getElementById('kolonneGem').addEventListener('click', gemKolonner);
  bindGemGenvej(host, gemKolonner);
}

/* ---- pb_tags.js ---- */
'use strict';
/* tovo - maerkaterne.
 *
 * Et tag uden et tal er en gaettekonkurrence: "#internt" siger ingenting, foer
 * man kan se, at der sidder fjorten opgaver paa det. Derfor er antallet det
 * foerste, listen viser - og et klik aabner opgaverne bag tallet.
 */

async function tegnTags() {
  const host = document.getElementById('pageHost');
  const [t, d] = await Promise.all([
    api('GET', '/api/v1/tags'),
    api('GET', '/api/v1/items?kind=task'),
  ]);
  state.items = d.items;
  const valgt = state.openTag && t.tags.find((x) => x.id === state.openTag);
  const opgaver = valgt
    ? d.items.filter((o) => (o.tagIds || []).includes(valgt.id))
    : [];
  const aabne = opgaver.filter((o) => o.status !== 'done');
  const faerdige = opgaver.filter((o) => o.status === 'done');

  host.innerHTML = `<div class="page">
    <h1>Tags</h1>
    <p class="lead">${esc(BESKRIVELSER.tags)}</p>

    ${t.tags.length ? `<div class="tagliste">
      ${t.tags.map((x) => `<button class="tagkort${valgt && valgt.id === x.id ? ' on' : ''}"
          data-tag="${esc(x.id)}">
          <span class="tagnavn">#${esc(x.name)}</span>
          <span class="tagtal">${x.count}</span>
          <span class="meta">${x.open} open</span>
        </button>`).join('')}
    </div>` : `<div class="empty"><p class="empty-title">No tags yet</p>
      <p>Write <code>#name</code> when you capture a task — or type <code>#</code> in the field
      above to create one on its own.</p></div>`}

    ${valgt ? `
      <div class="row" style="justify-content:space-between;align-items:baseline;margin-top:22px">
        <h2 class="group">#${esc(valgt.name)}<span class="group-count">${opgaver.length}</span></h2>
        <span class="row" style="gap:8px">
          <button class="linkbtn" id="tagOmdoeb">rename</button>
          <button class="linkbtn" id="tagSlet">delete tag</button>
        </span>
      </div>
      <div data-keynav>
        ${afsnit('Open', aabne)}
        ${faerdige.length ? afsnit('Done', faerdige, { foldbar: true, noegle: `tag-faerdige-${valgt.id}` }) : ''}
      </div>
      ${!opgaver.length ? '<div class="empty"><p>Nothing carries this tag right now.</p></div>' : ''}
      <p class="hintline meta">Arrow keys move into the list · Enter opens · ⌘↵ starts the timer</p>
    ` : (t.tags.length ? '<p class="meta" style="margin-top:18px">Pick a tag to see what carries it.</p>' : '')}
  </div>`;

  host.querySelectorAll('[data-tag]').forEach((el) => {
    el.addEventListener('click', () => {
      // Et klik paa det valgte slaar det fra igen - ellers er der ingen vej
      // tilbage til hele listen uden at forlade siden.
      state.openTag = state.openTag === el.dataset.tag ? null : el.dataset.tag;
      tegnSide();
    });
  });
  if (valgt) {
    bindOpgaveListe(host);
    document.getElementById('tagOmdoeb').addEventListener('click', () => omdoebTag(valgt));
    document.getElementById('tagSlet').addEventListener('click', () => sletTag(valgt, opgaver.length));
  }
}

function omdoebTag(tag) {
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `<div class="modal-card" role="dialog" aria-label="Rename tag">
      <h2>Rename #${esc(tag.name)}</h2>
      <p class="meta">The tag keeps its place on every task — only the name changes.</p>
      <label class="field"><span>Name</span>
        <input class="input" id="tgNavn" value="${esc(tag.name)}"></label>
      <div class="modal-foot">
        <button class="btn primary" id="tgGem" title="⌘↵ / Ctrl+↵">Save <span class="genvejstip">⌘↵</span></button>
        <button class="btn" id="tgLuk">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });
  document.getElementById('tgLuk').addEventListener('click', luk);
  const gemNavnet = async () => {
    const navn = document.getElementById('tgNavn').value.trim();
    if (!navn) { toast('A tag needs a name.'); return; }
    try {
      await api('PATCH', `/api/v1/items/${tag.id}`, { name: navn });
      luk();
      await genindlaes();
      toast('Renamed.');
    } catch (ex) { toast(ex.message); }
  };
  document.getElementById('tgGem').addEventListener('click', gemNavnet);
  bindGemGenvej(host, gemNavnet);
  document.getElementById('tgNavn').focus();
}

/**
 * Sletning fjerner ogsaa maerkatet FRA opgaverne - serveren gør det i samme
 * kald. Og den sender navnet og de ramte opgaver tilbage, saa fortrydelsen
 * kan saette begge dele paa plads igen i stedet for at gaette.
 */
async function sletTag(tag, antal) {
  try {
    const d = await api('DELETE', `/api/v1/tags/${tag.id}`);
    state.openTag = null;
    await genindlaes();
    toast(`#${d.deleted.name} deleted${antal ? ` and taken off ${antal} task${antal > 1 ? 's' : ''}` : ''}.`, {
      label: 'Undo',
      run: async () => {
        try {
          const ny = await api('POST', '/api/v1/items', { kind: 'tag', name: d.deleted.name });
          for (const id of d.taskIds) {
            const opgave = (await api('GET', `/api/v1/items/${id}`)).item;
            await api('PATCH', `/api/v1/items/${id}`, {
              tagIds: (opgave.tagIds || []).concat([ny.item.id]),
            });
          }
          await genindlaes();
          toast(`#${ny.item.name} is back on ${d.taskIds.length} task${d.taskIds.length === 1 ? '' : 's'}.`);
        } catch (ex) { toast(ex.message); }
      },
    });
  } catch (ex) { toast(ex.message); }
}
