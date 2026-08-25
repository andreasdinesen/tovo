'use strict';
/* tovo - kerne: opstart, tema, login, app-skal.
   Denne fil samles til public/app.js af build_rune.py. Redigér aldrig app.js.

   NB: interfacet er ENGELSK (som i doda - aeoeaa er besvaerligt at taste),
   men koden, kommentarerne og dokumenterne er dansk. */

const APP_VERSION = 21;

/* Mobilgraensen bor to steder: her og i style.css. Holdes de ikke i trit,
   folder menuknappen sidebaren sammen paa en iPad, hvor CSS'en tror den er
   overlay (RUNE-ERFARINGER §4). */
const SMAL_SKAERM = 900;

/* Opgaver uden projekt er ikke et projekt med tomt navn - de er deres egen
   plads. Id'et er en KONSTANT og ikke en tom streng, saa det aldrig kan
   forveksles med "intet valgt". */
const INTET_PROJEKT = '__uden';
const smalSkaerm = () => window.matchMedia(`(max-width: ${SMAL_SKAERM}px)`).matches;

const state = {
  user: null,
  config: { appName: 'tovo', needsSetup: false, allowRegistration: false, secureContext: false },
  view: 'today',
  today: '',
  settings: {},
  projects: [],
  unassigned: 0,
  tags: [],
  items: [],
  counts: {},
  todayMinutes: 0,
  openProject: null,
  openTag: null,
};

/* ------------------------------------------------------------ hjaelpere */

// crypto.randomUUID() findes KUN i secure contexts. Panelet tilgaas paa
// IP:port over http, hvor alt der opretter id'er ellers doer stille (§4).
function nyId() {
  if (window.crypto && crypto.randomUUID && window.isSecureContext) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.random() * 256 | 0;
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Goer URL'er og [tekst](url) klikbare.
 *
 * Teksten escapes FOERST, og der matches derefter kun paa http(s). Saa kan
 * javascript: og data: aldrig slippe igennem fra en import eller en
 * MCP-klient - og en attribut-udbrydning er umulig, fordi " allerede er
 * blevet &quot; (doda F1).
 *
 * NB: onenote:-links gemmes paa opgaver (fase 1) og bliver med vilje IKKE
 * linkificeret her - de tegnes som et <a href> af link-visningen, hvor
 * skemaet er hvidlistet. Fri tekst maa kun blive til http(s).
 */
function linkify(tekst) {
  let ud = esc(tekst);
  ud = ud.replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^)\s]{1,500})\)/g,
    (_, navn, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${navn}</a>`);
  ud = ud.replace(/(^|[\s(])(https?:\/\/[^\s<]{1,500})/g, (helt, foer, url) => {
    const hale = url.match(/[.,;:!?)]+$/);
    const ren = hale ? url.slice(0, -hale[0].length) : url;
    const vis = ren.replace(/^https?:\/\//, '').slice(0, 60);
    return `${foer}<a href="${ren}" target="_blank" rel="noopener noreferrer">${vis}</a>${hale ? hale[0] : ''}`;
  });
  return ud;
}

/**
 * Et tidsstempel, som et menneske laeser det.
 *
 * "today 14:32" · "yesterday 09:05" · "18 Aug 14:32" · "18 Aug 2025 14:32".
 * Aaret skrives kun, naar det ikke er i aar - ellers stjaeler det plads fra
 * det, man faktisk kigger efter.
 */
/** Date -> YYYY-MM-DD i LOKAL tid. Aldrig toISOString - den er UTC og
    flytter datoen for alle mellem midnat og to om natten. */
function isoDato(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Sagsnummeret, som link hvis der er en skabelon.
 *
 * Skabelonen er en URL med `{case}` i, fx
 * `https://firma.service-now.com/nav_to.do?uri=/task.do?sysparm_query=number={case}`.
 * Kun http(s) tages imod: en skabelon er brugerens egen tekst, men den bliver
 * til et href, og dér maa javascript: aldrig kunne slippe igennem.
 */
function sagHtml(sag) {
  if (!sag) return '';
  const skabelon = (state.settings || {}).case_url || '';
  if (!/^https?:\/\//i.test(skabelon) || !skabelon.includes('{case}')) {
    return `<span class="sagchip">${esc(sag)}</span>`;
  }
  const url = skabelon.replace('{case}', encodeURIComponent(sag));
  return `<a class="sagchip saglink" href="${esc(url)}" target="_blank" rel="noopener noreferrer"
    title="Open ${esc(sag)}" data-stop>${esc(sag)}</a>`;
}

function visTidspunkt(unix) {
  if (!unix) return '';
  const d = new Date(Number(unix) * 1000);
  const kl = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (iso === state.today) return `today ${kl}`;
  const igaar = new Date();
  igaar.setDate(igaar.getDate() - 1);
  const igaarIso = `${igaar.getFullYear()}-${String(igaar.getMonth() + 1).padStart(2, '0')}-${String(igaar.getDate()).padStart(2, '0')}`;
  if (iso === igaarIso) return `yesterday ${kl}`;
  const iAar = d.getFullYear() === new Date().getFullYear();
  const dato = d.toLocaleDateString('en-GB', iAar
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
  return `${dato} ${kl}`;
}

async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    // Saet headers EFTER en evt. merge - en shallow merge har foer slettet
    // Authorization, fordi hele header-objektet blev erstattet (Kokkeri v15).
    opts.headers = { 'Content-Type': 'application/json' };
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    // Browserens egen tekst er ubrugelig for et menneske: Safari siger
    // "Load failed", Chrome "Failed to fetch". Oversaettelsen hoerer hjemme
    // HER - ét sted - og ikke i hvert kaldssted (doda v11).
    //
    // Ingen `status`: den, der skal skelne netvaerksbrud fra afslag, kigger
    // netop paa fravaeret af en status.
    throw Object.assign(new Error('No connection — this needs the network. Try again when you are back.'),
      { offline: true });
  }
  let data = {};
  try { data = await res.json(); } catch { /* tomt svar er i orden */ }
  if (!res.ok) {
    /*
     * Hele kroppen faelger med som `svar`.
     *
     * Foer stod der kun `status` og `code`, og saa faldt alt andet paa gulvet
     * - fx `needsCode` ved login. Det er samme fejlform som hvidlisten, der
     * aad `via` fra Sagu: en udvaelgelse, der er rigtig den dag den skrives,
     * og tavst forkert foerste gang serveren svarer med et felt mere.
     */
    throw Object.assign(new Error(data.message || data.error || `Error ${res.status}`),
      { status: res.status, code: data.error, svar: data, needsCode: !!data.needsCode });
  }
  return data;
}

/**
 * Kopiér til udklipsholderen.
 *
 * `navigator.clipboard` kraever et secure context, og panelet tilgaas paa
 * IP:port over http. Uden fallbacken kan brugeren ikke kopiere det link, han
 * kom for at hente - og fejlen er tavs (doda F2).
 */
async function kopier(tekst) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(tekst);
      return true;
    }
  } catch { /* falder igennem til den gamle vej */ }
  try {
    const felt = document.createElement('textarea');
    felt.value = tekst;
    felt.setAttribute('readonly', '');
    felt.style.position = 'fixed';
    felt.style.top = '-1000px';
    document.body.appendChild(felt);
    felt.select();
    const ok = document.execCommand('copy');
    felt.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * ⌘↵ (Ctrl+↵) gemmer en rude.
 *
 * Ligger ét sted, saa alle ruder svarer ens - en genvej, der virker i den
 * ene og ikke i den anden, er vaerre end ingen genvej.
 *
 * Den lyttes paa RUDEN og ikke paa dokumentet: saa gaelder den kun, mens
 * ruden er aaben, og den kan ikke komme til at gemme noget i baggrunden.
 * `capture: true`, saa den naar frem, ogsaa naar et felt selv har en
 * Enter-handler (fx kommentarfeltet).
 */
function bindGemGenvej(host, gem) {
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    e.stopPropagation();
    gem();
  }, true);
}

/**
 * En ja/nej-praeference, der hoerer til BRUGEREN - ikke til browseren.
 *
 * localStorage betyder "husket her". tovo bruges paa baade telefon og
 * desktop, saa en visningsindstilling, der kun gaelder én browser, ligner
 * en indstilling, der ikke virker (meldt af Andreas om liste/kort).
 * `state.settings` hentes allerede ved opstart, saa serveren koster ingen
 * ny rute og intet ekstra kald ved indlaesning - kun ét, naar valget skifter.
 *
 * `gammelLokal` er den localStorage-noegle, vaerdien laa i FOER flytningen.
 * Den laeses som reserve, saa et valg, brugeren tog i gaar, ikke kastes vaek
 * praecis i den version, der skulle goere det bedre.
 */
