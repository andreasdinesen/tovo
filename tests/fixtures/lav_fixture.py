#!/usr/bin/env python3
"""Bygger tests/fixtures/planner-eksport.xlsx - en ANONYMISERET Planner-eksport.

    python3 tests/fixtures/lav_fixture.py

Strukturen er kopieret 1:1 fra en rigtig eksport (2026-08-18): seks ark, de
samme kolonnenavne INKLUSIVE de efterstillede mellemrum, celler som `t="str"`
med teksten direkte i <v>, og INGEN sharedStrings-fil. Det er praecis de tre
ting, der afveg fra byggeplanens antagelser - saa en fixture, der "ser rigtig
ud", men bruger sharedStrings, ville teste noget andet end virkeligheden.

Indholdet er opdigtet. Kundenavne, opgavetekster, id'er og personer fra den
rigtige eksport maa ALDRIG ligge i repoet.

Ud over det virkelige tilfaelde daekker fixturen de varianter, importen skal
kunne taale, og som den ene eksport ikke indeholdt:
  - alle tre statusord (kun 'Ikke startet' fandtes i virkeligheden)
  - en udfyldt forfaldsdato og en fuldfoeringsdato
  - en opgave hvor Noter er PROSA og ikke et tal
  - en opgave uden tjekliste
  - et bucket-navn der kun findes i Buckets-arket (id-opslaget)
"""
import os
import zipfile
from xml.sax.saxutils import escape

HER = os.path.dirname(os.path.abspath(__file__))
UD = os.path.join(HER, 'planner-eksport.xlsx')

KOLONNER = [
    'Opgave-id', 'Opgavenavn ', 'Bucket', 'Mål', 'Status', 'Prioritet', 'Tildelt til',
    'Oprettet af', 'Oprettelsesdato', 'Forfaldsdato', 'Startdato', 'Er tilbagevendende',
    'Forsinket', 'Fuldføringsdato', 'Færdiggjort af', 'Afsluttede tjeklisteelementer',
    'Tjeklisteelementer', 'Mærkater', 'Noter',
]

BUCKETS = [
    ('bkt0000000000000000000000001', 'Backlog'),
    ('bkt0000000000000000000000002', 'Up next'),
    ('bkt0000000000000000000000003', 'In progress'),
    ('bkt0000000000000000000000004', 'Completed'),
]

# (id, navn, bucket, status, prioritet, oprettet, forfald, fuldfoert, tjekliste, noter)
OPGAVER = [
    ('opg0000000000000000000000001', 'Forberedelse og aftaler', 'Backlog', 'Ikke startet',
     'Mellem', '2026-05-12', '', '', 'Aftale opstartsmoede;Indhente adgange;Bekraefte tidsplan', '6,1'),
    ('opg0000000000000000000000002', 'Installation af testmiljoe', 'Up next', 'I gang',
     'Vigtig', '2026-05-12', '2026-09-01', '', 'Rejse servere;Installere software', '19,6'),
    ('opg0000000000000000000000003', 'Migrering af data', 'In progress', 'I gang',
     'Mellem', '2026-05-13', '2026-09-15', '', 'Toerkoersel;Verificere raekketal;Endelig koersel', '11,3'),
    ('opg0000000000000000000000004', 'Overdragelse og dokumentation', 'Completed', 'Fuldført',
     'Lav', '2026-05-13', '2026-08-01', '2026-08-14', 'Skrive drift-noter;Afholde overdragelse', '4,5'),
    # Noter som PROSA - den anden halvdel af "Noter kan vaere to ting".
    ('opg0000000000000000000000005', 'Opfoelgning hos kunden', 'Backlog', 'Ikke startet',
     'Mellem', '2026-05-14', '', '', '', 'Husk at spoerge til deres eget overvaagningssetup.'),
]


def celle(ref, tekst):
    return f'<c r="{ref}" t="str"><v xml:space="preserve">{escape(str(tekst))}</v></c>'


