'use strict';
/* tovo - polering: Toggl-import, genvejsoversigt og eksport.
 *
 * Ingen udregninger her. Hullerne, summerne og varighederne kommer fra
 * beregn.js, som de gør alle andre steder.
 */

/* ------------------------------------------------- import fra Toggl */

/* CSV-laesningen og kolonnerne ligger i app/shared/toggl.js, saa de kan
   testes uden en browser. Her er kun ruden. */
const laesToggl = (tekst) => tovoToggl.laesToggl(tekst);

function aabnTogglImport() {
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'togglModal';
  host.innerHTML = `<div class="modal-card" role="dialog" aria-label="Import from Toggl">
      <h2>Import history from Toggl</h2>
      <p class="meta">In Toggl: <strong>Reports → Detailed → Export → CSV</strong>.
        Every row becomes a time entry here, marked as <code>import</code> so a report can
        tell it apart from time you tracked in tovo.</p>
      <label class="field"><span>CSV file from Toggl</span>
        <input class="input" type="file" id="tgFil" accept=".csv,text/csv"></label>
      <div id="tgKrop"></div>
      <div class="modal-foot" id="tgFod"><button class="btn" id="tgClose">Cancel</button></div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  document.getElementById('tgClose').addEventListener('click', luk);
  document.getElementById('tgFil').addEventListener('change', async (e) => {
    const fil = e.target.files && e.target.files[0];
    if (fil) togglForhaandsvis(await fil.text());
  });
}

let togglState = null;

function togglForhaandsvis(tekst) {
  const krop = document.getElementById('tgKrop');
  let d;
  try {
    d = laesToggl(tekst);
  } catch (ex) {
    krop.innerHTML = `<p class="gate-error">${esc(ex.message)}</p>`;
    return;
  }
  togglState = d;
  const projekter = [...new Set(d.poster.map((p) => p.project).filter(Boolean))];
  const nye = projekter.filter((n) => !state.projects.some((p) => p.name.toLowerCase() === n.toLowerCase()));
  const minutter = d.poster.reduce((n, p) => n + (p.minutter
    || (Number(p.slut.slice(0, 2)) * 60 + Number(p.slut.slice(3)) - (Number(p.start.slice(0, 2)) * 60 + Number(p.start.slice(3))))), 0);
  const datoer = d.poster.map((p) => p.date).sort();

  krop.innerHTML = `<div class="card">
      <ul class="plain">
        <li><span class="post-sum">${d.poster.length}</span><span class="post-main">time entries</span></li>
        <li><span class="post-sum">${esc(tovoBeregn.formatVarighed(minutter))}</span><span class="post-main">in total</span></li>
        <li><span class="post-sum">${projekter.length}</span><span class="post-main">projects (${nye.length} new)</span></li>
      </ul>
      <p class="meta">${datoer.length ? `${esc(datoer[0])} – ${esc(datoer[datoer.length - 1])}` : ''}</p>
    </div>
    ${d.advarsler.length ? `<p class="meta">${d.advarsler.slice(0, 5).map(esc).join('<br>')}
      ${d.advarsler.length > 5 ? `<br>…and ${d.advarsler.length - 5} more.` : ''}</p>` : ''}
    <p class="meta">Tasks are matched by name inside the project — a row that matches an
      existing task lands on it instead of creating a second one.</p>`;
  document.getElementById('tgFod').innerHTML = `
    <button class="btn primary" id="tgGo">Import ${d.poster.length} entries</button>
    <button class="btn" id="tgClose2">Cancel</button>`;
  document.getElementById('tgClose2').addEventListener('click', () => document.getElementById('togglModal').remove());
  document.getElementById('tgGo').addEventListener('click', togglImporter);
}

async function togglImporter() {
  const fod = document.getElementById('tgFod');
  fod.innerHTML = '<p class="meta" id="tgFremdrift">Importing…</p>';
  try {
    // 1. Projekterne, én gang.
    const projektId = new Map(state.projects.map((p) => [p.name.toLowerCase(), p.id]));
    for (const navn of [...new Set(togglState.poster.map((p) => p.project).filter(Boolean))]) {
      if (projektId.has(navn.toLowerCase())) continue;
      const p = await api('POST', '/api/v1/items', { kind: 'project', name: navn, sections: [] });
      projektId.set(navn.toLowerCase(), p.item.id);
    }

    // 2. Opgaverne. Navn + projekt er noeglen, saa den samme opgave ikke
    //    bliver oprettet én gang pr. tidspost.
    const alle = (await api('GET', '/api/v1/items?kind=task')).items;
    const opgaveId = new Map(alle.map((t) => [`${t.projectId || ''}|${t.title.toLowerCase()}`, t.id]));
    const skalOprettes = [];
    for (const post of togglState.poster) {
      const pid = post.project ? projektId.get(post.project.toLowerCase()) : null;
      const noegle = `${pid || ''}|${post.title.toLowerCase()}`;
      if (opgaveId.has(noegle) || skalOprettes.some((x) => x.noegle === noegle)) continue;
      skalOprettes.push({ noegle, kind: 'task', title: post.title, projectId: pid, status: 'open' });
    }
    for (let i = 0; i < skalOprettes.length; i += 25) {
      const parti = skalOprettes.slice(i, i + 25).map(({ noegle, ...rest }) => rest);
      const svar = await api('POST', '/api/v1/items/bulk', { items: parti });
      svar.items.forEach((t, j) => opgaveId.set(skalOprettes[i + j].noegle, t.id));
      const f = document.getElementById('tgFremdrift');
      if (f) f.textContent = `Creating tasks… ${Math.min(i + 25, skalOprettes.length)} of ${skalOprettes.length}`;
    }

    // 3. Tidsposterne, én ad gangen - de har hver sit tidsrum.
    let n = 0;
    for (const post of togglState.poster) {
      const pid = post.project ? projektId.get(post.project.toLowerCase()) : null;
      const id = opgaveId.get(`${pid || ''}|${post.title.toLowerCase()}`);
      const startedAt = tovoBeregn.tidspunkt(post.date, post.start);
      const minutter = post.minutter
        || (Number(post.slut.slice(0, 2)) * 60 + Number(post.slut.slice(3))
          - (Number(post.start.slice(0, 2)) * 60 + Number(post.start.slice(3))));
      await api('POST', '/api/v1/entries', {
        taskId: id, startedAt, stoppedAt: startedAt + Math.max(1, minutter) * 60, source: 'import',
      });
      n += 1;
      if (n % 10 === 0) {
        const f = document.getElementById('tgFremdrift');
        if (f) f.textContent = `Importing entries… ${n} of ${togglState.poster.length}`;
      }
    }

    document.getElementById('togglModal').remove();
    await genindlaes();
    toast(`Imported ${n} entries from Toggl.`);
  } catch (ex) {
    fod.innerHTML = `<p class="gate-error">${esc(ex.message)}</p>`;
  }
}

/* ------------------------------------------------- genvejsoversigten */

const GENVEJE = [
  ['⌘K / Ctrl+K', 'Open the search field from anywhere'],
  ['Just type', 'Starts writing in the search field'],
  ['+ text', 'Create a task — @project #tag :case !date ~estimate'],
  ['%', 'Anywhere in the line: create it and start the timer at once'],
  ['Enter', 'Create, or open the selected row'],
  ['⌘↵', 'Start the timer on the selected task'],
  ['↑ ↓', 'Move into the list and around in it'],
  ['Space', 'Complete the task the cursor is on'],
  ['Esc', 'Leave the list, or close what is open'],
  ['⌘⇧M', 'Log time by hand'],
];

function visGenveje() {
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `<div class="modal-card" role="dialog" aria-label="Keyboard shortcuts">
      <h2>Keyboard shortcuts</h2>
      <table class="data genvejstabel">
        ${GENVEJE.map(([t, b]) => `<tr><td><kbd>${esc(t)}</kbd></td><td>${esc(b)}</td></tr>`).join('')}
      </table>
      <p class="meta">Letters never move the cursor into a list — you must be able to type a
        task that begins with any letter.</p>
      <div class="modal-foot"><button class="btn primary" id="gvClose">Close</button></div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  document.getElementById('gvClose').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });
}
