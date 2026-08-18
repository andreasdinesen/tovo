'use strict';
/* tovo - kerne: opstart, tema, login, app-skal.
   Denne fil samles til public/app.js af build_rune.py. Redigér aldrig app.js.

   NB: interfacet er ENGELSK (som i doda - aeoeaa er besvaerligt at taste),
   men koden, kommentarerne og dokumenterne er dansk. */

const APP_VERSION = 2;

/* Mobilgraensen bor to steder: her og i style.css. Holdes de ikke i trit,
   folder menuknappen sidebaren sammen paa en iPad, hvor CSS'en tror den er
   overlay (RUNE-ERFARINGER §4). */
const SMAL_SKAERM = 900;
const smalSkaerm = () => window.matchMedia(`(max-width: ${SMAL_SKAERM}px)`).matches;

const state = {
  user: null,
  config: { appName: 'tovo', needsSetup: false, allowRegistration: false, secureContext: false },
  view: 'today',
  today: '',
  settings: {},
  projects: [],
  tags: [],
  items: [],
  counts: {},
  todayMinutes: 0,
  openProject: null,
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
    throw Object.assign(new Error(data.message || data.error || `Error ${res.status}`),
      { status: res.status, code: data.error });
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
};

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* --------------------------------------------------------------- sider */

// Raekkefoelgen her er ogsaa sidebarens.
const VIEWS = [
  { id: 'today', label: 'Today', icon: 'today', group: 1 },
  { id: 'projects', label: 'Projects', icon: 'projects', group: 1 },
  { id: 'report', label: 'Report', icon: 'report', group: 2 },
  // group: 0 = staar IKKE i navigationen. Settings naas fra menuen paa
  // brugerknappen, hvor kontoen i forvejen bor - to indgange til det samme
  // sted er én for meget (§9c).
  { id: 'settings', label: 'Settings', icon: 'settings', group: 0 },
];

const viewById = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];
const BUND = ['today', 'projects', 'report'];

const BESKRIVELSER = {
  today: 'What you have registered today, and what is running right now.',
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
      const data = await api('POST', nyKonto ? '/api/register' : '/api/login', {
        username: document.getElementById('gateUser').value,
        password: document.getElementById('gatePass').value,
      });
      state.user = data.user;
      state.config.needsSetup = false;
      state.gateNy = false;
      await hentState();
      render();
    } catch (ex) {
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
          <span class="nav-prik"></span><span>${esc(p.name)}</span></button>`).join('')}</div>` : ''}`;
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
  const vBtn = document.getElementById('versionBtn');
  if (vBtn) {
    vBtn.addEventListener('click', async () => {
      try {
        if (window.caches) await Promise.all((await caches.keys()).map((n) => caches.delete(n)));
      } catch { /* uden cache-api er der ikke noget at rydde */ }
      location.reload();
    });
  }
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
  if (skifter) state.openProject = null;
  if (opt && opt.project !== undefined) state.openProject = opt.project;
  document.body.classList.remove('navopen');
  opdaterNav();
  // Feltet arbejder i den side, man staar paa - og skal vise det.
  opdaterOmniKontekst();
  tegnSide();
  // Scroll kun til toppen ved REELT sideskift - ellers kastes brugeren op,
  // hver gang en inline-redigering gentegner samme side (Beanledger v24).
  if (skifter) window.scrollTo(0, 0);
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
  if (state.view === 'report') { await tegnRapport(); return; }
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
  const tema = nuvaerendeTema();
  const knap = (id, navn) => `<button class="btn ${tema === id ? 'primary' : ''}" data-tema="${id}">${navn}</button>`;
  return `
    <h1>Settings</h1>
    <p class="lead">${esc(BESKRIVELSER.settings)}</p>

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
      <h2>Passkeys</h2>
      ${pk.blocked ? `<p class="meta">${esc(pk.blocked)}</p>` : `
        <p class="meta">A passkey is an extra way in — it never replaces the password.</p>
        <div class="row"><button class="btn" id="pkAdd">Add a passkey</button></div>`}
      ${pk.credentials.length ? `<ul class="plain">${pk.credentials.map((c) => `
        <li>${esc(c.name)} <button class="linkbtn" data-pk="${esc(c.id)}">remove</button></li>`).join('')}</ul>` : ''}
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

/* --------------------------------------------------------------- start */

(async function start() {
  anvendTema(nuvaerendeTema());
  try {
    state.config = await api('GET', '/api/public-config');
    document.title = state.config.appName || 'tovo';
    const me = await api('GET', '/api/me');
    state.user = me.user;
    if (state.user) await hentState();
  } catch (ex) {
    document.getElementById('root').innerHTML =
      `<div class="gate"><div class="card"><div class="brand">${icon('logo', 26)} tovo</div>
       <p class="lead" style="text-align:center">Could not reach the server.<br>${esc(ex.message)}</p></div></div>`;
    return;
  }
  render();
}());
