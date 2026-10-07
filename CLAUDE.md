# tovo — projektregler

Tidsregistrering på opgaver og projekter. Yggdrasil-rune. Tvilling til doda:
separate apps, separate data, **ingen synkronisering**. Se »Broen fra doda«
nederst — doda kan siden 18-09-2026 starte et ur her, og det ændrer intet i tovo.

> Kun det, der skal vides i hver session. Detaljerne ligger i `claude-noter/` —
> slå op dér, når opgaven rammer området (oversigt nederst).

Ren Node ≥22 (`node:http`, `node:sqlite`, `node:crypto`), **nul npm-pakker, nul CDN**.
**Flerbruger** (doda er én-bruger). Engelsk UI; kode, commits og docs på dansk.
Install-scriptet **henter** app-koden fra GitHub-taggen `vN`, og `app/kilde.js` henter
den igen ved hver opstart — **en genstart ER opdateringen**.

## Før du gør noget

Læs `~/ClaudeMacBook/RUNE-ERFARINGER.md` — hele filen. Læs den igen **efter** et større
stykke arbejde, ikke kun før.

## Filer

| Fil | Rolle |
|---|---|
| `app/server.js` | Hele backenden: auth, items-API, `FELTER`-hvidlisten, settings, ruter |
| `app/shared/beregn.js` | **ALLE** udregninger + formatering af varigheder (UMD) |
| `app/shared/parse.js` | Fangst-syntaksen og dansk datosprog (fra doda, ændrede markører) |
| `app/shared/planner.js` · `servicenow.js` · `toggl.js` | Importernes risikable del — testbar uden browser |
| `app/shared/xlsx.js` · `ruter.js` | .xlsx/zip uden pakker · sidernes adresser (app.js + server) |
| `app/parts/p1_core.js` … `pg_rigtekst.js` | Frontend-kildedele — **redigér her**. `APP_VERSION` står i `p1_core.js` |
| `app/public/app.js` | **Genereret** af `build_rune.py`. Redigér aldrig |
| `app/public/style.css` · `sw.js` | Dodas CSS + tovo-blok nederst · service worker |
| `app/mcp.js` · `oauth.js` · `webauthn.js` | MCP (fjorten værktøjer) · OAuth 2.1 · passkeys (fra doda) |
| `app/kilde.js` | Henter app-koden ved opstart |
| `app/live.js` | SSE-nav pr. bruger |
| `app/totp.js` · `qr.js` | Totrin — kopieret **ordret** fra sagu |
| `app/sagu.js` · `klientip.js` | Broen til Sagu · klient-IP bag proxy |
| `app/udvidelse/` | Edge/Chrome-udvidelsen |
| `build_rune.py` | Bygger `app.js` + `runes/tovo.yaml` |
| `runes/tovo.yaml` | **Genereret** — redigér aldrig i hånden |

## Ufravigeligt (fuld udgave i `claude-noter/arkitektur.md`)

1. **Alle beregninger i `app/shared/beregn.js`** — aldrig i `app/parts/`, heller ikke en lille.
2. **`user_id`-filteret ligger i `hentItem` / `hentItems` / `gemItem` / `saveBulk` selv** —
   aldrig i kaldstederne. Admin er ingen undtagelse. Isolationstesten køres altid.
3. **Endepunkter uden login** (`/s/:token`, `/ical/:token`) scanner aldrig datasættet og
   svarer **404** — aldrig 401/403.
4. **Genimport (Planner/ServiceNow) rører kun en hvidliste af felter**, og ALT, der gemmes via
   `/api/v1/items/bulk`, er en HEL opgave.
5. **Hemmeligheder i `settings` står på `HEMMELIGE_SETTINGS`** (filteret i `hentSettings()`).
6. **Repoet er OFFENTLIGT** — aldrig kundedata i koden, tests eller kommentarer
   (eksempler: `Nordvind`, `SAG-…`).
7. **Visningspræferencer i `settings`** via `brugerFlag()`/`saetBrugerFlag()` — kun
   `tovo_theme` og `tovo_nav_skjult` bliver med vilje i `localStorage`.

