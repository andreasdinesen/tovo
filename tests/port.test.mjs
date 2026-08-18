/* Porten. doda v2 var utilgaengelig i panelet paa grund af én linje:
 * serveren faldt igennem til PORT_web, som er HOST-porten panelet har
 * allokeret - ikke container-porten. Intet fejlede hoejlydt: installationen
 * lykkedes, done_regex matchede, serveren stod som "running", og siden var
 * bare doed.
 *
 * Derfor to tests: at panelets miljoe ikke kan flytte porten, og at runens
 * ports.default er det SAMME tal som serverens standard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './hjaelp.mjs';

const ROD = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('PORT_web og TOVO_PORT kan ikke kapre porten', async () => {
  // Panelets praecise miljoe: host-porten sat, BIND_PORT tom.
  const srv = await startServer({ PORT_web: '25012', TOVO_PORT: '25012' });
  try {
    // BIND_PORT=0 fra hjaelperen betyder "vaelg en fri port" - havde serveren
    // laest PORT_web, ville den staa paa 25012.
    assert.notEqual(srv.port, 25012);
    const r = await fetch(`${srv.base}/api/public-config`);
    assert.equal(r.status, 200, 'serveren skal svare paa den port, den skrev');
  } finally {
    srv.stop();
  }
});

test('serveren logger den port, socketen FAKTISK fik', async () => {
  const srv = await startServer();
  try {
    // At skrive sit eget oenske tilbage beviser ingenting - netop dét gjorde,
    // at dodas portfejl ikke kunne ses i serverens egen linje (doda v7).
    assert.match(srv.stdout(), new RegExp(`tovo lytter paa port ${srv.port}\\b`));
    assert.notEqual(srv.port, 0);
  } finally {
    srv.stop();
  }
});

test('runens ports.default er serverens standard', () => {
  const yaml = readFileSync(path.join(ROD, 'runes', 'tovo.yaml'), 'utf8');
  const server = readFileSync(path.join(ROD, 'app', 'server.js'), 'utf8');
  const iYaml = yaml.match(/name:\s*web\s*\n\s*default:\s*(\d+)/);
  const iServer = server.match(/process\.env\.BIND_PORT\s*\|\|\s*(\d+)/);
  assert.ok(iYaml, 'ports.default mangler i runen');
  assert.ok(iServer, 'serverens standardport kunne ikke laeses');
  assert.equal(iYaml[1], iServer[1], 'runen og serveren skal pege paa samme container-port');
});

test('done_regex matcher den linje, serveren rent faktisk skriver', async () => {
  const yaml = readFileSync(path.join(ROD, 'runes', 'tovo.yaml'), 'utf8');
  const m = yaml.match(/done_regex:\s*(.+)/);
  assert.ok(m, 'done_regex mangler');
  const srv = await startServer();
  try {
    assert.match(srv.stdout(), new RegExp(m[1].trim()));
  } finally {
    srv.stop();
  }
});
