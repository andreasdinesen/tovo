/* Indstillingerne: adresse + capture-noegle, gemt i storage.local (aldrig sync). */
const $ = (id) => document.getElementById(id);

function status(tekst, klasse) {
  $('status').textContent = tekst;
  $('status').className = klasse || '';
}

(async () => {
  const { url, noegle } = await chrome.storage.local.get(['url', 'noegle']);
  if (url) $('url').value = url;
  if (noegle) $('noegle').value = noegle;
  /* Hentet fra tovos Settings, har zip'en en forvalg.json med tovos adresse.
     Hentet fra GitHub findes den ikke - saa skriver man selv adressen. */
  if (!url) {
    try {
      const f = await (await fetch(chrome.runtime.getURL('forvalg.json'))).json();
      if (f && f.url) $('url').value = f.url;
    } catch { /* ingen forvalg */ }
  }
})();

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = tovoOrigin($('url').value);
  const noegle = $('noegle').value.trim();
  if (!url) { status('That is not a valid address.', 'fejl'); return; }
  if (!noegle.startsWith('tovo_')) { status('A tovo access key starts with "tovo_".', 'fejl'); return; }

  /* Tilladelsen SKAL bedes om foer det foerste await: Edge kraever, at
     permissions.request kaldes direkte fra brugerens klik. */
  let tilladt;
  try {
    tilladt = await chrome.permissions.request({ origins: [`${url}/*`] });
  } catch (err) {
    status(`Edge refused the permission: ${err.message}`, 'fejl');
    return;
  }
  if (!tilladt) { status('Without permission to reach tovo, the extension cannot start timers.', 'fejl'); return; }

  $('gem').disabled = true;
  status('Testing…');
  try {
    /* En tom tekst er en proeve uden sideeffekter: en gyldig noegle med ret
       scope faar 400 "there is no text to capture" - intet oprettes. */
    await tjekVersion(url);
    await kaldCapture(url, noegle, { text: '', start: false });
    status('Unexpected answer from tovo — nothing was saved.', 'fejl');
  } catch (err) {
    if (err.status === 400) {
      await chrome.storage.local.set({ url, noegle });
      $('url').value = url;
      status('Saved. Select some text, right-click, and choose "Start tovo timer".', 'ok');
    } else {
      status(err.message, 'fejl');
    }
  } finally {
    $('gem').disabled = false;
  }
});
