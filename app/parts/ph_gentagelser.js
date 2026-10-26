'use strict';
/* tovo - gentagne opgaver (Recurring).
 *
 * En skabelon bliver til en opgave et antal dage foer sit forfald: »skift
 * kodeord paa alle forbindelser hver 3. maaned«. Serveren goer arbejdet (ved
 * opstart, hver time og naar en forekomst lukkes) - siden her viser planen og
 * retter i den. Ingen datoregning her: naeste dato, oprettelsesdagen og
 * tilstanden kommer fra beregn.js via serveren.
 */

const GENTAG_ENHED_NAVN = { day: 'days', week: 'weeks', month: 'months', year: 'years' };

const GENTAG_TILSTAND = {
  open: 'Task is open',
  due: 'Being created',
  waiting: 'Waiting',
  paused: 'Paused',
};

async function tegnGentagelser() {
  const host = document.getElementById('pageHost');
  const d = await api('GET', '/api/v1/recurring');
  const liste = d.recurring;

  host.innerHTML = `<div class="page">
    <div class="row" style="justify-content:space-between;align-items:baseline">
      <h1>Recurring</h1>
      <button class="btn" id="gtNy">${icon('plus', 15)} New recurring task</button>
    </div>
    <p class="lead">${esc(BESKRIVELSER.recurring)}</p>

    ${liste.length ? `<div class="gentagliste">${liste.map(gentagRaekke).join('')}</div>`
    : `<div class="empty"><p class="empty-title">Nothing recurring yet</p>
      <p>Things you must remember now and then — change the passwords on every connection,
      update the time sheet — go here. tovo puts them on your list a few days before they are due.</p></div>`}
  </div>`;

  document.getElementById('gtNy').addEventListener('click', () => aabnGentagelse(null));
  host.querySelectorAll('[data-gentag]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      aabnGentagelse(liste.find((x) => x.id === el.dataset.gentag));
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === el) aabnGentagelse(liste.find((x) => x.id === el.dataset.gentag));
    });
  });
  host.querySelectorAll('[data-gtopgave]').forEach((el) => {
    el.addEventListener('click', () => aabnOpgave(el.dataset.gtopgave));
  });
  host.querySelectorAll('[data-gtnu]').forEach((el) => {
    el.addEventListener('click', () => opretGentagelseNu(el.dataset.gtnu));
  });
}

function gentagRaekke(s) {
  const projekt = state.projects.find((p) => p.id === s.projectId);
  const dele = [esc(s.describe)];
  if (projekt) dele.push(esc(projekt.name));
  if (s.estimateMinutes) dele.push(`~${esc(tovoBeregn.formatVarighed(s.estimateMinutes))}`);

  let naar;
  if (s.state === 'paused') naar = 'Paused';
  else if (s.task) {
    naar = `Due ${esc(visDato(s.task.dueDate))}`;
  } else {
    naar = `Due ${esc(visDato(s.nextDue))} · on your list ${esc(visDato(s.createOn))}`;
  }
  const forsinket = s.task && s.task.dueDate && s.task.dueDate < state.today;

  return `<div class="item-row gentag-raekke${s.paused ? ' dim' : ''}" tabindex="0" data-gentag="${esc(s.id)}">
    <span class="gentag-ikon" aria-hidden="true">${icon('gentag', 16)}</span>
    <div class="item-main">
      <div class="item-title">${esc(s.title)}</div>
      <div class="item-meta meta">${dele.join(' · ')}</div>
      <div class="item-meta meta"><span class="${forsinket ? 'overdue' : ''}">${naar}</span>
        ${s.lastDone ? ` · last done ${esc(visDato(s.lastDone))}` : ''}</div>
    </div>
    ${s.task
    ? `<button class="btn small" data-gtopgave="${esc(s.task.id)}" title="Open the task">Open task</button>`
    : (s.paused ? '' : `<button class="btn small" data-gtnu="${esc(s.id)}"
        title="Put it on your list today instead of waiting">Create now</button>`)}
  </div>`;
}

async function opretGentagelseNu(id) {
  try {
    const d = await api('POST', `/api/v1/recurring/${id}/now`);
    await genindlaes();
    toast(`“${d.created.title}” is on your list.`);
  } catch (ex) { toast(ex.message); }
}

