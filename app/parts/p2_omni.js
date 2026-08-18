'use strict';
/* tovo - kommandopaletten. Ét felt der baade soeger og opretter.
 *
 * Oprettelse staar ALTID oeverst og kan altid naas med Enter: soegning maa
 * aldrig komme i vejen for fangst. Paletten er dodas, med tovos markoerer.
 */

/* Foerste tegn vaelger en TILSTAND. Pillen i feltet og legenden nedenunder
   viser hvilken, saa man aldrig er i tvivl om, hvad Enter kommer til at goere.

   Legenden skal naevne ALT, parseren kan i den tilstand. Naevner den mindre,
   findes funktionen i praksis ikke - det var praecis derfor "/projekt" laa
   ubrugt i doda indtil v4, selv om paletten lovede det. */
const MODER = {
  '+': {
    id: 'task', pil: '+ New task', ph: 'Task title… try ~2,5t !friday',
    legend: ['@ project', '# tag', '! date', '~ estimate'], enter: 'Create',
  },
  '/': { id: 'project', pil: '/ Projects', ph: 'Find or create a project…', legend: [], enter: 'Open' },
  '#': { id: 'tag', pil: '# Tags', ph: 'Find a tag…', legend: [], enter: 'Open' },
};

const STANDARD_LEGEND = ['+ task', '@ project', '# tag', '! date', '~ estimate', '⌘↵ start timer'];

const omniState = {
  mode: null,
  tolket: null,
  resultater: { tasks: [], projects: [] },
  valgt: 0,
  raekker: [],
  soegeTimer: null,
  soegeToken: 0,
};

function omniEl() { return document.getElementById('omni'); }

/* Tolkningen sker LOKALT med den samme parser, serveren bruger. Ingen
   netvaerkskald pr. tastetryk - chipsene skal foelge fingrene, og de kan
   alligevel ikke komme ud af trit med det, der bliver gemt (doda F1). */
function tolkNu(tekst) {
  if (typeof tovoParse === 'undefined') return null;
  return tovoParse.tolkFangst(tekst);
}

/** Det projekt, feltet arbejder i. Staar man i et projekt, hoerer alt til der. */
function omniKontekst() {
  return state.openProject ? state.projects.find((p) => p.id === state.openProject) : null;
}

function saetMode(tegn) {
  omniState.mode = tegn;
  const pille = document.getElementById('omniMode');
  const el = omniEl();
  if (!el) return;
  const m = tegn ? MODER[tegn] : null;
  if (pille) {
    pille.textContent = m ? m.pil : '';
    pille.hidden = !m;
  }
  const k = omniKontekst();
  el.placeholder = m ? m.ph
    : (k ? `Search or add in ${k.name}…` : 'Search — or start a line with + to create');
}

function tegnLegend() {
  const host = document.getElementById('omniLegend');
  if (!host) return;
  const m = omniState.mode ? MODER[omniState.mode] : null;
  const dele = m ? m.legend : STANDARD_LEGEND;
  const k = omniKontekst();
  const kontekst = k ? `<span class="chip">in ${esc(k.name)}</span>` : '';
  host.innerHTML = kontekst + dele.map((d) => `<span>${esc(d)}</span>`).join('');
}

/* Chips under feltet: det, parseren HAR forstaaet. Et navn, der ikke findes
   endnu, skal kunne SES med det samme - men foerst oprettes ved Enter. Ellers
   forsvinder @navn ud af titlen uden at lande et synligt sted, og interfacet
   lyver (doda 2026-08-18). */
function tegnChips() {
  const host = document.getElementById('omniChips');
  if (!host) return;
  const t = omniState.tolket;
  if (!t) { host.innerHTML = ''; return; }
  const kendteP = new Set(state.projects.map((p) => p.name.toLowerCase()));
  const kendteT = new Set((state.tags || []).map((x) => x.name.toLowerCase()));
  const chips = [];
  if (t.project) {
    const ny = !kendteP.has(t.project.toLowerCase());
    chips.push(`<span class="chip">@${esc(t.project)}${ny ? ' — new' : ''}</span>`);
  }
  for (const navn of t.tags) {
    const ny = !kendteT.has(navn.toLowerCase());
    chips.push(`<span class="chip neutral">#${esc(navn)}${ny ? ' — new' : ''}</span>`);
  }
  if (t.estimateMinutes) chips.push(`<span class="chip neutral">~${esc(tovoBeregn.formatVarighed(t.estimateMinutes))}</span>`);
  if (t.due) chips.push(`<span class="chip neutral">${esc(visDato(t.due.dato))}${t.due.tid ? ` ${esc(t.due.tid)}` : ''}</span>`);
  if (t.recurrenceText) chips.push(`<span class="chip neutral">${esc(t.recurrenceText)}</span>`);
  for (const w of t.warnings) chips.push(`<span class="chip neutral">${esc(w)}</span>`);
  host.innerHTML = chips.join('');
}

