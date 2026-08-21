#!/usr/bin/env python3
"""Bygger runes/tovo.yaml ud fra kilderne i app/.

    python3 build_rune.py

Trin:
  1. Saml app/shared/*.js + app/parts/p*.js -> app/public/app.js og koer
     `node --check` paa resultatet.
  2. Stempl ?v=<APP_VERSION> ind i index.html (Cloudflare edge-cacher .js/.css
     i timevis og ignorerer no-cache - se RUNE-ERFARINGER §5).
  3. Pak app-filerne som tar, komprimer med brotli q11, kod med base85.
  4. Verificer rundturen med PRAECIS den dekoder, der udgives.
  5. Skriv og valider runens YAML - og RAPPORTER payload-stoerrelsen.

runes/tovo.yaml og app/public/app.js er GENEREREDE artefakter.
"""

import io
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import textwrap

import yaml

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, 'app')
PARTS = os.path.join(APP, 'parts')
PUBLIC = os.path.join(APP, 'public')
SHARED = os.path.join(APP, 'shared')
OUT = os.path.join(ROOT, 'runes', 'tovo.yaml')

# Install-scriptet koeres som ET sh -c-argument -> Linux' MAX_ARG_STRLEN
# (131072 b) er loftet. Margenen skal daekke panelets {{VARIABEL}}-
# udskiftninger, og de er faa og korte.
#
# Beanledger v28 sprang sin egen graense, FOER én linje MCP var skrevet -
# derfor staar brotli+base85 her fra fase 0 og ikke som en senere redning.
MAX_INSTALL = 120_000
MAX_YAML = 512 * 1024

# Install-scriptet HENTER app-koden i stedet for at baere den.
#
# Med payloaden indlejret laa scriptet paa 96 % af de 120.000 tegn, og den
# naeste funktion af nogen stoerrelse kunne ikke vaere der. Et hentende script
# er KONSTANT stort, uanset hvor stor appen bliver (sagu, tools v1).
#
# Payloaden bygges STADIG ved hver koersel, og det er ikke spild:
#   - rundturs-tjekket beviser, at kilderne kan pakkes og pakkes ud igen,
#   - tallet staar i loggen, saa §8's vane (rapportér payloaden) holder,
#   - og saet HENT_FRA_GITHUB = False, saa er den indlejrede rune tilbage.
#     Det er den eneste vej, der virker uden net ved installationen.
#
# Prisen er, at repoet skal vaere OFFENTLIGT (codeload spoerger ikke om et
# token), og at hver udgivelse skal tagges: `git tag vN && git push --tags`.
HENT_FRA_GITHUB = True
GITHUB_EJER = 'andreasdinesen'
GITHUB_REPO = 'tovo'


def tarball_url(version):
    """Runens version N hoerer sammen med taggen vN - ikke med en gren.

    Peger scriptet paa `refs/heads/main`, installerer en gammel rune det, main
    tilfaeldigvis indeholder i dag. Med en tag installerer rune vN praecis vN's
    kode, ogsaa om et aar. Glemmer man at pushe taggen, siger install-scriptet
    det HOEJT (404) i stedet for at installere noget andet.
    """
    return (f'https://codeload.github.com/{GITHUB_EJER}/{GITHUB_REPO}'
            f'/tar.gz/refs/tags/v{version}')


HEREDOC = 'YGG_PAYLOAD_EOF'
FORBUDT_MOENSTER = re.compile(r'\{\{[A-Z_]{2,}\}\}')

# base85 uden { } og \ - saa kan payloaden aldrig ligne panelets
# {{VARIABEL}}-skabeloner (RUNE-ERFARINGER §2).
ALFABET = [c for c in range(33, 127) if c not in (123, 125, 92)][:85]


def fejl(besked):
    print(f'FEJL: {besked}', file=sys.stderr)
    sys.exit(1)


def node(*args, stdin=None):
    res = subprocess.run(['node', *args], input=stdin, capture_output=True)
    if res.returncode != 0:
        fejl(f'node fejlede: {res.stderr.decode("utf8", "replace")[:2000]}')
    return res.stdout


def js_filer(mappe):
    if not os.path.isdir(mappe):
        return []
    return sorted(f for f in os.listdir(mappe) if f.endswith('.js'))


