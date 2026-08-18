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
