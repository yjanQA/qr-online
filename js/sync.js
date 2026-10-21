// ============================================================
// sync.js — 멀티터미널 동기화 계층
//   1) 같은 기기 여러 탭: BroadcastChannel + storage 이벤트로 즉시 반영(서버 불필요)
//   2) 여러 기기(사내망): 옵션 동기화 서버(server.py)의 /api 로 운영 데이터 공유
//
//   서버가 없으면(정적 http.server 나 file://) 자동으로 로컬 전용 + 탭 동기화만 동작.
//   즉, 이 모듈이 있어도 기존 localStorage 동작을 절대 깨지 않는다(순수 추가 기능).
//
// ── 설계 원칙(데이터를 잃지 않기 위한 세 가지) ──
//   가. 통째 덮어쓰기를 만들지 않는다. 모든 키는 레코드 배열로 다루고 식별자 기준으로 병합한다.
//       모양을 런타임에 추측하면 "마지막 1건을 지워 빈 배열이 된 단말"이 전 단말의 데이터를
//       말살한다. 그래서 식별자는 아래 KEY_FIELD 로 고정하고, 그 모양이 아니면 동기화를 건너뛴다.
//   나. 부팅은 pull 이 먼저다. 서버 상태를 받은 뒤 시드가 돌아야 시드가 실데이터를 덮지 않고,
//       받은 상태와 다른 것만 push 하므로 오래된 단말이 최신 편집을 되돌리지 못한다.
//   다. 보내지 못한 로컬 변경은 localStorage 에 남긴다(pending). 오프라인/새로고침을 넘겨야
//       하고, 그 레코드에 한해서는 pull 이 와도 로컬이 이긴다.
// ============================================================

