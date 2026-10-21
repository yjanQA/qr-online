// ============================================================
// xlsx_export.js — 외부 라이브러리 없이 .xlsx 생성 (오프라인/PWA 대응)
//   저장(STORED) 방식 ZIP + CRC32 + OpenXML 파트로 진짜 엑셀파일 생성.
//   WSXlsx.download(filename, sheets)  · sheets: [{ name, rows:[[cell,...]] }]
//     cell: 숫자 → 숫자셀 / 그 외 → 문자열셀(inlineStr)
// ============================================================

const WSXlsx = (() => {
  const enc = (s) => new TextEncoder().encode(s);
  const escXml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // CRC32
  const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
  const crc32 = (bytes) => { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  const colName = (n) => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  const sheetXml = (rows) => {
    let body = '';
    rows.forEach((row, r) => {
      let cells = '';
      (row || []).forEach((val, c) => {
        if (val == null || val === '') return;
        const ref = colName(c) + (r + 1);
        if (typeof val === 'number' && isFinite(val)) cells += `<c r="${ref}"><v>${val}</v></c>`;
        else cells += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(val)}</t></is></c>`;
      });
      body += `<row r="${r + 1}">${cells}</row>`;
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  };

  const buildParts = (sheets) => {
    const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${escXml(s.name || ('Sheet' + (i + 1)))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
    const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`;
    const parts = [
      { name: '[Content_Types].xml', data: enc(ct) },
      { name: '_rels/.rels', data: enc(rels) },
      { name: 'xl/workbook.xml', data: enc(wb) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc(wbRels) },
    ];
    sheets.forEach((s, i) => parts.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(sheetXml(s.rows || [])) }));
    return parts;
  };

  // STORED(무압축) ZIP 아카이브
  const zipStore = (files) => {
    const u16 = (n) => [n & 0xFF, (n >> 8) & 0xFF];
    const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
    const chunks = [], central = [];
    let offset = 0;
    files.forEach(f => {
      const nameBytes = enc(f.name), crc = crc32(f.data), sz = f.data.length;
      const local = [].concat([0x50, 0x4b, 0x03, 0x04], u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(sz), u32(sz), u16(nameBytes.length), u16(0));
      chunks.push(new Uint8Array(local), nameBytes, f.data);
      const cd = [].concat([0x50, 0x4b, 0x01, 0x02], u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(sz), u32(sz), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset));
      central.push(new Uint8Array(cd), nameBytes);
      offset += local.length + nameBytes.length + sz;
    });
    let cdSize = 0; central.forEach(c => cdSize += c.length);
    const end = [].concat([0x50, 0x4b, 0x05, 0x06], u16(0), u16(0), u16(files.length), u16(files.length),
      u32(cdSize), u32(offset), u16(0));
    return [...chunks, ...central, new Uint8Array(end)];
  };

  const blob = (sheets) => new Blob(zipStore(buildParts(sheets)), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  const download = (filename, sheets) => {
    const url = URL.createObjectURL(blob(sheets));
    const a = document.createElement('a');
    a.href = url; a.download = /\.xlsx$/i.test(filename) ? filename : filename + '.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  return { download, blob, _internals: { buildParts, zipStore, sheetXml } };
})();

if (typeof window !== 'undefined') window.WSXlsx = WSXlsx;
if (typeof module !== 'undefined' && module.exports) module.exports = WSXlsx;
