// ============================================================
// silo.js — 사일로 관리 페이지 (PPT 아산공장 주원료 사일로 이미지 재현)
// ============================================================

const SiloPage = (() => {
  let viewMode = 'card';  // card / table
  let selectedSiloId = null;

  const statusLabel = { FULL:'가득', AVAILABLE:'사용가능', LOW:'재고부족', EMPTY:'비어있음' };
  const statusColor = { FULL:'#ef4444', AVAILABLE:'#10b981', LOW:'#f59e0b', EMPTY:'#475569' };
  const statusCls   = { FULL:'badge-fail', AVAILABLE:'badge-pass', LOW:'badge-warning', EMPTY:'badge-default' };

  const lotPalette = [
    '#2563eb', '#f97316', '#10b981', '#e11d48', '#8b5cf6', '#facc15',
    '#06b6d4', '#ec4899', '#84cc16', '#fb7185', '#14b8a6', '#a855f7',
    '#f59e0b', '#22c55e', '#0ea5e9', '#ef4444', '#6366f1', '#d946ef'
  ];

  // 같은 사일로 안에서는 LOT 순서별 팔레트를 우선 사용해 서로 다른 색을 보장한다.
  const getLotColor = (lotNo, idx = 0) => {
    if (!lotNo) return '#94a3b8';
    if (idx < lotPalette.length) return lotPalette[idx];
    let hash = 0;
    for (let i = 0; i < lotNo.length; i++) hash = lotNo.charCodeAt(i) + ((hash << 5) - hash);
    const hue = (Math.abs(hash) * 47 + idx * 31) % 360;
    return `hsl(${hue}, 78%, 52%)`;
  };

  const render = () => {
    const factory = App.getFactory();
    const silos   = factory === 'ALL' ? DB.getSilos() : DB.getSilosByFactory(factory);
    const groupedByFactory = DB.getFactories().reduce((acc, f) => {
      if (factory !== 'ALL' && f.id !== factory) return acc;
      acc[f.id] = { name: f.name, silos: silos.filter(s => s.factory === f.id) };
      return acc;
    }, {});

    return `
      <div class="fade-in">

        <!-- 헤더 -->
        <div class="flex items-center justify-between mb-20">
          <div class="text-sm text-muted">총 ${silos.length}개 사일로</div>
          <div style="display:flex;gap:8px">
            <div class="view-toggle">
              <button class="view-btn ${viewMode==='card'?'active':''}" onclick="SiloPage.setView('card')">카드형</button>
              <button class="view-btn ${viewMode==='table'?'active':''}" onclick="SiloPage.setView('table')">테이블</button>
            </div>
            <button class="btn btn-primary btn-sm" onclick="SiloPage.openConsumeModal()">FIFO 투입 차감</button>
            <button class="btn btn-ghost btn-sm" onclick="SiloPage.openLossModal()">로스 등록</button>
          </div>
        </div>

        ${viewMode === 'card' ? renderCardView(groupedByFactory) : renderTableView(silos)}

        <!-- 배정 대기 원료 -->
        ${renderPendingAssignment()}

        <!-- FIFO 차감 모달 -->
        <div class="modal-overlay" id="consume-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title">FIFO 투입 차감</div>
              <button class="modal-close" onclick="SiloPage.closeModal('consume-modal')">✕</button>
            </div>
            <div id="consume-modal-body"></div>
          </div>
        </div>

        <!-- 로스 등록 모달 -->
        <div class="modal-overlay" id="loss-modal">
          <div class="modal">
            <div class="modal-header">
              <div class="modal-title">로스 등록</div>
              <button class="modal-close" onclick="SiloPage.closeModal('loss-modal')">✕</button>
            </div>
            <div id="loss-modal-body"></div>
          </div>
        </div>

        <!-- 사일로 배정 모달 -->
        <div class="modal-overlay" id="assign-modal">
          <div class="modal">
            <div class="modal-header">
              <div class="modal-title">사일로 배정</div>
              <button class="modal-close" onclick="SiloPage.closeModal('assign-modal')">✕</button>
            </div>
            <div id="assign-modal-body"></div>
          </div>
        </div>

      </div>
    `;
  };

  // ── 카드형 뷰 ──
  const renderCardView = (grouped) => {
    return Object.entries(grouped).map(([factoryId, { name, silos: fSilos }]) => `
      <div class="mb-24">
        <div class="section-title mb-12">${name} <span class="text-muted text-sm">(사일로 ${fSilos.length}개)</span></div>
        <div class="silo-card-grid">
          ${fSilos.map(silo => renderSiloCard(silo)).join('')}
        </div>
      </div>
    `).join('');
  };

  const renderSiloCard = (silo) => {
    const sum  = DB.getSiloCapacitySummary(silo);
    const sc   = statusColor[sum.status] || '#475569';
    const sl   = statusLabel[sum.status] || sum.status;
    const lots = silo.currentLots || [];
    const lastInDate  = lots.length > 0 ? lots[lots.length-1].inDate : '-';
    const topLot      = lots[0];

    return `
      <div class="silo-card ${sum.status === 'LOW' || sum.status === 'EMPTY' ? 'silo-card-warn':''}" onclick="SiloPage.showDetail('${silo.id}')">
        <div class="silo-card-header">
          <div>
            <div class="silo-card-name">${silo.name}</div>
            <div class="silo-card-id text-muted text-xs">${silo.id} · ${DB.getFactoryName(silo.factory)}</div>
          </div>
          <span class="badge ${statusCls[sum.status] || 'badge-default'}">${sl}</span>
        </div>

        <!-- 사일로 시각화 + 게이지 -->
        <div class="silo-visual-row">
          <div class="silo-cylinder-wrap">
            <div class="silo-cylinder" style="display: flex; flex-direction: column-reverse; align-items: flex-end;">
              ${lots.map((l, idx) => {
                const layerPct = (l.qty / silo.maxCapacity) * 100;
                const lotColor = getLotColor(l.lotNo, idx);
                return `
                  <div class="silo-fill-layer" 
                       style="height:${layerPct}%; width: 100%; background:${lotColor}; border-top:1px solid rgba(255,255,255,0.3); transition: height 0.8s ease;" 
                       title="LOT: ${l.lotNo} (${formatNum(l.qty)}kg)">
                  </div>`;
              }).reverse().join('') /* FIFO 차례대로 쌓기 위해 순서 역순화 */}
              <div class="silo-label-inside">${formatNum(sum.totalQty / 1000)}t</div>
            </div>
          </div>
          <div class="silo-gauge-wrap">
            <div class="silo-pct" style="color:${sc}">${sum.pct}%</div>
            <div class="silo-qty-text">${formatNum(sum.totalQty)}kg / ${formatNum(silo.maxCapacity)}kg</div>
            <div class="silo-progress-bar mt-8">
              <div class="silo-progress-fill" style="width:${sum.pct}%;background:${sc}"></div>
            </div>
            <div class="silo-material-chip mt-8">
              <span>${silo.materialName}</span>
              <span class="text-muted">· LOT ${lots.length}개</span>
            </div>
            <!-- LOT 목록 -->
            <div class="silo-lot-list mt-8">
              ${lots.map((l, idx) => {
                const lotColor = getLotColor(l.lotNo, idx);
                return `
                  <div class="silo-lot-row">
                    <span class="lot-dot" style="background:${lotColor}"></span>
                    <span class="lot-name">${l.lotNo}</span>
                    <span class="lot-qty">${formatNum(l.qty)}kg</span>
                  </div>`;
              }).join('')}
            </div>
          </div>
        </div>

        <div class="silo-card-footer">
          <div class="silo-date-info">
            <div>
              <div class="text-xs text-muted">최근 입고</div>
              <div class="text-sm font-bold">${lastInDate}</div>
            </div>
            <div>
              <div class="text-xs text-muted">최근 투입</div>
              <div class="text-sm font-bold">${silo.lastConsumeDate || '-'}</div>
            </div>
          </div>
          <div style="display:flex;gap:4px" onclick="event.stopPropagation()">
            <button class="btn btn-ghost btn-xs" onclick="SiloPage.openConsumeModal('${silo.id}')">투입</button>
            <button class="btn btn-ghost btn-xs" onclick="SiloPage.openLossModal('${silo.id}')">로스</button>
          </div>
        </div>
      </div>
    `;
  };

  // ── 테이블형 뷰 ──
  const renderTableView = (silos) => `
    <div class="card">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>사일로 ID</th><th>명칭</th><th>공장</th><th>원료</th>
              <th class="td-right">현재재고(kg)</th><th class="td-right">최대용량(kg)</th>
              <th>점유율</th><th>LOT수</th><th>상태</th><th>액션</th>
            </tr>
          </thead>
          <tbody>
            ${silos.map(s => {
              const sum = DB.getSiloCapacitySummary(s);
              return `
              <tr>
                <td><span class="td-mono">${s.id}</span></td>
                <td><strong>${s.name}</strong></td>
                <td>${DB.getFactoryName(s.factory)}</td>
                <td>${s.materialName}</td>
                <td class="td-right">${formatNum(sum.totalQty)}</td>
                <td class="td-right">${formatNum(s.maxCapacity)}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div class="mini-bar"><div class="mini-fill" style="width:${sum.pct}%;background:${statusColor[sum.status]}"></div></div>
                    <span class="text-sm">${sum.pct}%</span>
                  </div>
                </td>
                <td class="td-center">${(s.currentLots||[]).length}</td>
                <td><span class="badge ${statusCls[sum.status]||'badge-default'}">${statusLabel[sum.status]||sum.status}</span></td>
                <td>
                  <div style="display:flex;gap:4px">
                    <button class="btn btn-ghost btn-xs" onclick="SiloPage.openConsumeModal('${s.id}')">차감</button>
                    <button class="btn btn-ghost btn-xs" onclick="SiloPage.openLossModal('${s.id}')">로스</button>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // ── 사일로 배정 대기 ──
  const renderPendingAssignment = () => {
    const pending = DB.getReceivings().filter(r => r.status === 'APPROVED' && !r.siloId);
    if (pending.length === 0) return '';
    return `
      <div class="card mt-20">
        <div class="card-header">
          <div class="card-title"><span class="icon"></span> 사일로 배정 대기</div>
          <div class="badge badge-warning">${pending.length}건</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
          ${pending.map(r => `
            <div class="flex items-center justify-between p-12" style="background:var(--bg-card);border-radius:8px;border:1px solid var(--border)">
              <div>
                <span class="font-bold">${r.materialName}</span>
                <span class="text-sm text-muted ml-8">${r.supplierName||''} · ${formatNum(r.actualWeight||r.expectedWeight)}kg · LOT: ${r.lotNo||'-'}</span>
              </div>
              <button class="btn btn-primary btn-sm" onclick="SiloPage.openAssignModal('${r.id}')">사일로 배정</button>
            </div>`).join('')}
        </div>
      </div>
    `;
  };

  // ── 이벤트 핸들러 ──
  const setView = (mode) => { viewMode = mode; App.refreshPage(); };

  const showDetail = (siloId) => {
    selectedSiloId = siloId;
    // 상세 모달 또는 페이지 내 표시 (추후 확장)
    App.toast('상세 보기: ' + siloId, 'info');
  };

  const closeModal = (id) => document.getElementById(id)?.classList.remove('open');

  // ── FIFO 차감 모달 ──
  const openConsumeModal = (siloId) => {
    const silos = DB.getSilos();
    const body  = document.getElementById('consume-modal-body');
    if (!body) return;
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div class="form-group">
          <label class="form-label">사일로 선택</label>
          <select class="form-input" id="consume-silo" onchange="SiloPage.updateFIFOPreview()">
            ${silos.map(s => {
              const sum = DB.getSiloCapacitySummary(s);
              return `<option value="${s.id}" ${s.id===siloId?'selected':''}>${s.name} (${formatNum(sum.totalQty)}kg)</option>`;
            }).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">투입량 (kg)</label>
          <input type="number" class="form-input" id="consume-amount" placeholder="0" oninput="SiloPage.updateFIFOPreview()" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">담당자</label>
          <input type="text" class="form-input" id="consume-actor" value="생산팀">
        </div>
        <!-- FIFO 미리보기 -->
        <div id="fifo-preview" class="info-box info-blue" style="display:none">
          <div class="font-bold mb-4">FIFO 차감 미리보기</div>
          <div id="fifo-preview-detail"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="SiloPage.closeModal('consume-modal')">취소</button>
          <button class="btn btn-primary" onclick="SiloPage.submitConsume()">투입 차감 실행</button>
        </div>
      </div>
    `;
    document.getElementById('consume-modal').classList.add('open');
    if (siloId) setTimeout(() => { document.getElementById('consume-silo').value = siloId; updateFIFOPreview(); }, 50);
  };

  const updateFIFOPreview = () => {
    const siloId = document.getElementById('consume-silo')?.value;
    const amount = parseFloat(document.getElementById('consume-amount')?.value) || 0;
    const preview = document.getElementById('fifo-preview');
    const detail  = document.getElementById('fifo-preview-detail');
    if (!siloId || amount <= 0 || !preview || !detail) { if(preview) preview.style.display='none'; return; }

    const silo = DB.getSiloById(siloId);
    if (!silo) return;
    let remaining = amount;
    const rows = [];
    for (const lot of (silo.currentLots||[])) {
      if (remaining <= 0) break;
      const deduct = Math.min(lot.qty, remaining);
      rows.push({ lotNo: lot.lotNo, deduct, before: lot.qty, after: lot.qty - deduct });
      remaining -= deduct;
    }
    if (remaining > 0) {
      detail.innerHTML = `<div style="color:#ef4444">사일로 재고 부족! 현재 ${formatNum(amount-remaining)}kg만 차감 가능합니다.</div>`;
      preview.style.display = 'block';
      return;
    }
    detail.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr style="color:var(--text-muted)"><th>차감순서</th><th>LOT</th><th>차감량</th><th>잔량</th></tr>
        ${rows.map((r,i) => `<tr>
          <td style="padding:3px 6px">${i+1}</td>
          <td style="padding:3px 6px;font-family:monospace">${r.lotNo}</td>
          <td style="padding:3px 6px;color:#10b981">${formatNum(r.deduct)}kg</td>
          <td style="padding:3px 6px;color:${r.after===0?'#ef4444':'inherit'}">${formatNum(r.after)}kg</td>
        </tr>`).join('')}
      </table>
    `;
    preview.style.display = 'block';
  };

  const submitConsume = () => {
    const siloId = document.getElementById('consume-silo')?.value;
    const amount = parseFloat(document.getElementById('consume-amount')?.value);
    const actor  = document.getElementById('consume-actor')?.value || '생산팀';
    if (!siloId || !amount || amount <= 0) { App.toast('사일로와 투입량을 입력해주세요', 'error'); return; }
    try {
      const consumed = DB.consumeFromSiloFIFO(siloId, amount, actor);
      closeModal('consume-modal');
      App.toast(`FIFO 차감 완료 (${consumed.length}개 LOT)`, 'success');
      App.refreshPage();
    } catch(e) { App.toast(e.message, 'error'); }
  };

  // ── 로스 등록 모달 ──
  const openLossModal = (siloId) => {
    const silos = DB.getSilos();
    const body  = document.getElementById('loss-modal-body');
    if (!body) return;
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div class="form-group">
          <label class="form-label">사일로 선택</label>
          <select class="form-input" id="loss-silo" onchange="SiloPage.updateLossLots()">
            ${silos.map(s => `<option value="${s.id}" ${s.id===siloId?'selected':''}>${s.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">LOT 선택</label>
          <select class="form-input" id="loss-lot">
            ${siloId ? (DB.getSiloById(siloId)?.currentLots||[]).map(l=>`<option value="${l.lotNo}">${l.lotNo} (${formatNum(l.qty)}kg)</option>`).join('') : ''}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">로스 유형</label>
          <select class="form-input" id="loss-type">
            <option value="분진">분진</option>
            <option value="이송잔량">이송잔량</option>
            <option value="샘플채취">샘플채취</option>
            <option value="폐기">폐기</option>
            <option value="기타">기타</option>
          </select>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">수량 (kg)</label>
            <input type="number" class="form-input" id="loss-qty" placeholder="0" min="0">
          </div>
          <div class="form-group">
            <label class="form-label">담당자</label>
            <input type="text" class="form-input" id="loss-actor" value="관리자">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">사유</label>
          <input type="text" class="form-input" id="loss-reason" placeholder="로스 발생 사유 입력">
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="SiloPage.closeModal('loss-modal')">취소</button>
          <button class="btn btn-danger" onclick="SiloPage.submitLoss()">로스 등록</button>
        </div>
      </div>
    `;
    document.getElementById('loss-modal').classList.add('open');
  };

  const updateLossLots = () => {
    const siloId = document.getElementById('loss-silo')?.value;
    const el = document.getElementById('loss-lot');
    if (!el || !siloId) return;
    const silo = DB.getSiloById(siloId);
    el.innerHTML = (silo?.currentLots||[]).map(l=>`<option value="${l.lotNo}">${l.lotNo} (${formatNum(l.qty)}kg)</option>`).join('');
  };

  const submitLoss = () => {
    const siloId   = document.getElementById('loss-silo')?.value;
    const lotNo    = document.getElementById('loss-lot')?.value;
    const lossType = document.getElementById('loss-type')?.value;
    const qty      = parseFloat(document.getElementById('loss-qty')?.value);
    const reason   = document.getElementById('loss-reason')?.value || '';
    const actor    = document.getElementById('loss-actor')?.value || '관리자';
    if (!siloId || !qty || qty <= 0) { App.toast('사일로와 수량을 입력해주세요', 'error'); return; }
    DB.addLoss({ siloId, lotNo, lossType, qty, reason, actor });
    closeModal('loss-modal');
    App.toast(`로스 등록 완료 (${lossType} ${formatNum(qty)}kg)`, 'success');
    App.refreshPage();
  };

  // ── 사일로 배정 모달 ──
  const openAssignModal = (receivingId) => {
    const r = DB.getReceivingById(receivingId);
    if (!r) return;
    const body = document.getElementById('assign-modal-body');
    if (!body) return;
    const compatSilos = DB.getSilos().filter(s => s.factory === r.factory);
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div class="info-box info-blue">
          <strong>${r.materialName}</strong> / ${formatNum(r.actualWeight||r.expectedWeight)}kg / LOT: ${r.lotNo||'-'}
        </div>
        <div class="form-group">
          <label class="form-label">배정 사일로 선택</label>
          <select class="form-input" id="assign-silo">
            ${compatSilos.map(s => {
              const sum = DB.getSiloCapacitySummary(s);
              return `<option value="${s.id}">${s.name} — ${sum.pct}% 사용중 (여유: ${formatNum(s.maxCapacity-sum.totalQty)}kg)</option>`;
            }).join('')}
          </select>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="SiloPage.closeModal('assign-modal')">취소</button>
          <button class="btn btn-primary" onclick="SiloPage.submitAssign('${receivingId}')">배정 확정</button>
        </div>
      </div>
    `;
    document.getElementById('assign-modal').classList.add('open');
  };

  const submitAssign = (receivingId) => {
    const siloId = document.getElementById('assign-silo')?.value;
    if (!siloId) return;
    const r = DB.getReceivingById(receivingId);
    if (!r) return;
    DB.assignLotToSilo(siloId, {
      lotNo: r.lotNo || r.id.slice(0,10),
      receivingId, materialCode: r.materialCode, materialName: r.materialName,
      qty: r.actualWeight || r.expectedWeight, inDate: r.receivedDate, actor: '관리자'
    });
    DB.updateReceiving(receivingId, { siloId, status: 'IN_STOCK' });
    closeModal('assign-modal');
    App.toast('사일로 배정 완료!', 'success');
    App.refreshPage();
  };

  const afterRender = () => {};

  return { render, afterRender, setView, showDetail, openConsumeModal, updateFIFOPreview, submitConsume, openLossModal, updateLossLots, submitLoss, openAssignModal, submitAssign, closeModal };
})();
