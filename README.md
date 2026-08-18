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
| 7 | Gentagelser og iCal-feed | næste |
| 8 | MCP-server + connector til claude.ai | |
| 9 | Polering | |

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
