// ============================================================
// lab_xlsx_import.js — 시료접수 엑셀 일괄등록
//   실험실 분석데이터/제품분석 엑셀(.xlsx)을 브라우저에서 직접 읽어(라이브러리 없이)
//   행별 분석건으로 파싱 → 관리자 검토·수정 오버레이 → 결과입력 대기(접수)로 등록.
//   양식: 2행 헤더(접수번호·접수일·코드·시료명/배합비·비고 + 성분열 Moist(%)·Protein-N(%)…)
// ============================================================

const LabImport = (() => {
  // ── 성분 열 헤더(정규화) → 항목 key ──
  //   정규화: 소문자 · % 제거 · 영숫자/한글만 유지 (ppm/ppb/log는 남겨 곰팡이독소 LC 구분)
  const normHead = (h) => String(h || '').toLowerCase().replace(/%/g, '').replace(/[^a-z0-9가-힣]/g, '');
  const HEAD_ALIAS = {
    moist: 'moist', proteinn: 'protein_n', proteink: 'protein', fatee: 'fat', afat: 'afat',
    fiberf: 'fiber', fiber: 'fiber_c', ash: 'ash', ca: 'ca', p: 'p', adf: 'adf', ndf: 'ndf',
    starch: 'starch', koh: 'koh', pd00002: 'pd_0_0002',
    salc: 'sal_c', salpcr: 'sal_pcr', saldgroup: 'sal_d_group',
    coliformlog: 'coliform_log', ecolilog: 'e_coli_log', tbaclog: 't_bac_log',
    aflatppb: 'afla', aflat: 'afla', ochrappb: 'ochra_ppb', vomippm: 'vomi_ppm',
    zearalppm: 'zearal_ppm', fumoppm: 'fumo_ppm', fumonppm: 'fumo_ppm', t2ppb: 't2_ppb',
    aflatlc: 'afla_t_lc', ochraalc: 'ochra_a_lc', zearallcppb: 'zearal_lc_ppb',
    zearallcppm: 'zearal_lc_ppm', vomilcppm: 'vomi_lc_ppm', fumonlcppm: 'fumon_lc_ppm',
    cuppm: 'cu_ppm', znppm: 'zn_ppm', salt: 'salt', sugarinvert: 'sugar_invert',
    gekcalg: 'ge_kcal_g', ehec: 'ehec', listeria: 'listeria', vbn: 'vbn', npn: 'npn',
    ph: 'ph', pov: 'pov', av: 'av', avcheckl: 'av_check_l', aniv: 'ani_v',
    impurity: 'impurity', sgel: 's_gel', ua: 'ua', 반추동물유래동물성단백질: 'x',
    lyspct: 'lys', metpct: 'met', cyspct: 'cys',
  };
  // 메타(비항목) 열
  const META = {
    접수번호: 'srcId', 접수일: 'date', 신청번호: 'reqNo', 요청자: 'by', 코드: 'code',
    시료명: 'name', 배합비: 'formula', 입고일: 'inDate', 공급처: 'supplier', 원산지: 'origin',
    모선명: 'origin', 생산일: 'prodDate', 비고: 'note',
  };
  // NIR 원본(NIR기기 export) 헤더 → 항목 key (대문자 단일 성분명)
  const HEAD_ALIAS_NIR = {
    moisture: 'moist', protein: 'protein_n', afat: 'afat', fat: 'fat', fiber: 'fiber',
    ash: 'ash', ca: 'ca', p: 'p', sgel: 's_gel', adf: 'adf', ndf: 'ndf', starch: 'starch',
    bulkdensity: 'bulk_density', 용적중: 'bulk_density',
  };

  // 항목 key 매핑: 별칭 우선 → 항목 label 정규화 매칭
  let _labelIdx = null;
  const itemKeyOf = (header) => {
    const nh = normHead(header);
    if (HEAD_ALIAS[nh]) return HEAD_ALIAS[nh];
    if (!_labelIdx) {
      _labelIdx = new Map();
      LabDB.getItems().forEach(it => { const k = normHead(it.label); if (k && !_labelIdx.has(k)) _labelIdx.set(k, it.key); });
    }
    return _labelIdx.get(nh) || null;
  };

  // ============================================================
  // (1) 브라우저 XLSX 리더 (라이브러리 없음) — ZIP + DEFLATE + XML
  // ============================================================
  const inflateRaw = async (u8) => {
    if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 엑셀 해제를 지원하지 않습니다(크롬 권장)');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };

  // ZIP 파싱: EOCD → 중앙디렉터리 → {파일명: {method, compSize, offset}}
  const readZip = async (buf) => {
    const dv = new DataView(buf); const u8 = new Uint8Array(buf); const n = buf.byteLength;
    // EOCD 시그니처 0x06054b50 뒤에서부터 탐색
    let eocd = -1;
    for (let i = n - 22; i >= 0 && i >= n - 22 - 65536; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('올바른 xlsx(zip) 파일이 아닙니다');
    const cdCount = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = {};
    const dec = new TextDecoder('utf-8');
    for (let i = 0; i < cdCount; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commLen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      entries[name] = { method, compSize, lho };
      p += 46 + nameLen + extraLen + commLen;
    }
    // 각 엔트리의 실제 데이터: 로컬헤더에서 자기 filename/extra 길이 재확인
    const fileText = async (name) => {
      const e = entries[name]; if (!e) return null;
      const lp = e.lho;
      if (dv.getUint32(lp, true) !== 0x04034b50) throw new Error('zip 로컬헤더 오류: ' + name);
      const lNameLen = dv.getUint16(lp + 26, true);
      const lExtraLen = dv.getUint16(lp + 28, true);
      const dataStart = lp + 30 + lNameLen + lExtraLen;
      const raw = u8.subarray(dataStart, dataStart + e.compSize);
      const out = e.method === 0 ? raw : await inflateRaw(raw);
      return dec.decode(out);
    };
    return { entries, fileText };
  };

  const colOf = (ref) => { const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return 0; let c = 0; for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64); return c - 1; };

  // xlsx → 2차원 배열(행×열). 첫 시트 기준.
  const parseXlsx = async (buf) => {
    const zip = await readZip(buf);
    const parser = new DOMParser();
    // 공유문자열
    let shared = [];
    const ssTxt = await zip.fileText('xl/sharedStrings.xml');
    if (ssTxt) {
      const doc = parser.parseFromString(ssTxt, 'application/xml');
      shared = Array.from(doc.getElementsByTagName('si')).map(si => {
        // <si><t>..</t></si> 또는 여러 <r><t>..</t></r>
        const ts = si.getElementsByTagName('t');
        let s = ''; for (let i = 0; i < ts.length; i++) s += ts[i].textContent;
        return s;
      });
    }
    // 첫 시트 경로: workbook.xml + rels
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wbTxt = await zip.fileText('xl/workbook.xml');
    const relTxt = await zip.fileText('xl/_rels/workbook.xml.rels');
    if (wbTxt && relTxt) {
      const wb = parser.parseFromString(wbTxt, 'application/xml');
      const sheet0 = wb.getElementsByTagName('sheet')[0];
      const rid = sheet0 && (sheet0.getAttribute('r:id') || sheet0.getAttribute('id'));
      if (rid) {
        const rels = parser.parseFromString(relTxt, 'application/xml');
        Array.from(rels.getElementsByTagName('Relationship')).forEach(rel => {
          if (rel.getAttribute('Id') === rid) {
            let t = rel.getAttribute('Target') || '';
            t = t.replace(/^\/?xl\//, '').replace(/^\//, '');
            sheetPath = 'xl/' + t.replace(/^xl\//, '');
          }
        });
      }
    }
    const shTxt = await zip.fileText(sheetPath) || await zip.fileText('xl/worksheets/sheet1.xml');
    if (!shTxt) throw new Error('시트를 찾을 수 없습니다');
    const sh = parser.parseFromString(shTxt, 'application/xml');
    const rowsEl = sh.getElementsByTagName('row');
    const grid = [];
    for (let i = 0; i < rowsEl.length; i++) {
      const cells = rowsEl[i].getElementsByTagName('c');
      const row = [];
      for (let j = 0; j < cells.length; j++) {
        const c = cells[j];
        const ci = colOf(c.getAttribute('r'));
        const t = c.getAttribute('t');
        let v = '';
        if (t === 'inlineStr') { const is = c.getElementsByTagName('t')[0]; v = is ? is.textContent : ''; }
        else { const vEl = c.getElementsByTagName('v')[0]; const raw = vEl ? vEl.textContent : ''; v = t === 's' ? (shared[+raw] || '') : raw; }
        row[ci] = v;
      }
      grid.push(row);
    }
    return grid;
  };

  // ============================================================
  // (2) 파싱된 그리드 → 분석건 배열
  // ============================================================
  const excelDate = (v) => {
    // 엑셀 일련값(숫자) 또는 ISO 문자열 모두 허용
    if (v == null || v === '') return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) return String(v).slice(0, 10);
    const n = Number(v);
    if (!isNaN(n) && n > 20000 && n < 60000) { const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return d.toISOString().slice(0, 10); }
    return String(v);
  };

  // 형식 자동감지 → 화학분석대장(chem) 또는 NIR기기 원본(nir) 파서로 분기
  const buildRows = (grid, kind) => {
    let hr = -1;
    for (let i = 0; i < Math.min(grid.length, 6); i++) {
      const joined = (grid[i] || []).map(x => String(x || '')).join('|');
      if (/시료명|코드|프로덕트|시료 ?번호/.test(joined)) { hr = i; break; }
    }
    if (hr < 0) throw new Error('헤더(시료명·코드 또는 프로덕트·시료번호)를 찾지 못했습니다');
    const header = grid[hr];
    const hjoin = header.map(x => String(x || '')).join('|');
    const isNir = /프로덕트|시료 ?번호/.test(hjoin) || (/moisture/i.test(hjoin) && /protein/i.test(hjoin) && !hjoin.includes('시료명'));
    return isNir ? buildNirRows(grid, hr, header) : buildChemRows(grid, hr, header, kind);
  };

  // 분석대장/성분등록 형식(코드·시료명·성분열) → 화학분석건
  const buildChemRows = (grid, hr, header, kind) => {
    const metaCol = {}; const itemCol = {}; const ignored = [];
    header.forEach((h, ci) => {
      const hh = String(h || '').trim(); if (!hh) return;
      if (META[hh] != null) { metaCol[META[hh]] = ci; return; }
      const key = itemKeyOf(hh);
      if (key) { if (itemCol[key] == null) itemCol[key] = ci; }
      else ignored.push(hh);
    });
    const rows = [];
    for (let r = hr + 1; r < grid.length; r++) {
      const row = grid[r]; if (!row) continue;
      const g = (field) => { const ci = metaCol[field]; return ci == null ? '' : String(row[ci] == null ? '' : row[ci]).trim(); };
      const code = g('code'); const name = g('name');
      if (!code && !name) continue;
      const vals = {};
      Object.keys(itemCol).forEach(key => {
        const raw = row[itemCol[key]];
        if (raw == null || raw === '') return;
        const num = Number(String(raw).replace(/,/g, ''));
        if (!isNaN(num)) vals[key] = num;
      });
      rows.push({
        code, name, formula: g('formula'), supplier: g('supplier'), origin: g('origin'),
        date: excelDate(g('date')) || new Date().toISOString().slice(0, 10),
        prodDate: excelDate(g('prodDate')), note: g('note'), srcId: g('srcId'),
        vals, kind, matched: null,
      });
    }
    return { rows, ignored, itemKeys: Object.keys(itemCol), mode: 'chem' };
  };

  // NIR기기 원본(분석시간·프로덕트이름·시료번호·대문자 성분열) → NIR분석건
  //   프로덕트이름=NIR검량모델(원료는 모델번호=원료코드), 시료번호=자유메모(제품 힌트) → 코드 자동추정 후 검토표에서 확정
  const buildNirRows = (grid, hr, header) => {
    const col = {}; const itemCol = {}; const ignored = [];
    header.forEach((h, ci) => {
      const hh = String(h || '').trim(); if (!hh) return;
      if (hh.includes('분석') && hh.includes('시간')) { col.time = ci; return; }
      if (hh.includes('프로덕트') || hh.includes('제품이름')) { col.model = ci; return; }
      if (hh.includes('시료') && hh.includes('번호')) { col.sample = ci; return; }
      const nh = normHead(hh);
      const key = HEAD_ALIAS_NIR[nh] || itemKeyOf(hh);
      if (key) { if (itemCol[key] == null) itemCol[key] = ci; }
      else ignored.push(hh);
    });
    const rows = [];
    for (let r = hr + 1; r < grid.length; r++) {
      const row = grid[r]; if (!row) continue;
      const model = col.model != null ? String(row[col.model] == null ? '' : row[col.model]).trim() : '';
      const sample = col.sample != null ? String(row[col.sample] == null ? '' : row[col.sample]).trim() : '';
      if (!model && !sample) continue;
      const vals = {};
      Object.keys(itemCol).forEach(key => {
        const raw = row[itemCol[key]];
        if (raw == null || raw === '') return;
        const num = Number(String(raw).replace(/,/g, ''));
        if (!isNaN(num)) vals[key] = num;
      });
      if (!Object.keys(vals).length) continue;
      const date = col.time != null ? excelDate(row[col.time]) : '';
      rows.push({
        model, sample, note: sample, code: '', name: '', kind: 'prod',
        date: date || new Date().toISOString().slice(0, 10),
        vals, matched: null,
      });
    }
    return { rows, ignored, itemKeys: Object.keys(itemCol), mode: 'nir' };
  };

  // 코드/시료명 → 제품(원료) 매칭
  const matchProduct = (row) => {
    const kind = row.kind;
    let m = kind === 'raw' ? LabDB.getMaterialByCode(row.code) : LabDB.getProductByCode(row.code);
    if (m) return { code: m.code, name: m.name, via: '코드', ok: true };
    // 이름 일치 시도
    if (row.name) {
      const list = (kind === 'raw' ? LabDB.getMaterials() : LabDB.getProducts());
      const nn = String(row.name).replace(/\s|-/g, '');
      const hit = list.find(x => String(x.name).replace(/\s|-/g, '') === nn)
        || list.find(x => String(x.name).replace(/\s|-/g, '').includes(nn) && nn.length >= 4);
      if (hit) return { code: hit.code, name: hit.name, via: '시료명', ok: true };
    }
    return { code: row.code, name: row.name, via: '미매칭', ok: false };
  };

  // NIR 코드 자동추정: ① 검량모델번호(4자리)=원료코드 접미 → 원료  ② 시료번호 힌트 → 제품명 매칭
  const nkey = (s) => String(s || '').replace(/^@/, '').replace(/[\s\-\/]/g, '').toLowerCase();
  const rawByModel = (model) => {
    const m = String(model || '').match(/(\d{4})/);   // "2064_압편옥수수" → 2064 → 원료 4402064
    if (!m) return null;
    const suf = m[1];
    const list = LabDB.getMaterials().filter(x => String(x.code).endsWith(suf));
    return list.find(x => String(x.code).length >= 7) || list[0] || null;
  };
  const prodBySample = (sample) => {
    const nn = nkey(sample);
    if (nn.length < 3) return null;
    let best = null, len = 0;
    LabDB.getProducts().forEach(p => {
      const pn = nkey(p.name).replace(/(kg|po|ea|bulk)$/, '');
      if (pn.length >= 4 && nn.includes(pn) && pn.length > len) { best = p; len = pn.length; }
    });
    return best;
  };
  const matchNir = (row) => {
    const raw = rawByModel(row.model);
    if (raw) { row.kind = 'raw'; return { code: raw.code, name: raw.name, via: '원료모델', ok: true }; }
    const p = prodBySample(row.sample);
    if (p) { row.kind = 'prod'; return { code: p.code, name: p.name, via: '시료명', ok: true }; }
    row.kind = 'prod';
    return { code: '', name: row.sample || '', via: '미매칭', ok: false };
  };

  // 관리자 수동 수정용: 입력한 코드 우선(원료/제품 자동판별), 없으면 이름으로 조회
  const resolveManual = (row) => {
    if (row.code) {
      const p = LabDB.getProductByCode(row.code); if (p) { row.kind = 'prod'; return { code: p.code, name: p.name, via: '코드', ok: true }; }
      const m = LabDB.getMaterialByCode(row.code); if (m) { row.kind = 'raw'; return { code: m.code, name: m.name, via: '코드', ok: true }; }
    }
    if (row.name) {
      const nn = nkey(row.name);
      const pp = LabDB.getProducts().find(x => nkey(x.name) === nn) || (nn.length >= 4 && LabDB.getProducts().find(x => nkey(x.name).replace(/(kg|po|ea|bulk)$/, '') === nn));
      if (pp) { row.kind = 'prod'; return { code: pp.code, name: pp.name, via: '시료명', ok: true }; }
      const mm = LabDB.getMaterials().find(x => nkey(x.name) === nn);
      if (mm) { row.kind = 'raw'; return { code: mm.code, name: mm.name, via: '시료명', ok: true }; }
    }
    return { code: row.code || '', name: row.name || '', via: '미매칭', ok: false };
  };

  // ============================================================
  // (3) 검토·수정 오버레이
  // ============================================================
  let staged = null;   // { kind, mode, rows[], itemKeys[], ignored[] }

  const start = async (kind, file) => {
    try {
      App.toast('엑셀을 읽는 중…', 'info', 1500);
      const buf = await file.arrayBuffer();
      const grid = await parseXlsx(buf);
      const built = buildRows(grid, kind);
      const { rows, ignored, itemKeys, mode } = built;
      if (!rows.length) { App.toast('불러올 분석 데이터가 없습니다', 'warning'); return; }
      rows.forEach(r => {
        r.matched = mode === 'nir' ? matchNir(r) : matchProduct(r);
        if (r.matched.ok) { r.code = r.matched.code; r.name = r.matched.name; }
      });
      staged = { kind, mode, rows, itemKeys, ignored };
      openOverlay();
    } catch (e) {
      App.toast('엑셀 읽기 실패: ' + (e.message || e), 'error', 5000);
    }
  };

  const esc2 = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtV = (v) => (v == null || v === '') ? '' : v;

  const openOverlay = () => {
    ensureStyle();
    close();
    const { rows, itemKeys, ignored, mode } = staged;
    const isNir = mode === 'nir';
    const items = itemKeys.map(k => LabDB.getItem(k)).filter(Boolean);
    const headCols = items.map(it => `<th title="${esc2(it.label)}">${esc2(it.label)}${it.unit ? `<br><span class="imp-unit">${esc2(it.unit)}</span>` : ''}</th>`).join('');
    const bodyRows = rows.map((r, ri) => {
      const valCells = items.map(it => {
        const v = r.vals[it.key];
        const verd = (typeof v === 'number') ? LabDB.judge(r.kind, r.code, it.key, v) : 'NA';
        const cls = { HIGH: 'imp-hi', LOW: 'imp-lo', OK: 'imp-ok', NA: '' }[verd] || '';
        return `<td class="imp-num ${cls}"><input type="number" step="any" value="${fmtV(v)}" data-ri="${ri}" data-key="${it.key}" oninput="LabImport.editVal(${ri},'${it.key}',this.value)"></td>`;
      }).join('');
      const badge = r.matched.ok
        ? `<span class="imp-tag imp-tag-ok" title="${esc2(r.matched.via)} 매칭">${esc2(r.matched.via)}</span>`
        : `<span class="imp-tag imp-tag-ng" title="제품을 찾지 못함 — 코드·명칭 확인">미매칭</span>`;
      const kindTag = `<span class="imp-kind ${r.kind}">${r.kind === 'raw' ? '원료' : '제품'}</span>`;
      const modelCell = isNir ? `<td class="imp-model" title="NIR 검량모델: ${esc2(r.model || '')}">
          <div class="imp-model-name">${esc2(r.model || '-')}</div>
          <button class="btn btn-ghost btn-xs" onclick="LabImport.fillModel(${ri})" title="같은 모델의 코드 비어있는 행에 이 코드 채우기">▼ 같은모델 채움</button>
        </td>` : '';
      const dev = rowDev(r);
      return `<tr data-row="${ri}">
        <td class="imp-fix"><input class="imp-idc" value="${esc2(r.code)}" data-ri="${ri}" data-f="code" autocomplete="off" oninput="LabImport.editCell(${ri},'code',this)" onfocus="LabImport.suggest(${ri},'code',this)" onblur="LabImport.blurSuggest()" title="코드·명칭 검색(원료/제품)"></td>
        <td class="imp-nm"><input value="${esc2(r.name)}" data-ri="${ri}" data-f="name" autocomplete="off" oninput="LabImport.editCell(${ri},'name',this)" onfocus="LabImport.suggest(${ri},'name',this)" onblur="LabImport.blurSuggest()" title="코드·명칭 검색(원료/제품)"></td>
        <td>${kindTag}</td>
        <td>${badge}</td>
        <td>${dev}</td>
        ${valCells}
        ${modelCell}
        <td><input class="imp-note" value="${esc2(r.note || '')}" data-ri="${ri}" data-f="note" oninput="LabImport.editMeta(${ri},'note',this.value)"></td>
        <td><button class="btn btn-ghost btn-xs" onclick="LabImport.dropRow(${ri})" title="이 행 제외">✕</button></td>
      </tr>`;
    }).join('');
    const ignoreNote = ignored.length ? `<div class="imp-ignore">※ 매칭되지 않아 제외된 열: ${ignored.map(esc2).join(', ')}</div>` : '';
    const ov = document.createElement('div'); ov.className = 'imp-overlay'; ov.id = 'imp-overlay';
    ov.innerHTML = `
      <div class="imp-box">
        <div class="imp-head">
          <div><b>${isNir ? 'NIR 일괄등록 검토' : '엑셀 일괄등록 검토'}</b>
            <span class="text-muted">${rows.length}건 · ${isNir ? '코드 확인·지정 후' : '값 확인·수정 후'} 등록 (값·코드 편집 가능)</span></div>
          <button class="btn btn-ghost btn-sm" onclick="LabImport.close()">✕ 닫기</button>
        </div>
        ${ignoreNote}
        <div class="imp-scroll">
          <table class="imp-tbl">
            <thead><tr>
              <th class="imp-fix">코드</th><th>시료명</th><th>구분</th><th>매칭</th><th>이탈</th>
              ${headCols}
              ${isNir ? '<th>NIR모델</th>' : ''}
              <th>비고</th><th></th>
            </tr></thead>
            <tbody id="imp-tbody">${bodyRows}</tbody>
          </table>
        </div>
        <div class="imp-foot">
          <span class="text-muted" id="imp-summary">${summaryText()}</span>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" onclick="LabImport.close()">취소</button>
            <button class="btn btn-primary btn-sm" onclick="LabImport.commit()">결과입력 대기로 등록</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);
  };

  const rowDev = (r) => {
    let ng = 0, checked = 0;
    Object.keys(r.vals).forEach(k => {
      const v = LabDB.judge(r.kind, r.code, k, r.vals[k]);
      if (v === 'NA') return; checked++;
      if (v === 'HIGH' || v === 'LOW') ng++;
    });
    if (checked === 0) return '<span class="text-muted" style="font-size:11px">기준없음</span>';
    return ng > 0 ? `<span class="imp-tag imp-tag-ng">${ng}</span>` : `<span class="imp-tag imp-tag-ok">적합</span>`;
  };
  const summaryText = () => {
    const rows = staged.rows.filter(Boolean);
    const matched = rows.filter(r => r.matched.ok || r.code).length;
    const dev = rows.filter(r => Object.keys(r.vals).some(k => { const v = LabDB.judge(r.kind, r.code, k, r.vals[k]); return v === 'HIGH' || v === 'LOW'; })).length;
    const noCode = rows.filter(r => !r.code).length;
    return `총 ${rows.length}건 · 코드지정 ${rows.length - noCode}건 · 코드없음 ${noCode}건 · 이탈 포함 ${dev}건`;
  };
  // 열 순서: [0]코드 [1]시료명 [2]구분 [3]매칭 [4]이탈 [5..]값 ...
  const refreshRow = (ri) => {
    const tr = document.querySelector(`#imp-tbody tr[data-row="${ri}"]`); if (!tr) return;
    const r = staged.rows[ri];
    const cells = tr.children;
    cells[2].innerHTML = `<span class="imp-kind ${r.kind}">${r.kind === 'raw' ? '원료' : '제품'}</span>`;
    cells[3].innerHTML = r.matched.ok
      ? `<span class="imp-tag imp-tag-ok">${esc2(r.matched.via)}</span>`
      : `<span class="imp-tag imp-tag-ng">미매칭</span>`;
    cells[4].innerHTML = rowDev(r);
    const items = staged.itemKeys.map(k => LabDB.getItem(k)).filter(Boolean);
    items.forEach((it, i) => {
      const td = cells[5 + i]; if (!td) return;
      const v = r.vals[it.key];
      const verd = (typeof v === 'number') ? LabDB.judge(r.kind, r.code, it.key, v) : 'NA';
      td.className = 'imp-num ' + ({ HIGH: 'imp-hi', LOW: 'imp-lo', OK: 'imp-ok', NA: '' }[verd] || '');
    });
    const sm = document.getElementById('imp-summary'); if (sm) sm.textContent = summaryText();
  };

  const editVal = (ri, key, value) => {
    const r = staged.rows[ri]; if (!r) return;
    if (value === '' || isNaN(Number(value))) delete r.vals[key]; else r.vals[key] = Number(value);
    refreshRow(ri);
  };
  // 코드·시료명 칸 입력: 값 반영 + 자동조회 + 검색 드롭다운
  const editCell = (ri, field, el) => { editMeta(ri, field, el.value); suggest(ri, field, el); };

  // ── 원료·제품 통합 검색 드롭다운 ──
  const combinedSearch = (q, limit = 14) => {
    const lq = String(q || '').toLowerCase().trim(); if (!lq) return [];
    const nq = nkey(q);
    const out = [];
    const scan = (list, kind) => {
      for (const x of list) {
        const code = String(x.code); const nm = String(x.name);
        if (code.toLowerCase().includes(lq) || nkey(nm).includes(nq)) out.push({ code, name: nm, kind });
        if (out.length >= 200) break;
      }
    };
    scan(LabDB.getProducts(), 'prod');
    scan(LabDB.getMaterials(), 'raw');
    // 코드 정확일치·시작일치 우선 정렬
    out.sort((a, b) => {
      const sa = a.code.toLowerCase() === lq ? 0 : a.code.toLowerCase().startsWith(lq) ? 1 : 2;
      const sb = b.code.toLowerCase() === lq ? 0 : b.code.toLowerCase().startsWith(lq) ? 1 : 2;
      return sa - sb;
    });
    return out.slice(0, limit);
  };
  let _sugEl = null, _sugScrollEl = null, _sugScrollFn = null;
  const closeSuggest = () => {
    if (_sugScrollEl && _sugScrollFn) _sugScrollEl.removeEventListener('scroll', _sugScrollFn);
    _sugScrollEl = _sugScrollFn = null;
    if (_sugEl) { _sugEl.remove(); _sugEl = null; }
  };
  const blurSuggest = () => setTimeout(closeSuggest, 160);
  const suggest = (ri, field, el) => {
    const list = combinedSearch(el.value);
    closeSuggest();
    if (!list.length) return;
    const rect = el.getBoundingClientRect();
    _sugEl = document.createElement('div');
    _sugEl.className = 'imp-sug';
    _sugEl.style.left = rect.left + 'px';
    _sugEl.style.top = (rect.bottom + 2) + 'px';
    _sugEl.style.minWidth = Math.max(rect.width, 280) + 'px';
    _sugEl.innerHTML = list.map(o => `<div class="imp-sug-item" onmousedown="LabImport.pickSuggest(${ri},'${esc2(o.code)}','${o.kind}')">
        <span class="imp-kind ${o.kind}">${o.kind === 'raw' ? '원료' : '제품'}</span>
        <span class="imp-sug-code">${esc2(o.code)}</span>
        <span class="imp-sug-name">${esc2(o.name)}</span>
      </div>`).join('');
    document.body.appendChild(_sugEl);
    // 표 스크롤 시 닫기(위치 어긋남 방지)
    _sugScrollEl = document.querySelector('.imp-scroll');
    if (_sugScrollEl) { _sugScrollFn = () => closeSuggest(); _sugScrollEl.addEventListener('scroll', _sugScrollFn, { passive: true }); }
  };
  const pickSuggest = (ri, code, kind) => {
    const r = staged.rows[ri]; if (!r) { closeSuggest(); return; }
    const rec = kind === 'raw' ? LabDB.getMaterialByCode(code) : LabDB.getProductByCode(code);
    if (!rec) { closeSuggest(); return; }
    r.code = rec.code; r.name = rec.name; r.kind = kind;
    r.matched = { code: rec.code, name: rec.name, via: '검색', ok: true };
    const tr = document.querySelector(`#imp-tbody tr[data-row="${ri}"]`);
    if (tr) { tr.querySelector('.imp-idc').value = rec.code; tr.querySelector('.imp-nm input').value = rec.name; refreshRow(ri); }
    closeSuggest();
  };

  const editMeta = (ri, field, value) => {
    const r = staged.rows[ri]; if (!r) return;
    r[field] = value;
    if (field === 'code' || field === 'name') {
      const m = resolveManual(r);
      r.matched = m;
      if (m.ok) {
        if (field === 'name' && m.code) r.code = m.code;
        if (field === 'code' && m.name) r.name = m.name;
        const idc = r.matched && document.querySelector(`#imp-tbody tr[data-row="${ri}"] .imp-idc`);
        const nmi = document.querySelector(`#imp-tbody tr[data-row="${ri}"] .imp-nm input`);
        if (idc && idc.value !== r.code) idc.value = r.code;
        if (nmi && field === 'code' && nmi.value !== r.name) nmi.value = r.name;
      }
      refreshRow(ri);
    }
  };
  // NIR: 같은 검량모델의 코드 비어있는 행에 이 행의 코드를 일괄 채움 (예: 흑자 40건)
  const fillModel = (ri) => {
    const src = staged.rows[ri];
    if (!src || !src.code) { App.toast('먼저 이 행에 코드를 지정하세요', 'warning'); return; }
    let n = 0;
    staged.rows.forEach((r, i) => {
      if (!r || i === ri || r.code || !r.model || r.model !== src.model) return;
      r.code = src.code; r.name = r.name || src.name; r.kind = src.kind;
      r.matched = { code: src.code, name: src.name, via: '모델일괄', ok: true };
      const tr = document.querySelector(`#imp-tbody tr[data-row="${i}"]`);
      if (tr) { tr.querySelector('.imp-idc').value = src.code; const nmi = tr.querySelector('.imp-nm input'); if (nmi && !nmi.value) nmi.value = src.name; refreshRow(i); }
      n++;
    });
    App.toast(n ? `같은 모델 ${n}건에 코드를 채웠습니다` : '채울 빈 코드 행이 없습니다', n ? 'success' : 'info');
  };
  const dropRow = (ri) => {
    const tr = document.querySelector(`#imp-tbody tr[data-row="${ri}"]`);
    if (tr) tr.remove();
    staged.rows[ri] = null;   // 인덱스 유지(다른 행 data-row 보존)
    const sm = document.getElementById('imp-summary');
    if (sm) { const live = staged.rows.filter(Boolean); sm.textContent = `총 ${live.length}건 (일부 제외됨)`; }
  };

  const commit = () => {
    const live = staged.rows.filter(Boolean);
    if (!live.length) { App.toast('등록할 행이 없습니다', 'warning'); return; }
    const noCode = live.filter(r => !r.code);
    if (noCode.length) { App.toast(`코드가 없는 ${noCode.length}건이 있습니다 — 코드를 지정하거나 ✕로 제외하세요`, 'error', 5000); return; }
    const isNir = staged.mode === 'nir';
    let n = 0;
    live.forEach(r => {
      const items = Object.keys(r.vals);
      LabDB.addRequest({
        kind: r.kind || staged.kind, code: r.code, name: r.name,
        supplier: r.supplier || '', origin: r.origin || '', formula: r.formula || '',
        prodDate: r.prodDate || '', date: r.date, by: r.by || '',
        note: (r.note ? r.note + ' ' : '') + (isNir ? '[NIR일괄]' : '[엑셀일괄]'), priority: '보통',
        category: (r.kind || staged.kind) === 'prod' ? LabDB.productCategory(r.code) : '',
        anaMode: isNir ? 'nir' : 'chem',
        items,
        nirVals: isNir ? r.vals : {},   // NIR은 결과치(NIR)로 · 화학은 결과치(vals)로
        vals: isNir ? {} : r.vals,
        source: isNir ? 'nir-xlsx' : 'xlsx',
      });
      n++;
    });
    close();
    staged = null;
    App.toast(`${n}건을 결과입력 대기로 등록했습니다`, 'success', 3000);
    App.navigate('input');
  };

  const close = () => { closeSuggest(); document.getElementById('imp-overlay')?.remove(); };

  // 파일 선택 → 처리
  const pick = (kind) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx';
    inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) start(kind, f); };
    inp.click();
  };

  const ensureStyle = () => {
    if (document.getElementById('imp-style')) return;
    const st = document.createElement('style'); st.id = 'imp-style';
    st.textContent = `
    .imp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;display:flex;align-items:center;justify-content:center;padding:24px;}
    .imp-box{background:var(--bg-card,#1a1d27);border:1px solid var(--border,#2a2f3d);border-radius:12px;width:min(1200px,96vw);max-height:92vh;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,.5);}
    .imp-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border,#2a2f3d);}
    .imp-ignore{padding:6px 18px;font-size:12px;color:var(--text-muted,#8892a6);background:rgba(255,176,32,.08);}
    .imp-scroll{overflow:auto;flex:1;padding:0 6px;}
    .imp-tbl{border-collapse:separate;border-spacing:0;white-space:nowrap;font-size:12px;}
    .imp-tbl th,.imp-tbl td{border-bottom:1px solid var(--border,#2a2f3d);padding:4px 6px;text-align:center;}
    .imp-tbl thead th{position:sticky;top:0;background:var(--bg-surface,#20242f);color:var(--text-muted,#8892a6);z-index:2;font-weight:600;}
    .imp-unit{font-weight:400;font-size:10px;color:var(--text-muted,#8892a6);}
    .imp-fix{position:sticky;left:0;background:var(--bg-card,#1a1d27);z-index:1;}
    .imp-tbl thead .imp-fix{z-index:3;background:var(--bg-surface,#20242f);}
    .imp-tbl input{background:var(--bg-input,#151821);border:1px solid transparent;border-radius:5px;color:var(--text-primary,#e5e9f0);font-size:12px;padding:3px 5px;width:72px;text-align:center;}
    .imp-tbl input:focus{border-color:var(--accent,#4f9cff);outline:none;}
    .imp-idc{width:78px;font-family:monospace;} .imp-nm input,.imp-nm{min-width:150px;} .imp-nm input{width:150px;text-align:left;} .imp-note{width:120px;text-align:left;}
    .imp-num input{width:64px;}
    .imp-hi input{color:#ff6b81;font-weight:700;} .imp-lo input{color:#ffb020;font-weight:700;} .imp-ok input{color:#48c78e;}
    .imp-tag{display:inline-block;padding:1px 7px;border-radius:9px;font-size:11px;font-weight:700;}
    .imp-tag-ok{color:#0a7d28;background:#e3f7e8;} .imp-tag-ng{color:#c62222;background:#fdeaea;}
    .imp-kind{display:inline-block;padding:1px 7px;border-radius:9px;font-size:10.5px;font-weight:700;}
    .imp-kind.raw{color:#1d6fd6;background:#e4eefb;} .imp-kind.prod{color:#0a7d28;background:#e3f7e8;}
    .imp-model{text-align:left;} .imp-model-name{font-size:11px;color:var(--text-secondary,#c7d0e0);max-width:150px;overflow:hidden;text-overflow:ellipsis;}
    .imp-model .btn{margin-top:2px;font-size:10px;padding:1px 5px;}
    .imp-sug{position:fixed;z-index:10000;max-height:300px;overflow:auto;background:var(--bg-card,#1a1d27);border:1px solid var(--accent,#4f9cff);border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.55);}
    .imp-sug-item{display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;font-size:12px;white-space:nowrap;border-bottom:1px solid var(--border,#2a2f3d);}
    .imp-sug-item:last-child{border-bottom:0;}
    .imp-sug-item:hover{background:var(--bg-hover,#252a37);}
    .imp-sug-code{font-family:monospace;color:var(--text-muted,#8892a6);min-width:66px;}
    .imp-sug-name{color:var(--text-primary,#e5e9f0);overflow:hidden;text-overflow:ellipsis;max-width:280px;}
    .imp-foot{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-top:1px solid var(--border,#2a2f3d);}
    @media (max-width:760px){ .imp-nm input{width:110px;} }`;
    document.head.appendChild(st);
  };

  return { pick, start, editVal, editMeta, editCell, suggest, pickSuggest, blurSuggest, dropRow, fillModel, commit, close,
    // 테스트/디버그용
    _parseXlsx: parseXlsx, _buildRows: buildRows };
})();
