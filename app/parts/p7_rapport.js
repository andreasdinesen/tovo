'use strict';
/* tovo - ugerapporten.
 *
 * Formaalet er AFSTEMNING mod et andet system og et overblik til en kunde,
 * der spoerger. Rapporten skal derfor vaere til at LAESE og KOPIERE - ikke at
 * integrere med. Derfor markdown og print, og ingen eksportformater.
 *
 * Alle tal kommer fra beregn.js, saa MCP'ens week_report (fase 8) svarer
 * noejagtig det samme.
 */

const rapportState = { fra: null, til: null, data: null };

function ugeMandag(iso) {
  const [aa, mm, dd] = iso.split('-').map(Number);
  const d = new Date(aa, mm - 1, dd);
  const ugedag = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - (ugedag - 1));
  return isoDato(d);
}

function flytUger(iso, n) {
  const [aa, mm, dd] = iso.split('-').map(Number);
  return isoDato(new Date(aa, mm - 1, dd + n * 7));
}

async function tegnRapport() {
  const host = document.getElementById('pageHost');
  if (!rapportState.fra) {
    rapportState.fra = ugeMandag(state.today);
    rapportState.til = flytUger(rapportState.fra, 1);
    const [aa, mm, dd] = rapportState.til.split('-').map(Number);
    rapportState.til = isoDato(new Date(aa, mm - 1, dd - 1));
  }

  host.innerHTML = '<div class="page"><h1>Report</h1><p class="lead skeleton">Adding it up…</p></div>';
  let d;
  try {
    d = await api('GET', `/api/v1/report?from=${rapportState.fra}&to=${rapportState.til}`);
  } catch (ex) { toast(ex.message); return; }
  rapportState.data = d;

  const f = tovoBeregn.formatVarighed;
  const r = d.report;
  const ts = d.timesheet;
  const forrige = d.previous;
  const dagsnavn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const forskel = (a, b) => {
    if (!b) return '';
    const diff = a - b;
    if (!diff) return ' · same as the period before';
    return ` · ${diff > 0 ? '+' : '−'}${f(Math.abs(diff))} vs. the period before`;
  };

  host.innerHTML = `<div class="page">
    <div class="row" style="justify-content:space-between;align-items:baseline">
      <h1>Report</h1>
      <span class="row" style="gap:8px">
        <button class="btn" id="rMarkdown">Copy as markdown</button>
        <button class="btn" id="rPrint">Print / PDF</button>
      </span>
    </div>

    <div class="row" style="margin-bottom:18px">
      <button class="btn" id="rForrige">← Previous</button>
      <button class="btn" id="rDenne">This week</button>
      <button class="btn" id="rNaeste">Next →</button>
      <label class="field" style="margin:0"><input class="input" type="date" id="rFra" value="${esc(d.from)}"></label>
      <label class="field" style="margin:0"><input class="input" type="date" id="rTil" value="${esc(d.to)}"></label>
    </div>

    <div class="card">
      <div class="row">
        <div style="flex:1"><div class="meta">Total</div><div class="bigtal">${esc(f(r.total))}</div></div>
        <div style="flex:1"><div class="meta">On projects</div><div class="bigtal">${esc(f(r.onProjects))}</div></div>
        <div style="flex:1"><div class="meta">Ad hoc</div><div class="bigtal">${esc(f(r.adhoc))}</div></div>
        <div style="flex:1"><div class="meta">Completed</div><div class="bigtal">${r.completed}</div></div>
      </div>
      <p class="meta">${r.norm ? `Against ${esc(f(r.norm))} normal hours: ${r.overNorm >= 0 ? '+' : '−'}${esc(f(Math.abs(r.overNorm)))}` : 'No normal week set'}${esc(forskel(r.total, forrige.total))}</p>
      ${d.rounding ? `<p class="meta">Rounded to ${d.rounding} minutes for display — the stored times are exact.</p>` : ''}
    </div>

    <h2 class="group">Days</h2>
    <div class="dagsliste">
      ${r.days.map((dag) => `<div class="dag${dag.tynd ? ' tynd' : ''}${dag.tom ? ' tom' : ''}">
        <div class="meta">${dagsnavn[dag.weekday]} ${esc(dag.date.slice(8))}</div>
        <div class="dagsum">${esc(f(dag.minutter))}</div>
        <div class="dagbar" style="height:${Math.min(100, Math.round((dag.minutter / Math.max(60, ...r.days.map((x) => x.minutter))) * 100))}%"></div>
      </div>`).join('')}
    </div>
    ${r.days.some((x) => x.tynd || x.tom) ? `<p class="meta warnline">${
    r.days.filter((x) => x.tynd || x.tom).map((x) => dagsnavn[x.weekday]).join(', ')
  } look thin — that is usually forgotten registration, not a quiet day.</p>` : ''}

    ${r.cases.length ? `<h2 class="group">Per case number<span class="group-count">${r.cases.length}</span></h2>
      <table class="data rapporttabel">
        <tr><th>Case</th><th class="num">Hours</th><th>Tasks</th></tr>
        ${r.cases.map((c) => `<tr>
          <td>${c.case === '(no case number)' ? '<span class="meta">(no case number)</span>' : sagHtml(c.case)}</td>
          <td class="num">${esc(f(c.minutter))}</td>
          <td class="meta">${esc(c.tasks.map((t) => t.title).join(', ').slice(0, 90))}</td>
        </tr>`).join('')}
      </table>
      <p class="meta">This is the list to reconcile against — the hours you register elsewhere,
        per case number.</p>` : ''}

    ${ts.rows.length ? `<h2 class="group">Per day, per task<span class="group-count">${ts.rows.length}</span></h2>
      <div class="tabelrul">
      <table class="data rapporttabel timeseddel">
        <tr><th>Case</th><th>Task</th>
          ${ts.dage.map((iso) => {
    const d = new Date(`${iso}T12:00:00`);
    return `<th class="num">${dagsnavn[d.getDay()]}<span class="meta">${iso.slice(8)}</span></th>`;
  }).join('')}
          <th class="num">Total</th></tr>
        ${ts.rows.map((raekke) => `<tr>
          <td>${raekke.case ? sagHtml(raekke.case) : '<span class="meta">—</span>'}</td>
          <td>${esc(raekke.title)}${raekke.project ? `<span class="meta"> · ${esc(raekke.project)}</span>` : ''}</td>
          ${ts.dage.map((iso) => `<td class="num">${raekke.dage[iso] ? esc(f(raekke.dage[iso])) : ''}</td>`).join('')}
          <td class="num"><strong>${esc(f(raekke.total))}</strong></td>
        </tr>`).join('')}
        <tr><td colspan="2"><strong>Total</strong></td>
          ${ts.dage.map((iso) => `<td class="num"><strong>${ts.perDay[iso] ? esc(f(ts.perDay[iso])) : ''}</strong></td>`).join('')}
          <td class="num"><strong>${esc(f(ts.total))}</strong></td></tr>
      </table>
      </div>` : ''}

    ${r.projects.length ? r.projects.map((p) => `
      <h2 class="group">${esc(p.name)}<span class="group-count">${esc(f(p.minutter))}</span></h2>
      <table class="data rapporttabel">
        <tr><th>Task</th><th class="num">Estimated</th><th class="num">Spent</th><th>Status</th></tr>
        ${p.tasks.map((t) => `<tr>
          <td>${esc(t.title)}</td>
          <td class="num">${t.estimateMinutes ? esc(f(t.estimateMinutes)) : '—'}</td>
          <td class="num">${esc(f(t.minutter))}</td>
          <td>${t.completedIPerioden ? 'Completed' : 'Still open'}</td>
        </tr>`).join('')}
      </table>`).join('')
    : '<div class="empty"><p class="empty-title">Nothing registered in this period</p>'
      + '<p>Start a timer, or log the hours by hand.</p></div>'}
  </div>`;

  document.getElementById('rForrige').addEventListener('click', () => skiftPeriode(-1));
  document.getElementById('rNaeste').addEventListener('click', () => skiftPeriode(1));
  document.getElementById('rDenne').addEventListener('click', () => {
    rapportState.fra = null;
    tegnRapport();
  });
  for (const id of ['rFra', 'rTil']) {
    document.getElementById(id).addEventListener('change', () => {
      rapportState.fra = document.getElementById('rFra').value;
      rapportState.til = document.getElementById('rTil').value;
      tegnRapport();
    });
  }
  document.getElementById('rMarkdown').addEventListener('click', async () => {
    const md = rapportMarkdown(d);
    const ok = await kopier(md);
    toast(ok ? 'Report copied as markdown — paste it into OneNote.' : 'Could not reach the clipboard.');
  });
  document.getElementById('rPrint').addEventListener('click', () => {
    printArk(rapportArkHtml(d), `tovo-report-${d.from}`);
  });
}

