'use strict';
/* tovo - kundevisning og print.
 *
 * Den rene udgave af projektsiden: hvad der blev aftalt, hvad der er lavet,
 * og hvad der staar tilbage. Uden interne noter og uden kilde-maerkning -
 * det er tovos eget bogholderi, ikke kundens aerinde.
 *
 * Ingen udregninger her. Tallene kommer fra serverens rollup, som kommer fra
 * beregn.js. Kunden og ugerapporten skal svare det samme.
 */

/**
 * Bygger arket. Bruges BAADE til visningen paa skaermen og til print - ellers
 * ville de to kunne komme til at vise forskellige tal, og det er hele
 * pointen, at de ikke kan (Beanledger v16-v18).
 */
function kundeArkHtml(p, opgaver, rollup, forbrug) {
  const f = tovoBeregn.formatVarighed;
  const idag = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const raekker = opgaver
    .slice()
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((t) => `<tr>
      <td>${esc(t.title)}</td>
      <td>${t.status === 'done' ? 'Done' : 'In progress'}</td>
      <td class="num">${t.estimateMinutes ? esc(f(t.estimateMinutes)) : '—'}</td>
      <td class="num">${esc(f(forbrug[t.id] || 0))}</td>
    </tr>`).join('');

  return `
    <h1>${esc(p.name)}</h1>
    <p class="pkunde">${esc(p.customer || '')}</p>
    <table>
      <thead><tr><th>Task</th><th>Status</th><th class="num">Estimated</th><th class="num">Spent</th></tr></thead>
      <tbody>${raekker}</tbody>
      <tfoot><tr>
        <td><strong>Total</strong></td><td></td>
        <td class="num"><strong>${esc(f(rollup.estimat))}</strong></td>
        <td class="num"><strong>${esc(f(rollup.forbrugt))}</strong></td>
      </tr></tfoot>
    </table>
    ${rollup.ramme ? `<table class="pramme">
      <tr><td>Agreed budget</td><td class="num">${esc(f(rollup.ramme))}</td></tr>
      <tr><td>Spent</td><td class="num">${esc(f(rollup.forbrugt))}</td></tr>
      <tr><td><strong>Remaining</strong></td>
        <td class="num"><strong>${esc(f(Math.max(0, rollup.resterende)))}</strong></td></tr>
    </table>` : ''}
    <p class="pdate">${esc(idag)}</p>`;
}

/** Kundevisningen paa skaermen. Samme ark, samme tal - bare i en rude. */
async function visKundevisning(projektId) {
  let d;
  try {
    d = await api('GET', `/api/v1/projects/${projektId}`);
  } catch (ex) { toast(ex.message); return; }

  const ark = kundeArkHtml(d.project, d.tasks, d.rollup, d.spent);
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `<div class="modal-card kundekort" role="dialog" aria-label="Customer view">
      <div class="kundeark">${ark}</div>
      <div class="modal-foot">
        <button class="btn primary" id="kExcel">Excel</button>
        <button class="btn" id="kPrint">Print / save as PDF</button>
        <button class="btn" id="kClose">Close</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });
  document.getElementById('kClose').addEventListener('click', luk);
  document.getElementById('kPrint').addEventListener('click', () => {
    printArk(ark, `tovo-${d.project.name}-${state.today}`);
  });
  document.getElementById('kExcel').addEventListener('click', () => {
    const t = (m) => excelTimer(m);
    hentExcel([{
      navn: d.project.name,
      rows: [
        [d.project.name, d.project.customer || '', d.project.caseNumber || ''],
        [],
        ['Task', 'Status', 'Estimated (hours)', 'Spent (hours)'],
        ...d.tasks.slice().sort((a, b) => (a.position || 0) - (b.position || 0))
          .map((x) => [x.title, x.status === 'done' ? 'Done' : 'In progress',
            t(x.estimateMinutes), t(d.spent[x.id] || 0)]),
        ['Total', '', t(d.rollup.estimat), t(d.rollup.forbrugt)],
        ...(d.rollup.ramme ? [[], ['Agreed budget (hours)', '', t(d.rollup.ramme), ''],
          ['Remaining (hours)', '', t(Math.max(0, d.rollup.resterende)), '']] : []),
      ],
    }], `tovo-${d.project.name.replace(/[^\w-]+/g, '-')}-${state.today}.xlsx`);
    toast('Excel file downloaded.');
  });
}

/**
 * Print.
 *
 * Arket laegges i #printHost, som ligger i <body> og kun vises i @media
 * print. Titlen bliver browserens forslag til filnavn ved "Gem som PDF" og
 * gendannes paa afterprint.
 *
 * NB til den, der tester: `afterprint` fyrer ALDRIG, naar window.print er
 * stubbet - saa skal titlen saettes tilbage i haanden (Muldbog).
 */
function printArk(html, filnavn) {
  let host = document.getElementById('printHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'printHost';
    host.className = 'printsheet';
    document.body.appendChild(host);
  }
  host.innerHTML = html;
  const gammelTitel = document.title;
  document.title = filnavn;
  const gendan = () => {
    document.title = gammelTitel;
    window.removeEventListener('afterprint', gendan);
  };
  window.addEventListener('afterprint', gendan);
  setTimeout(() => window.print(), 60);
}