function aabnGentagelse(s) {
  const ny = !s;
  const r = s || { every: 3, unit: 'month', schedule: 'fixed', leadDays: 7, nextDue: '' };
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
    <div class="modal-card" role="dialog" aria-label="${ny ? 'New recurring task' : 'Edit recurring task'}">
      <h2>${ny ? 'New recurring task' : 'Edit recurring task'}</h2>
      <label class="field"><span>Title</span>
        <input class="input" id="gtTitel" placeholder="Change the passwords on every connection"
          value="${esc(r.title || '')}"></label>

      <div class="row gentag-plan">
        <label class="field"><span>Every</span>
          <input class="input" id="gtAntal" type="number" min="1" max="999" inputmode="numeric"
            value="${esc(r.every || 1)}"></label>
        <label class="field"><span>&nbsp;</span>
          <select class="input" id="gtEnhed">
            ${Object.entries(GENTAG_ENHED_NAVN).map(([k, v]) =>
    `<option value="${k}"${r.unit === k ? ' selected' : ''}>${v}</option>`).join('')}
          </select></label>
        <label class="field" style="flex:1.4"><span>Next due</span>
          <input class="input" id="gtDato" type="date" value="${esc(r.nextDue || '')}"></label>
      </div>

      <div class="field"><span>Count from</span>
        <label class="radio"><input type="radio" name="gtPlan" value="fixed"${r.schedule !== 'completion' ? ' checked' : ''}>
          the plan — the same rhythm no matter when you finish</label>
        <label class="radio"><input type="radio" name="gtPlan" value="completion"${r.schedule === 'completion' ? ' checked' : ''}>
          the day you finish it</label>
      </div>

      <div class="row gentag-varsel">
        <label class="field"><span>Put it on the list</span>
          <input class="input" id="gtVarsel" type="number" min="0" max="365" inputmode="numeric"
            value="${esc(r.leadDays === undefined || r.leadDays === null ? 7 : r.leadDays)}"></label>
        <span class="gentag-hint">days before it is due</span>
      </div>

      <div class="row">
        <label class="field" style="flex:1.4"><span>Project</span>
          <select class="input" id="gtProjekt">
            <option value="">No project</option>
            ${state.projects.map((p) => `<option value="${esc(p.id)}"${p.id === r.projectId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select></label>
        <label class="field" style="flex:1"><span>Estimate</span>
          <input class="input" id="gtEst" placeholder="30m · 1t"
            value="${esc(r.estimateMinutes ? tovoBeregn.formatVarighed(r.estimateMinutes) : '')}"></label>
      </div>

      <label class="field"><span>Notes</span>
        <textarea class="input" id="gtNote" placeholder="Which connections, where the list lives …">${esc(r.note || '')}</textarea></label>

      ${!ny && r.task ? `<p class="meta">The open task is due ${esc(visDato(r.task.dueDate))}. When you complete it,
        the next one is planned.</p>` : ''}

      <div class="modal-foot">
        <button class="btn primary" id="gtGem" title="⌘↵ / Ctrl+↵">Save <span class="genvejstip">⌘↵</span></button>
        <button class="btn" id="gtLuk">Cancel</button>
        <span style="flex:1"></span>
        ${ny ? '' : `<button class="btn" id="gtPause">${r.paused ? 'Resume' : 'Pause'}</button>
          <button class="btn" id="gtSlet">Delete</button>`}
      </div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });
  document.getElementById('gtLuk').addEventListener('click', luk);

  const gem = async () => {
    const val = (id) => document.getElementById(id).value;
    const est = val('gtEst').trim();
    const minutter = est ? tovoBeregn.parseVarighed(est) : null;
    if (est && !minutter) { toast(`"${est}" is not a duration.`); return; }
    const krop = {
      title: val('gtTitel').trim(),
      every: Number(val('gtAntal')) || 1,
      unit: val('gtEnhed'),
      nextDue: val('gtDato'),
      schedule: host.querySelector('input[name="gtPlan"]:checked').value,
      leadDays: val('gtVarsel') === '' ? 0 : Number(val('gtVarsel')),
      projectId: val('gtProjekt') || null,
      estimateMinutes: minutter,
      note: val('gtNote'),
    };
    if (!krop.title) { toast('Give it a title.'); return; }
    if (!krop.nextDue) { toast('Pick the next due date.'); return; }
    try {
      const d = ny ? await api('POST', '/api/v1/recurring', krop)
        : await api('PATCH', `/api/v1/recurring/${r.id}`, krop);
      luk();
      await genindlaes();
      toast(d.created ? `Saved — “${d.created.title}” is on your list now.` : 'Saved.');
    } catch (ex) { toast(ex.message); }
  };
  document.getElementById('gtGem').addEventListener('click', gem);
  bindGemGenvej(host, gem);

  if (!ny) {
    document.getElementById('gtPause').addEventListener('click', async () => {
      try {
        await api('PATCH', `/api/v1/recurring/${r.id}`, { paused: !r.paused });
        luk();
        await genindlaes();
        toast(r.paused ? 'Resumed.' : 'Paused — no new tasks until you resume it.');
      } catch (ex) { toast(ex.message); }
    });
    document.getElementById('gtSlet').addEventListener('click', async () => {
      try {
        await api('DELETE', `/api/v1/items/${r.id}`);
        luk();
        await genindlaes();
        // Fortrydelsen laver planen igen med de samme felter. Den aabne
        // opgave kender den ikke laengere - den staar paa listen alligevel.
        toast(`“${r.title}” deleted. Tasks it already made stay on your list.`, {
          label: 'Undo',
          run: async () => {
            try {
              await api('POST', '/api/v1/recurring', {
                title: r.title, note: r.note, every: r.every, unit: r.unit, schedule: r.schedule,
                nextDue: r.nextDue, leadDays: r.leadDays, projectId: r.projectId,
                estimateMinutes: r.estimateMinutes, paused: r.paused, tagIds: r.tagIds,
                links: r.links, caseNumber: r.caseNumber, sectionId: r.sectionId, priority: r.priority,
              });
              await genindlaes();
            } catch (ex2) { toast(ex2.message); }
          },
        });
      } catch (ex) { toast(ex.message); }
    });
  }
  document.getElementById('gtTitel').focus();
}
