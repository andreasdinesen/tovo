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

/**
 * ⌘ paa Mac, Ctrl+ alle andre steder - samme regel som sagu (modTast).
 * Laeses én gang ved indlaesning; uden `navigator` (tests) bliver det Ctrl+.
 */
function modTast() {
  const nav = (typeof navigator !== 'undefined' && navigator) || {};
  const kilde = String((nav.userAgentData && nav.userAgentData.platform) || nav.platform || '');
  return /mac|iphone|ipad|ipod/i.test(kilde) ? '\u2318' : 'Ctrl+';
}

/*
 * Den faelles genvejsregel for doda, tovo, qlk og sagu (10-10-2026):
 * samme tre grupper i samme raekkefoelge, samme form som dodas GENVEJE -
 * [gruppe, [[tast, tekst], ...]]. Guiden laeser den SAMME konstant.
 *
 * `/` staar her ikke som egen genvej: i tovo er `/` projekt-praefikset,
 * man skriver via »skriv bare«, ikke en vej til soegefeltet.
 */
const GENVEJ_MOD = modTast();
const GENVEJE = [
  ['Anywhere', [
    [`${GENVEJ_MOD}K`, 'Open the search field'],
    ['Just type', 'Starts writing in the search field — unless a row has the cursor'],
    ['?', 'This list'],
    ['Esc', 'Close what is open'],
    [`${GENVEJ_MOD}↵`, 'In a dialog: save and close it'],
    [GENVEJ_MOD === '\u2318' ? '⌘⇧M' : 'Ctrl+Shift+M', 'Log time by hand'],
  ]],
  ['In the search field', [
    ['+ text', 'Create a task — @project #tag :case !date ~estimate'],
    ['%', 'Anywhere in the line: create it and start the timer at once'],
    ['↑ ↓', 'Move between results'],
    ['Enter', 'Create, or open the selected result'],
    [`${GENVEJ_MOD}↵`, 'Start the timer on the selected task'],
    ['Backspace', 'Leave the mode when the field is empty'],
  ]],
  ['In a list', [
    ['↑ ↓', 'Move into the list and around in it'],
    ['j / k', 'Next / previous row'],
    ['Enter', 'Open the task'],
    ['Space', 'Complete the task'],
    [`t / ${GENVEJ_MOD}↵`, 'Start or stop its timer'],
    ['m', 'Move it to another project'],
    ['← →', 'On a board: change column'],
    ['Esc', 'Leave the list — letters go back to the search field'],
  ]],
];

/** Grupperne som tabeller - brugt af oversigten OG af guiden, hver med
    sin egen tabelklasse (ruden: `data genvejstabel`, guiden: `shortcuts`). */
function genvejeHtml(klasse) {
  return GENVEJE.map(([gruppe, liste]) => `
    <div class="meta" style="margin:16px 0 8px">${esc(gruppe)}</div>
    <table class="${klasse}">${liste.map(([t, b]) =>
    `<tr><td><kbd>${esc(t)}</kbd></td><td>${esc(b)}</td></tr>`).join('')}</table>`).join('');
}

function visGenveje() {
  if (document.getElementById('genvejsark')) return;
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'genvejsark';
  host.innerHTML = `<div class="modal-card" role="dialog" aria-label="Keyboard shortcuts">
      <h2>Keyboard shortcuts</h2>
      ${genvejeHtml('data genvejstabel')}
      <p class="meta">Letters never move the cursor into a list — only ↑ ↓ do — so you can always
        type a task that begins with any letter. Once a row has the cursor, its letters belong to
        the row; Esc gives them back to the search field.</p>
      <div class="modal-foot"><button class="btn primary" id="gvClose">Close</button></div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  document.getElementById('gvClose').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });
  document.getElementById('gvClose').focus();
}

/*
 * `?` viser oversigten OVERALT - ogsaa naar en raekke har fokus og ejer
 * bogstaverne. Derfor capture-fasen og stopPropagation: den skal naa frem
 * FOER raekkens egne taster og foer »skriv bare«, der ellers ville sende
 * `?` til soegefeltet (samme greb som doda).
 */
document.addEventListener('keydown', (e) => {
  if (!state.user || e.key !== '?') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
    || el.isContentEditable)) return;
  if (document.querySelector('.modal')) return;
  e.preventDefault();
  e.stopPropagation();
  visGenveje();
}, true);


/* ------------------------------------------------------ excel-download */

/**
 * Henter en .xlsx ned.
 *
 * Blob + object-URL og et <a download>. URL'en frigives bagefter - ellers
 * ligger filen i hukommelsen, saa laenge fanen er aaben.
 */
function hentExcel(ark, filnavn) {
  const data = tovoXlsx.byg(ark);
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filnavn;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Timer som TAL, ikke tekst.
 *
 * Det er hele grunden til at lave en rigtig regnearksfil frem for en CSV:
 * 3,5 skal kunne laegges sammen i Excel, uanset om maskinen staar paa dansk
 * eller engelsk komma. Excel viser det med maskinens eget komma af sig selv.
 */
const excelTimer = (minutter) => (minutter ? Math.round((minutter / 60) * 100) / 100 : null);
