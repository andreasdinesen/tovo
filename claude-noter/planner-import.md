# tovo — Planner-importen

Læs når du rører `app/shared/planner.js` eller `app/parts/p6_planner.js`. Flyttet fra den gamle byggeplan (fase 5 og fund fra brug), tjekket mod koden 2026-10-07.

**Ét projekt pr. Planner-plan.** Flere planer må gerne importeres som hver sit projekt.

## Eksportens form (verificeret mod en rigtig eksport, 2026-08-18)

- **Der er ingen `xl/sharedStrings.xml`.** Alle celler er `t="str"` med teksten direkte i
  `<v>`. Parseren læser `t="str"` og tåler `t="s"` og `inlineStr` som fallback.
- **Datoer er ISO-tekst** (`2026-05-12`), ikke serienumre. Tekst først, tal som fallback.
- Arkene: `Plan`, `Konsoliderede data`, `Opgaver`, `Goals`, `Buckets`, `Brugere`. `Bucket` er
  et **navn** i det konsoliderede ark og et **bucket-id** i `Opgaver`. Foretræk arket, hvis
  navn indeholder `konsoliderede`; ellers `opgaver` + `buckets`; fejl pænt, hvis ingen findes.
- Arknavn → `sheetN.xml` slås op via `r:id` i `xl/_rels/workbook.xml.rels` — rækkefølgen i
  workbook.xml er ikke nødvendigvis `sheet1, sheet2, …`.
- `Plan`-arket giver `Abonnement-id` og `Navn på plan ` (→ `plannerPlanId`,
  `plannerPlanName`) og `Dato for eksport `, som vises i forhåndsvisningen.
- **Trim kolonnenavnene.** `"Opgavenavn "`, `"Bucket-navn "`, `"Navn på plan "` og
  `"Dato for eksport "` har efterstillet mellemrum.
- **Kolonnedetektion er case-insensitiv PRÆFIKSmatch**, ikke `indeholder`: arket har både
  `Tjeklisteelementer` og `Afsluttede tjeklisteelementer` (en tæller som `0/3`), og et
  indeholder-match ville gøre underopgaverne til teksten »0/3«.

| Felt i tovo | Kolonne i eksporten |
|---|---|
| `plannerTaskId` | `Opgave-id` |
| titel | `Opgavenavn ` |
| sektion | `Bucket` |
| status | `Status` (ikke `Fremdrift`) |
| forfaldsdato | `Forfaldsdato` |
| beskrivelse | `Noter` (ikke `Beskrivelse`) |
| underopgaver | `Tjeklisteelementer` (`;`-separeret, ét niveau) |
| prioritet | `Prioritet` (dansk skala, `Mellem`) |

`Fuldføringsdato` er den rigtige kilde til `completedAt`. Kun `Ikke startet` er set i
virkeligheden; statusmapningen er derfor tolerant, og en ukendt status bliver »ikke startet«
frem for at fælde importen.

## Import og genimport

- **Alt, der kan gøre skade, ligger i `app/shared/planner.js`** (arkvalg, kolonnegenkendelse,
  mapning, flettehvidliste) og testes i Node. `p6_planner.js` læser kun zip'en og XML'en og
  tegner ruden.
- **Genimport opdaterer KUN** titel, sektion, status, forfaldsdato, beskrivelse og
  underopgaver — skrevet som hvidliste. Estimat, tidsposter, kommentarer, links, ramme og
  prioritet sat i tovo røres aldrig. En tredje import af samme fil skriver **ingenting**.
- **`Noter` kan være to ting, og importen spørger.** Er `Noter` et rent tal på mindst halvdelen
  af rækkerne, viser forhåndsvisningen et flueben »Noter ligner estimater« (`6,1` → 366 min).
  Fluebenet gælder kun den import og kun opgaver uden estimat. Aldrig automatik uden det viste
  valg. Et rent tal bliver **ikke** også beskrivelse.
- **`sammenlign` springer felter over, der ikke står i `felter`.** Ellers blev en udeladelse
  (fx et `Noter`-tal brugt som estimat) læst som `null` og dermed en falsk ændring, der
  **sletter** — hver genimport meldte »skal opdateres« for evigt.
- **Alle buckets bliver kolonner**, også de tomme: `Buckets`-arket læses altid (også når
  opgaverne kommer fra det konsoliderede ark), og hele listen sås ind i `sammenlign()` før
  opgaverne. Det giver også planens egen rækkefølge.
- Forsvundne opgaver: arkivér / spørg / ignorér, gemt som setting.
- Gem i batches à 25 via bulk-API'et, og `saveBulk()` har en vagt: et delvist objekt må aldrig
  gemmes som helt.
- Importruden fortæller om kolonnerne (antal nye, total, navne), og import-knappen lover kun
  det, forhåndsvisningen siger, der sker.
- Genimport-testen er `tests/planner.test.mjs` (se `test.md`).
