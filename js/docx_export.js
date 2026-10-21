// ============================================================
// docx_export.js — 라이브러리 없이 진짜 Word 파일(.docx) 생성
//   · OOXML(WordprocessingML) 파트를 만들고 js/xlsx_export.js 의 ZIP 빌더를 재사용한다.
//   · 워드에서 그대로 열려 편집·저장이 되므로 원료 규격서 원본 양식을 유지할 수 있다.
//
// 문서 모델(doc):
//   { title, landscape?, blocks: [
//       { type:'p',     runs:[{t, bold, size, color}], align, spacing, indent },
//       { type:'table', widths:[twips...], rows:[[cell...]] },
//       { type:'image', dataUri, w, h },        // w/h = 픽셀
//     ] }
//   cell: { t, bold, align, valign, fill, gridSpan, vMerge:'restart'|'cont', size }
// ============================================================

const WSDocx = (() => {
  const enc = (s) => new TextEncoder().encode(s);
  const escXml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  const FONT = 'Malgun Gothic';
  const EMU = 9525;                 // 1px = 9525 EMU
  const PAGE_W = 11906, PAGE_H = 16838;   // A4 (twips)
  const MARGIN = 1134;              // 2cm
  const CONTENT_W = PAGE_W - MARGIN * 2;  // 9638

  const rPr = (o) => {
    o = o || {};
    return `<w:rPr><w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}"/>`
      + (o.bold ? '<w:b/>' : '')
      + (o.color ? `<w:color w:val="${o.color}"/>` : '')
      + `<w:sz w:val="${o.size || 20}"/><w:szCs w:val="${o.size || 20}"/></w:rPr>`;
  };

  // 줄바꿈(\n)은 <w:br/> 로 — 한 문단 안에서 원본 줄 구성을 유지한다.
  const runXml = (r) => {
    const parts = String(r.t == null ? '' : r.t).split('\n');
    const body = parts.map((p, i) =>
      (i ? '<w:br/>' : '') + `<w:t xml:space="preserve">${escXml(p)}</w:t>`).join('');
    return `<w:r>${rPr(r)}${body}</w:r>`;
  };

  const pPr = (o) => {
    o = o || {};
    const jc = o.align ? `<w:jc w:val="${o.align}"/>` : '';
    const sp = `<w:spacing w:before="${o.before == null ? 0 : o.before}" w:after="${o.after == null ? 40 : o.after}" w:line="240" w:lineRule="auto"/>`;
    const ind = o.indent ? `<w:ind w:left="${o.indent}"/>` : '';
    return `<w:pPr>${sp}${jc}${ind}</w:pPr>`;
  };

  const paraXml = (b) => `<w:p>${pPr(b)}${(b.runs || []).map(runXml).join('')}</w:p>`;

  const cellXml = (c, w) => {
    c = c || {};
    const span = c.gridSpan ? `<w:gridSpan w:val="${c.gridSpan}"/>` : '';
    const vm = c.vMerge === 'restart' ? '<w:vMerge w:val="restart"/>'
      : c.vMerge === 'cont' ? '<w:vMerge/>' : '';
    const shd = c.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${c.fill}"/>` : '';
    const va = `<w:vAlign w:val="${c.valign || 'center'}"/>`;
    const inner = (c.blocks && c.blocks.length)
      ? c.blocks.map(blockXml).join('')
      : `<w:p>${pPr({ align: c.align, after: 0 })}${runXml({ t: c.t == null ? '' : c.t, bold: c.bold, size: c.size })}</w:p>`;
    return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span}${vm}${shd}${va}</w:tcPr>${inner}</w:tc>`;
  };

  const tableXml = (b) => {
    const widths = b.widths || [];
    const bd = (t) => `<w:${t} w:val="single" w:sz="6" w:space="0" w:color="000000"/>`;
    const borders = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(bd).join('')}</w:tblBorders>`;
    const grid = `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
    const rows = (b.rows || []).map(r => {
      let gi = 0;
      const cells = r.map(c => {
        const span = (c && c.gridSpan) || 1;
        let w = 0;
        for (let k = 0; k < span; k++) w += widths[gi + k] || 0;
        gi += span;
        return cellXml(c, w);
      }).join('');
      return `<w:tr><w:trPr>${b.rowHeight ? `<w:trHeight w:val="${b.rowHeight}"/>` : ''}</w:trPr>${cells}</w:tr>`;
    }).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, c) => a + c, 0)}" w:type="dxa"/>`
      + `<w:tblLayout w:type="fixed"/>${borders}</w:tblPr>${grid}${rows}</w:tbl>`
      + '<w:p><w:pPr><w:spacing w:after="0" w:line="120" w:lineRule="auto"/></w:pPr></w:p>';
  };

  const imageXml = (b, rid) => {
    const cx = Math.round((b.w || 200) * EMU), cy = Math.round((b.h || 150) * EMU);
    return `<w:p>${pPr({ align: 'center', before: 80, after: 80 })}<w:r>`
      + `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">`
      + `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${b._id || 1}" name="Picture ${b._id || 1}"/>`
      + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`
      + `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
      + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
      + `<pic:nvPicPr><pic:cNvPr id="${b._id || 1}" name="Picture ${b._id || 1}"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
      + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
      + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
      + `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  };

  const blockXml = (b) => {
    if (!b) return '';
    if (b.type === 'table') return tableXml(b);
    if (b.type === 'image') return imageXml(b, b._rid);
    return paraXml(b);
  };

  // data URI → { ext, mime, bytes }
  const decodeDataUri = (uri) => {
    const m = /^data:([^;]+);base64,(.*)$/.exec(String(uri || ''));
    if (!m) return null;
    const mime = m[1];
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = mime.indexOf('png') >= 0 ? 'png' : (mime.indexOf('gif') >= 0 ? 'gif' : 'jpeg');
    return { ext, mime, bytes };
  };

  const buildParts = (doc) => {
    const blocks = (doc.blocks || []).filter(Boolean);

    // 이미지 파트 수집 + 관계 id 부여
    const media = [];
    blocks.forEach(b => {
      if (b.type !== 'image') return;
      const d = decodeDataUri(b.dataUri);
      if (!d) { b.type = 'skip'; return; }
      const idx = media.length + 1;
      b._rid = 'rId' + (100 + idx);
      b._id = idx;
      media.push({ name: `word/media/image${idx}.${d.ext}`, ext: d.ext, mime: d.mime, data: d.bytes, rid: b._rid });
    });

    const body = blocks.filter(b => b.type !== 'skip').map(blockXml).join('');
    const sectPr = `<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/>`
      + `<w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;

    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}${sectPr}</w:body></w:document>`;

    const exts = Array.from(new Set(media.map(m => m.ext)));
    const defaults = exts.map(e =>
      `<Default Extension="${e}" ContentType="image/${e === 'jpeg' ? 'jpeg' : e}"/>`).join('');
    const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${defaults}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${
      media.map(m => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name.split('/').pop()}"/>`).join('')}</Relationships>`;

    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="40" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;

    const title = escXml(doc.title || '문서');
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${title}</dc:title><dc:creator>우성 품질관리 플랫폼</dc:creator><cp:lastModifiedBy>우성 품질관리 플랫폼</cp:lastModifiedBy></cp:coreProperties>`;

    const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>우성 품질관리 플랫폼</Application></Properties>`;

    const parts = [
      { name: '[Content_Types].xml', data: enc(ct) },
      { name: '_rels/.rels', data: enc(rels) },
      { name: 'docProps/core.xml', data: enc(core) },
      { name: 'docProps/app.xml', data: enc(app) },
      { name: 'word/document.xml', data: enc(document) },
      { name: 'word/styles.xml', data: enc(styles) },
      { name: 'word/_rels/document.xml.rels', data: enc(docRels) },
    ];
    media.forEach(m => parts.push({ name: m.name, data: m.data }));
    return parts;
  };

  const blob = (doc) => {
    // ZIP 저장(STORED) 로직은 xlsx 내보내기와 공유
    const zipStore = WSXlsx._internals.zipStore;
    return new Blob(zipStore(buildParts(doc)),
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  };

  const download = (filename, doc) => {
    const url = URL.createObjectURL(blob(doc));
    const a = document.createElement('a');
    a.href = url;
    a.download = /\.docx$/i.test(filename) ? filename : filename + '.docx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  return { download, blob, CONTENT_W, _internals: { buildParts, decodeDataUri } };
})();

if (typeof window !== 'undefined') window.WSDocx = WSDocx;
if (typeof module !== 'undefined' && module.exports) module.exports = WSDocx;