# ----------------------------------------------------------------- 1. frontend

def saml_frontend():
    navne = js_filer(PARTS)
    if not navne:
        fejl('ingen dele i app/parts/')
    stykker = []

    # De delte moduler FOERST. De er UMD-pakkede, saa serveren kan require dem
    # og browseren faar dem paa window - ÉN parser og ÉN beregning, to
    # koeresteder. Uden dem foerst er de ikke defineret, naar delene bruger dem.
    for navn in js_filer(SHARED):
        with open(os.path.join(SHARED, navn), encoding='utf8') as fh:
            stykker.append(f'/* ---- shared/{navn} ---- */\n{fh.read()}')

    for navn in navne:
        with open(os.path.join(PARTS, navn), encoding='utf8') as fh:
            stykker.append(f'/* ---- {navn} ---- */\n{fh.read()}')
    samlet = '\n'.join(stykker)

    sti = os.path.join(PUBLIC, 'app.js')
    with open(sti, 'w', encoding='utf8') as fh:
        fh.write(samlet)

    # Ingen bundler fanger syntaksfejl for os.
    res = subprocess.run(['node', '--check', sti], capture_output=True)
    if res.returncode != 0:
        fejl('app.js har en syntaksfejl:\n' + res.stderr.decode('utf8', 'replace'))

    m = re.search(r'^const APP_VERSION = (\d+);', samlet, re.M)
    if not m:
        fejl('APP_VERSION mangler i app/parts/ (forventet: const APP_VERSION = N;)')
    print(f'  frontend: {len(navne)} dele + {len(js_filer(SHARED))} delte, {len(samlet):,} tegn')
    return int(m.group(1))


def stempl_version(version):
    """Cache-bust. Resultatet SKAL skrives tilbage til disk - payloaden laeser
    filerne fra disk igen, og ellers pakkes den gamle HTML (§5)."""
    sti = os.path.join(PUBLIC, 'index.html')
    with open(sti, encoding='utf8') as fh:
        html = fh.read()
    ny = re.sub(r'(style\.css|app\.js)(\?v=\d+)?', rf'\1?v={version}', html)
    if ny != html:
        with open(sti, 'w', encoding='utf8') as fh:
            fh.write(ny)
    if f'app.js?v={version}' not in ny:
        fejl('kunne ikke stemple versionen i index.html')

    # Service workerens cache-navn OG dens precache-liste skal foelge SAMME
    # version. Ellers hober hver udgivelse sig op i browserens cache, og
    # SW'en kan servere en gammel app.js i det uendelige (§5).
    sw_sti = os.path.join(PUBLIC, 'sw.js')
    with open(sw_sti, encoding='utf8') as fh:
        sw = fh.read()
    ny_sw = re.sub(r'^const VERSION = \d+;', f'const VERSION = {version};', sw, flags=re.M)
    if ny_sw != sw:
        with open(sw_sti, 'w', encoding='utf8') as fh:
            fh.write(ny_sw)
    if f'const VERSION = {version};' not in ny_sw:
        fejl('kunne ikke stemple versionen i sw.js')

    # Og saa DET statiske tjek, §5 peger paa: precache-listen skal indeholde
    # praecis de ?v=-adresser, index.html henter. Den fejl kan ikke ses i en
    # browser - den viser sig som en gammel version, der nagler sig fast.
    i_html = set(re.findall(r'(?:src|href)="((?:style\.css|app\.js)\?v=\d+)"', ny))
    i_sw = set(re.findall(r'\./((?:style\.css|app\.js)\?v=\$\{VERSION\})', ny_sw))
    forventet = {n.replace(f'?v={version}', '?v=${VERSION}') for n in i_html}
    if not i_html:
        fejl('kunne ikke laese de versionerede adresser ud af index.html')
    if i_sw != forventet:
        fejl(f'service workerens precache-liste passer ikke med index.html: '
             f'{sorted(i_sw)} mod {sorted(forventet)}')
    print(f'  index.html og sw.js stemplet med v={version} '
          f'({len(i_html)} versionerede adresser, precache stemmer)')


# ------------------------------------------------------------------ 2. payload

