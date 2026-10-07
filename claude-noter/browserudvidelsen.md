# tovo — browserudvidelsen

Læs når du rører `app/udvidelse/`, `/api/v1/extension.zip` eller `POST /api/v1/capture`.

## Browserudvidelsen (`app/udvidelse/`)

En Edge/Chrome-udvidelse (MV3): markér tekst → højreklik → »Start tovo timer«. Ingen
byggetrin, ingen pakker. Siden v33 ligger den **i `app/`**, så den følger med koden, som
`kilde.js` henter, og serveren pakker den som zip på `GET /api/v1/extension.zip`
(Settings → Connections → »Download the extension«).

- **Zip'en bygges ved hvert kald** med `xlsx.zip()` — den samme stored-zip-skriver som
  Excel-eksporten. Ingen genereret zip i repoet, der kan komme ud af trit med kilderne.
- **`forvalg.json` i zip'en bærer tovos adresse** (`basisUrl(req)`), så indstillingssiden er
  udfyldt. **Aldrig en nøgle i zip'en** — den havner i Overførsler. »Create a key for it«
  laver i stedet en `capture`-nøgle gennem den almindelige nøglerude, der viser den én gang.
- `server.js` require'r nu `shared/xlsx.js` på modulniveau, så den står på `kilde.js`'
  liste over moduler, en hentet udgave skal have (og i `tests/kilde.test.mjs`).

- **Én rute: `POST /api/v1/capture` med `raw: true`** (`fangstOrdret()` i server.js).
  Parseren springes over med vilje — sidetekst er ikke tovo-syntaks, samme grund som
  doda-broen. Retter du i fangsten, så husk, at der nu er to veje ind.
- **Nøglen er `capture`-scope.** Den kan oprette og starte (det kunne `%` i forvejen),
  men ikke læse. Kræv aldrig `full` i udvidelsen — nøglen ligger i en browserprofil.
- **Genbrug sker på titel** (trimmet, mellemrum samlet, uden hensyn til store/små
  bogstaver) og kun på ÅBNE opgaver. En afsluttet sag genopstår ikke.
- **Kører uret allerede på opgaven, røres det ikke** — en genstart ville efterlade en
  post på 0 minutter.
- Indstillingssiden tester nøglen med en TOM tekst: 400 »no text« betyder gyldig nøgle med
  ret scope, uden at noget oprettes. Ændrer du fejlkoden for tom fangst, knækker testen.
- `permissions.request` skal kaldes før første `await` i klik-handleren, ellers afviser
  Edge den (brugergesten er tabt).
- **Ikke verificeret i en rigtig Edge** fra Claudes side: API'et er testet
  (`tests/udvidelse.test.mjs`), udvidelsen selv er kun syntakstjekket.
