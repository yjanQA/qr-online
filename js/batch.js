// ============================================================
// batch.js — 배합 배치 + 제품 LOT 관리
// ============================================================

const BatchPage = (() => {
  let tab = 'batch';  // batch / product

  const render = () => {
    const batches  = DB.getBatches().slice().reverse();
    const products = DB.getProductLots().slice().reverse();
    return `
      <div class="fade-in">
        ${typeof StockLevel !== 'undefined' ? StockLevel.productionBanner() : ''}
        <div class="tabs mb-16">
          <div class="tab ${tab==='batch'?'active':''}" onclick="BatchPage.setTab('batch')">배합 배치 (${batches.length})</div>
          <div class="tab ${tab==='product'?'active':''}" onclick="BatchPage.setTab('product')">제품 LOT (${products.length})</div>
        </div>

        ${tab === 'batch' ? renderBatches(batches) : renderProducts(products)}

        <!-- 배합 등록 모달 -->
        <div class="modal-overlay" id="batch-add-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title">배합 배치 등록</div>
              <button class="modal-close" onclick="BatchPage.closeModal('batch-add-modal')">✕</button>
            </div>
            <div id="batch-add-body"></div>
          </div>
        </div>

        <!-- 제품LOT 등록 모달 -->
        <div class="modal-overlay" id="product-add-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title">제품 LOT 등록</div>
              <button class="modal-close" onclick="BatchPage.closeModal('product-add-modal')">✕</button>
            </div>
            <div id="product-add-body"></div>
          </div>
        </div>

        <!-- 상세 모달 -->
        <div class="modal-overlay" id="batch-detail-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title">배합 상세</div>
              <button class="modal-close" onclick="BatchPage.closeModal('batch-detail-modal')">✕</button>
            </div>
            <div id="batch-detail-body"></div>
          </div>
        </div>
      </div>
    `;
  };

  const renderBatches = (batches) => `
    <div class="flex justify-between items-center mb-12">
      <div class="text-sm text-muted">총 ${batches.length}건</div>
      <button class="btn btn-primary btn-sm" onclick="BatchPage.openBatchModal()">＋ 배합 등록</button>
    </div>
    <div class="card">
      <div class="table-wrapper">
        <table>
          <thead><tr><th>배치코드</th><th>공장</th><th>제품코드</th><th>제품명</th><th class="td-right">총량(kg)</th><th>소비LOT</th><th>제품LOT</th><th>배합일시</th><th>액션</th></tr></thead>
          <tbody>
            ${batches.length===0?`<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-muted)">배합 배치가 없습니다</td></tr>`:
            batches.map(b=>`<tr>
              <td><span class="td-mono text-xs">${b.batchCode}</span></td>
              <td>${DB.getFactoryName(b.factory)}</td>
              <td><span class="td-mono text-xs">${b.productCode || '-'}</span></td>
              <td><strong>${b.productName}</strong></td>
              <td class="td-right">${formatNum(b.totalQty)}</td>
              <td class="td-center">${(b.consumedLots||[]).length}개</td>
              <td>${b.productLotId?`<span class="badge badge-pass">연결됨</span>`:`<span class="badge badge-default">미연결</span>`}</td>
              <td class="text-xs text-muted">${formatDate(b.batchedAt)}</td>
              <td>
                <div style="display:flex;gap:4px">
                  <button class="btn btn-ghost btn-xs" onclick="BatchPage.showDetail('${b.id}')">상세</button>
                  ${!b.productLotId?`<button class="btn btn-success btn-xs" onclick="BatchPage.openProductModal('${b.id}')">제품LOT 등록</button>`:''}
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const renderProducts = (products) => `
    <div class="flex justify-between items-center mb-12">
      <div class="text-sm text-muted">총 ${products.length}건</div>
      <button class="btn btn-primary btn-sm" onclick="BatchPage.openProductModal()">＋ 제품LOT 등록</button>
    </div>
    <div class="card">
      <div class="table-wrapper">
        <table>
          <thead><tr><th>제품LOT</th><th class="qr-only">QR키</th><th>공장</th><th>제품코드</th><th>제품명</th><th class="td-right">수량(kg)</th><th>포장형태</th><th>포장수</th><th>생산일</th><th>상태</th><th>액션</th></tr></thead>
          <tbody>
            ${products.length===0?`<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text-muted)">제품 LOT가 없습니다</td></tr>`:
            products.map(p=>`<tr>
              <td><span class="td-mono text-xs">${p.fgLotNo}</span></td>
              <td class="qr-only"><span class="td-mono text-xs">${p.qrCode || DB.makeQRValue('PRODUCT_LOT', p.fgLotNo)}</span></td>
              <td>${DB.getFactoryName(p.factory)}</td>
              <td><span class="td-mono text-xs">${p.productCode || '-'}</span></td>
              <td><strong>${p.productName}</strong></td>
              <td class="td-right">${formatNum(p.qty)}</td>
              <td>${p.packType}</td>
              <td class="td-center">${formatNum(p.packCount)}개</td>
              <td>${p.productionDate||'-'}</td>
              <td><span class="badge ${p.status==='AVAILABLE'?'badge-pass':p.status==='SHIPPED'?'badge-info':'badge-default'}">${p.status==='AVAILABLE'?'사용가능':p.status==='SHIPPED'?'출하완료':p.status}</span></td>
              <td>
                <button class="btn btn-ghost btn-xs" onclick="App.navigate('voc');setTimeout(()=>VOCPage.prefill('${p.fgLotNo}','${p.productName}','${p.productCode || ''}'),200)">VOC</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const setTab = (t) => { tab = t; App.refreshPage(); };

  const openBatchModal = () => {
    const body = document.getElementById('batch-add-body');
    if (!body) return;
    const productOptions = DB.getProducts().slice(0,300).map(p=>`<option value="${p.code}">${p.code} - ${p.name}`).join('');
    // 상단에서 고른 공장을 기본값으로. 'ALL' 이면 첫 공장을 쓴다(투입지시 후보가 공장별로 갈린다)
    const curFac = (typeof App !== 'undefined' && App.getFactory && App.getFactory() !== 'ALL')
      ? App.getFactory() : (DB.getFactories()[0]?.id || 'AS');
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">공장</label>
            <select class="form-input" id="bat-factory">
              ${DB.getFactories().map(f=>`<option value="${f.id}" ${f.id===curFac?'selected':''}>${f.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">제품코드</label>
            <input type="text" class="form-input" id="bat-product-code" list="batch-product-code-list" placeholder="제품코드">
            <datalist id="batch-product-code-list">${productOptions}</datalist>
          </div>
        </div>
        <div class="form-group">
            <label class="form-label">제품명 *</label>
            <input type="text" class="form-input" id="bat-product" placeholder="예) 육계 선진L">
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">총 배합량 (kg) *</label>
            <input type="number" class="form-input" id="bat-qty" placeholder="0" min="0">
          </div>
          <div class="form-group">
            <label class="form-label">사용 배합비</label>
            <select class="form-input" id="bat-formula"><option value="">선택 안함</option></select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">투입지시 연결
            <span class="text-muted" style="font-weight:400;font-size:12px">— 이 배합에 들어간 투입지시를 고르면 원료 LOT이 함께 기록됩니다</span></label>
          <div id="bat-orders" class="bat-orders"></div>
          <div class="form-hint">연결하지 않으면 완제품에서 원료로 거슬러 올라가는 역추적이 불가능합니다.</div>
        </div>

        <div class="form-group">
          <label class="form-label">담당자</label>
          <input type="text" class="form-input" id="bat-actor" value="배합팀">
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="BatchPage.closeModal('batch-add-modal')">취소</button>
          <button class="btn btn-primary" onclick="BatchPage.submitBatch()">배합 등록</button>
        </div>
      </div>
    `;
    document.getElementById('batch-add-modal').classList.add('open');
    document.getElementById('bat-factory').onchange = fillBatchPickers;
    document.getElementById('bat-product-code').oninput = fillBatchPickers;
    fillBatchPickers();
  };

  // 공장·제품에 맞는 배합비와 투입지시 후보를 채운다
  const fillBatchPickers = () => {
    const fac = document.getElementById('bat-factory')?.value || '';
    const code = (document.getElementById('bat-product-code')?.value || '').trim();

    const sel = document.getElementById('bat-formula');
    if (sel) {
      const recipes = (DB.getFormulaRecipes() || [])
        .filter(r => !code || r.productCode === code);
      const cur = sel.value;
      sel.innerHTML = '<option value="">선택 안함</option>' + recipes.map(r =>
        `<option value="${esc(r.id)}">${esc(r.formulaCode || r.productCode || '')} ${esc(r.productName || '')} ${esc(r.version || '')}</option>`).join('');
      if (recipes.some(r => r.id === cur)) sel.value = cur;
      else if (recipes.length === 1) sel.value = recipes[0].id;
    }

    const box = document.getElementById('bat-orders');
    if (!box) return;
    const orders = DB.getUnbatchedOrders(fac);
    box.innerHTML = orders.length ? orders.map(o => {
      const lots = (o.consumedLots || []).length;
      return `<label class="bat-order">
        <input type="checkbox" class="bat-order-cb" value="${esc(o.id)}">
        <span style="flex:1;min-width:0">
          <b>${esc(o.materialName || o.materialCode || '-')}</b>
          <span class="text-muted"> ${formatNum(o.amount)}kg · ${esc(o.siloId || '')}</span>
          <span class="text-xs text-muted" style="display:block">
            ${esc(String(o.executedAt || '').slice(0, 16).replace('T', ' '))}
            ${lots ? ` · 투입 LOT ${lots}건` : ' · 차감 LOT 없음'}</span>
        </span></label>`;
    }).join('') : '<div class="text-muted" style="font-size:12px;padding:8px 2px">연결할 수 있는 투입지시가 없습니다. 투입지시 화면에서 먼저 실행하세요.</div>';
  };

  const submitBatch = () => {
    const factory  = document.getElementById('bat-factory')?.value;
    const productCode = document.getElementById('bat-product-code')?.value.trim();
    const product  = document.getElementById('bat-product')?.value.trim();
    const qty      = parseFloat(document.getElementById('bat-qty')?.value);
    const actor    = document.getElementById('bat-actor')?.value || '배합팀';
    if (!product || !qty || qty <= 0) { App.toast('제품명과 배합량은 필수입니다', 'error'); return; }

    const orderIds = [...document.querySelectorAll('.bat-order-cb:checked')].map(c => c.value);
    const formulaId = document.getElementById('bat-formula')?.value || '';
    const recipe = formulaId ? (DB.getFormulaRecipes() || []).find(r => r.id === formulaId) : null;
    // 배합비를 고르면 그 구성비를 배치 시점 스냅샷으로 남긴다(배합비는 나중에 개정될 수 있다)
    const formula = recipe ? (recipe.ingredients || []).map(g => ({
      materialCode: g.materialCode, materialName: g.materialName,
      pct: g.pct, qty: Math.round((Number(g.pct) || 0) * qty) / 100,
    })) : [];

    if (!orderIds.length && !confirm('투입지시를 연결하지 않으면 이 배합에서 원료로 거슬러 올라갈 수 없습니다.\n그래도 등록할까요?')) return;

    DB.addBatch({
      factory, productCode, productName: product, totalQty: qty, actor,
      orderIds, formulaId, formulaCode: recipe?.formulaCode || '', formula,
    });
    closeModal('batch-add-modal');
    App.toast(orderIds.length ? `배합 등록 완료 · 투입지시 ${orderIds.length}건 연결` : '배합 배치 등록 완료', 'success');
    App.refreshPage();
  };

  const openProductModal = (batchId) => {
    const body = document.getElementById('product-add-body');
    if (!body) return;
    const batch = batchId ? DB.getBatchById(batchId) : null;
    const productOptions = DB.getProducts().slice(0,300).map(p=>`<option value="${p.code}">${p.code} - ${p.name}`).join('');
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        ${batch ? `<div class="info-box info-blue">배합배치: <strong>${batch.batchCode}</strong> / ${batch.productName} / ${formatNum(batch.totalQty)}kg</div>` : ''}
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">공장</label>
            <select class="form-input" id="fg-factory" onchange="BatchPage.stockHint()">
              ${DB.getFactories().map(f=>`<option value="${f.id}" ${batch?.factory===f.id?'selected':''}>${f.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">제품코드</label>
            <input type="text" class="form-input" id="fg-product-code" list="fg-product-code-list" value="${batch?.productCode||''}" placeholder="제품코드" onchange="BatchPage.stockHint()">
            <datalist id="fg-product-code-list">${productOptions}</datalist>
          </div>
        </div>
        <div class="form-group">
            <label class="form-label">제품명 *</label>
            <input type="text" class="form-input" id="fg-product" value="${batch?.productName||''}" placeholder="예) 육계 선진L">
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">수량 (kg) *</label>
            <input type="number" class="form-input" id="fg-qty" value="${batch?.totalQty||''}" placeholder="0">
          </div>
          <div class="form-group">
            <label class="form-label">포장형태</label>
            <select class="form-input" id="fg-pack" onchange="BatchPage.stockHint()">
              <option value="20kg포대">20kg 포대</option>
              <option value="25kg포대">25kg 포대</option>
              <option value="1t톤백">1t 톤백</option>
              <option value="벌크">벌크</option>
            </select>
          </div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">포장 수량 (개)</label>
            <input type="number" class="form-input" id="fg-packcount" placeholder="0">
          </div>
          <div class="form-group">
            <label class="form-label">생산일자</label>
            <input type="date" class="form-input" id="fg-date" value="${new Date().toLocaleDateString('sv-SE')}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">담당자</label>
          <input type="text" class="form-input" id="fg-actor" value="포장팀">
        </div>
        <div id="fg-stock-hint"></div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="BatchPage.closeModal('product-add-modal')">취소</button>
          <button class="btn btn-primary" onclick="BatchPage.submitProduct('${batchId||''}')">제품LOT 등록</button>
        </div>
      </div>
    `;
    document.getElementById('product-add-modal').classList.add('open');
    stockHint();
  };

  // 고른 제품·포장의 재고 적정성(부족/과재고)을 등록 창 안에 보여준다
  const stockHint = () => {
    const el = document.getElementById('fg-stock-hint');
    if (!el || typeof StockLevel === 'undefined') return;
    const v = (id) => document.getElementById(id)?.value.trim() || '';
    try { el.innerHTML = StockLevel.hintFor(v('fg-factory'), v('fg-product-code'), v('fg-product'), v('fg-pack')); }
    catch (_) { el.innerHTML = ''; }
  };

  const submitProduct = (batchId) => {
    const factory   = document.getElementById('fg-factory')?.value;
    const productCode = document.getElementById('fg-product-code')?.value.trim();
    const product   = document.getElementById('fg-product')?.value.trim();
    const qty       = parseFloat(document.getElementById('fg-qty')?.value);
    const packType  = document.getElementById('fg-pack')?.value;
    const packCount = parseInt(document.getElementById('fg-packcount')?.value)||0;
    const date      = document.getElementById('fg-date')?.value;
    const actor     = document.getElementById('fg-actor')?.value || '포장팀';
    if (!product || !qty || qty <= 0) { App.toast('제품명과 수량은 필수입니다', 'error'); return; }
    DB.addProductLot({ factory, productCode, productName: product, batchId, qty, packType, packCount, productionDate: date, actor });
    closeModal('product-add-modal');
    App.toast('제품 LOT 등록 완료', 'success');
    App.refreshPage();
  };

  const showDetail = (batchId) => {
    const batch = DB.getBatchById(batchId);
    if (!batch) return;
    const body = document.getElementById('batch-detail-body');
    if (!body) return;
    body.innerHTML = `
      <div style="padding:16px">
        <div class="info-grid-2 mb-12">
          <div><div class="info-label">배치코드</div><div class="info-value font-mono">${batch.batchCode}</div></div>
          <div><div class="info-label">공장</div><div class="info-value">${DB.getFactoryName(batch.factory)}</div></div>
          <div><div class="info-label">제품명</div><div class="info-value">${batch.productName}</div></div>
          <div><div class="info-label">총량</div><div class="info-value">${formatNum(batch.totalQty)}kg</div></div>
          ${batch.formulaCode ? `<div><div class="info-label">배합비</div><div class="info-value font-mono">${esc(batch.formulaCode)}</div></div>` : ''}
          ${(batch.orderIds||[]).length ? `<div><div class="info-label">투입지시</div><div class="info-value">${batch.orderIds.length}건 연결</div></div>` : ''}
        </div>
        ${(batch.consumedLots||[]).length>0?`
        <div class="font-bold mb-8">투입 원료 LOT</div>
        <div class="table-wrapper">
          <table><thead><tr><th>원료</th><th>LOT번호</th><th>사일로</th><th class="td-right">투입량</th><th>입고 역추적</th></tr></thead>
          <tbody>${batch.consumedLots.map(l=>{
            // 수량 필드는 FIFO 차감 결과가 deducted, 수기 입력분이 qty 로 들어온다
            const q = l.deducted ?? l.qty ?? 0;
            const r = l.receivingId ? DB.getReceivingById(l.receivingId) : null;
            return `<tr>
              <td>${esc(l.materialName || l.materialCode || '-')}</td>
              <td class="font-mono text-xs">${esc(l.lotNo || '-')}</td>
              <td>${esc(l.siloId||'-')}</td>
              <td class="td-right">${formatNum(q)}kg</td>
              <td>${r ? `<button class="btn btn-ghost btn-xs" onclick="BatchPage.traceLot('${esc(l.receivingId)}')">${esc(r.supplierName || '입고건')} 보기</button>`
                      : '<span class="text-xs text-muted">입고 연결 없음</span>'}</td>
            </tr>`;
          }).join('')}</tbody></table>
        </div>`:'<div class="text-muted text-sm">투입 LOT 정보가 없습니다. 배합 등록 시 투입지시를 연결하면 기록됩니다.</div>'}
        <div class="modal-footer"><button class="btn btn-ghost" onclick="BatchPage.closeModal('batch-detail-modal')">닫기</button></div>
      </div>
    `;
    document.getElementById('batch-detail-modal').classList.add('open');
  };

  // 투입 LOT 에서 그 원료가 들어온 입고건으로 이동 — 역추적의 마지막 한 칸
  //   원료 추적 화면은 QR 코드 문자열로 조회하므로 입고건의 qrCode 를 넘긴다.
  const traceLot = (receivingId) => {
    const r = DB.getReceivingById(receivingId);
    if (!r) { App.toast('입고건을 찾을 수 없습니다', 'warning'); return; }
    closeModal('batch-detail-modal');
    App.navigate('history');
    setTimeout(() => {
      try {
        const input = document.getElementById('manual-id');
        if (input) input.value = r.qrCode || r.id;
        HistoryPage.searchById(r.qrCode || r.id);
      } catch (_) {}
    }, 150);
  };

  const closeModal = (id) => document.getElementById(id)?.classList.remove('open');

  return { render, afterRender: () => {}, setTab, openBatchModal, submitBatch, openProductModal, submitProduct, showDetail, traceLot, closeModal, stockHint };
})();
