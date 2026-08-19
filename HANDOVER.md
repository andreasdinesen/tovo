# tovo — overdragelse

Skrevet 2026-08-19, efter v11. Denne fil er til den næste Claude-samtale: hvad tovo er,
hvor tingene står, og hvad man skal vide, før man rører noget.

**Læs i denne rækkefølge:** `~/ClaudeMacBook/RUNE-ERFARINGER.md` (hele filen — den er fælles
for alle Andreas' runer og indeholder de fælder, der allerede har kostet tid), derefter
`CLAUDE.md` her i repoet, og så `TOVO-PLAN.md` for den fase, du er i gang med.

---

## Hvad tovo er

Tidsregistrering på opgaver og projekter, bygget som **Yggdrasil-rune**: ren Node ≥22
(`node:http` + `node:sqlite` + `node:crypto`), **nul npm-pakker, nul CDN**. Hele appen
udgives som én YAML-fil med app-filerne pakket som brotli-komprimeret tar i base85.

Den afløser Toggl + regneark for Andreas' konsulentarbejde: opgaverne kommer fra Microsoft
Planner, timerne skal afstemmes pr. **sagsnummer** i et andet system (ServiceNow), og
start-links klikkes fra OneNote.

- Repo: `andreasdinesen/tovo` (privat) · lokalt i `~/ClaudeMacBook/tovo/`
- Kører hos Andreas på Hjorten via Yggdrasil Panel. **v11 er udgivet.** Om den er
  *installeret*, kan kun Andreas se: panelets opdatering er todelt, og v7 stod pushet i
  et døgn, mens serveren kørte v6. Versionen i appens nederste venstre hjørne er facit.
- Tvilling til `andreasdinesen/doda` — samme stak og udseende, men **ingen kobling**.

## Tilstand lige nu

| | |
|---|---|
| Version | **v11** (`APP_VERSION` i `app/parts/p1_core.js`) |
| Tests | **166**, alle grønne — `node --test tests/*.test.mjs` |
| Install-script | **113.846 / 120.000 tegn (94 %)** ← se »Pladsen« nedenfor |
| Plan | **Alle ni faser færdige.** `TOVO-PLAN.md` har ingen ukrydsede punkter |

## Sådan kører du den

```sh
cd ~/ClaudeMacBook/tovo
node --test tests/*.test.mjs      # 166 tests, ~4 sek.
python3 build_rune.py             # -> runes/tovo.yaml, rapporterer payload-størrelsen
```

Dev-server til preview-værktøjet hedder `tovo` i den **globale** `~/.claude/launch.json`
(port 8911, `TOVO_DEV=1`). **Node genindlæser ikke moduler** — efter en ændring i
`app/server.js` eller `app/shared/*.js` skal serveren genstartes, ikke bare siden
genindlæses. Det kostede mig en fejlsøgning.

## Arkitekturens ufravigelige regler

Bryder man en af dem, opstår der to sandheder, og fejlen opdages først i en rapport.

1. **Alle udregninger i `app/shared/beregn.js`.** Aldrig en udregning i `app/parts/` —
   heller ikke en lille. Webappen, serveren og MCP kalder det samme modul, og en test
   sammenligner frontendens tal med serverens på de samme data.
2. **`user_id`-filteret ligger i `hentItems` / `hentItem` / `gemItem` / `saveBulk` selv** —
   aldrig i kaldstederne. tovo er flerbruger; admin er ingen undtagelse.
3. **Én parser.** `app/shared/parse.js` tolker syntaksen alle steder: paletten, serveren,
   MCP og titlen man retter.
4. **Feltwhitelisten `FELTER` i `app/server.js`** er det, en genimport fra Planner hviler på.
   Skriv den som hvidliste, aldrig sortliste.
5. **`app/public/app.js` og `runes/tovo.yaml` er genererede.** Ret kilderne, kør build'et.
6. **Endepunkter uden login** (`/s/:token`, `/ical/:token`) må aldrig scanne datasættet og
   svarer **404** på alt forkert — aldrig 401/403.

## Filerne

```
app/server.js          hele backenden (~2900 linjer)
app/mcp.js             MCP-server, tretten værktøjer
app/oauth.js           OAuth 2.1 (kopieret fra doda, motoren er ordret den samme)
app/webauthn.js        passkeys (kopieret fra doda)
app/shared/beregn.js   ALLE udregninger + formatering af varigheder
app/shared/parse.js    fangst-syntaksen og dansk datosprog (fra doda, ændrede markører)
app/shared/planner.js  Planner-eksporten: arkvalg, kolonner, fletning (testbar uden browser)
app/shared/toggl.js    Toggl-CSV (testbar uden browser)
app/shared/xlsx.js     skriver .xlsx uden pakker (zip med metode 0 + CRC32)
app/parts/p1_core.js   skal, tema, login, indstillinger  ← APP_VERSION står her
app/parts/p2_omni.js   kommandopaletten
app/parts/p3_opgaver.js opgave- og projektvisninger, detaljeruden
app/parts/p4_timer.js  timeren og manuel registrering
app/parts/p5_kunde.js  kundevisning og print
app/parts/p6_planner.js zip/XML-læsning + importruden
app/parts/p7_rapport.js ugerapporten
app/parts/p8_kalender.js ugekalenderen
app/parts/p9_polering.js Toggl-import, genveje, Excel-download
app/parts/pa_tavle.js  kanban-tavlen
app/parts/pb_tags.js   mærkaterne
```

**Delene samles alfabetisk** til `app/public/app.js`, og `app/shared/*.js` lægges FØRST.
Et delt modul, der bruger et andet, skal derfor komme efter det i alfabetet
(`beregn.js` før `parse.js`).

## Syntaksen i søgefeltet

| Skriv | Betyder |
|---|---|
| `+ tekst` | opret en opgave |
| `@projekt` · `/projekt` | læg under et projekt — `@"To ord"` ved mellemrum |
| `#tag` | sæt et mærkat |
| `:SAG-1234` | sagsnummer (arves fra projektet, hvis opgaven ikke har sit eget) |
| `~2,5t` | estimat — dansk decimalkomma virker |
| `!fredag` | forfaldsdato · `!every monday at 9` er en gentagelse |
| `%` | opret **og start timeren** med det samme |
| `tekst // mere` | alt efter `//` bliver beskrivelsen |

Det hele virker også, når man **retter en titel** — undtagen `%`, som er en handling ved
oprettelsen og derfor bliver stående.

## Arbejdsgangen (Andreas' regler)

- **Bump aldrig `APP_VERSION` undervejs.** Kun ved udgivelse, efter et udtrykkeligt ja.
- **Commit og push kræver et udtrykkeligt ja.** Et push er en udgivelse.
- Efter hver ændring: byg, kør testene, opsummer — og vent.
- Ny generel lærdom → loggen i `RUNE-ERFARINGER.md` (og push det repo). Projekt-specifik →
  `CLAUDE.md` her.
- Panelets opdatering er todelt: **Runes → Browse GitHub → Reload** henter rune-definitionen,
  **Serveren → Settings → Update** installerer appen. `/data` overlever.

## Pladsen — det vigtigste åbne punkt

Install-scriptet er på **94 % af de 120.000 tegn**. Loftet er Linux' `MAX_ARG_STRLEN`
(131.072 b), fordi scriptet køres som ét `sh -c`-argument. Næste større funktion kræver,
at noget ryger ud.

**Mål før du barberer** (RUNE-ERFARINGER §2): brotli+base85 er allerede i bund, og
kommentar-strip af den udgivne kopi kører. Den næste målte mulighed er **dodas ubrugte CSS**:
`app/public/style.css` er kopieret ordret fra doda og bærer klasser, tovo aldrig bruger.
Lav et leave-one-out (komprimér tar'en uden hver fil på skift) før du beslutter noget —
rå filstørrelse siger næsten intet.

## Hvad der IKKE er verificeret

Det her kan jeg ikke prøve fra en browser i et værktøj. Sig det ærligt videre:

1. **Kalenderabonnementet i Outlook.** Feedet opfylder RFC 5545, og sommertidsprøven er en
   test (en aftale kl. 9 står kl. 9 på begge sider af skiftet) — men et rigtigt abonnement
   er ikke prøvet.
2. **Connectoren fra claude.ai.** Alle otte OAuth-flowtests kører med en rigtig fremmed
   `redirect_uri`, så fælde 4 er udelukket. Men ingen har tilsluttet den fra claude.ai.
3. **Start-links klikket fra en rigtig OneNote-side.** `onenote:`-klienten håndterer links
   anderledes end en browserfane.
4. **Service workerens registrering.** Claude Codes browser-panel kan ikke registrere service
   workers overhovedet — heller ikke mod en nøgen server (doda F6). Det statiske er tjekket:
   cache-navnet bærer versionen, og build'et fælder, hvis precache-listen ikke matcher
   `index.html`.
5. **Toggl-importen mod Andreas' egen eksport.** Kørt mod en syntetisk CSV med Toggls
   kolonnenavne.
6. **Excel-filerne åbnet i rigtig Excel.** De er verificeret som gyldige zip-arkiver med
   gyldig XML, læst tilbage af både Pythons `zipfile` og tovos egen zip-læser.

## Hvad der kom til UDEN at stå i planen

Otte-ti ting kom af, at Andreas brugte appen, mens den blev bygget — de er ofte mere værd
end planens punkter. De står under »Efter fase 6 · Ønsker fra første rigtige brug« og
»Efter fase 7« i `TOVO-PLAN.md`: kanban-tavlen, sagsnumre med ServiceNow-links,
timesedlen pr. dag, decimaltimer, Excel-eksport, tags-visningen, ugekalenderen,
`%`-genvejen, foldbare afsnit og projektlisten.

**Bliv ved med at spørge til de små ting.** Fejlene, der blev fundet i brug — at tags ikke
kunne oprettes, at `@navn` alene svarede »there is no text to capture«, at »← Projects« var
død, at budgettet blev rundet til hele timer — var alle usynlige i tests, fordi ingen test
tænker på at skrive halvdelen af en syntaks.

## Test-noter, der har betalt sig

- Kør altid med `BIND_PORT=0`, og tag serverens stderr med i timeout-beskeden.
- **Tastaturnavigation kan ikke testes gennem browser-panelet** — det sender syntetiske
  keydown med tom `e.key`. Dispatch en rigtig `KeyboardEvent` med `key` sat.
- **Vælg testdata, der ligger skævt** i forhold til den regel, du tester. En test med lutter
  hele kvarter kan ikke se en afrundingsfejl — min bestod med en bevidst saboteret server,
  indtil den fik en post på 22 minutter.
- **En test, man ikke har set fejle, er en formodning.** Rul rettelsen tilbage og se den
  blive rød. Det gælder også build'ets spærrer (require-listen, precache-listen).
- **En scriptet tekstudskiftning uden en assertion er en tavs no-op.** Det ramte mig to gange
  på én dag.
