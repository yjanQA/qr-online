// ============================================================
// lab_species_db.js — 축종별 전용 품질관리 데이터·계산 레이어
//   · 양축: 옥수수 BCFM 등급평가 / 제품 입자도(Dgw·Sgw, ASABE S319)
//   · 양어: 부상침강·흡수율·붕괴율·밀도·직경/길이 물리검사
//   · 반려: 방향성(↑↓) 등록성분 합부판정 · SIZE/용적중 · 정확도% · 컴플레인
//   계산식은 우성사료 논산공장 실측 엑셀 수식을 1:1 재현(배합비팀 전달용).
//   공장별 분리(factory) 필수 — App.getFactory() 연동.
// ============================================================

const LabSpeciesDB = (() => {
  // ----- 저장 유틸 (lab_db 패턴 동일) -----
  const get    = (key)      => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) { return []; } };
  const getObj = (key, def) => { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; };
  const notifyWrite = (key) => { try { if (typeof window !== 'undefined' && window.__onDbWrite) window.__onDbWrite(key); } catch (_) {} };
  const set    = (key, data) => { localStorage.setItem(key, JSON.stringify(data)); notifyWrite(key); };
  const now    = () => new Date().toISOString();
  const today  = () => new Date().toISOString().slice(0, 10);
  const uuid   = (p) => (p || 'SP') + '-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
  const num    = (v) => { if (v === '' || v == null) return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

  // 공장 스코프: 현재 필터가 'ALL'이면 전체, 아니면 해당 공장.  신규 등록 기본공장.
  const curFactory = () => { try { return (typeof App !== 'undefined' && App.getFactory && App.getFactory()) || 'ALL'; } catch (_) { return 'ALL'; } };
  const defFactory = () => { const f = curFactory(); return (f && f !== 'ALL') ? f : 'NS'; };
  const scoped = (list, factory) => {
    const f = factory !== undefined ? factory : curFactory();
    if (!f || f === 'ALL') return list;
    return list.filter(r => (r.factory || 'NS') === f);
  };
  const byDateDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id).localeCompare(String(a.id));

  // ============================================================
  // 1) 옥수수 BCFM 등급평가 (양축)
  // ============================================================
  const CORN_KEY = 'lab_corn';

  // BCFM(%) = (FM2 + BC + FM1) / (CleanedCorn + FM2 + BC + FM1) × 100  (엑셀 N열)
  const bcfmFromWeights = (w) => {
    const cleaned = num(w.cleaned) || 0, fm2 = num(w.fm2) || 0, bc = num(w.bc) || 0, fm1 = num(w.fm1) || 0;
    const total = cleaned + fm2 + bc + fm1;
    if (total <= 0) return { total: 0, bcfm: null, cleanedPct: null, bcPct: null, fm1Pct: null, fm2Pct: null };
    const pct = (x) => x / total * 100;
    return {
      total,
      cleanedPct: pct(cleaned), fm2Pct: pct(fm2), bcPct: pct(bc), fm1Pct: pct(fm1),
      bcfm: pct(fm2) + pct(bc) + pct(fm1),   // = FM2% + BC% + FM1%
    };
  };

  // 항목별 점수 (엑셀 BCFM 결과 IF식과 1:1)
  const densityScore = (d) => d == null ? null : (d >= 750 ? 4 : d >= 720 ? 3 : d >= 690 ? 2 : 1);
  const bcfmScore    = (b) => b == null ? null : (b <= 1 ? 4 : b <= 2 ? 3 : b <= 4 ? 2 : 1);
  const normalScore  = (n) => n == null ? null : (n >= 80 ? 4 : n >= 75 ? 3 : n >= 70 ? 2 : 1);
  const totalGrade   = (t) => t == null ? null : (t >= 10 ? '1' : t >= 8 ? '2' : t >= 6 ? '3' : '4');
  const GRADE_META = {
    '1': { label: '1등급', tone: 'ok',   desc: 'Excellent~Good' },
    '2': { label: '2등급', tone: 'ok',   desc: 'Good~Normal' },
    '3': { label: '3등급', tone: 'low',  desc: 'Normal~Bad' },
    '4': { label: '4등급', tone: 'high', desc: 'Bad' },
  };

  // 종합 평가: density/bcfm/normal → 점수·총점·등급
  const cornEvaluate = (v) => {
    const d = num(v.density), b = num(v.bcfm), n = num(v.normalPct);
    const ds = densityScore(d), bs = bcfmScore(b), ns = normalScore(n);
    const scores = [ds, bs, ns];
    const total = scores.every(s => s != null) ? scores.reduce((a, c) => a + c, 0) : null;
    const grade = totalGrade(total);
    return { densityScore: ds, bcfmScore: bs, normalScore: ns, total, grade, gradeMeta: GRADE_META[grade] || null };
  };

  const getCorns   = (factory) => scoped(get(CORN_KEY), factory).slice().sort(byDateDesc);
  const getCorn    = (id) => get(CORN_KEY).find(r => r.id === id) || null;
  const saveCorn   = (rec) => {
    const list = get(CORN_KEY);
    const id = rec.id || uuid('CORN');
    const clean = {
      id, factory: rec.factory || defFactory(),
      date: rec.date || today(), by: rec.by || '',
      vessel: rec.vessel || '', origin: rec.origin || '', allocQty: num(rec.allocQty),
      inDate: rec.inDate || '', arrivalNo: rec.arrivalNo || '',
      density: num(rec.density), bcfm: num(rec.bcfm), normalPct: num(rec.normalPct),
      onSize: num(rec.onSize), note: rec.note || '',
      weights: rec.weights || null,   // {cleaned,fm2,bc,fm1} 원시 정선 무게(선택)
      createdAt: rec.createdAt || now(), updatedAt: now(),
    };
    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) list[idx] = { ...list[idx], ...clean }; else list.push(clean);
    set(CORN_KEY, list);
    return clean;
  };
  const deleteCorn = (id) => set(CORN_KEY, get(CORN_KEY).filter(r => r.id !== id));

  // ============================================================
  // 2) 입자도 분석 Dgw / Sgw (양축, ASABE S319)
  // ============================================================
  const PSA_KEY  = 'lab_psa';
  const PSASET_KEY = 'lab_psa_sets';
  const PSASET_VER = '2026-07-06-v1';
  const PSASET_VER_KEY = 'lab_psa_sets_ver';   // 시드 버전은 기기별 — 동기화 대상이 아니다

  // 체 세트 시드 — 엑셀 양식(#1~#6) 체구경(micron) 그대로.  sieves는 大→小, 마지막 Pan.
  const PSA_SEED_SETS = [
    { id: 'set1', name: '양식 #1 (사료용)', sieves: [
      { name: '#4', d: 4750 }, { name: '#14', d: 1400 }, { name: '#16', d: 1180 }, { name: '#18', d: 1000 },
      { name: '#20', d: 850 }, { name: '#25', d: 710 }, { name: '#30', d: 600 }, { name: '#35', d: 600 },
      { name: '#40', d: 425 }, { name: '#45', d: 355 }, { name: 'Pan', d: 37 } ] },
    { id: 'set2', name: '양식 #2', sieves: [
      { name: '#4', d: 4750 }, { name: '#7', d: 2800 }, { name: '#8', d: 2360 }, { name: '#12', d: 1700 },
      { name: '#14', d: 1400 }, { name: '#16', d: 1180 }, { name: '#20', d: 850 }, { name: '#25', d: 710 },
      { name: '#30', d: 600 }, { name: '#40', d: 425 }, { name: 'Pan', d: 37 } ] },
    { id: 'set3', name: '양식 #3', sieves: [
      { name: '#4', d: 4750 }, { name: '#6', d: 3350 }, { name: '#7', d: 2800 }, { name: '#8', d: 2360 },
      { name: '#10', d: 2000 }, { name: '#14', d: 1400 }, { name: '#16', d: 1180 }, { name: '#20', d: 850 },
      { name: '#30', d: 600 }, { name: '#40', d: 425 }, { name: 'Pan', d: 37 } ] },
    { id: 'set4', name: '양식 #4', sieves: [
      { name: '#4', d: 4750 }, { name: '#6', d: 3350 }, { name: '#7', d: 2800 }, { name: '#8', d: 2360 },
      { name: '#10', d: 2000 }, { name: '#12', d: 1700 }, { name: '#14', d: 1400 }, { name: '#16', d: 1180 },
      { name: '#20', d: 850 }, { name: '#30', d: 600 }, { name: 'Pan', d: 37 } ] },
    { id: 'set5', name: '양식 #5', sieves: [
      { name: '#4', d: 4750 }, { name: '#6', d: 3350 }, { name: '#7', d: 2800 }, { name: '#8', d: 2360 },
      { name: '#10', d: 2000 }, { name: '#12', d: 1700 }, { name: '#14', d: 1400 }, { name: '#16', d: 1180 },
      { name: '#20', d: 850 }, { name: '#25', d: 710 }, { name: 'Pan', d: 37 } ] },
    { id: 'set6', name: '양식 #6 (미분용)', sieves: [
      { name: '#4', d: 4750 }, { name: '#10', d: 2000 }, { name: '#14', d: 1400 }, { name: '#16', d: 1180 },
      { name: '#18', d: 1000 }, { name: '#20', d: 850 }, { name: '#25', d: 710 }, { name: '#30', d: 600 },
      { name: '#35', d: 600 }, { name: '#40', d: 425 }, { name: 'Pan', d: 37 } ] },
  ];
  // 체 세트는 배열로 저장한다. 예전에는 { _ver, sets:[] } 객체였는데 그 모양이면
  // 동기화 계층이 레코드 배열로 다루지 못해 단말 간에 공유되지 않는다(버전은 기기별로만 둔다).
  const seedPsaSets = () => {
    let cur = getObj(PSASET_KEY, null);
    if (cur && !Array.isArray(cur) && Array.isArray(cur.sets)) {  // 구 형식 1회 이관
      cur = cur.sets;
      set(PSASET_KEY, cur);
    }
    if (window.Sync && Sync.serverHas && Sync.serverHas(PSASET_KEY)) {
      try { localStorage.setItem(PSASET_VER_KEY, PSASET_VER); } catch (_) {}
      return;
    }
    if (Array.isArray(cur) && cur.length && localStorage.getItem(PSASET_VER_KEY) === PSASET_VER) return;
    // 사용자가 추가한 커스텀 세트는 보존
    const custom = Array.isArray(cur) ? cur.filter(s => s && s.custom) : [];
    set(PSASET_KEY, PSA_SEED_SETS.concat(custom));
    try { localStorage.setItem(PSASET_VER_KEY, PSASET_VER); } catch (_) {}
  };
  const getPsaSets = () => { seedPsaSets(); const v = getObj(PSASET_KEY, []); return Array.isArray(v) ? v : (v.sets || []); };
  const getPsaSet  = (id) => getPsaSets().find(s => s.id === id) || null;

  // 입자도 계산 (엑셀 양식 수식 재현)
  //   · log dᵢ = LOG10( √(dᵢ₋₁ × dᵢ) )   [최상단 체는 상단 구경 기준으로만 사용, 합계서 제외]
  //   · logDgw = Σ(Wi·log dᵢ) / ΣWi ,  Dgw = 10^logDgw (micron)
  //   · Sgw = 10^√( Σ Wi(log dᵢ − logDgw)² / ΣWi )
  const psaCompute = (sieves, weights) => {
    // sieves: [{name,d}...] 大→小(마지막 Pan).  weights: {name: grams}
    const rows = [];
    let totalWi = 0;
    // 최상단(index 0)은 상단 구경 참조용 — 합계·가중합서 제외 (엑셀 P5=SUM(F5:O5))
    for (let i = 1; i < sieves.length; i++) {
      const upper = sieves[i - 1].d, cur = sieves[i].d;
      const wi = num(weights[sieves[i].name]) || 0;
      const logDi = Math.log10(Math.sqrt(upper * cur));
      totalWi += wi;
      rows.push({ name: sieves[i].name, d: cur, wi, logDi });
    }
    const topWi = num(weights[sieves[0].name]) || 0;   // 오버사이즈(#4) — 기록용
    if (totalWi <= 0) {
      return { valid: false, totalWi, topWi, rows: rows.map(r => ({ ...r, pct: null, cumPassing: null })), Dgw: null, DgwMm: null, Sgw: null };
    }
    const sumWiLog = rows.reduce((a, r) => a + r.wi * r.logDi, 0);
    const logDgw = sumWiLog / totalWi;
    const Dgw = Math.pow(10, logDgw);                    // micron
    const sumWiDev2 = rows.reduce((a, r) => a + r.wi * Math.pow(r.logDi - logDgw, 2), 0);
    const Sgw = Math.pow(10, Math.sqrt(sumWiDev2 / totalWi));
    // 누적 통과율(% less) 및 잔류%
    let cumRet = 0;
    const outRows = rows.map(r => {
      const pct = r.wi / totalWi * 100; cumRet += pct;
      return { ...r, pct, cumPassing: 100 - cumRet };
    });
    // 참고: ASABE 입자수/표면적 (밀도 ρ=1, 형상계수 1.4 — 엑셀 M13/P13)
    let particles = null, surface = null;
    try {
      const lnS = Math.log(Sgw);
      particles = (1 / (1 * 1.4)) * Math.exp(4.5 * lnS * lnS - 3 * Math.log(Dgw / 10000));
      surface = Math.pow(6 / (1 * 1.4), (0.5 * lnS * lnS - Math.log(Dgw / 10000)));
    } catch (_) {}
    return {
      valid: true, totalWi, topWi, rows: outRows,
      logDgw, Dgw, DgwMm: Dgw / 1000, Sgw, particles, surface,
    };
  };

  const getPSAs  = (factory) => scoped(get(PSA_KEY), factory).slice().sort(byDateDesc);
  const getPSA   = (id) => get(PSA_KEY).find(r => r.id === id) || null;
  const savePSA  = (rec) => {
    const list = get(PSA_KEY);
    const id = rec.id || uuid('PSA');
    const clean = {
      id, factory: rec.factory || defFactory(),
      date: rec.date || today(), by: rec.by || '',
      product: rec.product || '', productCode: rec.productCode || '', prodDate: rec.prodDate || '',
      setId: rec.setId || '', volWeight: num(rec.volWeight), note: rec.note || '',
      weights: rec.weights || {},
      createdAt: rec.createdAt || now(), updatedAt: now(),
    };
    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) list[idx] = { ...list[idx], ...clean }; else list.push(clean);
    set(PSA_KEY, list);
    return clean;
  };
  const deletePSA = (id) => set(PSA_KEY, get(PSA_KEY).filter(r => r.id !== id));

  // ============================================================
  // 3) 양어 물리검사 (부상침강/새우)
  // ============================================================
  const AQUA_KEY = 'lab_aqua';
  const AQUA_TYPES = ['부상침강사료', '새우사료'];

  // 규격 대조: 값이 [min,max] 범위/오차(±) 안이면 적합
  const inRange = (v, min, max) => (v == null || min == null || max == null) ? 'NA' : (v < min ? 'LOW' : v > max ? 'HIGH' : 'OK');

  const aquaJudge = (rec, spec) => {
    // spec: {diaMin,diaMax,lenMin,lenMax,volMin,volMax}
    const out = {};
    if (spec) {
      out.dia = inRange(num(rec.diaAvg), spec.diaMin, spec.diaMax);
      out.len = inRange(num(rec.lenAvg), spec.lenMin, spec.lenMax);
      out.vol = inRange(num(rec.volWeight), spec.volMin, spec.volMax);
    }
    const flags = Object.values(out).filter(x => x && x !== 'NA' && x !== 'OK');
    out.overall = flags.length ? 'FAIL' : (Object.values(out).some(x => x === 'OK') ? 'PASS' : 'NA');
    return out;
  };

  const getAquas = (factory) => scoped(get(AQUA_KEY), factory).slice().sort(byDateDesc);
  const getAqua  = (id) => get(AQUA_KEY).find(r => r.id === id) || null;
  const saveAqua = (rec) => {
    const list = get(AQUA_KEY);
    const id = rec.id || uuid('AQUA');
    const clean = {
      id, factory: rec.factory || defFactory(),
      date: rec.date || today(), by: rec.by || '',
      atype: rec.atype || AQUA_TYPES[0],
      sample: rec.sample || '', productCode: rec.productCode || '', prodDate: rec.prodDate || '',
      ext: rec.ext || '', floatSink: num(rec.floatSink), volWeight: num(rec.volWeight),
      diaAvg: num(rec.diaAvg), lenAvg: num(rec.lenAvg), weight: num(rec.weight), density: num(rec.density),
      // 흡수율(부상침강) 또는 붕괴율(새우) 시간별 %  {t: value}
      absorption: rec.absorption || null,     // {'1분':n,'5분':n,'30분':n}
      disintegration: rec.disintegration || null, // {'30분':n,'60분':n,'120분':n, cracks:n}
      spec: rec.spec || {},                    // {diaMin,diaMax,lenMin,lenMax,volMin,volMax}
      note: rec.note || '',
      createdAt: rec.createdAt || now(), updatedAt: now(),
    };
    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) list[idx] = { ...list[idx], ...clean }; else list.push(clean);
    set(AQUA_KEY, list);
    return clean;
  };
  const deleteAqua = (id) => set(AQUA_KEY, get(AQUA_KEY).filter(r => r.id !== id));

  // ============================================================
  // 4) 반려 성분·SIZE (방향성 판정) + 컴플레인
  // ============================================================
  const PET_KEY = 'lab_pet';
  const PETC_KEY = 'lab_pet_complaint';

  // 방향성 항목: dir '↓'=상한(이하 합격) / '↑'=하한(이상 합격)
  const PET_COMPONENTS = [
    { key: 'moist',   label: '수분',   dir: '↓' },
    { key: 'protein', label: '조단백', dir: '↑' },
    { key: 'fat',     label: '조지방', dir: '↑' },
    { key: 'fiber',   label: '조섬유', dir: '↓' },
    { key: 'ash',     label: '조회분', dir: '↓' },
    { key: 'ca',      label: '칼슘',   dir: '↑' },
    { key: 'p',       label: '인',     dir: '↑' },
  ];
  // 방향성 판정: dir '↓'→ 분석치 ≤ 기준 적합 / '↑'→ 분석치 ≥ 기준 적합
  const petComponentJudge = (dir, val, spec) => {
    if (val == null || spec == null) return 'NA';
    if (dir === '↓') return val <= spec ? 'OK' : 'HIGH';
    return val >= spec ? 'OK' : 'LOW';
  };
  const petEvaluate = (rec) => {
    const vals = rec.vals || {}, specs = rec.specs || {};
    const items = PET_COMPONENTS.map(c => {
      const v = num(vals[c.key]), s = num(specs[c.key]);
      const verdict = petComponentJudge(c.dir, v, s);
      const accuracy = (v != null && s != null && s !== 0) ? (v / s * 100) : null;
      return { ...c, val: v, spec: s, verdict, accuracy };
    });
    // SIZE(직경/길이) 범위 + 용적중 범위
    const size = {
      dia: inRange(num(vals.dia), num(specs.diaMin), num(specs.diaMax)),
      len: inRange(num(vals.len), num(specs.lenMin), num(specs.lenMax)),
      vol: inRange(num(vals.vol), num(specs.volMin), num(specs.volMax)),
    };
    const bad = items.filter(i => i.verdict !== 'OK' && i.verdict !== 'NA')
      .concat(Object.values(size).filter(x => x !== 'OK' && x !== 'NA'));
    return { items, size, overall: bad.length ? 'FAIL' : (items.some(i => i.verdict === 'OK') ? 'PASS' : 'NA') };
  };

  const getPets = (factory) => scoped(get(PET_KEY), factory).slice().sort(byDateDesc);
  const getPet  = (id) => get(PET_KEY).find(r => r.id === id) || null;
  const savePet = (rec) => {
    const list = get(PET_KEY);
    const id = rec.id || uuid('PET');
    const clean = {
      id, factory: rec.factory || defFactory(),
      date: rec.date || today(), by: rec.by || '',
      brand: rec.brand || '', formula: rec.formula || '', productCode: rec.productCode || '', product: rec.product || '',
      prodDate: rec.prodDate || '',
      vals: rec.vals || {},     // {moist,protein,...,dia,len,vol}
      specs: rec.specs || {},   // {moist,...,diaMin,diaMax,lenMin,lenMax,volMin,volMax}
      note: rec.note || '',
      createdAt: rec.createdAt || now(), updatedAt: now(),
    };
    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) list[idx] = { ...list[idx], ...clean }; else list.push(clean);
    set(PET_KEY, list);
    return clean;
  };
  const deletePet = (id) => set(PET_KEY, get(PET_KEY).filter(r => r.id !== id));

  // 컴플레인
  const COMPLAINT_TYPES = ['가루', '건강', '곰팡이', '냄새', '덩어리', '분변', '외관', '이물질', '포장', '품질', '기타'];
  const getComplaints = (factory) => scoped(get(PETC_KEY), factory).slice()
    .sort((a, b) => String(b.recvDate || '').localeCompare(String(a.recvDate || '')));
  const getComplaint  = (id) => get(PETC_KEY).find(r => r.id === id) || null;
  const saveComplaint = (rec) => {
    const list = get(PETC_KEY);
    const id = rec.id || uuid('VOC');
    const clean = {
      id, factory: rec.factory || defFactory(),
      recvDate: rec.recvDate || today(), prodDate: rec.prodDate || '',
      channel: rec.channel || 'Oral', brand: rec.brand || '', productCode: rec.productCode || '', product: rec.product || '',
      ctype: rec.ctype || '기타', detail: rec.detail || '', action: rec.action || '', replyDate: rec.replyDate || '',
      createdAt: rec.createdAt || now(), updatedAt: now(),
    };
    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) list[idx] = { ...list[idx], ...clean }; else list.push(clean);
    set(PETC_KEY, list);
    return clean;
  };
  const deleteComplaint = (id) => set(PETC_KEY, get(PETC_KEY).filter(r => r.id !== id));
  // 유형별·월별 집계
  const complaintStats = (factory, year) => {
    const list = getComplaints(factory).filter(c => !year || String(c.recvDate || '').slice(0, 4) === String(year));
    const byType = {}, byMonth = {};
    COMPLAINT_TYPES.forEach(t => byType[t] = 0);
    for (let m = 1; m <= 12; m++) byMonth[m] = 0;
    list.forEach(c => {
      byType[c.ctype] = (byType[c.ctype] || 0) + 1;
      const mm = parseInt(String(c.recvDate || '').slice(5, 7), 10);
      if (mm >= 1 && mm <= 12) byMonth[mm] += 1;
    });
    return { total: list.length, byType, byMonth };
  };

  // ── VOC(고객 클레임) 축종별 집계 ──
  //   VOC(DB.getVOCs)를 제품코드→축종(LabDB.productCategory)으로 매핑해 축종별 건수/유형/월별 집계.
  //   반환 형태는 complaintStats와 동일(total/byType/byMonth) → 축종 리포트에서 그대로 재사용.
  const VOC_CTYPES = ['품질이상', '이물혼입', '규격불일치', '이취/변질', '기타'];
  const vocSpeciesOf = (v) => {
    try {
      if (typeof LabDB !== 'undefined' && LabDB.productCategory) return LabDB.productCategory(v.productCode || v.fgLotNo || '');
    } catch (_) {}
    return '양축';  // 앱 공통: 미매핑 제품은 양축 기본
  };
  const vocComplaintStats = (species, year) => {
    const vocs = (typeof DB !== 'undefined' && DB.getVOCs) ? DB.getVOCs() : [];
    const byType = {}, byMonth = {};
    VOC_CTYPES.forEach(t => byType[t] = 0);
    for (let m = 1; m <= 12; m++) byMonth[m] = 0;
    let total = 0;
    vocs.forEach(v => {
      if (species && species !== 'ALL' && vocSpeciesOf(v) !== species) return;
      const ymd = String(v.registeredAt || '').slice(0, 10);
      if (year && ymd.slice(0, 4) !== String(year)) return;
      total++;
      const t = VOC_CTYPES.includes(v.category) ? v.category : '기타';
      byType[t] = (byType[t] || 0) + 1;
      const mm = parseInt(ymd.slice(5, 7), 10);
      if (mm >= 1 && mm <= 12) byMonth[mm] += 1;
    });
    return { total, byType, byMonth };
  };

  // ----- 동기화 키 (sync.js에서 참조) -----
  const SYNC_KEYS = [CORN_KEY, PSA_KEY, PSASET_KEY, AQUA_KEY, PET_KEY, PETC_KEY];

  return {
    // 옥수수
    bcfmFromWeights, cornEvaluate, GRADE_META,
    getCorns, getCorn, saveCorn, deleteCorn,
    // 입자도
    getPsaSets, getPsaSet, psaCompute, getPSAs, getPSA, savePSA, deletePSA,
    // 양어
    AQUA_TYPES, aquaJudge, getAquas, getAqua, saveAqua, deleteAqua,
    // 반려
    PET_COMPONENTS, petEvaluate, getPets, getPet, savePet, deletePet,
    COMPLAINT_TYPES, getComplaints, getComplaint, saveComplaint, deleteComplaint, complaintStats,
    VOC_CTYPES, vocComplaintStats, vocSpeciesOf,
    // 기타
    SYNC_KEYS, curFactory, defFactory,
  };
})();

if (typeof window !== 'undefined') window.LabSpeciesDB = LabSpeciesDB;
