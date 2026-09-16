/* tovo - adresser til siderne. Én liste, to brugere.
 *
 * Browseren skriver stien i adresselinjen, saa /report kan bogmaerkes og
 * /projects/<id> kan laegges paa hjemmeskaermen. Serveren skal svare med
 * index.html paa PRAECIS de samme stier, ellers giver et genindlaes en 404 paa
 * noget, der lige stod paa skaermen. To lister ville skride fra hinanden ved
 * den foerste nye side, saa den bor her (RUNE-ERFARINGER §9g, Beanledger v36).
 *
 * Kun de kendte stier peger paa appen - aldrig en catch-all. En catch-all
 * ville ogsaa svare 200 med HTML paa /app.jsx og /styl.css, og en manglende
 * fil, der svarer med en side, er den slags fejl man leder efter i timevis.
 *
 * Modulet kender hverken DOM'en eller databasen: det oversaetter mellem en
 * sti og {view, project, tag, fane} - intet andet.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.tovoRuter = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* [view-id, adresse, andre stavemaader der ogsaa skal virke]
     Interfacet er engelsk, saa adresserne er det ogsaa. De danske ord er
     med, fordi det er dem, man skriver i haanden. */
  const SIDER = [
    ['today', 'today', ['idag', 'i-dag', 'forside', 'start']],
    ['week', 'week', ['uge', 'kalender', 'calendar']],
    ['projects', 'projects', ['projekter', 'projekt', 'project']],
    ['tags', 'tags', ['tag', 'maerkater', 'maerkat']],
    ['report', 'report', ['rapport', 'ugerapport', 'timeseddel']],
    ['settings', 'settings', ['indstillinger']],
    ['guide', 'guide', ['vejledning', 'hjaelp', 'help']],
  ];

  /* Fanerne i indstillingerne (§9f). `server` er kun for administratorer -
     serveren svarer alligevel med siden, og fladen falder tilbage til den
     foerste fane, saa ingen staar paa en tom side. */
  const FANER = ['general', 'account', 'connections', 'data', 'server'];

  /* Sider, der kan pege paa ét element: /projects/<id>, /tags/<id>. */
  const MED_ID = { projects: 'project', tags: 'tag' };
  // Id'er er serverens hex, fladens uuid eller en konstant som `__uden`.
  // Alt andet er ikke et id, og saa er stien ikke en side.
  const ID = /^[A-Za-z0-9_-]{1,64}$/;

  /* Stien skal kunne skrives i haanden. Store bogstaver, en skraastreg til
     sidst og æøå skal alle ramme. æøå foldes til ae/oe/aa - samme translit,
     som aliasserne selv er skrevet i. */
  function nogle(del) {
    return String(del || '').toLowerCase()
      .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa');
  }

  const OPSLAG = {};
  for (const [id, sti, alias] of SIDER) {
    OPSLAG[nogle(sti)] = id;
    OPSLAG[nogle(id)] = id;
    for (const a of alias || []) OPSLAG[nogle(a)] = id;
  }

  /**
   * '/projects/abc' -> { view: 'projects', project: 'abc' }.
   * '/' er forsiden. Ukendt sti -> null (og serveren svarer 404).
   */
  function laesSti(sti) {
    let s = String(sti || '');
    try { s = decodeURIComponent(s); } catch { return null; }
    const dele = s.split('/').filter(Boolean);
    if (!dele.length || (dele.length === 1 && dele[0] === 'index.html')) return { view: 'today' };
    const view = OPSLAG[nogle(dele[0])];
    if (!view || dele.length > 2) return null;
    if (dele.length === 1) return { view };
    // Andet led: et id (case-foelsomt - det er ikke en stavemaade) eller en fane.
    if (MED_ID[view] && ID.test(dele[1])) return { view, [MED_ID[view]]: dele[1] };
    if (view === 'settings' && FANER.includes(nogle(dele[1]))) return { view, fane: nogle(dele[1]) };
    return null;
  }

  /** { view, project, tag, fane } -> den kanoniske sti. Ukendt view -> null. */
  function stiFor(tilstand) {
    const t = tilstand || {};
    const side = SIDER.find((x) => x[0] === t.view);
    if (!side) return null;
    const rod = `/${side[1]}`;
    const id = MED_ID[t.view] ? t[MED_ID[t.view]] : null;
    if (id && ID.test(id)) return `${rod}/${encodeURIComponent(id)}`;
    if (t.view === 'settings' && FANER.includes(t.fane)) return `${rod}/${t.fane}`;
    return rod;
  }

  return { SIDER, FANER, laesSti, stiFor };
}));
