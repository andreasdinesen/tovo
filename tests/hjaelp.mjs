/* Faelles opsaetning for integrationstestene.
 *
 * Testene starter den RIGTIGE server. Det er dyrere end enhedstests og
 * betaler sig hver gang: doda fandt fejl gennem denne vej, som ingen
 * enhedstest ville have set (F4).
 *
 * To ting er ikke til forhandling:
 *  - BIND_PORT=0. Et fast portnummer goer testen afhaengig af, at ingen
 *    efterladt proces fra en tidligere koersel sidder paa den - og fejlen
 *    bliver "serveren startede ikke" i stedet for EADDRINUSE (doda v7).
 *  - Serverens stderr skal med i timeout-beskeden. Uden den peger fejlen paa
 *    opstarten i stedet for paa aarsagen.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROD = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function startServer(ekstraEnv = {}, genbrugDataDir = null) {
  // genbrugDataDir: start en NY proces paa den samme database. Det er den
  // eneste maade at bevise, at en koerende timer overlever, at serveren
  // (eller browseren) lukkes - og en timer, der ikke goer det, er ubrugelig.
  const dataDir = genbrugDataDir || mkdtempSync(path.join(tmpdir(), 'tovo-test-'));
  const proc = spawn('node', [path.join(ROD, 'app', 'server.js')], {
    env: { ...process.env, BIND_PORT: '0', DATA_DIR: dataDir, ...ekstraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let ud = '';
  let fejl = '';
  proc.stdout.on('data', (b) => { ud += b; });
  proc.stderr.on('data', (b) => { fejl += b; });

  const port = await new Promise((resolve, reject) => {
    const frist = setTimeout(() => reject(new Error(
      `serveren skrev ingen listen-linje inden 10 s.\nstdout:\n${ud}\nstderr:\n${fejl}`)), 10000);
    const tjek = setInterval(() => {
      // Samme linje, som runens done_regex venter paa - og porten er den,
      // socket'en FAKTISK fik, ikke den vi bad om.
      const m = ud.match(/tovo lytter paa port (\d+)/);
      if (m) { clearInterval(tjek); clearTimeout(frist); resolve(Number(m[1])); }
      if (proc.exitCode !== null) {
        clearInterval(tjek);
        clearTimeout(frist);
        reject(new Error(`serveren stoppede (kode ${proc.exitCode}).\nstderr:\n${fejl}`));
      }
    }, 30);
  });

  const base = `http://127.0.0.1:${port}`;
  return {
    port,
    base,
    dataDir,
    stdout: () => ud,
    stderr: () => fejl,
    /** @param {boolean} [behold] lad datamappen staa, saa en ny proces kan overtage. */
    stop(behold) {
      proc.kill('SIGTERM');
      if (behold) return;
      try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ligegyldigt */ }
    },
    /** En klient med sin egen cookie-krukke, saa to brugere kan koere samtidig. */
    klient() {
      let cookie = '';
      return {
        get cookie() { return cookie; },
        async kald(metode, sti, krop, opts = {}) {
          const h = {};
          if (krop !== undefined) h['Content-Type'] = 'application/json';
          if (cookie && !opts.udenCookie) h.Cookie = cookie;
          if (opts.noegle) h.Authorization = `Bearer ${opts.noegle}`;
          const res = await fetch(base + sti, {
            method: metode,
            headers: h,
            body: krop === undefined ? undefined : JSON.stringify(krop),
          });
          const saet = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
          for (const c of saet) if (c.startsWith('tovo_session=')) cookie = c.split(';')[0];
          let data = null;
          try { data = await res.json(); } catch { /* tom krop */ }
          return { status: res.status, data };
        },
      };
    },
  };
}

export async function opretBruger(srv, username, password = 'hemmeligt123') {
  const k = srv.klient();
  const r = await k.kald('POST', '/api/register', { username, password });
  if (r.status !== 200) throw new Error(`kunne ikke oprette ${username}: ${JSON.stringify(r.data)}`);
  return { klient: k, user: r.data.user };
}
