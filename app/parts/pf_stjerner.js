'use strict';
/*
 * tovo - stjernemarkerede opgaver.
 *
 * »Jeg kunne godt tænke mig muligheden for at kunne stjernemarkere opgaver
 * som så lægger sig ude i venstre menu. Hvor man hurtigt kan starte en
 * tidstagning på dem. Desuden måtte de også godt lægge sig oppe over
 * søgefeltet som i sagu med noter« (Andreas, 2026-09-16).
 *
 * ── Ét sted tegner OG binder ──────────────────────────────────────────────
 *
 * `tegnStjerner()` skriver markup og saetter lytterne i samme kald. Stod
 * markuppen i `shellHtml()` og bindingen her, ville punkterne efter hver
 * fulde optegning se rigtige ud og ikke goere noget - praecis den fejl Sagus
 * favoritter havde (RUNE-ERFARINGER, Sagu 2026-08-21).
 *
 * ── To steder, ét stykke logik ────────────────────────────────────────────
 *
 * Sidebaren og baandet over soegefeltet viser det samme: `state.starred`,
 * som serveren har sorteret. Kun formen er forskellig, og de deler baade
 * klik-handleren og spoergsmaalet om, hvorvidt timeren koerer paa raekken.
 *
 * Under mobilgraensen er sidebaren et overlay, man ikke kan se - der er
 * baandet den ENESTE vej til en stjerne, og derfor vises det ogsaa dér.
 * Sagu skjuler sine faner paa telefonen; her ville det tage funktionen vaek
 * netop paa den skaerm, der ikke har et alternativ.
 *
 * ── Baandet er ikke en visning af data, det er en KNAPRAEKKE ──────────────
 *
 * Et klik paa navnet aabner opgaven, et klik paa trekanten starter timeren -
 * samme fordeling som `opgaveRaekke()` har i listerne. En genvej, der gjorde
 * noget ANDET end den raekke, den er en genvej til, skal man laere to gange.
 */

/** Samme fold-noegle som afsnittene: ét sted at rette, naeste gang de aendres. */
function stjernerAabne() {
  return afsnitAabent('stjerner', true);
}

/** Koerer timeren paa den her opgave lige nu? */
function stjerneKoerer(id) {
  return !!(timerState.data && timerState.data.entry.taskId === id);
}

function stjerneProjekt(t) {
  const p = state.projects.find((x) => x.id === t.projectId);
  return p ? p.name : '';
}

/** Titel-attributten paa begge former: navnet og hvor opgaven hoerer til. */
function stjerneTitel(t) {
  const p = stjerneProjekt(t);
  return p ? `${t.title} — ${p}` : t.title;
}

function stjerneStartMaerke(id) {
  return stjerneKoerer(id) ? 'Stop the timer' : 'Start a timer';
}

/* ------------------------------------------------------ sidebaren */

function stjerneNavHtml() {
  const liste = state.starred || [];
  // Ingen stjerner: intet afsnit. En tom overskrift i sidebaren er en
  // funktion, der ser ud til at vaere gaaet i stykker.
  if (!liste.length) return '';
  const aabne = stjernerAabne();
  /*
   * En `div`, ikke en `nav`. Afsnittet ligger INDE i navigationens egen
   * `<nav>` (lige over Projects), og en `nav` i en `nav` er to landemaerker
   * i hinanden - en skaermlaeser melder dem begge. `.nav`-klassen giver den
   * samme spalte og afstand uden den bivirkning.
   */
  return `<div class="nav stjernesektion">
    <button class="nav-item stjerne-titel" data-stjernefold
      aria-expanded="${aabne ? 'true' : 'false'}">
      ${icon('stjerneFuld')}<span>Starred</span>
      <span class="nav-count">${liste.length}</span>
      <span class="stjerne-pil${aabne ? ' on' : ''}">${icon('chevron', 14)}</span>
    </button>
    ${aabne ? `<div class="nav-under">${liste.map((t) => {
    const koerer = stjerneKoerer(t.id);
    return `<div class="stjerne-raekke${koerer ? ' koerer' : ''}">
        <button class="nav-item nav-sub stjerne-navn" data-stjerne="${esc(t.id)}"
          title="${esc(stjerneTitel(t))}">
          <span class="nav-prik"></span><span class="stjerne-tekst">${esc(t.title)}</span>
        </button>
        <button class="playbtn${koerer ? ' on' : ''}" data-stjernestart="${esc(t.id)}"
          aria-label="${esc(stjerneStartMaerke(t.id))}"
          title="${esc(stjerneStartMaerke(t.id))}">${icon(koerer ? 'stop' : 'play', 15)}</button>
      </div>`;
  }).join('')}</div>` : ''}
  </div>`;
}

/* --------------------------------------------- baandet over feltet */