function brugerFlag(noegle, standard, gammelLokal) {
  const v = (state.settings || {})[noegle];
  if (v === '1') return true;
  if (v === '0') return false;
  if (gammelLokal) {
    try {
      const g = localStorage.getItem(gammelLokal);
      if (g === '1') return true;
      if (g === '0') return false;
    } catch { /* privat tilstand */ }
  }
  return standard;
}

/*
 * Sætter flaget. Opdaterer `state.settings` SYNKRONT, saa kaldsstedet kan
 * tegne om med det samme uden at vente paa en rundtur (~180 ms mod den
 * udgivne server, doda v27). Fejler gemningen, staar valget stadig rigtigt
 * paa skaermen; det er kun "husk det til naeste gang", der gaar tabt.
 */
async function saetBrugerFlag(noegle, vaerdi) {
  const v = vaerdi ? '1' : '0';
  state.settings = Object.assign({}, state.settings, { [noegle]: v });
  try {
    await api('POST', '/api/v1/settings', { [noegle]: v });
  } catch (ex) { toast(`I could not remember that setting: ${ex.message}`); }
}

function toast(besked, handling) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(besked)}</span>`;
  if (handling) {
    const knap = document.createElement('button');
    knap.className = 'toast-action';
    knap.textContent = handling.label;
    knap.addEventListener('click', () => { el.remove(); handling.run(); });
    el.appendChild(knap);
  }
  host.appendChild(el);
  // Fortryd skal kunne naas i ro og mag - 10 sek. er kravet i fase 2.
  setTimeout(() => el.remove(), handling ? 10000 : 3200);
}

/* --------------------------------------------------------------- tema */

function anvendTema(valg) {
  if (valg === 'light' || valg === 'dark') document.documentElement.setAttribute('data-theme', valg);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('tovo_theme', valg); } catch { /* privat tilstand */ }
}

function nuvaerendeTema() {
  try { return localStorage.getItem('tovo_theme') || 'auto'; } catch { return 'auto'; }
}

/* Det tema, man rent faktisk SER. "Follow system" er ikke en tredje farve. */
function visuelTema() {
  const valg = nuvaerendeTema();
  if (valg === 'light' || valg === 'dark') return valg;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/* -------------------------------------------------------------- ikoner */

const ICONS = {
  logo: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.4 2"/>',
  today: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 1.8"/>',
  projects: '<path d="M6.5 20L12 4l5.5 16"/>',
  report: '<path d="M5 19.5h14"/><path d="M7.5 19.5v-6M12 19.5V6M16.5 19.5v-9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6L6 18M18 18l-1.4-1.4M7.4 7.4L6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  play: '<path d="M8.5 6.5l9 5.5-9 5.5z"/>',
  stop: '<rect x="7.5" y="7.5" width="9" height="9" rx="1.5"/>',
  link: '<path d="M10.5 13.5a3.5 3.5 0 005 0l3-3a3.5 3.5 0 00-5-5l-1 1"/><path d="M13.5 10.5a3.5 3.5 0 00-5 0l-3 3a3.5 3.5 0 005 5l1-1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4M17.8 17.8l-1.4-1.4M7.6 7.6L6.2 6.2"/>',
  moon: '<path d="M20 14.6A8.6 8.6 0 019.4 4 8.6 8.6 0 1020 14.6z"/>',
  pin: '<path d="M9 3.5h6l-1 5 3 3.5H7l3-3.5z"/><path d="M12 12v8.5"/>',
  out: '<path d="M14.5 4.5H18a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5h-3.5"/><path d="M4.5 12h10M11 8.5l3.5 3.5-3.5 3.5"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  kalender: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M9 3.5v4M15 3.5v4"/>',
  tags: '<path d="M5 9.5h14M5 14.5h14M10.5 4.5L8.5 19.5M15.5 4.5l-2 15"/>',
};

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* --------------------------------------------------------------- sider */

// Raekkefoelgen her er ogsaa sidebarens.
const VIEWS = [
  { id: 'today', label: 'Today', icon: 'today', group: 1 },
  { id: 'week', label: 'Week', icon: 'kalender', group: 1 },
  { id: 'projects', label: 'Projects', icon: 'projects', group: 1 },
  { id: 'tags', label: 'Tags', icon: 'tags', group: 2 },
  { id: 'report', label: 'Report', icon: 'report', group: 2 },
  // group: 0 = staar IKKE i navigationen. Settings naas fra menuen paa
  // brugerknappen, hvor kontoen i forvejen bor - to indgange til det samme
  // sted er én for meget (§9c).
  { id: 'settings', label: 'Settings', icon: 'settings', group: 0 },
  { id: 'guide', label: 'Guide', icon: 'link', group: 0 },
];

const viewById = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];
const BUND = ['today', 'week', 'projects', 'tags'];

const BESKRIVELSER = {
  today: 'What you have registered today, and what is running right now.',
  week: 'The week as a grid — drag in it to log time.',
  tags: 'Your labels, and how much carries each one.',
  projects: 'Estimate, budget and hours spent — per project.',
  report: 'Hours per project and task for a week you choose.',
  settings: 'Appearance, account and access.',
};

/* ------------------------------------------------------------ optegning */

/** Fuld optegning. Kun ved login/logout - ellers mister soegefeltet fokus. */
function render() {
  const root = document.getElementById('root');
  if (!state.user) { root.innerHTML = gateHtml(); bindGate(); return; }
  root.innerHTML = shellHtml();
  bindShell();
  tegnSide();
}

function gateHtml() {
  const setup = state.config.needsSetup;
  return `
  <div class="gate">
    <div class="card">
      <div class="brand">${icon('logo', 26)} tovo</div>
      <p class="lead" style="text-align:center;margin-bottom:22px">
        ${setup ? 'Pick a username and a password, and you are in.' : 'Sign in to continue.'}
      </p>
      <p class="gate-error" id="gateError" hidden></p>
      <form id="gateForm">
        <label class="field"><span>Username</span>
          <input class="input" id="gateUser" autocomplete="username" autocapitalize="none" required></label>
        <label class="field"><span>Password</span>
          <input class="input" id="gatePass" type="password"
            autocomplete="${setup || state.gateNy ? 'new-password' : 'current-password'}" required></label>
        <label class="field" id="gateKodeFelt" hidden><span>Code from your app</span>
          <input class="input" id="gateKode" inputmode="numeric" autocomplete="one-time-code"
            placeholder="123456 — or a recovery code"></label>
        <button class="btn primary" type="submit" style="width:100%">
          ${setup || state.gateNy ? 'Create account' : 'Sign in'}</button>
      </form>
      ${!setup && !state.gateNy && state.config.passkeys && state.config.hasPasskeys ? `
        <div class="gate-or"><span>or</span></div>
        <button class="btn" id="gatePasskey" style="width:100%">Sign in with a passkey</button>` : ''}
      ${gateSkiftHtml(setup)}
    </div>
  </div>`;
}

/* Registreringslinket vises kun, naar serveren faktisk tager imod en ny
   bruger. Ellers ville det foere til en 403, og det er en daarlig maade at
   fortaelle, at serveren er lukket (§3). */
function gateSkiftHtml(setup) {
  if (setup) return '<p class="gate-note">The first account becomes the administrator.</p>';
  if (!state.config.allowRegistration) return '';
  return state.gateNy
    ? '<p class="gate-note"><button class="linkbtn" id="gateSkift">I already have an account</button></p>'
    : '<p class="gate-note"><button class="linkbtn" id="gateSkift">Create an account</button></p>';
}

function bindGate() {
  const form = document.getElementById('gateForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('gateError');
    err.hidden = true;
    try {
      const nyKonto = state.config.needsSetup || state.gateNy;
      const kodeFelt = document.getElementById('gateKodeFelt');
      const kodeInput = document.getElementById('gateKode');
      const data = await api('POST', nyKonto ? '/api/register' : '/api/login', {
        username: document.getElementById('gateUser').value,
        password: document.getElementById('gatePass').value,
        // Tom ved foerste forsoeg; serveren beder saa om den.
        code: kodeInput && !kodeFelt.hidden ? kodeInput.value.trim() : undefined,
      });
      /*
       * Kodeordet passede, men der mangler et led. Der er INGEN cookie endnu
       * - porten ligger foer sessionen paa serveren (§9d).
       */
      if (data.needsCode) {
        kodeFelt.hidden = false;
        kodeInput.value = '';
        kodeInput.focus();
        return;
      }
      state.user = data.user;
      state.config.needsSetup = false;
      state.gateNy = false;
      // Kom man fra en connector, skal man tilbage til samtykket - ikke ind
      // i appen. Stien er whitelistet: ellers er login-siden en aaben
      // viderestilling, og det er praecis dér, brugeren er indstillet paa at
      // godkende noget (§9a).
      if (fortsaetTilConnector()) return;
      await hentState();
      render();
    } catch (ex) {
      /*
       * `needsCode` paa FEJLEN er det, fladen skelner paa: en forkert
       * engangskode lader feltet blive staaende (proev igen), mens et forkert
       * kodeord folder det vaek - ellers ville man taste en kode ind i en
       * formular, der aldrig naaede til andet trin.
       */
      const kodeFelt = document.getElementById('gateKodeFelt');
      if (kodeFelt) {
        if (ex.needsCode) {
          const k = document.getElementById('gateKode');
          if (k) { k.value = ''; k.focus(); }
        } else {
          kodeFelt.hidden = true;
        }
      }
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  const skift = document.getElementById('gateSkift');
  if (skift) skift.addEventListener('click', () => { state.gateNy = !state.gateNy; render(); });

  const pk = document.getElementById('gatePasskey');
  if (pk) {
    pk.addEventListener('click', async () => {
      const err = document.getElementById('gateError');
      err.hidden = true;
      try {
        const d = await loginMedPasskey();
        state.user = d.user;
        await hentState();
        render();
      } catch (ex) {
        // Brugeren afbroed selv - det er ikke en fejl, der skal vises.
        if (ex.name === 'NotAllowedError') return;
        err.textContent = ex.message || 'The passkey did not work';
        err.hidden = false;
      }
    });
  }
  document.getElementById('gateUser').focus();
}

/* ------------------------------------------------------------ passkeys */

const b64uTilBuf = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const bufTilB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function loginMedPasskey() {
  const o = await api('POST', '/api/webauthn/login/options', {});
  const pk = Object.assign({}, o.publicKey, { challenge: b64uTilBuf(o.publicKey.challenge) });
  const cred = await navigator.credentials.get({ publicKey: pk });
  return api('POST', '/api/webauthn/login/verify', {
    challengeId: o.challengeId,
    id: cred.id,
    clientDataJSON: bufTilB64u(cred.response.clientDataJSON),
    authenticatorData: bufTilB64u(cred.response.authenticatorData),
    signature: bufTilB64u(cred.response.signature),
  });
}

async function opretPasskey(navn) {
  const o = await api('POST', '/api/webauthn/register/options', {});
  const pk = Object.assign({}, o.publicKey, {
    challenge: b64uTilBuf(o.publicKey.challenge),
    user: Object.assign({}, o.publicKey.user, { id: b64uTilBuf(o.publicKey.user.id) }),
    excludeCredentials: (o.publicKey.excludeCredentials || []).map((c) => ({ type: c.type, id: b64uTilBuf(c.id) })),
  });
  const cred = await navigator.credentials.create({ publicKey: pk });
  return api('POST', '/api/webauthn/register/verify', {
    challengeId: o.challengeId,
    name: navn,
    clientDataJSON: bufTilB64u(cred.response.clientDataJSON),
    attestationObject: bufTilB64u(cred.response.attestationObject),
  });
}

/* ------------------------------------------------------------- skallen */

/* Projektlisten i menuen kan foldes ud. Valget huskes - en menu, der falder
   sammen ved hver optegning, er mere til besvaer end til hjaelp. */
function projekterAabne() {
  try { return localStorage.getItem('tovo_nav_projekter') !== '0'; } catch { return true; }
}

function saetProjekterAabne(aabne) {
  try { localStorage.setItem('tovo_nav_projekter', aabne ? '1' : '0'); } catch { /* privat */ }
}

function navHtml() {
  const iNav = VIEWS.filter((v) => v.group > 0);
  const grupper = [...new Set(iNav.map((v) => v.group))];
  const aabne = projekterAabne();
  return grupper.map((g) => `<nav class="nav">${iNav.filter((v) => v.group === g).map((v) => {
    const paaSiden = v.id === state.view ? 'aria-current="page"' : '';
    if (v.id !== 'projects') {
      return `<button class="nav-item" data-view="${v.id}" ${paaSiden}>
        ${icon(v.icon)}<span>${esc(v.label)}</span></button>`;
    }
    // Selve raekken navigerer; chevronen folder ud. To ting i én raekke, men
    // to forskellige maal - derfor to knapper og ikke én.
    return `<div class="nav-med-fold">
        <button class="nav-item" data-view="projects" ${paaSiden}>
          ${icon(v.icon)}<span>${esc(v.label)}</span>
          ${state.projects.length ? `<span class="nav-count">${state.projects.length}</span>` : ''}
        </button>
        ${state.projects.length ? `<button class="foldbtn${aabne ? ' on' : ''}" id="foldProjekter"
          aria-label="${aabne ? 'Hide the projects' : 'Show the projects'}"
          aria-expanded="${aabne ? 'true' : 'false'}">${icon('chevron', 14)}</button>` : ''}
      </div>
      ${aabne && state.projects.length ? `<div class="nav-under">${state.projects.map((p) => `
        <button class="nav-item nav-sub" data-projekt="${esc(p.id)}"
          ${state.view === 'projects' && state.openProject === p.id ? 'aria-current="page"' : ''}>
          <span class="nav-prik"></span><span>${esc(p.name)}</span></button>`).join('')}
        ${state.unassigned ? `<button class="nav-item nav-sub" data-projekt="${INTET_PROJEKT}"
          ${state.view === 'projects' && state.openProject === INTET_PROJEKT ? 'aria-current="page"' : ''}>
          <span class="nav-prik tom"></span><span>No project</span>
          <span class="nav-count">${state.unassigned}</span></button>` : ''}</div>` : ''}`;
  }).join('')}</nav>`).join('');
}

function shellHtml() {
  return `
  <button class="btn navtoggle" id="navToggle" aria-label="Menu">${icon('menu')}</button>
  <div class="backdrop" id="backdrop"></div>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">${icon('logo', 24)} <span style="flex:1">tovo</span>
        <button class="pinbtn" id="pinBtn" aria-label="Hide the menu"
          title="Hide the menu">${icon('pin', 16)}</button></div>
      <div id="navHost">${navHtml()}</div>
      <div class="sidebar-foot">
        <div id="timerHost"></div>
        <button class="nav-item" id="userBtn"
          ${state.view === 'settings' ? 'aria-current="page"' : ''}>${icon('settings')}<span>${esc(state.user.username)}</span></button>
        <div class="foot-row" id="footRow">${versionHtml()}${temaKnapHtml()}</div>
      </div>
    </aside>
    <main class="main">
      <div class="rulvagt" id="rulVagt"></div>
      <div class="topbar">
        <div class="toprow">
          <div class="stats meta" id="statsHost">${statsHtml()}</div>
        </div>
        <div class="omni-card" id="omniCard">
          <div class="omni-field">
            <span class="omni-icon">${icon('search', 22)}</span>
            <span class="omni-mode" id="omniMode" hidden></span>
            <input class="omni-input" id="omni" autocomplete="off" spellcheck="false"
              placeholder="Search — or start a line with + to create">
          </div>
          <div class="omni-panel" id="omniPanel" hidden></div>
          <div class="omni-legend meta" id="omniLegend"></div>
        </div>
        <div class="omni-chips" id="omniChips"></div>
      </div>
      <div id="pageHost"></div>
    </main>
  </div>
  <nav class="bottomnav" id="bottomNav">
    ${BUND.map((id) => {
    const v = viewById(id);
    return `<button class="bottomnav-item" data-view="${v.id}" ${v.id === state.view ? 'aria-current="page"' : ''}>
        ${icon(v.icon, 21)}<span>${esc(v.label)}</span></button>`;
  }).join('')}
  </nav>`;
}

/*
 * Versionen, altid synlig. Det er SAMME tal som runens version: i panelet -
 * build_rune.py stempler APP_VERSION i index.html og i runen paa én gang.
 *
 * Serveren melder sit eget tal i /api/public-config. Er de to forskellige,
 * er app.js i browserens cache aeldre end den, serveren udleverer - og saa er
 * det dét, brugeren skal vide.
 */
function versionHtml() {
  const server = state.config.version;
  if (server && server !== APP_VERSION) {
    return `<button class="version-line meta version-old" id="versionBtn"
      title="Your browser is running v${APP_VERSION}, but the server has v${server}. Click to reload.">
      v${APP_VERSION} · v${server} available — reload</button>`;
  }
  return `<div class="version-line meta">v${esc(String(APP_VERSION))}</div>`;
}

/* Knappen viser det tema, man skifter TIL - ikke det, man er i. */
function temaKnapHtml() {
  const naeste = visuelTema() === 'dark' ? 'light' : 'dark';
  return `<button class="temabtn" id="temaBtn" data-naeste="${naeste}"
    aria-label="Switch to ${naeste} theme" title="Switch to ${naeste} theme">
    ${icon(naeste === 'dark' ? 'moon' : 'sun', 16)}</button>`;
}

function opdaterTemaKnap() {
  const gammel = document.getElementById('temaBtn');
  if (!gammel) return;
  gammel.outerHTML = temaKnapHtml();
  bindTemaKnap();
}

/**
 * "vN - vM available - reload".
 *
 * Cachen ryddes BEGGE veje: fra siden OG ved at bede service workeren om det
 * selv. Handleren har ligget i sw.js hele tiden, men beskeden blev aldrig
 * sendt - og en SW, der stadig styrer siden, kan servere den gamle fil igen,
 * lige efter man har ryddet fra siden (doda).
 */
function bindVersionKnap() {
  const el = document.getElementById('versionBtn');
  if (!el) return;
  el.addEventListener('click', async () => {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage('ryd');
      }
      if (window.caches) await Promise.all((await caches.keys()).map((n) => caches.delete(n)));
    } catch { /* uden cache-api er der ikke noget at rydde */ }
    location.reload();
  });
}

/**
 * Opdager en ny version, MENS appen ligger aaben.
 *
 * `state.config` blev kun hentet ÉN gang - ved opstart. En web app paa
 * hjemmeskaermen genindlaeses stort set aldrig, saa paa telefonen kunne
 * serveren staa paa vN+1 i dagevis, uden at knappen nogensinde dukkede op.
 * Service workeren opdaterer sig selv (registrerSW), men det er den STILLE
 * vej; det her er den, brugeren kan se og selv trykke paa.
 *
 * Kun foden tegnes om. En baggrundshentning maa goere siden nyere, aldrig
 * tommere - og en fejl her skal ikke kunne erstatte noget med en fejlside.
 */
const versionTjek = { sidst: 0 };

async function tjekVersion() {
  if (document.visibilityState !== 'visible') return;
  /*
   * Kort spaerre. `focus` fyrer, hver gang man klikker tilbage i vinduet paa
   * desktop, og et delings-ark eller et tilladelses-pop-up, der blinker forbi
   * paa telefonen, sender ogsaa en visibilitychange (doda v26). Uden den her
   * koster hvert eneste skift et kald.
   */
  if (Date.now() - versionTjek.sidst < 3000) return;
  versionTjek.sidst = Date.now();
  try {
    const c = await api('GET', '/api/public-config');
    if (!c || !c.version || c.version === (state.config || {}).version) return;
    state.config = c;
    const rad = document.getElementById('footRow');
    if (!rad) return;
    rad.innerHTML = versionHtml() + temaKnapHtml();
    bindVersionKnap();
    bindTemaKnap();
  } catch { /* offline: proev igen naar appen kommer frem */ }
}

/**
 * Sagu-afsnittet under Settings.
 *
 * Tegnes for sig og hentes ved AABNING af siden - ikke ved hver optegning.
 * Et kald til Sagu pr. render er praecis det, Sagus egen bro forbyder
 * (RUNE-ERFARINGER, doda v27: taeal blokerende rundture, ikke millisekunder).
 *
 * Noeglen vises aldrig igen: serveren melder kun OM der er en. Feltet staar
 * derfor tomt ved en genforbindelse, og en tom noegle betyder "behold den,
 * der staar" - ellers kunne man ikke rette adressen uden at finde noeglen
 * frem paa ny.
 */
async function tegnSaguKort() {
  const vaert = document.getElementById('saguKort');
  if (!vaert) return;
  let d;
  try { d = await api('GET', '/api/v1/sagu'); } catch (ex) {
    vaert.innerHTML = `<p class="gate-error">${esc(ex.message)}</p>`;
    return;
  }
  const boeger = d.notebooks || [];
  vaert.innerHTML = `
    ${d.connected ? `<p class="meta">Connected to <strong>${esc(d.url)}</strong>.</p>` : ''}
    <label class="field"><span>Sagu address</span>
      <input class="input" id="saguUrl" placeholder="https://sagu.example.com"
        value="${esc(d.url || '')}"></label>
    <label class="field"><span>API key${d.connected ? ' — leave empty to keep the one you have' : ''}</span>
      <input class="input" id="saguKey" type="password" autocomplete="off"
        placeholder="${d.connected ? '••••••••' : 'Paste a "link" key from Sagu'}"></label>
    <p class="meta">In Sagu: Settings → Access keys → new key with the <code>link</code> scope.
      It can search and create notes, and it cannot delete anything.</p>
    ${d.connected && boeger.length ? `<label class="field"><span>Where new notes go</span>
      <select class="input" id="saguBog">
        <option value="">No notebook</option>
        ${boeger.map((b) => `<option value="${esc(b.id)}"${d.notebook === b.id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}
      </select></label>` : ''}
    <div class="row">
      <button class="btn primary" id="saguGem">${d.connected ? 'Reconnect' : 'Connect'}</button>
      ${d.connected ? '<button class="btn" id="saguFrisk">Refresh notebooks</button>' : ''}
      ${d.connected ? '<span style="flex:1"></span><button class="btn danger" id="saguFra">Disconnect</button>' : ''}
    </div>`;

  document.getElementById('saguGem').addEventListener('click', async () => {
    const knap = document.getElementById('saguGem');
    knap.disabled = true;
    try {
      const r = await api('POST', '/api/v1/sagu', {
        url: document.getElementById('saguUrl').value.trim(),
        key: document.getElementById('saguKey').value.trim(),
      });
      toast(`Connected to Sagu — ${r.notes} note${r.notes === 1 ? '' : 's'}.`);
      await tegnSaguKort();
    } catch (ex) { toast(ex.message); knap.disabled = false; }
  });

  const frisk = document.getElementById('saguFrisk');
  if (frisk) {
    frisk.addEventListener('click', async () => {
      try {
        const r = await api('POST', '/api/v1/sagu/refresh', {});
        toast(`${(r.notebooks || []).length} notebook${(r.notebooks || []).length === 1 ? '' : 's'}.`);
        await tegnSaguKort();
      } catch (ex) { toast(ex.message); }
    });
  }

  const bog = document.getElementById('saguBog');
  if (bog) {
    bog.addEventListener('change', async () => {
      try {
        await api('POST', '/api/v1/sagu/notebook', { id: bog.value });
        toast('Saved.');
      } catch (ex) { toast(ex.message); }
    });
  }

  const fra = document.getElementById('saguFra');
  if (fra) {
    fra.addEventListener('click', async () => {
      try {
        await api('POST', '/api/v1/sagu/disconnect', {});
        toast('Sagu disconnected. The notes are untouched.');
        await tegnSaguKort();
      } catch (ex) { toast(ex.message); }
    });
  }
}