/**
 * Projekter, der LIGNER det, man er ved at skrive.
 *
 * Uden det siger chippen "@BeanLedg — new", mens "BeanLedger" ligger lige
 * ved siden af - og saa opretter man et projekt nummer to med et
 * stavefejlsnavn uden at opdage det. Foerst praefiks (det man er i gang med
 * at skrive), derefter delstreng.
 */
function lignendeProjekter(navn) {
  const q = String(navn || '').toLowerCase();
  if (!q) return [];
  const alle = state.projects || [];
  if (alle.some((p) => p.name.toLowerCase() === q)) return [];   // praecist match: intet at foreslaa
  const praefiks = alle.filter((p) => p.name.toLowerCase().startsWith(q));
  const delstreng = alle.filter((p) => !praefiks.includes(p) && p.name.toLowerCase().includes(q));
  return praefiks.concat(delstreng).slice(0, 4);
}

/** Skifter det skrevne @navn ud med et rigtigt projektnavn i feltet. */
function vaelgProjektForslag(navn) {
  const el = omniEl();
  if (!el) return;
  const t = omniState.tolket;
  const nyt = /\s/.test(navn) ? `"${navn}"` : navn;
  // Kun DET token, der faktisk staar der, skiftes ud - fjernMarkoer kender
  // den samme regel om mellemrum foran markoeren som parseren selv.
  const uden = tovoParse.fjernMarkoer(el.value, '@/', t && t.project ? t.project : '');
  el.value = `${uden} @${nyt} `.replace(/\s{2,}/g, ' ');
  el.focus();
  opdaterOmni();
}

function visDato(iso) {
  if (!iso) return '';
  if (iso === state.today) return 'today';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* ------------------------------------------------------------ raekker */

function byggRaekker() {
  const el = omniEl();
  const raa = el ? el.value : '';
  const q = raa.trim();
  const raekker = [];
  const k = omniKontekst();

  if (omniState.mode === '/' || omniState.mode === '#') {
    const kilde = omniState.mode === '/' ? state.projects : (state.tags || []);
    const passer = kilde.filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()));
    for (const x of passer.slice(0, 12)) {
      raekker.push({ type: 'goto', mode: omniState.mode, id: x.id, titel: x.name,
        under: omniState.mode === '/' ? 'PROJECT' : 'TAG' });
    }
    if (omniState.mode === '/' && q && !kilde.some((x) => x.name.toLowerCase() === q.toLowerCase())) {
      raekker.push({ type: 'nyt', navn: q, hvad: 'project' });
    }
    if (!raekker.length) raekker.push({ type: 'tom', titel: 'Nothing yet', under: 'Type a name to create one' });
    return raekker;
  }

  if (q) {
    const t = omniState.tolket;
    const titel = (t && t.title) || q;
    raekker.push({
      type: 'fangst',
      titel,
      under: k ? `NEW TASK IN ${k.name.toUpperCase()}` : 'NEW TASK',
    });
    // Skriver man et projektnavn, der ligner et, der findes, saa vis det -
    // FOER resultaterne, fordi det er en rettelse og ikke et opslag.
    if (t && t.project) {
      for (const p of lignendeProjekter(t.project)) {
        raekker.push({ type: 'projektforslag', projekt: p });
      }
    }
  }

  for (const it of omniState.resultater.tasks) raekker.push({ type: 'task', item: it });
  for (const p of omniState.resultater.projects) {
    raekker.push({ type: 'goto', mode: '/', id: p.id, titel: p.name, under: 'PROJECT' });
  }
  if (!raekker.length && q) raekker.push({ type: 'tom', titel: 'No matches', under: 'Enter creates a task' });
  return raekker;
}

