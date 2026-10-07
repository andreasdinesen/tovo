# tovo — udgivelse, versionsnumre og opdatering

Læs før en udgivelse, og når du rører `kilde.js`, `update:`-scriptet, `build_rune.py` eller versionsnumrene.

## Arbejdsgang

- **Bump aldrig `APP_VERSION` undervejs.** Kun ved udgivelse, efter Andreas har sagt ja.
  Flere ændringer samles i én version.
- **Hver udgivelse SKAL tagges:** `git tag vN && git push --tags`. Install-scriptet henter
  `refs/tags/vN` — glemmer man taggen, svarer GitHub 404, og runen kan ikke installeres.
  Build'et minder om det i sin sidste linje.
- **Commit og push kræver et udtrykkeligt ja.** Et push er en udgivelse.
- Efter hver ændring: byg, test, opsummer — og vent.
- Ny generel lærdom → loggen i `RUNE-ERFARINGER.md`. Projekt-specifik → denne fil.

## To versionsnumre — og hvorfor det ene næsten aldrig flyttes

Fra v23 henter `app/kilde.js` app-koden ved hver opstart. **En genstart ER opdateringen.**
Runen er blevet en startsnor.

- **`APP_VERSION`** (`app/parts/p1_core.js`) — koden. Bumpes ved hver udgivelse, som før.
- **`RUNE_VERSION`** (`build_rune.py`) — runen. **Bumpes KUN, når YAML'en selv ændrer sig**
  (variabler, startup, porte, watchers, events).

Bumper du `RUNE_VERSION` ved hver udgivelse, er hele pointen tabt: så skal Andreas igennem
panelets to trin hver gang, og det var netop dét, ændringen fjernede. Build'et siger til,
når runen er uændret.

Build'et spærrer for `RUNE_VERSION > APP_VERSION`: startsnoren ville pege på en tag, der
ikke er udgivet, og det viser sig **først hos en, der installerer forfra** — aldrig hos os,
der har en kørende server.

`KODE_VERSION` i panelet: **tom = nyeste**, et tal låser. Vejen tilbage fra en dårlig
udgivelse er at skrive tallet og genstarte; frem igen er at tømme feltet.

**Låser du til før v23, forsvinder `kilde.js` sammen med resten,** og en genstart opdaterer
ikke længere. Vejen videre er panelets »Opdater tovo«. Modulet advarer, før det sker, og
startup-kommandoen siger det ved hver opstart i stedet for at kaste et stakspor.

## »Opdater tovo«-knappen

Panelets `app-update` skifter **filer** og **genstarter ikke serveren** — `restart` er et
separat endpoint. Uden en besked kører serveren videre på den gamle kode oven på nye filer.
Sagu lå ti timer sådan. Beskeden står derfor sidst i scriptet, i en ramme, og en prøve
holder den på plads.

Fire regler, som build'et håndhæver — de er alle betalt for én gang:

- **`kilde.js`-grenen først, startsnoren i `else`.** Omvendt nedgraderer hvert tryk appen
  til runens udgave og henter den frem igen; fejler andet trin, bliver den liggende.
- **Aldrig `/tmp`.** `mv` mellem to filsystemer er en kopi, der kan afbrydes på midten.
  Pak ud ved siden af `app/`.
- **Aldrig `rm -rf app`.** Flyt den gamle app til `.tovo-gammel` i stedet: samme virkning
  (slettede filer bliver ikke liggende, Beanledger v30), men uden et vindue uden `app/` —
  og `startup`-redningen dækker så også denne vej.
- **Låsen om hele scriptet.** `mkdir` er atomisk; `[ -d ]` + `mkdir` har et hul. En `trap`
  skal frigive den, og `startup` rydder en strandet lås.

`tests/opdatering.test.mjs` kører panelets **eget** script, hentet ud af den udgivne YAML.
En afskrift ville kun bevise, at afskriften er rigtig.

## Payload-budget

Install-scriptet **henter** app-koden i stedet for at bære den (`HENT_FRA_GITHUB = True` i
`build_rune.py`), så det er ~1,6 K og konstant — uanset hvor stor appen bliver. Loftet på
120 K er dermed ikke længere en begrænsning.

Payloaden bygges **stadig** ved hver kørsel, og det er ikke spild: rundturs-tjekket beviser,
at kilderne kan pakkes og pakkes ud igen, og tallet står i loggen, så §8's vane holder.
Sæt `HENT_FRA_GITHUB = False`, og den indlejrede rune er tilbage — det er den eneste vej,
der virker uden net ved installationen.

De delte moduler (`beregn.js`, `parse.js`) ligger i payloaden **to gange** — inde i `app.js`
og som selvstændige filer serveren kan `require`.


## Fra overdragelsen og byggeplanen (stadig gyldigt)

- **Panelets opdatering af selve RUNEN er todelt:** Runes → Browse GitHub → Reload henter
  rune-definitionen, Serveren → Settings → Update installerer. `/data` overlever. Det er
  kun nødvendigt, når `RUNE_VERSION` er flyttet — ellers er en genstart opdateringen.
- **Koden hentes fra en TAG** (`codeload.github.com/andreasdinesen/tovo/tar.gz/refs/tags/vN`),
  ikke en gren: rune vN installerer vN's kode, også om et år. Mappenavnet i arkivet gættes
  ikke — der ledes efter en mappe med `app/server.js` (arkivet begynder desuden med en
  `pax_global_header`-post).
- **Panelets GitHub-token gælder rune-definitionen, ikke det, der kører inde i containeren** —
  derfor skal repoet være offentligt (se `arkitektur.md`).
- **`tjekTrae()` i `kilde.js`** kræver en længere liste af filer end dodas: `server.js`
  require'r oauth, mcp, webauthn, sagu, totp, qr, live og klientip på modulniveau, og
  mangler ét, dør serveren med MODULE_NOT_FOUND. Kommer der et nyt modul på modulniveau,
  skal det på listen (og i `tests/kilde.test.mjs`). Versionen i det hentede `index.html`
  skal passe med taggen, ellers byttes der ikke.
- **En fejl i hentningen må aldrig forhindre opstart.** Kan GitHub ikke nås, starter serveren
  på den kode, der ligger — doda er én brugers opgaveliste, tovo er flere menneskers
  tidsregistrering.
- **Om panelet templater `{{KODE_VERSION}}` ind i `update`-scriptets tekst er ikke bevist** —
  derfor falder scriptet tilbage til env, så en låsning ikke kan tabes på en formodning.
- **Prøverne saboteres på den udgivne YAML, ikke i kilden** — build'ets egen validering
  fanger ellers sabotagen, før prøven kører, og så har man kun bevist vagten.
  Rækkefølge-kontroller i build'et skal bevise, at begge led findes, før positionerne
  sammenlignes (`index()` på noget, der mangler, er ikke et svar).
- **En kommentar, der beskriver hensigten, er ikke et bevis for rækkefølgen** (v23: startsnoren
  blev hentet før forgreningen, under en kommentar om, at grenen forhindrede netop det).