/*
 * Til toppen - uden at gaette paa hvem der ruller.
 *
 * `window.scrollTo()` gaar til den boks, browseren har udpeget som rullende.
 * Under mobilgraensen er dét ikke `window`: `html, body { height: 100% }`
 * (globalt) plus `html, body { overflow-x: hidden }` (i @media) goer BODY til
 * rullekassen. Saa gaar `window.scrollTo(0, 0)` ingen steder, og `scrollY`
 * staar paa 0, uanset hvor langt nede man er.
 *
 * Foelgen var stille og irriterende: skiftede man side paa telefonen, blev
 * man staaende i den gamle rulleposition og landede midt i den nye side.
 *
 * De tre linjer koster intet. Den, der ikke ruller, ignorerer sit nul - og
 * saa behoever koden her ikke vide, hvilken af dem det er. Fundet i doda
 * (v61) og meldt herover; tovo har de samme to CSS-regler.
 */
function tilToppen() {
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
}

/*
 * `body.rullet` - er siden rullet ned fra toppen?
 *
 * Den klaebende topbjaelke bruger den til at folde tallene og legenden
 * sammen, saa kun soegefeltet bliver staaende.
 *
 * ── En VAGTPOST, ikke en scroll-lytter (laant fra Sagu) ───────────────────
 *
 * En `scroll`-lytter er i princippet rigtig og i praksis skroebelig: den
 * skal vide HVEM der ruller (`window.scrollY` mod et elements `scrollTop`),
 * og en programmatisk rulning kan give NUL haendelser, mens klassen bliver
 * haengende i den forkerte stilling.
 *
 * En `IntersectionObserver` paa en usynlig vagtpost lige OVER bjaelken
 * spoerger om det, der faktisk betyder noget: er toppen af siden ude af
 * billedet? Den er ligeglad med hvem der ruller og fyrer uden en haendelse
 * pr. billede.
 *
 * En observer paa selve BJAELKEN ville aldrig fyre - den er sticky og
 * forlader aldrig skaermen. Derfor vagtposten.
 *
 * `rootMargin` giver hysterese: uden den blafrer bjaelken lige paa graensen,
 * fordi sammenfoldningen selv flytter indholdet.
 */
