# tovo — arkitektur og ufravigelige regler

De regler, der holder flerbrugerlaget, beregningerne og det offentlige repo på plads. Kort udgave i `CLAUDE.md`.

## Ufravigeligt

- **Nul npm-pakker, nul CDN.** Node ≥22: `node:http`, `node:sqlite`, `node:crypto`.
- **Alle beregninger i `app/shared/beregn.js`.** Aldrig en udregning i `app/parts/`, heller
  ikke en lille. Webappen og MCP skal give samme tal, ellers er der to sandheder.
- **`user_id`-filteret ligger i `hentItem` / `hentItems` / `gemItem` / `saveBulk` selv** —
  aldrig i kaldstederne. Brugere må ikke se hinandens data. Admin er ingen undtagelse.
- **Genimport fra Planner rører kun en whitelist af felter.** Estimater, tidsposter,
  kommentarer, links og projektramme er tovos egne og skal overleve enhver import.
- **Endepunkter uden login** (`/s/:token`, `/ical/:token`) må aldrig scanne datasættet,
  og svarer **404** ved forkert token — ikke 401 eller 403.
- `app/public/app.js` og `runes/tovo.yaml` er **genererede** — redigér dem aldrig i hånden.
- **Adgangsnøgler har en `user_id`.** En nøgle giver adgang til sin egen brugers data og
  intet andet. Uden det rammer den "første bruger i tabellen", som i doda.
- **`settings` har `(scope, key)`** hvor scope er brugerens id eller `*` for installationen.
  Kun admin må skrive `*`-nøglerne (i dag: `allow_registration`).
- **En visningspræference, brugeren ville forvente overalt, hører i `settings` — ikke i
  `localStorage`.** localStorage betyder »husket i DENNE browser«, og tovo bruges på både
  telefon og desktop. Gå gennem `brugerFlag()` / `saetBrugerFlag()` i `p1_core.js` — de
  læser `state.settings` (hentet ved opstart, så ingen ny rute og intet ekstra kald),
  skriver optimistisk og tager den gamle localStorage-nøgle som reserve, så et valg fra
  før flytningen ikke kastes væk. Nøgler i dag: `view_projects_list`, `fold_<afsnit>`,
  `board_<projektId>`. **Egen nøgle pr. projekt, aldrig ét JSON-kort** — settings-værdier
  afkortes til 2000 tegn, og et kort med mange projekt-id'er ville tavst miste de sidste.
- **To ting bliver med vilje i `localStorage`, fordi de hører til ENHEDEN og ikke til
  brugeren:** `tovo_theme` (skal læses før første paint, hvor der ikke er noget netværk —
  og lyst/mørkt er et valg pr. skærm) og `tovo_nav_skjult` (afhænger af skærmbredden).
  Flyt dem ikke.

## Repoet er OFFENTLIGT

`andreasdinesen/tovo` er offentligt, fordi install-scriptet henter app-koden fra
codeload.github.com, og det spørger ikke om et token.

- **Aldrig kundedata i koden** — heller ikke som eksempel i en test eller en
  dok-kommentar. Eksemplerne hedder `Nordvind` (opdigtet kunde) og `SAG-…`
  (sagsnumre). Historikken blev renset én gang; den øvelse skal ikke gentages.
- Fixturer skal være syntetiske. `tests/fixtures/planner-eksport.xlsx` bruger »Testkunde«.

## Læsningen af doda (2026-08-18)

Ved projektstart: læs kildekoden i `andreasdinesen/doda`, især `app/shared/parse.js`
(quick-add-syntaksen, hvor `+` opretter en opgave), `app/mcp.js`, `app/oauth.js` og
`app/public/style.css`. tovo skal føles som doda.

**Læst 2026-08-18. Det er allerede fundet, så det behøver ikke findes igen:**