def indsaml_filer():
    """Alle app-filer. GLOBBES - en haandholdt liste glemmer et nyt modul, og
    fejlen er usynlig lokalt (Beanledger v30: to udgivelser kunne ikke
    installeres, fordi mcp.js og oauth.js manglede i payloaden)."""
    filer = [(f'app/{n}', os.path.join(APP, n)) for n in js_filer(APP)]
    for navn in js_filer(SHARED):
        filer.append((f'app/shared/{navn}', os.path.join(SHARED, navn)))
    for navn in sorted(os.listdir(PUBLIC)):
        sti = os.path.join(PUBLIC, navn)
        if os.path.isfile(sti) and not navn.startswith('.'):
            filer.append((f'app/public/{navn}', sti))
    return filer


def tjek_kilder(filer):
    for arkivnavn, sti in filer:
        if not sti.endswith(('.js', '.html', '.css', '.webmanifest')):
            continue
        with open(sti, encoding='utf8') as fh:
            indhold = fh.read()
        if HEREDOC in indhold:
            fejl(f'{arkivnavn} indeholder heredoc-markoeren {HEREDOC}')
        fund = FORBUDT_MOENSTER.search(indhold)
        if fund:
            fejl(f'{arkivnavn} indeholder {fund.group(0)} - yggdrasil templater '
                 'den vaek i install-scriptet. Omskriv.')


def tjek_requires(filer):
    """Udled kravet fra KODEN, ikke fra listen.

    En verifikation, der kun bekraefter det, du allerede har skrevet ned,
    fanger tilfoejelser - aldrig udeladelser (Beanledger v30). Derfor laeses
    alle require('./...') ud af kildefilerne, og build'et faelder, hvis en af
    dem ikke er i payloaden.

    Bevis spaerren ved at fjerne en fil fra globben og se build'et stoppe.
    """
    i_payload = {navn for navn, _ in filer}
    mangler = []
    for arkivnavn, sti in filer:
        if not arkivnavn.startswith('app/') or not sti.endswith('.js'):
            continue
        if arkivnavn.startswith('app/public/'):
            continue                      # frontenden require'r ingenting
        mappe = os.path.dirname(arkivnavn)
        with open(sti, encoding='utf8') as fh:
            for ref in re.findall(r"require\(\s*'(\.[^']+)'\s*\)", fh.read()):
                maal = os.path.normpath(os.path.join(mappe, ref))
                if not maal.endswith('.js'):
                    maal += '.js'
                if maal not in i_payload:
                    mangler.append(f'{maal} (kraevet af {arkivnavn})')
    if mangler:
        fejl('disse require-filer mangler i payloaden: ' + ', '.join(sorted(set(mangler))))
    print(f'  require-spaerre: alle {len(i_payload)} filer haenger sammen')


def tjek_syntaks(navn, kode):
    """node --check paa INDHOLD, ikke paa en sti."""
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf8') as fh:
        fh.write(kode)
        midl = fh.name
    try:
        res = subprocess.run(['node', '--check', midl], capture_output=True)
        if res.returncode != 0:
            fejl(f'{navn} har en syntaksfejl EFTER kommentar-strip:\n'
                 + res.stderr.decode('utf8', 'replace'))
    finally:
        os.unlink(midl)


def strip_kommentarer(kode):
    """Fjerner kommentarer fra den UDGIVNE kopi. Kilderne roeres aldrig.

    Kokkeri maalte 0,8 % og doda 24 % af det samme greb - tallet skal maales
    paa sit eget projekt, ikke antages. tovo skriver begrundelser i koden som
    doda, saa gevinsten forventes at ligge samme sted.

    To regler goer den sikker:
      1. Kun linjer, der er HELT kommentar eller tomme, fjernes. En linje med
         kode paa roeres aldrig, saa hverken en streng eller en regex-literal
         kan beskadiges.
      2. Hver fjernet linje efterlades TOM, saa linjetallet holder og en
         stak-sporing fra containeren peger paa samme linje i repoet.
    """
    ud, i_blok = [], False
    for linje in kode.split('\n'):
        s = linje.strip()
        fjern = False
        if i_blok:
            if '*/' in s:
                i_blok = False
            fjern = True
        elif s.startswith('/*'):
            if '*/' not in s:
                i_blok = True
            elif s.split('*/', 1)[1].strip():
                # Kode efter en kort blok-kommentar: behold linjen frem for
                # at aede koden.
                ud.append(linje)
                continue
            fjern = True
        elif s.startswith('//') or not s:
            fjern = True
        ud.append('' if fjern else linje)
    return '\n'.join(ud)


