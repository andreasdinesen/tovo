# tovo — broen fra doda

Læs før du ændrer timer-API'et, `POST /api/v1/items` eller reglen om én kørende timer.

## Broen fra doda (18-09-2026)

doda har fået en optageknap på hver opgave. Den kalder **tovos eksisterende API** —
`/api/v1/state`, `/api/v1/items`, `/api/v1/timer/start|stop|current` — med en
`full`-nøgle. **Der er ikke ændret én linje i tovo, og der skal ikke ændres noget.**

Det, du skal vide, hvis du retter i tovo:

- **Koblingen ejes af doda.** `items.tovo_task_id` står i dodas base. tovo har
  bevidst IKKE et `dodaTaskId` ved siden af `plannerTaskId` og `snNumber`: en
  kobling med to ejere kan blive uenig med sig selv, og så er der ingen at spørge.
  tovo skal blive ved med ikke at vide, at doda findes.
- **doda opretter en opgave og rører den aldrig igen.** Den kender reglen om, at
  `POST /api/v1/items` gemmer en HEL opgave, og at en titel-only-skrivning ville
  slette estimat, note, kolonne og links. Fjerner du den regel — eller laver du en
  PATCH-rute — så er det stadig den regel, broen er bygget på.
- **Oprettelsen går uden om `/api/v1/capture`** med vilje: en doda-titel er ikke
  skrevet til tovos parser, hvor `#` er et mærkat og `~` et estimat.
- **`source` bliver `mcp`** på de tidsposter, doda starter, fordi `/timer/start`
  sætter `auth.viaToken ? 'mcp' : 'timer'`. Det er ikke forkert (doda ER en
  API-klient), men vil du kunne skelne i en rapport, er det dér, det skal ændres.
- **Reglen om ÉN kørende timer er det, dodas ikon hviler på.** Knappen fortæller,
  hvilken opgave der bliver stoppet, FØR man trykker. Laver du flere samtidige
  timere, holder den forklaring op med at passe.

Dodas side er skrevet ned i `../doda/DESIGN.md` under »tovo-broen«.
