'use strict';
/*
 * tovo - tidsregistrering paa opgaver og projekter.
 *
 * Ren Node: node:http + node:sqlite + node:crypto. Ingen npm-pakker, ingen CDN.
 * Det er ikke sparsommelighed, men sikkerhedsvalget: uden afhaengigheder findes
 * der ingen transitiv forsyningskaede at holde patchet (RUNE-ERFARINGER §1).
 *
 * tovo er en TVILLING til doda - samme stak, samme udseende - men de to apps
 * har intet med hinanden at goere: hver sin database, ingen synkronisering.
 * Modsat doda er tovo FLERBRUGER, og dodas auth-stak kan derfor ikke kopieres
 * ordret: doda henter brugeren med "SELECT ... FROM users LIMIT 1".
 */

// Tidszonen SKAL saettes foer den foerste Date bruges - ellers regner
// containeren i UTC, og "i dag" bliver forkert nogle timer i doegnet.
process.env.TZ = process.env.TZ || 'Europe/Copenhagen';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// De to delte moduler. Samme parser og samme udregning som frontenden -
// der maa ikke findes en saerlig vej ind i dataene for hverken webappen,
// et start-link eller MCP.
const parse = require('./shared/parse.js');
const beregn = require('./shared/beregn.js');

const DATA_DIR = process.env.DATA_DIR || process.cwd();

// KUN BIND_PORT - aldrig PORT_web eller TOVO_PORT.
//
// Panelet injicerer PORT_<navn> og <NAVN>_PORT med den HOST-port, det har
// allokeret - ikke container-porten. Container-siden er den konstant, runen
// selv erklaerer i ports.default (3000). Binder appen sig til host-porten inde
// i containeren, peger panelets mapping paa 3000, hvor der ikke lytter noget,
// og INTET fejler hoejlydt: installationen lykkes, done_regex matcher, og
// siden er bare doed (doda v3).
const BIND_PORT = Number(process.env.BIND_PORT || 3000);
const APP_NAME = process.env.APP_NAME || 'tovo';

// Under udvikling staar APP_VERSION stille (den bumpes foerst ved udgivelse),
// men de statiske filer serveres "immutable" - saa koerer browseren glad den
// gamle app.js videre, og man fejlsoeger kode, der ikke er indlaest (doda F1).
const DEV = process.env.TOVO_DEV === '1';

const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'tovo_session';
const SESSION_DAYS = 90;

/* ---------------------------------------------------------------- database */

const db = new DatabaseSync(path.join(DATA_DIR, 'tovo.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

/*
 * Skema-trin. Tilfoej ALDRIG til et eksisterende trin efter udgivelse - laeg
 * en ny funktion i enden af listen i stedet (doda: migrationsliste styret af
 * PRAGMA user_version fra dag ét, saa der aldrig skal danses ALTER i haanden).
 */
const MIGRATIONS = [
  function m1(d) {
    d.exec(`
      CREATE TABLE users (
        id         TEXT PRIMARY KEY,
        username   TEXT NOT NULL UNIQUE,
        password   TEXT NOT NULL,
        -- Foerste registrerede bruger er admin. Admin driver APPEN (adgang,
        -- registrering, sikkerhedslog) og ser ALDRIG andres opgaver.
        is_admin   INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE sessions (
        token      TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX ix_sessions_udloeb ON sessions(expires_at);

      -- scope = brugerens id, eller '*' for de faa indstillinger, der hoerer
      -- til installationen (fx allow_registration). Uden scope i noeglen ville
      -- to brugeres afrundingsregel vaere den samme raekke.
      CREATE TABLE settings (
        scope TEXT NOT NULL,
        key   TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (scope, key)
      );

      -- Rate-limit hoerer til i databasen, ikke i memory: panelets
      -- auto-opdatering genstarter containeren kl. 04 (doda).
      CREATE TABLE rate (
        bucket   TEXT PRIMARY KEY,
        count    INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      );

      CREATE TABLE audit (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        at      INTEGER NOT NULL,
        event   TEXT NOT NULL,
        subject TEXT,
        detail  TEXT
      );
      CREATE INDEX ix_audit_tid ON audit(at DESC);

      CREATE TABLE credentials (
        id         TEXT PRIMARY KEY,          -- credentialId, base64url
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL DEFAULT '',
        public_key TEXT NOT NULL,             -- SPKI PEM
        alg        TEXT NOT NULL,
        sign_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );
      CREATE INDEX ix_credentials_bruger ON credentials(user_id);

      -- Kun hashen gemmes. Access-tokens fra OAuth (fase 8) laegges i SAMME
      -- tabel med client_id + expires_at, saa der er ét sted at validere,
      -- ét sted at tilbagekalde og ét sted at rate-limite (§9a).
      CREATE TABLE tokens (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        hash       TEXT NOT NULL UNIQUE,
        prefix     TEXT NOT NULL,
        scope      TEXT NOT NULL DEFAULT 'full',
        client_id  TEXT,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER
      );
      CREATE INDEX ix_tokens_hash ON tokens(hash) WHERE revoked_at IS NULL;
    `);
  },

  function m2(d) {
    /*
     * Domaenet. To bevidste afvigelser fra den generiske items-tabel:
     *
     *  - TIDSPOSTER faar en rigtig tabel. De forespoerges paa tidsinterval og
     *    summeres; et json_extract pr. raekke i en ugesum er unoedigt.
     *  - START- og ICAL-TOKENS faar rigtige kolonner, fordi de slaas op fra
     *    endepunkter UDEN login og aldrig maa scanne datasaettet (§4).
     *
     * Projekter, opgaver, kommentarer og tags ligger som JSON i items. Til
     * gengaeld faar de felter, der FAKTISK forespoerges, et udtryks-indeks -
     * dodas m2 siger det ligeud: alt der filtreres paa skal kunne slaas op.
     */
    d.exec(`
      CREATE TABLE items (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL,
        data       TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX ix_items_user_kind ON items(user_id, kind);
      -- Genimport fra Planner slaar op paa plannerTaskId for HVER raekke i
      -- eksporten. Uden indekset er det en fuld scanning pr. opgave.
      CREATE INDEX ix_items_planner ON items(user_id, json_extract(data, '$.plannerTaskId'))
        WHERE json_extract(data, '$.plannerTaskId') IS NOT NULL;
      CREATE INDEX ix_items_projekt ON items(user_id, json_extract(data, '$.projectId'))
        WHERE json_extract(data, '$.projectId') IS NOT NULL;

      CREATE TABLE time_entries (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id    TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        stopped_at INTEGER,                  -- NULL = koerer nu
        note       TEXT,
        source     TEXT NOT NULL             -- timer | manuel | link | mcp
      );
      CREATE INDEX ix_te_user_time ON time_entries(user_id, started_at);
      CREATE INDEX ix_te_task ON time_entries(task_id);
      -- Reglen "kun én koerende timer" haandhaeves af DATABASEN. Applikations-
      -- logikken stoppes ikke af to samtidige faner; det her goer.
      CREATE UNIQUE INDEX ix_te_running ON time_entries(user_id) WHERE stopped_at IS NULL;

      CREATE TABLE start_tokens (
        token      TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id    TEXT NOT NULL,
        mode       TEXT NOT NULL,            -- start | toggle
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX ix_start_tokens_task ON start_tokens(task_id);

      CREATE TABLE ical_feeds (
        token      TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
    `);
  },
];

function migrate() {
  const cur = db.prepare('PRAGMA user_version').get().user_version || 0;
  for (let i = cur; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      MIGRATIONS[i](db);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
      log(`skema opdateret til version ${i + 1}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/* De fire slags indhold. Kind-hvidlisten staar ÉT sted, saa et API-kald ikke
   kan lave en femte slags, som ingen visning kender. */
const KINDS = new Set(['project', 'task', 'comment', 'tag']);

/*
 * Felterne pr. slags. En EKSPLICIT hvidliste, ikke en sortliste.
 *
 * Det er ikke pedanteri: fase 5's genimport fra Planner skal kunne opdatere
 * nogle felter og aldrig roere andre, og den regel kan kun skrives sikkert,
 * hvis der findes en udtoemmende liste over, hvad et element overhovedet har.
 * En sortliste glemmer det felt, nogen tilfoejer om et halvt aar.
 */
const FELTER = {
  project: ['name', 'color', 'icon', 'customer', 'plannerPlanId', 'plannerPlanName',
    'lastImportAt', 'budgetHours', 'archivedAt', 'sections', 'position'],
  // Sektioner er et FELT paa projektet (array af {id, name, position}), ikke
  // en egen kind - de findes ikke uden for deres projekt.
  task: ['title', 'note', 'projectId', 'sectionId', 'parentTaskId', 'estimateMinutes',
    'priority', 'dueDate', 'dueTime', 'status', 'completedAt', 'plannerTaskId',
    'recurrenceRule', 'links', 'tagIds', 'position'],
  comment: ['taskId', 'text'],
  tag: ['name', 'color'],
};

// Opgavens tilstande. 'doing' findes, fordi Planner har den ('I gang') - uden
// den ville en genimport kaste information vaek hver gang.
const STATUSSER = ['open', 'doing', 'done'];
const PRIORITETER = ['low', 'medium', 'high'];

/* Indstillinger, der hoerer til INSTALLATIONEN og ikke til en bruger. Kun
   admin maa skrive dem; alle andre noegler er brugerens egne. */
const GLOBALE_SETTINGS = new Set(['allow_registration']);

/* ----------------------------------------------------------------- hjaelpere */

const now = () => Math.floor(Date.now() / 1000);
const log = (msg) => console.log(`[tovo] ${msg}`);
const logError = (msg) => console.error(`[fejl] ${msg}`);
// Ruller op pr. subjekt i panelets sikkerhedshistorik via runens events:-blok.
const logSecurity = (msg) => console.warn(`[sikkerhed] ${msg}`);

function newId() {
  return crypto.randomBytes(16).toString('hex');
}

function audit(event, subject, detail) {
  try {
    db.prepare('INSERT INTO audit (at, event, subject, detail) VALUES (?,?,?,?)')
      .run(now(), event, subject || null, detail ? String(detail).slice(0, 500) : null);
  } catch (err) {
    logError(`kunne ikke skrive audit: ${err.message}`);
  }
}

function getSetting(scope, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE scope = ? AND key = ?').get(scope, key);
  return row ? row.value : fallback;
}

function setSetting(scope, key, value) {
  db.prepare(`INSERT INTO settings (scope, key, value) VALUES (?,?,?)
              ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`)
    .run(scope, key, String(value));
}

function hentSettings(scope) {
  const ud = {};
  for (const r of db.prepare('SELECT key, value FROM settings WHERE scope = ?').all(scope)) {
    ud[r.key] = r.value;
  }
  return ud;
}

function rateAllow(bucket, limit, windowSec) {
  const t = now();
  const row = db.prepare('SELECT count, reset_at FROM rate WHERE bucket = ?').get(bucket);
  if (!row || row.reset_at <= t) {
    db.prepare(`INSERT INTO rate (bucket, count, reset_at) VALUES (?,1,?)
                ON CONFLICT(bucket) DO UPDATE SET count = 1, reset_at = excluded.reset_at`)
      .run(bucket, t + windowSec);
    return true;
  }
  if (row.count >= limit) return false;
  db.prepare('UPDATE rate SET count = count + 1 WHERE bucket = ?').run(bucket);
  return true;
}

function rateClear(bucket) {
  db.prepare('DELETE FROM rate WHERE bucket = ?').run(bucket);
}

/* ---------------------------------------------------------------- kodeord */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  let actual;
  try {
    actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/* ---------------------------------------------------------------- sessioner */

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const t = now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, userId, t, t + SESSION_DAYS * 86400);
  return token;
}

function sessionUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.is_admin, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (row.expires_at <= now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { id: row.id, username: row.username, isAdmin: !!row.is_admin };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function sessionCookie(req, token, maxAge) {
  const bits = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isHttps(req)) bits.push('Secure');
  return bits.join('; ');
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'ukendt';
}

/* ------------------------------------------------------------ http-svar */

// Hashen af det inline tema-script i index.html. Beregnes ved OPSTART i stedet
// for at blive stemplet ind af build'et - saa kan CSP'en aldrig komme ud af
// trit med filen, og build og server er ikke koblet sammen (doda).
let INLINE_SCRIPT_HASH = '';
let INLINE_SCRIPT_TEXT = '';
let APP_VERSION_FIL = '1';

function computeInlineHash() {
  try {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    const v = html.match(/style\.css\?v=(\d+)/);
    if (v) APP_VERSION_FIL = v[1];
    const m = html.match(/<script data-theme-init>([\s\S]*?)<\/script>/);
    if (!m) return;
    INLINE_SCRIPT_TEXT = m[1];
    INLINE_SCRIPT_HASH = ` 'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`;
  } catch (err) {
    logError(`kunne ikke beregne CSP-hash: ${err.message}`);
  }
}

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'none'",
    `script-src 'self'${INLINE_SCRIPT_HASH}`,
    // 'unsafe-inline' gaelder KUN typografi. Den betydningsfulde spaerring er
    // script-src; uden style-attributter kan en vanilla-JS-frontend ikke bygge
    // markup med innerHTML.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    // Uden worker-src falder en service worker tilbage til default-src 'none'
    // og blokeres af vores egen CSP - uden at fejlen naevner CSP med ét ord.
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy',
    'geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function sendJson(res, status, body, extraHeaders) {
  const data = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(data),
  }, extraHeaders || {}));
  res.end(data);
}