function tegnPanel() {
  const panel = document.getElementById('omniPanel');
  if (!panel) return;
  omniState.raekker = byggRaekker();
  if (!omniState.raekker.length) { panel.hidden = true; panel.innerHTML = ''; return; }
  if (omniState.valgt >= omniState.raekker.length) omniState.valgt = 0;

  panel.innerHTML = omniState.raekker.map((r, i) => {
    const valgt = i === omniState.valgt ? ' aria-selected="true"' : '';
    if (r.type === 'task') {
      const it = r.item;
      const projekt = state.projects.find((p) => p.id === it.projectId);
      const under = [projekt ? projekt.name : '', it.dueDate ? visDato(it.dueDate) : '',
        it.estimateMinutes ? `~${tovoBeregn.formatVarighed(it.estimateMinutes)}` : ''].filter(Boolean).join(' · ');
      const koerer = timerState.data && timerState.data.entry.taskId === it.id;
      // Start-knappen SKAL kunne naas herfra: at skulle aabne opgaven for at
      // trykke start er tre klik til noget, der hoerer til ét.
      return `<div class="omni-row${it.status === 'done' ? ' dim' : ''}"${valgt} data-i="${i}" data-raekke>
        ${icon('today')}<span class="omni-row-main">
        <span class="omni-row-title">${esc(it.title)}</span>
        <span class="omni-row-sub">${esc(under || 'no project')}</span></span>
        ${it.status === 'done' ? '' : `<button class="playbtn${koerer ? ' on' : ''}" data-omnistart="${esc(it.id)}"
          title="${koerer ? 'Stop the timer' : 'Start a timer (⌘↵)'}"
          aria-label="${koerer ? 'Stop the timer' : 'Start a timer'}">${icon(koerer ? 'stop' : 'play', 15)}</button>`}
      </div>`;
    }
    if (r.type === 'tom') {
      return `<div class="omni-row empty-row"><span class="omni-row-main">
        <span class="omni-row-title">${esc(r.titel)}</span>
        <span class="omni-row-sub">${esc(r.under)}</span></span></div>`;
    }
    if (r.type === 'goto') {
      return `<button class="omni-row"${valgt} data-i="${i}">
        ${icon(r.mode === '/' ? 'projects' : 'link')}<span class="omni-row-main">
        <span class="omni-row-title">${esc(r.titel)}</span>
        <span class="omni-row-sub">${esc(r.under)}</span></span></button>`;
    }
    if (r.type === 'nyt') {
      return `<button class="omni-row"${valgt} data-i="${i}">
        ${icon('plus')}<span class="omni-row-main">
        <span class="omni-row-title">${esc(r.navn)}</span>
        <span class="omni-row-sub">NEW PROJECT</span></span></button>`;
    }
    if (r.type === 'projektforslag') {
      return `<button class="omni-row"${valgt} data-i="${i}">
        ${icon('projects')}<span class="omni-row-main">
        <span class="omni-row-title">${esc(r.projekt.name)}</span>
        <span class="omni-row-sub">EXISTING PROJECT — USE THIS INSTEAD</span></span></button>`;
    }
    return `<button class="omni-row big"${valgt} data-i="${i}">
      <span class="omni-plus">${icon('plus', 20)}</span>
      <span class="omni-row-main"><span class="omni-row-title">${esc(r.titel)}</span></span>
      <span class="omni-badge">${esc(r.under)}</span></button>`;
  }).join('');
  panel.hidden = false;

  panel.querySelectorAll('.omni-row[data-i]').forEach((el) => {
    el.addEventListener('mouseenter', () => { omniState.valgt = Number(el.dataset.i); markerValgt(); });
    el.addEventListener('mousedown', (e) => e.preventDefault());   // behold fokus i feltet
    el.addEventListener('click', () => { omniState.valgt = Number(el.dataset.i); aktiver(); });
  });
  panel.querySelectorAll('[data-omnistart]').forEach((el) => {
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = el.dataset.omnistart;
      const koerer = timerState.data && timerState.data.entry.taskId === id;
      luk();
      if (koerer) await stopTimer();
      else await startTimerPaa(id);
    });
  });
}

function markerValgt() {
  document.querySelectorAll('#omniPanel .omni-row').forEach((el, i) => {
    if (i === omniState.valgt) el.setAttribute('aria-selected', 'true');
    else el.removeAttribute('aria-selected');
  });
}