function skiftPeriode(n) {
  rapportState.fra = flytUger(rapportState.fra, n);
  rapportState.til = flytUger(rapportState.til, n);
  tegnRapport();
}

/**
 * Markdown til OneNote. Én knap, og formatet er det, man kan LAESE - ikke
 * det, en maskine skal parse.
 */
function rapportMarkdown(d) {
  const f = tovoBeregn.formatVarighed;
  const r = d.report;
  const linjer = [`# ${d.from} – ${d.to}`, ''];
  linjer.push(`**${f(r.total)}** in total · ${f(r.onProjects)} on projects · ${f(r.adhoc)} ad hoc`);
  if (r.norm) linjer.push(`Against ${f(r.norm)} normal hours: ${r.overNorm >= 0 ? '+' : '−'}${f(Math.abs(r.overNorm))}`);
  linjer.push('');
  if (r.cases.length) {
    linjer.push('## Per case number', '');
    for (const c of r.cases) linjer.push(`- **${c.case}**: ${f(c.minutter)}`);
    linjer.push('');
  }
  const ts = d.timesheet;
  if (ts && ts.rows.length) {
    // En markdown-tabel: den kan klistres i OneNote og laeses som den er.
    linjer.push('## Per day, per task', '');
    linjer.push(`| Case | Task | ${ts.dage.map((iso) => iso.slice(5)).join(' | ')} | Total |`);
    linjer.push(`|---|---|${ts.dage.map(() => '--:').join('|')}|--:|`);
    for (const raekke of ts.rows) {
      linjer.push(`| ${raekke.case || '—'} | ${raekke.title} | `
        + `${ts.dage.map((iso) => (raekke.dage[iso] ? f(raekke.dage[iso]) : '')).join(' | ')} | ${f(raekke.total)} |`);
    }
    linjer.push(`| **Total** |  | ${ts.dage.map((iso) => (ts.perDay[iso] ? f(ts.perDay[iso]) : '')).join(' | ')} | **${f(ts.total)}** |`);
    linjer.push('');
  }
  for (const p of r.projects) {
    linjer.push(`## ${p.name} — ${f(p.minutter)}`);
    for (const t of p.tasks) {
      const est = t.estimateMinutes ? ` (est. ${f(t.estimateMinutes)})` : '';
      linjer.push(`- ${t.title}: ${f(t.minutter)}${est}${t.completedIPerioden ? ' ✓ completed' : ''}`);
    }
    linjer.push('');
  }
  return linjer.join('\n');
}

