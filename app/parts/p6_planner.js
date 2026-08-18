'use strict';
/* tovo - import fra Microsoft Planner.
 *
 * En .xlsx er et ZIP-arkiv med XML. Der er ingen SheetJS og ingen anden
 * pakke: ~120 linjers egen zip-laeser (central directory -> lokal header ->
 * datastart) og DecompressionStream til hver entry, praecis som Kokkeris
 * Paprika-import (§6c). XML'en laeses med DOMParser - browseren har allerede
 * en, og en hjemmelavet XML-parser er en fejlkilde uden gevinst.
 *
 * ALT hvad der kan goere skade - arkvalg, kolonnegenkendelse, mapning og
 * fletningens hvidliste - ligger i app/shared/planner.js, hvor det kan
 * testes uden en browser. Denne fil laeser kun filen og tegner ruden.
 */

/* ------------------------------------------------------------- zip */

/**
 * Laeser et zip-arkiv til en Map(navn -> Uint8Array).
 *
 * Central directory findes bagfra (End of Central Directory), fordi den er
 * det eneste sted, hvor filnavnene staar samlet. Den lokale header skal
 * stadig laeses for hver entry: dens navne- og extra-laengde er IKKE
 * noedvendigvis den samme som i directory'et, og datastarten ligger efter dem.
 */
