// ============================================================
// pest_db.js — 구서(방서)관리 데이터 레이어 (localStorage)
//   방역업체A 등 방역업체 월간 결과보고서를 공장별·월별로 등록·조회
//   factory 코드는 나머지 시스템과 동일: AS(아산)/GS(경산)/NS(논산)/HQ(본사)
// ============================================================

const PestDB = (() => {
  const KEY = 'pest_reports';
  const now = () => new Date().toISOString();
  const notifyWrite = (key) => { try { if (typeof window !== 'undefined' && window.__onDbWrite) window.__onDbWrite(key); } catch (_) {} };
  const get = () => JSON.parse(localStorage.getItem(KEY) || '[]');
  const set = (data) => { localStorage.setItem(KEY, JSON.stringify(data)); notifyWrite(KEY); };

  const sumVals = (obj) => Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0);

  // ── 위치 마스터 (구분: 공장 / 영업소) ──
  //   공장은 기존 factory 코드(GS/AS/HQ) 재사용 → 기존 데이터 그대로 보존.
  //   ※ 논산은 방역업체·시설이 논산1공장/논산2공장으로 분리되어 있어, 구서관리에서만
  //     NS1/NS2 로 나눠 관리한다. 전역 factory 코드 'NS' 는 그대로 두고 여기서만 확장하며,
  //     레거시 'NS'(구 통합 논산공장) 데이터는 논산2공장(NS2)으로 이관한다(locOf·initSampleData).
  const LOCATIONS = [
    { code: 'NS1', name: '논산1공장', group: '공장' },
    { code: 'NS2', name: '논산2공장', group: '공장' },
    { code: 'GS', name: '경산공장', group: '공장' },
    { code: 'AS', name: '아산공장', group: '공장' },
    { code: 'HQ', name: '본사',     group: '공장' },
    { code: 'YA', name: '안동영업소', group: '영업소' },
    { code: 'NJ', name: '나주영업소', group: '영업소' },
    { code: 'SU', name: '서울영업소', group: '영업소' },
    { code: 'GW', name: '경원영업소', group: '영업소' },
    { code: 'HS', name: '홍성영업소', group: '영업소' },
    { code: 'GN', name: '경남영업소', group: '영업소' },
  ];
  const GROUPS = ['공장', '영업소'];
  const getLocations = (group) => group ? LOCATIONS.filter(l => l.group === group) : LOCATIONS.slice();
  const locationName = (code) => (LOCATIONS.find(l => l.code === code) || {}).name || code || '-';
  const locationGroup = (code) => (LOCATIONS.find(l => l.code === code) || {}).group || '기타';
  // 레코드의 위치 코드(구버전 factory 필드 호환) — 레거시 'NS'는 논산2공장으로 정규화
  const locOf = (r) => { const c = r.location || r.factory || 'NS2'; return c === 'NS' ? 'NS2' : c; };

  // filter: 'ALL'|undefined → 전체 · '공장'/'영업소' → 구분 · 그 외 → 위치코드
  const matchFilter = (r, filter) => {
    if (!filter || filter === 'ALL') return true;
    if (filter === '공장' || filter === '영업소') return locationGroup(locOf(r)) === filter;
    return locOf(r) === filter;
  };
  const getReports = (filter) => get()
    .filter(r => matchFilter(r, filter))
    .sort((a, b) => String(b.month).localeCompare(String(a.month)));
  const getReport = (id) => get().find(r => r.id === id);
  const getReportByMonth = (loc, month) => get().find(r => r.month === month && locOf(r) === loc);

  const addReport = (rep) => {
    const all = get();
    const month = rep.month || new Date().toISOString().slice(0, 7);
    let location = rep.location || rep.factory || 'NS2';
    if (location === 'NS') location = 'NS2';   // 레거시 통합 논산 → 논산2공장
    const clean = {
      id: rep.id || (`PEST-${location}-${month}`),
      month,
      location,
      factory: location,   // 하위호환(동기화·구버전 코드에서 factory 참조)
      periodStart: rep.periodStart || (month + '-01'),
      periodEnd: rep.periodEnd || '',
      visits: Array.isArray(rep.visits) ? rep.visits : [],
      ratBreakdown: rep.ratBreakdown || {},
      insectBreakdown: rep.insectBreakdown || {},
      facilityCheck: rep.facilityCheck || {},
      facilityIssues: Array.isArray(rep.facilityIssues) ? rep.facilityIssues : [],
      facilityResolutions: (rep.facilityResolutions && typeof rep.facilityResolutions === 'object') ? rep.facilityResolutions : {},
      note: rep.note || '',
      source: rep.source || '',
      manual: !!rep.manual,
      createdAt: now(),
    };
    const idx = all.findIndex(r => r.month === month && locOf(r) === location);
    if (idx >= 0) all[idx] = { ...all[idx], ...clean, id: all[idx].id };
    else all.push(clean);
    set(all);
    return clean;
  };
  const updateReport = (id, patch) => {
    const all = get();
    const i = all.findIndex(r => r.id === id);
    if (i < 0) return null;
    const before = { ...all[i] };
    all[i] = { ...all[i], ...patch, id: all[i].id };
    if (window.AuditLog) AuditLog.record(all[i], before, {
      month: '월', factory: '공장', vendor: '방역업체', visits: '방문횟수',
      ratBreakdown: '쥐 내역', insectBreakdown: '해충 내역', findings: '지적사항',
      actions: '조치', note: '비고', periodStart: '시작일', periodEnd: '종료일',
    }, { by: patch.updatedBy });
    set(all);
    return all[i];
  };
  const deleteReport = (id) => { set(get().filter(r => r.id !== id)); };

  // 파생값
  const ratTotal = (rep) => sumVals(rep.ratBreakdown);
  const insectTotal = (rep) => sumVals(rep.insectBreakdown);
  const grandTotal = (rep) => ratTotal(rep) + insectTotal(rep);

  // ── 시설점검 개선(해결) 이력 ──
  //   각 리포트의 facilityIssues[idx] 특이사항을 개별 추적. 개선 완료 시
  //   report.facilityResolutions[idx] = { improvement, photos:[dataURL...], by, resolvedAt } 저장.
  //   → 개선내역·사진을 남기고 '양호'로 전환, 미해결 건수에서 제외된다.
  const issueResolution = (rep, idx) => (rep && rep.facilityResolutions ? rep.facilityResolutions[idx] : null) || null;
  const issueResolved = (rep, idx) => !!issueResolution(rep, idx);
  // 미해결(개선 미완료) 건수: 특이사항 목록이 있으면 그중 미개선 항목 수, 없으면 시설점검 카운트로 폴백
  const facilityOpenCount = (rep) => {
    const issues = (rep && rep.facilityIssues) || [];
    if (issues.length) return issues.reduce((s, _, i) => s + (issueResolved(rep, i) ? 0 : 1), 0);
    const fc = (rep && rep.facilityCheck) || {};
    return (fc.개선진행중 || 0) + (fc.개선예정 || 0) + (fc.개선미진행 || 0);
  };
  const facilityIssueCount = (rep) => ((rep && rep.facilityIssues) || []).length;
  const facilityResolvedCount = (rep) => facilityIssueCount(rep) - facilityOpenCount(rep);

  // 시설 이슈 개선 완료 처리 / 되돌리기
  const resolveIssue = (id, idx, data) => {
    const all = get();
    const i = all.findIndex(r => r.id === id);
    if (i < 0) return null;
    const r = all[i];
    r.facilityResolutions = r.facilityResolutions || {};
    r.facilityResolutions[idx] = {
      improvement: (data && data.improvement) || '',
      photos: (data && Array.isArray(data.photos)) ? data.photos : [],
      by: (data && data.by) || '',
      resolvedAt: (data && data.resolvedAt) || now(),
    };
    set(all);
    return r;
  };
  const unresolveIssue = (id, idx) => {
    const all = get();
    const i = all.findIndex(r => r.id === id);
    if (i < 0) return null;
    if (all[i].facilityResolutions) delete all[i].facilityResolutions[idx];
    set(all);
    return all[i];
  };

  // 전월(같은 위치) 대비 벌레 포획량 급증(3배 이상) 여부 — 이상치 경보
  const spikeVsPrevMonth = (rep) => {
    const sameFactory = getReports(locOf(rep)); // desc by month, 같은 위치만
    const idx = sameFactory.findIndex(r => r.id === rep.id);
    const prev = idx >= 0 ? sameFactory[idx + 1] : null; // desc 정렬이므로 다음 인덱스가 이전 달
    if (!prev) return null;
    const cur = insectTotal(rep), prv = insectTotal(prev);
    if (prv <= 0) return null;
    const ratio = cur / prv;
    if (ratio < 3) return null;
    return { prevMonth: prev.month, prevValue: prv, curValue: cur, ratio: +ratio.toFixed(1) };
  };

  // factory: 'ALL'|undefined → 전체 공장 통합, 그 외 → 해당 공장만
  const stats = (factory) => {
    const all = getReports(factory);
    if (!all.length) return { months: 0, latest: null, latestRat: 0, latestInsect: 0, latestTotal: 0, openFacility: 0, spike: null };
    const latest = all[0];
    const openFacility = all.reduce((s, r) => s + facilityOpenCount(r), 0);
    return {
      months: all.length,
      latest,
      latestRat: ratTotal(latest),
      latestInsect: insectTotal(latest),
      latestTotal: grandTotal(latest),
      openFacility: facilityOpenCount(latest),
      openFacilityAll: openFacility,
      spike: spikeVsPrevMonth(latest),
    };
  };

  // ── 위치별 최신 집계 (구분/위치 분석용) ──
  //   각 위치의 최근월 리포트 기준 쥐·벌레·합계·시설미해결·전월대비 급증
  const byLocationStats = (group) => {
    const locs = getLocations(group);
    return locs.map(l => {
      const reps = getReports(l.code); // desc by month
      const latest = reps[0] || null;
      return {
        code: l.code, name: l.name, group: l.group,
        months: reps.length,
        latestMonth: latest ? latest.month : null,
        rat: latest ? ratTotal(latest) : 0,
        insect: latest ? insectTotal(latest) : 0,
        total: latest ? grandTotal(latest) : 0,
        openFacility: latest ? facilityOpenCount(latest) : 0,
        spike: latest ? spikeVsPrevMonth(latest) : null,
        hasData: reps.length > 0,
      };
    });
  };
  // 구분(공장/영업소)별 최신월 합계
  const groupTotals = () => {
    const out = {};
    GROUPS.forEach(g => {
      const rows = byLocationStats(g).filter(r => r.hasData);
      out[g] = {
        locations: rows.length,
        rat: rows.reduce((s, r) => s + r.rat, 0),
        insect: rows.reduce((s, r) => s + r.insect, 0),
        total: rows.reduce((s, r) => s + r.total, 0),
        // 시설 미해결: 최근월만이 아니라 해당 구분의 모든 리포트에서 아직 개선되지 않은 특이사항 총합
        //   (개선 완료 처리하면 즉시 감소 → 하단 목록/상세와 연동)
        openFacility: getReports(g).reduce((s, r) => s + facilityOpenCount(r), 0),
        spikes: rows.filter(r => r.spike).length,
      };
    });
    return out;
  };
  // 위치별 월 추이 (특정 metric: 'rat'|'insect'|'total') → {months:[], series:[{code,name,data:[]}]}
  const locationTrend = (group, metric) => {
    const m = metric || 'total';
    const locs = getLocations(group).filter(l => getReports(l.code).length);
    const monthSet = new Set();
    get().forEach(r => { if (!group || locationGroup(locOf(r)) === group) monthSet.add(r.month); });
    const months = [...monthSet].sort();
    const metricVal = (rep) => m === 'rat' ? ratTotal(rep) : m === 'insect' ? insectTotal(rep) : grandTotal(rep);
    const series = locs.map(l => {
      const byMonth = {};
      getReports(l.code).forEach(r => { byMonth[r.month] = metricVal(r); });
      return { code: l.code, name: l.name, data: months.map(mo => byMonth[mo] ?? null) };
    });
    return { months, series };
  };

  const SEED_VERSION = '2026-07-27-noicon';   // 시드 노트의 기호 제거 반영
  const SEED_VER_KEY = 'pest_seed_ver';
  const initSampleData = () => {
    const ver = localStorage.getItem(SEED_VER_KEY);
    if (ver === SEED_VERSION) return;
    // 서버가 이미 방역 리포트를 갖고 있으면 시드를 다시 적용하지 않는다 — 이 기기가 지우고 다시 깔면
    //   그 삭제·변경이 서버로 올라가 모든 기기에 퍼진다(lab_sqf 사례, 2026-10-16)
    if (typeof Sync !== 'undefined' && Sync.serverHas && Sync.serverHas(KEY)) {
      localStorage.setItem(SEED_VER_KEY, SEED_VERSION);
      return;
    }
    const existing = get();
    // 레거시 'NS'(구 통합 논산공장) → 'NS2'(논산2공장) 이관: 기존 논산 방역 데이터는 모두 논산2공장 기준
    existing.forEach(r => {
      if (r.location === 'NS' || (!r.location && r.factory === 'NS')) r.location = 'NS2';
      if (r.factory === 'NS') r.factory = 'NS2';
      if (typeof r.id === 'string' && r.id.startsWith('PEST-NS-')) r.id = r.id.replace('PEST-NS-', 'PEST-NS2-');
    });
    const manualKeys = new Set(existing.filter(r => r.manual).map(r => (r.factory || 'NS2') + '|' + r.month));
    const seed = (typeof window !== 'undefined' && window.WS_PEST_SEED) || [];
    const fresh = seed.filter(r => !manualKeys.has((r.factory || 'NS2') + '|' + r.month)).map(r => ({ ...r, factory: r.factory || 'NS2', manual: false }));
    // 시설점검 개선(해결) 이력은 시드 재적용 시에도 보존 — 기존 리포트 id 기준으로 이관
    const resById = {};
    existing.forEach(r => { if (r.facilityResolutions && Object.keys(r.facilityResolutions).length) resById[r.id] = r.facilityResolutions; });
    fresh.forEach(r => { if (resById[r.id]) r.facilityResolutions = resById[r.id]; });
    const manual = existing.filter(r => r.manual);
    set(manual.concat(fresh));
    localStorage.setItem(SEED_VER_KEY, SEED_VERSION);
  };

  return {
    getReports, getReport, getReportByMonth, addReport, updateReport, deleteReport,
    ratTotal, insectTotal, grandTotal, facilityOpenCount, spikeVsPrevMonth, stats,
    facilityIssueCount, facilityResolvedCount, issueResolution, issueResolved, resolveIssue, unresolveIssue,
    initSampleData,
    // 위치·구분
    LOCATIONS, GROUPS, getLocations, locationName, locationGroup, locOf,
    byLocationStats, groupTotals, locationTrend,
  };
})();
