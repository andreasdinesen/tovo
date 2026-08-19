# tovo — projektregler

Tidsregistrering på opgaver og projekter. Yggdrasil-rune. Tvilling til doda, men
**ingen kobling til den**: separate apps, separate data, ingen synkronisering.

## Ny samtale? Læs HANDOVER.md først

`HANDOVER.md` er den korte vej ind: hvad tovo er, hvor tingene står, arkitekturens
ufravigelige regler, hvad der ikke er verificeret, og hvor pladsen i install-scriptet er.
Denne fil er reglerne; handover'en er tilstanden.

## Før du gør noget

Læs `~/ClaudeMacBook/RUNE-ERFARINGER.md` — hele filen. Læs den igen **efter** et større
stykke arbejde, ikke kun før. Læs `TOVO-PLAN.md` for fasen du er i gang med.

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

## Arbejdsgang

- **Bump aldrig `APP_VERSION` undervejs.** Kun ved udgivelse, efter Andreas har sagt ja.
  Flere ændringer samles i én version.
- **Commit og push kræver et udtrykkeligt ja.** Et push er en udgivelse.
- Efter hver ændring: byg, test, opsummer — og vent.
- Ny generel lærdom → loggen i `RUNE-ERFARINGER.md`. Projekt-specifik → denne fil.

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

## Payload-budget

Loftet er ~120 K i install-scriptet (`MAX_ARG_STRLEN` er 131.072 b). brotli q11 + base85,
alfabet uden `{ } \``. **Rapportér den målte størrelse efter hver `build_rune.py`.**

De delte moduler (`beregn.js`, `parse.js`) ligger i payloaden **to gange** — inde i `app.js`
og som selvstændige filer serveren kan `require`. Det alene kostede Beanledger 10 K.
Bliver det trangt: mål komprimering og kodning før du barberer kildekode.

## Faldgruber der allerede har kostet tid i andre runer

- `crypto.randomUUID()` findes ikke over http (panelets IP:port) — brug altid
  `crypto.getRandomValues`-fallback, ellers dør alt der opretter id'er, stille.
- CSS skal have `[hidden]{display:none!important}`.
- Mobilgrænsen er **900 px** og bor i én konstant, brugt af både `matchMedia()` og `@media`.
- `render()` må ikke `scrollTo(0,0)` ved gentegning af samme side.
- `overflow-wrap: break-word` på `body` — Planner-titler er lange og ubrudte.
- Print-HTML må aldrig bruge `var(--…)`-farver. Giv `@media print` egne eksplicitte farver.
- Serveren logger `server.address().port`, ikke `BIND_PORT`.
- Bind aldrig til `PORT_KODA` / `KODA_PORT` — det er host-porten.
- Netværksfejl oversættes i den fælles `api()`-indpakning; `ex.message` må aldrig nå en toast.
- `Object.assign({headers}, opts)` er shallow — sæt headers **efter** merge.
- Cache-bust: `app.js?v=N` stemplet i `index.html` af build'et, og **skriv HTML'en tilbage
  til disk**, ellers pakker tar'en den gamle. HTML serveres `no-store`.

## Lokal kørsel

```sh
BIND_PORT=8911 DATA_DIR=/tmp/tovodata TOVO_DEV=1 node app/server.js
python3 build_rune.py
node --test tests/*.test.mjs
```

Dev-serveren til preview-værktøjet hedder `tovo` i den **globale** `~/.claude/launch.json`
(port 8911 — 8902 er kokkeris). `TOVO_DEV=1` slår `immutable`-cachen fra; uden den
revalideres en cachet `app.js?v=1` aldrig, og man fejlsøger kode, der ikke er indlæst.

## Test

- Kør altid med `BIND_PORT=0`; tag serverens stderr med i timeout-beskeden.
- **Tastaturnavigation kan ikke testes gennem browser-panelet** — det sender syntetiske
  keydown med tom `e.key`. Dispatch en rigtig `KeyboardEvent` med `key` sat.
- **Mål efter animationen, ikke under den.** Verificér på den egenskab der ER ændret
  (`getComputedStyle().transform`, en klasse), ikke på geometri der først lander bagefter.
  Screenshots midt i en transition lyver.
- Isolationstesten (to brugere, 404 overalt) køres i hver fase, ikke kun én gang.
  Den ligger i `tests/isolation.test.mjs` og er **set fejle**: fjern `AND user_id = ?`
  i `hentItem`, og to tests bliver røde. En test, man ikke har set fejle, er en formodning.
- Build'ets require-spærre er også set fejle (fjern `app/webauthn.js` → build'et stopper).
- Genimport-testen (importér, sæt estimat, registrér tid, ret i Planner, genimportér,
  assertér at estimat og tidsposter er urørte) er den vigtigste test i projektet.
- Print testes ved at stubbe `window.print` og inspicere `#printHost`. `afterprint` fyrer
  ikke med en stub — sæt `document.title` tilbage manuelt bagefter.

## Ikke i scope

Offline-tilstand, service worker-kø, fakturerbarhed, Notion-integration, deling mellem
brugere, synkronisering med doda, OneNote-API (kun links).
