// ============================================================
// office_audit_db.js — 영업소 심사 체크리스트 데이터 레이어 (localStorage)
//   원본: 품질 데이터/HACCP/유효성평가/…/영업소 심사 체크리스트.pdf (별첨#5)
//   5개 구분(제품40·물류16·위생32·안전6·기타6) = 100점 만점, 영업소별·심사일별 누적
// ============================================================

const OfficeAuditDB = (() => {
  const KEY = 'office_audits';
  const SEED_VER_KEY = 'office_audit_seed_ver';
  const SEED_VERSION = '2026-07-22-oa1';
  const now = () => new Date().toISOString();
  const notifyWrite = (key) => { try { if (typeof window !== 'undefined' && window.__onDbWrite) window.__onDbWrite(key); } catch (_) {} };
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
  const set = (data) => { localStorage.setItem(KEY, JSON.stringify(data)); notifyWrite(KEY); };

  // ── 영업소 마스터 (편집 가능 · localStorage) ──
  //   기본값은 아래 6개. 사용자가 추가/이름변경/삭제 가능(영업소 조직 변경 대응).
  //   코드는 audit 레코드의 office 키로 쓰이므로 이름을 바꿔도 기존 심사 연결 유지.
  const OFFICE_KEY = 'office_audit_offices';
  const DEFAULT_OFFICES = [
    { code: 'YA', name: '안동영업소' },
    { code: 'NJ', name: '나주영업소' },
    { code: 'SU', name: '서울영업소' },
    { code: 'GW', name: '경원영업소' },
    { code: 'HS', name: '홍성영업소' },
    { code: 'GN', name: '경남영업소' },
  ];
  const getOffices = () => {
    try { const s = JSON.parse(localStorage.getItem(OFFICE_KEY)); if (Array.isArray(s) && s.length) return s; } catch (_) {}
    return DEFAULT_OFFICES.slice();
  };
  const setOffices = (list) => { localStorage.setItem(OFFICE_KEY, JSON.stringify(list)); notifyWrite(OFFICE_KEY); };
  // 이름 조회: 현재 목록 → 기본값(삭제된 레거시 코드도 표시) → 코드
  const officeName = (code) => {
    const hit = getOffices().find(o => o.code === code) || DEFAULT_OFFICES.find(o => o.code === code);
    return (hit && hit.name) || code || '-';
  };
  const officeHasAudits = (code) => get().some(a => a.office === code);
  const addOffice = (name) => {
    name = String(name || '').trim(); if (!name) return null;
    const list = getOffices();
    if (list.some(o => o.name === name)) return null;    // 이름 중복 방지
    const code = 'OF' + Date.now().toString(36);
    list.push({ code, name });
    setOffices(list);
    return { code, name };
  };
  const renameOffice = (code, name) => {
    name = String(name || '').trim(); if (!name) return false;
    const list = getOffices(); const o = list.find(x => x.code === code); if (!o) return false;
    if (list.some(x => x.code !== code && x.name === name)) return false;
    o.name = name; setOffices(list); return true;
  };
  const removeOffice = (code) => { setOffices(getOffices().filter(o => o.code !== code)); };

  // ── 심사 체크리스트 템플릿 (원본 양식 그대로) ──
  //   각 항목 opts: [ [등급라벨, 배점], ... ] · 항목별 배점이 다름
  const CHECKLIST = [
    { key: '제품', max: 40, items: [
      { id: 'PR1', q: '축종별(축우/양돈, 양계/양어, 양견)로 구분 관리 되는가?', opts: [['우수', 7], ['미흡', 0]] },
      { id: 'PR2', q: '항생제 유무에 따라 구분 관리 되는가?', opts: [['우수', 7], ['미흡', 0]] },
      { id: 'PR3', q: '반품사료는 구분관리 되는가?', opts: [['우수', 5], ['미흡', 0]] },
      { id: 'PR4', q: '벌크차/벌크빈 크리닝은 실시하는가?', opts: [['우수', 5], ['미흡', 0]] },
      { id: 'PR5', q: '공지대의 표기내용은 등록사항과 일치하는가?', opts: [['우수', 5], ['미흡', 0]] },
      { id: 'PR6', q: '톤백 속에 잔류 물질이 없는가?', opts: [['우수', 4], ['보통', 2], ['미흡', 0]] },
      { id: 'PR7', q: '파포는 구분관리 및 즉시 처리되는가?', opts: [['우수', 4], ['보통', 2], ['미흡', 0]] },
      { id: 'PR8', q: '제품 보관 상태(먼지오염, 햇빛 노출 등)는 양호한가?', opts: [['우수', 3], ['보통', 2], ['미흡', 1]] },
    ] },
    { key: '물류', max: 16, items: [
      { id: 'LO1', q: '적정재고를 유지하고 있는가?', opts: [['우수', 2], ['보통', 1], ['미흡', 0]] },
      { id: 'LO2', q: '사전주문은 잘 이루어지고 있는가?', opts: [['우수', 2], ['보통', 1], ['미흡', 0]] },
      { id: 'LO3', q: '선입선출 및 제조일자 관리는 잘 되고 있는가?', opts: [['우수', 2], ['보통', 1], ['미흡', 0]] },
      { id: 'LO4', q: '벌크 배차 운영은 원활한가? (고객요구시간 준수)', opts: [['우수', 2], ['보통', 1], ['미흡', 0]] },
      { id: 'LO5', q: '톤백 상차 후 배합사료성분표는 고객에게 제공하는가?', opts: [['우수', 2], ['보통', 1], ['미흡', 0]] },
      { id: 'LO6', q: '벌크 간이빈 운영은 효율적인가?(톤백 대비 비율)', opts: [['우수', 2], ['보통', 1], ['미흡', 0]] },
      { id: 'LO7', q: '공장과 영업소의 중량차이는 없는가?', opts: [['우수', 2], ['보통', 1], ['미흡', 0]] },
      { id: 'LO8', q: '계근대는 정기적으로 점검하는가?', opts: [['우수', 2], ['보통', 1], ['미흡', 0]] },
    ] },
    { key: '위생', max: 32, items: [
      { id: 'HY1', q: '제품 창고는 청결한가? (거미줄, 분진 등)', opts: [['우수', 4], ['보통', 3], ['미흡', 2]] },
      { id: 'HY2', q: '구서/구충은 정기적으로 실시 되는가?', opts: [['우수', 4], ['보통', 3], ['미흡', 2]] },
      { id: 'HY3', q: '소독약 희석비율을 준수하고 있는가?', opts: [['우수', 4], ['보통', 3], ['미흡', 2]] },
      { id: 'HY4', q: '소독실시 관리 대장은 잘 기록되고 있는가?', opts: [['우수', 3], ['보통', 2], ['미흡', 1]] },
      { id: 'HY5', q: '소독실 운영 및 청결 상태는 양호한가?', opts: [['우수', 3], ['보통', 2], ['미흡', 1]] },
      { id: 'HY6', q: '영업소 내 전체 소독은 이루어 지고 있는가?', opts: [['우수', 3], ['보통', 2], ['미흡', 1]] },
      { id: 'HY7', q: '벌크차 부착 소독기는 잘 작동하는가?', opts: [['우수', 3], ['보통', 2], ['미흡', 1]] },
      { id: 'HY8', q: '벌크 차량은 청결한가?', opts: [['우수', 2], ['보통', 1], ['미흡', 0]] },
      { id: 'HY9', q: '누수가 발생되는 곳은 없는가?', opts: [['우수', 2], ['보통', 1], ['미흡', 0]] },
      { id: 'HY10', q: '청소 도구는 제자리에 있는가(빗자루, 삽 등)', opts: [['우수', 2], ['보통', 1], ['미흡', 0]] },
      { id: 'HY11', q: '도색이 필요한 곳은 없는가?', opts: [['우수', 2], ['보통', 1], ['미흡', 0]] },
    ] },
    { key: '안전', max: 6, items: [
      { id: 'SA1', q: '작업장에 안전 표지판은 부착되어 있는가?', opts: [['우수', 2], ['보통', 1], ['미흡', 0]] },
      { id: 'SA2', q: '작업자는 근무복 및 안전화를 착용하고 있는가?', opts: [['우수', 2], ['보통', 1], ['미흡', 0]] },
      { id: 'SA3', q: '상차대는 안전에 문제가 없는가?', opts: [['우수', 2], ['보통', 1], ['미흡', 0]] },
    ] },
    { key: '기타', max: 6, items: [
      { id: 'ET1', q: '고객과의 전화예절은 잘 지켜지고 있는가?', opts: [['우수', 3], ['보통', 2], ['미흡', 1]] },
      { id: 'ET2', q: '지대상차 용역과 벌크차량 기사의 협력은 잘 이루어지는가?', opts: [['우수', 3], ['보통', 2], ['미흡', 1]] },
    ] },
  ];
  const ITEMS = CHECKLIST.reduce((a, c) => a.concat(c.items.map(it => ({ ...it, cat: c.key }))), []);
  const itemById = (id) => ITEMS.find(i => i.id === id);
  const catByKey = (key) => CHECKLIST.find(c => c.key === key);
  const MAX_TOTAL = CHECKLIST.reduce((s, c) => s + c.max, 0); // 100
  // 항목 배점→등급라벨 (항목 내 배점은 서로 다르므로 유일)
  const optLabel = (itemId, pts) => {
    const it = itemById(itemId); if (!it) return String(pts);
    const hit = it.opts.find(([, p]) => p === pts);
    return hit ? hit[0] : String(pts);
  };

  // ── 파생 점수 ──
  const categoryScore = (audit, catKey) => {
    const c = catByKey(catKey); if (!c) return 0;
    return c.items.reduce((s, it) => { const v = audit && audit.scores ? audit.scores[it.id] : undefined; return s + (v == null ? 0 : Number(v) || 0); }, 0);
  };
  const categoryMax = (catKey) => (catByKey(catKey) || {}).max || 0;
  const totalScore = (audit) => CHECKLIST.reduce((s, c) => s + categoryScore(audit, c.key), 0);
  const filledCount = (audit) => ITEMS.reduce((n, it) => n + ((audit && audit.scores && audit.scores[it.id] != null) ? 1 : 0), 0);
  const gradeOf = (total) => {
    const p = MAX_TOTAL ? (total / MAX_TOTAL) * 100 : 0;
    if (p >= 90) return { g: 'A', label: '우수', color: '#0a7d28' };
    if (p >= 80) return { g: 'B', label: '양호', color: '#3E6AE1' };
    if (p >= 70) return { g: 'C', label: '보통', color: '#c67f22' };
    return { g: 'D', label: '미흡', color: '#c62222' };
  };

  // ── 조회 ──
  const getAudits = (office) => get()
    .filter(a => !office || office === 'ALL' || a.office === office)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const getAudit = (id) => get().find(a => a.id === id);

  const saveAudit = (rec) => {
    const all = get();
    const date = rec.date || new Date().toISOString().slice(0, 10);
    const office = rec.office;
    const id = rec.id || `OA-${office}-${date}`;
    const idx = all.findIndex(a => a.id === id);
    const clean = {
      id,
      office,
      date,
      auditor: rec.auditor || '',
      scores: rec.scores || {},
      improvements: Array.isArray(rec.improvements) ? rec.improvements : [],
      note: rec.note || '',
      enteredBy: rec.enteredBy || (idx >= 0 ? all[idx].enteredBy : '') || '',
      manual: rec.manual !== false,
      createdAt: (idx >= 0 && all[idx].createdAt) || now(),
      updatedAt: now(),
    };
    if (idx >= 0) all[idx] = clean; else all.push(clean);
    set(all);
    return clean;
  };
  const deleteAudit = (id) => set(get().filter(a => a.id !== id));

  // ── 대시보드 집계 ──
  const latestByOffice = () => getOffices().map(o => {
    const list = getAudits(o.code);
    const latest = list[0] || null;
    return {
      code: o.code, name: o.name, count: list.length,
      latest, latestDate: latest ? latest.date : null,
      total: latest ? totalScore(latest) : null,
      avg: list.length ? Math.round(list.reduce((s, a) => s + totalScore(a), 0) / list.length) : null,
    };
  });
  // 특정 영업소(또는 전체 평균) 총점 추이 — 오름차순
  const totalTrend = (office) => {
    if (!office || office === 'ALL') {
      // 심사일별 전체 평균 총점
      const byDate = new Map();
      get().forEach(a => { const k = a.date; const c = byDate.get(k) || { sum: 0, n: 0 }; c.sum += totalScore(a); c.n++; byDate.set(k, c); });
      return [...byDate.keys()].sort().map(d => ({ date: d, total: Math.round(byDate.get(d).sum / byDate.get(d).n) }));
    }
    return getAudits(office).slice().reverse().map(a => ({ date: a.date, total: totalScore(a) }));
  };
  // 카테고리별 달성률(%) — 선택 범위 평균 (레이더용)
  const categoryRates = (office) => {
    const list = getAudits(office);
    return CHECKLIST.map(c => {
      if (!list.length) return { key: c.key, rate: 0, avg: 0, max: c.max };
      const avg = list.reduce((s, a) => s + categoryScore(a, c.key), 0) / list.length;
      return { key: c.key, rate: c.max ? Math.round(avg / c.max * 100) : 0, avg: Math.round(avg * 10) / 10, max: c.max };
    });
  };
  // 최근 심사에서 만점 미달 항목(개선 필요) 목록
  const attentionItems = (office) => {
    const list = getAudits(office);
    const latest = list[0]; if (!latest) return [];
    return ITEMS.filter(it => {
      const v = latest.scores ? latest.scores[it.id] : undefined;
      const max = Math.max(...it.opts.map(o => o[1]));
      return v != null && Number(v) < max;
    }).map(it => {
      const v = Number(latest.scores[it.id]);
      const max = Math.max(...it.opts.map(o => o[1]));
      const imp = (latest.improvements || []).find(x => x.id === it.id);
      return { id: it.id, cat: it.cat, q: it.q, score: v, max, label: optLabel(it.id, v), note: imp ? imp.note : '' };
    });
  };

  // ── 시드(원본 나주영업소 2024-01-24 심사 실측) ──
  const SEED = [{
    id: 'OA-NJ-2024-01-24',
    office: 'NJ',
    date: '2024-01-24',
    auditor: '김경로',
    scores: {
      PR1: 7, PR2: 7, PR3: 5, PR4: 5, PR5: 5, PR6: 4, PR7: 4, PR8: 1,
      LO1: 1, LO2: 2, LO3: 1, LO4: 2, LO5: 2, LO6: 2, LO7: 2, LO8: 1,
      HY1: 4, HY2: 4, HY3: 4, HY4: 3, HY5: 2, HY6: 3, HY7: 3, HY8: 2, HY9: 1, HY10: 1, HY11: 1,
      SA1: 1, SA2: 1, SA3: 1,
      ET1: 3, ET2: 3,
    },
    improvements: [
      { id: 'PR8', note: '제품 보관상태 미흡 — 먼지오염/햇빛노출 개선 필요' },
      { id: 'HY9', note: '일부 누수 발생 — 보수 필요' },
      { id: 'HY10', note: '청소도구 제자리 정리정돈 필요' },
      { id: 'SA2', note: '작업자 안전화 미착용 — 착용 지도 필요' },
    ],
    note: '2024년 1월 24일 나주영업소 정기심사(유효성평가). 구분별 제품38·물류13·위생28·안전3·기타6 = 총점 88/100. 개선요망사항은 원본 수기 메모 기준(일부 항목 판독).',
    enteredBy: '',
    manual: false,
  }];

  const initSampleData = () => {
    // 서버가 이미 내려준 데이터가 있으면 시드가 다시 개입하지 않는다(현장 편집분 보존)
    if (window.Sync && Sync.serverHas && Sync.serverHas(KEY)) {
      try { localStorage.setItem(SEED_VER_KEY, SEED_VERSION); } catch (_) {}
      return;
    }
    const ver = localStorage.getItem(SEED_VER_KEY);
    if (ver === SEED_VERSION) return;
    const existing = get();
    const manual = existing.filter(a => a.manual !== false);       // 사용자 입력·수정분 보존
    const manualIds = new Set(manual.map(a => a.id));
    const fresh = SEED.filter(s => !manualIds.has(s.id)).map(s => ({ ...s, manual: false, createdAt: now(), updatedAt: now() }));
    set(manual.concat(fresh));
    localStorage.setItem(SEED_VER_KEY, SEED_VERSION);
  };

  return {
    CHECKLIST, ITEMS, MAX_TOTAL,
    getOffices, addOffice, renameOffice, removeOffice, officeHasAudits,
    officeName, itemById, catByKey, categoryMax, optLabel,
    categoryScore, totalScore, filledCount, gradeOf,
    getAudits, getAudit, saveAudit, deleteAudit,
    latestByOffice, totalTrend, categoryRates, attentionItems,
    initSampleData,
  };
})();