function registrerRullevagt() {
  const vagt = document.getElementById('rulVagt');
  if (!vagt || !('IntersectionObserver' in window)) {
    // Uden observer: ingen sammenfoldning. Bjaelken klaeber stadig - man
    // mister kun den ekstra plads, og det er bedre end en klasse, der
    // saetter sig fast i den forkerte stilling.
    return;
  }
  new IntersectionObserver(([post]) => {
    document.body.classList.toggle('rullet', !post.isIntersecting);
  }, { rootMargin: '-8px 0px 0px 0px', threshold: 0 }).observe(vagt);
}

/**
 * Totrinsbekraeftelsen under Settings.
 *
 * Tre tilstande, ikke to: FRA, PAABEGYNDT (hemmeligheden findes, men koden er
 * ikke bekraeftet) og TIL. Uden den midterste ville fladen vise »slaa til« til
 * en, der staar midt i opsaetningen.
 */
async function tegnTotpKort() {
  const vaert = document.getElementById('totpKort');
  if (!vaert) return;
  let d;
  try { d = await api('GET', '/api/v1/totp'); } catch (ex) {
    vaert.innerHTML = `<p class="gate-error">${esc(ex.message)}</p>`;
    return;
  }

  if (d.enabled) {
    vaert.innerHTML = `
      <p class="meta">On. You need a code from your app to sign in.
        <strong>${d.recoveryLeft}</strong> recovery code${d.recoveryLeft === 1 ? '' : 's'} left.</p>
      <div class="row">
        <button class="btn" id="totpNyeKoder">New recovery codes</button>
        <span style="flex:1"></span>
        <button class="btn danger" id="totpFra">Turn off</button>
      </div>
      <div id="totpKoder"></div>`;

    document.getElementById('totpNyeKoder').addEventListener('click', async () => {
      try {
        const r = await api('POST', '/api/v1/totp/recovery', {});
        visGenoprettelseskoder(r.recoveryCodes);
        toast('Ten new codes. The old ones no longer work.');
        await tegnTotpKort();
      } catch (ex) { toast(ex.message); }
    });

    // At slaa FRA kraever en kode. En aaben fane paa en laant maskine skal
    // ikke kunne fjerne det andet led med ét klik.
    document.getElementById('totpFra').addEventListener('click', async () => {
      const kode = prompt('Enter a code from your app (or a recovery code) to turn two-factor off:');
      if (kode === null) return;
      try {
        await api('POST', '/api/v1/totp/disable', { code: kode.trim() });
        toast('Two-factor is off.');
        await tegnTotpKort();
      } catch (ex) { toast(ex.message); }
    });
    return;
  }

  vaert.innerHTML = `
    <p class="meta">Off. Your password is the only thing needed to sign in.</p>
    <div class="row"><button class="btn primary" id="totpStart">${d.pending ? 'Start over' : 'Set up two-factor'}</button></div>
    <div id="totpOpsaet"></div>`;

  document.getElementById('totpStart').addEventListener('click', async () => {
    try {
      const r = await api('POST', '/api/v1/totp/setup', {});
      const host = document.getElementById('totpOpsaet');
      host.innerHTML = `
        <p class="meta" style="margin-top:14px">Scan this with your authenticator app, then type
          the six digits it shows.</p>
        <div class="totp-qr">${r.svg}</div>
        <p class="meta">Cannot scan? Type this key in by hand:
          <code class="totp-hem">${esc(r.secret)}</code></p>
        <div class="row">
          <input class="input" id="totpKode" inputmode="numeric" autocomplete="one-time-code"
            maxlength="6" placeholder="123456" style="max-width:140px">
          <button class="btn primary" id="totpBekraeft">Turn it on</button>
        </div>`;
      const bekraeft = async () => {
        try {
          const svar = await api('POST', '/api/v1/totp/enable',
            { code: document.getElementById('totpKode').value.trim() });
          visGenoprettelseskoder(svar.recoveryCodes);
          toast('Two-factor is on.');
          await tegnTotpKort();
        } catch (ex) { toast(ex.message); }
      };
      document.getElementById('totpBekraeft').addEventListener('click', bekraeft);
      document.getElementById('totpKode').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); bekraeft(); }
      });
      document.getElementById('totpKode').focus();
    } catch (ex) { toast(ex.message); }
  });
}

