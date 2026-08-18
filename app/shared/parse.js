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
