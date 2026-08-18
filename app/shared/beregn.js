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

      return {
        fra,
        til,
        total: s.total,
        entries: s.entries,
        projects: s.projects,
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
      varighed, forbrugPaaOpgave, forbrugPaaProjekt, rollupProjekt,
      sumPeriode, sumPrDag, ugerapport, afrunding,
    };
  }

  return {
    parseVarighed, formatVarighed, formatUr, parseTidsrum, placerVarighed,
    tidspunkt, afrund, opret,
  };
}));