/**
 * Koderne vises ÉN gang.
 *
 * De gemmes hashet og kan aldrig laeses igen - derfor en rude, man selv skal
 * lukke, og ikke en linje, der forsvinder ved naeste optegning.
 */
function visGenoprettelseskoder(koder) {
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
    <div class="modal-card" role="dialog" aria-label="Recovery codes">
      <h2>Recovery codes</h2>
      <p class="meta">Keep these somewhere safe — on paper is fine. Each one works once, and
        they are the only way in if you lose your phone. <strong>They are shown once.</strong></p>
      <ul class="plain totp-koder">${koder.map((k) => `<li><code>${esc(k)}</code></li>`).join('')}</ul>
      <div class="modal-foot">
        <button class="btn" id="kodeKopi">Copy them</button>
        <span style="flex:1"></span>
        <button class="btn primary" id="kodeLuk">I have saved them</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  document.getElementById('kodeKopi').addEventListener('click', async () => {
    toast(await kopier(koder.join('\n')) ? 'Copied.' : 'Could not copy — write them down instead.');
  });
  document.getElementById('kodeLuk').addEventListener('click', () => host.remove());
}

function bindTemaKnap() {
  const el = document.getElementById('temaBtn');
  if (!el) return;
  el.addEventListener('click', () => {
    anvendTema(el.dataset.naeste);
    opdaterTemaKnap();
    if (state.view === 'settings') tegnSide();
  });
}

function statsHtml() {
  const c = state.counts || {};
  const flertal = (n, ord) => `${n} ${ord}${n === 1 ? '' : 's'}`;
  const dele = [`${c.tasks || 0} open`, flertal(c.projects || 0, 'project')];
  if (c.done) dele.push(`${c.done} done`);
  return dele.map((d) => `<span>${esc(d)}</span>`).join('');
}

function bindNav() {
  document.querySelectorAll('#navHost .nav-item[data-view]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.view));
  });
  document.querySelectorAll('#navHost [data-projekt]').forEach((el) => {
    el.addEventListener('click', () => gaaTil('projects', { project: el.dataset.projekt }));
  });
  const fold = document.getElementById('foldProjekter');
  if (fold) {
    fold.addEventListener('click', () => {
      saetProjekterAabne(!projekterAabne());
      opdaterNav();
    });
  }
}

function opdaterNav() {
  // Taellerne staar i skallen, som render() kun tegner ved login/logout.
  // Uden denne linje blev de staaende paa 0, mens listen viste opgaver -
  // og et tal, der ser rigtigt ud, men er forkert, er vaerre end intet.
  const stats = document.getElementById('statsHost');
  if (stats) stats.innerHTML = statsHtml();
  const host = document.getElementById('navHost');
  if (host) host.innerHTML = navHtml();
  bindNav();
  document.querySelectorAll('.bottomnav-item[data-view]').forEach((el) => {
    el.setAttribute('aria-current', el.dataset.view === state.view ? 'page' : 'false');
  });
  const ub = document.getElementById('userBtn');
  if (ub) ub.setAttribute('aria-current', state.view === 'settings' ? 'page' : 'false');
}

function bindShell() {
  saetNavSkjult(navErSkjult());
  bindNav();
  document.querySelectorAll('.bottomnav-item[data-view]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.view));
  });
  document.getElementById('userBtn').addEventListener('click', visBrugerMenu);
  document.getElementById('pinBtn').addEventListener('click', () => {
    const skjul = !document.body.classList.contains('navskjult');
    saetNavSkjult(skjul);
    if (skjul) document.body.classList.remove('navopen');
  });
  bindTemaKnap();
  bindVersionKnap();
  registrerRullevagt();
  document.getElementById('navToggle').addEventListener('click', () => document.body.classList.toggle('navopen'));
  document.getElementById('backdrop').addEventListener('click', () => document.body.classList.remove('navopen'));
  bindOmni();
  // Timeren tegnes IGEN her. hentState() koerer FOER skallen findes ved
  // opstart, saa #timerHost fandtes ikke, og timeren faldt tilbage til den
  // flydende bjaelke - ogsaa paa en bred skaerm. Symptomet var, at den
  // flyttede sig ved en genindlaesning.
  tegnTimerBjaelke();
}