/** Samme tal, samme raekkefoelge - bare til papir. */
function rapportArkHtml(d) {
  const f = tovoBeregn.formatVarighed;
  const r = d.report;
  return `
    <h1>${esc(d.from)} – ${esc(d.to)}</h1>
    <p class="pkunde">${esc(f(r.total))} in total · ${esc(f(r.onProjects))} on projects
      · ${esc(f(r.adhoc))} ad hoc${r.norm ? ` · norm ${esc(f(r.norm))}` : ''}</p>
    ${d.timesheet && d.timesheet.rows.length ? `<table>
        <thead><tr><th>Case</th><th>Task</th>
          ${d.timesheet.dage.map((iso) => `<th class="num">${esc(iso.slice(5))}</th>`).join('')}
          <th class="num">Total</th></tr></thead>
        <tbody>${d.timesheet.rows.map((raekke) => `<tr>
          <td>${esc(raekke.case || '—')}</td><td>${esc(raekke.title)}</td>
          ${d.timesheet.dage.map((iso) => `<td class="num">${raekke.dage[iso] ? esc(f(raekke.dage[iso])) : ''}</td>`).join('')}
          <td class="num">${esc(f(raekke.total))}</td></tr>`).join('')}</tbody>
      </table>` : ''}
    ${r.projects.map((p) => `
      <table>
        <thead><tr><th>${esc(p.name)}</th><th class="num">Estimated</th><th class="num">Spent</th></tr></thead>
        <tbody>${p.tasks.map((t) => `<tr>
          <td>${esc(t.title)}${t.completedIPerioden ? ' ✓' : ''}</td>
          <td class="num">${t.estimateMinutes ? esc(f(t.estimateMinutes)) : '—'}</td>
          <td class="num">${esc(f(t.minutter))}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td><strong>Total</strong></td><td></td>
          <td class="num"><strong>${esc(f(p.minutter))}</strong></td></tr></tfoot>
      </table>`).join('')}
    <p class="pdate">${esc(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>`;
}
