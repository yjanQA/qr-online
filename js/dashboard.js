// ============================================================
// dashboard.js — QR 입고배정 현황 대시보드 (PPT 이미지 재현)
// ============================================================

const DashboardPage = (() => {
  let charts = {};
  let searchVehicle = '';

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
      IN_STOCK:         `<span class="status-pill pill-done">입고확정</span>`,
      HOLD:             `<span class="status-pill pill-hold">보류</span>`,
      REJECTED:         `<span class="status-pill pill-fail">부적합</span>`,
    };
    return map[status] || `<span class="status-pill">${status}</span>`;
  };

  const render = () => {
    const factory = App.getFactory();
    const stats   = DB.getStats(factory !== 'ALL' ? factory : null);
    const silos   = factory !== 'ALL' ? DB.getSilosByFactory(factory) : DB.getSilos().slice(0,6);
    const allReceivings = DB.getReceivings()
      .filter(r => factory === 'ALL' || r.factory === factory)
      .slice().reverse();
    const todayReceivings = allReceivings.filter(r => {
      const today = new Date().toISOString().split('T')[0];
      return r.receivedDate === today || ['PENDING_SCALE','PENDING_QC','PENDING_APPROVAL'].includes(r.status);
    });
    const filtered = searchVehicle
      ? todayReceivings.filter(r => r.vehicleNo?.includes(searchVehicle) || r.supplierName?.includes(searchVehicle) || r.materialName?.includes(searchVehicle) || r.preRegId?.includes(searchVehicle))
      : todayReceivings;

    const scanRate = stats.todayReceivingCount > 0
      ? Math.round((stats.scannedCount / stats.todayReceivingCount) * 100) : 0;

    return `
      <div class="fade-in">

        <!-- ── 6개 KPI 카드 (PPT 이미지 기준) ── -->
        <div class="kpi-grid-6 mb-20">

          <div class="kpi6 kpi6-blue" onclick="App.navigate('receiving')">
            <div class="kpi6-label">오늘 입고예정</div>
            <div class="kpi6-value">${stats.todayReceivingCount}<span class="kpi6-unit">건</span></div>
            <div class="kpi6-bar"><div class="kpi6-fill kpi6-fill-blue" style="width:100%"></div></div>
            <div class="kpi6-sub">${formatNum(stats.todayReceivingTon)} ton</div>
          </div>
          <div class="kpi6 kpi6-green" onclick="App.navigate('receiving')">
            <div class="kpi6-label">QR 스캔완료</div>
            <div class="kpi6-value">${stats.scannedCount}<span class="kpi6-unit">건</span></div>
            <div class="kpi6-bar"><div class="kpi6-fill kpi6-fill-green" style="width:${scanRate}%"></div></div>
            <div class="kpi6-sub">${scanRate}%</div>
          </div>
          <div class="kpi6 kpi6-orange" onclick="App.navigate('receiving')">
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
          <div class="kpi6 kpi6-purple" onclick="App.navigate('silo')">
            <div class="kpi6-label">사일로 배정대기</div>
            <div class="kpi6-value">${stats.siloWaitingCount}<span class="kpi6-unit">건</span></div>
            <div class="kpi6-bar"><div class="kpi6-fill kpi6-fill-purple" style="width:${stats.siloWaitingCount>0?60:0}%"></div></div>
            <div class="kpi6-sub">위치 선택</div>
          </div>
          <div class="kpi6 ${stats.exceptionCount>0?'kpi6-red':'kpi6-gray'}" onclick="showExceptions()">
            <div class="kpi6-label">QR 예외처리</div>
            <div class="kpi6-value">${stats.exceptionCount}<span class="kpi6-unit">건</span></div>
            <div class="kpi6-bar"><div class="kpi6-fill kpi6-fill-red" style="width:${stats.exceptionCount>0?80:0}%"></div></div>
            <div class="kpi6-sub">로그 저장</div>
          </div>
        </div>

        <!-- ── 사일로 미니 현황 ── -->
        <div class="card mb-20">
          <div class="card-header">
            <div class="card-title"><span class="icon"></span> 사일로 현황 요약</div>
            <button class="btn btn-ghost btn-sm" onclick="App.navigate('silo')">전체보기 →</button>
          </div>
          <div class="silo-mini-grid">
            ${silos.slice(0,6).map(silo => {
              const sum = DB.getSiloCapacitySummary(silo);
              const statusColor = sum.status === 'FULL' ? '#ef4444' : sum.status === 'LOW' ? '#f59e0b' : sum.status === 'AVAILABLE' ? '#10b981' : '#475569';
              const statusText  = { FULL:'가득', AVAILABLE:'사용가능', LOW:'재고부족', EMPTY:'비어있음' }[sum.status] || sum.status;
              return `
              <div class="silo-mini-card" onclick="App.navigate('silo')">
                <div class="silo-mini-header">
                  <div class="silo-mini-name">${silo.name.replace('사일로','').trim()}</div>
                  <div class="silo-mini-badge" style="color:${statusColor}">${statusText}</div>
                </div>
                <div class="silo-mini-gauge">
                  <div class="silo-mini-bar">
                    <div class="silo-mini-fill" style="width:${sum.pct}%;background:${statusColor}"></div>
                  </div>
                  <div class="silo-mini-pct">${sum.pct}%</div>
                </div>
                <div class="silo-mini-detail">
                  <span>${silo.materialName}</span>
                  <span>${formatNum(sum.totalQty)}kg</span>
                </div>
                <div class="silo-mini-lots">
                  ${(silo.currentLots || []).map(l => `<span class="silo-lot-chip">${l.lotNo}: ${formatNum(l.qty)}kg</span>`).join('')}
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>

        <!-- ── 입고예정·입고내역 테이블 ── -->
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title"><span class="icon"></span> 입고예정·입고내역</div>
              <div class="text-xs text-muted mt-2">QR은 예정정보이고, 우성 계근값 입력 후 입고확정됩니다</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-outline-primary btn-sm" onclick="searchByVehicle()">차량번호 검색</button>
              <button class="btn btn-ghost btn-sm" onclick="openTempReceiving()">QR 없이 임시 입고</button>
              <button class="btn btn-primary btn-sm" onclick="App.navigate('scan')">QR 스캔</button>
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
              <h3>오늘 입고 예정이 없습니다</h3>
              <p>입고 등록을 시작해보세요</p>
            </div>
          ` : `
          <div class="table-wrapper">
            <table class="receiving-table">
              <thead>
                <tr>
                  <th>사전입고번호</th>
                  <th>QR 상태</th>
                  <th>스캔</th>
                  <th>협력사</th>
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
                  <td><span class="pre-reg-id">${r.preRegId || r.id.slice(0,20)}</span></td>
                  <td>${qrStatusBadge(r)}</td>
                  <td class="td-center"><span class="scan-count">${r.scanCount||0}회</span></td>
                  <td>${r.supplierName || '-'}</td>
                  <td><span class="vehicle-no">${r.vehicleNo || '-'}</span></td>
                  <td>
                    <span class="material-code">${r.materialCode}</span>
                    <span class="material-name">/ ${r.materialName}</span>
                  </td>
                  <td class="td-right">${formatNum(r.expectedWeight)}kg</td>
                  <td class="td-right ${r.actualWeight?'':'text-muted'}">${r.actualWeight ? formatNum(r.actualWeight)+'kg' : '-'}</td>
                  <td>${inStatusBadge(r.status)}</td>
                  <td onclick="event.stopPropagation()">
                    <div style="display:flex;gap:4px">
                      ${r.status==='PENDING_SCALE'?`<button class="btn btn-warning btn-xs" onclick="App.navigate('receiving');setTimeout(()=>ReceivingPage.openWeighModal('${r.id}'),200)">계근</button>`:''}
                      ${r.status==='PENDING_QC'?`<button class="btn btn-info btn-xs" onclick="App.navigate('quality')">검사</button>`:''}
                      ${r.status==='APPROVED'&&!r.siloId?`<button class="btn btn-success btn-xs" onclick="App.navigate('silo')">배정</button>`:''}
                    </div>
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
        </div>

        <!-- ── 하단 — 차트 + 최근활동 ── -->
        <div class="grid-2 mt-20">
          <div class="card">
            <div class="card-header">
              <div class="card-title"><span class="icon"></span> 7일 품질 추이</div>
            </div>
            <div class="chart-wrapper"><canvas id="defectChart"></canvas></div>
          </div>
          <div class="card">
            <div class="card-header">
              <div class="card-title"><span class="icon"></span> 최근 활동</div>
              <button class="btn btn-ghost btn-sm" onclick="App.navigate('history')">전체보기</button>
            </div>
            <div class="timeline mt-4">
              ${stats.recentActivity.length === 0
                ? `<div class="empty-state"><div class="empty-icon"></div><h3>활동 이력 없음</h3></div>`
                : stats.recentActivity.slice(0,8).map(a => `
                  <div class="timeline-item">
                    <div class="timeline-action">${typeIcon(a.refType)} ${a.action}</div>
                    <div class="timeline-detail">${a.detail||''}</div>
                    <div class="timeline-meta">${formatDate(a.timestamp)} · ${a.actor}</div>
                  </div>`).join('')}
            </div>
          </div>
        </div>

        <!-- 예외처리 모달 -->
        <div class="modal-overlay" id="exception-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title">QR 예외처리 목록</div>
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
              <div class="modal-title">QR 없이 임시 입고</div>
              <button class="modal-close" onclick="document.getElementById('temp-receiving-modal').classList.remove('open')">✕</button>
            </div>
            <div id="temp-receiving-body"></div>
          </div>
        </div>

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

  const typeIcon = (type) => {
    const m = { RECEIVING:'', WEIGHING:'', QC:'', INVENTORY:'', OUTBOUND:'', ADJUST:'', SILO:'', SILO_CONSUME:'', LOSS:'', PRODUCTION:'', BATCH:'', PRODUCT:'', VOC:'' };
    return m[type] || '•';
  };

  const afterRender = () => {
    drawDefectChart();

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


  const drawDefectChart = () => {
    const ctx = document.getElementById('defectChart');
    if (!ctx) return;
    if (charts.defect) charts.defect.destroy();
    const data = DB.getStats().last7DaysDefect;
    charts.defect = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(d => d.date.slice(5)),
        datasets: [{
          label: '불량률(%)',
          data: data.map(d => d.rate),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.1)',
          fill: true, tension: 0.4, pointBackgroundColor: '#ef4444', pointRadius: 4
        },{
          label: '검사건수',
          data: data.map(d => d.total),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.1)',
          fill: false, tension: 0.4, pointBackgroundColor: '#3b82f6', pointRadius: 4, yAxisID: 'y1'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color:'#94a3b8', font:{size:11} } } },
        scales: {
          x:  { ticks:{color:'#94a3b8',font:{size:11}}, grid:{color:'rgba(255,255,255,0.05)'} },
          y:  { ticks:{color:'#94a3b8',font:{size:11}}, grid:{color:'rgba(255,255,255,0.05)'}, title:{display:true,text:'불량률(%)',color:'#94a3b8',font:{size:10}} },
          y1: { position:'right', ticks:{color:'#94a3b8',font:{size:11}}, grid:{drawOnChartArea:false}, title:{display:true,text:'건수',color:'#94a3b8',font:{size:10}} }
        }
      }
    });
  };

  const clearSearch = () => { searchVehicle = ''; App.refreshPage(); };

  const doVehicleSearch = () => {
    const val = document.getElementById('vehicle-search-input')?.value.trim();
    if (val) { searchVehicle = val; document.getElementById('vehicle-search-modal').classList.remove('open'); App.refreshPage(); }
  };

  return { render, afterRender, clearSearch, doVehicleSearch };
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
        <div><div class="info-label">사전입고번호</div><div class="info-value font-mono">${r.preRegId||r.id}</div></div>
        <div><div class="info-label">공장</div><div class="info-value">${DB.getFactoryName(r.factory)}</div></div>
        <div><div class="info-label">협력사</div><div class="info-value">${r.supplierName||'-'}</div></div>
        <div><div class="info-label">차량번호</div><div class="info-value">${r.vehicleNo||'-'}</div></div>
        <div><div class="info-label">원료</div><div class="info-value">${r.materialCode} / ${r.materialName}</div></div>
        <div><div class="info-label">LOT번호</div><div class="info-value font-mono">${r.lotNo||'-'}</div></div>
        <div><div class="info-label">예정중량</div><div class="info-value">${formatNum(r.expectedWeight)}kg</div></div>
        <div><div class="info-label">실측중량</div><div class="info-value">${r.actualWeight?formatNum(r.actualWeight)+'kg':'-'}</div></div>
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
        QR 미부착 차량 임시 등록입니다. 나중에 QR 스캔 후 연결합니다.
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