const Sync = (() => {
  // ── 동기화 대상 = 운영 데이터. 기기별 설정(현재 공장, 최근 화면 등)은 제외한다. ──
  const SYNC_KEYS = [
    'rm_receiving', 'rm_silos', 'rm_inventory', 'rm_weighing', 'rm_quality',
    'rm_qc_config', 'rm_exceptions', 'rm_raw_analysis', 'rm_product_analysis',
    'rm_production_orders', 'rm_mixing_batches', 'rm_product_lots', 'rm_voc',
    'rm_outbound', 'rm_history', 'rm_loss', 'rm_qr_scan_logs',
    'rm_formula_recipes', 'rm_suppliers',
    // 스마트제조/부자재
    'rm_ccp_defs', 'rm_ccp_logs', 'rm_equipment', 'rm_equip_logs', 'rm_oee',
    'rm_submaterials', 'rm_sub_orders', 'rm_process_issues',
    // 제품 재고 적정성 기준(부족·과재고 기준 개월, 제품별 기준 출하량)
    'rm_stock_levels',
    // 품질 분석관리
    'lab_records', 'lab_specs', 'lab_items', 'lab_requests',
    'lab_haccp_docs', 'lab_haccp_ha', 'lab_haccp_logs', 'lab_newmat', 'lab_validations',
    // 구서관리
    'pest_reports',
    // 축종별 전용 품질관리 (양축 옥수수·입자도 / 양어 / 반려)
    'lab_corn', 'lab_psa', 'lab_psa_sets', 'lab_aqua', 'lab_pet', 'lab_pet_complaint',
    // SQF 인증 관리 (문서·일지·시정조치)
    'sqf_docs', 'sqf_logs', 'sqf_ca',
    // 코드 마스터 (코드관리 화면 발행분)
    'rm_materials', 'rm_products', 'lab_materials', 'lab_products',
    // 규격 변경 이력 (수정사유 기록)
    'lab_spec_log',
    // 시료접수 그룹 일괄추가 사용자 정의 그룹
    'lab_quick_groups',
    // 원료 매트릭스 기준값(적용 개월수·SPEC·허용편차·측정평균 지정)
    'lab_matrix_config',
    // 사료성분등록증 — 제품별 오버라이드 · 회사 공통 문구
    'feed_certs', 'feed_cert_boiler',
    // 로그인 계정(가입 승인 공유용)
    'rm_auth_users',
    // 선행요건 확장 — 계측기 검교정 / 심사 지적사항 / 영업소 심사
    'calib_instruments', 'audit_findings', 'office_audits',
    // 전자 일지 — 양식 · 기록 · 결재선
    'journal_templates', 'journal_records', 'journal_lines',
    // 품질회의 — 회의록·안건·조치 이력, 다른 화면에서 올린 안건 대기함
    'quality_meetings', 'quality_meeting_inbox',
    // 연구관리 — 제품기획·개발과제·규격·일정·연구기록·지식자산·협업
    'rnd_plans', 'rnd_projects', 'rnd_specs', 'rnd_milestones',
    'rnd_notes', 'rnd_knowledge', 'rnd_collabs',
    // 연구관리 설정 — 단계별 담당 부서 오버라이드(단일 레코드 배열)
    'rnd_settings',
    // 협력사 평가 배점 설정 — 분류 가중치·등급 컷오프(단일 레코드 배열)
    'rm_supplier_eval_config',
    // 품질검사 로트·품질재고·검사설정 (SAP QM To-Be)
    'qm_lots', 'qm_stock', 'qm_setup',
    // 배합비 외부연동 설정·반영이력
    'formula_sync_config', 'formula_sync_log',
    // 대시보드 화면배치 — 계정별(email) 설정. 기기별 설정(현재 공장 등)과 달리
    //   사용자를 따라다녀야 하므로 동기화 대상에 넣는다(레코드 id=email 로 계정 단위 병합).
    'dashboard_prefs',
  ];

  // ── 레코드 식별자 ──
  //   기본은 id. 아래 키들은 id 필드가 없고 다른 필드가 자연키다.
  //   ※ 여기 적는 필드는 그 배열 안에서 유일해야 하고, 해당 레코드에 원래 id 필드가 있으면 안 된다
  //     (전송할 때 id 로 실어 보내고 받을 때 지우므로 원래 id 가 있으면 사라진다).
  const KEY_FIELD = {
    lab_items:     'key',    // 분석항목 마스터 — key 가 항목코드
    rm_materials:  'code',   // 원료 마스터   — 코드관리 화면 발행분이 섞이므로 코드 단위 병합
    rm_products:   'code',   // 제품 마스터
    lab_materials: 'code',
    lab_products:  'code',
    qm_setup:      'materialCode',   // 자재 검사설정 — id 필드가 없고 자재코드가 자연키
  };
  const keyField = (key) => KEY_FIELD[key] || 'id';

  const SYNC_SET = new Set(SYNC_KEYS);
  const CHANNEL_NAME = 'ws-mes-sync';
  const TERM_KEY = 'rm__terminal_id';
  const SEQ_KEY = 'rm__sync_seq';        // 마지막으로 받은 서버 시퀀스(다음 접속을 증분 pull 로)
  const PENDING_KEY = 'rm__sync_pending'; // 아직 보내지 못한 로컬 변경
  const POLL_MS = 4000;
  const PUSH_DEBOUNCE_MS = 800;

  let terminalId = '';
  let serverOn = false;       // /api/health 응답 확인 시 true
  let ready = false;          // 부팅 완료 후 로컬쓰기 반영 시작
  let applyingRemote = false; // 원격 반영 중엔 재푸시 금지
  let pushing = false;        // push 왕복 중 — 이 사이 pull 이 끼어들면 안 보낸 변경이 유실된다
  let failCount = 0;          // 연속 전송 실패 횟수(재시도 간격 조절)
  let lastSeq = 0;
  const dirty = new Set();
  const snapshots = {};       // key -> 마지막으로 서버와 맞춘 시점의 localStorage 원본 문자열
  let pending = { ids: {}, deletes: [] };
  let pushTimer = null;
  let bc = null;
  let lastTabRefresh = 0;
  let polling = null;
  const provided = new Set();  // 부팅 pull 로 서버가 내려준 키 — 이 키는 시드가 건드리면 안 된다

  const termId = () => {
    let id = localStorage.getItem(TERM_KEY);
    if (!id) {
      id = 'T-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      localStorage.setItem(TERM_KEY, id);
    }
    return id;
  };

  const readRaw = (key) => localStorage.getItem(key) || '';

  // ── 미전송 변경 보관 ──
  //   여기 담긴 (키, 식별자)는 "로컬이 아직 서버에 알리지 못한 값"이라 pull 이 와도 덮지 않는다.
  //   그러지 않으면 와이파이가 끊긴 사이 현장에서 입력한 기록이 재접속 순간 되돌아간다.
  const loadPending = () => {
    try {
      const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
      if (p && typeof p === 'object') {
        pending = { ids: p.ids && typeof p.ids === 'object' ? p.ids : {},
                    deletes: Array.isArray(p.deletes) ? p.deletes : [] };
        return;
      }
    } catch (_) {}
    pending = { ids: {}, deletes: [] };
  };
  const savePending = () => {
    try {
      const empty = !pending.deletes.length && !Object.keys(pending.ids).some(k => pending.ids[k].length);
      if (empty) localStorage.removeItem(PENDING_KEY);
      else localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    } catch (_) {}
  };
  const isPending = (key, id) => (pending.ids[key] || []).includes(String(id)) ||
    pending.deletes.some(d => d.key === key && String(d.id) === String(id));
  const markPending = (key, ids) => {
    if (!ids.length) return;
    const cur = new Set(pending.ids[key] || []);
    ids.forEach(i => cur.add(String(i)));
    pending.ids[key] = [...cur];
  };
  const clearPending = (sentIds, sentDeletes) => {
    Object.keys(sentIds).forEach(key => {
      const gone = new Set(sentIds[key].map(String));
      const left = (pending.ids[key] || []).filter(i => !gone.has(String(i)));
      if (left.length) pending.ids[key] = left; else delete pending.ids[key];
    });
    if (sentDeletes.length) {
      const gone = new Set(sentDeletes.map(d => d.key + ' ' + d.id));
      pending.deletes = pending.deletes.filter(d => !gone.has(d.key + ' ' + d.id));
    }
    savePending();
  };

  // ── localStorage 원본 → 전송용 레코드 배열 ──
  //   배열이 아니거나 식별자 없는 원소가 하나라도 있으면 null 을 돌려 그 키를 통째로 건너뛴다.
  //   "모양이 이상하면 아무것도 하지 않는다"가 "통째로 덮어쓴다"보다 언제나 안전하다.
  const toRecords = (key, raw) => {
    if (!raw) return null;
    let val;
    try { val = JSON.parse(raw); } catch (_) { return null; }
    if (!Array.isArray(val)) return null;
    const f = keyField(key);
    const out = [];
    for (let i = 0; i < val.length; i++) {
      const el = val[i];
      if (!el || typeof el !== 'object' || Array.isArray(el)) return null;
      const rid = el[f];
      if (rid == null || rid === '') return null;
      out.push(f === 'id' ? el : { ...el, id: String(rid) });
    }
    return out;   // 빈 배열도 정상(레코드 0건) — 삭제는 deletes 로 따로 전달한다
  };

  // 서버에서 받은 레코드 → 로컬 저장 형태
  const fromRecord = (key, r) => {
    const c = { ...r };
    delete c._seq;
    if (keyField(key) !== 'id') delete c.id;
    return c;
  };
  const idIn = (key, rec) => String(rec ? rec[keyField(key)] : '');

  // ── dirty 키들의 변경분/삭제분 계산 ──
  const buildBody = (keys) => {
    const out = {};
    const deletes = pending.deletes.slice();   // 아직 못 보낸 삭제는 계속 따라간다
    const seen = new Set(deletes.map(d => d.key + ' ' + d.id));
    keys.forEach(key => {
      const raw = readRaw(key);
      if (raw === snapshots[key]) return;      // 실제 변화 없음
      const recs = toRecords(key, raw);
      if (recs === null) {
        console.warn('[Sync] 형태가 레코드 배열이 아니라 동기화를 건너뜁니다:', key);
        return;
      }
      out[key] = recs;
      // 삭제 감지 — 직전 스냅샷에 있었는데 지금 없는 식별자
      const prev = toRecords(key, snapshots[key]);
      if (prev) {
        const now = new Set(recs.map(r => String(r.id)));
        prev.forEach(r => {
          const rid = String(r.id);
          if (now.has(rid)) return;
          const k = key + ' ' + rid;
          if (seen.has(k)) return;
          seen.add(k);
          deletes.push({ key, id: rid });
        });
      }
    });
    return { keys: out, deletes };
  };

  // 첫 접속 때는 마스터 코드표까지 한 번에 올라가 요청이 수 MB 가 된다.
  // 한 번에 다 보내지 말고 이 레코드 수 정도로 끊어 보낸다.
  const PUSH_CHUNK = 2000;

  const flushPush = () => {
    pushTimer = null;
    if (pushing) { schedulePush(); return; }          // 왕복 중이면 끝난 뒤 다시
    if (dirty.size === 0 && !pending.deletes.length) return;

    const sending = [...dirty];
    dirty.clear();
    const sentRaw = {};
    sending.forEach(k => { sentRaw[k] = readRaw(k); });
    const body = buildBody(sending);
    const changedKeys = Object.keys(body.keys);
    if (!changedKeys.length && !body.deletes.length) return;

    // 서버 유무와 무관하게 "못 보낸 변경"으로 먼저 기록해 둔다(오프라인이어도 남아야 한다)
    const sentIds = {};
    changedKeys.forEach(key => {
      sentIds[key] = body.keys[key].map(r => String(r.id));
      markPending(key, sentIds[key]);
    });
    pending.deletes = body.deletes.slice();
    savePending();

    if (!serverOn) { sending.forEach(k => dirty.add(k)); return; }

    // 키 단위로 묶어 나눈다(레코드가 통째로 나뉘면 삭제 감지가 어긋난다)
    const chunks = [];
    let cur = { keys: {}, n: 0 };
    changedKeys.forEach(key => {
      if (cur.n && cur.n + body.keys[key].length > PUSH_CHUNK) { chunks.push(cur); cur = { keys: {}, n: 0 }; }
      cur.keys[key] = body.keys[key];
      cur.n += body.keys[key].length;
    });
    if (cur.n || !chunks.length) chunks.push(cur);
    chunks[0].deletes = body.deletes;                 // 삭제는 첫 요청에 한 번만

    pushing = true;
    const done = [];                                  // 실제로 서버가 받은 키
    const sendOne = (i) => {
      if (i >= chunks.length) return Promise.resolve();
      return fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: chunks[i].keys, deletes: chunks[i].deletes || [], since: lastSeq }),
      }).then(r => r.json()).then(res => {
        if (res && typeof res.seq === 'number') setSeq(res.seq);
        done.push(...Object.keys(chunks[i].keys));
        if (chunks[i].deletes) clearPending({}, chunks[i].deletes);
        return sendOne(i + 1);
      });
    };

    sendOne(0).then(() => { failCount = 0; }, () => { failCount++; }).then(() => {
      const ok = new Set(done);
      const okIds = {};
      done.forEach(key => { okIds[key] = sentIds[key]; });
      clearPending(okIds, []);
      changedKeys.forEach(key => {
        if (!ok.has(key)) { dirty.add(key); return; }  // 전송 실패 → 다음 주기에 재시도
        // 보내는 사이에 또 바뀐 키는 스냅샷을 갱신하지 않고 다음 주기에 다시 보낸다
        if (readRaw(key) === sentRaw[key]) snapshots[key] = sentRaw[key];
        else dirty.add(key);
      });
      pushing = false;
      if (dirty.size) schedulePush();
    });
  };

  // 서버가 내려가 있으면 실패가 이어진다. 그대로 두면 0.8초마다 계속 두드리므로
  // 실패할수록 간격을 벌린다(최대 30초). 성공하면 즉시 원래 간격으로 돌아온다.
  const schedulePush = () => {
    if (pushTimer) return;
    const wait = failCount ? Math.min(30000, PUSH_DEBOUNCE_MS * Math.pow(2, failCount)) : PUSH_DEBOUNCE_MS;
    pushTimer = setTimeout(flushPush, wait);
  };

  const setSeq = (n) => {
    if (typeof n !== 'number' || n < lastSeq) return;
    lastSeq = n;
    try { localStorage.setItem(SEQ_KEY, String(n)); } catch (_) {}
  };

  // ── DB.set 훅: 로컬 쓰기 발생 시 호출됨 ──
  const onLocalWrite = (key) => {
    if (!SYNC_SET.has(key)) return;
    // 다른 탭에 즉시 알림(같은 기기 실시간 반영)
    try { if (bc) bc.postMessage({ t: terminalId, key }); } catch (_) {}
    if (!ready || applyingRemote) return;
    dirty.add(key);
    schedulePush();
  };

  // ── 원격 변경 로컬 반영 ──
  const applyRemote = (changes, deletes) => {
    let touched = false;
    applyingRemote = true;
    try {
      Object.keys(changes || {}).forEach(key => {
        if (!SYNC_SET.has(key)) return;
        const incoming = changes[key] || [];
        let local = [];
        try { local = JSON.parse(readRaw(key) || '[]'); } catch (_) { local = []; }
        if (!Array.isArray(local)) {
          console.warn('[Sync] 로컬 값이 배열이 아니라 병합하지 않습니다:', key);
          return;
        }
        const map = new Map(local.map(r => [idIn(key, r), r]));
        let hit = 0;
        incoming.forEach(r => {
          if (!r || r.id == null) return;
          if (isPending(key, r.id)) return;   // 아직 못 보낸 로컬 변경이 우선
          map.set(String(r.id), fromRecord(key, r));
          hit++;
        });
        if (!hit) return;
        localStorage.setItem(key, JSON.stringify([...map.values()]));
        if (!dirty.has(key)) snapshots[key] = readRaw(key);   // 미전송 변경이 있으면 스냅샷 유지
        touched = true;
      });
      (deletes || []).forEach(d => {
        if (!d || !SYNC_SET.has(d.key)) return;
        if (isPending(d.key, d.id)) return;
        let local = [];
        try { local = JSON.parse(readRaw(d.key) || '[]'); } catch (_) { local = []; }
        if (!Array.isArray(local)) return;
        const filtered = local.filter(r => idIn(d.key, r) !== String(d.id));
        if (filtered.length !== local.length) {
          localStorage.setItem(d.key, JSON.stringify(filtered));
          if (!dirty.has(d.key)) snapshots[d.key] = readRaw(d.key);
          touched = true;
        }
      });
    } finally {
      applyingRemote = false;
    }
    if (touched && ready) refreshUI();
    return touched;
  };

  // 다른 단말의 변경이 들어왔다고 화면을 바로 다시 그리면, 지금 입력 중이던 폼이 통째로 날아간다.
  // 모달이 열려 있거나 입력칸에 커서가 있으면 다시 그리기를 미뤘다가 손을 뗀 뒤에 반영한다.
  let deferredRefresh = false;
  const userIsEditing = () => {
    try {
      if (document.querySelector('.modal-overlay.open')) return true;
      const a = document.activeElement;
      if (!a) return false;
      if (a.isContentEditable) return true;
      return ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName);
    } catch (_) { return false; }
  };

  const refreshUI = () => {
    try { if (typeof LabDB !== 'undefined' && LabDB.invalidateCaches) LabDB.invalidateCaches(); } catch (_) {}
    try { typeof Auth !== 'undefined' && Auth.refreshAdmin && Auth.refreshAdmin(); } catch (_) {}
    try { typeof App !== 'undefined' && App.updateBadges && App.updateBadges(); } catch (_) {}
    if (userIsEditing()) { deferredRefresh = true; return; }
    deferredRefresh = false;
    try { typeof App !== 'undefined' && App.refreshPage && App.refreshPage(); } catch (_) {}
  };

  const pull = () => {
    if (!serverOn) return Promise.resolve();
    if (deferredRefresh && !userIsEditing()) refreshUI();      // 입력이 끝났으면 미뤄둔 반영
    if (pushing || dirty.size) { schedulePush(); return Promise.resolve(); }  // 내 변경을 먼저 보낸다
    return fetch('/api/pull?since=' + lastSeq)
      .then(r => r.json())
      .then(res => {
        if (!res) return;
        const hasChange = (res.changes && Object.keys(res.changes).length) || (res.deletes && res.deletes.length);
        if (hasChange) applyRemote(res.changes, res.deletes);
        setSeq(res.seq);
      })
      .catch(() => { /* 일시 실패 무시 */ });
  };

  // ── 같은 기기 다른 탭 동기화(서버 없이도 동작) ──
  const setupCrossTab = () => {
    try {
      if ('BroadcastChannel' in window) {
        bc = new BroadcastChannel(CHANNEL_NAME);
        bc.onmessage = (ev) => {
          if (!ev.data || ev.data.t === terminalId) return; // 자기 자신 무시
          throttledTabRefresh();
        };
      }
    } catch (_) {}
    // storage 이벤트 폴백(다른 탭의 localStorage 변경 감지)
    window.addEventListener('storage', (ev) => {
      if (ev.key && SYNC_SET.has(ev.key)) throttledTabRefresh();
    });
  };

  const throttledTabRefresh = () => {
    const t = Date.now();
    if (t - lastTabRefresh < 400) return;
    lastTabRefresh = t;
    if (ready) refreshUI();
  };

  const snapshotAll = () => { SYNC_KEYS.forEach(key => { snapshots[key] = readRaw(key); }); };

  // ── 1단계: 서버 상태를 먼저 받는다 (시드보다 먼저 호출해야 한다) ──
  //   여기서 받은 뒤에 시드가 돌아야 새 단말의 샘플/마스터 시드가 실데이터를 덮지 않는다.
  const bootstrap = () => {
    if (window.__syncBootstrapped) return Promise.resolve(serverOn);
    window.__syncBootstrapped = true;
    terminalId = termId();
    loadPending();
    setupCrossTab();

    // 이전 접속에서 받은 지점부터 증분으로 받는다.
    // 단, 로컬이 비어 있으면(새 기기·캐시 삭제) 처음부터 전량을 받아야 한다.
    const storedSeq = Number(localStorage.getItem(SEQ_KEY) || 0);
    const haveLocal = SYNC_KEYS.some(k => { const r = readRaw(k); return r && r !== '[]'; });
    let since = (storedSeq > 0 && haveLocal) ? storedSeq : 0;
    lastSeq = since;

    return fetch('/api/health', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        if (!res || !res.ok) return false;
        serverOn = true;
        // 서버 시퀀스가 내가 아는 지점보다 뒤에 있으면 서버 저장소가 초기화·교체된 것이다.
        // 그대로 증분으로 붙으면 아무도 데이터를 다시 올리지 않아 서버가 빈 채로 남는다.
        if (typeof res.seq === 'number' && res.seq < since) { since = 0; lastSeq = 0; }
        return fetch('/api/pull?since=' + since).then(r => r.json()).then(pullRes => {
          if (pullRes && pullRes.changes) {
            Object.keys(pullRes.changes).forEach(k => {
              if ((pullRes.changes[k] || []).length) provided.add(k);
            });
            applyRemote(pullRes.changes, pullRes.deletes);
          }
          // 증분으로 붙은 기기(since > 0)는 '바뀐 것'만 받으므로, 이미 서버와 맞춘 자료가 있는 키도
          //   provided 에 넣어 둔다. 안 그러면 각 모듈의 시드가 "서버 자료 없음"으로 보고 기본자료를
          //   지우고 새 id 로 다시 깔아, 그 삭제가 서버로 올라간다(2026-10-16 SQF 문서·시정조치 45건 교체).
          if (since > 0) {
            SYNC_KEYS.forEach(k => { const r = readRaw(k); if (r && r !== '[]') provided.add(k); });
          }
          if (pullRes) setSeq(pullRes.seq);
          return true;
        });
      })
      .catch(() => false)
      .then(ok => {
        // 기준선 = "서버가 이미 알고 있는 상태". 이후 여기서 달라진 것만 올린다.
        //   · 처음 붙는 단말(since=0)은 서버가 내 데이터를 하나도 모른다고 보고 전량을 올린다.
        //     기준선을 지금 로컬로 잡으면 서버가 비어 있어도 아무것도 올라가지 않는다.
        //     (서버는 내용이 같은 레코드를 걸러내므로 두 번째 단말부터는 실제 전송이 없다)
        //   · 이어 붙는 단말은 지금 로컬이 곧 서버와 맞춘 상태다.
        //   · 서버가 없으면 올릴 곳이 없으니 기준선을 로컬로 두고 대기열을 쌓지 않는다.
        if (ok && since === 0) SYNC_KEYS.forEach(k => { snapshots[k] = ''; });
        else snapshotAll();
        return !!ok;
      });
  };

  // ── 2단계: 시드까지 끝난 뒤 호출. 기준선과 달라진 것만 올리고 폴링을 시작한다 ──
  const start = () => {
    if (window.__syncStarted) return;
    window.__syncStarted = true;
    ready = true;
    SYNC_KEYS.forEach(key => { if (readRaw(key) !== snapshots[key]) dirty.add(key); });
    Object.keys(pending.ids).forEach(key => { if (SYNC_SET.has(key)) dirty.add(key); });
    if (!serverOn) { watchReconnect(); return; }
    try { App.toast && App.toast('현장 동기화 서버 연결됨', 'success'); } catch (_) {}
    if (dirty.size || pending.deletes.length) schedulePush();
    if (!polling) polling = setInterval(pull, POLL_MS);
  };

  // 켜질 때 서버를 못 찾은 창(서버 재시작 몇 초 사이에 열렸거나 잠깐 끊긴 경우)은
  //   예전엔 새로고침 전까지 혼자 돌았다 — 가입 신청·승인이 서로 안 보이는 원인이었다.
  //   10초마다 서버를 다시 찾고, 찾으면 그 자리에서 받기·보내기를 시작한다.
  //   (http 로 열린 경우만. 파일로 연 단독 실행은 서버가 없으니 찾지 않는다)
  let reconnectTimer = null;
  const watchReconnect = () => {
    if (reconnectTimer || !/^https?:$/.test(location.protocol)) return;
    reconnectTimer = setInterval(() => {
      fetch('/api/health', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(res => {
          if (!res || !res.ok || serverOn) return;
          clearInterval(reconnectTimer); reconnectTimer = null;
          // 그 사이 서버 저장소가 바뀌었으면(시퀀스가 뒤로 감) 처음부터 받는다
          if (typeof res.seq === 'number' && res.seq < lastSeq) { lastSeq = 0; }
          serverOn = true;
          try { App.toast && App.toast('동기화 서버에 다시 연결됐습니다', 'success'); } catch (_) {}
          if (dirty.size || pending.deletes.length) schedulePush();
          pull();
          if (!polling) polling = setInterval(pull, POLL_MS);
        })
        .catch(() => {});
    }, 10000);
  };

  // 예전 호출부 호환 — 한 번에 부팅(시드 보호 효과는 없다)
  const init = () => bootstrap().then(start);

  // DB.set 이 호출할 전역 훅
  window.__onDbWrite = onLocalWrite;

  return {
    bootstrap, start, init,
    onLocalSet: onLocalWrite,
    // 부팅 때 서버가 이 키의 데이터를 내려줬는가.
    //   각 모듈의 initSampleData 가 "표준 시드를 다시 깔지" 판단할 때 쓴다.
    //   새로 합류한 단말이 시드를 다시 깔면 그동안 현장에서 고친 내용이 통째로 되돌아간다.
    serverHas: (...keys) => keys.some(k => provided.has(k)),
    status: () => ({
      serverOn, terminalId, lastSeq, ready, dirty: dirty.size,
      pending: Object.keys(pending.ids).reduce((n, k) => n + pending.ids[k].length, 0) + pending.deletes.length,
    }),
    // 수동 강제 동기화(디버그/버튼용)
    syncNow: () => { flushPush(); return pull(); },
  };
})();

if (typeof window !== 'undefined') window.Sync = Sync;
