# tovo — totrinsbekræftelse

Læs når du rører `app/totp.js`, `app/qr.js`, login-porten eller genoprettelseskoderne.

## Totrinsbekræftelse

`app/totp.js` og `app/qr.js` er **kopieret ordret fra sagu**; kun udstederens navn er
skiftet. Ret dem ikke uden at rette dem samme sted i sagu — to udgaver af den samme
RFC-implementering er to steder at have en fejl.

- **Porten ligger før `createSession`.** Mangler koden, svares `needsCode` uden cookie.
  Udstedte man cookien først, ville et halvt login være et helt login for enhver, der
  kunne læse den.
- **`tjek()` returnerer det vindue, der passede** — ikke `true`. Værdien gemmes i
  `totp_last`, så den samme kode ikke kan bruges to gange inden for sit vindue.
- **Adgangsnøgler springer porten over.** En nøgle er selv to led; en engangskode ovenpå
  ville være et tredje. Det står også i guiden, så retter man det, lyver siden.
- `kodeFor(hemmelighed, **counter**)` tager et tælleskridt, ikke et tidspunkt. Kalder man
  den uden, bliver counter `NaN` → 0, og man får den samme kode hver gang — en kode, der
  ser rigtig ud og aldrig virker. Det kostede mig en fejlsøgning af appen, som var rask.


## Fra byggeplanen (v19, stadig gyldigt)

- **Ingen `Set-Cookie` i et `needsCode`-svar** — verificeret med curl. Udstedte man sessionen
  først og »huskede« at kræve koden i fladen, var andet trin en høflig anmodning, ikke en lås.
- **Genoprettelseskoder: ti, vist én gang, gemt som hash.** `used_at` sættes i stedet for at
  slette rækken, så et forbrug kan ses. Store/små bogstaver og manglende bindestreg
  accepteres — koden tastes i hånden af en, der lige har mistet sin telefon.
- **Begrundelsen for, at adgangsnøgler springer porten over, står som kommentar PÅ ruten** og
  i guiden, så en senere »rettelse« støder på den.
- **`api()` bærer hele fejlkroppen videre som `svar`**, ikke kun `status` og `code`. Før faldt
  `needsCode` på gulvet, og fladen kunne ikke skelne en forkert engangskode fra et forkert
  kodeord.
- **QR'en verificeres som indhold, ikke som billede:** stien sammenlignes modul for modul med
  en lokalt bygget kode for den forventede `otpauth://`-URI.
