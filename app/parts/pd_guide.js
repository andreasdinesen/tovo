'use strict';
/* tovo - skaermen "Guide": en samlet gennemgang af appen.
 *
 * FORMEN er dodas og sagus, saa de tre apps' hjaelpesider laeses ens: store
 * DELE med eget navn, GRUPPER som et lille versalt maerke, EMNER som h2 med
 * raekker, der har et maerke i venstre side.
 *
 * INDHOLDET er tovos eget. Fire regler, som forlaegget selv naevner:
 *
 * 1. Guiden maa ALDRIG love mere end koden kan. En hjaelpetekst er en
 *    kravspecifikation. Hver raekke herunder er skrevet ud fra
 *    app/shared/parse.js, beregn.js og skaermenes faktiske adfaerd.
 * 2. tovo er ikke doda. Der er ingen inbox, ingen kontekster og ingen
 *    ugentlig gennemgang - men der er en timer, sagsnumre, en kalender og
 *    en Planner-import. Skriv tovos virkelighed, ikke forlaeggets.
 * 3. Ingenting gentages, hvis det staar ét sted i forvejen: genvejene
 *    hentes fra GENVEJE, saa de to lister ikke kan komme ud af trit.
 * 4. Hvert EMNE er en <h2>. Det er ogsaa det, sideoversigten ville bygge
 *    paa, hvis tovo faar §9b's skinne senere.
 */

/*
 * Maerket er enten en TAST/MARKOER (monospace, ordret) eller en TILSTAND
 * (versal etiket). Afgoerelsen traeffes paa teksten selv, ikke paa dens
 * laengde: med en laengderegel blev "!every monday" til en versal etiket, og
 * text-transform gjorde den til en syntaks, der ikke findes (doda v25).
 */
function guideMaerke(t) {
  const erEtiket = /[a-zA-Z]/.test(t) && t === t.toUpperCase();
  return erEtiket
    ? `<span class="guide-tag">${esc(t)}</span>`
    : `<code class="guide-key">${esc(t)}</code>`;
}

function guideEmne(e) {
  const krop = (e.raekker || []).map(([m, tekst]) => `<div class="guide-row">
        <div class="guide-badge">${guideMaerke(m)}</div>
        <div class="guide-text">${tekst}</div></div>`).join('')
    + (e.kort ? `<p class="guide-short"><strong>In short:</strong> ${e.kort}</p>` : '');
  // Et emne uden raekker faar intet kort - men skal stadig kunne have sin
  // knap. En betingelse, der bortkaster to ting paa én gang, er en faelde.
  const knapper = e.go
    ? `<div class="guide-go">${e.go.map(([v, t]) =>
      `<button class="btn" data-guide-go="${esc(v)}">${esc(t)}</button>`).join(' ')}</div>`
    : '';
  return `<h2>${esc(e.titel)}</h2>
    <p class="lead guide-lead">${e.lead}</p>
    ${krop ? `<div class="card guide-card">${krop}${knapper}</div>` : knapper}`;
}

/* ------------------------------------------------------------ indholdet */

