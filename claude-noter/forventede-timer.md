# tovo — forventede timer (dagens og ugens mål)

Læs når du rører `expected_day_hours`, `workday_start`/`workday_end` eller `forventning()`.

## Forventede timer

**Dagen er tallet; ugen regnes af den** (dag × 5 i `beregn.ugerapport`). Før lå sandheden i
`norm_week_hours`, som blev delt med 5 — to tal, der kunne pege hver sin vej.

`expected_day_hours` har den gamle ugenorm delt med 5 som standard, så en opgradering ikke
ændrer nogens tal. Klokkeslættene (`workday_start` / `workday_end`) valideres i
`forventning()` på serveren, ikke i `beregn.js`: et ugyldigt tidspunkt ville blive til NaN
inde i udregningen og tage hele dagskortet med sig.

To sammenligninger, og de svarer på hver sit: `forventet` er hele dagen, `forventetNu` er
den del, dagen er nået til. Uden den anden står man kl. 9 og er 6,4 timer bagud hver morgen.
Samme regel gælder ugen: `normTilNu`.


## Fra byggeplanen (v24, stadig gyldigt)

- **Normstregen og søjlen måler fra samme boks.** En absolut placeret streg i `.dag` ville
  regne procenter af paddingboksen, mens søjlens højde regnes af indholdsboksen — 16 px ved
  siden af.
- Det tilfælde, der knækker udregningen, er start LIG slut på selve slaget (`0/0`) — ikke et
  omvendt vindue, hvor negativ divideret med negativ giver et pænt tal. Test det rigtige.
