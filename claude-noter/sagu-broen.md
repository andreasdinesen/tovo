# tovo — broen til Sagu

Læs når du rører `app/sagu.js`, `app/parts/pc_sagu.js` eller hemmelighederne i settings.

## Broen til Sagu

`app/sagu.js` er porteret fra doda og er afhængigheds-indsprøjtet: det kender hverken
databasen eller http-laget. To regler, som ikke må brydes:

- **Forbindelsen er PERSONLIG.** Hver funktion tager `userId` først. doda er én-bruger og
  slipper for det; gør man det samme her, gælder den første brugers nøgle alle.
- **Aldrig et kald til Sagu pr. optegning.** Noten hentes ved åbning af ruden — indhold og
  kommentarer i ét svar — og søgningen venter 300 ms. En rundtur gennem tunnelen er
  140–190 ms, og tre i træk er et halvt sekund, hvor der ikke sker noget.

`sagu_key` var tovos **første hemmelighed** i settings-tabellen. Den står i
`HEMMELIGE_SETTINGS` sammen med `totp_secret` og `totp_last`, og filteret ligger i
`hentSettings()` selv — både settings-ruten og JSON-eksporten går den vej, så der er ét
sted at huske det. Lægger du en hemmelighed mere i tabellen, skal den på den liste.


## Fra byggeplanen (v14–v15, stadig gyldigt)

- **Standard-notesbogen lægges på i RUTEN, ikke i kaldsstederne** (paletten og opgaveruden
  sendte den ikke, og noter landede uden notesbog). Ét sted at huske det, og en fremtidig
  klient (fx MCP) arver opførslen. En udtrykkelig notesbog fra klienten vinder.
  Testen bruger en **falsk Sagu** og kigger på det, tovo SENDER.
- **`/api/v1/changes?since=`** findes i dodas form, så Sagu kan tale med begge apps.
- Porteringen fra doda: modulet kunne flyttes uden ændringer i logikken; den ene rigtige
  tilpasning er `userId` gennem hver funktion, som i Sagus egen `doda.js`.
