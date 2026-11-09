// ============================================================
// supplier_inbound.js — 협력사 입고예정 등록 · QR 발행 기능
//   목록 화면은 QR 입고배정 현황(dashboard.js)으로 합쳤다(2026-11-06). 여기에는 등록·QR·도착·보류·반려만 남는다.
// ============================================================

const SupplierInboundPage = (() => {
  let supplierSearchTimeout = null;
  let materialSearchTimeout = null;
  let prefillSupplierId = '';

  const escapeText = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const supplierName = (r) => r.supplierName || r.supplier || '-';
  const isOpenStatus = (status) => ['QR_ISSUED', 'ARRIVED', 'PENDING_SCALE', 'PENDING_QC', 'PENDING_APPROVAL', 'HOLD'].includes(status);

  // 입고예정 등록·QR 모달 — 화면은 QR 입고배정 현황(dashboard.js)에 합쳤고, 그쪽이 이 모달을 함께 그린다
  const modals = () => `
      <div class="modal-overlay" id="supplier-inbound-modal">
        <div class="modal modal-xl">
          <div class="modal-header">
            <div class="modal-title">협력사 입고예정 등록</div>
            <button class="modal-close" onclick="SupplierInboundPage.closeModal('supplier-inbound-modal')">✕</button>
          </div>
          <div id="supplier-inbound-body"></div>
        </div>
      </div>

      <div class="modal-overlay" id="supplier-inbound-qr-modal">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title">협력사 입고 QR</div>
            <button class="modal-close" onclick="SupplierInboundPage.closeModal('supplier-inbound-qr-modal')">✕</button>
          </div>
          <div id="supplier-inbound-qr-body"></div>
        </div>
      </div>
    `;

  const renderActions = (r) => {
    const buttons = [];
    if (r.status === 'QR_ISSUED') {
      buttons.push(`<button class="btn btn-info btn-sm" onclick="SupplierInboundPage.markArrived('${r.id}')">도착</button>`);
    }
    if (['QR_ISSUED', 'ARRIVED', 'PENDING_SCALE'].includes(r.status)) {
      buttons.push(`<button class="btn btn-warning btn-sm" onclick="SupplierInboundPage.openWeigh('${r.id}')">계근</button>`);
    }
    if (r.status === 'PENDING_QC') {
      buttons.push(`<button class="btn btn-outline-primary btn-sm" onclick="App.navigate('quality','${r.id}')">검사</button>`);
    }
    if (r.status === 'APPROVED') {
      buttons.push(`<button class="btn btn-success btn-sm" onclick="ReceivingPage.registerStock('${r.id}')">입고</button>`);
    }
    if (isOpenStatus(r.status)) {
      buttons.push(`<button class="btn btn-ghost btn-sm" onclick="SupplierInboundPage.hold('${r.id}')">보류</button>`);
      buttons.push(`<button class="btn btn-danger btn-sm" onclick="SupplierInboundPage.reject('${r.id}')">반려</button>`);
    }
    if (r.status === 'IN_STOCK') {
      buttons.push('<span class="text-xs text-muted">중복 입고 불가</span>');
    }
    return buttons.join('');
  };

  const openAddModal = () => {
    const today = new Date().toISOString().split('T')[0];
    const activeFactory = App.getFactory?.() === 'ALL' ? 'AS' : (App.getFactory?.() || 'AS');
    document.getElementById('supplier-inbound-body').innerHTML = `
      <div class="form-grid form-grid-2" style="gap:16px">
        <div class="form-group">
          <label class="form-label">협력사 <span class="required">*</span></label>
          <div class="search-box relative">
            <span class="search-icon"></span>
            <input type="text" class="form-input" id="sin-supplier-search" placeholder="업체명, 코드, 거래품목 검색..." autocomplete="off"
              oninput="SupplierInboundPage.onSupplierSearch(this.value)" onblur="setTimeout(()=>SupplierInboundPage.closeSupplierDropdown(),200)">
            <div class="autocomplete-dropdown hidden" id="sin-supplier-dropdown"></div>
          </div>
          <div id="sin-selected-supplier" class="hidden supplier-inbound-selected">
            <span id="sin-selected-supplier-text"></span>
            <button class="btn btn-ghost btn-sm" onclick="SupplierInboundPage.clearSupplier()">✕</button>
          </div>
          <input type="hidden" id="sin-supplier-id" value="">
          <input type="hidden" id="sin-supplier-name" value="">
        </div>

        <div class="form-group">
          <label class="form-label">도착 공장</label>
          <select class="form-input" id="sin-factory" onchange="SupplierInboundPage.updateLotPreview()">
            ${DB.getFactories().map(f => `<option value="${f.id}" ${f.id === activeFactory ? 'selected' : ''}>${f.name} (${f.lotCode})</option>`).join('')}
          </select>
          <div class="form-hint">LOT 공장코드: A=논산, C=경산, D=아산, W=본사</div>
        </div>

        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">원료 <span class="required">*</span></label>
          <div class="search-box relative">
            <span class="search-icon"></span>
            <input type="text" class="form-input" id="sin-material-search" placeholder="원료코드 또는 원료명 검색..." autocomplete="off"
              oninput="SupplierInboundPage.onMaterialSearch(this.value)" onblur="setTimeout(()=>SupplierInboundPage.closeMaterialDropdown(),200)">
            <div class="autocomplete-dropdown hidden" id="sin-material-dropdown"></div>
          </div>
          <div id="sin-selected-material" class="hidden supplier-inbound-selected">
            <span id="sin-selected-material-text"></span>
            <button class="btn btn-ghost btn-sm" onclick="SupplierInboundPage.clearMaterial()">✕</button>
          </div>
          <input type="hidden" id="sin-material-code" value="">
          <input type="hidden" id="sin-material-name" value="">
        </div>

        <div class="form-group">
          <label class="form-label">납품예정일 <span class="required">*</span></label>
          <input type="date" class="form-input" id="sin-received-date" value="${today}">
        </div>
        <div class="form-group">
          <label class="form-label">차량번호</label>
          <input type="text" class="form-input" id="sin-vehicle-no" placeholder="경기92사1187">
        </div>
        <div class="form-group">
          <label class="form-label">기사명</label>
          <input type="text" class="form-input" id="sin-driver-name" placeholder="기사명">
        </div>
        <div class="form-group">
          <label class="form-label">연락처</label>
          <input type="text" class="form-input" id="sin-contact" placeholder="010-0000-0000">
        </div>
        <div class="form-group">
          <label class="form-label">예정수량</label>
          <input type="number" class="form-input" id="sin-expected-qty" placeholder="0" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">예정중량(kg) <span class="required">*</span></label>
          <input type="number" class="form-input" id="sin-expected-weight" placeholder="0.000" step="0.001" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">LOT 번호</label>
          <input type="text" class="form-input" id="sin-lot-no" placeholder="LOT-공장코드-원료코드-YYYYMMDD-순번 자동 생성" oninput="this.dataset.autoLot='0'">
        </div>
        <div class="form-group">
          <label class="form-label">제조일</label>
          <input type="date" class="form-input" id="sin-manufacture-date">
        </div>
        <div class="form-group">
          <label class="form-label">소비기한</label>
          <input type="date" class="form-input" id="sin-expiry-date">
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">서류/특이사항</label>
          <textarea class="form-textarea" id="sin-attachment-note" placeholder="성적서, HACCP 서류, 특이사항 등을 입력"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="SupplierInboundPage.closeModal('supplier-inbound-modal')">취소</button>
        <button class="btn btn-primary" onclick="SupplierInboundPage.submitNotice()">${QR_ON ? 'QR 발행' : '입고예정 등록'}</button>
      </div>
    `;
    if (prefillSupplierId) setTimeout(() => selectSupplier(prefillSupplierId), 50);
    openModal('supplier-inbound-modal');
  };

  const onSupplierSearch = (query) => {
    clearTimeout(supplierSearchTimeout);
    if (!query || query.length < 1) { closeSupplierDropdown(); return; }
    supplierSearchTimeout = setTimeout(() => {
      const results = DB.searchSuppliers(query).slice(0, 30);
      const dd = document.getElementById('sin-supplier-dropdown');
      if (!dd) return;
      dd.innerHTML = results.length === 0
        ? '<div class="autocomplete-item text-muted">검색 결과 없음</div>'
        : results.map(s => `
          <div class="autocomplete-item" onclick="SupplierInboundPage.selectSupplier('${s.id}')">
            <span class="item-name">${escapeText(s.name)}</span>
            <span class="item-code">${escapeText(s.code)} · ${escapeText(s.haccpGrade || '-')}등급 · ${escapeText(s.mainItem || '-')}</span>
          </div>`).join('');
      dd.classList.remove('hidden');
    }, 150);
  };

  const selectSupplier = (supplierId) => {
    const s = DB.getSupplierById(supplierId);
    if (!s) return;
    document.getElementById('sin-supplier-id').value = s.id;
    document.getElementById('sin-supplier-name').value = s.name;
    document.getElementById('sin-supplier-search').value = `${s.name} (${s.code})`;
    document.getElementById('sin-selected-supplier-text').innerHTML =
      `<strong>${escapeText(s.name)}</strong> <span class="font-mono text-accent">${escapeText(s.qrCode || s.code)}</span>`;
    document.getElementById('sin-selected-supplier').classList.remove('hidden');
    prefillSupplierId = '';
    closeSupplierDropdown();
  };

  const clearSupplier = () => {
    document.getElementById('sin-supplier-id').value = '';
    document.getElementById('sin-supplier-name').value = '';
    document.getElementById('sin-supplier-search').value = '';
    document.getElementById('sin-selected-supplier').classList.add('hidden');
  };

  const closeSupplierDropdown = () => document.getElementById('sin-supplier-dropdown')?.classList.add('hidden');

  const onMaterialSearch = (query) => {
    clearTimeout(materialSearchTimeout);
    if (!query || query.length < 1) { closeMaterialDropdown(); return; }
    materialSearchTimeout = setTimeout(() => {
      const results = DB.searchMaterials(query).slice(0, 30);
      const dd = document.getElementById('sin-material-dropdown');
      if (!dd) return;
      dd.innerHTML = results.length === 0
        ? '<div class="autocomplete-item text-muted">검색 결과 없음</div>'
        : results.map(m => `
          <div class="autocomplete-item" onclick="SupplierInboundPage.selectMaterial('${m.code}')">
            <span class="item-name">${escapeText(m.name)}</span>
            <span class="item-code">${escapeText(m.code)} · ${escapeText(m.category || '-')}</span>
          </div>`).join('');
      dd.classList.remove('hidden');
    }, 150);
  };

  const selectMaterial = (materialCode) => {
    const m = DB.getMaterialByCode(materialCode);
    if (!m) return;
    document.getElementById('sin-material-code').value = m.code;
    document.getElementById('sin-material-name').value = m.name;
    document.getElementById('sin-material-search').value = `${m.name} (${m.code})`;
    document.getElementById('sin-selected-material-text').innerHTML =
      `<strong>${escapeText(m.name)}</strong> <span class="font-mono text-accent">${escapeText(m.code)}</span>`;
    document.getElementById('sin-selected-material').classList.remove('hidden');
    const lotEl = document.getElementById('sin-lot-no');
    const factory = document.getElementById('sin-factory')?.value || 'AS';
    if (lotEl && !lotEl.value) {
      lotEl.value = DB.generateLotNo(m.code, factory);
      lotEl.dataset.autoLot = '1';
    }
    closeMaterialDropdown();
  };

  const updateLotPreview = () => {
    const lotEl = document.getElementById('sin-lot-no');
    const materialCode = document.getElementById('sin-material-code')?.value || '';
    const factory = document.getElementById('sin-factory')?.value || 'AS';
    if (!lotEl || !materialCode) return;
    if (!lotEl.value || lotEl.dataset.autoLot === '1') {
      lotEl.value = DB.generateLotNo(materialCode, factory);
      lotEl.dataset.autoLot = '1';
    }
  };

  const clearMaterial = () => {
    document.getElementById('sin-material-code').value = '';
    document.getElementById('sin-material-name').value = '';
    document.getElementById('sin-material-search').value = '';
    document.getElementById('sin-lot-no').value = '';
    document.getElementById('sin-lot-no').dataset.autoLot = '1';
    document.getElementById('sin-selected-material').classList.add('hidden');
  };

  const closeMaterialDropdown = () => document.getElementById('sin-material-dropdown')?.classList.add('hidden');

  const submitNotice = () => {
    const materialCode = document.getElementById('sin-material-code').value;
    const expectedWeight = parseFloat(document.getElementById('sin-expected-weight').value);
    const supplierName = document.getElementById('sin-supplier-name').value || document.getElementById('sin-supplier-search').value;
    const factory = document.getElementById('sin-factory').value;

    if (!supplierName) { App.toast('협력사를 선택하거나 입력해주세요', 'error'); return; }
    if (!materialCode) { App.toast('원료를 선택해주세요', 'error'); return; }
    if (!expectedWeight || expectedWeight <= 0) { App.toast('예정중량을 입력해주세요', 'error'); return; }

    try {
      const item = DB.addSupplierPreNotice({
        supplierId: document.getElementById('sin-supplier-id').value,
        supplierName,
        supplier: supplierName,
        factory,
        materialCode,
        materialName: document.getElementById('sin-material-name').value,
        receivedDate: document.getElementById('sin-received-date').value,
        vehicleNo: document.getElementById('sin-vehicle-no').value,
        driverName: document.getElementById('sin-driver-name').value,
        contact: document.getElementById('sin-contact').value,
        expectedQty: document.getElementById('sin-expected-qty').value || 0,
        expectedWeight,
        lotNo: document.getElementById('sin-lot-no').value || DB.generateLotNo(materialCode, factory),
        manufactureDate: document.getElementById('sin-manufacture-date').value,
        expiryDate: document.getElementById('sin-expiry-date').value,
        attachmentNote: document.getElementById('sin-attachment-note').value
      });
      closeModal('supplier-inbound-modal');
      App.toast(QR_ON ? '협력사 입고예정 QR이 발행되었습니다' : '입고예정이 등록되었습니다', 'success');
      App.refreshPage();
      if (QR_ON) setTimeout(() => showQR(item.id), 250);
    } catch (e) {
      App.toast((QR_ON ? 'QR 발행 실패: ' : '입고예정 등록 실패: ') + e.message, 'error');
    }
  };

  const showQR = (receivingId) => {
    const r = DB.getReceivingById(receivingId);
    if (!r) return;
    const qrKey = r.qrCode || r.id;
    const scanUrl = QRUtil.buildAppLink?.(r, 'scan') || qrKey;
    document.getElementById('supplier-inbound-qr-body').innerHTML = `
      <div style="text-align:center">
        <div class="mb-12">
          <div class="font-bold text-lg">${escapeText(r.materialName)}</div>
          <div class="text-sm text-muted">${escapeText(supplierName(r))} · ${escapeText(r.preRegId || r.id)}</div>
        </div>
        <div class="qr-preview-box">
          <div id="supplier-inbound-qr-preview"></div>
        </div>
        <div class="text-xs text-muted mt-8 font-mono">${escapeText(qrKey)}</div>
        <div class="text-xs text-muted mt-4 font-mono" style="word-break:break-all">${escapeText(scanUrl)}</div>
        <div class="supplier-inbound-label-info">
          <div><span>원료코드</span><strong>${escapeText(r.materialCode)}</strong></div>
          <div><span>LOT</span><strong>${escapeText(r.lotNo || '-')}</strong></div>
          <div><span>입고공장</span><strong>${escapeText(DB.getFactoryName(r.factory))} (${escapeText(DB.getFactoryLotCode?.(r.factory) || r.factoryLotCode || '-')})</strong></div>
          <div><span>납품예정일</span><strong>${escapeText(r.receivedDate || '-')}</strong></div>
          <div><span>예정중량</span><strong>${formatNum(r.expectedWeight)}kg</strong></div>
          <div><span>차량번호</span><strong>${escapeText(r.vehicleNo || '-')}</strong></div>
          <div><span>출력횟수</span><strong>${formatNum(r.qrPrintCount || 0)}회</strong></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="SupplierInboundPage.closeModal('supplier-inbound-qr-modal')">닫기</button>
        <button class="btn btn-primary" onclick="SupplierInboundPage.printLabel('${r.id}')">라벨 인쇄</button>
      </div>
    `;
    openModal('supplier-inbound-qr-modal');
    setTimeout(() => QRUtil.generate('supplier-inbound-qr-preview', scanUrl, { size: 210 }), 80);
  };

  const printLabel = (receivingId) => {
    try {
      const updated = DB.markQrPrinted(receivingId);
      QRUtil.printLabel(updated);
      App.toast('QR 라벨 출력 이력이 기록되었습니다', 'success');
      App.refreshPage();
    } catch (e) {
      App.toast('라벨 출력 실패: ' + e.message, 'error');
    }
  };

  const markArrived = (receivingId) => {
    try {
      DB.processSupplierInbound(receivingId, 'ARRIVE', { actor: '현장' });
      App.toast('납품 도착 처리 완료', 'success');
      App.refreshPage();
    } catch (e) {
      App.toast('도착 처리 실패: ' + e.message, 'error');
    }
  };

  const openWeigh = (receivingId) => {
    const r = DB.getReceivingById(receivingId);
    if (!r) return;
    try {
      if (r.status === 'QR_ISSUED') DB.processSupplierInbound(receivingId, 'ARRIVE', { actor: '현장' });
      App.navigate('receiving');
      setTimeout(() => ReceivingPage.openWeighModal(receivingId), 250);
    } catch (e) {
      App.toast('계근 전환 실패: ' + e.message, 'error');
    }
  };

  const hold = (receivingId) => {
    const reason = prompt('보류 사유를 입력하세요', '서류 확인 필요');
    if (reason === null) return;
    try {
      DB.processSupplierInbound(receivingId, 'HOLD', { reason, actor: '현장' });
      App.toast('입고 보류 처리 완료', 'warning');
      App.refreshPage();
    } catch (e) {
      App.toast('보류 처리 실패: ' + e.message, 'error');
    }
  };

  const reject = (receivingId) => {
    const reason = prompt('반려 사유를 입력하세요', QR_ON ? 'QR/실물 정보 불일치' : '송장/실물 정보 불일치');
    if (reason === null) return;
    try {
      DB.processSupplierInbound(receivingId, 'REJECT', { reason, actor: '현장' });
      App.toast('입고 반려 처리 완료', 'warning');
      App.refreshPage();
    } catch (e) {
      App.toast('반려 처리 실패: ' + e.message, 'error');
    }
  };

  const prefillSupplier = (supplierId) => {
    prefillSupplierId = supplierId;
  };

  const openModal = (id) => document.getElementById(id)?.classList.add('open');
  const closeModal = (id) => document.getElementById(id)?.classList.remove('open');

  return {
    modals,
    renderActions,
    openAddModal,
    onSupplierSearch,
    selectSupplier,
    clearSupplier,
    closeSupplierDropdown,
    onMaterialSearch,
    selectMaterial,
    clearMaterial,
    closeMaterialDropdown,
    updateLotPreview,
    submitNotice,
    showQR,
    printLabel,
    markArrived,
    openWeigh,
    hold,
    reject,
    prefillSupplier,
    closeModal
  };
})();
