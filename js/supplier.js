// ============================================================
// supplier.js — 협력사 관리 페이지
// ============================================================

const SupplierPage = (() => {
  let pendingDocuments = [];
  let pendingMaterials = [];   // 협력사 납품 품목코드(원료코드·제품코드 혼용 · QR 이력 연동)
  let pendingEvalFiles = {};   // 품질평가 항목별 첨부파일 {evalKey: {name,size,mimeType,dataUrl}}
  let searchQuery = '';   // 협력사 검색어(이름·코드·품목·원료/제품명·업종)

  const documentTypes = [
    { type: 'BUSINESS_LICENSE', label: '사업자등록증', required: true },
    { type: 'RAW_MATERIAL_COA', label: '분석성적서', required: true },
    { type: 'HACCP_CERT', label: 'HACCP/인증서', required: false },
    { type: 'OTHER', label: '기타 서류', required: false }
  ];

  // 품질평가 항목별 첨부 셀(제출서류 업로드/보기/교체/삭제)
  const EVAL_FILE_ACCEPT = '.pdf,image/*,.doc,.docx,.xls,.xlsx';
  const evalAttachCell = (key) => {
    const f = pendingEvalFiles[key];
    if (f) {
      const short = f.name.length > 8 ? f.name.slice(0, 7) + '…' : f.name;
      // 잘못 올린 파일을 바로잡을 수 있게: 보기 / 교체(수정) / 삭제 3개 동작 제공
      return `<div class="eval-attach has-file" id="eval-attach-${key}">
        <button type="button" class="eval-attach-name" title="${escapeText(f.name)} (클릭하면 보기)" onclick="SupplierPage.viewEvalFile('${key}')">${escapeText(short)}</button>
        <label class="eval-attach-swap" title="다른 파일로 교체">↻
          <input type="file" accept="${EVAL_FILE_ACCEPT}" style="display:none" onchange="SupplierPage.onEvalFile('${key}', this.files[0]); this.value=''">
        </label>
        <button type="button" class="eval-attach-x" title="첨부 삭제" onclick="SupplierPage.removeEvalFile('${key}')">✕</button>
      </div>`;
    }
    return `<div class="eval-attach" id="eval-attach-${key}">
      <label class="btn btn-ghost btn-xs" style="cursor:pointer">첨부
        <input type="file" accept="${EVAL_FILE_ACCEPT}" style="display:none" onchange="SupplierPage.onEvalFile('${key}', this.files[0]); this.value=''">
      </label>
    </div>`;
  };

  // 협력사 품질검증 제출자료 체크리스트 (Check-List)
  // cat: 검증 유형 / doc: 제출 자료 / purpose: 검증 목적 / check: 주요 확인사항
  //
  // ※ 항목 추가는 반드시 해당 분류의 '맨 뒤'에만 할 것.
  //    평가 결과가 위치 기반 키(evalKey = 분류index-항목index)로 저장되므로,
  //    중간에 끼워 넣거나 순서를 바꾸면 과거 평가 이력의 판정·첨부가 다른 항목으로 밀린다.
  //
  // weight: 분류별 배점(합계 100 기준). 업종·거래 성격에 따라 달라지므로
  //         '배점 설정' 화면에서 덮어쓸 수 있고, 여기 값은 기본값으로만 쓰인다.
  const EVAL_CHECKLIST = [
    { cat: '기본 정보', weight: 15, items: [
      { doc: '사업자등록증', purpose: '사업자 적격성 확인', check: '업체명, 대표자, 사업자번호' },
      { doc: '공장등록증', purpose: '제조시설 등록 여부 확인', check: '공장 주소, 등록사항' },
      { doc: '인허가사항', purpose: '관련 법규 준수 여부 확인', check: '허가 유효성, 허가 범위' },
      { doc: '신고증(동물의약외품, 생활화학제품 등)', purpose: '법적 신고 여부 확인', check: '신고 품목 및 유효 여부' },
      { doc: '제품안전성 검증서(KC, 자가품질검사 등)', purpose: '법적 안전기준 충족 여부 확인', check: '시험기관, 유효기간' },
      // 완납증명서는 1회성 확인 — 만료 추적 대상이 아니므로 유효기간은 보지 않는다
      { doc: '국세 완납증명서', purpose: '조세 체납 여부 확인', check: '발급일, 체납액 유무' },
      { doc: '지방세 완납증명서', purpose: '지방세 체납 여부 확인', check: '발급일, 체납액 유무' },
    ]},
    { cat: '품질관리 체계', weight: 15, items: [
      { doc: '품질관리 조직도', purpose: '품질관리 운영체계 확인', check: 'QA/QC 조직 및 책임자' },
      { doc: '인증서(HACCP, GMP, ISO 등)', purpose: '품질경영시스템 운영 여부 확인', check: '인증범위 및 유효기간' },
      { doc: '품질교육자료', purpose: '품질교육 운영 여부 확인', check: '교육계획 및 이수현황' },
      { doc: '작업표준서·지시서', purpose: '작업 표준화 수준 확인', check: '최신 개정본 여부' },
    ]},
    { cat: '제조 환경 관리', weight: 15, items: [
      { doc: '제조·포장 공정도', purpose: '제조공정 적정성 확인', check: '공정 흐름 및 CCP 관리' },
      { doc: '제조·포장 시설 평면도', purpose: '작업환경 적합성 확인', check: '동선, 교차오염 방지' },
      { doc: '설비점검 일지', purpose: '설비 유지관리 수준 확인', check: '정기점검 실시 여부' },
      { doc: '이물질 예방관리 장비대장', purpose: '이물 예방체계 확인', check: '금속검출기, 방충·방서 운영 여부' },
    ]},
    { cat: '원료 및 제품관리', weight: 15, items: [
      { doc: '원료 원산지 증명서', purpose: '원료 적합성 확인', check: '원산지 및 공급처 확인' },
      { doc: 'MSDS', purpose: '화학물질 안전성 확인', check: '최신 개정본 여부' },
      { doc: '성분등록증', purpose: '제품 등록 적합성 확인', check: '등록 내용 일치 여부' },
      { doc: '품목제조보고서', purpose: '제조 신고 적합성 확인', check: '신고 내용 일치 여부' },
    ]},
    { cat: '생산 및 검사관리', weight: 15, items: [
      { doc: '생산일지', purpose: '생산이력 관리 확인', check: 'Lot 추적 가능 여부' },
      { doc: '원료수불대장', purpose: '원료 추적성 확인', check: '입출고 이력 관리' },
      { doc: '제품 중량(용량) 관리기록', purpose: '규격 관리 여부 확인', check: '허용오차 관리 여부' },
      { doc: '입고검사 성적서', purpose: '원료 품질관리 확인', check: '검사기준 적합 여부' },
      { doc: '반제품·완제품 검사성적서', purpose: '최종 품질 확인', check: '시험항목 및 판정 결과' },
    ]},
    { cat: '시험·법규 적합성', weight: 10, items: [
      { doc: '표시·광고 문구 검증자료', purpose: '표시광고 적법성 확인', check: '법규 위반 여부' },
      { doc: '계측기 검교정 성적서', purpose: '측정 신뢰성 확보', check: '교정 유효기간 및 관리상태' },
    ]},
    { cat: '변경 및 고객 관리', weight: 8, items: [
      { doc: '변경관리 절차서 및 변경관리 이력', purpose: '변경관리 체계 확인', check: '승인 절차 운영 및 검증 여부' },
      { doc: 'VOC 처리 절차서 및 개선 보고서', purpose: '고객불만 대응체계 확인', check: '프로세스 운영 및 재발방지 조치 확인' },
    ]},
    { cat: '안전 및 리스크 관리', weight: 7, items: [
      { doc: 'PL보험(생산물배상책임보험)', purpose: '제품 책임 리스크 관리', check: '가입금액 및 보장범위' },
      { doc: '용수관리 자료', purpose: '제조용수 안전성 확인', check: '수질검사 결과 및 관리주기' },
      { doc: '보존 및 보관방법', purpose: '제품 보관 적정성 확인', check: '온·습도 관리 및 보관기준 준수' },
    ]},
  ];
  const EVAL_TOTAL = EVAL_CHECKLIST.reduce((n, g) => n + g.items.length, 0);
  const evalKey = (ci, ii) => `${ci}-${ii}`;

  const escapeText = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const docLabel = (type) => documentTypes.find(d => d.type === type)?.label || '기타 서류';
  const docsOf = (supplier) => Array.isArray(supplier?.documents) ? supplier.documents : [];
  const missingRequiredDocs = (supplier) => documentTypes
    .filter(d => d.required && !docsOf(supplier).some(doc => doc.type === d.type))
    .map(d => d.label);

  const formatFileSize = (size) => {
    const n = Number(size) || 0;
    if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
    if (n >= 1024) return `${Math.round(n / 1024)}KB`;
    return `${n}B`;
  };

  // ── 사업자등록번호 자동 인식(OCR) ─────────────────────────
  const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  const PDFJS_SRC     = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js';
  const PDFJS_WORKER  = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js';
  const scriptCache = {};

  // 입력값을 표준 형식(XXX-XX-XXXXX)으로 정규화. 10자리가 아니면 원문 유지(부분 수정 허용)
  const normalizeBizNo = (raw) => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
    return String(raw || '').trim();
  };

  // OCR 텍스트에서 사업자등록번호(3-2-5, 총 10자리) 추출. 법인번호(13자리) 오인 방지
  const findBizNo = (text) => {
    const m = String(text || '').match(/(?<!\d)(\d{3})\s*[-–·.]?\s*(\d{2})\s*[-–·.]?\s*(\d{5})(?!\d)/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  };

  const ensureScript = (src) => {
    if (scriptCache[src]) return scriptCache[src];
    scriptCache[src] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { delete scriptCache[src]; reject(new Error('스크립트 로드 실패: ' + src)); };
      document.head.appendChild(el);
    });
    return scriptCache[src];
  };

  // PDF 첫 페이지를 캔버스로 렌더(이미지가 아닌 사업자등록증 대응)
  const renderPdfFirstPage = async (file) => {
    await ensureScript(PDFJS_SRC);
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) return null;
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas;
  };

  const getOcrSource = async (file) => {
    const mime = file.type || '';
    if (mime.startsWith('image/')) return file;
    if (mime === 'application/pdf' || /\.pdf$/i.test(file.name)) return renderPdfFirstPage(file);
    return null;
  };

  // 사업자등록증 업로드 시 번호 자동 인식 → 입력칸 채움(비어있을 때만, 수정 가능)
  const runBizNoOCR = async (file) => {
    let source;
    try { source = await getOcrSource(file); }
    catch (_) { source = null; }
    if (!source) return; // 지원하지 않는 형식(문서파일 등)은 조용히 통과
    App.toast('사업자등록번호 인식 중…', 'info', 6000);
    try {
      await ensureScript(TESSERACT_SRC);
      const { data } = await window.Tesseract.recognize(source, 'eng');
      const no = findBizNo(data && data.text);
      const input = document.getElementById('sup-bizno'); // 모달이 닫혔으면 null
      if (!no) { App.toast('사업자등록번호를 자동 인식하지 못했습니다. 직접 입력해주세요', 'warning'); return; }
      if (!input) return;
      const cur = normalizeBizNo(input.value || '');
      if (!cur)            { input.value = no; App.toast(`사업자등록번호 자동 인식: ${no}`, 'success'); }
      else if (cur !== no) { App.toast(`인식된 번호 ${no} · 현재 입력값(${cur}) 유지 · 필요시 수정하세요`, 'info', 5000); }
      else                 { App.toast(`사업자등록번호 확인: ${no}`, 'success'); }
    } catch (_) {
      App.toast('사업자등록번호 자동 인식에 실패했습니다. 직접 입력해주세요', 'warning');
    }
  };

  // 검색어로 협력사 필터(이름·코드·QR·품목·원료·업종·국내수입)
  const filterSuppliers = (suppliers, q) => {
    const lq = String(q || '').toLowerCase().trim();
    if (!lq) return suppliers;
    return suppliers.filter(s => {
      const hay = [
        s.name, s.code, s.qrCode, s.mainItem, s.industry, s.domesticImport, s.businessNo,
        ...(s.materials || []),
        // 연동 품목의 명칭(원료·제품)으로도 검색되게
        ...(s.materials || []).map(c => resolveItemByCode(c).name),
      ].map(v => String(v ?? '').toLowerCase()).join(' ');
      return hay.includes(lq);
    });
  };

  // 협력사 카드 1개 렌더
  const cardHtml = (s, receivings) => {
    const supReceivings = receivings.filter(r => r.supplierName === s.name || r.supplierId === s.id);
    const totalQty = supReceivings.reduce((acc, r) => acc + (r.actualWeight||r.expectedWeight||0), 0);
    const qcFails  = supReceivings.filter(r => r.status === 'REJECTED').length;
    const diffWarn = supReceivings.filter(r => {
      const w = DB.getWeighingByReceivingId(r.id);
      return w && Math.abs(w.diffPct) > 2;
    }).length;
    const docs = docsOf(s);
    const missingDocs = missingRequiredDocs(s);
    return `
    <div class="card supplier-card">
      <div class="flex items-start justify-between mb-12">
        <div class="supplier-card-head" onclick="SupplierPage.showFullDetail('${s.id}')" title="클릭하면 전체 정보·이력을 봅니다">
          <div class="font-bold text-lg">${escapeText(s.name)} <span class="supplier-detail-hint">상세 ›</span></div>
          <div class="text-xs text-muted">${escapeText(s.code)} · ${escapeText(s.domesticImport||'-')} · ${escapeText(s.industry||'-')}</div>
          <div class="text-xs text-muted td-mono mt-4 qr-only">${escapeText(s.qrCode || DB.makeQRValue('SUPPLIER', s.code))}</div>
          ${s.businessNo ? `<div class="text-xs text-muted td-mono mt-4">사업자 ${escapeText(s.businessNo)}</div>` : ''}
        </div>
        <span class="badge ${s.haccpGrade==='A'?'badge-pass':s.haccpGrade==='B'?'badge-info':s.haccpGrade?'badge-warning':'badge-default'}">${escapeText(s.haccpGrade || s.status || '활성')}</span>
      </div>
      <div class="text-sm mb-8">${escapeText(s.mainItem || '거래품목 미입력')}</div>
      ${s.haccpOpinion ? `<div class="text-xs text-muted mb-8">${escapeText(s.haccpOpinion)}</div>` : ''}
      <div class="supplier-doc-summary ${missingDocs.length ? 'doc-missing' : ''}">
        <div>
          <div class="text-xs text-muted">등록 서류</div>
          <div class="font-bold">${docs.length}건 ${missingDocs.length ? `<span class="text-warning">· 미첨부 ${missingDocs.length}</span>` : '<span class="text-success">· 필수 확인</span>'}</div>
        </div>
        <button class="btn btn-ghost btn-xs" onclick="SupplierPage.showDocuments('${s.id}')">보기</button>
      </div>
      <div class="supplier-stats">
        <div class="stat-box">
          <div class="stat-label">총 납품</div>
          <div class="stat-value">${supReceivings.length}건</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">납품중량</div>
          <div class="stat-value">${(totalQty/1000).toFixed(1)}t</div>
        </div>
        <div class="stat-box ${qcFails>0?'stat-danger':''}">
          <div class="stat-label">품질불합격</div>
          <div class="stat-value">${qcFails}건</div>
        </div>
        <div class="stat-box ${diffWarn>0?'stat-warn':''}">
          <div class="stat-label">중량차이</div>
          <div class="stat-value">${diffWarn}건</div>
        </div>
      </div>
      ${(s.materials||[]).length > 0 ? `
      <div class="mt-8">
        <div class="text-xs text-muted mb-4">납품 품목</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          ${s.materials.map(mc => `<span class="badge badge-default">${escapeText(mc)}</span>`).join('')}
        </div>
      </div>` : ''}
      ${(() => {
        const ev = latestEval(s);
        if (!ev) return `<div class="supplier-eval-summary none">품질평가 미실시</div>`;
        const sm = summaryOf(ev);
        const tone = (GRADE_META[sm.grade] || {}).cls || 'none';
        const prevEv = (s.evaluations || []).slice(-2)[0];
        // 직전 대비 증감 — 점수제로 바꾼 이유가 추이를 보기 위한 것이므로 카드에서 바로 보여준다
        const diff = (prevEv && prevEv !== ev) ? Math.round((sm.score - summaryOf(prevEv).score) * 10) / 10 : null;
        return `<div class="supplier-eval-summary ${tone}">
          품질평가 ${escapeText(ev.date)} · <b>${sm.score}점</b> ${gradeChip(sm)}
          ${diff !== null && diff !== 0 ? `<span class="eval-diff ${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}</span>` : ''}
          ${sm.zero ? `<span class="text-danger">· 부적합 ${sm.zero}</span>` : ''}
        </div>`;
      })()}
      <div class="flex gap-8 mt-12">
        <button class="btn btn-ghost btn-sm qr-only" onclick="SupplierPage.showQR('${s.id}')">QR</button>
        <button class="btn btn-ghost btn-sm" onclick="SupplierPage.showHistory('${s.id}')">납품이력</button>
        <button class="btn btn-ghost btn-sm" onclick="SupplierPage.showDocuments('${s.id}')">서류</button>
        <button class="btn btn-outline-primary btn-sm" onclick="SupplierPage.openEvalModal('${s.id}')">품질평가</button>
        <button class="btn btn-ghost btn-sm" onclick="SupplierPage.editSupplier('${s.id}')">수정</button>
      </div>
    </div>`;
  };

  // 목록 영역(검색 결과) HTML — 검색 시 이 부분만 갱신해 입력 포커스 유지
  const listHtml = (suppliers, receivings) => {
    const filtered = filterSuppliers(suppliers, searchQuery);
    if (filtered.length === 0) {
      return `<div class="empty-state"><div class="empty-icon"></div><h3>검색 결과가 없습니다</h3><p class="text-muted">"${escapeText(searchQuery)}"에 해당하는 협력사가 없습니다.</p></div>`;
    }
    return `<div class="grid-2 mb-20">${filtered.map(s => cardHtml(s, receivings)).join('')}</div>`;
  };

  const render = () => {
    const suppliers = DB.getSuppliers();
    const receivings = DB.getReceivings();
    const filteredCount = filterSuppliers(suppliers, searchQuery).length;

    return `
      <div class="fade-in">
        <div class="flex items-center justify-between mb-12" style="gap:12px;flex-wrap:wrap">
          <div class="text-sm text-muted" id="supplier-count">
            ${searchQuery ? `검색 <b>${filteredCount}</b> / 총 ${suppliers.length}개` : `총 ${suppliers.length}개 협력사`} · 신규 코드는 자동 발급
          </div>
          <div class="flex gap-8">
            <button class="btn btn-ghost btn-sm" onclick="SupplierPage.openEvalConfig()">평가 배점 설정</button>
            <button class="btn btn-primary btn-sm" onclick="SupplierPage.openAddModal()">＋ 협력사 등록</button>
          </div>
        </div>

        ${suppliers.length === 0 ? '' : `
        <div class="form-group" style="position:relative;margin-bottom:16px">
          <input type="text" class="form-input" id="supplier-search" autocomplete="off"
                 placeholder="협력사 검색 (이름·코드·거래품목·납품원료·업종)"
                 value="${escapeText(searchQuery)}"
                 oninput="SupplierPage.onSearch(this.value)">
          <button class="btn btn-ghost btn-xs" id="supplier-search-clear"
                  style="position:absolute;right:8px;top:50%;transform:translateY(-50%);display:${searchQuery ? '' : 'none'}"
                  onclick="SupplierPage.clearSearch()">✕ 초기화</button>
        </div>`}

        ${suppliers.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon"></div>
            <h3>등록된 협력사가 없습니다</h3>
          </div>` : `
        <div id="supplier-list">${listHtml(suppliers, receivings)}</div>`}

        <div class="modal-overlay" id="supplier-add-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title">협력사 등록/수정</div>
              <button class="modal-close" onclick="SupplierPage.closeModal('supplier-add-modal')">✕</button>
            </div>
            <div id="supplier-add-body"></div>
          </div>
        </div>

        <div class="modal-overlay" id="supplier-history-modal">
          <div class="modal modal-xl">
            <div class="modal-header">
              <div class="modal-title">협력사 납품이력</div>
              <button class="modal-close" onclick="SupplierPage.closeModal('supplier-history-modal')">✕</button>
            </div>
            <div id="supplier-history-body"></div>
          </div>
        </div>

        <div class="modal-overlay" id="supplier-doc-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title">협력사 등록서류</div>
              <button class="modal-close" onclick="SupplierPage.closeModal('supplier-doc-modal')">✕</button>
            </div>
            <div id="supplier-doc-body"></div>
          </div>
        </div>

        <div class="modal-overlay" id="supplier-eval-modal">
          <div class="modal modal-xl">
            <div class="modal-header">
              <div class="modal-title">협력사 품질검증 평가</div>
              <button class="modal-close" onclick="SupplierPage.closeModal('supplier-eval-modal')">✕</button>
            </div>
            <div id="supplier-eval-body"></div>
          </div>
        </div>

        <div class="modal-overlay" id="supplier-detail-modal">
          <div class="modal modal-xl">
            <div class="modal-header">
              <div class="modal-title">협력사 전체 정보 · 이력</div>
              <button class="modal-close" onclick="SupplierPage.closeModal('supplier-detail-modal')">✕</button>
            </div>
            <div id="supplier-detail-body"></div>
          </div>
        </div>

        <div class="modal-overlay" id="supplier-qr-modal">
          <div class="modal">
            <div class="modal-header">
              <div class="modal-title">협력사 QR</div>
              <button class="modal-close" onclick="SupplierPage.closeModal('supplier-qr-modal')">✕</button>
            </div>
            <div id="supplier-qr-body"></div>
          </div>
        </div>
      </div>
    `;
  };

  const openAddModal = (supplierId) => {
    const s = supplierId ? DB.getSupplierById(supplierId) : null;
    const body = document.getElementById('supplier-add-body');
    if (!body) return;
    pendingDocuments = docsOf(s).map(d => ({ ...d }));
    pendingMaterials = Array.isArray(s?.materials) ? s.materials.slice() : [];
    const code = s?.code || DB.generateSupplierCode();
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">협력사명 *</label>
            <input type="text" class="form-input" id="sup-name" value="${escapeText(s?.name||'')}" placeholder="예) 한빛곡물">
          </div>
          <div class="form-group">
            <label class="form-label">협력사 코드</label>
            <input type="text" class="form-input supplier-code-readonly" id="sup-code-preview" value="${escapeText(code)}" readonly>
            <div class="form-hint">${s ? '기존 협력사 코드는 수정하지 않습니다' : (QR_ON ? '등록 시 자동 발급되고 QR 코드도 함께 생성됩니다' : '등록 시 자동 발급됩니다')}</div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">거래품목</label>
          <input type="text" class="form-input" id="sup-main-item" value="${escapeText(s?.mainItem||'')}" placeholder="예) 옥수수, 첨가제">
          <div class="form-hint">표시용 요약입니다 · 실제 ${QR_ON ? 'QR 이력' : '이력'} 연동은 아래 <b>납품 품목</b>에서 코드로 연결하세요</div>
        </div>
        <div class="form-group">
          <label class="form-label">납품 품목 (원료·제품코드 연동)</label>
          <div class="search-box relative">
            <span class="search-icon"></span>
            <input type="text" class="form-input" id="sup-material-search" placeholder="원료코드·제품코드 또는 명칭으로 검색..." autocomplete="off"
              oninput="SupplierPage.onMaterialSearch(this.value)" onblur="setTimeout(()=>SupplierPage.closeMaterialDropdown(),200)">
            <div class="autocomplete-dropdown hidden" id="sup-material-dropdown"></div>
          </div>
          <div class="form-hint">이름만 입력하면 ${QR_ON ? 'QR 이력관리' : '이력관리'}가 안 될 수 있어요 · 마스터에서 실제 <b>원료코드 또는 제품코드</b>를 찾아 연결합니다 (여러 개 추가 가능)</div>
          <div id="sup-material-chips" class="supplier-material-chips"></div>
        </div>
        <div class="form-group">
          <label class="form-label">사업자등록번호</label>
          <input type="text" class="form-input" id="sup-bizno" value="${escapeText(s?.businessNo||'')}" placeholder="예) 123-45-67890" inputmode="numeric">
          <div class="form-hint">사업자등록증을 업로드하면 자동으로 인식됩니다 · 인식 오류 시 직접 수정하세요</div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">연락처</label>
            <input type="text" class="form-input" id="sup-tel" value="${escapeText(s?.contact||'')}" placeholder="041-000-0000">
          </div>
          <div class="form-group">
            <label class="form-label">이메일</label>
            <input type="text" class="form-input" id="sup-email" value="${escapeText(s?.email||'')}" placeholder="example@mail.com">
          </div>
        </div>

        <div class="supplier-doc-upload-panel">
          <div class="flex items-center justify-between mb-8">
            <div>
              <div class="font-bold text-sm">필요 서류</div>
              <div class="text-xs text-muted">사업자등록증, 분석성적서 등 파일당 2MB 이하로 보관됩니다</div>
            </div>
          </div>
          <div class="supplier-doc-upload-grid">
            ${documentTypes.map(d => `
              <label class="supplier-doc-upload">
                <div>
                  <div class="font-bold text-sm">${d.label} ${d.required ? '<span class="required">*</span>' : ''}</div>
                  <div class="text-xs text-muted">${d.required ? '필수 서류' : '선택 서류'}</div>
                </div>
                <input type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" onchange="SupplierPage.onDocumentFile('${d.type}', this.files[0]);this.value=''">
                <span class="btn btn-ghost btn-xs">파일 선택</span>
              </label>
            `).join('')}
          </div>
          <div id="supplier-doc-list">${renderDocumentList(pendingDocuments, true)}</div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="SupplierPage.closeModal('supplier-add-modal')">취소</button>
          <button class="btn btn-primary" onclick="SupplierPage.submitSupplier('${supplierId||''}')">${s?'수정':'등록'}</button>
        </div>
      </div>
    `;
    document.getElementById('supplier-add-modal').classList.add('open');
    renderMaterialChips();
  };

  // ── 납품 품목(원료·제품 코드) 검색·연동 ─────────────────────────────
  //   협력사가 원료뿐 아니라 완제품도 납품할 수 있어 두 마스터를 모두 연동한다.
  //   저장 구조는 기존과 동일한 '코드 문자열 배열' — 조회 시 원료 우선, 없으면 제품으로 해석.
  const resolveItemByCode = (code) => {
    const m = DB.getMaterialByCode(code);
    if (m) return { code, name: m.name, kind: 'raw', label: '원료' };
    const p = DB.getProductByCode ? DB.getProductByCode(code) : null;
    if (p) return { code, name: p.name, kind: 'prod', label: '제품' };
    return { code, name: '(미확인 코드)', kind: null, label: '' };
  };
  const kindBadge = (kind) => kind === 'prod'
    ? '<span class="badge badge-info" style="font-size:10px;padding:1px 5px">제품</span>'
    : kind === 'raw' ? '<span class="badge badge-default" style="font-size:10px;padding:1px 5px">원료</span>' : '';

  const onMaterialSearch = (query) => {
    const dd = document.getElementById('sup-material-dropdown');
    if (!dd) return;
    const q = String(query || '').trim();
    if (!q) { closeMaterialDropdown(); return; }
    const raws = DB.searchMaterials(q).map(m => ({ code: m.code, name: m.name, kind: 'raw', label: '원료' }));
    const prods = (DB.searchProducts ? DB.searchProducts(q) : []).map(p => ({ code: p.code, name: p.name, kind: 'prod', label: '제품' }));
    const results = raws.concat(prods).filter(x => !pendingMaterials.includes(x.code)).slice(0, 40);
    if (results.length === 0) {
      dd.innerHTML = '<div class="autocomplete-item text-muted">검색 결과 없음 · 원료코드/제품코드 또는 명칭을 확인하세요</div>';
    } else {
      dd.innerHTML = results.map(x => `
        <div class="autocomplete-item" onclick="SupplierPage.addMaterial('${escapeText(x.code)}')">
          <span class="item-name">${kindBadge(x.kind)} ${escapeText(x.name)}</span>
          <span class="item-code">${escapeText(x.code)}</span>
        </div>`).join('');
    }
    dd.classList.remove('hidden');
  };

  const closeMaterialDropdown = () => {
    const dd = document.getElementById('sup-material-dropdown');
    if (dd) dd.classList.add('hidden');
  };

  const addMaterial = (code) => {
    if (code && !pendingMaterials.includes(code)) pendingMaterials.push(code);
    const input = document.getElementById('sup-material-search');
    if (input) { input.value = ''; input.focus(); }
    closeMaterialDropdown();
    renderMaterialChips();
  };

  const removeMaterial = (code) => {
    pendingMaterials = pendingMaterials.filter(c => c !== code);
    renderMaterialChips();
  };

  const renderMaterialChips = () => {
    const box = document.getElementById('sup-material-chips');
    if (!box) return;
    if (pendingMaterials.length === 0) {
      box.innerHTML = '<div class="supplier-material-empty">연결된 품목이 없습니다 · 위에서 검색해 추가하세요</div>';
      return;
    }
    box.innerHTML = pendingMaterials.map(code => {
      const it = resolveItemByCode(code);
      return `<span class="supplier-material-chip">
        <span class="chip-name">${kindBadge(it.kind)} ${escapeText(it.name)}</span>
        <span class="chip-code">${escapeText(code)}</span>
        <button type="button" class="chip-remove" onclick="SupplierPage.removeMaterial('${escapeText(code)}')">✕</button>
      </span>`;
    }).join('');
  };

  const renderDocumentList = (docs, editable = false) => {
    const list = Array.isArray(docs) ? docs : [];
    if (list.length === 0) {
      return `<div class="supplier-doc-empty">첨부된 서류가 없습니다</div>`;
    }

    // 개별 서류 행(파일명·용량·날짜 + 보기/삭제)
    const docItem = (doc) => `
      <div class="supplier-doc-item">
        <div class="supplier-doc-icon"></div>
        <div style="flex:1;min-width:0">
          <div class="font-bold text-sm ellipsis">${escapeText(doc.name || '-')}</div>
          <div class="text-xs text-muted">${formatFileSize(doc.size)} · ${formatDateShort(doc.uploadedAt)}</div>
        </div>
        <button class="btn btn-ghost btn-xs" onclick="${editable ? `SupplierPage.viewPendingDocument('${doc.id}')` : `SupplierPage.openDocumentById('${doc.id}')`}">보기</button>
        ${editable ? `<button class="btn btn-danger btn-xs" onclick="SupplierPage.removePendingDocument('${doc.id}')">삭제</button>` : ''}
      </div>`;

    // 서류 종류별로 그룹핑(정해진 순서: 사업자등록증 → 분석성적서 → HACCP/인증서 → 기타)
    let n = 0;
    const group = (label, items) => {
      if (!items.length) return '';
      n += 1;
      return `
        <div class="supplier-doc-group">
          <div class="supplier-doc-group-title">${n}. ${escapeText(label)} <span class="supplier-doc-group-count">${items.length}건</span></div>
          ${items.map(docItem).join('')}
        </div>`;
    };

    const known = new Set(documentTypes.map(d => d.type));
    let sections = documentTypes.map(dt => group(dt.label, list.filter(d => d.type === dt.type))).join('');
    // documentTypes에 없는 레거시 타입 방어
    sections += group('기타', list.filter(d => !known.has(d.type)));

    return `<div class="supplier-doc-list">${sections}</div>`;
  };

  const refreshPendingDocuments = () => {
    const el = document.getElementById('supplier-doc-list');
    if (el) el.innerHTML = renderDocumentList(pendingDocuments, true);
  };

  const onDocumentFile = (type, file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      App.toast('파일은 2MB 이하만 첨부할 수 있습니다', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const label = docLabel(type);
      const doc = {
        id: `DOC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        type,
        label,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl: reader.result,
        uploadedAt: new Date().toISOString()
      };
      if (type !== 'OTHER') pendingDocuments = pendingDocuments.filter(d => d.type !== type);
      pendingDocuments.push(doc);
      refreshPendingDocuments();
      App.toast(`${label} 첨부 완료`, 'success');
      if (type === 'BUSINESS_LICENSE') runBizNoOCR(file);
    };
    reader.onerror = () => App.toast('파일을 읽지 못했습니다', 'error');
    reader.readAsDataURL(file);
  };

  const viewDoc = (doc) => {
    if (!doc?.dataUrl) {
      App.toast('서류 데이터가 없습니다', 'error');
      return;
    }
    const win = window.open('', '_blank');
    if (!win) {
      App.toast('팝업 차단을 해제한 뒤 다시 시도해주세요', 'warning');
      return;
    }
    const safeName = escapeText(doc.name || docLabel(doc.type));
    if ((doc.mimeType || '').startsWith('image/')) {
      win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${safeName}</title><style>body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh}img{max-width:100%;max-height:100vh}</style></head><body><img src="${doc.dataUrl}" alt="${safeName}"></body></html>`);
    } else {
      win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${safeName}</title><style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style></head><body><iframe src="${doc.dataUrl}"></iframe></body></html>`);
    }
    win.document.close();
  };

  const viewPendingDocument = (docId) => {
    const doc = pendingDocuments.find(d => d.id === docId);
    viewDoc(doc);
  };

  const removePendingDocument = (docId) => {
    pendingDocuments = pendingDocuments.filter(d => d.id !== docId);
    refreshPendingDocuments();
  };

  const editSupplier = (id) => openAddModal(id);

  const submitSupplier = (supplierId) => {
    const name  = document.getElementById('sup-name')?.value.trim();
    const tel   = document.getElementById('sup-tel')?.value.trim();
    const email = document.getElementById('sup-email')?.value.trim();
    const businessNo = normalizeBizNo(document.getElementById('sup-bizno')?.value || '');
    const materials = pendingMaterials.slice();
    // 거래품목이 비어있으면 연동된 원료명으로 자동 요약
    let mainItem = document.getElementById('sup-main-item')?.value.trim();
    if (!mainItem && materials.length) {
      mainItem = materials.map(c => { const it = resolveItemByCode(c); return it.kind ? it.name : null; }).filter(Boolean).join(', ');
    }
    if (!name) { App.toast('협력사명은 필수입니다', 'error'); return; }
    try {
      if (supplierId) {
        DB.updateSupplier(supplierId, { name, mainItem, contact: tel, email, businessNo, materials, documents: pendingDocuments });
        App.toast('협력사 정보 수정 완료', 'success');
      } else {
        const item = DB.addSupplier({ name, mainItem, contact: tel, email, businessNo, materials, documents: pendingDocuments });
        App.toast(`협력사 등록 완료: ${item.code}`, 'success');
      }
      pendingDocuments = [];
      pendingMaterials = [];
      closeModal('supplier-add-modal');
      App.refreshPage();
    } catch (e) {
      App.toast('저장 실패: ' + e.message, 'error');
    }
  };

  const showQR = (supplierId) => {
    const s = DB.getSupplierById(supplierId);
    const body = document.getElementById('supplier-qr-body');
    if (!s || !body) return;
    const qrValue = s.qrCode || DB.makeQRValue('SUPPLIER', s.code);
    body.innerHTML = `
      <div style="padding:16px;text-align:center">
        <div class="font-bold text-lg mb-4">${escapeText(s.name)}</div>
        <div class="text-sm text-muted mb-12">${escapeText(s.code)} · ${escapeText(s.mainItem || '-')}</div>
        <div class="qr-preview-box"><div id="supplier-qr-preview"></div></div>
        <div class="td-mono text-xs text-muted mt-10">${escapeText(qrValue)}</div>
        <div class="info-box info-blue mt-16" style="text-align:left">
          이 QR을 스캔하면 협력사 마스터와 납품 이력을 조회하고, 해당 협력사로 바로 입고예정 QR을 발행할 수 있습니다.
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="SupplierPage.closeModal('supplier-qr-modal')">닫기</button>
          <button class="btn btn-primary" onclick="SupplierInboundPage.prefillSupplier('${s.id}');App.navigate('supplierInbound');setTimeout(()=>SupplierInboundPage.openAddModal(),200)">이 업체로 입고예정 등록</button>
        </div>
      </div>`;
    document.getElementById('supplier-qr-modal').classList.add('open');
    setTimeout(() => QRUtil.generate('supplier-qr-preview', qrValue, { size: 180 }), 80);
  };

  const showDocuments = (supplierId) => {
    const s = DB.getSupplierById(supplierId);
    const body = document.getElementById('supplier-doc-body');
    if (!s || !body) return;
    const docs = docsOf(s);
    const missing = missingRequiredDocs(s);
    body.innerHTML = `
      <div style="padding:16px">
        <div class="info-box ${missing.length ? 'info-warning' : 'info-green'} mb-12">
          <strong>${escapeText(s.name)}</strong> (${escapeText(s.code)}) · 등록서류 ${docs.length}건
          ${missing.length ? `<br>미첨부 필수서류: ${missing.map(escapeText).join(', ')}` : '<br>필수서류가 첨부되어 있습니다.'}
        </div>
        <div id="supplier-stored-doc-list">${renderDocumentList(docs, false)}</div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="SupplierPage.closeModal('supplier-doc-modal')">닫기</button>
          <button class="btn btn-primary" onclick="SupplierPage.closeModal('supplier-doc-modal');SupplierPage.editSupplier('${s.id}')">서류 추가/수정</button>
        </div>
      </div>
    `;
    document.getElementById('supplier-doc-modal').classList.add('open');
  };

  const openDocumentById = (docId) => {
    const doc = DB.getSuppliers().flatMap(s => docsOf(s)).find(d => d.id === docId);
    viewDoc(doc);
  };

  const openStoredDocument = (supplierId, docId) => {
    const s = DB.getSupplierById(supplierId);
    const doc = docsOf(s).find(d => d.id === docId);
    viewDoc(doc);
  };

  const showHistory = (supplierId) => {
    const s    = DB.getSupplierById(supplierId);
    const body = document.getElementById('supplier-history-body');
    if (!body || !s) return;
    const hist = DB.getReceivings().filter(r => r.supplierId===supplierId || r.supplierName===s.name).slice().reverse();
    body.innerHTML = `
      <div style="padding:16px">
        <div class="info-box info-blue mb-12">
          <strong>${escapeText(s.name)}</strong> (${escapeText(s.code)}) — 총 ${hist.length}건 납품
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>입고번호</th><th>원료</th><th>차량번호</th><th class="td-right">예정중량</th><th class="td-right">실중량</th><th>편차</th><th>상태</th><th>날짜</th></tr></thead>
            <tbody>
              ${hist.length===0?`<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted)">납품이력 없음</td></tr>`:
              hist.map(r => {
                const w = DB.getWeighingByReceivingId(r.id);
                return `<tr>
                  <td><span class="td-mono text-xs">${escapeText(recvNo(r).slice(0,16))}</span></td>
                  <td>${escapeText(r.materialName)}</td>
                  <td>${escapeText(r.vehicleNo||'-')}</td>
                  <td class="td-right">${formatNum(r.expectedWeight)}kg</td>
                  <td class="td-right">${r.actualWeight?formatNum(r.actualWeight)+'kg':'-'}</td>
                  <td class="${w?Math.abs(w.diffPct)>2?'text-red':'':''}">${w?`${w.diffPct>0?'+':''}${w.diffPct}%`:'-'}</td>
                  <td>${r.status==='IN_STOCK'?'<span class="badge badge-pass">입고완료</span>':r.status==='REJECTED'?'<span class="badge badge-fail">불합격</span>':'<span class="badge badge-warning">진행중</span>'}</td>
                  <td class="text-xs text-muted">${escapeText(r.receivedDate)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="modal-footer"><button class="btn btn-ghost" onclick="SupplierPage.closeModal('supplier-history-modal')">닫기</button></div>
      </div>
    `;
    document.getElementById('supplier-history-modal').classList.add('open');
  };

  // ── 협력사 품질검증 평가 (점수제) ──────────────────────────
  //
  //   합부(적합/부적합) 판정은 "기준을 넘었나"만 알려줄 뿐, 협력사끼리 비교하거나
  //   해마다 나아지고 있는지를 볼 수 없었다. 그래서 항목마다 5점 척도로 채점하고
  //   분류 가중치를 반영해 100점으로 환산한 뒤 등급을 매긴다.
  //
  //   과거 합부 이력은 버리지 않고 환산해서 같은 축에 얹는다(migrateResult 참조).
  const MAX_SCORE = 5;
  const SCORE_SCALE = [
    { v: 5, label: '우수',   desc: '기준을 넘어 체계적으로 관리' },
    { v: 4, label: '양호',   desc: '기준 충족 · 경미한 보완사항' },
    { v: 3, label: '보통',   desc: '기준 충족 최소 수준' },
    { v: 1, label: '미흡',   desc: '자료 불충분 · 개선 필요' },
    { v: 0, label: '부적합', desc: '미제출 또는 기준 미달' },
  ];
  const NA_VALUE = 'NA';
  const scoreLabel = (v) => (v === NA_VALUE ? '해당없음'
    : (SCORE_SCALE.find(x => x.v === Number(v))?.label || ''));

  const GRADE_META = {
    A: { label: '우수',   cls: 'ok',   note: '정기평가 유지' },
    B: { label: '양호',   cls: 'ok',   note: '경미 보완 요청' },
    C: { label: '조건부', cls: 'warn', note: '개선계획 제출 요구' },
    D: { label: '부적격', cls: 'bad',  note: '거래 재검토 · 재평가 필요' },
  };
  const DEFAULT_CUTOFFS = { A: 90, B: 80, C: 70 };

  // ── 배점 설정 (분류 가중치 · 등급 컷오프) ──
  //   동기화 계층이 id 를 가진 레코드 배열만 병합할 수 있어 단일 레코드 배열로 저장한다.
  const EVAL_CFG_KEY = 'rm_supplier_eval_config';
  const EVAL_CFG_ID = 'supplier-eval-config';
  const readCfgRow = () => {
    try { return JSON.parse(localStorage.getItem(EVAL_CFG_KEY) || '[]').find(x => x.id === EVAL_CFG_ID) || null; }
    catch (_) { return null; }
  };
  const evalConfig = () => {
    const row = readCfgRow();
    const weights = {};
    // 가중치는 분류 index 가 아니라 이름으로 잡는다.
    // index 로 잡으면 분류를 하나 끼워 넣는 순간 배점이 통째로 밀린다.
    EVAL_CHECKLIST.forEach(g => {
      const o = row?.weights?.[g.cat];
      weights[g.cat] = (o === undefined || o === null || o === '') ? g.weight : Number(o);
    });
    return { weights, cutoffs: { ...DEFAULT_CUTOFFS, ...(row?.cutoffs || {}) }, updatedAt: row?.updatedAt, updatedBy: row?.updatedBy };
  };
  const saveEvalConfig = (weights, cutoffs, by) => {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(EVAL_CFG_KEY) || '[]').filter(x => x.id !== EVAL_CFG_ID); } catch (_) { list = []; }
    list.push({ id: EVAL_CFG_ID, weights, cutoffs, updatedAt: new Date().toISOString(), updatedBy: by || '' });
    localStorage.setItem(EVAL_CFG_KEY, JSON.stringify(list));
    try { if (window.__onDbWrite) window.__onDbWrite(EVAL_CFG_KEY); } catch (_) {}
  };
  const resetEvalConfig = () => {
    localStorage.setItem(EVAL_CFG_KEY, '[]');
    try { if (window.__onDbWrite) window.__onDbWrite(EVAL_CFG_KEY); } catch (_) {}
  };

  // 구버전 합부 판정 → 점수 환산.
  //   '적합'을 만점(5)이 아니라 4점으로 두는 이유: 옛 평가는 "기준을 넘었는지"만 봤을 뿐
  //   우수한지까지 가린 것이 아니다. 만점을 주면 새 기준으로 재평가한 협력사가 손해를 본다.
  const VERDICT_TO_SCORE = { '적합': 4, '부적합': 0, '해당없음': NA_VALUE };
  const migrateResult = (r) => {
    if (!r) return r;
    if (r.score !== undefined && r.score !== null && r.score !== '') return r;
    if (r.verdict && VERDICT_TO_SCORE[r.verdict] !== undefined) {
      return { ...r, score: VERDICT_TO_SCORE[r.verdict], migrated: true };
    }
    return r;
  };

  // 평가 결과 배열 → 점수 요약(분류별 득점 · 100점 환산 · 등급)
  const summarizeEval = (results) => {
    const cfg = evalConfig();
    const map = {};
    (results || []).forEach(r => { map[r.key] = migrateResult(r); });

    let submitted = 0, scored = 0, na = 0, unscored = 0, zero = 0;
    const cats = EVAL_CHECKLIST.map((g, ci) => {
      let sum = 0, n = 0, catNa = 0, catZero = 0;
      g.items.forEach((_, ii) => {
        const r = map[evalKey(ci, ii)];
        if (r?.checked) submitted += 1;
        const v = r?.score;
        if (v === NA_VALUE) { catNa += 1; na += 1; return; }
        if (v === undefined || v === null || v === '') { unscored += 1; return; }
        const num = Number(v);
        if (!Number.isFinite(num)) { unscored += 1; return; }
        sum += num; n += 1; scored += 1;
        if (num === 0) { catZero += 1; zero += 1; }
      });
      const max = n * MAX_SCORE;
      return {
        cat: g.cat, items: g.items.length, weight: cfg.weights[g.cat],
        n, na: catNa, zero: catZero, sum, max,
        rate: max > 0 ? sum / max : null,   // null = 채점된 항목이 없어 평가 불가
      };
    });

    // 전부 '해당없음'이거나 미평가인 분류는 배점에서 빼고, 남은 분류로 100점을 다시 나눈다.
    // 그렇게 하지 않으면 해당사항이 적은 협력사가 구조적으로 낮은 점수를 받는다.
    const wTotal = cats.filter(c => c.rate !== null).reduce((a, c) => a + c.weight, 0);
    cats.forEach(c => {
      c.points = (c.rate === null || wTotal <= 0) ? 0 : c.rate * c.weight * (100 / wTotal);
      c.fullPoints = (c.rate === null || wTotal <= 0) ? 0 : c.weight * (100 / wTotal);
    });

    const score = Math.round(cats.reduce((a, c) => a + c.points, 0) * 10) / 10;
    const cut = cfg.cutoffs;
    const grade = scored === 0 ? '-' : score >= cut.A ? 'A' : score >= cut.B ? 'B' : score >= cut.C ? 'C' : 'D';

    return {
      total: EVAL_TOTAL, submitted, scored, na, unscored, zero,
      score, grade, cats, wTotal, cutoffs: cut,
      // 구버전 화면·데이터 호환용(적합률 자리에 100점 환산 점수를 넣는다)
      pct: Math.round(score),
    };
  };

  // 저장된 요약이 구버전(적합률만 있음)이면 결과 배열로 다시 계산한다
  const summaryOf = (ev) => (ev && ev.summary && ev.summary.score !== undefined)
    ? ev.summary : summarizeEval(ev?.results);

  const gradeChip = (sm, extra) => {
    if (!sm || sm.grade === '-') return '<span class="eval-grade none">미평가</span>';
    const g = GRADE_META[sm.grade] || {};
    return `<span class="eval-grade ${g.cls || ''}">${sm.grade}<em>${escapeText(g.label || '')}</em></span>`
      + (extra ? `<span class="eval-score-num">${sm.score}점</span>` : '');
  };

  const latestEval = (s) => {
    const list = Array.isArray(s?.evaluations) ? s.evaluations : [];
    return list.length ? list[list.length - 1] : null;
  };

  const openEvalModal = (supplierId) => {
    const s = DB.getSupplierById(supplierId);
    const body = document.getElementById('supplier-eval-body');
    if (!s || !body) return;
    const prev = latestEval(s);                 // 직전 평가값을 기본값으로 불러옴
    const prevMap = {};
    (prev?.results || []).forEach(r => { prevMap[r.key] = r; });
    // 직전 평가의 첨부파일을 이어받음(수정 시 유지)
    pendingEvalFiles = {};
    (prev?.results || []).forEach(r => { if (r.file) pendingEvalFiles[r.key] = r.file; });
    const today = new Date().toISOString().slice(0, 10);
    const history = (s.evaluations || []).slice().reverse();

    const cfg = evalConfig();
    const rows = EVAL_CHECKLIST.map((g, ci) => `
      <div class="eval-group">
        <div class="eval-group-title">
          ${ci + 1}. ${escapeText(g.cat)}
          <span class="eval-group-weight">배점 ${cfg.weights[g.cat]}점 · ${g.items.length}항목</span>
          <span class="eval-group-score" id="eval-cat-${ci}"></span>
        </div>
        ${g.items.map((it, ii) => {
          const k = evalKey(ci, ii);
          const pr = migrateResult(prevMap[k]) || {};
          const sv = pr.score === undefined || pr.score === null ? '' : String(pr.score);
          return `
          <div class="eval-row" data-key="${k}">
            <label class="eval-check" title="자료 제출 확인">
              <input type="checkbox" class="eval-cb" ${pr.checked ? 'checked' : ''}>
            </label>
            <div class="eval-info">
              <div class="eval-doc">${escapeText(it.doc)}</div>
              <div class="eval-sub"><span class="eval-purpose">${escapeText(it.purpose)}</span> · ${escapeText(it.check)}</div>
            </div>
            <select class="form-input form-input-sm eval-score" title="${SCORE_SCALE.map(x => `${x.v} ${x.label} — ${x.desc}`).join('&#10;')}">
              <option value="">미평가</option>
              ${SCORE_SCALE.map(x => `<option value="${x.v}" ${sv === String(x.v) ? 'selected' : ''}>${x.v} ${x.label}</option>`).join('')}
              <option value="${NA_VALUE}" ${sv === NA_VALUE ? 'selected' : ''}>해당없음</option>
            </select>
            <input type="text" class="form-input form-input-sm eval-note" placeholder="비고" value="${escapeText(pr.note || '')}">
            ${evalAttachCell(k)}
          </div>`;
        }).join('')}
      </div>`).join('');

    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div class="info-box info-blue">
          <strong>${escapeText(s.name)}</strong> (${escapeText(s.code)}) · 품질검증 제출자료 체크리스트 (총 ${EVAL_TOTAL}개 항목)
          <br>항목별 <b>5점 척도</b>로 채점하고 분류 배점을 반영해 100점으로 환산합니다.
          해당사항이 없는 항목은 <b>해당없음</b>을 선택하면 배점에서 제외됩니다.
          ${prev ? `<br>직전 평가: ${escapeText(prev.date)} · ${summaryOf(prev).score}점 (${summaryOf(prev).grade}등급)${(prev.results || []).some(r => r.verdict && r.score === undefined) ? ' — 구버전 합부판정을 점수로 환산해 불러왔습니다(적합=4점). 재확인 후 저장하십시오.' : ' (값을 불러왔습니다)'}` : ''}
        </div>
        <div class="eval-scalebar">
          ${SCORE_SCALE.map(x => `<span><b>${x.v}</b> ${escapeText(x.label)} <em>${escapeText(x.desc)}</em></span>`).join('')}
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">평가일</label>
            <input type="date" class="form-input" id="eval-date" value="${prev?.date || today}">
          </div>
          <div class="form-group">
            <label class="form-label">평가자</label>
            <input type="text" class="form-input" id="eval-evaluator" value="${escapeText(prev?.evaluator || '')}" placeholder="담당자명">
          </div>
        </div>
        <div class="eval-summary-bar" id="eval-summary"></div>
        <div class="eval-list">${rows}</div>
        <div class="form-group">
          <label class="form-label">종합 의견</label>
          <textarea class="form-textarea" id="eval-memo" placeholder="종합 평가 의견 · 개선 요청사항">${escapeText(prev?.memo || '')}</textarea>
        </div>
        ${history.length ? `
        <div>
          <div class="font-bold text-sm mb-8">평가 이력 (${history.length}건)</div>
          <div class="eval-history">
            ${history.map(ev => { const sm = summaryOf(ev); return `
              <div class="eval-history-item">
                <div>
                  <div class="font-bold text-sm">${escapeText(ev.date)} · ${gradeChip(sm, true)}</div>
                  <div class="text-xs text-muted">평가자 ${escapeText(ev.evaluator || '-')} · 채점 ${sm.scored} / 부적합 ${sm.zero} / 해당없음 ${sm.na}</div>
                </div>
                <button class="btn btn-danger btn-xs" onclick="SupplierPage.deleteEvaluation('${s.id}','${ev.id}')">삭제</button>
              </div>`; }).join('')}
          </div>
        </div>` : ''}
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="SupplierPage.closeModal('supplier-eval-modal')">닫기</button>
          <button class="btn btn-primary" onclick="SupplierPage.submitEvaluation('${s.id}')">평가 저장</button>
        </div>
      </div>`;

    document.getElementById('supplier-eval-modal').classList.add('open');
    refreshEvalSummary();
    // 입력 변화 시 요약 실시간 갱신
    body.querySelectorAll('.eval-cb, .eval-score').forEach(el => el.addEventListener('change', refreshEvalSummary));
  };

  // 항목별 첨부파일 업로드/교체/삭제/보기
  const onEvalFile = (key, file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { App.toast('파일은 2MB 이하만 첨부할 수 있습니다', 'warning'); return; }
    const replacing = !!pendingEvalFiles[key];   // 이미 있으면 교체
    const reader = new FileReader();
    reader.onload = () => {
      pendingEvalFiles[key] = { name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream', dataUrl: reader.result };
      refreshEvalAttach(key);
      App.toast(replacing ? '첨부파일을 교체했습니다' : '제출서류 첨부 완료', 'success');
    };
    reader.onerror = () => App.toast('파일을 읽지 못했습니다', 'error');
    reader.readAsDataURL(file);
  };
  // 실수로 지우는 일을 막기 위해 파일명을 보여주고 확인받는다.
  const removeEvalFile = (key) => {
    const f = pendingEvalFiles[key];
    if (!f) return;
    if (!confirm(`첨부파일 "${f.name}" 을(를) 삭제할까요?`)) return;
    delete pendingEvalFiles[key];
    refreshEvalAttach(key);
    App.toast('첨부파일을 삭제했습니다', 'info');
  };
  const refreshEvalAttach = (key) => {
    const el = document.getElementById(`eval-attach-${key}`);
    if (el) el.outerHTML = evalAttachCell(key);
  };
  const viewEvalFile = (key) => {
    const f = pendingEvalFiles[key];
    if (f) viewDoc({ dataUrl: f.dataUrl, name: f.name, mimeType: f.mimeType, type: 'OTHER' });
  };

  // 현재 모달의 입력값을 읽어 결과 배열로 수집
  const collectEvalResults = () => {
    const results = [];
    document.querySelectorAll('#supplier-eval-body .eval-row').forEach(row => {
      const key = row.getAttribute('data-key');
      const checked = row.querySelector('.eval-cb')?.checked || false;
      const raw = row.querySelector('.eval-score')?.value ?? '';
      const note = row.querySelector('.eval-note')?.value.trim() || '';
      const file = pendingEvalFiles[key] || null;
      if (raw === '' && !checked && !note && !file) return;
      const score = raw === '' ? undefined : (raw === NA_VALUE ? NA_VALUE : Number(raw));
      results.push({ key, checked, ...(score === undefined ? {} : { score }), note, ...(file ? { file } : {}) });
    });
    return results;
  };

  const refreshEvalSummary = () => {
    const el = document.getElementById('eval-summary');
    if (!el) return;
    const sm = summarizeEval(collectEvalResults());
    el.innerHTML = `
      ${gradeChip(sm)}
      <span class="eval-chip pct">종합 <b>${sm.score}</b> / 100점</span>
      <span class="eval-chip">채점 <b>${sm.scored}</b>/${sm.total - sm.na}</span>
      <span class="eval-chip">자료제출 <b>${sm.submitted}</b>/${sm.total}</span>
      <span class="eval-chip na">해당없음 <b>${sm.na}</b></span>
      <span class="eval-chip ${sm.zero ? 'bad' : ''}">부적합(0점) <b>${sm.zero}</b></span>
      ${sm.unscored ? `<span class="eval-chip warn">미평가 <b>${sm.unscored}</b></span>` : ''}`;
    // 분류별 득점 — 어느 영역이 약한지 바로 보이게 그룹 제목 옆에 붙인다
    sm.cats.forEach((c, ci) => {
      const t = document.getElementById('eval-cat-' + ci);
      if (!t) return;
      t.textContent = c.rate === null ? '' : `${c.points.toFixed(1)} / ${c.fullPoints.toFixed(1)}점`;
      t.className = 'eval-group-score' + (c.rate === null ? '' : c.rate >= 0.8 ? ' ok' : c.rate >= 0.6 ? ' warn' : ' bad');
    });
  };

  const submitEvaluation = (supplierId) => {
    const s = DB.getSupplierById(supplierId);
    if (!s) return;
    const results = collectEvalResults();
    const summary = summarizeEval(results);
    const record = {
      id: `EVAL-${Date.now().toString(36).toUpperCase()}`,
      date: document.getElementById('eval-date')?.value || new Date().toISOString().slice(0, 10),
      evaluator: document.getElementById('eval-evaluator')?.value.trim() || '',
      memo: document.getElementById('eval-memo')?.value.trim() || '',
      results,
      summary,
    };
    const evaluations = (Array.isArray(s.evaluations) ? s.evaluations.slice() : []).concat([record]);
    try {
      DB.updateSupplier(supplierId, { evaluations });
      App.toast(`품질평가 저장 완료 · ${summary.score}점 (${summary.grade}등급)`, 'success');
      pendingEvalFiles = {};
      closeModal('supplier-eval-modal');
      App.refreshPage();
    } catch (e) {
      App.toast('평가 저장 실패: ' + e.message, 'error');
    }
  };

  // ── 배점 설정 (분류 가중치 · 등급 컷오프) ──
  //   업종마다 무엇을 중히 볼지가 달라서 코드에 고정하지 않는다.
  const openEvalConfig = () => {
    const cfg = evalConfig();
    const body = document.getElementById('supplier-eval-body');
    if (!body) return;
    const wSum = EVAL_CHECKLIST.reduce((a, g) => a + cfg.weights[g.cat], 0);
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div class="info-box info-blue">
          분류별 배점과 등급 기준을 조정합니다. 배점 합계가 100이 아니어도 되며,
          채점된 분류의 배점만으로 100점 환산합니다(해당없음 분류는 자동 제외).
          <br>칸을 비우면 기본값으로 돌아갑니다.
        </div>

        <div>
          <div class="font-bold text-sm mb-8">분류 배점 <span class="text-muted" style="font-weight:400">(현재 합계 <b id="cfg-wsum">${wSum}</b>)</span></div>
          <div class="cfg-list">
            ${EVAL_CHECKLIST.map((g, ci) => `
              <div class="cfg-row">
                <label>${ci + 1}. ${escapeText(g.cat)} <em>${g.items.length}항목</em></label>
                <input type="number" class="form-input form-input-sm cfg-weight" data-cat="${escapeText(g.cat)}"
                       min="0" max="100" step="1" value="${cfg.weights[g.cat]}" placeholder="${g.weight}"
                       oninput="SupplierPage.refreshCfgSum()">
                <span class="cfg-default">기본 ${g.weight}</span>
              </div>`).join('')}
          </div>
        </div>

        <div>
          <div class="font-bold text-sm mb-8">등급 기준 (100점 환산 기준 이상)</div>
          <div class="cfg-list">
            ${['A', 'B', 'C'].map(k => `
              <div class="cfg-row">
                <label>${k} 등급 <em>${escapeText(GRADE_META[k].label)} — ${escapeText(GRADE_META[k].note)}</em></label>
                <input type="number" class="form-input form-input-sm" id="cfg-cut-${k}" min="0" max="100" step="1"
                       value="${cfg.cutoffs[k]}" placeholder="${DEFAULT_CUTOFFS[k]}">
                <span class="cfg-default">점 이상</span>
              </div>`).join('')}
            <div class="cfg-row">
              <label>D 등급 <em>${escapeText(GRADE_META.D.label)} — ${escapeText(GRADE_META.D.note)}</em></label>
              <span class="text-sm text-muted" style="grid-column:2/4">C 등급 기준 미만</span>
            </div>
          </div>
        </div>

        ${cfg.updatedAt ? `<div class="text-xs text-muted">최종 수정 ${escapeText(String(cfg.updatedAt).slice(0, 10))}${cfg.updatedBy ? ` · ${escapeText(cfg.updatedBy)}` : ''}</div>` : ''}

        <div class="modal-footer">
          <button class="btn btn-danger" onclick="SupplierPage.resetEvalConfigUI()">기본값 복원</button>
          <button class="btn btn-ghost" onclick="SupplierPage.closeModal('supplier-eval-modal')">닫기</button>
          <button class="btn btn-primary" onclick="SupplierPage.submitEvalConfig()">저장</button>
        </div>
      </div>`;
    document.getElementById('supplier-eval-modal').classList.add('open');
  };

  const refreshCfgSum = () => {
    const el = document.getElementById('cfg-wsum');
    if (!el) return;
    let sum = 0;
    document.querySelectorAll('.cfg-weight').forEach(i => { sum += Number(i.value) || 0; });
    el.textContent = sum;
  };

  const submitEvalConfig = () => {
    const weights = {};
    document.querySelectorAll('.cfg-weight').forEach(i => {
      const v = i.value.trim();
      if (v !== '') weights[i.dataset.cat] = Number(v);
    });
    const cutoffs = {};
    ['A', 'B', 'C'].forEach(k => {
      const v = document.getElementById('cfg-cut-' + k)?.value.trim();
      if (v !== '' && v !== undefined) cutoffs[k] = Number(v);
    });
    // 컷오프가 뒤집히면 등급이 영원히 안 나오는 조합이 생긴다
    const c = { ...DEFAULT_CUTOFFS, ...cutoffs };
    if (!(c.A > c.B && c.B > c.C)) {
      App.toast('등급 기준은 A > B > C 순으로 높아야 합니다', 'warning');
      return;
    }
    saveEvalConfig(weights, cutoffs, (typeof Auth !== 'undefined' && Auth.currentName()) || '');
    App.toast('배점 기준을 저장했습니다 — 기존 평가 점수도 새 배점으로 다시 계산됩니다', 'success');
    closeModal('supplier-eval-modal');
    App.refreshPage();
  };

  const resetEvalConfigUI = () => {
    if (!confirm('배점과 등급 기준을 기본값으로 되돌립니다.\n계속할까요?')) return;
    resetEvalConfig();
    App.toast('기본값으로 복원했습니다', 'success');
    closeModal('supplier-eval-modal');
    App.refreshPage();
  };

  const deleteEvaluation = (supplierId, evalId) => {
    const s = DB.getSupplierById(supplierId);
    if (!s) return;
    const evaluations = (s.evaluations || []).filter(ev => ev.id !== evalId);
    DB.updateSupplier(supplierId, { evaluations });
    App.toast('평가 이력을 삭제했습니다', 'warning');
    openEvalModal(supplierId);
  };

  // ── 협력사 전체 정보·이력 통합 보기 ──────────────────────
  const infoRow = (label, value) => `
    <div class="detail-field">
      <div class="detail-field-label">${escapeText(label)}</div>
      <div class="detail-field-value">${value || '<span class="text-muted">-</span>'}</div>
    </div>`;

  const showFullDetail = (supplierId) => {
    const s = DB.getSupplierById(supplierId);
    const body = document.getElementById('supplier-detail-body');
    if (!s || !body) return;
    const receivings = DB.getReceivings().filter(r => r.supplierName === s.name || r.supplierId === s.id);
    const totalQty = receivings.reduce((a, r) => a + (r.actualWeight || r.expectedWeight || 0), 0);
    const qcFails = receivings.filter(r => r.status === 'REJECTED').length;
    const docs = docsOf(s);
    const missing = missingRequiredDocs(s);
    const materials = s.materials || [];
    const evals = (s.evaluations || []).slice().reverse();
    const recent = receivings.slice()
      .sort((a, b) => new Date(b.receivedDate || b.createdAt || 0) - new Date(a.receivedDate || a.createdAt || 0))
      .slice(0, 8);

    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:16px">
        <div class="detail-hero">
          <div>
            <div class="detail-hero-name">${escapeText(s.name)}</div>
            <div class="text-xs text-muted td-mono">${escapeText(s.code)}${QR_ON ? ' · ' + escapeText(s.qrCode || DB.makeQRValue('SUPPLIER', s.code)) : ''}</div>
          </div>
          <span class="badge ${s.haccpGrade==='A'?'badge-pass':s.haccpGrade==='B'?'badge-info':s.haccpGrade?'badge-warning':'badge-default'}">${escapeText(s.haccpGrade || s.status || '활성')}</span>
        </div>

        <div>
          <div class="detail-section-title">기본 정보</div>
          <div class="detail-grid">
            ${infoRow('사업자등록번호', s.businessNo ? `<span class="td-mono">${escapeText(s.businessNo)}</span>` : '')}
            ${infoRow('연락처', escapeText(s.contact))}
            ${infoRow('이메일', escapeText(s.email))}
            ${infoRow('업종', escapeText(s.industry))}
            ${infoRow('국내/수입', escapeText(s.domesticImport))}
            ${infoRow('거래품목', escapeText(s.mainItem))}
          </div>
        </div>

        <div>
          <div class="detail-section-title">납품 품목 (${materials.length})</div>
          ${materials.length ? `<div class="supplier-material-chips">${materials.map(code => {
            const it = resolveItemByCode(code);
            return `<span class="supplier-material-chip"><span class="chip-name">${kindBadge(it.kind)} ${escapeText(it.name)}</span><span class="chip-code">${escapeText(code)}</span></span>`;
          }).join('')}</div>` : '<div class="text-sm text-muted">연동된 품목이 없습니다</div>'}
        </div>

        <div>
          <div class="detail-section-title">등록 서류 (${docs.length})${missing.length ? ` · <span class="text-warning">미첨부 ${missing.length}</span>` : ''}</div>
          ${renderDocumentList(docs, false)}
        </div>

        <div>
          <div class="detail-section-title">납품 이력</div>
          <div class="supplier-stats">
            <div class="stat-box"><div class="stat-label">총 납품</div><div class="stat-value">${receivings.length}건</div></div>
            <div class="stat-box"><div class="stat-label">납품중량</div><div class="stat-value">${(totalQty/1000).toFixed(1)}t</div></div>
            <div class="stat-box ${qcFails>0?'stat-danger':''}"><div class="stat-label">품질불합격</div><div class="stat-value">${qcFails}건</div></div>
          </div>
          ${recent.length ? `
          <table class="data-table compact mt-8">
            <thead><tr><th>입고일</th><th>원료</th><th>중량</th><th>상태</th></tr></thead>
            <tbody>${recent.map(r => `<tr>
              <td>${escapeText(formatDateShort(r.receivedDate || r.createdAt))}</td>
              <td>${escapeText(r.materialName || r.materialCode || '-')}</td>
              <td class="mono">${(((r.actualWeight||r.expectedWeight||0))/1000).toFixed(2)}t</td>
              <td>${escapeText(r.status || '-')}</td>
            </tr>`).join('')}</tbody>
          </table>` : '<div class="text-sm text-muted mt-8">납품 이력이 없습니다</div>'}
        </div>

        <div>
          <div class="detail-section-title">품질평가 이력 (${evals.length})</div>
          ${evals.length ? `<div class="eval-history">${evals.map(ev => {
            const sm = summaryOf(ev);
            const files = (ev.results || []).filter(r => r.file).length;
            return `<div class="eval-history-item">
              <div style="flex:1;min-width:0">
                <div class="font-bold text-sm">${escapeText(ev.date)} · ${gradeChip(sm, true)}</div>
                <div class="text-xs text-muted">평가자 ${escapeText(ev.evaluator || '-')} · 채점 ${sm.scored} / 부적합 ${sm.zero} / 해당없음 ${sm.na}${files ? ` · 첨부 ${files}` : ''}</div>
                <div class="eval-catbars">${sm.cats.filter(c => c.rate !== null).map(c => `
                  <div class="eval-catbar" title="${escapeText(c.cat)} — ${c.points.toFixed(1)}/${c.fullPoints.toFixed(1)}점">
                    <label>${escapeText(c.cat)}</label>
                    <div><i class="${c.rate >= 0.8 ? 'ok' : c.rate >= 0.6 ? 'warn' : 'bad'}" style="width:${Math.round(c.rate * 100)}%"></i></div>
                    <span>${Math.round(c.rate * 100)}%</span>
                  </div>`).join('')}</div>
                ${ev.memo ? `<div class="text-xs text-muted mt-4">${escapeText(ev.memo)}</div>` : ''}
              </div>
            </div>`;
          }).join('')}</div>` : '<div class="text-sm text-muted">품질평가 이력이 없습니다</div>'}
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="SupplierPage.closeModal('supplier-detail-modal')">닫기</button>
          <button class="btn btn-outline-primary" onclick="SupplierPage.printFullDetail('${s.id}')">출력</button>
          <button class="btn btn-outline-primary" onclick="SupplierPage.closeModal('supplier-detail-modal');SupplierPage.openEvalModal('${s.id}')">품질평가</button>
          <button class="btn btn-primary" onclick="SupplierPage.closeModal('supplier-detail-modal');SupplierPage.editSupplier('${s.id}')">정보 수정</button>
        </div>
      </div>`;

    document.getElementById('supplier-detail-modal').classList.add('open');
  };

  // 협력사 전체 정보 인쇄용 문서 생성 → 새 창에서 인쇄/PDF 저장
  const printFullDetail = (supplierId) => {
    const s = DB.getSupplierById(supplierId);
    if (!s) return;
    const receivings = DB.getReceivings().filter(r => r.supplierName === s.name || r.supplierId === s.id);
    const totalQty = receivings.reduce((a, r) => a + (r.actualWeight || r.expectedWeight || 0), 0);
    const qcFails = receivings.filter(r => r.status === 'REJECTED').length;
    const docs = docsOf(s);
    const materials = s.materials || [];
    const prev = latestEval(s);
    const evals = (s.evaluations || []).slice().reverse();
    const printedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const recent = receivings.slice()
      .sort((a, b) => new Date(b.receivedDate || b.createdAt || 0) - new Date(a.receivedDate || a.createdAt || 0))
      .slice(0, 12);

    const infoTable = `
      <table class="kv">
        <tr><th>협력사명</th><td>${escapeText(s.name)}</td><th>협력사코드</th><td>${escapeText(s.code)}</td></tr>
        <tr><th>사업자등록번호</th><td>${escapeText(s.businessNo || '-')}</td><th>업종</th><td>${escapeText(s.industry || '-')}</td></tr>
        <tr><th>연락처</th><td>${escapeText(s.contact || '-')}</td><th>이메일</th><td>${escapeText(s.email || '-')}</td></tr>
        <tr><th>국내/수입</th><td>${escapeText(s.domesticImport || '-')}</td><th>거래품목</th><td>${escapeText(s.mainItem || '-')}</td></tr>
        ${QR_ON ? `<tr><th>QR 코드</th><td colspan="3">${escapeText(s.qrCode || DB.makeQRValue('SUPPLIER', s.code))}</td></tr>` : ''}
      </table>`;

    const matHtml = materials.length
      ? `<ul class="inline">${materials.map(c => { const it = resolveItemByCode(c); return `<li>${it.label ? '[' + it.label + '] ' : ''}${escapeText(it.name)} <span class="mono">${escapeText(c)}</span></li>`; }).join('')}</ul>`
      : '<p class="muted">연동된 품목이 없습니다</p>';

    const docHtml = docs.length
      ? documentTypes.map(dt => {
          const g = docs.filter(d => d.type === dt.type);
          if (!g.length) return '';
          return `<div class="docgrp"><b>${escapeText(dt.label)}</b><ul>${g.map(d => `<li>${escapeText(d.name || '-')}</li>`).join('')}</ul></div>`;
        }).join('')
      : '<p class="muted">첨부된 서류가 없습니다</p>';

    const recvHtml = `
      <p>총 납품 <b>${receivings.length}</b>건 · 납품중량 <b>${(totalQty/1000).toFixed(1)}</b>t · 품질불합격 <b>${qcFails}</b>건</p>
      ${recent.length ? `<table class="grid"><thead><tr><th>입고일</th><th>원료</th><th>중량(t)</th><th>상태</th></tr></thead><tbody>
        ${recent.map(r => `<tr><td>${escapeText(formatDateShort(r.receivedDate || r.createdAt))}</td><td>${escapeText(r.materialName || r.materialCode || '-')}</td><td class="r mono">${(((r.actualWeight||r.expectedWeight||0))/1000).toFixed(2)}</td><td>${escapeText(r.status || '-')}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">납품 이력이 없습니다</p>'}`;

    let evalHtml = '<p class="muted">품질평가 이력이 없습니다</p>';
    if (prev) {
      const rmap = {}; (prev.results || []).forEach(r => { rmap[r.key] = migrateResult(r); });
      const sm = summaryOf(prev);
      const gm = GRADE_META[sm.grade] || {};
      const rows = EVAL_CHECKLIST.map((g, ci) => {
        const c = sm.cats[ci];
        const items = g.items.map((it, ii) => {
          const r = rmap[evalKey(ci, ii)] || {};
          const sv = r.score;
          return `<tr>
            <td>${escapeText(it.doc)}</td>
            <td class="c">${r.checked ? 'O' : ''}</td>
            <td class="c mono">${sv === NA_VALUE ? '-' : (sv === undefined || sv === null || sv === '' ? '' : sv)}</td>
            <td class="c">${escapeText(scoreLabel(sv))}</td>
            <td>${escapeText(r.note || '')}</td>
            <td>${r.file ? escapeText(r.file.name) : ''}</td>
          </tr>`;
        }).join('');
        const catHead = c && c.rate !== null
          ? `${ci + 1}. ${escapeText(g.cat)} <span style="font-weight:400">— ${c.points.toFixed(1)} / ${c.fullPoints.toFixed(1)}점 (${Math.round(c.rate * 100)}%)</span>`
          : `${ci + 1}. ${escapeText(g.cat)} <span style="font-weight:400">— 평가 제외</span>`;
        return `<tr class="cat"><td colspan="6">${catHead}</td></tr>${items}`;
      }).join('');
      evalHtml = `
        <p>최근 평가일 <b>${escapeText(prev.date)}</b> · 평가자 ${escapeText(prev.evaluator || '-')}</p>
        <p class="scorebox">종합 <b>${sm.score}</b> / 100점 · 등급 <b>${sm.grade}</b> (${escapeText(gm.label || '')})
           ${gm.note ? `· ${escapeText(gm.note)}` : ''}<br>
           <span class="muted">채점 ${sm.scored}항목 · 부적합(0점) ${sm.zero} · 해당없음 ${sm.na} · 미평가 ${sm.unscored}
           · 등급기준 A ${sm.cutoffs.A} / B ${sm.cutoffs.B} / C ${sm.cutoffs.C}점</span></p>
        ${prev.memo ? `<p class="memo">종합의견: ${escapeText(prev.memo)}</p>` : ''}
        <table class="grid"><thead><tr><th>제출자료</th><th>제출</th><th>점수</th><th>평가</th><th>비고</th><th>첨부</th></tr></thead><tbody>${rows}</tbody></table>
        ${evals.length > 1 ? `<p class="muted" style="margin-top:8px">전체 평가 ${evals.length}회 · ${evals.map(e => { const x = summaryOf(e); return `${escapeText(e.date)}(${x.score}점 ${x.grade})`; }).join(', ')}</p>` : ''}`;
    }

    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
      <title>협력사 전체정보 - ${escapeText(s.name)}</title>
      <style>
        *{box-sizing:border-box} body{font-family:'Malgun Gothic','Noto Sans KR',sans-serif;color:#171A20;margin:0;padding:28px;font-size:12px;line-height:1.5}
        h1{font-size:20px;margin:0 0 2px} h2{font-size:14px;margin:20px 0 8px;padding-bottom:4px;border-bottom:2px solid #3E6AE1}
        .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #171A20;padding-bottom:8px}
        .muted{color:#888} .mono{font-family:consolas,monospace} .c{text-align:center} .r{text-align:right}
        table{width:100%;border-collapse:collapse;margin:4px 0}
        table.kv th{background:#f4f4f4;text-align:left;width:130px;font-weight:600} table.kv th,table.kv td{border:1px solid #ddd;padding:5px 8px}
        table.grid th{background:#3E6AE1;color:#fff;font-weight:600} table.grid th,table.grid td{border:1px solid #ddd;padding:4px 7px}
        table.grid tr.cat td{background:#eef2fb;font-weight:600}
        ul.inline{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px} ul.inline li{border:1px solid #ddd;border-radius:4px;padding:2px 8px}
        .docgrp{margin-bottom:6px} .docgrp ul{margin:2px 0 0 16px}
        .memo{background:#f4f4f4;padding:6px 10px;border-radius:4px}
        .scorebox{background:#eef2fb;border-left:3px solid #3E6AE1;padding:8px 12px;border-radius:4px}
        .scorebox b{font-size:15px}
        .toolbar{margin-bottom:16px} .btn{background:#3E6AE1;color:#fff;border:0;border-radius:4px;padding:8px 18px;font-size:13px;cursor:pointer}
        @media print{.no-print{display:none} body{padding:0}}
      </style></head><body>
      <div class="toolbar no-print"><button class="btn" onclick="window.print()">인쇄 / PDF 저장</button></div>
      <div class="head"><div><h1>협력사 전체정보</h1><div class="muted">${escapeText(s.name)} (${escapeText(s.code)})</div></div>
        <div class="muted">출력일 ${printedAt}<br>${QR_ON ? '우성사료 QR 이력관리' : '우성 품질관리 플랫폼'}</div></div>
      <h2>기본 정보</h2>${infoTable}
      <h2>납품 품목 (${materials.length})</h2>${matHtml}
      <h2>등록 서류 (${docs.length})</h2>${docHtml}
      <h2>납품 이력</h2>${recvHtml}
      <h2>품질검증 평가</h2>${evalHtml}
      <script>window.onload=function(){setTimeout(function(){window.print()},400)}</script>
      </body></html>`;

    const win = window.open('', '_blank');
    if (!win) { App.toast('팝업 차단을 해제한 뒤 다시 시도해주세요', 'warning'); return; }
    win.document.write(html);
    win.document.close();
  };

  const closeModal = (id) => document.getElementById(id)?.classList.remove('open');

  // ── 검색: 목록 영역만 갱신해 입력 포커스 유지(전체 재렌더 안 함) ──
  const onSearch = (value) => {
    searchQuery = value;
    const suppliers = DB.getSuppliers();
    const receivings = DB.getReceivings();
    const listEl = document.getElementById('supplier-list');
    if (listEl) listEl.innerHTML = listHtml(suppliers, receivings);
    const countEl = document.getElementById('supplier-count');
    if (countEl) {
      const fc = filterSuppliers(suppliers, searchQuery).length;
      countEl.innerHTML = (searchQuery ? `검색 <b>${fc}</b> / 총 ${suppliers.length}개` : `총 ${suppliers.length}개 협력사`) + ' · 신규 코드는 자동 발급';
    }
    const clearBtn = document.getElementById('supplier-search-clear');
    if (clearBtn) clearBtn.style.display = searchQuery ? '' : 'none';
  };
  const clearSearch = () => {
    const inp = document.getElementById('supplier-search');
    if (inp) inp.value = '';
    onSearch('');
    inp?.focus();
  };

  return {
    // 자체 점검표(self_check.js)가 같은 항목·점수 기준·배점·등급 계산을 쓴다 — 한 곳만 고치면 둘 다 바뀐다
    evalKit: {
      checklist: EVAL_CHECKLIST, total: EVAL_TOTAL, key: evalKey,
      scale: SCORE_SCALE, NA: NA_VALUE, scoreLabel, grades: GRADE_META,
      summarize: summarizeEval, config: evalConfig,
    },
    render,
    afterRender: () => {},
    onSearch,
    clearSearch,
    openAddModal,
    editSupplier,
    submitSupplier,
    onMaterialSearch,
    closeMaterialDropdown,
    addMaterial,
    removeMaterial,
    onDocumentFile,
    viewPendingDocument,
    removePendingDocument,
    showDocuments,
    openDocumentById,
    openStoredDocument,
    showHistory,
    showQR,
    showFullDetail,
    printFullDetail,
    openEvalModal,
    submitEvaluation,
    deleteEvaluation,
    openEvalConfig,
    refreshCfgSum,
    submitEvalConfig,
    resetEvalConfigUI,
    onEvalFile,
    removeEvalFile,
    viewEvalFile,
    closeModal
  };
})();
