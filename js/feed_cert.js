// ============================================================
// feed_cert.js — 사료성분등록증(배합사료 성분표) 발행
//   양식 출처: 사료성분등록증(예시).pdf  (문서번호 WSE-SP-100)
//
//   제품코드에 자동 연동된다. 대부분의 칸은 이미 있는 데이터에서 끌어온다.
//     · 상품명            ← 제품 마스터(DB.getProductByCode)
//     · 사료의 명칭·용도  ← 사료성분 등록내역(LabDB.getRegSpec)
//     · 성분등록번호(논산) ← 등록내역의 reg
//     · 등록성분량        ← 등록내역의 specs(min→이상 / max→이하)
//   회사 공통 문구(주의사항·보관방법·주소·고객센터 등)는 보일러플레이트로 둔다.
//   제품·항목마다 다른 값은 오버라이드(feed_certs)에만 저장한다 — 그래서 제품이
//   새로 추가되면 그 코드로 등록증이 바로 만들어지고(자동 연동), 고친 칸만 남는다.
//
//   출고 화면·제품재고에서 [성분등록증]으로 열어 인쇄하면 제품과 함께 나간다.
// ============================================================

const FeedCert = (() => {
  const STORE_KEY  = 'feed_certs';        // 제품별 오버라이드(id=제품코드)
  const BOILER_KEY = 'feed_cert_boiler';  // 회사 공통 문구(1건)

  const get = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch (_) { return []; } };
  const set = (arr) => { localStorage.setItem(STORE_KEY, JSON.stringify(arr)); notify(STORE_KEY); };
  const notify = (k) => { try { if (window.__onDbWrite) window.__onDbWrite(k); } catch (_) {} };
  const now = () => new Date().toISOString();
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ── 회사 공통 문구(양식 그대로가 기본값) ──
  const DEFAULT_BOILER = {
    docNo: 'WSE-SP-100',
    company: '우성사료',
    factories: {
      NS: { name: '논산공장', addr: '충남 논산시 은진면 안심로 259-3' },
      GS: { name: '경산공장', addr: '경북 경산시 진량읍 일연로 599' },
      AS: { name: '아산공장', addr: '충남 아산시 둔포면 봉신로 278-39' },
    },
    ingredients: '곡류, 강피류, 박류, 당밀, 석회석분말, 식염, 중조, 규산염제, 아미노산발효부산물, 생균제, 보존제, 황산칼슘, 비타민제 합제(A,D3), 혼합광물질류 합제(철,망간,아연)',
    gmo: '유전자 변형 옥수수, 대두박 포함 사료',
    cautions: [
      '본 제품은 표기된 사료의 명칭 및 용도 외 타가축에 급여하지 마십시오.',
      '유통 또는 사용 중 취급 부주의로 변질이 발생할 수 있으니 급여 전에 반드시 확인하여 주십시오.',
    ],
    storage: [
      '서늘하고 습기가 차지 않는 곳에 보관하십시오.',
      '사료 교체 시에는 2주에 걸쳐 서서히 교체하여 주십시오.',
      '기타 주의사항 및 사용방법은 공장 품질경영부에 문의하십시오.',
    ],
    netWeight: '계근량 참조',
    shelfDays: 30,
    mfgDate: '별도표기',
    repack: '해당사항 없음',
    center: '우성 런투유(Run to you) 서비스',
    tel: '1577-1782',
    footer: [
      '초식동물에게는 풀사료 급여를 늘려야 합니다.',
      '유통과정에서 훼손되거나 변질된 제품은 판매대리점 혹은 공장에서 교환하여 드립니다.',
    ],
  };
  // 보일러플레이트는 1건이지만 동기화 계층이 레코드 배열만 다루므로 [{id:'default',...}] 로 저장한다.
  const getBoiler = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(BOILER_KEY));
      const rec = Array.isArray(raw) ? raw.find(x => x && x.id === 'default') : raw;   // 구 객체형도 흡수
      if (rec && typeof rec === 'object') return { ...DEFAULT_BOILER, ...rec };
    } catch (_) {}
    return { ...DEFAULT_BOILER };
  };
  const saveBoiler = (patch) => {
    const next = { ...getBoiler(), ...patch, id: 'default' };
    localStorage.setItem(BOILER_KEY, JSON.stringify([next]));
    notify(BOILER_KEY);
  };

  // ── 등록성분: 등록내역 specs → 등록증 행 ──
  //   min → '이상', max → '이하'. 양식 표기 순서에 맞춰 정렬한다.
  const NUTRIENT_LABEL = {
    moist: '수분', protein: '조단백질', protein_n: '조단백질', fat: '조지방', fiber: '조섬유',
    ash: '조회분', ca: '칼슘', p: '인', tdn: '가소화영양소총량(TDN)', nfe: '가용무질소물',
    salt: '염분', lys: '리신', met: '메티오닌',
  };
  const NUTRIENT_ORDER = ['moist', 'protein', 'protein_n', 'fat', 'fiber', 'ash', 'ca', 'p', 'tdn', 'nfe', 'salt', 'lys', 'met'];
  const nutrientLabel = (key) => NUTRIENT_LABEL[key] || (typeof LabDB !== 'undefined' && LabDB.itemLabel ? LabDB.itemLabel(key) : key);

  // 등록내역 형태 표기 정리 — 줄바꿈/콤마로 나열된 여러 형태를 '가루·펠릿·크럼블' 로 다듬는다
  const cleanForm = (s) => {
    if (!s) return '';
    return String(s).split(/[\n,]/).map(x => x.trim()).filter(Boolean).join('·');
  };

  const regNutrients = (reg) => {
    if (!reg || !reg.specs) return [];
    const keys = Object.keys(reg.specs);
    keys.sort((a, b) => {
      const ia = NUTRIENT_ORDER.indexOf(a), ib = NUTRIENT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const out = [];
    keys.forEach(k => {
      const sp = reg.specs[k] || {};
      if (sp.min != null) out.push({ name: nutrientLabel(k), value: sp.min, dir: '이상' });
      if (sp.max != null) out.push({ name: nutrientLabel(k), value: sp.max, dir: '이하' });
    });
    return out;
  };

  // ── 자동 데이터 + 오버라이드 병합(해석) ──
  //   화면·인쇄가 쓰는 최종 등록증 객체. 오버라이드가 있으면 그 값이, 없으면 자동값이 들어간다.
  const resolve = (code) => {
    const c = String(code || '').trim();
    const p = (typeof DB !== 'undefined' && DB.getProductByCode) ? DB.getProductByCode(c) : null;
    const reg = (typeof LabDB !== 'undefined' && LabDB.getRegSpec) ? LabDB.getRegSpec(c) : null;
    const ov = get().find(x => x.id === c) || {};
    const b = getBoiler();
    const pick = (a, fb) => (a != null && a !== '') ? a : fb;
    return {
      code: c,
      productName: p ? p.name : (ov.productName || ''),
      formulaCode: p ? p.formulaCode : '',
      // 성분등록번호 — 세 공장 모두 등록내역에서 자동, 오버라이드가 있으면 우선
      regNo: {
        NS: pick(ov.regNoNS, reg ? (reg.ns || reg.reg || '') : ''),
        GS: pick(ov.regNoGS, reg ? (reg.gs || '') : ''),
        AS: pick(ov.regNoAS, reg ? (reg.as || '') : ''),
      },
      species: ov.species || '',   // 직접 지정한 축종(없으면 목록 화면이 등록내역·배합비·제품명으로 판단)
      feedName: pick(ov.feedName, reg && reg.label ? reg.label : (p ? p.name : '')),
      form: pick(ov.form, cleanForm(reg ? reg.form : '')),   // 가루 / 펠릿 / 크럼블
      use: pick(ov.use, reg ? reg.use : ''),
      nutrients: (ov.nutrients && ov.nutrients.length) ? ov.nutrients : regNutrients(reg),
      ingredients: pick(ov.ingredients, b.ingredients),
      gmo: pick(ov.gmo, b.gmo),
      drugs: Array.isArray(ov.drugs) ? ov.drugs : [],   // [{name, amount, purpose, withdrawal}]
      netWeight: pick(ov.netWeight, b.netWeight),
      shelfDays: pick(ov.shelfDays, b.shelfDays),
      mfgDate: pick(ov.mfgDate, b.mfgDate),
      repack: pick(ov.repack, b.repack),
      bagSize: pick(ov.bagSize, ''),
      bagMaterial: pick(ov.bagMaterial, ''),
      officialDocs: Array.isArray(ov.officialDocs) ? ov.officialDocs : [],   // 도청 발행 실제 등록증(첨부 원본)
      history: Array.isArray(ov.history) ? ov.history : [],
      docNo: pick(ov.docNo, b.docNo),
      rev: pick(ov.rev, ''),
      revDate: pick(ov.revDate, ''),
      note: ov.note || '',
      _boiler: b,
      // 실제 지정값이 하나라도 있는가(이력만 남은 레코드는 '편집됨'으로 보지 않는다)
      _hasOverride: OV_FIELDS.some(f => ov[f] != null && ov[f] !== '')
        || (Array.isArray(ov.nutrients) && ov.nutrients.length > 0),
      _hasDocs: Array.isArray(ov.officialDocs) && ov.officialDocs.length > 0,
      _reg: reg,
      _updatedAt: ov.updatedAt || '', _updatedBy: ov.updatedBy || '',
    };
  };
  // 오버라이드로 저장되는 폼 필드(이력/첨부/시각 제외) — _hasOverride 판정에 쓴다
  const OV_FIELDS = ['productName', 'regNoNS', 'regNoGS', 'regNoAS', 'species', 'feedName', 'form', 'use',
    'ingredients', 'gmo', 'netWeight', 'shelfDays', 'mfgDate', 'repack', 'bagSize', 'bagMaterial', 'docNo', 'rev', 'revDate', 'note'];

  // 빈 값은 저장하지 않는다(자동값으로 복귀). 지정한 칸만 남긴다.
  const clean = (v) => (v == null || v === '') ? null : v;
  const whoNow = () => { try { return (typeof Auth !== 'undefined' && Auth.currentName) ? (Auth.currentName() || '') : ''; } catch (_) { return ''; } };

  // 변경 이력 항목 — 누가·언제·무엇을 고쳤는지. history[] 에 누적한다(동기화 대상).
  const pushHistory = (rec, action, changes, by) => {
    if (!Array.isArray(rec.history)) rec.history = [];
    rec.history.push({ ts: now(), by: by != null ? by : whoNow(), action, changes: changes || [] });
    // 이력이 무한정 쌓이지 않게 최근 100건만 유지
    if (rec.history.length > 100) rec.history = rec.history.slice(-100);
  };
  // 저장 전 오버라이드 값(폼 필드)의 라벨
  const FIELD_LABELS = {
    productName: '상품명', regNoNS: '논산 등록번호', regNoGS: '경산 등록번호', regNoAS: '아산 등록번호', species: '축종',
    feedName: '사료의 명칭', form: '사료의 형태', use: '사료의 용도', shelfDays: '유통기간(일)',
    ingredients: '사용원료', gmo: 'GMO 표기', netWeight: '실중량', mfgDate: '제조년월일', repack: '재포장',
    bagSize: '지대크기', bagMaterial: '지대재질', docNo: '문서번호', rev: '개정번호', revDate: '개정일',
    note: '비고', nutrients: '등록성분량',
  };

  const saveOverride = (code, data) => {
    const c = String(code || '').trim();
    if (!c) return null;
    const all = get();
    const i = all.findIndex(x => x.id === c);
    const prev = i >= 0 ? all[i] : null;
    const rec = { id: c };
    const FIELDS = ['productName', 'regNoNS', 'regNoGS', 'regNoAS', 'species', 'feedName', 'form', 'use',
      'ingredients', 'gmo', 'netWeight', 'mfgDate', 'repack', 'bagSize', 'bagMaterial', 'docNo', 'rev', 'revDate', 'note'];
    FIELDS.forEach(f => { const v = clean(data[f]); if (v != null) rec[f] = v; });
    const sd = clean(data.shelfDays); if (sd != null && isFinite(Number(sd))) rec.shelfDays = Number(sd);
    if (Array.isArray(data.nutrients)) {
      const ns = data.nutrients.filter(n => n && n.name && n.value !== '' && n.value != null)
        .map(n => ({ name: String(n.name), value: n.value, dir: n.dir === '이하' ? '이하' : '이상' }));
      if (ns.length) rec.nutrients = ns;
    }
    if (Array.isArray(data.drugs)) {
      const ds = data.drugs.filter(d => d && d.name);
      if (ds.length) rec.drugs = ds;
    }
    // 첨부·이력은 폼 필드가 아니므로 기존 것을 이어받는다.
    const prevDocs = (prev && Array.isArray(prev.officialDocs)) ? prev.officialDocs : [];
    const docs = Array.isArray(data.officialDocs) ? data.officialDocs : prevDocs;
    if (docs.length) rec.officialDocs = docs;
    rec.history = (prev && Array.isArray(prev.history)) ? prev.history.slice() : [];

    // 무엇이 바뀌었는지 계산(첨부·이력·시각 제외)
    const norm = (r) => { const o = { ...r }; ['id', 'officialDocs', 'history', 'updatedAt', 'updatedBy'].forEach(k => delete o[k]); return o; };
    const a = norm(prev || {}), bnew = norm(rec);
    const keys = [...new Set([...Object.keys(a), ...Object.keys(bnew)])];
    const changes = [];
    keys.forEach(k => {
      const fromV = JSON.stringify(a[k] == null ? '' : a[k]);
      const toV = JSON.stringify(bnew[k] == null ? '' : bnew[k]);
      if (fromV !== toV) changes.push({ field: k, label: FIELD_LABELS[k] || k });
    });

    rec.updatedAt = now();
    rec.updatedBy = data.by != null ? data.by : whoNow();
    // 지정한 칸이 하나도 없으면 오버라이드를 지운다(자동값만 씀)
    const meaningful = Object.keys(rec).filter(k => !['id', 'updatedAt', 'updatedBy', 'history'].includes(k))
      .some(k => k === 'officialDocs' ? rec.officialDocs && rec.officialDocs.length : true);
    if (!meaningful) {
      if (i >= 0) { all.splice(i, 1); set(all); }
      return null;
    }
    if (changes.length) pushHistory(rec, prev ? '수정' : '작성', changes, rec.updatedBy);
    if (i >= 0) all[i] = rec; else all.push(rec);
    set(all);
    return rec;
  };
  const deleteOverride = (code) => {
    const c = String(code || '').trim();
    const all = get();
    const next = all.filter(x => x.id !== c);
    if (next.length !== all.length) set(next);
  };

  const historyOf = (code) => {
    const rec = get().find(x => x.id === String(code || '').trim());
    return (rec && Array.isArray(rec.history)) ? rec.history.slice().reverse() : [];
  };

  // 편집 해제 — 지정값·성분만 자동값으로 되돌리고 첨부·이력은 보존한다(감사 추적).
  const revertToAuto = (code) => {
    const c = String(code || '').trim();
    const all = get();
    const rec = all.find(x => x.id === c);
    if (!rec) return;
    OV_FIELDS.forEach(f => delete rec[f]);
    delete rec.nutrients; delete rec.drugs;
    rec.updatedAt = now(); rec.updatedBy = whoNow();
    pushHistory(rec, '자동값 복귀', [{ label: '지정값 전체 해제' }], rec.updatedBy);
    // 첨부도 이력도 없으면 레코드를 지운다
    if (!(Array.isArray(rec.officialDocs) && rec.officialDocs.length)) { set(all.filter(x => x.id !== c)); return; }
    set(all);
  };

  // ── 실제 등록증(도청 발행) 첨부 ── 공장별(fac)로 태그해 보관한다.
  //   PhotoStore.save 로 서버(data/files)에 올리고 레코드에는 메타만 남긴다(동기화 안전).
  const officialDocsOf = (code, fac) => {
    const rec = get().find(x => x.id === String(code || '').trim());
    const docs = (rec && Array.isArray(rec.officialDocs)) ? rec.officialDocs : [];
    if (!fac || fac === 'ALL') return docs;
    // 특정 공장: 그 공장 태그 + 공장 미지정(공통) 첨부
    return docs.filter(d => (d.fac || '') === fac || !d.fac);
  };
  const FAC_NAME = { NS: '논산', GS: '경산', AS: '아산' };
  const addOfficialDoc = (code, meta, fac) => {
    const c = String(code || '').trim();
    if (!c || !meta) return null;
    const all = get();
    let rec = all.find(x => x.id === c);
    if (!rec) { rec = { id: c, officialDocs: [] }; all.push(rec); }
    if (!Array.isArray(rec.officialDocs)) rec.officialDocs = [];
    if (fac && FAC_NAME[fac]) meta.fac = fac;
    rec.officialDocs.push(meta);
    rec.updatedAt = now(); rec.updatedBy = whoNow();
    pushHistory(rec, '첨부', [{ label: `${fac && FAC_NAME[fac] ? FAC_NAME[fac] + ' ' : ''}실제 등록증`, detail: meta.name }], rec.updatedBy);
    set(all);
    return meta;
  };
  const removeOfficialDoc = (code, docId) => {
    const c = String(code || '').trim();
    const all = get();
    const rec = all.find(x => x.id === c);
    if (!rec || !Array.isArray(rec.officialDocs)) return;
    const gone = rec.officialDocs.find(d => d && d.id === docId);
    rec.officialDocs = rec.officialDocs.filter(d => d && d.id !== docId);
    rec.updatedAt = now(); rec.updatedBy = whoNow();
    pushHistory(rec, '첨부삭제', [{ label: `${gone && gone.fac && FAC_NAME[gone.fac] ? FAC_NAME[gone.fac] + ' ' : ''}실제 등록증`, detail: gone ? gone.name : docId }], rec.updatedBy);
    // 첨부·이력만 남고 지정 내용이 없어도, 이력 보존을 위해 레코드는 지우지 않는다.
    set(all);
  };

  return {
    STORE_KEY, BOILER_KEY, FAC_NAME,
    resolve, getOverrides: get, saveOverride, deleteOverride, revertToAuto, historyOf,
    officialDocsOf, addOfficialDoc, removeOfficialDoc,
    getBoiler, saveBoiler, regNutrients, nutrientLabel,
  };
})();


