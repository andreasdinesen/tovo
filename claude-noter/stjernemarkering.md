# tovo — stjernemarkerede opgaver

Læs når du rører `app/parts/pf_stjerner.js`, `starred`/`starredSeq` eller sidebaren.

## Stjernemarkerede opgaver

Et `starred`-flag og et `starredSeq`-**løbenummer** på opgaven — ingen tabel ved siden af.
Sagu har en `favorites`-tabel, fordi en note dér kan være *delt*; i tovo hører opgaven
allerede til én bruger, og en tabel ville være det samme svar skrevet to gange.

- **Nummeret er et LØBENUMMER, ikke et tidsstempel.** Første udgave skrev `now()` i feltet.
  Det ser rigtigt ud — tidsstempler sorterer kronologisk — og er forkert: `now()` er
  sekunder, så tre opgaver markeret lige efter hinanden får det samme tal, og listen falder
  tilbage på databasens rækkefølge. Det er præcis samme lektie som `naestePosition()`
  (doda F3). `tests/stjerner.test.mjs` fangede det, fordi den **markerer i en anden orden,
  end den opretter i**.
- **Nummeret sættes af serveren** i `POST /api/v1/tasks/:id/star` — ikke af klienten, og
  ikke gennem en PATCH. To faner må ikke kunne blive uenige om, hvad »sidst markeret«
  betyder. Samme regel som `completedAt` i `fuldfoer`.
- **Listen kommer med `/api/v1/state`** (`starred`, højst 20, kun `{id, title, projectId}`).
  Den tegnes i sidebaren OG over søgefeltet ved hver optegning; et kald mere pr. side ville
  være en blokerende rundtur efter noget, man ikke kom efter.
- **Afsnittet står lige over Projects** (Andreas, 2026-09-16) — de to foldbare afsnit i
  sidebaren hører sammen. Værten `#stjerneHost` tegnes derfor **inde i `navHtml()`**, ikke
  i `shellHtml()`, og `tegnStjerner()` kaldes til sidst i `opdaterNav()`, som lige har
  skiftet hele `#navHost` ud. Ligger kaldet før, tegnes stjernerne og overskrives straks.
  Sektionen er en `div.nav`, ikke en `<nav>`: den ligger inde i navigationens egen `<nav>`,
  og to landemærker i hinanden meldes begge af en skærmlæser.
- **Båndet ligger under tællerne og over feltet** — samme sted som Sagus fanelinje. Tallene
  folder sig væk ved rulning (`body.rullet .toprow`); båndet bliver, og skal blive: det er
  netop langt nede i en liste, man vil skifte opgave. Det vises **også under mobilgrænsen**,
  hvor sidebaren er et overlay og båndet derfor er den eneste vej til en stjerne.
- **En afsluttet opgave falder ud af listen, men beholder sit flag.** Åbnes den igen, er
  genvejen tilbage. En stjerne, der blev slettet af en afkrydsning, ville man skulle sætte
  igen hver gang.
- **`tegnStjerner()` tegner OG binder.** Markup i `shellHtml()` og binding et andet sted
  giver punkter, der ser rigtige ud og ikke gør noget efter hver fulde optegning (Sagu,
  2026-08-21). Knappen i en åben opgaverude rettes desuden i hånden af
  `opdaterStjerneKnapper()`: ruden er et element på `body`, som sidernes optegning ikke rører.
- Stjernen følger **ikke** med en `duplicate` (den står ikke i `KOPIER_FELTER`), og en
  genimport fra Planner/ServiceNow rører den ikke — den ligger uden for fletningens
  hvidliste og bæres uændret med.