/** Fejlsvar med to lag: en kode til maskinen, en saetning til mennesket. */
function apiFejl(res, status, kode, besked) {
  sendJson(res, status, { error: kode, message: besked });
}

const MAX_BODY = 2 * 1024 * 1024;

/**
 * @param {boolean} tilgivende  Saettes KUN naar forespoergslen er godkendt med
 *   en adgangsnoegle. Kravet om application/json er en CSRF-barriere, og CSRF
 *   forudsaetter en ambient legitimation (cookien). En Bearer-noegle sendes
 *   aktivt af klienten, saa der er intet at forfalske.
 */
function readJsonBody(req, tilgivende, tilladArray) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    const erJson = type.includes('application/json');
    if (!erJson && !tilgivende) {
      reject(Object.assign(new Error('Content-Type must be application/json'), { status: 415 }));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('the request is too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) { resolve({}); return; }
      if (erJson || raw.startsWith('{') || (tilladArray && raw.startsWith('['))) {
        try {
          const parsed = JSON.parse(raw);
          // En generel body-laeser skal have et EKSPLICIT tilladArray-flag.
          // Tavs afvisning af arrays gjorde JSON-RPC-batch umulig i doda.
          if (Array.isArray(parsed)) { resolve(tilladArray ? parsed : {}); return; }
          resolve(parsed && typeof parsed === 'object' ? parsed : {});
        } catch {
          reject(Object.assign(new Error('The body is not valid JSON.'), { status: 400 }));
        }
        return;
      }
      if (type.includes('application/x-www-form-urlencoded')) {
        const felter = {};
        for (const [n, v] of new URLSearchParams(raw)) felter[n] = v;
        resolve(felter);
        return;
      }
      resolve({ text: raw });
    });
    req.on('error', reject);
  });
}

function str(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/* ------------------------------------------------------------ statisk */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.resolve(PUBLIC_DIR, rel);
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) {
    apiFejl(res, 403, 'forbidden', 'Not allowed.');
    return;
  }
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    apiFejl(res, 404, 'not_found', 'No such file.');
    return;
  }
  if (!stat.isFile()) { apiFejl(res, 404, 'not_found', 'No such file.'); return; }

  const ext = path.extname(full).toLowerCase();
  const isHtml = ext === '.html';
  securityHeaders(res);

  // I DEV stemples ?v= med filernes mtime. Ellers beholder browseren en
  // "immutable" app.js og spoerger aldrig serveren igen (doda F1).
  if (isHtml && DEV) {
    let html = fs.readFileSync(full, 'utf8');
    html = html.replace(/(style\.css|app\.js)\?v=\d+/g, (_, fil) => {
      let m = 0;
      try { m = Math.floor(fs.statSync(path.join(PUBLIC_DIR, fil)).mtimeMs); } catch { /* ligegyldigt */ }
      return `${fil}?v=${m}`;
    });
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    // HTML altid frisk: Cloudflare edge-cacher .js/.css i timevis og ignorerer
    // no-cache, saa versionerede URL'er baerer opdateringen (§5).
    'Cache-Control': (isHtml || DEV) ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(full).pipe(res);
}

/* ------------------------------------------------- adgangsnoegler */

/* En mistet telefon maa ikke kunne laese hele systemet: en capture-noegle kan
   KUN oprette, ikke se noget. */
const SCOPE_TILLADER = {
  capture: new Set(['capture']),
  read: new Set(['read']),
  full: new Set(['capture', 'read', 'write']),
};

function hashToken(raa) {
  return crypto.createHash('sha256').update(String(raa), 'utf8').digest('hex');
}