def byg_tar(filer):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w') as tar:
        for arkivnavn, sti in filer:
            info = tarfile.TarInfo(arkivnavn)
            data = open(sti, 'rb').read()
            if arkivnavn.endswith('.js'):
                tekst = data.decode('utf8')
                renset = strip_kommentarer(tekst)
                if renset.count('\n') != tekst.count('\n'):
                    fejl(f'{arkivnavn}: strip aendrede linjetallet - stak-sporinger '
                         'ville ikke laengere passe med kilden')
                # Tjek DEN FIL, DER UDGIVES - ikke kilden den kom fra.
                tjek_syntaks(arkivnavn, renset)
                data = renset.encode('utf8')
            info.size = len(data)
            info.mode = 0o644
            info.mtime = 0
            info.uid = info.gid = 0
            info.uname = info.gname = ''
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def brotli(raw):
    """Python har ikke brotli i stdlib - Node har. Og install-imaget ER node."""
    return node('-e', 'process.stdout.write(require("zlib").brotliCompressSync('
                      'require("fs").readFileSync(0),{params:{[require("zlib")'
                      '.constants.BROTLI_PARAM_QUALITY]:11}}))', stdin=raw)


def b85(raw):
    ud = []
    for i in range(0, len(raw) - len(raw) % 4, 4):
        v = int.from_bytes(raw[i:i + 4], 'big')
        blok = []
        for _ in range(5):
            blok.append(ALFABET[v % 85])
            v //= 85
        ud.extend(reversed(blok))
    rest = len(raw) % 4
    if rest:
        # NULpadning her, mens dekoderen padder cifrene med 84 (max). De to
        # runder hver sin vej, saa de betydende bytes overlever. Padder man
        # begge steder opad, loeber overskuddet op i den sidste rigtige byte -
        # og brotli dekomprimerer VILLIGT til noget, der kun afviger i halen
        # (doda). Rundturs-tjekket er det eneste, der fanger det.
        v = int.from_bytes(raw[-rest:] + b'\x00' * (4 - rest), 'big')
        blok = []
        for _ in range(5):
            blok.append(ALFABET[v % 85])
            v //= 85
        ud.extend(list(reversed(blok))[:rest + 1])
    return ''.join(chr(c) for c in ud)


# Dekoderen staar i en 'single quoted' sh-streng -> den maa IKKE indeholde '.
# Derfor bygges alfabetet af tegnkoder, ikke som streng-literal.
DEKODER = (
    'const A=[];for(let c=33;c<127;c++)if(c!==123&&c!==125&&c!==92)A.push(c);'
    'const M=new Int16Array(128).fill(-1);for(let i=0;i<85;i++)M[A[i]]=i;'
    'const s=require("fs").readFileSync(0,"utf8").replace(/\\s+/g,"");'
    'const h=s.length/5|0,r=s.length%5,o=Buffer.alloc(h*4+(r?r-1:0));let q=0;'
    'for(let i=0;i<h;i++){let v=0;for(let j=0;j<5;j++)v=v*85+M[s.charCodeAt(q++)];'
    'o.writeUInt32BE(v>>>0,i*4);}'
    'if(r){let v=0;for(let j=0;j<5;j++)v=v*85+(j<r?M[s.charCodeAt(q+j)]:84);'
    'const b=Buffer.alloc(4);b.writeUInt32BE(v>>>0);b.copy(o,h*4,0,r-1);}'
    'process.stdout.write(require("zlib").brotliDecompressSync(o));'
)


def verificer(kodet, forventet):
    """Koer PRAECIS den dekoder, der udgives - saa beviser testen, at dekoderen
    virker, ikke bare at Python kan regne baglaens."""
    if "'" in DEKODER:
        fejl("dekoderen indeholder ' og kan ikke staa i en sh-streng")
    faktisk = node('-e', DEKODER, stdin=kodet.encode('ascii'))
    if faktisk != forventet:
        fejl(f'rundturen fejlede: {len(faktisk)} b ud, {len(forventet)} b ind')
    print(f'  rundtur ok: {len(forventet):,} b tar -> {len(kodet):,} tegn base85')