function gaaTil(view, opt) {
  const skifter = state.view !== view;
  state.view = view;
  /*
   * Projektet nulstilles ALTID, medmindre kaldet selv angiver et.
   *
   * Foer stod der `if (skifter) state.openProject = null`, og saa gjorde
   * "← Projects" inde fra et projekt ingenting: view'et var allerede
   * 'projects', saa der var intet "skift", og det aabne projekt blev
   * staaende. Knappen saa ud til at vaere doed. Naar en tilstand hoerer til
   * en SIDE og ikke til et view, skal den ryddes af den, der navigerer.
   */
  state.openProject = (opt && opt.project !== undefined) ? opt.project : null;
  state.openTag = (opt && opt.tag !== undefined) ? opt.tag : (view === 'tags' ? state.openTag : null);
  document.body.classList.remove('navopen');
  opdaterNav();
  // Feltet arbejder i den side, man staar paa - og skal vise det.
  opdaterOmniKontekst();
  tegnSide();
  // Scroll kun til toppen ved REELT sideskift - ellers kastes brugeren op,
  // hver gang en inline-redigering gentegner samme side (Beanledger v24).
  if (skifter) tilToppen();
}

async function genindlaes() {
  await hentState();
  opdaterNav();
  await tegnSide();
}

async function hentState() {
  try {
    const d = await api('GET', '/api/v1/state');
    state.user = d.user || state.user;
    state.today = d.today;
    state.settings = d.settings || {};
    state.projects = d.projects || [];
    state.tags = d.tags || [];
    state.unassigned = d.unassigned || 0;
    state.counts = d.counts || {};
    state.todayMinutes = d.todayMinutes || 0;
    // Den koerende timer foelger med hvert state-kald, saa bjaelken er rigtig
    // i enhver visning - ogsaa hvis timeren blev startet fra en anden fane.
    timerState.data = d.timer || null;
    tegnTimerBjaelke();
    if (d.global) state.config.allowRegistration = d.global.allowRegistration;
  } catch (ex) {
    if (ex.status !== 401) toast(ex.message);
  }
}

/* ------------------------------------------------------ sidebaren */

/*
 * Sidebaren kan foldes helt vaek, saa der kun staar en hamburger tilbage.
 * Skjult ligger den som et OVERLAY over indholdet i stedet for at skubbe det -
 * ellers hopper hele siden, hver gang man kigger i menuen (§9c).
 */
function navErSkjult() {
  try { return localStorage.getItem('tovo_nav_skjult') === '1'; } catch { return false; }
}

function saetNavSkjult(skjult) {
  try { localStorage.setItem('tovo_nav_skjult', skjult ? '1' : '0'); } catch { /* privat */ }
  document.body.classList.toggle('navskjult', skjult);
  if (!skjult) document.body.classList.remove('navopen');
  // Popovers haenger fast paa knapper i sidebaren. Foldes den vaek, mens en
  // menu staar aaben, bliver menuen svaevende tilbage over ingenting.
  const menu = document.getElementById('userMenu');
  if (menu) menu.remove();
  const knap = document.getElementById('pinBtn');
  if (knap) {
    const tekst = skjult ? 'Keep the menu open' : 'Hide the menu';
    knap.setAttribute('aria-label', tekst);
    knap.title = tekst;
    knap.classList.toggle('off', skjult);
  }
}

/* --------------------------------------------------- brugermenuen */

function visBrugerMenu() {
  const gammel = document.getElementById('userMenu');
  if (gammel) { gammel.remove(); return; }
  const anker = document.getElementById('userBtn');
  if (!anker) return;

  const host = document.createElement('div');
  host.className = 'usermenu';
  host.id = 'userMenu';
  host.innerHTML = `
    <div class="usermenu-head">
      <div class="usermenu-name">${esc(state.user.username)}</div>
      <div class="meta">${state.user.isAdmin ? 'Administrator' : 'Signed in'}${state.config.secureContext ? '' : ' · plain http'}</div>
    </div>
    <button class="usermenu-item" data-go="settings">${icon('settings', 17)}<span>Settings</span></button>
    <button class="usermenu-item" data-go="guide">${icon('link', 17)}<span>Guide</span></button>
    <button class="usermenu-item" data-go="shortcuts">${icon('link', 17)}<span>Keyboard shortcuts</span></button>
    <button class="usermenu-item danger" data-go="logout">${icon('out', 17)}<span>Log out</span></button>`;

  const r = anker.getBoundingClientRect();
  host.style.left = `${Math.round(r.left)}px`;
  host.style.bottom = `${Math.round(window.innerHeight - r.top + 8)}px`;
  document.body.appendChild(host);

  const luk = () => host.remove();
  host.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', async () => {
      const hvad = el.dataset.go;
      luk();
      if (hvad === 'settings') gaaTil('settings');
      else if (hvad === 'guide') gaaTil('guide');
      else if (hvad === 'shortcuts') visGenveje();
      else {
        await api('POST', '/api/logout', {});
        state.user = null;
        render();
      }
    });
  });
  // setTimeout, saa klikket der AABNEDE menuen ikke lukker den med det samme.
  setTimeout(() => {
    document.addEventListener('click', function udenfor(e) {
      if (host.isConnected && !host.contains(e.target) && e.target !== anker) {
        luk();
        document.removeEventListener('click', udenfor);
      }
    });
  }, 0);
}

/* --------------------------------------------------------------- sider */

async function tegnSide() {
  const host = document.getElementById('pageHost');
  if (!host) return;
  const v = viewById(state.view);
  // .page er dodas indholdsbredde (760 px). .main centrerer sine boern, saa
  // uden wrapperen bliver siden shrink-to-fit og staar midt paa skaermen.
  if (state.view === 'settings') {
    host.innerHTML = `<div class="page">${await settingsHtml()}</div>`;
    bindSettings();
    return;
  }
  if (state.view === 'today') { await tegnIDag(); return; }
  if (state.view === 'projects') { await tegnProjekter(); return; }
  if (state.view === 'week') { await tegnKalender(); return; }
  if (state.view === 'tags') { await tegnTags(); return; }
  if (state.view === 'report') { await tegnRapport(); return; }
  if (state.view === 'guide') { host.innerHTML = sideGuide(); bindGuide(); return; }
  host.innerHTML = `<div class="page">
    <h1>${esc(v.label)}</h1>
    <p class="lead">${esc(BESKRIVELSER[v.id] || '')}</p>
    ${tomHtml(v.id)}</div>`;
}

/* Aerlige tomme tilstande. De skal sige hvad der KOMMER, ikke lade som om
   siden er faerdig - fase 0 er skelettet. */
function tomHtml(view) {
  // Kun de sider, der endnu ikke findes. Tomme tilstande for de RIGTIGE sider
  // hoerer hjemme i visningen selv, hvor de kender indholdet.
  const tekst = { report: 'The weekly report arrives in phase 6.' }[view];
  return `<div class="empty"><p>${esc(tekst || '')}</p></div>`;
}

