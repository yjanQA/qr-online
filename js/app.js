// ============================================================
// app.js — SPA 라우터, 상태 관리, 토스트 (v2.0)
// ============================================================

const App = (() => {
  const workspaces = {
    qr:      { label: QR_ON ? '입고·재고 QR' : '입고·재고', defaultPage: 'dashboard' },
    quality: { label: '품질·실험실',  defaultPage: 'labDashboard' },
    formula: { label: '배합비·생산',  defaultPage: 'formula' },
    trace:   { label: '추적·클레임',  defaultPage: 'productTrace' },
    admin:   { label: '관리',        defaultPage: 'supplier' },
    smart:   { label: '스마트제조',   defaultPage: 'ccp' },
    haccp:   { label: '인증관리',     defaultPage: 'haccpDocs' },
    rnd:     { label: '연구관리',     defaultPage: 'rndProject' },
  };

  const pages = {
    dashboard:  { workspace:'qr',      title: QR_ON ? 'QR 입고배정 현황' : '입고배정 현황',   subtitle: '',   module: () => DashboardPage },
    receiving:  { workspace:'qr',      title: '입고 관리',           subtitle: '',         module: () => ReceivingPage },
    silo:       { workspace:'qr',      title: '사일로 관리',         subtitle: '',      module: () => SiloPage      },
    inventory:  { workspace:'qr',      title: '톤백·지대 재고',      subtitle: '',                module: () => InventoryPage },
    longStock:  { workspace:'qr',      title: '장기재고 알람',       subtitle: '장기 보관(3개월 미사용·저회전) · 유통기한 지남/임박', module: () => LongStockPage },
    outbound:   { workspace:'qr',      title: '출고 처리',           subtitle: '',                   module: () => OutboundPage  },
    subMaterial:{ workspace:'qr',      title: '부자재 재고',         subtitle: '', module: () => SubMaterialPage },
    productStock:{ workspace:'qr',     title: '제품 재고',           subtitle: '',         module: () => ProductStockPage },
    scan:       { workspace:'qr',      title: 'QR 스캔',             subtitle: '',              module: () => ScanPage      },
    plateScan:  { workspace:'qr',      title: '번호 인식(카메라)',    subtitle: '차량번호·문서번호', module: () => PlateScanPage },
    qualityRd:  { workspace:'quality', title: '분석 데이터',         subtitle: '',      module: () => QualityRDPage },
    quality:    { workspace:'quality', title: '품질 게이트',         subtitle: '',         module: () => QualityPage   },
    defectStats:{ workspace:'quality', title: '부적합 통계',         subtitle: '월별·유형별 부적합률 추이', module: () => DefectStatsPage },
    // ── 품질검사 로트·품질재고 (To-Be 정의서 QM.1~QM.3) ──
    qmLot:      { workspace:'quality', title: '품질검사 로트',   subtitle: '검사로트 · 합부판정 · 용도결정(UD)', module: () => QmLotPage },
    qmStock:    { workspace:'quality', title: '품질재고 · 처분', subtitle: '검사/가용/보류 3구분 · 반복검사 · 부적합 처분', module: () => QmStockPage },
    qmSetup:    { workspace:'quality', title: '검사설정(QM뷰)',  subtitle: '자재별 검사대상 지정 · 반복검사 주기', module: () => QmSetupPage },
    formula:    { workspace:'formula', title: '배합비 관리',         subtitle: '', module: () => FormulaPage },
    production: { workspace:'formula', title: '투입지시',            subtitle: '',        module: () => ProductionPage},
    batch:      { workspace:'formula', title: '배합·생산LOT',        subtitle: '',          module: () => BatchPage     },
    feedProduction: { workspace:'formula', title: '배합사료 생산실적', subtitle: '', module: () => FeedProductionPage },
    formulaTrend: { workspace:'formula', title: '배합비 추이분석', subtitle: '배합비별 제품 스펙(화학·물리) 누적 추이', module: () => FormulaTrendPage },
    feedAppearance: { workspace:'formula', title: '외관·흐름성 시뮬레이터', subtitle: '배합비·공정조건 → 완제품 외관 · 빈 배출 거동(Mass/Funnel flow) 시각화', module: () => FeedAppearancePage },
    productTrace:{ workspace:'trace',  title: '제품 추적관리',       subtitle: '제품·제조일자 → 생산 · 원료 투입 · 입고 · 분석 · VOC · 그날 공장 기록', module: () => ProductTracePage },
    // 원료 추적(옛 화면) — 메뉴에서는 뺐고 QR 링크·입고건 바로가기로만 열린다(2026-11-10)
    history:    { workspace:'trace',   title: '원료 추적',           subtitle: '', module: () => HistoryPage   },
    voc:        { workspace:'trace',   title: 'VOC 역추적',          subtitle: '접수 · 처리내역(조치·근본원인·재발방지) · 역추적', module: () => VOCPage       },
    vocDashboard:{ workspace:'trace',  title: 'VOC 대시보드',        subtitle: '접수 추이 · 유형/원인 분포 · 재발방지 이력', module: () => VOCDashboardPage },
    codes:      { workspace:'admin',   title: '코드 관리',           subtitle: '', module: () => CodeMasterPage },
    supplier:   { workspace:'admin',   title: '협력사 관리',         subtitle: '',        module: () => SupplierPage  },
    auditLog:   { workspace:'admin',   title: '수정 이력 조회',      subtitle: '전 업무 감사 추적 — 누가·언제·무엇을 고쳤는지', module: () => AuditViewPage },
    ccp:        { workspace:'smart',   title: '스마트 HACCP',        subtitle: '', module: () => HaccpPage     },
    equipment:  { workspace:'smart',   title: '설비관리',            subtitle: '', module: () => EquipmentPage },
    issue:      { workspace:'smart',   title: '공정 이슈',           subtitle: '',     module: () => ProcessIssuePage },
    processFlow:{ workspace:'smart',   title: '제조공정도',          subtitle: '원료입고~출고 전 공정 · CCP 이탈 실시간 표시', module: () => ProcessFlowPage },
    // ── 품질 분석관리 (통합) ──
    workmap:      { workspace:'quality', title: '품질 업무맵',    subtitle: '업무체계도 4.1~4.12 커버리지', module: () => QualityWorkmapPage },
    labDashboard: { workspace:'quality', title: '품질 대시보드',  subtitle: '',  module: () => LabDashboardPage },
    labReceive:   { workspace:'quality', title: '시료 접수',        subtitle: '',       module: () => ReceivePage },
    input:        { workspace:'quality', title: '분석 결과입력',    subtitle: '', module: () => InputPage },
    raw:          { workspace:'quality', title: '원료 분석대장',   subtitle: '',             module: () => RawAnalysisPage },
    prod:         { workspace:'quality', title: '제품 분석대장',   subtitle: '',             module: () => ProdAnalysisPage },
    items:        { workspace:'quality', title: '분석항목 관리',    subtitle: '',     module: () => ItemsPage },
    spec:         { workspace:'quality', title: '성분규격 관리',    subtitle: '',     module: () => SpecPage },
    matrix:       { workspace:'quality', title: '원료 매트릭스',    subtitle: '분석대장 기반 자동작성(적용평균·적용편차·적용 Matrix·SPEC)', module: () => RawMatrixPage },
    specSheet:    { workspace:'quality', title: '원료 규격서',      subtitle: '반려원료 규격 원본 양식 · 항목 수정/개정이력', module: () => SpecSheetPage },
    feedCert:     { workspace:'quality', title: '사료성분등록증',   subtitle: '제품코드 자동연동 · 배합사료 성분표 발행·인쇄(출고 동봉)', module: () => FeedCertPage },
    haccpDocs:    { workspace:'haccp', title: 'HACCP 기준서·문서', subtitle: '',       module: () => HaccpDocsPage },
    haccpHA:      { workspace:'haccp', title: '위해요소분석',      subtitle: '', module: () => HaccpHAPage },
    newMat:       { workspace:'haccp', title: '신원료 위해평가',   subtitle: '', module: () => NewMatPage },
    validation:   { workspace:'haccp', title: '유효성 평가',       subtitle: '', module: () => ValidationPage },
    calibration:  { workspace:'haccp', title: '계측기 검교정',     subtitle: '선행요건 · 교정주기·성적서 관리', module: () => CalibrationPage },
    auditFinding: { workspace:'haccp', title: '심사 지적사항',     subtitle: '연간 심사 이력 · 지적사항 개선 추적', module: () => AuditFindingPage },
    journal:      { workspace:'haccp', title: '전자 일지 작성',    subtitle: '양식 기반 점검일지 · 이탈 개선조치 · 상신/결재', module: () => JournalPage },
    journalBoard: { workspace:'haccp', title: '일지 현황·결재함',  subtitle: QR_ON ? '결재 대기 · 작성기한 초과 · 현장 QR' : '결재 대기 · 작성기한 초과', module: () => JournalBoardPage },
    journalSetup: { workspace:'haccp', title: '일지 양식 설정',    subtitle: '점검항목·대상·주기·결재선 정의 (화면 개발 없이 일지 추가)', module: () => JournalSetupPage },
    sqfDocs:      { workspace:'haccp', title: 'SQF 기준서·문서', subtitle: '', module: () => SqfDocsPage },
    sqfCA:        { workspace:'haccp', title: 'SQF 시정조치',    subtitle: '', module: () => SqfCAPage },
    lawMonitor:   { workspace:'haccp', title: '법령 모니터',     subtitle: '법령·고시 개정 감시 · 입법예고 · 시행 예정', module: () => LawMonitorPage },
    pestControl:  { workspace:'quality', title: '구서관리',          subtitle: '', module: () => PestControlPage },
    officeAudit:  { workspace:'quality', title: '영업소 심사',        subtitle: '영업소 정기심사 체크리스트 · 누적 대시보드', module: () => OfficeAuditPage },
    meeting:      { workspace:'quality', title: '품질회의 · 안건 추적', subtitle: '회의록 · 결정사항 조치 이력 · 미종결 안건 이월', module: () => MeetingPage },
    // ── 축종별 품질관리 (전문가 시트) ──
    speciesLivestock: { workspace:'quality', title: '양축 품질관리', subtitle: '', module: () => SpeciesLivestockPage },
    speciesAqua:      { workspace:'quality', title: '양어 품질관리', subtitle: '', module: () => SpeciesAquaPage },
    speciesPet:       { workspace:'quality', title: '반려 품질관리', subtitle: '', module: () => SpeciesPetPage },
    // ── 축종별 측정 도구 (전문가 시트에서 진입) ──
    cornGrade:    { workspace:'quality', title: '옥수수 등급평가',   subtitle: '', module: () => CornPage },
    psa:          { workspace:'quality', title: '입자도 분석(Dgw)',  subtitle: '', module: () => PSAPage },
    aqua:         { workspace:'quality', title: '양어 물리검사',      subtitle: '', module: () => AquaPage },
    pet:          { workspace:'quality', title: '반려 품질·컴플레인', subtitle: '', module: () => PetPage },
    weather:      { workspace:'quality', title: '날씨·습도 기록',    subtitle: '', module: () => WeatherPage },
    disease:      { workspace:'quality', title: '질병관리',          subtitle: '가축전염병 위기단계 · 발생 분포 지도 · 공장 인근 발생 (KAHIS)', module: () => DiseasePage },
    // ── 연구관리 (WS-FSMS-2311 신제품 개발 절차서 기준) ──
    rndPlan:      { workspace:'rnd', title: '제품기획',       subtitle: '절차서 5.1 제품 개발계획 · 5.2 제품설계(입력)', module: () => RndPlanPage },
    rndProject:   { workspace:'rnd', title: '개발과제관리',   subtitle: '업무절차 5.1~5.13 단계 진행 · 절차 체크', module: () => RndProjectPage },
    rndSpec:      { workspace:'rnd', title: '제품규격',       subtitle: '절차서 5.11 규격확정 · 개정 이력', module: () => RndSpecPage },
    rndSchedule:  { workspace:'rnd', title: '개발일정',       subtitle: '제품개발일정표 · 계획 대비 실적', module: () => RndSchedulePage },
    rndNote:      { workspace:'rnd', title: '연구기록관리',   subtitle: '실험계획서 · 연구노트 · 점검자 서명', module: () => RndNotePage },
    rndKnowledge: { workspace:'rnd', title: '지식자산관리',   subtitle: '연구데이터·노하우 축적 · 통합 검색', module: () => RndKnowledgePage },
    rndCollab:    { workspace:'rnd', title: '협업관리',       subtitle: '공동연구 범위·공유수준·교류 이력', module: () => RndCollabPage },
  };

  let currentPage = 'dashboard';
  let pageArgs    = [];
  let currentFactory = 'ALL';   // 공장 필터
  let currentWorkspace = 'qr';
  let navHistory  = [];         // 페이지 이력 스택 (백스페이스 뒤로가기용)
  let _navBack    = false;      // 뒤로가기 중 플래그 (이력 재적재 방지)

  // ── 초기화 ──
  const init = async () => {
    const params  = new URLSearchParams(window.location.search);
    const qrId    = params.get('id') || params.get('qr') || params.get('code');
    const initPage = params.get('page') || 'dashboard';

    // 원료 마스터 로드 (실패해도 계속 진행)
    try { await DB.loadMaterialsFromJSON(); } catch(e) { /* file:// 환경에서 무시 */ }
    try { await DB.loadProductsFromJSON(); } catch(e) { /* file:// 환경에서 무시 */ }
    try { await DB.loadSuppliersFromJSON(); } catch(e) { /* file:// 환경에서 무시 */ }

    // 동기화 서버 상태를 먼저 받는다 — 시드보다 반드시 앞이어야 한다.
    //   순서가 뒤바뀌면 새 단말의 샘플 시드(고정 id 사일로, 비밀번호 미설정 마스터 계정 등)가
    //   서버의 실데이터를 덮어쓴다. 여기서 받아두면 아래 시드들은 "비어 있을 때만" 조건에
    //   걸려 자동으로 건너뛴다.
    try { if (window.Sync) await Sync.bootstrap(); } catch (e) { console.warn('[Sync] bootstrap skip', e); }

    // 샘플 데이터 초기화
    DB.initSampleData();

    // 품질 분석관리(통합) 데이터 초기화 — 실패해도 QR 동작에 영향 없음
    try {
      if (typeof LabDB !== 'undefined') {
        await LabDB.loadMaterialsFromJSON();
        await LabDB.loadProductsFromJSON();
        LabDB.initSampleData();
      }
    } catch (e) { console.warn('[Lab] init skip', e); }

    // 구서관리 시드 데이터 초기화
    try { if (typeof PestDB !== 'undefined') PestDB.initSampleData(); } catch (e) { console.warn('[Pest] init skip', e); }

    // 영업소 심사 시드 데이터 초기화
    try { if (typeof OfficeAuditDB !== 'undefined') OfficeAuditDB.initSampleData(); } catch (e) { console.warn('[OfficeAudit] init skip', e); }

    // 계측기 검교정 시드 데이터 초기화
    try { if (typeof CalibDB !== 'undefined') CalibDB.initSampleData(); } catch (e) { console.warn('[Calib] init skip', e); }

    // 심사 지적사항 시드 데이터 초기화
    try { if (typeof AuditFindingDB !== 'undefined') AuditFindingDB.initSampleData(); } catch (e) { console.warn('[AuditFinding] init skip', e); }

    // 연구관리 시드 데이터 초기화
    try { if (typeof RndDB !== 'undefined') RndDB.initSampleData(); } catch (e) { console.warn('[Rnd] init skip', e); }

    // 품질검사 로트 시드
    try { if (typeof QmDB !== 'undefined') QmDB.initSampleData(); } catch (e) { console.warn('[Qm] init skip', e); }

    // 전자 일지 표준 양식 시드 초기화
    try { if (typeof JournalDB !== 'undefined') JournalDB.initSampleData(); } catch (e) { console.warn('[Journal] init skip', e); }

    // 품질회의 시드 초기화
    try { if (typeof MeetingDB !== 'undefined') MeetingDB.initSampleData(); } catch (e) { console.warn('[Meeting] init skip', e); }

    // 전역 인쇄 훅(브라우저 Ctrl+P 포함) — 보고서 오버레이가 없을 때만 페이지 인쇄 모드 적용
    window.addEventListener('beforeprint', preparePrint);
    window.addEventListener('afterprint', cleanupPrint);

    // 알림 초기 스캔(각 도메인 주목 이슈 → 알림 생성)
    try { if (typeof NotificationCenter !== 'undefined') NotificationCenter.scan(); } catch (e) { console.warn('[Notif] scan skip', e); }

    // 라우팅
    if (qrId) {
      if (initPage === 'scan') {
        navigate('scan', qrId, window.location.href);
      } else {
        navigate('history', qrId);
      }
    } else {
      navigate(initPage);
      // 현장 QR(?page=journal&tpl=…) — 해당 일지 작성 화면을 바로 연다
      const jtpl = params.get('tpl');
      if (initPage === 'journal' && jtpl) {
        try { JournalPage.startFromQR(jtpl); } catch (_) {}
      }
    }

    // 로그인 사용자 접근권한 확정(허용되지 않은 착지 영역이면 허용 영역으로 이동)
    try { if (typeof Auth !== 'undefined' && Auth.enforceLanding) Auth.enforceLanding(); } catch (_) {}

    updateBadges();
    initClock();
    initBackKey();
    try { if (window.Weather) { Weather.init(); document.addEventListener('weather:update', updateWeatherBadge); updateWeatherBadge(); } } catch (e) { console.warn('[Weather] init skip', e); }
    document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);

    // 동기화 개시 — 서버에서 받은 기준선과 달라진 것(= 이 단말에서 새로 생긴 것)만 올린다
    try { if (window.Sync) Sync.start(); } catch (e) { console.warn('[Sync] start skip', e); }
  };

  // ── 공장 필터 ──
  const setFactory = (factory) => {
    currentFactory = factory;
    document.querySelectorAll('.factory-tab').forEach(el => {
      el.classList.toggle('active', el.dataset.factory === factory);
    });
    const fbadge = document.getElementById('topbar-factory');
    if (fbadge) {
      const names = { ALL:'전체 공장', AS:'아산공장', GS:'경산공장', NS:'논산공장', HQ:'본사' };
      fbadge.textContent = names[factory] || factory;
      fbadge.className   = `factory-badge factory-${factory.toLowerCase()}`;
    }
    navigate(currentPage, ...pageArgs);
    try { if (window.Weather) { updateWeatherBadge(); Weather.record(currentFactory === 'ALL' ? 'NS' : currentFactory).then(updateWeatherBadge); } } catch (_) {}
  };
  const getFactory = () => currentFactory;

  const switchWorkspace = (workspace) => {
    if (!workspaces[workspace]) workspace = 'qr';
    currentWorkspace = workspace;
    updateWorkspaceUI();
    navigate(workspaces[workspace].defaultPage);
  };
  const getWorkspace = () => currentWorkspace;

  // ── 스크롤 위치 보존(전역) : 같은 페이지 재렌더 시 화면이 상단으로 튀지 않게 ──
  const _scrollEl = () => document.getElementById('page-content');
  const captureScroll = () => {
    const el = _scrollEl();
    return { el: el ? el.scrollTop : 0, win: window.pageYOffset || document.documentElement.scrollTop || 0 };
  };
  const restoreScroll = (s) => {
    if (!s) return;
    const apply = () => {
      const el = _scrollEl();
      if (el && s.el) el.scrollTop = s.el;               // page-content가 스크롤러인 레이아웃
      // 실제 스크롤러(문서/윈도우)는 즉시 복원(smooth 애니메이션 방지)
      if (s.win) { try { window.scrollTo({ top: s.win, left: 0, behavior: 'auto' }); } catch (_) { window.scrollTo(0, s.win); } }
    };
    apply();                              // 렌더 직후 동기 복원
    requestAnimationFrame(apply);         // afterRender로 높이가 바뀌어도 재복원
  };
  const resetScroll = () => {
    const el = _scrollEl();
    if (el) el.scrollTop = 0;
    try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch (_) { window.scrollTo(0, 0); }
  };

  // ── 네비게이션 ──
  // 통합으로 사라진 화면 → 대체 화면으로 보낸다(기존 북마크·현장 QR·알림 링크 보호)
  const REDIRECTS = { haccpLogs: 'journal', sqfLogs: 'journal', supplierInbound: 'dashboard' };

  const navigate = (page, ...args) => {
    // 유통기한 임박 화면은 장기재고 알람의 '유통기한' 탭으로 합쳤다(2026-10-19) — 옛 주소·바로가기는 그 탭으로
    if (page === 'expiryAlert') { page = 'longStock'; args = ['expiry']; }
    if (REDIRECTS[page]) page = REDIRECTS[page];
    // QR 을 숨긴 동안 스캔 화면은 인쇄된 라벨의 링크(id 있음)로만 열린다
    if (page === 'scan' && !QR_ON && !args[0]) page = 'dashboard';
    if (!pages[page]) page = 'dashboard';
    // 같은 페이지 재렌더(체크박스 토글·상태갱신·refreshPage)면 스크롤 위치 유지,
    //   실제 페이지 전환이면 상단으로. → 전 화면 공통(전역) 처리.
    const _samePage = (currentPage === page);
    const _scroll = _samePage ? captureScroll() : null;
    // 이력 적재: 실제 페이지 전환일 때만(같은 페이지 재렌더·공장필터·refreshPage 제외), 뒤로가기 중엔 제외
    if (!_navBack && currentPage && currentPage !== page) {
      navHistory.push({ page: currentPage, args: pageArgs });
      if (navHistory.length > 50) navHistory.shift();
    }
    _navBack = false;
    currentPage = page;
    pageArgs    = args;
    currentWorkspace = pages[page].workspace || currentWorkspace;
    updateWorkspaceUI();

    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    const info   = pages[page];
    const titleEl = document.getElementById('topbar-title');
    const subEl   = document.getElementById('topbar-subtitle');
    if (titleEl) titleEl.textContent = info.title;
    if (subEl)   subEl.textContent   = info.subtitle;

    renderPage();
    if (_scroll) restoreScroll(_scroll); else resetScroll();
    closeSidebar();
    // 알림 스캔 → 현재 페이지 알림 읽음 처리(진입=읽음) → 배지 갱신
    try {
      if (typeof NotificationCenter !== 'undefined') {
        NotificationCenter.scan();
        NotificationCenter.markPageRead(page);
      }
    } catch (_) {}
    updateBadges();
  };

  // ── 뒤로가기 (백스페이스) ──
  const goBack = () => {
    // 열린 오버레이(보고서·성적서)가 있으면 먼저 닫기
    const ov = document.getElementById('rpt-overlay') || document.getElementById('coa-overlay');
    if (ov) { ov.remove(); return true; }
    if (!navHistory.length) return false;
    const prev = navHistory.pop();
    _navBack = true;
    navigate(prev.page, ...(prev.args || []));
    return true;
  };

  // 백스페이스 → 이전 화면 (입력 중일 땐 제외)
  const _isEditable = (el) => {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  };
  const initBackKey = () => {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Backspace') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (_isEditable(e.target)) return;          // 입력창 타이핑 중이면 무시
      e.preventDefault();                          // 브라우저 기본 뒤로가기 차단
      goBack();
    });
  };

  const updateWorkspaceUI = () => {
    document.querySelectorAll('.workspace-tab').forEach(el => {
      el.classList.toggle('active', el.dataset.workspace === currentWorkspace);
    });
    document.querySelectorAll('.sidebar-nav [data-workspace]').forEach(el => {
      el.classList.toggle('hidden', el.dataset.workspace !== currentWorkspace);
    });
    document.querySelectorAll('[data-workspace-action]').forEach(el => {
      const scopes = String(el.dataset.workspaceAction || '').split(',').map(v => v.trim());
      el.classList.toggle('hidden', !scopes.includes(currentWorkspace));
    });
  };

  const refreshPage = () => navigate(currentPage, ...pageArgs);

  // 상단 날씨·습도 배지 갱신 (현재 선택 공장 기준)
  const updateWeatherBadge = () => {
    const el = document.getElementById('topbar-weather');
    if (!el || !window.Weather) return;
    const fac = currentFactory && currentFactory !== 'ALL' ? currentFactory : 'NS';
    const d = Weather.current(fac);
    if (!d) { el.classList.add('hidden'); return; }
    const ci = Weather.codeInfo(d.code);
    const lvl = Weather.humidityLevel(d.humidity);
    const hcol = lvl === 'high' ? '#ff6b81' : lvl === 'caution' ? '#e0a656' : 'var(--text-secondary)';
    el.classList.remove('hidden');
    el.title = `${(Weather.LOCATIONS[fac] || {}).name || fac} · ${ci.label}${lvl && lvl !== 'ok' ? ' · 고습 주의(곰팡이)' : ''} · 클릭 시 날씨 기록`;
    el.onclick = () => navigate('weather');
    el.innerHTML = `<span style="cursor:pointer">${ci.icon} <b>${d.temp != null ? d.temp.toFixed(0) : '-'}°</b> `
      + `<span style="color:${hcol}">${d.humidity != null ? d.humidity : '-'}%</span></span>`;
  };

  const renderPage = () => {
    const el  = document.getElementById('page-content');
    if (!el) return;
    const mod = pages[currentPage]?.module();
    if (!mod) return;

    try {
      el.innerHTML = mod.render(...pageArgs);
      setTimeout(() => mod.afterRender?.(...pageArgs), 50);
      // 인증관리 워크스페이스: HACCP 교육 신규 공지 알람 배너
      try { if (typeof HaccpEduAlert !== 'undefined') HaccpEduAlert.mount(el, pages[currentPage].workspace); } catch (_) {}
    } catch (e) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon"></div><h3>렌더링 오류</h3><p>${e.message}</p></div>`;
      console.error('[App] renderPage error:', e);
    }
  };

  // ── 배지 업데이트 ──
  const updateBadges = () => {
    const stats = DB.getStats(currentFactory);

    const badge = document.getElementById('badge-receiving');
    if (badge) {
      const cnt = stats.pendingScaleCount + stats.pendingQCCount;
      badge.textContent = cnt;
      badge.style.display = cnt > 0 ? 'inline-block' : 'none';
    }
    const supplierInboundBadge = document.getElementById('badge-supplier-inbound');
    if (supplierInboundBadge) {
      const cnt = stats.supplierInboundOpenCount || 0;
      supplierInboundBadge.textContent = cnt;
      supplierInboundBadge.style.display = cnt > 0 ? 'inline-block' : 'none';
    }
    const qbadge = document.getElementById('badge-quality');
    if (qbadge) {
      qbadge.textContent  = stats.pendingQCCount;
      qbadge.style.display = stats.pendingQCCount > 0 ? 'inline-block' : 'none';
    }
    // 전자 일지: 결재대기 + 작성기한초과 + 미조치이탈 합계
    const jBadge = document.getElementById('badge-journal');
    if (jBadge) {
      let cnt = 0;
      try {
        if (typeof JournalDB !== 'undefined') {
          const s = JournalDB.summary(currentFactory);
          cnt = (s.overdue || 0) + (s.pending || 0) + (s.openNg || 0);
        }
      } catch (_) {}
      jBadge.textContent = cnt;
      jBadge.style.display = cnt > 0 ? 'inline-block' : 'none';
    }
    // 품질회의: 안건 대기함 + 기한초과 안건
    const mBadge = document.getElementById('badge-meeting');
    if (mBadge) {
      let cnt = 0;
      try {
        if (typeof MeetingDB !== 'undefined') {
          const s = MeetingDB.stats(currentFactory, 'ALL');
          cnt = MeetingDB.inboxCount() + (s.overdue || 0);
        }
      } catch (_) {}
      mBadge.textContent = cnt;
      mBadge.style.display = cnt > 0 ? 'inline-block' : 'none';
    }
    const lsBadge = document.getElementById('badge-longstock');
    if (lsBadge) {
      let cnt = 0;
      try { if (typeof LongStockPage !== 'undefined') cnt = LongStockPage.alertCount(currentFactory); } catch (_) {}
      lsBadge.textContent = cnt;
      lsBadge.style.display = cnt > 0 ? 'inline-block' : 'none';
    }
    const sbadge = document.getElementById('badge-silo');
    if (sbadge) {
      sbadge.textContent  = stats.siloWaitingCount;
      sbadge.style.display = stats.siloWaitingCount > 0 ? 'inline-block' : 'none';
    }
    const pbadge = document.getElementById('badge-production');
    if (pbadge) {
      const pending = DB.getProductionOrders().filter(o => o.status === 'PENDING').length;
      pbadge.textContent  = pending;
      pbadge.style.display = pending > 0 ? 'inline-block' : 'none';
    }
    const vocbadge = document.getElementById('badge-voc');
    if (vocbadge) {
      vocbadge.textContent  = stats.openVOCCount;
      vocbadge.style.display = stats.openVOCCount > 0 ? 'inline-block' : 'none';
    }
    // [신규] 스마트제조/재고 배지
    const setBadge = (id, cnt) => { const el = document.getElementById(id); if (el) { el.textContent = cnt; el.style.display = cnt > 0 ? 'inline-block' : 'none'; } };
    try {
      const ccpDev = DB.getCCPStatus(currentFactory).reduce((s, x) => s + x.deviations, 0);
      setBadge('badge-ccp', ccpDev);
      setBadge('badge-equipment', DB.getMaintenanceDue(currentFactory).length + DB.getEquipment(currentFactory).filter(e => e.status === 'DOWN').length);
      setBadge('badge-issue', DB.getIssues(currentFactory).filter(i => i.status !== 'CLOSED').length);
      setBadge('badge-submaterial', DB.getReorderSuggestions(currentFactory).length);
    } catch (e) { /* 신규 모듈 미로드 방어 */ }
    // 실험실 시료접수 대기 배지
    try {
      if (typeof LabDB !== 'undefined' && LabDB.requestStats) setBadge('badge-lab-receive', LabDB.requestStats().pending);
    } catch (e) { /* lab 모듈 미로드 방어 */ }
    // 읽지 않은 알림 배지(사이드바 각 항목) — 클릭(진입) 시 읽음 처리되어 사라짐
    try {
      if (typeof NotificationCenter !== 'undefined') {
        const unread = NotificationCenter.unreadByPage();
        document.querySelectorAll('.sidebar-nav .nav-item[data-page]').forEach(el => {
          const page = el.dataset.page;
          const cnt = unread[page] || 0;
          let alertEl = el.querySelector('.nav-alert');
          if (cnt > 0) {
            if (!alertEl) {
              alertEl = document.createElement('span');
              alertEl.className = 'nav-alert';
              const existingBadge = el.querySelector('.nav-badge');   // 기존 카운트 배지 앞(왼쪽)에 삽입
              if (existingBadge) el.insertBefore(alertEl, existingBadge); else el.appendChild(alertEl);
            }
            alertEl.textContent = cnt > 99 ? '99+' : cnt;
            alertEl.title = NotificationCenter.list({ page, unreadOnly: true }).slice(0, 6).map(n => '• ' + n.title).join('\n');
          } else if (alertEl) {
            alertEl.remove();
          }
        });
        // 상단 워크스페이스 탭에 알림 롤업 점(다른 워크스페이스 알림도 인지)
        const wsUnread = {};
        Object.keys(unread).forEach(pg => { const ws = pages[pg]?.workspace; if (ws) wsUnread[ws] = (wsUnread[ws] || 0) + unread[pg]; });
        document.querySelectorAll('.workspace-tab[data-workspace]').forEach(tab => {
          const cnt = wsUnread[tab.dataset.workspace] || 0;
          let dot = tab.querySelector('.ws-alert-dot');
          if (cnt > 0) { if (!dot) { dot = document.createElement('span'); dot.className = 'ws-alert-dot'; tab.appendChild(dot); } dot.title = cnt + '건의 새 알림'; }
          else if (dot) { dot.remove(); }
        });
      }
    } catch (e) { /* 알림 모듈 미로드 방어 */ }
  };

  // ── 모바일 사이드바 ──
  const toggleSidebar = () => {
    document.getElementById('sidebar')?.classList.toggle('open');
    document.getElementById('sidebar-overlay')?.classList.toggle('open');
  };
  const closeSidebar = () => {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('open');
  };

  // ── 토스트 알림 ──
  const toast = (msg, type = 'info', duration = 3000) => {
    const container = document.getElementById('toast-container');
    if (!container) return;
    // 아이콘은 오류(✕)만 남긴다 — 나머지는 색으로 구분(토스트에 이모지 금지)
    const icons = { error: '✕' };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = (icons[type] ? `<span>${icons[type]}</span>` : '') + `<span>${msg}</span>`;
    container.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(20px)'; t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300); }, duration);
  };

  // ── 사이드바 하단 날짜·시계 ──
  //   현장에서 기록 시각을 눈으로 확인할 수 있게 1초 간격으로 갱신한다.
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  let clockTimer = null;
  const tickClock = () => {
    const de = document.getElementById('clock-date');
    const te = document.getElementById('clock-time');
    if (!de || !te) return;
    const n = new Date();
    const p = (v) => String(v).padStart(2, '0');
    de.textContent = `${n.getFullYear()}년 ${n.getMonth() + 1}월 ${n.getDate()}일 (${WEEKDAYS[n.getDay()]})`;
    te.textContent = `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
  };
  const initClock = () => {
    tickClock();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(tickClock, 1000);
    // 백그라운드 탭에서 타이머가 느려지는 경우가 있어 복귀 시 즉시 맞춘다
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tickClock(); });
  };

  // ── 공통 날짜 포맷 ──
  const formatDate = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) + ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  };

  // ── 전역 인쇄(모든 화면 공통) — 사이드바·탑바 등 UI 크롬 제외, 현재 화면 콘텐츠만 ──
  //   랩 보고서 오버레이(#rpt-overlay·자체 @media print 보유)가 열려있으면 그쪽에 맡긴다.
  //   beforeprint 훅으로 브라우저 인쇄(Ctrl+P)에서도 동일하게 동작.
  const _pad2 = (x) => String(x).padStart(2, '0');
  const _esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const preparePrint = () => {
    if (document.getElementById('rpt-overlay')) return; // 보고서 오버레이 자체 인쇄
    document.body.classList.add('printing');
    const main = document.getElementById('page-content');
    if (!main) return;
    main.querySelector('#print-header')?.remove();
    const title = document.getElementById('topbar-title')?.textContent || '';
    const subtitle = document.getElementById('topbar-subtitle')?.textContent || '';
    const factory = document.getElementById('topbar-factory')?.textContent || '';
    const now = new Date();
    const ts = `${now.getFullYear()}-${_pad2(now.getMonth() + 1)}-${_pad2(now.getDate())} ${_pad2(now.getHours())}:${_pad2(now.getMinutes())}`;
    const meta = [subtitle, factory, `출력 ${ts}`, '우성 품질관리 플랫폼'].filter(Boolean).join(' · ');
    const hdr = document.createElement('div');
    hdr.id = 'print-header';
    hdr.innerHTML = `<div class="ph-title">${_esc(title)}</div><div class="ph-meta">${_esc(meta)}</div>`;
    main.insertBefore(hdr, main.firstChild);
  };
  const cleanupPrint = () => {
    document.body.classList.remove('printing');
    document.getElementById('print-header')?.remove();
  };
  const printPage = () => {
    if (document.getElementById('rpt-overlay')) { window.print(); return; }
    preparePrint();
    window.print();
    setTimeout(cleanupPrint, 800); // afterprint 미발생 브라우저 대비 폴백
  };

  return { init, navigate, goBack, refreshPage, toast, toggleSidebar, setFactory, getFactory, switchWorkspace, getWorkspace, updateWorkspaceUI, pageWorkspace: (p) => pages[p]?.workspace, updateBadges, formatDate, printPage };
})();

// ── 전역 유틸 ──
function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('ko-KR', { month:'2-digit', day:'2-digit' }) + ' ' + d.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });
}
function formatDateShort(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit' });
}
function formatNum(n) { return Number(n || 0).toLocaleString(); }

// 앱 시작
window.addEventListener('DOMContentLoaded', () => {
  App.init();
});

