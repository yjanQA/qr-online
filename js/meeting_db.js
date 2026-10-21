// ============================================================
// meeting_db.js — 품질회의 기록·안건 추적 데이터 레이어
//
//   품질회의를 종이 회의록으로 남기면 "무엇을 하기로 했는지"는 남아도
//   "그래서 어떻게 됐는지"가 남지 않는다. 다음 회의에서 같은 얘기가 반복된다.
//   그래서 회의(meeting) 아래 안건(agenda)을 두고, 안건마다 조치 이력(history)을
//   누적해 종결될 때까지 회의를 넘어 따라다니게 한다.
//
//   구조
//     회의 ─┬─ 안건 ─┬─ 조치 이력(누적, 사진 첨부)
//           │        └─ 출처(VOC·부적합·지적사항 등 원본 레코드 연결)
//           └─ 회의자료 첨부
//
//   이월(carry-over)
//     회의를 새로 열면 이전 회의의 미종결 안건을 그대로 끌어온다.
//     끌어온 안건은 원본 안건과 같은 계보(rootId)를 공유하므로
//     "이 건이 몇 번째 회의째 안 끝나고 있는가"를 셀 수 있다.
// ============================================================

const MeetingDB = (() => {
  const KEY = 'quality_meetings';
  const now = () => new Date().toISOString();
  // 로컬 날짜 — toISOString() 은 UTC 라 한국시간 오전에 하루 전 날짜가 나온다
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const notifyWrite = (k) => { try { if (typeof window !== 'undefined' && window.__onDbWrite) window.__onDbWrite(k); } catch (_) {} };
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
  const set = (d) => { localStorage.setItem(KEY, JSON.stringify(d)); notifyWrite(KEY); };
  const uid = (p) => `${p}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

  // ── 코드 정의 ──
  const MEETING_TYPES = [
    '정기 품질회의', '월간 품질회의', 'HACCP 팀회의', 'CCP 검증회의',
    '클레임 대책회의', '부적합 대책회의', '경영자 검토회의', '수시 회의',
  ];
  const AGENDA_CATEGORIES = [
    '고객 클레임', '원료 품질', '제품 품질', '공정 관리', 'HACCP·선행요건',
    '설비·시설', '위생 관리', '문서·기록', '교육 훈련', '협력사 관리', '기타',
  ];
  const PRIORITIES = ['긴급', '높음', '보통', '낮음'];
  const PRIORITY_META = {
    긴급: { cls: 'badge-fail',    weight: 3 },
    높음: { cls: 'badge-warning', weight: 2 },
    보통: { cls: 'badge-info',    weight: 1 },
    낮음: { cls: 'badge-default', weight: 0 },
  };
  // 안건 상태 — 미착수/진행중/완료/보류/취소
  const AGENDA_STATUS = ['미착수', '진행중', '완료', '보류', '취소'];
  const STATUS_META = {
    미착수: { cls: 'badge-fail',    tone: 'danger', open: true },
    진행중: { cls: 'badge-warning', tone: 'warn',   open: true },
    완료:   { cls: 'badge-pass',    tone: 'ok',     open: false },
    보류:   { cls: 'badge-info',    tone: 'warn',   open: true },
    취소:   { cls: 'badge-default', tone: 'muted',  open: false },
  };
  const isOpen = (a) => !!(STATUS_META[a.status] || {}).open;

  // 안건 출처 — 기존 화면에서 바로 올라온 건은 원본으로 되돌아갈 수 있어야 한다
  const SOURCE_TYPES = {
    NONE:       { label: '직접 등록', page: '' },
    VOC:        { label: 'VOC 클레임', page: 'voc' },
    DEFECT:     { label: '입고 부적합', page: 'defectStats' },
    FINDING:    { label: '심사 지적사항', page: 'auditFinding' },
    JOURNAL:    { label: '전자 일지 이탈', page: 'journal' },
    ISSUE:      { label: '공정 이슈', page: 'issue' },
    EQUIP:      { label: '설비', page: 'equipment' },
    LAB:        { label: '분석 규격이탈', page: 'labDashboard' },
    VALIDATION: { label: '유효성 평가', page: 'validation' },
    CALIB:      { label: '계측기 검교정', page: 'calibration' },
    ETC:        { label: '기타', page: '' },
  };
  const sourceLabel = (t) => (SOURCE_TYPES[t] || SOURCE_TYPES.ETC).label;
  const sourcePage = (t) => (SOURCE_TYPES[t] || {}).page || '';

  const FACTORIES = [
    { code: 'NS', name: '논산공장' }, { code: 'GS', name: '경산공장' },
    { code: 'AS', name: '아산공장' }, { code: 'HQ', name: '본사' },
  ];
  const factoryName = (c) => (FACTORIES.find(f => f.code === c) || {}).name || c || '-';

  // ── 조회 ──
  const matchFactory = (m, f) => !f || f === 'ALL' || m.factory === f;
  const getMeetings = (factory, year) => get()
    .filter(m => matchFactory(m, factory) && (!year || year === 'ALL' || String(m.date || '').slice(0, 4) === String(year)))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const getMeeting = (id) => get().find(m => m.id === id);
  const years = () => [...new Set(get().map(m => String(m.date || '').slice(0, 4)).filter(Boolean))].sort((a, b) => b.localeCompare(a));

  // 전체 안건(회의 정보 포함) — 추적 화면·통계용
  const allAgenda = (factory, opts = {}) => {
    const out = [];
    getMeetings(factory, opts.year).forEach(m => {
      (m.agenda || []).forEach(a => out.push({
        ...a,
        meetingId: m.id, meetingDate: m.date, meetingTitle: m.title, meetingType: m.type, factory: m.factory,
      }));
    });
    return out;
  };
  const findAgenda = (meetingId, agendaId) => {
    const m = getMeeting(meetingId);
    return m ? (m.agenda || []).find(a => a.id === agendaId) : null;
  };
  // 기한 경과 — 미종결이면서 기한이 지난 건
  const isOverdue = (a) => isOpen(a) && !!a.dueDate && a.dueDate < todayStr();

  // 같은 계보(rootId)의 안건을 오래된 순으로 — 이월 히스토리 추적
  const lineage = (agenda) => {
    const root = agenda.rootId || agenda.id;
    return allAgenda('ALL')
      .filter(a => (a.rootId || a.id) === root)
      .sort((a, b) => String(a.meetingDate || '').localeCompare(String(b.meetingDate || '')));
  };

  // 이월된 안건은 회의마다 한 벌씩 생기므로 그대로 세면 같은 사안이 여러 건으로 잡힌다.
  //   추적·통계는 "사안" 단위여야 하므로 계보당 가장 최근 것만 남긴다.
  //   (allAgenda 는 회의일 내림차순이라 처음 만나는 것이 최신이다)
  const latestByRoot = (list) => {
    const seen = new Set();
    return list.filter(a => {
      const root = a.rootId || a.id;
      if (seen.has(root)) return false;
      seen.add(root);
      return true;
    });
  };

  // ── 회의 ──
  const addMeeting = (d) => {
    const all = get();
    const date = d.date || todayStr();
    const rec = {
      id: uid('MT'),
      date,
      time: d.time || '',
      type: d.type || MEETING_TYPES[0],
      title: (d.title || '').trim() || `${date} ${d.type || MEETING_TYPES[0]}`,
      place: (d.place || '').trim(),
      factory: d.factory || 'NS',
      chair: (d.chair || '').trim(),
      attendees: Array.isArray(d.attendees) ? d.attendees : String(d.attendees || '').split(',').map(s => s.trim()).filter(Boolean),
      note: (d.note || '').trim(),
      status: 'DRAFT',                                  // DRAFT(작성중) / CONFIRMED(확정)
      agenda: Array.isArray(d.agenda) ? d.agenda : [],
      files: Array.isArray(d.files) ? d.files : [],     // 회의자료(PhotoStore 메타)
      createdAt: now(),
      createdBy: (d.createdBy || '').trim(),
    };
    all.push(rec);
    set(all);
    return rec;
  };
  const updateMeeting = (id, patch) => {
    const all = get();
    const i = all.findIndex(m => m.id === id);
    if (i < 0) return null;
    const before = { ...all[i] };
    all[i] = { ...all[i], ...patch, id: all[i].id };
    if (window.AuditLog) AuditLog.record(all[i], before, {
      date: '일자', time: '시각', type: '구분', title: '제목', place: '장소',
      factory: '공장', attendees: '참석자', summary: '요약', decisions: '결정사항', note: '비고',
    }, { by: patch.updatedBy });
    set(all);
    return all[i];
  };
  const deleteMeeting = (id) => { set(get().filter(m => m.id !== id)); };

  // 회의록 확정 — 확정 후에도 안건의 조치 이력은 계속 쌓인다(회의록은 잠기고 추적은 열려 있다)
  const confirmMeeting = (id, by) => {
    const m = getMeeting(id);
    if (!m) return { ok: false, msg: '회의를 찾을 수 없습니다' };
    if (!(m.agenda || []).length) return { ok: false, msg: '안건이 하나도 없습니다' };
    const noOwner = (m.agenda || []).filter(a => isOpen(a) && !a.owner);
    if (noOwner.length) return { ok: false, msg: `담당자가 없는 안건이 ${noOwner.length}건 있습니다` };
    updateMeeting(id, { status: 'CONFIRMED', confirmedAt: now(), confirmedBy: by || '' });
    return { ok: true };
  };
  const reopenMeeting = (id) => updateMeeting(id, { status: 'DRAFT', confirmedAt: '', confirmedBy: '' });

  // ── 안건 ──
  const addAgenda = (meetingId, d) => {
    const all = get();
    const i = all.findIndex(m => m.id === meetingId);
    if (i < 0) return null;
    const list = all[i].agenda || [];
    const a = {
      id: uid('AG'),
      no: list.length + 1,
      category: d.category || AGENDA_CATEGORIES[0],
      title: (d.title || '').trim(),
      content: (d.content || '').trim(),       // 논의 내용
      decision: (d.decision || '').trim(),     // 결정 사항
      owner: (d.owner || '').trim(),
      dept: (d.dept || '').trim(),
      dueDate: d.dueDate || '',
      priority: d.priority || '보통',
      status: d.status || '미착수',
      sourceType: d.sourceType || 'NONE',
      sourceId: d.sourceId || '',
      sourceLabel: (d.sourceLabel || '').trim(),
      rootId: d.rootId || '',                  // 이월 계보(최초 안건 id). 비어 있으면 자기 자신이 뿌리
      carriedFrom: d.carriedFrom || '',        // 직전 회의 id
      carryCount: Number(d.carryCount) || 0,   // 몇 번 이월됐는가
      history: Array.isArray(d.history) ? d.history : [],
      createdAt: now(),
    };
    all[i].agenda = list.concat(a);
    set(all);
    return a;
  };
  const updateAgenda = (meetingId, agendaId, patch) => {
    const all = get();
    const i = all.findIndex(m => m.id === meetingId);
    if (i < 0) return null;
    const ai = (all[i].agenda || []).findIndex(a => a.id === agendaId);
    if (ai < 0) return null;
    const before = { ...all[i].agenda[ai] };
    all[i].agenda[ai] = { ...all[i].agenda[ai], ...patch, id: agendaId };
    if (window.AuditLog) AuditLog.record(all[i].agenda[ai], before, {
      title: '안건', detail: '내용', status: '상태', owner: '담당', dueDate: '기한',
      result: '결과', note: '비고',
    }, { by: patch.updatedBy });
    set(all);
    return all[i].agenda[ai];
  };
  const deleteAgenda = (meetingId, agendaId) => {
    const all = get();
    const i = all.findIndex(m => m.id === meetingId);
    if (i < 0) return null;
    all[i].agenda = (all[i].agenda || []).filter(a => a.id !== agendaId);
    all[i].agenda.forEach((a, n) => { a.no = n + 1; });
    set(all);
    return all[i];
  };

  // ── 조치(개선 피드백) ──
  //   안건 하나에 여러 번 쌓인다. 현재 상태는 마지막 조치를 따른다.
  const addProgress = (meetingId, agendaId, d) => {
    const all = get();
    const i = all.findIndex(m => m.id === meetingId);
    if (i < 0) return null;
    const ai = (all[i].agenda || []).findIndex(a => a.id === agendaId);
    if (ai < 0) return null;
    const a = all[i].agenda[ai];
    const entry = {
      id: uid('PG'),
      date: d.date || todayStr(),
      status: d.status || '진행중',
      content: (d.content || '').trim(),
      by: (d.by || '').trim(),
      photos: Array.isArray(d.photos) ? d.photos : [],
      createdAt: now(),
    };
    a.history = (a.history || []).concat(entry);
    a.status = entry.status;
    a.lastProgress = entry.content;
    a.lastProgressAt = entry.date;
    all[i].agenda[ai] = a;
    set(all);
    return a;
  };
  const deleteProgress = (meetingId, agendaId, progressId) => {
    const all = get();
    const i = all.findIndex(m => m.id === meetingId);
    if (i < 0) return null;
    const ai = (all[i].agenda || []).findIndex(a => a.id === agendaId);
    if (ai < 0) return null;
    const a = all[i].agenda[ai];
    a.history = (a.history || []).filter(h => h.id !== progressId);
    const last = a.history.slice().sort((x, y) => String(x.date).localeCompare(String(y.date))).pop();
    a.status = last ? last.status : '미착수';
    a.lastProgress = last ? last.content : '';
    a.lastProgressAt = last ? last.date : '';
    all[i].agenda[ai] = a;
    set(all);
    return a;
  };

  // ============================================================
  // 안건 대기함 — 다른 화면(VOC·부적합 등)에서 "회의 안건으로 올리기"
  //   회의가 열리기 전에 눌러도 잃어버리지 않도록 대기함에 담아 둔다.
  //   회의를 만들 때 대기함에서 골라 안건으로 넣는다.
  // ============================================================
  const INBOX_KEY = 'quality_meeting_inbox';
  const getInbox = () => { try { return JSON.parse(localStorage.getItem(INBOX_KEY) || '[]'); } catch (_) { return []; } };
  const setInbox = (d) => { localStorage.setItem(INBOX_KEY, JSON.stringify(d)); notifyWrite(INBOX_KEY); };
  const pushInbox = (d) => {
    const box = getInbox();
    // 같은 원본을 두 번 올리지 않는다
    if (d.sourceId && box.some(x => x.sourceType === d.sourceType && x.sourceId === d.sourceId)) {
      return { ok: false, msg: '이미 안건 대기함에 있습니다' };
    }
    box.push({
      id: uid('IB'),
      sourceType: d.sourceType || 'ETC',
      sourceId: d.sourceId || '',
      sourceLabel: (d.sourceLabel || '').trim(),
      title: (d.title || '').trim(),
      content: (d.content || '').trim(),
      category: d.category || '',
      // 화면에서 넘어온 공장값은 믿을 수 없다 — 상단 필터가 'ALL' 이거나
      // 일부 화면의 select 버그로 문자열 'undefined' 가 들어오는 경우가 있다.
      factory: (d.factory && d.factory !== 'ALL' && d.factory !== 'undefined') ? d.factory : '',
      priority: d.priority || '보통',
      by: (d.by || '').trim(),
      at: now(),
    });
    setInbox(box);
    return { ok: true, msg: '안건 대기함에 담았습니다' };
  };
  const removeInbox = (id) => setInbox(getInbox().filter(x => x.id !== id));
  const clearInbox = () => setInbox([]);
  const inboxCount = () => getInbox().length;
  // 원본이 이미 안건으로 올라가 있는지 — 화면에서 버튼 상태를 바꿀 때 쓴다
  const isQueued = (sourceType, sourceId) =>
    getInbox().some(x => x.sourceType === sourceType && x.sourceId === sourceId)
    || allAgenda('ALL').some(a => a.sourceType === sourceType && a.sourceId === sourceId);

  // ── 이월 ──
  //   직전 회의(같은 공장·같은 유형 우선)의 미종결 안건을 새 회의로 끌어온다.
  const carryOverCandidates = (factory, exceptMeetingId) => {
    const seen = new Set();
    const out = [];
    // 최신 회의부터 훑되, 같은 계보는 가장 최근 것 하나만 남긴다
    getMeetings(factory).forEach(m => {
      if (m.id === exceptMeetingId) return;
      (m.agenda || []).forEach(a => {
        const root = a.rootId || a.id;
        if (seen.has(root)) return;
        seen.add(root);
        if (isOpen(a)) out.push({ ...a, meetingId: m.id, meetingDate: m.date, meetingTitle: m.title });
      });
    });
    return out.sort((a, b) => (PRIORITY_META[b.priority]?.weight || 0) - (PRIORITY_META[a.priority]?.weight || 0));
  };
  const carryOver = (meetingId, items) => {
    let n = 0;
    (items || []).forEach(src => {
      const added = addAgenda(meetingId, {
        // 결정사항도 함께 가져온다 — 아직 끝나지 않았을 뿐 그 결정은 여전히 유효하다.
        // 이번 회의에서 방향이 바뀌면 안건 수정으로 덮어쓰면 된다.
        category: src.category, title: src.title, content: src.content, decision: src.decision,
        owner: src.owner, dept: src.dept, dueDate: src.dueDate, priority: src.priority,
        status: src.status, sourceType: src.sourceType, sourceId: src.sourceId, sourceLabel: src.sourceLabel,
        rootId: src.rootId || src.id,
        carriedFrom: src.meetingId,
        carryCount: (Number(src.carryCount) || 0) + 1,
        history: src.history || [],           // 그동안의 조치 이력을 함께 가져온다
      });
      if (added) n++;
    });
    return n;
  };

  // ── 통계 ──
  const stats = (factory, year) => {
    const ms = getMeetings(factory, year);
    const ag = allAgenda(factory, { year });
    const uniq = latestByRoot(ag);              // 사안 단위(이월 중복 제거)
    const byStatus = {};
    AGENDA_STATUS.forEach(s => { byStatus[s] = uniq.filter(a => a.status === s).length; });
    const open = uniq.filter(isOpen);
    const done = uniq.filter(a => a.status === '완료');
    return {
      meetings: ms.length,
      raised: ag.length,                        // 회의에 상정된 총 횟수(이월 포함)
      agenda: uniq.length,                      // 사안 수
      open: open.length,
      done: done.length,
      overdue: uniq.filter(isOverdue).length,
      urgent: open.filter(a => a.priority === '긴급').length,
      carried: uniq.filter(a => (Number(a.carryCount) || 0) > 0).length,
      byStatus,
      closeRate: uniq.length ? Math.round(done.length / uniq.length * 100) : 100,
    };
  };
  // 담당자별 미종결 안건
  const byOwner = (factory) => {
    const map = new Map();
    latestByRoot(allAgenda(factory)).filter(isOpen).forEach(a => {
      const k = a.owner || '(미지정)';
      if (!map.has(k)) map.set(k, { name: k, n: 0, overdue: 0, urgent: 0 });
      const o = map.get(k); o.n++;
      if (isOverdue(a)) o.overdue++;
      if (a.priority === '긴급') o.urgent++;
    });
    return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.n - a.n);
  };
  // 분류별 안건
  const byCategory = (factory, year) => {
    const map = new Map();
    allAgenda(factory, { year }).forEach(a => {
      const k = a.category || '기타';
      if (!map.has(k)) map.set(k, { name: k, n: 0, open: 0 });
      const o = map.get(k); o.n++;
      if (isOpen(a)) o.open++;
    });
    return [...map.values()].sort((a, b) => b.n - a.n);
  };
  // 장기 미해결 — 이월 횟수가 많은 순. 회의에서 매번 언급만 되고 안 끝나는 건.
  const stalled = (factory, minCarry = 1) => latestByRoot(allAgenda(factory))
    .filter(a => isOpen(a) && (Number(a.carryCount) || 0) >= minCarry)
    .sort((a, b) => (Number(b.carryCount) || 0) - (Number(a.carryCount) || 0));
  // 조치 필요 목록(알림용)
  const openAgenda = (factory) => latestByRoot(allAgenda(factory))
    .filter(isOpen)
    .map(a => ({ ...a, overdue: isOverdue(a) }))
    .sort((a, b) => (b.overdue - a.overdue)
      || ((PRIORITY_META[b.priority]?.weight || 0) - (PRIORITY_META[a.priority]?.weight || 0))
      || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));

  // ── 시드 ──
  const SEED_VERSION = '2026-08-04-init';
  const SEED_KEY = 'quality_meeting_seed_ver';
  const initSampleData = () => {
    if (localStorage.getItem(SEED_KEY) === SEED_VERSION) return;
    if (get().length > 0) { localStorage.setItem(SEED_KEY, SEED_VERSION); return; }

    const m1 = addMeeting({
      date: '2026-06-11', time: '14:00', type: '월간 품질회의', factory: 'NS',
      title: '2026년 6월 월간 품질회의', place: '논산공장 회의실',
      chair: '품질팀장', attendees: ['품질팀장', '생산팀장', '구매팀', '품질관리자'],
      note: '5월 실적 검토 및 클레임 대책',
    });
    const a1 = addAgenda(m1.id, {
      category: '고객 클레임', title: '펠릿 분화율 클레임 재발 방지',
      content: '5월 중 동일 농장에서 분화 관련 클레임 2건 접수. 펠릿 경도 편차가 원인으로 추정됨.',
      decision: '펠릿기 다이 마모도 주간 점검 항목 추가, 경도 측정 주기를 일 1회에서 배치별로 강화',
      owner: '생산팀장', dept: '생산팀', dueDate: '2026-07-10', priority: '높음',
    });
    addProgress(m1.id, a1.id, { date: '2026-06-25', status: '진행중', content: '다이 마모도 점검 항목을 설비 점검일지에 추가 완료. 경도 측정 강화는 인력 배치 조정 중.', by: '생산팀장' });
    addAgenda(m1.id, {
      category: '원료 품질', title: '수입 대두박 수분 편차 관리',
      content: '입고 로트별 수분 12.1~13.8% 편차. 하절기 저장 중 변질 우려.',
      decision: '입고 검사 시 수분 13.0% 초과 로트는 우선 소진 원칙 적용, 사일로 배정 시 별도 관리',
      owner: '품질관리자', dept: '품질팀', dueDate: '2026-06-30', priority: '보통', status: '완료',
    });

    const m2 = addMeeting({
      date: '2026-07-09', time: '14:00', type: '월간 품질회의', factory: 'NS',
      title: '2026년 7월 월간 품질회의', place: '논산공장 회의실',
      chair: '품질팀장', attendees: ['품질팀장', '생산팀장', '구매팀', '품질관리자', '설비팀'],
      note: '6월 안건 이월 검토 포함',
    });
    // 6월 안건이 아직 안 끝나 7월로 이월된 상태를 재현
    const carried = carryOverCandidates('NS', m2.id).filter(a => a.title.includes('분화율'));
    carryOver(m2.id, carried);
    addAgenda(m2.id, {
      category: 'HACCP·선행요건', title: '계측기 교정 유효기간 경과 재발 방지',
      content: '심사 지적사항으로 교정 기한 경과 장비 사용이 확인됨. 알림 체계 부재가 원인.',
      decision: '검교정 만료 30일 전 알림 확인을 품질팀 주간 업무에 포함',
      owner: '품질관리자', dept: '품질팀', dueDate: '2026-07-31', priority: '긴급',
      sourceType: 'FINDING', sourceLabel: '2026 조사·평가 지적',
    });
    confirmMeeting(m1.id, '품질팀장');

    localStorage.setItem(SEED_KEY, SEED_VERSION);
  };

  return {
    MEETING_TYPES, AGENDA_CATEGORIES, PRIORITIES, PRIORITY_META, AGENDA_STATUS, STATUS_META,
    SOURCE_TYPES, sourceLabel, sourcePage, FACTORIES, factoryName,
    isOpen, isOverdue, lineage, latestByRoot,
    getMeetings, getMeeting, years, allAgenda, findAgenda,
    addMeeting, updateMeeting, deleteMeeting, confirmMeeting, reopenMeeting,
    addAgenda, updateAgenda, deleteAgenda,
    addProgress, deleteProgress,
    getInbox, pushInbox, removeInbox, clearInbox, inboxCount, isQueued,
    carryOverCandidates, carryOver,
    stats, byOwner, byCategory, stalled, openAgenda,
    initSampleData,
  };
})();
