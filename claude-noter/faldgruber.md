# tovo — faldgruber

Fælder, der allerede har kostet tid. Læs før en større ændring, og når noget opfører sig uforklarligt.

## Faldgruber der allerede har kostet tid i andre runer

- `crypto.randomUUID()` findes ikke over http (panelets IP:port) — brug altid
  `crypto.getRandomValues`-fallback, ellers dør alt der opretter id'er, stille.
- CSS skal have `[hidden]{display:none!important}`.
- Mobilgrænsen er **900 px** og bor i én konstant, brugt af både `matchMedia()` og `@media`.
- `render()` må ikke `scrollTo(0,0)` ved gentegning af samme side.
- `overflow-wrap: break-word` på `body` — Planner-titler er lange og ubrudte.
- Print-HTML må aldrig bruge `var(--…)`-farver. Giv `@media print` egne eksplicitte farver.
- Serveren logger `server.address().port`, ikke `BIND_PORT`.
- Bind aldrig til `PORT_KODA` / `KODA_PORT` — det er host-porten.
- Netværksfejl oversættes i den fælles `api()`-indpakning; `ex.message` må aldrig nå en toast.
- `Object.assign({headers}, opts)` er shallow — sæt headers **efter** merge.
- **`state.items` er den AKTUELLE SIDES udsnit** (et projekt, et tag, en søgning) — aldrig
  »alle opgaver«. Skal noget bruge alle (ugekalenderen, »Log time«), henter det selv
  `/api/v1/items?kind=task`. En `if (!state.items.length)`-genvej er den samme fejl: listen er
  sjældent tom, bare forkert. Den gav »Deleted task« i ugen og et projekt i »Log time« (v34).
- Cache-bust: `app.js?v=N` stemplet i `index.html` af build'et, og **skriv HTML'en tilbage
  til disk**, ellers pakker tar'en den gamle. HTML serveres `no-store`.

- **Node genindlæser ikke moduler** — efter en ændring i `app/server.js` eller
  `app/shared/*.js` skal serveren genstartes, ikke bare siden genindlæses.

## Layout og rulning (fra byggeplanen, stadig gyldigt)

- **Under mobilgrænsen er BODY rullekassen**, ikke `window` (`html, body { height: 100% }` +
  `overflow-x: hidden` i `@media`). `window.scrollY` er 0 uanset hvor langt nede man er.
  Brug `tilToppen()`, som sætter alle tre; `tests/flade.test.mjs` afviser et bart
  `window.scrollTo` uden for hjælperen.
- **`.topbar` er `position: sticky`**, ikke `fixed` (ellers skal indholdet have en margen, der
  passer præcis til bjælkens højde). **Lag 35, ikke 40** — menuknappen på mobil ligger på 40
  i samme hjørne og skal kunne rammes. `body.rullet .topbar { padding-left: 60px }` i
  mobilblokken (tovos eget tal, ikke dodas 52). Bjælken bærer `.main`s padding-top selv
  (`padding-top: 22px; margin-top: -22px`), ellers glimter indholdet forbi øverst.
- **En klæbende bjælke, der KRYMPER, kan svinge** på korte sider: sammenfoldningen gør
  dokumentet kortere, browseren klipper rullepositionen, og den folder sig ud igen. Derfor to
  tærskler og en rulle-lytter (`rulletNed()`), ikke en `IntersectionObserver`, og
  **`RULLET_PLADS` er selve forsikringen**: fold kun, hvis der er rigeligt at rulle i.
- Legenden under søgefeltet foldes **ikke** væk ved rulning (den vises kun ved fokus).
- **`.modal` er et grid:** `grid-template-columns: minmax(0, 1fr)`, ellers vokser kolonnen til
  indholdets min-bredde, og kortet bliver bredere end telefonen. `flex-wrap` på `.modal-foot`.
- **Brede tabeller pakkes i `.tabelrul` med `min-width: max-content`** og første kolonne
  sticky — mobilens `overflow-x: hidden` **skjuler** ellers overløbet, så det hverken kan ses
  eller rulles frem.
- **Tavlen har sin egen sidebredde** (`.page.bred`, 1500 px); `.page`'s 760 px er en
  læsebredde.
- Brugernavnet versaliseres **kun i CSS** (`text-transform`): værdien sammenlignes med
  `lower()` ved login, registrering og dubletcheck.
- Den fælles `.meta` versaliserer; brugerens egne navne (fx Planner-kolonner) får
  `.meta.navne`, så de kan genkendes.
- **Deler man kilde med doda, deler man fejl** — CSS'en er kopieret ordret, og en melding fra
  søsterprojektet (rullekassen, `via`-hvidlisten) er mere værd end en gennemgang af egen kode.
- **Uafklaret:** `target="_blank"` fra en PWA på iOS' hjemmeskærm (`"display": "standalone"`).
  Aldrig set ske; prøven er at åbne tovo fra hjemmeskærmen og trykke på et eksternt link.