## Arbejdsgang og udgivelse (detaljer i `claude-noter/udgivelse.md`)

- **Commit og push kræver et udtrykkeligt ja.** Et push er en udgivelse.
- **Bump aldrig `APP_VERSION` undervejs.** Kun ved udgivelse, efter Andreas har sagt ja.
- **Hver udgivelse SKAL tagges:** `git tag vN && git push --tags`. Uden taggen svarer
  GitHub 404, og runen kan ikke installeres.
- **`RUNE_VERSION` bumpes KUN, når YAML'en selv ændrer sig.**
- Efter hver ændring: byg, test, opsummer — og vent.
- Ny generel lærdom → loggen i `RUNE-ERFARINGER.md`. Projekt-specifik → den relevante
  fil i `claude-noter/`.

## Lokal kørsel

```sh
BIND_PORT=8911 DATA_DIR=/tmp/tovodata TOVO_DEV=1 node app/server.js
python3 build_rune.py
node --test tests/*.test.mjs
```

Dev-serveren til preview-værktøjet hedder `tovo` i den **globale** `~/.claude/launch.json`
(port 8911 — 8902 er kokkeris). `TOVO_DEV=1` slår `immutable`-cachen fra; uden den
revalideres en cachet `app.js?v=1` aldrig, og man fejlsøger kode, der ikke er indlæst.

## De fælder, der bider oftest

- **`state.items` er den AKTUELLE SIDES udsnit** — aldrig »alle opgaver«.
- **Node genindlæser ikke moduler** — genstart serveren efter en ændring i `server.js`/`shared/`.
- **Under mobilgrænsen (900 px) er BODY rullekassen** — brug `tilToppen()`, aldrig `window.scrollTo`.
- **En enhedstest kan ikke se et forkert kaldssted** — kør hele flowet i browseren.
- **Tastaturnavigation kan ikke testes gennem browser-panelet** (tom `e.key`).
- **GitHub-push:** SSH over port 443; port 22 timer ud fra Mac'en.

Hele listen: `claude-noter/faldgruber.md` og `claude-noter/test.md`.

## Ikke i scope

Offline-tilstand, service worker-kø, fakturerbarhed, Notion-integration, deling mellem
brugere, OneNote-API (kun links). **Tovejs-synkronisering med doda** er stadig ikke i
scope — broen ovenfor er et link, ikke en synkronisering.

## Notefiler

| Fil | Læs den når |
|---|---|
| `claude-noter/arkitektur.md` | Du rører datamodel, isolation, settings, `FELTER` — eller kopierer fra doda. |
| `claude-noter/udgivelse.md` | Du udgiver, rører `kilde.js`, `update:`-scriptet, »Opdater tovo«, payload eller versionsnumrene. |
| `claude-noter/funktioner.md` | Du rører en funktion: syntaks, timer, start-links, rapport, iCal, gentagelser, eksport, MCP. |
| `claude-noter/planner-import.md` | Du rører Planner-importen. |
| `claude-noter/servicenow-import.md` | Du rører ServiceNow-importen. |
| `claude-noter/totrin.md` | Du rører totrin, `totp.js`/`qr.js` eller genoprettelseskoder. |
| `claude-noter/sagu-broen.md` | Du rører broen til Sagu eller hemmeligheder i settings. |
| `claude-noter/live-opdatering.md` | Du rører `live.js` eller en skrivefunktion. |
| `claude-noter/stjernemarkering.md` | Du rører stjernerne eller sidebaren. |
| `claude-noter/forventede-timer.md` | Du rører dagens/ugens mål. |
| `claude-noter/timer-fra-andre.md` | Du rører `otherHours` eller projektets budget. |
| `claude-noter/broen-fra-doda.md` | Du ændrer timer-API'et, `POST /api/v1/items` eller reglen om én timer. |
| `claude-noter/browserudvidelsen.md` | Du rører `app/udvidelse/` eller `/api/v1/capture`. |
| `claude-noter/faldgruber.md` | Før en større ændring — og ved layout/rulning på mobil. |
| `claude-noter/test.md` | Du skriver tests — og listen over, hvad der ikke er verificeret. |