# -------------------------------------------------------------------- 3. yaml

def henter(version):
    """Node-koden, der henter tarball'en. Staar i en 'single quoted' sh-streng
    -> den maa IKKE indeholde '.

    Node frem for wget af to grunde: Node ER install-imaget og altsaa
    garanteret til stede, mens busybox' wget og dens TLS er ubevist - og zlib
    i Node pakker gzip'en ud, saa `tar` kun skal kunne det, den allerede goer.
    """
    url = tarball_url(version)
    return (
        'const https=require("https"),zlib=require("zlib");'
        f'const U="{url}";'
        'function d(m){console.error("[fejl] "+m);console.error("Adresse: "+U);'
        'console.error("GitHub svarer 404 BAADE naar adressen ikke findes OG naar '
        'der ikke er adgang - tjek at taggen er pushet, og at repoet er offentligt.");'
        'process.exit(1);}'
        'function hent(u,n){https.get(u,{headers:{"user-agent":"tovo-installer"}},(r)=>{'
        'if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){'
        'if(n<=0)return d("for mange omdirigeringer");r.resume();'
        'return hent(new URL(r.headers.location,u).toString(),n-1);}'
        'if(r.statusCode!==200)return d("GitHub svarede "+r.statusCode);'
        'const g=zlib.createGunzip();'
        'g.on("error",(e)=>d("arkivet kunne ikke pakkes ud: "+e.message));'
        'r.pipe(g).pipe(process.stdout);'
        '}).on("error",(e)=>d("kunne ikke naa GitHub: "+e.message));}'
        'hent(U,3);'
    )


def hent_krop(version):
    """De linjer, install og update har TILFAELLES, naar koden hentes.

    Der pakkes ALTID ud i en frisk mappe, som byttes ind - saa kan en halv
    hentning aldrig efterlade et halvt app/. `rm -rf app` staar med, fordi tar
    overskriver, men ikke fjerner filer, der er slettet i en ny version
    (Beanledger v30). Datamappen roeres ikke: alt midlertidigt ligger i /tmp.
    """
    return (
        'echo "Henter app-koden fra GitHub ..."\n'
        'rm -rf /tmp/tovo-hent\n'
        'mkdir -p /tmp/tovo-hent\n'
        f"node -e '{henter(version)}' > /tmp/tovo-hent/app.tar\n"
        'tar x -C /tmp/tovo-hent -f /tmp/tovo-hent/app.tar\n'
        '\n'
        '# Mappenavnet i et GitHub-arkiv er <repo>-<ref uden v>, og arkivet\n'
        '# begynder med en pax_global_header-post. Ingen af delene gaettes:\n'
        '# find den app-mappe, der FINDES.\n'
        'NY=$(find /tmp/tovo-hent -maxdepth 2 -type d -name app | head -n 1)\n'
        'if [ -z "$NY" ] || [ ! -f "$NY/server.js" ]; then\n'
        '  echo "[fejl] arkivet fra GitHub indeholder ingen app/server.js"\n'
        '  exit 1\n'
        'fi\n'
        'rm -rf app\n'
        'mv "$NY" app\n'
        'rm -rf /tmp/tovo-hent\n'
    )


def install_script(version, payload):
    if HENT_FRA_GITHUB:
        return (
            'set -eu\n'
            f'echo "Installerer tovo v{version} ..."\n'
            'echo "Node: $(node --version)"\n'
            '\n'
            + hent_krop(version)
            + '\n'
            'echo "Filer udpakket:"\n'
            'ls -1 app app/public\n'
            'echo "Klar. Start serveren i panelet."\n'
        )
    linjer = textwrap.wrap(payload, 100)
    return (
        'set -eu\n'
        f'echo "Installerer tovo v{version} ..."\n'
        'echo "Node: $(node --version)"\n'
        '\n'
        '# App-filerne ligger som brotli-komprimeret tar i base85 - se build_rune.py\n'
        f"node -e '{DEKODER}' <<'{HEREDOC}' | tar x\n"
        + '\n'.join(linjer) + '\n'
        f'{HEREDOC}\n'
        '\n'
        'echo "Filer udpakket:"\n'
        'ls -1 app app/public\n'
        'echo "Klar. Start serveren i panelet."\n'
    )


