// ============================================================
// journal_db.js — 전자 일지(기록일지) 데이터 레이어
//   스마트HACCP 범용프로그램 가이드라인(식품업체용) 기준
//     · 일지설정관리 → 양식(템플릿) 마스터 : rows(점검항목) + targets(점검대상) + 주기 + 결재선
//     · 선행일지관리 / 성적서관리 / 관리일지 → 기록(레코드)
//     · 결재 워크플로우 : 작성중 → 상신 → 검토 → 승인 / 반려
//   목적: 종이 일지를 없애고 플랫폼에서 작성·결재·보관까지 끝낸다.
// ============================================================

const JournalDB = (() => {
  const TPL_KEY  = 'journal_templates';
  const REC_KEY  = 'journal_records';
  const LINE_KEY = 'journal_lines';
  const SEED_KEY = 'journal_seed_ver';
  const SEED_VERSION = '2026-08-03-sqf2';

  const now = () => new Date().toISOString();
  const notifyWrite = (key) => { try { if (typeof window !== 'undefined' && window.__onDbWrite) window.__onDbWrite(key); } catch (_) {} };
  const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) { return []; } };
  const write = (key, data) => { localStorage.setItem(key, JSON.stringify(data)); notifyWrite(key); };
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pad2 = (n) => String(n).padStart(2, '0');
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

  // ── 작성 주기 ──
  //   nextDue: 마지막 작성일 기준 다음 작성 기한 산출에 쓰이는 일수
  const CYCLES = {
    DAILY:     { label: '일일',  days: 1,   order: 1 },
    WEEKLY:    { label: '주간',  days: 7,   order: 2 },
    MONTHLY:   { label: '월간',  days: 31,  order: 3 },
    QUARTERLY: { label: '분기',  days: 92,  order: 4 },
    HALF:      { label: '반기',  days: 183, order: 5 },
    YEARLY:    { label: '연간',  days: 366, order: 6 },
    EVENT:     { label: '수시',  days: 0,   order: 7 },
  };
  const cycleLabel = (c) => (CYCLES[c] || CYCLES.EVENT).label;

  // ── 항목 입력 유형 ──
  //   CHECK/OX/SELECT 는 ngValues 에 해당하면 이탈, NUM 은 min~max 벗어나면 이탈
  const FIELD_TYPES = {
    CHECK:  { label: '적합/부적합', options: ['적합', '부적합'],          ng: ['부적합'] },
    GOOD:   { label: '양호/불량',   options: ['양호', '불량'],            ng: ['불량'] },
    OX:     { label: '양호/보통/불량', options: ['양호', '보통', '불량'], ng: ['불량'] },
    YN:     { label: '예/아니오',   options: ['예', '아니오'],            ng: ['아니오'] },
    DONE:   { label: '실시/미실시', options: ['실시', '미실시'],          ng: ['미실시'] },
    NUM:    { label: '수치(한계기준)', options: null, ng: [] },
    SELECT: { label: '선택',        options: [], ng: [] },
    TEXT:   { label: '텍스트',      options: null, ng: [] },
    TIME:   { label: '시각',        options: null, ng: [] },
  };

  // ── 일지 상태 ──
  const STATUS = {
    DRAFT:     { label: '작성중',   cls: 'badge-default', order: 1 },
    SUBMITTED: { label: '상신',     cls: 'badge-info',    order: 2 },
    REVIEWED:  { label: '검토완료', cls: 'badge-purple',  order: 3 },
    APPROVED:  { label: '승인완료', cls: 'badge-pass',    order: 4 },
    REJECTED:  { label: '반려',     cls: 'badge-fail',    order: 5 },
  };
  const statusMeta = (s) => STATUS[s] || STATUS.DRAFT;

  const CATEGORIES = ['선행요건', '중요관리점', '성적서', '교육', '법정서류', '기타'];

  // ============================================================
  // 표준 일지 양식 시드
  //   [A] 우성사료 SQF 매뉴얼(모듈4 선행요건 프로그램) 실제 기록 서식을 그대로 옮긴 것.
  //       code = 실제 문서번호. 원본: 품질 데이터/SQF/우성사료 SQF 매뉴얼_251212
  //   [B] SQF 서식이 없으나 사료 HACCP 선행요건상 필요한 일지(보완분).
  //   builtin:true 는 기본 제공 양식. 항목 수정/추가 가능하고,
  //   삭제 대신 미사용(active:false) 처리로 기록 이력을 보존한다.
  // ============================================================
  const SEED_TEMPLATES = [
    // ── [A] SQF 실서식 ──────────────────────────────────────
    {
      code: 'WSP-FSMS-404-01', name: '일일위생점검표', category: '선행요건', cycle: 'DAILY',
      note: 'SQF 모듈4 4-1. 개인위생부터 작업 전·중·후 위생상태와 폐기물까지 1일 1회 점검한다.',
      targets: [],
      rows: [
        { key: 'p1', group: '개인위생', label: '위생복, 위생모, 위생화, 작업복 등 착용상태 및 청결하게 관리되고 있는가?', type: 'CHECK' },
        { key: 'p2', group: '개인위생', label: '두발, 수염, 손톱 등 개인위생은 잘 지켜지고 있는가?', type: 'CHECK' },
        { key: 'p3', group: '개인위생', label: '시계, 반지, 목걸이, 머리핀 등 장신구 미착용 준수하는가?', type: 'CHECK' },
        { key: 'p4', group: '개인위생', label: '피부병, 감기 등 전염병 또는 사료 안전성에 영향을 주는 외상은 없는가?', type: 'CHECK' },
        { key: 'b1', group: '작업 전 위생상태', label: '기계, 기구 등의 설비는 청결한 상태인가?', type: 'CHECK' },
        { key: 'b2', group: '작업 전 위생상태', label: '제품과 접촉 장비(배합기 등), 도구의 내·외부 표면이 청결하게 유지되었는가?', type: 'CHECK' },
        { key: 'b3', group: '작업 전 위생상태', label: '청소도구는 일정 장소에 정리 정돈되어 있는가?', type: 'CHECK' },
        { key: 'b4', group: '작업 전 위생상태', label: '벽면, 천장은 먼지, 거미줄 등이 제거되어 청결하게 유지되고 있는가?', type: 'CHECK' },
        { key: 'b5', group: '작업 전 위생상태', label: '바닥 및 배수구는 청결하게 관리되며, 물이 고여 있거나 냄새가 나지 않는가?', type: 'CHECK' },
        { key: 'b6', group: '작업 전 위생상태', label: '포장재는 위생적으로 관리되고 있는가?', type: 'CHECK' },
        { key: 'm1', group: '작업 중 위생상태', label: '작업 중 흡연, 음식물 섭취, 껌 씹는 행위를 하지 않는가?', type: 'CHECK' },
        { key: 'm2', group: '작업 중 위생상태', label: '작업장 외부 및 화장실 출입 시 위생모 및 장갑 등을 벗고 가는가?', type: 'CHECK' },
        { key: 'm3', group: '작업 중 위생상태', label: '작업장 출입 시 손을 세척 또는 소독하는가?', type: 'CHECK' },
        { key: 'm4', group: '작업 중 위생상태', label: '사료를 오염되지 않도록 위생적으로 운반, 처리 또는 포장하는가?', type: 'CHECK' },
        { key: 'm5', group: '작업 중 위생상태', label: '버킷 엘리베이터 등의 상하차 시 청결하게 이용하는가?', type: 'CHECK' },
        { key: 'm6', group: '작업 중 위생상태', label: '바닥은 항상 청결하게 유지되고 있는가?', type: 'CHECK' },
        { key: 'a1', group: '작업 후 위생상태', label: '손은 수시로 소독하며, 장갑은 오염 시 교체하는가?', type: 'CHECK' },
        { key: 'a2', group: '작업 후 위생상태', label: '사용하였던 장비, 작업대, 기구 등은 깨끗이 세척·소독되어 정리되었는가?', type: 'CHECK' },
        { key: 'a3', group: '작업 후 위생상태', label: '위생복, 위생모, 위생화, 작업복 등 착용상태 및 청결하게 관리되고 있는가?', type: 'CHECK' },
        { key: 'a4', group: '작업 후 위생상태', label: '바닥, 배수구, 벽은 이물질 제거 및 청소되고 물이 고여 있지 않는가?', type: 'CHECK' },
        { key: 'w1', group: '폐기물', label: '폐기물은 위생적으로 처리 및 보관하고 있는가?', type: 'CHECK' },
      ],
    },
    {
      code: 'WSP-FSMS-404-04', name: '작업장 청소상태 점검표', category: '선행요건', cycle: 'DAILY',
      note: 'SQF 모듈4 4-4. 위생구역과 일반 작업구역의 청소상태를 구역별로 점검한다.',
      targets: [],
      rows: [
        { key: 'h1', group: '위생구역', label: '원료투입구', type: 'CHECK' },
        { key: 'h2', group: '위생구역', label: '냉동실', type: 'CHECK' },
        { key: 'h3', group: '위생구역', label: '해동실', type: 'CHECK' },
        { key: 'h4', group: '위생구역', label: '소포장', type: 'CHECK' },
        { key: 'g1', group: '작업 전 위생상태', label: '메인전실', type: 'CHECK' },
        { key: 'g2', group: '작업 전 위생상태', label: '원료창고 전실', type: 'CHECK' },
        { key: 'g3', group: '작업 전 위생상태', label: '제품창고 전실', type: 'CHECK' },
        { key: 'g4', group: '작업 전 위생상태', label: '냉동실', type: 'CHECK' },
        { key: 'g5', group: '작업 전 위생상태', label: '해동실', type: 'CHECK' },
        { key: 'g6', group: '작업 전 위생상태', label: '계량기', type: 'CHECK' },
        { key: 'g7', group: '작업 전 위생상태', label: '미분쇄', type: 'CHECK' },
        { key: 'g8', group: '작업 전 위생상태', label: '배합', type: 'CHECK' },
        { key: 'g9', group: '작업 전 위생상태', label: 'EXT', type: 'CHECK' },
        { key: 'g10', group: '작업 전 위생상태', label: 'DRY', type: 'CHECK' },
        { key: 'g11', group: '작업 전 위생상태', label: '쿨러', type: 'CHECK' },
        { key: 'g12', group: '작업 전 위생상태', label: '제품탱크(서비스)', type: 'CHECK' },
        { key: 'g13', group: '작업 전 위생상태', label: '액상코팅', type: 'CHECK' },
        { key: 'g14', group: '작업 전 위생상태', label: '소포장', type: 'CHECK' },
        { key: 'g15', group: '작업 전 위생상태', label: '원료창고', type: 'CHECK' },
      ],
    },
    {
      code: 'WSM-SB-720-03', name: '소독설비 점검표', category: '선행요건', cycle: 'WEEKLY',
      note: 'SQF 모듈4 5-2(방역관리). 주 1회 소독설비의 약품·작동상태를 점검한다.',
      targets: [],
      rows: [
        { key: 'c1', group: '정문 출입차량 소독설비', label: '약품준비(재고) 상태', type: 'GOOD' },
        { key: 'c2', group: '정문 출입차량 소독설비', label: '소독조 취수상태', type: 'GOOD' },
        { key: 'c3', group: '정문 출입차량 소독설비', label: '약품투입 여부', type: 'GOOD' },
        { key: 'c4', group: '정문 출입차량 소독설비', label: '소독기 작동상태', type: 'GOOD' },
        { key: 'v1', group: '출입자 소독설비', label: '약품준비(재고) 상태', type: 'GOOD' },
        { key: 'v2', group: '출입자 소독설비', label: '소독조 취수상태', type: 'GOOD' },
        { key: 'v3', group: '출입자 소독설비', label: '약품투입 여부', type: 'GOOD' },
        { key: 'v4', group: '출입자 소독설비', label: '소독기 작동상태', type: 'GOOD' },
        { key: 'f1', group: '발판 소독조', label: '약품준비(재고) 상태', type: 'GOOD' },
        { key: 'f2', group: '발판 소독조', label: '약품투입 여부', type: 'GOOD' },
        { key: 'f3', group: '발판 소독조', label: '소독기 청결상태', type: 'GOOD' },
        { key: 't1', group: '운송차량 소독시설', label: '소독약 충진상태', type: 'GOOD' },
        { key: 't2', group: '운송차량 소독시설', label: '소독기 작동상태', type: 'GOOD' },
        { key: 't3', group: '운송차량 소독시설', label: '간이 소독기 작동상태', type: 'GOOD' },
      ],
    },
    {
      code: 'WSP-FSMS-406-03', name: '냉장냉동창고 점검표', category: '선행요건', cycle: 'DAILY',
      note: 'SQF 모듈4 7-1. 냉동 -18℃ 이하, 해동 10℃ 이하. 1일 3회(오전10시·오후2시·오후5시) 실온 및 원료 심부온도를 측정한다.',
      targets: [],
      rows: [
        { key: 'q1', group: '위생품질', label: '바닥, 내벽, 천정 등이 청결한가?', type: 'CHECK' },
        { key: 'q2', group: '위생품질', label: '전등이 정상적으로 작동하는가?', type: 'CHECK' },
        { key: 'q3', group: '위생품질', label: '장비, 에어커튼, 문 작동 상태', type: 'CHECK' },
        { key: 'q4', group: '위생품질', label: '창고 안이 정리가 되어있는가?', type: 'CHECK' },
        { key: 'q5', group: '위생품질', label: '냉장고의 온도상태가 양호한가?', type: 'CHECK' },
        { key: 's1', group: '보관관리', label: '제품의 적재상태는 양호한가?', type: 'CHECK' },
        { key: 's2', group: '보관관리', label: '제품에 식별표시가 되어 있는가?', type: 'CHECK' },
        { key: 's3', group: '보관관리', label: '선입선출하고 있는가?', type: 'CHECK' },
        { key: 's4', group: '보관관리', label: '이격보관은 되어 있는가?', type: 'CHECK' },
        { key: 'e1', group: '환경관리', label: '바닥, 내벽, 천정, 문 파손이 없는가?', type: 'CHECK' },
        { key: 'e2', group: '환경관리', label: '소음, 진동, 녹, 떨림이 발생하지 않는가?', type: 'CHECK' },
        { key: 'z1', group: '온도관리(냉동)', label: '오전 10시 실온·원료 심부온도', type: 'NUM', unit: '℃', max: -18, std: '-18℃ 이하' },
        { key: 'z2', group: '온도관리(냉동)', label: '오후 2시 실온·원료 심부온도', type: 'NUM', unit: '℃', max: -18, std: '-18℃ 이하' },
        { key: 'z3', group: '온도관리(냉동)', label: '오후 5시 실온·원료 심부온도', type: 'NUM', unit: '℃', max: -18, std: '-18℃ 이하' },
        { key: 'd1', group: '온도관리(해동)', label: '오전 10시 해동온도·원료 심부온도', type: 'NUM', unit: '℃', max: 10, std: '10℃ 이하' },
        { key: 'd2', group: '온도관리(해동)', label: '오후 2시 해동온도·원료 심부온도', type: 'NUM', unit: '℃', max: 10, std: '10℃ 이하' },
        { key: 'd3', group: '온도관리(해동)', label: '오후 5시 해동온도·원료 심부온도', type: 'NUM', unit: '℃', max: 10, std: '10℃ 이하' },
        { key: 'd4', group: '해동 작업', label: '해동 시작시간', type: 'TIME' },
        { key: 'd5', group: '해동 작업', label: '해동 종료시간', type: 'TIME' },
      ],
    },
    {
      code: 'WSM-SC-410-02-1', name: '조도 기록표 (1공장)', category: '선행요건', cycle: 'HALF',
      note: 'SQF 모듈4 1-2. 연 2회(7월·10월) 측정. 작업면(바닥에서 1.2m) 기준, 사무실은 책상 위. 불합격 시 즉시 수리 후 재측정한다.',
      targets: [],
      rows: [
        { key: 'l1',  label: '약품1(투입구)',        type: 'NUM', unit: 'lx', min: 250, std: '250 lx 이상' },
        { key: 'l2',  label: '약품2(계량실)',        type: 'NUM', unit: 'lx', min: 300, std: '300 lx 이상' },
        { key: 'l3',  label: '원료(투입구)',         type: 'NUM', unit: 'lx', min: 150, std: '150 lx 이상' },
        { key: 'l4',  label: 'SILO하차(투입구)',     type: 'NUM', unit: 'lx', min: 150, std: '150 lx 이상' },
        { key: 'l5',  label: '투입반(사무실)',       type: 'NUM', unit: 'lx', min: 150, std: '150 lx 이상 · 책상 위' },
        { key: 'l6',  label: '가공1(기계전면)',      type: 'NUM', unit: 'lx', min: 150, std: '150 lx 이상' },
        { key: 'l7',  label: '가공2(사무실)',        type: 'NUM', unit: 'lx', min: 150, std: '150 lx 이상 · 책상 위' },
        { key: 'l8',  label: '벌크1(제품배출구)',    type: 'NUM', unit: 'lx', min: 200, std: '200 lx 이상' },
        { key: 'l9',  label: '벌크2(사무실)',        type: 'NUM', unit: 'lx', min: 150, std: '150 lx 이상' },
        { key: 'l10', label: '포장1(제품배출구)',    type: 'NUM', unit: 'lx', min: 300, std: '300 lx 이상' },
        { key: 'l11', label: '포장2(사무실)',        type: 'NUM', unit: 'lx', min: 150, std: '150 lx 이상 · 책상 위' },
        { key: 'l12', label: '조정실(운전데스크)',   type: 'NUM', unit: 'lx', min: 150, std: '150 lx 이상 · 책상 위' },
        { key: 'l13', label: '원료창고(창고중앙)',   type: 'NUM', unit: 'lx', min: 150, std: '150 lx 이상' },
        { key: 'l14', label: '제품창고(창고중앙)',   type: 'NUM', unit: 'lx', min: 150, std: '150 lx 이상' },
        { key: 'l15', label: '상차대(제품상차대)',   type: 'NUM', unit: 'lx', min: 200, std: '200 lx 이상' },
      ],
    },
    {
      code: 'WSM-SC-410-02-2', name: '조도 기록표 (2공장)', category: '선행요건', cycle: 'HALF',
      note: 'SQF 모듈4 1-2. 연 2회(7월·10월) 측정. 작업면(바닥에서 1.2m) 기준, 사무실은 책상 위.',
      targets: [],
      rows: [
        { key: 'l1',  label: '약품1(투입구)',      type: 'NUM', unit: 'lx', min: 250, std: '250 lx 이상' },
        { key: 'l2',  label: '약품2(계량실)',      type: 'NUM', unit: 'lx', min: 300, std: '300 lx 이상' },
        { key: 'l3',  label: '원료(투입구)',       type: 'NUM', unit: 'lx', min: 150, std: '150 lx 이상' },
        { key: 'l4',  label: '가공1(기계전면)',    type: 'NUM', unit: 'lx', min: 200, std: '200 lx 이상' },
        { key: 'l5',  label: '가공2(작업실)',      type: 'NUM', unit: 'lx', min: 150, std: '150 lx 이상' },
        { key: 'l6',  label: '포장1(포장양어)',    type: 'NUM', unit: 'lx', min: 300, std: '300 lx 이상' },
        { key: 'l7',  label: '포장2(포장반려)',    type: 'NUM', unit: 'lx', min: 300, std: '300 lx 이상' },
        { key: 'l8',  label: '조정실(운전데스크)', type: 'NUM', unit: 'lx', min: 150, std: '150 lx 이상 · 책상 위' },
        { key: 'l9',  label: '원료창고(창고중앙)', type: 'NUM', unit: 'lx', min: 150, std: '150 lx 이상' },
        { key: 'l10', label: '제품창고(창고중앙)', type: 'NUM', unit: 'lx', min: 150, std: '150 lx 이상' },
        { key: 'l11', label: '반려(포장)',         type: 'NUM', unit: 'lx', min: 300, std: '300 lx 이상' },
        { key: 'l12', label: '반려(소포장)',       type: 'NUM', unit: 'lx', min: 300, std: '300 lx 이상' },
      ],
    },
    {
      code: 'WSP-FSMS-410-01', name: '칼날 등록부', category: '선행요건', cycle: 'MONTHLY',
      note: 'SQF 모듈4 10. 구역별 칼날 보유 수량을 매월 실사한다. 등록 수량과 다르면 즉시 분실 조사 대상.',
      targets: [],
      rows: [
        { key: 'h1', group: '위생구역', label: '원료투입구', type: 'NUM', unit: '개' },
        { key: 'h2', group: '위생구역', label: '냉동실', type: 'NUM', unit: '개' },
        { key: 'h3', group: '위생구역', label: '해동실', type: 'NUM', unit: '개' },
        { key: 'h4', group: '위생구역', label: '소포장', type: 'NUM', unit: '개' },
        { key: 'g1', group: '일반구역', label: '메인전실', type: 'NUM', unit: '개' },
        { key: 'g2', group: '일반구역', label: '원료창고 전실', type: 'NUM', unit: '개' },
        { key: 'g3', group: '일반구역', label: '제품창고 전실', type: 'NUM', unit: '개' },
        { key: 'g4', group: '일반구역', label: '계량기', type: 'NUM', unit: '개' },
        { key: 'g5', group: '일반구역', label: '미분쇄', type: 'NUM', unit: '개' },
        { key: 'g6', group: '일반구역', label: '배합', type: 'NUM', unit: '개' },
        { key: 'g7', group: '일반구역', label: 'EXT', type: 'NUM', unit: '개' },
        { key: 'g8', group: '일반구역', label: 'DRY', type: 'NUM', unit: '개' },
        { key: 'g9', group: '일반구역', label: '쿨러', type: 'NUM', unit: '개' },
        { key: 'g10', group: '일반구역', label: '제품탱크(서비스)', type: 'NUM', unit: '개' },
        { key: 'g11', group: '일반구역', label: '액상코팅', type: 'NUM', unit: '개' },
        { key: 'g12', group: '일반구역', label: '원료창고', type: 'NUM', unit: '개' },
        { key: 'g13', group: '일반구역', label: '사무실', type: 'NUM', unit: '개' },
        { key: 'x1', group: '점검 결과', label: '등록 수량과 실사 수량 일치', type: 'CHECK' },
      ],
    },
    {
      code: 'WSP-FSMS-409-02', name: '유리·플라스틱 점검표', category: '선행요건', cycle: 'MONTHLY',
      note: 'SQF 모듈4 9. 월 1회 등록부(WSP-FSMS-409-01) 기준으로 파손 여부를 점검한다. 파손 발견 시 즉시 생산 중단·격리 대상.',
      targetLabel: '점검 구역',
      targets: ['1층 소포장실', '1층 원료창고', '2층 생육가공실', '2M층 냉동실', '4층 투입구', '4층 수투입구'],
      rows: [
        { key: 'win',  label: '창호·Sight Glass 파손 유무', type: 'CHECK' },
        { key: 'led',  label: '조명(LED커버·포충등) 파손 유무', type: 'CHECK' },
        { key: 'tool', label: '청소용구·플라스틱 기구 파손 유무', type: 'CHECK' },
        { key: 'cnt',  label: '등록 수량 일치', type: 'CHECK' },
      ],
    },
    {
      code: 'WSP-FSMS-402-07', name: '유지보수 작업 위생 승인서', category: '선행요건', cycle: 'EVENT',
      note: 'SQF 모듈4 2-7. 유지보수 작업 전 사전 승인, 작업 후 위생 확인을 거쳐야 생산을 재개할 수 있다.',
      targets: [],
      rows: [
        { key: 'i1', group: '작업 정보', label: '유지보수 내용', type: 'TEXT' },
        { key: 'i2', group: '작업 정보', label: '유지보수 업체명 / 담당자명', type: 'TEXT' },
        { key: 'c1', group: '확인 내용', label: '유지보수 작업 사전 승인이 되었습니까?', type: 'YN' },
        { key: 'c2', group: '확인 내용', label: '식품에 오염의 위험이 없는 방식으로 작업이 수행되었습니까?', type: 'YN' },
        { key: 'c3', group: '확인 내용', label: '모든 생산 작업이 중단된 후 유지보수 작업이 실행되었습니까?', type: 'YN' },
        { key: 'c4', group: '확인 내용', label: '모든 유지보수 직원이 회사 위생 정책과 구역별 위생복장 규정을 준수하고 있습니까?', type: 'YN' },
        { key: 'c5', group: '확인 내용', label: '관리자가 수리를 승인했습니까?', type: 'YN' },
        { key: 'c6', group: '확인 내용', label: '유지보수에 사용하는 화학물질이 식품 등급으로 사용되고 있습니까?', type: 'YN' },
        { key: 'c7', group: '확인 내용', label: '모든 유지보수 작업이 끝나면 재료·도구 등이 제거되고 철저한 청소가 이루어졌습니까?', type: 'YN' },
        { key: 'o1', group: '운영 사전 검사', label: '유지보수 설비 세척소독을 실시하였습니까?', type: 'YN' },
        { key: 'o2', group: '운영 사전 검사', label: '유지보수 작업 후 주변 재료 등 철저히 제거되고 청소되었습니까?', type: 'YN' },
      ],
    },
    {
      code: 'WSP-FSMS-404-03', name: '출입자 보건 문진표', category: '선행요건', cycle: 'EVENT',
      note: 'SQF 모듈4 4-3(개인위생 행동강령). 외부 출입자 작성. "예"가 하나라도 있으면 출입 제한 검토 대상이다.',
      targets: [],
      rows: [
        { key: 'n1', group: '출입자 정보', label: '성명', type: 'TEXT' },
        { key: 'n2', group: '출입자 정보', label: '소속(회사명)', type: 'TEXT' },
        { key: 'n3', group: '출입자 정보', label: '연락처', type: 'TEXT' },
        { key: 'q1', group: '건강 상태 문진', label: '현재 발열(37.5℃ 이상), 기침, 인후통, 호흡곤란, 설사, 구토 등 증상이 있다', type: 'YN', ng: ['예'] },
        { key: 'q2', group: '건강 상태 문진', label: '최근 7일 이내 감기(독감·코로나 포함) 또는 장염 등으로 진단·치료를 받은 적이 있다', type: 'YN', ng: ['예'] },
        { key: 'q3', group: '건강 상태 문진', label: '최근 7일 이내 감염병 환자(가족·동거인·밀접접촉자)와 접촉한 사실이 있다', type: 'YN', ng: ['예'] },
        { key: 'q4', group: '건강 상태 문진', label: '최근 14일 이내 해외 또는 감염병 고위험 지역을 방문한 이력이 있다', type: 'YN', ng: ['예'] },
        { key: 'q5', group: '건강 상태 문진', label: '현재 복용 중인 약(감염성 질환 관련)이 있다', type: 'YN', ng: ['예'] },
      ],
    },
    {
      code: 'DOC-N-400-01-01', name: '공정별 DB 청소현황 (1공장)', category: '선행요건', cycle: 'QUARTERLY',
      note: 'SQF 모듈4 1-6 공장관리대장. 분기 1회 청소. 2공장·신공장 설비는 양식 설정에서 대상을 추가하세요.',
      targetLabel: '설비(DB) 번호',
      targets: ['DB-185', 'DB-191', 'DB-257', 'DB-268', 'DB-273', 'DB-278', 'DB-283', 'DB-283B',
        'DB-311', 'DB-318', 'DB-328B', 'DB-331', 'DB-383', 'DB-487', 'DB-491', 'DB-494', 'DB-497',
        'DB-561', 'DB-682', 'DB-756', 'DB-758', 'DB-760', 'DB-41', 'DB-725',
        'DB-2004', 'DB-2005', 'DB-2055', 'DB-2148', 'DB-2188', 'DB-2533', 'DB-2535', 'DB-2806',
        'DB-906', 'DB-964'],
      rows: [
        { key: 'done', label: '청소 실시', type: 'DONE' },
        { key: 'chk',  label: '점검내역', type: 'TEXT' },
        { key: 'memo', label: '특이사항', type: 'TEXT' },
      ],
    },
    {
      code: 'DOC-N-400-01-03', name: '공정별 원료탱크 청소현황 (양축)', category: '선행요건', cycle: 'QUARTERLY',
      note: 'SQF 모듈4 1-6 공장관리대장. 분기 1회 청소. 특수원료탱크·2공장·신공장 탱크는 양식 설정에서 대상을 추가하세요.',
      targetLabel: 'Tank No.',
      targets: ['GT-1', 'GT-2', 'GT-3', 'GT-4', 'GT-5', 'GT-6', 'GT-7', 'GT-8', 'GT-9', 'GT-10',
        'GT-11', 'GT-12', 'GT-13', 'GT-14', 'T-13', 'T-556',
        'BT-1', 'BT-2', 'BT-3', 'BT-4', 'BT-5', 'BT-6', 'BT-7', 'BT-8', 'BT-9', 'BT-10',
        'BT-11', 'BT-12', 'BT-13', 'BT-14', 'BT-15', 'BT-16', 'BT-17', 'BT-18', 'BT-19', 'BT-20',
        'BT-21', 'BT-22', 'BT-23', 'BT-24', 'BT-25', 'BT-26', 'BT-27', 'BT-28', 'BT-29', 'BT-30',
        'BT-31', 'BT-32', 'BT-33', 'BT-34', 'BT-35', 'BT-36', 'BT-37', 'BT-38', 'BT-39', 'BT-40',
        'BT-41', 'BT-42', 'BT-43', 'BT-44', 'BT-53', 'BT-54',
        'BT-45', 'BT-46', 'BT-47', 'BT-48', 'BT-49', 'BT-50', 'BT-51', 'BT-52'],
      rows: [
        { key: 'done', label: '청소 실시', type: 'DONE' },
        { key: 'chk',  label: '점검내역', type: 'TEXT' },
        { key: 'memo', label: '특이사항', type: 'TEXT' },
      ],
    },

    // ── [B] SQF 서식 미보유 · HACCP 선행요건 보완 ────────────
    {
      code: 'PR-02', name: '작업장 온·습도 점검일지', category: '선행요건', cycle: 'DAILY',
      note: '보관·작업 구역의 온습도를 1일 1회 이상 측정한다. 습도 70% 초과 시 곰팡이 위험.',
      targets: ['원료창고', '배합실', '포장실', '제품창고'],
      rows: [
        { key: 'temp', label: '온도',   type: 'NUM', unit: '℃', min: 0,  max: 35, std: '35℃ 이하' },
        { key: 'hum',  label: '습도',   type: 'NUM', unit: '%', min: 0,  max: 70, std: '70% 이하' },
        { key: 'memo', label: '특이사항', type: 'TEXT' },
      ],
    },
    {
      code: 'PR-05', name: '창고 보관관리 점검일지', category: '선행요건', cycle: 'DAILY',
      note: '선입선출 및 벽·바닥 이격(15cm)은 사료관리법 및 HACCP 선행요건 필수 항목.',
      targets: ['원료창고', '부자재창고', '제품창고'],
      rows: [
        { key: 'fifo',  label: '선입선출 준수',      type: 'CHECK' },
        { key: 'gap',   label: '벽·바닥 이격(15cm)', type: 'CHECK' },
        { key: 'pal',   label: '파렛트 상태',        type: 'OX' },
        { key: 'sep',   label: '구분 보관(축종·항생제)', type: 'CHECK' },
        { key: 'memo',  label: '특이사항',           type: 'TEXT' },
      ],
    },
    {
      code: 'PR-06', name: '용수 관리 일지', category: '선행요건', cycle: 'DAILY',
      note: '수돗물 외 지하수 사용 시 잔류염소 0.1ppm 이상 유지.',
      targets: [],
      rows: [
        { key: 'cl',   label: '잔류염소',    type: 'NUM', unit: 'ppm', min: 0.1, max: 4.0, std: '0.1~4.0ppm' },
        { key: 'ph',   label: 'pH',          type: 'NUM', unit: '',    min: 5.8, max: 8.5, std: '5.8~8.5' },
        { key: 'turb', label: '탁도',        type: 'NUM', unit: 'NTU', min: 0,   max: 0.5, std: '0.5 NTU 이하' },
        { key: 'odor', label: '이취·이물 유무', type: 'CHECK' },
        { key: 'tank', label: '저수조 상태',  type: 'OX' },
      ],
    },
    {
      code: 'PR-07', name: '공정관리 확인일지', category: '선행요건', cycle: 'DAILY',
      note: '배합 순서·시간 이탈은 제품 균질성과 약물 이월(carry-over)에 직결된다.',
      targets: [],
      rows: [
        { key: 'order', label: '배합 순서 준수',       type: 'CHECK' },
        { key: 'time',  label: '배합 시간 준수',       type: 'CHECK' },
        { key: 'qty',   label: '투입량 확인',          type: 'CHECK' },
        { key: 'label', label: '라벨·표시사항 확인',   type: 'CHECK' },
        { key: 'cross', label: '교차오염 방지 조치',   type: 'DONE' },
        { key: 'flush', label: '잔량·플러싱 처리',     type: 'DONE' },
      ],
    },
    {
      code: 'PR-08', name: '계량·저울 점검일지', category: '선행요건', cycle: 'DAILY',
      note: '표준분동으로 영점 및 오차를 확인한다. 검교정 주기는 계측기 검교정 화면에서 관리.',
      targets: ['배합저울', '포장저울', '계근대'],
      rows: [
        { key: 'zero', label: '영점 확인',      type: 'DONE' },
        { key: 'std',  label: '표준분동 값',    type: 'NUM', unit: 'kg' },
        { key: 'err',  label: '오차',           type: 'NUM', unit: 'kg', min: -0.5, max: 0.5, std: '±0.5kg 이내' },
        { key: 'state', label: '작동 상태',     type: 'OX' },
      ],
    },
    {
      code: 'PR-09', name: '차량·벌크차 세척점검 일지', category: '선행요건', cycle: 'EVENT',
      note: '벌크 출하 전 차량 내부 잔류물·이물을 확인한다.',
      targets: [],
      rows: [
        { key: 'plate', label: '차량번호',        type: 'TEXT' },
        { key: 'wash',  label: '세척 실시',       type: 'DONE' },
        { key: 'resid', label: '잔류물 확인',     type: 'CHECK' },
        { key: 'seal',  label: '밀폐 상태',       type: 'CHECK' },
        { key: 'drv',   label: '운전자 위생 상태', type: 'CHECK' },
      ],
    },
    {
      code: 'PR-10', name: '방충·방서 점검일지', category: '선행요건', cycle: 'MONTHLY',
      note: '자체 점검용. 외부 방역업체 리포트는 구서관리 화면에서 별도 관리한다.',
      targets: ['포충등 1', '포충등 2', '포충등 3', '트랩 구역 A', '트랩 구역 B'],
      rows: [
        { key: 'cnt',   label: '포집 마릿수', type: 'NUM', unit: '마리', min: 0, max: 30, std: '30마리 이하' },
        { key: 'clean', label: '청소 실시',   type: 'DONE' },
        { key: 'state', label: '설치 상태',   type: 'OX' },
        { key: 'gap',   label: '외부 유입경로 차단', type: 'CHECK' },
      ],
    },
    {
      code: 'PR-11', name: '압축공기 관리 일지', category: '선행요건', cycle: 'MONTHLY',
      note: '제품에 직접 접촉하는 압축공기는 필터·오일 관리가 필요하다.',
      targets: ['컴프레서 1', '컴프레서 2'],
      rows: [
        { key: 'filter', label: '필터 상태',   type: 'OX' },
        { key: 'drain',  label: '드레인 배출', type: 'DONE' },
        { key: 'oil',    label: '오일 누출 유무', type: 'CHECK' },
        { key: 'press',  label: '압력', type: 'NUM', unit: 'kg/㎠', min: 4, max: 9, std: '4~9 kg/㎠' },
      ],
    },
    {
      code: 'PR-13', name: '폐기물·부적합품 관리 일지', category: '선행요건', cycle: 'EVENT',
      note: '부적합품은 식별 표시 후 별도 격리 보관한다.',
      targets: [],
      rows: [
        { key: 'item',  label: '품목명',      type: 'TEXT' },
        { key: 'qty',   label: '수량',        type: 'NUM', unit: 'kg' },
        { key: 'cause', label: '발생 사유',   type: 'TEXT' },
        { key: 'iso',   label: '격리 보관 조치', type: 'DONE' },
        { key: 'disp',  label: '처리 방법',   type: 'SELECT', options: ['폐기', '반품', '재작업', '용도전환'] },
      ],
    },
    {
      code: 'CP-01', name: '자석(마그넷) 점검일지', category: '중요관리점', cycle: 'DAILY',
      note: '금속 이물 제거 CCP. 부착 이물 제거 미실시는 즉시 개선조치 대상.',
      targets: ['투입구 마그넷', '배합기 전단 마그넷', '출하 마그넷'],
      rows: [
        { key: 'clean', label: '부착 이물 제거', type: 'DONE' },
        { key: 'amt',   label: '이물량',         type: 'NUM', unit: 'g' },
        { key: 'force', label: '자력 상태',      type: 'OX' },
        { key: 'fix',   label: '고정 상태',      type: 'CHECK' },
      ],
    },
    {
      code: 'CP-02', name: '금속검출기 점검일지', category: '중요관리점', cycle: 'DAILY',
      note: '시험편(Fe/SUS) 통과 시 반드시 검출되어야 한다. 미검출은 한계기준 이탈.',
      targets: ['포장라인 1', '포장라인 2'],
      rows: [
        { key: 'fe',   label: 'Fe 시험편 검출',  type: 'SELECT', options: ['검출', '미검출'], ng: ['미검출'] },
        { key: 'sus',  label: 'SUS 시험편 검출', type: 'SELECT', options: ['검출', '미검출'], ng: ['미검출'] },
        { key: 'rej',  label: '배출장치 작동',   type: 'DONE' },
        { key: 'cnt',  label: '검출 건수',       type: 'NUM', unit: '건' },
      ],
    },
    {
      code: 'RP-01', name: '표면오염도 검사 성적서', category: '성적서', cycle: 'MONTHLY',
      note: 'ATP 측정으로 세척 효과를 확인한다.',
      targets: ['배합기 내부', '포장기 슈트', '컨베이어', '작업자 손'],
      rows: [
        { key: 'atp', label: 'ATP',      type: 'NUM', unit: 'RLU',   min: 0, max: 200, std: '200 RLU 이하' },
        { key: 'tpc', label: '일반세균', type: 'NUM', unit: 'CFU/㎠', min: 0, max: 100, std: '100 CFU/㎠ 이하' },
        { key: 'act', label: '재세척 실시', type: 'DONE' },
      ],
    },
    {
      code: 'RP-02', name: '공중낙하균 검사 성적서', category: '성적서', cycle: 'MONTHLY',
      note: '구역별 15분 노출 배지법.',
      targets: ['배합실', '포장실', '제품창고'],
      rows: [
        { key: 'tpc',   label: '일반세균', type: 'NUM', unit: 'CFU/plate', min: 0, max: 30, std: '30 이하' },
        { key: 'fungi', label: '진균',     type: 'NUM', unit: 'CFU/plate', min: 0, max: 10, std: '10 이하' },
      ],
    },
    {
      code: 'ED-01', name: '위생교육 훈련일지', category: '교육', cycle: 'EVENT',
      note: 'HACCP 팀원 및 종업원 정기 교육 실시 기록.',
      targets: [],
      rows: [
        { key: 'title',  label: '교육명',     type: 'TEXT' },
        { key: 'tutor',  label: '강사',       type: 'TEXT' },
        { key: 'hours',  label: '교육시간',   type: 'NUM', unit: '시간' },
        { key: 'plan',   label: '대상 인원',  type: 'NUM', unit: '명' },
        { key: 'attend', label: '참석 인원',  type: 'NUM', unit: '명' },
        { key: 'body',   label: '교육 내용',  type: 'TEXT' },
        { key: 'eval',   label: '이해도 평가', type: 'OX' },
      ],
    },

    // ── [C] 구 HACCP 일지 / SQF 일지에만 있던 유형 보완 ─────────
    {
      code: 'PR-14', name: 'PRP(선행요건) 종합 모니터링', category: '선행요건', cycle: 'WEEKLY',
      note: '개별 점검일지로 다루지 않는 선행요건 항목을 주 1회 종합 확인한다. 구 SQF 일지의 "PRP 모니터링"을 대체.',
      targets: [],
      rows: [
        { key: 'water',  label: '용수·배수 관리 상태',        type: 'CHECK' },
        { key: 'waste',  label: '폐기물 보관·처리 상태',      type: 'CHECK' },
        { key: 'pest',   label: '방충·방서 시설 상태',        type: 'CHECK' },
        { key: 'chem',   label: '화학물질(세척·소독제) 보관', type: 'CHECK' },
        { key: 'store',  label: '보관창고 정리·이격',         type: 'CHECK' },
        { key: 'flow',   label: '동선·교차오염 방지',         type: 'CHECK' },
        { key: 'train',  label: '작업자 위생교육 이행',       type: 'CHECK' },
        { key: 'memo',   label: '특이사항',                   type: 'TEXT' },
      ],
    },
    {
      code: 'PR-15', name: '공급업체 평가 기록', category: '선행요건', cycle: 'YEARLY',
      note: '협력사 정기 평가 결과를 기록한다. 협력사 마스터·등급은 협력사 관리 화면에서 관리.',
      targets: [],
      rows: [
        { key: 'sup',    label: '업체명',                type: 'TEXT' },
        { key: 'item',   label: '공급 품목',             type: 'TEXT' },
        { key: 'cert',   label: '인증서·시험성적서 확인', type: 'CHECK' },
        { key: 'qual',   label: '납품 품질 이력',         type: 'OX' },
        { key: 'deliv',  label: '납기 준수',             type: 'OX' },
        { key: 'audit',  label: '현장 실사 실시',        type: 'DONE' },
        { key: 'grade',  label: '종합 등급',             type: 'SELECT', options: ['A', 'B', 'C', 'D'], ng: ['C', 'D'] },
      ],
    },
    {
      code: 'CP-03', name: 'CCP 검증 기록', category: '중요관리점', cycle: 'MONTHLY',
      note: '월 1회 CCP 모니터링이 계획대로 수행되는지 검증한다. 구 HACCP 일지의 "검증"을 대체.',
      targets: [],
      rows: [
        { key: 'mon',   label: '모니터링 주기 준수 확인',       type: 'CHECK' },
        { key: 'rec',   label: '기록 누락 없음',                type: 'CHECK' },
        { key: 'lim',   label: '한계기준 적정성 확인',          type: 'CHECK' },
        { key: 'cal',   label: '모니터링 장비 검교정 유효',     type: 'CHECK' },
        { key: 'dev',   label: '이탈 발생 시 개선조치 이행 확인', type: 'CHECK' },
        { key: 'devn',  label: '당월 이탈 건수',                type: 'NUM', unit: '건' },
        { key: 'memo',  label: '검증 결론',                    type: 'TEXT' },
      ],
    },
    {
      code: 'MIG-01', name: '이관 기록 (구 HACCP·SQF 일지)', category: '기타', cycle: 'EVENT',
      note: '구 HACCP 일지·SQF 일지에서 옮겨온 과거 기록입니다. 원본 항목을 그대로 보존합니다. 신규 작성에는 사용하지 마세요.',
      targets: [],
      rows: [
        { key: 'src',    label: '출처',        type: 'TEXT' },
        { key: 'type',   label: '원래 유형',   type: 'TEXT' },
        { key: 'target', label: '대상/항목',   type: 'TEXT' },
        { key: 'value',  label: '측정값/결과', type: 'TEXT' },
        { key: 'judged', label: '판정',        type: 'CHECK' },
        { key: 'memo',   label: '특이사항',    type: 'TEXT' },
      ],
    },
  ];

  // ── 시드 ──
  //   기존 사용자 편집분을 덮어쓰지 않도록 code 기준으로 없는 양식만 추가한다.
  //   시드 버전이 바뀌면 "기록이 한 건도 없는 기본제공 양식"만 걷어내고 최신 서식으로 다시 깐다.
  //   (사용자가 직접 만든 양식과 이미 작성된 일지가 걸린 양식은 절대 건드리지 않는다)
  const initSampleData = () => {
    // 서버가 이미 양식을 내려줬으면 시드가 다시 개입하지 않는다(현장 편집분 보존)
    if (window.Sync && Sync.serverHas && Sync.serverHas(TPL_KEY)) {
      // 구 일지 이관도 먼저 붙은 단말이 이미 끝냈고 그 결과가 동기화돼 있다.
      // 버전키·이관완료 표시를 같이 찍어야 다음 부팅에 시드가 되살아나지 않는다.
      try {
        localStorage.setItem(SEED_KEY, SEED_VERSION);
        if (!localStorage.getItem(MIGRATED_KEY)) localStorage.setItem(MIGRATED_KEY, '0');
      } catch (_) {}
      return;
    }
    let cur = read(TPL_KEY);
    if (localStorage.getItem(SEED_KEY) !== SEED_VERSION) {
      const used = new Set(read(REC_KEY).map(r => r.tplId));
      const next = cur.filter(t => !t.builtin || used.has(t.id));
      if (next.length !== cur.length) { cur = next; write(TPL_KEY, cur); }
    }
    const have = new Set(cur.map(t => t.code));
    let added = 0;
    SEED_TEMPLATES.forEach((s, i) => {
      if (have.has(s.code)) return;
      cur.push({
        id: 'JT' + s.code.replace('-', ''),
        code: s.code, name: s.name, category: s.category, cycle: s.cycle,
        factory: 'ALL', note: s.note || '',
        targetLabel: (s.targets && s.targets.length) ? '점검대상' : '',
        targets: (s.targets || []).slice(),
        rows: (s.rows || []).map(r => ({ ...r })),
        useReview: true, useApproval: true,
        active: true, builtin: true, seq: i + 1,
        createdAt: now(),
      });
      added++;
    });
    if (added) write(TPL_KEY, cur);
    try { localStorage.setItem(SEED_KEY, SEED_VERSION); } catch (_) {}
    // 양식이 깔린 뒤에 구 일지 기록을 옮긴다(MIG-01 양식이 있어야 하므로 순서 중요)
    try { migrateLegacyLogs(); } catch (e) { console.warn('[Journal] legacy migrate skip', e); }
  };

  // ============================================================
  // 구 HACCP 일지 / SQF 일지 → 전자 일지 이관 (1회성)
  //   두 화면은 같은 일을 평면 표로 하던 것이라 전자 일지로 일원화했다.
  //   과거 기록은 구조가 다르므로 없는 항목을 지어내지 않고 원본 열을 그대로 옮긴다.
  //   원본(lab_haccp_logs / sqf_logs)은 지우지 않는다 — 되돌릴 여지를 남긴다.
  // ============================================================
  const MIGRATED_KEY = 'journal_migrated_legacy';
  const migrateLegacyLogs = () => {
    if (localStorage.getItem(MIGRATED_KEY)) return 0;
    const tpl = read(TPL_KEY).find(t => t.code === 'MIG-01');
    if (!tpl) return 0;

    const src = [];
    try {
      JSON.parse(localStorage.getItem('lab_haccp_logs') || '[]')
        .forEach(l => src.push({ ...l, __src: 'HACCP 일지' }));
    } catch (_) {}
    try {
      JSON.parse(localStorage.getItem('sqf_logs') || '[]')
        .forEach(l => src.push({ ...l, __src: 'SQF 일지' }));
    } catch (_) {}
    if (!src.length) { localStorage.setItem(MIGRATED_KEY, '0'); return 0; }

    const recs = read(REC_KEY);
    const done = new Set(recs.map(r => r.legacyId).filter(Boolean));
    let n = 0;
    src.forEach(l => {
      if (!l.id || done.has(l.id)) return;
      const ng = l.judged === '부적합';
      const act = String(l.action || '').trim();
      const rec = {
        id: uid('JR'), legacyId: l.id,
        tplId: tpl.id, tplCode: tpl.code, tplName: tpl.name, category: tpl.category,
        factory: l.factory || '',
        date: String(l.date || '').slice(0, 10) || todayStr(),
        targets: [],
        vals: {
          '|src':    { v: l.__src },
          '|type':   { v: l.type || '' },
          '|target': { v: l.target || '' },
          '|value':  { v: l.value || '' },
          '|judged': { v: ng ? '부적합' : (l.judged === '적합' ? '적합' : '') },
          '|memo':   { v: l.memo || '' },
        },
        // 부적합에 조치가 적혀 있으면 개선조치로 옮겨 이탈이 해소된 상태로 만든다
        actions: (ng && act) ? [{ key: '|judged', item: '판정', cause: '', action: act, by: l.by || '', at: l.createdAt || now() }] : [],
        photos: [], memo: '',
        writer: l.by || '', writerEmail: '',
        // 조치 없는 부적합은 조치중으로 남겨 미조치 이탈이 눈에 띄게 한다
        status: (ng && !act) ? 'ACTION' : 'APPROVED',
        reviewer: null, approver: null,
        history: [{ act: 'MIGRATE', by: '시스템', email: '', at: now(), comment: `${l.__src}에서 이관` }],
        createdAt: l.createdAt || now(), updatedAt: now(),
      };
      recalc(rec);
      recs.push(rec);
      n++;
    });
    if (n) write(REC_KEY, recs);
    localStorage.setItem(MIGRATED_KEY, String(n));
    return n;
  };

  // ============================================================
  // 양식(템플릿)
  // ============================================================
  const getTemplates = (opt = {}) => {
    let list = read(TPL_KEY);
    if (opt.activeOnly) list = list.filter(t => t.active !== false);
    if (opt.category && opt.category !== 'ALL') list = list.filter(t => t.category === opt.category);
    if (opt.factory && opt.factory !== 'ALL') list = list.filter(t => !t.factory || t.factory === 'ALL' || t.factory === opt.factory);
    return list.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  };
  const getTemplate = (id) => read(TPL_KEY).find(t => t.id === id) || null;

  const saveTemplate = (data) => {
    const list = read(TPL_KEY);
    if (data.id) {
      const i = list.findIndex(t => t.id === data.id);
      if (i < 0) return null;
      list[i] = { ...list[i], ...data, updatedAt: now() };
      write(TPL_KEY, list);
      return list[i];
    }
    const t = {
      id: uid('JT'), code: data.code || ('U-' + (list.length + 1)), name: data.name || '새 일지',
      category: data.category || '선행요건', cycle: data.cycle || 'DAILY',
      factory: data.factory || 'ALL', note: data.note || '',
      targetLabel: data.targetLabel || '', targets: data.targets || [],
      rows: data.rows || [], useReview: data.useReview !== false, useApproval: data.useApproval !== false,
      active: true, builtin: false, createdAt: now(),
    };
    list.push(t); write(TPL_KEY, list);
    return t;
  };
  const deleteTemplate = (id) => {
    const used = read(REC_KEY).some(r => r.tplId === id);
    if (used) {   // 기록이 있으면 삭제 대신 미사용 처리 (이력 보존)
      saveTemplate({ id, active: false });
      return 'DEACTIVATED';
    }
    write(TPL_KEY, read(TPL_KEY).filter(t => t.id !== id));
    return 'DELETED';
  };
  const toggleTemplate = (id) => {
    const t = getTemplate(id); if (!t) return;
    saveTemplate({ id, active: t.active === false });
  };

  // ── 항목 판정 ──
  const fieldMeta = (row) => FIELD_TYPES[row.type] || FIELD_TYPES.TEXT;
  const optionsOf = (row) => {
    if (row.type === 'SELECT') return row.options || [];
    return fieldMeta(row).options || [];
  };
  const ngValuesOf = (row) => (row.ng && row.ng.length) ? row.ng : (fieldMeta(row).ng || []);
  const isNg = (row, v) => {
    if (v === '' || v === null || v === undefined) return false;
    if (row.type === 'NUM') {
      const n = Number(v);
      if (!isFinite(n)) return false;
      if (typeof row.min === 'number' && n < row.min) return true;
      if (typeof row.max === 'number' && n > row.max) return true;
      return false;
    }
    return ngValuesOf(row).includes(String(v));
  };
  const stdText = (row) => {
    if (row.std) return row.std;
    if (row.type === 'NUM') {
      const hasMin = typeof row.min === 'number', hasMax = typeof row.max === 'number';
      if (hasMin && hasMax) return `${row.min} ~ ${row.max}${row.unit ? ' ' + row.unit : ''}`;
      if (hasMax) return `${row.max}${row.unit ? ' ' + row.unit : ''} 이하`;
      if (hasMin) return `${row.min}${row.unit ? ' ' + row.unit : ''} 이상`;
      return '';
    }
    const ngs = ngValuesOf(row);
    return ngs.length ? `${ngs.join('·')} 시 이탈` : '';
  };
  const cellKey = (target, rowKey) => `${target || ''}|${rowKey}`;

  // 문항형 일지의 그룹(개인위생 / 작업 전 위생상태 …) 구분줄을 끼워 넣은 목록.
  //   원본 서식의 '구분' 열을 화면에서도 그대로 살리기 위한 것.
  const withGroupRows = (rows) => {
    const out = []; let last = null;
    (rows || []).forEach(r => {
      const g = r.group || '';
      if (g && g !== last) { out.push({ __group: g }); last = g; }
      out.push(r);
    });
    return out;
  };

  // 기록의 이탈 목록 산출 — [{target, rowKey, label, value, std}]
  const deviationsOf = (rec, tpl) => {
    const t = tpl || getTemplate(rec.tplId);
    if (!t) return [];
    const targets = (rec.targets && rec.targets.length) ? rec.targets : [''];
    const out = [];
    targets.forEach(tg => {
      (t.rows || []).forEach(row => {
        const cell = (rec.vals || {})[cellKey(tg, row.key)];
        const v = cell ? cell.v : '';
        if (isNg(row, v)) out.push({ target: tg, rowKey: row.key, label: row.label, value: v, unit: row.unit || '', std: stdText(row) });
      });
    });
    return out;
  };
  // 이탈 중 개선조치가 입력되지 않은 건
  const openDeviations = (rec, tpl) => {
    const acts = new Set((rec.actions || []).filter(a => a.action).map(a => a.key));
    return deviationsOf(rec, tpl).filter(d => !acts.has(cellKey(d.target, d.rowKey)));
  };

  // ============================================================
  // 기록(일지)
  // ============================================================
  const getRecords = (filter = {}) => {
    let list = read(REC_KEY);
    if (filter.factory && filter.factory !== 'ALL') list = list.filter(r => r.factory === filter.factory);
    if (filter.tplId && filter.tplId !== 'ALL') list = list.filter(r => r.tplId === filter.tplId);
    if (filter.category && filter.category !== 'ALL') list = list.filter(r => r.category === filter.category);
    if (filter.status && filter.status !== 'ALL') list = list.filter(r => r.status === filter.status);
    if (filter.from) list = list.filter(r => (r.date || '') >= filter.from);
    if (filter.to)   list = list.filter(r => (r.date || '') <= filter.to);
    if (filter.ngOnly) list = list.filter(r => (r.ng || 0) > 0);
    if (filter.writerEmail) list = list.filter(r => r.writerEmail === filter.writerEmail);
    return list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  };
  const getRecord = (id) => read(REC_KEY).find(r => r.id === id) || null;

  const recalc = (rec) => {
    const tpl = getTemplate(rec.tplId);
    rec.ng = deviationsOf(rec, tpl).length;
    rec.openNg = openDeviations(rec, tpl).length;
    return rec;
  };

  const addRecord = (data) => {
    const tpl = getTemplate(data.tplId);
    if (!tpl) return null;
    const list = read(REC_KEY);
    const rec = {
      id: uid('JR'),
      tplId: tpl.id, tplCode: tpl.code, tplName: tpl.name, category: tpl.category,
      factory: data.factory || 'HQ',
      date: data.date || todayStr(),
      shift: data.shift || '',
      targetLabel: tpl.targetLabel || '',
      targets: (data.targets && data.targets.length) ? data.targets.slice() : (tpl.targets || []).slice(),
      vals: data.vals || {},
      actions: data.actions || [],
      photos: data.photos || [],
      memo: data.memo || '',
      writer: data.writer || '', writerEmail: data.writerEmail || '',
      status: 'DRAFT',
      reviewer: data.reviewer || null, approver: data.approver || null,
      history: [],
      createdAt: now(), updatedAt: now(),
    };
    recalc(rec);
    list.push(rec); write(REC_KEY, list);
    return rec;
  };

  const updateRecord = (id, patch) => {
    const list = read(REC_KEY);
    const i = list.findIndex(r => r.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, updatedAt: now() };
    recalc(list[i]);
    write(REC_KEY, list);
    return list[i];
  };
  const deleteRecord = (id) => { write(REC_KEY, read(REC_KEY).filter(r => r.id !== id)); };

  // 이탈 개선조치 등록
  const setAction = (recId, key, data) => {
    const rec = getRecord(recId); if (!rec) return null;
    const acts = (rec.actions || []).filter(a => a.key !== key);
    if (data && data.action) {
      acts.push({
        key, item: data.item || '', cause: data.cause || '', action: data.action,
        by: data.by || '', at: data.at || now(),
      });
    }
    return updateRecord(recId, { actions: acts });
  };

  // ── 결재 워크플로우 ──
  //   상신 → (검토) → 승인.  반려 시 작성중으로 되돌아가 수정·재상신 가능.
  const pushHistory = (rec, act, comment) => {
    const h = (rec.history || []).slice();
    h.push({ act, by: actorName(), email: actorEmail(), at: now(), comment: comment || '' });
    return h;
  };
  const actorName = () => { try { return (typeof Auth !== 'undefined' && Auth.currentName) ? Auth.currentName() : ''; } catch (_) { return ''; } };
  const actorEmail = () => { try { return (typeof Auth !== 'undefined' && Auth.currentEmail) ? Auth.currentEmail() : ''; } catch (_) { return ''; } };

  const submit = (id, line) => {
    const rec = getRecord(id); if (!rec) return { ok: false, msg: '일지를 찾을 수 없습니다' };
    if (rec.status !== 'DRAFT' && rec.status !== 'REJECTED') return { ok: false, msg: '작성중 상태에서만 상신할 수 있습니다' };
    const open = openDeviations(rec);
    if (open.length) return { ok: false, msg: `이탈 ${open.length}건의 개선조치를 먼저 입력해야 상신할 수 있습니다` };
    const patch = { status: 'SUBMITTED', submittedAt: now(), history: pushHistory(rec, 'SUBMIT') };
    if (line) { patch.reviewer = line.reviewer || null; patch.approver = line.approver || null; }
    return { ok: true, rec: updateRecord(id, patch) };
  };
  const cancelSubmit = (id) => {
    const rec = getRecord(id); if (!rec) return { ok: false, msg: '일지를 찾을 수 없습니다' };
    if (rec.status !== 'SUBMITTED') return { ok: false, msg: '상신 상태에서만 취소할 수 있습니다' };
    return { ok: true, rec: updateRecord(id, { status: 'DRAFT', history: pushHistory(rec, 'CANCEL') }) };
  };
  const review = (id, comment) => {
    const rec = getRecord(id); if (!rec) return { ok: false, msg: '일지를 찾을 수 없습니다' };
    if (rec.status !== 'SUBMITTED') return { ok: false, msg: '상신된 일지만 검토할 수 있습니다' };
    return { ok: true, rec: updateRecord(id, { status: 'REVIEWED', reviewedAt: now(), history: pushHistory(rec, 'REVIEW', comment) }) };
  };
  const approve = (id, comment) => {
    const rec = getRecord(id); if (!rec) return { ok: false, msg: '일지를 찾을 수 없습니다' };
    if (rec.status !== 'SUBMITTED' && rec.status !== 'REVIEWED') return { ok: false, msg: '상신·검토완료 상태에서만 승인할 수 있습니다' };
    return { ok: true, rec: updateRecord(id, { status: 'APPROVED', approvedAt: now(), history: pushHistory(rec, 'APPROVE', comment) }) };
  };
  const reject = (id, comment) => {
    const rec = getRecord(id); if (!rec) return { ok: false, msg: '일지를 찾을 수 없습니다' };
    if (rec.status !== 'SUBMITTED' && rec.status !== 'REVIEWED') return { ok: false, msg: '상신·검토완료 상태에서만 반려할 수 있습니다' };
    return { ok: true, rec: updateRecord(id, { status: 'REJECTED', history: pushHistory(rec, 'REJECT', comment) }) };
  };
  const isLocked = (rec) => rec && (rec.status === 'SUBMITTED' || rec.status === 'REVIEWED' || rec.status === 'APPROVED');

  // 내 결재함 — 검토/승인자로 지정됐거나 결재선 미지정(전체 결재 가능)인 상신 건
  const myApprovals = (email, factory) => {
    const e = (email || actorEmail() || '').toLowerCase();
    return getRecords({ factory }).filter(r => {
      if (r.status !== 'SUBMITTED' && r.status !== 'REVIEWED') return false;
      const rv = (r.reviewer && r.reviewer.email || '').toLowerCase();
      const ap = (r.approver && r.approver.email || '').toLowerCase();
      if (!rv && !ap) return true;
      return e && (e === rv || e === ap);
    });
  };

  // ============================================================
  // 작성 현황 · 미작성(지연) 산출
  // ============================================================
  const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);

  // 양식별 최근 작성일 / 다음 기한 / 지연일
  const dueList = (factory) => {
    const today = todayStr();
    const recs = getRecords({ factory });
    return getTemplates({ activeOnly: true, factory }).map(t => {
      const mine = recs.filter(r => r.tplId === t.id);
      const last = mine.length ? mine[0].date : null;      // getRecords 는 날짜 내림차순
      const cyc = CYCLES[t.cycle] || CYCLES.EVENT;
      let due = null, overdue = 0;
      if (cyc.days > 0) {
        // 작성 이력이 없으면 양식을 등록한 날부터 1주기를 센다.
        //   양식을 방금 깔았는데 "미작성 초과"로 잡으면 첫날부터 경고가 쏟아져 의미가 없다.
        const base = last || String(t.createdAt || '').slice(0, 10);
        if (!base) { overdue = 0; }
        else {
          const d = new Date(base); d.setDate(d.getDate() + cyc.days);
          due = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
          overdue = Math.max(0, daysBetween(due, today));
        }
      }
      return {
        tpl: t, last, due, overdue,
        count: mine.length,
        pending: mine.filter(r => r.status === 'SUBMITTED' || r.status === 'REVIEWED').length,
        ng: mine.reduce((s, r) => s + (r.ng || 0), 0),
      };
    });
  };

  const stats = (factory, opt = {}) => {
    const from = opt.from || '', to = opt.to || '';
    const recs = getRecords({ factory, from, to });
    const due = dueList(factory);
    return {
      templates: getTemplates({ activeOnly: true, factory }).length,
      total: recs.length,
      draft: recs.filter(r => r.status === 'DRAFT').length,
      submitted: recs.filter(r => r.status === 'SUBMITTED' || r.status === 'REVIEWED').length,
      approved: recs.filter(r => r.status === 'APPROVED').length,
      rejected: recs.filter(r => r.status === 'REJECTED').length,
      ng: recs.reduce((s, r) => s + (r.ng || 0), 0),
      openNg: recs.reduce((s, r) => s + (r.openNg || 0), 0),
      overdue: due.filter(d => d.overdue > 0).length,
      never: due.filter(d => !d.last && (CYCLES[d.tpl.cycle] || CYCLES.EVENT).days > 0).length,
      approveRate: recs.length ? Math.round(recs.filter(r => r.status === 'APPROVED').length / recs.length * 100) : 0,
    };
  };

  // 월별 작성/이탈 추이 (최근 n개월)
  const monthlyTrend = (factory, months = 12) => {
    const recs = getRecords({ factory });
    const d = new Date();
    const labels = [];
    for (let i = months - 1; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      labels.push(`${x.getFullYear()}-${pad2(x.getMonth() + 1)}`);
    }
    const ymOf = (s) => String(s || '').slice(0, 7);
    return {
      labels,
      written: labels.map(m => recs.filter(r => ymOf(r.date) === m).length),
      approved: labels.map(m => recs.filter(r => ymOf(r.date) === m && r.status === 'APPROVED').length),
      ng: labels.map(m => recs.filter(r => ymOf(r.date) === m).reduce((s, r) => s + (r.ng || 0), 0)),
    };
  };

  // 대시보드 요약
  const summary = (factory) => {
    const s = stats(factory);
    return { overdue: s.overdue, pending: s.submitted, openNg: s.openNg, total: s.total };
  };

  // ── 결재선 ──
  const getLines = () => read(LINE_KEY);
  const saveLine = (data) => {
    const list = read(LINE_KEY);
    if (data.id) {
      const i = list.findIndex(l => l.id === data.id);
      if (i >= 0) { list[i] = { ...list[i], ...data }; write(LINE_KEY, list); return list[i]; }
    }
    const l = { id: uid('JL'), name: data.name || '기본 결재선', tplId: data.tplId || 'ALL', reviewer: data.reviewer || null, approver: data.approver || null, createdAt: now() };
    list.push(l); write(LINE_KEY, list);
    return l;
  };
  const deleteLine = (id) => write(LINE_KEY, read(LINE_KEY).filter(l => l.id !== id));
  const lineFor = (tplId) => getLines().find(l => l.tplId === tplId) || getLines().find(l => l.tplId === 'ALL') || null;

  return {
    CYCLES, FIELD_TYPES, STATUS, CATEGORIES, SEED_VERSION,
    cycleLabel, statusMeta, fieldMeta, optionsOf, ngValuesOf, isNg, stdText, cellKey, withGroupRows,
    initSampleData, migrateLegacyLogs,
    getTemplates, getTemplate, saveTemplate, deleteTemplate, toggleTemplate,
    getRecords, getRecord, addRecord, updateRecord, deleteRecord, setAction,
    deviationsOf, openDeviations, isLocked,
    submit, cancelSubmit, review, approve, reject, myApprovals,
    dueList, stats, monthlyTrend, summary,
    getLines, saveLine, deleteLine, lineFor,
    todayStr,
  };
})();
