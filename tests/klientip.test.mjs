/* Prøver af app/klientip.js - kopieres sammen med modulet. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { klientIp, erEgen, rens } = require('../app/klientip.js');

const req = (sokkel, xff) => ({ socket: { remoteAddress: sokkel }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } });

test('uden proxy: socket-adressen - og headeren ignoreres', () => {
  assert.equal(klientIp(req('203.0.113.7', '198.51.100.1')), '203.0.113.7');
});

test('en klient kan IKKE vaelge sin adresse gennem tunnelen', () => {
  // Klienten sender »1.2.3.4«; Cloudflare og tunnelen laegger deres til bagerst.
  assert.equal(klientIp(req('127.0.0.1', '1.2.3.4, 203.0.113.9')), '203.0.113.9');
  assert.equal(klientIp(req('::ffff:172.18.0.2', '1.2.3.4, 5.6.7.8, 203.0.113.9, 172.18.0.1')), '203.0.113.9');
});

test('skiftende forfalskning giver samme noegle', () => {
  const a = klientIp(req('10.0.0.5', '9.9.9.1, 203.0.113.9'));
  const b = klientIp(req('10.0.0.5', '9.9.9.2, 203.0.113.9'));
  assert.equal(a, b);
});

test('Cloudflare-kanten springes over', () => {
  // Cloudflare foran Nginx Proxy Manager: nginx ser kanten, ikke klienten.
  assert.equal(klientIp(req('192.168.1.10', '203.0.113.9, 162.158.1.1')), '203.0.113.9');
  assert.equal(klientIp(req('192.168.1.10', '2001:db8::5, 2606:4700::1')), '2001:db8::5');
});

test('hjemmenettet gennem en lokal proxy: den naermeste proxys syn', () => {
  assert.equal(klientIp(req('172.17.0.1', '192.168.1.50')), '192.168.1.50');
});

test('ingen header bag en proxy: socket-adressen', () => {
  assert.equal(klientIp(req('127.0.0.1')), '127.0.0.1');
});

test('vroevl og porte i headeren', () => {
  assert.equal(klientIp(req('127.0.0.1', 'unknown, 203.0.113.9:4431, <script>')), '203.0.113.9');
  assert.equal(klientIp(req('127.0.0.1', ['1.1.1.1', '203.0.113.9'])), '203.0.113.9');
  assert.equal(klientIp({ socket: {}, headers: {} }), 'ukendt');
});

test('hjaelperne', () => {
  assert.equal(rens('::ffff:10.1.2.3'), '10.1.2.3');
  assert.equal(rens('[2001:db8::1]:80'), '2001:db8::1');
  assert.equal(rens('ikke-en-ip'), '');
  for (const ip of ['127.0.0.1', '10.1.1.1', '172.31.0.1', '192.168.0.1', '::1', 'fd00::1', '104.16.0.1'])
    assert.equal(erEgen(ip), true, ip);
  for (const ip of ['203.0.113.1', '8.8.8.8', '172.32.0.1', '2001:db8::1'])
    assert.equal(erEgen(ip), false, ip);
});
