// ============================================================
// invoice_scan.js — 입고 송장 스캔 등록
//   스캐너로 받은 송장(JPG·PNG·PDF)을 서버 OCR(/api/ocr)로 읽어 입고 입력칸을 채운다.
//   담당자가 스캔 원본과 대조해 확인한 뒤에만 입고로 등록한다. 인식값을 바로 저장하지 않는다.
//
//   · 협력사·원료는 마스터와 맞춰 고르고, 담당자가 고친 표기는 rm_invoice_alias(동기화)에 기억해 다음부터 바로 맞춘다.
//   · 진행 중 입고예정과 맞는 건이 있으면 새로 만들지 않고 그 건에 반영한다.
//   · 같은 송장을 다시 스캔하면 등록 전에 경고한다.
//   · 스캔 원본은 PhotoStore 로 보관하고 입고 기록에는 메타만 남긴다.
// ============================================================

const InvoiceScan = (() => {
  const ALIAS_KEY = 'rm_invoice_alias';
  const MAX_BYTES = 8 * 1024 * 1024;       // 서버 MAX_FILE_BYTES 와 같아야 한다
  const OWN_RE = /우성/;                   // 공급받는자(자사)는 협력사 후보에서 뺀다
  const PLATE_CHARS = '가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자배하허호';
  const PLATE_REGIONS = '서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주';

  // ── 표시 ──
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // ── 학습 표기 저장 ──
  const readAliases = () => { try { return JSON.parse(localStorage.getItem(ALIAS_KEY) || '[]'); } catch (_) { return []; } };
  const saveAlias = (kind, text, value) => {
    const key = normName(text);
    if (key.length < 2 || !value) return;
    const id = `${kind}:${key}`;
    const list = readAliases().filter(a => a.id !== id);
    list.push({ id, kind, key, value, at: new Date().toISOString() });
    localStorage.setItem(ALIAS_KEY, JSON.stringify(list));
    try { if (window.__onDbWrite) window.__onDbWrite(ALIAS_KEY); } catch (_) {}
  };

  // ── 이름 맞추기 ──
  const normName = (s) => String(s ?? '').normalize('NFKC').toLowerCase()
    .replace(/주식회사|유한회사|합자회사|\(주\)|\(유\)|\(합\)|㈜|㈕|㈔/g, '')
    .replace(/[\s()[\]{}·.,\-_/'"`:;]/g, '');

  const bigrams = (s) => { const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; };
  const dice = (a, b) => {
    if (a.length < 2 || b.length < 2) return 0;
    const x = bigrams(a), y = bigrams(b);
    let hit = 0;
    x.forEach(g => { const i = y.indexOf(g); if (i >= 0) { hit++; y.splice(i, 1); } });
    return (2 * hit) / (a.length + b.length - 2);
  };

  // text 에 가장 가까운 마스터 항목. how = 학습 | 일치 | 포함 | 유사
  const matchMaster = (text, list, aliasMap, idOf) => {
    const t = normName(text);
    if (t.length < 2) return null;
    if (aliasMap[t]) {
      const hit = list.find(x => idOf(x) === aliasMap[t]);
      if (hit) return { item: hit, how: '학습' };
    }
    const named = list.map(x => ({ x, n: normName(x.name) })).filter(o => o.n.length >= 2);
    const exact = named.find(o => o.n === t);
    if (exact) return { item: exact.x, how: '일치' };
    const inside = named.filter(o => o.n.length >= 3 && t.includes(o.n)).sort((a, b) => b.n.length - a.n.length)[0];
    if (inside) return { item: inside.x, how: '포함' };
    const around = t.length >= 3 ? named.filter(o => o.n.includes(t)).sort((a, b) => a.n.length - b.n.length)[0] : null;
    if (around) return { item: around.x, how: '포함' };
    let best = null, score = 0;
    named.forEach(o => { const d = dice(t, o.n); if (d > score) { score = d; best = o.x; } });
    return score >= 0.6 ? { item: best, how: '유사' } : null;
  };

  // ── 쪽별 단어 → 줄·칸 ──
  //   스캔이 기울면 같은 줄의 좌표가 어긋나므로 OCR 이 알려준 각도만큼 되돌린 좌표로 묶는다.
  const toRows = (pages) => {
    const rows = [];
    (pages || []).forEach((page, pageNo) => {
      const rad = -(Number(page.angle) || 0) * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const words = (page.words || []).map(([t, x, y, w, h]) => {
        const cx = x + w / 2, cy = y + h / 2;
        return { t, w, h, x: cx * cos - cy * sin - w / 2, cy: cx * sin + cy * cos };
      }).sort((a, b) => a.cy - b.cy);
      const heights = words.map(w => w.h).sort((a, b) => a - b);
      const unit = heights[Math.floor(heights.length / 2)] || 20;
      const groups = [];
      words.forEach(w => {
        const g = groups[groups.length - 1];
        if (g && Math.abs(g.cy - w.cy) < unit * 0.6) {
          g.cy = (g.cy * g.items.length + w.cy) / (g.items.length + 1);
          g.items.push(w);
        } else groups.push({ cy: w.cy, items: [w] });
      });
      groups.forEach(g => {
        const cells = [];
        g.items.sort((a, b) => a.x - b.x).forEach(w => {
          const c = cells[cells.length - 1];
          if (c && w.x - (c.x + c.w) < unit * 1.5) {
            const glue = w.x - (c.x + c.w) < unit * 0.25 ? '' : ' ';
            c.text += glue + w.t;
            c.w = w.x + w.w - c.x;
          } else cells.push({ text: w.t, x: w.x, w: w.w });
        });
        rows.push({ page: pageNo, cells, text: cells.map(c => c.text).join('  ') });
      });
    });
    return rows;
  };

  // ── 값 해석 ──
  const pad = (n) => String(n).padStart(2, '0');
  const parseDate = (s) => {
    // 구분자를 놓친 2026.1028 같은 인식 결과도 받는다
    const m = String(s).match(/(20\d{2}|\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/) || String(s).match(/(20\d{2})[.\-/]?(\d{2})[.\-/]?(\d{2})/);
    if (!m) return null;
    const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
    const mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  };

  // 중량 → kg. 단위가 없거나 자릿수가 모호하면 warn 을 단다.
  const parseWeight = (s) => {
    const m = String(s).match(/(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(kgs?|㎏|ton|톤|mt|m\/t|t)?(?![a-z가-힣])/i);
    if (!m || m[1] === '0') return null;
    const n = Number(m[1].replace(/,/g, ''));
    if (!n) return null;
    const u = (m[2] || '').toLowerCase();
    if (/^(ton|톤|mt|m\/t|t)$/.test(u)) return { value: Math.round(n * 1000 * 1000) / 1000, unit: u };
    const warn = !u ? '단위가 없어 kg 으로 넣었습니다' : (/\.\d{3}$/.test(m[1]) ? '소수점과 천 단위 쉼표를 확인하세요' : '');
    return { value: n, unit: u || 'kg', warn };
  };

  const parseVehicle = (s) => {
    const t = String(s).replace(/[\s\-·.]/g, '');
    const m = t.match(new RegExp(`(?:(${PLATE_REGIONS})(\\d{2})|(\\d{2,3}))([${PLATE_CHARS}])(\\d{4})(?!\\d)`));
    if (!m) return null;
    return m[1] ? `${m[1]}${m[2]}${m[4]} ${m[5]}` : `${m[3]}${m[4]} ${m[5]}`;
  };

  const parsePhone = (s) => {
    const m = String(s).match(/01[016789][\s\-.]?\d{3,4}[\s\-.]?\d{4}/);
    return m ? m[0].replace(/[\s.]/g, '-') : null;
  };

  const parseCode = (s) => {
    const m = String(s).match(/[A-Za-z0-9][A-Za-z0-9\-_/]{2,}/);
    return m ? m[0] : null;
  };

  const parseName = (s) => {
    const t = String(s).replace(/^[\s:：.\-·=]+/, '').trim();
    if (t.length < 2 || !/[가-힣A-Za-z]/.test(t) || /^[\d,.\s]+$/.test(t)) return null;
    return t;
  };

  // ── 라벨 옆·아래 값 찾기 ──
  const spaced = (label) => label.split('').map(c => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('\\s*');
  // 앞 글자가 붙은 다른 낱말(공차중량의 중량, 제조일자의 일자)과 공급받는자의 공급을 건너뛴다
  const labelRe = (label) => new RegExp(`(?<![가-힣A-Za-z]\\s?)${spaced(label)}(?!받)`, 'i');

  const findByLabel = (rows, labels, accept) => {
    for (const label of labels) {
      const re = labelRe(label);
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        for (let c = 0; c < row.cells.length; c++) {
          const cell = row.cells[c];
          const m = cell.text.match(re);
          if (!m) continue;
          const attempt = (text, rowIndex) => {
            const value = accept(text);
            return value == null ? null : { value, label, raw: String(text).trim().slice(0, 60), rowIndex };
          };
          const tail = cell.text.slice(m.index + m[0].length).replace(/^[\s:：.\-·=]+/, '').slice(0, 40);
          let hit = tail ? attempt(tail, r) : null;
          for (let n = c + 1; !hit && n < Math.min(c + 3, row.cells.length); n++) hit = attempt(row.cells[n].text, r);
          // 표는 값이 라벨 아래 칸에 있다
          for (let d = r + 1; !hit && d < Math.min(r + 4, rows.length); d++) {
            if (rows[d].page !== row.page) break;
            const under = rows[d].cells.find(x => x.x < cell.x + cell.w && cell.x < x.x + x.w);
            if (under) hit = attempt(under.text, d);
          }
          if (hit) return hit;
        }
      }
    }
    return null;
  };

  const LABELS = {
    received: ['입고일자', '입고일', '납품일자', '납품일', '출하일자', '출하일', '출고일자', '출고일', '배송일자', '배송일', '계량일자', '계량일시', '거래일자', '거래일', '발행일자', '발행일', '작성일자', '작성일', '일자', '날짜'],
    made: ['제조일자', '제조년월일', '제조연월일', '제조일', '생산일자', '생산일', 'MFG', 'MFD'],
    expiry: ['유통기한', '소비기한', '사용기한', '품질유지기한', '유효기한', '유효기간', 'EXP'],
    vehicle: ['차량번호', '차량 No', '차번', '차량'],
    weight: ['실중량', '순중량', '정미중량', '납품중량', '입고중량', '출하중량', '출고중량', '납품량', '입고량', '출하량', '톤수', '중량'],
    qty: ['수량', '포수', '포대수', 'QTY', "Q'TY"],
    lot: ['LOT NO', 'LOT NUMBER', 'LOT', '로트번호', '로트', '롯트번호', '롯트', '제조번호', '배치번호', 'BATCH NO', 'BATCH'],
    invoice: ['송장번호', '전표번호', '명세서번호', '문서번호', '계량번호', '증명서번호', '일련번호'],
    driver: ['기사명', '기사성명', '운전자', '운전기사', '기사'],
    material: ['원료명', '품목명', '품명', '품목', '제품명', '상품명'],
    supplier: ['공급자', '공급처', '판매처', '출하처', '발송인', '보내는분', '보내는곳', '업체명', '회사명', '상호'],
    place: ['납품처', '납품장소', '도착지', '하차지', '인수처', '공급받는자'],
  };

  const ANY_LABEL = new RegExp(Object.values(LABELS).flat().filter(l => /[가-힣]/.test(l)).join('|'));

  /** OCR 쪽 정보를 입고 항목으로 해석한다. 값마다 어디서 읽었는지(raw)를 함께 돌려준다. */
  const parse = (pages, master) => {
    const rows = toRows(pages);
    const whole = rows.map(r => r.text).join('\n');
    const flat = normName(whole);
    const aliases = { supplier: {}, material: {} };
    (master.aliases || []).forEach(a => { if (aliases[a.kind]) aliases[a.kind][a.key] = a.value; });
    const suppliers = (master.suppliers || []).filter(s => !OWN_RE.test(s.name || ''));
    const materials = master.materials || [];
    const fields = {};
    const warnings = [];

    // 날짜·차량 등 값 형식이 뚜렷한 항목
    const take = (key, labels, accept) => { const hit = findByLabel(rows, labels, accept); if (hit) fields[key] = hit; return hit; };
    take('receivedDate', LABELS.received, parseDate);
    if (!fields.receivedDate) {
      const first = rows.map(r => parseDate(r.text)).find(Boolean);
      if (first) fields.receivedDate = { value: first, label: '문서의 첫 날짜', raw: first };
    }
    take('manufactureDate', LABELS.made, parseDate);
    take('expiryDate', LABELS.expiry, parseDate);
    take('supplierLot', LABELS.lot, parseCode);
    take('invoiceNo', LABELS.invoice, parseCode);
    take('driverName', LABELS.driver, (s) => {
      const m = String(s).trim().match(/^[가-힣]{2,4}$/);        // 이름 한 칸만 받는다(옆 항목명을 이름으로 읽지 않게)
      return m && !ANY_LABEL.test(m[0]) ? m[0] : null;
    });

    if (!take('vehicleNo', LABELS.vehicle, parseVehicle)) {
      const plate = rows.map(r => parseVehicle(r.text)).find(Boolean);
      if (plate) fields.vehicleNo = { value: plate, label: '번호 형식', raw: plate };
    }
    const phone = parsePhone(whole);
    if (phone) fields.contact = { value: phone, label: '전화번호 형식', raw: phone };

    // 중량: 라벨 → 총중량-공차중량 → 수량×규격 → 문서에서 가장 큰 kg 값
    const weight = take('expectedWeight', LABELS.weight, parseWeight);
    const qty = take('expectedQty', LABELS.qty, (s) => {
      const m = String(s).match(/^\s*([\d,]+(?:\.\d+)?)/);
      return m ? Number(m[1].replace(/,/g, '')) || null : null;
    });
    if (weight) {
      const parsed = weight.value;
      weight.value = parsed.value;
      if (parsed.warn) warnings.push(`중량: ${parsed.warn}`);
    } else {
      const gross = findByLabel(rows, ['총중량'], parseWeight);
      const empty = findByLabel(rows, ['공차중량', '차량중량', '공차'], parseWeight);
      if (gross && empty && gross.value.value > empty.value.value) {
        fields.expectedWeight = { value: gross.value.value - empty.value.value, label: '총중량-공차중량', raw: `${gross.raw} - ${empty.raw}` };
      } else {
        const spec = qty ? String(rows[qty.rowIndex].text).match(/(\d+(?:\.\d+)?)\s*(?:kg|㎏)/i) : null;
        if (spec && qty.value * Number(spec[1]) > 0) {
          fields.expectedWeight = { value: qty.value * Number(spec[1]), label: '수량×규격', raw: `${qty.value} × ${spec[0]}` };
        } else {
          let big = null;
          (whole.match(/[\d,.]+\s*(?:kgs?|㎏|톤|ton|mt)\b/gi) || []).forEach(t => {
            const w = parseWeight(t);
            if (w && (!big || w.value > big.value)) big = { value: w.value, raw: t };
          });
          if (big) {
            fields.expectedWeight = { value: big.value, label: '문서의 가장 큰 중량', raw: big.raw };
            warnings.push('중량: 항목명을 찾지 못해 가장 큰 값을 넣었습니다. 확인하세요');
          }
        }
      }
    }

    // 협력사
    const supplierAlias = (t) => matchMaster(t, suppliers, aliases.supplier, s => s.id);
    const supLabel = findByLabel(rows, LABELS.supplier, (s) => {
      const name = parseName(s);
      return name && !OWN_RE.test(name) ? name : null;
    });
    let supMatch = supLabel ? supplierAlias(supLabel.value) : null;
    let supFrom = supLabel;
    if (!supMatch) {
      // 라벨로 못 찾으면 문서 전체에서 가장 긴 협력사명
      const inDoc = suppliers.map(s => ({ s, n: normName(s.name) }))
        .filter(o => o.n.length >= 3 && flat.includes(o.n)).sort((a, b) => b.n.length - a.n.length)[0];
      if (inDoc) { supMatch = { item: inDoc.s, how: '포함' }; supFrom = { label: '문서 전체', raw: inDoc.s.name }; }
    }
    fields.supplier = {
      value: supMatch ? supMatch.item.name : (supLabel ? supLabel.value : ''),
      id: supMatch ? supMatch.item.id : '',
      how: supMatch ? supMatch.how : '',
      label: supFrom ? supFrom.label : '',
      raw: supFrom ? (supFrom.value || supFrom.raw) : '',
    };

    // 원료
    const matLabel = findByLabel(rows, LABELS.material, parseName);
    let matMatch = matLabel ? matchMaster(matLabel.value, materials, aliases.material, m => m.code) : null;
    let matFrom = matLabel;
    const codeInDoc = (whole.match(/\b44\d{5}\b/g) || []).map(c => materials.find(m => m.code === c)).find(Boolean);
    if (codeInDoc) { matMatch = { item: codeInDoc, how: '코드' }; matFrom = { label: '원료코드', raw: codeInDoc.code }; }
    const named = materials.map(m => ({ m, n: normName(m.name) })).filter(o => o.n.length >= 3 && flat.includes(o.n))
      .sort((a, b) => b.n.length - a.n.length);
    if (!matMatch && named[0]) { matMatch = { item: named[0].m, how: '포함' }; matFrom = { label: '문서 전체', raw: named[0].m.name }; }
    const others = [...new Set(named.map(o => o.m.code))].filter(c => !matMatch || c !== matMatch.item.code);
    if (others.length && named.some(o => matMatch && !normName(matMatch.item.name).includes(o.n) && !o.n.includes(normName(matMatch.item.name)))) {
      warnings.push('품목이 여러 개로 보입니다. 한 건씩 등록하세요');
    }
    const head = rows.findIndex(r => /품\s*[명목]/.test(r.text) && /수\s*량|단\s*가|금\s*액|중\s*량/.test(r.text));
    if (head >= 0) {
      const items = rows.slice(head + 1, head + 30).filter(r => r.page === rows[head].page
        && !/합\s*계|소\s*계|총\s*계/.test(r.text) && r.cells.filter(c => /\d/.test(c.text)).length >= 2);
      if (items.length > 1 && !warnings.some(w => w.startsWith('품목이'))) warnings.push(`품목이 ${items.length}줄로 보입니다. 한 건씩 등록하세요`);
    }
    fields.material = {
      value: matMatch ? matMatch.item.name : '',
      code: matMatch ? matMatch.item.code : '',
      how: matMatch ? matMatch.how : '',
      label: matFrom ? matFrom.label : '',
      raw: matFrom ? (matFrom.value || matFrom.raw) : '',
    };

    // 공장: 납품처 줄에 공장 이름이 있으면 그 공장
    const place = findByLabel(rows, LABELS.place, parseName);
    if (place) {
      const f = (master.factories || []).find(x => String(x.name || '').replace(/공장|사료/g, '').length >= 2
        && place.value.includes(String(x.name).replace(/공장|사료/g, '')));
      if (f) fields.factory = { value: f.id, label: place.label, raw: place.value };
    }

    return { fields, warnings, rows };
  };

  // ── 화면 ──
  let queue = [];          // 처리할 파일
  let index = 0;
  let current = null;      // { file, images, parsed, ms }

  const masters = () => ({
    suppliers: DB.getSuppliers(),
    materials: DB.getMaterials(),
    factories: DB.getFactories(),
    aliases: readAliases(),
  });

  const ensureOverlay = () => {
    let el = document.getElementById('invoice-scan-modal');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'modal-overlay';
    el.id = 'invoice-scan-modal';
    el.innerHTML = `
      <div class="modal modal-xl" style="max-width:1120px;width:96vw">
        <div class="modal-header">
          <div class="modal-title" id="ins-title">송장 스캔 입고</div>
          <button class="modal-close" onclick="InvoiceScan.close()">✕</button>
        </div>
        <div id="ins-body"></div>
      </div>
      <datalist id="ins-supplier-list"></datalist>
      <datalist id="ins-material-list"></datalist>`;
    document.body.appendChild(el);
    return el;
  };

  const showPick = () => {
    document.getElementById('ins-title').textContent = '송장 스캔 입고';
    document.getElementById('ins-body').innerHTML = `
      <div style="padding:20px">
        <label id="ins-drop" style="display:block;border:2px dashed var(--border);border-radius:var(--radius-md);padding:48px 16px;text-align:center;cursor:pointer">
          <div style="font-weight:600;margin-bottom:6px">스캔한 송장 파일을 끌어다 놓거나 눌러서 고르세요</div>
          <div class="text-sm text-muted">JPG, PNG, PDF · 파일당 8MB 이하 · 여러 장 가능</div>
          <input type="file" id="ins-file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" multiple style="display:none">
        </label>
        <div class="form-hint" style="margin-top:10px">스캐너는 300dpi, 흑백 또는 회색조가 잘 읽힙니다. 손글씨는 읽지 못하므로 직접 입력해 주세요.</div>
      </div>`;
    const drop = document.getElementById('ins-drop');
    document.getElementById('ins-file').addEventListener('change', (e) => start(Array.from(e.target.files || [])));
    ['dragover', 'dragenter'].forEach(t => drop.addEventListener(t, (e) => { e.preventDefault(); drop.style.borderColor = 'var(--primary)'; }));
    drop.addEventListener('dragleave', () => { drop.style.borderColor = 'var(--border)'; });
    drop.addEventListener('drop', (e) => { e.preventDefault(); start(Array.from(e.dataTransfer.files || [])); });
  };

  const open = () => {
    ensureOverlay().classList.add('open');
    document.getElementById('ins-supplier-list').innerHTML = DB.getSuppliers().map(s => `<option value="${esc(s.name)}"></option>`).join('');
    document.getElementById('ins-material-list').innerHTML = DB.getMaterials().map(m => `<option value="${esc(m.code)} ${esc(m.name)}"></option>`).join('');
    queue = []; index = 0; current = null;
    showPick();
  };

  const close = () => {
    document.getElementById('invoice-scan-modal')?.classList.remove('open');
    if (current?.url) URL.revokeObjectURL(current.url);
    current = null; queue = [];
  };

  const start = (files) => {
    queue = files.filter(Boolean);
    index = 0;
    if (queue.length) processCurrent();
  };

  const readDataUrl = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('파일을 읽지 못했습니다'));
    r.readAsDataURL(file);
  });

  const dataUrlToFile = async (url, name) => {
    const blob = await (await fetch(url)).blob();
    return new File([blob], name, { type: blob.type || 'image/jpeg' });
  };

  // 컬러 PNG 스캔은 8MB 를 쉽게 넘는다. 이미지는 글자가 뭉개지지 않는 선에서 JPEG 로 줄여 보낸다.
  const shrinkForUpload = async (file) => {
    if (file.size <= MAX_BYTES) return file;
    if (!/^image\//.test(file.type)) throw new Error('PDF 가 8MB 를 넘습니다. 스캔 해상도를 300dpi 로 낮춰 주세요');
    const bitmap = await createImageBitmap(file);
    const k = Math.min(1, 3500 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * k);
    canvas.height = Math.round(bitmap.height * k);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.88));
    if (!blob || blob.size > MAX_BYTES) throw new Error('파일이 너무 큽니다. 스캔 해상도를 300dpi 로 낮춰 주세요');
    return blob;
  };

  const processCurrent = async () => {
    const file = queue[index];
    const title = document.getElementById('ins-title');
    title.textContent = queue.length > 1 ? `송장 스캔 입고 (${index + 1}/${queue.length})` : '송장 스캔 입고';
    document.getElementById('ins-body').innerHTML = `<div style="padding:60px 16px;text-align:center" class="text-muted">${esc(file.name)} 인식 중입니다</div>`;
    try {
      const upload = await shrinkForUpload(file);
      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: await readDataUrl(upload) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !json.ok) {
        throw new Error((json && json.error) || (res.status === 404 ? '이 주소에서는 송장 인식을 쓸 수 없습니다. 사내 서버로 접속해 주세요' : '인식에 실패했습니다'));
      }
      const url = URL.createObjectURL(file);
      const previews = json.pages.map(p => p.preview).filter(Boolean);
      current = { file, url, previews, ms: json.ms, parsed: parse(json.pages, masters()) };
      if (!current.parsed.rows.length) throw new Error('글자를 찾지 못했습니다. 스캔 상태를 확인해 주세요');
      showReview();
    } catch (e) {
      document.getElementById('ins-body').innerHTML = `
        <div style="padding:40px 16px;text-align:center">
          <div style="font-weight:600;margin-bottom:6px">${esc(file.name)}</div>
          <div class="text-muted">${esc(e.message)}</div>
          <div class="modal-footer" style="justify-content:center">
            <button class="btn btn-ghost" onclick="InvoiceScan.skip()">${index + 1 < queue.length ? '다음 파일' : '닫기'}</button>
            <button class="btn btn-primary" onclick="InvoiceScan.retry()">다시 고르기</button>
          </div>
        </div>`;
    }
  };

  const fieldHint = (f) => {
    if (!f || f.value === '' || f.value == null) return `<div class="form-hint" style="color:var(--warning)">인식 못 함 · 직접 입력</div>`;
    const weak = f.how === '유사' || /^문서/.test(f.label || '');
    return `<div class="form-hint" title="${esc(f.raw)}"${weak ? ' style="color:var(--warning)"' : ''}>${weak ? '확인 필요 · ' : ''}${esc(f.label || '')}${f.raw ? ` · ${esc(String(f.raw).slice(0, 26))}` : ''}</div>`;
  };

  const field = (label, id, f, attrs = '', required = false) => `
    <div class="form-group">
      <label class="form-label">${label}${required ? ' <span class="required">*</span>' : ''}</label>
      <input class="form-input" id="${id}" value="${esc(f ? f.value : '')}" ${attrs}>
      ${fieldHint(f)}
    </div>`;

  const dateField = (label, id, f, required = false) => field(label, id, f, 'type="date"', required);

  const openCandidates = (materialCode, supplierId) => {
    if (!materialCode) return [];
    return DB.getReceivings()
      .filter(r => ['QR_ISSUED', 'ARRIVED', 'PENDING_SCALE'].includes(r.status) && r.materialCode === materialCode
        && !r.invoiceScan                                  // 이미 송장이 붙은 건에 덮어쓰지 않는다
        && (!supplierId || !r.supplierId || r.supplierId === supplierId))
      .slice().reverse();
  };

  const renderTargets = () => {
    const box = document.getElementById('ins-targets');
    if (!box) return;
    const code = resolveMaterial()?.code || '';
    const list = openCandidates(code, resolveSupplier()?.id || '');
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <div style="grid-column:1/-1;background:var(--info-bg);border:1px solid var(--info);border-radius:var(--radius-md);padding:10px 14px">
        <div style="font-weight:600;margin-bottom:6px">같은 원료의 진행 중 입고가 있습니다</div>
        ${list.slice(0, 4).map((r, i) => `
          <label style="display:block;margin:4px 0;cursor:pointer">
            <input type="radio" name="ins-target" value="${esc(r.id)}" ${i === 0 ? 'checked' : ''}>
            ${esc(r.preRegId || r.lotNo || r.id)} · ${esc(r.receivedDate || '-')} · ${esc(r.supplierName || '-')} · ${Number(r.expectedWeight || 0).toLocaleString()}kg
          </label>`).join('')}
        <label style="display:block;margin:4px 0;cursor:pointer"><input type="radio" name="ins-target" value=""> 새 입고로 등록</label>
      </div>`;
  };

  const showReview = () => {
    const { fields, warnings } = current.parsed;
    const pick = fields.factory?.value || (App.getFactory?.() === 'ALL' ? '' : App.getFactory?.());
    const isPdf = /pdf/i.test(current.file.type) || /\.pdf$/i.test(current.file.name);
    const images = isPdf ? current.previews : [current.url];
    const material = fields.material;
    const supplier = fields.supplier;
    document.getElementById('ins-body').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;padding:16px;max-height:76vh;overflow:auto">
        <div style="overflow:auto;border:1px solid var(--border);border-radius:var(--radius-md);max-height:72vh;background:var(--bg-input)">
          ${images.map(src => `<img src="${esc(src)}" alt="스캔한 송장" style="width:100%;display:block">`).join('')}
        </div>
        <div style="overflow:auto;max-height:72vh;padding-right:4px">
          ${warnings.length ? `<div style="background:var(--warning-bg);border:1px solid var(--warning);border-radius:var(--radius-md);padding:8px 12px;margin-bottom:12px" class="text-sm">${warnings.map(esc).join('<br>')}</div>` : ''}
          <div class="form-hint" style="margin-bottom:10px">왼쪽 원본과 대조해 확인한 뒤 등록하세요. 항목 아래 작은 글씨가 읽어 온 원문입니다.</div>
          <div class="form-grid" style="gap:12px">
            <div id="ins-targets" style="display:contents"></div>
            <div class="form-group">
              <label class="form-label">입고 공장 <span class="required">*</span></label>
              <select class="form-input" id="ins-factory">
                <option value="">선택</option>
                ${DB.getFactories().map(f => `<option value="${esc(f.id)}" ${f.id === pick ? 'selected' : ''}>${esc(f.name)} (${esc(f.lotCode)})</option>`).join('')}
              </select>
              ${fields.factory ? fieldHint(fields.factory) : ''}
            </div>
            ${dateField('입고일', 'ins-date', fields.receivedDate, true)}
            <div class="form-group" style="grid-column:1/-1">
              <label class="form-label">원료 <span class="required">*</span></label>
              <input class="form-input" id="ins-material" list="ins-material-list" autocomplete="off"
                value="${material.code ? esc(`${material.code} ${material.value}`) : ''}" placeholder="코드 또는 원료명" onchange="InvoiceScan.refreshTargets()">
              ${material.code ? fieldHint(material) : `<div class="form-hint" style="color:var(--warning)">마스터에서 찾지 못함${material.raw ? ` · 원문 ${esc(String(material.raw).slice(0, 30))}` : ''}</div>`}
            </div>
            <div class="form-group" style="grid-column:1/-1">
              <label class="form-label">협력사</label>
              <input class="form-input" id="ins-supplier" list="ins-supplier-list" autocomplete="off"
                value="${esc(supplier.value)}" placeholder="업체명" onchange="InvoiceScan.refreshTargets()">
              ${supplier.id ? fieldHint(supplier) : `<div class="form-hint" style="color:var(--warning)">마스터에서 찾지 못함${supplier.raw ? ` · 원문 ${esc(String(supplier.raw).slice(0, 30))}` : ''}</div>`}
            </div>
            ${field('중량 (kg)', 'ins-weight', fields.expectedWeight, 'type="number" step="0.001" min="0"', true)}
            ${field('수량', 'ins-qty', fields.expectedQty, 'type="number" min="0"')}
            ${field('차량번호', 'ins-vehicle', fields.vehicleNo)}
            ${field('기사', 'ins-driver', fields.driverName)}
            ${field('연락처', 'ins-contact', fields.contact)}
            ${field('송장번호', 'ins-invoice', fields.invoiceNo)}
            ${field('협력사 LOT', 'ins-lot', fields.supplierLot, 'maxlength="60"')}
            ${dateField('제조일', 'ins-made', fields.manufactureDate)}
            ${dateField('유통기한', 'ins-expiry', fields.expiryDate)}
            <div class="form-group" style="grid-column:1/-1">
              <label class="form-label">메모</label>
              <input class="form-input" id="ins-memo">
            </div>
          </div>
          <details style="margin-top:10px">
            <summary class="text-sm text-muted" style="cursor:pointer">인식 원문 보기 (${(current.ms / 1000).toFixed(1)}초)</summary>
            <pre class="text-xs" style="white-space:pre-wrap;margin-top:6px">${esc(current.parsed.rows.map(r => r.text).join('\n'))}</pre>
          </details>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="InvoiceScan.skip()">${index + 1 < queue.length ? '이 파일 건너뛰기' : '취소'}</button>
        <button class="btn btn-primary" id="ins-submit" onclick="InvoiceScan.submit()">확인 후 입고 등록</button>
      </div>`;
    renderTargets();
  };

  const resolveMaterial = () => {
    const raw = document.getElementById('ins-material')?.value.trim() || '';
    if (!raw) return null;
    const code = raw.split(/\s+/)[0];
    return DB.getMaterialByCode(code) || DB.getMaterials().find(m => m.name === raw) || null;
  };

  const resolveSupplier = () => {
    const raw = document.getElementById('ins-supplier')?.value.trim() || '';
    return raw ? (DB.getSuppliers().find(s => s.name === raw) || null) : null;
  };

  const val = (id) => document.getElementById(id)?.value.trim() || '';

  // 같은 송장을 두 번 등록하지 않게 — 송장번호가 같거나, 같은 날 같은 차량·원료·중량이면 중복으로 본다
  const duplicateOf = (d, targetId) => DB.getReceivings().find(r => {
    if (r.id === targetId || r.status === 'CANCELLED') return false;
    if (d.invoiceNo && r.invoiceNo === d.invoiceNo && (r.supplierName || '') === d.supplierName) return true;
    return !!d.vehicleNo && r.vehicleNo === d.vehicleNo && r.materialCode === d.materialCode
      && r.receivedDate === d.receivedDate && Number(r.expectedWeight) === d.expectedWeight;
  });

  const saveScan = async () => {
    const by = typeof Auth !== 'undefined' ? Auth.currentName() : '';
    const isPdf = /pdf/i.test(current.file.type) || /\.pdf$/i.test(current.file.name);
    const source = isPdf
      ? (current.previews[0] ? await dataUrlToFile(current.previews[0], current.file.name.replace(/\.[^.]+$/, '') + '.jpg') : null)
      : current.file;
    return source ? PhotoStore.save(source, { kind: 'INVOICE', by }) : null;
  };

  const submit = async () => {
    const material = resolveMaterial();
    const supplier = resolveSupplier();
    const supplierName = supplier ? supplier.name : val('ins-supplier');
    const factory = val('ins-factory');
    const receivedDate = val('ins-date');
    const expectedWeight = parseFloat(val('ins-weight'));
    if (!factory) { App.toast('입고 공장을 선택해주세요', 'error'); return; }
    if (!material) { App.toast('원료를 목록에서 선택해주세요', 'error'); return; }
    if (!receivedDate) { App.toast('입고일을 입력해주세요', 'error'); return; }
    if (!expectedWeight || expectedWeight <= 0) { App.toast('중량을 입력해주세요', 'error'); return; }

    const targetId = document.querySelector('input[name="ins-target"]:checked')?.value || '';
    const data = {
      materialCode: material.code, materialName: material.name,
      supplierId: supplier ? supplier.id : '', supplierName, supplier: supplierName,
      factory, receivedDate, expectedWeight,
      expectedQty: Number(val('ins-qty')) || 0,
      vehicleNo: val('ins-vehicle'), driverName: val('ins-driver'), contact: val('ins-contact'),
      invoiceNo: val('ins-invoice'), supplierLot: val('ins-lot'),
      manufactureDate: val('ins-made'), expiryDate: val('ins-expiry'),
      memo: val('ins-memo'),
    };
    const dup = duplicateOf(data, targetId);
    if (dup && !window.confirm(`이미 등록된 입고와 겹칩니다.\n${dup.lotNo || dup.id} · ${dup.receivedDate} · ${dup.materialName}\n그래도 등록할까요?`)) return;

    const button = document.getElementById('ins-submit');
    button.disabled = true;
    try {
      const actor = typeof Auth !== 'undefined' ? Auth.currentName() : '';
      data.invoiceScan = await saveScan();
      const arrivalAt = new Date().toISOString();
      if (targetId) {
        const before = DB.getReceivingById(targetId);
        if (before.status === 'QR_ISSUED') DB.processSupplierInbound(targetId, 'ARRIVE', { actor });
        DB.updateReceiving(targetId, { ...data, arrivalAt: before.arrivalAt || arrivalAt });
        DB.addHistory({ refId: targetId, refType: 'RECEIVING', action: '송장 스캔 반영', detail: `${material.name} / 송장 ${expectedWeight}kg${data.vehicleNo ? ` / ${data.vehicleNo}` : ''}`, actor });
      } else {
        DB.addReceiving({
          ...data,
          source: 'INVOICE_SCAN',
          preRegId: DB.generatePreRegId(),
          status: 'PENDING_SCALE',
          lotNo: DB.generateLotNo(material.code, factory),
          arrivalAt,
          createdBy: actor,
        });
      }
      // 담당자가 맞게 고른 표기를 기억해 다음 스캔부터 바로 맞춘다
      const { supplier: sf, material: mf } = current.parsed.fields;
      if (mf.raw && mf.code !== material.code) saveAlias('material', mf.raw, material.code);
      if (sf.raw && supplier && sf.id !== supplier.id) saveAlias('supplier', sf.raw, supplier.id);
      App.toast('입고 등록 완료. 다음은 계근입니다', 'success');
      next();
    } catch (e) {
      button.disabled = false;
      App.toast('등록 실패: ' + e.message, 'error');
    }
  };

  const next = () => {
    if (current?.url) URL.revokeObjectURL(current.url);
    current = null;
    App.refreshPage();
    index += 1;
    if (index < queue.length) processCurrent();
    else close();
  };

  const skip = () => {
    if (current?.url) URL.revokeObjectURL(current.url);
    current = null;
    index += 1;
    if (index < queue.length) processCurrent();
    else close();
  };

  const retry = () => { queue = []; index = 0; current = null; showPick(); };

  return { open, close, skip, retry, submit, parse, refreshTargets: renderTargets };
})();

if (typeof module !== 'undefined') module.exports = InvoiceScan;
