// ============================================================
// voc.js — VOC 역추적 페이지 (PPT 원료 추적 연결키 재현)
// ============================================================

const VOCPage = (() => {
  let prefillFgLot  = '';
  let prefillProduct = '';
  let prefillProductCode = '';
  const pendingPhotos = [];  // 등록 폼에 첨부 대기중인 사진(메타). 재대입 금지 — clearBucket 사용
  let listFilter    = 'ALL';   // ALL | COMPLAINT | OPEN | OVERDUE | NOPREV
  let handleTarget  = null;    // 처리내역 등록 대상 VOC id
  let searchQ       = '';
  const PAGE = 40;
  let listLimit     = PAGE;    // 과거 대장 임포트로 건수가 많아 화면에는 나눠 그린다

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const actorName = () => { try { return (typeof Auth !== 'undefined' && Auth.currentName) ? (Auth.currentName() || '품질팀') : '품질팀'; } catch (_) { return '품질팀'; } };
  const statusText = { OPEN: '접수', INVESTIGATING: '조사중', ACTION: '조치중', CLOSED: '종결' };
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const overdueTag = (v) => {
    const d = DB.vocOverdue(v);
    return d > 0 ? ` · <span style="color:var(--danger)">답변기한 ${d}일 초과</span>` : (v.dueDate && v.status !== 'CLOSED' ? ` · 답변기한 ${v.dueDate}` : '');
  };

  // ── 사진 첨부 ──
  //   원본은 서버(data/files) 또는 IndexedDB, 레코드에는 썸네일+메타만. PhotoStore 참조.
  const MAX_PHOTOS = 8;
  const KIND_LABEL = { INTAKE: '접수', ACTION: '조치' };

  // 첨부 대기중인 사진: 등록폼(INTAKE) / 처리내역폼(ACTION) 을 따로 담는다.
  //   ※ 두 배열은 절대 재대입하지 않는다(`= []` 금지, `length = 0` 만 사용).
  //     업로드 루프가 배열 참조를 붙잡고 도는데 중간에 재대입하면 완료된 사진이
  //     버려진 배열로 들어가 조용히 사라진다.
  const pendingAction = [];
  const clearBucket = (b) => { b.length = 0; };

  // 업로드가 도는 동안 저장/종결을 막는다(진행 중 저장 시 사진 유실 방지)
  let uploading = 0;
  const setBusy = (on) => {
    uploading += on ? 1 : -1;
    if (uploading < 0) uploading = 0;
    document.querySelectorAll('[data-upload-lock]').forEach(el => { el.disabled = uploading > 0; });
  };

  const pickInto = async (input, bucket, kind, previewId, cap) => {
    const files = [...(input.files || [])];
    input.value = '';                       // 같은 파일 재선택 허용
    if (!files.length) return;
    setBusy(true);
    App.toast(`사진 ${files.length}장을 저장하는 중입니다`, 'info');
    try {
      for (const f of files) {
        if (!String(f.type || '').startsWith('image/')) continue;
        if (bucket.length >= cap) { App.toast(`사진은 최대 ${cap}장까지 첨부할 수 있습니다`, 'warning'); break; }
        try {
          const meta = await PhotoStore.save(f, { kind, by: actorName() });
          if (meta) bucket.push(meta);
        } catch (e) { App.toast(e.message || '사진 저장에 실패했습니다', 'error'); }
        renderPreview(bucket, previewId, kind);   // 한 장씩 즉시 반영
      }
    } finally { setBusy(false); }
  };
  const onPhotosSelected = (input) => pickInto(input, pendingPhotos, 'INTAKE', 'voc-photo-preview', MAX_PHOTOS);
  const onActionPhotos  = (input) => pickInto(input, pendingAction, 'ACTION', 'vh-photo-preview', MAX_PHOTOS);

  const removePhoto = async (idx) => { const p = pendingPhotos[idx]; pendingPhotos.splice(idx, 1); renderPreview(pendingPhotos, 'voc-photo-preview', 'INTAKE'); await PhotoStore.remove(p); };
  const removeActionPhoto = async (idx) => { const p = pendingAction[idx]; pendingAction.splice(idx, 1); renderPreview(pendingAction, 'vh-photo-preview', 'ACTION'); await PhotoStore.remove(p); };

  const renderPreview = (bucket, elId, kind) => {
    const el = document.getElementById(elId);
    if (!el) return;
    const rm = kind === 'ACTION' ? 'removeActionPhoto' : 'removePhoto';
    el.innerHTML = bucket.length ? bucket.map((p, i) => `
      <div class="voc-thumb">
        <img src="${PhotoStore.thumbOf(p)}" alt="${esc(p.name || '')}">
        <button type="button" class="voc-thumb-x" onclick="VOCPage.${rm}(${i})" title="삭제">✕</button>
      </div>`).join('') : '<span class="text-muted" style="font-size:12px">첨부된 사진 없음</span>';
  };
  const renderPhotoPreview = () => renderPreview(pendingPhotos, 'voc-photo-preview', 'INTAKE');

  // ── 사진 뷰어 — PhotoStore 공용 라이트박스 사용(심사 지적사항과 동일 동작) ──
  const viewPhoto = (vocId, idx) => {
    const voc = DB.getVOCById(vocId);
    if (voc) PhotoStore.openViewer(voc.photos, idx, KIND_LABEL);
  };

  // 등록 이후에도 사진을 더 붙일 수 있어야 한다(현장에서 나중에 찍어오는 경우)
  const addPhotosTo = async (vocId, input, kind) => {
    const files = [...(input.files || [])];
    input.value = '';
    if (!files.length) return;
    if (!DB.getVOCById(vocId)) return;
    setBusy(true);
    App.toast(`사진 ${files.length}장을 저장하는 중입니다`, 'info');
    const added = [];
    try {
      for (const f of files) {
        if (!String(f.type || '').startsWith('image/')) continue;
        // 상한은 업로드 직전에 매번 최신 레코드로 다시 센다(대기 중 다른 곳에서 바뀔 수 있음)
        const cur = PhotoStore.normalize((DB.getVOCById(vocId) || {}).photos).length;
        if (cur + added.length >= MAX_PHOTOS) { App.toast(`사진은 최대 ${MAX_PHOTOS}장까지 첨부할 수 있습니다`, 'warning'); break; }
        try {
          const meta = await PhotoStore.save(f, { kind: kind || 'ACTION', by: actorName() });
          if (meta) added.push(meta);
        } catch (e) { App.toast(e.message || '사진 저장에 실패했습니다', 'error'); }
      }
    } finally { setBusy(false); }
    if (!added.length) { refreshDetail(vocId); return; }
    // 스냅샷이 아니라 "지금" 레코드에 이어 붙인다 — 업로드 중 발생한 삭제/추가를 덮어쓰지 않도록
    const latest = PhotoStore.normalize((DB.getVOCById(vocId) || {}).photos);
    DB.updateVOC(vocId, { photos: latest.concat(added) });
    DB.addVOCLog(vocId, { kind: '사진첨부', content: `${KIND_LABEL[kind || 'ACTION']} 사진 ${added.length}장 추가`, by: actorName() });
    App.toast('사진이 첨부되었습니다', 'success');
    refreshDetail(vocId);
  };
  const deletePhotoFrom = async (vocId, photoId) => {
    if (!confirm('이 사진을 삭제할까요?')) return;
    const voc = DB.getVOCById(vocId);
    if (!voc) return;
    const list = PhotoStore.normalize(voc.photos);
    const gone = list.find(p => p.id === photoId);
    DB.updateVOC(vocId, { photos: list.filter(p => p.id !== photoId) });
    DB.addVOCLog(vocId, { kind: '사진삭제', content: gone ? (gone.name || photoId) : photoId, by: actorName() });
    App.toast('사진이 삭제되었습니다', 'success');
    refreshDetail(vocId);
    await PhotoStore.remove(gone);
  };
  // 상세 모달을 열어둔 채 목록도 갱신한다.
  //   App.refreshPage() 는 page-content 를 통째로 다시 그려 모달 셸까지 날리므로,
  //   먼저 목록을 다시 그린 뒤 모달을 다시 연다(순서가 반대면 모달이 사라진다).
  const refreshDetail = (vocId) => {
    App.refreshPage();
    setTimeout(() => { try { openDetail(vocId); } catch (_) {} }, 0);
  };

  const statusBadge = (s) => {
    if (s==='OPEN')          return `<span class="badge badge-alert">접수</span>`;
    if (s==='INVESTIGATING') return `<span class="badge badge-warning">조사중</span>`;
    if (s==='ACTION')        return `<span class="badge badge-info">조치중</span>`;
    if (s==='CLOSED')        return `<span class="badge badge-pass">종결</span>`;
    return `<span class="badge badge-default">${s}</span>`;
  };

  // 처리 진행도 — 조사 → 조치 → 근본원인 → 재발방지 4단계가 채워졌는지
  const STEPS = [
    { key: 'investigation', label: '조사' },
    { key: 'action',        label: '조치' },
    { key: 'rootCause',     label: '원인' },
    { key: 'prevention',    label: '재발방지' },
  ];
  const stepChips = (v) => STEPS.map(s => {
    const done = !!String(v[s.key] || '').trim();
    return `<span class="voc-step ${done ? 'voc-step-on' : ''}">${s.label}</span>`;
  }).join('');
  const stepDone = (v) => STEPS.filter(s => String(v[s.key] || '').trim()).length;

  const severityBadge = (s) => {
    if (s==='HIGH')   return `<span class="badge badge-fail">긴급</span>`;
    if (s==='MEDIUM') return `<span class="badge badge-warning">중간</span>`;
    return `<span class="badge badge-default">낮음</span>`;
  };

  const noPrev = (v) => v.status === 'CLOSED' && String(v.action||'').trim() && !String(v.prevention||'').trim();

  // 제조일자는 LOT 추적의 출발점이라, 없으면 없다고 드러내야 소급 입력이 이뤄진다.
  //   칭찬·정보공유 건은 추적 대상이 아니므로 미기재를 지적하지 않는다.
  const mfgBadge = (v) => {
    const d = DB.vocMfgDate(v);
    if (d) return `<span class="badge badge-info">제조일자: ${esc(d)}</span>`;
    // 종결된 과거 건까지 경고를 띄우면 정작 진행 중인 건의 누락이 묻힌다
    return DB.vocFeedback(v) === 'COMPLAINT' && v.status !== 'CLOSED' ? '<span class="badge badge-warning">제조일자 미기재</span>' : '';
  };
  // 사료(양축) 대장은 제품명 컬럼이 없다 — 축종·분류를 제목으로 세운다
  const cardTitle = (v) => v.productName || v.brand
    || [v.species, v.speciesDetail].filter(Boolean).join(' · ') || '제품명 미입력';

  // 품질회의 안건으로 올리기 — 제목·본문에 따옴표가 섞일 수 있어 onclick 에는 id 만 넘기고 여기서 조립한다.
  //   대기함에만 담고 화면은 건드리지 않는다(App.refreshPage 를 부르면 열려 있는 모달이 닫힌다).
  const toAgenda = (vocId) => {
    const v = DB.getVOCById(vocId);
    if (!v || typeof MeetingPage === 'undefined') return;
    MeetingPage.quickAgenda({
      sourceType: 'VOC',
      sourceId: v.id,
      sourceLabel: `${v.vocNo || v.id}${v.customer ? ' · ' + v.customer : ''}`,
      title: `[VOC] ${cardTitle(v)} — ${String(v.complaint || '').replace(/\s+/g, ' ').slice(0, 40)}`,
      content: String(v.complaint || ''),
      category: '고객 클레임',
      factory: v.factory || App.getFactory(),
      priority: v.severity === 'HIGH' ? '긴급' : v.severity === 'MEDIUM' ? '보통' : '낮음',
    });
  };

  const render = () => {
    const f = App.getFactory();
    // 공장이 지정된 건만 해당 공장에 잡힌다(과거 대장 임포트본은 공장 미지정 → 전체에서만 보임)
    const all = DB.getVOCs().filter(v => f === 'ALL' || (v.factory || '') === f);
    let vocs = all.slice().sort((a,b) => String(b.receivedAt||b.registeredAt||'').localeCompare(String(a.receivedAt||a.registeredAt||'')));
    if (listFilter === 'OPEN')    vocs = vocs.filter(v => v.status !== 'CLOSED');
    if (listFilter === 'OVERDUE') vocs = vocs.filter(v => DB.vocOverdue(v) > 0);
    if (listFilter === 'NOPREV')  vocs = vocs.filter(noPrev);
    if (listFilter === 'COMPLAINT') vocs = vocs.filter(v => DB.vocFeedback(v) === 'COMPLAINT');
    if (listFilter === 'NOTYPE')  vocs = vocs.filter(v => String(v.rootCause||'').trim() && !String(v.rootType||'').trim());
    if (searchQ) {
      const q = searchQ.toLowerCase();
      vocs = vocs.filter(v => [v.productName, v.customer, v.complaint, v.region, v.category, v.brand, v.actor, v.fgLotNo, DB.vocMfgDate(v)]
        .some(x => String(x||'').toLowerCase().includes(q)));
    }
    const nOpen = all.filter(v => v.status !== 'CLOSED').length;
    const nOver = all.filter(v => DB.vocOverdue(v) > 0).length;
    const nNoPrev = all.filter(noPrev).length;
    const nComp = all.filter(v => DB.vocFeedback(v) === 'COMPLAINT').length;
    const nNoType = all.filter(v => String(v.rootCause||'').trim() && !String(v.rootType||'').trim()).length;
    const tabs = [['ALL',`전체 ${all.length}`],['COMPLAINT',`불만 ${nComp}`],['OPEN',`미종결 ${nOpen}`],['OVERDUE',`기한초과 ${nOver}`],['NOPREV',`대책 미기재 ${nNoPrev}`],['NOTYPE',`원인 미분류 ${nNoType}`]]
      .map(([k,l])=>`<button class="factory-tab ${listFilter===k?'active':''}" onclick="VOCPage.setFilter('${k}')">${l}</button>`).join('');

    const total = vocs.length;
    const shown = vocs.slice(0, listLimit);

    return `
      <div class="fade-in">
        ${nOver > 0 ? `<div class="card alert-banner alert-danger"><b>답변기한 초과 ${nOver}건</b> — 고객 답변이 지연되고 있습니다.</div>` : ''}
        ${nNoPrev > 0 ? `<div class="card alert-banner alert-warn"><b>재발방지대책 미기재 종결 ${nNoPrev}건</b> — 조치는 했으나 대책이 비어 있는 건입니다. 소급 입력하면 대시보드 이력에 반영됩니다.</div>` : ''}
        <div class="flex items-center justify-between mb-12">
          <div class="factory-tabs">${tabs}</div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" onclick="App.navigate('vocDashboard')">대시보드</button>
            <button class="btn btn-primary btn-sm" onclick="VOCPage.openAddModal()">＋ VOC 등록</button>
          </div>
        </div>
        <div class="flex items-center justify-between mb-16">
          <input class="form-input form-input-sm" style="max-width:320px" placeholder="제품·거래처·내용·지구 검색"
            value="${esc(searchQ)}" oninput="VOCPage.setSearch(this.value)">
          <div class="text-muted" style="font-size:12px">${total}건 중 ${shown.length}건 표시</div>
        </div>

        ${shown.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon"></div>
            <h3>${searchQ || listFilter !== 'ALL' ? '조건에 맞는 VOC가 없습니다' : '등록된 VOC가 없습니다'}</h3>
            <p>고객 클레임 발생 시 VOC를 등록하고 원료를 역추적하세요</p>
          </div>
        ` : `
        <div style="display:flex;flex-direction:column;gap:12px">
          ${shown.map(v => `
            <div class="card voc-card">
              <div class="flex items-start justify-between gap-12">
                <div style="flex:1">
                  <div class="flex items-center gap-8 mb-4">
                    ${statusBadge(v.status)}
                    ${severityBadge(v.severity)}
                    <span class="td-mono text-xs text-muted">${v.vocNo}</span>
                  </div>
                  <div class="font-bold mb-2">${esc(cardTitle(v))}</div>
                  <div class="text-sm text-muted mb-4">고객: ${esc(v.customer||'-')} · 유형: ${esc(v.category)}${v.region?' · '+esc(v.region):''} · 접수: ${formatDate(v.receivedAt||v.registeredAt)}${overdueTag(v)}</div>
                  <div class="text-sm voc-body">${esc(v.complaint)}</div>
                  ${DB.vocFeedback(v)==='COMPLAINT'
                    ? `<div class="voc-steps mt-8">${stepChips(v)}
                        <span class="text-xs text-muted" style="margin-left:6px">처리 ${stepDone(v)}/4</span></div>`
                    : `<div class="mt-8"><span class="badge badge-pass">${DB.vocFeedback(v)==='PRAISE'?'칭찬·만족':'정보공유'}</span>
                        <span class="text-xs text-muted" style="margin-left:6px">처리 대상 아님</span></div>`}
                  ${v.prevention?`<div class="voc-prevent mt-8"><b>재발방지</b> ${esc(v.prevention)}</div>`:''}
                  ${(v.photos&&v.photos.length)?`<div class="mt-8" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                    ${PhotoStore.normalize(v.photos).slice(0,6).map((p,i)=>`<img src="${PhotoStore.thumbOf(p)}" onclick="VOCPage.viewPhoto('${v.id}',${i})" title="${esc(p.name||'')} (${KIND_LABEL[p.kind]||'접수'})" class="voc-card-thumb${p.kind==='ACTION'?' voc-card-thumb-act':''}">`).join('')}
                    ${v.photos.length>6?`<span class="text-xs text-muted">외 ${v.photos.length-6}장</span>`:''}
                  </div>`:''}
                  ${(v.fgLotNo || mfgBadge(v))?`<div class="mt-4" style="display:flex;gap:6px;flex-wrap:wrap">
                    ${v.fgLotNo?`<span class="badge badge-info">제품LOT: ${esc(v.fgLotNo)}</span>`:''}${mfgBadge(v)}
                  </div>`:''}
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;min-width:120px">
                  <button class="btn btn-primary btn-sm" onclick="VOCPage.openHandle('${v.id}')">처리내역</button>
                  <button class="btn btn-outline-primary btn-sm" onclick="VOCPage.openDetail('${v.id}')">이력</button>
                  <button class="btn btn-ghost btn-sm" onclick="VOCPage.traceVOC('${v.id}')">역추적</button>
                  <button class="btn btn-ghost btn-sm" onclick="VOCPage.aiReport('${v.id}')" style="color:var(--ai-accent-light)">원인분석</button>
                  <button class="btn btn-ghost btn-sm" onclick="VOCPage.toAgenda('${v.id}')">회의 안건</button>
                  ${v.status!=='CLOSED'?`<button class="btn btn-ghost btn-xs" onclick="VOCPage.updateStatus('${v.id}','CLOSED')">종결</button>`
                    :`<button class="btn btn-ghost btn-xs" onclick="VOCPage.updateStatus('${v.id}','ACTION')">재오픈</button>`}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
        ${total > shown.length ? `<div style="text-align:center;margin-top:14px">
          <button class="btn btn-ghost btn-sm" onclick="VOCPage.showMore()">더 보기 (${total - shown.length}건 남음)</button>
        </div>` : ''}`}

        <!-- VOC 등록 모달 -->
        <div class="modal-overlay" id="voc-add-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title">VOC 등록</div>
              <button class="modal-close" onclick="VOCPage.closeModal('voc-add-modal')">✕</button>
            </div>
            <div id="voc-add-body"></div>
          </div>
        </div>

        <!-- 역추적 결과 모달 -->
        <div class="modal-overlay" id="voc-trace-modal">
          <div class="modal modal-xl">
            <div class="modal-header">
              <div class="modal-title">원료 추적 연결키 — 역추적 결과</div>
              <button class="modal-close" onclick="VOCPage.closeModal('voc-trace-modal')">✕</button>
            </div>
            <div id="voc-trace-body"></div>
          </div>
        </div>

        <!-- 처리내역 등록 모달 -->
        <div class="modal-overlay" id="voc-handle-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title">처리내역 등록</div>
              <button class="modal-close" onclick="VOCPage.closeModal('voc-handle-modal')">✕</button>
            </div>
            <div id="voc-handle-body"></div>
          </div>
        </div>

        <!-- 처리 이력 모달 -->
        <div class="modal-overlay" id="voc-detail-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title">VOC 처리 이력</div>
              <button class="modal-close" onclick="VOCPage.closeModal('voc-detail-modal')">✕</button>
            </div>
            <div id="voc-detail-body"></div>
          </div>
        </div>

        <!-- AI 근본원인 분석 모달 -->
        <div class="modal-overlay" id="voc-ai-modal">
          <div class="modal modal-xl">
            <div class="modal-header">
              <div class="modal-title" style="color:var(--ai-accent-light)">AI 근본원인 분석 리포트</div>
              <button class="modal-close" onclick="VOCPage.closeModal('voc-ai-modal')">✕</button>
            </div>
            <div id="voc-ai-body"></div>
          </div>
        </div>
      </div>
    `;
  };

  const afterRender = () => {
    // 다른 화면에서 넘어온 prefill 값이 있으면 모달 자동 오픈(제품LOT/제품코드 어느 쪽이든)
    if (prefillFgLot || prefillProduct || prefillProductCode) { setTimeout(() => { openAddModal(); }, 100); }
  };

  // VOC 페이지가 이미 떠 있으면 즉시 모달을 열고, 아니면 페이지로 이동 후 afterRender가 연다
  const openIfReady = () => {
    if (document.getElementById('voc-add-modal')) { openAddModal(); }
    else { App.navigate('voc'); }
  };

  const prefill = (fgLot, product, productCode = '') => {
    prefillFgLot   = fgLot;
    prefillProduct = product;
    prefillProductCode = productCode;
    openIfReady();
  };

  const prefillProductCodeFn = (productCode, product) => {
    prefillFgLot = '';
    prefillProduct = product || '';
    prefillProductCode = productCode || '';
    openIfReady();
  };

  const openAddModal = () => {
    const body = document.getElementById('voc-add-body');
    if (!body) return;
    const products = DB.getProductLots();
    const productMaster = DB.getProducts();
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div class="form-grid form-grid-3">
          <div class="form-group">
            <label class="form-label">제품코드 QR/마스터</label>
            <input type="text" class="form-input" id="voc-product-code" list="product-code-list" value="${prefillProductCode}" placeholder="제품코드 또는 QR키" onchange="VOCPage.findLotByMfg()">
            <datalist id="product-code-list">${productMaster.slice(0,300).map(p=>`<option value="${p.code}">${p.code} - ${p.name}`).join('')}</datalist>
          </div>
          <div class="form-group">
            <label class="form-label">제조일자</label>
            <input type="date" class="form-input" id="voc-mfg" onchange="VOCPage.findLotByMfg()">
            <div class="form-hint">포대 날인 기준 — LOT 없이도 추적됩니다</div>
          </div>
          <div class="form-group">
            <label class="form-label">제품 LOT</label>
            <input type="text" class="form-input" id="voc-fglot" list="fg-lot-list" value="${prefillFgLot}" placeholder="제품 LOT 입력">
            <datalist id="fg-lot-list">${products.map(p=>`<option value="${p.fgLotNo}">${p.fgLotNo} - ${p.productName}`).join('')}</datalist>
            <div class="form-hint" id="voc-lot-hint"></div>
          </div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">제품명</label>
            <input type="text" class="form-input" id="voc-product" value="${prefillProduct}" placeholder="예) 육계 선진L">
          </div>
          <div class="form-group">
            <label class="form-label">고객/거래처</label>
            <input type="text" class="form-input" id="voc-customer" placeholder="예) 삼성농장">
          </div>
          <div class="form-group">
            <label class="form-label">클레임 유형</label>
            <select class="form-input" id="voc-category">
              ${DB.VOC_CATEGORIES.map(c => `<option>${c}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-grid form-grid-3">
          <div class="form-group">
            <label class="form-label">접수일</label>
            <input type="date" class="form-input" id="voc-received" value="${todayStr()}" onchange="VOCPage.syncDue()">
          </div>
          <div class="form-group">
            <label class="form-label">답변기한</label>
            <input type="date" class="form-input" id="voc-due" value="${DB.addBusinessDays(todayStr(), DB.VOC_ANSWER_DAYS)}">
            <div class="form-hint">접수일로부터 ${DB.VOC_ANSWER_DAYS}영업일 (주말 제외)</div>
          </div>
          <div class="form-group">
            <label class="form-label">접수경로</label>
            <select class="form-input" id="voc-channel">${DB.VOC_CHANNELS.map(c => `<option>${c}</option>`).join('')}</select>
          </div>
        </div>
        <div class="form-grid form-grid-3">
          <div class="form-group">
            <label class="form-label">담당 공장</label>
            <select class="form-input" id="voc-factory">
              ${DB.getFactories().map(x => `<option value="${x.id}" ${App.getFactory() === x.id ? 'selected' : ''}>${x.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">소속지구</label>
            <input type="text" class="form-input" id="voc-region" list="voc-region-list" placeholder="예) 천안지구">
            <datalist id="voc-region-list">${[...new Set(DB.getVOCs().map(v => v.region).filter(Boolean))].map(r => `<option value="${esc(r)}">`).join('')}</datalist>
          </div>
          <div class="form-group">
            <label class="form-label">축종</label>
            <select class="form-input" id="voc-species">
              <option value="">선택</option>
              ${['양돈','비육','낙농','산란','육계','양어','반려','기타'].map(x => `<option>${x}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">클레임 내용 *</label>
          <textarea class="form-input" id="voc-complaint" rows="3" placeholder="고객 불만 내용을 상세히 입력해주세요"></textarea>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">긴급도</label>
            <select class="form-input" id="voc-severity">
              <option value="HIGH">긴급</option>
              <option value="MEDIUM" selected>중간</option>
              <option value="LOW">낮음</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">접수 담당자</label>
            <input type="text" class="form-input" id="voc-actor" value="${esc(actorName())}" readonly style="background:rgba(128,128,128,.08)">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">사진 첨부 <span class="text-muted" style="font-weight:400;font-size:12px">(불량 부위·이물·포장 등, 최대 ${MAX_PHOTOS}장)</span></label>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;display:inline-block;margin:0">
            사진 선택 / 촬영
            <input type="file" accept="image/*" multiple capture="environment" style="display:none" onchange="VOCPage.onPhotosSelected(this)">
          </label>
          <div id="voc-photo-preview" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="VOCPage.closeModal('voc-add-modal')">취소</button>
          <button class="btn btn-primary" data-upload-lock onclick="VOCPage.submitVOC()">VOC 등록</button>
        </div>
      </div>
    `;
    prefillFgLot = '';
    prefillProduct = '';
    prefillProductCode = '';
    clearBucket(pendingPhotos);
    renderPhotoPreview();
    document.getElementById('voc-add-modal').classList.add('open');
  };

  const submitVOC = () => {
    const fgLotNo   = document.getElementById('voc-fglot')?.value.trim();
    let productCode = document.getElementById('voc-product-code')?.value.trim();
    let product   = document.getElementById('voc-product')?.value.trim();
    const customer  = document.getElementById('voc-customer')?.value.trim();
    const category  = document.getElementById('voc-category')?.value;
    const complaint = document.getElementById('voc-complaint')?.value.trim();
    const severity  = document.getElementById('voc-severity')?.value;
    const actor     = document.getElementById('voc-actor')?.value || actorName();
    const rcv       = document.getElementById('voc-received')?.value || todayStr();
    const extra = {
      receivedAt: rcv + 'T00:00:00',
      dueDate:  document.getElementById('voc-due')?.value || DB.addBusinessDays(rcv, DB.VOC_ANSWER_DAYS),
      channel:  document.getElementById('voc-channel')?.value || '전화',
      factory:  document.getElementById('voc-factory')?.value || 'HQ',
      region:   document.getElementById('voc-region')?.value.trim() || '',
      species:  document.getElementById('voc-species')?.value || '',
      mfgDate:  document.getElementById('voc-mfg')?.value || '',
    };
    if (!complaint) { App.toast('클레임 내용을 입력해주세요', 'error'); return; }
    if (productCode) {
      const resolvedProduct = DB.resolveQRCode(productCode);
      if (resolvedProduct.type === 'PRODUCT' && resolvedProduct.item) {
        productCode = resolvedProduct.item.code;
        if (!product) product = resolvedProduct.item.name;
      }
    }
    const created = DB.addVOC({ fgLotNo, productCode, productName: product, customer, category, complaint, severity, actor, photos: pendingPhotos.slice(), ...extra });
    if (created) DB.addVOCLog(created.id, { kind: '접수', content: complaint, by: actor });
    clearBucket(pendingPhotos);
    closeModal('voc-add-modal');
    App.toast('VOC 등록 완료', 'success');
    App.updateBadges();
    App.refreshPage();
  };

  // ── 핵심: VOC 역추적 ──
  const traceVOC = (vocId) => {
    const voc  = DB.getVOCById(vocId);
    if (!voc) return;

    const mfgDate = DB.vocMfgDate(voc);
    let result = null;
    if (voc.fgLotNo || voc.productCode) {
      result = DB.traceVOC(voc.fgLotNo, voc.productCode, mfgDate);
    }
    // LOT 이 안 잡히면 제조일자로 그날 생산분을 후보로 띄운다 — 여기서 고르면 체인이 이어진다
    //   VOC 의 담당 공장은 접수 부서(본사 등)를 가리키므로 생산 공장과 다를 수 있다.
    //   공장으로 거르면 진짜 후보가 사라지므로, 거르지 말고 후보에 생산 공장을 함께 보여준다.
    const cands = (!result && mfgDate) ? DB.findProductLotsByMfgDate(mfgDate, voc.productCode) : [];

    // 추적 결과가 없으면 샘플 체인 표시
    const body = document.getElementById('voc-trace-body');
    if (!body) return;

    // 추적 체인 생성 (PPT 이미지 기준)
    const productLot   = result?.productLot || null;
    const productMaster = result?.productMaster || (voc.productCode ? DB.getProductByCode(voc.productCode) : null);
    const batch        = result?.batch        || null;
    const receivings   = result?.receivings   || [];
    const suppliers    = result?.suppliers    || [];

    body.innerHTML = `
      <div style="padding:16px">
        <div class="info-box info-warning mb-16">
          <strong>VOC: ${esc(voc.vocNo)}</strong> — ${esc(voc.complaint)}
          ${voc.productCode ? `<div class="text-sm mt-4">제품코드: <span class="td-mono">${esc(voc.productCode)}</span> / ${esc(productMaster?.name || voc.productName || '-')}</div>` : ''}
          <div class="text-sm mt-4">
            제조일자: ${mfgDate
              ? `<span class="td-mono">${mfgDate}</span>${voc.mfgDate ? '' : ' <span class="text-xs text-muted">(제품LOT 에서 확인)</span>'}`
              : `<span class="text-muted">미기재 — 포대 날인 제조일자를 넣으면 LOT 을 특정할 수 있습니다</span>`}
          </div>
          ${mfgDate ? '' : `<div class="mt-8" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <input type="date" class="form-input form-input-sm" id="voc-trace-mfg" style="max-width:170px">
            <button class="btn btn-outline-primary btn-sm" onclick="VOCPage.setMfgFromTrace('${vocId}')">제조일자 저장 후 추적</button>
          </div>`}
        </div>

        ${cands.length ? `
        <div class="card mb-16">
          <div class="card-header"><div class="card-title">제조일자 ${mfgDate} 생산 LOT 후보 ${cands.length}건</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;padding:12px">
            ${cands.slice(0,12).map(c=>`
              <button class="btn btn-ghost btn-sm" onclick="VOCPage.linkLot('${vocId}','${esc(c.fgLotNo)}')">
                <span class="td-mono">${esc(c.fgLotNo)}</span> · ${esc(c.productName || '')}
                ${c.factory?`· ${esc(DB.getFactories().find(f=>f.id===c.factory)?.name || c.factory)}`:''}${c.packType?` · ${esc(c.packType)}`:''}
              </button>`).join('')}
          </div>
          <div class="text-xs text-muted" style="padding:0 12px 12px">클레임 현품과 맞는 LOT 을 고르면 원료까지 체인이 이어집니다.</div>
        </div>` : (!result && mfgDate ? `
        <div class="info-box info-warning mb-16 text-sm">${mfgDate} 생산 제품 LOT 이 시스템에 없습니다 — 제품 LOT 등록 여부를 확인하거나, 현품의 LOT 을 처리내역에 직접 입력하세요.</div>` : '')}

        <!-- 원료 추적 연결키 체인 (PPT 이미지6 재현) -->
        <div class="trace-chain mb-20">
          <div class="trace-chain-title">원료 추적 연결키 — 입고부터 배합까지</div>
          <div class="trace-chain-subtitle">클레임이나 재고 차이 발생 시 역추적 기준이 되는 데이터입니다</div>

          <div class="trace-steps">
            <!-- Step 1: 사전입고 QR -->
            <div class="trace-step">
              <div class="trace-step-icon"></div>
              <div class="trace-step-content">
                <div class="trace-step-label">사전입고 QR</div>
                <div class="trace-step-desc">협력사 사전 등록</div>
                <div class="trace-step-value ${receivings.length>0?'':'trace-empty'}">
                  ${receivings.length>0 ? receivings.map(r=>`<div class="trace-link">${esc(r.preRegId||r.id)}</div>`).join('') : '<span class="text-muted text-xs">추적 정보 없음</span>'}
                </div>
              </div>
            </div>
            <div class="trace-arrow">→</div>

            <!-- Step 2: 원료 입고 LOT -->
            <div class="trace-step">
              <div class="trace-step-icon"></div>
              <div class="trace-step-content">
                <div class="trace-step-label">원료 입고 LOT</div>
                <div class="trace-step-desc">우성 계근 확정</div>
                <div class="trace-step-value ${receivings.length>0?'':'trace-empty'}">
                  ${receivings.length>0 ? receivings.map(r=>`<div class="trace-link">${esc(r.lotNo||String(r.id).slice(0,12))}</div>`).join('') : '<span class="text-muted text-xs">추적 정보 없음</span>'}
                </div>
              </div>
            </div>
            <div class="trace-arrow">→</div>

            <!-- Step 3: 사일로 LOT 잔량 -->
            <div class="trace-step">
              <div class="trace-step-icon"></div>
              <div class="trace-step-content">
                <div class="trace-step-label">사일로 LOT 잔량</div>
                <div class="trace-step-desc">사일로 배정 후 FIFO 순서</div>
                <div class="trace-step-value ${result?.siloIds?.length>0?'':'trace-empty'}">
                  ${result?.siloIds?.length>0 ? result.siloIds.map(id=>{
                    const silo = DB.getSiloById(id);
                    const sum  = silo ? DB.getSiloCapacitySummary(silo) : null;
                    return `<div class="trace-link">${id} / FIFO</div>`;
                  }).join('') : '<span class="text-muted text-xs">추적 정보 없음</span>'}
                </div>
              </div>
            </div>
            <div class="trace-arrow">→</div>

            <!-- Step 4: 투입지시 -->
            <div class="trace-step">
              <div class="trace-step-icon"></div>
              <div class="trace-step-content">
                <div class="trace-step-label">투입지시</div>
                <div class="trace-step-desc">생산팀 작업 지시</div>
                <div class="trace-step-value ${result?.prodOrders?.length>0?'':'trace-empty'}">
                  ${result?.prodOrders?.length>0 ? result.prodOrders.map(o=>`<div class="trace-link">${o.id}</div>`).join('') : '<span class="text-muted text-xs">추적 정보 없음</span>'}
                </div>
              </div>
            </div>
            <div class="trace-arrow">→</div>

            <!-- Step 5: 배합 배치 -->
            <div class="trace-step">
              <div class="trace-step-icon"></div>
              <div class="trace-step-content">
                <div class="trace-step-label">배합 배치</div>
                <div class="trace-step-desc">실제 원료 투입 기록</div>
                <div class="trace-step-value ${batch?'':'trace-empty'}">
                  ${batch ? `<div class="trace-link">${esc(batch.batchCode)}</div>` : '<span class="text-muted text-xs">추적 정보 없음</span>'}
                </div>
              </div>
            </div>
            <div class="trace-arrow">→</div>

            <!-- Step 6: 제품 LOT -->
            <div class="trace-step">
              <div class="trace-step-icon"></div>
              <div class="trace-step-content">
                <div class="trace-step-label">제품 LOT</div>
                <div class="trace-step-desc">완제품 추적 연결</div>
                <div class="trace-step-value ${productLot?'':'trace-empty'}">
                  ${productLot ? `<div class="trace-link">${esc(productLot.fgLotNo)}</div>` : `<div class="trace-link text-muted">${esc(voc.fgLotNo || productMaster?.qrCode || '미입력')}</div>`}
                  ${(productLot?.productionDate || mfgDate) ? `<div class="text-xs text-muted" style="margin-top:3px">제조 ${String(productLot?.productionDate || mfgDate).slice(0,10)}</div>` : ''}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 협력사 정보 -->
        ${suppliers.length>0 ? `
        <div class="card mb-16">
          <div class="card-header"><div class="card-title">관련 협력사</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;padding:12px">
            ${suppliers.filter(Boolean).map(s=>`
              <div class="supplier-chip">
                <strong>${esc(s.name)}</strong>
                <span class="text-xs text-muted">${esc(s.code)}</span>
              </div>`).join('')}
          </div>
        </div>` : ''}

        <!-- 추적 테이블 -->
        <div class="card">
          <div class="card-header"><div class="card-title">단계별 연결 데이터</div></div>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>단계</th><th>연결 데이터</th><th>저장 기준</th><th>추적 목적</th></tr></thead>
              <tbody>
                <tr><td>입고</td><td>QR, 협력사, 원료코드, 계근값</td><td>사전입고번호 + 원료 LOT</td><td>어떤 원료가 언제 들어왔는지 확인</td></tr>
                <tr><td>보관</td><td>사일로, FIFO 순서, LOT별 잔량</td><td>silo_lot_balances</td><td>사일로 안 LOT 구성 추정</td></tr>
                <tr><td>투입지시</td><td>생산 LOT, 배합코드, 지시량</td><td>production_orders</td><td>어느 배합에 어떤 사일로를 썼는지 확인</td></tr>
                <tr><td>배합</td><td>실투입량, FIFO 차감 LOT, 작업자</td><td>mixing_batches + material_consumptions</td><td>완제품 LOT에서 원료 LOT까지 역추적</td></tr>
                <tr><td>포장·제품</td><td>제품 LOT, 제조일자, 유통기한</td><td>product_lots</td><td>포대에 찍힌 제조일자로 LOT을 특정</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="modal-footer mt-16">
          <button class="btn btn-ghost" onclick="VOCPage.closeModal('voc-trace-modal')">닫기</button>
          ${voc.status === 'OPEN' ? `<button class="btn btn-primary" onclick="VOCPage.updateStatus('${vocId}','INVESTIGATING');VOCPage.closeModal('voc-trace-modal')">조사 시작</button>` : ''}
        </div>
      </div>
    `;

    // VOC 추적 결과 저장
    DB.updateVOC(vocId, { traceResult: result ? '추적 완료' : '추적 정보 부족', status: voc.status === 'OPEN' ? 'INVESTIGATING' : voc.status });
    document.getElementById('voc-trace-modal').classList.add('open');
  };

  // 제조일자를 넣으면 그날 생산된 제품 LOT 후보를 찾아준다.
  //   포대에 LOT 이 아니라 제조일자만 찍히는 제품이 많아, 현장 클레임은 대부분 이 경로로 들어온다.
  const findLotByMfg = () => {
    const d    = document.getElementById('voc-mfg')?.value || '';
    let code   = document.getElementById('voc-product-code')?.value.trim() || '';
    const hint = document.getElementById('voc-lot-hint');
    const lotEl = document.getElementById('voc-fglot');
    if (!hint || !lotEl) return;
    // 전에 자동으로 채운 LOT 이 그대로면 비운다 — 날짜·제품을 바꿨는데 이전 LOT 이 남으면
    // LOT 과 제조일자가 서로 다른 날을 가리킨 채 저장된다
    if (lotEl.dataset.auto && lotEl.value === lotEl.dataset.auto) lotEl.value = '';
    delete lotEl.dataset.auto;
    if (!d) { hint.innerHTML = ''; return; }
    // 제품칸에는 QR키가 들어올 수 있다 — 저장할 때와 같은 방식으로 제품코드로 푼다
    if (code) {
      const r = DB.resolveQRCode(code);
      if (r && r.type === 'PRODUCT' && r.item) code = r.item.code;
    }
    const cands = DB.findProductLotsByMfgDate(d, code);
    if (!cands.length) {
      hint.innerHTML = `<span class="text-muted">${esc(d)} 생산 LOT 없음 — 제품코드를 확인하거나 LOT 을 직접 입력하세요</span>`;
      return;
    }
    if (cands.length === 1 && !lotEl.value.trim()) {
      lotEl.value = cands[0].fgLotNo;
      lotEl.dataset.auto = cands[0].fgLotNo;
      hint.innerHTML = `해당일 생산 LOT 1건 자동 입력 — ${esc(cands[0].productName || '')}`;
      return;
    }
    hint.innerHTML = `해당일 생산 LOT ${cands.length}건 — `
      + cands.slice(0, 6).map(c => `<a href="javascript:void(0)" onclick="VOCPage.pickLot('${esc(c.fgLotNo)}')">${esc(c.fgLotNo)}</a>`).join(', ');
  };
  const pickLot = (lot) => { const el = document.getElementById('voc-fglot'); if (el) { el.value = lot; delete el.dataset.auto; } };

  // 역추적 화면에서 곧바로 제조일자를 채운다 — 현장은 포대를 보며 통화하는 경우가 많다
  const setMfgFromTrace = (vocId) => {
    const d = document.getElementById('voc-trace-mfg')?.value || '';
    if (!d) { App.toast('제조일자를 선택해주세요', 'warning'); return; }
    DB.updateVOC(vocId, { mfgDate: d });
    DB.addVOCLog(vocId, { kind: '조사', content: `제조일자 ${d} 확인`, by: actorName() });
    App.toast('제조일자 저장', 'success');
    App.refreshPage();     // 목록 카드의 제조일자 뱃지도 바로 바뀌게 (열린 모달은 닫히므로 다시 연다)
    traceVOC(vocId);
  };
  const linkLot = (vocId, lot) => {
    DB.updateVOC(vocId, { fgLotNo: lot });
    DB.addVOCLog(vocId, { kind: '조사', content: `제품LOT ${lot} 연결`, by: actorName() });
    App.toast('제품 LOT 연결', 'success');
    App.refreshPage();
    traceVOC(vocId);
  };

  // 접수일을 바꾸면 답변기한(3영업일)을 다시 계산해 준다
  const syncDue = () => {
    const r = document.getElementById('voc-received')?.value;
    const d = document.getElementById('voc-due');
    if (r && d) d.value = DB.addBusinessDays(r, DB.VOC_ANSWER_DAYS);
  };

  const setFilter = (k) => { listFilter = k; listLimit = PAGE; App.refreshPage(); };
  const showMore  = () => { listLimit += PAGE; App.refreshPage(); };
  // 검색은 입력 중 재렌더로 포커스가 튀지 않게 디바운스 + 커서 복원
  let searchTimer = null;
  const setSearch = (q) => {
    searchQ = q; listLimit = PAGE;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      App.refreshPage();
      const el = document.querySelector('input[placeholder="제품·거래처·내용·지구 검색"]');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 250);
  };

  // ── 처리내역 등록 (조사 → 조치 → 근본원인 → 재발방지 → 답변) ──
  //   실제 VOC 대장(반려/양어)이 관리하던 항목 그대로.
  const openHandle = (vocId) => {
    const v = DB.getVOCById(vocId);
    const body = document.getElementById('voc-handle-body');
    if (!v || !body) return;
    handleTarget = vocId;
    const opt = (list, cur) => ['<option value="">선택</option>']
      .concat(list.map(x => `<option ${cur === x ? 'selected' : ''}>${esc(x)}</option>`)).join('');
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="info-box info-blue">
          <div class="info-label">${esc(v.productName || '-')} · ${esc(v.customer || '-')}</div>
          <div class="info-value" style="font-size:13px">${esc(v.complaint)}</div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">제조일자</label>
            <input type="date" class="form-input" id="vh-mfg" value="${esc((v.mfgDate || '').slice(0,10))}">
            <div class="form-hint">포대 날인 기준. 채워 넣으면 역추적이 그날 생산 LOT 을 찾습니다.</div>
          </div>
          <div class="form-group">
            <label class="form-label">제품 LOT</label>
            <input type="text" class="form-input" id="vh-lot" value="${esc(v.fgLotNo || '')}" placeholder="현품에서 확인되면 입력">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">불만 및 조사내역</label>
          <textarea class="form-input" id="vh-inv" rows="2" placeholder="현품 확인·시험 결과 등 조사한 내용">${esc(v.investigation || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">조치사항 <span class="req">*</span></label>
          <textarea class="form-input" id="vh-act" rows="2" placeholder="예) 반품 및 동일제품 교환처리, 해당 LOT 공장재고 출고금지">${esc(v.action || '')}</textarea>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">근본원인 분류</label>
            <select class="form-input" id="vh-roottype">${opt(DB.VOC_ROOT_TYPES, v.rootType)}</select>
            <div class="form-hint">대시보드에서 원인별로 집계됩니다</div>
          </div>
          <div class="form-group">
            <label class="form-label">고객 답변일</label>
            <input type="date" class="form-input" id="vh-answer" value="${esc((v.answerDate || '').slice(0,10))}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">근본원인 <span class="req">*</span></label>
          <textarea class="form-input" id="vh-root" rows="2" placeholder="예) 액상노즐 교체시기 경과로 코팅 얼룩 발생">${esc(v.rootCause || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">재발방지대책 <span class="req">*</span></label>
          <textarea class="form-input" id="vh-prev" rows="2" placeholder="예) 액상노즐 점검주기 월 1회 → 주 1회로 강화, 설비점검일지 항목 추가">${esc(v.prevention || '')}</textarea>
          <div class="form-hint">이 대책이 대시보드의 재발방지 이력으로 쌓입니다. 종결하려면 조치·근본원인·재발방지가 모두 필요합니다.</div>
        </div>
        <div class="form-group">
          <label class="form-label">조치 증빙 사진
            <span class="text-muted" style="font-weight:400;font-size:12px">(조치 전·후, 개선 결과 등 · 최대 ${MAX_PHOTOS}장)</span></label>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;display:inline-block;margin:0">
            사진 선택 / 촬영
            <input type="file" accept="image/*" multiple capture="environment" style="display:none" onchange="VOCPage.onActionPhotos(this)">
          </label>
          <div id="vh-photo-preview" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"></div>
          <div class="form-hint">${PhotoStore.serverOn()
            ? '원본은 서버에 저장되어 모든 단말에서 볼 수 있습니다.'
            : '서버 미연결 — 원본은 이 기기에만 저장되고, 다른 단말에는 작은 이미지로만 보입니다.'}</div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">처리 후 고객 만족도</label>
            <select class="form-input" id="vh-sat">${opt(DB.VOC_SATISFACTION, v.satisfaction)}</select>
          </div>
          <div class="form-group">
            <label class="form-label">처리 담당자</label>
            <input type="text" class="form-input" id="vh-by" value="${esc(actorName())}" readonly style="background:rgba(128,128,128,.08)">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="VOCPage.closeModal('voc-handle-modal')">취소</button>
          <button class="btn btn-outline-primary" data-upload-lock onclick="VOCPage.saveHandle(false)">저장</button>
          <button class="btn btn-primary" data-upload-lock onclick="VOCPage.saveHandle(true)">저장 후 종결</button>
        </div>
      </div>`;
    clearBucket(pendingAction);
    renderPreview(pendingAction, 'vh-photo-preview', 'ACTION');
    document.getElementById('voc-handle-modal').classList.add('open');
  };

  const saveHandle = (close) => {
    if (!handleTarget) return;
    const before = DB.getVOCById(handleTarget) || {};
    const patch = {
      mfgDate:       document.getElementById('vh-mfg').value,
      fgLotNo:       document.getElementById('vh-lot').value.trim(),
      investigation: document.getElementById('vh-inv').value.trim(),
      action:        document.getElementById('vh-act').value.trim(),
      rootType:      document.getElementById('vh-roottype').value,
      rootCause:     document.getElementById('vh-root').value.trim(),
      prevention:    document.getElementById('vh-prev').value.trim(),
      answerDate:    document.getElementById('vh-answer').value,
      satisfaction:  document.getElementById('vh-sat').value,
    };
    // 무엇이 바뀌었는지만 이력으로 남긴다
    const LBL = { mfgDate:'제조일자', fgLotNo:'제품LOT', investigation:'조사내역', action:'조치사항', rootType:'근본원인 분류', rootCause:'근본원인', prevention:'재발방지대책', answerDate:'고객 답변일', satisfaction:'만족도' };
    const changed = Object.keys(patch).filter(k => String(patch[k] || '') !== String(before[k] || ''));

    if (uploading > 0) { App.toast('사진 저장이 끝난 뒤에 저장해 주세요', 'warning'); return; }

    // 조치 증빙 사진은 기존 사진 뒤에 붙인다(접수 사진을 덮지 않도록).
    //   레코드 전체 기준으로 상한을 다시 확인한다 — pendingAction 길이만 보면 상한이 우회된다.
    if (pendingAction.length) {
      const base = PhotoStore.normalize(before.photos);
      const room = Math.max(0, MAX_PHOTOS - base.length);
      if (pendingAction.length > room) {
        App.toast(`이 VOC는 사진을 ${MAX_PHOTOS}장까지만 보관합니다 (현재 ${base.length}장 · ${room}장만 저장)`, 'warning');
      }
      patch.photos = base.concat(pendingAction.slice(0, room));
    }

    if (close) {
      const chk = DB.vocCloseCheck({ ...before, ...patch });
      if (!chk.ok) { App.toast(`${chk.missing.join(', ')}을(를) 입력해야 종결할 수 있습니다`, 'warning'); return; }
      patch.status = 'CLOSED';
    } else if (before.status === 'OPEN' && (patch.investigation || patch.action)) {
      patch.status = patch.action ? 'ACTION' : 'INVESTIGATING';
    }

    const nPhotos = (patch.photos ? patch.photos.length - PhotoStore.normalize(before.photos).length : 0);
    DB.updateVOC(handleTarget, patch);
    changed.forEach(k => DB.addVOCLog(handleTarget, { kind: LBL[k] || k, content: patch[k], by: actorName() }));
    if (nPhotos) DB.addVOCLog(handleTarget, { kind: '사진첨부', content: `조치 증빙 사진 ${nPhotos}장`, by: actorName() });
    if (close) DB.addVOCLog(handleTarget, { kind: '종결', content: '처리 완료 종결', by: actorName() });

    closeModal('voc-handle-modal');
    clearBucket(pendingAction);
    handleTarget = null;
    App.toast(close ? 'VOC를 종결했습니다' : '처리내역을 저장했습니다', 'success');
    App.updateBadges();
    App.refreshPage();
  };

  // 상세의 사진 패널 — 접수/조치로 나눠 보여주고, 여기서 추가·삭제도 한다
  const photoPanel = (v) => {
    const all = PhotoStore.normalize(v.photos);
    const grp = (kind) => all.map((p, i) => ({ p, i })).filter(x => (x.p.kind || 'INTAKE') === kind);
    const section = (kind, title) => {
      const items = grp(kind);
      if (!items.length) return '';
      return `<div style="margin-bottom:10px">
        <div class="text-xs text-muted mb-4">${title} (${items.length}장)</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${items.map(({ p, i }) => `<div class="voc-thumb voc-thumb-lg">
            <img src="${PhotoStore.thumbOf(p)}" onclick="VOCPage.viewPhoto('${v.id}',${i})" title="${esc(p.name || '')}">
            ${p.legacy ? '' : `<button type="button" class="voc-thumb-x" onclick="VOCPage.deletePhotoFrom('${v.id}','${esc(p.id)}')" title="삭제">✕</button>`}
          </div>`).join('')}
        </div></div>`;
    };
    const addBtn = (kind, label) => `<label class="btn btn-ghost btn-xs" style="cursor:pointer;margin:0">
        ${label}
        <input type="file" accept="image/*" multiple capture="environment" style="display:none"
          onchange="VOCPage.addPhotosTo('${v.id}',this,'${kind}')">
      </label>`;
    return `
      <div class="card" style="padding:12px;margin-bottom:14px">
        <div class="flex items-center justify-between mb-8">
          <div style="font-weight:600;font-size:13px">사진 (${all.length}장)</div>
          <div style="display:flex;gap:6px">${addBtn('INTAKE', '＋ 접수 사진')}${addBtn('ACTION', '＋ 조치 사진')}</div>
        </div>
        ${all.length ? section('INTAKE', '접수 시 사진') + section('ACTION', '조치 증빙 사진')
          : '<div class="text-muted" style="font-size:12px;padding:6px 0">첨부된 사진이 없습니다. 현장 사진을 붙이면 기록 근거가 남습니다.</div>'}
      </div>`;
  };

  // ── 처리 이력 ──
  const openDetail = (vocId) => {
    const v = DB.getVOCById(vocId);
    const body = document.getElementById('voc-detail-body');
    if (!v) return;
    if (!body) { App.navigate('voc'); setTimeout(() => openDetail(vocId), 80); return; }
    const logs = (v.logs || []).slice().reverse();
    const row = (label, value) => value ? `<tr><th style="width:120px;text-align:left;color:var(--text-muted);font-weight:500;font-size:12px;padding:6px 8px">${label}</th><td style="padding:6px 8px;font-size:13px">${esc(value)}</td></tr>` : '';
    const od = DB.vocOverdue(v);
    body.innerHTML = `
      <div style="padding:16px">
        <div class="flex items-center gap-8 mb-8">
          ${statusBadge(v.status)} ${severityBadge(v.severity)}
          <span class="td-mono text-xs text-muted">${esc(v.vocNo)}</span>
          <span class="text-xs text-muted">경과 ${DB.vocLeadDays(v)}일</span>
          ${od > 0 ? `<span class="badge badge-fail">답변기한 ${od}일 초과</span>` : ''}
        </div>
        <div class="card" style="padding:0;margin-bottom:14px">
          <table style="width:100%;border-collapse:collapse">
            ${row('제품', v.productName)}${row('제품LOT', v.fgLotNo)}${row('제조일자', DB.vocMfgDate(v))}${row('거래처', v.customer)}
            ${row('접수경로', v.channel)}${row('소속지구', v.region)}${row('축종', v.species)}
            ${row('접수일', (v.receivedAt||v.registeredAt||'').slice(0,10))}${row('답변기한', v.dueDate)}${row('고객 답변일', v.answerDate)}
            ${row('불만내용', v.complaint)}
          </table>
        </div>
        <div class="card" style="padding:0;margin-bottom:14px">
          <div style="padding:9px 12px;font-weight:600;font-size:13px;border-bottom:1px solid var(--border)">처리 결과</div>
          <table style="width:100%;border-collapse:collapse">
            ${row('조사내역', v.investigation)}${row('조치사항', v.action)}
            ${row('근본원인 분류', v.rootType)}${row('근본원인', v.rootCause)}
            ${row('재발방지대책', v.prevention)}${row('만족도', v.satisfaction)}
            ${!v.action && !v.rootCause && !v.prevention ? '<tr><td style="padding:14px;text-align:center;color:var(--text-muted);font-size:12px">아직 처리내역이 없습니다</td></tr>' : ''}
          </table>
        </div>
        ${photoPanel(v)}

        <div class="card" style="padding:0">
          <div style="padding:9px 12px;font-weight:600;font-size:13px;border-bottom:1px solid var(--border)">변경 이력 (${logs.length}건)</div>
          ${logs.length ? `<div class="table-wrapper"><table>
            <thead><tr><th style="width:130px">일시</th><th style="width:110px">구분</th><th>내용</th><th style="width:90px">처리자</th></tr></thead>
            <tbody>${logs.map(l => `<tr>
              <td class="text-xs">${String(l.at||'').replace('T',' ').slice(0,16)}</td>
              <td><span class="badge badge-default">${esc(l.kind)}</span></td>
              <td class="text-xs">${esc(l.content)}</td>
              <td class="text-xs">${esc(l.by||'-')}</td>
            </tr>`).join('')}</tbody>
          </table></div>` : '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px">기록된 변경 이력이 없습니다</div>'}
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="VOCPage.closeModal('voc-detail-modal')">닫기</button>
          <button class="btn btn-outline-primary" onclick="VOCPage.toAgenda('${v.id}')">회의 안건 등록</button>
          <button class="btn btn-primary" onclick="VOCPage.closeModal('voc-detail-modal');VOCPage.openHandle('${v.id}')">처리내역 등록</button>
        </div>
      </div>`;
    document.getElementById('voc-detail-modal').classList.add('open');
  };

  const updateStatus = (vocId, status) => {
    if (status === 'CLOSED') {
      const v = DB.getVOCById(vocId);
      const chk = DB.vocCloseCheck(v || {});
      if (!chk.ok) {
        App.toast(`${chk.missing.join(', ')} 입력 후 종결할 수 있습니다`, 'warning');
        openHandle(vocId);
        return;
      }
    }
    DB.updateVOC(vocId, { status });
    DB.addVOCLog(vocId, { kind: '상태변경', content: `${statusText[status] || status}(으)로 변경`, by: actorName() });
    App.toast(`VOC 상태 변경: ${statusText[status] || status}`, 'success');
    App.updateBadges();
    App.refreshPage();
  };

  const closeModal = (id) => document.getElementById(id)?.classList.remove('open');

  // ── AI 근본원인 분석 리포트 ──
  const sevText = { HIGH:'긴급', MEDIUM:'중간', LOW:'낮음' };
  const aiReport = (vocId) => {
    const voc = DB.getVOCById(vocId);
    const body = document.getElementById('voc-ai-body');
    if (!voc || !body) return;
    const r = AIEngine.buildRootCauseReport(voc);
    const hasKey = AIEngine.hasApiKey();
    body.innerHTML = `
      <div style="padding:4px 4px 16px">
        <div class="card" style="padding:14px;margin-bottom:14px">
          <div class="text-xs text-muted">클레임</div>
          <div style="font-weight:700">${voc.complaint || '-'}</div>
          <div class="text-xs text-muted" style="margin-top:4px">유형 ${voc.category||'-'} · 제품 ${voc.productName||voc.productCode||'-'} · LOT ${voc.fgLotNo||'-'} · 긴급도 ${sevText[voc.severity]||voc.severity||'-'}</div>
        </div>

        <div class="card" style="padding:14px;margin-bottom:14px;border-left:4px solid var(--ai-accent)">
          <div class="section-title mb-12">유력 근본원인</div>
          <div><span class="badge badge-warning">${r.topCause.area}</span> ${r.topCause.desc}</div>
          ${r.causes.length>1?`<div style="margin-top:10px" class="text-xs text-muted">그 외 후보</div><ul style="margin:4px 0 0 16px;font-size:13px">${r.causes.slice(1,5).map(c=>`<li><strong>${c.area}</strong> — ${c.desc}</li>`).join('')}</ul>`:''}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" class="ai-two-col">
          <div class="card" style="padding:14px">
            <div class="section-title mb-12">추적 원료</div>
            ${r.materialFindings.length? `<ul style="margin:0 0 0 16px;font-size:13px;line-height:1.8">${r.materialFindings.map(m=>`<li>${m.materialName} <span class="td-mono text-xs">${m.lotNo||''}</span> / 협력사 ${m.supplierName||'미상'} ${m.hasIssue?'<span class="badge badge-fail">분석이상</span>':'<span class="badge badge-pass">정상</span>'}</li>`).join('')}</ul>` : '<div class="text-xs text-muted">추적된 원료 LOT이 없습니다(배합·소비 데이터 필요).</div>'}
          </div>
          <div class="card" style="padding:14px">
            <div class="section-title mb-12">공정 신호</div>
            <div class="text-xs" style="line-height:1.9">
              CCP 한계이탈: <strong>${r.ccpDevs.length}건</strong>${r.ccpDevs.length?` (${r.ccpDevs.map(d=>d.ccpName).join(', ')})`:''}<br>
              미해결 공정이슈: <strong>${r.issues.length}건</strong>${r.issues.length?` (${r.issues.map(i=>i.title).join(', ')})`:''}
            </div>
          </div>
        </div>

        <div class="card" style="padding:14px;margin-top:14px;border-left:4px solid var(--success)">
          <div class="section-title mb-12">권고 조치(CAPA)</div>
          <ol style="margin:0 0 0 16px;font-size:13px;line-height:1.8">${r.actions.map(a=>`<li>${a}</li>`).join('')}</ol>
        </div>

        <div style="margin-top:16px;display:flex;gap:8px;align-items:center">
          <button class="btn btn-primary btn-sm" onclick="VOCPage.aiDeep('${vocId}')" ${hasKey?'':'disabled'}>Claude 심층분석 리포트</button>
          <span class="text-xs text-muted">${hasKey?'AI가 5-Why·CAPA 서술형 보고서를 생성합니다':'심층분석은 AI 어시스턴트에서 Claude API Key 등록 시 사용 가능'}</span>
        </div>
        <div id="voc-ai-deep" style="margin-top:12px"></div>
      </div>`;
    document.getElementById('voc-ai-modal').classList.add('open');
  };

  const aiDeep = async (vocId) => {
    const voc = DB.getVOCById(vocId);
    const out = document.getElementById('voc-ai-deep');
    if (!voc || !out) return;
    out.innerHTML = `<div class="card" style="padding:14px"><div class="text-muted">AI가 리포트를 작성 중입니다…</div></div>`;
    try {
      const prompt = AIEngine.rootCausePrompt(voc);
      let acc = '';
      for await (const chunk of AIEngine.askClaude(prompt, [])) {
        acc += chunk;
        out.innerHTML = `<div class="card" style="padding:14px;white-space:pre-wrap;font-size:13px;line-height:1.7">${acc.replace(/</g,'&lt;')}</div>`;
      }
    } catch (e) {
      out.innerHTML = `<div class="card" style="padding:14px;color:var(--danger)">AI 분석 실패: ${e.message}</div>`;
    }
  };

  return { render, afterRender, prefill, prefillProductCode: prefillProductCodeFn, openAddModal, submitVOC, traceVOC, updateStatus, closeModal, aiReport, aiDeep,
    findLotByMfg, pickLot, setMfgFromTrace, linkLot,
    onPhotosSelected, removePhoto, onActionPhotos, removeActionPhoto, viewPhoto, addPhotosTo, deletePhotoFrom,
    setFilter, setSearch, showMore, syncDue, openHandle, saveHandle, openDetail, toAgenda };
})();
