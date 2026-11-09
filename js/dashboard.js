// ============================================================
// dashboard.js — QR 입고배정 현황 (입고 현황 + 협력사 입고예정 등록·QR 통합)
//   2026-11-06 협력사 입고예정 화면을 여기로 합쳤다. 같은 입고 기록(rm_receiving)을 보는 화면이라
//   등록·QR·도착·보류·반려는 SupplierInboundPage 의 기능을 그대로 불러 쓴다.
// ============================================================

const DashboardPage = (() => {
  let searchVehicle = '';
  let view = 'open';     // open(진행 중) | all(전체)

  // ── QR 상태 배지 ──
  const qrStatusBadge = (r) => {
    if (r.isTemporary)            return `<span class="qr-badge qr-temp">임시입고</span>`;
    if (r.scanCount === 0)        return `<span class="qr-badge qr-wait">입고대기</span>`;
    if (r.status === 'PENDING_APPROVAL') return `<span class="qr-badge qr-error">오류</span>`;
    if (r.status === 'IN_STOCK')  return `<span class="qr-badge qr-done">사용완료</span>`;
    return `<span class="qr-badge qr-scan">스캔됨</span>`;
  };

  const inStatusBadge = (status) => {
    const map = {
      PENDING_SCALE:    `<span class="status-pill pill-warn">입고예정</span>`,
      PENDING_QC:       `<span class="status-pill pill-info">계근완료</span>`,
      PENDING_APPROVAL: `<span class="status-pill pill-error">확인필요</span>`,
      APPROVED:         `<span class="status-pill pill-pass">승인완료</span>`,
      QR_ISSUED:        `<span class="status-pill pill-warn">${QR_ON ? 'QR발행' : '입고예정'}</span>`,
      ARRIVED:          `<span class="status-pill pill-info">도착확인</span>`,
      IN_STOCK:         `<span class="status-pill pill-done">입고확정</span>`,
      HOLD:             `<span class="status-pill pill-hold">보류</span>`,
      REJECTED:         `<span class="status-pill pill-fail">부적합</span>`,
    };
    return map[status] || `<span class="status-pill">${status}</span>`;
  };

  // 진행 중 = 입고 처리가 끝나지 않은 건. 납품일이 며칠 뒤인 QR 발행 건도 여기 포함된다.
  const OPEN_STATUS = ['QR_ISSUED', 'ARRIVED', 'PENDING_SCALE', 'PENDING_QC', 'PENDING_APPROVAL', 'APPROVED', 'HOLD'];

  // 입고 표 액션 — 도착·계근·검사·입고·보류·반려는 협력사 입고예정의 동작을 그대로 쓴다
  const rowActions = (r) => {
    if (['IN_STOCK', 'REJECTED', 'CANCELLED'].includes(r.status)) {
      return r.isTemporary || !QR_ON ? '' : `<button class="btn btn-ghost btn-xs" onclick="SupplierInboundPage.showQR('${r.id}')">QR</button>`;
    }
    const acts = SupplierInboundPage.renderActions(r).replace(/btn-sm/g, 'btn-xs');
    const qr = r.isTemporary || !QR_ON ? '' : `<button class="btn btn-ghost btn-xs" onclick="SupplierInboundPage.showQR('${r.id}')">QR</button>`;
    const silo = r.status === 'APPROVED' && !r.siloId ? `<button class="btn btn-success btn-xs" onclick="App.navigate('silo')">배정</button>` : '';
    return qr + acts + silo;
  };

  const render = () => {
    const factory = App.getFactory();
    const stats   = DB.getStats(factory !== 'ALL' ? factory : null);
    const allReceivings = DB.getReceivings()
      .filter(r => factory === 'ALL' || r.factory === factory)
      .slice().reverse();
    const todayReceivings = allReceivings.filter(r => {
      const today = new Date().toLocaleDateString('sv-SE');   // 현지 날짜(UTC 로 자르면 오전 9시 전엔 어제가 된다)
      return r.receivedDate === today || OPEN_STATUS.includes(r.status);
    });
    // 검색은 끝난 입고건까지 찾는다 — 진행 중 목록에서만 찾으면 지난 차량이 안 나온다
    const filtered = searchVehicle
      ? allReceivings.filter(r => r.vehicleNo?.includes(searchVehicle) || r.supplierName?.includes(searchVehicle) || r.materialName?.includes(searchVehicle) || r.preRegId?.includes(searchVehicle))
      : (view === 'all' ? allReceivings : todayReceivings);

    const scanRate = stats.todayReceivingCount > 0
      ? Math.round((stats.scannedCount / stats.todayReceivingCount) * 100) : 0;

    return `
      <div class="fade-in">

        <!-- ── 입고 KPI 카드 ── -->
        <div class="kpi-grid-6 kpi-grid-5 mb-20">

          <div class="kpi6 kpi6-blue" onclick="App.navigate('receiving')">
            <div class="kpi6-label">오늘 입고예정</div>
            <div class="kpi6-value">${stats.todayReceivingCount}<span class="kpi6-unit">건</span></div>
            <div class="kpi6-bar"><div class="kpi6-fill kpi6-fill-blue" style="width:100%"></div></div>
            <div class="kpi6-sub">${formatNum(Math.round(stats.todayReceivingTon / 100) / 10)} ton</div>
          </div>
          <div class="kpi6 kpi6-green qr-only" onclick="App.navigate('receiving')">
            <div class="kpi6-label">QR 스캔완료</div>
            <div class="kpi6-value">${stats.scannedCount}<span class="kpi6-unit">건</span></div>
            <div class="kpi6-bar"><div class="kpi6-fill kpi6-fill-green" style="width:${scanRate}%"></div></div>
            <div class="kpi6-sub">${scanRate}%</div>
          </div>
          <div class="kpi6 kpi6-orange qr-only" onclick="App.navigate('receiving')">
            <div class="kpi6-label">남은 미스캔</div>
            <div class="kpi6-value">${stats.missScanCount}<span class="kpi6-unit">건</span></div>
            <div class="kpi6-bar"><div class="kpi6-fill kpi6-fill-orange" style="width:${stats.todayReceivingCount>0?Math.round(stats.missScanCount/stats.todayReceivingCount*100):0}%"></div></div>
            <div class="kpi6-sub">도착 확인</div>
          </div>
          <div class="kpi6 kpi6-teal" onclick="App.navigate('quality')">
            <div class="kpi6-label">입고확정</div>
            <div class="kpi6-value">${stats.inStockCount}<span class="kpi6-unit">건</span></div>
            <div class="kpi6-bar"><div class="kpi6-fill kpi6-fill-teal" style="width:100%"></div></div>
            <div class="kpi6-sub">LOT 생성됨</div>
          </div>
          <div class="kpi6 ${stats.exceptionCount>0?'kpi6-red':'kpi6-gray'}" onclick="showExceptions()">
            <div class="kpi6-label">${QR_ON ? 'QR 예외처리' : '입고 예외처리'}</div>
            <div class="kpi6-value">${stats.exceptionCount}<span class="kpi6-unit">건</span></div>
            <div class="kpi6-bar"><div class="kpi6-fill kpi6-fill-red" style="width:${stats.exceptionCount>0?80:0}%"></div></div>
            <div class="kpi6-sub">로그 저장</div>
          </div>
        </div>

        <!-- ── 입고예정·입고내역 테이블 ── -->
        <div class="card mb-20">
          <div class="card-header">
            <div>
              <div class="card-title"><span class="icon"></span> 입고예정·입고내역</div>
              <div class="text-xs text-muted mt-2">${QR_ON ? 'QR은 예정정보이고' : '송장은 예정정보이고'}, 우성 계근값 입력 후 입고확정됩니다</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn ${view === 'open' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="DashboardPage.setView('open')">진행 중 ${todayReceivings.length}</button>
              <button class="btn ${view === 'all' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="DashboardPage.setView('all')">전체 ${allReceivings.length}</button>
              <button class="btn btn-outline-primary btn-sm" onclick="searchByVehicle()">차량번호 검색</button>
              <button class="btn btn-ghost btn-sm" onclick="openTempReceiving()">${QR_ON ? 'QR 없이 임시 입고' : '임시 입고'}</button>
              <button class="btn btn-ghost btn-sm qr-only" onclick="App.navigate('scan')">QR 스캔</button>
              <button class="btn btn-outline-primary btn-sm" onclick="SupplierInboundPage.openAddModal()">＋ 입고예정 등록</button>
              <button class="btn btn-primary btn-sm" onclick="InvoiceScan.open()">송장 스캔 입고</button>
            </div>
          </div>

          <!-- 검색 -->
          ${searchVehicle ? `
          <div class="flex gap-8 mb-12" style="align-items:center">
            <span class="text-sm text-muted">검색: "${searchVehicle}"</span>
            <button class="btn btn-ghost btn-sm" onclick="DashboardPage.clearSearch()">✕ 초기화</button>
          </div>` : ''}

          ${filtered.length === 0 ? `
            <div class="empty-state">
              <div class="empty-icon"></div>
              <h3>${searchVehicle ? '검색 결과가 없습니다' : '진행 중인 입고가 없습니다'}</h3>
              <p>${QR_ON ? '납품 전에 협력사, 원료, 예정중량을 입력하면 QR 라벨이 생성됩니다' : '송장을 스캔하거나 입고예정을 등록하세요'}</p>
            </div>
          ` : `
          <div class="table-wrapper">
            <table class="receiving-table">
              <thead>
                <tr>
                  <th>사전입고번호</th>
                  <th class="qr-only">QR 상태</th>
                  <th class="qr-only">스캔</th>
                  <th>협력사</th>
                  <th>납품예정일</th>
                  <th>차량번호</th>
                  <th>원료코드 / 명칭</th>
                  <th class="td-right">예정중량</th>
                  <th class="td-right">실중량</th>
                  <th>입고상태</th>
                  <th>액션</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map(r => `
                <tr class="receiving-row ${r.status==='PENDING_APPROVAL'?'row-error':r.status==='REJECTED'?'row-rejected':''}" onclick="showReceivingDetail('${r.id}')">
                  <td><span class="pre-reg-id">${recvNo(r).slice(0,20)}</span></td>
                  <td class="qr-only">${qrStatusBadge(r)}</td>
                  <td class="td-center qr-only"><span class="scan-count">${r.scanCount||0}회</span></td>
                  <td>${r.supplierName || '-'}</td>
                  <td class="text-xs">${r.receivedDate || '-'}</td>
                  <td><span class="vehicle-no">${r.vehicleNo || '-'}</span></td>
                  <td>
                    <span class="material-code">${r.materialCode}</span>
                    <span class="material-name">/ ${r.materialName}</span>
                  </td>
                  <td class="td-right">${formatNum(r.expectedWeight)}kg</td>
                  <td class="td-right ${r.actualWeight?'':'text-muted'}">${r.actualWeight ? formatNum(r.actualWeight)+'kg' : '-'}</td>
                  <td>${inStatusBadge(r.status)}</td>
                  <td onclick="event.stopPropagation()">
                    <div style="display:flex;gap:4px;flex-wrap:wrap">${rowActions(r)}</div>
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
        </div>

        <!-- 예외처리 모달 -->
        <div class="modal-overlay" id="exception-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title">${QR_ON ? 'QR 예외처리 목록' : '입고 예외처리 목록'}</div>
              <button class="modal-close" onclick="document.getElementById('exception-modal').classList.remove('open')">✕</button>
            </div>
            <div id="exception-modal-body"></div>
          </div>
        </div>

        <!-- 차량번호 검색 모달 -->
        <div class="modal-overlay" id="vehicle-search-modal">
          <div class="modal">
            <div class="modal-header">
              <div class="modal-title">차량번호 검색</div>
              <button class="modal-close" onclick="document.getElementById('vehicle-search-modal').classList.remove('open')">✕</button>
            </div>
            <div style="padding:16px">
              <div class="flex gap-8">
                <input type="text" class="form-input" id="vehicle-search-input" placeholder="차량번호 또는 협력사명 입력..." style="flex:1">
                <button class="btn btn-primary" onclick="DashboardPage.doVehicleSearch()">검색</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 임시입고 모달 -->
        <div class="modal-overlay" id="temp-receiving-modal">
          <div class="modal">
            <div class="modal-header">
              <div class="modal-title">${QR_ON ? 'QR 없이 임시 입고' : '임시 입고'}</div>
              <button class="modal-close" onclick="document.getElementById('temp-receiving-modal').classList.remove('open')">✕</button>
            </div>
            <div id="temp-receiving-body"></div>
          </div>
        </div>

        ${SupplierInboundPage.modals()}

        <!-- 입고 상세 모달 -->
        <div class="modal-overlay" id="receiving-detail-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title">입고 상세</div>
              <button class="modal-close" onclick="document.getElementById('receiving-detail-modal').classList.remove('open')">✕</button>
            </div>
            <div id="receiving-detail-body"></div>
          </div>
        </div>

      </div>
    `;
  };

  const afterRender = () => {
    // KPI 카운터 애니메이션
    document.querySelectorAll('.kpi6-value').forEach(el => {
      el.classList.add('counting');
      setTimeout(() => el.classList.remove('counting'), 600);
    });
    // KPI 바 shimmer
    document.querySelectorAll('.kpi6-fill').forEach(el => {
      el.classList.add('kpi6-fill-animated');
    });
  };

  const clearSearch = () => { searchVehicle = ''; App.refreshPage(); };
  const setView = (v) => { view = v; App.refreshPage(); };

  const doVehicleSearch = () => {
    const val = document.getElementById('vehicle-search-input')?.value.trim();
    if (val) { searchVehicle = val; document.getElementById('vehicle-search-modal').classList.remove('open'); App.refreshPage(); }
  };

  return { render, afterRender, clearSearch, doVehicleSearch, setView };
})();

// ── 전역 헬퍼 (HTML onclick에서 사용) ──
function showReceivingDetail(id) {
  const r = DB.getReceivingById(id);
  if (!r) return;
  const w = DB.getWeighingByReceivingId(id);
  const insp = DB.getInspectionsByReceivingId(id);
  const hist = DB.getHistoryByRefId(id);
  const body = document.getElementById('receiving-detail-body');
  if (!body) return;
  body.innerHTML = `
    <div style="padding:16px;display:flex;flex-direction:column;gap:16px">
      <div class="info-grid-2">
        <div><div class="info-label">사전입고번호</div><div class="info-value font-mono">${recvNo(r)}</div></div>
        <div><div class="info-label">공장</div><div class="info-value">${DB.getFactoryName(r.factory)}</div></div>
        <div><div class="info-label">협력사</div><div class="info-value">${r.supplierName||'-'}</div></div>
        <div><div class="info-label">차량번호</div><div class="info-value">${r.vehicleNo||'-'}</div></div>
        <div><div class="info-label">원료</div><div class="info-value">${r.materialCode} / ${r.materialName}</div></div>
        <div><div class="info-label">LOT번호</div><div class="info-value font-mono">${r.lotNo||'-'}</div></div>
        <div><div class="info-label">예정중량</div><div class="info-value">${formatNum(r.expectedWeight)}kg</div></div>
        <div><div class="info-label">실측중량</div><div class="info-value">${r.actualWeight?formatNum(r.actualWeight)+'kg':'-'}</div></div>
        ${r.supplierLot ? `<div><div class="info-label">협력사 LOT</div><div class="info-value font-mono">${r.supplierLot}</div></div>` : ''}
        ${r.invoiceNo ? `<div><div class="info-label">송장번호</div><div class="info-value font-mono">${r.invoiceNo}</div></div>` : ''}
        ${r.invoiceScan ? `<div><div class="info-label">스캔 원본</div><div class="info-value"><button class="btn btn-ghost btn-xs" onclick="PhotoStore.openViewer([DB.getReceivingById('${r.id}').invoiceScan], 0, {})">송장 보기</button></div></div>` : ''}
      </div>
      ${w ? `<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:12px">
        <div style="font-weight:600;margin-bottom:8px">계근 정보</div>
        <div class="info-grid-2">
          <div><div class="info-label">실측중량</div><div class="info-value">${formatNum(w.actualWeight)}kg</div></div>
          <div><div class="info-label">편차</div><div class="info-value">${w.diffPct>0?'+':''}${w.diffPct}%</div></div>
          <div><div class="info-label">차량번호</div><div class="info-value">${w.vehicleNo||'-'}</div></div>
          <div><div class="info-label">계근담당</div><div class="info-value">${w.weighedBy}</div></div>
        </div>
      </div>` : ''}
      ${insp.length>0 ? `<div>
        <div style="font-weight:600;margin-bottom:8px">품질 검사</div>
        ${insp.map(i=>`<div class="flex gap-8 items-center mb-4"><span class="badge ${i.verdict==='PASS'?'badge-pass':'badge-fail'}">${i.verdict==='PASS'?'':''} ${i.gateName}</span><span class="text-sm text-muted">${i.inspector} · ${formatDate(i.inspectedAt)}</span></div>`).join('')}
      </div>`:''}
      <div>
        <div style="font-weight:600;margin-bottom:8px">이력</div>
        <div class="timeline">
          ${hist.slice(-5).map(h=>`<div class="timeline-item"><div class="timeline-action">${h.action}</div><div class="timeline-detail">${h.detail}</div><div class="timeline-meta">${formatDate(h.timestamp)} · ${h.actor}</div></div>`).join('')}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="document.getElementById('receiving-detail-modal').classList.remove('open')">닫기</button>
        <button class="btn btn-primary" onclick="App.navigate('receiving')">입고관리로 이동</button>
      </div>
    </div>
  `;
  document.getElementById('receiving-detail-modal').classList.add('open');
}

function showExceptions() {
  const exceptions = DB.getExceptions().filter(e => !e.resolved);
  const body = document.getElementById('exception-modal-body');
  if (!body) return;
  body.innerHTML = `
    <div style="padding:16px">
      ${exceptions.length === 0
        ? `<div class="empty-state"><div class="empty-icon"></div><h3>예외 없음</h3></div>`
        : `<div style="display:flex;flex-direction:column;gap:8px">
          ${exceptions.map(e=>`
            <div class="card" style="padding:12px">
              <div class="flex justify-between items-center">
                <div>
                  <span class="badge badge-alert">${e.type}</span>
                  <span class="ml-8 text-sm">${e.detail}</span>
                </div>
                <div class="flex gap-4">
                  <span class="text-xs text-muted">${e.vehicleNo||''} · ${formatDate(e.timestamp)}</span>
                  <button class="btn btn-ghost btn-xs" onclick="DB.resolveException('${e.id}');App.refreshPage()">해결</button>
                </div>
              </div>
            </div>`).join('')}
          </div>`}
    </div>
  `;
  document.getElementById('exception-modal').classList.add('open');
}

function searchByVehicle() {
  document.getElementById('vehicle-search-modal').classList.add('open');
  setTimeout(() => document.getElementById('vehicle-search-input')?.focus(), 100);
}

function openTempReceiving() {
  const body = document.getElementById('temp-receiving-body');
  if (!body) return;
  const preId = DB.generatePreRegId();
  body.innerHTML = `
    <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
      <div class="info-box info-warning">
        ${QR_ON ? 'QR 미부착 차량 임시 등록입니다. 나중에 QR 스캔 후 연결합니다.' : '송장 없이 들어온 차량의 임시 등록입니다.'}
      </div>
      <div class="form-group">
        <label class="form-label">사전입고번호 (자동생성)</label>
        <input type="text" class="form-input" value="${preId}" readonly style="background:var(--bg-card)">
      </div>
      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label">차량번호 *</label>
          <input type="text" class="form-input" id="tmp-vehicle" placeholder="예) 서울12가3456">
        </div>
        <div class="form-group">
          <label class="form-label">협력사명</label>
          <input type="text" class="form-input" id="tmp-supplier" list="supplier-list" placeholder="협력사 선택">
          <datalist id="supplier-list">${DB.getSuppliers().map(s=>`<option value="${s.name}">`).join('')}</datalist>
        </div>
      </div>
      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label">원료명 *</label>
          <input type="text" class="form-input" id="tmp-material" placeholder="예) 옥수수">
        </div>
        <div class="form-group">
          <label class="form-label">예정중량 (kg)</label>
          <input type="number" class="form-input" id="tmp-weight" placeholder="0">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">공장</label>
        <select class="form-input" id="tmp-factory">
          ${DB.getFactories().map(f=>`<option value="${f.id}">${f.name}</option>`).join('')}
        </select>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="document.getElementById('temp-receiving-modal').classList.remove('open')">취소</button>
        <button class="btn btn-primary" onclick="submitTempReceiving('${preId}')">임시 등록</button>
      </div>
    </div>
  `;
  document.getElementById('temp-receiving-modal').classList.add('open');
}

function submitTempReceiving(preId) {
  const vehicleNo    = document.getElementById('tmp-vehicle')?.value.trim();
  const supplierName = document.getElementById('tmp-supplier')?.value.trim();
  const materialName = document.getElementById('tmp-material')?.value.trim();
  const expectedWeight = parseFloat(document.getElementById('tmp-weight')?.value) || 0;
  const factory      = document.getElementById('tmp-factory')?.value || 'AS';
  if (!vehicleNo || !materialName) { App.toast('차량번호와 원료명은 필수입니다', 'error'); return; }
  DB.addReceiving({ preRegId: preId, materialCode: 'TEMP', materialName, supplierName, factory, vehicleNo, expectedWeight, isTemporary: true, createdBy: '현장' });
  DB.addException({ type:'QR_MISSING', detail:`임시입고 - 차량:${vehicleNo} 원료:${materialName}`, vehicleNo, actor:'현장' });
  document.getElementById('temp-receiving-modal').classList.remove('open');
  App.toast('임시 입고 등록 완료', 'success');
  App.refreshPage();
}
