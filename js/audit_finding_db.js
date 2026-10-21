// ============================================================
// audit_finding_db.js — 심사 지적사항 연간 기록 데이터 레이어
//   HACCP 인증심사·연장심사·조사평가 등 각종 심사의 결과와 지적사항을
//   연도별로 축적하고, 지적사항마다 개선(조치) 이력을 남긴다.
//   식품안전관리인증원 범용 HACCP MES 표준모델의 '심사지적사항'을
//   자사 이력 관리형으로 구현(연간 통계·재발 방지 추적).
// ============================================================

const AuditFindingDB = (() => {
  const KEY = 'audit_findings';
  const now = () => new Date().toISOString();
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const notifyWrite = (k) => { try { if (typeof window !== 'undefined' && window.__onDbWrite) window.__onDbWrite(k); } catch (_) {} };
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
  const set = (d) => { localStorage.setItem(KEY, JSON.stringify(d)); notifyWrite(KEY); };

  // 심사 구분
  const AUDIT_TYPES = ['HACCP 인증심사', 'HACCP 연장심사', 'SQF 인증심사', 'SQF 재인증심사', 'SQF 내부심사', '조사·평가', '사후관리 점검', '자체 점검', '관계기관 점검', '고객사 감사'];
  // 지적 등급 — 인증원 심사 기준에 준함
  const GRADES = ['중부적합', '경부적합', '관찰사항', '권고사항'];
  const GRADE_META = {
    중부적합: { cls: 'badge-fail',    weight: 3, color: '#e5484d' },
    경부적합: { cls: 'badge-warning', weight: 2, color: '#d4820f' },
    관찰사항: { cls: 'badge-info',    weight: 1, color: '#3E6AE1' },
    권고사항: { cls: 'badge-default', weight: 0, color: '#8892a6' },
  };
  // 지적 분야 — HACCP 선행요건/중요관리점 체계 기준
  const CATEGORIES = [
    '선행요건-영업장관리', '선행요건-위생관리', '선행요건-제조시설·설비', '선행요건-냉장/냉동설비',
    '선행요건-용수관리', '선행요건-보관·운송', '선행요건-검사관리', '선행요건-회수관리',
    'HACCP-위해요소분석', 'HACCP-CCP 결정/한계기준', 'HACCP-모니터링', 'HACCP-개선조치',
    'HACCP-검증', 'HACCP-기록관리', '교육훈련', '기타',
  ];

  // ── 심사기준(HACCP·SQF) — 지적 분야를 표준 체계의 중분류에서 고르게 한다 ──
  //   출처: HACCP 관리기준서/매뉴얼(선행요건·7원칙), SQF Food Safety Code 체크리스트(WS-FSMS-2541-03)
  const AUDIT_STANDARDS = {
  HACCP: {
    label: 'HACCP 심사기준',
    groups: [
      {
        title: '선행요건 관리',
        items: ['영업장 관리', '위생 관리', '제조·가공시설·설비 관리', '냉장·냉동시설·설비 관리', '용수 관리', '보관·운송 관리', '검사 관리', '회수프로그램 관리']
      },
      {
        title: 'HACCP 관리 (7원칙 12절차)',
        items: ['절차1 HACCP팀 구성', '절차2 제품설명서 작성', '절차3 용도 확인', '절차4 공정흐름도 작성', '절차5 공정흐름도 현장확인', '원칙1 위해요소 분석', '원칙2 중요관리점(CCP) 결정', '원칙3 CCP 한계기준 설정', '원칙4 CCP 모니터링 체계', '원칙5 개선조치 방법', '원칙6 검증절차·방법', '원칙7 문서화·기록유지']
      }
    ]
  },
  SQF: {
    label: 'SQF 심사기준 (Food Safety Code)',
    groups: [
      {
        title: '2.1 경영진의 의지',
        items: ['2.1.1 경영 책임', '2.1.2 경영 검토', '2.1.3 불만 관리']
      },
      {
        title: '2.2 문서관리 및 기록',
        items: ['2.2.1 식품안전경영시스템', '2.2.2 문서 관리', '2.2.3 기록 관리']
      },
      {
        title: '2.3 사양·제품개발·공급업체',
        items: ['2.3.1 제품 배합·실현', '2.3.2 규격서(원료·포장·완제품)', '2.3.3 위탁 제조업체', '2.3.4 승인 공급업체 프로그램']
      },
      {
        title: '2.4 식품안전시스템',
        items: ['2.4.1 식품 법규 준수', '2.4.2 우수제조기준(GMP)', '2.4.3 식품안전계획(HACCP)', '2.4.4 시료채취·검사·분석', '2.4.5 부적합품 관리', '2.4.6 재작업 관리', '2.4.7 제품 출하 승인', '2.4.8 환경 모니터링']
      },
      {
        title: '2.5 SQF 시스템 검증',
        items: ['2.5.1 유효성 검증', '2.5.2 검증 활동', '2.5.3 시정·예방 조치', '2.5.4 내부심사·점검']
      },
      {
        title: '2.6 제품 추적성·위기관리',
        items: ['2.6.1 제품 식별', '2.6.2 제품 추적', '2.6.3 제품 회수·리콜', '2.6.4 위기관리 계획']
      },
      {
        title: '2.7 식품방어 및 식품사기',
        items: ['2.7.1 식품방어 계획', '2.7.2 식품사기 관리']
      },
      {
        title: '2.8 알레르겐·표시',
        items: ['2.8.1 알레르겐 관리', '2.8.2 표시·강조표시(라벨)']
      },
      {
        title: '2.9 교육훈련',
        items: ['2.9.1 교육 요구사항', '2.9.2 교육 프로그램']
      },
      {
        title: '4.1 부지 및 건물',
        items: ['4.1.1 부지 위치·승인', '4.1.2 건축 자재', '4.1.3 조명·조명기구', '4.1.4 검사·품질관리 구역', '4.1.5 분진·방충·방서', '4.1.6 환기', '4.1.7 설비·기구', '4.1.8 부지·도로']
      },
      {
        title: '4.2 시설 운영·유지',
        items: ['4.2.1 수리·유지보수', '4.2.2 정비 인력·외주', '4.2.3 계측기 교정', '4.2.4 방제(유해생물)', '4.2.5 세척·소독']
      },
      {
        title: '4.3 개인위생 및 복지',
        items: ['4.3.1 작업자 복지', '4.3.2 손 세척', '4.3.3 작업복·개인소지품', '4.3.4 방문객 관리', '4.3.5 편의시설(탈의·화장실·휴게)']
      },
      {
        title: '4.4 작업자 취급수칙',
        items: ['4.4.1 식품 취급 작업자 수칙']
      },
      {
        title: '4.5 용수·얼음·공기',
        items: ['4.5.1 용수 공급', '4.5.2 용수 처리', '4.5.3 수질', '4.5.4 얼음 공급', '4.5.5 공기·기체']
      },
      {
        title: '4.6 입고·보관·운송',
        items: ['4.6.1 입고·보관·취급', '4.6.2 냉장·냉동 보관', '4.6.3 건자재·포장재 보관', '4.6.4 유해화학물질 보관', '4.6.5 상·하차·운송']
      },
      {
        title: '4.7 공정 분리·이물관리',
        items: ['4.7.1 고위험 공정', '4.7.2 해동 관리', '4.7.3 이물 오염 관리', '4.7.4 이물 검출', '4.8.1 폐기물 처리']
      }
    ]
  }
};
  // 심사 유형 → 적용 기준. 유형에 'SQF' 가 들어가면 SQF, 그 외엔 HACCP 를 지적 분야로 쓴다.
  const standardOf = (type) => (type && String(type).indexOf('SQF') >= 0) ? 'SQF' : 'HACCP';
  // 지적 분야 후보(그룹 형태). 표준 중분류 + '기타' 그룹.
  const categoriesFor = (type) => {
    const std = AUDIT_STANDARDS[standardOf(type)];
    const groups = (std ? std.groups : []).map(g => ({ title: g.title, items: g.items.slice() }));
    groups.push({ title: '기타', items: ['교육훈련', '문서·기록관리', '기타'] });
    return groups;
  };

  const RESULTS = ['적합', '조건부 적합', '부적합', '해당없음'];
  const STATUS = ['미조치', '조치중', '완료'];
  const STATUS_META = {
    미조치: { cls: 'badge-fail',    tone: 'danger' },
    조치중: { cls: 'badge-warning', tone: 'warn' },
    완료:   { cls: 'badge-pass',    tone: 'ok' },
  };
  const FACTORIES = [
    { code: 'NS', name: '논산공장' }, { code: 'GS', name: '경산공장' },
    { code: 'AS', name: '아산공장' }, { code: 'HQ', name: '본사' },
  ];
  const factoryName = (c) => (FACTORIES.find(f => f.code === c) || {}).name || c || '-';

  // ── 조회 ──
  const matchFactory = (a, f) => !f || f === 'ALL' || a.factory === f;
  const getAudits = (year, factory) => get()
    .filter(a => (!year || year === 'ALL' || String(a.year) === String(year)) && matchFactory(a, factory))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const getAudit = (id) => get().find(a => a.id === id);
  const years = () => [...new Set(get().map(a => String(a.year)))].sort((a, b) => b.localeCompare(a));

  // 전체 지적사항(심사 정보 포함) — 필터·통계용
  const allFindings = (year, factory) => {
    const out = [];
    getAudits(year, factory).forEach(a => {
      (a.findings || []).forEach(f => out.push({ ...f, auditId: a.id, auditType: a.type, auditDate: a.date, agency: a.agency, factory: a.factory, year: a.year }));
    });
    return out;
  };

  // 기한 경과 여부(미완료 + 개선기한 지남)
  const isOverdue = (f) => f.status !== '완료' && !!f.dueDate && f.dueDate < todayStr();

  // ── 심사 등록/수정/삭제 ──
  const addAudit = (d) => {
    const all = get();
    const date = d.date || todayStr();
    const rec = {
      id: 'AUD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(),
      year: Number(d.year) || Number(String(date).slice(0, 4)),
      type: d.type || AUDIT_TYPES[0],
      date,
      agency: (d.agency || '').trim(),
      factory: d.factory || 'NS',
      result: d.result || '적합',
      score: d.score === '' || d.score == null ? null : Number(d.score),
      auditor: (d.auditor || '').trim(),
      note: (d.note || '').trim(),
      findings: Array.isArray(d.findings) ? d.findings : [],
      // 자체 점검표 결과 {results:[{key,score,memo}], summary} — self_check.js
      checklist: d.checklist || null,
      createdAt: now(),
    };
    all.push(rec);
    set(all);
    return rec;
  };
  const updateAudit = (id, patch) => {
    const all = get();
    const i = all.findIndex(a => a.id === id);
    if (i < 0) return null;
    const before = { ...all[i] };
    all[i] = { ...all[i], ...patch, id: all[i].id };
    if (window.AuditLog) AuditLog.record(all[i], before, {
      year: '연도', type: '유형', date: '심사일', agency: '심사기관', factory: '공장',
      result: '결과', scope: '범위', auditor: '심사원', note: '비고',
    }, { by: patch.updatedBy });
    set(all);
    return all[i];
  };
  const deleteAudit = (id) => { set(get().filter(a => a.id !== id)); };

  // ── 지적사항 ──
  const addFinding = (auditId, d) => {
    const all = get();
    const i = all.findIndex(a => a.id === auditId);
    if (i < 0) return null;
    const f = {
      id: 'F-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(),
      category: d.category || '기타',
      grade: d.grade || '경부적합',
      content: (d.content || '').trim(),
      dept: (d.dept || '').trim(),
      dueDate: d.dueDate || '',
      status: d.status || '미조치',
      action: '', actionDate: '', actionBy: '',
      photos: Array.isArray(d.photos) ? d.photos : [],   // 지적 현장 사진(썸네일+메타)
      sourceKey: d.sourceKey || '',   // 점검표 항목에서 만든 지적이면 그 항목 키 — 같은 항목을 두 번 만들지 않게
      history: [],
      createdAt: now(),
    };
    all[i].findings = (all[i].findings || []).concat(f);
    set(all);
    return f;
  };
  const updateFinding = (auditId, findingId, patch) => {
    const all = get();
    const i = all.findIndex(a => a.id === auditId);
    if (i < 0) return null;
    const fi = (all[i].findings || []).findIndex(f => f.id === findingId);
    if (fi < 0) return null;
    const before = { ...all[i].findings[fi] };
    all[i].findings[fi] = { ...all[i].findings[fi], ...patch, id: findingId };
    if (window.AuditLog) AuditLog.record(all[i].findings[fi], before, {
      clause: '조항', title: '지적내용', grade: '등급', status: '상태',
      cause: '원인', correction: '시정조치', preventive: '예방조치', owner: '담당',
      dueDate: '기한', closeDate: '종결일', note: '비고',
    }, { by: patch.updatedBy });
    set(all);
    return all[i].findings[fi];
  };
  const deleteFinding = (auditId, findingId) => {
    const all = get();
    const i = all.findIndex(a => a.id === auditId);
    if (i < 0) return null;
    all[i].findings = (all[i].findings || []).filter(f => f.id !== findingId);
    set(all);
    return all[i];
  };
  // 개선(조치) 등록 — 이력에 누적하고 현재 상태를 갱신
  const addAction = (auditId, findingId, d) => {
    const all = get();
    const i = all.findIndex(a => a.id === auditId);
    if (i < 0) return null;
    const fi = (all[i].findings || []).findIndex(f => f.id === findingId);
    if (fi < 0) return null;
    const f = all[i].findings[fi];
    const entry = {
      id: 'AC-' + Date.now().toString(36).toUpperCase(),
      date: d.date || todayStr(),
      status: d.status || '완료',
      action: (d.action || '').trim(),
      by: (d.by || '').trim(),
      photos: Array.isArray(d.photos) ? d.photos : [],   // 개선 증빙(썸네일+메타)
      createdAt: now(),
    };
    f.history = (f.history || []).concat(entry);
    f.status = entry.status;
    f.action = entry.action;
    f.actionDate = entry.date;
    f.actionBy = entry.by;
    all[i].findings[fi] = f;
    set(all);
    return f;
  };
  const deleteAction = (auditId, findingId, actionId) => {
    const all = get();
    const i = all.findIndex(a => a.id === auditId);
    if (i < 0) return null;
    const fi = (all[i].findings || []).findIndex(f => f.id === findingId);
    if (fi < 0) return null;
    const f = all[i].findings[fi];
    f.history = (f.history || []).filter(h => h.id !== actionId);
    const last = f.history.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    f.status = last ? last.status : '미조치';
    f.action = last ? last.action : '';
    f.actionDate = last ? last.date : '';
    f.actionBy = last ? last.by : '';
    all[i].findings[fi] = f;
    set(all);
    return f;
  };

  // ── 통계 ──
  const yearStats = (year, factory) => {
    const audits = getAudits(year, factory);
    const fs = allFindings(year, factory);
    const byStatus = { 미조치: 0, 조치중: 0, 완료: 0 };
    fs.forEach(f => { byStatus[f.status] = (byStatus[f.status] || 0) + 1; });
    const byGrade = {};
    GRADES.forEach(g => { byGrade[g] = fs.filter(f => f.grade === g).length; });
    return {
      audits: audits.length,
      findings: fs.length,
      ...byStatus,
      overdue: fs.filter(isOverdue).length,
      byGrade,
      closeRate: fs.length ? Math.round(byStatus.완료 / fs.length * 100) : 100,
      critical: byGrade['중부적합'] || 0,
    };
  };
  // 연도별 추이 (지적건수·중부적합·완료율)
  const yearTrend = (factory) => years().slice().sort().map(y => {
    const s = yearStats(y, factory);
    return { year: y, audits: s.audits, findings: s.findings, critical: s.critical, closeRate: s.closeRate };
  });
  // 분야별 다발 지적 TOP
  const byCategory = (year, factory) => {
    const map = new Map();
    allFindings(year, factory).forEach(f => {
      const k = f.category || '기타';
      if (!map.has(k)) map.set(k, { name: k, n: 0, critical: 0, open: 0 });
      const o = map.get(k); o.n++;
      if (f.grade === '중부적합') o.critical++;
      if (f.status !== '완료') o.open++;
    });
    return [...map.values()].sort((a, b) => b.n - a.n);
  };
  // 반복 지적(2개 연도 이상에서 같은 분야가 지적된 경우) — 재발 방지 추적
  const repeated = (factory) => {
    const map = new Map();
    allFindings('ALL', factory).forEach(f => {
      const k = f.category || '기타';
      if (!map.has(k)) map.set(k, { name: k, yearsSet: new Set(), n: 0 });
      const o = map.get(k); o.yearsSet.add(String(f.year)); o.n++;
    });
    return [...map.values()]
      .filter(o => o.yearsSet.size >= 2)
      .map(o => ({ name: o.name, years: [...o.yearsSet].sort(), n: o.n }))
      .sort((a, b) => b.years.length - a.years.length || b.n - a.n);
  };
  // 조치 필요 목록(대시보드용)
  const openFindings = (factory) => allFindings('ALL', factory)
    .filter(f => f.status !== '완료')
    .map(f => ({ ...f, overdue: isOverdue(f) }))
    .sort((a, b) => (b.overdue - a.overdue) || (GRADE_META[b.grade]?.weight || 0) - (GRADE_META[a.grade]?.weight || 0));

  // ── 시드 ──
  const SEED_VERSION = '2026-07-27-init';
  const SEED_KEY = 'audit_finding_seed_ver';
  const initSampleData = () => {
    if (localStorage.getItem(SEED_KEY) === SEED_VERSION) return;
    if (get().length > 0) { localStorage.setItem(SEED_KEY, SEED_VERSION); return; }
    const a1 = addAudit({ year: 2025, type: 'HACCP 연장심사', date: '2025-05-14', agency: '한국식품안전관리인증원', factory: 'NS', result: '조건부 적합', score: 87, auditor: '심사팀' });
    addFinding(a1.id, { category: '선행요건-위생관리', grade: '경부적합', content: '작업장 출입구 손 세척·소독 설비 관리기록 일부 누락', dept: '품질팀', dueDate: '2025-06-13', status: '완료' });
    addFinding(a1.id, { category: '선행요건-제조시설·설비', grade: '경부적합', content: '원료투입구 주변 분진 퇴적, 청소주기 기준 미준수', dept: '생산팀', dueDate: '2025-06-13', status: '완료' });
    addFinding(a1.id, { category: 'HACCP-기록관리', grade: '관찰사항', content: 'CCP 모니터링 일지 서명 누락 건 확인', dept: '품질팀', dueDate: '2025-06-30', status: '완료' });

    const a2 = addAudit({ year: 2026, type: '조사·평가', date: '2026-04-22', agency: '한국식품안전관리인증원', factory: 'NS', result: '조건부 적합', score: 91, auditor: '심사팀' });
    addFinding(a2.id, { category: '선행요건-제조시설·설비', grade: '경부적합', content: '출입문 개폐 관리 미흡 — 방충·방서 취약', dept: '생산팀', dueDate: '2026-05-22', status: '조치중' });
    addFinding(a2.id, { category: '선행요건-검사관리', grade: '중부적합', content: '계측기 교정 유효기간 경과 장비 사용 확인', dept: '품질팀', dueDate: '2026-05-22', status: '미조치' });
    addFinding(a2.id, { category: '교육훈련', grade: '관찰사항', content: '신규 입사자 HACCP 교육 이수 기록 미비', dept: '관리팀', dueDate: '2026-06-30', status: '조치중' });

    const a3 = addAudit({ year: 2026, type: '자체 점검', date: '2026-06-10', agency: '내부 품질팀', factory: 'GS', result: '적합', score: null, auditor: '품질팀' });
    addFinding(a3.id, { category: '선행요건-보관·운송', grade: '권고사항', content: '완제품 창고 파렛트 적재 높이 기준 게시 권고', dept: '물류팀', dueDate: '', status: '완료' });

    localStorage.setItem(SEED_KEY, SEED_VERSION);
  };

  return {
    AUDIT_TYPES, GRADES, GRADE_META, CATEGORIES, AUDIT_STANDARDS, standardOf, categoriesFor, RESULTS, STATUS, STATUS_META, FACTORIES, factoryName,
    getAudits, getAudit, years, allFindings, isOverdue,
    addAudit, updateAudit, deleteAudit,
    addFinding, updateFinding, deleteFinding, addAction, deleteAction,
    yearStats, yearTrend, byCategory, repeated, openFindings,
    initSampleData,
  };
})();
