'use strict';
/* tovo - timeren, tidsposterne og den manuelle registrering.
 *
 * Ingen udregninger her. Alt hvad der ligner et tal kommer fra beregn.js -
 * ogsaa de smaa. Webappen og MCP skal svare det samme (CLAUDE.md).
 */

/*
 * Bjaelken bor i <body>, UDEN FOR det element render() skifter ud.
 * Ellers forsvinder den ved hver optegning (doda F8).
 *
 * Og den taeller ud fra STARTTIDSPUNKTET, aldrig ved at laegge et sekund til
 * en variabel: en taeller nulstilles ved hver gentegning og driver, naar
 * fanen har vaeret i baggrunden. `Date.now() - start` er korrekt efter en
 * fuld sideindlaesning, efter en time i baggrunden og paa tvaers af faner.
 */
const timerState = { data: null, tik: null };

function tegnTimerBjaelke() {
  let bar = document.getElementById('timerBar');
  const t = timerState.data;
  if (!t) {
    if (bar) bar.remove();
    document.title = state.config.appName || 'tovo';
    stopTik();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'timerbar';
    bar.id = 'timerBar';
    document.body.appendChild(bar);
  }
  const gaaet = forloebet(t);
  bar.classList.toggle('warn', !!t.tooLong);
  bar.innerHTML = `
    <button class="timerbar-main" id="timerOpen">
      <span class="timerbar-dot"></span>
      <span class="timerbar-text">
        <span class="timerbar-title">${esc(t.taskTitle)}</span>
        <span class="timerbar-sub meta">${esc(t.projectName || 'no project')}${t.tooLong
    ? ` · running for over ${esc(tovoBeregn.formatVarighed(t.warnAfterMinutes))}` : ''}</span>
      </span>
    </button>
    <span class="timerbar-time">${esc(gaaet)}</span>
    <button class="btn" id="timerStop">${icon('stop', 15)} Stop</button>`;
  document.getElementById('timerStop').addEventListener('click', stopTimer);
  document.getElementById('timerOpen').addEventListener('click', () => aabnOpgave(t.entry.taskId));
  // Titlen er den eneste visning, der er der, ogsaa naar fanen ikke er det.
  document.title = `${gaaet} · ${t.taskTitle} — tovo`;
  startTik();
}

/** Den forloebne tid, formateret af beregn.js. */
function forloebet(t) {
  const minutter = Math.max(0, Math.round((Date.now() / 1000 - t.entry.startedAt) / 60));
  return tovoBeregn.formatVarighed(minutter);
}

function startTik() {
  if (timerState.tik) return;
  // Ét minut er den groveste opdeling, der stadig foeles praecis - og den
  // koster ingenting. Bjaelken tegnes om, ikke hele siden.
  timerState.tik = setInterval(() => { if (timerState.data) tegnTimerBjaelke(); }, 30000);
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
function aabnManuel(forvalgtOpgave) {
  const host = document.createElement('div');
  host.className = 'modal';
  const opgaver = (state.items || []).filter((t) => t.status !== 'done');
  host.innerHTML = `
    <div class="modal-card" role="dialog" aria-label="Log time">
      <h2>Log time</h2>
      <p class="meta">On any date — the timer is not the only way in.</p>
      <label class="field"><span>Task</span>
        <select class="input" id="mTask">
          ${opgaver.map((t) => `<option value="${esc(t.id)}"${t.id === forvalgtOpgave ? ' selected' : ''}>${esc(t.title)}</option>`).join('')}
        </select></label>
      <div class="row">
        <label class="field" style="flex:1"><span>Date</span>
          <input class="input" id="mDate" type="date" value="${esc(state.today)}"></label>
        <label class="field" style="flex:1"><span>Time</span>
          <input class="input" id="mText" placeholder="9-11.30 · 1,5t · 90m" autocomplete="off"></label>
      </div>
      <label class="field"><span>Note (optional)</span>
        <input class="input" id="mNote" placeholder="What was it?"></label>
      <div class="modal-foot">
        <button class="btn primary" id="mSave">Log it</button>
        <button class="btn" id="mClose">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });
  document.getElementById('mClose').addEventListener('click', luk);

  const gem = async () => {
    const taskId = document.getElementById('mTask').value;
    if (!taskId) { toast('Create a task first — time is always logged on something.'); return; }
    try {
      await api('POST', '/api/v1/entries', {
        taskId,
        date: document.getElementById('mDate').value,
        text: document.getElementById('mText').value,
        note: document.getElementById('mNote').value,
      });
      luk();
      await genindlaes();
      toast('Logged.');
    } catch (ex) { toast(ex.message); }
  };
  document.getElementById('mSave').addEventListener('click', gem);
  document.getElementById('mText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); gem(); }
  });
  document.getElementById('mText').focus();
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
