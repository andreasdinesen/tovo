# tovo — live-opdatering (SSE)

Læs når du rører `app/live.js` eller en skrivefunktion.

## Live-opdatering

`app/live.js` er et SSE-nav. Serveren sender et **vink**, aldrig data; fladen henter så
`/api/v1/state`, som den allerede gør ved opstart. Bar vinket data, skulle en opgave
serialiseres et sted mere — og så er der to steder, der skal blive enige.

- **`live.varsko(userId)` kaldes fra SKRIVEFUNKTIONERNE selv** (`gemItem`, `startTimer`,
  `stopTimer`, `gemPost`, `sletPost`) — aldrig fra kaldsstederne. Samme regel som
  `user_id`-filteret: én vej ind, så ingen ny rute kan glemme det.
- **En lytter hører kun sin egen brugers ændringer.** Lytterne er grupperet på `userId`, og
  der findes ingen vej til at sende til alle. En fælles strøm ville fortælle den ene bruger,
  hvornår den anden møder og går hjem.
- **Hjerteslag hvert 25. sekund.** En tunnel lukker en stille forbindelse; Cloudflare giver
  typisk ~100 s. Uden det dør strømmen tavst, og fladen tror, den lytter.
- `X-Accel-Buffering: no` og `no-transform`, ellers buffrer et mellemled svaret.
- Klienten kobles til og fra i **`render()`** — det ene sted, der kører ved både login,
  logout og opstart.
- **En optegning venter, hvis en dialog er åben eller markøren er i et felt.** Data hentes
  altid; det er kun siden, der kan vente. Et vink fra en anden enhed er aldrig vigtigere end
  det, hånden er i gang med.


## Tabte vink og døde forbindelser (v45)

Andreas så det på to computere: et ur stoppet på den ene dukkede først op på den anden
efter en genindlæsning. SSE alene var ikke nok, af to grunde:

- **Et vink, der sendes, mens strømmen er nede, er væk.** EventSource genforbinder efter
  dvale/netskift, men ved ikke, at den gik glip af noget. Kuren: en **ændringstæller pr.
  bruger** i `live.js` (`rev`), der stiger ved hvert `varsko` — også uden lyttere. Den står i
  hvert `hej` (ved tilslutning), hvert `hjerte` og hvert `aendring`, og i `/api/v1/state`
  som `liveRev`. Fladen henter, når tallet er et andet end det, den sidst hentede ved.
  I hukommelsen med vilje: efter en genstart er tallet 0 ≠ fladens, og den henter.
- **En halvdød forbindelse efter dvale står stadig som OPEN.** Hjerteslaget var en
  kommentarlinje, som EventSource ikke kan se. Nu er det en navngiven hændelse, og
  **vagten** (hvert 15. s, kun mens fanen er synlig) river strømmen ned og åbner den igen,
  hvis der har været tavst i 70 s — og henter state, men tegner kun om, hvis tælleren rykkede.
  Det er også nettet under nettet, hvis en proxy holder SSE tilbage.
- **Fanen kommer frem / vinduet får fokus / nettet er tilbage** (`vaagnLive`): har strømmen
  været tavs i over 30 s, genforbindes der straks i stedet for at vente på vagten.

Tælleren er brugerens EGEN — testen viser, at Andreas' ændring ikke rykker Bodils.

## Fra byggeplanen (v24, stadig gyldigt)

- **SSE og ikke websockets.** Beskeden går kun én vej, og `text/event-stream` er det mindste,
  der virker: Node kan det selv, og browseren genforbinder uden kode.
- **Et vink kan ikke lække noget** — endnu en grund til, at det ikke bærer data.
- Isolationen er **set fejle**: lad `varsko` sende til alle, og præcis den test bliver rød.
