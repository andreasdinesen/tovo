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
let manuelAabner = false;

async function aabnManuel(forvalgtOpgave, opt) {
  /*
   * Opgaverne hentes HVER gang ruden aabnes. state.items er kun den aktuelle
   * sides udsnit (et projekt, et tag, ugen ...), og ruden stod med det: aabnet
   * efter et projekt kunne man kun registrere paa det projekt (2026-09-22).
   * Laasen forhindrer, at ⌘⇧M to gange under hentningen giver to ruder.
   */
  if (manuelAabner) return;
  manuelAabner = true;
  let alle;
  try {
    alle = (await api('GET', '/api/v1/items?kind=task')).items;
  } catch (ex) { toast(ex.message); return; } finally { manuelAabner = false; }
  if (document.querySelector('.modal')) return;

  const o = opt || {};
  const post = o.entry || null;
  const host = document.createElement('div');
  host.className = 'modal';
  // Ved redigering skal opgaven kunne vaere en, der er afsluttet - ellers
  // kan man ikke rette en tidspost paa noget, man lige har lukket.
  const opgaver = alle.filter((t) => t.status !== 'done'
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
        <select class="input" id="mTask">${opgaveValg(opgaver, forvalgtProjekt, forvalgtOpgave)}${NY_OPGAVE}</select></label>
      <label class="field" id="mNewField" hidden><span>New task</span>
        <input class="input" id="mNewTask" placeholder="What is it called? — lands in the project above"
          autocomplete="off"></label>
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
  const opgaveFelt = document.getElementById('mTask');
  const nyFelt = document.getElementById('mNewField');
  const nyTitel = document.getElementById('mNewTask');
  const visNyFelt = () => {
    nyFelt.hidden = opgaveFelt.value !== '__ny';
    if (!nyFelt.hidden) nyTitel.focus();
  };
  const tegnOpgaver = (valgt) => {
    opgaveFelt.innerHTML = opgaveValg(opgaver, projektFelt.value, valgt) + NY_OPGAVE;
    // Kun hvis den findes i det nye projekt. Ellers giver `.value = ...` et
    // TOMT valg - og i et tomt projekt skal »+ New task« vaelges af sig selv.
    if (valgt && [...opgaveFelt.options].some((x) => x.value === valgt)) opgaveFelt.value = valgt;
    visNyFelt();
  };
  projektFelt.addEventListener('change', () => tegnOpgaver(opgaveFelt.value));
  opgaveFelt.addEventListener('change', visNyFelt);
  nyTitel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); gem(); }
  });

  const gem = async () => {
    let taskId = opgaveFelt.value;
    if (!taskId) { toast('Pick a task, or choose "+ New task" — time is always logged on something.'); return; }
    const dato = document.getElementById('mDate').value;
    const tekst = document.getElementById('mText').value;
    try {
      if (taskId === '__ny') {
        const titel = nyTitel.value.trim();
        if (!titel) { toast('Give the new task a name.'); nyTitel.focus(); return; }
        /*
         * Tiden tjekkes FOER opgaven oprettes - med den samme parseTidsrum,
         * serveren bruger. Ellers efterlod en tastefejl i tiden en opgave
         * uden tid, og et nyt forsoeg lavede en til.
         */
        if (!tovoBeregn.parseTidsrum(tekst, dato)) {
          toast(`I did not understand "${tekst}". Try 9-11.30, 1,5t or 90m.`);
          return;
        }
        // Gennem fangsten: titlen er skrevet i tovo, saa #tag, ~estimat og
        // @projekt virker som i soegefeltet. Uden @ lander den i projektet
        // ovenfor - samme regel som konteksten paa en projektside.
        const valgtProjekt = projektFelt.value;
        const r = await api('POST', '/api/v1/capture', {
          text: titel,
          projectId: valgtProjekt && valgtProjekt !== '__ingen' ? valgtProjekt : null,
        });
        opgaver.push(r.item);
        taskId = r.item.id;
        // `@Nyt projekt` i titlen opretter projektet. state.projects kender det
        // foerst efter genindlaesningen, og uden det kan listerne ikke vise
        // den nye opgave, hvis registreringen herunder fejler.
        const nytProjekt = (r.nye || []).find((n) => n.kind === 'project');
        if (r.item.projectId && nytProjekt && !state.projects.some((p) => p.id === r.item.projectId)) {
          state.projects.push({ id: r.item.projectId, name: nytProjekt.name });
        }
        // Opgaven FINDES nu. Fejler registreringen herunder, staar den valgt,
        // saa et nyt tryk ikke opretter den igen.
        if (r.item.projectId && projektFelt.value !== r.item.projectId) {
          projektFelt.innerHTML = projektValg(opgaver, r.item.projectId);
        }
        nyTitel.value = '';
        tegnOpgaver(taskId);
      }
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

/* Sidst i opgavelisten - staar den foerst, bliver den valgt af sig selv. */
const NY_OPGAVE = '<option value="__ny">+ New task…</option>';

/**
 * Alle projekter - plus "alle" og "No project".
 *
 * Foer v35 kun dem, der HAVDE opgaver: der var intet at registrere paa i et
 * tomt projekt. Med »+ New task« er der, og et nyt projekt fra ServiceNow-
 * importen er netop tomt, indtil man opretter den foerste opgave.
 */
function projektValg(opgaver, valgt) {
  const medOpgaver = new Set(opgaver.map((t) => t.projectId || '__ingen'));
  const dele = [`<option value=""${valgt === '' ? ' selected' : ''}>All projects</option>`];
  for (const p of state.projects) {
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

  // Tomt projekt: intet her, saa »+ New task« er det eneste valg - og bliver
  // valgt af sig selv.
  if (!filtreret.length) return '';
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
