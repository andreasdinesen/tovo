'use strict';
/* tovo - kopiér som rig tekst (RUNE-ERFARINGER §9e).
 *
 * Ugerapporten og kundevisningen skal kunne saettes ind i en MAIL som en
 * rigtig tabel - og i et REGNEARK som celler. Det er to formater paa én
 * gang, og udklipsholderen kan baere begge:
 *
 *   text/html   en tabel med INLINE-stil. Mailprogrammer (Outlook, Gmail)
 *               smider <style> og klasser vaek; kun style="" overlever.
 *               Ingen var(--farve): temaets farver findes ikke i en mail.
 *   text/plain  tabulator-separeret. Et regneark laegger hver vaerdi i sin
 *               egen celle, og et tekstfelt faar noget, der kan laeses.
 *
 * Ingen udregninger her - tallene kommer faerdige fra serveren (beregn.js).
 */

const MAIL_SKRIFT = 'font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222';
const MAIL_CELLE = 'border:1px solid #c8c8c8;padding:4px 8px;vertical-align:top';

/**
 * Én tabel til en mail.
 *
 * `hoved` og raekkerne er TEKST (ikke HTML) - alt escapes her, ét sted.
 * `tal` er de kolonne-indeks, der skal hoejrestilles. `fod` er en fed
 * totalraekke. `cellpadding`/`border` er med for Outlooks Word-motor, der
 * ikke altid laeser padding fra style.
 */
function mailTabelHtml(hoved, raekker, fod, tal) {
  const hoejre = new Set(tal || []);
  const celle = (tag, v, i, ekstra) => `<${tag} style="${MAIL_CELLE};${hoejre.has(i) ? 'text-align:right;' : 'text-align:left;'}${ekstra || ''}">${esc(v === null || v === undefined ? '' : String(v))}</${tag}>`;
  return `<table cellpadding="4" cellspacing="0" border="1" style="border-collapse:collapse;${MAIL_SKRIFT};margin:0 0 14px">
<thead><tr>${hoved.map((v, i) => celle('th', v, i, 'background:#f0f0f0;font-weight:bold')).join('')}</tr></thead>
<tbody>${raekker.map((r) => `<tr>${r.map((v, i) => celle('td', v, i)).join('')}</tr>`).join('\n')}</tbody>
${fod ? `<tfoot><tr>${fod.map((v, i) => celle('td', v, i, 'font-weight:bold;background:#f7f7f7')).join('')}</tr></tfoot>` : ''}
</table>`;
}

/** En raekke til et regneark: tabulator og linjeskift i en vaerdi ville flytte cellerne. */
function tsvLinje(celler) {
  return celler.map((v) => String(v === null || v === undefined ? '' : v).replace(/[\t\r\n]+/g, ' ')).join('\t');
}

function tsvTabel(hoved, raekker, fod) {
  return [hoved, ...raekker, ...(fod ? [fod] : [])].map(tsvLinje).join('\n');
}

function mailOverskrift(tekst, niveau) {
  const str = niveau === 1 ? 'font-size:18px' : 'font-size:15px';
  return `<p style="${MAIL_SKRIFT};${str};font-weight:bold;margin:14px 0 6px">${esc(tekst)}</p>`;
}

function mailAfsnit(tekst) {
  return `<p style="${MAIL_SKRIFT};margin:0 0 10px">${esc(tekst)}</p>`;
}

/**
 * Ugerapporten som {html, tekst}. Samme afsnit og samme raekkefoelge som
 * skaermen og papiret: sagerne pr. dag foerst - det er dem, der skal
 * skrives af - saa opgaverne, saa projekterne.
 */
