// ============================================================
// db.js — 품질 분석관리 시스템 데이터 레이어 (localStorage)
//   원료/제품 성분분석 결과 · 이력 · 규격(스펙) · 이탈판정
// ============================================================

const LabDB = (() => {
  // ----- 기본 유틸 -----
  const get    = (key)      => JSON.parse(localStorage.getItem(key) || '[]');
  const getObj = (key, def) => { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; };
  const notifyWrite = (key) => { try { if (typeof window !== 'undefined' && window.__onDbWrite) window.__onDbWrite(key); } catch (_) {} };
  const set    = (key, data) => { localStorage.setItem(key, JSON.stringify(data)); notifyWrite(key); };
  const now    = () => new Date().toISOString();
  const toCode = (v) => String(v || '').trim();
  const uuid   = (p) => (p || 'M') + '-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();

  // ----- 인덱스 캐시 (성능) -----
  // 레코드/규격을 매번 스캔·정렬하지 않도록 파생 인덱스를 캐싱한다.
  let _recIdx = null;   // 레코드 파생 인덱스
  let _specCache = null; // 규격 배열 캐시
  let _specIdx = null;   // 규격 조회 인덱스 (kind|item → byCode/global) — 규격 수천 건에서 판정 성능 확보
  const invalidateRecords = () => { _recIdx = null; };
  const invalidateSpecs = () => { _specCache = null; _specIdx = null; };

  // ============================================================
  // 분석 항목 마스터 (canonical)
  // ============================================================
  // appliesTo: 'both' | 'raw' | 'prod'  (원료/제품 구분)
  const DEFAULT_ITEMS = [
    { key: 'moist',   label: '수분',       unit: '%',   group: '일반성분', appliesTo: 'both' },
    { key: 'protein', label: '조단백',     unit: '%',   group: '일반성분', appliesTo: 'both' },
    { key: 'fat',     label: '조지방',     unit: '%',   group: '일반성분', appliesTo: 'both' },
    { key: 'fiber',   label: '조섬유',     unit: '%',   group: '일반성분', appliesTo: 'both' },
    { key: 'ash',     label: '조회분',     unit: '%',   group: '일반성분', appliesTo: 'both' },
    { key: 'starch',  label: '전분',       unit: '%',   group: '일반성분', appliesTo: 'both' },
    { key: 'ca',      label: '칼슘(Ca)',   unit: '%',   group: '무기물', appliesTo: 'both' },
    { key: 'p',       label: '인(P)',      unit: '%',   group: '무기물', appliesTo: 'both' },
    { key: 'salt',    label: '염분',       unit: '%',   group: '무기물', appliesTo: 'both' },
    { key: 'adf',     label: 'ADF',        unit: '%',   group: '섬유질', appliesTo: 'both' },
    { key: 'ndf',     label: 'NDF',        unit: '%',   group: '섬유질', appliesTo: 'both' },
    { key: 'afla',    label: '아플라톡신', unit: 'ppb', group: '유해물질', appliesTo: 'both' },
    { key: 'pb',      label: '납(Pb)',     unit: 'ppm', group: '중금속', appliesTo: 'both' },
    { key: 'as',      label: '비소(As)',   unit: 'ppm', group: '중금속', appliesTo: 'both' },
    { key: 'hg',      label: '수은(Hg)',   unit: 'ppb', group: '중금속', appliesTo: 'both' },
    { key: 'cd',      label: '카드뮴(Cd)', unit: 'ppm', group: '중금속', appliesTo: 'both' },
  ];
  const ITEMS_KEY = 'lab_items';
  let _itemCache = null;
  const invalidateItems = () => { _itemCache = null; };
  const _rawItems = () => {
    if (_itemCache) return _itemCache;
    const stored = getObj(ITEMS_KEY, null);
    _itemCache = (Array.isArray(stored) && stored.length) ? stored : DEFAULT_ITEMS.slice();
    return _itemCache;
  };
  // getItems() → 전체 / getItems('raw'|'prod') → 해당 대상 항목만
  const getItems = (kind) => {
    const all = _rawItems();
    if (kind !== 'raw' && kind !== 'prod') return all;
    return all.filter(i => (i.appliesTo || 'both') === 'both' || i.appliesTo === kind);
  };
  const getItem  = (key) => _rawItems().find(i => i.key === key);
  const itemLabel = (key) => { const i = getItem(key); return i ? i.label : key; };
  const itemUnit  = (key) => { const i = getItem(key); return i ? i.unit : ''; };
  const itemOwner = (key) => { const i = getItem(key); return i && i.owner ? i.owner : ''; };
  const itemAppliesLabel = (a) => a === 'raw' ? '원료' : a === 'prod' ? '제품' : '공통';

  const addItem = (it) => {
    const all = _rawItems().slice();
    let key = String(it.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!key) key = 'it_' + Date.now().toString(36);
    if (all.some(x => x.key === key)) throw new Error('이미 존재하는 항목 키입니다: ' + key);
    const item = {
      key, label: (it.label || key).trim(), unit: (it.unit || '').trim(),
      group: (it.group || '기타').trim(), appliesTo: it.appliesTo || 'both',
      owner: (it.owner || '').trim(), custom: true,
    };
    all.push(item);
    set(ITEMS_KEY, all); invalidateItems(); invalidateRecords();
    return item;
  };
  const updateItem = (key, patch) => {
    const all = _rawItems().slice();
    const i = all.findIndex(x => x.key === key);
    if (i < 0) return null;
    all[i] = { ...all[i], ...patch, key: all[i].key };
    set(ITEMS_KEY, all); invalidateItems(); invalidateRecords();
    return all[i];
  };
  const deleteItem = (key) => {
    set(ITEMS_KEY, _rawItems().filter(x => x.key !== key));
    invalidateItems(); invalidateRecords();
  };
  const itemMaster = () => (typeof window !== 'undefined' && Array.isArray(window.LAB_ITEMS) && window.LAB_ITEMS.length) ? window.LAB_ITEMS.map(i => ({ ...i })) : DEFAULT_ITEMS.slice();
  const seedItems = (force) => {
    const cur = getObj(ITEMS_KEY, null);
    if (!cur) { set(ITEMS_KEY, itemMaster()); invalidateItems(); return; }
    if (!force) return;
    // 마스터 갱신 시 사용자가 추가한 custom 항목은 보존
    const masterKeys = new Set(itemMaster().map(i => i.key));
    const keepCustoms = (Array.isArray(cur) ? cur : []).filter(i => i.custom && !masterKeys.has(i.key));
    set(ITEMS_KEY, itemMaster().concat(keepCustoms)); invalidateItems();
  };

  // ============================================================
  // 원료 / 제품 마스터 (QR시스템과 동일 소스)
  // ============================================================
  const MATERIALS_KEY = 'lab_materials';
  const PRODUCTS_KEY  = 'lab_products';
  const getMaterials = () => get(MATERIALS_KEY);
  const getProducts  = () => get(PRODUCTS_KEY);
  const getMaterialByCode = (code) => getMaterials().find(m => m.code === toCode(code));
  const getProductByCode  = (code) => getProducts().find(p => p.code === toCode(code));
  const nameOf = (kind, code) => {
    const c = toCode(code);
    const hit = kind === 'raw' ? getMaterialByCode(c) : getProductByCode(c);
    return hit ? hit.name : '';
  };
  const searchMaster = (kind, q, limit = 30) => {
    const lq = String(q || '').toLowerCase().trim();
    const list = kind === 'raw' ? getMaterials() : getProducts();
    if (!lq) return list.slice(0, limit);
    return list.filter(m =>
      m.code.toLowerCase().includes(lq) ||
      (m.name || '').toLowerCase().includes(lq) ||
      String(m.formulaCode || '').includes(lq)
    ).slice(0, limit);
  };

  // ── 제품 축종 구분 (양축/양어/반려/기타) ──
  //   매핑: data/productCategories.js (window.WS_PRODUCT_CATEGORIES = {code: '양어'|'반려'})
  //   매핑에 없는 제품은 '양축'이 기본. '기타'는 필터 없이 전체 검색.
  const PROD_CATEGORIES = ['양축', '양어', '반려', '기타'];
  // 표준 스펙리스트 (DoDream 분석요청서 그리드 기준 18항목)
  const STANDARD_SPEC_ITEMS = [
    'moist', 'protein_n', 'protein', 'fat', 'fiber_c', 'fiber', 'ash', 'ca', 'p',
    'as', 'cd', 'f_ppm', 'hg', 'pb', 'se_ppm', 'sal_c', 'sal_d_group', 'afla',
  ];
  // 구분별 기본 체크(CHK) 항목
  const CATEGORY_DEFAULT_ITEMS = {
    '양축': ['moist', 'protein_n', 'fat', 'fiber', 'ash', 'ca', 'p'],
    '양어': ['moist', 'protein_n', 'fat', 'ash', 'ca', 'p', 'av'],
    '반려': ['moist', 'protein_n', 'fat', 'fiber', 'ash', 'ca', 'p', 'sal_c', 'e_coli_log'],
    '기타': ['moist', 'protein_n', 'fat', 'fiber', 'ash'],
  };
  // 접수 화면 스펙리스트: 표준 18항목 + 구분별 추가 항목(적용대상 필터)
  const standardSpecList = (kind, category) => {
    const keys = STANDARD_SPEC_ITEMS.slice();
    if (category === '양어') keys.push('av');
    if (category === '반려') keys.push('e_coli_log');
    return keys.map(getItem).filter(Boolean)
      .filter(it => !kind || (it.appliesTo || 'both') === 'both' || it.appliesTo === kind)
      .map(it => it.key);
  };
  const productCategory = (code) => {
    const map = (typeof window !== 'undefined' && window.WS_PRODUCT_CATEGORIES) || {};
    return map[toCode(code)] || '양축';
  };
  const defaultItemsFor = (category) => (CATEGORY_DEFAULT_ITEMS[category] || []).filter(k => getItem(k));
  const searchProducts = (q, category, limit = 30) => {
    const lq = String(q || '').toLowerCase().trim();
    let list = getProducts();
    if (category && category !== '기타' && category !== '전체') {
      list = list.filter(p => productCategory(p.code) === category);
    }
    if (!lq) return list.slice(0, limit);
    return list.filter(m =>
      m.code.toLowerCase().includes(lq) ||
      (m.name || '').toLowerCase().includes(lq) ||
      String(m.formulaCode || '').includes(lq)
    ).slice(0, limit);
  };

  const loadMaterialsFromJSON = async () => {
    if (getMaterials().length > 0) return;
    try {
      const data = window.WS_RAW_MATERIALS || await (await fetch('./data/rawMaterials.json')).json();
      set(MATERIALS_KEY, data.map(m => ({ code: toCode(m.code), name: m.name || '' })));
    } catch (e) { console.error('[DB] rawMaterials 로드 실패:', e); }
  };
  const loadProductsFromJSON = async () => {
    if (getProducts().length > 0) return;
    try {
      const data = window.WS_PRODUCT_CODES || await (await fetch('./data/productCodes.json')).json();
      set(PRODUCTS_KEY, data.map(p => ({ code: toCode(p.code), name: p.name || '', formulaCode: p.formulaCode || '' })));
    } catch (e) { console.error('[DB] productCodes 로드 실패:', e); }
  };

  // 코드관리 화면에서 발행/수정된 코드를 실험실 마스터에도 반영 (없으면 추가, 있으면 갱신)
  const upsertMasterCode = (kind, entry) => {
    const KEY = kind === 'raw' ? MATERIALS_KEY : PRODUCTS_KEY;
    const list = (kind === 'raw' ? getMaterials() : getProducts()).slice();
    const code = toCode(entry.code);
    if (!code) return null;
    const row = kind === 'raw'
      ? { code, name: entry.name || '' }
      : { code, name: entry.name || '', formulaCode: entry.formulaCode || '' };
    const i = list.findIndex(x => x.code === code);
    if (i >= 0) list[i] = { ...list[i], ...row }; else list.push(row);
    set(KEY, list);
    return row;
  };

  // ============================================================
  // 분석 레코드
  //   { id(접수번호), kind:'raw'|'prod', date, by, code, name,
  //     formula?, supplier?, origin?, inDate?, prodDate?, note?,
  //     vals:{ item:number }, createdAt }
  // ============================================================
  const RECORDS_KEY = 'lab_records';
  const _cmpDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id).localeCompare(String(a.id));

  // ── ERP 분석 raw 임포트(코드 상주, 동기화·localStorage 부담 없이 읽기 시 병합) ──
  //   window.LAB_RAW_IMPORT.records = 과거 분석대장(공장별·담당자·분석치). 라이브(lab_records) id가 우선.
  let _impCache = null;
  const importRecords = () => {
    if (_impCache) return _impCache;
    const src = (typeof window !== 'undefined' && window.LAB_RAW_IMPORT && Array.isArray(window.LAB_RAW_IMPORT.records)) ? window.LAB_RAW_IMPORT.records : [];
    _impCache = src.map(r => ({ ...r, kind: r.kind || 'raw', vals: r.vals || {}, imported: true }));
    return _impCache;
  };
  const setQuiet = (key, data) => { try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { console.warn('[LabDB] setQuiet 실패(용량?)', key, e && e.message); } };
  const DELETED_KEY = 'lab_rec_deleted';   // 임포트 레코드 삭제표시
  const deletedSet = () => { try { return new Set(JSON.parse(localStorage.getItem(DELETED_KEY) || '[]')); } catch (_) { return new Set(); } };

  // 레코드 인덱스: kind별 정렬목록 · 코드별 목록 · 통계밴드(코드·항목) 를 1회 계산
  const buildRecIdx = () => {
    const live = get(RECORDS_KEY);
    const liveIds = new Set(live.map(r => r.id));
    const del = deletedSet();
    const imp = importRecords().filter(r => !liveIds.has(r.id) && !del.has(r.id));   // 라이브 우선, 삭제분 제외
    const all = live.filter(r => !del.has(r.id)).concat(imp);
    const byKind = { raw: [], prod: [] };
    const byCode = new Map();          // `${kind}|${code}` -> records[]
    all.forEach(r => {
      (byKind[r.kind] || (byKind[r.kind] = [])).push(r);
      const k = r.kind + '|' + toCode(r.code);
      if (!byCode.has(k)) byCode.set(k, []);
      byCode.get(k).push(r);
    });
    byKind.raw.sort(_cmpDesc); byKind.prod.sort(_cmpDesc);
    const allSorted = all.slice().sort(_cmpDesc);
    // 통계밴드: 코드·항목별 평균±2σ (표본 5건↑)
    const bands = new Map();           // `${kind}|${code}|${item}` -> band
    const itemsAll = getItems();
    byCode.forEach((recs, k) => {
      itemsAll.forEach(it => {
        const vals = [];
        recs.forEach(r => { const v = r.vals && r.vals[it.key]; if (typeof v === 'number' && !Number.isNaN(v)) vals.push(v); });
        const n = vals.length;
        if (n < 5) return;
        const mean = vals.reduce((a, b) => a + b, 0) / n;
        const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
        bands.set(k + '|' + it.key, {
          n, mean: +mean.toFixed(3), std: +std.toFixed(3),
          min: +(mean - 2 * std).toFixed(3), max: +(mean + 2 * std).toFixed(3),
        });
      });
    });
    _recIdx = { allSorted, byKind, byCode, bands };
    return _recIdx;
  };
  const recIdx = () => _recIdx || buildRecIdx();

  const getRecords = (kind = 'ALL') => {
    const ix = recIdx();
    return kind === 'ALL' ? ix.allSorted : (ix.byKind[kind] || []);
  };
  const getRecordById = (id) => get(RECORDS_KEY).find(r => r.id === id) || importRecords().find(r => r.id === id) || null;
  const getRecordsByCode = (kind, code) => recIdx().byCode.get(kind + '|' + toCode(code)) || [];

  const genReceiptNo = (kind) => {
    const prefix = kind === 'raw' ? 'I' : 'P';
    const y = new Date().getFullYear();
    const pat = `${prefix}-${y}-M`;
    // 접수(lab_requests)와 대장(lab_records) 양쪽에서 최대 순번을 찾는다 (중복 채번 방지)
    let maxSeq = 0;
    get(RECORDS_KEY).concat(get(REQUESTS_KEY)).forEach(r => {
      const id = String(r.id || '');
      if (!id.startsWith(pat)) return;
      const n = parseInt(id.slice(pat.length), 10);
      if (!Number.isNaN(n) && n > maxSeq) maxSeq = n;
    });
    return `${pat}${String(maxSeq + 1).padStart(4, '0')}`;
  };

  const addRecord = (rec) => {
    const all = get(RECORDS_KEY);
    const id = rec.id && toCode(rec.id) ? toCode(rec.id) : genReceiptNo(rec.kind || 'raw');
    const clean = {
      id,
      kind: rec.kind || 'raw',
      date: rec.date || new Date().toISOString().slice(0, 10),
      by: rec.by || '',
      byEmail: rec.byEmail || '',
      factory: rec.factory || '',
      code: toCode(rec.code),
      name: rec.name || nameOf(rec.kind || 'raw', rec.code) || '',
      formula: rec.formula || '',
      supplier: rec.supplier || '',
      origin: rec.origin || '',
      inDate: rec.inDate || '',
      prodDate: rec.prodDate || '',
      note: rec.note || '',
      vals: {},
      nirVals: {},
      // 분석 확정 시점의 기상 각인 (온도·습도·날씨) — 나중에 VOC 원인분석용
      weather: rec.weather || ((typeof window !== 'undefined' && window.Weather && Weather.stamp)
        ? Weather.stamp((typeof App !== 'undefined' && App.getFactory && App.getFactory()) || 'NS') : null),
      createdAt: now(),
      manual: true,
    };
    Object.keys(rec.vals || {}).forEach(k => {
      const n = Number(rec.vals[k]);
      if (rec.vals[k] !== '' && rec.vals[k] != null && !Number.isNaN(n)) clean.vals[k] = n;
    });
    Object.keys(rec.nirVals || {}).forEach(k => {
      const n = Number(rec.nirVals[k]);
      if (rec.nirVals[k] !== '' && rec.nirVals[k] != null && !Number.isNaN(n)) clean.nirVals[k] = n;
    });
    // 동일 접수번호는 갱신 (기상 각인은 최초값 보존)
    const idx = all.findIndex(r => r.id === id);
    if (idx >= 0) all[idx] = { ...all[idx], ...clean, weather: all[idx].weather || clean.weather };
    else all.unshift(clean);
    set(RECORDS_KEY, all);
    invalidateRecords();
    return clean;
  };
  const deleteRecord = (id) => {
    const inLive = get(RECORDS_KEY).some(r => r.id === id);
    set(RECORDS_KEY, get(RECORDS_KEY).filter(r => r.id !== id));
    if (!inLive && importRecords().some(r => r.id === id)) {   // 임포트(코드) 레코드는 삭제표시로 숨김
      const d = Array.from(deletedSet()); d.push(id); setQuiet(DELETED_KEY, d);
    }
    invalidateRecords();
  };

  // 분석대장 값·메타 수정 + 수정이력 기록 (원료/제품 분석대장 편집)
  //   patch: { vals?, nirVals?, name?, note?, supplier?, formula?, origin?, prodDate?, date? }
  const REC_META_LABELS = { name: '시료명', note: '비고', supplier: '공급처', formula: '배합비', origin: '원산지', prodDate: '생산일', date: '접수일' };
  const updateRecord = (id, patch, by, reason, byEmail) => {
    const all = get(RECORDS_KEY);
    let i = all.findIndex(r => r.id === id);
    if (i < 0) {
      // 임포트(코드 상주) 레코드 수정 → 라이브로 복제 후 수정(copy-on-write)
      const imp = importRecords().find(r => r.id === id);
      if (!imp) return null;
      all.push({ ...imp, vals: { ...(imp.vals || {}) }, nirVals: { ...(imp.nirVals || {}) }, manual: true });
      i = all.length - 1;
    }
    const before = all[i];
    const changes = [];   // {field, label, from, to}
    const rec = { ...before, vals: { ...(before.vals || {}) }, nirVals: { ...(before.nirVals || {}) } };
    // 항목값(vals) 변경
    if (patch.vals) {
      Object.keys(patch.vals).forEach(k => {
        const raw = patch.vals[k];
        const oldV = before.vals ? before.vals[k] : undefined;
        if (raw === '' || raw == null) {
          if (oldV !== undefined) { delete rec.vals[k]; changes.push({ field: 'val:' + k, label: itemLabel(k), from: oldV, to: '' }); }
          return;
        }
        const n = Number(raw);
        if (Number.isNaN(n)) return;
        if (n !== oldV) { rec.vals[k] = n; changes.push({ field: 'val:' + k, label: itemLabel(k), from: oldV == null ? '' : oldV, to: n }); }
      });
    }
    // NIR값(nirVals) 변경
    if (patch.nirVals) {
      Object.keys(patch.nirVals).forEach(k => {
        const raw = patch.nirVals[k]; const oldV = before.nirVals ? before.nirVals[k] : undefined;
        if (raw === '' || raw == null) { if (oldV !== undefined) { delete rec.nirVals[k]; changes.push({ field: 'nir:' + k, label: itemLabel(k) + '(NIR)', from: oldV, to: '' }); } return; }
        const n = Number(raw); if (Number.isNaN(n)) return;
        if (n !== oldV) { rec.nirVals[k] = n; changes.push({ field: 'nir:' + k, label: itemLabel(k) + '(NIR)', from: oldV == null ? '' : oldV, to: n }); }
      });
    }
    // 메타 필드 변경
    Object.keys(REC_META_LABELS).forEach(f => {
      if (!(f in patch)) return;
      const to = patch[f] == null ? '' : String(patch[f]);
      const from = before[f] == null ? '' : String(before[f]);
      if (to !== from) { rec[f] = patch[f]; changes.push({ field: f, label: REC_META_LABELS[f], from, to }); }
    });
    if (!changes.length) return before;   // 변경 없음
    rec.editHistory = (before.editHistory || []).concat([{ ts: now(), by: by || '', byEmail: byEmail || '', reason: reason || '', changes }]);
    rec.updatedAt = now();
    all[i] = rec;
    set(RECORDS_KEY, all);
    invalidateRecords();
    return rec;
  };

  // ============================================================
  // 시료 접수 (분석 의뢰 접수 → 결과입력 → 완료 시 분석대장으로 이관)
  //   { id(접수번호), kind:'raw'|'prod', date(접수일), by(신청자), code, name,
  //     formula?, supplier?, origin?, inDate?, prodDate?, note?,
  //     priority:'보통'|'긴급', items:[itemKey...](의뢰항목), vals:{입력중 값},
  //     status:'RECEIVED'|'IN_PROGRESS'|'DONE', createdAt, completedAt? }
  // ============================================================
  const REQUESTS_KEY = 'lab_requests';
  const REQ_STATUS = {
    RECEIVED:    { label: '접수',   cls: 'blue' },
    IN_PROGRESS: { label: '분석중', cls: 'green' },
    DONE:        { label: '완료',   cls: 'gray' },
  };
  const getRequests = (status = 'ALL') => {
    const all = get(REQUESTS_KEY).slice().sort(_cmpDesc);
    if (status === 'ALL') return all;
    if (status === 'OPEN') return all.filter(r => r.status !== 'DONE');
    return all.filter(r => r.status === status);
  };
  const getRequest = (id) => get(REQUESTS_KEY).find(r => r.id === id);
  const addRequest = (req) => {
    const all = get(REQUESTS_KEY);
    const clean = {
      id: genReceiptNo(req.kind || 'raw'),
      kind: req.kind || 'raw',
      date: req.date || new Date().toISOString().slice(0, 10),
      by: req.by || '',
      byEmail: req.byEmail || '',
      factory: req.factory || '',
      code: toCode(req.code),
      name: req.name || nameOf(req.kind || 'raw', req.code) || '',
      formula: req.formula || '',
      supplier: req.supplier || '',
      origin: req.origin || '',
      inDate: req.inDate || '',
      prodDate: req.prodDate || '',
      note: req.note || '',
      priority: req.priority || '보통',
      category: req.category || ((req.kind || 'raw') === 'prod' ? productCategory(req.code) : ''),
      anaMode: req.anaMode || '',   // 분석 구분 (nir/chem)
      items: Array.isArray(req.items) ? req.items.slice() : [],
      vals: {},
      nirVals: {},
      source: req.source || '',     // 접수 출처 (예: 'xlsx' 엑셀 일괄등록)
      status: 'RECEIVED',
      createdAt: now(),
    };
    Object.keys(req.nirVals || {}).forEach(k => {
      const n = Number(req.nirVals[k]);
      if (req.nirVals[k] !== '' && req.nirVals[k] != null && !Number.isNaN(n)) clean.nirVals[k] = n;
    });
    // 결과치 사전입력(엑셀 일괄등록 등) — 숫자만 반영, 결과입력에서 최종확인
    Object.keys(req.vals || {}).forEach(k => {
      const n = Number(req.vals[k]);
      if (req.vals[k] !== '' && req.vals[k] != null && !Number.isNaN(n)) clean.vals[k] = n;
    });
    all.unshift(clean);
    set(REQUESTS_KEY, all);
    return clean;
  };
  const updateRequest = (id, patch) => {
    const all = get(REQUESTS_KEY);
    const i = all.findIndex(r => r.id === id);
    if (i < 0) return null;
    all[i] = { ...all[i], ...patch, id: all[i].id };
    set(REQUESTS_KEY, all);
    return all[i];
  };
  const deleteRequest = (id) => {
    set(REQUESTS_KEY, get(REQUESTS_KEY).filter(r => r.id !== id));
  };
  // 결과입력 완료 → 분석대장(lab_records) 등록 + 접수 상태 DONE
  const completeRequest = (id) => {
    const req = getRequest(id);
    if (!req) throw new Error('접수 건을 찾을 수 없습니다: ' + id);
    const vals = req.vals || {};
    if (!Object.keys(vals).some(k => vals[k] !== '' && vals[k] != null)) {
      throw new Error('입력된 분석값이 없습니다. 값을 1개 이상 입력하세요.');
    }
    const rec = addRecord({
      id: req.id, kind: req.kind, date: req.date, by: req.by, byEmail: req.byEmail, factory: req.factory,
      code: req.code, name: req.name, formula: req.formula,
      supplier: req.supplier, origin: req.origin,
      inDate: req.inDate, prodDate: req.prodDate, note: req.note,
      vals, nirVals: req.nirVals || {},
    });
    updateRequest(id, { status: 'DONE', completedAt: now() });
    return rec;
  };
  const requestStats = () => {
    const all = get(REQUESTS_KEY);
    const received = all.filter(r => r.status === 'RECEIVED').length;
    const inProgress = all.filter(r => r.status === 'IN_PROGRESS').length;
    return { received, inProgress, pending: received + inProgress, done: all.filter(r => r.status === 'DONE').length };
  };

  // ============================================================
  // NIR 신속분석 정확도 (화학분석 대비)
  //   접수 시 입력한 nirVals 와 완료된 화학분석값(vals)을 항목별로 비교
  // ============================================================
  const NIR_TOLERANCE_PCT = 10; // 허용오차 ±10% (조정 가능)
  const nirAccuracyStats = (kind = 'ALL') => {
    const recs = getRecords(kind).filter(r => r.nirVals && Object.keys(r.nirVals).length);
    const byItem = new Map(); // itemKey -> { diffs:[], pcts:[], within }
    recs.forEach(r => {
      Object.keys(r.nirVals).forEach(k => {
        const nir = r.nirVals[k];
        const chem = r.vals ? r.vals[k] : undefined;
        if (typeof nir !== 'number' || typeof chem !== 'number') return;
        if (!byItem.has(k)) byItem.set(k, { diffs: [], pcts: [], within: 0 });
        const o = byItem.get(k);
        const diff = chem - nir;
        const pct = chem !== 0 ? Math.abs(diff) / Math.abs(chem) * 100 : (diff === 0 ? 0 : 100);
        o.diffs.push(diff); o.pcts.push(pct);
        if (pct <= NIR_TOLERANCE_PCT) o.within++;
      });
    });
    const rows = [];
    byItem.forEach((o, key) => {
      const n = o.diffs.length;
      const meanDiff = o.diffs.reduce((a, b) => a + b, 0) / n;
      const meanPct = o.pcts.reduce((a, b) => a + b, 0) / n;
      rows.push({
        item: key, n,
        meanDiff: +meanDiff.toFixed(3),
        meanPct: +meanPct.toFixed(1),
        withinRate: +(o.within / n * 100).toFixed(1),
      });
    });
    rows.sort((a, b) => b.n - a.n);
    const totalN = rows.reduce((s, r) => s + r.n, 0);
    const totalWithin = rows.reduce((s, r) => s + Math.round(r.withinRate / 100 * r.n), 0);
    return { rows, totalN, overallRate: totalN ? +(totalWithin / totalN * 100).toFixed(1) : null, tolerance: NIR_TOLERANCE_PCT };
  };

  // ── 공정기준율 (조단백 기준 · NIR 신속치 대비 화학분석치 비율) ──
  //   출처: 공정기준율 점검 보고 방법론 — 비율 = 화학분석치/NIR치 ×100
  //   Range: 0(99~101) · 1(98~102) · 2(97~103) · 3(96~104) · 4(그 외)
  //   판정: Range 0~1 만족 · 2 의심 · 3~4 불만족 · 공정기준율 비율 = 97~103%(Range≤2) 비중
  const processRate = (nir, chem) => {
    if (typeof nir !== 'number' || typeof chem !== 'number' || nir === 0) return null;
    const rate = chem / nir * 100;
    const range = (rate >= 99 && rate <= 101) ? 0
      : (rate >= 98 && rate <= 102) ? 1
      : (rate >= 97 && rate <= 103) ? 2
      : (rate >= 96 && rate <= 104) ? 3 : 4;
    return { rate: +rate.toFixed(1), range, grade: range <= 1 ? '만족' : range === 2 ? '의심' : '불만족' };
  };
  const processRateStats = (kind = 'ALL') => {
    const rows = [];
    const counts = [0, 0, 0, 0, 0];
    getRecords(kind).forEach(r => {
      if (!r.nirVals) return;
      const nir = r.nirVals.protein_n;
      const chem = r.vals ? r.vals.protein : undefined;   // 화학(Kjeldahl) 조단백만 비교 — NIR 복사값 자기비교 방지
      const pr = processRate(nir, chem);
      if (!pr) return;
      counts[pr.range]++;
      rows.push({ rec: r, nir, chem, ...pr });
    });
    const n = rows.length;
    const okN = counts[0] + counts[1] + counts[2];
    rows.sort((a, b) => String(b.rec.date || '').localeCompare(String(a.rec.date || '')));
    return { rows, n, counts, ratio: n ? +(okN / n * 100).toFixed(1) : null,
      grades: { 만족: counts[0] + counts[1], 의심: counts[2], 불만족: counts[3] + counts[4] } };
  };

  // ============================================================
  // 규격(스펙) — 수동 규격 + 통계밴드 자동
  //   { id, kind:'raw'|'prod'|'ALL', code:''(전체)|'코드', item, min, max, active }
  // ============================================================
  const SPECS_KEY = 'lab_specs';
  const getSpecs = () => (_specCache || (_specCache = get(SPECS_KEY)));
  const addSpec = (s) => {
    const all = getSpecs();
    const spec = {
      id: uuid('SPEC'),
      kind: s.kind || 'ALL',
      code: toCode(s.code),
      item: s.item,
      min: (s.min === '' || s.min == null) ? null : Number(s.min),
      max: (s.max === '' || s.max == null) ? null : Number(s.max),
      active: s.active !== false,
      updatedAt: now(),
    };
    all.push(spec);
    set(SPECS_KEY, all);
    invalidateSpecs();
    return spec;
  };
  const updateSpec = (id, patch) => {
    const all = getSpecs().slice();
    const i = all.findIndex(s => s.id === id);
    if (i < 0) return null;
    all[i] = { ...all[i], ...patch, updatedAt: now() };
    if ('min' in patch) all[i].min = (patch.min === '' || patch.min == null) ? null : Number(patch.min);
    if ('max' in patch) all[i].max = (patch.max === '' || patch.max == null) ? null : Number(patch.max);
    set(SPECS_KEY, all);
    invalidateSpecs();
    return all[i];
  };
  const deleteSpec = (id) => { set(SPECS_KEY, getSpecs().filter(s => s.id !== id)); invalidateSpecs(); };

  // ── 시료접수 그룹 일괄추가: 사용자 정의 그룹 ──
  //   기본값은 항목 마스터의 group 필드에서 시드. 이후 사용자가 자유롭게 추가/수정/삭제.
  const QUICK_GROUPS_KEY = 'lab_quick_groups';
  const defaultQuickGroups = () => {
    const names = ['물리분석', '곰팡이독소', '중금속', '잔류농약', '무기물', '아미노산', '미생물'];
    return names
      .map((g, i) => ({ id: 'QG-' + (i + 1), label: g, items: getItems().filter(it => it.group === g).map(it => it.key) }))
      .filter(g => g.items.length);
  };
  const getQuickGroups = () => {
    const cur = getObj(QUICK_GROUPS_KEY, null);
    if (Array.isArray(cur)) return cur;
    const def = defaultQuickGroups();
    set(QUICK_GROUPS_KEY, def);
    return def;
  };
  const saveQuickGroups = (list) => set(QUICK_GROUPS_KEY, Array.isArray(list) ? list : []);

  // ── 규격 변경 이력 (수정사유 필수 기록) ──
  const SPEC_LOG_KEY = 'lab_spec_log';
  const getSpecLog = () => get(SPEC_LOG_KEY);
  const addSpecLog = (e) => {
    const log = getSpecLog();
    log.push({
      id: uuid('SPLOG'), ts: now(),
      by: e.by || '', reason: e.reason || '', action: e.action || '수정',
      kind: e.kind || '', code: e.code || '', name: e.name || '', item: e.item || '',
      from: e.from || null, to: e.to || null,
    });
    set(SPEC_LOG_KEY, log);
  };

  // ============================================================
  // 원료 매트릭스 기준값 (사용자 지정)
  //   매트릭스는 분석대장에서 자동 집계하지만, 실제 관리기준은 담당자가 정한다.
  //   자동값을 그대로 쓰는 원료가 대부분이므로 "지정한 것만" 저장한다(빈 설정은 삭제).
  //     · months : 이 원료에 적용할 분석치 기간(개월). 없으면 화면 기본값을 쓴다.
  //     · ex     : 평균에서 뺄 분석 레코드. { 레코드id: true } 면 그 건 전체를 빼고,
  //                { 레코드id: ['moist','fat'] } 면 그 항목 값만 뺀다.
  //                기간만으로는 못 거르는 이상치를 담당자가 로우데이터를 보고 직접 뺀다.
  //     · items[항목] = { spec, applyMode, applyDiv }
  //         spec      … SPEC 직접 지정(원료스펙·규격관리보다 우선). 양식의 'n월 SPEC' 상수에 해당.
  //         applyMode … 적용 Matrix 계산식. ''(적용평균 그대로) · 'minus'(적용평균 − 적용편차 ÷ N)
  //         applyDiv  … 편차를 나눌 값 N. 양식은 2(= 편차/2)이지만 원료·항목마다 바꿀 수 있다.
  //   적용 평균·적용 편차는 고른 분석치에서 계산되는 값이라 따로 저장하지 않는다
  //   (양식에서도 AVERAGE·STDEV 수식이고 사람이 값을 박아 넣는 자리가 아니다).
  //   공장별로 관리기준이 다를 수 있어 factory 를 키에 포함한다.
  //   조회는 현재 공장 → 'ALL' 순으로 떨어진다.
  // ============================================================
  const MATRIX_CFG_KEY = 'lab_matrix_config';
  const matrixCfgId = (factory, code) => (factory || 'ALL') + '|' + toCode(code);

  // ── 적용 편차 ──
  //   엑셀 STDEV 과 같은 표본표준편차(n−1). 논산 양식이 이 식 하나만 쓰므로 고르게 두지 않는다.
  const matrixSd = (values) => {
    const arr = (values || []).filter(v => typeof v === 'number' && isFinite(v));
    const n = arr.length;
    if (n < 2) return null;                              // 한 건으로는 흩어진 정도를 말할 수 없다
    const mean = arr.reduce((a, b) => a + b, 0) / n;
    const ss = arr.reduce((s, v) => s + (v - mean) * (v - mean), 0);
    const sd = Math.sqrt(ss / (n - 1));
    return isFinite(sd) ? sd : null;
  };

  // ── 적용 Matrix 계산식 ── 논산 원료Matrix 양식의 '적용 Matrix' 행을 그대로 옮긴 것.
  //   양식에 있는 두 가지뿐이다. 대부분은 적용평균을 그대로 쓰고, 모선마다 단백이 크게
  //   흔들리는 동물성 원료(어분·육골분·갑각류)만 Prot 을 '적용평균 − 적용편차÷N' 으로 낮춰 잡는다.
  const APPLY_DIV = 2;                                   // 양식이 쓰는 기본 나눗값(= 편차/2)
  const APPLY_MODES = [
    { key: '',      label: '적용평균 그대로', expr: '적용평균' },
    { key: 'minus', label: '평균 − 편차 ÷ N', expr: '적용평균 − 적용편차 ÷ N' },
  ];
  const applyMode = (key) => APPLY_MODES.find(m => m.key === (key || '')) || APPLY_MODES[0];
  // 이 항목에 실제로 쓰이는 나눗값 — 지정이 없거나 0 이하면 기본 2
  const applyDivOf = (ic) => {
    const d = ic && Number(ic.applyDiv);
    return (typeof d === 'number' && isFinite(d) && d > 0) ? d : APPLY_DIV;
  };

  // 적용 Matrix 값 계산. 수분이면 100−평균(건물 환산).
  const matrixApply = (ic, mean, dev, isDrymat) => {
    if (isDrymat) return (mean == null) ? null : 100 - mean;
    if (mean == null) return null;
    if (((ic && ic.applyMode) || '') !== 'minus') return mean;
    if (dev == null) return mean;                        // 편차를 못 내면 평균 그대로
    return mean - dev / applyDivOf(ic);
  };

  const getMatrixConfigs = () => get(MATRIX_CFG_KEY);
  // 실제 적용할 설정 — 현재 공장 지정분이 있으면 그것, 없으면 전 공장 공통(ALL)
  const getMatrixConfig = (code, factory) => {
    const all = getMatrixConfigs();
    const c = toCode(code);
    const fac = factory || 'ALL';
    return all.find(x => x.code === c && x.factory === fac)
        || (fac !== 'ALL' ? all.find(x => x.code === c && x.factory === 'ALL') : null)
        || null;
  };
  const matrixItemCfg = (cfg, item) => (cfg && cfg.items && cfg.items[item]) || null;
  // 이 분석 레코드의 이 항목 값을 평균에서 뺄 것인가
  const matrixExcluded = (cfg, recordId, item) => {
    const v = cfg && cfg.ex && cfg.ex[recordId];
    if (!v) return false;
    if (v === true) return true;
    return Array.isArray(v) && v.indexOf(item) >= 0;
  };

  // 빈 값(''·null)은 "지정 안 함"이다. 0 은 유효한 지정값이므로 살린다.
  const cleanNum = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };
  const saveMatrixConfig = (data) => {
    const code = toCode(data.code);
    if (!code) return null;
    const factory = data.factory || 'ALL';
    const items = {};
    // 양식에서 사람이 정하는 건 두 가지뿐이다 — 적용식과 SPEC.
    // 평균·편차는 고른 분석치에서 계산되는 값이라 직접 넣지 않는다.
    Object.keys(data.items || {}).forEach(k => {
      const src = data.items[k] || {};
      const mode = src.applyMode === 'minus' ? 'minus' : '';
      // 나눗값은 minus 일 때만 의미가 있다. 2(기본)와 같으면 저장하지 않아 설정을 가볍게 유지한다.
      const div = mode === 'minus' ? cleanNum(src.applyDiv) : null;
      const one = { spec: cleanNum(src.spec), applyMode: mode };
      if (div != null && div > 0 && div !== APPLY_DIV) one.applyDiv = div;
      if (one.spec != null || one.applyMode) items[k] = one;
    });
    // 제외 목록 — true(레코드 전체) 또는 항목키 배열만 남긴다
    const ex = {};
    Object.keys(data.ex || {}).forEach(rid => {
      const v = data.ex[rid];
      if (v === true) { ex[rid] = true; return; }
      if (Array.isArray(v)) { const list = v.filter(Boolean); if (list.length) ex[rid] = list; }
    });
    const months = cleanNum(data.months);
    const note = String(data.note || '').trim();
    const all = getMatrixConfigs();
    const id = matrixCfgId(factory, code);
    const i = all.findIndex(x => x.id === id);
    // 아무것도 지정하지 않았으면 저장하지 않고 기존 설정을 지운다(자동값으로 복귀)
    if (months == null && !note && !Object.keys(items).length && !Object.keys(ex).length) {
      if (i >= 0) { all.splice(i, 1); set(MATRIX_CFG_KEY, all); }
      return null;
    }
    const rec = {
      id, factory, code, months: months != null && months > 0 ? Math.round(months) : null,
      note, items, ex,
      updatedAt: now(), updatedBy: data.updatedBy || '',
    };
    // 병합이 아니라 통째로 바꾼다. 남겨두면 예전 버전에서 쓰던 필드가 계속 따라다닌다.
    if (i >= 0) all[i] = rec; else all.push(rec);
    set(MATRIX_CFG_KEY, all);
    return rec;
  };
  // ── 논산 원료Matrix 규칙 시드 ──
  //   '논산 원료Matrix(2025년2월)' 배합비SPEC 시트의 적용 Matrix 수식을 그대로 옮긴 것.
  //   73개 원료 블록 중 아래 22종만 Prot 이 '적용평균 − 적용편차/2' 였고 나머지는 평균 그대로다.
  //   같은 동물성이라도 혈분·혈장단백·계란분말·크릴분말·프로타이드는 평균을 그대로 쓴다
  //   (모선별 편차가 작아 낮춰 잡을 이유가 없다) — 축종이 아니라 원료별 판단이라 목록으로 둔다.
  const MATRIX_HALF_SD_CODES = [
    '4405001', '4405002', '4405009', '4405011', '4405012', '4405013', '4405015', '4405016',
    '4405022', '4405023', '4405026', '4405027', '4405029', '4405070',
    '4405080', '4405081', '4405082', '4405083',
    '4405300', '4405305', '4405306', '4405600',
  ];
  const MATRIX_SEED_VERSION = '2026-08-14-nonsan';
  const MATRIX_SEED_KEY = 'lab_matrix_seed_ver';
  const seedMatrixRules = () => {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem(MATRIX_SEED_KEY) === MATRIX_SEED_VERSION) return;
    // 서버가 이미 설정을 내려줬으면 건드리지 않는다(현장에서 고친 값이 되돌아간다)
    if (typeof window !== 'undefined' && window.Sync && Sync.serverHas && Sync.serverHas(MATRIX_CFG_KEY)) {
      try { localStorage.setItem(MATRIX_SEED_KEY, MATRIX_SEED_VERSION); } catch (_) {}
      return;
    }
    const all = getMatrixConfigs();
    let added = 0;
    MATRIX_HALF_SD_CODES.forEach(code => {
      const id = matrixCfgId('ALL', code);
      if (all.some(x => x.id === id)) return;              // 이미 있으면 사용자 설정 우선
      all.push({
        id, factory: 'ALL', code, months: null, note: '', ex: {},
        items: { protein_n: { spec: null, applyMode: 'minus' } },
        updatedAt: now(), updatedBy: '논산 원료Matrix 규칙',
      });
      added++;
    });
    if (added) set(MATRIX_CFG_KEY, all);
    try { localStorage.setItem(MATRIX_SEED_KEY, MATRIX_SEED_VERSION); } catch (_) {}
  };

  const deleteMatrixConfig = (code, factory) => {
    const id = matrixCfgId(factory || 'ALL', code);
    const all = getMatrixConfigs();
    const next = all.filter(x => x.id !== id);
    if (next.length !== all.length) set(MATRIX_CFG_KEY, next);
  };

  // ============================================================
  // 대시보드 사용자 설정 (카드 순서 등) — 사용자별로 저장, 동기화로 단말 간 공유
  //   화면 배치는 개인 취향이라 factory 가 아니라 로그인 계정(email)으로 구분한다.
  //   기록은 레코드 배열(id=email)이라 sync 가 계정 단위로 병합한다 → 다른 PC·현장폰에서도 따라온다.
  // ============================================================
  const DASH_PREFS_KEY = 'dashboard_prefs';
  const dashPrefId = () => {
    try { return (typeof Auth !== 'undefined' && Auth.currentEmail && Auth.currentEmail()) || '__local__'; }
    catch (_) { return '__local__'; }
  };
  const getDashPref = () => {
    const id = dashPrefId();
    return get(DASH_PREFS_KEY).find(x => x.id === id) || null;
  };
  const saveDashPref = (patch) => {
    const id = dashPrefId();
    const all = get(DASH_PREFS_KEY);
    const i = all.findIndex(x => x.id === id);
    let by = '';
    try { by = (typeof Auth !== 'undefined' && Auth.currentName) ? Auth.currentName() : ''; } catch (_) {}
    const rec = Object.assign({ id }, i >= 0 ? all[i] : {}, patch, { updatedAt: now(), updatedBy: by });
    if (i >= 0) all[i] = rec; else all.push(rec);
    set(DASH_PREFS_KEY, all);
    return rec;
  };

  // ============================================================
  // 원료 규격서 (원본 .doc 양식 그대로 — data/rawSpecSheets.js)
  //   원본은 코드 상주(수정 불가), 화면에서 고친 값만 localStorage에 override 로 저장하고
  //   읽을 때 원본 위에 덮어쓴다(copy-on-write). → 원본 복원이 항상 가능.
  // ============================================================
  const SHEET_KEY = 'lab_specsheets';        // { id: {필드부분} } 원본 규격서의 편집분만
  const SHEET_NEW_KEY = 'lab_specsheets_new';// 플랫폼에서 새로 만든 규격서(전체 내용 보관)
  const SHEET_DEL_KEY = 'lab_specsheet_deleted'; // 원본 규격서 삭제표시(id 배열)
  const SHEET_LOG_KEY = 'lab_specsheet_log'; // 개정 이력
  let _sheetCache = null;

  const importSheets = () => {
    if (_sheetCache) return _sheetCache;
    const src = (typeof window !== 'undefined' && window.RAW_SPEC_SHEETS && Array.isArray(window.RAW_SPEC_SHEETS.sheets))
      ? window.RAW_SPEC_SHEETS.sheets : [];
    _sheetCache = src;
    return _sheetCache;
  };
  const sheetOverrides = () => getObj(SHEET_KEY, {}) || {};
  const customSheets = () => get(SHEET_NEW_KEY);
  // 원본 규격서는 코드에 상주해 실제로 지울 수 없으므로 '삭제표시'로 감춘다(복원 가능).
  const sheetDeleted = () => { try { return new Set(JSON.parse(localStorage.getItem(SHEET_DEL_KEY) || '[]')); } catch (_) { return new Set(); } };

  const applyOverride = (s, ov) => {
    const o = ov[s.id];
    if (!o) return s;
    // blocks 는 키 단위로 병합(원본 순서·라벨 유지, 값만 교체)
    const blocks = (s.blocks || []).map(b => (o.blocks && o.blocks[b.k] != null) ? { ...b, v: o.blocks[b.k] } : b);
    return { ...s, ...o, blocks, edited: true };
  };

  // 원본 규격서(임포트) + 신규 작성분. 삭제표시된 건 제외한다.
  const getSpecSheets = () => {
    const ov = sheetOverrides();
    const del = sheetDeleted();
    const imported = importSheets().filter(s => !del.has(s.id)).map(s => applyOverride(s, ov));
    return imported.concat(customSheets().map(s => ({ ...s, custom: true })));
  };
  const getSpecSheet = (id) => getSpecSheets().find(s => s.id === id) || null;

  // 삭제(숨김)된 원본 규격서 목록 — 휴지통 화면에서 복원할 수 있다.
  const getDeletedSpecSheets = () => {
    const ov = sheetOverrides();
    const del = sheetDeleted();
    return importSheets().filter(s => del.has(s.id)).map(s => ({ ...applyOverride(s, ov), deleted: true }));
  };

  const restoreSpecSheet = (id, meta) => {
    const del = sheetDeleted();
    if (!del.has(id)) return false;
    del.delete(id);
    set(SHEET_DEL_KEY, Array.from(del));
    addSpecSheetLog({ sheetId: id, action: '삭제취소', ...(meta || {}) });
    return true;
  };

  // 새 규격서 작성 — 기존 양식(blocks 구성)을 그대로 쓰고 내용만 비운다.
  const addSpecSheet = (data, meta) => {
    const list = customSheets();
    const sheet = {
      id: 'ssU' + Date.now().toString(36),
      file: (data.group || '') + '_' + (data.title || ''),
      group: data.group || '',
      title: data.title || '',
      form: data.form || 'A',
      docNo: data.docNo || '',
      revDate: data.revDate || now().slice(0, 10).replace(/-/g, '. '),
      revNo: data.revNo || '1',
      page: data.page || '',
      headName: data.headName || data.title || '',
      name: data.name || '',
      code: data.code || '',
      blocks: data.blocks || [],
      proximate: data.proximate || null,
      photo: data.photo || '',
      insp: [],
      footer: data.footer || 'WSM-SA-420-02  Rev.2',
      createdAt: now(),
    };
    list.push(sheet);
    set(SHEET_NEW_KEY, list);
    addSpecSheetLog({ sheetId: sheet.id, action: '신규작성', revNo: sheet.revNo, ...(meta || {}) });
    return sheet;
  };

  // 삭제: 신규 작성분은 실제로 지우고(영구), 원본 규격서는 삭제표시로 감춘다(복원 가능).
  const deleteSpecSheet = (id, meta) => {
    const list = customSheets();
    const i = list.findIndex(s => s.id === id);
    if (i >= 0) {
      list.splice(i, 1);
      set(SHEET_NEW_KEY, list);
      addSpecSheetLog({ sheetId: id, action: '삭제', ...(meta || {}) });
      return 'permanent';
    }
    if (!importSheets().some(s => s.id === id)) return false;
    const del = sheetDeleted();
    if (del.has(id)) return false;
    del.add(id);
    set(SHEET_DEL_KEY, Array.from(del));
    addSpecSheetLog({ sheetId: id, action: '삭제', ...(meta || {}) });
    return 'hidden';
  };

  // patch: { docNo, revDate, revNo, page, name, code, photo, proximate, blocks:{키:값} }
  const saveSpecSheet = (id, patch, meta) => {
    // 신규 작성분은 통째로 보관하므로 그 자리에서 갱신
    const cust = customSheets();
    const ci = cust.findIndex(s => s.id === id);
    if (ci >= 0) {
      const s = cust[ci];
      const blocks = patch.blocks
        ? (s.blocks || []).map(b => (patch.blocks[b.k] != null ? { ...b, v: patch.blocks[b.k] } : b))
        : s.blocks;
      cust[ci] = { ...s, ...patch, blocks };
      set(SHEET_NEW_KEY, cust);
      addSpecSheetLog({ sheetId: id, ...(meta || {}) });
      return { ...cust[ci], custom: true };
    }

    const base = importSheets().find(s => s.id === id);
    if (!base) return null;
    const ov = sheetOverrides();
    const cur = ov[id] || {};
    const next = { ...cur, ...patch };
    if (patch.blocks) next.blocks = { ...(cur.blocks || {}), ...patch.blocks };
    // 원본과 같아진 필드는 override에서 제거(불필요한 저장 방지)
    Object.keys(next).forEach(k => {
      if (k !== 'blocks' && JSON.stringify(next[k]) === JSON.stringify(base[k])) delete next[k];
    });
    if (next.blocks) {
      Object.keys(next.blocks).forEach(k => {
        const orig = (base.blocks || []).find(b => b.k === k);
        if (orig && orig.v === next.blocks[k]) delete next.blocks[k];
      });
      if (!Object.keys(next.blocks).length) delete next.blocks;
    }
    if (Object.keys(next).length) ov[id] = next; else delete ov[id];
    set(SHEET_KEY, ov);
    addSpecSheetLog({ sheetId: id, ...(meta || {}) });
    return getSpecSheet(id);
  };

  // 편집분 폐기 → 원본 .doc 내용으로 되돌림
  const resetSpecSheet = (id, meta) => {
    const ov = sheetOverrides();
    delete ov[id];
    set(SHEET_KEY, ov);
    addSpecSheetLog({ sheetId: id, action: '원본복원', ...(meta || {}) });
    return getSpecSheet(id);
  };

  const getSpecSheetLog = (sheetId) => {
    const all = get(SHEET_LOG_KEY);
    const l = sheetId ? all.filter(x => x.sheetId === sheetId) : all;
    return l.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  };
  const addSpecSheetLog = (e) => {
    const log = get(SHEET_LOG_KEY);
    log.push({
      id: uuid('SSLOG'), ts: now(), sheetId: e.sheetId || '',
      by: e.by || '', byEmail: e.byEmail || '', reason: e.reason || '',
      action: e.action || '수정', revNo: e.revNo || '', changes: e.changes || [],
    });
    set(SHEET_LOG_KEY, log);
  };

  // 통계밴드: 특정 kind+code+item 의 평균 ± 2σ (표본 5개 이상일 때) — 인덱스 캐시 사용
  const statBand = (kind, code, item) => recIdx().bands.get(kind + '|' + toCode(code) + '|' + item) || null;

  // 규격 조회 인덱스: kind|item → { byCode: Map(코드→규격), global } — 배열 순서 유지(첫 규격 우선)
  const specIdx = () => {
    if (_specIdx) return _specIdx;
    const idx = new Map();
    getSpecs().forEach(s => {
      if (!s.active || (s.min == null && s.max == null)) return;
      const kinds = s.kind === 'ALL' ? ['raw', 'prod'] : [s.kind];
      kinds.forEach(k => {
        const key = k + '|' + s.item;
        if (!idx.has(key)) idx.set(key, { byCode: new Map(), global: null });
        const o = idx.get(key);
        if (s.code) { const c = toCode(s.code); if (!o.byCode.has(c)) o.byCode.set(c, s); }
        else if (!o.global) o.global = s;
      });
    });
    return (_specIdx = idx);
  };

  // 규격 해석: 수동규격(코드지정 > 전체) → 통계밴드
  const resolveSpec = (kind, code, item) => {
    const o = specIdx().get(kind + '|' + item);
    const hit = o ? (o.byCode.get(toCode(code)) || o.global) : null;
    if (hit) return { min: hit.min, max: hit.max, source: 'manual', specId: hit.id };
    const band = statBand(kind, code, item);
    if (band) return { min: band.min, max: band.max, source: 'stat', band };
    return { min: null, max: null, source: null };
  };

  // 값 판정: OK / HIGH / LOW / NA
  const judge = (kind, code, item, value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return 'NA';
    const sp = resolveSpec(kind, code, item);
    if (sp.source == null) return 'NA';
    if (sp.max != null && value > sp.max) return 'HIGH';
    if (sp.min != null && value < sp.min) return 'LOW';
    return 'OK';
  };

  // 이탈 목록: 모든 레코드 값 중 규격이탈 항목
  const getDeviations = (kind = 'ALL', limit = 200) => {
    const out = [];
    getRecords(kind).forEach(r => {
      Object.keys(r.vals || {}).forEach(item => {
        const v = r.vals[item];
        const verdict = judge(r.kind, r.code, item, v);
        if (verdict === 'HIGH' || verdict === 'LOW') {
          const sp = resolveSpec(r.kind, r.code, item);
          out.push({ rec: r, item, value: v, verdict, spec: sp });
        }
      });
    });
    return out.slice(0, limit);
  };

  // 추세: 특정 코드+항목의 시간순 값
  const getTrend = (kind, code, item) => {
    return getRecordsByCode(kind, code)
      .filter(r => typeof (r.vals && r.vals[item]) === 'number')
      .map(r => ({ id: r.id, date: r.date, value: r.vals[item] }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  };

  // 항목 요약(전체 kind 기준): 표본수/평균/최근값
  const getItemSummary = (kind, item) => {
    const vals = [];
    getRecords(kind).forEach(r => { const v = r.vals && r.vals[item]; if (typeof v === 'number') vals.push(v); });
    const n = vals.length;
    if (!n) return { n: 0 };
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    return { n, mean: +mean.toFixed(2), min: Math.min(...vals), max: Math.max(...vals) };
  };

  // 코드별 요약(분석 이력 화면): 최근 접수일/건수/이탈수
  const getCodeSummaries = (kind) => {
    const map = new Map();
    getRecords(kind).forEach(r => {
      const c = toCode(r.code);
      if (!map.has(c)) map.set(c, { code: c, name: r.name || nameOf(kind, c), count: 0, lastDate: '', dev: 0, formula: r.formula || '' });
      const m = map.get(c);
      m.count++;
      if (String(r.date) > String(m.lastDate)) m.lastDate = r.date;
      Object.keys(r.vals || {}).forEach(item => {
        const vd = judge(kind, c, item, r.vals[item]);
        if (vd === 'HIGH' || vd === 'LOW') m.dev++;
      });
    });
    return [...map.values()].sort((a, b) => String(b.lastDate).localeCompare(String(a.lastDate)));
  };

  // ============================================================
  // 대시보드 통계
  // ============================================================
  const getStats = () => {
    const raw = getRecords('raw');
    const prod = getRecords('prod');
    const devs = getDeviations('ALL', 9999);
    const codes = new Set([...raw, ...prod].map(r => toCode(r.code)));
    // 최근 7종 항목 커버리지
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 864e5).toISOString().slice(0, 10);
    const recentCount = [...raw, ...prod].filter(r => String(r.date) >= weekAgo).length;
    return {
      totalRecords: raw.length + prod.length,
      rawCount: raw.length,
      prodCount: prod.length,
      codeCount: codes.size,
      devCount: devs.length,
      recentCount,
      specCount: getSpecs().filter(s => s.active).length,
    };
  };

  // ============================================================
  // HACCP 문서·위해요소분석·일지·신원료 위해평가 (사료HACCP 디지털화)
  // ============================================================
  const HACCP_DOCS_KEY = 'lab_haccp_docs';
  const HACCP_HA_KEY   = 'lab_haccp_ha';
  const HACCP_LOG_KEY  = 'lab_haccp_logs';
  const NEWMAT_KEY     = 'lab_newmat';

  const DOC_CATEGORIES = ['HACCP관리기준서', '선행요건관리기준서', '제품설명서', '공정흐름도', '위해요소분석', 'CCP관리계획', '위생·교육', '회수·폐기'];
  const LOG_TYPES = ['CCP모니터링', '위생점검', '개선조치', '검증'];
  const HAZARD_DOCS = ['중금속', '곰팡이독소', '잔류농약', '미생물(살모넬라 등)', 'GMO', '방사능', '멜라민', '동물성단백질(반추)'];

  // ── 기준서/문서 ──
  const getHaccpDocs = () => get(HACCP_DOCS_KEY).sort((a, b) => String(a.docNo).localeCompare(String(b.docNo)));
  const getHaccpDoc  = (id) => get(HACCP_DOCS_KEY).find(d => d.id === id);
  const DOC_FIELD_LABELS = { title: '제목', category: '분류', version: '버전', status: '상태', docNo: '문서번호', effDate: '시행일', author: '작성', reviewer: '검토', approver: '승인', body: '본문' };
  const addHaccpDoc  = (d) => {
    const all = get(HACCP_DOCS_KEY);
    const rec = {
      id: uuid('DOC'), docNo: d.docNo || ('WS-DOC-' + String(all.length + 1).padStart(2, '0')),
      title: d.title || '', category: d.category || DOC_CATEGORIES[0], version: d.version || '1.0',
      effDate: d.effDate || new Date().toISOString().slice(0, 10), revDate: d.revDate || '',
      author: d.author || '', reviewer: d.reviewer || '', approver: d.approver || '',
      status: d.status || '유효', body: d.body || '',
      attachments: [], history: [{ ts: now(), action: '생성', by: d.author || '-', detail: '문서 생성' }],
      updatedAt: now(),
    };
    all.push(rec); set(HACCP_DOCS_KEY, all); return rec;
  };
  const updateHaccpDoc = (id, patch, by) => {
    const all = get(HACCP_DOCS_KEY);
    const i = all.findIndex(x => x.id === id);
    if (i < 0) return null;
    const before = all[i];
    // 변경된 필드 감지(첨부/이력/시스템 필드 제외)
    const changes = Object.keys(patch)
      .filter(k => DOC_FIELD_LABELS[k] && String(before[k] == null ? '' : before[k]) !== String(patch[k] == null ? '' : patch[k]))
      .map(k => DOC_FIELD_LABELS[k]);
    all[i] = { ...before, ...patch, updatedAt: now() };
    if (changes.length) {
      all[i].history = (before.history || []).concat([{ ts: now(), action: '수정', by: by || patch.author || before.author || '-', detail: changes.join(', ') + ' 변경' }]);
      all[i].seeded = false;   // 사용자가 편집한 문서는 향후 시드 교체 대상에서 제외(보존)
    }
    set(HACCP_DOCS_KEY, all);
    return all[i];
  };
  const deleteHaccpDoc = (id) => set(HACCP_DOCS_KEY, get(HACCP_DOCS_KEY).filter(x => x.id !== id));

  // ── 문서 첨부파일 메타 (실제 바이너리는 FileStore(IndexedDB)에 별도 저장) ──
  const addDocAttachment = (docId, meta, by) => {
    const all = get(HACCP_DOCS_KEY);
    const i = all.findIndex(x => x.id === docId);
    if (i < 0) return null;
    all[i].attachments = (all[i].attachments || []).concat([meta]);
    all[i].history = (all[i].history || []).concat([{ ts: now(), action: '첨부', by: by || all[i].author || '-', detail: `파일 첨부: ${meta.name}` }]);
    all[i].seeded = false;   // 파일 첨부한 문서는 향후 시드 교체 대상에서 제외(첨부 보존)
    all[i].updatedAt = now();
    set(HACCP_DOCS_KEY, all);
    return all[i];
  };
  const removeDocAttachment = (docId, attId, by) => {
    const all = get(HACCP_DOCS_KEY);
    const i = all.findIndex(x => x.id === docId);
    if (i < 0) return null;
    const att = (all[i].attachments || []).find(a => a.id === attId);
    all[i].attachments = (all[i].attachments || []).filter(a => a.id !== attId);
    all[i].history = (all[i].history || []).concat([{ ts: now(), action: '첨부삭제', by: by || all[i].author || '-', detail: `파일 삭제: ${att ? att.name : attId}` }]);
    all[i].updatedAt = now();
    set(HACCP_DOCS_KEY, all);
    return all[i];
  };

  // ── 위해요소분석(HA) ──
  const getHA = () => get(HACCP_HA_KEY).sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const addHA = (h) => {
    const all = get(HACCP_HA_KEY);
    const sev = Number(h.severity) || 1, like = Number(h.likelihood) || 1;
    const rec = { id: uuid('HA'), seq: all.length + 1, step: h.step || '', stepType: h.stepType || '공정', hazardType: h.hazardType || 'B', hazard: h.hazard || '', cause: h.cause || '', severity: sev, likelihood: like, risk: sev * like, control: h.control || '', isCCP: !!h.isCCP, ccpNo: h.ccpNo || '' };
    all.push(rec); set(HACCP_HA_KEY, all); return rec;
  };
  const updateHA = (id, patch) => { const all = get(HACCP_HA_KEY); const i = all.findIndex(x => x.id === id); if (i < 0) return null; all[i] = { ...all[i], ...patch }; all[i].risk = (Number(all[i].severity) || 1) * (Number(all[i].likelihood) || 1); set(HACCP_HA_KEY, all); return all[i]; };
  const deleteHA = (id) => set(HACCP_HA_KEY, get(HACCP_HA_KEY).filter(x => x.id !== id));

  // ── 일지 ──
  const getHaccpLogs = (type = 'ALL') => { const all = get(HACCP_LOG_KEY); const l = type === 'ALL' ? all : all.filter(x => x.type === type); return l.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt))); };
  const addHaccpLog = (l) => {
    const all = get(HACCP_LOG_KEY);
    const rec = { id: uuid('LOG'), type: l.type || 'CCP모니터링', date: l.date || new Date().toISOString().slice(0, 10), by: l.by || '', target: l.target || '', value: l.value || '', judged: l.judged || '-', memo: l.memo || '', action: l.action || '', createdAt: now() };
    all.unshift(rec); set(HACCP_LOG_KEY, all); return rec;
  };
  const deleteHaccpLog = (id) => set(HACCP_LOG_KEY, get(HACCP_LOG_KEY).filter(x => x.id !== id));

  // ── 신원료 위해평가 ──
  const getNewMats = () => get(NEWMAT_KEY).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const getNewMat = (id) => get(NEWMAT_KEY).find(x => x.id === id);
  const addNewMat = (m) => {
    const all = get(NEWMAT_KEY);
    const rec = {
      id: uuid('NM'), code: toCode(m.code), name: m.name || nameOf('raw', m.code), supplier: m.supplier || '', origin: m.origin || '', use: m.use || '',
      bio: m.bio || { hazard: '', assess: '', control: '' }, chem: m.chem || { hazard: '', assess: '', control: '' }, phys: m.phys || { hazard: '', assess: '', control: '' },
      docsNeeded: m.docsNeeded || [], verdict: m.verdict || '검토중', assessor: m.assessor || '', approver: m.approver || '', date: m.date || new Date().toISOString().slice(0, 10), note: m.note || '',
    };
    all.unshift(rec); set(NEWMAT_KEY, all); return rec;
  };
  const updateNewMat = (id, patch) => { const all = get(NEWMAT_KEY); const i = all.findIndex(x => x.id === id); if (i < 0) return null; all[i] = { ...all[i], ...patch }; set(NEWMAT_KEY, all); return all[i]; };
  const deleteNewMat = (id) => set(NEWMAT_KEY, get(NEWMAT_KEY).filter(x => x.id !== id));

  // ── 유효성 평가(Validation) — 실제 우성사료 논산 유효성평가 항목 ──
  const VALIDATION_KEY = 'lab_validations';
  const VALIDATION_CATEGORIES = ['모의회수', 'CCP검증', '소독·살균', '이물관리', '설비검증', '외부심사', '용기·포장'];
  const getValidations = () => get(VALIDATION_KEY).sort((a, b) => (a.no || 0) - (b.no || 0));
  const getValidation = (id) => get(VALIDATION_KEY).find(x => x.id === id);
  const addValidation = (v) => {
    const all = get(VALIDATION_KEY);
    const rec = {
      id: uuid('VAL'), no: v.no || (all.length + 1), name: v.name || '', category: v.category || VALIDATION_CATEGORIES[0],
      cycle: v.cycle || '연1회', lastDate: v.lastDate || '', nextDate: v.nextDate || '', result: v.result || '진행중',
      factory: v.factory || 'NS', evidence: v.evidence || '', note: v.note || '', seeded: !!v.seeded, updatedAt: now(),
      // 관련 서류(성적서·보고서) — 원본은 PhotoStore 가 서버/IndexedDB 에 두고 여기엔 메타만
      files: Array.isArray(v.files) ? v.files : [],
    };
    all.push(rec); set(VALIDATION_KEY, all); return rec;
  };
  const updateValidation = (id, patch) => {
    const all = get(VALIDATION_KEY); const i = all.findIndex(x => x.id === id); if (i < 0) return null;
    const before = { ...all[i] };
    all[i] = { ...all[i], ...patch };
    if (typeof window !== 'undefined' && window.AuditLog) AuditLog.record(all[i], before, {
      name: '항목명', category: '분류', cycle: '주기', method: '방법', result: '결과',
      lastDate: '최근일', nextDate: '차기일', owner: '담당', note: '비고',
    }, { by: patch.updatedBy });
    else all[i].updatedAt = now();
    set(VALIDATION_KEY, all); return all[i];
  };
  const deleteValidation = (id) => set(VALIDATION_KEY, get(VALIDATION_KEY).filter(x => x.id !== id));
  const validationSummary = () => {
    const all = getValidations();
    return {
      total: all.length,
      pass: all.filter(v => v.result === '적합').length,
      fail: all.filter(v => v.result === '부적합').length,
      ongoing: all.filter(v => v.result === '진행중').length,
    };
  };

  const haccpSummary = () => {
    const ha = getHA();
    return {
      docCount: get(HACCP_DOCS_KEY).length,
      ccpCount: ha.filter(h => h.isCCP).length,
      haCount: ha.length,
      sigCount: ha.filter(h => h.risk >= 6).length,
      logCount: get(HACCP_LOG_KEY).length,
      failLogCount: get(HACCP_LOG_KEY).filter(l => l.judged === '부적합').length,
      newMatOpen: getNewMats().filter(m => m.verdict === '검토중').length,
      newMatCount: getNewMats().length,
      validationCount: getValidations().length,
    };
  };

  // ── HACCP 시드 (우성사료 논산공장 실제 문서체계 기준) ──
  //   실제 파일: D:\담당자(품질)\HACCP\2026 HACCP\* (문서번호 DOC-N-xxx, CCP 계획 V36)
  //   seeded:true 마커를 붙여 버전 변경 시 시드분만 교체, 사용자 추가분(마커 없음)은 보존.
  const HACCP_SEED_VERSION = '2026-08-14-seedid';  // 시드 id 를 단말 무관 고정값으로 전환(중복 시드 방지)
  const HACCP_SEED_VER_KEY = 'lab_haccp_ver';
  // ── 시드 레코드 id 는 단말마다 같아야 한다 ──
  //   시드 버전 키(lab_haccp_ver)는 localStorage, 즉 단말별이다. 그런데 데이터는 동기화 서버로
  //   공유된다. 그래서 새 단말은 서버에서 시드를 이미 받아 놓고도 자기는 "처음"이라고 판단해
  //   시드를 한 벌 더 얹는다. 그때 id 가 랜덤이면 동기화 병합이 서로 다른 레코드로 보고
  //   목록이 그대로 두 배가 된다(유효성평가 13건 → 26건 사고의 원인).
  //   id 를 배열 순서에서 결정적으로 만들면 어느 단말에서 만들어도 같은 id 라서 병합 시 하나로 합쳐진다.
  const seedId = (key, i) => `SEED-${key}-${String(i + 1).padStart(3, '0')}`;

  const reseed = (key, rows) => {
    const cur = get(key);
    const userAdded = cur.filter(x => !x.seeded);   // 사용자가 직접 추가/편집한 항목 보존
    const seeded = rows.map((r, i) => ({ ...r, id: seedId(key, i), seeded: true }));
    set(key, userAdded.concat(seeded));
  };

  // 과거에 랜덤 id 로 들어가 이미 중복된 시드를 정리한다.
  //   자연키가 같은 시드 레코드가 여럿이면 id 가 가장 작은 것만 남긴다.
  //   (모든 단말이 같은 기준으로 고르므로 단말끼리 결과가 갈리지 않는다.)
  const SEED_NATURAL_KEY = {
    lab_validations: (r) => `no:${r.no}`,
    lab_haccp_docs:  (r) => `doc:${r.docNo}`,
    lab_haccp_ha:    (r) => `ha:${r.step}|${r.hazard}`,
    lab_haccp_logs:  (r) => `log:${r.type}|${r.date}|${r.target}`,
  };
  const dedupeSeeded = () => {
    Object.entries(SEED_NATURAL_KEY).forEach(([key, natOf]) => {
      const cur = get(key);
      if (!cur.length) return;
      const keep = new Map();
      cur.forEach(r => {
        if (!r.seeded) return;
        const k = natOf(r);
        const prev = keep.get(k);
        if (!prev || String(r.id) < String(prev.id)) keep.set(k, r);
      });
      const survivors = new Set([...keep.values()].map(r => r.id));
      const next = cur.filter(r => !r.seeded || survivors.has(r.id));
      if (next.length !== cur.length) {
        console.warn(`[LabDB] 중복 시드 정리: ${key} ${cur.length} → ${next.length}`);
        set(key, next);
      }
    });
  };

  const seedHaccp = () => {
    // 어떤 경로로 들어왔든 중복 시드는 먼저 정리한다(과거 데이터 복구)
    dedupeSeeded();

    const savedVer = (typeof localStorage !== 'undefined') ? localStorage.getItem(HACCP_SEED_VER_KEY) : null;
    const fresh = savedVer !== HACCP_SEED_VERSION;
    // 최초(빈 값)이거나 버전이 바뀌었을 때만 시드분 교체
    if (!fresh && get(HACCP_DOCS_KEY).length) return;

    // 1) 기준서·문서 — 실제 우성사료 논산 HACCP 문서 리스트(문서번호·최신버전)
    const docs = [
      { docNo: 'DOC-N-100', title: 'HACCP 매뉴얼(조직도 포함)', category: 'HACCP관리기준서', version: 'V34', effDate: '2026-01-02', body: 'HACCP팀 구성·운영, 7원칙 12절차 적용범위. 지사장 방침·조직도 포함. 대상: 배합사료 전 품목(양축·양어·반려). 검증: 연1회 이상 및 중요변경 시.' },
      { docNo: 'WSM-SA-420', title: '선행요건 관리기준서(PRP)', category: '선행요건관리기준서', version: '-', effDate: '2026-01-02', body: '영업장·위생·제조가공포장 시설설비·용수·보관운송·검사·회수 관리 등 선행요건 운영기준.' },
      { docNo: 'DOC-N-100(제품)', title: '제품설명서', category: '제품설명서', version: 'V23', effDate: '2023-03-01', body: '제품명·성상(펠릿/매쉬/EP)·사용원료·포장단위·유통기한·대상축종·사용방법·표시사항. 사료성분등록내역·급이율표 포함.' },
      { docNo: 'DOC-N-200', title: '공장 평면도', category: '공정흐름도', version: '-', effDate: '2026-01-02', body: '논산공장 건물·구역 배치도(작업동선·청결/일반구역 구분).' },
      { docNo: 'DOC-N-210', title: '액상 배관도면', category: '공정흐름도', version: '-', effDate: '2026-01-02', body: '유지·당밀 등 액상원료 배관 계통도.' },
      { docNo: 'DOC-N-220', title: '배수 도면', category: '공정흐름도', version: '-', effDate: '2026-01-02', body: '공장 배수 계통도(교차오염 방지 배수 흐름).' },
      { docNo: 'DOC-N-230', title: '제조공정도 및 제조설명서', category: '공정흐름도', version: 'V25', effDate: '2026-01-02', body: '원료입고→저장→분쇄→계량·배합→열처리/건조→펠릿/EP성형→냉각→금속·X-Ray검출→포장→보관→출고. 1·2공장 공정도.' },
      { docNo: 'DOC-N-240', title: '전체 Flow sheet', category: '공정흐름도', version: '-', effDate: '2026-01-02', body: '전 공정 흐름도(원료~출고).' },
      { docNo: 'DOC-N-250', title: '공정별 Flow sheet', category: '공정흐름도', version: '-', effDate: '2026-01-02', body: '공정 단위별 상세 흐름도.' },
      { docNo: 'DOC-N-310', title: 'Hazard Analysis(위해요소 분석)', category: '위해요소분석', version: 'V26', effDate: '2026-01-02', body: '생물학적·화학적·물리적 위해요소 단계별 분류·평가. 사료협회 사업보고서·자가품질검사 Lab data 근거.' },
      { docNo: 'DOC-N-315', title: '원부재료 위해요소분석', category: '위해요소분석', version: 'V28', effDate: '2026-01-02', body: '식물성·동물성·광물성·기타·보조사료 대분류별 원부재료 위해요소 구분표.' },
      { docNo: 'DOC-N-330', title: '원부재료 위해성분석결과(실행성분석)', category: '위해요소분석', version: 'V21', effDate: '2026-01-02', body: '원부재료별 실행성 위해성 분석 결과.' },
      { docNo: 'DOC-N-340', title: '원부재료 CCP 결정계통도', category: '위해요소분석', version: 'V24', effDate: '2026-01-02', body: '원부재료 위해요소 CCP 결정 질문도(Decision Tree).' },
      { docNo: 'DOC-N-350', title: '공정별 위해 분석표', category: '위해요소분석', version: 'V33', effDate: '2026-01-02', body: '1·2공장 공정 단계별 위해분석표.' },
      { docNo: 'DOC-N-355', title: '공정 CCP 결정도', category: '위해요소분석', version: 'V29', effDate: '2026-01-02', body: '공정 위해요소 CCP 결정 질문도.' },
      { docNo: 'DOC-N-360', title: 'HACCP 시스템 CCP 계획', category: 'CCP관리계획', version: 'V36', effDate: '2025-02-28', body: 'CCP 6종(1C-1 아플라톡신 / 1C-2 보미톡신 / 1C-3 제랄레논 / 1B 원료살모넬라 / 2B 건조살모넬라 / 3P 반려 X-Ray 이물) 한계기준·모니터링·개선조치·검증·기록 규정.' },
    ];
    reseed(HACCP_DOCS_KEY, docs.map((d, i) => ({
      id: uuid('DOC'), docNo: d.docNo, title: d.title, category: d.category, version: d.version || '-',
      effDate: d.effDate || '2026-01-02', revDate: '', author: '품질보증팀', reviewer: 'HACCP팀장', approver: '지사장',
      status: '유효', body: d.body || '',
      attachments: [], history: [{ ts: now(), action: '생성', by: 'HACCP팀', detail: '문서 등록(문서번호 ' + d.docNo + ')' }],
      seeded: true, updatedAt: now(),
    })));

    // 2) 위해요소분석(HA) — 실제 CCP 6종을 정확히 반영 + 주요 비CCP 위해
    const rows = [
      { step: '원료입고/검사(옥수수)', stepType: '원료', hazardType: 'C', hazard: '아플라톡신(Total)', cause: '재배·저장·운송 중 곰팡이 생성', severity: 3, likelihood: 3, control: '한계기준 10ppb 이하, 모선별 입고검사(ELISA), 초과 시 입고금지', isCCP: true, ccpNo: 'CCP-1C-1' },
      { step: '원료입고/검사(야자박·면실피)', stepType: '원료', hazardType: 'C', hazard: '아플라톡신(Total)', cause: '재배·저장 중 곰팡이 생성', severity: 3, likelihood: 2, control: '한계기준 야자박 30 / 면실피 40ppb 이하, 자체분석(HPLC)', isCCP: true, ccpNo: 'CCP-1C-1' },
      { step: '원료입고/검사(수입단백피)', stepType: '원료', hazardType: 'C', hazard: '보미톡신(DON)', cause: '곡물 오염', severity: 3, likelihood: 2, control: '한계기준 6,000ppb 이하, 모선별 입고검사(HPLC)', isCCP: true, ccpNo: 'CCP-1C-2' },
      { step: '원료입고/검사(수입단백피)', stepType: '원료', hazardType: 'C', hazard: '제랄레논', cause: '곡물 오염', severity: 3, likelihood: 2, control: '한계기준 1,000ppb 이하, 모선별 입고검사(HPLC)', isCCP: true, ccpNo: 'CCP-1C-3' },
      { step: '원료입고/검사(어분: 뱀장어·자돈용)', stepType: '원료', hazardType: 'B', hazard: '살모넬라', cause: '원료 자체 오염', severity: 3, likelihood: 2, control: '불검출, 차량/입고일별 검사(PCR), 검출 시 사용금지·LOT카드 관리', isCCP: true, ccpNo: 'CCP-1B' },
      { step: '가공/건조(EXT DRYER)', stepType: '공정', hazardType: 'B', hazard: '살모넬라 잔존', cause: '건조 온도·시간 부족', severity: 3, likelihood: 2, control: '건조기 70℃ 이상 40분 이상 유지·기록', isCCP: true, ccpNo: 'CCP-2B' },
      { step: '반려동물 소포장/X-Ray', stepType: '공정', hazardType: 'P', hazard: '이물(Fe·SUS·유리·세라믹)', cause: '설비 마모·원료 혼입', severity: 3, likelihood: 2, control: 'X-Ray 검출(Fe2.0/SUS2.0/유리4.0/세라믹4.0mm 이상 불검출)', isCCP: true, ccpNo: 'CCP-3P' },
      { step: '원료입고/검사', stepType: '원료', hazardType: 'C', hazard: '중금속(납·카드뮴·비소 등)', cause: '원료 오염', severity: 2, likelihood: 1, control: '시험성적서 확인·주기적 자가품질검사', isCCP: false, ccpNo: '' },
      { step: '원료입고/검사', stepType: '원료', hazardType: 'C', hazard: '잔류농약', cause: '재배단계 농약 사용', severity: 2, likelihood: 1, control: '성적서 확인·모니터링', isCCP: false, ccpNo: '' },
      { step: '계량·배합', stepType: '공정', hazardType: 'P', hazard: '금속 이물', cause: '설비 마모·혼입', severity: 2, likelihood: 2, control: '자석·체 선별, 마그네트 자력 관리', isCCP: false, ccpNo: '' },
      { step: '포장', stepType: '공정', hazardType: 'P', hazard: '지대 철물 이물', cause: '포장기 마모', severity: 2, likelihood: 2, control: '지대 포장기별 철물 검증·육안검사', isCCP: false, ccpNo: '' },
    ];
    reseed(HACCP_HA_KEY, rows.map((h, i) => ({ ...h, id: uuid('HA'), seq: i + 1, risk: h.severity * h.likelihood, seeded: true })));

    // 3) HACCP 일지 — 실제 CCP 6종 기준 모니터링 예시
    const logs = [
      { type: 'CCP모니터링', date: '2026-07-01', by: '품질담당', target: 'CCP-1C-1 아플라톡신(옥수수)', value: '5.2ppb', judged: '적합', memo: '모선별 ELISA, 한계 10ppb 이하' },
      { type: 'CCP모니터링', date: '2026-07-01', by: '품질담당', target: 'CCP-1B 살모넬라(어분)', value: '불검출', judged: '적합', memo: '차량별 PCR' },
      { type: 'CCP모니터링', date: '2026-07-01', by: '생산담당', target: 'CCP-2B 건조온도', value: '72℃/42분', judged: '적합', memo: '한계 70℃·40분 이상' },
      { type: 'CCP모니터링', date: '2026-07-01', by: '생산담당', target: 'CCP-3P X-Ray 이물', value: '미검출', judged: '적합', memo: '반려 소포장, 감도 정상' },
      { type: '위생점검', date: '2026-07-01', by: 'HACCP팀', target: '작업장·설비 청결', value: '양호', judged: '적합', memo: '' },
      { type: '검증', date: '2026-06-30', by: 'HACCP팀', target: 'X-Ray 검교정', value: '정상(연1회)', judged: '적합', memo: '외부 검교정 성적서 확인' },
    ];
    reseed(HACCP_LOG_KEY, logs.map(l => ({ ...l, id: uuid('LOG'), action: '', seeded: true, createdAt: now() })));

    // 4) 신원료 위해평가 — 예시 유지
    if (get(NEWMAT_KEY).filter(x => x.seeded).length === 0 && get(NEWMAT_KEY).length === 0) {
      set(NEWMAT_KEY, [{
        id: uuid('NM'), code: '', name: '신규 어분(Fish meal)', supplier: '(예시)해양사료', origin: '페루', use: '단백질원(가금·양돈)',
        bio: { hazard: '살모넬라, 장내세균', assess: '중(원료 자체오염 가능)', control: '공급업체 시험성적서·후속 열처리' },
        chem: { hazard: '카드뮴, 히스타민', assess: '중(해양오염·부패)', control: '중금속·히스타민 성적서 확인' },
        phys: { hazard: '금속·뼈조각', assess: '저', control: '자석·금속검출' },
        docsNeeded: ['중금속', '미생물(살모넬라 등)', '곰팡이독소'], verdict: '조건부승인', assessor: '연구소', approver: 'HACCP팀장', date: '2026-06-25',
        note: '초도 3로트 전수 성적서 확인 조건', seeded: true,
      }]);
    }

    // 5) 유효성 평가 — 실제 논산공장 유효성평가 폴더 12종
    const vals = [
      { no: 1,  name: '제품 모의 회수 훈련', category: '모의회수', cycle: '연1회', lastDate: '2024-10-23', result: '적합', evidence: 'WS-FSMS-2621-01 추적성 보고서(241023)', note: '반려 제품 회수 내역 포함' },
      { no: 2,  name: '지대 포장기별 철물 검증', category: '이물관리', cycle: '연1회', lastDate: '2024-04-17', result: '적합', evidence: '포장 호기별 제품 철물 검증(240417)', note: '' },
      { no: 3,  name: '소독제 살균 효과 검증', category: '소독·살균', cycle: '연1회', lastDate: '2025-01-12', result: '적합', evidence: '소독제 살균 효과 2025', note: '방역상황판(논산공장)' },
      { no: 4,  name: '자외선 살균 효과 검증(대인·반품)', category: '소독·살균', cycle: '연1회', lastDate: '2025-01-12', result: '적합', evidence: '자외선 살균 유효성 테스트(2025.01.12)', note: '자체 대장균군 분석성적서 첨부' },
      { no: 5,  name: '마그네트 자력 측정 검증', category: '이물관리', cycle: '연1회', lastDate: '2025-12-26', result: '적합', evidence: '마그네트 자력 측정 유효성 테스트(2025.12.26)', note: '' },
      { no: 6,  name: '오존 살균 효과 검증', category: '소독·살균', cycle: '연1회', lastDate: '2024-01-01', result: '적합', evidence: '오존 살균 2024', note: '' },
      { no: 7,  name: '벌크차 약품배합기 플러싱 효과 검증', category: '설비검증', cycle: '연1회', lastDate: '2026-02-12', result: '적합', evidence: '벌크차 약품배합기 플러싱 효과 검증(26.02.12)', note: '샘플 성적서 첨부' },
      { no: 8,  name: '반려동물 소포장 X-Ray 검출기 검증', category: 'CCP검증', cycle: '연1회', lastDate: '', result: '진행중', evidence: '', note: 'CCP-3P 실행성 검증' },
      { no: 9,  name: '2공장 금속검출기 검증', category: 'CCP검증', cycle: '연1회', lastDate: '', result: '진행중', evidence: '', note: '' },
      { no: 10, name: '2공장 DRY(건조기) 검증', category: 'CCP검증', cycle: '연1회', lastDate: '', result: '진행중', evidence: '', note: 'CCP-2B 건조온도·시간 실행성 검증' },
      { no: 11, name: '차량용 소독기 유효성 검증', category: '소독·살균', cycle: '연1회', lastDate: '2024-11-04', result: '적합', evidence: '정문 차량용 소독제 유효성 분석(2024.11.04)', note: '' },
      { no: 12, name: '용기·포장 시험성적서', category: '용기·포장', cycle: '반기1회', lastDate: '2025-01-01', result: '적합', evidence: '25년 상·하반기(포장협력사A·포장협력사B·포장협력사C·포장협력사D)', note: '양축·반려·양어·박스·톤백' },
      { no: 13, name: '나주영업소 정기심사', category: '외부심사', cycle: '분기1회', lastDate: '2024-01-24', result: '적합', evidence: '2024.01.24 나주영업소', note: '' },
    ];
    reseed(VALIDATION_KEY, vals.map(v => ({
      id: uuid('VAL'), no: v.no, name: v.name, category: v.category, cycle: v.cycle,
      lastDate: v.lastDate || '', nextDate: '', result: v.result || '진행중', factory: 'NS',
      evidence: v.evidence || '', note: v.note || '', seeded: true, updatedAt: now(),
    })));

    if (typeof localStorage !== 'undefined') { try { localStorage.setItem(HACCP_SEED_VER_KEY, HACCP_SEED_VERSION); } catch (_) {} }
  };

  // ============================================================
  // 설정
  // ============================================================
  const SETTINGS_KEY = 'lab_settings';
  const getSettings = () => getObj(SETTINGS_KEY, { labName: '중앙연구소 실험실', company: '우성사료' });
  const saveSettings = (s) => set(SETTINGS_KEY, { ...getSettings(), ...s });

  // ============================================================
  // 샘플/시드 데이터
  // ============================================================
  const seedRecords = (force) => {
    const existing = get(RECORDS_KEY);
    // 실데이터 임포트가 있으면: localStorage엔 수기입력분만 유지(데모 시드 제거), 임포트는 읽기 시 병합
    const hasImport = (typeof window !== 'undefined' && window.LAB_RAW_IMPORT && Array.isArray(window.LAB_RAW_IMPORT.records) && window.LAB_RAW_IMPORT.records.length);
    if (hasImport) {
      const hasDemo = existing.some(r => !r.manual);
      if (force || hasDemo) { setQuiet(RECORDS_KEY, existing.filter(r => r.manual)); invalidateRecords(); }
      return;
    }
    if (existing.length && !force) return;
    const seed = (typeof window !== 'undefined' && window.LAB_SEED) || null;
    const manual = existing.filter(r => r.manual);
    const manualIds = new Set(manual.map(r => r.id));
    const fresh = [];
    if (seed) {
      (seed.raw || []).forEach(r => { if (!manualIds.has(r.id)) fresh.push({ ...r, kind: 'raw', name: r.name || '', vals: r.vals || {}, manual: false }); });
      (seed.prod || []).forEach(r => { if (!manualIds.has(r.id)) fresh.push({ ...r, kind: 'prod', name: r.name || '', vals: r.vals || {}, manual: false }); });
    }
    set(RECORDS_KEY, manual.concat(fresh));  // 수기 입력분 보존
    invalidateRecords();
  };

  const seedSpecs = () => {
    if (getSpecs().length > 0) return;
    // 안전·법정 관리기준 위주의 기본 규격(전체 적용, 편집 가능)
    const defaults = [
      { kind: 'ALL',  item: 'moist', min: null, max: 14 },   // 사료 수분 상한(곰팡이 예방)
      { kind: 'ALL',  item: 'afla',  min: null, max: 20 },   // 아플라톡신 총합 ppb
      { kind: 'ALL',  item: 'pb',    min: null, max: 10 },   // 납
      { kind: 'ALL',  item: 'as',    min: null, max: 2 },    // 비소
      { kind: 'ALL',  item: 'cd',    min: null, max: 1 },    // 카드뮴
      { kind: 'ALL',  item: 'hg',    min: null, max: 400 },  // 수은 ppb
    ];
    set(SPECS_KEY, defaults.map(d => ({ ...d, id: uuid('SPEC'), code: '', active: true, updatedAt: now() })));
    invalidateSpecs();
  };

  // ── 반려 제품규격 → 코드별 규격(lab_specs) 시딩 ──
  //   원본: (품질)반려사료 제품 규격_2604.xlsx (data/petSpecs.js 자동 생성본).  등록성분 = 그 사료의 기준치.
  //   방향성: 수분/조섬유/조회분 ↓(max) · 조단백(N정량/Kjeldahl)/조지방/칼슘/인 ↑(min)
  //   매칭: ① 코드 직접 ② 같은 배합비(-PO 등 포장변형은 기본제품과 배합비 동일 → 등록성분 동일) ③ 배합비(단종 포함)
  //   src:'petspec' 마커가 붙은 이전 시드는 재생성 시 교체, 수동 규격은 보존.
  const PET_SPEC_VERSION = '2026-07-06-v2604-vol';
  const PET_SPEC_VER_KEY = 'lab_pet_spec_ver';
  const PET_DIRS = [
    ['moist', 'max'], ['protein', 'min'], ['protein_n', 'min'], ['fat', 'min'],
    ['ca', 'min'], ['p', 'min'], ['fiber', 'max'], ['ash', 'max'],
  ];
  const seedPetSpecs = () => {
    const master = (typeof window !== 'undefined' && window.WS_PET_SPECS) || [];
    if (!master.length) return;
    const savedVer = (typeof localStorage !== 'undefined') ? localStorage.getItem(PET_SPEC_VER_KEY) : null;
    if (savedVer === PET_SPEC_VERSION) return;
    // 코드 직접(엑셀 전체 코드 · 단종이어도 등록성분=기준치는 유효 · 중복은 유효행 우선)
    // 배합비→규격(유효 우선, 없으면 단종) — 엑셀에 코드 없는 -PO 변형 커버
    const byCode = new Map(), byFormula = new Map(), byFormulaAny = new Map();
    master.forEach(m => {
      const cur = byCode.get(m.code);
      if (!cur || (cur.discontinued && !m.discontinued)) byCode.set(m.code, m);
      if (m.formula) {
        if (!m.discontinued && !byFormula.has(m.formula)) byFormula.set(m.formula, m);
        if (!byFormulaAny.has(m.formula)) byFormulaAny.set(m.formula, m);
      }
    });
    // 시딩 대상: code → 규격원본.  ① 엑셀 코드 직접  ② 제품마스터 코드 중 배합비 매칭(엑셀에 코드 없는 -PO 등)
    const targets = new Map();
    byCode.forEach((m, code) => targets.set(code, m));
    getProducts().forEach(p => {
      if (targets.has(p.code)) return;
      const f = String(p.formulaCode || '');
      const m = byFormula.get(f) || byFormulaAny.get(f);
      if (m) targets.set(p.code, m);
    });
    const rest = getSpecs().filter(s => s.src !== 'petspec');   // 수동/기존 규격 보존
    const fresh = [];
    targets.forEach((m, code) => {
      PET_DIRS.forEach(([item, dir]) => {
        const srcKey = item === 'protein_n' ? 'protein' : item;   // 조단백(N정량)도 등록 조단백질 기준 적용
        const v = m[srcKey];
        if (v == null || !getItem(item)) return;
        fresh.push({
          id: `PETSPEC-${code}-${item}`, kind: 'prod', code, item,
          min: dir === 'min' ? v : null, max: dir === 'max' ? v : null,
          active: true, src: 'petspec', updatedAt: now(),
        });
      });
      // 비중(용적밀도) = 제품 용적중(제품 열) 범위 → 반려 비중 기준치
      if (getItem('bulk_density') && (m.volMin != null || m.volMax != null)) {
        fresh.push({
          id: `PETSPEC-${code}-bulk_density`, kind: 'prod', code, item: 'bulk_density',
          min: m.volMin != null ? m.volMin : null, max: m.volMax != null ? m.volMax : null,
          active: true, src: 'petspec', updatedAt: now(),
        });
      }
    });
    set(SPECS_KEY, rest.concat(fresh));
    invalidateSpecs();
    if (typeof localStorage !== 'undefined') { try { localStorage.setItem(PET_SPEC_VER_KEY, PET_SPEC_VERSION); } catch (_) {} }
  };
  // ── 축종별 사료성분 등록내역(법적 등록성분) → 코드별 규격(lab_specs) 시딩 ──
  //   원본: 사료성분등록내역(2026.02.26) (data/regSpecs.js 자동 생성본 — 제품명 정규화 매칭)
  //   우선순위: 수동 규격 > 반려규격(petspec) > 등록성분(regspec) — 이미 규격 있는 (코드,항목)은 건너뜀
  //   petspec 버전이 바뀌어도 우선순위가 유지되도록 상태키에 두 버전을 함께 기록해 재시딩.
  const REG_SPEC_VERSION = '2026-02-26-v2';
  const REG_SPEC_VER_KEY = 'lab_reg_spec_ver';
  const seedRegSpecs = () => {
    const M = (typeof window !== 'undefined' && window.WS_REG_SPECS) || null;
    if (!M || !M.byCode || !M.entries) return;
    const state = REG_SPEC_VERSION + '|' + PET_SPEC_VERSION;
    const savedVer = (typeof localStorage !== 'undefined') ? localStorage.getItem(REG_SPEC_VER_KEY) : null;
    if (savedVer === state) return;
    const rest = getSpecs().filter(s => s.src !== 'regspec');
    // (코드,항목)에 이미 규격 존재(수동/petspec) → regspec 미시딩
    const taken = new Set(rest.filter(s => s.code).map(s => toCode(s.code) + '|' + s.item));
    const fresh = [];
    Object.keys(M.byCode).forEach(code => {
      const e = M.entries[M.byCode[code].i];
      if (!e || !e.specs) return;
      Object.keys(e.specs).forEach(item => {
        const sp = e.specs[item];
        const targets = item === 'protein' ? ['protein', 'protein_n'] : [item];   // 조단백(N정량)도 등록 조단백질 기준
        targets.forEach(it => {
          if (!getItem(it) || taken.has(toCode(code) + '|' + it)) return;
          fresh.push({
            id: `REGSPEC-${code}-${it}`, kind: 'prod', code, item: it,
            min: sp.min != null ? sp.min : null, max: sp.max != null ? sp.max : null,
            active: true, src: 'regspec', updatedAt: now(),
          });
        });
      });
    });
    set(SPECS_KEY, rest.concat(fresh));
    invalidateSpecs();
    if (typeof localStorage !== 'undefined') { try { localStorage.setItem(REG_SPEC_VER_KEY, state); } catch (_) {} }
  };
  // 코드로 등록성분 원본 조회 (화면 출처표시용) — 매칭 근거(via) 포함
  const getRegSpec = (code) => {
    const M = (typeof window !== 'undefined' && window.WS_REG_SPECS) || null;
    const hit = M && M.byCode && M.byCode[toCode(code)];
    return hit ? { ...M.entries[hit.i], via: hit.via, how: hit.how } : null;
  };

  // 코드로 규격 마스터 조회 (반려 모듈 자동채움용) — 코드 직접 → 배합비 매칭
  const getPetSpec = (code) => {
    const master = (typeof window !== 'undefined' && window.WS_PET_SPECS) || [];
    const c = toCode(code);
    let m = master.find(x => x.code === c && !x.discontinued) || master.find(x => x.code === c);
    if (m) return m;
    // 배합비 매칭 (엑셀에 없는 코드 → 제품마스터 배합비로 기본제품 규격)
    const p = getProductByCode(c);
    const f = p && String(p.formulaCode || '');
    if (!f) return null;
    return master.find(x => String(x.formula) === f && !x.discontinued) || master.find(x => String(x.formula) === f) || null;
  };
  const searchPetSpecs = (q, limit = 30) => {
    const master = (typeof window !== 'undefined' && window.WS_PET_SPECS) || [];
    const lq = String(q || '').toLowerCase().trim();
    let list = master.filter(m => !m.discontinued);
    if (lq) list = list.filter(m => m.code.includes(lq) || m.name.toLowerCase().includes(lq) || (m.brand || '').toLowerCase().includes(lq));
    return list.slice(0, limit);
  };

  const SEED_VERSION = '2026-07-03-spec';   // 시드/항목 마스터 버전 (변경 시 자동 갱신)
  const SEED_VER_KEY = 'lab_seed_ver';
  const initSampleData = () => {
    // 동기화 서버가 이미 내려준 데이터가 있으면 시드를 아예 돌리지 않는다.
    //   새로 합류한 단말은 버전키가 비어 있어 "버전이 바뀐 것"으로 오인하고 표준 시드를 다시 까는데,
    //   그러면 그동안 현장에서 고친 규격·문서가 통째로 되돌아가고 그 상태가 다시 서버로 올라간다.
    if (window.Sync && Sync.serverHas && Sync.serverHas(SPECS_KEY, ITEMS_KEY, HACCP_DOCS_KEY)) {
      // 건너뛴 시드의 버전키는 반드시 다 찍어둔다. 하나라도 빠지면 다음 부팅 때
      // 그 시드만 "버전이 바뀐 것"으로 보고 규격 수천 건을 다시 깔아 서버로 밀어낸다.
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(SEED_VER_KEY, SEED_VERSION);
          localStorage.setItem(HACCP_SEED_VER_KEY, HACCP_SEED_VERSION);
          localStorage.setItem(PET_SPEC_VER_KEY, PET_SPEC_VERSION);
          localStorage.setItem(REG_SPEC_VER_KEY, REG_SPEC_VERSION + '|' + PET_SPEC_VERSION);
          localStorage.setItem(MATRIX_SEED_KEY, MATRIX_SEED_VERSION);
        } catch (_) {}
      }
      invalidateRecords(); invalidateSpecs(); invalidateItems();
      return;
    }
    const ver = (typeof localStorage !== 'undefined') ? localStorage.getItem(SEED_VER_KEY) : null;
    const fresh = ver !== SEED_VERSION;
    seedItems(fresh);     // 버전 변경 시 전체 항목 마스터 반영(custom 보존)
    seedRecords(fresh);   // 버전 변경 시 시드 레코드 갱신(수기 입력분 보존)
    seedSpecs();          // 규격은 비어있을 때만
    seedPetSpecs();       // 반려 제품규격(공식 기준) — 버전 변경 시 petspec 시드만 교체
    seedRegSpecs();       // 축종별 사료성분 등록내역(법적 등록성분) — petspec/수동 없는 곳만 보완
    seedHaccp();          // HACCP 문서·위해분석·일지·신원료(비어있을 때만)
    seedMatrixRules();    // 논산 원료Matrix 적용식(어분·육골분 Prot = 평균−편차/2)
    if (fresh && typeof localStorage !== 'undefined') { try { localStorage.setItem(SEED_VER_KEY, SEED_VERSION); } catch (_) {} }
  };

  return {
    // 유틸/항목
    getItems, getItem, itemLabel, itemUnit, itemOwner, itemAppliesLabel,
    addItem, updateItem, deleteItem,
    // 마스터
    getMaterials, getProducts, getMaterialByCode, getProductByCode, nameOf, searchMaster,
    loadMaterialsFromJSON, loadProductsFromJSON, upsertMasterCode,
    // 제품 축종 구분 · 표준 스펙리스트
    PROD_CATEGORIES, productCategory, defaultItemsFor, searchProducts, standardSpecList,
    getPetSpec, searchPetSpecs, getRegSpec,
    // 레코드(분석대장)
    getRecords, getRecordById, getRecordsByCode, addRecord, updateRecord, deleteRecord, genReceiptNo,
    // 시료 접수
    REQ_STATUS, getRequests, getRequest, addRequest, updateRequest, deleteRequest,
    completeRequest, requestStats,
    // NIR 정확도
    NIR_TOLERANCE_PCT, nirAccuracyStats, processRate, processRateStats,
    // 규격/판정
    getSpecs, addSpec, updateSpec, deleteSpec, getSpecLog, addSpecLog, statBand, resolveSpec, judge,
    // 원료 규격서(원본 양식 + 편집분 override + 신규 작성분)
    getSpecSheets, getSpecSheet, saveSpecSheet, resetSpecSheet, getSpecSheetLog,
    addSpecSheet, deleteSpecSheet, getDeletedSpecSheets, restoreSpecSheet,
    getQuickGroups, saveQuickGroups,
    // 원료 매트릭스 기준값(사용자 지정)
    getMatrixConfigs, getMatrixConfig, matrixItemCfg, matrixExcluded, saveMatrixConfig, deleteMatrixConfig,
    matrixSd, APPLY_MODES, APPLY_DIV, applyMode, applyDivOf, matrixApply,
    getDeviations, getTrend, getItemSummary, getCodeSummaries,
    // 대시보드/설정
    getStats, getSettings, saveSettings,
    getDashPref, saveDashPref,
    // HACCP
    DOC_CATEGORIES, LOG_TYPES, HAZARD_DOCS,
    getHaccpDocs, getHaccpDoc, addHaccpDoc, updateHaccpDoc, deleteHaccpDoc,
    addDocAttachment, removeDocAttachment,
    getHA, addHA, updateHA, deleteHA,
    getHaccpLogs, addHaccpLog, deleteHaccpLog,
    getNewMats, getNewMat, addNewMat, updateNewMat, deleteNewMat,
    haccpSummary,
    // 유효성 평가
    VALIDATION_CATEGORIES, getValidations, getValidation, addValidation, updateValidation, deleteValidation, validationSummary,
    // 시드
    initSampleData,
    // 동기화(원격 반영) 후 파생 캐시 무효화
    invalidateCaches: () => { invalidateRecords(); invalidateSpecs(); invalidateItems(); },
  };
})();
