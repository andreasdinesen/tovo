# tovo — byggeplan

Tidsregistrering på opgaver og projekter, bygget som Yggdrasil-rune.
Planen er skrevet til at blive udført af Claude Code, én fase ad gangen.

---

## Fase −1 · Læs dette først (obligatorisk, før én linje kode)

Dette trin må ikke springes over. tovo er en tvilling til doda og arver hele stakken.

1. **`~/ClaudeMacBook/RUNE-ERFARINGER.md`** — hele filen, ikke kun de afsnit der lyder relevante.
   Særligt §1–§5, §8 og §9a.
2. **`andreasdinesen/doda`** — kildekoden, ikke kun README:
   - `app/server.js` — auth, items-API, settings, backup, ruteopsætning
   - `app/shared/parse.js` — **quick-add-parseren. tovo skal bruge nøjagtig samme syntaks.**
     `+` opretter en opgave. Læs den faktiske implementering; gæt ikke syntaksen.
   - `app/mcp.js` + `app/oauth.js` — MCP + OAuth 2.1, kopieres stort set 1:1
   - `app/parts/p1_core.js` — SPA-skelettet, søgepaletten, tastaturhåndteringen
   - `app/public/style.css` — tovo skal se ud som doda
   - `build_rune.py` — tjek om brotli+base85 allerede er på plads dér; hvis ja, kopiér
   - `CLAUDE.md` — dodas egne projektregler
3. **`andreasdinesen/toggl-planner-link-generator`** — `index.html`, funktionen `extractTasks()`.
   Den indeholder den eneste dokumenterede viden om Planner-eksportens arkformer og kolonnenavne.
   **Koden kan ikke genbruges** (den bruger SheetJS fra CDN, og runer må ikke have CDN-afhængigheder),
   men arkvalg og kolonnedetektion skal overføres. Se fase 5.

