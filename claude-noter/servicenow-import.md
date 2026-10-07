# tovo — ServiceNow-importen

Læs når du rører `app/shared/servicenow.js` eller `app/parts/pe_servicenow.js`.

## ServiceNow-importen

`app/shared/servicenow.js` læser **CSV**, ikke JSON. ServiceNows JSON-eksport har 145 felter
mod CSV'ens 16 — og er alligevel den dårligste kilde: referencefelter står som `sys_id`, så
`company` er en GUID og `state` er `-30`. Listevisningens CSV har dem allerede opløst til
navne. Skift ikke format; tilføj en kolonne i ServiceNow-visningen, hvis der mangler et felt.

CSV-teksten læses med `tovoToggl.parseCsv` — en rigtig RFC 4180-maskine, så en `description`
med linjeskift ikke knækker filen.

- **Matchet sker på `snNumber`,** aldrig på `caseNumber`, selv om de bærer samme værdi.
  Sagsnummeret kan rettes i hånden, og så ville den samme sag blive oprettet igen. Samme
  regel som Planners `plannerTaskId`.
- **Kunden bliver et projekt, underkategorien et tag.**
- **ALT, der gemmes, skal gennem `flet()` eller `luk()`.** `/api/v1/items/bulk` gemmer en
  **hel** opgave; et bart objekt med kun de importerede felter sletter estimat, note, kolonne
  og links. Det så rigtigt ud fra begge ender og blev først fanget ved en rigtig import i
  browseren — **en enhedstest på `sammenlign` kan ikke se et forkert kaldssted.**
- **En sag, der mangler i filen, lukkes ALDRIG af sig selv.** Filteret er typisk
  `State != Resolved`, men et filter kan være ændret, og så ville en automatisk afslutning
  lukke noget, der stadig løber. Ruden spørger, og intet er krydset af på forhånd.
- Beskrivelsen skrives kun ved **oprettelsen** — ellers overskriver en genimport din egen note.


## Fra byggeplanen (v25, stadig gyldigt)

- **Flere felter er ikke det samme som mere information** — derfor CSV. Verificeret mod en
  rigtig eksport: 32 rækker, 16 kolonner, alle rækker samme bredde.
- **En forsvunden sag lukkes aldrig af sig selv** — Andreas valgte »spørg mig«; en standard er
  et valg, nogen har taget for én.
- **Et rigtigt kundenavn røg en gang ind i en dok-kommentar** og blev fanget af en grep før
  commit. Build'et har siden fået `tjek_kundedata()` i `build_rune.py` — kun et tjek holder
  reglen, ikke det at kende den.