/* ------------------------------------------------------------ soegning */

function planlaegSoegning() {
  clearTimeout(omniState.soegeTimer);
  const q = omniEl().value.trim();
  if (q.length < 2 || (omniState.mode && omniState.mode !== '+')) {
    omniState.resultater = { tasks: [], projects: [] };
    tegnPanel();
    return;
  }
  omniState.soegeTimer = setTimeout(async () => {
    const token = ++omniState.soegeToken;
    const k = omniKontekst();
    try {
      const d = await api('GET', `/api/v1/search?q=${encodeURIComponent(q)}`
        + (k ? `&project=${encodeURIComponent(k.id)}` : ''));
      // Et AELDRE svar maa aldrig overskrive et nyere - ellers blinker
      // resultaterne tilbage til noget, brugeren er holdt op med at skrive.
      if (token !== omniState.soegeToken) return;
      omniState.resultater = d;
      tegnPanel();
    } catch { /* soegning maa aldrig staa i vejen for fangst */ }
  }, 140);
}

/* ------------------------------------------------------------ handling */

async function aktiver() {
  const raekke = omniState.raekker[omniState.valgt];
  if (!raekke) return;
  if (raekke.type === 'tom') return;
  if (raekke.type === 'projektforslag') { vaelgProjektForslag(raekke.projekt.name); return; }
  if (raekke.type === 'task') { luk(); aabnOpgave(raekke.item.id); return; }
  if (raekke.type === 'goto') {
    luk();
    if (raekke.mode === '/') gaaTil('projects', { project: raekke.id });
    else gaaTil('today');
    return;
  }
  if (raekke.type === 'nyt') {
    const p = await api('POST', '/api/v1/items', { kind: 'project', name: raekke.navn, sections: [] });
    luk();
    await genindlaes();
    gaaTil('projects', { project: p.item.id });
    return;
  }
  await fangstNu();
}

async function fangstNu() {
  const el = omniEl();
  const tekst = el.value.trim();
  if (!tekst) return;
  const k = omniKontekst();
  try {
    const r = await api('POST', '/api/v1/capture', {
      text: tekst,
      projectId: k ? k.id : null,
    });
    luk();
    await genindlaes();
    // Advarsler fra parseren skal SIGES. Et estimat, der ikke blev forstaaet,
    // staar stadig i titlen - og det skal brugeren vide nu, ikke om en uge.
    if (r.warnings && r.warnings.length) toast(r.warnings[0]);
    else toast(`Added: ${r.item.title}`, { label: 'Open', run: () => aabnOpgave(r.item.id) });
  } catch (ex) {
    toast(ex.message);
  }
}

function luk() {
  const el = omniEl();
  if (el) { el.value = ''; el.blur(); }
  omniState.tolket = null;
  omniState.valgt = 0;
  omniState.resultater = { tasks: [], projects: [] };
  saetMode(null);
  tegnLegend();
  tegnChips();
  const panel = document.getElementById('omniPanel');
  if (panel) { panel.hidden = true; panel.innerHTML = ''; }
}

function opdaterOmni() {
  const el = omniEl();
  if (!el) return;
  // Foerste tegn vaelger tilstand og fjernes fra feltet, saa pillen baerer den.
  if (!omniState.mode && el.value.length === 1 && MODER[el.value]) {
    saetMode(el.value);
    el.value = '';
    tegnLegend();
  }
  omniState.tolket = (!omniState.mode || omniState.mode === '+') ? tolkNu(el.value) : null;
  omniState.valgt = 0;
  tegnChips();
  planlaegSoegning();
  tegnPanel();
}

/*
 * Feltet skal SIGE, hvor det arbejder.
 *
 * Kontekstbevidstheden virkede fra foerste faerd - en fangst inde i et
 * projekt landede rigtigt - men pladsholderen og legenden blev staaende paa
 * den generelle tekst, fordi de kun blev tegnet ved skallens optegning.
 * En funktion, der opfoerer sig anderledes, end interfacet siger, er den
 * slags, brugeren opdager som en fejl, selv naar den goer det rigtige.
 */
function opdaterOmniKontekst() {
  if (!omniEl()) return;
  saetMode(omniState.mode);
  tegnLegend();
}

