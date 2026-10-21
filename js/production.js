// ============================================================
// production.js — 투입지시 + 배합배치 + 제품LOT 통합 페이지
// ============================================================

const ProductionPage = (() => {
  let tab = 'orders';

  const statusBadge = (s) => {
    if (s==='PENDING') return `<span class="badge badge-warning">대기</span>`;
    if (s==='EXECUTING') return `<span class="badge badge-info">실행중</span>`;
    if (s==='DONE') return `<span class="badge badge-pass">완료</span>`;
    return `<span class="badge badge-default">${s}</span>`;
  };

  const render = () => {
    const orders  = DB.getProductionOrders().slice().reverse();
    const pending = orders.filter(o => o.status === 'PENDING');
    return `
      <div class="fade-in">
        <div class="flex items-center justify-between mb-20">
          <div class="text-sm text-muted">투입지시 ${orders.length}건 (대기: ${pending.length}건)</div>
          <button class="btn btn-primary btn-sm" onclick="ProductionPage.openAddModal()">＋ 투입지시 등록</button>
        </div>

        ${typeof StockLevel !== 'undefined' ? StockLevel.productionBanner() : ''}

        ${pending.length > 0 ? `
        <div class="info-box info-warning mb-16">
          대기 중인 투입지시 ${pending.length}건이 있습니다. FIFO 차감을 실행해주세요.
        </div>` : ''}

        <div class="card">
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>지시번호</th><th>공장</th><th>사일로</th><th>원료</th>
                  <th class="td-right">지시량(kg)</th><th>제품코드</th><th>제품명</th><th>상태</th>
                  <th>등록일시</th><th>액션</th>
                </tr>
              </thead>
              <tbody>
                ${orders.length === 0 ? `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted)">등록된 투입지시가 없습니다</td></tr>` :
                orders.map(o => `
                <tr>
                  <td><span class="td-mono text-xs">${o.id}</span></td>
                  <td>${DB.getFactoryName(o.factory)}</td>
                  <td><span class="badge badge-default">${o.siloId}</span></td>
                  <td>${o.materialName}</td>
                  <td class="td-right font-bold">${formatNum(o.amount)}</td>
                  <td><span class="td-mono text-xs">${o.productCode || '-'}</span></td>
                  <td>${o.productName||'-'}</td>
                  <td>${statusBadge(o.status)}</td>
                  <td class="text-xs text-muted">${formatDate(o.createdAt)}</td>
                  <td>
                    ${o.status==='PENDING'?`
                      <div style="display:flex;gap:4px">
                        <button class="btn btn-success btn-xs" onclick="ProductionPage.execute('${o.id}')">▶ FIFO 실행</button>
                        <button class="btn btn-ghost btn-xs" onclick="ProductionPage.viewFIFOPreview('${o.id}')">미리보기</button>
                      </div>` :
                    o.status==='DONE' ? `<button class="btn btn-ghost btn-xs" onclick="ProductionPage.viewResult('${o.id}')">결과보기</button>` : ''}
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- 등록 모달 -->
        <div class="modal-overlay" id="prod-add-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title">투입지시 등록</div>
              <button class="modal-close" onclick="ProductionPage.closeModal('prod-add-modal')">✕</button>
            </div>
            <div id="prod-add-body"></div>
          </div>
        </div>

        <!-- 결과 모달 -->
        <div class="modal-overlay" id="prod-result-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title">FIFO 차감 결과</div>
              <button class="modal-close" onclick="ProductionPage.closeModal('prod-result-modal')">✕</button>
            </div>
            <div id="prod-result-body"></div>
          </div>
        </div>
      </div>
    `;
  };

  const afterRender = () => {};

  const openAddModal = () => {
    const body = document.getElementById('prod-add-body');
    if (!body) return;
    const factories = DB.getFactories();
    // 초기 공장: 상단 공장선택이 특정 공장이면 그 공장, 아니면 첫 공장 — 사일로 목록도 같은 공장으로 일치시킴
    const curFactory = (App.getFactory && App.getFactory() !== 'ALL') ? App.getFactory() : (factories[0] ? factories[0].id : '');
    const silos    = DB.getSilosByFactory(curFactory);
    const productOptions = DB.getProducts().slice(0,300).map(p=>`<option value="${p.code}">${p.code} - ${p.name}`).join('');
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">공장</label>
            <select class="form-input" id="po-factory" onchange="ProductionPage.onFactoryChange()">
              ${factories.map(f=>`<option value="${f.id}" ${f.id===curFactory?'selected':''}>${f.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">사일로</label>
            <select class="form-input" id="po-silo" onchange="ProductionPage.onSiloChange()">
              ${silos.map(s=>{
                const sum = DB.getSiloCapacitySummary(s);
                return `<option value="${s.id}">${s.name} (${formatNum(sum.totalQty)}kg)</option>`;
              }).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">원료명 (자동)</label>
          <input type="text" class="form-input" id="po-material" readonly style="background:var(--bg-card)">
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">투입량 (kg) *</label>
            <input type="number" class="form-input" id="po-amount" placeholder="0" min="0">
          </div>
          <div class="form-group">
            <label class="form-label">제품코드</label>
            <input type="text" class="form-input" id="po-product-code" list="po-product-code-list" placeholder="제품코드">
            <datalist id="po-product-code-list">${productOptions}</datalist>
          </div>
        </div>
        <div class="form-group">
            <label class="form-label">제품명</label>
            <input type="text" class="form-input" id="po-product" placeholder="예) 육계 선진L">
        </div>
        <div class="form-group">
          <label class="form-label">담당자</label>
          <input type="text" class="form-input" id="po-actor" value="생산팀">
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="ProductionPage.closeModal('prod-add-modal')">취소</button>
          <button class="btn btn-primary" onclick="ProductionPage.submitAdd()">투입지시 등록</button>
        </div>
      </div>
    `;
    // 초기 원료명 설정
    setTimeout(() => ProductionPage.onSiloChange(), 50);
    document.getElementById('prod-add-modal').classList.add('open');
  };

  const onFactoryChange = () => {
    const factory = document.getElementById('po-factory')?.value;
    const el = document.getElementById('po-silo');
    if (!el) return;
    const silos = DB.getSilosByFactory(factory);
    el.innerHTML = silos.map(s => {
      const sum = DB.getSiloCapacitySummary(s);
      return `<option value="${s.id}">${s.name} (${formatNum(sum.totalQty)}kg)</option>`;
    }).join('');
    onSiloChange();
  };

  const onSiloChange = () => {
    const siloId = document.getElementById('po-silo')?.value;
    const el = document.getElementById('po-material');
    if (!el || !siloId) return;
    const silo = DB.getSiloById(siloId);
    el.value = silo?.materialName || '';
  };

  const submitAdd = () => {
    const factory  = document.getElementById('po-factory')?.value;
    const siloId   = document.getElementById('po-silo')?.value;
    const amount   = parseFloat(document.getElementById('po-amount')?.value);
    const productCode = document.getElementById('po-product-code')?.value || '';
    const product  = document.getElementById('po-product')?.value || '';
    const actor    = document.getElementById('po-actor')?.value || '생산팀';
    const silo     = DB.getSiloById(siloId);
    if (!siloId || !amount || amount <= 0) { App.toast('사일로와 투입량은 필수입니다', 'error'); return; }
    try {
      DB.addProductionOrder({ factory, siloId, materialCode: silo?.materialCode||'', materialName: silo?.materialName||'', amount, productCode, productName: product, actor });
      closeModal('prod-add-modal');
      App.toast('투입지시 등록 완료', 'success');
      App.refreshPage();
    } catch(e) { App.toast(e.message, 'error'); }
  };

  const execute = (orderId) => {
    if (!confirm('FIFO 차감을 실행하시겠습니까?')) return;
    try {
      const result = DB.executeProductionOrder(orderId, '생산팀');
      App.toast(`FIFO 차감 완료 (${result.consumedLots?.length||0}개 LOT)`, 'success');
      App.refreshPage();
    } catch(e) { App.toast(e.message, 'error'); }
  };

  const viewFIFOPreview = (orderId) => {
    const order = DB.getProductionOrderById(orderId);
    if (!order) return;
    const silo  = DB.getSiloById(order.siloId);
    const body  = document.getElementById('prod-result-body');
    if (!body) return;
    let remaining = order.amount;
    const rows = [];
    for (const lot of (silo?.currentLots||[])) {
      if (remaining <= 0) break;
      const deduct = Math.min(lot.qty, remaining);
      rows.push({ lotNo: lot.lotNo, deduct, before: lot.qty, after: lot.qty - deduct });
      remaining -= deduct;
    }
    body.innerHTML = `
      <div style="padding:16px">
        <div class="info-box info-blue mb-12">
          <strong>${order.materialName}</strong> / ${formatNum(order.amount)}kg / ${silo?.name||order.siloId}
        </div>
        <div class="font-bold mb-8">FIFO 차감 순서 미리보기</div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>순서</th><th>LOT</th><th>차감량</th><th>잔량</th></tr></thead>
            <tbody>
              ${rows.map((r,i)=>`<tr>
                <td>${i+1}</td>
                <td><span class="td-mono">${r.lotNo}</span></td>
                <td style="color:#10b981">${formatNum(r.deduct)}kg</td>
                <td style="color:${r.after===0?'#ef4444':'inherit'}">${formatNum(r.after)}kg</td>
              </tr>`).join('')}
              ${remaining>0?`<tr><td colspan="4" style="color:#ef4444;text-align:center">재고 부족: ${formatNum(remaining)}kg 부족</td></tr>`:''}
            </tbody>
          </table>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="ProductionPage.closeModal('prod-result-modal')">닫기</button>
          <button class="btn btn-primary" onclick="ProductionPage.execute('${orderId}');ProductionPage.closeModal('prod-result-modal')">실행</button>
        </div>
      </div>
    `;
    document.getElementById('prod-result-modal').classList.add('open');
  };

  const viewResult = (orderId) => {
    const order = DB.getProductionOrderById(orderId);
    if (!order) return;
    const body  = document.getElementById('prod-result-body');
    if (!body) return;
    body.innerHTML = `
      <div style="padding:16px">
        <div class="info-box info-blue mb-12">투입 완료: <strong>${order.materialName}</strong> ${formatNum(order.amount)}kg</div>
        <div class="font-bold mb-8">실제 차감 내역</div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>LOT</th><th>차감량</th><th>차감 전</th><th>차감 후</th></tr></thead>
            <tbody>
              ${(order.consumedLots||[]).map(c=>`<tr>
                <td><span class="td-mono">${c.lotNo}</span></td>
                <td style="color:#10b981">${formatNum(c.deducted)}kg</td>
                <td>${formatNum(c.before)}kg</td>
                <td style="color:${c.after===0?'#ef4444':'inherit'}">${formatNum(c.after)}kg</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="ProductionPage.closeModal('prod-result-modal')">닫기</button>
        </div>
      </div>
    `;
    document.getElementById('prod-result-modal').classList.add('open');
  };

  const closeModal = (id) => document.getElementById(id)?.classList.remove('open');

  return { render, afterRender, openAddModal, onFactoryChange, onSiloChange, submitAdd, execute, viewFIFOPreview, viewResult, closeModal };
})();
