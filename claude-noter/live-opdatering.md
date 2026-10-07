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


## Fra byggeplanen (v24, stadig gyldigt)

- **SSE og ikke websockets.** Beskeden går kun én vej, og `text/event-stream` er det mindste,
  der virker: Node kan det selv, og browseren genforbinder uden kode.
- **Et vink kan ikke lække noget** — endnu en grund til, at det ikke bærer data.
- Isolationen er **set fejle**: lad `varsko` sende til alle, og præcis den test bliver rød.