Skriv en kort opsummering af, hvad der faktisk blev fundet i doda (særligt parserens syntaks
og om brotli allerede er i build'et), før fase 0 startes. Hvis noget afviger fra denne plan,
så sig det — planen er skrevet uden adgang til kildekoden.

---

### Hvad læsningen faktisk fandt (2026-08-18)

Fire ting afviger fra det, planen antog. De er indarbejdet i faserne herunder.

1. **`~` er allerede optaget i dodas parser.** `MARKOERER = '#@!~/'`, hvor `~` betyder
   *udskudt dato* ("skjul indtil") og `/` er en anden projektmarkør ved siden af `@`.
   tovo har ingen udskudt dato, så `~` genbruges til estimat, og defer-grenen fjernes
   frem for at lade den spise tekst, der ikke kan lande nogen steder (doda 2026-08-18:
   *list hvad parseren kan producere, og hold det op mod de felter, modtageren HAR*).
   `#` bliver til **tag** i tovo, ikke kontekst.
2. **doda er en én-brugers app.** `godkend()` slutter med `SELECT id, username FROM users
   LIMIT 1`, og hverken `items`, `projects` eller `contexts` har `user_id`. Hele
   flerbrugerlaget i tovo er skrevet fra bunden — og derfor er isolationstesten ikke en
   formalitet, men beviset. Den er skrevet allerede i fase 0.
3. **doda bruger ikke en generisk items-tabel.** Migration m2 siger ligeud: *alt der
   forespørges eller filtreres får en RIGTIG kolonne med indeks*. tovo følger planen med
   JSON i `items`, men de felter, der faktisk slås op (`plannerTaskId`, `projectId`), har
   fået **udtryks-indeks** — ellers er genimport en fuld scanning pr. opgave i eksporten.
4. **brotli+base85 var allerede i dodas build**, sammen med kommentar-strip (24 % dér),
   `update:`-blok, `{{NODE_IMAGE}}` og `events:`. Alt det er kopieret. Det eneste, der
   manglede, var **require-spærren** fra Beanledger v30 — den er med fra fase 0 og bevist
   ved at fjerne en fil og se build'et fælde.

Planner-tabellen i fase 5 er bekræftet lige så tynd som frygtet: `extractTasks()` kender
kun `opgavenavn`, `bucket`, `bucket-id`, `bucket-navn` og `tjeklisteelementer`.
**`opgave-id` optræder ikke i det eksisterende værktøj** — fase 5 kan ikke bygges uden en
rigtig eksport at verificere mod.

---

## Rammer der gælder hele vejen

| Regel | Hvorfor |
|---|---|
| Node ≥22, `node:http` + `node:sqlite` + `node:crypto`. **Nul npm-pakker, nul CDN.** | §1 |
| `brotli q11 + base85` i payloaden **fra fase 0** | §2 · Beanledger v28 sprang grænsen før MCP var skrevet |
| base85-alfabetet udelader `{ } \`` | §2 |
| Alle beregninger i `app/shared/beregn.js` (UMD) — **aldrig i frontenden alene** | Beanledger v28 |
| `user_id`-filteret ligger i hente-/gemmefunktionerne, ikke i kaldstederne | Kokkeri §4 |
| `APP_VERSION` starter på 1 og **bumpes kun ved udgivelse**, efter Andreas' ja | §8 |
| **Commit og push kræver et udtrykkeligt ja** | §8 |
| Cache-bust: `app.js?v=N` stemplet i `index.html`, HTML serveres `no-store` | §5 |
| `crypto.getRandomValues`-fallback for `randomUUID` | §4 — panelets adgang er http |
| 900 px-mobilgrænsen i **én** konstant, brugt af både JS og CSS | §4 |
| `[hidden]{display:none!important}` i CSS | §4 |
| `overflow-wrap: break-word` på `body` | §4 — importerede Planner-titler er lange |
| `render()` nulstiller ikke scroll ved gentegning af samme side | Beanledger v24 |
| Serveren logger `server.address().port` | doda v7 |
| Bind aldrig til `PORT_<navn>` / `<NAVN>_PORT` — det er host-porten | doda v3 |
| Netværksfejl oversættes i den fælles `api()`-indpakning | doda v11 |
| Integrationstests kører med `BIND_PORT=0`, stderr med i timeout-beskeden | doda v7 |

**Ikke i scope:** offline-kø, service worker-kø, fakturerbarhed, Notion, deling mellem brugere,
synkronisering med doda. tovo og doda har intet med hinanden at gøre.

---

## Fase 0 · Skelet

**Mål:** en tom, kørende rune med login.

- [x] Repo `andreasdinesen/tovo`, struktur som doda:
      `app/server.js`, `app/parts/`, `app/shared/`, `app/public/`, `build_rune.py`, `runes/tovo.yaml`
- [x] Auth-stakken kopieret 1:1 fra doda: scrypt, sessionscookie `tovo_session`, WebAuthn,
      rate-limit på login. rpId/origin udledes pr. request af `X-Forwarded-Host/Proto`.
- [x] Første registrerede bruger = admin. `allow_registration`-setting + `/api/public-config`
      så registreringslinket kan skjules.
- [x] `build_rune.py` med brotli+base85 og en assert på payload-størrelsen (loft 120 K).
      **Skriv den målte størrelse i build-outputtet ved hver kørsel** — den skal følges hele vejen.
- [x] Rundturs-tjekket kører den dekoder, der faktisk udgives.
- [x] Skema (migration 1 og 2):

```sql
CREATE TABLE items (              -- projekter, opgaver, kommentarer, tags
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
  data TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX ix_items_user_kind ON items(user_id, kind);

CREATE TABLE time_entries (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL,
  started_at INTEGER NOT NULL, stopped_at INTEGER,   -- NULL = kører nu
  note TEXT, source TEXT NOT NULL                    -- timer | manuel | link | mcp
);
CREATE INDEX ix_te_user_time ON time_entries(user_id, started_at);
CREATE INDEX ix_te_task ON time_entries(task_id);
CREATE UNIQUE INDEX ix_te_running ON time_entries(user_id) WHERE stopped_at IS NULL;

CREATE TABLE start_tokens (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL,
  mode TEXT NOT NULL, revoked_at INTEGER            -- mode: start | toggle
);
CREATE TABLE ical_feeds (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, revoked_at INTEGER
);
```

**Bemærk afvigelsen fra §3:** tidsposter får en rigtig tabel i stedet for items-tabellen.
De forespørges på tidsinterval og summeres; `json_extract` pr. række i en ugesum er unødigt.
Start- og iCal-tokens får også rigtige kolonner, fordi de slås op fra endepunkter uden login
og aldrig må scanne datasættet (§4).

- [x] `runes/tovo.yaml`: én web-port (container 3000), `watchers:` på `\[fejl\]`,
      `backup.include: []`, `wipe.paths` med `backup_first: true`.
- [x] Dev-server i `~/.claude/launch.json` (den globale) med `BIND_PORT` + `DATA_DIR` i scratch-mappe.

**Accept:** `BIND_PORT=8911 DATA_DIR=/tmp/tovo node app/server.js` starter, `/api/register`
opretter en bruger, login virker, SPA'en tegner en tom side i dodas udseende. Build'et rapporterer
payload-størrelse. Ingen npm-pakker i repoet.

**Status 2026-08-18 — fase 0 er bygget.** Install-scriptet måler **37.256 af 120.000 tegn (31 %)**.
21 tests grønne (auth, isolation, port). Afvigelser fra listen ovenfor:

- Skemaet blev til **to** migrationer: `m1` kerne (users, sessions, settings, rate, audit,
  credentials, tokens) og `m2` domæne (planens fire tabeller). Migrationslisten er styret af
  `PRAGMA user_version` fra dag ét.
- `tokens` fik en **`user_id`-kolonne**, som doda ikke har. Uden den ville en adgangsnøgle
  ramme "første bruger i tabellen", og flerbrugerisolationen var en illusion.
- `settings` fik **`(scope, key)`** som primærnøgle, hvor scope er brugerens id eller `*` for
  installationen. Ellers ville to brugeres afrundingsregel være den samme række.
- Blød sletning ligger som `deletedAt` **i JSON'en**, så skemaet er præcis planens. Filteret
  ligger i `hentItems`/`hentItem`, ikke i kaldstederne.
- Dev-serveren står på **8911** (8902 er kokkeris) med `TOVO_DEV=1`, som slår
  `immutable`-cachen fra — ellers ser man ikke sine egne ændringer (doda F1).

---

## Fase 1 · Opgaver, projekter og søgning

**Mål:** brugbar som ren opgaveliste.

- [x] Kinds: `project`, `task`, `comment`, `tag`
- [x] Projekt: navn, farve, ikon, kunde, `plannerPlanId`, `plannerPlanName`, `lastImportAt`,
      `budgetHours` (manuel projektramme), `archivedAt`
- [x] Sektioner som felt på projektet (array af `{id, navn, position}`) — ikke egen kind
- [x] Opgave: titel, beskrivelse, `projectId`, `sectionId`, `parentTaskId`, `estimateMinutes`,
      `priority`, `dueDate`, `dueTime`, `status`, `completedAt`, `plannerTaskId`,
      `recurrenceRule`, `links` (array af `{label, url}`), `position`
- [x] Kommentarer som egen kind med `taskId`
- [x] `app/shared/parse.js` **kopieret fra doda**, udvidet med ét token: `~` for estimat
      (`~2t`, `~90m`, `~1,5t` — dansk decimalkomma skal virke)
- [x] Søgepaletten fra doda: ét felt øverst, live-søgning i opgaver og projekter,
      `+` opretter, `Cmd/Ctrl+K` åbner overalt
- [x] **Kontekstbevidsthed:** står man i et projekt, søger og opretter feltet kun der
- [x] Tastatur: **kun piletaster fører ind i listen**, aldrig bogstaver (doda v7 — bogstaver
      skal kunne skrives i søgefeltet). `Esc` slipper listen igen.
- [x] Links på opgaver: flere pr. opgave med label. `onenote:`-URL'er skal kunne gemmes og
      klikkes — verificér at de ikke bliver saniteret væk.

**Accept:** opret projekt og opgave via `+`, find dem via søgning, afslut en opgave,
skriv en kommentar, gem et `onenote:`-link og klik det. Tastaturnavigation testet med
en dispatchet `KeyboardEvent` med `key` sat — **browser-panelet sender tom `e.key` og kan
ikke bruges til det** (§4 + doda v7).

**Status 2026-08-18 — fase 1 er bygget.** Install-scriptet: **52.811 af 120.000 tegn (44 %)**.
44 tests grønne (parser, fangst, auth, isolation, port). Accepten er kørt igennem i browseren:
opgave og projekt oprettet på én linje via `+`, fundet via søgning, afsluttet og fortrudt,
kommentar skrevet, `onenote:`-link gemt og tegnet som et rigtigt `<a href="onenote:…">`.
Tastaturnavigationen er testet med dispatchede `KeyboardEvent`s med `key` sat.

Fire ting, der ikke stod i planen, men som arbejdet krævede:

- **`beregn.js` blev oprettet allerede her**, ikke i fase 2. `~` kræver `parseVarighed`, og
  reglen siger, at en udregning aldrig må bo i `app/parts/`. Modulet indeholder indtil
  videre kun `parseVarighed` og `formatVarighed`; summerne kommer i fase 2. Build'et samler
  `app/shared/*.js` alfabetisk, så `beregn.js` ligger før `parse.js` i `app.js`.
- **`FELTER`-hvidlisten pr. kind** ligger i serveren og bruges af `gemItem`. Det er den,
  fase 5's genimport skal hvile på, og den kunne lige så godt skrives, mens felterne blev
  defineret. Rensningen sker ét sted, så hverken en rute, en import eller MCP kan smugle et
  ukendt felt ind. **Fælde, som isolationstesten fangede med det samme:** hvidlisten åd den
  bløde sletning, fordi `deletedAt` ikke er et modelfelt. Interne felter føres nu med
  eksplicit.
- **Dodas regel om bogstaver i lister er vendt om.** doda trækker sig, så snart fokus står i
  en `[data-keynav]`-liste, fordi dodas rækker ejer `n`/`w`/`s`/`x`. tovos rækker bruger kun
  Enter og mellemrum, så den regel ville betyde, at bogstaver blev ædt — stik imod planen.
  Kun en liste, der selv siger `data-keynav-letters`, beholder bogstaverne nu.
- **Opgavens `status` har tre værdier** (`open`/`doing`/`done`), ikke to. Planner har
  »I gang«, og uden den ville hver genimport kaste information væk.

**Ikke verificeret:** at et `onenote:`-link rent faktisk åbner OneNote-klienten. Det kan
kun testes på din maskine — browserpanelet har ingen OneNote at give linket videre til.
Selve adressen overlever gemning, hentning og optegning uændret.

---

## Fase 2 · Tidsregistrering

**Mål:** timeren og den manuelle registrering er ligeværdige indgange.

- [x] `app/shared/beregn.js` **oprettes her**, med den første beregning. UMD, kender hverken
      databasen eller `S`. Sømmen mod frontenden er `items(kind)` og `settings()`.
      Funktioner: `forbrugPaaOpgave`, `forbrugPaaProjekt`, `rollupProjekt`, `sumPeriode`,
      `formatVarighed`, `parseVarighed`.
      **Skriv aldrig en beregning i `app/parts/` — heller ikke en lille.**
- [x] Timer: `POST /api/v1/timer/start {taskId}` stopper automatisk en kørende og starter ny.
      `POST /api/v1/timer/stop`. `GET /api/v1/timer/current`.
      Det unikke indeks håndhæver reglen — stol ikke kun på applikationslogikken.
- [x] Kørende timer synlig i alle views + i `document.title`
- [x] **Manuel tidspost på vilkårlig dato.** Egen knap, egen tastaturgenvej.
      Feltet forstår `9-11.30`, `9:00-11:30`, `1,5t`, `90m`, `1t30m`.
      Dansk decimalkomma er ikke valgfrit (§7's `num()`-lærdom).
- [x] Redigering og sletning af enhver tidspost, uanset kilde
- [x] Fortryd-toast i 10 sek. ved sletning
- [x] `source` sættes korrekt: `timer` / `manuel` / `link` / `mcp`
- [x] Advarsel når en timer har kørt over en grænse fra settings (default 8 t)
- [x] Afrundingsregel i settings (ingen / 5 / 10 / 15 min) — anvendes ved **visning og rapport**,
      aldrig destruktivt på den gemte post

**Accept:** start en timer, luk browseren, åbn igen — den kører stadig. Start en anden opgave —
den første er stoppet. Registrér 1,5 t på i forgårs manuelt. Slet den og fortryd.
Alle summer kommer fra `beregn.js`; en test sammenligner frontendens tal med serverens
på samme data (Beanledger v28: to sandheder er den fejl, der skal forhindres).

**Status 2026-08-18 — fase 2 er bygget.** Install-scriptet: **59.446 af 120.000 tegn (49 %)**.
53 tests grønne. Accepten er kørt igennem både som test og i browseren: timeren overlevede en
genstart af serverprocessen *og* en genindlæsning, den anden opgave stoppede den første, 1,5 t
blev registreret på i forgårs (landede kl. 9), og en slettet post kom tilbage byte-identisk.

To ting, som testene fandt, og som er værd at huske:

- **Fortryd gendannede posten som `manuel`, selv om den var `timer`** — og 26 sekunder
  forskudt, fordi vejen gik gennem et `HH:MM`-felt. En fortrydelse, der ændrer kilden og
  taber sekunderne, er ikke en fortrydelse. `POST /api/v1/entries` tager nu enten dato +
  tekst (mennesket) eller præcise tidspunkter + id + kilde (fortrydelsen og senere MCP).
- **"Frontendens tal er serverens tal"-testen bestod med en bevidst saboteret server**,
  fordi alle testens tider var hele kvarter. Data, der ligger på afrundingsgriddet, kan ikke
  se en afrundingsfejl. Med en post på 22 og en på 7 minutter bliver den rød med det samme.

Afvigelser fra planen:

- **Timerens advarselsgrænse regnes på serveren** (`timerStatus`), ikke i frontenden. Den skal
  være den samme, uanset om det er webappen eller en MCP-klient, der spørger.
- **Afrunding sker pr. post, ikke på totalen**, og en post på 2 minutter bliver til 15 — ikke
  til 0. Et stykke arbejde, der er registreret, må ikke kunne runde sig selv væk.
- **En ren varighed placeres efter dagens sidste post, ellers kl. 9.** Uden en regel ville tre
  poster på samme dag ligge oven i hinanden, og dagsvisningen i fase 9 ville vise tre samtidige
  stykker arbejde. Placeringen ligger i `beregn.js` som alt andet.
- **Genvejen til manuel registrering er `⌘⇧M` / `Ctrl+Shift+M`.** Et bart bogstav kan ikke
  bruges: de åbner søgefeltet, og det skal de blive ved med.

---

## Fase 3 · Start-links

**Mål:** Toggl kan afskaffes.

- [x] Token pr. opgave i `start_tokens`, genereret server-side, vist kun til den indloggede ejer
- [x] `GET /s/:token` — **ingen session, ingen cookie.** Opslag direkte på primærnøglen.
- [x] Forkert eller tilbagekaldt token → **404**, aldrig 401/403 (doda F9: de bekræfter, at feedet findes)
- [x] `timingSafeEqual` kræver ens længde — sammenlign længden først
- [x] `mode: toggle` som standard: samme link starter og stopper
- [x] Kvitteringssiden er **server-renderet uden JavaScript** — samme greb som OAuth-samtykkesiden
      (§9a del 4): link til `/style.css?v=N` med N læst ud af `index.html` ved opstart, og
      tema-scriptet indsat **ordret**, så CSP-hashen passer af sig selv. Ingen ny undtagelse.
- [x] Siden viser: opgavens navn, projekt, om timeren nu kører eller blev stoppet, forbrugt i dag,
      og en stop-knap (almindelig `<form method="post">`, ingen JS)
- [x] Kopiér-link-knap i opgavevisningen
- [x] Bulk-generering: "kopiér links for hele projektet" som markdown-liste, klar til OneNote

**Accept:** klik linket fra en rigtig OneNote-side — ikke kun fra en browserfane; `onenote:`-klienten
håndterer links anderledes. Klik igen og se timeren stoppe. Kald `/s/<forkert>` og få 404.
Kald `/s/:token` som en anden bruger og få 404.

**Status 2026-08-18 — fase 3 er bygget.** Install-scriptet: **62.100 af 120.000 tegn (51 %)**.
64 tests grønne. Kvitteringssiden er set i browseren: den arver SPA'ens udseende, har
præcis ét script (tema-scriptet, ordret som i `index.html`, så den eksisterende CSP-hash
dækker det), og stop-knappen er en almindelig formular, der POSTer til samme adresse.

Fire valg, planen ikke traf:

- **`GET /s/:token` udfører handlingen** — en GET, der ændrer noget. Det er prisen for ét
  klik fra OneNote; en POST kan et link ikke være. Prisen er, at en forhåndshentning kan
  starte en timer, så klienter, der selv siger, at de kun kigger (`Sec-Purpose`, `Purpose`,
  `X-Purpose`, samt `HEAD`), får siden **uden** handlingen. Det dækker Outlook og de
  browsere, der prefetcher — det er en dæmpning, ikke en garanti.
- **Samme opgave giver samme token.** Ellers ville hvert klik på "kopiér" lave et nyt, og
  de gamle links i OneNote ville hobe sig op som døde adresser.
- **En fremmed *session* giver 404, en manglende session gør ikke.** Det er den nuance,
  isolationstesten kræver: B må ikke kunne betjene A's link fra sin egen browser, men
  adressen i sig selv **er** legitimationen — som et iCal-feed. Hvem der har linket, kan
  starte timeren, og det er meningen.
- **`timingSafeEqual` er ceremoni her**, og det står i koden. Opslaget sker på
  primærnøglen, så et forkert token giver ingen række overhovedet — der er ingen
  sammenligning at måle på. Den står der, fordi den er gratis og er den rigtige vane det
  sted, hvor den gør en forskel.

**Ikke verificeret:** at klik fra en rigtig OneNote-side virker (kræver din maskine), og at
kopiér-knappen faktisk skriver til udklipsholderen — browserpanelet nægter både at læse
udklipsholderen og at give en scriptet klik den brugeraktivering, skrivningen kræver.
Linket vises derfor altid i fuld længde i ruden, så det kan tages med musen.

Efter denne fase bør tovo tages i brug i det daglige, selvom resten mangler.
Rigtige data er den bedste kravspecifikation for fase 4–6.

---

## Fase 4 · Estimater og projektoverblik

**Mål:** svare på "hvor er jeg?" — og kunne vise det til en kunde.

- [x] Estimat pr. opgave (sat i UI eller via `~`-token)
- [x] Rollup i `beregn.js` på **tre niveauer**:
      sum af opgaveestimater · manuel projektramme (`budgetHours`) · forbrugt
- [x] Projektside: de tre tal, resterende, procent, opgaveliste med estimat/forbrugt pr. række
- [x] Advarsel når forbrugt passerer 80 % og 100 % af rammen
- [x] Advarsel når sum af estimater overstiger rammen — det er den tidlige advarsel om,
      at der er fundet mere arbejde end der er solgt
- [x] **Kundevisning:** en ren udgave af projektsiden uden interne noter og uden kilde-mærkning,
      egnet til at vise eller printe. Print via `.printsheet`-mønsteret med
      **eksplicitte farver — aldrig `var(--…)`** (Muldbog: `--muted` er lys grå i mørkt tema
      og forsvinder på hvidt papir). `@page { margin: 0 }`, papirmargen som padding.
      `document.title = 'tovo-<projekt>-<dato>'` under print, gendannet på `afterprint`.
      `print-color-adjust: exact` hvis der bruges baggrundsfarver.

**Accept:** et projekt med fem opgaver viser korrekte tal fra `beregn.js`. Kundevisningen
printes til PDF med læsbare farver. Print testes ved at stubbe `window.print` og inspicere
`#printHost` — husk at `afterprint` aldrig fyrer med en stub, så titlen sættes tilbage manuelt.

**Status 2026-08-18 — fase 4 er bygget.** Fem opgaver, 9 t estimeret mod 10 t ramme og
2 t 15 m forbrugt: kundevisningen viser de samme tal som serverens rollup, række for række.
Print er verificeret med stubbet `window.print`: `#printHost` fyldes, `document.title` bliver
`tovo-<projekt>-<dato>` under print og sættes tilbage bagefter, `@page { margin: 0 }` er der,
og **ingen regel i `@media print` bruger `var(--…)`** — det er målt på de faktiske CSS-regler,
ikke antaget. 80 %- og 100 %-advarslerne er to forskellige sætninger; den ene siger, hvor
langt man er, den anden at rammen er brugt op.

---

## Fase 5 · Planner-import

**Mål:** hente en plan ind og kunne genimportere uden at ødelægge noget.

**Ét projekt pr. Planner-plan.** Flere planer må gerne importeres som hver sit projekt.

### Verificeret mod en rigtig eksport (2026-08-18)

En rigtig Planner-eksport er læst igennem (én plan, 9 opgaver, 5 buckets). **Tre af planens
tekniske antagelser holder ikke**, og de skal rettes, før parseren skrives:

1. **Der er ingen `xl/sharedStrings.xml`.** Alle celler er `t="str"` med teksten direkte i
   `<v>`. Planens beskrivelse (`t="s"` = indeks i en fælles pulje) passer ikke på det,
   Planner faktisk lægger i filen. Parseren skal læse `t="str"` — og tåle `t="s"` og
   `inlineStr`, hvis Microsoft skifter, uden at fælde importen.
2. **Datoer er ISO-tekst** (`2026-05-12`), ikke serienumre. Ingen konvertering fra
   1899-12-30 er nødvendig for denne eksport; håndtér tekst først og tal som fallback.
3. **Der er ingen `styles`-afhængighed** at tage hensyn til, fordi ingen celle er
   talformateret.

Filen har seks ark: `Plan`, `Konsoliderede data`, `Opgaver`, `Goals`, `Buckets`, `Brugere`.
Forskellen mellem `Konsoliderede data` og `Opgaver` er præcis to kolonner: `Bucket` er et
**navn** i det konsoliderede ark og et **bucket-id** i opgavearket (og `Oprettet af` er et
navn mod en bruger-guid). Planens præference for »konsoliderede« er altså rigtig.

`Plan`-arket giver `Abonnement-id`, `Navn på plan ` og `Dato for eksport ` — de to første
er projektets `plannerPlanId` og `plannerPlanName`, den tredje er værd at vise i
forhåndsvisningen, så man ikke importerer en eksport fra i forgårs uden at opdage det.

### Parseren skal skrives forfra
`toggl-planner-link-generator` bruger SheetJS fra CDN og kan ikke bruges. Følg Kokkeris
Paprika-mønster (§6c): en `.xlsx` er et zip-arkiv med XML.

- [x] Zip-læser i frontenden: central directory → lokal header → datastart,
      `DecompressionStream('deflate-raw')` på hver entry. ~120 linjer.
- [x] `xl/workbook.xml` + `xl/_rels/workbook.xml.rels` → arknavn til `sheetN.xml`
      (rækkefølgen i workbook.xml er **ikke** nødvendigvis `sheet1, sheet2, …` — slå
      `r:id` op i rels-filen i stedet for at gætte ud fra navnet)
- [x] `xl/worksheets/sheetN.xml` → rækker og celler. `t="str"` er det, der kommer;
      `t="s"` (sharedStrings) og `inlineStr` håndteres som fallback
- [x] `DOMParser` til XML'en; ingen egen parser

### Arkvalg og kolonner (verificeret)
- [x] Foretræk arket hvis navn indeholder `konsoliderede` — buckets er allerede opløst dér
- [x] Ellers `opgaver` + `buckets`, hvor bucket-id slås op mod bucket-navn
- [x] Fejl pænt hvis ingen af delene findes
- [x] **Trim kolonnenavnene.** Headeren hedder `"Opgavenavn "` med efterstillet mellemrum
      (`xml:space="preserve"`), og det samme gør `"Bucket-navn "`, `"Navn på plan "` og
      `"Dato for eksport "`. En lighedstest på det utrimmede navn rammer forbi.
- [x] Kolonnedetektion er **case-insensitiv præfiksmatch**, ikke lighed:

| Felt i tovo | Kolonne i eksporten | Bemærkning |
|---|---|---|
| `plannerTaskId` | `Opgave-id` | **Bekræftet — genimport er mulig.** |
| titel | `Opgavenavn ` | efterstillet mellemrum |
| sektion | `Bucket` | navn i det konsoliderede ark, id i `Opgaver` |
| status | `Status` | **ikke `Fremdrift`, som planen gættede** |
| forfaldsdato | `Forfaldsdato` | ISO-tekst |
| beskrivelse | `Noter` | **ikke `Beskrivelse`, som planen gættede** |
| underopgaver | `Tjeklisteelementer` | `;`-separeret |
| prioritet | `Prioritet` | dansk skala (`Mellem`) |

**Præfiksmatch er ikke en detalje her:** arket har både `Tjeklisteelementer` og
`Afsluttede tjeklisteelementer` (sidstnævnte er en tæller som `0/3`). Et `indeholder`-match
ville ramme begge, og så bliver underopgaverne til teksten »0/3«.

Kolonner, planen ikke kendte, og som findes: `Mål` (Planner-goals), `Tildelt til`,
`Oprettet af`, `Oprettelsesdato`, `Startdato`, `Er tilbagevendende`, `Forsinket`,
`Fuldføringsdato`, `Færdiggjort af`, `Afsluttede tjeklisteelementer`, `Mærkater`.
Ingen af dem importeres i første omgang — men `Fuldføringsdato` er den rigtige kilde til
`completedAt`, når en genimport ser en opgave, der er lukket i Planner.

**Kun ét statusord er set i virkeligheden** (`Ikke startet`). `I gang` og `Fuldført` er
stadig gæt — mapningen skal derfor være tolerant og lade en ukendt status stå som
»ikke startet« frem for at fælde importen.

### Import og genimport
- [x] Forhåndsvisning før skrivning: X nye · Y opdaterede · Z forsvundne fra Planner
- [x] **`Noter` kan være to ting, og importen skal spørge.** I den eksport, der er set,
      stod der et rent tal med dansk decimalkomma (`6,1`, `19,6`) på hver eneste opgave —
      altså timeestimater. Andreas siger, at det ikke altid vil være sådan. Reglen:
      - Er `Noter` et **rent tal** på mindst halvdelen af rækkerne, viser forhåndsvisningen
        et flueben: »Noter ligner estimater — sæt dem som estimat« (slået til).
        `6,1` → `estimateMinutes: 366`. Feltet bliver **ikke** også beskrivelse; et tal er
        ikke en beskrivelse.
      - Ellers importeres `Noter` som beskrivelse, som resten af planen siger.
      - Fluebenet gælder **kun den import**, og kun opgaver uden estimat i forvejen.
        Et estimat, der findes i tovo, er tovos — det er hele pointen med whitelisten.
      Aldrig automatik uden det viste valg: en heuristik, der stiltiende skriver i
      estimatfeltet, er præcis den slags, man opdager tre uger senere i en ugerapport.
- [x] Genimport opdaterer **kun**: titel, sektion, status, forfaldsdato, beskrivelse, underopgaver
- [x] Genimport rører **aldrig**: `estimateMinutes`, tidsposter, kommentarer, `links`,
      `budgetHours`, `priority` sat i tovo.
      Skriv det som en eksplicit whitelist i koden, ikke som en blacklist.
- [x] Forsvundne opgaver: valg mellem arkivér / spørg / ignorér, gemt som setting
- [x] Tjeklisteelementer → underopgaver (ét niveau)
- [x] Gem i batches à 25 via bulk-API'et med fremdriftsvisning (§6c)
- [x] **Vagt i `saveBulk()`:** et delvist objekt må aldrig gemmes som helt (Kokkeri §4 —
      bulk er den farlige, den kan ødelægge hundredvis af poster stille)

**Accept:** importér en rigtig eksport. Sæt estimater og registrér tid. Ret en opgave i Planner,
eksportér igen, genimportér — statussen er opdateret, estimaterne og tidsposterne er urørte.
Det er den vigtigste test i hele projektet; skriv den som en automatisk test, ikke en manuel.

**Status 2026-08-18 — fase 5 er bygget.** Genimport-testen findes som `tests/planner.test.mjs`
og gør præcis det: importerer, sætter estimat, registrerer tid, tilføjer link og kommentar,
retter planen, genimporterer — og asserterer at titel, status, sektion og forfaldsdato er
opdateret, mens estimat, prioritet, links, start-link, tidspost og kommentar er urørte. En
tredje import af den samme fil skriver **ingenting**.

Arbejdsdelingen blev en anden end planens: **alt der kan gøre skade ligger i
`app/shared/planner.js`** (arkvalg, kolonnegenkendelse, mapning, flettehvidliste), som kan
testes i Node. `app/parts/p6_planner.js` læser kun zip'en og XML'en og tegner ruden — det er
den del, der kræver en browser. Zip- og XML-vejen er verificeret i browseren mod
`tests/fixtures/planner-eksport.xlsx`: 6 ark, overskrifter med efterstillede mellemrum,
plan-id og -navn, 5 opgaver, 4 sektioner, tjeklister splittet, `Noter` genkendt som estimater
på 4 af 5 rækker — og den femte, hvor `Noter` er prosa, blev beskrivelse **uden** estimat.

---

## Fase 6 · Ugerapport

**Formål ifølge Andreas:** afstemning af tidsregistrering et andet sted, og projektoverblik til
en kunde der spørger. Rapporten skal altså være til at **læse og kopiere**, ikke til at
integrere med noget.

- [x] Vælg periode: denne uge, sidste uge, vilkårlig uge, måned
- [x] Grupperet pr. projekt → opgave, med timer pr. opgave og total pr. projekt
- [x] Marker hvad der blev **afsluttet** i perioden vs. hvad der stadig kører
- [x] Estimat vs. forbrug pr. opgave og pr. projekt
- [x] Fordeling: projekt vs. ad hoc
- [x] Sammenligning mod normtid fra settings (default 37 t) og mod forrige uge
- [x] Dage med påfaldende få timer fremhæves — det er sådan man opdager glemt registrering
- [x] **Kopiér som markdown** — én knap, klar til at klistre i OneNote
- [x] Print/PDF med samme regler som fase 4
- [x] Alle tal fra `beregn.js`, så `week_report` i MCP giver nøjagtig samme resultat

**Accept:** en uge med blandede projekt- og ad hoc-timer giver en rapport, hvis tal stemmer
med en manuel optælling. Markdown-kopien indsat i OneNote ser rigtig ud.

**Status 2026-08-18 — fase 6 er bygget.** Facit i testen er regnet i hånden (240 + 60 + 210 +
20 = 530 minutter), ikke ved at kalde den samme funktion igen. Summen af rækker = projektets
total = rapportens total; kan en kunde ikke lægge tallene sammen selv og få det samme, er
rapporten ubrugelig. Perioden er halvåben, så to naboperioder hverken tæller dobbelt eller
taber en post.

**Testen fandt en grænse, der skulle vælges bevidst:** tre timer på en mandag blev markeret
som en tynd dag. Med 37 timers norm er en dagsnorm 7,4 t, og halvdelen af den er 3,7 t — så
reglen var rigtig, og det var testdataene, der var misvisende. Tomme **hverdage** fremhæves
også, men en tom lørdag gættes der ikke på.

---

## Efter fase 6 · Ønsker fra første rigtige brug (2026-08-18)

Andreas tog v1 i brug og bad om fem ting. Alle fem er lavet, fordi de er små og retter
noget, der er i vejen hver dag — ikke fordi de stod i planen:

- [x] **Timeren skal kunne ses tælle.** Den viste `0m` i det første minut og opdaterede
      hvert 30. sekund; nu tæller den i sekunder (`0:07`, `1:02:03`) og opdaterer hvert
      sekund. Kun uret tegnes om — ikke hele bjælken, som ville rive fokus ud af knapper.
      Tiden regnes stadig ud fra starttidspunktet ved hver tegning, aldrig ved at lægge et
      sekund til en tæller (doda F8).
- [x] **Timeren er ét klik ind i opgaven** — hele feltet, ikke kun titlen.
- [x] **Timeren står i venstre menu** på desktop. Under 900 px er sidebaren et overlay, man
      ikke kan se, så dér bliver den den flydende bjælke. Ét stykke markup, to placeringer,
      og en `resize`-lytter, så den flytter med, når vinduet krydser grænsen.
- [x] **Projekterne kan foldes ud i menuen** med en chevron; valget huskes. Rækken
      navigerer, chevronen folder — to mål, derfor to knapper.
- [x] **Projektforslag mens man skriver `@navn`.** Skriver man `@BeanLedg`, mens
      »BeanLedger« findes, foreslår paletten det eksisterende projekt i stedet for at love
      et nyt. Uden det opretter man et projekt nummer to med et stavefejlsnavn.
- [x] **Timeren kan startes direkte fra et søgeresultat** — knappen i rækken eller `⌘↵`.
      At skulle åbne opgaven først var tre klik til noget, der hører til ét.
- [x] **`⌘↵` virker også i opgavelisterne**, ikke kun i paletten. En genvej, der kun virker
      ét sted, er en genvej, man ikke lærer — og den står nu i hjælpelinjen begge steder.
- [x] **Tidsstempel på kommentarer** (`today 14:33` · `18 Aug 14:32`, fuld dato som tooltip).
- [x] **Ugekalender som i Toggl** — en ny visning: dage hen ad, timer ned ad, poster tegnet
      hvor de ligger. Træk i et tomt felt registrerer tid (formularen åbnes udfyldt, så et
      fejlramt træk ikke lige har bogført en time), klik på en blok retter eller sletter den.
      Trækket bruger pointer-events og ikke HTML5 drag & drop, som ikke virker på touch (§4).
      **Det trækker fase 9's dagslinje frem** — den er i praksis lavet her.
- [x] **Today grupperer efter dagen**: overskredet · forfalder i dag · rørt i dag · resten.
      Én liste med alt i betød, at man skulle lede efter dagens arbejde.
- [x] **»Log time« viser hvilket projekt en opgave hører til.** Feltet var en flad liste af
      titler, og med opgaver fra flere projekter kunne man ikke se, hvad man valgte.
      Nu: et projektfelt, der filtrerer, og opgaverne grupperet under deres projekt med
      `<optgroup>` — native, så det virker på mobil, med tastatur og med skærmlæser uden en
      linje JavaScript. Står man i et projekt, er det forudvalgt.
- [x] **»No project« er et sted i menuen**, ikke kun en gruppe i Today. Opgaver uden projekt
      er ikke et projekt med tomt navn — de har hverken ramme eller kunde — så de har fået
      deres egen visning i stedet for projektsidens skabelon med fire tomme tal i toppen.
- [x] **Fejl fundet i brug: `@navn` alene kunne ikke lade sig gøre.** Parseren spiste hele
      teksten, og paletten svarede »there is no text to capture« — sandt og ubrugeligt.
      Nu opretter `@nyt navn` projektet, og `@eksisterende` åbner det. En besked om, at man
      ikke må, hører kun hjemme, hvor der ikke findes noget fornuftigt at gøre.
- [x] **Afsnit kan foldes sammen.** »Everything else« og »Done« begynder sammenfoldede, når
      listen er lang (over otte) — en lang liste under »det andet« er støj på en side, der
      skal svare på, hvad man laver i dag. Er der tre punkter, er det ingen støj, og så skal
      man ikke skulle klikke. Valget huskes, så snart brugeren selv har taget det, og en
      sammenfoldet række kan ikke nås med piletasterne.

---

## Fase 7 · Gentagelser og iCal

- [x] Gentagelsesregel på opgave: dagligt, hverdage, ugentligt, månedligt, hver n'te
- [x] Ny forekomst ved afslutning; estimatet arves
- [x] Gentagne opgaver kan ligge under et projekt
- [x] iCal-motoren kopieret fra doda/Muldbog. Fælderne:
  - [x] **Aldrig UTC.** `DTSTART;TZID=Europe/Copenhagen:20260817T090000`
  - [x] Linjefoldning ved **75 oktetter**, foldet på bytes — æøå fylder to
  - [x] Token i URL'en, opslag på primærnøgle, **404** ved forkert token
  - [x] Feedet må aldrig scanne datasættet — kalender-apps poller hvert kvarter
  - [x] `VALARM` **kun** på begivenheder med klokkeslæt; en heldagspost ringer ved midnat
  - [x] `VEVENT`, ikke `VTODO` — Outlook håndterer VTODO dårligt
- [x] Eventets beskrivelse indeholder **både** link til opgaven i tovo **og** start-linket
- [x] Varighed = opgavens estimat, hvis sat; ellers 1 time
- [x] "Tilføj til kalender": download af enkelt `.ics` for øjeblikkelig placering
- [x] I UI'et: skriv at Outlook opdaterer abonnementer hver 3.–24. time, og at iOS skal have
      "Remove Alarms" slået fra

**Accept:** abonnér i Outlook, verificér at en aftale kl. 9 står kl. 9 — også på den anden side
af sommertidsskiftet. Klik start-linket fra kalenderaftalen.

**Status 2026-08-18 — fase 7 er bygget.** 92 tests grønne. Sommertidsprøven er en test og ikke
en formodning: to opgaver, én 3/9 (sommertid) og én 3/12 (vintertid), begge kl. 9 — begge står
som `DTSTART;TZID=Europe/Copenhagen:…T090000`, og ingen `DTSTART` har et `Z`-suffiks.
Linjefoldningen er målt på **oktetter** på hver eneste linje i feedet, og teksten kan foldes ud
igen med æ, ø og å i behold.

Fire ting, der er værd at kende:

- **Kun én åben forekomst.** Den næste materialiseres først, når den nuværende lukkes, og den
  lukkede beholder ikke reglen — ellers ville en genåbning lave endnu en, og så er reglen om
  én åben forekomst brudt. Estimat, projekt, sektion, links og tags arves: en gentagelse er
  den samme opgave igen, ikke en ny slags arbejde.
- **Varigheden i kalenderen er opgavens estimat**, ellers en time. En aftale uden udstrækning
  ser ud som ingenting i en ugevisning.
- **Beskrivelsen bærer begge veje ind:** link til opgaven i tovo *og* start-linket, så timeren
  kan startes fra selve kalenderaftalen.
- **De to fælder står i UI'et**, ikke kun i planen: at Outlook opdaterer hver 3.–24. time, og
  at iOS stripper alarmerne, hvis »Remove Alarms« ikke slås fra ved abonnementet.

**Ikke verificeret:** at abonnementet virker i din Outlook. Feedet er kørt igennem som tekst
og opfylder RFC 5545, men et rigtigt abonnement kan jeg ikke oprette herfra.

---

## Efter fase 7 · Flere fund fra brug

- [x] **»← Projects« var død.** `gaaTil('projects')` nulstillede kun det åbne projekt, når
      view'et *skiftede* — og man var allerede på `projects`, så knappen så ud til at gøre
      ingenting. Tilstanden hører til siden, ikke til view'et, så den ryddes nu altid,
      medmindre kaldet selv angiver et projekt.
- [x] **Et projekt kunne ikke redigeres.** Navn, kunde og ramme kunne kun sættes gennem
      API'et — altså fandtes funktionen ikke. Nu er der en rude med navn, kunde, budget,
      arkivér, og en forklaring på forskellen mellem de to tal.
- [x] **Estimated vs. Budget forklarede sig ikke selv.** Hvert af de fire tal har fået en
      linje under sig (»9 task estimates, added up« · »what was agreed« · »logged so far«),
      så spørgsmålet ikke skal stilles igen.
- [x] **Budgettet blev rundet til hele timer.** 80,5 t blev til 81 — en halv time ædt tavst,
      fordi feltet gik gennem en heltals-hjælper. Rammen tåler nu decimaler.



---

## Fase 8 · MCP

§9a følges ordret. Værktøjerne kalder `beregn.js` og `parse.js` — **der må ikke findes en
særlig MCP-vej ind i dataene.**

- [ ] `app/mcp.js` + `app/oauth.js` med `srv`-injektion, kopieret fra doda
- [ ] Fælde 1: `WWW-Authenticate: Bearer realm="tovo", resource_metadata="…"` på 401 fra `/mcp`.
      Verificér med `curl -si … | grep -i www-authenticate`. **Byg den header først.**
- [ ] Fælde 2: begge `.well-known`-former serveres
- [ ] Fælde 3: offentlige OAuth-ruter uden om `securityHeaders()`
- [ ] Fælde 4: `form-action 'self' <klientens origin>` på samtykkesiden
- [ ] Egen hmac-CSRF på samtykkeformularen, `timingSafeEqual` på **bufferlængder**
- [ ] Access-tokens i den eksisterende nøgletabel med `client_id` + `expires_at`;
      udløbstjekket **i opslaget**; filtreret fra UI'ets nøgleliste med `client_id IS NULL`
- [ ] Registrerings-rate-limit sat højt (60/time)
- [ ] Værktøjer:
      `search` · `capture` (hele fangst-linjen, ikke felter) · `start_timer` · `stop_timer` ·
      `current_timer` · `log_time` (bagudrettet — den mest værdifulde) · `list_projects` ·
      `project_status` · `week_report` · `complete_task` · `update_task` · `set_estimate`
- [ ] `instructions` i initialize-svaret forklarer domænet og siger "opfind aldrig id'er"

**Accept:** de otte flow-tests fra §9a (kode på tværs af klienter, engangsbrug, PKCE, roterende
refresh, udløb, afvisning, tilbagekaldelse, scope). Mindst ét gennemløb med en rigtig fremmed
`redirect_uri` — `localhost` er same-origin og afslører ikke fælde 4. Tilslut fra claude.ai
og bed Claude om ugerapporten; tallene skal være identiske med webappens.

---

## Fase 9 · Polering

- [ ] Dagsvisning som tidslinje med huller markeret — den funktion der afslører glemt registrering
- [ ] Import af historik fra Toggl (CSV-eksport)
- [ ] PWA/manifest. Service worker **kun** hvis cache-navnet bumpes med versionen og
      precache-listen peger på `?v=N`-URL'erne (§5) — ellers hober hver release sig op
- [ ] Tastaturgenvejs-oversigt i UI'et
- [ ] Dataeksport som JSON med hård størrelsesgrænse (doda F9)

---

## Isolationstest (skrives i fase 1, køres i hver fase derefter)

Brugere må ikke kunne se hinandens data. Admin er **ingen undtagelse** — admin driver
appen (settings, backup, registrering), men ser ikke andres opgaver.

Test: opret bruger A og B. Som A: et projekt, en opgave, en tidspost, et start-link, et iCal-feed.
Som B skal alle disse give **404**:

- [ ] `GET /api/v1/items/<A's opgave-id>`
- [ ] `PATCH` på samme
- [ ] `GET /s/<A's start-token>`
- [ ] `GET /ical/<A's feed-token>`
- [ ] MCP `search` som B returnerer intet af A's
- [ ] A's opgave optræder ikke i B's søgning, rapport eller projektliste

Filteret skal ligge i `hentItem()` / `hentItems()` / `gemItem()` / `saveBulk()` selv.
Lægges det i kaldstederne, bliver ét glemt.

---

## Estimat

| Fase | Dage |
|---|---|
| −1 Læsning og opsummering | 0,5 |
| 0 Skelet | 2 |
| 1 Opgaver og søgning | 3–4 |
| 2 Tidsregistrering | 3 |
| 3 Start-links | 1–2 |
| 4 Estimater og projektoverblik | 2 |
| 5 Planner-import | 3 |
| 6 Ugerapport | 2 |
| 7 Gentagelser og iCal | 2 |
| 8 MCP | 2 |
| 9 Polering | 2 |

**I alt 22,5–25,5 fokuserede dage.** Ved aftener og weekender: 3–4 måneder.

Efter fase 3 kan Toggl afskaffes. Efter fase 6 er tovo bedre end den kombination, der bruges i dag.

---

## Efter hver fase

1. Kør `python3 build_rune.py` og **rapportér payload-størrelsen** — hold øje med de 120 K.
2. Kør hele testsuiten, inklusive isolationstesten.
3. Opsummer hvad der blev lavet, og **vent på et ja** før commit og push.
4. Læs de dele af `RUNE-ERFARINGER.md` igennem, der rører fasen — **efter**, ikke kun før.
   Kokkeri v1–v6 kørte med tre dokumenterede fælder, som først blev lukket ved et efter-tjek.
5. Nye generelle lærdomme skrives i `RUNE-ERFARINGER.md`s log (`dato · tovo · læring`),
   projekt-specifikke i `CLAUDE.md`.
