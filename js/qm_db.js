// ============================================================
// qm_db.js — 품질검사 로트·품질재고 데이터 레이어
//
//   근거: 우성사료 To-Be 정의서(품질 업무영역) v1.0 / 2021.08.03 — SAP QM 프로세스
//     QM.1 기준정보   : 자재 QM뷰(검사대상 지정) · 검사계획
//     QM.2 품질검사   : 2.1 원부재료 입고검사 / 2.2 제품·반제품 입고검사 / 2.3 재고 반복검사
//     QM.3 부적합관리 : 불용전환 → 위해요소 평가 → 폐기 또는 해제
//
//   ── 왜 만들었나 ──
//   기존 앱의 품질 게이트는 "판정을 기록"할 뿐 재고를 막지 못했다.
//   입고가 IN_STOCK 이 되면 판정과 무관하게 출고·투입에 쓸 수 있었다.
//   To-Be 문서가 세 번 반복하는 목표가 "품질검사 결과에 따른 통제기능"이므로,
//   재고를 품질상태 3구분으로 나누고 용도결정(UD)을 거쳐야 가용으로 풀리게 했다.
//
//   ── 핵심 개념 ──
//   검사로트(Inspection Lot) : 검사의 단위. 발생원(구매입고/생산입고/반복검사)을 갖는다.
//   품질재고 3구분           : 품질검사재고(QI) / 가용재고 / 보류재고. 합은 총 재고.
//   용도결정(UD)             : 합부판정과 별개다. 판정은 "규격 충족 여부",
//                              UD 는 "그래서 이 재고를 어떻게 할 것인가"이다.
//                              조건부합격을 특채로 쓸지 보류할지는 판정이 아니라 UD 가 정한다.
// ============================================================

