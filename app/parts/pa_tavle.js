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

function tavleTilstand(projektId) {
  try { return localStorage.getItem(`tovo_tavle_${projektId}`) === '1'; } catch { return false; }
}

function saetTavleTilstand(projektId, paa) {
  try { localStorage.setItem(`tovo_tavle_${projektId}`, paa ? '1' : '0'); } catch { /* privat */ }
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
  return `<div class="tavle" id="tavle">
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
  return `<div class="kort${t.status === 'done' ? ' dim' : ''}" data-kort="${esc(t.id)}" tabindex="0">
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
      if (e.key === 'Enter') { e.preventDefault(); aabnOpgave(el.dataset.kort); }
      if (e.key === ' ') { e.preventDefault(); skiftFaerdig(el.dataset.kort); }
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
        <button class="btn primary" id="kolonneGem">Save</button>
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

  document.getElementById('kolonneGem').addEventListener('click', async () => {
    laesNavne();
    try {
      await api('PATCH', `/api/v1/items/${p.id}`, {
        sections: liste.filter((s) => s.name.trim()).map((s, i) => ({ id: s.id, name: s.name.trim(), position: i })),
      });
      luk();
      await genindlaes();
      toast('Columns saved.');
    } catch (ex) { toast(ex.message); }
  });
}
