// ============================================================
// rnd_db.js — 연구관리 데이터 레이어
//
//   품질·실험실이 "이미 만든 것을 검사"하는 영역이라면,
//   연구관리는 "아직 없는 것을 만들어 가는" 영역이다. 그래서 워크스페이스를 나눴다.
//
//   ── 제품개발 ──
//     rnd_plans      제품기획      — 무엇을 왜 만들 것인가 (승인되면 과제로 전환)
//     rnd_projects   개발과제관리  — 기획을 실행 단위로 쪼갠 것. 아래 3종의 상위 키
//     rnd_specs      제품규격      — 개발 결과물의 확정 규격(개정 이력 포함)
//     rnd_milestones 개발일정      — 과제별 마일스톤 (계획 vs 실적)
//
//   ── 연구관리 ──
//     rnd_notes      연구기록      — 실험계획서 / 연구노트. 점검자 서명 후 잠금
//     rnd_knowledge  지식자산      — 원료지식·공정노하우·트러블슈팅 축적
//     rnd_collabs    협업관리      — 공동연구 상대·범위·공유수준·교류 이력
//
//   모든 도메인은 factory 로 분리한다(App.getFactory() 연동).
//   모든 도메인은 files[] 에 PhotoStore 메타를 담아 첨부를 지원한다.
// ============================================================

