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
      <h2>${esc(tovoBeregn.formatVarighed(state.todayMinutes || 0))} today</h2>
      ${p.entries.length ? `<ul class="plain posts">${p.entries.map((e) => postRaekke(e, d.items)).join('')}</ul>`
    : '<p class="meta">Nothing logged yet. Start a timer on a task, or log it by hand.</p>'}
      ${(p.gaps || []).length ? `<div class="huller">
        <div class="meta">Gaps between what you registered — this is where forgotten time hides.</div>
        ${p.gaps.map((h) => `<button class="hul" data-hul="${esc(h.fra)}-${esc(h.til)}">
          <span>${esc(h.fra)}–${esc(h.til)}</span>
          <span class="meta">${esc(tovoBeregn.formatVarighed(h.minutter))} unaccounted</span>
        </button>`).join('')}
      </div>` : ''}
      ${p.rounding ? `<p class="meta">Shown rounded to ${p.rounding} minutes — the stored times are exact.</p>` : ''}
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

function afsnitAabent(noegle, standard) {
  try {
    const gemt = localStorage.getItem(`tovo_fold_${noegle}`);
    if (gemt === '1') return true;
    if (gemt === '0') return false;
  } catch { /* privat tilstand */ }
  return standard;
}

function saetAfsnitAabent(noegle, aabent) {
  try { localStorage.setItem(`tovo_fold_${noegle}`, aabent ? '1' : '0'); } catch { /* privat */ }
}

/* Kort eller liste. Kort er rare, naar der er tre projekter; en liste er
   det, der duer, naar der er tredive. Valget huskes. */
function projektListeTilstand() {
  try { return localStorage.getItem('tovo_projekter_liste') === '1'; } catch { return false; }
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
    try { localStorage.setItem('tovo_projekter_liste', somListe ? '0' : '1'); } catch { /* privat */ }
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
