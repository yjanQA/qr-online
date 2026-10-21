// ============================================================
// receiving.js — 입고 관리 + 계근 페이지
// ============================================================

const ReceivingPage = (() => {
  let currentTab = 'list';
  let materialSearchTimeout = null;
  let supplierSearchTimeout = null;
  let prefillSupplierId = '';

  const statusBadge = (status) => {
    const map = {
      QR_ISSUED:        `<span class="badge badge-info">QR발행</span>`,
      ARRIVED:          `<span class="badge badge-warning">도착확인</span>`,
      PENDING_SCALE:    `<span class="badge badge-warning">계근대기</span>`,
      PENDING_QC:       `<span class="badge badge-info">검사대기</span>`,
      PENDING_APPROVAL: `<span class="badge badge-alert">승인대기</span>`,
      APPROVED:         `<span class="badge badge-pass">합격</span>`,
      IN_STOCK:         `<span class="badge badge-pass">재고등록</span>`,
      HOLD:             `<span class="badge badge-hold">보류</span>`,
      REJECTED:         `<span class="badge badge-fail">불합격</span>`,
      CANCELLED:        `<span class="badge badge-default">취소</span>`
    };
    return map[status] || `<span class="badge badge-default">${status}</span>`;
  };

  const render = () => {
    const list = DB.getReceivings().slice().reverse();
    const pendingScale = list.filter(r => r.status === 'QR_ISSUED' || r.status === 'ARRIVED' || r.status === 'PENDING_SCALE' || r.status === 'PENDING_APPROVAL');

    return `
      <div class="fade-in">
        <div class="flex items-center justify-between mb-20">
          <div>
            <div class="text-sm text-muted">총 ${list.length}건 입고 등록됨</div>
          </div>
          <div style="display:flex;gap:10px">
            <button class="btn btn-ghost btn-sm" onclick="ReceivingPage.openScanWeighModal()">
              계근 처리
              ${pendingScale.length > 0 ? `<span class="nav-badge">${pendingScale.length}</span>` : ''}
            </button>
            <button class="btn btn-primary" onclick="ReceivingPage.openAddModal()">
              ＋ 입고 등록
            </button>
          </div>
        </div>

        <!-- 탭 -->
        <div class="tabs">
          <div class="tab ${currentTab==='list'?'active':''}" onclick="ReceivingPage.switchTab('list')">전체 목록</div>
          <div class="tab ${currentTab==='scale'?'active':''}" onclick="ReceivingPage.switchTab('scale')">
            계근 대기 ${pendingScale.length > 0 ? `<span class="nav-badge" style="margin-left:6px">${pendingScale.length}</span>` : ''}
          </div>
        </div>

        ${currentTab === 'list' ? renderList(list) : renderScaleList(pendingScale)}
      </div>

      <!-- 입고 등록 모달 -->
      <div class="modal-overlay" id="add-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <div class="modal-title">입고 등록</div>
            <button class="modal-close" onclick="ReceivingPage.closeModal('add-modal')">✕</button>
          </div>
          <div id="add-modal-body"></div>
        </div>
      </div>

      <!-- 계근 처리 모달 -->
      <div class="modal-overlay" id="weigh-modal">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title">계근 처리</div>
            <button class="modal-close" onclick="ReceivingPage.closeModal('weigh-modal')">✕</button>
          </div>
          <div id="weigh-modal-body"></div>
        </div>
      </div>

      <!-- QR 확인 모달 -->
      <div class="modal-overlay" id="qr-modal">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title">QR 라벨</div>
            <button class="modal-close" onclick="ReceivingPage.closeModal('qr-modal')">✕</button>
          </div>
          <div id="qr-modal-body"></div>
        </div>
      </div>
    `;
  };

  const renderList = (list) => {
    if (list.length === 0) return `
      <div class="empty-state">
        <div class="empty-icon"></div>
        <h3>입고 데이터가 없습니다</h3>
        <p>입고 등록 버튼을 눌러 첫 번째 입고를 등록해보세요</p>
        <button class="btn btn-primary mt-12" onclick="ReceivingPage.openAddModal()">＋ 입고 등록</button>
      </div>`;

    return `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>입고번호</th>
              <th>원료코드</th>
              <th>원료명</th>
              <th>거래처</th>
              <th>입고공장</th>
              <th>LOT</th>
              <th>입고일</th>
              <th>예상중량(kg)</th>
              <th>실측중량(kg)</th>
              <th>상태</th>
              <th>액션</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(r => {
              const weighing = DB.getWeighingByReceivingId(r.id);
              return `
              <tr>
                <td><span class="td-mono">${r.id.slice(0,16)}...</span></td>
                <td><span class="td-mono">${r.materialCode}</span></td>
                <td><strong>${r.materialName}</strong></td>
                <td>${r.supplierName || r.supplier || '-'}</td>
                <td>${DB.getFactoryName(r.factory)} <span class="td-mono text-xs">(${DB.getFactoryLotCode?.(r.factory) || r.factoryLotCode || '-'})</span></td>
                <td><span class="td-mono text-xs">${r.lotNo || '-'}</span></td>
                <td>${r.receivedDate || ''}</td>
                <td class="td-right">${r.expectedWeight?.toLocaleString() || 0}</td>
                <td class="td-right">
                  ${weighing ? `
                    <span style="color:${weighing.weightStatus==='NORMAL'?'var(--success)':weighing.weightStatus==='WARNING'?'var(--warning)':'var(--danger)'}">
                      ${weighing.actualWeight?.toLocaleString()}
                      <small>(${weighing.diffPct > 0 ? '+' : ''}${weighing.diffPct}%)</small>
                    </span>
                  ` : '<span class="text-muted">-</span>'}
                </td>
                <td>${statusBadge(r.status)}</td>
                <td>
                  <div style="display:flex;gap:6px">
                    <button class="btn btn-ghost btn-sm btn-icon" title="QR 보기" onclick="ReceivingPage.showQR('${r.id}')">QR</button>
                    ${r.status === 'QR_ISSUED' || r.status === 'ARRIVED' || r.status === 'PENDING_SCALE' || r.status === 'PENDING_APPROVAL' ?
                      `<button class="btn btn-warning btn-sm" onclick="ReceivingPage.openWeighModal('${r.id}')">계근</button>` : ''}
                    ${r.status === 'PENDING_QC' || r.status === 'APPROVED' ?
                      `<button class="btn btn-outline-primary btn-sm" onclick="App.navigate('quality','${r.id}')">검사</button>` : ''}
                    ${r.status === 'APPROVED' ?
                      `<button class="btn btn-success btn-sm" onclick="ReceivingPage.registerStock('${r.id}')">입고</button>` : ''}
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  };

  const renderScaleList = (list) => {
    if (list.length === 0) return `
      <div class="empty-state">
        <div class="empty-icon"></div>
        <h3>계근 대기 항목이 없습니다</h3>
        <p>모든 입고 항목의 계근이 완료되었습니다</p>
      </div>`;
    return `
      <div style="display:flex;flex-direction:column;gap:12px">
        ${list.map(r => `
          <div class="card" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
            <div>
              <div class="font-bold">${r.materialName}</div>
              <div class="text-sm text-muted font-mono">${r.materialCode} · ${r.supplierName || r.supplier || '거래처 미입력'}</div>
              <div class="text-sm" style="margin-top:4px">입고공장: <strong>${DB.getFactoryName(r.factory)}</strong> · 예상중량: <strong>${r.expectedWeight?.toLocaleString()} kg</strong> · LOT: ${r.lotNo || '-'}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              ${statusBadge(r.status)}
              <button class="btn btn-warning" onclick="ReceivingPage.openWeighModal('${r.id}')">계근 처리</button>
            </div>
          </div>`).join('')}
      </div>`;
  };

  const switchTab = (tab) => {
    currentTab = tab;
    App.refreshPage();
  };

  // ── 입고 등록 모달 ──
  const openAddModal = () => {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('add-modal-body').innerHTML = `
      <div class="form-grid" style="gap:16px">
        <!-- 원료 검색 -->
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">원료 검색 <span class="required">*</span></label>
          <div class="search-box relative">
            <span class="search-icon"></span>
            <input type="text" class="form-input" id="material-search" placeholder="코드 또는 원료명으로 검색..." autocomplete="off"
              oninput="ReceivingPage.onMaterialSearch(this.value)" onblur="setTimeout(()=>ReceivingPage.closeDropdown(),200)">
            <div class="autocomplete-dropdown hidden" id="material-dropdown"></div>
          </div>
          <div id="selected-material" class="hidden" style="margin-top:8px;padding:10px 14px;background:var(--success-bg);border:1px solid var(--success);border-radius:var(--radius-md);">
            <span id="selected-text"></span>
            <button class="btn btn-ghost btn-sm" style="margin-left:8px" onclick="ReceivingPage.clearMaterial()">✕</button>
          </div>
          <input type="hidden" id="material-code" value="">
          <input type="hidden" id="material-name" value="">
        </div>

        <div class="form-group">
          <label class="form-label">협력사</label>
          <div class="search-box relative">
            <span class="search-icon"></span>
            <input type="text" class="form-input" id="supplier" placeholder="업체명, 코드, 거래품목으로 검색..." autocomplete="off"
              oninput="ReceivingPage.onSupplierSearch(this.value)" onblur="setTimeout(()=>ReceivingPage.closeSupplierDropdown(),200)">
            <div class="autocomplete-dropdown hidden" id="supplier-dropdown"></div>
          </div>
          <div id="selected-supplier" class="hidden" style="margin-top:8px;padding:10px 14px;background:var(--info-bg);border:1px solid var(--info);border-radius:var(--radius-md);">
            <span id="selected-supplier-text"></span>
            <button class="btn btn-ghost btn-sm" style="margin-left:8px" onclick="ReceivingPage.clearSupplier()">✕</button>
          </div>
          <input type="hidden" id="supplier-id" value="">
          <input type="hidden" id="supplier-name" value="">
        </div>
        <div class="form-group">
          <label class="form-label">입고 공장 <span class="required">*</span></label>
          <select class="form-input" id="factory" onchange="ReceivingPage.updateLotPreview()">
            ${DB.getFactories().map(f => `<option value="${f.id}" ${f.id === (App.getFactory?.() === 'ALL' ? 'AS' : App.getFactory?.()) ? 'selected' : ''}>${f.name} (${f.lotCode})</option>`).join('')}
          </select>
          <div class="form-hint">LOT 공장코드: A=논산, C=경산, D=아산, W=본사</div>
        </div>
        <div class="form-group">
          <label class="form-label">입고일 <span class="required">*</span></label>
          <input type="date" class="form-input" id="received-date" value="${today}">
        </div>
        <div class="form-group">
          <label class="form-label">예상 수량</label>
          <input type="number" class="form-input" id="expected-qty" placeholder="0" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">예상 중량 (kg) <span class="required">*</span></label>
          <input type="number" class="form-input" id="expected-weight" placeholder="0.000" step="0.001" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">LOT 번호</label>
          <input type="text" class="form-input" id="lot-no" placeholder="비워두면 LOT-공장코드-원료코드-YYYYMMDD-순번 자동생성" oninput="this.dataset.autoLot='0'">
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">메모</label>
          <textarea class="form-textarea" id="memo" placeholder="특이사항 입력"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="ReceivingPage.closeModal('add-modal')">취소</button>
        <button class="btn btn-primary" onclick="ReceivingPage.submitAdd()">등록 및 QR 생성</button>
      </div>
    `;
    if (prefillSupplierId) {
      setTimeout(() => selectSupplier(prefillSupplierId), 50);
    }
    openModal('add-modal');
  };

  const onMaterialSearch = (query) => {
    clearTimeout(materialSearchTimeout);
    if (!query || query.length < 1) { closeDropdown(); return; }
    materialSearchTimeout = setTimeout(() => {
      const results = DB.searchMaterials(query).slice(0, 30);
      const dd = document.getElementById('material-dropdown');
      if (!dd) return;
      if (results.length === 0) {
        dd.innerHTML = '<div class="autocomplete-item text-muted">검색 결과 없음</div>';
      } else {
        dd.innerHTML = results.map(m => `
          <div class="autocomplete-item" onclick="ReceivingPage.selectMaterial('${m.code}','${m.name.replace(/'/g,"\\'")}')">
            <span class="item-name">${m.name}</span>
            <span class="item-code">${m.code}</span>
          </div>`).join('');
      }
      dd.classList.remove('hidden');
    }, 150);
  };

  const selectMaterial = (code, name) => {
    document.getElementById('material-code').value = code;
    document.getElementById('material-name').value = name;
    document.getElementById('material-search').value = `${name} (${code})`;
    document.getElementById('selected-text').innerHTML = `<strong>${name}</strong> <span class="font-mono text-accent" style="margin-left:8px">${code}</span>`;
    document.getElementById('selected-material').classList.remove('hidden');
    updateLotPreview(true);
    closeDropdown();
  };

  const updateLotPreview = (force = false) => {
    const lotEl = document.getElementById('lot-no');
    const code = document.getElementById('material-code')?.value || '';
    const factory = document.getElementById('factory')?.value || 'AS';
    if (!lotEl || !code) return;
    if (force || !lotEl.value || lotEl.dataset.autoLot === '1') {
      lotEl.value = DB.generateLotNo(code, factory);
      lotEl.dataset.autoLot = '1';
    }
  };

  const clearMaterial = () => {
    document.getElementById('material-code').value = '';
    document.getElementById('material-name').value = '';
    document.getElementById('material-search').value = '';
    document.getElementById('selected-material').classList.add('hidden');
    const lotEl = document.getElementById('lot-no');
    if (lotEl && lotEl.dataset.autoLot === '1') lotEl.value = '';
  };

  const closeDropdown = () => {
    const dd = document.getElementById('material-dropdown');
    if (dd) dd.classList.add('hidden');
  };

  const onSupplierSearch = (query) => {
    clearTimeout(supplierSearchTimeout);
    if (!query || query.length < 1) { closeSupplierDropdown(); return; }
    supplierSearchTimeout = setTimeout(() => {
      const results = DB.searchSuppliers(query).slice(0, 30);
      const dd = document.getElementById('supplier-dropdown');
      if (!dd) return;
      if (results.length === 0) {
        dd.innerHTML = '<div class="autocomplete-item text-muted">검색 결과 없음 · 그대로 입력하면 임시 협력사로 저장됩니다</div>';
      } else {
        dd.innerHTML = results.map(s => `
          <div class="autocomplete-item" onclick="ReceivingPage.selectSupplier('${s.id}')">
            <span class="item-name">${s.name}</span>
            <span class="item-code">${s.code} · ${s.haccpGrade || '-'}등급 · ${s.mainItem || '-'}</span>
          </div>`).join('');
      }
      dd.classList.remove('hidden');
    }, 150);
  };

  const selectSupplier = (supplierId) => {
    const s = DB.getSupplierById(supplierId);
    if (!s) return;
    document.getElementById('supplier-id').value = s.id;
    document.getElementById('supplier-name').value = s.name;
    document.getElementById('supplier').value = `${s.name} (${s.code})`;
    document.getElementById('selected-supplier-text').innerHTML =
      `<strong>${s.name}</strong> <span class="font-mono text-accent" style="margin-left:8px">${s.qrCode || s.code}</span>`;
    document.getElementById('selected-supplier').classList.remove('hidden');
    prefillSupplierId = '';
    closeSupplierDropdown();
  };

  const clearSupplier = () => {
    document.getElementById('supplier-id').value = '';
    document.getElementById('supplier-name').value = '';
    document.getElementById('supplier').value = '';
    document.getElementById('selected-supplier').classList.add('hidden');
  };

  const closeSupplierDropdown = () => {
    const dd = document.getElementById('supplier-dropdown');
    if (dd) dd.classList.add('hidden');
  };

  const prefillSupplier = (supplierId) => {
    prefillSupplierId = supplierId;
  };

  const submitAdd = () => {
    const code = document.getElementById('material-code').value;
    const name = document.getElementById('material-name').value;
    const weight = parseFloat(document.getElementById('expected-weight').value);
    const supplierId = document.getElementById('supplier-id')?.value || '';
    const supplierName = document.getElementById('supplier-name')?.value || document.getElementById('supplier')?.value || '';
    const factory = document.getElementById('factory')?.value || 'AS';

    if (!code) { App.toast('원료를 선택해주세요', 'error'); return; }
    if (!weight || weight <= 0) { App.toast('예상 중량을 입력해주세요', 'error'); return; }

    try {
      const lotNo = document.getElementById('lot-no').value || DB.generateLotNo(code, factory);
      const item = DB.addReceiving({
        materialCode: code,
        materialName: name,
        supplierId,
        supplierName,
        supplier: supplierName,
        factory,
        receivedDate: document.getElementById('received-date').value,
        expectedQty: document.getElementById('expected-qty').value || 0,
        expectedWeight: weight,
        lotNo,
        memo: document.getElementById('memo').value
      });
      closeModal('add-modal');
      App.toast('입고 등록 완료! QR 라벨을 출력하세요.', 'success');
      setTimeout(() => showQR(item.id), 300);
      App.refreshPage();
    } catch (e) {
      App.toast('등록 실패: ' + e.message, 'error');
    }
  };

  // ── 계근 모달 ──
  const openWeighModal = (receivingId) => {
    const r = DB.getReceivingById(receivingId);
    if (!r) return;
    const settings = DB.getSettings();
    const warnPct  = settings.weightWarnPct  || 0.5;
    const alertPct = settings.weightAlertPct || 2.0;

    document.getElementById('weigh-modal-body').innerHTML = `
      <div style="margin-bottom:16px">
        <div class="badge badge-info mb-8">${r.materialCode}</div>
        <div class="font-bold text-lg">${r.materialName}</div>
        <div class="text-sm text-muted">입고공장: ${DB.getFactoryName(r.factory)} (${DB.getFactoryLotCode?.(r.factory) || r.factoryLotCode || '-'}) · 거래처: ${r.supplierName || r.supplier || '-'} · LOT: ${r.lotNo || '-'}</div>
      </div>

      <div class="weight-display mb-16">
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">예상 중량</div>
        <div style="font-size:32px;font-weight:700;font-family:'JetBrains Mono',monospace;color:var(--text-secondary)">${r.expectedWeight?.toLocaleString()} kg</div>
      </div>

      <div class="form-group mb-16">
        <label class="form-label">실측 중량 (kg) <span class="required">*</span></label>
        <input type="number" class="form-input weight-input-large" id="actual-weight"
          placeholder="0.000" step="0.001" min="0" oninput="ReceivingPage.calcDiff(${r.expectedWeight})">
        <div class="form-hint">
          허용범위: ±${warnPct}% 이내 정상 / ±${alertPct}% 초과 시 관리자 승인
        </div>
      </div>

      <div id="weight-diff-display" class="hidden mb-16"></div>

      <div class="form-grid form-grid-2" style="gap:12px">
        <div class="form-group">
          <label class="form-label">차량번호</label>
          <input type="text" class="form-input" id="vehicle-no" placeholder="00가0000" value="${r.vehicleNo || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">기사명</label>
          <input type="text" class="form-input" id="driver-name" placeholder="홍길동" value="${r.driverName || ''}">
        </div>
      </div>
      <div class="form-group mt-12">
        <label class="form-label">처리자</label>
        <input type="text" class="form-input" id="weigh-by" placeholder="현장 담당자명">
      </div>

      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="ReceivingPage.closeModal('weigh-modal')">취소</button>
        <button class="btn btn-warning" onclick="ReceivingPage.submitWeigh('${receivingId}')">계근 확정</button>
      </div>
    `;
    openModal('weigh-modal');
  };

  const calcDiff = (expected) => {
    const actual = parseFloat(document.getElementById('actual-weight').value);
    const display = document.getElementById('weight-diff-display');
    if (!actual || isNaN(actual)) { display.classList.add('hidden'); return; }

    const diff = actual - expected;
    const pct  = expected > 0 ? (diff / expected * 100) : 0;
    const settings = DB.getSettings();
    const alertPct = settings.weightAlertPct || 2.0;
    const warnPct  = settings.weightWarnPct  || 0.5;

    let statusCls = 'badge-normal', statusTxt = '정상 범위';
    if (Math.abs(pct) > alertPct) { statusCls = 'badge-alert'; statusTxt = '이상 — 관리자 승인 필요'; }
    else if (Math.abs(pct) > warnPct) { statusCls = 'badge-warning'; statusTxt = '주의 — 기록 후 통과 가능'; }

    display.classList.remove('hidden');
    display.innerHTML = `
      <div class="weight-display">
        <div class="weight-value">${actual.toLocaleString()}</div>
        <div class="weight-unit">kg</div>
        <div class="weight-diff badge ${statusCls}">
          ${diff >= 0 ? '+' : ''}${diff.toFixed(3)} kg &nbsp;|&nbsp; ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%
          &nbsp;|&nbsp; ${statusTxt}
        </div>
      </div>`;
  };

  const submitWeigh = (receivingId) => {
    const actual = parseFloat(document.getElementById('actual-weight').value);
    if (!actual || actual <= 0) { App.toast('실측 중량을 입력해주세요', 'error'); return; }

    try {
      DB.addWeighing({
        receivingId,
        actualWeight: actual,
        vehicleNo: document.getElementById('vehicle-no').value,
        driverName: document.getElementById('driver-name').value,
        weighedBy:  document.getElementById('weigh-by').value || '현장'
      });
      closeModal('weigh-modal');
      App.toast('계근 처리 완료', 'success');
      App.refreshPage();
    } catch (e) {
      App.toast('계근 실패: ' + e.message, 'error');
    }
  };

  // ── QR 확인 모달 ──
  const showQR = (receivingId) => {
    const r = DB.getReceivingById(receivingId);
    if (!r) return;
    const qrKey = r.qrCode || r.id;
    const scanUrl = QRUtil.buildAppLink?.(r, 'scan') || qrKey;

    document.getElementById('qr-modal-body').innerHTML = `
      <div style="text-align:center">
        <div class="mb-12">
          <div class="font-bold text-lg">${r.materialName}</div>
          <div class="text-sm text-muted font-mono">${r.materialCode}</div>
        </div>
        <div class="qr-preview-box">
          <div id="qr-preview"></div>
        </div>
        <div class="text-xs text-muted mt-8 font-mono">${qrKey}</div>
        <div class="text-xs text-muted mt-4 font-mono" style="word-break:break-all">${scanUrl}</div>
        <div style="margin-top:16px;padding:12px;background:var(--bg-surface);border-radius:var(--radius-md);text-align:left;font-size:12px">
          <div class="flex justify-between"><span class="text-muted">거래처</span><span>${r.supplierName || r.supplier || '-'}</span></div>
          <div class="flex justify-between mt-4"><span class="text-muted">입고공장</span><span>${DB.getFactoryName(r.factory)} (${DB.getFactoryLotCode?.(r.factory) || r.factoryLotCode || '-'})</span></div>
          <div class="flex justify-between mt-4"><span class="text-muted">입고일</span><span>${r.receivedDate}</span></div>
          <div class="flex justify-between mt-4"><span class="text-muted">예상중량</span><span>${r.expectedWeight?.toLocaleString()} kg</span></div>
          <div class="flex justify-between mt-4"><span class="text-muted">LOT</span><span>${r.lotNo || '-'}</span></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="ReceivingPage.closeModal('qr-modal')">닫기</button>
        <button class="btn btn-primary" onclick="QRUtil.printLabel(${JSON.stringify(r).replace(/"/g,'&quot;')})">라벨 인쇄</button>
      </div>
    `;
    openModal('qr-modal');
    setTimeout(() => QRUtil.generate('qr-preview', scanUrl, { size: 210 }), 100);
  };

  // 계근 대기 스캔 처리
  const openScanWeighModal = () => {
    App.navigate('scan');
  };

  // 재고 등록 (품질 통과 후)
  const registerStock = (receivingId) => {
    const bin = prompt('창고 위치를 입력하세요 (예: A-01-01)', 'A-01-01');
    if (!bin) return;
    try {
      DB.registerStock({ receivingId, binLocation: bin });
      App.toast('재고 등록 완료', 'success');
      App.refreshPage();
    } catch (e) {
      App.toast('재고 등록 실패: ' + e.message, 'error');
    }
  };

  const openModal = (id) => document.getElementById(id)?.classList.add('open');
  const closeModal = (id) => document.getElementById(id)?.classList.remove('open');

  const afterRender = () => {};

  return {
    render, afterRender, switchTab, openAddModal, closeModal,
    onMaterialSearch, selectMaterial, clearMaterial, closeDropdown, updateLotPreview,
    onSupplierSearch, selectSupplier, clearSupplier, closeSupplierDropdown, prefillSupplier,
    submitAdd, openWeighModal, calcDiff, submitWeigh,
    showQR, openScanWeighModal, registerStock
  };
})();
