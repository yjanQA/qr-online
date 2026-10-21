// ============================================================
// outbound.js — 출고 관리 페이지
// ============================================================

const OutboundPage = (() => {
  let preselectedCode = '';
  let preselectedBin  = '';

  const render = (materialCode, binLocation) => {
    preselectedCode = materialCode || '';
    preselectedBin  = binLocation  || '';
    const list = DB.getOutbounds().slice().reverse();
    const today = new Date().toISOString().split('T')[0];
    const todayOut = list.filter(o => o.outboundDate === today);

    return `
      <div class="fade-in">
        <!-- 오늘 통계 -->
        <div class="kpi-grid mb-20" style="grid-template-columns:repeat(3,1fr)">
          <div class="kpi-card" style="--kpi-color:var(--purple)">
            <div class="kpi-label">오늘 출고</div>
            <div class="kpi-value">${todayOut.length}</div>
            <div class="kpi-sub">건</div>
            <div class="kpi-icon"></div>
          </div>
          <div class="kpi-card" style="--kpi-color:var(--accent)">
            <div class="kpi-label">오늘 출고량</div>
            <div class="kpi-value">${todayOut.reduce((s,o)=>s+o.qty,0).toLocaleString()}</div>
            <div class="kpi-sub">EA</div>
            <div class="kpi-icon"></div>
          </div>
          <div class="kpi-card" style="--kpi-color:var(--success)">
            <div class="kpi-label">총 출고 건수</div>
            <div class="kpi-value">${list.length}</div>
            <div class="kpi-sub">누적</div>
            <div class="kpi-icon"></div>
          </div>
        </div>

        <div class="flex items-center justify-between mb-20">
          <div class="text-sm text-muted">전체 출고 이력</div>
          <button class="btn btn-primary" onclick="OutboundPage.openOutboundModal()">출고 처리</button>
        </div>

        ${list.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon"></div>
            <h3>출고 이력이 없습니다</h3>
            <p>출고 처리 버튼을 눌러 시작하세요</p>
          </div>` : `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>출고번호</th>
                  <th>구분</th>
                  <th>코드</th>
                  <th>품명</th>
                  <th>출고처</th>
                  <th class="td-right">수량</th>
                  <th class="td-right">중량(kg)</th>
                  <th>출고일</th>
                  <th>처리자</th>
                  <th>서류</th>
                </tr>
              </thead>
              <tbody>
                ${list.map(o => {
                  const isProd = o.kind === 'PRODUCT';
                  const code = isProd ? (o.productCode || '') : o.materialCode;
                  const name = isProd ? (o.productName || o.fgLotNo || '') : o.materialName;
                  return `
                  <tr>
                    <td><span class="td-mono">${o.id.slice(0,14)}...</span></td>
                    <td>${isProd ? '<span class="badge badge-info">완제품</span>' : '<span class="badge badge-default">원료</span>'}</td>
                    <td><span class="td-mono">${code || '-'}</span></td>
                    <td><strong>${name}</strong>${isProd && o.fgLotNo ? ` <span class="text-xs text-muted">${o.fgLotNo}</span>` : ''}</td>
                    <td>${o.destination || '-'}</td>
                    <td class="td-right">${o.qty?.toLocaleString()}${isProd ? '' : ' EA'}</td>
                    <td class="td-right">${o.weight?.toLocaleString()}</td>
                    <td>${o.outboundDate}</td>
                    <td class="text-sm text-muted">${o.processedBy}</td>
                    <td>${isProd && code ? `<button class="btn btn-ghost btn-xs" onclick="FeedCertPrint.open('${code}','${o.factory || ''}')" title="사료성분등록증 인쇄">등록증</button>` : '<span class="text-muted">-</span>'}</td>
                  </tr>`; }).join('')}
              </tbody>
            </table>
          </div>`}
      </div>

      <!-- 출고 모달 -->
      <div class="modal-overlay" id="outbound-modal">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title">출고 처리</div>
            <button class="modal-close" onclick="OutboundPage.closeModal()">✕</button>
          </div>
          <div id="outbound-modal-body"></div>
        </div>
      </div>
    `;
  };

  const openOutboundModal = () => {
    const today = new Date().toISOString().split('T')[0];
    const invList = DB.getInventory();

    // 제품 출고 대상 — 아직 잔량이 남은 제품 LOT
    const fgList = (DB.getProductStockRows('ALL') || []).filter(p => p.remaining > 0);

    document.getElementById('outbound-modal-body').innerHTML = `
      <div class="form-group mb-16">
        <label class="form-label">출고 구분</label>
        <div class="out-kind">
          <label><input type="radio" name="out-kind" value="MATERIAL" checked onchange="OutboundPage.setKind('MATERIAL')"> 원료·부자재</label>
          <label><input type="radio" name="out-kind" value="PRODUCT" onchange="OutboundPage.setKind('PRODUCT')"> 완제품</label>
        </div>
      </div>

      <div class="form-group mb-16" id="out-mat-wrap">
        <label class="form-label">재고 선택 <span class="required">*</span></label>
        <select class="form-select" id="out-inv" onchange="OutboundPage.onSelectInv(this.value)">
          <option value="">-- 선택하세요 --</option>
          ${invList.map(i => `
            <option value="${i.materialCode}|${i.binLocation}" ${(preselectedCode === i.materialCode && preselectedBin === i.binLocation) ? 'selected' : ''}>
              ${i.materialName} (${i.materialCode}) · ${i.binLocation} · 재고 ${i.qty?.toLocaleString()} EA
            </option>`).join('')}
        </select>
      </div>

      <div class="form-group mb-16 hidden" id="out-fg-wrap">
        <label class="form-label">제품 LOT 선택 <span class="required">*</span></label>
        <select class="form-select" id="out-fg">
          <option value="">-- 선택하세요 --</option>
          ${fgList.map(p => `
            <option value="${p.id}">
              ${p.productName} · ${p.fgLotNo} · 잔량 ${Number(p.remaining).toLocaleString()}${p.unit || 'kg'}
            </option>`).join('')}
        </select>
        ${fgList.length ? '<div style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" onclick="OutboundPage.printCert()">사료성분등록증 미리보기 · 인쇄</button> <span class="text-xs text-muted">출고 제품과 함께 동봉</span></div>' : '<div class="form-hint">출고할 수 있는 제품 LOT이 없습니다. 배합·생산LOT 화면에서 먼저 제품LOT을 등록하세요.</div>'}
      </div>
      <div id="inv-info" class="hidden mb-16"></div>

      <div class="form-grid form-grid-2" style="gap:12px">
        <div class="form-group">
          <label class="form-label">출고 수량 <span class="required">*</span></label>
          <input type="number" class="form-input" id="out-qty" placeholder="0" min="1"
            oninput="OutboundPage.calcWeight(this.value)">
        </div>
        <div class="form-group">
          <label class="form-label">출고 중량 (kg)</label>
          <input type="number" class="form-input" id="out-weight" placeholder="자동계산" step="0.001">
        </div>
        <div class="form-group">
          <label class="form-label">출고처</label>
          <input type="text" class="form-input" id="out-dest" placeholder="공장명, 부서명 등">
        </div>
        <div class="form-group">
          <label class="form-label">출고 목적</label>
          <select class="form-select" id="out-purpose">
            <option>생산 투입</option>
            <option>반품</option>
            <option>폐기</option>
            <option>이동</option>
            <option>기타</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">출고일</label>
          <input type="date" class="form-input" id="out-date" value="${today}">
        </div>
        <div class="form-group">
          <label class="form-label">요청자</label>
          <input type="text" class="form-input" id="out-requester" placeholder="생산팀 홍길동">
        </div>
      </div>
      <div class="form-group mt-12">
        <label class="form-label">처리자</label>
        <input type="text" class="form-input" id="out-processor" placeholder="창고 담당자">
      </div>

      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="OutboundPage.closeModal()">취소</button>
        <button class="btn btn-primary" onclick="OutboundPage.submitOutbound()">출고 확정</button>
      </div>
    `;

    // 미리 선택된 재고가 있으면 정보 표시
    if (preselectedCode) {
      setTimeout(() => {
        const sel = document.getElementById('out-inv');
        if (sel) onSelectInv(sel.value);
      }, 100);
    }

    document.getElementById('outbound-modal').classList.add('open');
  };

  const onSelectInv = (val) => {
    const info = document.getElementById('inv-info');
    if (!val) { info.classList.add('hidden'); return; }
    const [code, bin] = val.split('|');
    const inv = DB.getInventory().find(i => i.materialCode === code && i.binLocation === bin);
    if (!inv) return;
    info.classList.remove('hidden');
    info.innerHTML = `
      <div class="card" style="background:var(--info-bg);border-color:var(--info)">
        <div class="flex justify-between text-sm">
          <span><strong>${inv.materialName}</strong></span>
          <span class="font-mono text-accent">${inv.materialCode}</span>
        </div>
        <div class="flex gap-16 mt-8 text-sm">
          <span>위치: <strong>${inv.binLocation}</strong></span>
          <span>재고: <strong>${inv.qty?.toLocaleString()} EA</strong></span>
          <span>중량: <strong>${inv.weight?.toLocaleString()} kg</strong></span>
        </div>
      </div>
    `;
    window._selectedInv = inv;
  };

  const calcWeight = (qty) => {
    if (!window._selectedInv) return;
    const inv = window._selectedInv;
    if (inv.qty > 0) {
      const unitWeight = inv.weight / inv.qty;
      const w = document.getElementById('out-weight');
      if (w) w.value = (unitWeight * qty).toFixed(3);
    }
  };

  // 원료/제품 전환 — 고르는 대상만 바뀌고 나머지 입력은 그대로 쓴다
  const setKind = (kind) => {
    document.getElementById('out-mat-wrap')?.classList.toggle('hidden', kind !== 'MATERIAL');
    document.getElementById('out-fg-wrap')?.classList.toggle('hidden', kind !== 'PRODUCT');
    document.getElementById('inv-info')?.classList.add('hidden');
    const q = document.getElementById('out-qty');
    if (q) q.placeholder = kind === 'PRODUCT' ? '출고 kg' : '0';
  };
  const currentKind = () => document.querySelector('input[name="out-kind"]:checked')?.value || 'MATERIAL';

  const submitOutbound = () => {
    if (currentKind() === 'PRODUCT') return submitProductOutbound();
    const sel = document.getElementById('out-inv')?.value;
    if (!sel) { App.toast('재고를 선택해주세요', 'error'); return; }
    const [code, bin] = sel.split('|');
    const qty = parseInt(document.getElementById('out-qty')?.value);
    if (!qty || qty <= 0) { App.toast('출고 수량을 입력해주세요', 'error'); return; }

    try {
      DB.addOutbound({
        materialCode: code,
        binLocation: bin,
        qty,
        weight: parseFloat(document.getElementById('out-weight')?.value) || qty,
        destination: document.getElementById('out-dest')?.value || '',
        purpose: document.getElementById('out-purpose')?.value || '',
        outboundDate: document.getElementById('out-date')?.value,
        requestedBy: document.getElementById('out-requester')?.value || '',
        processedBy:  document.getElementById('out-processor')?.value || '관리자'
      });
      preselectedCode = '';
      preselectedBin  = '';
      closeModal();
      App.toast('출고 처리 완료', 'success');
      App.refreshPage();
    } catch (e) {
      App.toast('출고 실패: ' + e.message, 'error');
    }
  };

  const submitProductOutbound = () => {
    const lotId = document.getElementById('out-fg')?.value;
    if (!lotId) { App.toast('제품 LOT을 선택해주세요', 'error'); return; }
    const qty = parseFloat(document.getElementById('out-qty')?.value);
    if (!qty || qty <= 0) { App.toast('출고 수량을 입력해주세요', 'error'); return; }
    try {
      DB.addProductOutbound({
        productLotId: lotId,
        qty,
        weight: parseFloat(document.getElementById('out-weight')?.value) || qty,
        destination: document.getElementById('out-dest')?.value || '',
        purpose: document.getElementById('out-purpose')?.value || '',
        outboundDate: document.getElementById('out-date')?.value,
        requestedBy: document.getElementById('out-requester')?.value || '',
        processedBy: document.getElementById('out-processor')?.value || '관리자',
      });
      closeModal();
      App.toast('제품 출고 처리 완료', 'success');
      App.refreshPage();
    } catch (e) {
      App.toast('출고 실패: ' + e.message, 'error');
    }
  };

  const closeModal = () => {
    document.getElementById('outbound-modal')?.classList.remove('open');
    window._selectedInv = null;
  };

  const afterRender = () => {
    if (preselectedCode) openOutboundModal();
  };

  // 출고 모달에서 선택한 제품 LOT의 사료성분등록증을 바로 연다
  const printCert = () => {
    const lotId = document.getElementById('out-fg')?.value;
    if (!lotId) { App.toast('먼저 제품 LOT을 선택하세요', 'warning'); return; }
    const lot = DB.getProductLots().find(p => p.id === lotId || p.fgLotNo === lotId);
    const code = lot && lot.productCode;
    if (!code) { App.toast('이 제품 LOT에 제품코드가 없습니다', 'warning'); return; }
    FeedCertPrint.open(code, (lot && lot.factory) || '');   // 이 LOT을 생산한 공장 등록번호로
  };

  return { render, afterRender, openOutboundModal, onSelectInv, calcWeight, setKind, submitOutbound, closeModal, printCert };
})();