function rapportRigTekst(d, decimal) {
  const f = decimal ? tovoBeregn.formatDecimal : tovoBeregn.formatVarighed;
  const r = d.report;
  const ts = d.timesheet;
  const html = [];
  const tekst = [];
  const titel = `${d.from} – ${d.to}`;
  const resume = `${f(r.total)} in total · ${f(r.onProjects)} on projects · ${f(r.adhoc)} ad hoc`
    + `${r.norm ? ` · expected ${f(r.norm)}` : ''}`;
  html.push(mailOverskrift(titel, 1), mailAfsnit(resume));
  tekst.push(titel, resume);

  const afsnit = (navn, hoved, raekker, fod, tal) => {
    html.push(mailOverskrift(navn, 2), mailTabelHtml(hoved, raekker, fod, tal));
    tekst.push('', navn, tsvTabel(hoved, raekker, fod));
  };
  const dage = ts ? ts.dage.map((iso) => iso.slice(5)) : [];
  const dagTal = (kort) => ts.dage.map((iso) => (kort[iso] ? f(kort[iso]) : ''));
  const talFra = (start) => dage.map((_, i) => start + i).concat(start + dage.length);

  if (ts && ts.caseRows.length) {
    afsnit('Per case number, per day', ['Case', ...dage, 'Total'],
      ts.caseRows.map((c) => [c.case || '(no case number)', ...dagTal(c.dage), f(c.total)]),
      ['Total', ...dagTal(ts.perDay), f(ts.total)], talFra(1));
  }
  if (ts && ts.rows.length) {
    afsnit('Per day, per task', ['Case', 'Project', 'Task', ...dage, 'Total'],
      ts.rows.map((x) => [x.case || '', x.project || '', x.title, ...dagTal(x.dage), f(x.total)]),
      ['Total', '', '', ...dagTal(ts.perDay), f(ts.total)], talFra(3));
  }
  for (const p of r.projects) {
    afsnit(`${p.name} — ${f(p.minutter)}`, ['Task', 'Estimated', 'Spent', 'Status'],
      p.tasks.map((t) => [t.title, t.estimateMinutes ? f(t.estimateMinutes) : '',
        f(t.minutter), t.completedIPerioden ? 'Completed' : 'Still open']),
      null, [1, 2]);
  }
  return { html: html.join('\n'), tekst: `${tekst.join('\n')}\n` };
}

/** Kundevisningen som {html, tekst} - det samme ark som paa skaermen og i print. */
function kundeRigTekst(p, opgaver, rollup, forbrug) {
  const f = tovoBeregn.formatVarighed;
  const sorteret = opgaver.slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  const hoved = ['Task', 'Status', 'Estimated', 'Spent'];
  const raekker = sorteret.map((t) => [t.title, t.status === 'done' ? 'Done' : 'In progress',
    t.estimateMinutes ? f(t.estimateMinutes) : '—', f(forbrug[t.id] || 0)]);
  const fod = ['Total', '', f(rollup.estimat), f(rollup.forbrugt)];
  const html = [mailOverskrift(p.name, 1)];
  const tekst = [p.name];
  if (p.customer) { html.push(mailAfsnit(p.customer)); tekst.push(p.customer); }
  html.push(mailTabelHtml(hoved, raekker, fod, [2, 3]));
  tekst.push('', tsvTabel(hoved, raekker, fod));
  if (rollup.ramme) {
    const ramme = [['Agreed budget', f(rollup.ramme)], ['Spent', f(rollup.forbrugt)],
      ['Remaining', f(Math.max(0, rollup.resterende))]];
    html.push(mailTabelHtml(['Budget', ''], ramme, null, [1]));
    tekst.push('', tsvTabel(['Budget', ''], ramme));
  }
  return { html: html.join('\n'), tekst: `${tekst.join('\n')}\n` };
}

/**
 * Skriv begge formater til udklipsholderen.
 *
 * SKAL kaldes synkront fra klikket: Safari godtager kun en ClipboardItem,
 * der er oprettet inde i brugerens handling (Sagu v24). Derfor bygges
 * indholdet FOER kaldet, og blobbene gives som loefter.
 *
 * Over http (panelets IP:port) findes `navigator.clipboard` ikke. Saa
 * bruges `copy`-haendelsen: den kraever ingen tilladelse, kun et klik - men
 * den fyrer kun med en markering, saa den faar et skjult felt at kopiere
 * fra (§9e). Returnerer true, hvis en af vejene lykkedes.
 */
async function kopierRigTekst(indhold) {
  const { html, tekst } = indhold;
  if (window.isSecureContext && navigator.clipboard && navigator.clipboard.write
    && typeof ClipboardItem !== 'undefined') {
    try {
      const item = new ClipboardItem({
        'text/html': Promise.resolve(new Blob([html], { type: 'text/html' })),
        'text/plain': Promise.resolve(new Blob([tekst], { type: 'text/plain' })),
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch { /* falder igennem til copy-haendelsen */ }
  }
  return kopierMedHaendelse(html, tekst);
}

function kopierMedHaendelse(html, tekst) {
  let skrevet = false;
  const lyt = (e) => {
    e.clipboardData.setData('text/html', html);
    e.clipboardData.setData('text/plain', tekst);
    e.preventDefault();
    skrevet = true;
  };
  const felt = document.createElement('textarea');
  felt.value = ' ';
  felt.setAttribute('readonly', '');
  felt.style.position = 'fixed';
  felt.style.top = '-1000px';
  document.body.appendChild(felt);
  document.addEventListener('copy', lyt, true);
  try {
    felt.select();
    const ok = document.execCommand('copy');
    return ok && skrevet;
  } catch {
    return false;
  } finally {
    document.removeEventListener('copy', lyt, true);
    felt.remove();
  }
}
