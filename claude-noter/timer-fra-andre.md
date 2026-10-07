# tovo — timer fra andre (`otherHours`)

Læs når du rører projektets budget, `rollupProjekt` eller `log_other_hours`.

## Timer fra andre (`otherHours`)

Andre konsulenter leverer timer på det samme projektbudget. De er en **liste på projektet**
(`{id, date, minutes, who, note}`) — ikke tidsposter.

- **En tidspost er DIT arbejde.** Lægger man andres timer ind som poster, havner de i din
  dag, uge, rapport og timeseddel, og du ser ud til at have arbejdet 60 timer. Derfor lægges
  de KUN til i `rollupProjekt` (`forbrugt = egne + andre`) og i projektlistens forbrug —
  begge gennem `beregn.minutterFraAndre(projekt)`. `sumPeriode`, `sumPrDag` og resten må
  aldrig kende dem; `tests/andres-timer.test.mjs` holder øje.
- **Listen skrives én linje ad gangen på serveren** (`tilfoejAndresTimer` /
  `fjernAndresTimer`, ruterne `POST|DELETE /api/v1/projects/:id/other-hours`). En klient,
  der sendte hele listen, ville lade to faner overskrive hinandens linjer. Webappen og MCP's
  `log_other_hours` går samme vej.
- Feltet står i `FELTER.project`, så en PATCH (Edit project, Planner-genimport) bærer det
  urørt med, og `renAndresTimer` renser hver linje. Højst 500 linjer.
- Kundearket har en række »Delivered by others«, ellers er Total ikke summen af kolonnen.