def opdater_script(version, payload):
    """update:-blokken: skriver app-filerne igen og lader /data staa.

    `rm -rf app` FOERST: tar overskriver, men fjerner ikke filer, der er
    slettet i en ny version - uden det bliver de liggende for evigt
    (Beanledger v30)."""
    if HENT_FRA_GITHUB:
        return (
            'set -eu\n'
            f'echo "Opdaterer tovo til v{version} ..."\n'
            'echo "Node: $(node --version)"\n'
            '\n'
            + hent_krop(version)
            + '\n'
            'echo "App-filerne er skiftet ud. Databasen i /data er uroert."\n'
            'echo "Skemaet opdateres automatisk, naar serveren starter."\n'
        )
    linjer = textwrap.wrap(payload, 100)
    return (
        'set -eu\n'
        f'echo "Opdaterer tovo til v{version} ..."\n'
        'echo "Node: $(node --version)"\n'
        'rm -rf app\n'
        f"node -e '{DEKODER}' <<'{HEREDOC}' | tar x\n"
        + '\n'.join(linjer) + '\n'
        f'{HEREDOC}\n'
        '\n'
        'echo "App-filerne er skiftet ud. Databasen i /data er uroert."\n'
        'echo "Skemaet opdateres automatisk, naar serveren starter."\n'
    )


def byg_yaml(version, payload):
    rune = {'gameskill': {
        'id': 'tovo',
        'name': 'tovo',
        'category': 'Apps',
        'description': (
            'Tidsregistrering paa opgaver og projekter. Timer og manuel registrering er '
            'ligevaerdige indgange, start-links kan klikkes fra OneNote, og opgaver kan '
            'importeres fra Microsoft Planner uden at miste estimater eller registreret tid. '
            'Egen SQLite-database, ingen eksterne afhaengigheder.'
        ),
        'author': 'andreas',
        'version': version,
        'icon': 'app',

        # Node-versionen er et FELT i panelet, ikke en konstant i koden: findes
        # der en CVE i Node, kan den lukkes uden en kodeaendring.
        'docker': {'image': '{{NODE_IMAGE}}'},

        'variables': [
            {'key': 'APP_NAME', 'name': 'Appens navn', 'type': 'string', 'default': 'tovo'},
            {'key': 'NODE_IMAGE', 'name': 'Node-image', 'type': 'string',
             'default': 'node:24-alpine',
             'pattern': r'^node:[0-9][A-Za-z0-9._-]*$',
             'hint': 'Skal vaere et node:-image, fx node:24-alpine eller node:24.9.0-alpine'},
        ],

        'install': {'image': '{{NODE_IMAGE}}', 'script': install_script(version, payload)},
        'update': {'image': '{{NODE_IMAGE}}', 'label': 'Opdater tovo',
                   'script': opdater_script(version, payload)},

        'startup': {
            'command': ('if node -e "require(\'node:sqlite\')" >/dev/null 2>&1; then\n'
                        '  exec node app/server.js\n'
                        'else\n'
                        '  exec node --experimental-sqlite app/server.js\n'
                        'fi\n'),
            'done_regex': 'tovo lytter',
            'stop_timeout': 30,
        },

        # Container-porten er den konstant, runen selv erklaerer. Serveren
        # binder 3000, medmindre BIND_PORT er sat (kun lokal koersel).
        'ports': [{'name': 'web', 'default': 3000, 'protocol': 'tcp'}],

        'watchers': [
            {'name': 'Serverfejl i tovo', 'pattern': r'\[fejl\]',
             'threshold': 5, 'window_secs': 300},
        ],

        # Ruller op pr. IP i panelets sikkerhedshistorik. Watcheren notificerer,
        # events: giver historikken - to forskellige formaal.
        'events': [
            {'key': 'tovo_login_fejl', 'label': 'Mislykket login i tovo',
             'match': r'\[sikkerhed\] login-fejl ip=(\S+)'},
            {'key': 'tovo_login_spaerret', 'label': 'Login spaerret af rate-limit',
             'match': r'\[sikkerhed\] login-spaerret ip=(\S+)'},
        ],

        'backup': {'include': []},
        'wipe': {'paths': ['tovo.db', 'tovo.db-wal', 'tovo.db-shm'], 'backup_first': True},
    }}

    tekst = yaml.safe_dump(rune, allow_unicode=True, sort_keys=False, width=120)
    genlaest = yaml.safe_load(tekst)
    # Verificer payloaden BEGGE steder: en update, der pakker noget andet ud
    # end installationen, opdages ellers foerst, naar en bruger trykker paa
    # knappen (Kokkeri v26).
    for blok in ('install', 'update'):
        if genlaest['gameskill'][blok]['script'] != rune['gameskill'][blok]['script']:
            fejl(f'{blok}-scriptet overlevede ikke en YAML-rundtur')
    if HENT_FRA_GITHUB:
        # Henter de to scripts DET SAMME? En update, der henter en anden
        # version end installationen, opdages ellers foerst, naar en bruger
        # trykker paa knappen (Kokkeri v26).
        forventet = tarball_url(version) + '"'
        for blok in ('install', 'update'):
            script = genlaest['gameskill'][blok]['script']
            fund = re.findall(r'https://codeload\.github\.com/\S+?"', script)
            if len(fund) != 1:
                fejl(f'{blok}-scriptet henter fra {len(fund)} adresser - der skal vaere praecis én')
            if fund[0] != forventet:
                fejl(f'{blok}-scriptet henter ikke fra {tarball_url(version)}')
            # Her SKAL `rm -rf app` staa i begge: ombytningen af den friske
            # mappe er det, der goer, at en halv hentning ikke efterlader et
            # halvt app/.
            if 'rm -rf app' not in script:
                fejl(f'{blok}-scriptet mangler `rm -rf app` - slettede filer '
                     'ville blive liggende')
            if HEREDOC in script:
                fejl(f'{blok}-scriptet baerer stadig en payload')
    elif 'rm -rf app' in genlaest['gameskill']['install']['script']:
        fejl('install-scriptet maa ikke slette app/ - det er update-scriptets opgave')
    if '/data' in genlaest['gameskill']['update']['script'].replace('/data er uroert', ''):
        fejl('update-scriptet maa ikke roere /data')
    return tekst