def ark(raekker):
    ud = []
    for n, raekke in enumerate(raekker, start=1):
        celler = ''.join(celle(f'{chr(65 + i)}{n}', v) for i, v in enumerate(raekke))
        ud.append(f'<row r="{n}">{celler}</row>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<sheetData>{"".join(ud)}</sheetData></worksheet>')


def opgave_raekke(o, bucket_som_id):
    tid, navn, bucket, status, prio, oprettet, forfald, fuldfoert, tjek, noter = o
    bnavn = dict((n, i) for i, n in BUCKETS)
    afsluttede = f'0/{len([x for x in tjek.split(";") if x])}' if tjek else ''
    return [tid, navn, bnavn[bucket] if bucket_som_id else bucket, '', status, prio, '',
            'Test Testesen' if not bucket_som_id else 'usr00000-0000-0000-0000-000000000001',
            oprettet, forfald, '', '', 'false', fuldfoert,
            'Test Testesen' if fuldfoert else '', afsluttede, tjek, '', noter]


ARK = [
    ('Plan', [['Abonnement-id', 'Navn på plan ', 'Dato for eksport '],
              ['pln0000000000000000000000001', 'Testkunde - Projekt 1', '2026-08-18']]),
    ('Konsoliderede data', [KOLONNER] + [opgave_raekke(o, False) for o in OPGAVER]),
    ('Opgaver', [KOLONNER] + [opgave_raekke(o, True) for o in OPGAVER]),
    ('Goals', [['Mål-id', 'Navn på mål', 'Status', 'Prioritet', 'Startdato', 'Slutdato',
               'Forbundne opgaver', 'Noter']]),
    ('Buckets', [['Bucket-id', 'Bucket-navn ']] + [[i, n] for i, n in BUCKETS]),
    ('Brugere', [['Bruger-id', 'Brugernavn', 'Mail'],
                 ['usr00000-0000-0000-0000-000000000001', 'Test Testesen', 'test@example.com']]),
]

NS = 'http://schemas.openxmlformats.org/'
workbook = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<workbook xmlns="{NS}spreadsheetml/2006/main" '
            f'xmlns:r="{NS}officeDocument/2006/relationships"><sheets>'
            + ''.join(f'<sheet name="{escape(n)}" sheetId="{i}" r:id="rId{i}"/>'
                      for i, (n, _) in enumerate(ARK, start=1))
            + '</sheets></workbook>')

wbrels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
          f'<Relationships xmlns="{NS}package/2006/relationships">'
          + ''.join(f'<Relationship Id="rId{i}" Type="{NS}officeDocument/2006/'
                    f'relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
                    for i in range(1, len(ARK) + 1))
          + '</Relationships>')

rootrels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<Relationships xmlns="{NS}package/2006/relationships">'
            f'<Relationship Id="rId1" Type="{NS}officeDocument/2006/relationships/'
            'officeDocument" Target="xl/workbook.xml"/></Relationships>')

typer = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
         f'<Types xmlns="{NS}package/2006/content-types">'
         '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.'
         'relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
         '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-'
         'officedocument.spreadsheetml.sheet.main+xml"/>'
         + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType='
                   '"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                   for i in range(1, len(ARK) + 1))
         + '</Types>')

with zipfile.ZipFile(UD, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', typer)
    z.writestr('_rels/.rels', rootrels)
    z.writestr('xl/workbook.xml', workbook)
    z.writestr('xl/_rels/workbook.xml.rels', wbrels)
    for i, (_, raekker) in enumerate(ARK, start=1):
        z.writestr(f'xl/worksheets/sheet{i}.xml', ark(raekker))

print(f'{os.path.relpath(UD, os.path.dirname(os.path.dirname(HER)))}: '
      f'{os.path.getsize(UD)} b, {len(ARK)} ark, {len(OPGAVER)} opgaver, ingen sharedStrings')
