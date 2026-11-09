// ============================================================
// db.js — localStorage 데이터 레이어 (v2.0 — 우성사료 통합 이력관리)
// ============================================================

const DB = (() => {
  // ----- 기본 유틸 -----
  const get  = (key)       => JSON.parse(localStorage.getItem(key) || '[]');
  const getObj = (key, def) => { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; };
  // 쓰기 발생 시 동기화 계층(sync.js)에 알림 — 없으면 아무 일도 안 함(로컬 전용)
  const notifyWrite = (key) => { try { if (typeof window !== 'undefined' && window.__onDbWrite) window.__onDbWrite(key); } catch (_) {} };
  const set  = (key, data) => { localStorage.setItem(key, JSON.stringify(data)); notifyWrite(key); };
  const uuid = ()          => 'QR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2,5).toUpperCase();
  // 레코드 ID — Date.now() 만 쓰면 같은 밀리초에 만든 레코드끼리 ID가 겹친다(일괄 등록 시 실제로 발생).
  //   뒤에 짧은 랜덤을 붙여 충돌을 막는다. 기존 ID 형식은 그대로 두고 새로 만드는 것만 적용.
  const newId = (prefix) => prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  const now  = ()          => new Date().toISOString();
  const toCode = (v)        => String(v || '').trim();
  const makeQRValue = (type, code) => {
    const map = { RECEIVING:'RECV', MATERIAL:'MAT', PRODUCT:'PROD', PRODUCT_LOT:'FG', SUPPLIER:'SUP', SILO:'SILO' };
    const key = map[type] || type;
    return `WS-${key}-${toCode(code)}`;
  };
  const extractQRPayload = (rawCode) => {
    const raw = toCode(rawCode);
    if (!raw) return '';
    try {
      const mayBeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith('/') || raw.startsWith('?') || raw.includes('index.html?');
      if (mayBeUrl) {
        const base = (typeof window !== 'undefined' && window.location?.href) || 'http://local/';
        const url = new URL(raw, base);
        const embedded = url.searchParams.get('id') || url.searchParams.get('qr') || url.searchParams.get('code');
        if (embedded) return toCode(embedded);
      }
    } catch (_) {
      // Keep raw text QR compatibility.
    }
    return raw;
  };

  // ============================================================
  // 공장 마스터
  // ============================================================
  const FACTORIES = [
    { id: 'NS', name: '논산공장',  short: '논산', lotCode: 'A' },
    { id: 'GS', name: '경산공장',  short: '경산', lotCode: 'C' },
    { id: 'AS', name: '아산공장',  short: '아산', lotCode: 'D' },
    { id: 'HQ', name: '본사',      short: '본사', lotCode: 'W' },
  ];
  const getFactories = () => FACTORIES;
  const getFactoryName = (id) => FACTORIES.find(f => f.id === id)?.name || id || '-';
  const getFactoryLotCode = (id) => FACTORIES.find(f => f.id === id)?.lotCode || 'D';

  // ============================================================
  // 원료 마스터
  // ============================================================
  const MATERIALS_KEY = 'rm_materials';
  const getMaterials       = ()      => get(MATERIALS_KEY);
  const getMaterialByCode  = (code)  => getMaterials().find(m => m.code === code);
  const getMaterialByQRCode = (qr)   => getMaterials().find(m => m.qrCode === qr || makeQRValue('MATERIAL', m.code) === qr);
  const searchMaterials    = (q)     => { const lq = q.toLowerCase(); return getMaterials().filter(m => m.code.toLowerCase().includes(lq) || m.name.toLowerCase().includes(lq)); };

  const inferCategory = (code, name) => {
    const n = (name || '').toLowerCase();
    if (n.includes('착유') || n.includes('비육우') || n.includes('한우')) return '소사료';
    if (n.includes('양돈') || n.includes('자돈') || n.includes('모돈')) return '돼지사료';
    if (n.includes('육계') || n.includes('산란') || n.includes('종계')) return '닭사료';
    if (n.includes('양어') || n.includes('어류')) return '수산사료';
    if (n.includes('반려') || n.includes('양견')) return '반려동물사료';
    if (n.includes('옥수수') || n.includes('대두') || n.includes('소맥')) return '주원료(곡물)';
    if (n.includes('비타민') || n.includes('premix')) return '첨가제';
    return '기타원료';
  };

  const enhanceMaterial = (m) => ({
    ...m,
    code: toCode(m.code),
    name: m.name || '',
    qrCode: m.qrCode || makeQRValue('MATERIAL', m.code),
    unit: m.unit || 'kg',
    category: m.category || inferCategory(m.code, m.name),
    minStock: Number(m.minStock) || 0,
    maxStock: Number(m.maxStock) || 9999,
    supplier: m.supplier || '',
    active: m.active !== false
  });

  const normalizeMaterials = () => {
    const list = getMaterials();
    if (list.length > 0) set(MATERIALS_KEY, list.map(enhanceMaterial));
  };

  const loadMaterialsFromJSON = async () => {
    if (getMaterials().length > 0) { normalizeMaterials(); return; }
    try {
      const data = window.WS_RAW_MATERIALS || await (await fetch('./data/rawMaterials.json')).json();
      const enhanced = data.map(enhanceMaterial);
      set(MATERIALS_KEY, enhanced);
    } catch (e) { console.error('[DB] rawMaterials.json 로드 실패:', e); }
  };

  // ============================================================
  // 제품 마스터
  // ============================================================
  const PRODUCTS_KEY = 'rm_products';
  const getProducts       = ()     => get(PRODUCTS_KEY);
  const getProductByCode  = (code) => getProducts().find(p => p.code === toCode(code));
  const getProductByQRCode = (qr)  => getProducts().find(p => p.qrCode === qr || makeQRValue('PRODUCT', p.code) === qr);
  const searchProducts    = (q)    => {
    const lq = String(q || '').toLowerCase();
    return getProducts().filter(p =>
      p.code.toLowerCase().includes(lq) ||
      (p.name || '').toLowerCase().includes(lq) ||
      String(p.formulaCode || '').includes(lq)
    );
  };
  const enhanceProduct = (p) => ({
    ...p,
    code: toCode(p.code),
    name: p.name || '',
    formulaCode: p.formulaCode || '',
    qrCode: p.qrCode || makeQRValue('PRODUCT', p.code),
    active: p.active !== false
  });
  const normalizeProducts = () => {
    const list = getProducts();
    if (list.length > 0) set(PRODUCTS_KEY, list.map(enhanceProduct));
  };
  const loadProductsFromJSON = async () => {
    if (getProducts().length > 0) { normalizeProducts(); return; }
    try {
      const data = window.WS_PRODUCT_CODES || await (await fetch('./data/productCodes.json')).json();
      set(PRODUCTS_KEY, data.map(enhanceProduct));
    } catch (e) { console.error('[DB] productCodes.json 로드 실패:', e); }
  };

  // ============================================================
  // 코드 마스터 발행/수정 (코드관리 화면용 — 플랫폼 전체 기준)
  // ============================================================
  const addMaterial = (m) => {
    const code = toCode(m.code);
    if (!code) throw new Error('코드를 입력하세요');
    if (getMaterialByCode(code)) throw new Error('이미 존재하는 원료코드입니다: ' + code);
    const item = enhanceMaterial({ ...m, code });
    set(MATERIALS_KEY, getMaterials().concat([item]));
    return item;
  };
  const updateMaterialByCode = (code, patch) => {
    const all = getMaterials().slice();
    const i = all.findIndex(x => x.code === toCode(code));
    if (i < 0) return null;
    all[i] = enhanceMaterial({ ...all[i], ...patch, code: all[i].code });
    set(MATERIALS_KEY, all);
    return all[i];
  };
  const addProduct = (p) => {
    const code = toCode(p.code);
    if (!code) throw new Error('코드를 입력하세요');
    if (getProductByCode(code)) throw new Error('이미 존재하는 제품코드입니다: ' + code);
    const item = enhanceProduct({ ...p, code });
    set(PRODUCTS_KEY, getProducts().concat([item]));
    return item;
  };
  const updateProductByCode = (code, patch) => {
    const all = getProducts().slice();
    const i = all.findIndex(x => x.code === toCode(code));
    if (i < 0) return null;
    all[i] = enhanceProduct({ ...all[i], ...patch, code: all[i].code });
    set(PRODUCTS_KEY, all);
    return all[i];
  };

  // ============================================================
  // 협력사 (Suppliers)
  // ============================================================
  const SUPPLIERS_KEY = 'rm_suppliers';
  const getSuppliers       = ()     => get(SUPPLIERS_KEY);
  const getSupplierById    = (id)   => getSuppliers().find(s => s.id === id);
  const getSupplierByCode  = (code) => getSuppliers().find(s => s.code === toCode(code));
  const getSupplierByName  = (name) => getSuppliers().find(s => s.name === name);
  const getSupplierByQRCode = (qr)  => getSuppliers().find(s => s.qrCode === qr || makeQRValue('SUPPLIER', s.code) === qr);
  const searchSuppliers = (q) => {
    const lq = String(q || '').toLowerCase();
    return getSuppliers().filter(s =>
      (s.name || '').toLowerCase().includes(lq) ||
      (s.code || '').toLowerCase().includes(lq) ||
      (s.mainItem || '').toLowerCase().includes(lq) ||
      (s.industry || '').toLowerCase().includes(lq)
    );
  };

  const generateSupplierCode = () => {
    const used = new Set(getSuppliers().map(s => s.code).filter(Boolean));
    let maxSeq = 0;
    used.forEach(code => {
      const match = String(code).match(/^SUP(\d+)$/);
      if (match) maxSeq = Math.max(maxSeq, Number(match[1]));
    });
    let next = maxSeq + 1;
    let code = '';
    do {
      code = `SUP${String(next).padStart(3, '0')}`;
      next += 1;
    } while (used.has(code));
    return code;
  };

  const normalizeSupplierDocuments = (docs = []) => (Array.isArray(docs) ? docs : [])
    .filter(d => d && (d.dataUrl || d.name))
    .map((d, idx) => ({
      id: d.id || `DOC-${Date.now().toString(36).toUpperCase()}-${idx}`,
      type: d.type || 'OTHER',
      label: d.label || '',
      name: d.name || '',
      mimeType: d.mimeType || d.typeName || '',
      size: Number(d.size) || 0,
      dataUrl: d.dataUrl || '',
      uploadedAt: d.uploadedAt || now()
    }));

  const enhanceSupplier = (s, idx = 0) => {
    const code = s.code || s.supplier_code || `SUP${String(idx + 1).padStart(3, '0')}`;
    return {
      id: s.id || code,
      code,
      name: s.name || '',
      contact: s.contact || s.phone || '',
      email: s.email || '',
      businessNo: s.businessNo || s.business_no || s.bizNo || '',
      materials: s.materials || [],
      mainItem: s.mainItem || s.main_item || '',
      domesticImport: s.domesticImport || '',
      industry: s.industry || '',
      haccpEvalYear: s.haccpEvalYear || s.haccp_eval_year || '',
      haccpScore: s.haccpScore ?? s.haccp_score ?? null,
      haccpGrade: s.haccpGrade || s.haccp_grade || '',
      haccpOpinion: s.haccpOpinion || s.haccp_opinion || '',
      documents: normalizeSupplierDocuments(s.documents || s.supplierDocuments || []),
      evaluations: Array.isArray(s.evaluations) ? s.evaluations : [],
      status: s.status || 'ACTIVE',
      isManualCreated: !!(s.isManualCreated || s.is_manual_created),
      createdFrom: s.createdFrom || s.created_from || 'MANUAL',
      qrCode: s.qrCode || makeQRValue('SUPPLIER', code),
      createdAt: s.createdAt || now(),
      updatedAt: s.updatedAt || ''
    };
  };

  const loadSuppliersFromJSON = async () => {
    try {
      const data = window.WS_SUPPLIER_MASTER || await (await fetch('./data/supplierMaster.json')).json();
      const master = data.map(enhanceSupplier);
      const current = getSuppliers().map(enhanceSupplier);
      const merged = [...master];
      current.forEach(s => {
        const idx = merged.findIndex(m => m.code === s.code || m.name === s.name);
        if (idx >= 0) merged[idx] = {
          ...s,
          ...merged[idx],
          contact: s.contact || merged[idx].contact,
          email: s.email || merged[idx].email,
          materials: (s.materials || []).length ? s.materials : merged[idx].materials,
          documents: (s.documents || []).length ? s.documents : merged[idx].documents,
          qrCode: merged[idx].qrCode || s.qrCode,
          updatedAt: s.updatedAt || merged[idx].updatedAt
        };
        else merged.push(s);
      });
      set(SUPPLIERS_KEY, merged);
    } catch (e) { console.error('[DB] supplierMaster.json 로드 실패:', e); }
  };

  const addSupplier = (data) => {
    const list = getSuppliers();
    let code = data.code || generateSupplierCode();
    if (list.some(s => s.code === code)) code = generateSupplierCode();
    const item = enhanceSupplier({
      ...data,
      id: data.id || code,
      code,
      status: data.status || 'TEMP',
      isManualCreated: data.isManualCreated ?? true,
      createdFrom: data.createdFrom || 'MANUAL',
      createdAt: now()
    }, list.length);
    list.push(item);
    set(SUPPLIERS_KEY, list);
    return item;
  };

  const updateSupplier = (id, patch) => {
    const list = getSuppliers();
    const idx = list.findIndex(s => s.id === id);
    if (idx < 0) return null;
    const before = { ...list[idx] };
    const merged = enhanceSupplier({ ...list[idx], ...patch, code: list[idx].code, qrCode: list[idx].qrCode }, idx);
    if (window.AuditLog) AuditLog.record(merged, before, {
      name: '협력사명', contact: '연락처', email: '이메일', businessNo: '사업자번호',
      manager: '담당자', address: '주소', materials: '취급원료', active: '사용여부', note: '비고',
    }, { by: patch.updatedBy });
    else merged.updatedAt = now();
    list[idx] = merged;
    set(SUPPLIERS_KEY, list);
    return list[idx];
  };

  const initDefaultSuppliers = () => {
    if (getSuppliers().length > 0) return;
    const defaults = [
      { code: 'SUP001', name: '한빛곡물', contact: '041-000-0001', materials: ['4401000','4401004'] },
      { code: 'SUP002', name: '우리곡산', contact: '041-000-0002', materials: ['4401021','4401022'] },
      { code: 'SUP003', name: '삼진사료원료', contact: '031-000-0003', materials: ['4401103','4401104'] },
      { code: 'SUP004', name: '대성유지', contact: '031-000-0004', materials: ['4401001','4401002'] },
    ];
    defaults.forEach(d => addSupplier(d));
  };

  // ============================================================
  // 사일로 (Silos)
  // ============================================================
  const SILOS_KEY = 'rm_silos';
  const getSilos          = ()         => get(SILOS_KEY);
  const getSiloById       = (id)       => getSilos().find(s => s.id === id);
  const getSilosByFactory = (factory)  => getSilos().filter(s => s.factory === factory);

  const addSilo = (data) => {
    const list = getSilos();
    const item = {
      id: data.id || (data.factory + '-SILO-' + String(list.length+1).padStart(2,'0')),
      name: data.name,
      factory: data.factory,
      materialCode: data.materialCode || '',
      materialName: data.materialName || '',
      maxCapacity: Number(data.maxCapacity) || 100000,
      currentLots: [],   // [{lotId, lotNo, qty, inDate, receivingId}] — FIFO 순서
      status: 'EMPTY',   // EMPTY / AVAILABLE / LOW / FULL
      createdAt: now()
    };
    list.push(item);
    set(SILOS_KEY, list);
    return item;
  };

  const getSiloCapacitySummary = (silo) => {
    const total = (silo.currentLots || []).reduce((s, l) => s + l.qty, 0);
    const pct   = silo.maxCapacity > 0 ? Math.round((total / silo.maxCapacity) * 100) : 0;
    let status = 'EMPTY';
    if (pct >= 90) status = 'FULL';
    else if (pct >= 20) status = 'AVAILABLE';
    else if (pct > 0)  status = 'LOW';
    return { totalQty: total, pct, status };
  };

  // 사일로에 LOT 추가 (입고확정 후 배정)
  const assignLotToSilo = (siloId, lotData) => {
    const list = getSilos();
    const idx  = list.findIndex(s => s.id === siloId);
    if (idx < 0) throw new Error('사일로를 찾을 수 없습니다: ' + siloId);
    list[idx].currentLots.push({
      lotId:      uuid(),
      lotNo:      lotData.lotNo,
      receivingId: lotData.receivingId,
      materialCode: lotData.materialCode,
      materialName: lotData.materialName,
      qty:        Number(lotData.qty),
      inDate:     lotData.inDate || now().split('T')[0],
    });
    // 상태 업데이트
    const sum = getSiloCapacitySummary(list[idx]);
    list[idx].status = sum.status;
    set(SILOS_KEY, list);
    addHistory({ refId: siloId, refType: 'SILO', action: '사일로 LOT 배정', detail: `${lotData.lotNo} / ${lotData.qty}kg`, actor: lotData.actor || '시스템' });
    return list[idx];
  };

  // FIFO 차감
  const consumeFromSiloFIFO = (siloId, amount, actor) => {
    const list = getSilos();
    const idx  = list.findIndex(s => s.id === siloId);
    if (idx < 0) throw new Error('사일로를 찾을 수 없습니다: ' + siloId);

    let remaining = Number(amount);
    const consumed = [];    // [{lotNo, deducted, before, after}]

    const silo = list[idx];
    for (const lot of silo.currentLots) {
      if (remaining <= 0) break;
      const deduct = Math.min(lot.qty, remaining);
      consumed.push({
        siloId,
        materialCode: lot.materialCode || silo.materialCode,
        materialName: lot.materialName || silo.materialName,
        lotNo: lot.lotNo,
        lotId: lot.lotId,
        // 입고건 id 를 같이 들고 나가야 완제품→원료→입고→협력사 역추적이 이어진다.
        // 예전에는 lotNo 문자열로만 되짚어서 LOT 번호가 조금만 달라도 체인이 끊겼다.
        receivingId: lot.receivingId || '',
        inDate: lot.inDate || '',
        deducted: deduct,
        before: lot.qty,
        after: lot.qty - deduct
      });
      lot.qty    -= deduct;
      remaining  -= deduct;
    }

    // 0인 LOT 제거
    list[idx].currentLots = list[idx].currentLots.filter(l => l.qty > 0);
    const sum = getSiloCapacitySummary(list[idx]);
    list[idx].status = sum.status;
    set(SILOS_KEY, list);

    addHistory({ refId: siloId, refType: 'SILO_CONSUME', action: 'FIFO 차감', detail: `${amount}kg 투입 / 차감 LOT: ${consumed.map(c=>c.lotNo).join(',')}`, actor: actor || '시스템' });
    return consumed;
  };

  // 로스 등록
  const LOSS_KEY = 'rm_loss';
  const getLoss = () => get(LOSS_KEY);
  const addLoss = (data) => {
    const list = getLoss();
    const item = {
      id: uuid(),
      siloId: data.siloId,
      lotNo:  data.lotNo || '',
      lossType: data.lossType,   // 분진/이송잔량/샘플채취/폐기/기타
      qty: Number(data.qty),
      reason: data.reason || '',
      actor:  data.actor || '관리자',
      timestamp: now()
    };
    list.push(item);
    set(LOSS_KEY, list);
    // 사일로 재고 차감
    if (data.siloId && data.lotNo) {
      const silos = getSilos();
      const si = silos.findIndex(s => s.id === data.siloId);
      if (si >= 0) {
        const li = silos[si].currentLots.findIndex(l => l.lotNo === data.lotNo);
        if (li >= 0) { silos[si].currentLots[li].qty = Math.max(0, silos[si].currentLots[li].qty - item.qty); }
        silos[si].currentLots = silos[si].currentLots.filter(l => l.qty > 0);
        set(SILOS_KEY, silos);
      }
    }
    addHistory({ refId: data.siloId, refType: 'LOSS', action: `로스 등록(${data.lossType})`, detail: `${data.qty}kg`, actor: item.actor });
    return item;
  };

  const initDefaultSilos = () => {
    if (getSilos().length > 0) return;
    const defaults = [
      { id:'AS-SILO-01', name:'아산 1번 옥수수 사일로', factory:'AS', materialCode:'4401000', materialName:'옥수수', maxCapacity:100000 },
      { id:'AS-SILO-02', name:'아산 2번 대두박 사일로', factory:'AS', materialCode:'4401001', materialName:'대두박', maxCapacity:80000 },
      { id:'AS-SILO-03', name:'아산 3번 소맥 사일로',   factory:'AS', materialCode:'4401021', materialName:'소맥피', maxCapacity:90000 },
      { id:'AS-SILO-04', name:'아산 4번 소맥피 사일로', factory:'AS', materialCode:'4401021', materialName:'소맥피', maxCapacity:90000 },
      { id:'GS-SILO-01', name:'경산 1번 옥수수 사일로', factory:'GS', materialCode:'4401000', materialName:'옥수수', maxCapacity:60000 },
      { id:'GS-SILO-02', name:'경산 2번 대두박 사일로', factory:'GS', materialCode:'4401001', materialName:'대두박', maxCapacity:50000 },
      { id:'NS-SILO-01', name:'논산 1번 옥수수 사일로', factory:'NS', materialCode:'4401000', materialName:'옥수수', maxCapacity:70000 },
      { id:'NS-SILO-02', name:'논산 2번 소맥피 사일로', factory:'NS', materialCode:'4401021', materialName:'소맥피', maxCapacity:55000 },
    ];
    defaults.forEach(d => addSilo(d));
    // 샘플 LOT 추가
    const sampleLots = [
      { siloId:'AS-SILO-01', lotNo:'LOT-001', qty:5000,  inDate:'2026-06-10', receivingId:'', materialCode:'4401000', materialName:'옥수수', actor:'시스템' },
      { siloId:'AS-SILO-01', lotNo:'LOT-004', qty:73000, inDate:'2026-06-12', receivingId:'', materialCode:'4401000', materialName:'옥수수', actor:'시스템' },
      { siloId:'AS-SILO-04', lotNo:'LOT-002', qty:16200, inDate:'2026-06-04', receivingId:'', materialCode:'4401021', materialName:'소맥피', actor:'시스템' },
      { siloId:'GS-SILO-01', lotNo:'LOT-005', qty:30000, inDate:'2026-06-08', receivingId:'', materialCode:'4401000', materialName:'옥수수', actor:'시스템' },
      { siloId:'GS-SILO-02', lotNo:'LOT-006', qty:12000, inDate:'2026-06-09', receivingId:'', materialCode:'4401001', materialName:'대두박', actor:'시스템' },
      { siloId:'NS-SILO-01', lotNo:'LOT-007', qty:45000, inDate:'2026-06-07', receivingId:'', materialCode:'4401000', materialName:'옥수수', actor:'시스템' },
    ];
    sampleLots.forEach(l => assignLotToSilo(l.siloId, l));
  };

  // ============================================================
  // 입고 (Receiving) — 확장
  // ============================================================
  const RECEIVING_KEY = 'rm_receiving';
  const getReceivings       = ()   => get(RECEIVING_KEY);
  const getReceivingById    = (id) => {
    const key = toCode(id);
    return getReceivings().find(x => x.id === key || x.qrCode === key || x.preRegId === key);
  };

  const addReceiving = (data) => {
    const list = getReceivings();
    const id   = data.id || uuid();
    const qrCode = data.qrCode || makeQRValue('RECEIVING', id);
    if (list.some(x => x.qrCode === qrCode)) throw new Error('이미 등록된 QR 코드입니다.');
    if (data.preRegId && list.some(x => x.preRegId === data.preRegId)) throw new Error('이미 등록된 사전입고번호입니다.');
    const factory = data.factory || 'AS';
    // 협력사는 id 로 걸어야 이름이 바뀌어도 연결이 유지된다.
    //   화면에서 검색·선택했으면 supplierId 가 오지만, 자유입력·임포트 경로는 이름만 온다.
    //   그럴 때 마스터에서 이름으로 한 번 찾아 id 를 채워 둔다(못 찾으면 이름만 남긴다).
    const supName = data.supplierName || data.supplier || '';
    let supId = data.supplierId || '';
    if (!supId && supName) supId = getSupplierByName(supName)?.id || '';
    const item = {
      id,
      qrCode,
      preRegId:      data.preRegId || '',          // 협력사 사전입고번호 WS-IN-YYYYMMDD-NNNN
      source:        data.source || 'INTERNAL',
      materialCode:  data.materialCode,
      materialName:  data.materialName,
      supplierId:    supId,
      supplierName:  supName,
      supplier:      data.supplier || data.supplierName || '',
      contact:       data.contact || '',
      factory,                                      // 공장
      factoryName:   data.factoryName || getFactoryName(factory),
      factoryLotCode: data.factoryLotCode || getFactoryLotCode(factory),
      vehicleNo:     data.vehicleNo || '',          // 차량번호
      driverName:    data.driverName || '',
      expectedQty:   Number(data.expectedQty) || 0,
      expectedWeight: Number(data.expectedWeight) || 0,
      unit:          data.unit || 'kg',
      lotNo:         data.lotNo || '',
      receivedDate:  data.receivedDate || now().split('T')[0],
      manufactureDate: data.manufactureDate || '',
      expiryDate:    data.expiryDate || '',
      supplierLot:   data.supplierLot || '',        // 협력사 원 LOT(내부 LOT 와 별개, 원문 그대로)
      invoiceNo:     data.invoiceNo || '',          // 송장번호
      invoiceScan:   data.invoiceScan || null,      // 스캔 원본 메타(PhotoStore)
      attachmentNote: data.attachmentNote || '',
      memo:          data.memo || '',
      status:        data.status || 'PENDING_SCALE',
      // QR_ISSUED → ARRIVED/PENDING_SCALE → PENDING_QC → APPROVED → IN_STOCK
      // 예외: HOLD(보류) / REJECTED(반려·부적합) / CANCELLED(취소)
      isTemporary:   data.isTemporary || false,    // QR 없이 임시 입고
      siloId:        data.siloId || '',             // 배정 사일로
      scanCount:     Number(data.scanCount) || 0,
      qrPrintCount:  Number(data.qrPrintCount) || 0,
      lastQrPrintedAt: data.lastQrPrintedAt || '',
      arrivalAt:     data.arrivalAt || '',
      processedAt:   data.processedAt || '',
      processedBy:   data.processedBy || '',
      holdReason:    data.holdReason || '',
      rejectReason:  data.rejectReason || '',
      weightDiffReason: data.weightDiffReason || '',
      createdAt:     now(),
      createdBy:     data.createdBy || '관리자'
    };
    list.push(item);
    set(RECEIVING_KEY, list);
    addHistory({ refId: id, refType: 'RECEIVING', action: '입고 등록', detail: `${item.materialName} / 예상 ${item.expectedWeight}kg / ${item.factory}`, actor: item.createdBy });
    return item;
  };

  const importReceivingFromQRLink = (rawCode) => {
    const raw = toCode(rawCode);
    if (!raw) return null;

    let params;
    try {
      const base = (typeof window !== 'undefined' && window.location?.href) || 'http://local/';
      params = new URL(raw, base).searchParams;
    } catch (_) {
      return null;
    }

    const qrCode = toCode(params.get('id') || params.get('qr') || params.get('code'));
    if (!/^WS-RECV-/i.test(qrCode)) return null;

    const existing = getReceivingById(qrCode);
    if (existing) return existing;

    const materialCode = toCode(params.get('m'));
    if (!materialCode) return null;

    const material = getMaterialByCode(materialCode);
    const supplierKey = toCode(params.get('sup'));
    const supplier = supplierKey ? (getSupplierById(supplierKey) || getSupplierByCode(supplierKey)) : null;
    const id = toCode(params.get('rid')) || qrCode.replace(/^WS-RECV-/i, '');
    const factory = toCode(params.get('f')) || 'AS';

    try {
      return addReceiving({
        id,
        qrCode,
        preRegId: toCode(params.get('pre')),
        source: 'QR_LINK_IMPORT',
        materialCode,
        materialName: material?.name || materialCode,
        supplierId: supplier?.id || supplierKey,
        supplierName: supplier?.name || '',
        supplier: supplier?.name || supplierKey,
        factory,
        vehicleNo: toCode(params.get('veh')),
        expectedWeight: Number(params.get('w')) || 0,
        lotNo: toCode(params.get('lot')),
        receivedDate: toCode(params.get('dt')) || now().split('T')[0],
        status: toCode(params.get('st')) || 'QR_ISSUED',
        createdBy: 'QR 링크'
      });
    } catch (_) {
      return getReceivingById(qrCode) || null;
    }
  };

  const updateReceiving = (id, patch) => {
    const list = getReceivings();
    const key  = toCode(id);
    const idx  = list.findIndex(x => x.id === key || x.qrCode === key || x.preRegId === key);
    if (idx < 0) return null;
    list[idx] = { ...list[idx], ...patch, updatedAt: now() };
    set(RECEIVING_KEY, list);
    return list[idx];
  };

  // 스캔 횟수 증가
  const incrementScanCount = (id) => {
    const list = getReceivings();
    const idx  = list.findIndex(x => x.id === id);
    if (idx < 0) return;
    list[idx].scanCount = (list[idx].scanCount || 0) + 1;
    set(RECEIVING_KEY, list);
  };

  // 사전입고 번호 생성
  const generatePreRegId = () => {
    const d = new Date();
    const ymd = d.toISOString().split('T')[0].replace(/-/g,'');
    const seq = String(getReceivings().filter(r => r.preRegId?.startsWith('WS-IN-'+ymd)).length + 1).padStart(4,'0');
    return `WS-IN-${ymd}-${seq}`;
  };

  const generateLotNo = (materialCode = '', factory = 'AS') => {
    const d = new Date();
    const ymd = d.toISOString().split('T')[0].replace(/-/g,'');
    const factoryCode = getFactoryLotCode(factory);
    const prefix = materialCode ? `LOT-${factoryCode}-${materialCode}-${ymd}` : `LOT-${factoryCode}-${ymd}`;
    const seq = String(getReceivings().filter(r => (r.lotNo || '').startsWith(prefix)).length + 1).padStart(4,'0');
    return `${prefix}-${seq}`;
  };

  const getSupplierPreNotices = () => getReceivings()
    .filter(r => r.source === 'SUPPLIER_PORTAL' || r.status === 'QR_ISSUED' || r.status === 'ARRIVED');

  const addSupplierPreNotice = (data) => {
    const material = getMaterialByCode(data.materialCode);
    const supplier = data.supplierId ? getSupplierById(data.supplierId) : null;
    const materialCode = toCode(data.materialCode);
    if (!materialCode) throw new Error('원료코드를 입력해주세요.');
    if (!data.expectedWeight || Number(data.expectedWeight) <= 0) throw new Error('예정중량을 입력해주세요.');

    const item = addReceiving({
      ...data,
      source: 'SUPPLIER_PORTAL',
      preRegId: data.preRegId || generatePreRegId(),
      materialCode,
      materialName: data.materialName || material?.name || '',
      supplierId: supplier?.id || data.supplierId || '',
      supplierName: supplier?.name || data.supplierName || data.supplier || '',
      supplier: supplier?.name || data.supplier || data.supplierName || '',
      lotNo: data.lotNo || generateLotNo(materialCode, data.factory || 'AS'),
      status: 'QR_ISSUED',
      createdBy: data.createdBy || '협력사'
    });
    addHistory({
      refId: item.id,
      refType: 'RECEIVING',
      action: QR_ON ? '협력사 입고예정 QR 발행' : '입고예정 등록',
      detail: `${item.supplierName || item.supplier || '-'} / ${item.materialName} / ${item.expectedWeight}kg`,
      actor: item.createdBy
    });
    return item;
  };

  const markQrPrinted = (receivingId) => {
    const item = getReceivingById(receivingId);
    if (!item) throw new Error('입고 문서를 찾을 수 없습니다.');
    const updated = updateReceiving(item.id, {
      qrPrintCount: (Number(item.qrPrintCount) || 0) + 1,
      lastQrPrintedAt: now()
    });
    addHistory({
      refId: item.id,
      refType: 'RECEIVING',
      action: 'QR 라벨 출력',
      detail: `${item.preRegId || item.id} / ${item.qrCode}`,
      actor: '협력사'
    });
    return updated;
  };

  const processSupplierInbound = (receivingId, action, patch = {}) => {
    const item = getReceivingById(receivingId);
    if (!item) throw new Error('입고 문서를 찾을 수 없습니다.');
    const closed = ['IN_STOCK', 'CANCELLED', 'REJECTED'];
    const requested = String(action || '').toUpperCase();
    if (closed.includes(item.status)) {
      throw new Error(`이미 종료된 ${QR_ON ? 'QR' : '입고 건'}입니다. 중복 입고 처리가 불가합니다.`);
    }

    const actor = patch.actor || patch.processedBy || '현장';
    let update = { processedAt: now(), processedBy: actor };
    let historyAction = '';
    let historyDetail = '';

    if (requested === 'ARRIVE') {
      update = { ...update, status: 'ARRIVED', arrivalAt: patch.arrivalAt || item.arrivalAt || now() };
      historyAction = '납품 도착 확인';
      historyDetail = `${item.vehicleNo || patch.vehicleNo || '-'} / ${item.expectedWeight || 0}kg`;
    } else if (requested === 'HOLD') {
      update = { ...update, status: 'HOLD', holdReason: patch.reason || patch.holdReason || '' };
      historyAction = '입고 보류';
      historyDetail = update.holdReason || '사유 미입력';
    } else if (requested === 'REJECT') {
      update = { ...update, status: 'REJECTED', rejectReason: patch.reason || patch.rejectReason || '' };
      historyAction = '입고 반려';
      historyDetail = update.rejectReason || '사유 미입력';
    } else if (requested === 'CANCEL') {
      update = { ...update, status: 'CANCELLED', rejectReason: patch.reason || patch.rejectReason || '' };
      historyAction = '입고예정 취소';
      historyDetail = update.rejectReason || '사유 미입력';
    } else {
      throw new Error('알 수 없는 처리 액션입니다.');
    }

    if (patch.vehicleNo) update.vehicleNo = patch.vehicleNo;
    if (patch.driverName) update.driverName = patch.driverName;
    if (patch.contact) update.contact = patch.contact;
    if (patch.memo) update.memo = [item.memo, patch.memo].filter(Boolean).join(' / ');

    const updated = updateReceiving(item.id, update);
    addHistory({ refId: item.id, refType: 'RECEIVING', action: historyAction, detail: historyDetail, actor });
    return updated;
  };

  // 예외 처리 로그
  const EXCEPTIONS_KEY = 'rm_exceptions';
  const getExceptions = () => get(EXCEPTIONS_KEY);
  const addException = (data) => {
    const list = getExceptions();
    const item = {
      id: uuid(),
      type: data.type,   // QR_MISSING/QR_DUPLICATE/WEIGHT_DIFF/QR_DAMAGED
      detail: data.detail || '',
      vehicleNo: data.vehicleNo || '',
      receivingId: data.receivingId || '',
      resolved: false,
      actor: data.actor || '현장',
      timestamp: now()
    };
    list.push(item);
    set(EXCEPTIONS_KEY, list);
    return item;
  };
  const resolveException = (id) => {
    const list = getExceptions();
    const idx  = list.findIndex(e => e.id === id);
    if (idx >= 0) { list[idx].resolved = true; list[idx].resolvedAt = now(); set(EXCEPTIONS_KEY, list); }
  };

  // ============================================================
  // 계근 (Weighing)
  // ============================================================
  const WEIGHING_KEY = 'rm_weighing';
  const getWeighings             = ()           => get(WEIGHING_KEY);
  const getWeighingByReceivingId = (receivingId) => getWeighings().find(x => x.receivingId === receivingId);

  const addWeighing = (data) => {
    const list      = getWeighings();
    const receiving = getReceivingById(data.receivingId);
    if (!receiving) throw new Error('입고 문서를 찾을 수 없습니다.');
    if (['IN_STOCK', 'REJECTED', 'CANCELLED'].includes(receiving.status)) {
      throw new Error('이미 종료된 입고 건은 계근 처리할 수 없습니다.');
    }
    const expected  = receiving.expectedWeight;
    const actual    = Number(data.actualWeight);
    const diff      = actual - expected;
    const diffPct   = expected > 0 ? ((diff / expected) * 100) : 0;
    const settings  = getSettings();
    let weightStatus = 'NORMAL';
    if (Math.abs(diffPct) > (settings.weightAlertPct || 2))    weightStatus = 'ALERT';
    else if (Math.abs(diffPct) > (settings.weightWarnPct || 0.5)) weightStatus = 'WARNING';

    const item = {
      id: uuid(),
      receivingId: data.receivingId,
      materialCode: receiving.materialCode,
      materialName: receiving.materialName,
      factory: receiving.factory,
      expectedWeight: expected,
      actualWeight: actual,
      diff: parseFloat(diff.toFixed(3)),
      diffPct: parseFloat(diffPct.toFixed(2)),
      weightStatus,
      vehicleNo:  data.vehicleNo  || receiving.vehicleNo || '',
      driverName: data.driverName || '',
      weighedAt:  now(),
      weighedBy:  data.weighedBy || '현장',
      diffReason: data.diffReason || '',
      memo:       data.memo || ''
    };
    list.push(item);
    set(WEIGHING_KEY, list);

    const newStatus = weightStatus === 'ALERT' ? 'PENDING_APPROVAL' : 'PENDING_QC';
    updateReceiving(data.receivingId, {
      status: newStatus,
      actualWeight: actual,
      vehicleNo: item.vehicleNo,
      driverName: item.driverName || receiving.driverName || '',
      arrivalAt: receiving.arrivalAt || now()
    });
    if (weightStatus === 'ALERT') addException({ type:'WEIGHT_DIFF', detail:`편차 ${diffPct.toFixed(2)}% - ${data.diffReason}`, vehicleNo: item.vehicleNo, receivingId: data.receivingId, actor: item.weighedBy });
    addHistory({ refId: data.receivingId, refType: 'WEIGHING', action: '계근 완료', detail: `실측 ${actual}kg / 편차 ${diffPct.toFixed(2)}% [${weightStatus}]`, actor: item.weighedBy });
    return item;
  };

  // ============================================================
  // 품질 게이트 설정 (5-Gate)
  // ============================================================
  const QC_CONFIG_KEY  = 'rm_qc_config';
  const defaultQCGates = [
    { id:'gate1', order:1, name:'Gate 1 입고확인',    icon:'', items:[...(QR_ON ? ['QR 코드 확인'] : []),'차량번호 일치','원료명 일치','계근값 확인','서류 확인'], required:true  },
    { id:'gate2', order:2, name:'Gate 2 입고검수',    icon:'', items:['포장 상태','이물질 여부','색상/냄새 이상','수분흡습 여부','유통기한 확인'], required:true  },
    { id:'gate3', order:3, name:'Gate 3 분석결과',    icon:'', items:['수분 함량(기준이하)','단백질 함량','지방 함량','회분 함량','위해요소 검사'], required:false },
    { id:'gate4', order:4, name:'Gate 4 품질판정',    icon:'', items:['종합 판정'], required:true  },
    { id:'gate5', order:5, name:'Gate 5 투입허가',    icon:'', items:['생산 투입 승인'], required:true  },
  ];
  const getQCConfig  = ()      => { const c = localStorage.getItem(QC_CONFIG_KEY); return c ? JSON.parse(c) : defaultQCGates; };
  const saveQCConfig = (gates) => { localStorage.setItem(QC_CONFIG_KEY, JSON.stringify(gates)); notifyWrite(QC_CONFIG_KEY); };

  // ============================================================
  // 품질 검사 기록
  // ============================================================
  const QC_KEY       = 'rm_quality';
  const getInspections = ()   => get(QC_KEY);
  const getInspectionsByReceivingId = (receivingId) => getInspections().filter(x => x.receivingId === receivingId);

  // 불합격 원인코드 — 부적합 원인별 집계(실패비용 파레토)의 기준값.
  //   화면에서 하드코딩하지 말고 여기 한 곳에서만 정의한다.
  const FAIL_CODES = [
    { code: 'A001', label: '포장 불량' },
    { code: 'A002', label: '이물질 혼입' },
    { code: 'A003', label: '수분 이상' },
    { code: 'A004', label: '성분 미달' },
    { code: 'A005', label: '외관 불량' },
    { code: 'B001', label: '규격 불일치' },
    { code: 'OTHER', label: '기타' },
  ];
  const failCodeLabel = (code) => {
    if (!code) return '미분류';
    const f = FAIL_CODES.find(x => x.code === code);
    return f ? `${f.code} · ${f.label}` : code;
  };

  const addInspection = (data) => {
    const list      = getInspections();
    const failItems = (data.checkItems || []).filter(ci => ci.result === 'FAIL');
    const verdict   = data.verdict || (failItems.length === 0 ? 'PASS' : 'FAIL');

    // 합격 건에는 원인코드·사유를 남기지 않는다.
    //   화면의 원인코드 select 는 숨겨져 있어도 DOM 에 살아 있어 기본값(A001)이 딸려왔다.
    //   → 합격 건에도 '포장 불량'이 박혀 원인별 통계가 통째로 오염됐다.
    //   화면에서 막더라도 다른 호출부가 생길 수 있으므로 저장 직전에 한 번 더 막는다.
    const hasDefect = verdict === 'FAIL' || verdict === 'CONDITIONAL' || failItems.length > 0;

    const item = {
      id: uuid(),
      receivingId:  data.receivingId,
      gateId:       data.gateId,
      gateName:     data.gateName,
      materialCode: data.materialCode,
      materialName: data.materialName,
      checkItems:   data.checkItems || [],
      verdict,                    // PASS / FAIL / CONDITIONAL
      judgement:    data.judgement || '',   // Gate4: 적합/조건부/보류/부적합
      failReason:   hasDefect ? (data.failReason || '') : '',
      failCode:     hasDefect ? (data.failCode || '') : '',
      imageBase64:  data.imageBase64 || null,
      inspector:    data.inspector || '검사자',
      inspectedAt:  now(),
      memo:         data.memo || ''
    };
    list.push(item);
    set(QC_KEY, list);

    // 상태 업데이트 로직
    const allGates   = getQCConfig();
    const doneGates  = list.filter(i => i.receivingId === data.receivingId);
    const anyFail    = doneGates.some(i => i.verdict === 'FAIL');
    const gate4Done  = doneGates.find(i => i.gateId === 'gate4');

    if (anyFail) {
      const judgement4 = gate4Done?.judgement || '';
      if (judgement4 === '보류')     updateReceiving(data.receivingId, { status: 'HOLD' });
      else if (judgement4 === '부적합') updateReceiving(data.receivingId, { status: 'REJECTED' });
      else updateReceiving(data.receivingId, { status: 'REJECTED' });
    } else {
      const reqGates = allGates.filter(g => g.required).map(g => g.id);
      // 필수 게이트별로 중복(재검사) 제거 후 카운트 — 같은 게이트 재검사가 조기 합격을 유발하지 않도록
      const doneReqIds = [...new Set(
        doneGates.filter(g => reqGates.includes(g.gateId) && g.verdict !== 'FAIL').map(g => g.gateId)
      )];
      if (doneReqIds.length >= reqGates.length) updateReceiving(data.receivingId, { status: 'APPROVED' });
    }

    addHistory({ refId: data.receivingId, refType: 'QC', action: `${data.gateName} 완료`, detail: `판정: ${verdict}${failItems.length>0?' / 불합격:'+failItems.map(i=>i.name).join(','):''}`, actor: item.inspector });
    return item;
  };

  // ============================================================
  // 품질/R&D 분석 데이터
  // ============================================================
  const RAW_ANALYSIS_KEY = 'rm_raw_analysis';
  const PRODUCT_ANALYSIS_KEY = 'rm_product_analysis';
  const getRawAnalyses = () => get(RAW_ANALYSIS_KEY);
  const getProductAnalyses = () => get(PRODUCT_ANALYSIS_KEY);
  const getRawAnalysesByMaterial = (materialCode) => getRawAnalyses().filter(a => a.materialCode === toCode(materialCode));
  const getProductAnalysesByProduct = (productCode) => getProductAnalyses().filter(a => a.productCode === toCode(productCode));

  const addRawAnalysis = (data) => {
    const list = getRawAnalyses();
    const receiving = data.receivingId ? getReceivingById(data.receivingId) : null;
    const material = data.materialCode ? getMaterialByCode(data.materialCode) : null;
    const item = {
      id: data.id || newId('RAN-'),
      receivingId: data.receivingId || '',
      materialCode: toCode(data.materialCode || receiving?.materialCode || ''),
      materialName: data.materialName || receiving?.materialName || material?.name || '',
      lotNo: data.lotNo || receiving?.lotNo || '',
      supplierName: data.supplierName || receiving?.supplierName || receiving?.supplier || '',
      moisture: Number(data.moisture) || 0,
      protein: Number(data.protein) || 0,
      fat: Number(data.fat) || 0,
      fiber: Number(data.fiber) || 0,
      ash: Number(data.ash) || 0,
      toxin: data.toxin || '',
      verdict: data.verdict || 'PASS',
      analyst: data.analyst || 'R&D',
      memo: data.memo || '',
      analyzedAt: data.analyzedAt || now()
    };
    list.push(item);
    set(RAW_ANALYSIS_KEY, list);
    addHistory({ refId: item.materialCode || item.id, refType: 'QC', action: '원료 분석 등록', detail: `${item.materialName} / LOT ${item.lotNo || '-'} / ${item.verdict}`, actor: item.analyst });
    return item;
  };

  const addProductAnalysis = (data) => {
    const list = getProductAnalyses();
    const lot = data.productLotId ? getProductLotById(data.productLotId) : null;
    const product = data.productCode ? getProductByCode(data.productCode) : null;
    const item = {
      id: data.id || newId('PAN-'),
      productLotId: data.productLotId || '',
      fgLotNo: data.fgLotNo || lot?.fgLotNo || '',
      productCode: toCode(data.productCode || lot?.productCode || ''),
      productName: data.productName || lot?.productName || product?.name || '',
      moisture: Number(data.moisture) || 0,
      protein: Number(data.protein) || 0,
      fat: Number(data.fat) || 0,
      fiber: Number(data.fiber) || 0,
      ash: Number(data.ash) || 0,
      pelletDurability: Number(data.pelletDurability) || 0,
      verdict: data.verdict || 'PASS',
      analyst: data.analyst || 'R&D',
      memo: data.memo || '',
      analyzedAt: data.analyzedAt || now()
    };
    list.push(item);
    set(PRODUCT_ANALYSIS_KEY, list);
    addHistory({ refId: item.productLotId || item.productCode || item.id, refType: 'QC', action: '제품 분석 등록', detail: `${item.productName} / ${item.fgLotNo || '-'} / ${item.verdict}`, actor: item.analyst });
    return item;
  };

  // ============================================================
  // 재고 (Inventory) — 톤백/지대 재고
  // ============================================================
  const INVENTORY_KEY      = 'rm_inventory';
  const getInventory       = ()    => get(INVENTORY_KEY);
  const getInventoryByCode = (code) => getInventory().find(x => x.materialCode === code);

  const registerStock = (data) => {
    const receiving = getReceivingById(data.receivingId);
    if (!receiving) throw new Error('입고 문서 없음');
    if (receiving.status === 'IN_STOCK') throw new Error(`이미 재고 등록된 ${QR_ON ? 'QR' : '입고 건'}입니다. 중복 입고가 불가합니다.`);
    if (['REJECTED', 'CANCELLED'].includes(receiving.status)) throw new Error('반려 또는 취소된 입고 건은 재고 등록할 수 없습니다.');
    const list     = getInventory();
    const weighing = getWeighingByReceivingId(data.receivingId);
    const actualWeight = weighing ? weighing.actualWeight : receiving.expectedWeight;
    const actualQty    = Number(data.actualQty) || receiving.expectedQty || 1;
    const bin          = data.binLocation || 'A-01-01';   // 위치 기본값을 한 곳에서 확정(조회/등록/반환 일관성)
    const existing     = list.findIndex(x => x.materialCode === receiving.materialCode && x.binLocation === bin && x.factory === receiving.factory);

    if (existing >= 0) {
      list[existing].qty    += actualQty;
      list[existing].weight += actualWeight;
      list[existing].updatedAt = now();
      list[existing].lots.push({ lotNo: receiving.lotNo, qty: actualQty, receivingId: data.receivingId, receivedDate: receiving.receivedDate });
    } else {
      list.push({
        id: uuid(),
        materialCode: receiving.materialCode,
        materialName: receiving.materialName,
        factory:      receiving.factory || 'AS',
        qty: actualQty, weight: actualWeight,
        unit: receiving.unit || 'kg',
        binLocation: bin,
        warehouse:   data.warehouse   || '본창고',
        packType:    data.packType    || 'BULK',   // BULK/TONBAG/SACK
        minStock: data.minStock || 0,
        lots: [{ lotNo: receiving.lotNo, qty: actualQty, receivingId: data.receivingId, receivedDate: receiving.receivedDate }],
        createdAt: now(), updatedAt: now()
      });
    }
    set(INVENTORY_KEY, list);
    updateReceiving(data.receivingId, { status: 'IN_STOCK', binLocation: bin });
    addHistory({ refId: data.receivingId, refType: 'INVENTORY', action: '재고 등록', detail: `${receiving.materialName} ${actualQty}개(${actualWeight}kg) → ${bin}`, actor: data.registeredBy || '시스템' });
    return list.find(x => x.materialCode === receiving.materialCode && x.binLocation === bin && x.factory === receiving.factory);
  };

  const adjustInventory = (materialCode, binLocation, delta, reason, actor) => {
    const list = getInventory();
    const idx  = list.findIndex(x => x.materialCode === materialCode && x.binLocation === binLocation);
    if (idx < 0) return null;
    // delta 는 수량(개/포) 증감. 중량(kg)은 단위중량 비율로 함께 보정(포장 원료 qty/weight 불일치 방지)
    const row   = list[idx];
    const unitW = row.qty > 0 ? (row.weight / row.qty) : 0;
    row.qty     = Math.max(0, row.qty + delta);
    row.weight  = row.qty === 0 ? 0 : Math.max(0, Math.round((row.weight + delta * unitW) * 100) / 100);
    row.updatedAt = now();
    set(INVENTORY_KEY, list);
    addHistory({ refId: materialCode, refType: 'ADJUST', action: '재고 조정', detail: `${delta>0?'+':''}${delta} / 사유: ${reason}`, actor: actor || '관리자' });
    return list[idx];
  };

  // ============================================================
  // 투입지시 (Production Orders)
  // ============================================================
  const PROD_ORDERS_KEY   = 'rm_production_orders';
  const getProductionOrders = ()   => get(PROD_ORDERS_KEY);
  const getProductionOrderById = (id) => getProductionOrders().find(o => o.id === id);

  // ============================================================
  // 배합비 마스터
  // ============================================================
  const FORMULA_KEY = 'rm_formula_recipes';
  const getFormulaRecipes = () => get(FORMULA_KEY);
  const getFormulaRecipeById = (id) => getFormulaRecipes().find(f => f.id === id);
  const getFormulaRecipesByProduct = (productCode) => getFormulaRecipes().filter(f => f.productCode === toCode(productCode));

  const normalizeFormulaIngredients = (ingredients = [], targetQty = 1000) => {
    const totalPct = ingredients.reduce((s, i) => s + (Number(i.pct) || 0), 0);
    return ingredients
      .filter(i => i && (i.materialCode || i.materialName || Number(i.pct) > 0))
      .map(i => {
        const material = i.materialCode ? getMaterialByCode(i.materialCode) : null;
        const pct = Number(i.pct) || 0;
        return {
          materialCode: toCode(i.materialCode || material?.code || ''),
          materialName: i.materialName || material?.name || '',
          pct,
          qty: Number(i.qty) || (totalPct > 0 ? Number((targetQty * pct / 100).toFixed(3)) : 0),
          note: i.note || ''
        };
      });
  };

  const addFormulaRecipe = (data) => {
    const list = getFormulaRecipes();
    const product = data.productCode ? getProductByCode(data.productCode) : null;
    const targetQty = Number(data.targetQty) || 1000;
    const id = data.id || newId('FRM-');
    const item = {
      id,
      formulaCode: data.formulaCode || id,
      productCode: toCode(data.productCode || ''),
      productName: data.productName || product?.name || '',
      version: data.version || 'v1',
      status: data.status || 'ACTIVE',
      targetQty,
      ingredients: normalizeFormulaIngredients(data.ingredients || [], targetQty),
      specialNotes: data.specialNotes || '',
      caution: data.caution || '',
      ownerTeam: data.ownerTeam || '배합비팀',
      createdBy: data.createdBy || '배합비팀',
      createdAt: now(),
      updatedAt: now()
    };
    list.push(item);
    set(FORMULA_KEY, list);
    addHistory({ refId: id, refType: 'BATCH', action: '배합비 등록', detail: `${item.productName || item.productCode} / ${item.version} / 원료 ${item.ingredients.length}종`, actor: item.createdBy });
    return item;
  };

  const updateFormulaRecipe = (id, patch) => {
    const list = getFormulaRecipes();
    const idx = list.findIndex(f => f.id === id);
    if (idx < 0) return null;
    const before = { ...list[idx] };
    const merged = { ...list[idx], ...patch };
    merged.ingredients = normalizeFormulaIngredients(merged.ingredients || [], Number(merged.targetQty) || 1000);
    // 배합비 개정 이력 — 규제상 가장 중요. 누가·언제·무엇을 바꿨는지 남긴다.
    if (window.AuditLog) AuditLog.record(merged, before, {
      productName: '제품명', productCode: '제품코드', version: '버전', status: '상태',
      targetQty: '기준량', ingredients: '원료 구성비', note: '특이사항',
    }, { by: patch.updatedBy });
    else merged.updatedAt = now();
    list[idx] = merged;
    set(FORMULA_KEY, list);
    return merged;
  };

  const addProductionOrder = (data) => {
    const list = getProductionOrders();
    const id   = newId('ORD-');
    const item = {
      id, orderId: id,
      factory:      data.factory     || 'AS',
      siloId:       data.siloId      || '',
      materialCode: data.materialCode || '',
      materialName: data.materialName || '',
      amount:       Number(data.amount),
      unit:         data.unit        || 'kg',
      status:       'PENDING',       // PENDING / EXECUTING / DONE
      productCode:  data.productCode || '',
      productName:  data.productName || '',
      note:         data.note        || '',
      actor:        data.actor       || '생산팀',
      createdAt:    now()
    };
    // 사용가능 원료만 투입 가능 체크
    const silo = getSiloById(data.siloId);
    if (silo) {
      const sum = getSiloCapacitySummary(silo);
      if (sum.totalQty < item.amount) throw new Error(`사일로 재고 부족: 현재 ${sum.totalQty}kg / 요청 ${item.amount}kg`);
    }
    list.push(item);
    set(PROD_ORDERS_KEY, list);
    addHistory({ refId: id, refType: 'PRODUCTION', action: '투입지시 생성', detail: `${data.materialName} ${data.amount}kg → ${data.siloId}`, actor: item.actor });
    return item;
  };

  const executeProductionOrder = (orderId, actor) => {
    const orders = getProductionOrders();
    const idx    = orders.findIndex(o => o.id === orderId);
    if (idx < 0) throw new Error('투입지시를 찾을 수 없습니다.');
    const order  = orders[idx];
    if (order.status !== 'PENDING') throw new Error('이미 처리된 투입지시입니다.');

    // FIFO 차감
    const consumed = consumeFromSiloFIFO(order.siloId, order.amount, actor);
    orders[idx].status     = 'DONE';
    orders[idx].executedAt = now();
    orders[idx].consumedLots = consumed;
    set(PROD_ORDERS_KEY, orders);
    addHistory({ refId: orderId, refType: 'PRODUCTION', action: '투입 실행(FIFO)', detail: consumed.map(c=>`${c.lotNo}:${c.deducted}kg`).join('/'), actor: actor || '생산팀' });
    return orders[idx];
  };

  // ============================================================
  // 배합 배치 (Mixing Batches)
  // ============================================================
  const BATCH_KEY     = 'rm_mixing_batches';
  const getBatches    = ()   => get(BATCH_KEY);
  const getBatchById  = (id) => getBatches().find(b => b.id === id);

  // 배합에 붙일 수 있는 투입지시 — 실행 완료됐고 아직 어느 배치에도 묶이지 않은 것
  const getUnbatchedOrders = (factory) => getProductionOrders()
    .filter(o => o.status === 'DONE' && !o.batchId && (!factory || factory === 'ALL' || o.factory === factory))
    .sort((a, b) => String(b.executedAt || b.createdAt).localeCompare(String(a.executedAt || a.createdAt)));

  const addBatch = (data) => {
    const list = getBatches();
    const id   = newId('MIX-');

    // 투입지시를 고르면 그 FIFO 차감 결과를 배치의 투입 LOT 으로 그대로 가져온다.
    //   이 연결이 없으면 완제품에서 원료로 거슬러 올라갈 방법이 사라진다(역추적 단절).
    const orderIds = Array.isArray(data.orderIds) ? data.orderIds.filter(Boolean) : [];
    let consumed = Array.isArray(data.consumedLots) ? data.consumedLots.slice() : [];
    if (orderIds.length) {
      const orders = getProductionOrders();
      orderIds.forEach(oid => {
        const o = orders.find(x => x.id === oid);
        (o?.consumedLots || []).forEach(c => consumed.push({ ...c, orderId: oid }));
      });
    }

    const item = {
      id,
      batchCode:    data.batchCode   || id,
      factory:      data.factory     || 'AS',
      productCode:  data.productCode || '',
      productName:  data.productName || '',
      formulaId:    data.formulaId   || '',   // 사용한 배합비
      formulaCode:  data.formulaCode || '',
      orderIds,                               // 투입지시 연결
      formula:      data.formula     || [],   // [{materialCode, materialName, qty}]
      consumedLots: consumed,                 // [{siloId, lotNo, receivingId, materialCode, deducted, orderId}]
      totalQty:     Number(data.totalQty) || 0,
      status:       'DONE',
      productLotId: '',
      actor:        data.actor || '배합팀',
      batchedAt:    now()
    };
    list.push(item);
    set(BATCH_KEY, list);

    // 투입지시에 역참조를 남겨 같은 지시가 두 배치에 중복으로 붙지 않게 한다
    if (orderIds.length) {
      const orders = getProductionOrders();
      let touched = false;
      orders.forEach(o => { if (orderIds.includes(o.id)) { o.batchId = id; touched = true; } });
      if (touched) set(PROD_ORDERS_KEY, orders);
    }

    const lotTxt = consumed.length ? ` / 투입LOT ${consumed.length}건` : '';
    addHistory({ refId: id, refType: 'BATCH', action: '배합 완료', detail: `${data.productName} ${data.totalQty}kg${lotTxt}`, actor: item.actor });
    return item;
  };

  // ============================================================
  // 제품 LOT (Product Lots)
  // ============================================================
  const PRODUCT_LOT_KEY = 'rm_product_lots';
  const getProductLots  = ()   => get(PRODUCT_LOT_KEY);
  const getProductLotById = (id) => getProductLots().find(p => p.id === id);
  const updateProductLot = (id, patch) => {
    const list = getProductLots();
    const i = list.findIndex(p => p.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, id: list[i].id };
    set(PRODUCT_LOT_KEY, list);
    return list[i];
  };

  // ── 제품 유통기한(보관기간) 기준 ──
  //   사료는 축종·제품군별로 통상 유통기한이 다르다. 제품 마스터에 개별 값이 없으므로
  //   축종 기본값(개월)을 설정으로 두고, 제품 LOT 생성 시 제조일 기준으로 자동 계산한다.
  const SHELF_KEY = 'shelf_life_config';
  const SHELF_DEFAULT = { 양축: 3, 양어: 3, 반려: 12, 기타: 6, _raw: 6 };
  const getShelfConfig = () => {
    try { return { ...SHELF_DEFAULT, ...(JSON.parse(localStorage.getItem(SHELF_KEY) || '{}')) }; }
    catch (_) { return { ...SHELF_DEFAULT }; }
  };
  const setShelfConfig = (cfg) => {
    localStorage.setItem(SHELF_KEY, JSON.stringify({ ...getShelfConfig(), ...(cfg || {}) }));
  };
  const shelfMonthsFor = (productCode) => {
    const cfg = getShelfConfig();
    let cat = '기타';
    try { if (typeof LabDB !== 'undefined' && LabDB.productCategory) cat = LabDB.productCategory(productCode) || '기타'; } catch (_) {}
    return Number(cfg[cat]) || Number(cfg.기타) || 6;
  };
  // 날짜 문자열 포맷은 반드시 로컬 기준으로 만든다.
  //   toISOString() 은 UTC 로 바꾸므로 KST(+9)에서는 하루 앞당겨진다(유통기한 오산출 원인).
  const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addMonthsTo = (dateStr, months) => {
    if (!dateStr) return '';
    const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    if (isNaN(d)) return '';
    const day = d.getDate();
    d.setMonth(d.getMonth() + (Number(months) || 0));
    if (d.getDate() < day) d.setDate(0);   // 말일 보정
    return ymdLocal(d);
  };
  const addDaysTo = (dateStr, days) => {
    if (!dateStr) return '';
    const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    if (isNaN(d)) return '';
    d.setDate(d.getDate() + (Number(days) || 0));
    return ymdLocal(d);
  };
  // 영업일(주말 제외) 더하기 — 답변기한 산출용.
  //   시작일이 주말이면 다음 영업일부터 센다. 공휴일은 반영하지 않는다(주말만 제외).
  const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
  const addBusinessDays = (dateStr, days) => {
    if (!dateStr) return '';
    const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    if (isNaN(d)) return '';
    let left = Math.max(0, Number(days) || 0);
    while (left > 0) { d.setDate(d.getDate() + 1); if (!isWeekend(d)) left--; }
    while (isWeekend(d)) d.setDate(d.getDate() + 1);   // 기한이 주말이면 다음 영업일로
    return ymdLocal(d);
  };
  // 두 날짜 사이의 영업일 수(from 제외, to 포함) — 기한 초과일 계산용
  const businessDaysBetween = (from, to) => {
    if (!from || !to) return 0;
    const a = new Date(String(from).slice(0, 10) + 'T00:00:00');
    const b = new Date(String(to).slice(0, 10) + 'T00:00:00');
    if (isNaN(a) || isNaN(b) || b <= a) return 0;
    let n = 0;
    const cur = new Date(a);
    while (cur < b) { cur.setDate(cur.getDate() + 1); if (!isWeekend(cur)) n++; }
    return n;
  };

  const addProductLot = (data) => {
    const list = getProductLots();
    const id   = newId('FG-');
    const fgLotNo = data.fgLotNo || id;
    const item = {
      id,
      fgLotNo,
      factory:     data.factory    || 'AS',
      productCode: data.productCode || '',
      productName: data.productName,
      qrCode:      data.qrCode     || makeQRValue('PRODUCT_LOT', fgLotNo),
      productQrCode: data.productCode ? makeQRValue('PRODUCT', data.productCode) : '',
      batchId:     data.batchId    || '',
      qty:         Number(data.qty),
      unit:        data.unit       || 'kg',
      packType:    data.packType   || '20kg포대',
      packCount:   Number(data.packCount) || 0,
      // 제조일은 현지(KST) 날짜 — UTC 로 자르면 새벽 생산분이 전날로 찍혀 포대 제조일자로 못 찾는다
      productionDate: data.productionDate || ymdLocal(new Date()),
      // 유통기한 미지정 시 제조일 + 축종별 기본 보관기간으로 자동 산정(유통기한 임박 관리에 사용)
      expiryDate:  data.expiryDate || addMonthsTo(data.productionDate || ymdLocal(new Date()), shelfMonthsFor(data.productCode)),
      status:      'AVAILABLE',    // AVAILABLE / SHIPPED / RETURNED
      actor:       data.actor      || '포장팀',
      createdAt:   now()
    };
    list.push(item);
    set(PRODUCT_LOT_KEY, list);
    // 배합 배치에 연결
    if (data.batchId) {
      const batches = getBatches();
      const bi = batches.findIndex(b => b.id === data.batchId);
      if (bi >= 0) { batches[bi].productLotId = id; set(BATCH_KEY, batches); }
    }
    addHistory({ refId: id, refType: 'PRODUCT', action: '제품LOT 생성', detail: `${data.productName} ${data.qty}kg`, actor: item.actor });
    return item;
  };

  // ============================================================
  // VOC (클레임/불만 역추적)
  // ============================================================
  const VOC_KEY = 'rm_voc';
  const VOC_DEL_KEY = 'rm_voc_deleted';   // 임포트 레코드 삭제표시

  // ── VOC 대장 임포트(코드 상주, localStorage·동기화 부담 없이 읽기 시 병합) ──
  //   window.VOC_IMPORT.records = 과거 VOC 대장(사료·반려·양어). 라이브(rm_voc) id 가 우선.
  //   임포트본을 수정하면 라이브로 복사된다(copy-on-write) → 재발방지대책 소급 입력 가능.
  let _vocImpCache = null;
  const vocImportRecords = () => {
    if (_vocImpCache) return _vocImpCache;
    const src = (typeof window !== 'undefined' && window.VOC_IMPORT && Array.isArray(window.VOC_IMPORT.records))
      ? window.VOC_IMPORT.records : [];
    _vocImpCache = src.map(r => ({
      vocNo: r.id, status: 'CLOSED', severity: 'LOW', category: '기타',
      factory: '', photos: [], logs: [], investigation: '', action: '', rootCause: '', rootType: '', prevention: '',
      ...r,
      registeredAt: r.receivedAt || '',
      imported: true,
    }));
    return _vocImpCache;
  };
  const vocDeleted = () => { try { return new Set(JSON.parse(localStorage.getItem(VOC_DEL_KEY) || '[]')); } catch (_) { return new Set(); } };

  const getVOCs = () => {
    const live = get(VOC_KEY);
    const liveIds = new Set(live.map(v => v.id));
    const del = vocDeleted();
    const imp = vocImportRecords().filter(v => !liveIds.has(v.id) && !del.has(v.id));
    return live.filter(v => !del.has(v.id)).concat(imp);
  };
  const getVOCById = (id) => getVOCs().find(v => v.id === id);

  // 임포트본을 라이브로 끌어올린다(수정 진입점). 이미 라이브면 그대로.
  const vocLiveIndex = (live, id) => {
    let i = live.findIndex(v => v.id === id);
    if (i >= 0) return i;
    const imp = vocImportRecords().find(v => v.id === id);
    if (!imp) return -1;
    live.push({ ...imp });
    return live.length - 1;
  };

  const deleteVOC = (id) => {
    const live = get(VOC_KEY);
    const next = live.filter(v => v.id !== id);
    if (next.length !== live.length) set(VOC_KEY, next);
    if (vocImportRecords().some(v => v.id === id)) {
      const del = vocDeleted(); del.add(id);
      localStorage.setItem(VOC_DEL_KEY, JSON.stringify([...del]));
      notifyWrite(VOC_DEL_KEY);
    }
    return true;
  };

  // 분류 체계 — 실제 VOC 대장(양축 '사유' / 반려 '불만유형' / 양어 '불만내용')을 통합한 것
  const VOC_CATEGORIES = ['사료품질', '사료외형', '이물혼입', '포장·지대', '유통·보관', '배송', '건강·안전', '표시사항', '서비스', '기타'];
  // 근본원인 분류 — 재발방지 대책을 어디에 걸어야 하는지 판단하는 축
  const VOC_ROOT_TYPES = ['원료', '배합비', '생산설비', '포장설비', '보관·적재', '운송·배송', '표시·날인', '고객 취급', '원인불명', '해당없음'];
  const VOC_CHANNELS   = ['전화', '방문', 'Oral', 'VOC시스템', '온라인몰', '거래처 경유', '기타'];
  const VOC_SATISFACTION = ['매우 만족', '만족', '불만족', '매우 불만족'];
  const VOC_STATUS = ['OPEN', 'INVESTIGATING', 'ACTION', 'CLOSED'];
  const VOC_ANSWER_DAYS = 3;          // 기본 답변 기한 — 접수일로부터 3영업일(주말 제외)

  const addVOC = (data) => {
    const list = get(VOC_KEY);      // 임포트본은 코드 상주 — 라이브 배열에만 추가한다
    const id   = newId('VOC-');
    const receivedAt = data.receivedAt || now();
    const item = {
      id,
      vocNo:       data.vocNo      || id,
      fgLotNo:     data.fgLotNo   || '',    // 제품 LOT
      mfgDate:     String(data.mfgDate || '').slice(0, 10),   // 제조일자(포대 날인) — LOT 미기재 건의 역추적 진입점
      productCode:  data.productCode || '',
      productName: data.productName || '',
      customer:    data.customer   || '',
      complaint:   data.complaint  || '',
      category:    data.category   || '사료품질',
      severity:    data.severity   || 'MEDIUM',   // HIGH/MEDIUM/LOW
      status:      'OPEN',                         // OPEN/INVESTIGATING/ACTION/CLOSED
      traceResult: null,                           // 역추적 결과
      photos:      Array.isArray(data.photos) ? data.photos : [],  // 첨부 사진(다운스케일 data URI)
      // ── 접수 정보 ──
      factory:     data.factory   || 'HQ',
      region:      data.region    || '',   // 소속지구(영업)
      channel:     data.channel   || '전화',
      species:     data.species   || '',   // 축종(양돈/비육/낙농/산란/양어/반려)
      receivedAt,
      dueDate:     data.dueDate || addBusinessDays(receivedAt.slice(0, 10), VOC_ANSWER_DAYS),
      // ── 처리(8D) — 종결하려면 조치·근본원인·재발방지가 모두 채워져야 한다 ──
      investigation: data.investigation || '',   // 조사내역
      action:        data.action        || '',   // 조치사항
      rootCause:     data.rootCause     || '',   // 근본원인
      rootType:      data.rootType      || '',   // 근본원인 분류
      prevention:    data.prevention    || '',   // 재발방지대책
      answerDate:    data.answerDate    || '',   // 고객 답변일
      satisfaction:  data.satisfaction  || '',   // 처리 후 만족도
      logs:        [],                            // 처리 이력 타임라인
      registeredAt: now(),
      actor:       data.actor || '품질팀'
    };
    list.push(item);
    set(VOC_KEY, list);
    addHistory({ refId: id, refType: 'VOC', action: 'VOC 등록', detail: `${data.productName} / ${data.complaint}`, actor: item.actor });
    return item;
  };

  // 처리 이력 한 줄 추가 — 누가 언제 무엇을 했는지가 남아야 히스토리가 된다
  const addVOCLog = (id, entry) => {
    const list = get(VOC_KEY);
    const i = vocLiveIndex(list, id);
    if (i < 0) return null;
    const logs = Array.isArray(list[i].logs) ? list[i].logs.slice() : [];
    logs.push({
      id: 'VL' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      kind:    entry.kind    || '처리',
      content: entry.content || '',
      by:      entry.by      || '',
      at:      entry.at      || now(),
      evidence: entry.evidence || null,
    });
    list[i] = { ...list[i], logs, updatedAt: now() };
    set(VOC_KEY, list);
    return list[i];
  };
  const deleteVOCLog = (id, logId) => {
    const list = get(VOC_KEY);
    const i = vocLiveIndex(list, id);
    if (i < 0) return null;
    list[i] = { ...list[i], logs: (list[i].logs || []).filter(l => l.id !== logId), updatedAt: now() };
    set(VOC_KEY, list);
    return list[i];
  };

  // 종결 가능 여부 — 조치·근본원인·재발방지가 비면 종결을 막는다(대책 없는 종결 방지)
  const vocCloseCheck = (v) => {
    const miss = [];
    if (!String(v.action || '').trim())     miss.push('조치사항');
    if (!String(v.rootCause || '').trim())  miss.push('근본원인');
    if (!String(v.prevention || '').trim()) miss.push('재발방지대책');
    return { ok: miss.length === 0, missing: miss };
  };

  // 답변기한 초과 — 초과일수는 영업일로 세되, 기한을 넘겼으면 최소 1을 돌려준다.
  //   호출부가 전부 `vocOverdue(v) > 0` 로 초과를 판정하므로,
  //   금요일 기한을 토·일에 조회하면(영업일 0) "초과 아님"으로 보이던 문제를 막는다.
  //   오늘 날짜는 반드시 로컬(KST) 기준 — toISOString() 은 UTC 라 새벽 9시 이전에 하루 전이 된다.
  const vocOverdue = (v) => {
    if (!v || v.status === 'CLOSED' || !v.dueDate) return 0;
    const today = ymdLocal(new Date());
    if (today <= v.dueDate) return 0;
    return Math.max(1, businessDaysBetween(v.dueDate, today));
  };
  // 종결 시점 — 임포트 대장은 closedAt 이 없고 고객 답변일이 종결 시점 역할을 한다
  const vocClosedOn = (v) => String(v.closedAt || v.answerDate || '').slice(0, 10);
  // 처리 소요일 — 종결까지 걸린 일수(미종결은 접수 후 경과일)
  const vocLeadDays = (v) => {
    const s = (v.receivedAt || v.registeredAt || '').slice(0, 10);
    if (!s) return 0;
    const e = v.status === 'CLOSED' ? (vocClosedOn(v) || String(v.updatedAt || '').slice(0, 10)) : ymdLocal(new Date());
    if (!e) return 0;
    return Math.max(0, Math.floor((new Date(e) - new Date(s)) / 86400000));
  };

  // VOC 역추적 — 제품LOT → 배합 → 소비LOT → 사일로 → 입고LOT → 협력사
  //   제조일자(mfgDate)를 주면 LOT 번호를 몰라도 그 날 생산분으로 좁힐 수 있다.
  //   포대에는 LOT 대신 제조일자만 날인되는 경우가 많아 현장 클레임은 대부분 이 경로로 들어온다.
  const traceVOC = (fgLotNo, productCode = '', mfgDate = '') => {
    const lots = getProductLots();
    const day  = String(mfgDate || '').slice(0, 10);
    // LOT 번호가 없으면 제품코드(+제조일자)로 좁히되, 딱 1건일 때만 확정한다.
    //   첫 건을 집으면 엉뚱한 배치를 원인으로 지목하게 되므로, 후보가 여럿이면 null 을 돌려
    //   화면에서 후보를 고르게 한다.
    const only = (arr) => (arr.length === 1 ? arr[0] : null);
    const productLot =
      (fgLotNo ? lots.find(p => p.fgLotNo === fgLotNo || p.id === fgLotNo) : null)
      || (productCode
        ? only(lots.filter(p => p.productCode === productCode
            && (!day || String(p.productionDate || '').slice(0, 10) === day)))
        : null);
    if (!productLot) return null;

    const batch = productLot.batchId ? getBatchById(productLot.batchId) : null;
    const consumedLots = batch?.consumedLots || [];
    const siloIds      = [...new Set(consumedLots.map(c => c.siloId).filter(Boolean))];
    // 입고건은 receivingId 로 먼저 찾는다. 없을 때만 LOT 번호 문자열로 폴백 —
    // 문자열 매칭은 LOT 번호가 조금만 달라도 끊기므로 신뢰할 수 없다.
    const allRecv = getReceivings();
    const seenR = new Set();
    const receivings = consumedLots.map(c => {
      const r = (c.receivingId && allRecv.find(x => x.id === c.receivingId))
        || (c.lotNo && allRecv.find(x => x.lotNo === c.lotNo)) || null;
      if (!r || seenR.has(r.id)) return null;
      seenR.add(r.id);
      return r;
    }).filter(Boolean);
    // 협력사도 id 우선, 없으면 이름으로 폴백
    const seenS = new Set();
    const suppliers = receivings.map(r =>
      (r.supplierId && getSupplierById(r.supplierId)) || (r.supplierName && getSupplierByName(r.supplierName)) || null
    ).filter(s => s && !seenS.has(s.id) && seenS.add(s.id));
    // 배치에 연결된 투입지시가 있으면 그것을, 없으면 사일로 기준으로 추정
    const orderIds = batch?.orderIds || [];
    const prodOrders = orderIds.length
      ? getProductionOrders().filter(o => orderIds.includes(o.id))
      : getProductionOrders().filter(o => siloIds.includes(o.siloId) && o.status === 'DONE');
    const productMaster = getProductByCode(productLot.productCode || productCode);

    return { productLot, productMaster, batch, consumedLots, siloIds, receivings, suppliers, prodOrders };
  };

  // 제조일자로 제품 LOT 후보 찾기 — 포대에 LOT 이 없고 제조일자만 찍혀 있을 때 쓴다
  const findProductLotsByMfgDate = (mfgDate, productCode = '', factory = '') => {
    const day = String(mfgDate || '').slice(0, 10);
    if (!day) return [];
    return getProductLots().filter(p =>
      String(p.productionDate || '').slice(0, 10) === day
      && (!productCode || p.productCode === productCode)
      && (!factory || factory === 'ALL' || p.factory === factory));
  };

  // VOC 제조일자 — 직접 입력분이 우선, 없으면 연결된 제품 LOT 의 생산일에서 끌어온다
  const vocMfgDate = (v) => {
    const d = String(v && v.mfgDate || '').slice(0, 10);
    if (d) return d;
    const lotNo = v && v.fgLotNo;
    const lot = lotNo ? getProductLots().find(p => p.fgLotNo === lotNo || p.id === lotNo) : null;
    return lot ? String(lot.productionDate || '').slice(0, 10) : '';
  };

  const updateVOC = (id, patch) => {
    const list = get(VOC_KEY);
    const idx  = vocLiveIndex(list, id);      // 임포트본이면 라이브로 복사 후 수정
    if (idx < 0) return null;
    if (patch.status === 'CLOSED' && list[idx].status !== 'CLOSED') patch = { ...patch, closedAt: now() };
    list[idx] = { ...list[idx], ...patch, updatedAt: now() };
    set(VOC_KEY, list);
    return list[idx];
  };

  // 피드백 성격 — 사료(양축) 대장은 칭찬·서비스활동 기록도 함께 쓰므로 불만만 따로 셀 수 있어야 한다.
  //   임포트본은 feedback 을 갖고 있고, 신규 등록분은 만족도로 판정한다.
  const vocFeedback = (v) => v.feedback
    || (['불만족', '매우 불만족'].includes(v.satisfaction) ? 'COMPLAINT'
      : ['만족', '매우 만족'].includes(v.satisfaction) ? 'PRAISE' : 'COMPLAINT');

  // ── VOC 통계 (대시보드) ──
  //   factory: 'ALL' 이면 전사(공장 미지정 임포트본 포함). months: 최근 N개월 창.
  //   complaintOnly: true 면 불만 건만 집계(칭찬·정보공유 제외).
  const vocStats = (factory = 'ALL', months = 12, complaintOnly = true) => {
    let all = getVOCs();
    if (complaintOnly) all = all.filter(v => vocFeedback(v) === 'COMPLAINT');
    // 공장이 지정된 건만 해당 공장에 잡힌다(임포트본은 공장 미지정 → 전사에서만 보임)
    const scoped = all.filter(v => factory === 'ALL' || (v.factory || '') === factory);
    const d = new Date();
    const labels = [];
    for (let i = months - 1; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      labels.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
    }
    const ym = (s) => String(s || '').slice(0, 7);
    const inWin = scoped.filter(v => labels.includes(ym(v.receivedAt || v.registeredAt)));

    const openList   = scoped.filter(v => v.status !== 'CLOSED');
    const overdue    = openList.filter(v => vocOverdue(v) > 0);
    const closed     = inWin.filter(v => v.status === 'CLOSED');
    // 평균 처리일은 종결 시점을 아는 건만 대상으로 한다(과거 대장은 답변일이 없는 건이 섞여 있음)
    const leadDays   = closed.filter(vocClosedOn).map(vocLeadDays);
    const avgLead    = leadDays.length ? Math.round(leadDays.reduce((a, b) => a + b, 0) / leadDays.length * 10) / 10 : 0;
    // 조치는 했는데 재발방지대책이 비어있는 종결 건 = 히스토리가 끊긴 건.
    //   조치조차 기록되지 않은 과거 로그성 기록(사료 영업VOC 등)은 제외한다.
    const noPrevent  = scoped.filter(v => v.status === 'CLOSED'
      && String(v.action || '').trim() && !String(v.prevention || '').trim());

    const countBy = (arr, keyFn) => {
      const m = {};
      arr.forEach(v => { const k = keyFn(v) || '미분류'; m[k] = (m[k] || 0) + 1; });
      return Object.entries(m).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
    };

    return {
      labels,
      monthly:  labels.map(m => inWin.filter(v => ym(v.receivedAt || v.registeredAt) === m).length),
      monthlyClosed: labels.map(m => inWin.filter(v => ym(v.receivedAt || v.registeredAt) === m && v.status === 'CLOSED').length),
      monthlyHigh:   labels.map(m => inWin.filter(v => ym(v.receivedAt || v.registeredAt) === m && v.severity === 'HIGH').length),
      total: scoped.length, windowTotal: inWin.length,
      open: openList.length,
      investigating: scoped.filter(v => v.status === 'INVESTIGATING' || v.status === 'ACTION').length,
      closed: scoped.filter(v => v.status === 'CLOSED').length,
      overdue: overdue.length, overdueList: overdue,
      high: openList.filter(v => v.severity === 'HIGH').length,
      avgLead,
      closeRate: inWin.length ? Math.round(closed.length / inWin.length * 100) : 0,
      noPrevent: noPrevent.length, noPreventList: noPrevent,
      byCategory: countBy(inWin, v => v.category),
      byRootType: countBy(inWin.filter(v => v.rootType), v => v.rootType),
      byProduct:  countBy(inWin, v => v.productName),
      byCustomer: countBy(inWin, v => v.customer),
      byRegion:   countBy(inWin.filter(v => v.region), v => v.region),
      bySpecies:  countBy(inWin.filter(v => v.species), v => v.species),
      bySatisfaction: countBy(inWin.filter(v => v.satisfaction), v => v.satisfaction),
      // 근본원인은 적혀 있는데 '분류'가 비어 있는 건 — 분류만 하면 원인별 집계가 살아난다
      unclassified: scoped.filter(v => String(v.rootCause || '').trim() && !String(v.rootType || '').trim()).length,
      openList,
    };
  };

  // ============================================================
  // 출고 (Outbound)
  // ============================================================
  const OUTBOUND_KEY  = 'rm_outbound';
  const getOutbounds  = ()   => get(OUTBOUND_KEY);

  const addOutbound = (data) => {
    const list = getOutbounds();
    const inv  = getInventory();
    const idx  = inv.findIndex(x => x.materialCode === data.materialCode && x.binLocation === data.binLocation);
    if (idx < 0) throw new Error('재고를 찾을 수 없습니다.');
    if (inv[idx].qty < data.qty) throw new Error('재고 수량이 부족합니다.');
    const id   = uuid();
    const item = {
      id,
      materialCode: data.materialCode,
      materialName: inv[idx].materialName,
      factory:      data.factory || inv[idx].factory || 'AS',
      qty:          Number(data.qty),
      weight:       Number(data.weight) || Number(data.qty),
      binLocation:  data.binLocation,
      destination:  data.destination || '',
      purpose:      data.purpose || '',
      outboundDate: data.outboundDate || now().split('T')[0],
      requestedBy:  data.requestedBy  || '',
      processedBy:  data.processedBy  || '관리자',
      processedAt:  now()
    };
    list.push(item);
    set(OUTBOUND_KEY, list);
    inv[idx].qty    -= item.qty;
    inv[idx].weight -= item.weight;
    inv[idx].updatedAt = now();
    set(INVENTORY_KEY, inv);
    addHistory({ refId: id, refType: 'OUTBOUND', action: '출고 처리', detail: `${item.materialName} ${item.qty}개 → ${item.destination}`, actor: item.processedBy });
    return item;
  };

  // 제품(완제품) 출고 — 원료 출고와 같은 대장에 kind 로 구분해 쌓는다.
  //   제품LOT 수량은 깎지 않는다. 생산량은 그대로 두고 출고 대장을 합산해 잔량을 내는 방식이라
  //   양쪽을 다 줄이면 이중 차감이 된다(getProductStockRows 가 produced - shipped 로 계산).
  const addProductOutbound = (data) => {
    const lots = getProductLots();
    const li = lots.findIndex(p => p.id === data.productLotId || p.fgLotNo === data.fgLotNo);
    if (li < 0) throw new Error('제품 LOT을 찾을 수 없습니다.');
    const lot = lots[li];

    const qty = Number(data.qty);
    if (!(qty > 0)) throw new Error('출고 수량을 입력해주세요.');
    const already = getOutbounds()
      .filter(o => o.fgLotNo === lot.fgLotNo || o.productLotId === lot.id)
      .reduce((s, o) => s + (Number(o.qty) || 0), 0);
    const remaining = (Number(lot.qty) || 0) - already;
    if (qty > remaining) throw new Error(`출고 가능 수량을 초과했습니다. (잔량 ${remaining}kg)`);

    const id = uuid();
    const item = {
      id,
      kind:         'PRODUCT',
      productLotId: lot.id,
      fgLotNo:      lot.fgLotNo,
      productCode:  lot.productCode || '',
      productName:  lot.productName || '',
      factory:      data.factory || lot.factory || 'AS',
      qty,
      weight:       Number(data.weight) || qty,
      unit:         lot.unit || 'kg',
      destination:  data.destination || '',
      purpose:      data.purpose || '',
      outboundDate: data.outboundDate || now().split('T')[0],
      requestedBy:  data.requestedBy || '',
      processedBy:  data.processedBy || '관리자',
      processedAt:  now(),
    };
    const list = getOutbounds();
    list.push(item);
    set(OUTBOUND_KEY, list);

    // 전량 나가면 LOT 상태를 출하완료로
    if (already + qty >= (Number(lot.qty) || 0)) {
      lots[li] = { ...lot, status: 'SHIPPED' };
      set(PRODUCT_LOT_KEY, lots);
    }
    addHistory({ refId: lot.id, refType: 'OUTBOUND', action: '제품 출고', detail: `${item.productName} ${qty}${item.unit} → ${item.destination || '-'}`, actor: item.processedBy });
    return item;
  };

  // ============================================================
  // 이력 (History)
  // ============================================================
  const HISTORY_KEY    = 'rm_history';
  const getHistory     = ()       => get(HISTORY_KEY);
  const getHistoryByRefId = (id)  => getHistory().filter(h => h.refId === id).sort((a,b) => a.timestamp.localeCompare(b.timestamp));

  const addHistory = (data) => {
    const list = getHistory();
    list.push({ id: uuid(), refId: data.refId, refType: data.refType, action: data.action, detail: data.detail || '', actor: data.actor || '시스템', timestamp: now() });
    set(HISTORY_KEY, list);
  };

  // ============================================================
  // QR 해석 및 스캔 로그
  // ============================================================
  const QR_SCAN_LOG_KEY = 'rm_qr_scan_logs';
  const getQRScanLogs = () => get(QR_SCAN_LOG_KEY);

  const resolveQRCode = (rawCode) => {
    const raw = extractQRPayload(rawCode);
    if (!raw) return { type:'UNKNOWN', raw };

    const normalized = raw.toUpperCase();
    const prefixed = normalized.match(/^WS-(RECV|MAT|PROD|FG|SUP|SILO)-(.+)$/);
    if (prefixed) {
      const [, kind, code] = prefixed;
      if (kind === 'RECV') {
        const receiving = getReceivingById(raw) || getReceivingById(code);
        return receiving ? { type:'RECEIVING', raw, refId:receiving.id, item:receiving } : { type:'RECEIVING', raw, missing:true };
      }
      if (kind === 'MAT') {
        const material = getMaterialByCode(code) || getMaterialByQRCode(raw);
        return material ? { type:'MATERIAL', raw, refId:material.code, item:material } : { type:'MATERIAL', raw, missing:true };
      }
      if (kind === 'PROD') {
        const product = getProductByCode(code) || getProductByQRCode(raw);
        return product ? { type:'PRODUCT', raw, refId:product.code, item:product } : { type:'PRODUCT', raw, missing:true };
      }
      if (kind === 'FG') {
        const productLot = getProductLots().find(p => p.fgLotNo === code || p.id === code || p.qrCode === raw);
        return productLot ? { type:'PRODUCT_LOT', raw, refId:productLot.id, item:productLot } : { type:'PRODUCT_LOT', raw, missing:true };
      }
      if (kind === 'SUP') {
        const supplier = getSupplierByCode(code) || getSupplierByQRCode(raw);
        return supplier ? { type:'SUPPLIER', raw, refId:supplier.id, item:supplier } : { type:'SUPPLIER', raw, missing:true };
      }
      if (kind === 'SILO') {
        const silo = getSiloById(code);
        return silo ? { type:'SILO', raw, refId:silo.id, item:silo } : { type:'SILO', raw, missing:true };
      }
    }

    const receiving = getReceivingById(raw);
    if (receiving) return { type:'RECEIVING', raw, refId:receiving.id, item:receiving };

    const material = getMaterialByCode(raw) || getMaterialByQRCode(raw);
    if (material) return { type:'MATERIAL', raw, refId:material.code, item:material };

    const product = getProductByCode(raw) || getProductByQRCode(raw);
    if (product) return { type:'PRODUCT', raw, refId:product.code, item:product };

    const productLot = getProductLots().find(p => p.fgLotNo === raw || p.id === raw || p.qrCode === raw);
    if (productLot) return { type:'PRODUCT_LOT', raw, refId:productLot.id, item:productLot };

    const supplier = getSupplierByCode(raw) || getSupplierByQRCode(raw);
    if (supplier) return { type:'SUPPLIER', raw, refId:supplier.id, item:supplier };

    const silo = getSiloById(raw);
    if (silo) return { type:'SILO', raw, refId:silo.id, item:silo };

    return { type:'UNKNOWN', raw, missing:true };
  };

  const recordQRScan = (rawCode, action = 'QR 스캔', actor = '현장') => {
    const resolved = resolveQRCode(rawCode);
    const logs = getQRScanLogs();
    logs.push({
      id: uuid(),
      qrValue: resolved.raw || toCode(rawCode),
      qrType: resolved.type,
      refId: resolved.refId || '',
      action,
      actor,
      scannedAt: now()
    });
    set(QR_SCAN_LOG_KEY, logs);

    if (resolved.type === 'RECEIVING' && resolved.item) {
      incrementScanCount(resolved.item.id);
      addHistory({
        refId: resolved.item.id,
        refType: 'RECEIVING',
        action: 'QR 스캔',
        detail: `${resolved.item.materialName} / ${resolved.item.preRegId || resolved.item.id}`,
        actor
      });
    } else if (resolved.type !== 'UNKNOWN' && resolved.refId) {
      addHistory({
        refId: resolved.refId,
        refType: resolved.type === 'PRODUCT_LOT' ? 'PRODUCT' : resolved.type,
        action: '마스터 QR 조회',
        detail: resolved.item?.name || resolved.item?.materialName || resolved.item?.productName || resolved.refId,
        actor
      });
    }
    return resolved;
  };

  // ============================================================
  // 대시보드 통계 (확장)
  // ============================================================
  const getStats = (factory) => {
    const receivings  = factory && factory !== 'ALL' ? getReceivings().filter(r => r.factory === factory) : getReceivings();
    const today       = ymdLocal(new Date());
    const inspections = getInspections();
    const inventory   = getInventory();
    const outbounds   = getOutbounds();
    const vocs        = getVOCs();
    const exceptions  = getExceptions();

    const todayReceiving   = receivings.filter(r => r.receivedDate === today);
    const pendingScale     = receivings.filter(r => r.status === 'PENDING_SCALE');
    const pendingQC        = receivings.filter(r => r.status === 'PENDING_QC');
    const qrIssued         = receivings.filter(r => r.status === 'QR_ISSUED');
    const arrived          = receivings.filter(r => r.status === 'ARRIVED');
    const approved         = receivings.filter(r => r.status === 'APPROVED');
    const inStock          = receivings.filter(r => r.status === 'IN_STOCK');
    const rejected         = receivings.filter(r => r.status === 'REJECTED');
    const hold             = receivings.filter(r => r.status === 'HOLD');
    const scanned          = receivings.filter(r => r.scanCount > 0);
    const missScan         = receivings.filter(r => r.status === 'QR_ISSUED' || r.status === 'PENDING_SCALE' || r.status === 'PENDING_APPROVAL');
    const siloWaiting      = receivings.filter(r => r.status === 'APPROVED' && !r.siloId);
    const openExceptions   = exceptions.filter(e => !e.resolved);
    const lowStock         = inventory.filter(i => { const m = getMaterialByCode(i.materialCode); return m && m.minStock > 0 && i.qty <= m.minStock; });

    const totalInspections = inspections.length;
    const failedInsp       = inspections.filter(i => i.verdict === 'FAIL').length;
    const defectRate       = totalInspections > 0 ? ((failedInsp / totalInspections) * 100).toFixed(1) : 0;

    // 최근 7일 불량률
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const di = inspections.filter(x => x.inspectedAt.startsWith(ds));
      const df = di.filter(x => x.verdict === 'FAIL');
      last7.push({ date: ds, total: di.length, fail: df.length, rate: di.length > 0 ? ((df.length/di.length)*100).toFixed(1) : 0 });
    }

    return {
      todayReceivingCount: todayReceiving.length,
      todayReceivingTon:   todayReceiving.reduce((s,r) => s + (r.expectedWeight||0), 0),
      qrIssuedCount:       qrIssued.length,
      arrivedCount:        arrived.length,
      supplierInboundOpenCount: qrIssued.length + arrived.length,
      pendingScaleCount:   pendingScale.length,
      pendingQCCount:      pendingQC.length,
      approvedCount:       approved.length,
      inStockCount:        inStock.length,
      rejectedCount:       rejected.length,
      holdCount:           hold.length,
      scannedCount:        scanned.length,
      missScanCount:       missScan.length,
      siloWaitingCount:    siloWaiting.length,
      exceptionCount:      openExceptions.length,
      lowStockCount:       lowStock.length,
      defectRate,
      totalInventoryItems: inventory.length,
      totalOutboundToday:  outbounds.filter(o => o.outboundDate === today).length,
      openVOCCount:        vocs.filter(v => v.status !== 'CLOSED').length,
      last7DaysDefect:     last7,
      recentActivity:      getHistory().slice(-15).reverse(),
      todayReceivings:     receivings.filter(r => r.receivedDate === today || r.status === 'PENDING_SCALE'),
    };
  };

  // ============================================================
  // 원료 사용량 기반 재고주기
  // ============================================================
  const getMaterialUsageRows = (factory, days = 30) => {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const rows = [];

    getProductionOrders().forEach(order => {
      if (order.status !== 'DONE') return;
      const ts = order.executedAt || order.createdAt;
      if (ts && new Date(ts) < since) return;
      if (factory && factory !== 'ALL' && order.factory !== factory) return;
      rows.push({
        materialCode: order.materialCode,
        materialName: order.materialName,
        factory: order.factory,
        qty: Number(order.amount) || 0,
        source: '투입지시',
        usedAt: ts || now()
      });
    });

    getBatches().forEach(batch => {
      const ts = batch.batchedAt || batch.createdAt;
      if (ts && new Date(ts) < since) return;
      if (factory && factory !== 'ALL' && batch.factory !== factory) return;
      (batch.consumedLots || []).forEach(lot => {
        const silo = lot.siloId ? getSiloById(lot.siloId) : null;
        rows.push({
          materialCode: lot.materialCode || silo?.materialCode || '',
          materialName: lot.materialName || silo?.materialName || '',
          factory: batch.factory || silo?.factory || '',
          qty: Number(lot.qty || lot.deducted) || 0,
          source: '배합',
          usedAt: ts || now()
        });
      });
    });

    return rows.filter(r => r.materialCode && r.qty > 0);
  };

  const getInventoryCycleRows = (factory = 'ALL') => {
    const stockMap = new Map();
    const upsert = (key, patch) => {
      const base = stockMap.get(key) || {
        materialCode: patch.materialCode,
        materialName: patch.materialName,
        factory: patch.factory,
        stockKg: 0,
        lotCount: 0,
        locations: new Set(),
        latestInDate: ''
      };
      base.materialName = base.materialName || patch.materialName;
      base.stockKg += Number(patch.stockKg) || 0;
      base.lotCount += Number(patch.lotCount) || 0;
      if (patch.location) base.locations.add(patch.location);
      if (patch.latestInDate && patch.latestInDate > base.latestInDate) base.latestInDate = patch.latestInDate;
      stockMap.set(key, base);
    };

    getInventory()
      .filter(i => factory === 'ALL' || i.factory === factory)
      .forEach(i => upsert(`${i.factory}|${i.materialCode}`, {
        materialCode: i.materialCode,
        materialName: i.materialName,
        factory: i.factory,
        stockKg: Number(i.weight) || 0,
        lotCount: (i.lots || []).length,
        location: i.binLocation || i.warehouse,
        latestInDate: (i.lots || []).map(l => l.receivedDate || '').sort().pop() || ''
      }));

    getSilos()
      .filter(s => factory === 'ALL' || s.factory === factory)
      .forEach(s => {
        const sum = getSiloCapacitySummary(s);
        upsert(`${s.factory}|${s.materialCode}`, {
          materialCode: s.materialCode,
          materialName: s.materialName,
          factory: s.factory,
          stockKg: sum.totalQty,
          lotCount: (s.currentLots || []).length,
          location: s.name,
          latestInDate: (s.currentLots || []).map(l => l.inDate || '').sort().pop() || ''
        });
      });

    const usageMap = new Map();
    getMaterialUsageRows(factory, 30).forEach(row => {
      const key = `${row.factory}|${row.materialCode}`;
      const base = usageMap.get(key) || { used30d: 0, events: 0 };
      base.used30d += row.qty;
      base.events += 1;
      usageMap.set(key, base);
    });

    return [...stockMap.values()].map(row => {
      const usage = usageMap.get(`${row.factory}|${row.materialCode}`) || { used30d: 0, events: 0 };
      const avgDaily = usage.used30d / 30;
      const coverDays = avgDaily > 0 ? row.stockKg / avgDaily : null;
      let status = 'NO_USAGE';
      if (coverDays !== null) {
        if (coverDays <= 7) status = 'CRITICAL';
        else if (coverDays <= 14) status = 'WARN';
        else if (coverDays <= 30) status = 'WATCH';
        else status = 'OK';
      }
      const reorderDate = coverDays !== null
        ? new Date(Date.now() + Math.max(0, Math.floor(coverDays)) * 86400000).toISOString().split('T')[0]
        : '';
      return {
        ...row,
        locations: [...row.locations],
        used30d: usage.used30d,
        usageEvents: usage.events,
        avgDaily,
        coverDays,
        reorderDate,
        status
      };
    }).sort((a, b) => {
      if (a.coverDays === null && b.coverDays === null) return b.stockKg - a.stockKg;
      if (a.coverDays === null) return 1;
      if (b.coverDays === null) return -1;
      return a.coverDays - b.coverDays;
    });
  };

  // ============================================================
  // 설정
  // ============================================================
  const SETTINGS_KEY    = 'rm_settings';
  const defaultSettings = { companyName:'우성사료', warehouseName:'본창고', weightAlertPct:2.0, weightWarnPct:0.5, weightUnit:'kg', theme:'dark' };
  const getSettings     = ()      => { const s = localStorage.getItem(SETTINGS_KEY); return s ? {...defaultSettings,...JSON.parse(s)} : defaultSettings; };
  const saveSettings    = (patch) => { const c = getSettings(); localStorage.setItem(SETTINGS_KEY, JSON.stringify({...c,...patch})); };

  // ============================================================
  // 초기 샘플 데이터 로드
  // ============================================================
  // 검사자가 고르지 않았는데 저장된 원인코드를 한 번만 걷어낸다.
  //   원인: 원인코드 select 가 숨김 상태에서도 값을 반환해 기본값 A001 이 그대로 저장됐다.
  //   판정만으로는 오염 여부를 가릴 수 없다 — 원인 입력 영역이 실제로 열렸는지로 판단한다.
  //   영역이 열리는 경로는 두 가지뿐이었다: 항목을 불합격으로 클릭, 또는 판정을 불합격으로 변경.
  //   '불합격 처리' 버튼은 값만 바꿔 바로 제출해서 영역이 열리지 않았고,
  //   조건부합격도 영역이 열리지 않아 둘 다 A001 이 박혔다.
  //   → 불합격 항목도 없고 상세 사유도 없으면 검사자가 원인을 본 적이 없는 건이다.
  const QC_FAILCODE_FIX_KEY = 'rm_quality_failcode_fixed';
  const cleanFalseFailCodes = () => {
    if (localStorage.getItem(QC_FAILCODE_FIX_KEY)) return 0;
    const list = getInspections();
    let n = 0;
    list.forEach(i => {
      const hasFailItem = (i.checkItems || []).some(ci => ci.result === 'FAIL');
      const isDefect = i.verdict === 'FAIL' || i.verdict === 'CONDITIONAL' || hasFailItem;
      if (!isDefect) {                                   // 합격 건 — 원인이 남을 이유가 없다
        if (i.failCode || i.failReason) { i.failCode = ''; i.failReason = ''; n++; }
      } else if (!hasFailItem && !i.failReason && i.failCode) {
        i.failCode = ''; n++;                            // 부적합이지만 원인을 본 적 없는 건
      }
    });
    if (n) set(QC_KEY, list);
    localStorage.setItem(QC_FAILCODE_FIX_KEY, String(n));
    if (n) console.info(`[QC] 검사자가 선택하지 않은 원인코드 ${n}건 정리`);
    return n;
  };

  // 공장 select 가 f.code(존재하지 않는 필드)를 읽어 문자열 'undefined' 가 저장된 레코드를 한 번만 고친다.
  //   공장이 'undefined' 면 공장별 필터·집계에서 통째로 빠진다.
  const FACTORY_FIX_KEY = 'rm_factory_undefined_fixed';
  const cleanUndefinedFactory = () => {
    if (localStorage.getItem(FACTORY_FIX_KEY)) return 0;
    let n = 0;
    ['rm_process_issues', 'rm_equipment', 'rm_equip_logs'].forEach(k => {
      const list = get(k);
      let touched = false;
      list.forEach(r => {
        if (r.factory === 'undefined' || r.factory === undefined || r.factory === null) {
          r.factory = 'AS'; n++; touched = true;      // 기본 공장으로 회수
        }
      });
      if (touched) set(k, list);
    });
    localStorage.setItem(FACTORY_FIX_KEY, String(n));
    if (n) console.info(`[DB] 공장값이 비어 있던 레코드 ${n}건을 기본 공장으로 정리`);
    return n;
  };

  const initSampleData = () => {
    initDefaultSuppliers();
    initDefaultSilos();
    try { cleanFalseFailCodes(); } catch (e) { console.warn('[QC] failCode 정리 건너뜀', e); }
    try { cleanUndefinedFactory(); } catch (e) { console.warn('[DB] factory 정리 건너뜀', e); }
    // 샘플 사전입고 등록 (PPT 이미지 기준)
    if (getReceivings().length === 0) {
      const today = new Date().toISOString().split('T')[0];
      const sampleReceivings = [
        { preRegId:'WS-IN-20260616-0001', materialCode:'4401000', materialName:'옥수수', supplierName:'한빛곡물', factory:'AS', vehicleNo:'충남81바2451', expectedWeight:25000, lotNo:'LOT-D-4401000-20260616-0001', receivedDate:today, status:'PENDING_QC', scanCount:2, actualWeight:25020 },
        { preRegId:'WS-IN-20260616-0002', materialCode:'4401021', materialName:'소맥피', supplierName:'우리곡산', factory:'AS', vehicleNo:'전북85다5316', expectedWeight:22000, lotNo:'LOT-D-4401021-20260616-0001', receivedDate:today, status:'PENDING_SCALE', scanCount:0 },
        { preRegId:'WS-IN-20260616-0003', materialCode:'4401103', materialName:'대두박', supplierName:'삼진사료원료', factory:'AS', vehicleNo:'대전83아4319', expectedWeight:27200, lotNo:'LOT-D-4401103-20260616-0001', receivedDate:today, status:'PENDING_APPROVAL', scanCount:1, actualWeight:26200 },
        { preRegId:'WS-IN-20260616-0004', materialCode:'4401001', materialName:'대두유', supplierName:'대성유지', factory:'AS', vehicleNo:'경기92사1187', expectedWeight:18500, lotNo:'LOT-D-4401001-20260616-0001', receivedDate:today, status:'IN_STOCK', scanCount:3, actualWeight:18420, siloId:'AS-SILO-02' },
      ];
      sampleReceivings.forEach(r => addReceiving(r));
    }
    // 샘플 생산 투입지시
    if (getProductionOrders().length === 0) {
      addProductionOrder({ factory:'AS', siloId:'AS-SILO-01', materialCode:'4401000', materialName:'옥수수', amount:5000, productName:'육계 선진L', actor:'생산팀' });
    }
    // 샘플 배합배치
    if (getBatches().length === 0) {
      addBatch({ factory:'AS', productName:'육계 선진L', totalQty:15000, consumedLots:[{lotNo:'LOT-001', qty:5000, siloId:'AS-SILO-01'}], actor:'배합팀' });
    }
    // 샘플 제품 LOT
    if (getProductLots().length === 0) {
      const batch = getBatches()[0];
      if (batch) addProductLot({ factory:'AS', productName:'육계 선진L', batchId:batch.id, qty:15000, packType:'20kg포대', packCount:750, productionDate:new Date().toISOString().split('T')[0], actor:'포장팀' });
    }
    // 샘플 분석 데이터
    if (getRawAnalyses().length === 0) {
      const r = getReceivings().find(x => x.materialCode && x.materialCode !== 'TEMP');
      if (r) addRawAnalysis({ receivingId:r.id, moisture:12.4, protein:8.2, fat:3.8, fiber:2.1, ash:1.5, verdict:'PASS', analyst:'R&D', memo:'입고 기준 적합' });
    }
    if (getProductAnalyses().length === 0) {
      const p = getProductLots()[0];
      if (p) addProductAnalysis({ productLotId:p.id, moisture:10.8, protein:18.5, fat:5.2, fiber:3.1, ash:6.4, pelletDurability:96.2, verdict:'PASS', analyst:'R&D', memo:'제품 규격 적합' });
    }
    // 배합비는 회사 핵심 자산이라 시드로 만들지 않는다 (2026-09-07 보안 정리).
    //   샘플이라도 구성비 형태가 남으면 외부 배포 때 실제 배합으로 오인된다.
    //   실제 배합비는 화면에서 등록하거나 외부 연동(formula_sync.js)으로만 들어온다.
  };

  // ============================================================
  // [신규] 스마트 HACCP — CCP 모니터링
  // ============================================================
  const CCP_DEF_KEY = 'rm_ccp_defs';
  const CCP_LOG_KEY = 'rm_ccp_logs';
  const CCP_DEF_VER_KEY = 'rm_ccp_defs_ver';
  // 실제 우성사료 논산공장 HACCP CCP 계획(DOC-N-360, V36 2025.02.28) 기준 6종
  //  · 1C-1/1C-2/1C-3: 원료입고검사 곰팡이독소, 1B: 원료 살모넬라, 2B: 가공/건조, 3P: 반려 X-Ray 이물
  const defaultCCPs = [
    { id:'CCP-1C-1', code:'CCP-1C-1', name:'원료 아플라톡신(옥수수·야자박·면실피)', processStep:'원료입고/검사', factory:'NS', param:'Aflatoxin(Total)', unit:'ppb', limitType:'max', clMin:null, clMax:10,   monitorCycle:'모선별(입고전)', action:'①법적기준 초과: 입고금지 ②이내: 희석사용(배합비 제한·곰팡이독소저감제). 한계기준 원료별: 옥수수 10 / 야자박 30 / 면실피 40 ppb 이하', active:true },
    { id:'CCP-1C-2', code:'CCP-1C-2', name:'원료 보미톡신(수입단백피)',           processStep:'원료입고/검사', factory:'NS', param:'Vomitoxin(DON)', unit:'ppb', limitType:'max', clMin:null, clMax:6000, monitorCycle:'모선별(입고전)', action:'①초과: 입고금지 ②이내: 희석사용. 자체분석(HPLC)', active:true },
    { id:'CCP-1C-3', code:'CCP-1C-3', name:'원료 제랄레논(수입단백피)',           processStep:'원료입고/검사', factory:'NS', param:'Zearalenone',    unit:'ppb', limitType:'max', clMin:null, clMax:1000, monitorCycle:'모선별(입고전)', action:'①초과: 입고금지 ②이내: 희석사용. 자체분석(HPLC)', active:true },
    { id:'CCP-1B',   code:'CCP-1B',   name:'원료 살모넬라(어분: 뱀장어·자돈용)', processStep:'원료입고/검사', factory:'NS', param:'살모넬라',        unit:'판정', limitType:'pass', clMin:null, clMax:null, monitorCycle:'차량/입고일별(사용전)', action:'검출 시 사용금지, 납품처 방문 원인조사·변경 검토. 자체분석(PCR)', active:true },
    { id:'CCP-2B',   code:'CCP-2B',   name:'가공/건조 살모넬라(건조온도)',       processStep:'가공/건조',     factory:'NS', param:'건조온도',      unit:'℃', limitType:'min', clMin:70,   clMax:null, monitorCycle:'생산시', action:'폐기, 원인분석 후 재발방지. 한계기준: 건조기 70℃ 이상 40분 이상', active:true },
    { id:'CCP-3P',   code:'CCP-3P',   name:'반려 소포장 이물(X-Ray)',           processStep:'반려동물 소포장/X-Ray', factory:'NS', param:'이물검출', unit:'판정', limitType:'pass', clMin:null, clMax:null, monitorCycle:'생산시', action:'폐기, 원인분석 후 재발방지. 한계기준: Fe 2.0 / SUS 2.0 / 유리 4.0 / 세라믹 4.0mm 이상 불검출', active:true },
  ];
  const CCP_DEF_VERSION = '2026-07-03-real-v36';
  const getCCPDefs = (factory='ALL') => {
    let l = get(CCP_DEF_KEY);
    const savedVer = (typeof localStorage !== 'undefined') ? localStorage.getItem(CCP_DEF_VER_KEY) : null;
    // 최초(빈 값) 또는 옛 예시 시드(id CCP-01/02/03) 상태면 실제 CCP 6종으로 교체.
    //  사용자가 편집·추가한 흔적(그 외 id)이 있으면 보존.
    const isLegacySeed = l.length > 0 && l.every(c => ['CCP-01','CCP-02','CCP-03'].includes(c.id));
    if (l.length === 0 || (savedVer !== CCP_DEF_VERSION && isLegacySeed)) {
      l = defaultCCPs.map(c => ({ ...c }));
      set(CCP_DEF_KEY, l);
      try { localStorage.setItem(CCP_DEF_VER_KEY, CCP_DEF_VERSION); } catch (_) {}
    }
    return factory === 'ALL' ? l : l.filter(c => c.factory === factory || c.factory === 'ALL');
  };
  const addCCPDef    = (d)        => { const l=get(CCP_DEF_KEY); const rec={ id:uuid(), active:true, ...d }; l.push(rec); set(CCP_DEF_KEY,l); return rec; };
  const updateCCPDef = (id,patch) => { const l=get(CCP_DEF_KEY); const i=l.findIndex(x=>x.id===id); if(i<0) return null; l[i]={...l[i],...patch}; set(CCP_DEF_KEY,l); return l[i]; };
  const judgeCCP = (def, value) => {
    if (!def) return 'OK';
    if (def.limitType === 'pass') {
      const s = String(value).replace(/\s/g, '');
      // 불검출/미검출/음성/합격/정상/적합 = 정상(OK). '검출/양성/부적합/초과' = 이탈.
      if (/불검출|미검출|음성|합격|정상|적합|PASS|OK/i.test(s) && !/부적합|불합격/i.test(s)) return 'OK';
      if (/검출|양성|부적합|불합격|초과|FAIL|NG/i.test(s)) return 'DEVIATION';
      return 'OK';
    }
    const v = Number(value); if (isNaN(v)) return 'OK';
    if (def.limitType === 'min')   return v >= Number(def.clMin) ? 'OK' : 'DEVIATION';
    if (def.limitType === 'max')   return v <= Number(def.clMax) ? 'OK' : 'DEVIATION';
    if (def.limitType === 'range') return (v >= Number(def.clMin) && v <= Number(def.clMax)) ? 'OK' : 'DEVIATION';
    return 'OK';
  };
  const getCCPLogs = (factory='ALL') => {
    const l = get(CCP_LOG_KEY).sort((a,b)=>String(b.measuredAt).localeCompare(String(a.measuredAt)));
    return factory==='ALL' ? l : l.filter(x=>x.factory===factory);
  };
  const addCCPLog = (data) => {
    const def    = getCCPDefs('ALL').find(c => c.id === data.ccpId);
    const judged = judgeCCP(def, data.value);
    const rec = {
      id: uuid(), ccpId: data.ccpId, ccpName: def ? def.name : (data.ccpName||''),
      param: def ? def.param : '', unit: def ? def.unit : (data.unit||''),
      value: data.value, judged,
      correctiveAction: judged === 'DEVIATION' ? (data.correctiveAction || (def ? def.action : '')) : '',
      factory: data.factory || (def ? def.factory : 'AS'),
      refLotNo: data.refLotNo || '', measuredBy: data.measuredBy || '현장', measuredAt: now(),
    };
    const l = get(CCP_LOG_KEY); l.push(rec); set(CCP_LOG_KEY, l);
    addHistory({ refId: rec.refLotNo || rec.ccpId, refType:'CCP', action:`${rec.ccpName} ${judged==='DEVIATION'?'한계이탈':'정상'}`, detail:`측정 ${rec.value}${rec.unit} / 판정 ${judged}`, actor: rec.measuredBy });
    return rec;
  };
  const getCCPStatus = (factory='ALL') => {
    const defs = getCCPDefs(factory), logs = getCCPLogs(factory);
    const today = new Date().toISOString().split('T')[0];
    return defs.map(d => {
      const mine = logs.filter(l => l.ccpId === d.id);
      const last = mine[0] || null;
      const devToday = mine.filter(l => l.judged==='DEVIATION' && String(l.measuredAt).startsWith(today)).length;
      return { def:d, last, deviations: devToday, total: mine.length };
    });
  };

  // ============================================================
  // [신규] 설비관리 · OEE · 예지보전 · 수리내역
  // ============================================================
  const EQUIP_KEY     = 'rm_equipment';
  const EQUIP_LOG_KEY = 'rm_equip_logs';
  const OEE_KEY       = 'rm_oee';
  const defaultEquip = [
    { id:'EQ-01', code:'MIX-01', name:'배합 믹서 1호', factory:'AS', type:'배합', status:'RUN',  installDate:'2022-03-10', lastCheck:'2026-06-20', nextCheck:'2026-07-20', runtimeHours:8200 },
    { id:'EQ-02', code:'PEL-01', name:'펠릿기 1호',   factory:'AS', type:'성형', status:'RUN',  installDate:'2021-11-05', lastCheck:'2026-06-15', nextCheck:'2026-07-05', runtimeHours:11800 },
    { id:'EQ-03', code:'MD-01',  name:'금속검출기',   factory:'AS', type:'검사', status:'RUN',  installDate:'2023-01-20', lastCheck:'2026-06-28', nextCheck:'2026-07-28', runtimeHours:5400 },
    { id:'EQ-04', code:'PKG-01', name:'자동 포장기',  factory:'AS', type:'포장', status:'IDLE', installDate:'2022-08-14', lastCheck:'2026-05-30', nextCheck:'2026-06-30', runtimeHours:9100 },
  ];
  const getEquipment = (factory='ALL') => {
    let l = get(EQUIP_KEY);
    if (l.length === 0) { l = defaultEquip.slice(); set(EQUIP_KEY, l); }
    return factory==='ALL' ? l : l.filter(e => e.factory === factory);
  };
  const getEquipById   = (id)      => getEquipment('ALL').find(e => e.id === id);
  const addEquipment   = (d)       => { const l=get(EQUIP_KEY); const rec={ id:uuid(), status:'IDLE', runtimeHours:0, ...d }; l.push(rec); set(EQUIP_KEY,l); return rec; };
  const updateEquipment= (id,patch)=> { const l=get(EQUIP_KEY); const i=l.findIndex(x=>x.id===id); if(i<0) return null; l[i]={...l[i],...patch}; set(EQUIP_KEY,l); return l[i]; };
  const setEquipStatus = (id,status)=> updateEquipment(id, { status });
  const getEquipLogs   = (equipId=null) => {
    const l = get(EQUIP_LOG_KEY).sort((a,b)=>String(b.at).localeCompare(String(a.at)));
    return equipId ? l.filter(x=>x.equipId===equipId) : l;
  };
  const addEquipLog = (data) => {
    const eq = getEquipById(data.equipId);
    const rec = { id:uuid(), equipId:data.equipId, equipName: eq?eq.name:(data.equipName||''), type:data.type||'CHECK', memo:data.memo||'', cost:Number(data.cost)||0, downtimeMin:Number(data.downtimeMin)||0, factory: eq?eq.factory:(data.factory||'AS'), actor:data.actor||'설비팀', at: now() };
    const l = get(EQUIP_LOG_KEY); l.push(rec); set(EQUIP_LOG_KEY, l);
    // 점검이면 lastCheck/nextCheck 갱신, 수리면 상태 복귀
    if (eq && data.type === 'CHECK') { const d=new Date(); const next=new Date(d.getTime()+30*864e5); updateEquipment(eq.id, { lastCheck:d.toISOString().split('T')[0], nextCheck:next.toISOString().split('T')[0] }); }
    if (eq && data.type === 'REPAIR' && data.restore) setEquipStatus(eq.id, 'RUN');
    addHistory({ refId: data.equipId, refType:'EQUIP', action:`설비 ${({RUN:'가동',STOP:'정지',REPAIR:'수리',CHECK:'점검'})[rec.type]||rec.type}`, detail:`${rec.equipName}${rec.memo?' / '+rec.memo:''}`, actor: rec.actor });
    return rec;
  };
  const getMaintenanceDue = (factory='ALL') => {
    const today = new Date().toISOString().split('T')[0];
    return getEquipment(factory)
      .filter(e => e.nextCheck)
      .map(e => ({ ...e, overdue: e.nextCheck < today, dday: Math.round((new Date(e.nextCheck) - new Date(today))/864e5) }))
      .filter(e => e.overdue || e.dday <= 7)
      .sort((a,b)=>a.dday-b.dday);
  };
  const getOEERecords = (factory='ALL') => {
    const l = get(OEE_KEY).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    return factory==='ALL' ? l : l.filter(x=>x.factory===factory);
  };
  const addOEE = (data) => {
    const plannedMin = Number(data.plannedMin)||0, runMin = Number(data.runMin)||0;
    const idealRate  = Number(data.idealRate)||0;    // 이상 생산속도(개/분 또는 kg/분)
    const producedQty= Number(data.producedQty)||0, goodQty = Number(data.goodQty)||0;
    const availability = plannedMin>0 ? runMin/plannedMin : 0;
    const performance  = (runMin>0 && idealRate>0) ? Math.min(1, producedQty/(idealRate*runMin)) : 0;
    const quality      = producedQty>0 ? goodQty/producedQty : 0;
    const oee = Math.round(availability*performance*quality*1000)/10; // %
    const eq  = getEquipById(data.equipId);
    const rec = { id:uuid(), equipId:data.equipId, equipName: eq?eq.name:'', date: data.date || new Date().toISOString().split('T')[0],
      plannedMin, runMin, idealRate, producedQty, goodQty,
      availability: Math.round(availability*1000)/10, performance: Math.round(performance*1000)/10, quality: Math.round(quality*1000)/10, oee,
      factory: eq?eq.factory:(data.factory||'AS'), actor: data.actor||'생산팀', createdAt: now() };
    const l = get(OEE_KEY); l.push(rec); set(OEE_KEY, l);
    return rec;
  };

  // ============================================================
  // [신규] 부자재/포장재 재고 · 자동발주
  // ============================================================
  const SUBMAT_KEY   = 'rm_submaterials';
  const SUBORDER_KEY = 'rm_sub_orders';
  const defaultSubMats = [
    { id:'SM-01', code:'PKG-25KG', name:'25kg 크라프트 포대', category:'포장재', unit:'매', qty:1200, reorderPoint:800, leadDays:5, supplierName:'대한포장', factory:'AS' },
    { id:'SM-02', code:'PKG-TON',  name:'톤백',             category:'포장재', unit:'개', qty:180,  reorderPoint:200, leadDays:7, supplierName:'세종산업', factory:'AS' },
    { id:'SM-03', code:'LBL-QR',   name:'QR 라벨(롤)',      category:'라벨',   unit:'롤', qty:14,   reorderPoint:20,  leadDays:3, supplierName:'프린텍', factory:'AS' },
    { id:'SM-04', code:'PMX-VM',   name:'비타민 프리믹스',  category:'프리믹스', unit:'kg', qty:640, reorderPoint:500, leadDays:10, supplierName:'한국양행', factory:'AS' },
  ];
  const getSubMaterials = (factory='ALL') => {
    let l = get(SUBMAT_KEY);
    if (l.length === 0) { l = defaultSubMats.slice(); set(SUBMAT_KEY, l); }
    return factory==='ALL' ? l : l.filter(s => s.factory === factory);
  };
  const addSubMaterial    = (d)       => { const l=get(SUBMAT_KEY); const rec={ id:uuid(), qty:0, ...d, updatedAt:now() }; l.push(rec); set(SUBMAT_KEY,l); return rec; };
  const updateSubMaterial = (id,patch)=> { const l=get(SUBMAT_KEY); const i=l.findIndex(x=>x.id===id); if(i<0) return null; l[i]={...l[i],...patch,updatedAt:now()}; set(SUBMAT_KEY,l); return l[i]; };
  const adjustSubMaterial = (id,delta,reason,actor) => {
    const l=get(SUBMAT_KEY); const i=l.findIndex(x=>x.id===id); if(i<0) return null;
    l[i].qty = Math.max(0, (Number(l[i].qty)||0) + Number(delta)); l[i].updatedAt=now(); set(SUBMAT_KEY,l);
    addHistory({ refId:id, refType:'SUBMAT', action:'부자재 재고조정', detail:`${l[i].name} ${delta>0?'+':''}${delta}${l[i].unit} / ${reason||''}`, actor:actor||'자재팀' });
    return l[i];
  };
  const getReorderSuggestions = (factory='ALL') =>
    getSubMaterials(factory)
      .filter(s => Number(s.qty) <= Number(s.reorderPoint))
      .map(s => ({ ...s, suggestQty: Math.max(Number(s.reorderPoint)*2 - Number(s.qty), Number(s.reorderPoint)), shortage: Number(s.reorderPoint) - Number(s.qty) }));
  const getSubOrders = (factory='ALL') => {
    const l = get(SUBORDER_KEY).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    return factory==='ALL' ? l : l.filter(o => o.factory === factory);
  };
  const addSubOrder = (data) => {
    const sm = getSubMaterials('ALL').find(s => s.id === data.subId);
    const rec = { id:uuid(), subId:data.subId, name: sm?sm.name:(data.name||''), qty:Number(data.qty)||0, unit: sm?sm.unit:'', status:data.status||'ORDERED', supplierName: data.supplierName||(sm?sm.supplierName:''), factory: sm?sm.factory:(data.factory||'AS'), actor:data.actor||'구매팀', createdAt: now() };
    const l = get(SUBORDER_KEY); l.push(rec); set(SUBORDER_KEY, l);
    addHistory({ refId:rec.subId, refType:'SUBORDER', action:'부자재 발주', detail:`${rec.name} ${rec.qty}${rec.unit} → ${rec.supplierName}`, actor:rec.actor });
    return rec;
  };
  const updateSubOrder = (id,patch) => {
    const l=get(SUBORDER_KEY); const i=l.findIndex(x=>x.id===id); if(i<0) return null;
    l[i]={...l[i],...patch}; set(SUBORDER_KEY,l);
    if (patch.status === 'RECEIVED') { const sm=getSubMaterials('ALL').find(s=>s.id===l[i].subId); if(sm) adjustSubMaterial(sm.id, l[i].qty, '발주 입고', l[i].actor); }
    return l[i];
  };

  // ============================================================
  // [신규] 공정 이슈 기록
  // ============================================================
  const ISSUE_KEY = 'rm_process_issues';
  const getIssues = (factory='ALL') => {
    const l = get(ISSUE_KEY).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    return factory==='ALL' ? l : l.filter(x=>x.factory===factory);
  };
  const addIssue = (data) => {
    const rec = { id:uuid(), factory:data.factory||'AS', processStep:data.processStep||'', category:data.category||'품질', severity:data.severity||'MEDIUM', title:data.title||'', detail:data.detail||'', status:'OPEN', action:'', reporter:data.reporter||'현장', createdAt:now(), closedAt:null };
    const l=get(ISSUE_KEY); l.push(rec); set(ISSUE_KEY,l);
    addHistory({ refId:rec.id, refType:'ISSUE', action:`공정이슈 등록(${rec.category})`, detail:rec.title, actor:rec.reporter });
    return rec;
  };
  const updateIssue = (id, patch) => {
    const l = get(ISSUE_KEY);
    const i = l.findIndex(x => x.id === id);
    if (i < 0) return null;
    const before = { ...l[i] };
    l[i] = { ...l[i], ...patch };
    if (patch.status === 'CLOSED' && !l[i].closedAt) l[i].closedAt = now();
    if (window.AuditLog) AuditLog.record(l[i], before, {
      title: '제목', category: '분류', factory: '공장', status: '상태', severity: '심각도',
      cause: '원인', action: '조치', owner: '담당', dueDate: '기한', note: '비고',
    }, { by: patch.updatedBy });
    set(ISSUE_KEY, l);
    return l[i];
  };

  // ============================================================
  // [신규] 제품 재고 현황(제품LOT 생산량 − 출고량)
  // ============================================================
  const getProductStockRows = (factory='ALL') => {
    const lots = getProductLots().filter(p => factory==='ALL' || p.factory===factory);
    const outs = getOutbounds();
    return lots.map(p => {
      const shipped = outs.filter(o => o.fgLotNo===p.fgLotNo || o.productLotId===p.id || o.lotNo===p.fgLotNo)
                          .reduce((s,o)=> s + (Number(o.qty)||Number(o.amount)||0), 0);
      const produced = Number(p.qty)||0;
      return { ...p, produced, shipped, remaining: Math.max(0, produced - shipped) };
    });
  };

  // ============================================================
  // 공개 API
  // ============================================================
  return {
    // 유틸
    uuid, now,
    // 공장
    getFactories, getFactoryName, getFactoryLotCode,
    // 원료
    loadMaterialsFromJSON, getMaterials, getMaterialByCode, getMaterialByQRCode, searchMaterials,
    addMaterial, updateMaterialByCode,
    // 제품
    loadProductsFromJSON, getProducts, getProductByCode, getProductByQRCode, searchProducts,
    addProduct, updateProductByCode,
    // QR
    makeQRValue, resolveQRCode, recordQRScan, getQRScanLogs, importReceivingFromQRLink,
    // 협력사
    getSuppliers, getSupplierById, getSupplierByCode, getSupplierByName, getSupplierByQRCode, searchSuppliers, generateSupplierCode, loadSuppliersFromJSON, addSupplier, updateSupplier,
    // 사일로
    getSilos, getSiloById, getSilosByFactory, addSilo, assignLotToSilo, consumeFromSiloFIFO, getSiloCapacitySummary,
    // 로스
    getLoss, addLoss,
    // 입고
    getReceivings, getReceivingById, addReceiving, updateReceiving, incrementScanCount, generatePreRegId, generateLotNo,
    getSupplierPreNotices, addSupplierPreNotice, markQrPrinted, processSupplierInbound,
    // 예외
    getExceptions, addException, resolveException,
    // 계근
    getWeighings, addWeighing, getWeighingByReceivingId,
    // 품질
    getQCConfig, saveQCConfig, getInspections, addInspection, getInspectionsByReceivingId,
    FAIL_CODES, failCodeLabel,
    getRawAnalyses, getProductAnalyses, getRawAnalysesByMaterial, getProductAnalysesByProduct, addRawAnalysis, addProductAnalysis,
    // 재고
    getInventory, getInventoryByCode, registerStock, adjustInventory,
    // 투입지시
    getProductionOrders, getProductionOrderById, addProductionOrder, executeProductionOrder,
    // 배합비
    getFormulaRecipes, getFormulaRecipeById, getFormulaRecipesByProduct, addFormulaRecipe, updateFormulaRecipe,
    // 배합
    getBatches, getBatchById, addBatch, getUnbatchedOrders,
    // 제품LOT
    getProductLots, getProductLotById, addProductLot, updateProductLot,
    getShelfConfig, setShelfConfig, shelfMonthsFor, addMonthsTo, addDaysTo, addBusinessDays, businessDaysBetween,
    // VOC
    getVOCs, getVOCById, addVOC, updateVOC, deleteVOC, traceVOC, vocMfgDate, findProductLotsByMfgDate,
    addVOCLog, deleteVOCLog, vocCloseCheck, vocOverdue, vocLeadDays, vocStats, vocFeedback,
    VOC_CATEGORIES, VOC_ROOT_TYPES, VOC_CHANNELS, VOC_SATISFACTION, VOC_STATUS, VOC_ANSWER_DAYS,
    // 출고
    getOutbounds, addOutbound, addProductOutbound,
    // 이력
    getHistory, addHistory, getHistoryByRefId,
    // 통계
    getStats, getMaterialUsageRows, getInventoryCycleRows,
    // 설정
    getSettings, saveSettings,
    // [신규] 스마트 HACCP/CCP
    getCCPDefs, addCCPDef, updateCCPDef, getCCPLogs, addCCPLog, getCCPStatus, judgeCCP,
    // [신규] 설비/OEE/예지보전/수리
    getEquipment, getEquipById, addEquipment, updateEquipment, setEquipStatus,
    getEquipLogs, addEquipLog, getMaintenanceDue, getOEERecords, addOEE,
    // [신규] 부자재/자동발주
    getSubMaterials, addSubMaterial, updateSubMaterial, adjustSubMaterial,
    getReorderSuggestions, getSubOrders, addSubOrder, updateSubOrder,
    // [신규] 공정이슈
    getIssues, addIssue, updateIssue,
    // [신규] 제품재고
    getProductStockRows,
    // 초기화
    initSampleData,
  };
})();
