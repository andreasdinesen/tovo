/*
 * Live-opdatering: serveren siger til, naar noget er aendret.
 *
 * Starter man en timer paa telefonen, skal den dukke op paa computeren uden
 * at nogen trykker opdater. Det er hele formaalet.
 *
 * ── Hvorfor SSE og ikke websockets eller polling ──────────────────────────
 *
 * Beskeden gaar KUN én vej: serveren har noget nyt. Til det er Server-Sent
 * Events det mindste, der virker - `text/event-stream` over almindelig http,
 * som Node kan af sig selv (nul pakker, §1), og som browseren genforbinder
 * med helt uden kode. En websocket ville skulle haandskrives med rammer og
 * maskering for at kunne det samme den ene vej.
 *
 * Polling ville ogsaa virke, men enten langsomt eller dyrt: et kald hvert
 * sekund fra hver aabne fane, doegnet rundt, for noget der sker ti gange om
 * dagen.
 *
 * ── Beskeden baerer INTET ─────────────────────────────────────────────────
 *
 * Der sendes et vink, ikke data: »noget aendrede sig«. Fladen henter saa
 * `/api/v1/state`, som den allerede goer ved opstart.
 *
 * Det er med vilje. Bar beskeden data, skulle den serialiseres et sted mere -
 * og saa har vi to steder, der skal blive enige om, hvad en opgave er. Og et
 * vink kan ikke laekke noget: der staar ikke andet i det end et tal.
 *
 * ── Den ufravigelige regel ────────────────────────────────────────────────
 *
 * **En lytter hoerer KUN sin egen brugers aendringer.** tovo er flerbruger, og
 * en stroem, der vinkede til alle, ville fortaelle den ene, at den anden
 * arbejder - hvornaar de moeder, hvornaar de holder op. Derfor er lytterne
 * grupperet paa userId, og `varsko()` tager et userId. Der findes ingen vej
 * til at sende til alle.
 */

'use strict';

/**
 * @param hjerteslagMs  Hvor ofte der sendes et livstegn. Standard 25 s.
 *
 *   En tunnel eller en proxy lukker en stille forbindelse. Cloudflare giver
 *   typisk ~100 s, saa 25 s er rigeligt under - og billigt: to linjer tekst.
 *   Uden det ville stroemmen doe tavst, og fladen ville tro, den lyttede.
 */
function opret({ hjerteslagMs = 25000 } = {}) {
  /** userId -> Set(res) */
  const lyttere = new Map();

  function tilslut(req, res, userId) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      /* nginx og flere proxyer buffrer ellers svaret, og saa kommer vinkene
         i klumper - eller slet ikke, saa laenge forbindelsen er aaben. */
      'X-Accel-Buffering': 'no',
    });

    /* `retry` er browserens ventetid foer den genforbinder. EventSource
       genforbinder selv; her siger vi bare hvor hurtigt. */
    res.write('retry: 3000\n\n');

    if (!lyttere.has(userId)) lyttere.set(userId, new Set());
    lyttere.get(userId).add(res);

    const hjerte = setInterval(() => {
      /* En kommentarlinje. Den naar frem gennem enhver proxy og bliver
         ignoreret af EventSource - men holder forbindelsen i live. */
      try { res.write(': hjerteslag\n\n'); } catch { luk(); }
    }, hjerteslagMs);
    /* Uden unref holder intervallet processen i live - i en test betyder det,
       at node --test aldrig slutter. */
    if (typeof hjerte.unref === 'function') hjerte.unref();

    let lukket = false;
    function luk() {
      if (lukket) return;
      lukket = true;
      clearInterval(hjerte);
      const saet = lyttere.get(userId);
      if (saet) {
        saet.delete(res);
        /* Tom maengde fjernes. Ellers vokser kortet med en noegle pr. bruger,
           der nogensinde har lyttet. */
        if (!saet.size) lyttere.delete(userId);
      }
      try { res.end(); } catch { /* allerede lukket i den anden ende */ }
    }

    req.on('close', luk);
    req.on('error', luk);
    res.on('error', luk);
    return luk;
  }

  /**
   * Vink til én brugers aabne faner.
   *
   * Kaldes efter en aendring. Fejler en skrivning, er forbindelsen doed -
   * saa ryddes den, og resten faar stadig deres vink.
   */
  function varsko(userId, hvad = 'aendring') {
    const saet = lyttere.get(userId);
    if (!saet || !saet.size) return 0;
    const linje = `event: ${hvad}\ndata: ${Date.now()}\n\n`;
    let naaet = 0;
    for (const res of [...saet]) {
      try { res.write(linje); naaet += 1; } catch {
        saet.delete(res);
        try { res.end(); } catch { /* ligegyldigt */ }
      }
    }
    if (!saet.size) lyttere.delete(userId);
    return naaet;
  }

  /** Til tests og til /api/v1/state: hvor mange lytter lige nu? */
  function antal(userId) {
    if (userId === undefined) {
      let n = 0;
      for (const s of lyttere.values()) n += s.size;
      return n;
    }
    const s = lyttere.get(userId);
    return s ? s.size : 0;
  }

  function lukAlle() {
    for (const saet of lyttere.values()) {
      for (const res of [...saet]) { try { res.end(); } catch { /* n/a */ } }
    }
    lyttere.clear();
  }

  return { tilslut, varsko, antal, lukAlle };
}

module.exports = { opret };