const QmDB = (() => {
  const LOT_KEY   = 'qm_lots';
  const STOCK_KEY = 'qm_stock';
  const SETUP_KEY = 'qm_setup';        // 자재별 검사설정 (SAP 자재마스터 QM뷰)
  const SEED_KEY  = 'qm_seed_ver';
  const SEED_VERSION = '2026-08-14-qm1';

  const now = () => new Date().toISOString();
  const notifyWrite = (k) => { try { if (typeof window !== 'undefined' && window.__onDbWrite) window.__onDbWrite(k); } catch (_) {} };
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (_) { return []; } };
  const write = (k, d) => { localStorage.setItem(k, JSON.stringify(d)); notifyWrite(k); };
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pad = (n, w) => String(n).padStart(w, '0');
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`; };
  const addDays = (dateStr, n) => {
    const d = new Date(dateStr || todayStr());
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
  };
  const num = (v) => Number(v) || 0;

  // ============================================================
  // 공통 코드
  // ============================================================

  // 검사 발생원 — SAP 의 검사유형(01/04/09)에 대응
  const ORIGINS = {
    P01: { label: '구매입고',   short: '구매', cls: 'badge-info',   ref: '원부재료·상품 입고 (QM.2.1)' },
    P04: { label: '생산입고',   short: '생산', cls: 'badge-purple', ref: '제품·반제품 입고 (QM.2.2)' },
    P09: { label: '반복검사',   short: '반복', cls: 'badge-warning', ref: '장기보관 재고 (QM.2.3)' },
  };

  const LOT_STATUS = {
    CREATED:  { label: '로트생성', cls: 'badge-default', order: 1 },
    SAMPLED:  { label: '샘플채취', cls: 'badge-info',    order: 2 },
    TESTING:  { label: '분석중',   cls: 'badge-info',    order: 3 },
    RESULTED: { label: '결과등록', cls: 'badge-purple',  order: 4 },
    UD_DONE:  { label: '용도결정', cls: 'badge-pass',    order: 5 },
    CANCELLED:{ label: '취소',     cls: 'badge-fail',    order: 9 },
  };

  const VERDICTS = {
    PASS: { label: '합격',     cls: 'badge-pass' },
    COND: { label: '조건부합격', cls: 'badge-warning' },
    FAIL: { label: '부적합',   cls: 'badge-fail' },
  };

  // 용도결정 코드 — 판정 결과를 재고 상태로 옮기는 유일한 통로
  const UD_CODES = {
    A: { label: '가용전환',   to: 'unrestricted', cls: 'badge-pass',    need: [],           desc: '합격 — 정상 사용' },
    C: { label: '특채사용',   to: 'unrestricted', cls: 'badge-warning', need: ['note'],     desc: '규격 이탈이나 사용 승인 (사유 필수)' },
    B: { label: '보류전환',   to: 'blocked',      cls: 'badge-fail',    need: [],           desc: '부적합 — 처분 대기' },
    D: { label: '재작업',     to: 'blocked',      cls: 'badge-warning', need: ['note'],     desc: '재선별·재가공 후 재검사' },
    E: { label: '반품',       to: 'returned',     cls: 'badge-fail',    need: ['note'],     desc: '공급사 반품 — 재고에서 제외' },
    F: { label: '폐기',       to: 'scrapped',     cls: 'badge-fail',    need: ['note'],     desc: '타계정출고 — 재고에서 제외' },
  };

  // 부적합 처분 (QM.3.1)
  const DISPOSAL = {
    RELEASE: { label: '해제(가용전환)', cls: 'badge-pass', desc: '위해 없음 — 보류 해제' },
    SCRAP:   { label: '폐기출고',       cls: 'badge-fail', desc: '위해 있음 — 타계정출고' },
    RETURN:  { label: '공급사 반품',    cls: 'badge-fail', desc: '공급사로 반송' },
    REWORK:  { label: '재작업 지시',    cls: 'badge-warning', desc: '재선별 후 재검사' },
  };

  const meta = (map, k) => map[k] || { label: k || '-', cls: 'badge-default' };

  const byFactory = (list, f) => (!f || f === 'ALL') ? list : list.filter(x => x.factory === f);
  const newest = (list) => list.slice().sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const nextNo = (list, prefix, field) => {
    const yy = String(new Date().getFullYear()).slice(2);
    const head = `${prefix}-${yy}-`;
    const max = list.map(x => String(x[field] || ''))
      .filter(c => c.startsWith(head))
      .reduce((m, c) => Math.max(m, parseInt(c.slice(head.length), 10) || 0), 0);
    return head + pad(max + 1, 4);
  };

  // ============================================================
  // 자재 검사설정 (SAP 자재마스터 QM뷰 — QM.1.1.5)
  //   "이 자재가 검사 대상인가"를 정하는 곳. 이게 없으면 전 자재를 검사하거나
  //   아무것도 검사하지 않게 된다. 미등록 자재는 기본값(입고검사 ON)으로 본다.
  // ============================================================
  const getSetups = () => read(SETUP_KEY);
  const getSetup = (materialCode) => getSetups().find(x => x.materialCode === String(materialCode)) || null;
  const setupOf = (materialCode) => {
    const s = getSetup(materialCode);
    return s || {
      materialCode: String(materialCode || ''), materialName: '',
      onReceive: true, onProduce: true, recurringDays: 0, sampleQty: '',
      note: '', registered: false,
    };
  };
  const saveSetup = (data) => {
    const list = getSetups();
    const i = list.findIndex(x => x.materialCode === String(data.materialCode));
    const item = {
      materialCode: String(data.materialCode),
      materialName: data.materialName || '',
      onReceive: !!data.onReceive,
      onProduce: !!data.onProduce,
      recurringDays: num(data.recurringDays),
      sampleQty: data.sampleQty || '',
      note: data.note || '',
      registered: true,
      updatedAt: now(),
      updatedBy: data.updatedBy || '',
    };
    if (i >= 0) list[i] = { ...list[i], ...item }; else list.push(item);
    write(SETUP_KEY, list);
    return item;
  };
  const removeSetup = (materialCode) =>
    write(SETUP_KEY, getSetups().filter(x => x.materialCode !== String(materialCode)));

  // ============================================================
  // 검사로트
  // ============================================================
  const getLots = () => read(LOT_KEY);
  const getLotById = (id) => getLots().find(x => x.id === id);
  const getLotsBy = (factory) => newest(byFactory(getLots(), factory));
  const openLots = (factory) => getLotsBy(factory).filter(l => l.status !== 'UD_DONE' && l.status !== 'CANCELLED');
  const lotsOfRef = (refType, refId) => getLots().filter(l => l.refType === refType && l.refId === refId);

  const addLot = (data) => {
    const list = getLots();
    const item = {
      id: uid('QL'),
      lotNo: data.lotNo || nextNo(list, 'QL', 'lotNo'),
      factory: data.factory || 'AS',
      origin: data.origin || 'P01',
      refType: data.refType || '',
      refId: data.refId || '',
      materialCode: String(data.materialCode || ''),
      materialName: data.materialName || '',
      batchNo: data.batchNo || '',
      qty: num(data.qty),
      unit: data.unit || 'kg',
      plannedDate: data.plannedDate || todayStr(),
      status: 'CREATED',
      verdict: '',
      results: [],
      qualResults: [],
      ud: null,
      sampledBy: '', sampledAt: '',
      testedBy: '', resultAt: '',
      expiryDate: data.expiryDate || '',
      expiryAfter: '',
      nextInspectDate: data.nextInspectDate || '',
      supplierName: data.supplierName || '',
      note: data.note || '',
      createdAt: now(), updatedAt: now(),
      createdBy: data.createdBy || '',
    };
    list.push(item);
    write(LOT_KEY, list);
    // 로트가 생기는 순간 그 수량은 품질검사재고로 묶인다 — 이게 통제의 시작점이다
    moveStock({
      factory: item.factory, materialCode: item.materialCode, materialName: item.materialName,
      batchNo: item.batchNo, lotId: item.id, expiryDate: item.expiryDate,
      nextInspectDate: item.nextInspectDate,
    }, data.fromStatus || null, 'qi', item.qty);
    return item;
  };

  const updateLot = (id, patch) => {
    const list = getLots();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return null;
    // 용도결정이 끝난 로트는 결과를 못 고친다. 고치려면 재검사 로트를 새로 낸다.
    if (list[i].status === 'UD_DONE' && !patch.__force) return list[i];
    delete patch.__force;
    list[i] = { ...list[i], ...patch, updatedAt: now() };
    write(LOT_KEY, list);
    return list[i];
  };

  const removeLot = (id) => {
    const lot = getLotById(id);
    if (lot && lot.status !== 'UD_DONE') {
      // 묶어둔 검사재고를 풀어준다(원래 상태로 되돌림)
      moveStock({ factory: lot.factory, materialCode: lot.materialCode, batchNo: lot.batchNo, lotId: lot.id },
        'qi', lot.origin === 'P09' ? 'unrestricted' : null, lot.qty);
    }
    write(LOT_KEY, getLots().filter(x => x.id !== id));
  };

  const sampleLot = (id, by) => updateLot(id, { status: 'SAMPLED', sampledBy: by || '', sampledAt: now() });
  const startTest = (id) => updateLot(id, { status: 'TESTING' });

  // 검사결과 등록 (QM.2.x.2.1) — 정량 결과로 자동 판정하되 최종 판정은 사람이 확정한다
  const judgeValue = (r) => {
    const v = Number(r.value);
    if (r.value === '' || r.value === null || r.value === undefined || !Number.isFinite(v)) return '';
    const lo = r.lower === '' || r.lower === null || r.lower === undefined ? null : Number(r.lower);
    const hi = r.upper === '' || r.upper === null || r.upper === undefined ? null : Number(r.upper);
    if (lo !== null && v < lo) return 'NG';
    if (hi !== null && v > hi) return 'NG';
    return 'OK';
  };
  const autoVerdict = (results, qualResults) => {
    const rs = (results || []).map(r => ({ ...r, judge: judgeValue(r) }));
    const anyNG = rs.some(r => r.judge === 'NG') || (qualResults || []).some(q => q.ng);
    const anyValue = rs.some(r => r.judge) || (qualResults || []).length > 0;
    if (!anyValue) return '';
    return anyNG ? 'FAIL' : 'PASS';
  };

  const saveResults = (id, results, qualResults, verdict, by) => {
    const rs = (results || []).map(r => ({ ...r, judge: judgeValue(r) }));
    return updateLot(id, {
      results: rs,
      qualResults: qualResults || [],
      verdict: verdict || autoVerdict(rs, qualResults),
      status: 'RESULTED',
      testedBy: by || '',
      resultAt: now(),
    });
  };

  // ============================================================
  // 용도결정 (QM.2.x.3.1) — 재고를 실제로 움직이는 유일한 지점
  // ============================================================
  const decideUsage = (id, code, opt = {}) => {
    const lot = getLotById(id);
    if (!lot) throw new Error('검사로트를 찾을 수 없습니다.');
    if (lot.status === 'UD_DONE') throw new Error('이미 용도결정된 로트입니다.');
    if (!lot.verdict) throw new Error('검사결과를 먼저 등록하십시오.');
    const ud = UD_CODES[code];
    if (!ud) throw new Error('알 수 없는 용도결정 코드입니다.');
    if (ud.need.includes('note') && !String(opt.note || '').trim()) {
      throw new Error(`${ud.label}은(는) 사유를 반드시 남겨야 합니다.`);
    }
    const qty = opt.qty === undefined || opt.qty === null || opt.qty === '' ? lot.qty : num(opt.qty);
    if (qty <= 0 || qty > lot.qty) throw new Error('용도결정 수량이 올바르지 않습니다.');

    moveStock({ factory: lot.factory, materialCode: lot.materialCode, materialName: lot.materialName,
      batchNo: lot.batchNo, lotId: lot.id }, 'qi', ud.to, qty);

    // 반복검사면 차기 검사일과 유통기한을 다시 잡는다 (QM.2.3 · MM.1.1.5.2 배치변경)
    const patch = {
      ud: { code, label: ud.label, to: ud.to, qty, note: opt.note || '', by: opt.by || '', at: now() },
      status: 'UD_DONE',
    };
    const setup = getSetup(lot.materialCode);
    if (ud.to === 'unrestricted' && setup && setup.recurringDays > 0) {
      patch.nextInspectDate = addDays(todayStr(), setup.recurringDays);
    }
    if (opt.newExpiry) patch.expiryAfter = opt.newExpiry;

    const saved = updateLot(id, patch);
    // 재고 행에도 차기검사일·유통기한을 반영해야 다음 트리거가 돈다
    patchStockMeta(lot.factory, lot.materialCode, lot.batchNo, {
      nextInspectDate: patch.nextInspectDate || undefined,
      expiryDate: opt.newExpiry || undefined,
    });
    return saved;
  };

  // ============================================================
  // 품질재고 3구분
  //   qi(품질검사) / unrestricted(가용) / blocked(보류) + returned·scrapped(재고 제외)
  // ============================================================
  const getStock = () => read(STOCK_KEY);
  const getStockBy = (factory) => byFactory(getStock(), factory);
  const stockKey = (f, code, batch) => `${f}|${code}|${batch || ''}`;
  const findStock = (f, code, batch) =>
    getStock().find(x => stockKey(x.factory, x.materialCode, x.batchNo) === stockKey(f, code, batch));

  const moveStock = (ref, from, to, qty) => {
    const amount = num(qty);
    if (amount <= 0) return null;
    const list = getStock();
    const key = stockKey(ref.factory, ref.materialCode, ref.batchNo);
    let i = list.findIndex(x => stockKey(x.factory, x.materialCode, x.batchNo) === key);
    if (i < 0) {
      list.push({
        id: uid('QS'),
        factory: ref.factory, materialCode: String(ref.materialCode || ''),
        materialName: ref.materialName || '', batchNo: ref.batchNo || '',
        lotId: ref.lotId || '',
        qi: 0, unrestricted: 0, blocked: 0, returned: 0, scrapped: 0,
        expiryDate: ref.expiryDate || '', nextInspectDate: ref.nextInspectDate || '',
        createdAt: now(), updatedAt: now(),
      });
      i = list.length - 1;
    }
    const row = list[i];
    if (from && row[from] !== undefined) row[from] = Math.max(0, num(row[from]) - amount);
    if (to && row[to] !== undefined) row[to] = num(row[to]) + amount;
    if (ref.lotId) row.lotId = ref.lotId;
    if (ref.materialName && !row.materialName) row.materialName = ref.materialName;
    if (ref.expiryDate) row.expiryDate = ref.expiryDate;
    if (ref.nextInspectDate) row.nextInspectDate = ref.nextInspectDate;
    row.updatedAt = now();
    write(STOCK_KEY, list);
    return row;
  };

  const patchStockMeta = (f, code, batch, patch) => {
    const list = getStock();
    const i = list.findIndex(x => stockKey(x.factory, x.materialCode, x.batchNo) === stockKey(f, code, batch));
    if (i < 0) return null;
    Object.entries(patch).forEach(([k, v]) => { if (v !== undefined) list[i][k] = v; });
    list[i].updatedAt = now();
    write(STOCK_KEY, list);
    return list[i];
  };

  // 보류재고 처분 (QM.3.1)
  const disposeBlocked = (stockId, action, opt = {}) => {
    const list = getStock();
    const i = list.findIndex(x => x.id === stockId);
    if (i < 0) throw new Error('재고를 찾을 수 없습니다.');
    const row = list[i];
    const qty = opt.qty === undefined || opt.qty === '' ? num(row.blocked) : num(opt.qty);
    if (qty <= 0 || qty > num(row.blocked)) throw new Error('처분 수량이 보류재고를 초과합니다.');
    const map = { RELEASE: 'unrestricted', SCRAP: 'scrapped', RETURN: 'returned', REWORK: 'blocked' };
    const to = map[action];
    if (!to) throw new Error('알 수 없는 처분 구분입니다.');
    if (!String(opt.note || '').trim()) throw new Error('처분 사유를 남겨야 합니다.');

    if (action !== 'REWORK') {
      row.blocked = Math.max(0, num(row.blocked) - qty);
      row[to] = num(row[to]) + qty;
    }
    row.disposals = (row.disposals || []).concat([{
      id: uid('QD'), action, label: DISPOSAL[action].label, qty,
      hazard: !!opt.hazard, note: opt.note || '', by: opt.by || '', at: now(),
    }]);
    row.updatedAt = now();
    write(STOCK_KEY, list);

    // 재작업은 재고를 옮기지 않고 재검사 로트를 새로 낸다
    if (action === 'REWORK') {
      const created = addLot({
        factory: row.factory, origin: 'P09', refType: 'REWORK', refId: row.id,
        materialCode: row.materialCode, materialName: row.materialName, batchNo: row.batchNo,
        qty, expiryDate: row.expiryDate, createdBy: opt.by || '',
        note: '재작업 후 재검사: ' + (opt.note || ''),
        fromStatus: 'blocked',
      });
      return { row, lot: created };
    }
    return { row };
  };

  // ============================================================
  // 반복검사 트리거 (QM.2.3.1.1)
  //   차기검사일이 도래한 가용재고를 찾아 검사로트를 만들고 품질검사재고로 돌린다.
  //   "알림만 띄우고 끝"이 아니라 재고를 실제로 잠그는 것이 요점이다.
  // ============================================================
  const dueForRecurring = (factory) => {
    const today = todayStr();
    return getStockBy(factory).filter(s =>
      num(s.unrestricted) > 0 && s.nextInspectDate && s.nextInspectDate <= today);
  };

  const runRecurringTrigger = (factory, by) => {
    const due = dueForRecurring(factory);
    const created = [];
    due.forEach(s => {
      const lot = addLot({
        factory: s.factory, origin: 'P09', refType: 'RECURRING', refId: s.id,
        materialCode: s.materialCode, materialName: s.materialName, batchNo: s.batchNo,
        qty: num(s.unrestricted), expiryDate: s.expiryDate, createdBy: by || '',
        note: `차기검사일 ${s.nextInspectDate} 도래`,
        fromStatus: 'unrestricted',
      });
      created.push(lot);
    });
    return created;
  };

  // ============================================================
  // 기존 입고·생산과의 연결
  //   입고 승인건 중 아직 검사로트가 없는 것을 찾아준다.
  //   기존 흐름을 건드리지 않고 QM 레이어를 얹기 위한 접점이다.
  // ============================================================
  const pendingReceivings = (factory) => {
    if (typeof DB === 'undefined') return [];
    let list = [];
    try { list = DB.getReceivings() || []; } catch (_) { return []; }
    const done = new Set(getLots().filter(l => l.refType === 'RECEIVING').map(l => l.refId));
    const f = (!factory || factory === 'ALL') ? null : factory;
    return list.filter(r => {
      if (done.has(r.id)) return false;
      if (f && r.factory !== f) return false;
      if (['CANCELLED', 'REJECTED', 'QR_ISSUED'].includes(r.status)) return false;
      const setup = setupOf(r.materialCode);
      return setup.onReceive;
    });
  };

  const createLotFromReceiving = (receivingId, by) => {
    const r = (typeof DB !== 'undefined') ? DB.getReceivingById(receivingId) : null;
    if (!r) throw new Error('입고 문서를 찾을 수 없습니다.');
    if (lotsOfRef('RECEIVING', receivingId).length) throw new Error('이미 검사로트가 생성된 입고건입니다.');
    const setup = getSetup(r.materialCode);
    return addLot({
      factory: r.factory, origin: 'P01', refType: 'RECEIVING', refId: r.id,
      materialCode: r.materialCode, materialName: r.materialName,
      batchNo: r.lotNumber || r.lotNo || r.id,
      qty: num(r.actualWeight) || num(r.expectedWeight),
      expiryDate: r.expiryDate || '',
      supplierName: r.supplierName || '',
      nextInspectDate: setup && setup.recurringDays > 0 ? addDays(todayStr(), setup.recurringDays) : '',
      createdBy: by || '',
    });
  };

  const pendingProductLots = (factory) => {
    if (typeof DB === 'undefined') return [];
    let list = [];
    try { list = DB.getProductLots() || []; } catch (_) { return []; }
    const done = new Set(getLots().filter(l => l.refType === 'PRODUCT_LOT').map(l => l.refId));
    const f = (!factory || factory === 'ALL') ? null : factory;
    return list.filter(p => {
      if (done.has(p.id)) return false;
      if (f && p.factory !== f) return false;
      return setupOf(p.productCode || p.materialCode).onProduce;
    });
  };

  const createLotFromProductLot = (productLotId, by) => {
    const p = (typeof DB !== 'undefined') ? DB.getProductLotById(productLotId) : null;
    if (!p) throw new Error('제품 LOT 을 찾을 수 없습니다.');
    if (lotsOfRef('PRODUCT_LOT', productLotId).length) throw new Error('이미 검사로트가 생성된 제품 LOT 입니다.');
    const code = p.productCode || p.materialCode || '';
    const setup = getSetup(code);
    return addLot({
      factory: p.factory, origin: 'P04', refType: 'PRODUCT_LOT', refId: p.id,
      materialCode: code, materialName: p.productName || p.materialName || '',
      batchNo: p.lotNo || p.lotNumber || p.id,
      qty: num(p.qty) || num(p.weight),
      expiryDate: p.expiryDate || '',
      nextInspectDate: setup && setup.recurringDays > 0 ? addDays(todayStr(), setup.recurringDays) : '',
      createdBy: by || '',
    });
  };

  // ============================================================
  // 가용성 조회 — 출고·투입 화면이 "이거 써도 되나"를 묻는 창구
  // ============================================================
  const availability = (materialCode, factory) => {
    const rows = getStockBy(factory).filter(s => s.materialCode === String(materialCode));
    const sum = (k) => rows.reduce((a, r) => a + num(r[k]), 0);
    return {
      rows,
      qi: sum('qi'), unrestricted: sum('unrestricted'), blocked: sum('blocked'),
      returned: sum('returned'), scrapped: sum('scrapped'),
      usable: sum('unrestricted'),
      held: sum('qi') + sum('blocked'),
    };
  };
  const isUsable = (materialCode, factory, qty) => availability(materialCode, factory).usable >= num(qty);

  const summary = (factory) => {
    const rows = getStockBy(factory);
    const lots = getLotsBy(factory);
    const sum = (k) => rows.reduce((a, r) => a + num(r[k]), 0);
    return {
      qi: sum('qi'), unrestricted: sum('unrestricted'), blocked: sum('blocked'),
      returned: sum('returned'), scrapped: sum('scrapped'),
      openLots: lots.filter(l => l.status !== 'UD_DONE' && l.status !== 'CANCELLED').length,
      awaitingUD: lots.filter(l => l.status === 'RESULTED').length,
      failLots: lots.filter(l => l.verdict === 'FAIL' && l.status !== 'UD_DONE').length,
      dueRecurring: dueForRecurring(factory).length,
      pendingRecv: pendingReceivings(factory).length,
      pendingProd: pendingProductLots(factory).length,
    };
  };

  // ============================================================
  // 시드 — 화면이 비어 있지 않게 최소 예시만
  // ============================================================
  const initSampleData = () => {
    if (localStorage.getItem(SEED_KEY) === SEED_VERSION) return;
    localStorage.setItem(SEED_KEY, SEED_VERSION);
    if (getSetups().length) return;
    // 검사설정 예시 — 반복검사 주기가 있는 자재만 몇 건
    [
      { materialCode: '4401000', materialName: '옥수수',   onReceive: true, onProduce: false, recurringDays: 180, sampleQty: '500g', note: '수분·이물 중점' },
      { materialCode: '4402001', materialName: '대두박',   onReceive: true, onProduce: false, recurringDays: 180, sampleQty: '500g', note: '' },
      { materialCode: '4403001', materialName: '어분',     onReceive: true, onProduce: false, recurringDays: 90,  sampleQty: '300g', note: 'VBN·산가 확인' },
    ].forEach(saveSetup);
  };

  return {
    ORIGINS, LOT_STATUS, VERDICTS, UD_CODES, DISPOSAL,
    meta, todayStr, addDays,
    // 검사설정
    getSetups, getSetup, setupOf, saveSetup, removeSetup,
    // 검사로트
    getLots, getLotById, getLotsBy, openLots, lotsOfRef,
    addLot, updateLot, removeLot, sampleLot, startTest,
    saveResults, judgeValue, autoVerdict, decideUsage,
    // 품질재고
    getStock, getStockBy, findStock, moveStock, patchStockMeta, disposeBlocked,
    // 반복검사
    dueForRecurring, runRecurringTrigger,
    // 연결
    pendingReceivings, createLotFromReceiving, pendingProductLots, createLotFromProductLot,
    // 조회
    availability, isUsable, summary, initSampleData,
  };
})();