- Dodas markører er `#@!~/`. `~` betyder dér *udskudt dato*, og `/` er en anden
  projektmarkør ved siden af `@`. I tovo betyder **`~` estimat** (`~2t`, `~90m`, `~1,5t`),
  **`#` tag**, og `@`/`/` projekt. Defer-grenen skal FJERNES, ikke bare lades ligge —
  en parser, der producerer felter, modtageren ikke har, taber tekst tavst.
- **doda er en én-brugers app** (`SELECT ... FROM users LIMIT 1` i `godkend()`).
  Flerbrugerlaget er tovos eget. Kopiér auth-stakken, men aldrig dataadgangen.
- **Style.css er dodas, kopieret ordret.** Nye regler skrives i tovo-blokken nederst,
  så arven kan opdateres i én blok, når doda retter noget.


## Fra byggeplanen og overdragelsen (stadig gyldigt)

- **Én parser.** `app/shared/parse.js` tolker syntaksen alle steder: paletten, serveren,
  MCP og titlen man retter.
- **Feltwhitelisten `FELTER` i `app/server.js`** er det, en genimport fra Planner hviler på.
  Skriv den som hvidliste, aldrig sortliste. Rensningen sker ét sted (`gemItem`), så hverken
  en rute, en import eller MCP kan smugle et ukendt felt ind. **Fælde:** hvidlisten åd den
  bløde sletning, fordi `deletedAt` ikke er et modelfelt — interne felter føres med eksplicit.
- **Blød sletning ligger som `deletedAt` i JSON'en**, og filteret ligger i
  `hentItems`/`hentItem`, ikke i kaldstederne.
- **Skemaet:** `m1` kerne (users, sessions, settings, rate, audit, credentials, tokens) og
  `m2` domæne (`items`, `time_entries`, `start_tokens`, `ical_feeds`), styret af
  `PRAGMA user_version`. Tidsposter har en **rigtig tabel** frem for items-tabellen: de
  forespørges på tidsinterval og summeres, og `json_extract` pr. række i en ugesum er
  unødigt. Start- og iCal-tokens har rigtige kolonner, fordi de slås op fra endepunkter
  uden login og aldrig må scanne datasættet.
- **Udtryks-indeks på de JSON-felter, der slås op** (`plannerTaskId`, `projectId`) — ellers
  er genimport en fuld scanning pr. opgave i eksporten. (doda m2: alt, der forespørges,
  får en rigtig kolonne eller et indeks.)
- **Ét kørende ur pr. bruger håndhæves af databasen** (`ix_te_running`, unikt indeks på
  `user_id WHERE stopped_at IS NULL`) — stol ikke kun på applikationslogikken.
- **`source` på en tidspost** er en af `timer`, `manuel`, `link`, `mcp`, `import` (`KILDER`
  i server.js). `import` (Toggl) er med, så en rapport kan sige, at timerne er båret ind
  fra et andet system.
- **Opgavens `status` har tre værdier** (`open`/`doing`/`done`). Planner har »I gang«, og
  uden den ville hver genimport kaste information væk.
- **Delene samles alfabetisk** til `app/public/app.js`, og `app/shared/*.js` lægges FØRST.
  Et delt modul, der bruger et andet, skal derfor komme efter det i alfabetet
  (`beregn.js` før `parse.js`).
- **Isolationen og de token-baserede endepunkter:** uden session virker både `/s/:token` og
  `/ical/:token` — det er hele deres formål, for hverken OneNote eller en kalender-app kan
  sende cookies. Adressen *er* legitimationen, og den kan tilbagekaldes. Reglen handler om
  en **fremmed session**: B må ikke kunne betjene A's link fra sin egen browser → 404.
  Hele tjeklisten står som én test i `tests/isolation.test.mjs` (»PLANENS TJEKLISTE«).
- **Admin er ingen undtagelse:** admin driver appen (settings, backup, registrering), men
  ser ikke andres opgaver. Første registrerede bruger er admin.
