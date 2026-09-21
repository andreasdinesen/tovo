/* Deles af baggrund.js (importScripts) og indstillinger.html (<script>).
 *
 * Udvidelsen kender kun ÉN rute: POST /api/v1/capture med {raw: true}.
 * Noeglen skal have scope "capture" - den kan oprette og starte, men ikke
 * laese noget. Mister man computeren, kan noeglen ikke bruges til at se
 * tovos data (samme grund som telefonens noegle, server.js SCOPE_TILLADER).
 */

/* Adressen, som brugeren skrev den, skaaret ned til origin. En sti eller en
   afsluttende skraastreg ville give `//api/v1/...`. */
function tovoOrigin(raa) {
  let s = String(raa || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try { return new URL(s).origin; } catch { return ''; }
}

const MINDSTE_VERSION = 32;
const FOR_GAMMEL = `This tovo is too old for the extension (it needs v${MINDSTE_VERSION} or newer). `
  + 'Restart tovo in the panel so it updates itself.';

/* Den offentlige config fortaeller serverens version - uden noegle og uden
   at oprette noget. Svarer den ikke, afgoer selve kaldet sagen. */
async function tjekVersion(url) {
  try {
    const res = await fetch(`${url}/api/public-config`, { credentials: 'omit' });
    const c = await res.json();
    if (typeof c.version === 'number' && c.version < MINDSTE_VERSION) throw new Error(FOR_GAMMEL);
  } catch (err) {
    if (err.message === FOR_GAMMEL) throw err;
  }
}

async function hentIndstillinger() {
  const { url, noegle } = await chrome.storage.local.get(['url', 'noegle']);
  return { url: tovoOrigin(url), noegle: String(noegle || '').trim() };
}

/**
 * Kalder capture-ruten. Kaster en Error, hvis besked allerede er til et menneske
 * - aldrig en raa netvaerksfejl ("Failed to fetch" siger ingenting).
 */
async function kaldCapture(url, noegle, krop) {
  let res;
  try {
    res = await fetch(`${url}/api/v1/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${noegle}` },
      body: JSON.stringify({ raw: true, ...krop }),
      credentials: 'omit',
    });
  } catch {
    throw new Error(`Could not reach tovo at ${url}. Check the address and your connection.`);
  }
  let data = null;
  try { data = await res.json(); } catch { /* ikke JSON - fx en login-side foran tunnelen */ }
  /* En tovo foer v32 kender ikke `raw`/`start`: den opretter opgaven gennem
     den almindelige fangst og starter INTET - og svarer 200. Uden det her
     tjek meldte udvidelsen »Timer started«, mens intet koerte (2026-09-21).
     `created` er et boolean i v32+ og mangler helt i de gamle. */
  if (res.ok && data && typeof data.created !== 'boolean') throw new Error(FOR_GAMMEL);
  if (res.ok && data) return data;
  if (res.status === 401) throw new Error('The access key was not accepted. It may have been revoked.');
  if (res.status === 403) throw new Error('The key has the wrong scope. Create a "capture only" key in tovo.');
  if (res.status === 429) throw new Error('Too many requests with this key. Try again shortly.');
  if (!data) throw new Error(`tovo answered ${res.status}, but not with tovo's API. Is the address right?`);
  const e = new Error(data.message || data.error || `tovo answered ${res.status}.`);
  e.status = res.status;
  throw e;
}
