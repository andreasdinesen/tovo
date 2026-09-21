/* Hoejreklik paa en markering -> opgave i tovo -> timeren koerer.
 *
 * Serveren goer arbejdet (fangstOrdret i app/server.js): teksten bliver
 * titlen ordret, en AABEN opgave med samme titel genbruges, og en koerende
 * timer stoppes. Udvidelsen sender bare markeringen.
 */
importScripts('faelles.js');

const MENU_ID = 'tovo-start';

/* Menuen skal oprettes ved installation OG ved opstart af browseren: en MV3-
   service worker kan vaere sovet ind, og onInstalled fyrer kun én gang. */
function opretMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Start tovo timer: "%s"',
      contexts: ['selection'],
    });
  });
}
chrome.runtime.onInstalled.addListener((d) => {
  opretMenu();
  if (d.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(opretMenu);

function besked(titel, tekst) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'ikoner/ikon-128.png',
    title: titel,
    message: tekst,
    priority: 0,
  });
}

function maerke(tekst, farve) {
  chrome.action.setBadgeText({ text: tekst });
  chrome.action.setBadgeBackgroundColor({ color: farve });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return;
  const tekst = String(info.selectionText || '').trim();
  if (!tekst) return;

  const { url, noegle } = await hentIndstillinger();
  if (!url || !noegle) {
    chrome.runtime.openOptionsPage();
    return;
  }
  try {
    const r = await kaldCapture(url, noegle, { text: tekst, start: true });
    maerke('▶', '#2f9e44');
    /* Tre udfald, og alle tre er et JA. Den foerste udgave skrev »(an open
       task with this title already existed)« i parentes - det blev laest som
       en fejlbesked, selv om uret koerte (Andreas, 2026-09-21). */
    if (r.alreadyRunning) besked('Timer already running', r.item.title);
    else besked('Timer started', `${r.item.title}\n${r.created ? 'New task' : 'Continued on your existing task'}`);
  } catch (err) {
    maerke('!', '#c92a2a');
    besked('tovo could not start the timer', err.message);
  }
});

/* Klik paa ikonet: aabn tovo - eller indstillingerne, hvis den ikke er sat op. */
chrome.action.onClicked.addListener(async () => {
  const { url, noegle } = await hentIndstillinger();
  if (url && noegle) chrome.tabs.create({ url });
  else chrome.runtime.openOptionsPage();
});