function stjerneBarHtml() {
  return (state.starred || []).map((t) => {
    const koerer = stjerneKoerer(t.id);
    return `<div class="stjernefane${koerer ? ' koerer' : ''}">
      <button class="stjernefane-knap" data-stjerne="${esc(t.id)}"
        title="${esc(stjerneTitel(t))}">
        ${icon('stjerneFuld', 13)}<span class="stjernefane-titel">${esc(t.title)}</span>
      </button>
      <button class="stjernefane-start" data-stjernestart="${esc(t.id)}"
        aria-label="${esc(stjerneStartMaerke(t.id))}"
        title="${esc(stjerneStartMaerke(t.id))}">${icon(koerer ? 'stop' : 'play', 14)}</button>
    </div>`;
  }).join('');
}

/* ------------------------------------------------------- optegning */

/**
 * Tegner BEGGE steder og binder dem. Kaldes fra `bindShell()` ved opstart og
 * fra `opdaterNav()` ved hvert state-kald - de to steder, der i forvejen
 * holder skallen ajour.
 */
function tegnStjerner() {
  const nav = document.getElementById('stjerneHost');
  if (nav) nav.innerHTML = stjerneNavHtml();

  const bar = document.getElementById('stjerneBar');
  if (bar) {
    const html = stjerneBarHtml();
    bar.innerHTML = html;
    // `hidden` frem for en tom boks: baandet har margen, og en tom boks med
    // margen er en stribe luft, ingen kan forklare.
    bar.hidden = !html;
  }

  document.querySelectorAll('[data-stjerne]').forEach((el) => {
    el.addEventListener('click', () => aabnOpgave(el.dataset.stjerne));
  });
  document.querySelectorAll('[data-stjernestart]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.stjernestart;
      if (stjerneKoerer(id)) stopTimer();
      else startTimerPaa(id);
    });
  });
  const fold = document.querySelector('[data-stjernefold]');
  if (fold) {
    fold.addEventListener('click', () => {
      saetAfsnitAabent('stjerner', !stjernerAabne());
      // Tegner KUN sig selv. En fuld optegning ville lukke en aaben rude og
      // flytte rullepositionen.
      tegnStjerner();
    });
  }
}

/* ------------------------------------------------------- markering */

/**
 * Saetter eller fjerner stjernen.
 *
 * Gaar gennem serverens EGEN rute, ikke en PATCH med `starred`: det er dén,
 * der tildeler `starredSeq`, og nummeret er listens raekkefoelge.
 *
 * @param {string} id opgavens id
 * @param {boolean} paa den tilstand, stjernen skal have BAGEFTER
 */
async function skiftStjerne(id, paa) {
  try {
    await api('POST', `/api/v1/tasks/${id}/star`, { starred: !!paa });
    await genindlaes();
    /*
     * Knappen i en AABEN opgaverude tegnes ikke af `genindlaes()` - ruden er
     * et element paa `body`, som sidernes optegning ikke roerer. Uden det her
     * ville stjernen i sidebaren skifte, mens knappen, man lige trykkede paa,
     * blev staaende paa det gamle. Listernes egne knapper er allerede tegnet
     * forfra og faar bare det samme svar en gang til.
     */
    opdaterStjerneKnapper(id, !!paa);
    toast(paa ? 'Starred.' : 'Star removed.');
  } catch (ex) { toast(ex.message); }
}

/** Retter hver knap for `id`, hvor den end staar, til tilstanden `paa`. */
function opdaterStjerneKnapper(id, paa) {
  const tekst = paa ? 'Remove the star' : 'Star it — quick access and one-click timer';
  document.querySelectorAll(`[data-stjernemark="${CSS.escape(id)}"]`).forEach((el) => {
    el.classList.toggle('on', paa);
    el.dataset.stjernepaa = paa ? '0' : '1';
    el.setAttribute('aria-pressed', paa ? 'true' : 'false');
    el.setAttribute('aria-label', tekst);
    el.title = tekst;
    el.innerHTML = icon(paa ? 'stjerneFuld' : 'stjerne', el.classList.contains('stor') ? 18 : 16);
  });
}

/** Stjerneknappen, som den ser ud paa en opgave. Samme markup begge steder. */
function stjerneKnapHtml(it, opt) {
  const o = opt || {};
  const paa = !!it.starred;
  const tekst = paa ? 'Remove the star' : 'Star it — quick access and one-click timer';
  return `<button class="stjernebtn${paa ? ' on' : ''}${o.stor ? ' stor' : ''}"
    data-stjernemark="${esc(it.id)}" data-stjernepaa="${paa ? '0' : '1'}"
    aria-pressed="${paa ? 'true' : 'false'}"
    aria-label="${esc(tekst)}" title="${esc(tekst)}">${icon(paa ? 'stjerneFuld' : 'stjerne', o.stor ? 18 : 16)}</button>`;
}

/** Binder stjerneknapperne inde i `host`. Kaldes samme sted som resten. */
function bindStjerneKnapper(host) {
  host.querySelectorAll('[data-stjernemark]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      skiftStjerne(el.dataset.stjernemark, el.dataset.stjernepaa === '1');
    });
  });
}
