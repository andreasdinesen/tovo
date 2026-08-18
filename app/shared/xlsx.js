/* tovo - skriver en .xlsx uden en eneste pakke.
 *
 * Planner-importen LAESER et zip-arkiv med XML (§6c). Det her er den anden
 * vej: en regnearksfil er de samme fem XML-filer i en zip, og en zip kan
 * skrives uden komprimering (metode 0, "stored"). Saa skal der kun bruges
 * CRC32 - og det er en tabel og tolv linjer.
 *
 * Tallene skrives som TAL, ikke som tekst. Det er hele pointen med at lave en
 * rigtig regnearksfil frem for en CSV: 3,5 skal kunne laegges sammen i Excel,
 * uanset om maskinen staar paa dansk eller engelsk komma.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.tovoXlsx = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TABEL = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = TABEL[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const tekst = (s) => new TextEncoder().encode(s);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Kontroltegn er ikke gyldige i XML 1.0 og faar Excel til at afvise
      // HELE filen med "uleseligt indhold" - uden at sige hvor.
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  }

  /** "A1", "AB12" - kolonnebogstaverne er base-26 uden nul. */
  function celleRef(kolonne, raekke) {
    let n = kolonne + 1;
    let s = '';
    while (n > 0) {
      const rest = (n - 1) % 26;
      s = String.fromCharCode(65 + rest) + s;
      n = Math.floor((n - 1) / 26);
    }
    return `${s}${raekke + 1}`;
  }

  function arkXml(raekker) {
    const ud = raekker.map((raekke, r) => {
      const celler = (raekke || []).map((v, c) => {
        const ref = celleRef(c, r);
        if (v === null || v === undefined || v === '') return '';
        if (typeof v === 'number' && isFinite(v)) {
          return `<c r="${ref}"><v>${v}</v></c>`;
        }
        // inlineStr: ingen sharedStrings-fil at holde i trit med.
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join('');
      return `<row r="${r + 1}">${celler}</row>`;
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + `<sheetData>${ud}</sheetData></worksheet>`;
  }

  /* Arknavne: Excel afviser filen, hvis de indeholder : \ / ? * [ ] eller er
     over 31 tegn. Fejlen kommer foerst, naar brugeren aabner filen. */
  const arknavn = (n, i) => (String(n || `Sheet${i + 1}`)
    .replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`);

  /**
   * @param {array} ark  [{navn, rows: [[celle, ...], ...]}]
   * @returns {Uint8Array} en .xlsx
   */
  function byg(ark) {
    const dele = ark.length ? ark : [{ navn: 'Sheet1', rows: [] }];
    const filer = [
      ['[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + dele.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" `
          + 'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
        + '</Types>'],
      ['_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>'],
      ['xl/workbook.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        + dele.map((a, i) => `<sheet name="${esc(arknavn(a.navn, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
        + '</sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + dele.map((_, i) => `<Relationship Id="rId${i + 1}" `
          + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
          + `Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + '</Relationships>'],
      ...dele.map((a, i) => [`xl/worksheets/sheet${i + 1}.xml`, arkXml(a.rows || [])]),
    ];

    /* Zip'en skrives UDEN komprimering (metode 0). En regnearksfil paa nogle
       kilobyte har intet at hente ved deflate, og saa slipper vi for at gaa
       gennem CompressionStream - som er asynkron og ikke findes alle steder. */
    const lokale = [];
    const centrale = [];
    let offset = 0;

    for (const [navn, indhold] of filer) {
      const navnBytes = tekst(navn);
      const data = tekst(indhold);
      const crc = crc32(data);

      const lokal = new Uint8Array(30 + navnBytes.length + data.length);
      const lv = new DataView(lokal.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);              // version
      lv.setUint16(6, 0x0800, true);          // flag: navnet er UTF-8
      lv.setUint16(8, 0, true);               // metode 0 = stored
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, navnBytes.length, true);
      lokal.set(navnBytes, 30);
      lokal.set(data, 30 + navnBytes.length);
      lokale.push(lokal);

      const central = new Uint8Array(46 + navnBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, navnBytes.length, true);
      cv.setUint32(42, offset, true);
      central.set(navnBytes, 46);
      centrale.push(central);

      offset += lokal.length;
    }

    const centralStart = offset;
    const centralLaengde = centrale.reduce((n, c) => n + c.length, 0);
    const slut = new Uint8Array(22);
    const sv = new DataView(slut.buffer);
    sv.setUint32(0, 0x06054b50, true);
    sv.setUint16(8, filer.length, true);
    sv.setUint16(10, filer.length, true);
    sv.setUint32(12, centralLaengde, true);
    sv.setUint32(16, centralStart, true);

    const samlet = new Uint8Array(centralStart + centralLaengde + 22);
    let p = 0;
    for (const del of lokale.concat(centrale, [slut])) { samlet.set(del, p); p += del.length; }
    return samlet;
  }

  return { byg, crc32, celleRef };
}));