async function settingsHtml() {
  const pk = await api('GET', '/api/v1/passkeys').catch(() => ({ credentials: [], blocked: null }));
  const kal = await api('GET', '/api/v1/ical').catch(() => ({ feed: null, alarm: 15 }));
  const n = await api('GET', '/api/v1/keys').catch(() => ({ keys: [], connections: [], mcpUrl: '' }));
  const tema = nuvaerendeTema();
  const knap = (id, navn) => `<button class="btn ${tema === id ? 'primary' : ''}" data-tema="${id}">${navn}</button>`;
  return `
    <h1>Settings</h1>
    <p class="lead">${esc(BESKRIVELSER.settings)}</p>

    <!-- Samme indgang som doda og sagu har: sig hvad siden RUMMER, foer den
         ruller. Ellers er den en stak kort, man scroller i for at finde ud
         af, om det man leder efter overhovedet er her. -->
    <div class="card">
      <h2>What you can set here</h2>
      <p class="meta">How tovo looks, who you are, and what it is connected to. The
        <button class="linkbtn" data-go-guide>Guide</button> explains how the app itself works.</p>
      <p class="meta">Rounding, the normal week and the timer warning are yours alone —
        another user on this server has their own.</p>
    </div>

    <div class="card">
      <h2>Capture syntax</h2>
      <p class="meta">What the search field understands. The same list is in the Guide, and
        it comes from the same place in the code, so the two cannot drift apart.</p>
      <table class="shortcuts">
        <tr><td><kbd>+ text</kbd></td><td>Create a task</td></tr>
        <tr><td><kbd>@name</kbd></td><td>Put it under a project — <code>@"Two words"</code></td></tr>
        <tr><td><kbd>#name</kbd></td><td>Set a tag</td></tr>
        <tr><td><kbd>:SAG-1234</kbd></td><td>Case number — inherited from the project</td></tr>
        <tr><td><kbd>~2,5t</kbd></td><td>Estimate — <code>~90m</code>, <code>~1t30m</code></td></tr>
        <tr><td><kbd>!friday</kbd></td><td>Due date — <code>!every monday</code> repeats</td></tr>
        <tr><td><kbd>%</kbd></td><td>Create it and start the timer at once</td></tr>
        <tr><td><kbd>// text</kbd></td><td>Everything after becomes the description</td></tr>
      </table>
    </div>

    <div class="card">
      <h2>Appearance</h2>
      <div class="row">${knap('auto', 'Follow system')}${knap('light', 'Light')}${knap('dark', 'Dark')}</div>
    </div>

    <div class="card">
      <h2>Account</h2>
      <p class="meta">${esc(state.user.username)}${state.user.isAdmin ? ' · administrator' : ''}</p>
      <form id="pwForm">
        <label class="field"><span>Current password</span>
          <input class="input" id="pwCur" type="password" autocomplete="current-password"></label>
        <label class="field"><span>New password</span>
          <input class="input" id="pwNew" type="password" autocomplete="new-password"></label>
        <button class="btn" type="submit">Change password</button>
      </form>
    </div>

    <div class="card">
      <h2>Claude and other clients</h2>
      <p class="meta">tovo speaks MCP, so Claude can start timers, log time afterwards and read
        the weekly report — with exactly the same numbers you see here.</p>
      <p class="meta startlink-url" id="mcpUrl">${esc(n.mcpUrl)}</p>
      <div class="row">
        <button class="btn" id="mcpCopy">Copy the address</button>
      </div>
      <p class="meta">In <strong>claude.ai</strong> or the desktop app: add it as a custom
        connector and sign in — you will be asked to allow it. In <strong>Claude Code</strong>
        you need a key below instead.</p>

      <h2 style="margin-top:20px">Access keys</h2>
      ${n.keys.length ? `<ul class="plain">${n.keys.map((k) => `
        <li><span class="post-main"><span>${esc(k.name)}</span>
          <span class="meta">${esc(k.scope)} · tovo_${esc(k.prefix)}…
            ${k.last_used_at ? `· last used ${esc(visTidspunkt(k.last_used_at))}` : '· never used'}</span></span>
          <button class="linkbtn" data-noegle="${esc(k.id)}">revoke</button></li>`).join('')}</ul>`
    : '<p class="meta">No keys yet.</p>'}
      <div class="row">
        <input class="input" id="keyName" placeholder="What is it for?" style="flex:1">
        <select class="input" id="keyScope" style="flex:none;width:auto">
          <option value="full">full — read and write</option>
          <option value="read">read only</option>
          <option value="capture">capture only</option>
        </select>
        <button class="btn" id="keyAdd">Create a key</button>
      </div>
      <p class="meta">A key is shown <strong>once</strong>. Only its hash is stored, so a lost
        key cannot be read back — make a new one.</p>

      ${n.connections.length ? `<h2 style="margin-top:20px">Connected apps</h2>
        <ul class="plain">${n.connections.map((c) => `
          <li><span class="post-main"><span>${esc(c.name)}</span>
            <span class="meta">${c.last_used_at ? `last used ${esc(visTidspunkt(c.last_used_at))}` : 'not used yet'}</span></span>
            <button class="linkbtn" data-forbindelse="${esc(c.id)}">disconnect</button></li>`).join('')}</ul>` : ''}
    </div>

    <div class="card">
      <h2>Calendar</h2>
      <p class="meta">Tasks with a date become appointments in your own calendar. The address
        is the secret — anyone who has it can read the feed, and revoking it kills every copy.</p>
      ${kal.feed ? `
        <p class="meta startlink-url" id="icalUrl">${esc(kal.feed.url)}</p>
        <div class="row">
          <button class="btn" id="icalCopy">Copy the address</button>
          <button class="linkbtn" id="icalRevoke">revoke</button>
        </div>`
    : '<div class="row"><button class="btn" id="icalCreate">Create a calendar feed</button></div>'}
      <label class="field" style="margin-top:14px"><span>Reminder before an appointment</span>
        <select class="input" id="icalAlarm">
          ${[['-1', 'No reminder'], ['0', 'At the time'], ['5', '5 minutes before'],
    ['15', '15 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before']]
    .map(([v, n]) => `<option value="${v}"${String(kal.alarm) === v ? ' selected' : ''}>${n}</option>`).join('')}
        </select></label>
      <p class="meta">Reminders are only set on tasks that have a <strong>time</strong> —
        an all-day task would ring at midnight.</p>
      <p class="meta"><strong>Two things worth knowing.</strong> Outlook refreshes a subscribed
        calendar every 3–24 hours on its own schedule, so a task you add now may take a while to
        appear. And on iOS you must turn <strong>“Remove Alarms”</strong> off when you add the
        subscription — otherwise the phone strips the reminders without telling you.</p>
    </div>

    <div class="card">
      <h2>Two-factor</h2>
      <p class="meta">A code from an authenticator app, on top of your password. Unlike a
        passkey it works over plain http too — which is how this server is reached from
        the panel, and where the password alone would otherwise be the only thing between
        your data and whoever has it.</p>
      <div id="totpKort" class="meta">Loading…</div>
    </div>

    <div class="card">
      <h2>Passkeys</h2>
      ${pk.blocked ? `<p class="meta">${esc(pk.blocked)}</p>` : `
        <p class="meta">A passkey is an extra way in — it never replaces the password.</p>
        <div class="row"><button class="btn" id="pkAdd">Add a passkey</button></div>`}
      ${pk.credentials.length ? `<ul class="plain">${pk.credentials.map((c) => `
        <li>${esc(c.name)} <button class="linkbtn" data-pk="${esc(c.id)}">remove</button></li>`).join('')}</ul>` : ''}
    </div>

    <div class="card">
      <h2>Sagu</h2>
      <p class="meta">Sagu is where the notes live. Connect it, and a task can point at a
        note — you read it, and answer its comments, without leaving tovo.</p>
      <div id="saguKort" class="meta">Loading…</div>
    </div>

    <div class="card">
      <h2>Case numbers</h2>
      <p class="meta">A task can carry the number the hours are booked against in your other
        system — write <code>:SAG-1234</code> when you capture it, or set one on the project so
        every task inherits it.</p>
      <label class="field"><span>Link to open a case</span>
        <input class="input" id="setCaseUrl" placeholder="https://firma.service-now.com/nav_to.do?uri=/task.do?sysparm_query=number={case}"
          value="${esc((state.settings || {}).case_url || '')}"></label>
      <p class="meta">Put <code>{case}</code> where the number goes. Then every case number in
        tovo becomes a link straight into the case. Only http and https are accepted.</p>
    </div>

    <div class="card">
      <h2>Your data</h2>
      <p class="meta">Everything you have, in one open file. Secrets are left out on purpose:
        a start link or the calendar address in a file you pass on would give away access.</p>
      <div class="row">
        <button class="btn" id="dataEksport">Export as JSON</button>
        <button class="btn" id="dataToggl">Import history from Toggl</button>
      </div>
      <p class="meta">For a real backup, use the panel's own — it covers the whole data folder,
        database and all.</p>
    </div>

    ${state.user.isAdmin ? `
    <div class="card">
      <h2>This server</h2>
      <label class="check"><input type="checkbox" id="setReg" ${state.config.allowRegistration ? 'checked' : ''}>
        <span>Let new users sign up</span></label>
      <p class="meta">Users never see each other's data — not even the administrator.</p>
    </div>` : ''}`;
}

