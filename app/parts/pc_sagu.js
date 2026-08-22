'use strict';
/* tovo -> Sagu: broen, som den ser ud i opgaveruden.
 *
 * ── Hvor en note BOR i tovo ───────────────────────────────────────────────
 *
 * doda har ét `link_url`/`link_title` pr. element. tovo har i forvejen et
 * `links[]`-array (OneNote), saa en Sagu-note er bare et link med en KENDT
 * form: `<sagu>/#note-<32 hex>`. Ingen skemaaendring, ingen ny kolonne - og
 * noten lever side om side med OneNote-linket i stedet for at konkurrere.
 *
 * ── Kaldene ───────────────────────────────────────────────────────────────
 *
 * Der maa ALDRIG gaa et kald til Sagu pr. optegning: rundturen gennem en
 * tunnel er 140-190 ms (RUNE-ERFARINGER, doda v27). Noten hentes derfor, naar
 * ruden AABNES - én gang, og med indhold og kommentarer i samme svar.
 */

/* Adressens form. Den staar ogsaa i app/sagu.js paa serveren; det er samme
   valg som doda traf, og grunden er, at frontenden skal kunne vaelge rude
   UDEN et kald. Aendres formen, skal begge steder rettes - derfor staar den
   ét sted i hver ende og ikke spredt ud. */
const SAGU_NOTE = /#note-([0-9a-f]{32})$/i;

const saguState = { url: '', connected: false, hentet: false };

/** Hentes én gang pr. sideindlaesning - ikke pr. rude og ikke pr. optegning. */
async function saguOpsaetning() {
  if (saguState.hentet) return saguState;
  try {
    const d = await api('GET', '/api/v1/sagu');
    saguState.connected = !!d.connected;
    saguState.url = d.url || '';
  } catch { saguState.connected = false; }
  saguState.hentet = true;
  return saguState;
}

/** Er linket en note i VORES Sagu? Samme form paa en fremmed vaert taeller ikke. */
function erSaguLink(url) {
  if (!SAGU_NOTE.test(String(url || ''))) return false;
  if (!saguState.url) return true;
  try { return new URL(url).origin === new URL(saguState.url).origin; } catch { return false; }
}

const saguLinks = (it) => (it.links || []).filter((l) => erSaguLink(l.url));

/**
 * Sagu-afsnittet i opgaveruden.
 *
 * Er Sagu ikke forbundet, tegnes INTET - hverken en tom overskrift eller en
 * opfordring. En app, der reklamerer for en integration, man ikke bruger, er
 * stoej paa hver eneste opgave.
 */
