# tovo — test

Læs før du skriver eller retter en test.

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


## Fra overdragelsen og byggeplanen (stadig gyldigt)

- **Vælg testdata, der ligger skævt** i forhold til den regel, du tester. En test med lutter
  hele kvarter kan ikke se en afrundingsfejl — »frontendens tal er serverens tal«-testen
  bestod med en bevidst saboteret server, indtil den fik en post på 22 og en på 7 minutter.
- **En test, man ikke har set fejle, er en formodning.** Rul rettelsen tilbage og se den
  blive rød. Det gælder også build'ets spærrer (require-listen, precache-listen) — og
  **sabotageprøven kan dømme modellen** i testen, ikke kun koden (svingningstesten for
  bjælken målte ingenting, før den fik en drivkraft, der genskabte rullepositionen).
- **En scriptet tekstudskiftning uden en assertion er en tavs no-op.**
- **En enhedstest kan ikke se et forkert kaldssted** — kør hele flowet i browseren
  (ServiceNow-`/items/bulk`, Planners `Noter`, notesbogen til Sagu blev alle fundet sådan).
- **Ingen hårdkodede datoer i tests.** `tests/parse.test.mjs` er fastnaglet til en
  referencedato og skal IKKE røres. `!fredag` betyder »næste forekomst, i dag hvis i dag er
  fredag« — en test, der regner `|| 7`, er kun rød om fredagen.
- Rapporttestens facit regnes i hånden, ikke ved at kalde den samme funktion igen.
- **Claude Codes browser-panel:** kan ikke registrere service workers, `IntersectionObserver`
  fyrer ikke (`visibilityState: 'hidden'`), ingen viewport (`innerWidth: 0`) i visse
  tilstande, og udklipsholderen kan hverken læses eller skrives fra et scriptet klik.

## Ikke verificeret (sig det ærligt videre)

1. **Kalenderabonnementet i Outlook.** Feedet opfylder RFC 5545, og sommertidsprøven er en
   test — men et rigtigt abonnement er ikke prøvet.
2. **Connectoren fra claude.ai.** Alle otte OAuth-flowtests kører med en rigtig fremmed
   `redirect_uri` (`https://claude.ai/api/mcp/auth_callback`), men ingen har tilsluttet den
   fra claude.ai.
3. **Start-links klikket fra en rigtig OneNote-side.** `onenote:`-klienten håndterer links
   anderledes end en browserfane.
4. **Service workerens registrering.** Det statiske er tjekket: cache-navnet bærer versionen,
   og build'et fælder, hvis precache-listen ikke matcher `index.html`.
5. **Toggl-importen mod Andreas' egen eksport** — kørt mod en syntetisk CSV med Toggls
   kolonnenavne.
6. **Excel-filerne åbnet i rigtig Excel** — verificeret som gyldige zip-arkiver med gyldig XML.
7. **En rigtig genstart i panelet på Hjorten** efter `kilde.js`-hentningen.