const RndDB = (() => {
  const PLAN_KEY  = 'rnd_plans';
  const PROJ_KEY  = 'rnd_projects';
  const SPEC_KEY  = 'rnd_specs';
  const MILE_KEY  = 'rnd_milestones';
  const NOTE_KEY  = 'rnd_notes';
  const KNOW_KEY  = 'rnd_knowledge';
  const COLLAB_KEY = 'rnd_collabs';
  const SEED_KEY  = 'rnd_seed_ver';
  const SEED_VERSION = '2026-08-14-rnd1';

  const now = () => new Date().toISOString();
  const notifyWrite = (key) => { try { if (typeof window !== 'undefined' && window.__onDbWrite) window.__onDbWrite(key); } catch (_) {} };
  const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) { return []; } };
  const write = (key, data) => { localStorage.setItem(key, JSON.stringify(data)); notifyWrite(key); };
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pad = (n, w) => String(n).padStart(w, '0');
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
  };

  // ============================================================
  // 공통 코드
  // ============================================================

  // ── 근거 문서 ──
  //   WS-FSMS-2311 신제품 개발 절차서 (SQF 모듈2 · 2.3.1 제품개발, 2024.09.02 제정)
  //   단계·체크항목·기록양식은 임의로 만든 것이 아니라 이 절차서 본문을 그대로 옮긴 것이다.
  //   절차서가 개정되면 여기 STEPS/STEP_CHECKS 를 같이 고쳐야 한다.
  const PROCEDURE = {
    docNo: 'WS-FSMS-2311',
    title: '신제품 개발 절차서',
    rev: '0 (2024.09.02 제정)',
    scope: '우성사료 신제품개발과 기존제품의 개선에 관한 업무',
  };

  // 기록 및 보존 (절차서 7항)
  const RECORDS = {
    PLAN_DOC:   { docNo: 'WS-FSMS-2311-01', label: '개발계획서',      dept: '제품혁신팀', keep: '3년' },
    RESULT_DOC: { docNo: 'WS-FSMS-2311-02', label: '개발결과보고서',  dept: '품질팀',     keep: '3년' },
  };

  // 설계개발관리 PROCESS 4구간 (절차서 8항 첨부)
  const PHASES = {
    P1: { label: '제품계획 및 설계', order: 1, owner: '제품혁신팀',
          output: '제품개발계획서 · 제품개발일정표', monitor: '일정관리 · 만족도조사 · 원가관리' },
    P2: { label: '제품개발',        order: 2, owner: '배합비팀 · 세일즈팀 · 구매팀 · 생산팀 · 품질팀 · 제품혁신팀',
          output: '제품규격 결정 · 비교관능검사 결과', monitor: '원부재료·생산Line 검토' },
    P3: { label: '시제품생산',      order: 3, owner: '제품혁신팀 · 생산팀',
          output: '시장성조사 · 사전원가산출서 · 원부재료규격 · 규격검사', monitor: '보존테스트 · 사전원가' },
    P4: { label: '생산 및 사후관리', order: 4, owner: '품질팀 · 생산팀',
          output: '품목제조보고서 · 제조공정표준 · 판매계획서 · 생산계획서', monitor: '변경관리에 의한 위해요소분석 갱신' },
  };
  const phaseMeta = (p) => PHASES[p] || PHASES.P1;
  const phaseList = () => Object.entries(PHASES).sort((a, b) => a[1].order - b[1].order);

  // 업무절차 13단계 (절차서 5.1 ~ 5.13) — 개발과제가 지나가는 실제 경로
  const STAGES = {
    S01: { no: '5.1',  label: '제품 개발계획',   phase: 'P1', order: 1,  cls: 'badge-default', owner: '제품혁신팀 · 세일즈팀' },
    S02: { no: '5.2',  label: '제품설계(입력)',  phase: 'P1', order: 2,  cls: 'badge-default', owner: '제품혁신팀' },
    S03: { no: '5.3',  label: '제품출력',        phase: 'P1', order: 3,  cls: 'badge-info',    owner: '배합비팀' },
    S04: { no: '5.4',  label: '제품심의(검토)',  phase: 'P1', order: 4,  cls: 'badge-info',    owner: '관련부서 · 사업본부장' },
    S05: { no: '5.5',  label: '제품개발실험',    phase: 'P2', order: 5,  cls: 'badge-info',    owner: '제품혁신팀 · 배합비팀' },
    S06: { no: '5.6',  label: '구매',            phase: 'P2', order: 6,  cls: 'badge-info',    owner: '구매팀' },
    S07: { no: '5.7',  label: '제품검증',        phase: 'P2', order: 7,  cls: 'badge-purple',  owner: '품질팀' },
    S08: { no: '5.8',  label: '시생산',          phase: 'P3', order: 8,  cls: 'badge-purple',  owner: '생산팀 · 제품혁신팀' },
    S09: { no: '5.9',  label: '유효성 확인',     phase: 'P3', order: 9,  cls: 'badge-purple',  owner: '품질팀 · 거래처' },
    S10: { no: '5.10', label: '제품개선시험',    phase: 'P3', order: 10, cls: 'badge-purple',  owner: '제품혁신팀' },
    S11: { no: '5.11', label: '규격확정',        phase: 'P3', order: 11, cls: 'badge-pass',    owner: '제품혁신팀 · 구매팀' },
    S12: { no: '5.12', label: '인계',            phase: 'P4', order: 12, cls: 'badge-pass',    owner: '생산팀' },
    S13: { no: '5.13', label: '상업생산',        phase: 'P4', order: 13, cls: 'badge-pass',    owner: '생산팀 · 품질팀' },
  };
  const stageMeta = (s) => STAGES[s] || STAGES.S01;
  const stageList = () => Object.entries(STAGES).sort((a, b) => a[1].order - b[1].order);
  const stagesOfPhase = (p) => stageList().filter(([, v]) => v.phase === p);

  // ============================================================
  // 담당 부서 설정
  //   위 STAGES/PHASES 의 owner 는 절차서 문구 그대로다(브랜드전략팀·제품혁신팀 등).
  //   조직 개편으로 팀명이 바뀌면 코드를 고치는 게 아니라 여기서 덮어쓴다.
  //   저장 형태가 배열인 이유: 동기화 계층이 id 를 가진 레코드 배열만 병합할 수 있다.
  // ============================================================
  const SETTINGS_KEY = 'rnd_settings';
  const SETTINGS_ID = 'rnd-settings';

  const getSettings = () => {
    const row = read(SETTINGS_KEY).find(x => x.id === SETTINGS_ID);
    return {
      stageOwners: (row && row.stageOwners) || {},
      phaseOwners: (row && row.phaseOwners) || {},
      updatedAt: row && row.updatedAt,
      updatedBy: row && row.updatedBy,
    };
  };
  const saveSettings = (patch, by) => {
    const list = read(SETTINGS_KEY).filter(x => x.id !== SETTINGS_ID);
    const cur = getSettings();
    const row = {
      id: SETTINGS_ID,
      stageOwners: { ...cur.stageOwners, ...(patch.stageOwners || {}) },
      phaseOwners: { ...cur.phaseOwners, ...(patch.phaseOwners || {}) },
      updatedAt: now(),
      updatedBy: by || '',
    };
    list.push(row);
    write(SETTINGS_KEY, list);
    return row;
  };
  // 빈 문자열로 저장된 항목은 "지정 안 함" 이 아니라 "절차서 기본값" 으로 되돌린다
  const stageOwner = (k) => {
    const o = getSettings().stageOwners[k];
    return (o && o.trim()) || stageMeta(k).owner;
  };
  const phaseOwner = (k) => {
    const o = getSettings().phaseOwners[k];
    return (o && o.trim()) || phaseMeta(k).owner;
  };
  const isOwnerCustom = (k) => !!(getSettings().stageOwners[k] || '').trim();
  const resetOwners = () => write(SETTINGS_KEY, read(SETTINGS_KEY).filter(x => x.id !== SETTINGS_ID));

  // 단계별 체크항목 — 절차서 본문의 조항을 그대로 옮겼다.
  //   "무엇을 해야 절차를 지킨 것인가"를 화면에서 바로 확인·기록하기 위한 것이며,
  //   심사 때 절차 준수 근거로 쓸 수 있도록 항목 문구를 임의로 줄이지 않았다.
  const STEP_CHECKS = {
    S01: [
      '시장조사 — 소비자 의식수준·소비방향·거래처 요구사항·경쟁상품 판매방향',
      '영업·상품기획의 시장조사 분석자료 접수',
      '경영진 지시 또는 본부 사업계획 반영 여부 확인',
      '직원 아이디어·제안 참조',
      '기술자료·외부정보로 소비자 니즈 파악',
      '영업본부 사업계획안 참조',
      '당사 제품 소비자 Claim 내용 분석',
      '종합 분석하여 제품 개발계획 구상',
    ],
    S02: [
      '제품계획 단계의 소비자 니즈·시장분석 자료 재분석',
      '출시 시점의 계절 요인·시장 경제상황 고려',
      '주 소비 대상(축종·일령·용도) 고려',
      '제품개발 소요 예산 산출',
      '제품명(가칭)·중량·형태·가격·포장방법 잠정 결정',
      '타사 유사제품 시장 판매가 검토',
      '법적 사항(사료관리법) 비교 검토',
    ],
    S03: [
      '현장 기계라인 조건·당사 상황을 고려한 개발조건 설정',
      '현 설비 고려 및 추가 설비 사용 여부 결정',
      '사료관리법에 의거 원료 사용 가부·사용량 결정',
      '설계 규격에 준하여 원료 종류·투입량·부재료·첨가물 반영한 배합비 작성',
    ],
    S04: [
      '관련부서가 제품개발계획서·제품개발일정표 검토 → 제품심의 체크리스트 기록',
      '일정 변경 필요 시 관련부서와 재조정',
      '배합비·현장 Line·개발목적·제품 원단위 판매가 등 개발조건 검토',
      '실험 원·부재료 도입시기 및 포장지 진행사항 검토',
      '사업본부장 제품심의 후 대표이사 최종결재 득함',
    ],
    S05: [
      '임시 배합비로 실험 제조 후 문제점 분석',
      '대조구·비대조구 비교 실험으로 세부 개선',
      '사내 관능검사 실시 및 자료 기록 유지',
      '단계 이행 시 자체 관능평가 → 제품설계 항목에 피드백',
      '유통기간 설정 필요 제품은 보존 테스트 병행(사료관리법)',
      '원·부재료 투입원가 비교하여 조정',
      '포장지 표기사항 작성 후 브랜드전략팀 인계(포장도안·원고)',
    ],
    S06: [
      '부재료 — 구입 용이성·품질 균일성 확보 경로 선정',
      '부재료 — 품질·단가 견적 비교, 필요 시 시험성적서 의뢰',
      '초도물량 원·부자재 구매규격(1톤당 소요량) 산출 후 내자팀 인계',
      '포장재 — 시제 진행과 연계하여 충분한 기간 검토',
      '포장재 — 영업허가 업체 중 신뢰도·공급안정성 기준 선정',
      '포장재 — 포장지 표기사항 지침서에 따라 제작·발주',
      '포장지 제작과정은 제품개발일정표에 따름',
    ],
    S07: [
      '품질팀 협조로 사내 품평회 실시',
      '필요 시 설문서 작성 후 관능검사 분석 지침서에 의거 결과 분석',
      '시장경쟁력 예측 및 검증결과에 따른 수정·보완',
    ],
    S08: [
      '재료·설비를 정규공정에 투입하여 시생산, 문제점 조치',
      '공정별 검사항목 Check — 불합리·낭비·불량 요인 조치',
      '공정별 수율 Check 및 원가 상승 영향 검토',
      '정상 조건 원칙, 악조건도 고려',
      'Pilot plant 제품과 관능 비교 후 부적합 요인 Feed back',
      '시생산 Data 분석 → 제조공정 및 제품특성 재조정·확정',
      '시생산 결과로 사전원가(제품 원단위) 산출',
      '포장자재(박스) 규격 확정 후 구매팀 업무협조 의뢰',
      '필요 시 시험분석의뢰서로 성분·규격시험 의뢰',
      '해당 시 보존 테스트 실시(수분 14% 이상)',
    ],
    S09: [
      '사내 또는 거래처 협조로 사양테스트 실시',
      '연령·품종을 다양하게 고려한 관능검사',
      '시장경쟁력 예측 및 제품 수정·보완',
    ],
    S10: [
      '유효성확인 단계 문제점에 대한 비교실험 반복 실시',
      '보완실험마다 비교 관능검사 실시',
      '수시로 현장 Line 시생산 후 문제점 검토·개선',
      '현장 시생산품이 Pilot plant 제품과 동일 품질 도달 시 개선실험 종료',
    ],
    S11: [
      '개선실험·관능검사·현장 시생산을 통해 배합비와 공정 확정',
      '원부재료 구입처·규격 조건을 구매팀과 협의 결정',
      '제조공정표준(작업표준서)·사전원가 산출서 작성 후 팀장 결재',
      '도청 축산과에 사료성분등록신청서 의뢰',
      '포장지 표기 중 미결정 원재료명·함량을 홍보담당자에게 통보',
      '필요 시 한국사료협회 연구소에 성분규격 검사 의뢰',
    ],
    S12: [
      '공정별 관리점을 명확히 하여 생산부서에 인계',
      '제조공정표준을 생산부서에 인계',
    ],
    S13: [
      '영업지원팀 판매계획서에 의거 생산계획 수립·계획생산',
      '제조공정도에 준하여 공정별 공정검사 실시',
      '기호성테스트로 기준제품과 비교하여 품질특성 유지',
      '필요 시 품질팀 Sample 채취·성분분석 의뢰 후 생산팀 피드백',
    ],
  };
  const checksOf = (stage) => STEP_CHECKS[stage] || [];

  const PLAN_STATUS = {
    DRAFT:    { label: '작성중', cls: 'badge-default' },
    REVIEW:   { label: '검토중', cls: 'badge-info' },
    APPROVED: { label: '승인',   cls: 'badge-pass' },
    HOLD:     { label: '보류',   cls: 'badge-warning' },
    REJECT:   { label: '반려',   cls: 'badge-fail' },
  };
  const PROJ_STATUS = {
    ACTIVE: { label: '진행중', cls: 'badge-info' },
    HOLD:   { label: '보류',   cls: 'badge-warning' },
    DONE:   { label: '완료',   cls: 'badge-pass' },
    DROP:   { label: '중단',   cls: 'badge-fail' },
  };
  const SPEC_STATUS = {
    DRAFT:    { label: '초안', cls: 'badge-default' },
    APPROVED: { label: '승인', cls: 'badge-pass' },
    REVISED:  { label: '개정', cls: 'badge-purple' },
    OBSOLETE: { label: '폐지', cls: 'badge-fail' },
  };
  const MILE_STATUS = {
    TODO:  { label: '예정',   cls: 'badge-default' },
    DOING: { label: '진행중', cls: 'badge-info' },
    DONE:  { label: '완료',   cls: 'badge-pass' },
    DELAY: { label: '지연',   cls: 'badge-fail' },
  };
  const PRIORITY = {
    HIGH: { label: '높음', cls: 'badge-fail' },
    MID:  { label: '보통', cls: 'badge-info' },
    LOW:  { label: '낮음', cls: 'badge-default' },
  };

  // 연구기록 — 실험계획서는 실험 전, 연구노트는 실험 후에 쓴다
  const NOTE_TYPES = {
    PLAN: { label: '실험계획서', cls: 'badge-info' },
    NOTE: { label: '연구노트',   cls: 'badge-purple' },
  };
  const KNOW_CATEGORIES = {
    MATERIAL: { label: '원료 지식' },
    PROCESS:  { label: '공정 노하우' },
    ANALYSIS: { label: '분석 기법' },
    TROUBLE:  { label: '트러블슈팅' },
    FORMULA:  { label: '배합 설계' },
    REF:      { label: '문헌·규제' },
    PATENT:   { label: '특허·지재권' },
  };
  const PARTNER_TYPES = {
    UNIV:     { label: '대학' },
    INST:     { label: '연구기관' },
    SUPPLIER: { label: '협력사' },
    CUSTOMER: { label: '고객사·농장' },
    INTERNAL: { label: '사내 부서' },
  };
  // 공유수준 — 공동연구는 어디까지 열어줄지가 항상 문제가 된다. 기록으로 남긴다.
  const SHARE_LEVELS = {
    OPEN:         { label: '공개',   cls: 'badge-pass' },
    LIMITED:      { label: '제한',   cls: 'badge-warning' },
    CONFIDENTIAL: { label: '기밀',   cls: 'badge-fail' },
  };
  const COLLAB_STATUS = {
    ACTIVE: { label: '진행중', cls: 'badge-info' },
    HOLD:   { label: '중지',   cls: 'badge-warning' },
    DONE:   { label: '종료',   cls: 'badge-pass' },
  };

  const meta = (map, k, fallback) => map[k] || map[fallback] || { label: k || '-', cls: 'badge-default' };

  // ============================================================
  // 공통 조회
  // ============================================================
  const byFactory = (list, factory) =>
    (!factory || factory === 'ALL') ? list : list.filter(x => x.factory === factory);

  const newest = (list) => list.slice().sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));

  // 문서번호 — 연도 2자리 + 일련번호. 같은 연도 안에서만 채번한다.
  const nextCode = (list, prefix) => {
    const yy = String(new Date().getFullYear()).slice(2);
    const head = `${prefix}-${yy}-`;
    const max = list
      .map(x => String(x.code || ''))
      .filter(c => c.startsWith(head))
      .reduce((m, c) => Math.max(m, parseInt(c.slice(head.length), 10) || 0), 0);
    return head + pad(max + 1, 3);
  };

  // ============================================================
  // 제품기획
  // ============================================================
  const getPlans = () => read(PLAN_KEY);
  const getPlanById = (id) => getPlans().find(x => x.id === id);
  const getPlansBy = (factory) => newest(byFactory(getPlans(), factory));

  const addPlan = (data) => {
    const list = getPlans();
    const item = {
      id: uid('PLN'),
      code: data.code || nextCode(list, 'PLN'),
      factory: data.factory || 'HQ',
      title: data.title || '',
      species: data.species || '',
      category: data.category || '',
      background: data.background || '',
      concept: data.concept || '',
      target: data.target || '',
      competitor: data.competitor || '',
      priceTarget: data.priceTarget || '',
      volumeTarget: data.volumeTarget || '',
      dueYear: data.dueYear || String(new Date().getFullYear()),
      // ── 절차서 5.1 제품 개발계획 ──
      marketResearch: data.marketResearch || '',   // 시장조사(의식수준·소비방향·거래처 요구·경쟁상품)
      ideaSource: data.ideaSource || '',           // 아이디어·제안·사업계획안 출처
      claimAnalysis: data.claimAnalysis || '',     // 소비자 Claim 분석 (VOC 연계)
      // ── 절차서 5.2 제품설계(입력) ──
      season: data.season || '',                   // 출시 시점 계절요인·시장 경제상황
      consumer: data.consumer || '',               // 주 소비 대상(축종·일령·용도)
      budget: Number(data.budget) || 0,            // 개발 소요 예산
      productForm: data.productForm || '',         // 형태(펠릿/매쉬/EP/크럼블)
      productWeight: data.productWeight || '',     // 중량·포장단위
      packaging: data.packaging || '',             // 포장방법
      legalReview: data.legalReview || '',         // 사료관리법 비교 검토
      proposer: data.proposer || '',
      proposedAt: data.proposedAt || todayStr(),
      status: data.status || 'DRAFT',
      decision: '', decidedBy: '', decidedAt: '',
      projectId: '',
      files: data.files || [],
      createdAt: now(), updatedAt: now(),
    };
    list.push(item); write(PLAN_KEY, list);
    return item;
  };

  const updatePlan = (id, patch) => {
    const list = getPlans();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, updatedAt: now() };
    write(PLAN_KEY, list);
    return list[i];
  };
  const removePlan = (id) => write(PLAN_KEY, getPlans().filter(x => x.id !== id));

  // 기획 승인 → 개발과제 자동 생성.
  //   손으로 다시 옮겨 적게 두면 기획서와 과제의 내용이 갈라진다. 승인 시점에 한 번만 복사하고
  //   이후에는 projectId 로 서로를 참조한다.
  const approvePlanToProject = (planId, opt = {}) => {
    const plan = getPlanById(planId);
    if (!plan) return null;
    if (plan.projectId && getProjectById(plan.projectId)) return getProjectById(plan.projectId);
    const proj = addProject({
      factory: plan.factory,
      name: plan.title,
      planId: plan.id,
      species: plan.species,
      goal: [plan.concept, plan.target].filter(Boolean).join(' / '),
      leader: opt.leader || plan.proposer,
      startDate: opt.startDate || todayStr(),
      dueDate: opt.dueDate || '',
      priority: opt.priority || 'MID',
    });
    updatePlan(planId, {
      status: 'APPROVED',
      projectId: proj.id,
      decision: opt.decision || plan.decision,
      decidedBy: opt.decidedBy || '',
      decidedAt: todayStr(),
    });
    return proj;
  };

  // ============================================================
  // 개발과제
  // ============================================================
  const getProjects = () => read(PROJ_KEY);
  const getProjectById = (id) => getProjects().find(x => x.id === id);
  const getProjectsBy = (factory) => newest(byFactory(getProjects(), factory));
  // 다른 화면(규격·일정·노트·협업)의 셀렉트 박스는 살아 있는 과제만 보여준다
  const getActiveProjects = (factory) =>
    getProjectsBy(factory).filter(p => p.status === 'ACTIVE' || p.status === 'HOLD');

  const addProject = (data) => {
    const list = getProjects();
    const item = {
      id: uid('PRJ'),
      code: data.code || nextCode(list, 'RND'),
      factory: data.factory || 'HQ',
      name: data.name || '',
      planId: data.planId || '',
      species: data.species || '',
      stage: data.stage || 'S01',
      // 단계별 절차 체크 — { S01: [true,false,...], ... }. 절차 준수 근거로 남는다.
      checks: data.checks || {},
      priority: data.priority || 'MID',
      leader: data.leader || '',
      members: data.members || '',
      startDate: data.startDate || todayStr(),
      dueDate: data.dueDate || '',
      budget: Number(data.budget) || 0,
      spent: Number(data.spent) || 0,
      progress: Number(data.progress) || 0,
      status: data.status || 'ACTIVE',
      goal: data.goal || '',
      result: data.result || '',
      // 개발결과보고서(WS-FSMS-2311-02) 항목
      resultCost: data.resultCost || '',
      resultSpecNo: data.resultSpecNo || '',
      resultReporter: data.resultReporter || '',
      resultDate: data.resultDate || '',
      files: data.files || [],
      createdAt: now(), updatedAt: now(),
    };
    list.push(item); write(PROJ_KEY, list);
    return item;
  };

  const updateProject = (id, patch) => {
    const list = getProjects();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, updatedAt: now() };
    write(PROJ_KEY, list);
    return list[i];
  };
  const removeProject = (id) => write(PROJ_KEY, getProjects().filter(x => x.id !== id));

  // 과제에 달린 산출물 수 — 카드에 "규격 2 · 노트 7 · 일정 5" 로 보여준다
  const projectCounts = (projectId) => ({
    specs: getSpecs().filter(x => x.projectId === projectId).length,
    notes: getNotes().filter(x => x.projectId === projectId).length,
    miles: getMilestones().filter(x => x.projectId === projectId).length,
    collabs: getCollabs().filter(x => x.projectId === projectId).length,
    knows: getKnowledge().filter(x => x.projectId === projectId).length,
  });

  // 마일스톤 실적으로 진척률을 되계산한다. 손으로 적은 progress 보다 이쪽이 사실에 가깝다.
  const calcProgress = (projectId) => {
    const ms = getMilestones().filter(x => x.projectId === projectId);
    if (!ms.length) return null;
    const done = ms.filter(m => m.status === 'DONE').length;
    return Math.round(done / ms.length * 100);
  };

  // 절차 체크 — 단계별 이행률. 심사에서 "어디까지 했나" 를 묻는 질문에 그대로 답이 된다.
  const checkState = (project, stage) => {
    const total = checksOf(stage).length;
    const arr = (project?.checks || {})[stage] || [];
    const done = arr.filter(Boolean).length;
    return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
  };
  const overallChecks = (project) => {
    let done = 0, total = 0;
    stageList().forEach(([k]) => { const s = checkState(project, k); done += s.done; total += s.total; });
    return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
  };
  const toggleCheck = (projectId, stage, idx, on) => {
    const p = getProjectById(projectId);
    if (!p) return null;
    const checks = { ...(p.checks || {}) };
    const arr = (checks[stage] || []).slice();
    while (arr.length < checksOf(stage).length) arr.push(false);
    arr[idx] = !!on;
    checks[stage] = arr;
    return updateProject(projectId, { checks });
  };

  // 다음 단계로 넘어가도 되는지 — 현재 단계 체크가 다 끝났는지 본다(경고용, 강제하지는 않는다)
  const canAdvance = (project) => {
    const s = checkState(project, project.stage);
    return s.total === 0 || s.done >= s.total;
  };

  // ============================================================
  // 제품규격
  // ============================================================
  const getSpecs = () => read(SPEC_KEY);
  const getSpecById = (id) => getSpecs().find(x => x.id === id);
  const getSpecsBy = (factory) => newest(byFactory(getSpecs(), factory));

  const addSpec = (data) => {
    const list = getSpecs();
    const item = {
      id: uid('SPC'),
      code: data.code || nextCode(list, 'SPC'),
      factory: data.factory || 'HQ',
      projectId: data.projectId || '',
      productCode: data.productCode || '',
      productName: data.productName || '',
      version: data.version || 'V1.0',
      status: data.status || 'DRAFT',
      items: Array.isArray(data.items) ? data.items : [],
      appearance: data.appearance || '',
      form: data.form || '',
      packaging: data.packaging || '',
      shelfLife: data.shelfLife || '',
      storage: data.storage || '',
      author: data.author || '',
      approver: data.approver || '',
      effDate: data.effDate || '',
      revisionNote: data.revisionNote || '',
      files: data.files || [],
      createdAt: now(), updatedAt: now(),
    };
    list.push(item); write(SPEC_KEY, list);
    return item;
  };

  const updateSpec = (id, patch) => {
    const list = getSpecs();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, updatedAt: now() };
    write(SPEC_KEY, list);
    return list[i];
  };
  const removeSpec = (id) => write(SPEC_KEY, getSpecs().filter(x => x.id !== id));

  // 개정 — 원본을 고치지 않고 새 버전을 만든다. 규격은 이력이 남아야 한다.
  const reviseSpec = (id, note, by) => {
    const src = getSpecById(id);
    if (!src) return null;
    const m = String(src.version || 'V1.0').match(/V?(\d+)\.(\d+)/i);
    const nextVer = m ? `V${m[1]}.${Number(m[2]) + 1}` : 'V1.1';
    updateSpec(id, { status: 'OBSOLETE' });
    return addSpec({
      ...src,
      id: undefined, code: src.code,
      version: nextVer,
      status: 'DRAFT',
      approver: '', effDate: '',
      revisionNote: note || '',
      author: by || src.author,
      items: JSON.parse(JSON.stringify(src.items || [])),
      files: [],
    });
  };

  // ============================================================
  // 개발일정 (마일스톤)
  // ============================================================
  const getMilestones = () => read(MILE_KEY);
  const getMilestoneById = (id) => getMilestones().find(x => x.id === id);
  const getMilestonesBy = (factory) => byFactory(getMilestones(), factory);
  const getMilestonesOf = (projectId) => getMilestones()
    .filter(x => x.projectId === projectId)
    .sort((a, b) => String(a.planStart || '').localeCompare(String(b.planStart || '')));

  const addMilestone = (data) => {
    const list = getMilestones();
    const item = {
      id: uid('MST'),
      factory: data.factory || 'HQ',
      projectId: data.projectId || '',
      title: data.title || '',
      phase: data.phase || 'PLAN',
      planStart: data.planStart || '',
      planEnd: data.planEnd || '',
      actualStart: data.actualStart || '',
      actualEnd: data.actualEnd || '',
      owner: data.owner || '',
      status: data.status || 'TODO',
      note: data.note || '',
      createdAt: now(), updatedAt: now(),
    };
    list.push(item); write(MILE_KEY, list);
    return item;
  };
  const updateMilestone = (id, patch) => {
    const list = getMilestones();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, updatedAt: now() };
    write(MILE_KEY, list);
    return list[i];
  };
  const removeMilestone = (id) => write(MILE_KEY, getMilestones().filter(x => x.id !== id));

  // 계획 종료일이 지났는데 완료가 아니면 지연. 상태를 손으로 바꾸길 기다리지 않는다.
  const effectiveMileStatus = (m) => {
    if (m.status === 'DONE') return 'DONE';
    if (m.planEnd && m.planEnd < todayStr()) return 'DELAY';
    return m.status || 'TODO';
  };

  // 과제 기본 마일스톤 — 절차서 5.1~5.13 을 그대로 일정표로 깔아준다.
  //   주차는 표준 소요기간의 초안일 뿐이므로 과제마다 조정해서 쓴다.
  const MILE_TEMPLATE = [
    ['S01', 0,  3],
    ['S02', 3,  5],
    ['S03', 5,  7],
    ['S04', 7,  8],
    ['S05', 8,  14],
    ['S06', 10, 16],
    ['S07', 14, 16],
    ['S08', 16, 20],
    ['S09', 20, 24],
    ['S10', 22, 28],
    ['S11', 28, 30],
    ['S12', 30, 31],
    ['S13', 31, 33],
  ];
  const seedMilestones = (projectId, factory, startDate) => {
    const d = new Date(startDate || todayStr());
    const step = (weeks) => {
      const t = new Date(d); t.setDate(t.getDate() + weeks * 7);
      return `${t.getFullYear()}-${pad(t.getMonth() + 1, 2)}-${pad(t.getDate(), 2)}`;
    };
    return MILE_TEMPLATE.map(([stage, s, e]) => addMilestone({
      factory, projectId,
      title: `${stageMeta(stage).no} ${stageMeta(stage).label}`,
      phase: stage,
      owner: stageOwner(stage),
      planStart: step(s), planEnd: step(e),
    }));
  };

  // ============================================================
  // 연구기록 (실험계획서 / 연구노트)
  // ============================================================
  const getNotes = () => read(NOTE_KEY);
  const getNoteById = (id) => getNotes().find(x => x.id === id);
  const getNotesBy = (factory) => newest(byFactory(getNotes(), factory));

  const addNote = (data) => {
    const list = getNotes();
    const item = {
      id: uid('NTE'),
      noteNo: data.noteNo || nextCode(list.map(x => ({ code: x.noteNo })), data.type === 'PLAN' ? 'EXP' : 'NTE'),
      factory: data.factory || 'HQ',
      projectId: data.projectId || '',
      type: data.type || 'NOTE',
      title: data.title || '',
      expDate: data.expDate || todayStr(),
      objective: data.objective || '',
      materials: data.materials || '',
      method: data.method || '',
      result: data.result || '',
      conclusion: data.conclusion || '',
      nextPlan: data.nextPlan || '',
      author: data.author || '',
      authorEmail: data.authorEmail || '',
      witness: '', witnessedAt: '',
      locked: false,
      files: data.files || [],
      createdAt: now(), updatedAt: now(),
    };
    list.push(item); write(NOTE_KEY, list);
    return item;
  };

  const updateNote = (id, patch) => {
    const list = getNotes();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return null;
    // 잠긴 노트는 본문을 못 고친다. 연구노트는 사후 수정 가능성이 있으면 증빙 가치가 없다.
    if (list[i].locked && !patch.__unlock) {
      const allowed = ['files'];
      patch = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
      if (!Object.keys(patch).length) return list[i];
    }
    delete patch.__unlock;
    list[i] = { ...list[i], ...patch, updatedAt: now() };
    write(NOTE_KEY, list);
    return list[i];
  };
  const removeNote = (id) => write(NOTE_KEY, getNotes().filter(x => x.id !== id));

  // 점검자 서명 → 잠금. 특허·과제 증빙에서 요구하는 최소 요건.
  const signNote = (id, witness) => updateNote(id, {
    __unlock: true, witness, witnessedAt: now(), locked: true,
  });

  // ============================================================
  // 지식자산
  // ============================================================
  const getKnowledge = () => read(KNOW_KEY);
  const getKnowledgeById = (id) => getKnowledge().find(x => x.id === id);
  const getKnowledgeBy = (factory) => newest(byFactory(getKnowledge(), factory));

  const addKnowledge = (data) => {
    const list = getKnowledge();
    const item = {
      id: uid('KNW'),
      code: data.code || nextCode(list, 'KNW'),
      factory: data.factory || 'HQ',
      category: data.category || 'PROCESS',
      title: data.title || '',
      summary: data.summary || '',
      body: data.body || '',
      tags: Array.isArray(data.tags) ? data.tags : String(data.tags || '').split(',').map(s => s.trim()).filter(Boolean),
      projectId: data.projectId || '',
      author: data.author || '',
      views: 0,
      files: data.files || [],
      createdAt: now(), updatedAt: now(),
    };
    list.push(item); write(KNOW_KEY, list);
    return item;
  };
  const updateKnowledge = (id, patch) => {
    const list = getKnowledge();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, updatedAt: now() };
    write(KNOW_KEY, list);
    return list[i];
  };
  const removeKnowledge = (id) => write(KNOW_KEY, getKnowledge().filter(x => x.id !== id));
  // 조회수는 updatedAt 을 건드리면 안 된다 — 열어보기만 해도 목록 맨 위로 올라와 버린다
  const bumpKnowledgeView = (id) => {
    const list = getKnowledge();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return;
    list[i].views = (Number(list[i].views) || 0) + 1;
    write(KNOW_KEY, list);
  };

  const allTags = (factory) => {
    const map = new Map();
    getKnowledgeBy(factory).forEach(k => (k.tags || []).forEach(t => map.set(t, (map.get(t) || 0) + 1)));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };

  // ============================================================
  // 협업관리
  // ============================================================
  const getCollabs = () => read(COLLAB_KEY);
  const getCollabById = (id) => getCollabs().find(x => x.id === id);
  const getCollabsBy = (factory) => newest(byFactory(getCollabs(), factory));

  const addCollab = (data) => {
    const list = getCollabs();
    const item = {
      id: uid('CLB'),
      code: data.code || nextCode(list, 'CLB'),
      factory: data.factory || 'HQ',
      projectId: data.projectId || '',
      partnerType: data.partnerType || 'UNIV',
      partnerName: data.partnerName || '',
      contactName: data.contactName || '',
      contactInfo: data.contactInfo || '',
      theme: data.theme || '',
      scope: data.scope || '',
      startDate: data.startDate || todayStr(),
      endDate: data.endDate || '',
      nda: !!data.nda,
      shareLevel: data.shareLevel || 'LIMITED',
      status: data.status || 'ACTIVE',
      logs: Array.isArray(data.logs) ? data.logs : [],
      files: data.files || [],
      createdAt: now(), updatedAt: now(),
    };
    list.push(item); write(COLLAB_KEY, list);
    return item;
  };
  const updateCollab = (id, patch) => {
    const list = getCollabs();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, updatedAt: now() };
    write(COLLAB_KEY, list);
    return list[i];
  };
  const removeCollab = (id) => write(COLLAB_KEY, getCollabs().filter(x => x.id !== id));

  const addCollabLog = (id, log) => {
    const c = getCollabById(id);
    if (!c) return null;
    const logs = (c.logs || []).concat([{
      id: uid('CLG'),
      date: log.date || todayStr(),
      kind: log.kind || '회의',
      summary: log.summary || '',
      by: log.by || '',
      at: now(),
    }]);
    return updateCollab(id, { logs });
  };
  const removeCollabLog = (id, logId) => {
    const c = getCollabById(id);
    if (!c) return null;
    return updateCollab(id, { logs: (c.logs || []).filter(l => l.id !== logId) });
  };

  // ============================================================
  // 통합 검색 — 지식자산 화면에서 "예전에 이거 해봤나?" 를 한 번에 확인
  // ============================================================
  const searchAll = (q, factory) => {
    const lq = String(q || '').trim().toLowerCase();
    if (!lq) return [];
    const hit = (...vals) => vals.some(v => String(v || '').toLowerCase().includes(lq));
    const out = [];
    getKnowledgeBy(factory).forEach(k => {
      if (hit(k.title, k.summary, k.body, (k.tags || []).join(' '))) out.push({ kind: '지식자산', page: 'rndKnowledge', id: k.id, title: k.title, sub: knowCatLabel(k.category), at: k.updatedAt });
    });
    getNotesBy(factory).forEach(n => {
      if (hit(n.title, n.objective, n.method, n.result, n.conclusion)) out.push({ kind: '연구기록', page: 'rndNote', id: n.id, title: n.title, sub: (NOTE_TYPES[n.type] || {}).label, at: n.updatedAt });
    });
    getProjectsBy(factory).forEach(p => {
      if (hit(p.name, p.goal, p.result, p.code)) out.push({ kind: '개발과제', page: 'rndProject', id: p.id, title: p.name, sub: p.code, at: p.updatedAt });
    });
    getCollabsBy(factory).forEach(c => {
      if (hit(c.partnerName, c.theme, c.scope)) out.push({ kind: '협업', page: 'rndCollab', id: c.id, title: c.theme || c.partnerName, sub: c.partnerName, at: c.updatedAt });
    });
    return out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 40);
  };
  const knowCatLabel = (c) => (KNOW_CATEGORIES[c] || { label: c }).label;

  // ============================================================
  // 시드 — 빈 화면이 아니라 "이렇게 쓰는 것" 이 보이도록 최소 예시만
  // ============================================================
  const initSampleData = () => {
    if (localStorage.getItem(SEED_KEY) === SEED_VERSION) return;
    localStorage.setItem(SEED_KEY, SEED_VERSION);
    if (getPlans().length || getProjects().length) return;

    const plan = addPlan({
      factory: 'HQ',
      title: '저단백 친환경 육성돈 사료',
      species: '양돈',
      category: '신제품',
      background: '분뇨 질소 배출 규제 강화 및 조단백 저감 요구 증가',
      concept: '아미노산 밸런스 보정으로 조단백 2%p 저감, 성장성적 동등 유지',
      target: '조단백 14% 이하 · 일당증체 동등 · 사료요구율 +2% 이내',
      competitor: '경쟁사 저단백 라인 대비 가격 동등 수준',
      priceTarget: '기존 대비 +2% 이내',
      volumeTarget: '연 3,000톤',
      marketResearch: '거래처 요구사항 조사 결과 분뇨 처리 부담 경감이 최우선. 경쟁사 2개 사가 저단백 라인을 선출시.',
      ideaSource: '영업본부 사업계획안 · 거래처 요구',
      claimAnalysis: 'VOC 역추적 화면의 최근 클레임 중 분뇨 악취 관련 건 검토',
      season: '하절기 출시 목표 — 고온기 사료섭취 저하 고려',
      consumer: '양돈 육성구간(30~60kg)',
      productForm: '펠릿',
      productWeight: '25kg 지대',
      packaging: '지대 · 벌크 병행',
      legalReview: '사료관리법 제11조 성분등록 대상 · 사용 가능 첨가물 범위 확인 필요',
      proposer: '제품혁신팀',
      status: 'REVIEW',
    });

    const proj = addProject({
      factory: 'HQ',
      name: '저단백 육성돈 사료 개발',
      planId: plan.id,
      species: '양돈',
      stage: 'S03',
      priority: 'HIGH',
      leader: '제품혁신팀',
      members: '배합비팀, 세일즈팀, 구매팀, 생산팀, 품질팀',
      goal: '조단백 2%p 저감 · 성장성적 동등',
      progress: 30,
    });
    seedMilestones(proj.id, 'HQ');

    addKnowledge({
      factory: 'HQ',
      category: 'PROCESS',
      title: '조질온도 저하 시 펠릿 외관 불량 패턴',
      summary: '조질 증기온도가 70℃ 아래로 내려가면 전분 호화가 부족해 표면 균열과 미분이 동시에 증가한다.',
      body: '수분을 올려도 온도가 낮으면 호화가 진행되지 않는다. 수분 보상으로 해결하려 하면 오히려 냉각 부하가 커져 잔수분 크랙이 늘어난다.\n조치 순서: 스팀 헤더 압력 확인 → 컨디셔너 리텐션 확보 → 그 다음 수분 조정.\n관련 화면: 배합비·생산 > 외관 시뮬레이터에서 조질온도를 내려 재현 가능.',
      tags: '펠릿,조질,호화,외관,미분',
      projectId: proj.id,
      author: '제품혁신팀',
    });
  };

  return {
    PROCEDURE, RECORDS, PHASES, STAGES, STEP_CHECKS,
    PLAN_STATUS, PROJ_STATUS, SPEC_STATUS, MILE_STATUS, PRIORITY,
    NOTE_TYPES, KNOW_CATEGORIES, PARTNER_TYPES, SHARE_LEVELS, COLLAB_STATUS,
    phaseMeta, phaseList, stageMeta, stageList, stagesOfPhase, checksOf,
    getSettings, saveSettings, stageOwner, phaseOwner, isOwnerCustom, resetOwners,
    checkState, overallChecks, toggleCheck, canAdvance,
    meta, todayStr,
    // 제품기획
    getPlans, getPlanById, getPlansBy, addPlan, updatePlan, removePlan, approvePlanToProject,
    // 개발과제
    getProjects, getProjectById, getProjectsBy, getActiveProjects,
    addProject, updateProject, removeProject, projectCounts, calcProgress,
    // 제품규격
    getSpecs, getSpecById, getSpecsBy, addSpec, updateSpec, removeSpec, reviseSpec,
    // 개발일정
    getMilestones, getMilestoneById, getMilestonesBy, getMilestonesOf,
    addMilestone, updateMilestone, removeMilestone, effectiveMileStatus, seedMilestones,
    // 연구기록
    getNotes, getNoteById, getNotesBy, addNote, updateNote, removeNote, signNote,
    // 지식자산
    getKnowledge, getKnowledgeById, getKnowledgeBy, addKnowledge, updateKnowledge,
    removeKnowledge, bumpKnowledgeView, allTags, knowCatLabel,
    // 협업관리
    getCollabs, getCollabById, getCollabsBy, addCollab, updateCollab, removeCollab,
    addCollabLog, removeCollabLog,
    // 통합 검색 · 시드
    searchAll, initSampleData,
  };
})();
