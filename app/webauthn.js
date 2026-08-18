'use strict';
/*
 * tovo - passkeys (WebAuthn), handskrevet uden pakker.
 *
 * Samme stak som Andreas' oevrige runer (RUNE-ERFARINGER §3):
 *   CBOR-dekoder -> attestationObject/authData -> COSE->JWK -> crypto.verify
 *
 * To ting er vaerd at vide, foer man laeser videre:
 *
 *  - **Attestation ignoreres bevidst** (`attestation: "none"`). Vi vil vide, at
 *    brugeren har noeglen - ikke hvilken fabrikant der lavede den.
 *  - **Node accepterer DER-signaturer for EC**, sa der er ingen grund til at
 *    pille r||s fra hinanden. Det er den fejl, folk bruger en eftermiddag paa.
 */

const crypto = require('node:crypto');

/* ---------------------------------------------------------------- cbor */

/** Minimal CBOR-dekoder - kun de typer, WebAuthn faktisk bruger. */
function cbor(buf, pos = 0) {
  const b = buf[pos];
  const major = b >> 5;
  const info = b & 31;
  pos++;

  let vaerdi = info;
  if (info === 24) { vaerdi = buf[pos]; pos += 1; }
  else if (info === 25) { vaerdi = buf.readUInt16BE(pos); pos += 2; }
  else if (info === 26) { vaerdi = buf.readUInt32BE(pos); pos += 4; }
  else if (info === 27) { vaerdi = Number(buf.readBigUInt64BE(pos)); pos += 8; }

  switch (major) {
    case 0: return [vaerdi, pos];
    case 1: return [-1 - vaerdi, pos];
    case 2: return [buf.subarray(pos, pos + vaerdi), pos + vaerdi];
    case 3: return [buf.subarray(pos, pos + vaerdi).toString('utf8'), pos + vaerdi];
    case 4: {
      const ud = [];
      for (let i = 0; i < vaerdi; i++) { const [v, p] = cbor(buf, pos); ud.push(v); pos = p; }
      return [ud, pos];
    }
    case 5: {
      const ud = new Map();
      for (let i = 0; i < vaerdi; i++) {
        const [k, p1] = cbor(buf, pos);
        const [v, p2] = cbor(buf, p1);
        ud.set(k, v);
        pos = p2;
      }
      return [ud, pos];
    }
    case 7:
      if (info === 20) return [false, pos];
      if (info === 21) return [true, pos];
      if (info === 22) return [null, pos];
      return [undefined, pos];
    default:
      throw new Error(`ukendt CBOR-type ${major}`);
  }
}

/* ------------------------------------------------------------ noegler */

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/**
 * COSE -> JWK -> et rigtigt KeyObject.
 * Understoetter ES256 (EC2 P-256) og RS256 - det er dét, alt hardware bruger.
 */
function coseTilKey(cose) {
  const kty = cose.get(1);
  const alg = cose.get(3);

  if (kty === 2) {                                   // EC2
    if (alg !== -7) throw new Error(`uunderstoettet EC-algoritme ${alg}`);
    if (cose.get(-1) !== 1) throw new Error('kun P-256 understoettes');
    return {
      key: crypto.createPublicKey({
        key: { kty: 'EC', crv: 'P-256', x: b64u(cose.get(-2)), y: b64u(cose.get(-3)) },
        format: 'jwk',
      }),
      alg: 'ES256',
    };
  }
  if (kty === 3) {                                   // RSA
    if (alg !== -257) throw new Error(`uunderstoettet RSA-algoritme ${alg}`);
    return {
      key: crypto.createPublicKey({
        key: { kty: 'RSA', n: b64u(cose.get(-1)), e: b64u(cose.get(-2)) },
        format: 'jwk',
      }),
      alg: 'RS256',
    };
  }
  throw new Error(`ukendt noegletype ${kty}`);
}

/**
 * authData: rpIdHash(32) | flags(1) | signCount(4) | [aaguid(16) |
 *           credIdLen(2) | credId | COSE-noegle]
 */
function laesAuthData(buf) {
  const ud = {
    rpIdHash: buf.subarray(0, 32),
    flags: buf[32],
    signCount: buf.readUInt32BE(33),
  };
  ud.userPresent = !!(ud.flags & 0x01);
  ud.userVerified = !!(ud.flags & 0x04);
  if (ud.flags & 0x40) {                             // attested credential data
    const credLen = buf.readUInt16BE(53);
    ud.credId = buf.subarray(55, 55 + credLen);
    ud.cose = cbor(buf, 55 + credLen)[0];
  }
  return ud;
}

/* ----------------------------------------------------------- oprindelse */

/**
 * rpId og origin udledes PR. REQUEST.
 *
 * Det er dét, der gor, at passkeys virker bag Cloudflare-tunnelen uden en
 * eneste indstilling. Headeren kan vaere en liste ("a, b") bag to proxyer -
 * tag altid foerste led (RUNE-ERFARINGER §3).
 */
function oprindelse(req) {
  const foerste = (v) => String(v || '').split(',')[0].trim();
  const vaert = foerste(req.headers['x-forwarded-host']) || foerste(req.headers.host) || '';
  const proto = foerste(req.headers['x-forwarded-proto']) || 'http';
  return { rpId: vaert.split(':')[0], origin: `${proto}://${vaert}` };
}

/* ------------------------------------------------------------- modulet */