async function laesZip(buffer) {
  const b = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 65558; i--) {
    if (b.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That file is not a .xlsx (no zip directory found).');

  const antal = b.getUint16(eocd + 10, true);
  let p = b.getUint32(eocd + 16, true);
  const filer = new Map();
  const tekst = new TextDecoder();

  for (let i = 0; i < antal; i++) {
    if (b.getUint32(p, true) !== 0x02014b50) break;
    const metode = b.getUint16(p + 10, true);
    const komprimeret = b.getUint32(p + 20, true);
    const navnLaengde = b.getUint16(p + 28, true);
    const ekstraLaengde = b.getUint16(p + 30, true);
    const kommentarLaengde = b.getUint16(p + 32, true);
    const lokal = b.getUint32(p + 42, true);
    const navn = tekst.decode(bytes.subarray(p + 46, p + 46 + navnLaengde));

    const lokalNavn = b.getUint16(lokal + 26, true);
    const lokalEkstra = b.getUint16(lokal + 28, true);
    const start = lokal + 30 + lokalNavn + lokalEkstra;
    const raa = bytes.subarray(start, start + komprimeret);

    if (metode === 0) filer.set(navn, raa);
    else if (metode === 8) filer.set(navn, new Uint8Array(await udpak(raa)));
    // Andre metoder findes ikke i en Planner-eksport; springes over frem for
    // at faelde hele importen.

    p += 46 + navnLaengde + ekstraLaengde + kommentarLaengde;
  }
  return filer;
}

async function udpak(raa) {
  const strøm = new Blob([raa]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(strøm).arrayBuffer();
}

/* ------------------------------------------------------------- xlsx */

const XML = (tekst) => new DOMParser().parseFromString(tekst, 'application/xml');

/** "C5" -> 2. Kolonnebogstaverne er base-26 uden nul. */
function kolonneIndeks(ref) {
  const m = String(ref || '').match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const c of m[1]) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * .xlsx -> {arknavn: [[celle, ...], ...]}
 *
 * Den rigtige eksport har INGEN sharedStrings og bruger t="str" med teksten
 * direkte i <v>. `t="s"` (indeks i sharedStrings) og `inlineStr` haandteres
 * ogsaa, saa en aendring hos Microsoft ikke braekker importen.
 */
async function laesXlsx(buffer) {
  const filer = await laesZip(buffer);
  const tekst = new TextDecoder();
  const laes = (navn) => (filer.has(navn) ? tekst.decode(filer.get(navn)) : null);

  const wb = laes('xl/workbook.xml');
  if (!wb) throw new Error('That file is not an Excel workbook.');
  const rels = laes('xl/_rels/workbook.xml.rels');

  // Arkets fil findes gennem r:id i rels - IKKE ved at gaette "sheet1.xml"
  // ud fra raekkefoelgen. De to falder ikke altid sammen.
  const stier = new Map();
  if (rels) {
    for (const r of XML(rels).getElementsByTagName('Relationship')) {
      stier.set(r.getAttribute('Id'), r.getAttribute('Target'));
    }
  }

  const delte = [];
  const ss = laes('xl/sharedStrings.xml');
  if (ss) {
    for (const si of XML(ss).getElementsByTagName('si')) {
      delte.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
    }
  }

  const ark = {};
  const doc = XML(wb);
  let n = 0;
  for (const sh of doc.getElementsByTagName('sheet')) {
    n += 1;
    const navn = sh.getAttribute('name');
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let sti = stier.get(rid) || `worksheets/sheet${n}.xml`;
    sti = sti.replace(/^\/?xl\//, '');
    const xml = laes(`xl/${sti}`);
    if (!xml) continue;

    const raekker = [];
    for (const row of XML(xml).getElementsByTagName('row')) {
      const celler = [];
      for (const c of row.getElementsByTagName('c')) {
        const i = kolonneIndeks(c.getAttribute('r'));
        const t = c.getAttribute('t');
        let vaerdi = '';
        if (t === 'inlineStr') {
          vaerdi = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
        } else {
          const v = c.getElementsByTagName('v')[0];
          vaerdi = v ? v.textContent : '';
          if (t === 's') vaerdi = delte[Number(vaerdi)] || '';
        }
        celler[i] = vaerdi;
      }
      for (let j = 0; j < celler.length; j++) if (celler[j] === undefined) celler[j] = '';
      raekker.push(celler);
    }
    ark[navn] = raekker;
  }
  return ark;
}

/* ------------------------------------------------------------ ruden */

const importState = { data: null, projekt: null, valg: null };

function aabnPlannerImport(projektId) {
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'plannerModal';
  host.innerHTML = `<div class="modal-card" role="dialog" aria-label="Import from Planner">
      <h2>Import from Planner</h2>
      <p class="meta">In Planner: <strong>… → Export plan to Excel</strong>. Then pick the file here.
        Re-importing later updates the tasks — it never touches your estimates or logged time.</p>
      <label class="field"><span>Excel file from Planner</span>
        <input class="input" type="file" id="plFil" accept=".xlsx"></label>
      <div id="plKrop"></div>
      <div class="modal-foot" id="plFod">
        <button class="btn" id="plClose">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  importState.projekt = projektId || null;

  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  document.getElementById('plClose').addEventListener('click', luk);
  document.getElementById('plFil').addEventListener('change', (e) => {
    const fil = e.target.files && e.target.files[0];
    if (fil) forhaandsvis(fil);
  });
}

async function forhaandsvis(fil) {
  const krop = document.getElementById('plKrop');
  krop.innerHTML = '<p class="meta">Reading the file…</p>';
  let eksport;
  try {
    eksport = tovoPlanner.laesEksport(await laesXlsx(await fil.arrayBuffer()));
  } catch (ex) {
    krop.innerHTML = `<p class="gate-error">${esc(ex.message)}</p>`;
    return;
  }

  // Ét projekt pr. plan. Findes planen allerede, er det en GENIMPORT - og
  // saa skal den ramme det samme projekt, ikke lave et nyt ved siden af.
  const projekt = state.projects.find((p) => (eksport.plan.id && p.plannerPlanId === eksport.plan.id))
    || (importState.projekt ? state.projects.find((p) => p.id === importState.projekt) : null);

  let findes = [];
  if (projekt) {
    const d = await api('GET', `/api/v1/projects/${projekt.id}`);
    findes = d.tasks;
  }
  const sam = tovoPlanner.sammenlign(eksport.tasks, findes, { sections: projekt ? (projekt.sections || []) : [] });
  const noter = tovoPlanner.noterLignerEstimater(eksport.tasks);
  importState.data = { eksport, sam, projekt, noter, findes };

  krop.innerHTML = `
    <div class="card">
      <h2>${esc(eksport.plan.name || fil.name)}</h2>
      <div class="meta">${projekt ? `Re-import into “${esc(projekt.name)}”` : 'This will create a new project'}
        ${eksport.plan.exportedAt ? ` · exported ${esc(eksport.plan.exportedAt)}` : ''}</div>
      <ul class="plain">
        <li><span class="post-sum">${sam.nye.length}</span><span class="post-main">new tasks</span></li>
        <li><span class="post-sum">${sam.opdaterede.length}</span><span class="post-main">to update</span></li>
        <li><span class="post-sum">${sam.forsvundne.length}</span><span class="post-main">gone from Planner</span></li>
      </ul>
    </div>

    ${noter.ligner ? `<label class="check"><input type="checkbox" id="plEstimat" checked>
      <span>The “Noter” column looks like hours (${noter.antal} of ${noter.af} rows are a plain
      number) — set them as estimates on new tasks</span></label>` : ''}

    ${sam.forsvundne.length ? `<label class="field"><span>Tasks that are gone from Planner</span>
      <select class="input" id="plForsvundne">
        <option value="ask">Leave them alone (decide later)</option>
        <option value="archive">Mark them done</option>
        <option value="ignore">Ignore them</option>
      </select></label>` : ''}

    ${eksport.warnings.length ? `<p class="meta">${eksport.warnings.map(esc).join('<br>')}</p>` : ''}
    <p class="meta">Estimates, logged time, comments, links and the budget are never touched by an import.</p>`;

  document.getElementById('plFod').innerHTML = `
    <button class="btn primary" id="plGo">${projekt ? 'Update' : 'Import'} ${eksport.tasks.length} tasks</button>
    <button class="btn" id="plClose2">Cancel</button>`;
  document.getElementById('plClose2').addEventListener('click', () => document.getElementById('plannerModal').remove());
  document.getElementById('plGo').addEventListener('click', udfoerImport);
}

async function udfoerImport() {
  const { eksport, sam, projekt, noter } = importState.data;
  const brugNoter = noter.ligner && document.getElementById('plEstimat')
    && document.getElementById('plEstimat').checked;
  const forsvundne = document.getElementById('plForsvundne')
    ? document.getElementById('plForsvundne').value : 'ask';
  const fod = document.getElementById('plFod');
  fod.innerHTML = '<p class="meta" id="plFremdrift">Saving…</p>';

  try {
    // 1. Projektet. Sektionerne foelger med, saa opgaverne har noget at
    //    pege paa, naar de gemmes.
    const projektFelter = {
      kind: 'project',
      name: eksport.plan.name || 'Imported plan',
      plannerPlanId: eksport.plan.id,
      plannerPlanName: eksport.plan.name,
      lastImportAt: Math.floor(Date.now() / 1000),
      sections: sam.sektioner.map((s, i) => ({ id: s.id, name: s.name, position: i })),
    };
    const p = projekt
      ? (await api('PATCH', `/api/v1/items/${projekt.id}`, projektFelter)).item
      : (await api('POST', '/api/v1/items', projektFelter)).item;

    // 2. Opgaverne i portioner à 25 med fremdrift. Bulk-endepunktet gaar
    //    gennem den samme gemItem med den samme vagt mod delvise objekter.
    const alle = [];
    for (const n of sam.nye) {
      alle.push(tovoPlanner.flet(n.planner, n.felter, null, {
        noterSomEstimat: brugNoter,
        estimatMinutter: brugNoter ? tovoBeregn.parseVarighed(n.planner.note) : null,
      }));
    }
    for (const o of sam.opdaterede) alle.push(tovoPlanner.flet(o.planner, o.felter, o.task));
    if (forsvundne === 'archive') {
      for (const t of sam.forsvundne) {
        if (t.status !== 'done') alle.push(Object.assign({}, t, { status: 'done', completedAt: Math.floor(Date.now() / 1000) }));
      }
    }
    for (const t of alle) t.projectId = p.id;

    let gemt = 0;
    for (let i = 0; i < alle.length; i += 25) {
      await api('POST', '/api/v1/items/bulk', { items: alle.slice(i, i + 25) });
      gemt += Math.min(25, alle.length - i);
      const f = document.getElementById('plFremdrift');
      if (f) f.textContent = `Saving… ${gemt} of ${alle.length}`;
    }

    document.getElementById('plannerModal').remove();
    await genindlaes();
    gaaTil('projects', { project: p.id });
    toast(`${sam.nye.length} new, ${sam.opdaterede.length} updated.`);
  } catch (ex) {
    fod.innerHTML = `<p class="gate-error">${esc(ex.message)}</p>`;
  }
}
