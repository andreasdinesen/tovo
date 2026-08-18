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