// ============================================================
// FeedCertPage — 사료성분등록증 화면(목록·편집·인쇄)
// ============================================================
const FeedCertPage = (() => {
  let query = '';
  let speciesSel = 'ALL';   // 축종 필터
  const CAP = 120;
  const FACS = [['NS', '논산'], ['GS', '경산'], ['AS', '아산']];

  // ── 축종 ──
  //   1순위: 사료성분 등록내역의 축종(cat) — 법정 등록 기준이라 가장 정확하다(양계·양돈·한우·젖소·오리·말·메추리·염소·양축견·양어·반려)
  //   2순위: 제품 축종 구분(양어·반려 매핑)
  //   3순위: 제품명 단어. 그래도 모르면 '미분류'.
  const SPECIES_ORDER = ['양계', '양돈', '한우', '젖소', '오리', '메추리', '염소', '말', '양축견', '양어', '반려', '미분류'];
  const NAME_RULES = [
    ['양계', /산란|육계|종계|병아리|브로일러|육용|레이어|수탉|암탉|닭/],
    ['오리', /오리/],
    ['메추리', /메추리/],
    ['양돈', /양돈|자돈|모돈|돼지|포크|돈(?![가-힣]*까스)/],
    ['젖소', /젖소|착유|건유|낙농|유우|고능력우|육성우/],
    ['한우', /한우|송아지|비육우|번식우|거세|육우|큰소/],
    ['염소', /염소|산양/],
    ['말', /(^|[^가-힣])말([^가-힣]|$)|경주마|육성마/],
    ['양축견', /양축견|사역견/],
  ];
  //   같은 배합비 코드를 쓰는 제품은 축종이 같다 — 등록내역에 없는 포장 단위·변형 제품을 여기서 잡는다.
  let formulaSpecies = null;   // 배합비 코드 → 축종(등록내역 기준, 하나로 정해지는 것만)
  const buildFormulaSpecies = (products) => {
    const m = {};
    products.forEach(p => {
      const reg = (typeof LabDB !== 'undefined' && LabDB.getRegSpec) ? LabDB.getRegSpec(p.code) : null;
      if (reg && reg.cat && p.formulaCode) (m[p.formulaCode] = m[p.formulaCode] || new Set()).add(reg.cat);
    });
    formulaSpecies = {};
    Object.keys(m).forEach(f => { if (m[f].size === 1) formulaSpecies[f] = [...m[f]][0]; });
  };
  const speciesOf = (p, reg, ov) => {
    if (ov && ov.species) return ov.species;
    if (reg && reg.cat) return reg.cat;
    try {
      const c = (typeof LabDB !== 'undefined' && LabDB.productCategory) ? LabDB.productCategory(p.code) : '';
      if (c === '양어' || c === '반려') return c;
    } catch (_) {}
    if (formulaSpecies && p.formulaCode && formulaSpecies[p.formulaCode]) return formulaSpecies[p.formulaCode];
    const n = String(p.name || '');
    const hit = NAME_RULES.find(([, re]) => re.test(n));
    return hit ? hit[0] : '미분류';
  };

  // 목록용 가벼운 정보(축종·공장별 등록번호) — 1,700여 제품 전체를 세어야 해서 등록증 전체를 풀지 않는다
  const metaOf = (p, ovMap) => {
    const reg = (typeof LabDB !== 'undefined' && LabDB.getRegSpec) ? LabDB.getRegSpec(p.code) : null;
    const ov = ovMap[p.code] || {};
    const pick = (a, fb) => (a != null && a !== '') ? a : fb;
    return {
      species: speciesOf(p, reg, ov),
      regNo: {
        NS: pick(ov.regNoNS, reg ? (reg.ns || reg.reg || '') : ''),
        GS: pick(ov.regNoGS, reg ? (reg.gs || '') : ''),
        AS: pick(ov.regNoAS, reg ? (reg.as || '') : ''),
      },
    };
  };
  // 공장 — 화면 왼쪽 공장 선택을 따른다(본사는 등록번호가 없어 전체로 본다)
  // 직접 지정을 빼고 판단한 축종 — 편집 창에 '자동이면 무엇인지' 보여준다
  const autoSpecies = (code) => {
    const db = DB2(); const p = db && db.getProductByCode ? db.getProductByCode(code) : null;
    if (!p) return '미분류';
    if (!formulaSpecies) buildFormulaSpecies(db.getProducts());
    const reg = (typeof LabDB !== 'undefined' && LabDB.getRegSpec) ? LabDB.getRegSpec(code) : null;
    return speciesOf(p, reg, null);
  };
  const facNow = () => {
    try { const f = App.getFactory && App.getFactory(); return FACS.some(([c]) => c === f) ? f : 'ALL'; } catch (_) { return 'ALL'; }
  };
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const DB2 = () => (typeof DB !== 'undefined') ? DB : null;

  // ── 목록: 제품 마스터 기준(코드 자동 연동) ──
  // 검색어 → 공장 → 축종 순으로 거른다. 칩의 건수는 '그 칩을 눌렀을 때 나올 수'다.
  const listData = () => {
    const db = DB2(); if (!db || !db.getProducts) return { rows: [], counts: {}, facCounts: {} };
    const lq = query.toLowerCase().trim();
    const ovMap = {}; FeedCert.getOverrides().forEach(o => { ovMap[o.id] = o; });
    let rows = db.getProducts().filter(p => p.active !== false);
    buildFormulaSpecies(rows);
    if (lq) rows = rows.filter(p =>
      p.code.toLowerCase().includes(lq) ||
      (p.name || '').toLowerCase().includes(lq) ||
      String(p.formulaCode || '').includes(lq));
    rows = rows.map(p => ({ p, m: metaOf(p, ovMap) }));
    const fac = facNow();
    const facCounts = { ALL: rows.length };
    FACS.forEach(([c]) => { facCounts[c] = rows.filter(r => r.m.regNo[c]).length; });
    if (fac !== 'ALL') rows = rows.filter(r => r.m.regNo[fac]);
    const counts = { ALL: rows.length };
    rows.forEach(r => { counts[r.m.species] = (counts[r.m.species] || 0) + 1; });
    if (speciesSel !== 'ALL') rows = rows.filter(r => r.m.species === speciesSel);
    rows.sort((a, b) => a.p.code.localeCompare(b.p.code));
    return { rows, counts, facCounts, fac };
  };

  const render = () => {
    const ld = listData();
    const all = ld.rows;
    const rows = all.slice(0, CAP).map(r => r.p);
    const metaByCode = {}; all.slice(0, CAP).forEach(r => { metaByCode[r.p.code] = r.m; });
    const fac = ld.fac;
    const facName = { NS: '논산', GS: '경산', AS: '아산' }[fac];
    const total = (DB2() && DB2().getProducts) ? DB2().getProducts().length : 0;
    const edited = FeedCert.getOverrides().length;

    const body = rows.length ? rows.map(p => {
      const cert = FeedCert.resolve(p.code);
      const hasReg = !!cert._reg;
      const nut = cert.nutrients.length;
      const badge = cert._hasOverride
        ? '<span class="verdict verdict-ok">편집됨</span>'
        : (hasReg ? '<span class="fc-auto">자동</span>' : '<span class="text-muted">기본</span>');
      const docBadge = cert.officialDocs.length ? ` <span class="fc-doc-badge" title="실제 등록증 ${cert.officialDocs.length}건 첨부">원본 ${cert.officialDocs.length}</span>` : '';
      const m = metaByCode[p.code];
      // 공장을 고르면 그 공장 번호, 전체면 논산 번호 + 등록된 공장 표시
      const regCell = fac !== 'ALL'
        ? esc(cert.regNo[fac] || '-')
        : `${esc(cert.regNo.NS || cert.regNo.GS || cert.regNo.AS || '-')} ${FACS.filter(([c]) => cert.regNo[c]).map(([, n]) => `<span class="fc-fac">${n}</span>`).join('')}`;
      return `
        <tr>
          <td class="mono">${esc(p.code)}</td>
          <td>${esc(p.name)}</td>
          <td><span class="fc-sp">${esc(m ? m.species : '')}</span></td>
          <td class="mono text-muted">${regCell}</td>
          <td class="text-muted">${esc(cert.use || '-')}</td>
          <td style="text-align:center">${nut ? nut + '종' : '<span class="text-muted">없음</span>'}</td>
          <td style="text-align:center">${badge}${docBadge}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn btn-primary btn-xs" onclick="FeedCertPage.print('${esc(p.code)}')">등록증</button>
            <button class="btn btn-ghost btn-xs" onclick="FeedCertPage.edit('${esc(p.code)}')">편집</button>
          </td>
        </tr>`;
    }).join('') : `<tr><td colspan="8" class="text-muted" style="text-align:center;padding:24px">${query || speciesSel !== 'ALL' || fac !== 'ALL' ? '조건에 맞는 제품이 없습니다' : '제품이 없습니다'}</td></tr>`;

    // 축종 칩 — 건수가 있는 것만, 법정 축종 순서대로
    const chip = (key, label, n, on, fn) => `<button class="fc-chip ${on ? 'on' : ''}" onclick="${fn}">${esc(label)} <em>${n}</em></button>`;
    const spChips = chip('ALL', '전체', ld.counts.ALL || 0, speciesSel === 'ALL', "FeedCertPage.setSpecies('ALL')")
      + SPECIES_ORDER.filter(sp => ld.counts[sp] || speciesSel === sp)
          .map(sp => chip(sp, sp, ld.counts[sp] || 0, speciesSel === sp, `FeedCertPage.setSpecies('${sp}')`)).join('');
    const facChips = chip('ALL', '전체 공장', ld.facCounts.ALL || 0, fac === 'ALL', "App.setFactory('ALL')")
      + FACS.map(([c, n]) => chip(c, n + '공장', ld.facCounts[c] || 0, fac === c, `App.setFactory('${c}')`)).join('');

    const capNote = all.length > CAP
      ? `<div class="text-muted" style="font-size:12px;margin-top:8px">※ ${all.length}개 중 상위 ${CAP}개만 표시 — <b>검색</b>으로 좁히세요.</div>` : '';

    return `
    <style>
      .fc-auto{display:inline-block;font-size:11px;color:var(--accent,#3E6AE1);border:1px solid var(--accent,#3E6AE1);border-radius:10px;padding:1px 8px;}
      .fc-doc-badge{display:inline-block;font-size:11px;color:#0a7d28;border:1px solid #0a7d28;border-radius:10px;padding:1px 7px;}
      .fc-filter{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
      .fc-filter>label{font-size:12px;font-weight:700;color:var(--text-muted);min-width:44px}
      .fc-chip{border:1px solid var(--border);background:var(--bg-card);border-radius:14px;padding:3px 11px;font-size:12.5px;cursor:pointer;color:var(--text-secondary);font-family:inherit}
      .fc-chip em{font-style:normal;font-size:11px;color:var(--text-muted);margin-left:2px}
      .fc-chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
      .fc-chip.on em{color:rgba(255,255,255,.85)}
      .fc-sp{font-size:12px;color:var(--text-secondary)}
      .fc-fac{display:inline-block;font-size:10.5px;border:1px solid var(--border);border-radius:8px;padding:0 5px;margin-left:3px;color:var(--text-muted);font-family:inherit}
    </style>
    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><div class="card-title">사료성분등록증</div>
        <span class="text-muted" style="font-size:12px">제품코드에 자동 연동 · 편집한 칸만 저장 · 출고 시 함께 인쇄</span>
      </div>
      <div class="text-muted" style="font-size:12.5px;line-height:1.7">
        · 상품명·사료의 명칭·용도·등록번호·등록성분량은 <b>제품 마스터와 사료성분 등록내역</b>에서 자동으로 채워집니다.<br>
        · 회사 공통 문구(주의사항·보관방법·주소·고객센터)는 <b>공통 문구</b>에서 한 번만 정하면 전 등록증에 적용됩니다.<br>
        · 제품(코드)이 새로 발행되면 그 코드로 등록증이 바로 생깁니다. 자동값과 다른 칸만 <b>편집</b>에서 고치면 됩니다.
      </div>
    </div>

    <div class="card">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px">
        <div class="form-group" style="margin:0;flex:1;min-width:220px">
          <label class="form-label">제품 검색 (코드·제품명·배합코드)</label>
          <input type="text" class="form-input form-input-sm" id="fc-search" value="${esc(query)}" placeholder="예: 1002900, 육계" oninput="FeedCertPage.onSearch(this.value)">
        </div>
        <span class="text-muted" style="font-size:12px">제품 <b>${total}</b>종 · 편집 <b>${edited}</b>건</span>
        <button class="btn btn-ghost btn-sm" onclick="FeedCertPage.editBoiler()">공통 문구</button>
      </div>
      <div class="fc-filter"><label>공장</label>${facChips}</div>
      <div class="fc-filter"><label>축종</label>${spChips}</div>
      <div class="text-xs text-muted" style="margin:-2px 0 10px">공장은 그 공장 성분등록번호가 있는 제품만 보입니다(왼쪽 공장 선택과 같이 바뀝니다). 축종은 사료성분 등록내역 기준이며, 등록내역에 없는 제품은 제품명으로 나눴습니다.</div>
      <div class="table-wrap" style="max-height:min(720px,calc(100vh - 380px));overflow:auto">
        <table class="data-table compact">
          <thead><tr>
            <th>제품코드</th><th>제품명</th><th>축종</th><th>성분등록번호${facName ? '(' + facName + ')' : ''}</th><th>용도</th>
            <th style="text-align:center">등록성분</th><th style="text-align:center">상태</th>
            <th style="text-align:right">작업</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      ${capNote}
    </div>`;
  };

  const setSpecies = (sp) => { speciesSel = sp; App.refreshPage(); };

  let searchTimer = null;
  const onSearch = (v) => {
    query = v;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { App.refreshPage(); const el = document.getElementById('fc-search'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 300);
  };

  // ── 편집 모달 ──
  const ensureStyle = () => {
    if (document.getElementById('fced-style')) return;
    const st = document.createElement('style');
    st.id = 'fced-style';
    st.textContent = `
      .fced-ov{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px;}
      .fced-box{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;width:min(720px,96vw);max-height:90vh;overflow:auto;padding:20px;box-shadow:0 16px 48px rgba(0,0,0,.5);}
      .fced-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;}
      .fced-fld{display:flex;flex-direction:column;gap:4px;}
      .fced-fld.full{grid-column:1/3;}
      .fced-fld label{font-size:11.5px;color:var(--text-muted);}
      .fced-fld input,.fced-fld textarea,.fced-fld select{padding:7px 10px;font-size:13px;background:var(--bg-input,transparent);border:1px solid var(--border);border-radius:7px;color:var(--text);font-family:inherit;}
      .fced-fld textarea{min-height:52px;resize:vertical;}
      .fced-fld .auto{font-size:11px;color:var(--accent,#3E6AE1);}
      .fced-sec{font-size:12px;font-weight:700;margin:14px 0 6px;color:var(--text);}
      .fced-nut{width:100%;border-collapse:collapse;font-size:12px;}
      .fced-nut th,.fced-nut td{border:1px solid var(--border);padding:4px 6px;}
      .fced-nut th{font-size:11px;color:var(--text-muted);}
      .fced-nut input,.fced-nut select{width:100%;padding:4px 6px;background:var(--bg-input,transparent);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:12px;font-family:inherit;}
      .fced-nut .num{text-align:right;}
      .fced-doc{display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--border);border-radius:7px;margin-bottom:6px;font-size:12px;}
      .fced-doc .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .fced-doc .mt{color:var(--text-muted);font-size:11px;white-space:nowrap;}
      .fced-official{border:1px dashed var(--accent,#3E6AE1);border-radius:9px;padding:12px;margin-top:8px;background:rgba(62,106,225,.04);}
      .fced-facsec{border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:8px;}
      .fced-fachdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:12px;}
      .fced-hist{margin-top:14px;max-height:190px;overflow:auto;border:1px solid var(--border);border-radius:8px;}
      .fced-hist .hr{padding:6px 10px;border-bottom:1px solid var(--border);font-size:11.5px;}
      .fced-hist .hr:last-child{border-bottom:none;}
      .fced-hist .hm{color:var(--text-muted);}
      .fced-hist .ha{color:var(--accent,#3E6AE1);font-weight:600;}`;
    document.head.appendChild(st);
  };
  const closeEdit = () => { document.getElementById('fced-ov')?.remove(); };

  const nutRow = (n) => `
    <tr>
      <td><input class="fc-nn" value="${esc(n.name)}" placeholder="성분명"></td>
      <td><input class="fc-nv num" type="number" step="any" value="${n.value == null ? '' : esc(n.value)}" placeholder="값"></td>
      <td><select class="fc-nd">
        <option value="이상" ${n.dir !== '이하' ? 'selected' : ''}>이상</option>
        <option value="이하" ${n.dir === '이하' ? 'selected' : ''}>이하</option>
      </select></td>
      <td style="text-align:center;width:34px"><button class="btn btn-ghost btn-xs" onclick="this.closest('tr').remove()">✕</button></td>
    </tr>`;

  const edit = (code) => {
    const cert = FeedCert.resolve(code);
    ensureStyle(); closeEdit();
    const autoHint = (auto) => auto ? `<span class="auto">자동: ${esc(auto)}</span>` : '';
    const nutRows = cert.nutrients.length ? cert.nutrients.map(nutRow).join('') : '';
    const ov = document.createElement('div');
    ov.className = 'fced-ov'; ov.id = 'fced-ov';
    ov.innerHTML = `
      <div class="fced-box">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div><b>사료성분등록증 편집</b> <span class="mono text-muted" style="font-size:12px">${esc(cert.code)}</span> · ${esc(cert.productName)}</div>
          <button class="btn btn-ghost btn-xs" onclick="FeedCertPage.closeEdit()">✕</button>
        </div>
        <div class="text-muted" style="font-size:11.5px;margin-bottom:12px">비워두면 자동값을 씁니다. 고친 칸만 저장됩니다.</div>

        <div class="fced-grid">
          <div class="fced-fld"><label>사료의 명칭</label><input id="fc-feedName" value="${esc(cert.feedName)}"></div>
          <div class="fced-fld"><label>사료의 형태 (가루/펠릿/크럼블)</label><input id="fc-form" value="${esc(cert.form)}" placeholder="예: 가루"></div>
          <div class="fced-fld full"><label>사료의 용도 ${autoHint(cert._reg ? cert._reg.use : '')}</label><input id="fc-use" value="${esc(cert.use)}"></div>
          <div class="fced-fld"><label>성분등록번호 · 논산 ${autoHint(cert._reg ? cert._reg.reg : '')}</label><input id="fc-regNoNS" value="${esc(cert.regNo.NS)}" placeholder="예: CCBDL0012"></div>
          <div class="fced-fld"><label>성분등록번호 · 경산</label><input id="fc-regNoGS" value="${esc(cert.regNo.GS)}" placeholder="예: IIQU90014"></div>
          <div class="fced-fld"><label>성분등록번호 · 아산</label><input id="fc-regNoAS" value="${esc(cert.regNo.AS)}"></div>
          <div class="fced-fld"><label>축종 <span class="text-muted" style="font-weight:400">(비워 두면 자동: ${esc(autoSpecies(cert.code))})</span></label>
            <select id="fc-species"><option value="">자동</option>${SPECIES_ORDER.filter(x => x !== '미분류').map(x => `<option ${cert.species === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div class="fced-fld"><label>유통기간 (제조일로부터 · 일)</label><input id="fc-shelfDays" type="number" min="1" value="${esc(cert.shelfDays)}"></div>
        </div>

        <div class="fced-sec">등록성분량 <span class="text-muted" style="font-weight:400;font-size:11px">등록내역에서 자동 채움 · 필요 시 수정</span></div>
        <table class="fced-nut">
          <thead><tr><th>성분명</th><th style="width:110px">성분량</th><th style="width:70px">기준</th><th style="width:34px"></th></tr></thead>
          <tbody id="fc-nut-body">${nutRows || ''}</tbody>
        </table>
        <button class="btn btn-ghost btn-xs" style="margin-top:6px" onclick="FeedCertPage.addNut()">+ 성분 추가</button>

        <div class="fced-grid" style="margin-top:14px">
          <div class="fced-fld full"><label>사용한 원료의 명칭</label><textarea id="fc-ingredients">${esc(cert.ingredients)}</textarea></div>
          <div class="fced-fld"><label>실중량</label><input id="fc-netWeight" value="${esc(cert.netWeight)}"></div>
          <div class="fced-fld"><label>재포장내용</label><input id="fc-repack" value="${esc(cert.repack)}"></div>
          <div class="fced-fld"><label>지대크기(mm)</label><input id="fc-bagSize" value="${esc(cert.bagSize)}" placeholder="예: 가로X폭X길이"></div>
          <div class="fced-fld"><label>지대재질</label><input id="fc-bagMaterial" value="${esc(cert.bagMaterial)}"></div>
          <div class="fced-fld"><label>문서번호</label><input id="fc-docNo" value="${esc(cert.docNo)}"></div>
          <div class="fced-fld"><label>개정번호</label><input id="fc-rev" value="${esc(cert.rev)}"></div>
          <div class="fced-fld full"><label>비고</label><input id="fc-note" value="${esc(cert.note)}"></div>
        </div>

        <div class="fced-sec">실제 등록증 (도청 발행 원본)</div>
        <div class="fced-official">
          <div class="text-muted" style="font-size:11.5px;margin-bottom:8px">
            위 성분표는 <b>판매용(고객용)</b>입니다. 관할 도청이 발행한 <b>실제 등록증</b>을 <b>공장별로</b> 올려두면
            그 공장으로 출고할 때 해당 등록증만 골라 내려받을 수 있습니다.
          </div>
          <div id="fc-doc-list">${officialSectionsHtml(cert.code)}</div>
        </div>

        <div class="fced-sec">수정 이력 <span class="text-muted" style="font-weight:400;font-size:11px">누가·언제·무엇을 고쳤는지</span></div>
        <div class="fced-hist">${historyHtml(cert.code)}</div>

        <div style="display:flex;gap:8px;justify-content:space-between;margin-top:16px">
          <button class="btn btn-ghost btn-sm" onclick="FeedCertPage.resetOverride('${esc(cert.code)}')">${cert._hasOverride ? '편집 해제(자동값으로)' : ''}</button>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" onclick="FeedCertPage.closeEdit()">취소</button>
            <button class="btn btn-primary btn-sm" onclick="FeedCertPage.saveEdit('${esc(cert.code)}')">저장</button>
          </div>
        </div>
      </div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov) closeEdit(); });
    document.body.appendChild(ov);
  };
  const addNut = () => {
    const b = document.getElementById('fc-nut-body'); if (!b) return;
    b.insertAdjacentHTML('beforeend', nutRow({ name: '', value: '', dir: '이상' }));
  };

  // ── 실제 등록증 첨부: 공장별 섹션 ──
  const sizeText = (b) => { try { return PhotoStore.sizeText ? PhotoStore.sizeText(b) : ''; } catch (_) { return ''; } };
  const docRow = (code, d) => `
      <div class="fced-doc">
        <span class="nm" title="${esc(d.name)}">${esc(d.name)}</span>
        <span class="mt">${esc(sizeText(d.bytes))}${d.by ? ' · ' + esc(d.by) : ''}${d.at ? ' · ' + esc(String(d.at).slice(0, 10)) : ''}</span>
        <button class="btn btn-ghost btn-xs" onclick="FeedCertPage.viewOfficial('${esc(code)}','${esc(d.id)}')">열기</button>
        <button class="btn btn-ghost btn-xs" onclick="FeedCertPage.removeOfficial('${esc(code)}','${esc(d.id)}')">삭제</button>
      </div>`;
  const officialSectionsHtml = (code) => {
    const all = FeedCert.officialDocsOf(code);
    const byFac = { NS: [], GS: [], AS: [], '': [] };
    all.forEach(d => { (byFac[d.fac || ''] = byFac[d.fac || ''] || []).push(d); });
    const facSec = (fac, name) => {
      const docs = byFac[fac] || [];
      const list = docs.length ? docs.map(d => docRow(code, d)).join('')
        : '<div class="text-muted" style="font-size:11.5px;padding:2px 0">첨부 없음</div>';
      return `
        <div class="fced-facsec">
          <div class="fced-fachdr"><b>${name}</b>
            <label class="btn btn-ghost btn-xs" style="cursor:pointer">첨부
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,.hwp,.hwpx,.doc,.docx,image/*,application/pdf" style="display:none"
                     onchange="FeedCertPage.uploadOfficial('${esc(code)}', this, '${fac}')">
            </label>
          </div>
          ${list}
        </div>`;
    };
    const commonDocs = byFac[''] || [];
    return facSec('NS', '논산공장') + facSec('GS', '경산공장') + facSec('AS', '아산공장')
      + (commonDocs.length ? `<div class="fced-facsec"><div class="fced-fachdr"><b>공장 미지정(공통)</b></div>${commonDocs.map(d => docRow(code, d)).join('')}</div>` : '');
  };
  const historyHtml = (code) => {
    const h = FeedCert.historyOf(code);
    if (!h.length) return '<div class="text-muted" style="font-size:12px;padding:8px 10px">아직 수정 이력이 없습니다.</div>';
    return h.map(e => {
      const when = String(e.ts || '').slice(0, 16).replace('T', ' ');
      const what = (e.changes || []).map(c => c.label + (c.detail ? `(${c.detail})` : '')).join(', ');
      return `<div class="hr"><span class="hm">${esc(when)}</span> · <span class="ha">${esc(e.by || '-')}</span> · ${esc(e.action)}${what ? ' · ' + esc(what) : ''}</div>`;
    }).join('');
  };
  const refreshDocList = (code) => {
    const el = document.getElementById('fc-doc-list');
    if (el) el.innerHTML = officialSectionsHtml(code);
    const hel = document.querySelector('.fced-hist');
    if (hel) hel.innerHTML = historyHtml(code);
  };
  const uploadOfficial = async (code, input, fac) => {
    const file = input && input.files && input.files[0];
    if (!file) return;
    if (typeof PhotoStore === 'undefined' || !PhotoStore.save) { App.toast('첨부 모듈을 불러올 수 없습니다', 'error'); return; }
    try {
      let by = '';
      try { by = (typeof Auth !== 'undefined' && Auth.currentName) ? (Auth.currentName() || '') : ''; } catch (_) {}
      App.toast('업로드 중…', 'info');
      // PhotoStore.save 는 이미지면 축소본+썸네일, PDF·한글 등은 원본만 서버(data/files)에 올린다.
      const meta = await PhotoStore.save(file, { by, kind: 'FEED_CERT' });
      FeedCert.addOfficialDoc(code, meta, fac);           // 공장 태그와 함께 보관
      input.value = '';
      refreshDocList(code);
      const fname = (FeedCert.FAC_NAME && FeedCert.FAC_NAME[fac]) ? FeedCert.FAC_NAME[fac] + ' ' : '';
      App.toast(`${fname}실제 등록증을 첨부했습니다.`, 'success');
    } catch (e) {
      App.toast('첨부 실패: ' + (e.message || e), 'error');
    }
  };
  const viewOfficial = (code, docId) => {
    const d = FeedCert.officialDocsOf(code).find(x => x.id === docId);
    if (!d) return;
    try { PhotoStore.download(d); } catch (_) { App.toast('파일을 열 수 없습니다', 'error'); }
  };
  const removeOfficial = (code, docId) => {
    const d = FeedCert.officialDocsOf(code).find(x => x.id === docId);
    if (!d || !confirm(`"${d.name}" 을(를) 삭제할까요?`)) return;
    FeedCert.removeOfficialDoc(code, docId);
    refreshDocList(code);
    App.toast('첨부를 삭제했습니다.', 'info');
  };
  const collectNut = () => {
    const rows = [...document.querySelectorAll('#fc-nut-body tr')];
    return rows.map(tr => ({
      name: tr.querySelector('.fc-nn')?.value.trim() || '',
      value: tr.querySelector('.fc-nv')?.value.trim() || '',
      dir: tr.querySelector('.fc-nd')?.value || '이상',
    })).filter(n => n.name && n.value !== '');
  };
  const saveEdit = (code) => {
    const g = (id) => (document.getElementById(id)?.value || '').trim();
    FeedCert.saveOverride(code, {
      feedName: g('fc-feedName'), form: g('fc-form'), use: g('fc-use'),
      regNoNS: g('fc-regNoNS'), regNoGS: g('fc-regNoGS'), regNoAS: g('fc-regNoAS'), species: g('fc-species'),
      shelfDays: g('fc-shelfDays'),
      nutrients: collectNut(),
      ingredients: g('fc-ingredients'), netWeight: g('fc-netWeight'), repack: g('fc-repack'),
      bagSize: g('fc-bagSize'), bagMaterial: g('fc-bagMaterial'),
      docNo: g('fc-docNo'), rev: g('fc-rev'), note: g('fc-note'),
    });
    closeEdit();
    App.toast('사료성분등록증을 저장했습니다.', 'success');
    App.refreshPage();
  };
  const resetOverride = (code) => {
    if (!confirm('편집한 내용을 지우고 자동값으로 되돌릴까요?\n(첨부한 실제 등록증과 수정 이력은 그대로 유지됩니다)')) return;
    FeedCert.revertToAuto(code);
    closeEdit();
    App.toast('자동값으로 되돌렸습니다. (이력 기록됨)', 'success');
    App.refreshPage();
  };

  // ── 공통 문구 편집 ──
  const editBoiler = () => {
    const b = FeedCert.getBoiler();
    ensureStyle(); closeEdit();
    const ov = document.createElement('div');
    ov.className = 'fced-ov'; ov.id = 'fced-ov';
    ov.innerHTML = `
      <div class="fced-box">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div><b>등록증 공통 문구</b></div>
          <button class="btn btn-ghost btn-xs" onclick="FeedCertPage.closeEdit()">✕</button>
        </div>
        <div class="text-muted" style="font-size:11.5px;margin-bottom:12px">모든 등록증에 공통으로 들어가는 내용입니다. 한 번 고치면 전 제품에 적용됩니다.</div>
        <div class="fced-grid">
          <div class="fced-fld full"><label>사용한 원료의 명칭 (기본값)</label><textarea id="fb-ingredients">${esc(b.ingredients)}</textarea></div>
          <div class="fced-fld full"><label>GMO 표기</label><input id="fb-gmo" value="${esc(b.gmo)}"></div>
          <div class="fced-fld full"><label>주의사항 (줄바꿈으로 구분)</label><textarea id="fb-cautions">${esc((b.cautions || []).join('\n'))}</textarea></div>
          <div class="fced-fld full"><label>보관 및 사용방법 (줄바꿈으로 구분)</label><textarea id="fb-storage">${esc((b.storage || []).join('\n'))}</textarea></div>
          <div class="fced-fld"><label>기본 유통기간(일)</label><input id="fb-shelfDays" type="number" min="1" value="${esc(b.shelfDays)}"></div>
          <div class="fced-fld"><label>실중량 기본값</label><input id="fb-netWeight" value="${esc(b.netWeight)}"></div>
          <div class="fced-fld"><label>제조년월일 표기</label><input id="fb-mfgDate" value="${esc(b.mfgDate)}"></div>
          <div class="fced-fld"><label>재포장내용 기본값</label><input id="fb-repack" value="${esc(b.repack)}"></div>
          <div class="fced-fld"><label>고객센터명</label><input id="fb-center" value="${esc(b.center)}"></div>
          <div class="fced-fld"><label>대표전화</label><input id="fb-tel" value="${esc(b.tel)}"></div>
          <div class="fced-fld"><label>논산공장 주소</label><input id="fb-ns" value="${esc(b.factories.NS.addr)}"></div>
          <div class="fced-fld"><label>경산공장 주소</label><input id="fb-gs" value="${esc(b.factories.GS.addr)}"></div>
          <div class="fced-fld"><label>아산공장 주소</label><input id="fb-as" value="${esc(b.factories.AS.addr)}"></div>
          <div class="fced-fld"><label>문서번호</label><input id="fb-docNo" value="${esc(b.docNo)}"></div>
          <div class="fced-fld full"><label>하단 안내문구 (줄바꿈으로 구분)</label><textarea id="fb-footer">${esc((b.footer || []).join('\n'))}</textarea></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost btn-sm" onclick="FeedCertPage.closeEdit()">취소</button>
          <button class="btn btn-primary btn-sm" onclick="FeedCertPage.saveBoiler()">저장</button>
        </div>
      </div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov) closeEdit(); });
    document.body.appendChild(ov);
  };
  const saveBoiler = () => {
    const g = (id) => (document.getElementById(id)?.value || '').trim();
    const lines = (id) => g(id).split('\n').map(s => s.trim()).filter(Boolean);
    const cur = FeedCert.getBoiler();
    FeedCert.saveBoiler({
      ingredients: g('fb-ingredients'), gmo: g('fb-gmo'),
      cautions: lines('fb-cautions'), storage: lines('fb-storage'),
      shelfDays: Number(g('fb-shelfDays')) || cur.shelfDays,
      netWeight: g('fb-netWeight'), mfgDate: g('fb-mfgDate'), repack: g('fb-repack'),
      center: g('fb-center'), tel: g('fb-tel'), docNo: g('fb-docNo'),
      footer: lines('fb-footer'),
      factories: { NS: { name: '논산공장', addr: g('fb-ns') }, GS: { name: '경산공장', addr: g('fb-gs') }, AS: { name: '아산공장', addr: g('fb-as') } },
    });
    closeEdit();
    App.toast('공통 문구를 저장했습니다.', 'success');
  };

  return {
    render, onSearch, setSpecies, edit, closeEdit, addNut, saveEdit, resetOverride,
    editBoiler, saveBoiler,
    uploadOfficial, viewOfficial, removeOfficial,
    print: (code) => FeedCertPrint.open(code),
  };
})();


// ============================================================
// FeedCertPrint — 등록증 미리보기·인쇄 오버레이 (양식 재현)
// ============================================================
const FeedCertPrint = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const nl = (s) => esc(s).replace(/\n/g, '<br>');

  // fac: 'ALL' | 'NS' | 'GS' | 'AS' — 특정 공장이면 그 공장 등록번호만 찍는다(그 공장으로 출고되는 제품).
  const sheetHtml = (cert, fac) => {
    const b = cert._boiler;
    const facKeys = (fac && fac !== 'ALL') ? [fac] : ['NS', 'GS', 'AS'];
    const facLines = facKeys.map(f => {
      const fx = b.factories[f]; const no = cert.regNo[f];
      return no ? `<div>${esc(fx.name)} = 제 ${esc(no)} 호</div>` : '';
    }).filter(Boolean).join('')
      || `<div class="fc-muted">${(fac && fac !== 'ALL') ? (b.factories[fac].name + ' 등록번호 미입력') : '등록번호 미입력'}</div>`;

    const nutRows = cert.nutrients.length
      ? cert.nutrients.map(n => `<tr><td class="l">${esc(n.name)}</td><td class="r">${esc(n.value)}%${n.dir ? ' ' + esc(n.dir) : ''}</td></tr>`).join('')
      : '<tr><td colspan="2" class="fc-muted" style="text-align:center">등록성분 없음 — 사료성분 등록내역 매칭을 확인하세요</td></tr>';

    const drugRows = (cert.drugs && cert.drugs.length)
      ? cert.drugs.map(d => `<tr><td>${esc(d.name)}</td><td>${esc(d.amount || '')}</td><td>${esc(d.purpose || '')}</td><td>${esc(d.withdrawal || '')}</td></tr>`).join('')
      : `<tr><td colspan="4" style="text-align:center">첨가내용이 없습니다</td></tr>`;

    const addrLines = ['NS', 'GS', 'AS'].map(f => `<div>${esc(b.factories[f].name)} : ${esc(b.factories[f].addr)}</div>`).join('');

    return `
    <div class="fc-sheet">
      <table class="fc-hdr">
        <tr>
          <td class="lb">코드</td><td class="mono">${esc(cert.code)}</td>
          <td class="lb">지대크기(mm)</td><td>${esc(cert.bagSize)}</td>
          <td class="lb">문서번호</td><td class="mono">${esc(cert.docNo)}</td>
        </tr>
        <tr>
          <td class="lb">상품명</td><td>${esc(cert.productName)}</td>
          <td class="lb">지대재질</td><td>${esc(cert.bagMaterial)}</td>
          <td class="lb">개정번호</td><td>${esc(cert.rev)}</td>
        </tr>
      </table>

      <div class="fc-title">배 합 사 료 성 분 표</div>

      <div class="fc-cols">
        <div class="fc-col">
          <div class="fc-sec"><div class="fc-sn">1. 성분등록번호</div><div class="fc-sb">${facLines}</div></div>
          <div class="fc-sec"><div class="fc-sn">2. 사료의 명칭</div><div class="fc-sb">${esc(cert.feedName)}</div></div>
          <div class="fc-sec"><div class="fc-sn">3. 사료의 형태</div><div class="fc-sb">${esc(cert.form) || '<span class="fc-muted">-</span>'}</div></div>
          <div class="fc-sec"><div class="fc-sn">4. 사료의 용도</div><div class="fc-sb">${esc(cert.use) || '<span class="fc-muted">-</span>'}</div></div>
          <div class="fc-sec"><div class="fc-sn">5. 등록성분량</div>
            <table class="fc-nut"><tbody>${nutRows}</tbody></table>
          </div>
          <div class="fc-sec"><div class="fc-sn">6. 사용한 원료의 명칭</div>
            <div class="fc-sb">${nl(cert.ingredients)}${cert.gmo ? `<div class="fc-gmo">* ${esc(cert.gmo)}</div>` : ''}</div>
          </div>
          <div class="fc-sec"><div class="fc-sn">7. 동물용 의약품 첨가내용</div>
            <table class="fc-drug"><thead><tr><th>동물용의약품명</th><th>첨가량</th><th>첨가목적</th><th>휴약기간</th></tr></thead><tbody>${drugRows}</tbody></table>
          </div>
        </div>

        <div class="fc-col">
          <div class="fc-sec"><div class="fc-sn">8. 주의사항</div>
            <ul class="fc-ul">${(b.cautions || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
          <div class="fc-sec"><div class="fc-sn">9. 보관 및 사용방법</div>
            <ul class="fc-ul">${(b.storage || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
          <div class="fc-sec"><div class="fc-sn">10. 실중량</div><div class="fc-sb">${esc(cert.netWeight)}</div></div>
          <div class="fc-sec"><div class="fc-sn">11. 유통기간</div><div class="fc-sb">제조일로부터 ${esc(cert.shelfDays)}일까지</div></div>
          <div class="fc-sec"><div class="fc-sn">12. 제조년월일</div><div class="fc-sb">${esc(cert.mfgDate)}</div></div>
          <div class="fc-sec"><div class="fc-sn">13. 재포장내용</div><div class="fc-sb">${esc(cert.repack)}</div></div>
          <div class="fc-sec"><div class="fc-sn">14. 상호(공장명칭)·주소 및 전화번호</div>
            <div class="fc-sb"><b>${esc(b.company)}</b>${addrLines}
              <div class="fc-center">${esc(b.center)} · 대표전화 ${esc(b.tel)}</div></div>
          </div>
        </div>
      </div>

      ${cert.note ? `<div class="fc-note">비고: ${esc(cert.note)}</div>` : ''}
      <div class="fc-footer">${(b.footer || []).map(x => `<div>${esc(x)}</div>`).join('')}</div>
    </div>`;
  };

  const ensureStyle = () => {
    if (document.getElementById('fcp-style')) return;
    const st = document.createElement('style');
    st.id = 'fcp-style';
    st.textContent = `
    .fcp-ov{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;overflow:auto;padding:20px;}
    .fcp-tb{position:sticky;top:0;z-index:1;display:flex;gap:8px;justify-content:center;margin-bottom:14px;}
    .fcp-tb button{padding:8px 16px;border:0;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;}
    .fcp-print{background:#3E6AE1;color:#fff;} .fcp-close{background:#33384a;color:#e5e9f0;}
    .fcp-official{background:#0a7d28;color:#fff;}
    .fcp-tb{align-items:center;flex-wrap:wrap;}
    .fcp-faclabel{color:#c8cdd8;font-size:12px;font-weight:600;}
    .fcp-fac{background:#2a2f3e;color:#c8cdd8;padding:7px 13px;}
    .fcp-fac.on{background:#E4002B;color:#fff;}
    .fcp-sep{width:1px;height:20px;background:#4a4f5e;margin:0 2px;}
    .fc-sheet{background:#fff;color:#111;width:210mm;max-width:100%;min-height:290mm;margin:0 auto;
      padding:14mm 14mm;box-shadow:0 4px 24px rgba(0,0,0,.5);box-sizing:border-box;
      font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:11px;line-height:1.5;}
    .fc-sheet div,.fc-sheet td,.fc-sheet th,.fc-sheet li,.fc-sheet b{color:#111;}
    .fc-hdr{width:100%;border-collapse:collapse;margin-bottom:12px;}
    .fc-hdr td{border:1px solid #000;padding:4px 8px;font-size:11px;}
    .fc-hdr .lb{background:#eee;font-weight:700;text-align:center;white-space:nowrap;width:74px;}
    .fc-hdr .mono{font-family:'Consolas',monospace;}
    .fc-title{text-align:center;font-size:20px;font-weight:800;letter-spacing:6px;margin:6px 0 14px;}
    .fc-cols{display:flex;gap:12px;align-items:flex-start;}
    .fc-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:9px;}
    .fc-sec{border:1px solid #000;border-radius:2px;}
    .fc-sn{background:#eee;font-weight:700;padding:4px 8px;border-bottom:1px solid #000;font-size:11px;}
    .fc-sb{padding:6px 9px;white-space:normal;word-break:keep-all;}
    .fc-muted{color:#888;}
    .fc-gmo{margin-top:5px;color:#b00;font-weight:700;font-size:10.5px;}
    .fc-nut{width:100%;border-collapse:collapse;}
    .fc-nut td{border-top:1px solid #ddd;padding:4px 9px;font-size:11px;}
    .fc-nut tr:first-child td{border-top:0;}
    .fc-nut .l{text-align:left;} .fc-nut .r{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;}
    .fc-drug{width:100%;border-collapse:collapse;}
    .fc-drug th,.fc-drug td{border:1px solid #bbb;padding:3px 5px;font-size:10px;text-align:center;}
    .fc-drug th{background:#f4f4f4;}
    .fc-ul{margin:0;padding:6px 9px 6px 24px;}
    .fc-ul li{margin:2px 0;}
    .fc-center{margin-top:6px;font-size:10.5px;color:#c0392b;font-weight:700;}
    .fc-note{margin-top:10px;border:1px solid #000;padding:5px 9px;font-size:11px;}
    .fc-footer{margin-top:14px;border-top:1.5px solid #000;padding-top:8px;font-size:10.5px;color:#333;}
    .fc-footer > div{margin:1px 0;}
    @media print {
      body > *:not(.fcp-ov){display:none !important;}
      .fcp-ov{position:static;background:#fff;padding:0;overflow:visible;}
      .fcp-tb{display:none !important;}
      .fc-sheet{box-shadow:none;width:auto;min-height:auto;margin:0;padding:0;}
      @page{size:A4;margin:12mm;}
    }`;
    document.head.appendChild(st);
  };

  let cur = null;   // { cert, fac }  현재 미리보기 상태(공장 전환 시 다시 그림)
  const FAC_LABEL = { ALL: '전체', NS: '논산', GS: '경산', AS: '아산' };

  const toolbarHtml = (cert, fac) => {
    // 선택한 공장의 실제 등록증(공통 첨부 포함)만 대상으로 한다.
    const docs = FeedCert.officialDocsOf(cert.code, fac);
    const officialBtn = docs.length
      ? `<button class="fcp-official" onclick="FeedCertPrint.official('${esc(cert.code)}')">실제 등록증 열기 (${docs.length})</button>`
      : '';
    // 공장 선택: 등록번호가 있는 공장 + 전체. 지금 선택된 공장은 강조.
    const opts = ['ALL', 'NS', 'GS', 'AS'].filter(f => f === 'ALL' || cert.regNo[f]);
    const facBtns = opts.map(f =>
      `<button class="fcp-fac ${f === fac ? 'on' : ''}" onclick="FeedCertPrint.setFac('${f}')">${FAC_LABEL[f]}</button>`).join('');
    return `
      <div class="fcp-tb">
        <span class="fcp-faclabel">공장</span>${facBtns}
        <span class="fcp-sep"></span>
        <button class="fcp-print" onclick="FeedCertPrint.print()">인쇄 / PDF 저장</button>
        ${officialBtn}
        <button class="fcp-close" onclick="FeedCertPrint.close()">✕ 닫기</button>
      </div>`;
  };

  const paint = () => {
    const ov = document.getElementById('fcp-ov');
    if (!ov || !cur) return;
    ov.innerHTML = toolbarHtml(cur.cert, cur.fac) + sheetHtml(cur.cert, cur.fac);
  };

  // fac 기본값: 넘겨준 값 → 상단 공장필터(특정 공장일 때) → 전체
  const open = (code, fac) => {
    const cert = FeedCert.resolve(code);
    if (!cert.code) { App.toast('제품을 찾을 수 없습니다', 'error'); return; }
    ensureStyle(); close();
    let f = (fac && FAC_LABEL[fac]) ? fac : 'ALL';
    if (f === 'ALL') { try { const cf = App.getFactory && App.getFactory(); if (cf && cf !== 'ALL' && FAC_LABEL[cf]) f = cf; } catch (_) {} }
    if (f !== 'ALL' && !cert.regNo[f]) f = 'ALL';   // 그 공장 등록번호가 없으면 전체로
    cur = { cert, fac: f };
    const ov = document.createElement('div');
    ov.className = 'fcp-ov'; ov.id = 'fcp-ov';
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    paint();
  };
  const setFac = (f) => { if (cur) { cur.fac = f; paint(); } };
  const print = () => window.print();
  const close = () => { document.getElementById('fcp-ov')?.remove(); cur = null; };
  // 실제 등록증(도청 발행) 원본 내려받기 — 지금 고른 공장 것만, 여러 건이면 순서대로
  const official = (code) => {
    const fac = cur ? cur.fac : 'ALL';
    const docs = FeedCert.officialDocsOf(code, fac);
    if (!docs.length) { App.toast('이 공장에 첨부된 실제 등록증이 없습니다', 'warning'); return; }
    try { docs.forEach((d, i) => setTimeout(() => PhotoStore.download(d), i * 400)); } catch (_) { App.toast('파일을 열 수 없습니다', 'error'); }
  };

  return { open, print, close, official, setFac };
})();