# -------------------------------------------------------------------- main

def main():
    print('Bygger tovo-runen ...')
    version = saml_frontend()
    stempl_version(version)

    filer = indsaml_filer()
    tjek_kilder(filer)
    tjek_requires(filer)

    raw = byg_tar(filer)
    komprimeret = brotli(raw)
    payload = b85(komprimeret)
    verificer(payload, raw)

    install = install_script(version, payload)
    if len(install) > MAX_INSTALL:
        fejl(f'install-scriptet er {len(install):,} tegn - loftet er {MAX_INSTALL:,} '
             '(Linux MAX_ARG_STRLEN er 131072). Noget skal ud af payloaden.')

    tekst = byg_yaml(version, payload)
    if len(tekst.encode('utf8')) > MAX_YAML:
        fejl(f'YAML er {len(tekst.encode("utf8")):,} b - panelets loft er {MAX_YAML:,}')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf8') as fh:
        fh.write(tekst)

    # Stoerrelsen SKAL staa i outputtet ved hver koersel - den skal foelges
    # hele vejen gennem projektet, ikke maales foerste gang den fejler.
    print(f'  install-script: {len(install):,} / {MAX_INSTALL:,} tegn '
          f'({len(install) * 100 // MAX_INSTALL} %)')
    if HENT_FRA_GITHUB:
        # Payloaden er ikke i scriptet laengere, men tallet bliver ved med at
        # betyde noget: det er maalet paa, hvor stor appen er blevet, og det er
        # det, §8's vane handler om. Rapportér det, ogsaa naar det ikke laengere
        # kan faelde build'et.
        print(f'  app-koden hentes fra: {tarball_url(version)}')
        print(f'  (indlejret ville payloaden fylde {len(payload):,} tegn '
              f'= {len(payload) * 100 // MAX_INSTALL} % af loftet)')
        print(f'  HUSK ved udgivelse: git tag v{version} && git push --tags')
    print(f'\nOK  runes/tovo.yaml  (v{version}, {len(tekst.encode("utf8")):,} b)')


if __name__ == '__main__':
    main()
