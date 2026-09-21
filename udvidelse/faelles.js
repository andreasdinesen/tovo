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
  if (res.ok && data) return data;
  if (res.status === 401) throw new Error('The access key was not accepted. It may have been revoked.');
  if (res.status === 403) throw new Error('The key has the wrong scope. Create a "capture only" key in tovo.');
  if (res.status === 429) throw new Error('Too many requests with this key. Try again shortly.');
  if (!data) throw new Error(`tovo answered ${res.status}, but not with tovo's API. Is the address right?`);
  const e = new Error(data.message || data.error || `tovo answered ${res.status}.`);
  e.status = res.status;
  throw e;
}
