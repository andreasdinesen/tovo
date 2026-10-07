# tovo — funktionernes designvalg

Begrundelser bag de enkelte funktioner. Flyttet fra den gamle byggeplan og overdragelsen, tjekket mod koden 2026-10-07. Brugervendt beskrivelse og versionshistorik står i `README.md`.

## Syntaks ud over README'ens tabel

| Skriv | Betyder |
|---|---|
| `:SAG-1234` | sagsnummer (arves fra projektet, hvis opgaven ikke har sit eget) |
| `%` | opret **og start timeren** med det samme |

Det hele virker også, når man **retter en titel** — undtagen `%`, som er en handling ved
oprettelsen og derfor bliver stående. `@nyt navn` alene opretter projektet, og
`@eksisterende` åbner det. Skriver man `@BeanLedg`, foreslår paletten det eksisterende
projekt i stedet for at love et nyt.

## Paletten og tastaturet

- **Kun piletaster fører ind i listen**, aldrig bogstaver — bogstaver skal kunne skrives i
  søgefeltet. Dodas regel er vendt om: kun en liste, der selv siger `data-keynav-letters`,
  beholder bogstaverne. `Esc` slipper listen igen.
- **Kontekstbevidsthed:** står man i et projekt, søger og opretter feltet kun der.
- **`⌘↵` er bundet på hver rudes egen gemme-funktion**, ikke på »den primære knap i det åbne
  vindue« (som ikke kan se forskel på at gemme og at svare på et spørgsmål, doda v31).
- Manuel registrering er `⌘⇧M` / `Ctrl+Shift+M` — et bart bogstav åbner søgefeltet.
- Genvejene i guiden hentes fra `GENVEJE`, så de to lister ikke kan drifte.

## Timeren og tidsposter

- **Tiden regnes fra starttidspunktet ved hver tegning**, aldrig ved at lægge et sekund til en
  tæller (doda F8). Kun uret tegnes om hvert sekund — ikke hele bjælken.
- **Advarselsgrænsen regnes på serveren** (`timerStatus`, `timer_warn_hours`, standard 8), så
  webappen og MCP får samme svar.
- **Afrunding sker pr. post ved visning og rapport, aldrig destruktivt**, og en post på
  2 minutter bliver til 15 — ikke 0. Registreret arbejde må ikke kunne runde sig selv væk.
- **En ren varighed placeres efter dagens sidste post, ellers kl. 9** (i `beregn.js`).
- **Fortryd gendanner posten byte-identisk**: `POST /api/v1/entries` tager enten dato + tekst
  (mennesket) eller præcise tidspunkter + id + kilde (fortrydelsen og MCP).
- **Hullerne på Today** er mellemrummene *mellem* dagens registreringer — ikke tiden før den
  første (det er morgen). Under 20 minutter er frokost og kaffe (`hullerPaaDag`). Et klik
  åbner registreringen udfyldt.

## Start-links (`/s/:token`)

- **`GET /s/:token` udfører handlingen** — prisen for ét klik fra OneNote. Klienter, der siger,
  at de kun kigger (`Sec-Purpose`, `Purpose`, `X-Purpose`, samt `HEAD`), får siden **uden**
  handlingen. En dæmpning, ikke en garanti.
- **Samme opgave giver samme token** — ellers hober døde adresser sig op i OneNote.
- Kvitteringssiden er server-renderet uden JavaScript; tema-scriptet indsættes ordret, så
  CSP-hashen passer. Stop-knappen er en almindelig `<form method="post">`.
- `timingSafeEqual` er ceremoni her (opslag på primærnøglen), men står der som vane.

## Projekter, rapport og kundevisning

- Rollup på tre niveauer i `beregn.js`: sum af estimater · manuel ramme (`budgetHours`) ·
  forbrugt. 80 %- og 100 %-advarslerne er to forskellige sætninger. Rammen tåler decimaler —
  den må aldrig gå gennem en heltals-hjælper.
- **Print:** `.printsheet`-mønsteret, eksplicitte farver, `@page { margin: 0 }`,
  `document.title = 'tovo-<projekt>-<dato>'` under print.
- **Ugerapporten:** perioden er halvåben, så naboperioder hverken tæller dobbelt eller taber en
  post. Summen af rækker = projektets total = rapportens total. Tomme **hverdage** fremhæves,
  en tom lørdag gættes der ikke på. `week_report` i MCP giver samme tal.
- »No project« er sin egen visning, ikke et projekt med tomt navn (ingen ramme, ingen kunde).

## Opgaver

- **Kopiér en opgave:** hvad der følger med står som hvidliste (`KOPIER_FELTER`/`dupliker()`
  på serveren), så webappen og MCP kopierer det samme. Historik og `plannerTaskId`/
  gentagelsesregel bliver på originalen.
- **`Column` i opgaveruden, ikke `Priority`.** Feltet udelades, når projektet ingen kolonner
  har, og `sectionId` sendes så slet ikke: PATCH fletter, så et udeladt felt bevares, mens
  `null` ville rydde det. Samme grund til, at `priority` ikke sendes med.
- **Gentagelser:** kun én åben forekomst; den næste materialiseres, når den nuværende lukkes,
  og den lukkede beholder ikke reglen. Estimat, projekt, sektion, links og tags arves.
- **Foldbare afsnit:** »Everything else« og »Done« begynder sammenfoldede, når listen er over
  otte. Dagens registreringer foldes med samme `data-fold`-mekanik, og overskriften siger,
  hvad der gemmer sig.
- `onenote:`-links overlever gemning og optegning uændret.

## iCal

- Aldrig UTC: `DTSTART;TZID=Europe/Copenhagen:…`. Linjefoldning ved 75 **oktetter**.
  `VALARM` kun med klokkeslæt. `VEVENT`, ikke `VTODO`. Varighed = estimat, ellers en time.
  Beskrivelsen bærer både link til opgaven og start-linket.
- UI'et siger, at Outlook opdaterer hver 3.–24. time, og at iOS skal have »Remove Alarms«
  slået fra.

## Eksport, PWA og versionstjek

- **JSON-eksport med hård grænse på 25 MB** og uden hemmeligheder: hverken start-links,
  kalenderadressen, nøgler eller kodeordshashen kommer med.
- **Service worker** med versioneret cache-navn; build'et fælder, hvis precache-listen ikke
  peger på præcis de `?v=N`-adresser, `index.html` henter.
- **`tjekVersion`** henter `config` ved `visibilitychange`, `pageshow` og `focus` (3 sek.
  spærre), fordi en PWA stort set aldrig genindlæses. Kun foden tegnes om.
- Reload-knappen sender `postMessage('ryd')` til service workeren.

## MCP

- Værktøjerne kalder `beregn.js` og `parse.js` — **der må ikke findes en særlig MCP-vej ind i
  dataene.** `capture` tager hele fangst-linjen, ikke felter.
- Fælderne fra RUNE-ERFARINGER §9a er alle lukket og testet: `WWW-Authenticate` på 401 fra
  `/mcp`, begge `.well-known`-former, offentlige OAuth-ruter uden om `securityHeaders()`
  (ingen `Cross-Origin-Resource-Policy`), og **`form-action 'self' <klientens origin>` på
  samtykkesiden** (fælde 4 bed én gang: Allow-knappen gør så ingenting).
- En læsenøgle ser kun læseværktøjer i `tools/list` — og afvises alligevel i `tools/call`;
  listen er en hjælp, ikke en spærring.
