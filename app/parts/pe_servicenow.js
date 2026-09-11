/* Import fra ServiceNow.
 *
 * Filen laeses HER (FileReader), men alt, der kan goere skade - mapning,
 * dublettjek og fletning - ligger i app/shared/servicenow.js, hvor det kan
 * proeves uden en browser.
 *
 * CSV og ikke JSON: ServiceNows JSON-eksport har flere felter, men gemmer
 * referencer som sys_id, saa `company` er en GUID. Listevisningens CSV har dem
 * allerede oploest til navne. Se modulets hoved.
 */

const snState = { data: null };

function aabnServiceNowImport() {
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'snModal';
  host.innerHTML = `<div class="modal-card" role="dialog" aria-label="Import from ServiceNow">
      <h2>Import from ServiceNow</h2>
      <p class="meta">In ServiceNow: open your task list, then
        <strong>right-click the header → Export → CSV</strong>. Pick the file here.</p>
      <p class="meta">The customer becomes a project and the subcategory a tag. Re-importing
        later updates the tasks — it never touches your estimates, logged time or comments.</p>
      <label class="field"><span>CSV file from ServiceNow</span>
        <input class="input" type="file" id="snFil" accept=".csv,text/csv"></label>
      <div id="snKrop"></div>
      <div class="modal-foot" id="snFod">
        <button class="btn" id="snClose">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  document.getElementById('snClose').addEventListener('click', luk);
  document.getElementById('snFil').addEventListener('change', (e) => {
    const fil = e.target.files && e.target.files[0];
    if (fil) snForhaandsvis(fil);
  });
}

/** Viser hvad importen VILLE goere. Intet gemmes, foer der trykkes. */
async function snForhaandsvis(fil) {
  const krop = document.getElementById('snKrop');
  krop.innerHTML = '<p class="meta">Reading…</p>';
  try {
    const tekst = await fil.text();
    const raekker = tovoToggl.parseCsv(tekst);
    const eksport = tovoServiceNow.laesEksport(raekker);
    if (!eksport.opgaver.length) {
      krop.innerHTML = `<p class="gate-error">${esc(eksport.advarsler[0]
        || 'No rows with a Number in that file.')}</p>`;
      return;
    }

    /* Alle opgaver hentes, ikke kun det aktuelle projekts: en sag kan vaere
       flyttet til en anden kunde i ServiceNow, og saa skal den GENFINDES og
       flyttes - ikke oprettes en gang til. */
    const alle = await api('GET', '/api/v1/items?kind=task');
    const sam = tovoServiceNow.sammenlign(eksport.opgaver, alle.items, {
      projects: state.projects.map((p) => ({ id: p.id, name: p.name })),
      tags: (state.tags || []).map((t) => ({ id: t.id, name: t.name })),
    });
    snState.data = { eksport, sam };

    const linje = (n, etiket) => (n ? `<li><strong>${n}</strong> ${esc(etiket)}</li>` : '');
    krop.innerHTML = `
      <ul class="plain snsum">
        ${linje(sam.nye.length, sam.nye.length === 1 ? 'new task' : 'new tasks')}
        ${linje(sam.opdaterede.length, 'updated')}
        ${linje(sam.uaendrede.length, 'already up to date')}
      </ul>
      ${sam.projekter.length ? `<p class="meta">New projects: ${
    sam.projekter.map((p) => esc(p.name)).join(', ')}</p>` : ''}
      ${sam.tags.length ? `<p class="meta">New tags: ${
    sam.tags.map((t) => esc(t.name)).join(', ')}</p>` : ''}
      ${eksport.advarsler.length ? `<p class="meta warnline">${
    eksport.advarsler.map(esc).join('<br>')}</p>` : ''}
      ${snForsvundneHtml(sam.forsvundne)}`;

    document.getElementById('snFod').innerHTML = `
      <button class="btn" id="snClose2">Cancel</button>
      <span style="flex:1"></span>
      <button class="btn primary" id="snGo">Import</button>`;
    document.getElementById('snClose2').addEventListener('click', () => document.getElementById('snModal').remove());
    document.getElementById('snGo').addEventListener('click', snUdfoer);
  } catch (ex) {
    krop.innerHTML = `<p class="gate-error">${esc(ex.message)}</p>`;
  }
}

/**
 * De sager, tovo har importeret, men som IKKE er i filen.
 *
 * Filteret i ServiceNow er typisk »State != Resolved«, saa en loest sag falder
 * ud af eksporten. Men et filter kan ogsaa vaere aendret, eller eksporten kan
 * vaere en anden udvaelgelse - og saa ville en automatisk afslutning lukke
 * opgaver, der stadig loeber, sammen med den tid, der er registreret paa dem.
 *
 * Derfor er INTET krydset af paa forhaand. Et flueben er et valg, man tager;
 * en standard er et valg, nogen har taget for én.
 */
function snForsvundneHtml(forsvundne) {
  if (!forsvundne.length) return '';
  return `<div class="snmangler">
    <p class="meta"><strong>${forsvundne.length}</strong> imported
      ${forsvundne.length === 1 ? 'task is' : 'tasks are'} not in this file —
      probably resolved in ServiceNow. Tick the ones to close here:</p>
    <ul class="plain">
      ${forsvundne.map((t) => `<li><label class="snvalg">
        <input type="checkbox" data-luk="${esc(t.id)}">
        <span><code>${esc(t.number)}</code> ${esc(t.title)}</span>
      </label></li>`).join('')}
    </ul>
    <p class="meta">Nothing is closed unless you tick it. Your logged time stays either way.</p>
  </div>`;
}

async function snUdfoer() {
  const { sam } = snState.data;
  const luk = [...document.querySelectorAll('[data-luk]:checked')].map((el) => el.dataset.luk);
  const fod = document.getElementById('snFod');
  fod.innerHTML = '<p class="meta" id="snFremdrift">Saving…</p>';

  try {
    /*
     * 1. Projekter og maerkater FOERST - opgaverne peger paa deres id'er.
     *
     * Modulet gav dem midlertidige id'er (`nyt-projekt-0`); her byttes de til
     * rigtige. Uden oversaettelsen ville opgaverne pege paa noget, der ikke
     * findes, og projektfeltet stod tomt.
     */
    const idKort = new Map();
    for (const p of sam.projekter) {
      const ny = (await api('POST', '/api/v1/items', {
        kind: 'project', name: p.name, lastImportAt: Math.floor(Date.now() / 1000),
      })).item;
      idKort.set(p.id, ny.id);
    }
    for (const t of sam.tags) {
      const ny = (await api('POST', '/api/v1/items', { kind: 'tag', name: t.name })).item;
      idKort.set(t.id, ny.id);
    }
    const rigtigt = (id) => (id && idKort.has(id) ? idKort.get(id) : id);

    // 2. Opgaverne.
    /*
     * ALT gaar gennem `flet()` og `luk()`.
     *
     * Bulk-endepunktet gemmer en HEL opgave. Et bart objekt med kun de
     * importerede felter sletter estimat, note, kolonne og links - og det ser
     * rigtigt ud fra begge ender.
     */
    const oversat = (f) => ({
      ...f,
      projectId: rigtigt(f.projectId),
      tagIds: (f.tagIds || []).map(rigtigt),
    });

    const alle = [];
    for (const n of sam.nye) {
      alle.push(tovoServiceNow.flet(oversat(n.felter), null, { number: n.number, note: n.note }));
    }
    for (const o of sam.opdaterede) {
      alle.push(tovoServiceNow.flet(oversat(o.felter), o.task, { number: o.number }));
    }
    const lukkes = new Set(luk);
    for (const t of sam.forsvundne) {
      if (lukkes.has(t.id)) alle.push(tovoServiceNow.luk(t.task));
    }

    let gemt = 0;
    for (let i = 0; i < alle.length; i += 25) {
      await api('POST', '/api/v1/items/bulk', { items: alle.slice(i, i + 25) });
      gemt += Math.min(25, alle.length - i);
      const f = document.getElementById('snFremdrift');
      if (f) f.textContent = `Saving… ${gemt} of ${alle.length}`;
    }

    document.getElementById('snModal').remove();
    await genindlaes();
    const dele = [`${sam.nye.length} new`, `${sam.opdaterede.length} updated`];
    if (luk.length) dele.push(`${luk.length} closed`);
    toast(dele.join(', ') + '.');
  } catch (ex) {
    fod.innerHTML = `<button class="btn" id="snClose3">Close</button>`;
    document.getElementById('snKrop').innerHTML
      += `<p class="gate-error">${esc(ex.message)}</p>`;
    document.getElementById('snClose3').addEventListener('click',
      () => document.getElementById('snModal').remove());
  }
}