function opret(srv) {
  // Challenges lever kun i hukommelsen og kun i fem minutter. De behoever
  // ikke overleve en genstart - sa proever brugeren bare igen.
  const challenges = new Map();

  function nyChallenge(slags, data) {
    const id = crypto.randomBytes(16).toString('hex');
    const c = crypto.randomBytes(32);
    challenges.set(id, { c, slags, data, udloeber: Date.now() + 300000 });
    if (challenges.size > 200) {
      for (const [k, v] of challenges) if (v.udloeber < Date.now()) challenges.delete(k);
    }
    return { challengeId: id, challenge: c.toString('base64url') };
  }

  function taChallenge(id, slags) {
    const c = challenges.get(id);
    challenges.delete(id);                  // altid engangsbrug
    if (!c || c.slags !== slags || c.udloeber < Date.now()) return null;
    return c;
  }

  /** Faelles kontrol af clientDataJSON for bade registrering og login. */
  function tjekClientData(raa, forventetType, forventet, req) {
    const data = JSON.parse(Buffer.from(raa, 'base64url').toString('utf8'));
    if (data.type !== forventetType) throw new Error('forkert type i clientData');
    if (!crypto.timingSafeEqual(
      Buffer.from(data.challenge), Buffer.from(forventet.c.toString('base64url')))) {
      throw new Error('challenge passer ikke');
    }
    const { origin } = oprindelse(req);
    if (data.origin !== origin) throw new Error(`forkert origin: ${data.origin}`);
    return data;
  }

  return {
    oprindelse,

    /** Muligheder til navigator.credentials.create(). */
    registerOptions(req, user) {
      const { rpId } = oprindelse(req);
      const { challengeId, challenge } = nyChallenge('register', { userId: user.id });
      return {
        challengeId,
        publicKey: {
          challenge,
          rp: { id: rpId, name: srv.appName },
          user: { id: Buffer.from(user.id, 'utf8').toString('base64url'), name: user.username, displayName: user.username },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          timeout: 120000,
          attestation: 'none',
          authenticatorSelection: {
            // Discoverable credential: sa kan login ske UDEN brugernavn, og
            // login-siden roeber ikke hvilke konti der findes.
            residentKey: 'preferred',
            userVerification: 'preferred',
          },
          excludeCredentials: srv.hentCredentials(user.id).map((c) => ({ type: 'public-key', id: c.id })),
        },
      };
    },

    registerVerify(req, user, body) {
      const forventet = taChallenge(body.challengeId, 'register');
      if (!forventet) throw new Error('udloebet forespoergsel - proev igen');
      tjekClientData(body.clientDataJSON, 'webauthn.create', forventet, req);

      const att = cbor(Buffer.from(body.attestationObject, 'base64url'))[0];
      const auth = laesAuthData(att.get('authData'));
      const { rpId } = oprindelse(req);
      if (!crypto.timingSafeEqual(auth.rpIdHash, crypto.createHash('sha256').update(rpId).digest())) {
        throw new Error('noeglen hoerer til et andet domaene');
      }
      if (!auth.userPresent) throw new Error('ingen brugertilstedevaerelse');
      if (!auth.credId) throw new Error('der fulgte ingen noegle med');

      const { key, alg } = coseTilKey(auth.cose);
      return {
        id: Buffer.from(auth.credId).toString('base64url'),
        publicKey: key.export({ type: 'spki', format: 'pem' }),
        alg,
        signCount: auth.signCount,
      };
    },

    /** Muligheder til navigator.credentials.get(). Tom allowCredentials = usernameless. */
    loginOptions(req) {
      const { rpId } = oprindelse(req);
      const { challengeId, challenge } = nyChallenge('login', {});
      return {
        challengeId,
        publicKey: { challenge, rpId, timeout: 120000, userVerification: 'preferred', allowCredentials: [] },
      };
    },

    loginVerify(req, body) {
      const forventet = taChallenge(body.challengeId, 'login');
      if (!forventet) throw new Error('udloebet forespoergsel - proev igen');
      const cred = srv.findCredential(body.id);
      if (!cred) throw new Error('ukendt noegle');

      tjekClientData(body.clientDataJSON, 'webauthn.get', forventet, req);

      const authRaa = Buffer.from(body.authenticatorData, 'base64url');
      const auth = laesAuthData(authRaa);
      const { rpId } = oprindelse(req);
      if (!crypto.timingSafeEqual(auth.rpIdHash, crypto.createHash('sha256').update(rpId).digest())) {
        throw new Error('noeglen hoerer til et andet domaene');
      }
      if (!auth.userPresent) throw new Error('ingen brugertilstedevaerelse');

      // Signaturen daekker authData ‖ sha256(clientDataJSON).
      const signeret = Buffer.concat([
        authRaa,
        crypto.createHash('sha256').update(Buffer.from(body.clientDataJSON, 'base64url')).digest(),
      ]);
      const ok = crypto.verify('sha256', signeret, crypto.createPublicKey(cred.public_key),
        Buffer.from(body.signature, 'base64url'));
      if (!ok) throw new Error('signaturen holder ikke');

      // Counter-tjek: afvis KUN hvis begge taellere er > 0 og den nye ikke er
      // vokset. Mange noegler (bl.a. Apples) taeller slet ikke og sender 0.
      if (cred.sign_count > 0 && auth.signCount > 0 && auth.signCount <= cred.sign_count) {
        throw new Error('noeglen ser ud til at vaere klonet');
      }
      return { credential: cred, signCount: auth.signCount };
    },
  };
}

module.exports = { opret, oprindelse, cbor, coseTilKey, laesAuthData };
