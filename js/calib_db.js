// ============================================================
// calib_db.js — 계측기 검교정 관리 데이터 레이어 (localStorage)
//   HACCP 선행요건 필수 항목: 측정 신뢰성 확보를 위한 계측기 교정주기 관리
//   식품안전관리인증원 범용 HACCP MES 표준모델의 '검교정관리'에 대응
//   공장별 분리(factory) — App.getFactory() 와 연동
// ============================================================

const CalibDB = (() => {
  const KEY = 'calib_instruments';
  const now = () => new Date().toISOString();
  // 날짜는 로컬 기준으로 포맷한다(toISOString 은 UTC 라 KST에서 하루 앞당겨짐)
  const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => ymdLocal(new Date());
  const notifyWrite = (k) => { try { if (typeof window !== 'undefined' && window.__onDbWrite) window.__onDbWrite(k); } catch (_) {} };
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
  const set = (data) => { localStorage.setItem(KEY, JSON.stringify(data)); notifyWrite(KEY); };

  // 계측기 종류 — 사료공장·실험실 기준
  const TYPES = ['저울/계량', '온도계', '습도계', '금속검출기', 'NIR 분석기', '수분측정기', 'pH미터', '체건조기/오븐', '기타 분석기기', '기타'];
  // 교정 주기 프리셋(개월)
  const CYCLES = [6, 12, 24, 36];
  // 임박 판정 기준(일)
  const DUE_DAYS = 30;

  const FACTORIES = [
    { code: 'NS', name: '논산공장' },
    { code: 'GS', name: '경산공장' },
    { code: 'AS', name: '아산공장' },
    { code: 'HQ', name: '본사' },
  ];
  const factoryName = (c) => (FACTORIES.find(f => f.code === c) || {}).name || c || '-';

  // ── 날짜 계산 ──
  const addMonths = (dateStr, months) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return '';
    const day = d.getDate();
    d.setMonth(d.getMonth() + (Number(months) || 0));
    // 말일 보정(예: 1/31 + 1개월 → 2/28)
    if (d.getDate() < day) d.setDate(0);
    return ymdLocal(d);
  };
  const daysBetween = (from, to) => {
    if (!from || !to) return null;
    const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00');
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  };
  // 차기 교정일: 명시값 우선, 없으면 최근교정일 + 주기
  const nextDateOf = (it) => it.nextDate || addMonths(it.lastDate, it.cycleMonths);
  const ddayOf = (it) => daysBetween(today(), nextDateOf(it));

  // 상태: overdue(기한경과) / due(임박) / valid(유효) / none(미교정)
  const statusOf = (it) => {
    const nd = nextDateOf(it);
    if (!it.lastDate || !nd) return 'none';
    const d = daysBetween(today(), nd);
    if (d == null) return 'none';
    if (d < 0) return 'overdue';
    if (d <= DUE_DAYS) return 'due';
    return 'valid';
  };
  const STATUS_META = {
    valid:   { label: '유효',     cls: 'badge-pass',    tone: 'ok' },
    due:     { label: '교정임박', cls: 'badge-warning', tone: 'warn' },
    overdue: { label: '기한경과', cls: 'badge-fail',    tone: 'danger' },
    none:    { label: '미교정',   cls: 'badge-default', tone: 'warn' },
  };

  // ── 조회 ──
  const matchFactory = (it, factory) => !factory || factory === 'ALL' || it.factory === factory;
  const getAll = (factory) => get()
    .filter(it => it.active !== false && matchFactory(it, factory))
    .sort((a, b) => {
      // 기한경과 → 임박 → 미교정 → 유효 순, 같은 상태면 차기교정일 빠른 순
      const rank = { overdue: 0, due: 1, none: 2, valid: 3 };
      const ra = rank[statusOf(a)], rb = rank[statusOf(b)];
      if (ra !== rb) return ra - rb;
      return String(nextDateOf(a) || '9999').localeCompare(String(nextDateOf(b) || '9999'));
    });
  const getById = (id) => get().find(it => it.id === id);

  // ── 등록/수정/삭제 ──
  const genCode = () => {
    const used = new Set(get().map(i => i.code).filter(Boolean));
    let n = 1;
    while (used.has('CAL' + String(n).padStart(3, '0'))) n++;
    return 'CAL' + String(n).padStart(3, '0');
  };
  const add = (data) => {
    const all = get();
    const rec = {
      id: 'CALIB-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
      code: data.code || genCode(),
      name: (data.name || '').trim(),
      type: data.type || '기타',
      factory: data.factory || 'NS',
      location: (data.location || '').trim(),
      maker: (data.maker || '').trim(),
      model: (data.model || '').trim(),
      serial: (data.serial || '').trim(),
      cycleMonths: Number(data.cycleMonths) || 12,
      lastDate: data.lastDate || '',
      nextDate: data.nextDate || '',
      agency: (data.agency || '').trim(),
      note: (data.note || '').trim(),
      history: Array.isArray(data.history) ? data.history : [],
      active: true,
      createdAt: now(),
    };
    all.push(rec);
    set(all);
    return rec;
  };
  const update = (id, patch) => {
    const all = get();
    const i = all.findIndex(x => x.id === id);
    if (i < 0) return null;
    const before = { ...all[i] };
    all[i] = { ...all[i], ...patch, id: all[i].id };
    if (window.AuditLog) AuditLog.record(all[i], before, {
      name: '계측기명', code: '관리번호', type: '유형', factory: '공장', location: '위치',
      maker: '제조사', model: '모델', serial: '시리얼', cycleMonths: '교정주기(월)',
      lastDate: '최근교정일', nextDate: '차기교정일', range: '측정범위', tolerance: '허용오차', note: '비고',
    }, { by: patch.updatedBy });
    set(all);
    return all[i];
  };
  const remove = (id) => { set(get().filter(x => x.id !== id)); };

  // ── 교정 실시 등록 ──
  //   교정일·기관·결과·성적서를 이력에 남기고, 최근교정일/차기교정일을 갱신한다.
  const addCalibration = (id, rec) => {
    const all = get();
    const i = all.findIndex(x => x.id === id);
    if (i < 0) return null;
    const it = all[i];
    const date = rec.date || today();
    const entry = {
      id: 'CH-' + Date.now().toString(36).toUpperCase(),
      date,
      agency: (rec.agency || '').trim(),
      result: rec.result || '적합',
      cert: rec.cert || null,          // {name, mimeType, size, dataUrl}
      by: (rec.by || '').trim(),
      note: (rec.note || '').trim(),
      createdAt: now(),
    };
    it.history = (it.history || []).concat(entry);
    it.lastDate = date;
    it.nextDate = rec.nextDate || addMonths(date, it.cycleMonths);
    if (entry.agency) it.agency = entry.agency;
    all[i] = it;
    set(all);
    return it;
  };
  const deleteCalibration = (id, histId) => {
    const all = get();
    const i = all.findIndex(x => x.id === id);
    if (i < 0) return null;
    const it = all[i];
    it.history = (it.history || []).filter(h => h.id !== histId);
    // 최근 교정일 재계산
    const last = it.history.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    it.lastDate = last ? last.date : '';
    it.nextDate = last ? addMonths(last.date, it.cycleMonths) : '';
    all[i] = it;
    set(all);
    return it;
  };

  // ── 집계 ──
  const stats = (factory) => {
    const list = getAll(factory);
    const by = { valid: 0, due: 0, overdue: 0, none: 0 };
    list.forEach(it => { by[statusOf(it)]++; });
    return {
      total: list.length,
      ...by,
      // 조치 필요 = 기한경과 + 미교정 (임박은 예고)
      actionNeeded: by.overdue + by.none,
      complianceRate: list.length ? Math.round((by.valid + by.due) / list.length * 100) : 100,
    };
  };
  // 임박·경과 목록(대시보드 알림용)
  const alerts = (factory) => getAll(factory)
    .filter(it => { const s = statusOf(it); return s === 'overdue' || s === 'due' || s === 'none'; })
    .map(it => ({ ...it, status: statusOf(it), dday: ddayOf(it), next: nextDateOf(it) }));

  // ── 시드 ──
  const SEED_VERSION = '2026-07-27-init';
  const SEED_VER_KEY = 'calib_seed_ver';
  const initSampleData = () => {
    if (localStorage.getItem(SEED_VER_KEY) === SEED_VERSION) return;
    if (get().length > 0) { localStorage.setItem(SEED_VER_KEY, SEED_VERSION); return; }
    const d = (offsetDays) => {
      const x = new Date(); x.setDate(x.getDate() + offsetDays);
      return ymdLocal(x);
    };
    const seed = [
      { name: '실험실 정밀저울(0.1mg)', type: '저울/계량', factory: 'NS', location: '품질관리실', maker: 'Sartorius', cycleMonths: 12, lastDate: d(-350), agency: '한국계량측정협회' },
      { name: 'NIR 분석기', type: 'NIR 분석기', factory: 'NS', location: '품질관리실', maker: 'FOSS', cycleMonths: 12, lastDate: d(-200), agency: '제조사 정기점검' },
      { name: '수분측정기', type: '수분측정기', factory: 'NS', location: '품질관리실', maker: 'A&D', cycleMonths: 12, lastDate: d(-400), agency: '한국계량측정협회' },
      { name: '금속검출기 #1', type: '금속검출기', factory: 'NS', location: '포장라인', maker: 'Anritsu', cycleMonths: 6, lastDate: d(-120), agency: '사내 자체점검' },
      { name: '트럭스케일(계근대)', type: '저울/계량', factory: 'NS', location: '계근장', cycleMonths: 24, lastDate: d(-700), agency: '국가기술표준원 정기검사' },
      { name: '실험실 정밀저울(0.1mg)', type: '저울/계량', factory: 'GS', location: '품질관리실', maker: 'Sartorius', cycleMonths: 12, lastDate: d(-30), agency: '한국계량측정협회' },
      { name: '트럭스케일(계근대)', type: '저울/계량', factory: 'GS', location: '계근장', cycleMonths: 24, lastDate: d(-300), agency: '국가기술표준원 정기검사' },
      { name: '실험실 건조기(105℃)', type: '체건조기/오븐', factory: 'AS', location: '품질관리실', cycleMonths: 12, lastDate: d(-60), agency: '사내 자체점검' },
      { name: '금속검출기 #1', type: '금속검출기', factory: 'AS', location: '포장라인', maker: 'Anritsu', cycleMonths: 6, lastDate: d(-250), agency: '사내 자체점검' },
      { name: '창고 온습도계', type: '습도계', factory: 'AS', location: '원료창고', cycleMonths: 12, lastDate: '', agency: '' },
    ];
    seed.forEach(s => add(s));
    localStorage.setItem(SEED_VER_KEY, SEED_VERSION);
  };

  return {
    TYPES, CYCLES, DUE_DAYS, FACTORIES, factoryName, STATUS_META,
    getAll, getById, add, update, remove,
    addCalibration, deleteCalibration,
    statusOf, nextDateOf, ddayOf, addMonths, stats, alerts,
    initSampleData,
  };
})();