async function tegnSaguIRude(it) {
  const vaert = document.getElementById('dSagu');
  if (!vaert) return;
  const s = await saguOpsaetning();
  if (!s.connected) { vaert.innerHTML = ''; return; }

  const noter = saguLinks(it);
  vaert.innerHTML = `<h2 style="margin-top:18px">Sagu</h2>
    <div id="dSaguKrop"><p class="meta">Loading…</p></div>`;
  const krop = document.getElementById('dSaguKrop');

  if (!noter.length) {
    krop.innerHTML = `
      <p class="meta">No note yet. Find one in Sagu, or make a new one for this task.</p>
      <div class="row">
        <input class="input" id="dSaguSoeg" placeholder="Type part of a note title…" style="flex:1">
        <button class="btn" id="dSaguNy">New note</button>
      </div>
      <ul class="plain" id="dSaguTraef"></ul>`;
    bindSaguSoeg(it);
    return;
  }

  // Kun den FOERSTE note foldes ud. Har en opgave to, er den anden et link -
  // ruden er et vindue ind til noten, ikke noten.
  const note = noter[0];
  let d;
  try {
    d = await api('GET', `/api/v1/sagu/note?url=${encodeURIComponent(note.url)}`);
  } catch (ex) {
    krop.innerHTML = `<p class="gate-error">${esc(ex.message)}</p>
      <p class="meta"><a href="${esc(note.url)}" target="_blank" rel="noopener noreferrer">Open in Sagu</a></p>`;
    return;
  }

  krop.innerHTML = `
    <p class="meta"><a href="${esc(note.url)}" target="_blank" rel="noopener noreferrer">
      ${esc(d.note.title || 'Untitled')}</a> — open in Sagu</p>
    ${d.note.body ? `<div class="note-preview saguindhold">${linkify(d.note.body).replace(/\n/g, '<br>')}</div>` : ''}
    <!-- "in Sagu" er ikke pynt: opgaveruden har sine EGNE kommentarer
         laengere nede, og to afsnit med samme overskrift lige under hinanden
         kan man ikke svare rigtigt i. -->
    <h2 style="margin-top:14px" class="group meta">Comments in Sagu
      <span class="group-count">${(d.comments || []).length}</span></h2>
    <ul class="plain kommentarer" id="dSaguKomm">${(d.comments || []).map((c) => `
      <li>
        <span class="kommentar-tid meta">${esc(c.author)}${c.guest ? ' (guest)' : ''}
          · ${esc(visTidspunkt(c.at))}</span>
        <span class="kommentar-tekst">${linkify(c.body)}</span>
      </li>`).join('') || '<li class="meta">No comments yet</li>'}</ul>
    <div class="row">
      <input class="input" id="dSaguKommentar" placeholder="Comment on the note…" style="flex:1">
      <button class="btn" id="dSaguSkriv">Add</button>
    </div>
    ${d.commentError ? `<p class="meta">${esc(d.commentError)}</p>` : ''}
    <div class="row"><button class="linkbtn" id="dSaguFjern">Unlink this note</button>
      <span class="meta">The note stays in Sagu.</span></div>`;

  const skriv = async () => {
    const felt = document.getElementById('dSaguKommentar');
    const tekst = felt.value.trim();
    if (!tekst) return;
    try {
      const r = await api('POST', '/api/v1/sagu/comment', { url: note.url, text: tekst });
      felt.value = '';
      toast(r.message);
      await tegnSaguIRude(it);
    } catch (ex) { toast(ex.message); }
  };
  document.getElementById('dSaguSkriv').addEventListener('click', skriv);
  document.getElementById('dSaguKommentar').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); skriv(); }
  });

  document.getElementById('dSaguFjern').addEventListener('click', async () => {
    try {
      await api('PATCH', `/api/v1/items/${it.id}`,
        { links: (it.links || []).filter((l) => l.url !== note.url) });
      it.links = (it.links || []).filter((l) => l.url !== note.url);
      await genindlaes();
      await tegnSaguIRude(it);
      toast('Unlinked. The note is still in Sagu.');
    } catch (ex) { toast(ex.message); }
  });
}

/** Soegning og oprettelse, naar opgaven endnu ikke har en note. */
function bindSaguSoeg(it) {
  const felt = document.getElementById('dSaguSoeg');
  const traef = document.getElementById('dSaguTraef');
  let timer = null;

  const haeft = async (url, titel) => {
    try {
      const links = (it.links || []).concat([{ url, label: titel }]);
      await api('PATCH', `/api/v1/items/${it.id}`, { links });
      it.links = links;
      await genindlaes();
      await tegnSaguIRude(it);
      toast('Linked.');
    } catch (ex) { toast(ex.message); }
  };

  // Der soeges FOERST fra to tegn, og med en pause: ét kald pr. tastetryk
  // ville sende en rundtur gennem tunnelen for hvert bogstav.
  felt.addEventListener('input', () => {
    clearTimeout(timer);
    const q = felt.value.trim();
    if (q.length < 2) { traef.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const d = await api('GET', `/api/v1/sagu/search?q=${encodeURIComponent(q)}`);
        traef.innerHTML = (d.pages || []).map((p) => `
          <li><button class="linkbtn" data-haeft="${esc(p.url)}"
            data-titel="${esc(p.title)}">${esc(p.title)}</button>
            ${p.kind ? `<span class="meta">${esc(p.kind)}</span>` : ''}</li>`).join('')
          || '<li class="meta">No notes match</li>';
        traef.querySelectorAll('[data-haeft]').forEach((el) => el.addEventListener('click',
          () => haeft(el.dataset.haeft, el.dataset.titel)));
      } catch (ex) { traef.innerHTML = `<li class="gate-error">${esc(ex.message)}</li>`; }
    }, 300);
  });

  document.getElementById('dSaguNy').addEventListener('click', async () => {
    try {
      const d = await api('POST', '/api/v1/sagu/note', {
        title: it.title,
        // Noten faar et link TILBAGE til opgaven, saa de to kan findes fra
        // hinanden. Adressen er tovos egen - den er ikke hemmelig.
        backUrl: `${location.origin}/#task-${it.id}`,
        backTitle: it.title,
      });
      await haeft(d.page.url, d.page.title);
    } catch (ex) { toast(ex.message); }
  });
}
