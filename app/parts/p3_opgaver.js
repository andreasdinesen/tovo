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
    el.addEventListener('click', () => aabnOpgave(el.dataset.id));
    // Enter aabner den raekke, der har fokus. Piletasterne foerte hertil.
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); aabnOpgave(el.dataset.id); }
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
  const forfalder = aabne.filter((t) => t.dueDate && t.dueDate <= state.today);
  const resten = aabne.filter((t) => !forfalder.includes(t));
  const faerdige = d.items.filter((t) => t.status === 'done' && t.completedAt
    && new Date(t.completedAt * 1000).toISOString().slice(0, 10) === state.today);

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
      ${p.rounding ? `<p class="meta">Shown rounded to ${p.rounding} minutes — the stored times are exact.</p>` : ''}
    </div>

    <div data-keynav>
      ${afsnit('Due or overdue', forfalder)}
      ${afsnit('Everything else', resten)}
      ${faerdige.length ? afsnit('Done today', faerdige) : ''}
    </div>
    ${!d.items.length ? '<div class="empty"><p class="empty-title">Nothing here yet</p>'
      + '<p>Type in the field above to add your first task.</p></div>' : ''}
    <p class="hintline meta">Arrow keys move into the list · Enter opens · Space completes · Esc leaves
      · ⌘⇧M logs time by hand</p>
  </div>`;
  bindOpgaveListe(host);
  bindPoster(host, d.items);
  document.getElementById('logManual').addEventListener('click', () => aabnManuel());
}

function afsnit(titel, liste, opt) {
  if (!liste.length) return '';
  return `<h2 class="group">${esc(titel)}<span class="group-count">${liste.length}</span></h2>
    ${liste.map((it) => opgaveRaekke(it, opt)).join('')}`;
}

async function tegnProjekter() {
  const host = document.getElementById('pageHost');
  if (state.openProject) { await tegnProjekt(state.openProject); return; }
  const d = await api('GET', '/api/v1/items?kind=task');
  state.items = d.items;

  host.innerHTML = `<div class="page">
    <div class="row" style="justify-content:space-between;align-items:baseline">
      <h1>Projects</h1>
      <button class="btn" id="plannerImport">Import from Planner</button>
    </div>
    <p class="lead">${esc(BESKRIVELSER.projects)}</p>
    ${state.projects.length ? `<div class="cards">${state.projects.map((p) => {
      const opgaver = d.items.filter((t) => t.projectId === p.id);
      const aabne = opgaver.filter((t) => t.status !== 'done').length;
      return `<button class="card projectcard" data-projekt="${esc(p.id)}">
        <h2>${esc(p.name)}</h2>
        <div class="meta">${esc(p.customer || 'no customer')} · ${aabne} open · ${opgaver.length} total</div>
      </button>`;
    }).join('')}</div>` : '<div class="empty"><p class="empty-title">No projects yet</p>'
      + '<p>Type <code>/</code> in the field above to create one.</p></div>'}
  </div>`;
  document.getElementById('plannerImport').addEventListener('click', () => aabnPlannerImport(null));
  host.querySelectorAll('[data-projekt]').forEach((el) => {
    el.addEventListener('click', () => gaaTil('projects', { project: el.dataset.projekt }));
  });
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
  const aabne = d.tasks.filter((t) => t.status !== 'done');
  const faerdige = d.tasks.filter((t) => t.status === 'done');
  const sektioner = (p.sections || []).slice().sort((a, b) => a.position - b.position);
  const iSektion = (sid) => aabne.filter((t) => (t.sectionId || null) === sid);

  host.innerHTML = `<div class="page">
    <button class="linkbtn" id="tilbage">← Projects</button>
    <div class="row" style="justify-content:space-between;align-items:baseline">
      <h1>${esc(p.name)}</h1>
      <span class="row" style="gap:8px">
        <button class="btn" id="plannerRe">Re-import</button>
        <button class="btn" id="kundeVis">Customer view</button>
        <button class="btn" id="bulkLinks">Copy start links</button>
      </span>
    </div>
    <p class="lead">${esc(p.customer || 'No customer set')}</p>

    <div class="card">
      <div class="row">
        <div style="flex:1"><div class="meta">Estimated</div>
          <div class="bigtal">${esc(tovoBeregn.formatVarighed(r.estimat))}</div></div>
        <div style="flex:1"><div class="meta">Budget</div>
          <div class="bigtal">${r.ramme ? esc(tovoBeregn.formatVarighed(r.ramme)) : '—'}</div></div>
        <div style="flex:1"><div class="meta">Spent</div>
          <div class="bigtal">${esc(tovoBeregn.formatVarighed(r.forbrugt))}</div></div>
        <div style="flex:1"><div class="meta">Left</div>
          <div class="bigtal">${r.resterende === null ? '—' : esc(tovoBeregn.formatVarighed(Math.max(0, r.resterende)))}</div></div>
      </div>
      ${r.estimatOverRamme ? '<p class="meta warnline">The estimates add up to more than the budget — '
    + 'that is more work than was sold.</p>' : ''}
      ${r.procent === null ? '' : (r.procent >= 100
    ? `<p class="meta warnline">The budget is used up — ${r.procent}% of it is spent.</p>`
    : (r.procent >= 80 ? `<p class="meta warnline">${r.procent}% of the budget is used.</p>` : ''))}
    </div>

    <div data-keynav>
      ${sektioner.map((sek) => afsnit(sek.name, iSektion(sek.id), { forbrug: d.spent })).join('')}
      ${afsnit(sektioner.length ? 'No section' : 'Open', iSektion(null), { forbrug: d.spent })}
      ${faerdige.length ? afsnit('Done', faerdige, { forbrug: d.spent }) : ''}
    </div>
    ${!d.tasks.length ? '<div class="empty"><p class="empty-title">No tasks in this project</p>'
      + '<p>The field above adds them here — you are inside the project.</p></div>' : ''}
  </div>`;
  document.getElementById('tilbage').addEventListener('click', () => gaaTil('projects'));
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
  bindOpgaveListe(host);
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
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
    <div class="modal-card detail" role="dialog" aria-label="Task">
      <div class="detail-head">
        <button class="tick big${it.status === 'done' ? ' on' : ''}" id="dTick"
          aria-label="${it.status === 'done' ? 'Reopen' : 'Complete'}"></button>
        <input class="detail-title input" id="dTitle" value="${esc(it.title)}">
      </div>

      <label class="field"><span>Notes</span>
        <textarea class="input" id="dNote">${esc(it.note || '')}</textarea></label>

      <div class="row">
        <label class="field" style="flex:1"><span>Estimate</span>
          <input class="input" id="dEst" placeholder="2,5t · 90m · 1t30m"
            value="${esc(it.estimateMinutes ? tovoBeregn.formatVarighed(it.estimateMinutes) : '')}"></label>
        <label class="field" style="flex:1"><span>Due</span>
          <input class="input" id="dDue" type="date" value="${esc(it.dueDate || '')}"></label>
        <label class="field" style="flex:1"><span>Priority</span>
          <select class="input" id="dPrio">
            <option value="">—</option>
            ${['low', 'medium', 'high'].map((x) => `<option value="${x}"${it.priority === x ? ' selected' : ''}>${x}</option>`).join('')}
          </select></label>
      </div>

      <div class="meta">${esc(projekt ? projekt.name : 'No project')}</div>

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
      <ul class="plain" id="dComments">${kommentarer.map((c) => `
        <li><span>${linkify(c.text)}</span></li>`).join('') || '<li class="meta">No comments yet</li>'}</ul>
      <div class="row">
        <input class="input" id="dComment" placeholder="Write a comment…" style="flex:1">
        <button class="btn" id="dCommentAdd">Add</button>
      </div>

      <div class="modal-foot">
        <button class="btn primary" id="dSave">Save</button>
        <button class="btn" id="dStart">${icon('play', 15)} Start timer</button>
        <button class="btn" id="dLog">Log time</button>
        <button class="btn" id="dClose">Close</button>
        <span style="flex:1"></span>
        <button class="btn danger" id="dDelete">Delete</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  bindDetalje(host, it, startLink);
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
  const felter = () => ({
    title: document.getElementById('dTitle').value,
    note: document.getElementById('dNote').value,
    dueDate: document.getElementById('dDue').value || null,
    priority: document.getElementById('dPrio').value || null,
  });

  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  document.getElementById('dClose').addEventListener('click', luk);
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });

  document.getElementById('dSave').addEventListener('click', async () => {
    const f = felter();
    const raa = document.getElementById('dEst').value.trim();
    // Varigheden tolkes af beregn.js - samme funktion som `~` i paletten og
    // som serveren bruger. To tolkninger ville vaere to sandheder.
    if (raa) {
      const m = tovoBeregn.parseVarighed(raa);
      if (!m) { toast(`I did not understand "${raa}" as a duration.`); return; }
      f.estimateMinutes = m;
    } else f.estimateMinutes = null;
    try {
      await api('PATCH', `/api/v1/items/${it.id}`, f);
      luk();
      await genindlaes();
      toast('Saved.');
    } catch (ex) { toast(ex.message); }
  });

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
