# tovo

Tidsregistrering på opgaver og projekter, bygget som **Yggdrasil-rune**.
Ren Node ≥22 (`node:http` + `node:sqlite` + `node:crypto`) — nul npm-pakker, nul CDN.

tovo er en tvilling til [doda](https://github.com/andreasdinesen/doda): samme stak, samme
udseende, men separate apps med hver sin database og ingen synkronisering.

## Hvad den skal kunne

| Fase | Indhold | Status |
|---|---|---|
| 0 | Skelet: login, flerbruger-isolation, build med brotli+base85 | **færdig** |
| 1 | Opgaver, projekter, søgepalet med `+`-syntaks | **færdig** |
| 2 | Timer og manuel tidsregistrering | **færdig** |
| 3 | Start-links til OneNote (`/s/:token`, uden login) | **færdig** |
| 4 | Estimater, projektoverblik og kundevisning | **færdig** |
| 5 | Import og genimport fra Microsoft Planner | **færdig** |
| 6 | Ugerapport | **færdig** |
| 7 | Gentagelser og iCal-feed | **færdig** |
| 8 | MCP-server + connector til claude.ai | **færdig** |
| 9 | Polering | **færdig** |

Hele planen står i `TOVO-PLAN.md`, projektreglerne i `CLAUDE.md`.

## Lokal kørsel

```sh
BIND_PORT=8911 DATA_DIR=/tmp/tovodata TOVO_DEV=1 node app/server.js
python3 build_rune.py          # -> runes/tovo.yaml
node --test tests/*.test.mjs
```

`app/public/app.js` og `runes/tovo.yaml` er **genererede** — ret kilderne og kør build'et.

## Installation i panelet

Runes → Browse GitHub → Reload henter rune-definitionen.
Serveren → Settings → Update/Reinstall installerer selve appen; `/data` overlever.

## Syntaks i søgefeltet

| Skriv | Betyder |
|---|---|
| `+ tekst` | opret en opgave (feltet søger, når der ikke står `+`) |
| `@projekt` · `/projekt` | læg den under et projekt — `@"To ord"` |
| `#tag` | sæt et mærkat |
| `!dato` | `!i morgen`, `!fredag`, `!3/9`, `!in 2 weeks`, `!every monday at 9` |
| `~estimat` | `~2t`, `~90m`, `~1,5t`, `~1t30m` — dansk decimalkomma virker |
| `tekst // mere` | alt efter `//` bliver beskrivelsen |

`Cmd/Ctrl+K` åbner feltet overalt. Piletaster fører ind i listen, Enter åbner,
mellemrum afslutter, Esc slipper listen igen.

## Versionshistorik

### v10 — tavlen fylder skærmen, og importen fortæller om kolonnerne

- **Tavlen får sin egen bredde.** `.page` er 760 px — en læsebredde, rigtig til tekst og
  forkert til fem kolonner à 260 px. Tavlen lå og scrollede vandret i en spalte, der var
  smallere end tre kolonner. Projektsiden er nu bred, når den viser tavlen, og kolonnerne
  klemmes ned til 210 px, før tavlen begynder at rulle. Fem kolonner er synlige på én gang
  fra ~1.250 px og opefter.
- **Importen siger, hvor mange kolonner den henter ind** — og hvilke. Før skrev den dem
  stiltiende, så man først kunne se bagefter, om planens buckets var læst rigtigt.
- **Knappen lover det, der faktisk sker.** Den sagde »Update 9 tasks« — eksportens antal —
  også når forhåndsvisningen lige ovenover sagde 0 nye og 0 opdaterede. Nu:
  »Update 3 tasks and 2 columns«, eller »Nothing to change«.
- **Rettet: et rent tal i `Noter` gjorde hver genimport til en falsk ændring.** Blev
  `Noter` brugt som estimater ved importen, blev tallet med vilje ikke gemt som
  beskrivelse — men genimporten sammenlignede tovos tomme beskrivelse med eksportens
  `6,1` og meldte opgaven som »skal opdateres« for evigt. Et tryk på knappen ville have
  skrevet tallet ind i beskrivelsen og omgjort reglen tavst. Et tal er ikke en
  beskrivelse, heller ikke ved en genimport — og en beskrivelse, du selv har skrevet i
  tovo, overlever nu en genimport.

### v9 — kopiér en opgave, kolonne i ruden, og alle buckets bliver kolonner

- **Kopiér en opgave.** Knappen `Duplicate` i opgaveruden — og `duplicate_task` i MCP, så
  Claude kan det samme. Kopien bærer det, der beskriver **arbejdet**: noter, projekt,
  kolonne, estimat, forfaldsdato, sagsnummer, mærkater og links, og den begynder som åben.
  Tidsposter, kommentarer, start-linket og en gentagelsesregel bliver på originalen —
  historik hører til det arbejde, der *er* udført, og to opgaver med samme start-link ville
  dele ur.
- **`Column` i stedet for `Priority`** i opgaveruden: en dropdown med projektets egne
  kolonner, så en opgave kan flyttes uden at trække et kort. Har projektet ingen kolonner,
  er feltet der ikke. Prioriteten importeres stadig fra Planner og overlever enhver
  gemning — den var bare vist ingen steder.
- **Planner-import laver nu ALLE planens buckets til kolonner** — også de tomme, og i
  planens egen rækkefølge. Før blev kolonnerne udledt af de buckets, opgaverne *pegede på*,
  så en plan med alt i »Backlog« gav én kolonne, og præcis de faser, man havde lavet for at
  kunne flytte noget derhen, fandtes ikke. En genimport føjer nye buckets til uden at røre
  de kolonner, der er i forvejen — heller ikke dem, du selv har lavet.
- **Format-knappen i rapporten hedder nu `Format: 3,5`** i stedet for bare `3,5`. Et bart
  tal siger hverken, at knappen er en omskifter, eller hvad den skifter.

### v8 — ⌘↵ i alle ruder, og mærkaterne kan ses

- **⌘↵ (Ctrl+↵) gemmer i alle ruder:** opgave, projekt, Log time, kolonner og omdøb-mærkat.
  Genvejen står nu **på Gem-knappen** i alle fem — en genvej, ingen kan se, findes ikke.
  Den er bundet på hver rudes egen gemme-funktion og ikke på »den primære knap i det åbne
  vindue«, så et spørgsmål aldrig kan besvares ved et uheld.
- **Mærkaterne vises i opgaveruden.** `#Ai` i en titel har sat mærkatet siden v7, men intet
  sted i ruden viste det — så funktionen lignede en, der ikke virkede. Opgavens mærkater
  står nu som chips under titlen, hvert med et kryds, og en linje siger, hvordan man
  tilføjer flere. Fjernede mærkater gemmes først ved Save, så Cancel fortryder dem.

### v7 — Excel-eksport, decimaltimer og syntaks i en titel man retter

- **Excel:** rapporten og kundevisningen kan hentes som `.xlsx`, skrevet uden en eneste
  pakke. Tallene skrives som **tal**, ikke tekst, så de kan lægges sammen i Excel uanset
  om maskinen står på dansk eller engelsk komma. Rapporten får tre ark: pr. sag pr. dag,
  pr. opgave pr. dag, pr. projekt.
- **Decimaltimer:** `3h 30m` skrives `3,5`. Totalerne regnes på minutterne og formateres
  til sidst, så en uge ikke kan mangle et minut, fordi decimaler blev lagt sammen.
- **Per sagsnummer pr. dag** som en matrix med én kolonne pr. dag — den opgørelse, timerne
  skrives af fra. Rækker og kolonner summerer begge til totalen.
- **Syntaks i en titel man retter:** `#Ai` i en eksisterende titel bliver et mærkat. Hele
  syntaksen virker (`#tag @projekt :sag ~estimat !dato`); mærkater lægges til. `%` er den
  ene uden en modtager ved redigering og bliver stående i titlen.
- Tavlen fik tastaturnavigation; venstre/højre skifter kolonne.

### v6 — kanban, sagsnumre, tags og % til at starte uret

- **Kanban-tavle** på projektet. Kolonnerne er projektets sektioner, så to projekter kan
  have hver sine faser, og en Planner-import skriver bucket'erne direkte ind. Træk og slip
  med pointer-events, og hvert kort har en menu til at flytte uden at trække.
- **Sagsnummer** på opgaver og projekter (`:SAG-1234`). Opgaven arver projektets, medmindre
  den har sit eget — arven læses ved opslaget, så en rettelse gælder hele historikken.
  Et link-mønster med `{case}` gør hvert nummer til et link ind i fx ServiceNow.
- **Timeseddel** i rapporten: timer pr. dag pr. opgave med sagsnummer, hvor rækker og
  kolonner begge summerer til totalen.
- **Tags** som eget punkt i menuen med antal pr. mærkat, opgaverne bag tallet, omdøb og
  slet (som også fjerner mærkatet fra opgaverne, med fortryd).
- Gentagelser kan rettes og stoppes i opgaveruden. Parseren lærte `every 2 weeks on friday`.
- Projekter kan vises som liste i stedet for kort.
- **`%`** hvor som helst i fangst-linjen opretter opgaven **og** starter uret.

### v5 — Claude, huller og historik

**Fase 9:**

- **Hullerne på dagen** vises på Today: mellemrummene mellem det, du faktisk har registreret.
  Et klik åbner registreringen udfyldt med tidsrummet. Det er den funktion, der afslører
  glemt tid.
- **Import af historik fra Toggl** (detaljeret rapport som CSV). Posterne mærkes `import`,
  så en rapport kan kende dem fra tid, du har taget i tovo.
- **Genvejsoversigt** i brugermenuen.
- **JSON-eksport** af alt dit — uden hemmeligheder, med en hård grænse.
- **PWA:** service worker med versioneret cache; build'et fælder, hvis precache-listen ikke
  matcher `index.html`.

**Fase 8:**

- **MCP-server** på `/mcp` med tolv værktøjer: `capture` · `search` · `list_projects` ·
  `project_status` · `start_timer` · `stop_timer` · `current_timer` · `log_time` ·
  `week_report` · `complete_task` · `update_task` · `set_estimate`.
- **OAuth 2.1** med dynamisk klientregistrering, PKCE og roterende refresh, så claude.ai kan
  forbinde sig selv. Samtykkesiden er server-renderet uden JavaScript.
- **Adgangsnøgler** med scope (full/read/capture) til Claude Code og lignende — vises én gang,
  gemmes kun som hash, kan tilbagekaldes med øjeblikkelig virkning.
- Værktøjerne kalder de samme funktioner som webappen, så en ugerapport hentet af Claude er
  det samme tal som det på skærmen.

### v4 — gentagelser og kalender

- **Gentagne opgaver.** `!every monday at 9` i søgefeltet; næste forekomst opstår, når den
  nuværende afsluttes, og arver estimat, projekt, links og tags.
- **iCal-feed:** abonnér i Outlook eller på telefonen, så deadlines står i din egen kalender.
  Aftalen varer så længe estimatet siger, beskrivelsen indeholder både link til opgaven og
  start-linket, og påmindelser sættes kun på opgaver med et klokkeslæt.
- **»Add to calendar«** på en enkelt opgave (.ics-download).
- Projekter kan **redigeres** (navn, kunde, budget, arkivér), og de fire tal på projektsiden
  forklarer sig selv.

### v3 — ugekalender og dagens overblik

- **Ugekalender** som i Toggl: dage hen ad, timer ned ad, tidsposterne tegnet dér hvor de
  ligger. Træk i et tomt felt for at registrere tid, klik en blok for at rette eller slette
  den. Overlappende poster lægges ved siden af hinanden, og den kørende timer er stiplet.
- **Today grupperer efter dagen**: overskredet · forfalder i dag · rørt i dag · resten.
- Kommentarer får et **tidsstempel** (`today 14:33`, `18 Aug 14:32`).
- `⌘↵` starter timeren på den markerede opgave — også i opgavelisterne, ikke kun i paletten.
- »Log time« har fået et **projektfelt**, og opgaverne er grupperet under deres projekt.
- **»No project«** i menuen: opgaver, der ikke hører til et projekt, har fået deres eget sted.
- **`@navn` alene** opretter projektet (eller åbner det, hvis det findes).
- **Lange afsnit kan foldes sammen** — og begynder sammenfoldede, når de er lange.

### v2 — fase 4, 5 og 6

- **Kundevisning** af et projekt: en ren opgørelse med estimat og forbrug pr. opgave, klar
  til at vise eller printe. Print bruger egne, eksplicitte farver — aldrig temaets.
- **Import og genimport fra Microsoft Planner.** Ét projekt pr. plan, buckets bliver
  sektioner, tjeklister bliver underopgaver. En genimport opdaterer kun titel, sektion,
  status, forfaldsdato og beskrivelse — estimater, tid, kommentarer, links og ramme er tovos
  egne og overlever enhver import. Er `Noter`-kolonnen fyldt med tal, spørger importen, om de
  skal læses som estimater.
- **Ugerapport** med timer pr. projekt og opgave, estimat mod forbrug, fordeling på projekt
  og ad hoc, sammenligning med normtid og forrige periode, og fremhævning af dage med
  påfaldende få timer. Kan kopieres som markdown eller printes.
- Timeren tæller **synligt i sekunder**, står i venstre menu (og som en flydende bjælke på
  mobil, hvor menuen er skjult) og er ét klik ind i opgaven.
- **Projekterne kan foldes ud i menuen**, så man kan hoppe direkte ind i dem.
- Søgefeltet foreslår **eksisterende projekter**, der ligner det, man skriver — så man ikke
  opretter »BeanLedg« ved siden af »BeanLedger«.
- Timeren kan startes **direkte fra et søgeresultat** med knappen eller `⌘↵`.

### v1 — fase 0–3

- Auth-stakken fra doda: scrypt, sessionscookie `tovo_session`, passkeys (WebAuthn),
  rate-limit i databasen. Første registrerede bruger bliver admin.
- **Flerbruger fra bunden.** `user_id`-filteret ligger i `hentItems` / `hentItem` /
  `gemItem` / `saveBulk` selv — aldrig i kaldstederne. Admin er ingen undtagelse.
- Skema: `items` (projekt/opgave/kommentar/tag som JSON med udtryks-indeks),
  `time_entries`, `start_tokens`, `ical_feeds` — plus et unikt indeks, der gør
  "kun én kørende timer" til en regel i databasen.
- `build_rune.py`: brotli q11 + base85 (alfabet uden `{ } \`), kommentar-strip af den
  udgivne kopi, require-spærre, rundtur med præcis den dekoder der udgives,
  `update:`-blok og `{{NODE_IMAGE}}`. Install-scriptet måler 52.811 / 120.000 tegn.
- Opgaver, projekter (med sektioner), kommentarer og tags — søgefeltet opretter og finder
  begge dele, og arbejder kun i det projekt, man står i.
- Den delte parser fra doda med tovos markører: `~` er estimat, `#` er tag.
  `onenote:`-links kan gemmes på en opgave og klikkes.
- **Timer og manuel registrering er ligeværdige indgange.** Timeren gemmer starttidspunktet
  og overlever både en genindlæsning og en genstart af serveren; databasen — ikke
  applikationslogikken — håndhæver, at der kun kører én ad gangen. Manuelt kan der registreres
  på en vilkårlig dato med `9-11.30`, `1,5t`, `90m` eller `1t30m` (`⌘⇧M`).
- Enhver post kan rettes og slettes, uanset kilde, med 10 sekunders fortryd, der lægger posten
  tilbage præcis som den var — samme id, samme kilde, samme sekunder.
- Afrunding (ingen/5/10/15 min) er en **visningsregel**; de gemte tider er altid de rigtige.
- Alle tal kommer fra `app/shared/beregn.js`, som både serveren og browseren kører. En test
  regner frontendens tal ud på serverens data og sammenligner dem felt for felt.
- **Start-links til OneNote.** Ét klik på `/s/<token>` starter timeren, næste klik stopper
  den — uden login. Kvitteringssiden er server-renderet uden JavaScript og viser opgaven,
  projektet, dagens timer og en stop-knap. Hele projektets links kan kopieres som en
  markdown-liste. Et forkert eller tilbagekaldt link svarer 404 og røber ingenting.