function bindOmni() {
  const el = omniEl();
  if (!el) return;
  saetMode(null);
  tegnLegend();
  tegnChips();

  el.addEventListener('input', opdaterOmni);
  el.addEventListener('focus', tegnPanel);
  el.addEventListener('blur', () => {
    // Lille forsinkelse, saa et klik paa en raekke naar at blive registreret.
    setTimeout(() => {
      if (document.activeElement === el) return;
      const p = document.getElementById('omniPanel');
      if (p) p.hidden = true;
    }, 150);
  });

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); luk(); return; }
    // Backspace i et TOMT felt forlader tilstanden i stedet for ingenting.
    if (e.key === 'Backspace' && !el.value && omniState.mode) {
      e.preventDefault();
      saetMode(null);
      tegnLegend();
      opdaterOmni();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!omniState.raekker.length) return;
      e.preventDefault();
      const n = omniState.raekker.length;
      omniState.valgt = (omniState.valgt + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      markerValgt();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Cmd/Ctrl+Enter paa en fundet opgave STARTER den i stedet for at
      // aabne den - den hurtige vej fra soegning til registrering.
      const raekke = omniState.raekker[omniState.valgt];
      if ((e.metaKey || e.ctrlKey) && raekke && raekke.type === 'task') {
        const id = raekke.item.id;
        luk();
        startTimerPaa(id);
        return;
      }
      aktiver();
    }
  });
}

/*
 * Genvejene til feltet.
 *
 * Cmd/Ctrl+K aabner det overalt. Og skriver man bare et bogstav, aabner det
 * ogsaa - men undtagelserne er vigtigere end reglen: uden dem stjaeler
 * paletten tastetryk fra ethvert felt i appen.
 */
document.addEventListener('keydown', (e) => {
  if (!state.user) return;
  const omni = omniEl();
  if (!omni) return;

  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    omni.focus();
    omni.select();
    tegnPanel();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (document.querySelector('.modal')) return;
  /*
   * Her afviger tovo fra doda med vilje.
   *
   * doda traekker sig, saa snart fokus staar i en `[data-keynav]`-liste,
   * fordi dodas raekker EJER bogstaverne (n = next, w = waiting, x = slet).
   * tovos raekker bruger kun Enter og mellemrum, saa den samme regel ville
   * betyde, at bogstaver blev aedt: man staar i listen, skriver, og der sker
   * ingenting. Planen siger det modsatte - bogstaver skal kunne skrives i
   * soegefeltet, uanset hvor man staar.
   *
   * Derfor: kun en liste, der SELV siger, at den vil have bogstaverne
   * (`data-keynav-letters`), faar lov at beholde dem. Kommer der en saadan
   * liste i en senere fase, er mekanismen der allerede.
   */
  if (el && el.closest && el.closest('[data-keynav-letters]')) return;

  if (e.key.length !== 1) return;
  e.preventDefault();
  omni.focus();
  omni.value += e.key;
  opdaterOmni();
});

/*
 * Vejen IND i listen er piletaster - aldrig bogstaver.
 *
 * doda havde genveje paa raekkerne, som kun virkede naar en raekke havde
 * fokus, og fokus kunne kun komme fra et klik, der samtidig aabnede opgaven.
 * Genvejene var i praksis uopnaaelige (doda v7). Bogstaver maa ikke foere ind
 * i listen: i en app, hvor man bare kan begynde at skrive, ville det betyde,
 * at man ikke kan fange en opgave, der starter med det bogstav.
 */
document.addEventListener('keydown', (e) => {
  if (!state.user) return;
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (document.querySelector('.modal')) return;

  const raekker = [...document.querySelectorAll('[data-keynav] [data-row]')];
  if (!raekker.length) return;

  const nu = raekker.indexOf(el);
  if (nu < 0) {
    e.preventDefault();
    (e.key === 'ArrowDown' ? raekker[0] : raekker[raekker.length - 1]).focus();
    return;
  }
  e.preventDefault();
  const n = raekker.length;
  raekker[(nu + (e.key === 'ArrowDown' ? 1 : n - 1)) % n].focus();
});

/* Esc slipper listen igen - ellers sidder brugeren fast i en tilstand, hvor
   tasterne betyder noget andet, end de plejer (doda v7). */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const el = document.activeElement;
  if (el && el.closest && el.closest('[data-keynav]')) el.blur();
});