const GUIDE_DELE = [
  {
    del: 'How tovo works',
    lead: 'One line creates the work, one click times it, and the week adds up by itself.',
    grupper: [
      {
        gruppe: 'Capture',
        emner: [
          {
            titel: 'The search field',
            lead: 'It searches when you type, and creates when you start the line with a marker.',
            raekker: [
              ['any key', 'On any screen, start typing and the field takes what you typed.'],
              ['+', 'A task. Everything else on the line is read as detail, not as title.'],
              ['%', 'Anywhere in the line: create it <em>and</em> start the timer at once.'],
              ['//', 'Everything after <code>//</code> becomes the description.'],
              ['WHERE', 'Standing inside a project, the field searches and creates <em>there</em>. What you write yourself always wins over what the screen assumes.'],
            ],
            kort: 'anything the parser does not understand stays in the title — it is never thrown away.',
          },
          {
            titel: 'The markers',
            lead: 'They can come in any order, and they must touch what they mark.',
            raekker: [
              ['@name', 'Put it under a project. <code>@"Two words"</code> when the name has a space. <code>/</code> does the same.'],
              ['#name', 'Set a tag. Works in an existing title too — write it and save.'],
              [':SAG-1234', 'The case number the hours are booked against. A project can carry one, and its tasks inherit it.'],
              ['~2,5t', 'An estimate. <code>~90m</code> and <code>~1t30m</code> mean the same thing, and the Danish decimal comma works.'],
              ['!friday', 'A due date. <code>!tomorrow</code>, <code>!3/9</code> and <code>!in 2 weeks</code> all work.'],
              ['!every monday', 'A repeat. <code>every! friday</code> counts from when you finish, not from the plan.'],
            ],
            kort: 'a marker needs a space in front of it, so an e-mail address never becomes a project.',
          },
        ],
      },
      {
        gruppe: 'Time',
        emner: [
          {
            titel: 'The timer',
            lead: 'One timer runs at a time — the database enforces it, not just the code.',
            raekker: [
              ['CLICK', 'The play button on any task row starts it. Starting another stops the first.'],
              ['⌘↵', 'On the selected row: start or stop without opening anything.'],
              ['ANYWHERE', 'It keeps running when you close the browser — the start time is what is stored, never a counter.'],
            ],
            go: [['today', 'Open Today']],
          },
          {
            titel: 'Logging by hand',
            lead: 'The timer and typing it in afterwards are equal ways in.',
            raekker: [
              ['⌘⇧M', 'Opens the form on any screen.'],
              ['9-11.30', 'A span. <code>1,5t</code>, <code>90m</code> and <code>1t30m</code> are durations, and a bare duration lands after the day&rsquo;s last entry.'],
              ['GAPS', 'Today shows the holes <em>between</em> what you registered. A click opens the form filled in with that span — that is where forgotten time hides.'],
            ],
            kort: 'rounding is a display rule. The stored times stay exact, and two minutes never round away to nothing.',
          },
          {
            titel: 'Start links',
            lead: 'A link you paste into OneNote next to the task.',
            raekker: [
              ['ONE CLICK', 'Starts the timer. The next click stops it. No sign-in.'],
              ['SAFE', 'The address is the credential, so keep it where only you look. It can be revoked, and the same task always gives the same link.'],
            ],
          },
        ],
      },
      {
        gruppe: 'Organise',
        emner: [
          {
            titel: 'Projects',
            lead: 'Four numbers that answer &ldquo;where am I?&rdquo;.',
            raekker: [
              ['ESTIMATED', 'The task estimates, added up.'],
              ['BUDGET', 'What you agreed with the customer. You set it under Edit project.'],
              ['SPENT', 'Logged so far. When the estimates pass the budget, you have found more work than was sold.'],
              ['BOARD', 'The columns are the project&rsquo;s own, so two projects can run through different phases. A Planner import brings its buckets in as columns.'],
            ],
            go: [['projects', 'Open Projects']],
          },
          {
            titel: 'Importing from Planner',
            lead: 'Export the plan to Excel, then pick the file here.',
            raekker: [
              ['NEVER TOUCHED', 'Estimates, logged time, comments, links and the budget are yours. A re-import cannot overwrite them.'],
              ['UPDATED', 'Only the title, column, status, due date and description come from Planner.'],
              ['PREVIEW', 'It says what will change before it writes — including how many columns it will add.'],
            ],
          },
        ],
      },
      {
        gruppe: 'Report',
        emner: [
          {
            titel: 'The week',
            lead: 'What the hours are written off from.',
            raekker: [
              ['PER CASE', 'A grid with one column per day. Rows and columns both add up to the total.'],
              ['FORMAT', 'The button switches between <code>3,5</code> and <code>3h 30m</code>. Decimal hours are the form you type into the other system.'],
              ['THIN DAYS', 'Days with strikingly few hours are called out — that is usually forgotten registration, not a quiet day.'],
              ['OUT', 'Copy as markdown, print, or download it as Excel where the numbers are real numbers.'],
            ],
            go: [['report', 'Open Report']],
          },
        ],
      },
    ],
  },
  {
    del: 'Beyond tovo',
    lead: 'The things that reach out of the app.',
    grupper: [
      {
        gruppe: 'Connected',
        emner: [
          {
            titel: 'Sagu',
            lead: 'Sagu is where the notes live. Connect it under Settings.',
            raekker: [
              ['*', 'In the search field: create a note in Sagu, from here. It lands in the notebook you picked under Settings.'],
              ['ON A TASK', 'Find a note and link it. The note, and its comments, then show in the task — and you can answer without leaving tovo.'],
              ['NARROW', 'The key you paste has the <code>link</code> scope: it can search and create, and it cannot delete anything.'],
            ],
          },
          {
            titel: 'Calendar and Claude',
            lead: 'Two more doors out.',
            raekker: [
              ['ICAL', 'Tasks with a date, as a feed your calendar subscribes to. On iOS, turn &ldquo;Remove Alarms&rdquo; off, or the reminders are stripped.'],
              ['MCP', 'Claude can search, log time and read the week report — through the same functions the app itself uses, so the numbers cannot drift.'],
            ],
            go: [['settings', 'Open Settings']],
          },
        ],
      },
      {
        gruppe: 'Keyboard',
        emner: [{ titel: 'Every shortcut', lead: 'The same list the user menu shows.', genveje: true }],
      },
    ],
  },
];

function sideGuide() {
  return `<section class="page">
    <div class="page-head">
      <h1>Guide</h1>
      <p class="lead">How tovo works, in one place.</p>
    </div>
    ${GUIDE_DELE.map((d) => `
      <div class="guide-part">
        <div class="guide-part-name">${esc(d.del)}</div>
        <p class="lead" style="margin:0">${esc(d.lead)}</p>
      </div>
      ${d.grupper.map((g) => `
        ${g.gruppe ? `<div class="guide-group">${esc(g.gruppe)}</div>` : ''}
        ${g.emner.map((e) => {
    // Genvejene hentes fra GENVEJE, saa de to lister ALDRIG kan komme ud
    // af trit. En guide, der skriver dem af, er en legende mere at holde ved lige.
    if (e.genveje) {
      return `<h2>${esc(e.titel)}</h2><p class="lead guide-lead">${esc(e.lead)}</p>
        <div class="card"><table class="shortcuts">${GENVEJE.map(([t, b]) =>
    `<tr><td><kbd>${esc(t)}</kbd></td><td>${esc(b)}</td></tr>`).join('')}</table></div>`;
    }
    return guideEmne(e);
  }).join('')}`).join('')}`).join('')}
  </section>`;
}

function bindGuide() {
  document.querySelectorAll('[data-guide-go]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.guideGo));
  });
}