function opretToken(userId, navn, scope, ekstra) {
  const e = ekstra || {};
  const hemmelig = crypto.randomBytes(32).toString('base64url');
  const noegle = `tovo_${hemmelig}`;
  const id = newId();
  db.prepare(`INSERT INTO tokens (id, user_id, name, hash, prefix, scope, client_id, expires_at, created_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, navn, hashToken(noegle), hemmelig.slice(0, 6), scope,
      e.clientId || null, e.expiresAt || null, now());
  audit(e.clientId ? 'oauth-token-udstedt' : 'noegle-oprettet', navn, scope);
  // Noeglen returneres ÉN gang og gemmes aldrig i klartekst.
  return { id, key: noegle };
}

function findToken(raa) {
  if (typeof raa !== 'string' || !raa.startsWith('tovo_')) return null;
  return db.prepare(`
    SELECT id, user_id, name, scope, last_used_at, client_id FROM tokens
     WHERE hash = ? AND revoked_at IS NULL
       -- Uden udloebstjekket HER ville et OAuth-token leve evigt, uanset hvad
       -- vi lovede klienten i expires_in.
       AND (expires_at IS NULL OR expires_at > ?)`).get(hashToken(raa), now()) || null;
}

function stemplBrug(token) {
  const t = now();
  if (token.last_used_at && t - token.last_used_at < 60) return;
  db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(t, token.id);
}

/* ------------------------------------------------------------ godkendelse */

/**
 * Godkender via adgangsnoegle ELLER session-cookie. Webappen bruger samme API
 * som eksterne klienter - der er ingen intern bagvej (doda F2).
 *
 * @returns {{user, token, viaToken}|null} null naar svaret allerede er sendt.
 */
function godkend(req, res, kraevetScope) {
  const auth = String(req.headers.authorization || '');
  const bearer = auth.match(/^Bearer\s+(\S+)$/i);
  const raaNoegle = bearer ? bearer[1] : String(req.headers['x-api-key'] || '');

  if (raaNoegle) {
    const token = findToken(raaNoegle);
    if (!token) {
      logSecurity(`noegle-afvist ip=${clientIp(req)}`);
      apiFejl(res, 401, 'invalid_key', 'That access key is not valid. It may have been revoked.');
      return null;
    }
    if (!rateAllow(`api:${token.id}`, 600, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many requests with this key. Try again shortly.');
      return null;
    }
    if (!SCOPE_TILLADER[token.scope].has(kraevetScope)) {
      apiFejl(res, 403, 'wrong_scope',
        `This key is "${token.scope}" and cannot ${kraevetScope}. Create a key with a wider scope.`);
      return null;
    }
    stemplBrug(token);
    // Noeglen hoerer til ÉN bruger. Uden user_id paa tokens ville en noegle
    // give adgang til den foerste bruger i tabellen - som i doda, hvor der
    // kun findes én.
    const bruger = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(token.user_id);
    if (!bruger) { apiFejl(res, 401, 'invalid_key', 'That key has no owner.'); return null; }
    return {
      user: { id: bruger.id, username: bruger.username, isAdmin: !!bruger.is_admin },
      token,
      viaToken: true,
    };
  }

  const user = sessionUser(req);
  if (!user) {
    apiFejl(res, 401, 'not_signed_in', 'You are not signed in.');
    return null;
  }
  return { user, token: null, viaToken: false };
}

/**
 * Kraever en rigtig SESSION - en adgangsnoegle er ikke nok.
 *
 * Kun til kodeordsskift og administration af noeglerne selv. Ellers ville én
 * laekket noegle vaere nok til at give sig selv varig adgang (doda F2).
 */
function requireUser(req, res) {
  const user = sessionUser(req);
  if (!user) {
    apiFejl(res, 401, 'session_required',
      'This needs a signed-in browser session — an access key cannot do it.');
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!user.isAdmin) {
    apiFejl(res, 403, 'admin_only', 'Only the administrator can change this.');
    return null;
  }
  return user;
}

function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function tilladRegistrering() {
  // Ingen bruger endnu: foerste registrering skal altid kunne lade sig goere.
  if (userCount() === 0) return true;
  return getSetting('*', 'allow_registration', '0') === '1';
}

/* ------------------------------------------------------------ elementer */

/*
 * HELE dataadgangen ligger her, og user_id-filteret ligger i FUNKTIONERNE -
 * aldrig i kaldstederne. Laegges det i kaldstederne, bliver ét glemt, og saa
 * ser en bruger en andens opgaver (Kokkeri §4 / CLAUDE.md).
 *
 * Alle fire funktioner tager userId som foerste argument. Det er med vilje
 * ubekvemt: man kan ikke komme til at kalde dem uden at tage stilling.
 */

const MAX_ITEM_JSON = 200 * 1024;

function pakUd(row) {
  const data = JSON.parse(row.data);
  return Object.assign({}, data, { id: row.id, kind: row.kind, updatedAt: row.updated_at });
}

/** @param {object} [filter] {kind, ids, medSlettede} */
function hentItems(userId, filter) {
  const f = filter || {};
  const hvor = ['user_id = ?'];
  const arg = [userId];
  if (f.kind) {
    if (!KINDS.has(f.kind)) return [];
    hvor.push('kind = ?');
    arg.push(f.kind);
  }
  if (Array.isArray(f.ids)) {
    if (!f.ids.length) return [];
    hvor.push(`id IN (${f.ids.map(() => '?').join(',')})`);
    arg.push(...f.ids.map(String));
  }
  // Bloed sletning bor i JSON'en (deletedAt), saa skemaet er praecis det,
  // planen beskriver. Filteret ligger HER, saa ingen liste kan glemme det.
  if (!f.medSlettede) hvor.push("json_extract(data, '$.deletedAt') IS NULL");
  const rows = db.prepare(
    `SELECT id, kind, data, updated_at FROM items WHERE ${hvor.join(' AND ')} ORDER BY updated_at DESC`
  ).all(...arg);
  return rows.map(pakUd);
}

function hentItem(userId, id) {
  const row = db.prepare('SELECT id, kind, data, updated_at FROM items WHERE id = ? AND user_id = ?')
    .get(String(id || ''), userId);
  if (!row) return null;
  const item = pakUd(row);
  return item.deletedAt ? null : item;
}

/**
 * Opretter eller opdaterer ÉT element.
 *
 * @param {boolean} [erDelvis] Saettes af kaldsstedet, hvis objektet kommer fra
 *   en liste, der kun sendte nogle felter. Vagten ligger i GEMME-funktionen,
 *   ikke i kaldsstedet - der bliver ét glemt (Kokkeri §4).
 */
function gemItem(userId, raa, erDelvis) {
  if (erDelvis || (raa && raa.partial)) {
    throw Object.assign(new Error('a partial item can never be saved as a whole one'), { status: 400 });
  }
  const kind = String(raa && raa.kind || '');
  if (!KINDS.has(kind)) {
    throw Object.assign(new Error(`unknown kind "${kind}"`), { status: 400 });
  }
  const id = str(raa.id, 64) || newId();
  const t = now();

  // Findes elementet, skal det tilhoere den samme bruger. Ellers ville et
  // gaet paa et id kunne overskrive en andens opgave.
  const eksisterende = db.prepare('SELECT user_id, data FROM items WHERE id = ?').get(id);
  if (eksisterende && eksisterende.user_id !== userId) {
    throw Object.assign(new Error('no such item'), { status: 404 });
  }

  // Rensningen sker HER - ikke i ruterne. Alt uden for FELTER[kind] falder
  // fra, uanset om det kommer fra webappen, en import eller en MCP-klient.
  const data = renseItem(kind, raa);

  // De to INTERNE felter staar med vilje uden for FELTER: de hoerer til
  // lagringen, ikke til modellen. Men de skal foeres med, ellers aad
  // hvidlisten den bloede sletning - hvilket den gjorde, foerste gang
  // rensningen blev sat ind, og isolationstesten fangede det med det samme.
  if ('deletedAt' in raa) data.deletedAt = raa.deletedAt ? tal(raa.deletedAt, 0, 1e11) : null;
  if (!data.createdAt) {
    data.createdAt = eksisterende ? (JSON.parse(eksisterende.data).createdAt || t) : t;
  }
  const json = JSON.stringify(data);
  if (json.length > MAX_ITEM_JSON) {
    throw Object.assign(new Error('that item is too large'), { status: 413 });
  }

  db.prepare(`INSERT INTO items (id, user_id, kind, data, updated_at) VALUES (?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, data = excluded.data,
                                            updated_at = excluded.updated_at`)
    .run(id, userId, kind, json, t);
  return Object.assign({}, data, { id, kind, updatedAt: t });
}

/**
 * Gemmer mange elementer i ÉN transaktion.
 *
 * Bulk er den farlige: en importrutine kan oedelaegge hundredvis af poster
 * paa én gang, stille. Derfor gaar den gennem den SAMME gemItem med den
 * samme vagt - ikke ad en hurtigere vej udenom.
 */
function saveBulk(userId, liste) {
  if (!Array.isArray(liste)) {
    throw Object.assign(new Error('expected an array of items'), { status: 400 });
  }
  if (liste.length > 200) {
    throw Object.assign(new Error('at most 200 items per call'), { status: 413 });
  }
  const ud = [];
  db.exec('BEGIN');
  try {
    for (const raa of liste) ud.push(gemItem(userId, raa));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return ud;
}

/**
 * Bloed sletning.
 *
 * Afgoer OM raekken findes, FOER den aendres. Laeser man den tilbage bagefter
 * med den samme funktion, der netop har gjort den usynlig, svarer sletningen
 * 404 paa noget, der lykkedes (doda v8 - fejlen laa der i otte udgivelser).
 */
function sletItem(userId, id) {
  const item = hentItem(userId, id);
  if (!item) return false;
  gemItem(userId, Object.assign({}, item, { deletedAt: now() }));
  return true;
}

/* ------------------------------------------------------- rensning */

/*
 * Et link maa vaere http(s) ELLER onenote:.
 *
 * onenote: er hele grunden til, at tovo findes: opgaverne bor i OneNote, og
 * et link tilbage dertil skal kunne klikkes. Derfor er skemaet hvidlistet i
 * stedet for at koere alt gennem den http-only-linkifisering, frontenden
 * bruger til FRI tekst (hvor javascript: og data: aldrig maa slippe igennem).
 *
 * Bemaerk forskellen: her ved vi, at feltet ER et link, og brugeren har selv
 * skrevet det. I fri tekst ved vi det ikke, og der er reglen strengere.
 */
const LINK_SKEMAER = /^(https?:|onenote:)/i;

function rentLink(raa) {
  const url = str(raa && raa.url, 2000);
  if (!url || !LINK_SKEMAER.test(url)) return null;
  // Kontroltegn kan bryde ud af en attribut, naar linket senere tegnes.
  if (/[\x00-\x1f\x7f]/.test(url)) return null;
  return { url, label: str(raa.label, 120) || url.replace(/^\w+:\/*/, '').slice(0, 60) };
}

function tal(v, min, max) {
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function dato(v) {
  const t = str(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

/**
 * Skaerer et indkommet objekt ned til felterne for sin slags.
 *
 * Alt, der ikke staar i FELTER, forsvinder her - ogsaa hvis det kommer fra
 * en import, en MCP-klient eller en fremtidig funktion, nogen glemte at
 * taenke paa. Rensningen sker ÉT sted: i gemItem.
 */
function renseItem(kind, raa) {
  const ind = raa || {};
  const ud = {};
  for (const felt of FELTER[kind]) {
    if (!(felt in ind)) continue;
    const v = ind[felt];
    if (v === null || v === undefined) { ud[felt] = null; continue; }
    switch (felt) {
      case 'name': case 'title': ud[felt] = str(v, 500); break;
      case 'customer': case 'plannerPlanName': case 'color': case 'icon':
      case 'sectionId': case 'parentTaskId': case 'projectId': case 'taskId':
      case 'plannerPlanId': case 'plannerTaskId':
        ud[felt] = str(v, 200); break;
      case 'note': case 'text': ud[felt] = str(v, 20000); break;
      case 'estimateMinutes': ud[felt] = tal(v, 1, 365 * 24 * 60); break;
      case 'budgetHours': ud[felt] = tal(v, 0, 100000); break;
      case 'position': ud[felt] = tal(v, 0, 1e9); break;
      case 'lastImportAt': case 'archivedAt': case 'completedAt': ud[felt] = tal(v, 0, 1e11); break;
      case 'dueDate': ud[felt] = dato(v); break;
      case 'dueTime': ud[felt] = /^\d{2}:\d{2}$/.test(str(v, 5)) ? str(v, 5) : null; break;
      case 'status': ud[felt] = STATUSSER.includes(v) ? v : 'open'; break;
      case 'priority': ud[felt] = PRIORITETER.includes(v) ? v : null; break;
      case 'tagIds':
        ud[felt] = Array.isArray(v) ? v.map((x) => str(x, 64)).filter(Boolean).slice(0, 30) : [];
        break;
      case 'links':
        ud[felt] = Array.isArray(v) ? v.map(rentLink).filter(Boolean).slice(0, 20) : [];
        break;
      case 'sections':
        ud[felt] = Array.isArray(v) ? v.slice(0, 100).map((sek, i) => ({
          id: str(sek && sek.id, 64) || newId(),
          name: str(sek && sek.name, 200),
          position: tal(sek && sek.position, 0, 1e9) || i,
        })).filter((sek) => sek.name) : [];
        break;
      // recurrenceRule kommer fra parse.tolkGentagelse. Den gemmes som den er
      // - motoren i fase 7 er den eneste, der kan bedoemme indholdet.
      case 'recurrenceRule': ud[felt] = (v && typeof v === 'object') ? v : null; break;
      default: ud[felt] = typeof v === 'string' ? str(v, 500) : v;
    }
  }
  return ud;
}

/* ------------------------------------------------------- fangst og soegning */

function naestePosition(userId, kind) {
  // Et loebenummer, ikke et tidsstempel. Skriver man now() i sorterings-
  // kolonnen, ser listen rigtig ud (tidsstempler sorterer kronologisk), og
  // manuel sortering er umulig bagefter (doda F3 - fejlen sad tre steder).
  const raekker = hentItems(userId, { kind });
  return raekker.reduce((m, r) => Math.max(m, Number(r.position) || 0), -1) + 1;
}

function findProjektVedNavn(userId, navn) {
  const n = String(navn || '').toLowerCase();
  return hentItems(userId, { kind: 'project' })
    .find((p) => String(p.name || '').toLowerCase() === n) || null;
}

function findTagVedNavn(userId, navn) {
  const n = String(navn || '').toLowerCase();
  return hentItems(userId, { kind: 'tag' })
    .find((t) => String(t.name || '').toLowerCase() === n) || null;
}

/**
 * Fangst: ÉN tekstlinje ind, ét element ud.
 *
 * Vaerktoejerne (og senere MCP) tager HELE linjen og koerer den gennem samme
 * parser som webappen. Der maa ikke findes en vej ind i dataene, hvor
 * syntaksen betyder noget andet (§9a).
 *
 * @param {object} [opts] {projectId} - konteksten fra den side, man staar paa.
 *   Et eksplicit @projekt i teksten vinder altid over konteksten.
 * @param {boolean} [opretNye] opret ukendte projekter og tags. Falsk fra en
 *   forhaandsvisning, hvor intet endnu skal skrives.
 */
function fangst(userId, tekst, opts) {
  const o = opts || {};
  const p = parse.tolkFangst(tekst);
  if (!p.title) {
    throw Object.assign(new Error('there is no text to capture'), { status: 400 });
  }

  const nye = [];
  let projectId = o.projectId || null;
  if (p.project) {
    let projekt = findProjektVedNavn(userId, p.project);
    if (!projekt) {
      if (o.opretNye === false) {
        throw Object.assign(new Error(`there is no project called "${p.project}"`), { status: 400 });
      }
      projekt = gemItem(userId, {
        kind: 'project', name: p.project, position: naestePosition(userId, 'project'), sections: [],
      });
      nye.push({ kind: 'project', name: projekt.name });
    }
    projectId = projekt.id;
  }

  const tagIds = [];
  for (const navn of p.tags) {
    let tag = findTagVedNavn(userId, navn);
    if (!tag && o.opretNye !== false) {
      tag = gemItem(userId, { kind: 'tag', name: navn });
      nye.push({ kind: 'tag', name: tag.name });
    }
    if (tag) tagIds.push(tag.id);
  }

  const item = gemItem(userId, {
    kind: 'task',
    title: p.title,
    note: p.note || '',
    projectId,
    sectionId: o.sectionId || null,
    estimateMinutes: p.estimateMinutes,
    dueDate: p.due ? p.due.dato : null,
    dueTime: p.due ? p.due.tid : null,
    recurrenceRule: p.recurrenceRule,
    tagIds,
    status: 'open',
    position: naestePosition(userId, 'task'),
  });
  return { item, nye, warnings: p.warnings, recurrenceText: p.recurrenceText };
}

/**
 * Soegning i opgaver og projekter.
 *
 * Simpel delstrengs-match paa titel/navn. Datamaengden er én persons
 * opgaver, saa der er ingen grund til et indeks - men filteret ligger stadig
 * i hentItems, saa soegningen ikke kan naa en anden brugers data.
 */
function soeg(userId, raa, opts) {
  const q = String(raa || '').trim().toLowerCase();
  const o = opts || {};
  if (!q) return { tasks: [], projects: [] };
  const passer = (v) => String(v || '').toLowerCase().includes(q);
  const opgaver = hentItems(userId, { kind: 'task' })
    .filter((t) => (!o.projectId || t.projectId === o.projectId))
    .filter((t) => passer(t.title) || passer(t.note))
    .slice(0, 25);
  const projekter = o.projectId ? [] : hentItems(userId, { kind: 'project' })
    .filter((p) => passer(p.name) || passer(p.customer))
    .slice(0, 10);
  return { tasks: opgaver, projects: projekter };
}

/* ------------------------------------------------------- tidsposter */

/*
 * Tidsposter har deres egen tabel: de forespoerges paa tidsinterval og
 * summeres, og et json_extract pr. raekke i en ugesum er unoedigt.
 *
 * Som med items ligger user_id-filteret i FUNKTIONERNE - aldrig i
 * kaldstederne.
 */

const KILDER = new Set(['timer', 'manuel', 'link', 'mcp']);

function pakPost(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    note: row.note || '',
    source: row.source,
  };
}

/** @param {object} [filter] {fra, til, taskId} - fra/til i unix-sekunder */
function hentPoster(userId, filter) {
  const f = filter || {};
  const hvor = ['user_id = ?'];
  const arg = [userId];
  if (f.taskId) { hvor.push('task_id = ?'); arg.push(String(f.taskId)); }
  // Halvaabent interval: to naboperioder taeller hverken en post to gange
  // eller taber den.
  if (f.fra !== undefined) { hvor.push('started_at >= ?'); arg.push(f.fra); }
  if (f.til !== undefined) { hvor.push('started_at < ?'); arg.push(f.til); }
  return db.prepare(`SELECT * FROM time_entries WHERE ${hvor.join(' AND ')} ORDER BY started_at DESC`)
    .all(...arg).map(pakPost);
}

function hentPost(userId, id) {
  const row = db.prepare('SELECT * FROM time_entries WHERE id = ? AND user_id = ?')
    .get(String(id || ''), userId);
  return row ? pakPost(row) : null;
}

function koerendePost(userId) {
  const row = db.prepare('SELECT * FROM time_entries WHERE user_id = ? AND stopped_at IS NULL')
    .get(userId);
  return row ? pakPost(row) : null;
}

/**
 * Starter en timer og stopper en eventuel koerende.
 *
 * Det unikke indeks (ix_te_running) haandhaever reglen om ÉN koerende timer.
 * Applikationslogikken herunder er bekvemmeligheden - indekset er reglen, og
 * det er dét, der ogsaa holder, naar to faner trykker start samtidig.
 */
function startTimer(userId, taskId, kilde) {
  const opgave = hentItem(userId, taskId);
  if (!opgave || opgave.kind !== 'task') {
    throw Object.assign(new Error('no such task'), { status: 404 });
  }
  const t = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const koerende = koerendePost(userId);
    if (koerende) {
      db.prepare('UPDATE time_entries SET stopped_at = ? WHERE id = ?').run(t, koerende.id);
    }
    const id = newId();
    db.prepare(`INSERT INTO time_entries (id, user_id, task_id, started_at, stopped_at, note, source)
                VALUES (?,?,?,?,NULL,?,?)`)
      .run(id, userId, taskId, t, '', KILDER.has(kilde) ? kilde : 'timer');
    db.exec('COMMIT');
    return { entry: hentPost(userId, id), stopped: koerende ? hentPost(userId, koerende.id) : null };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function stopTimer(userId) {
  const koerende = koerendePost(userId);
  if (!koerende) return null;
  db.prepare('UPDATE time_entries SET stopped_at = ? WHERE id = ?').run(now(), koerende.id);
  return hentPost(userId, koerende.id);
}

function gemPost(userId, felter) {
  const taskId = str(felter.taskId, 64);
  if (!hentItem(userId, taskId)) {
    throw Object.assign(new Error('no such task'), { status: 404 });
  }
  const start = tal(felter.startedAt, 0, 1e11);
  const stop = felter.stoppedAt === null ? null : tal(felter.stoppedAt, 0, 1e11);
  if (!start || (stop !== null && stop <= start)) {
    throw Object.assign(new Error('that time range ends before it starts'), { status: 400 });
  }
  const id = str(felter.id, 64) || newId();
  const eksisterende = db.prepare('SELECT user_id FROM time_entries WHERE id = ?').get(id);
  if (eksisterende && eksisterende.user_id !== userId) {
    throw Object.assign(new Error('no such entry'), { status: 404 });
  }
  db.prepare(`INSERT INTO time_entries (id, user_id, task_id, started_at, stopped_at, note, source)
              VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET task_id = excluded.task_id,
                started_at = excluded.started_at, stopped_at = excluded.stopped_at,
                note = excluded.note`)
    .run(id, userId, taskId, start, stop, str(felter.note, 500),
      KILDER.has(felter.source) ? felter.source : 'manuel');
  return hentPost(userId, id);
}

function sletPost(userId, id) {
  const r = db.prepare('DELETE FROM time_entries WHERE id = ? AND user_id = ?').run(String(id || ''), userId);
  return r.changes > 0;
}

/**
 * En FRISK beregnings-instans pr. kald.
 *
 * Muldbog v6: en delt instans har forraederisk cache lige efter en skrivning -
 * vaerktoejet gemte en linje og lagde den derefter til et opslag, der allerede
 * havde hentet den, saa totalen blev talt to gange. Instansen her henter
 * gennem funktionerne ved hvert kald, og der er ingen tilstand at komme galt
 * af sted med.
 */
function beregnFor(userId) {
  return beregn.opret({
    items: (kind) => hentItems(userId, { kind }),
    entries: () => hentPoster(userId, {}),
    settings: () => ({
      rounding: Number(getSetting(userId, 'rounding', '0')),
      normWeekHours: Number(getSetting(userId, 'norm_week_hours', '37')),
      timerWarnHours: Number(getSetting(userId, 'timer_warn_hours', '8')),
    }),
  });
}

/** Den koerende timer med alt, en visning skal bruge - inklusive advarslen. */
function timerStatus(userId) {
  const post = koerendePost(userId);
  if (!post) return null;
  const opgave = hentItem(userId, post.taskId);
  const projekt = opgave && opgave.projectId ? hentItem(userId, opgave.projectId) : null;
  const minutter = beregnFor(userId).varighed(post);
  const graense = Number(getSetting(userId, 'timer_warn_hours', '8')) * 60;
  return {
    entry: post,
    // Titlen foelger MED. state paa klienten indeholder kun den aktuelle
    // skaerms elementer, saa et opslag fejler i samme sekund, brugeren
    // navigerer vaek (doda F8).
    taskTitle: opgave ? opgave.title : 'Deleted task',
    projectName: projekt ? projekt.name : null,
    minutes: minutter,
    // Advarslen regnes HER, ikke i frontenden: den skal vaere den samme,
    // uanset om det er webappen eller en MCP-klient, der spoerger.
    tooLong: graense > 0 && minutter >= graense,
    warnAfterMinutes: graense,
  };
}

/* ------------------------------------------------------- start-links */

/*
 * Et start-link er en adresse, der starter (og stopper) en timer UDEN login.
 * Det er hele grunden til, at tovo kan afloese Toggl: linket klistres ind paa
 * en OneNote-side ved siden af opgaven, og ét klik registrerer tid.
 *
 * Adressen ER hemmeligheden - som et iCal-feed. Derfor:
 *  - opslaget sker paa PRIMAERNOEGLEN og scanner aldrig datasaettet (§4),
 *  - et forkert eller tilbagekaldt token svarer 404, aldrig 401 eller 403:
 *    de to sidste bekraefter, at der ER noget at finde (doda F9),
 *  - tokenet vises kun til den indloggede ejer.
 */

function hentStartTokenFor(userId, taskId) {
  return db.prepare(`SELECT * FROM start_tokens
                      WHERE user_id = ? AND task_id = ? AND revoked_at IS NULL`)
    .get(userId, String(taskId || '')) || null;
}

function opretStartToken(userId, taskId, mode) {
  if (!hentItem(userId, taskId)) {
    throw Object.assign(new Error('no such task'), { status: 404 });
  }
  const eksisterende = hentStartTokenFor(userId, taskId);
  if (eksisterende) return eksisterende;
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare(`INSERT INTO start_tokens (token, user_id, task_id, mode, created_at)
              VALUES (?,?,?,?,?)`)
    .run(token, userId, taskId, mode === 'start' ? 'start' : 'toggle', now());
  audit('startlink-oprettet', taskId, mode);
  return hentStartTokenFor(userId, taskId);
}

/**
 * Slaar et start-token op. Punktopslag paa primaernoeglen.
 *
 * Den efterfoelgende timingSafeEqual er aerligt talt ceremoni HER: opslaget
 * sker paa noeglen selv, saa et forkert token giver ingen raekke, og der er
 * ingen sammenligning at maale paa. Den staar der, fordi den er gratis, og
 * fordi den er den rigtige vane det sted, hvor den GOER en forskel - naar en
 * hemmelighed hentes frem paa en anden noegle og derefter sammenlignes
 * (§9a / doda F9). Laengden tjekkes foerst: timingSafeEqual KASTER paa
 * forskellige laengder, og en klient bestemmer selv laengden.
 */
function findStartToken(raa) {
  const t = String(raa || '');
  if (t.length < 16 || t.length > 64) return null;
  const row = db.prepare('SELECT * FROM start_tokens WHERE token = ? AND revoked_at IS NULL').get(t);
  if (!row) return null;
  if (row.token.length !== t.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(row.token), Buffer.from(t))) return null;
  return row;
}

/*
 * Server-renderet side UDEN JavaScript.
 *
 * Den arver hele SPA'ens udseende gratis: link til /style.css?v=N med N laest
 * ud af index.html ved opstart, og tema-scriptet indsat ORDRET. Serveren
 * beregner allerede sha256 af netop den tekst til CSP-headeren, saa hashen
 * passer af sig selv - ingen ny undtagelse, ingen ny hash (§9a del 4).
 */
function sideSkal(titel, indhold) {
  return `<!doctype html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${escHtml(titel)}</title>
<script data-theme-init>${INLINE_SCRIPT_TEXT}</script>
<link rel="stylesheet" href="/style.css?v=${escHtml(APP_VERSION_FIL)}">
</head>
<body>
<div class="gate"><div class="card">${indhold}</div></div>
</body>
</html>`;
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sendHtml(res, status, html) {
  securityHeaders(res);
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

function ikkeFundetSide(res) {
  sendHtml(res, 404, sideSkal('Not found', '<h1>Not found</h1>'
    + '<p class="lead">This link does not exist, or it has been revoked.</p>'));
}

/**
 * Kvitteringssiden. Ingen JavaScript overhovedet - stop-knappen er en
 * almindelig formular, der POSTer til den samme adresse.
 */
function startSide(userId, taskId, koerer, besked) {
  const opgave = hentItem(userId, taskId);
  const projekt = opgave && opgave.projectId ? hentItem(userId, opgave.projectId) : null;
  const b = beregnFor(userId);
  const idag = b.sumPrDag(dagStart(iDag()), dagStart(iDag()) + 86400).get(iDag()) || 0;
  const paaOpgaven = b.forbrugPaaOpgave(taskId);
  const f = beregn.formatVarighed;

  return sideSkal(opgave ? opgave.title : 'tovo', `
    <div class="brand">${koerer ? '<span class="timerbar-dot"></span>' : ''} tovo</div>
    <h1 style="text-align:center">${escHtml(opgave ? opgave.title : 'Unknown task')}</h1>
    <p class="lead" style="text-align:center">${escHtml(projekt ? projekt.name : 'No project')}</p>
    <p class="startside-status">${escHtml(besked)}</p>
    <table class="data startside-tal">
      <tr><td>Today</td><td class="num">${escHtml(f(idag))}</td></tr>
      <tr><td>On this task</td><td class="num">${escHtml(f(paaOpgaven))}</td></tr>
    </table>
    ${koerer ? `<form method="post"><button class="btn primary" type="submit" style="width:100%">
      Stop the timer</button></form>` : ''}
    <p class="gate-note">${koerer
    ? 'You can close this page — the timer keeps running.'
    : 'Nothing is running. Open the link again to start it.'}</p>`);
}

/**
 * Haandterer /s/:token.
 *
 * GET udfoerer handlingen. Det er en GET, der aendrer noget, og det er et
 * bevidst valg: et link i OneNote kan ikke vaere en POST, og hele pointen er
 * ÉT klik. Prisen er, at en link-forhaandshentning kan komme til at starte en
 * timer - derfor svarer vi kun med SIDEN, naar klienten selv siger, at den
 * bare kigger (Sec-Purpose/Purpose/X-Purpose). Det daekker Outlook og de
 * browsere, der forhaandshenter; det er ikke en garanti, og det staar her,
 * saa ingen tror andet.
 */
function haandterStartLink(req, res, token) {
  const rad = findStartToken(token);
  if (!rad) {
    logSecurity(`startlink-afvist ip=${clientIp(req)}`);
    ikkeFundetSide(res);
    return;
  }

  // En anden INDLOGGET bruger maa ikke kunne betjene linket. Uden session er
  // adressen selv legitimationen - det er dens formaal - men er der en
  // session, og den hoerer til en anden, ser siden ikke ud til at findes.
  const session = sessionUser(req);
  if (session && session.id !== rad.user_id) {
    logSecurity(`startlink-fremmed-session ip=${clientIp(req)}`);
    ikkeFundetSide(res);
    return;
  }

  const opgave = hentItem(rad.user_id, rad.task_id);
  if (!opgave) { ikkeFundetSide(res); return; }

  const kigger = /prefetch|preview|prerender/i.test(
    String(req.headers['sec-purpose'] || req.headers.purpose || req.headers['x-purpose'] || ''));

  const koerende = koerendePost(rad.user_id);
  const koererDenne = koerende && koerende.taskId === rad.task_id;

  if (req.method === 'HEAD' || kigger) {
    sendHtml(res, 200, startSide(rad.user_id, rad.task_id, !!koererDenne,
      koererDenne ? 'The timer is running.' : 'Open this link to start the timer.'));
    return;
  }

  // POST = stop-knappen. GET = linket, som toggler (eller kun starter).
  if (req.method === 'POST' || (koererDenne && rad.mode === 'toggle')) {
    const post = stopTimer(rad.user_id);
    audit('startlink-stop', rad.task_id, clientIp(req));
    const minutter = post ? beregnFor(rad.user_id).varighed(post) : 0;
    sendHtml(res, 200, startSide(rad.user_id, rad.task_id, false,
      `Stopped after ${beregn.formatVarighed(minutter)}.`));
    return;
  }

  const r = startTimer(rad.user_id, rad.task_id, 'link');
  audit('startlink-start', rad.task_id, clientIp(req));
  sendHtml(res, 200, startSide(rad.user_id, rad.task_id, true,
    r.stopped ? 'Started — the timer that was running has been stopped.' : 'The timer is running.'));
}

/** Adressen, links skal skrives med. Udledes PR. REQUEST bag proxyen. */
function basisUrl(req) {
  const foerste = (v) => String(v || '').split(',')[0].trim();
  const vaert = foerste(req.headers['x-forwarded-host']) || foerste(req.headers.host) || 'localhost';
  const proto = foerste(req.headers['x-forwarded-proto']) || 'http';
  return `${proto}://${vaert}`;
}

/* ---------------------------------------------------------- passkeys */

function hentCredentials(userId) {
  return db.prepare(`
    SELECT id, name, alg, sign_count, created_at, last_used_at
      FROM credentials WHERE user_id = ? ORDER BY created_at`).all(userId);
}

function findCredential(id) {
  return db.prepare('SELECT * FROM credentials WHERE id = ?').get(String(id || ''));
}

const webauthn = require('./webauthn.js').opret({ appName: APP_NAME, hentCredentials, findCredential });

/**
 * Passkeys kraever et secure context. Panelet tilgaas paa IP:port over http,
 * hvor WebAuthn slet ikke findes - derfor maa de ALDRIG erstatte kodeordet,
 * og derfor svarer vi med en forklaring i stedet for en kryptisk fejl.
 */
function passkeySpaerre(req) {
  if (isHttps(req)) return null;
  const v = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
  if (v === 'localhost' || v === '127.0.0.1') return null;
  return 'Passkeys need a secure connection (https). Sign in with your password here — '
    + 'that always works, and it is why tovo never lets a passkey replace it.';
}

/* --------------------------------------------------------------- ruter */

const ROUTES = {
  'GET /api/public-config': (req, res) => {
    sendJson(res, 200, {
      appName: APP_NAME,
      // Den version, SERVEREN udleverer. Stemmer den ikke med den, browseren
      // koerer, sidder der en gammel app.js i cachen - og det skal brugeren
      // vide frem for at lede efter en funktion, der ikke er indlaest.
      version: Number(APP_VERSION_FIL),
      needsSetup: userCount() === 0,
      // Skjuler ogsaa selve registreringslinket paa login-siden (§3).
      allowRegistration: tilladRegistrering(),
      secureContext: isHttps(req),
      dev: DEV,
      passkeys: !passkeySpaerre(req),
      hasPasskeys: db.prepare('SELECT COUNT(*) AS n FROM credentials').get().n > 0,
    });
  },

  'GET /api/me': (req, res) => {
    const user = sessionUser(req);
    sendJson(res, 200, user ? { user } : { user: null });
  },

  'POST /api/register': async (req, res) => {
    const ip = clientIp(req);
    if (!tilladRegistrering()) {
      logSecurity(`registrering-afvist ip=${ip}`);
      apiFejl(res, 403, 'registration_closed', 'Sign-up is closed on this server.');
      return;
    }
    if (!rateAllow(`register:${ip}`, 10, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many attempts — try again later.');
      return;
    }
    const body = await readJsonBody(req);
    const username = str(body.username, 64).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (username.length < 2) { apiFejl(res, 400, 'bad_username', 'The username is too short.'); return; }
    if (password.length < 8) { apiFejl(res, 400, 'bad_password', 'The password must be at least 8 characters.'); return; }
    // Sammenlign med lower() - ellers er "Andreas" og "andreas" to konti.
    if (db.prepare('SELECT 1 FROM users WHERE lower(username) = ?').get(username)) {
      apiFejl(res, 409, 'username_taken', 'That username is taken.');
      return;
    }

    // Foerste bruger bliver admin. Admin driver appen - han ser ikke andres data.
    const erFoerste = userCount() === 0;
    const id = newId();
    db.prepare('INSERT INTO users (id, username, password, is_admin, created_at) VALUES (?,?,?,?,?)')
      .run(id, username, hashPassword(password), erFoerste ? 1 : 0, now());
    audit('bruger-oprettet', username, erFoerste ? 'admin' : null);
    const token = createSession(id);
    sendJson(res, 200, { user: { id, username, isAdmin: erFoerste } },
      { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
  },

  'POST /api/login': async (req, res) => {
    const body = await readJsonBody(req);
    const username = str(body.username, 64).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const ip = clientIp(req);
    const bucket = `login:${ip}:${username}`;
    if (!rateAllow(bucket, 15, 900)) {
      logSecurity(`login-spaerret ip=${ip}`);
      apiFejl(res, 429, 'rate_limited', 'Too many attempts — try again in a moment.');
      return;
    }
    const row = db.prepare('SELECT id, username, password, is_admin FROM users WHERE lower(username) = ?')
      .get(username);
    if (!row || !verifyPassword(password, row.password)) {
      logSecurity(`login-fejl ip=${ip}`);
      audit('login-fejl', username, ip);
      apiFejl(res, 401, 'bad_credentials', 'Wrong username or password.');
      return;
    }
    rateClear(bucket);
    audit('login', row.username, ip);
    const token = createSession(row.id);
    sendJson(res, 200, { user: { id: row.id, username: row.username, isAdmin: !!row.is_admin } },
      { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
  },

  'POST /api/logout': (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  },

  'POST /api/password': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const current = typeof body.current === 'string' ? body.current : '';
    const next = typeof body.next === 'string' ? body.next : '';
    if (next.length < 8) { apiFejl(res, 400, 'bad_password', 'The password must be at least 8 characters.'); return; }
    const row = db.prepare('SELECT password FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(current, row.password)) {
      logSecurity(`kodeordsskift-fejl ip=${clientIp(req)}`);
      apiFejl(res, 401, 'bad_credentials', 'The current password does not match.');
      return;
    }
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(next), user.id);
    // Alle andre sessioner droppes - et kodeordsskift skal kunne lukke en tyv ude.
    const keep = parseCookies(req.headers.cookie)[SESSION_COOKIE] || '';
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(user.id, keep);
    audit('kodeord-skiftet', user.username, clientIp(req));
    sendJson(res, 200, { ok: true });
  },

  /* --- passkeys --------------------------------------------------- */

  'POST /api/webauthn/register/options': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    await readJsonBody(req);
    const spaerre = passkeySpaerre(req);
    if (spaerre) { apiFejl(res, 400, 'insecure_context', spaerre); return; }
    sendJson(res, 200, webauthn.registerOptions(req, user));
  },

  'POST /api/webauthn/register/verify': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    try {
      const c = webauthn.registerVerify(req, user, body);
      db.prepare(`INSERT OR REPLACE INTO credentials
                  (id, user_id, name, public_key, alg, sign_count, created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(c.id, user.id, str(body.name, 60) || 'Passkey', c.publicKey, c.alg, c.signCount, now());
      audit('passkey-oprettet', user.username, clientIp(req));
      sendJson(res, 200, { credentials: hentCredentials(user.id) });
    } catch (err) {
      logSecurity(`passkey-registrering-fejl ip=${clientIp(req)}`);
      apiFejl(res, 400, 'passkey_failed', err.message);
    }
  },

  // Login kraever IKKE en session - det er hele pointen.
  'POST /api/webauthn/login/options': async (req, res) => {
    await readJsonBody(req);
    const spaerre = passkeySpaerre(req);
    if (spaerre) { apiFejl(res, 400, 'insecure_context', spaerre); return; }
    sendJson(res, 200, webauthn.loginOptions(req));
  },

  'POST /api/webauthn/login/verify': async (req, res) => {
    const body = await readJsonBody(req);
    const ip = clientIp(req);
    if (!rateAllow(`passkey:${ip}`, 20, 900)) {
      logSecurity(`login-spaerret ip=${ip}`);
      apiFejl(res, 429, 'rate_limited', 'Too many attempts — try again shortly.');
      return;
    }
    try {
      const { credential, signCount } = webauthn.loginVerify(req, body);
      const bruger = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?')
        .get(credential.user_id);
      if (!bruger) throw new Error('unknown user');
      db.prepare('UPDATE credentials SET sign_count = ?, last_used_at = ? WHERE id = ?')
        .run(signCount, now(), credential.id);
      audit('login-passkey', bruger.username, ip);
      const token = createSession(bruger.id);
      sendJson(res, 200, { user: { id: bruger.id, username: bruger.username, isAdmin: !!bruger.is_admin } },
        { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
    } catch (err) {
      logSecurity(`login-fejl ip=${ip}`);
      apiFejl(res, 401, 'passkey_failed', err.message);
    }
  },

  'GET /api/v1/passkeys': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, { credentials: hentCredentials(user.id), blocked: passkeySpaerre(req) });
  },

  /* --- data ------------------------------------------------------- */

  // Ét kald der giver skallen alt, den skal bruge for at tegne sig.
  'GET /api/v1/state': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const opgaver = hentItems(auth.user.id, { kind: 'task' });
    const projekter = hentItems(auth.user.id, { kind: 'project' });
    sendJson(res, 200, {
      user: auth.user,
      today: iDag(),
      settings: hentSettings(auth.user.id),
      global: { allowRegistration: tilladRegistrering() },
      // Projekter og tags er smaa og bruges paa hver eneste side - de foelger
      // med i ét kald, saa skallen kan tegne sig uden at hente tre gange.
      projects: projekter.filter((p) => !p.archivedAt),
      archivedProjects: projekter.filter((p) => p.archivedAt).length,
      tags: hentItems(auth.user.id, { kind: 'tag' }),
      counts: {
        tasks: opgaver.filter((t) => t.status !== 'done').length,
        done: opgaver.filter((t) => t.status === 'done').length,
        projects: projekter.filter((p) => !p.archivedAt).length,
      },
      // Den koerende timer skal kunne ses i ENHVER visning - derfor foelger
      // den med i det kald, skallen alligevel laver.
      timer: timerStatus(auth.user.id),
      todayMinutes: beregnFor(auth.user.id).sumPrDag(dagStart(iDag()), dagStart(iDag()) + 86400).get(iDag()) || 0,
    });
  },

  /* Fangst. Hele linjen ind - ikke felter hver for sig. Samme vej for
     webappen, for et start-link og senere for MCP. */
  'POST /api/v1/capture': async (req, res) => {
    const auth = godkend(req, res, 'capture');
    if (!auth) return;
    // tilgivende: en klient med en noegle maa sende ren tekst uden
    // Content-Type. Kravet om JSON er en CSRF-barriere, og CSRF forudsaetter
    // en ambient legitimation - en Bearer-noegle sendes aktivt (doda F2).
    const body = await readJsonBody(req, auth.viaToken);
    const tekst = typeof body.text === 'string' ? body.text : '';
    const r = fangst(auth.user.id, tekst, {
      projectId: str(body.projectId, 64) || null,
      sectionId: str(body.sectionId, 64) || null,
    });
    sendJson(res, 200, r);
  },

  /* --- timeren ---------------------------------------------------- */

  'POST /api/v1/timer/start': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    const r = startTimer(auth.user.id, str(body.taskId, 64), auth.viaToken ? 'mcp' : 'timer');
    sendJson(res, 200, { timer: timerStatus(auth.user.id), stopped: r.stopped });
  },

  'POST /api/v1/timer/stop': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    await readJsonBody(req, auth.viaToken);
    const post = stopTimer(auth.user.id);
    if (!post) { apiFejl(res, 404, 'no_timer', 'No timer is running.'); return; }
    sendJson(res, 200, { entry: post });
  },

  'GET /api/v1/timer/current': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    sendJson(res, 200, { timer: timerStatus(auth.user.id) });
  },

  /* --- tidsposter -------------------------------------------------- */

  'GET /api/v1/entries': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const fra = ctx.query.get('from');
    const til = ctx.query.get('to');
    sendJson(res, 200, {
      entries: hentPoster(auth.user.id, {
        taskId: ctx.query.get('task') || null,
        fra: fra ? dagStart(fra) : undefined,
        til: til ? dagStart(til) + 86400 : undefined,
      }),
      rounding: beregnFor(auth.user.id).afrunding(),
    });
  },

  /* Manuel registrering paa en VILKAARLIG dato - ligevaerdig med timeren,
     ikke en noedloesning. Feltet forstaar baade "9-11.30" og "1,5t". */
  'POST /api/v1/entries': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    /*
     * To veje ind, med vilje.
     *
     * MENNESKER skriver en dato og "9-11.30" eller "1,5t". En FORTRYDELSE
     * (og senere MCP) sender de praecise tidspunkter tilbage: en post, der
     * genskabes ud fra "HH:MM", taber sine sekunder, og saa er fortrydelsen
     * ikke en fortrydelse. Testen fangede praecis det - 26 sekunders
     * forskel paa en post, der skulle vaere den samme.
     */
    let plads;
    if (Number.isFinite(body.startedAt) && Number.isFinite(body.stoppedAt)) {
      plads = { startedAt: body.startedAt, stoppedAt: body.stoppedAt };
    } else {
      const isoDato = dato(body.date) || iDag();
      const raa = typeof body.text === 'string' ? body.text : '';
      const tidsrum = beregn.parseTidsrum(raa, isoDato);
      if (!tidsrum) {
        apiFejl(res, 400, 'bad_duration',
          `I did not understand "${raa}". Try 9-11.30, 1,5t, 90m or 1t30m.`);
        return;
      }
      // Placeringen af en ren varighed regnes i beregn.js - ogsaa den. En
      // "lille" udregning i en rute er stadig en udregning uden for modulet.
      const dagens = hentPoster(auth.user.id, { fra: dagStart(isoDato), til: dagStart(isoDato) + 86400 });
      plads = tidsrum.fra
        ? { startedAt: beregn.tidspunkt(isoDato, tidsrum.fra), stoppedAt: beregn.tidspunkt(isoDato, tidsrum.til) }
        : beregn.placerVarighed(dagens, isoDato, tidsrum.minutter);
    }
    sendJson(res, 200, {
      entry: gemPost(auth.user.id, {
        // Et id og en kilde MAA sendes med. Det er fortrydelsen, der har brug
        // for det: en slettet timer-post skal komme tilbage som en timer-post,
        // ellers lyver rapportens kilde-maerkning efter en fortrudt sletning.
        id: str(body.id, 64) || null,
        taskId: body.taskId,
        startedAt: plads.startedAt,
        stoppedAt: plads.stoppedAt,
        note: body.note,
        source: auth.viaToken ? 'mcp' : (KILDER.has(body.source) ? body.source : 'manuel'),
      }),
    });
  },

  /* --- ugerapport --------------------------------------------------- */

  'GET /api/v1/report': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const fraIso = dato(ctx.query.get('from')) || ugeStart(iDag());
    const tilIso = dato(ctx.query.get('to')) || ugeSlut(fraIso);
    const b = beregnFor(auth.user.id);
    sendJson(res, 200, {
      from: fraIso,
      to: tilIso,
      // Halvaabent interval: til-datoen er MED i rapporten, saa "til" er
      // dagen efter i sekunder. To naboperioder taeller hverken en post to
      // gange eller taber den.
      report: b.ugerapport(dagStart(fraIso), dagStart(tilIso) + 86400),
      // Forrige periode af samme laengde - sammenligningen er en af de to
      // ting, rapporten er til for.
      previous: (() => {
        const dage = Math.round((dagStart(tilIso) + 86400 - dagStart(fraIso)) / 86400);
        const slut = dagStart(fraIso);
        return b.ugerapport(slut - dage * 86400, slut);
      })(),
      rounding: b.afrunding(),
    });
  },

  'GET /api/v1/search': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    sendJson(res, 200, soeg(auth.user.id, ctx.query.get('q'), {
      projectId: ctx.query.get('project') || null,
    }));
  },

  'GET /api/v1/items': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const kind = ctx.query.get('kind');
    if (kind && !KINDS.has(kind)) { apiFejl(res, 400, 'unknown_kind', `Unknown kind "${kind}".`); return; }
    sendJson(res, 200, { items: hentItems(auth.user.id, { kind: kind || null }) });
  },

  'POST /api/v1/items': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    sendJson(res, 200, { item: gemItem(auth.user.id, body) });
  },

  'POST /api/v1/items/bulk': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken, true);
    const liste = Array.isArray(body) ? body : body.items;
    sendJson(res, 200, { items: saveBulk(auth.user.id, liste) });
  },

  'GET /api/v1/settings': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    // Brugerens EGNE indstillinger. Der ligger endnu ingen hemmeligheder her,
    // men et "hent alt i tabellen" er en tidsindstillet laekage (doda v16):
    // scope-filteret betyder, at en anden brugers noegler aldrig kan komme med.
    sendJson(res, 200, { settings: hentSettings(auth.user.id), global: { allowRegistration: tilladRegistrering() } });
  },

  'POST /api/v1/settings': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    for (const [key, value] of Object.entries(body)) {
      if (GLOBALE_SETTINGS.has(key)) {
        if (!auth.user.isAdmin) { apiFejl(res, 403, 'admin_only', `Only the administrator can set "${key}".`); return; }
        setSetting('*', key, value ? '1' : '0');
      } else {
        setSetting(auth.user.id, str(key, 64), String(value).slice(0, 2000));
      }
    }
    sendJson(res, 200, { settings: hentSettings(auth.user.id), global: { allowRegistration: tilladRegistrering() } });
  },
};

/* Ruter med parametre. Prefikset er altid /api/v1/ paa dataruterne. */
const MOENSTRE = [
  {
    metode: 'GET', re: /^\/api\/v1\/items\/([0-9a-f-]{8,64})$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      const item = hentItem(auth.user.id, ctx.params[0]);
      // En anden brugers element svarer 404 - ikke 403. 403 ville bekraefte,
      // at id'et findes.
      if (!item) { apiFejl(res, 404, 'not_found', 'No such item.'); return; }
      const rad = item.kind === 'task' ? hentStartTokenFor(auth.user.id, item.id) : null;
      sendJson(res, 200, {
        item,
        link: rad ? { token: rad.token, mode: rad.mode, url: `${basisUrl(req)}/s/${rad.token}` } : null,
      });
    },
  },
  {
    metode: 'PATCH', re: /^\/api\/v1\/items\/([0-9a-f-]{8,64})$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const body = await readJsonBody(req, auth.viaToken);
      const item = hentItem(auth.user.id, ctx.params[0]);
      if (!item) { apiFejl(res, 404, 'not_found', 'No such item.'); return; }
      const felter = Object.assign({}, body);
      delete felter.id;
      delete felter.kind;
      sendJson(res, 200, { item: gemItem(auth.user.id, Object.assign({}, item, felter)) });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/items\/([0-9a-f-]{8,64})$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      if (!sletItem(auth.user.id, ctx.params[0])) {
        apiFejl(res, 404, 'not_found', 'No such item.');
        return;
      }
      sendJson(res, 200, { ok: true });
    },
  },
  {
    // Ét kald med alt, projektsiden skal bruge. Seks trin med hver sin
    // forespoergsel goer bladring langsom (doda F8).
    metode: 'GET', re: /^\/api\/v1\/projects\/([0-9a-f-]{8,64})$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      const projekt = hentItem(auth.user.id, ctx.params[0]);
      if (!projekt || projekt.kind !== 'project') {
        apiFejl(res, 404, 'not_found', 'No such project.');
        return;
      }
      const b = beregnFor(auth.user.id);
      const opgaver = hentItems(auth.user.id, { kind: 'task' })
        .filter((t) => t.projectId === projekt.id);
      sendJson(res, 200, {
        project: projekt,
        tasks: opgaver,
        // Tallene kommer fra beregn.js - de samme funktioner, frontenden og
        // senere MCP kalder. To udregninger ville vaere to sandheder.
        rollup: b.rollupProjekt(projekt.id),
        spent: Object.fromEntries(opgaver.map((t) => [t.id, b.forbrugPaaOpgave(t.id)])),
      });
    },
  },
  {
    metode: 'GET', re: /^\/api\/v1\/tasks\/([0-9a-f-]{8,64})\/comments$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      // Findes opgaven ikke (eller er den en andens), er der ingen kommentarer
      // at tale om - og svaret maa ikke roebe forskellen.
      if (!hentItem(auth.user.id, ctx.params[0])) {
        apiFejl(res, 404, 'not_found', 'No such task.');
        return;
      }
      const alle = hentItems(auth.user.id, { kind: 'comment' })
        .filter((c) => c.taskId === ctx.params[0])
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      sendJson(res, 200, { comments: alle });
    },
  },
  {
    metode: 'POST', re: /^\/api\/v1\/tasks\/([0-9a-f-]{8,64})\/comments$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const body = await readJsonBody(req, auth.viaToken);
      if (!hentItem(auth.user.id, ctx.params[0])) {
        apiFejl(res, 404, 'not_found', 'No such task.');
        return;
      }
      const tekst = str(body.text, 20000);
      if (!tekst) { apiFejl(res, 400, 'empty_comment', 'A comment needs some text.'); return; }
      sendJson(res, 200, {
        comment: gemItem(auth.user.id, { kind: 'comment', taskId: ctx.params[0], text: tekst }),
      });
    },
  },
  {
    // Afslutning er sin egen rute, fordi den goer TO ting: saetter status og
    // stempler completedAt. Ligger stemplet i kaldsstedet, bliver det glemt
    // det sted, der ikke er webappen.
    metode: 'POST', re: /^\/api\/v1\/tasks\/([0-9a-f-]{8,64})\/complete$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const body = await readJsonBody(req, auth.viaToken);
      const item = hentItem(auth.user.id, ctx.params[0]);
      if (!item || item.kind !== 'task') { apiFejl(res, 404, 'not_found', 'No such task.'); return; }
      const luk = body.done !== false;
      sendJson(res, 200, {
        item: gemItem(auth.user.id, Object.assign({}, item, {
          status: luk ? 'done' : 'open',
          completedAt: luk ? now() : null,
        })),
      });
    },
  },
  {
    // Tokenet vises KUN til den indloggede ejer. Det er selve adressen, der er
    // hemmeligheden, saa den maa ikke kunne hentes af nogen anden.
    metode: 'POST', re: /^\/api\/v1\/tasks\/([0-9a-f-]{8,64})\/link$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const body = await readJsonBody(req, auth.viaToken);
      const rad = opretStartToken(auth.user.id, ctx.params[0], body.mode);
      sendJson(res, 200, {
        link: { token: rad.token, mode: rad.mode, url: `${basisUrl(req)}/s/${rad.token}` },
      });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/tasks\/([0-9a-f-]{8,64})\/link$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const r = db.prepare(`UPDATE start_tokens SET revoked_at = ?
                             WHERE task_id = ? AND user_id = ? AND revoked_at IS NULL`)
        .run(now(), ctx.params[0], auth.user.id);
      if (!r.changes) { apiFejl(res, 404, 'not_found', 'There is no link for that task.'); return; }
      audit('startlink-tilbagekaldt', ctx.params[0], clientIp(req));
      sendJson(res, 200, { ok: true });
    },
  },
  {
    /*
     * Bulk: links for HELE projektet som en markdown-liste, klar til at
     * klistre i OneNote. Én knap er forskellen paa, om funktionen bliver
     * brugt paa et projekt med tredive opgaver eller ej.
     */
    metode: 'POST', re: /^\/api\/v1\/projects\/([0-9a-f-]{8,64})\/links$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      await readJsonBody(req, auth.viaToken);
      const projekt = hentItem(auth.user.id, ctx.params[0]);
      if (!projekt || projekt.kind !== 'project') {
        apiFejl(res, 404, 'not_found', 'No such project.');
        return;
      }
      const opgaver = hentItems(auth.user.id, { kind: 'task' })
        .filter((t) => t.projectId === projekt.id && t.status !== 'done')
        .sort((a, b) => (a.position || 0) - (b.position || 0));
      const base = basisUrl(req);
      const links = opgaver.map((t) => {
        const rad = opretStartToken(auth.user.id, t.id, 'toggle');
        return { taskId: t.id, title: t.title, url: `${base}/s/${rad.token}` };
      });
      sendJson(res, 200, {
        links,
        markdown: links.map((l) => `- [${l.title}](${l.url})`).join('\n'),
      });
    },
  },
  {
    metode: 'PATCH', re: /^\/api\/v1\/entries\/([0-9a-f-]{8,64})$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const body = await readJsonBody(req, auth.viaToken);
      const post = hentPost(auth.user.id, ctx.params[0]);
      if (!post) { apiFejl(res, 404, 'not_found', 'No such time entry.'); return; }
      // Enhver post kan rettes - ogsaa en, timeren har lavet. Kilden bevares,
      // saa en rapport stadig kan fortaelle, hvor tallet kom fra.
      sendJson(res, 200, {
        entry: gemPost(auth.user.id, {
          id: post.id,
          taskId: body.taskId !== undefined ? body.taskId : post.taskId,
          startedAt: body.startedAt !== undefined ? body.startedAt : post.startedAt,
          stoppedAt: body.stoppedAt !== undefined ? body.stoppedAt : post.stoppedAt,
          note: body.note !== undefined ? body.note : post.note,
          source: post.source,
        }),
      });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/entries\/([0-9a-f-]{8,64})$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      // Posten sendes MED tilbage, saa frontenden kan tilbyde en fortrydelse
      // uden foerst at have gemt en kopi et sted, den kan komme ud af trit.
      const post = hentPost(auth.user.id, ctx.params[0]);
      if (!post || !sletPost(auth.user.id, ctx.params[0])) {
        apiFejl(res, 404, 'not_found', 'No such time entry.');
        return;
      }
      sendJson(res, 200, { deleted: post });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/passkeys\/(.{1,256})$/,
    kald: (req, res, ctx) => {
      const user = requireUser(req, res);
      if (!user) return;
      const r = db.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?')
        .run(decodeURIComponent(ctx.params[0]), user.id);
      if (!r.changes) { apiFejl(res, 404, 'not_found', 'No such passkey.'); return; }
      audit('passkey-fjernet', user.username, clientIp(req));
      sendJson(res, 200, { credentials: hentCredentials(user.id) });
    },
  },
];

function iDag() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Mandagen i den uge, datoen ligger i. Ugen begynder mandag (ISO). */
function ugeStart(isoDato) {
  const [aa, mm, dd] = String(isoDato).split('-').map(Number);
  const d = new Date(aa, mm - 1, dd);
  const ugedag = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - (ugedag - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ugeSlut(isoMandag) {
  const [aa, mm, dd] = String(isoMandag).split('-').map(Number);
  const d = new Date(aa, mm - 1, dd + 6);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Midnat paa en dato i LOKAL tid. Aldrig UTC - ellers flytter en dag sig. */
function dagStart(isoDato) {
  const [aa, mm, dd] = String(isoDato).split('-').map(Number);
  return Math.floor(new Date(aa, mm - 1, dd, 0, 0, 0).getTime() / 1000);
}

function findRute(metode, sti) {
  const direkte = ROUTES[`${metode} ${sti}`];
  if (direkte) return { kald: direkte, params: [] };
  for (const m of MOENSTRE) {
    if (m.metode !== metode) continue;
    const fund = sti.match(m.re);
    if (fund) return { kald: m.kald, params: fund.slice(1) };
  }
  return null;
}

/* ------------------------------------------------------------ server */

const server = http.createServer(async (req, res) => {
  let urlPath;
  let query;
  try {
    const u = new URL(req.url, 'http://localhost');
    urlPath = decodeURIComponent(u.pathname);
    query = u.searchParams;
  } catch {
    apiFejl(res, 400, 'bad_request', 'Bad address.');
    return;
  }

  try {
    // Start-links ligger paa /s/ - kort nok til at staa i en OneNote-side.
    // De har hverken session eller cookie og maa aldrig scanne datasaettet.
    const start = urlPath.match(/^\/s\/([A-Za-z0-9_-]{16,64})$/);
    if (start) {
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
        apiFejl(res, 405, 'method_not_allowed', 'That method is not allowed here.');
        return;
      }
      haandterStartLink(req, res, start[1]);
      return;
    }

    if (urlPath.startsWith('/api/')) {
      securityHeaders(res);
      const rute = findRute(req.method, urlPath);
      if (!rute) { apiFejl(res, 404, 'unknown_endpoint', 'Unknown endpoint.'); return; }
      await rute.kald(req, res, { query, params: rute.params });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      apiFejl(res, 405, 'method_not_allowed', 'That method is not allowed here.');
      return;
    }
    serveStatic(req, res, urlPath);
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    if (status >= 500) logError(`${req.method} ${urlPath}: ${err && err.stack ? err.stack : err}`);
    if (!res.headersSent) {
      // Samme form som resten af API'et. En 500 roeber ALDRIG sin egen besked -
      // den staar i serverloggen.
      const KODER = { 400: 'bad_request', 404: 'not_found', 413: 'too_large', 415: 'wrong_content_type' };
      apiFejl(res, status, KODER[status] || 'server_error',
        status >= 500 ? 'Something went wrong on the server.' : (err && err.message) || 'Bad request.');
    } else res.end();
  }
});

/* --------------------------------------------------------- oprydning */

function sweep() {
  try {
    const t = now();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(t);
    db.prepare('DELETE FROM rate WHERE reset_at <= ?').run(t);
    db.prepare('DELETE FROM audit WHERE at < ?').run(t - 180 * 86400);
    db.prepare('DELETE FROM tokens WHERE expires_at IS NOT NULL AND expires_at < ?').run(t - 30 * 86400);
  } catch (err) {
    logError(`oprydning fejlede: ${err.message}`);
  }
}

process.on('SIGTERM', () => {
  log('lukker ned');
  server.close(() => { try { db.close(); } catch { /* ligegyldigt ved nedlukning */ } process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
});

process.on('uncaughtException', (err) => {
  logError(`ufanget undtagelse: ${err && err.stack ? err.stack : err}`);
});

migrate();
computeInlineHash();
sweep();
setInterval(sweep, 6 * 3600 * 1000).unref();

server.listen(BIND_PORT, () => {
  // Den port, der FAKTISK blev bundet - ikke variablen. At skrive sit eget
  // oenske tilbage beviser ingenting; netop dét gjorde, at dodas portfejl ikke
  // kunne ses i den linje, serveren selv skrev. Med BIND_PORT=0 er det ogsaa
  // det eneste sted, portnummeret findes.
  log(`tovo lytter paa port ${server.address().port} (data: ${DATA_DIR})`);
});