function bindSettings() {
  document.querySelectorAll('[data-tema]').forEach((el) => {
    el.addEventListener('click', () => { anvendTema(el.dataset.tema); opdaterTemaKnap(); tegnSide(); });
  });

  const pw = document.getElementById('pwForm');
  if (pw) {
    pw.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/password', {
          current: document.getElementById('pwCur').value,
          next: document.getElementById('pwNew').value,
        });
        toast('Password changed.');
        pw.reset();
      } catch (ex) { toast(ex.message); }
    });
  }

  const add = document.getElementById('pkAdd');
  if (add) {
    add.addEventListener('click', async () => {
      try {
        await opretPasskey('Passkey');
        toast('Passkey added.');
        tegnSide();
      } catch (ex) {
        if (ex.name === 'NotAllowedError') return;
        toast(ex.message || 'The passkey did not work');
      }
    });
  }

  document.querySelectorAll('[data-pk]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await api('DELETE', `/api/v1/passkeys/${encodeURIComponent(el.dataset.pk)}`);
        tegnSide();
      } catch (ex) { toast(ex.message); }
    });
  });

  const tilGuide = document.querySelector('[data-go-guide]');
  if (tilGuide) tilGuide.addEventListener('click', () => gaaTil('guide'));

  tegnTotpKort();
  tegnSaguKort();

  const caseUrl = document.getElementById('setCaseUrl');
  if (caseUrl) {
    caseUrl.addEventListener('change', async () => {
      const v = caseUrl.value.trim();
      if (v && !/^https?:\/\//i.test(v)) { toast('The link must start with http:// or https://'); return; }
      if (v && !v.includes('{case}')) { toast('The link needs {case} where the number goes.'); return; }
      try {
        await api('POST', '/api/v1/settings', { case_url: v });
        await genindlaes();
        toast(v ? 'Case numbers are links now.' : 'Case links turned off.');
      } catch (ex) { toast(ex.message); }
    });
  }

  const eksport = document.getElementById('dataEksport');
  if (eksport) {
    eksport.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = '/api/v1/export';
      a.download = `tovo-${state.today}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }
  const tg = document.getElementById('dataToggl');
  if (tg) tg.addEventListener('click', aabnTogglImport);

  const mcpCopy = document.getElementById('mcpCopy');
  if (mcpCopy) {
    mcpCopy.addEventListener('click', async () => {
      const url = document.getElementById('mcpUrl').textContent;
      const ok = await kopier(url);
      toast(ok ? 'Address copied.' : `Copy it by hand: ${url}`);
    });
  }
  const keyAdd = document.getElementById('keyAdd');
  if (keyAdd) {
    keyAdd.addEventListener('click', async () => {
      try {
        const d = await api('POST', '/api/v1/keys', {
          name: document.getElementById('keyName').value,
          scope: document.getElementById('keyScope').value,
        });
        // Noeglen vises ÉN gang. Derfor en rude, der bliver staaende, og ikke
        // en toast, der forsvinder efter tre sekunder.
        visNoegle(d.key);
        tegnSide();
      } catch (ex) { toast(ex.message); }
    });
  }
  document.querySelectorAll('[data-noegle]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await api('DELETE', `/api/v1/keys/${el.dataset.noegle}`);
        tegnSide();
        toast('The key stopped working right away.');
      } catch (ex) { toast(ex.message); }
    });
  });
  document.querySelectorAll('[data-forbindelse]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await api('DELETE', `/api/v1/connections/${el.dataset.forbindelse}`);
        tegnSide();
        toast('Disconnected.');
      } catch (ex) { toast(ex.message); }
    });
  });

  const icalCreate = document.getElementById('icalCreate');
  if (icalCreate) {
    icalCreate.addEventListener('click', async () => {
      try {
        await api('POST', '/api/v1/ical', {});
        tegnSide();
        toast('Calendar feed created.');
      } catch (ex) { toast(ex.message); }
    });
  }
  const icalCopy = document.getElementById('icalCopy');
  if (icalCopy) {
    icalCopy.addEventListener('click', async () => {
      const url = document.getElementById('icalUrl').textContent;
      const ok = await kopier(url);
      toast(ok ? 'Address copied — add it as a subscribed calendar.' : `Copy it by hand: ${url}`);
    });
  }
  const icalRevoke = document.getElementById('icalRevoke');
  if (icalRevoke) {
    icalRevoke.addEventListener('click', async () => {
      try {
        await api('DELETE', '/api/v1/ical', {});
        tegnSide();
        toast('The feed is dead. Any calendar still subscribed will stop updating.');
      } catch (ex) { toast(ex.message); }
    });
  }
  const icalAlarm = document.getElementById('icalAlarm');
  if (icalAlarm) {
    icalAlarm.addEventListener('change', async () => {
      try {
        await api('POST', '/api/v1/settings', { ical_alarm: icalAlarm.value });
        toast('Saved. Calendars pick it up at their next refresh.');
      } catch (ex) { toast(ex.message); }
    });
  }

  const reg = document.getElementById('setReg');
  if (reg) {
    reg.addEventListener('change', async () => {
      try {
        const d = await api('POST', '/api/v1/settings', { allow_registration: reg.checked });
        state.config.allowRegistration = d.global.allowRegistration;
        toast(reg.checked ? 'Sign-up is open.' : 'Sign-up is closed.');
      } catch (ex) { toast(ex.message); reg.checked = !reg.checked; }
    });
  }
}

/**
 * Noeglen vises ÉN gang.
 *
 * Kun hashen gemmes, saa den kan aldrig laeses tilbage. Derfor en rude, man
 * selv lukker - og en kopiér-knap med fallback, fordi udklipsholderen
 * kraever et secure context, og panelet tilgaas over http (doda F2).
 */
function visNoegle(noegle) {
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `<div class="modal-card" role="dialog" aria-label="New key">
      <h2>Your new key</h2>
      <p class="meta">This is the only time it is shown. Only its hash is stored.</p>
      <p class="startlink-url" id="nyNoegle">${esc(noegle)}</p>
      <div class="modal-foot">
        <button class="btn primary" id="nkCopy">Copy</button>
        <button class="btn" id="nkClose">Done</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  document.getElementById('nkClose').addEventListener('click', luk);
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') luk(); });
  document.getElementById('nkCopy').addEventListener('click', async () => {
    const ok = await kopier(noegle);
    toast(ok ? 'Key copied.' : 'Select it and copy it by hand.');
  });
}

/**
 * Service workeren.
 *
 * Registreringen kan IKKE afproeves i Claude Codes browser-panel: den fejler
 * med "An unknown error occurred when fetching the script" - ogsaa mod en
 * helt noegen server. Det er panelet, ikke koden (doda F6). Fejler den, sker
 * der ingenting synligt, og appen virker uaendret.
 */
async function registrerSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');

    /*
     * En web app paa hjemmeskaermen bliver stort set ALDRIG genindlaest: den
     * lukkes ikke, den skjules. Registreringen ovenfor tjekker kun ved
     * sideindlaesning, saa uden det her opdager telefonen aldrig, at der ligger
     * en ny sw.js - og serverer sin egen cache videre i maanedsvis.
     *
     * doda stod paa v33 paa Andreas' telefon, mens serveren koerte v38, og
     * fejl, der var rettet for laengst, blev ved med at vise sig
     * (RUNE-ERFARINGER, 19-08-2026). tovo havde praecis samme mangel.
     */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => { /* offline er fint */ });
    });
    window.addEventListener('pageshow', () => {
      // iOS' bfcache: appen "kommer frem" uden en visibilitychange.
      reg.update().catch(() => { /* offline er fint */ });
    });

    /*
     * Naar en ny service worker tager over, koerer den GAMLE kode stadig i
     * siden - skipWaiting() skifter arbejderen ud, ikke det, brugeren ser.
     * Kun hvis der var en controller i forvejen: ved allerfoerste registrering
     * fyrer controllerchange ogsaa (clients.claim), og saa ville hver ny
     * installation genindlaese sig selv uden grund.
     */
    const havdeStyring = !!navigator.serviceWorker.controller;
    let genindlaeser = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!havdeStyring || genindlaeser) return;
      genindlaeser = true;
      window.location.reload();
    });
  } catch { /* uden SW virker alt stadig */ }
}

/* --------------------------------------------------------------- start */

/**
 * Adressen at vende tilbage til efter login.
 *
 * KUN samtykkesiden accepteres. Alt andet ville goere login-siden til en
 * aaben viderestilling.
 */
function oauthNaeste() {
  try {
    const n = new URLSearchParams(location.search).get('next') || '';
    return n.startsWith('/oauth/authorize?') ? n : null;
  } catch { return null; }
}

function fortsaetTilConnector() {
  const n = oauthNaeste();
  if (!n) return false;
  location.replace(n);
  return true;
}

(async function start() {
  anvendTema(nuvaerendeTema());
  try {
    state.config = await api('GET', '/api/public-config');
    document.title = state.config.appName || 'tovo';
    const me = await api('GET', '/api/me');
    state.user = me.user;
    // Var man allerede logget ind, da connectoren sendte én herhen, skal man
    // slet ikke se appen - kun samtykkesiden.
    if (state.user && fortsaetTilConnector()) return;
    if (state.user) await hentState();
  } catch (ex) {
    document.getElementById('root').innerHTML =
      `<div class="gate"><div class="card"><div class="brand">${icon('logo', 26)} tovo</div>
       <p class="lead" style="text-align:center">Could not reach the server.<br>${esc(ex.message)}</p></div></div>`;
    return;
  }
  render();
  registrerSW();

  /*
   * Den SYNLIGE vej til en ny version. Service workeren opdaterer sig selv
   * stille; det her er knappen, brugeren kan se og selv trykke paa - og den
   * virker ogsaa, naar der slet ingen service worker er (http, eller en
   * registrering der fejlede).
   *
   * `focus` er med, fordi en web app paa hjemmeskaermen kan faa fokus uden
   * en visibilitychange, og `pageshow` daekker iOS' bfcache.
   */
  document.addEventListener('visibilitychange', tjekVersion);
  window.addEventListener('pageshow', tjekVersion);
  window.addEventListener('focus', tjekVersion);
}());
