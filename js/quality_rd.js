// ============================================================
// quality_rd.js — 원료/제품 분석 데이터
// ============================================================

const QualityRDPage = (() => {
  let tab = 'raw';

  const verdictBadge = (v) => {
    if (v === 'FAIL') return '<span class="badge badge-fail">부적합</span>';
    if (v === 'CONDITIONAL') return '<span class="badge badge-warning">조건부</span>';
    return '<span class="badge badge-pass">적합</span>';
  };

  const render = () => {
    const raw = DB.getRawAnalyses().slice().reverse();
    const product = DB.getProductAnalyses().slice().reverse();
    return `
      <div class="fade-in">
        <div class="module-hero mb-20">
          <div>
            <div class="module-kicker">품질 · R&D</div>
            <h2>분석 데이터 관리</h2>
            <p>입고 원료와 생산 제품의 분석값, 판정, 특이사항을 분리해 관리합니다.</p>
          </div>
          <div class="module-metrics">
            <div><span>${formatNum(raw.length)}</span><label>원료분석</label></div>
            <div><span>${formatNum(product.length)}</span><label>제품분석</label></div>
            <div><span>${formatNum(raw.filter(x=>x.verdict==='FAIL').length + product.filter(x=>x.verdict==='FAIL').length)}</span><label>부적합</label></div>
          </div>
        </div>

        ${DiseaseAlert.render()}

        <div class="tabs mb-16">
          <div class="tab ${tab==='raw'?'active':''}" onclick="QualityRDPage.setTab('raw')">원료분석 데이터</div>
          <div class="tab ${tab==='product'?'active':''}" onclick="QualityRDPage.setTab('product')">제품분석 데이터</div>
        </div>

        ${tab === 'raw' ? renderRaw(raw) : renderProduct(product)}

        <div class="modal-overlay" id="analysis-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title" id="analysis-modal-title">분석 등록</div>
              <button class="modal-close" onclick="QualityRDPage.closeModal('analysis-modal')">✕</button>
            </div>
            <div id="analysis-modal-body"></div>
          </div>
        </div>
      </div>
    `;
  };

  const renderRaw = (rows) => `
    <div class="flex justify-between items-center mb-12">
      <div class="text-sm text-muted">입고 LOT 기준 원료 분석 ${rows.length}건</div>
      <button class="btn btn-primary btn-sm" onclick="QualityRDPage.openRawModal()">＋ 원료분석 등록</button>
    </div>
    <div class="card">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>분석일</th><th>원료</th><th>LOT</th><th>협력사</th>
              <th class="td-right">수분</th><th class="td-right">단백</th><th class="td-right">지방</th><th class="td-right">섬유</th><th class="td-right">회분</th>
              <th>판정</th><th>특이사항</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0 ? `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text-muted)">원료 분석 데이터가 없습니다</td></tr>` :
            rows.map(r => `<tr>
              <td class="text-xs text-muted">${formatDate(r.analyzedAt)}</td>
              <td><strong>${r.materialName || '-'}</strong><div class="td-mono text-xs text-muted">${r.materialCode || '-'}</div></td>
              <td><span class="td-mono text-xs">${r.lotNo || '-'}</span></td>
              <td>${r.supplierName || '-'}</td>
              <td class="td-right">${r.moisture || 0}%</td>
              <td class="td-right">${r.protein || 0}%</td>
              <td class="td-right">${r.fat || 0}%</td>
              <td class="td-right">${r.fiber || 0}%</td>
              <td class="td-right">${r.ash || 0}%</td>
              <td>${verdictBadge(r.verdict)}</td>
              <td>${r.memo || '-'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const renderProduct = (rows) => `
    <div class="flex justify-between items-center mb-12">
      <div class="text-sm text-muted">제품 LOT 기준 제품 분석 ${rows.length}건</div>
      <button class="btn btn-primary btn-sm" onclick="QualityRDPage.openProductModal()">＋ 제품분석 등록</button>
    </div>
    <div class="card">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>분석일</th><th>제품</th><th>제품LOT</th>
              <th class="td-right">수분</th><th class="td-right">단백</th><th class="td-right">지방</th><th class="td-right">섬유</th><th class="td-right">회분</th><th class="td-right">PDI</th>
              <th>판정</th><th>특이사항</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0 ? `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text-muted)">제품 분석 데이터가 없습니다</td></tr>` :
            rows.map(r => `<tr>
              <td class="text-xs text-muted">${formatDate(r.analyzedAt)}</td>
              <td><strong>${r.productName || '-'}</strong><div class="td-mono text-xs text-muted">${r.productCode || '-'}</div></td>
              <td><span class="td-mono text-xs">${r.fgLotNo || '-'}</span></td>
              <td class="td-right">${r.moisture || 0}%</td>
              <td class="td-right">${r.protein || 0}%</td>
              <td class="td-right">${r.fat || 0}%</td>
              <td class="td-right">${r.fiber || 0}%</td>
              <td class="td-right">${r.ash || 0}%</td>
              <td class="td-right">${r.pelletDurability || 0}%</td>
              <td>${verdictBadge(r.verdict)}</td>
              <td>${r.memo || '-'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const setTab = (next) => { tab = next; App.refreshPage(); };

  const commonFields = () => `
    <div class="form-grid form-grid-3">
      <div class="form-group"><label class="form-label">수분(%)</label><input type="number" class="form-input" id="an-moisture" step="0.01"></div>
      <div class="form-group"><label class="form-label">단백(%)</label><input type="number" class="form-input" id="an-protein" step="0.01"></div>
      <div class="form-group"><label class="form-label">지방(%)</label><input type="number" class="form-input" id="an-fat" step="0.01"></div>
      <div class="form-group"><label class="form-label">섬유(%)</label><input type="number" class="form-input" id="an-fiber" step="0.01"></div>
      <div class="form-group"><label class="form-label">회분(%)</label><input type="number" class="form-input" id="an-ash" step="0.01"></div>
      <div class="form-group">
        <label class="form-label">판정</label>
        <select class="form-input" id="an-verdict">
          <option value="PASS">적합</option>
          <option value="CONDITIONAL">조건부</option>
          <option value="FAIL">부적합</option>
        </select>
      </div>
    </div>
    <div class="form-grid form-grid-2">
      <div class="form-group"><label class="form-label">분석자</label><input type="text" class="form-input" id="an-analyst" value="R&D"></div>
      <div class="form-group"><label class="form-label">분석일</label><input type="date" class="form-input" id="an-date" value="${new Date().toISOString().split('T')[0]}"></div>
    </div>
    <div class="form-group">
      <label class="form-label">특이사항</label>
      <textarea class="form-textarea" id="an-memo" placeholder="기준 초과, 재검 필요, 배합비팀 전달사항 등"></textarea>
    </div>
  `;

  const openRawModal = () => {
    const body = document.getElementById('analysis-modal-body');
    if (!body) return;
    const receivings = DB.getReceivings().slice().reverse();
    document.getElementById('analysis-modal-title').textContent = '원료분석 등록';
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div class="form-group">
          <label class="form-label">입고 LOT</label>
          <select class="form-input" id="an-receiving-id">
            ${receivings.map(r => `<option value="${r.id}">${r.materialName} / ${r.lotNo || '-'} / ${r.supplierName || r.supplier || '-'}</option>`).join('')}
          </select>
        </div>
        ${commonFields()}
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="QualityRDPage.closeModal('analysis-modal')">취소</button>
          <button class="btn btn-primary" onclick="QualityRDPage.submitRaw()">저장</button>
        </div>
      </div>
    `;
    openModal('analysis-modal');
  };

  const openProductModal = () => {
    const body = document.getElementById('analysis-modal-body');
    if (!body) return;
    const lots = DB.getProductLots().slice().reverse();
    document.getElementById('analysis-modal-title').textContent = '제품분석 등록';
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div class="form-group">
          <label class="form-label">제품 LOT</label>
          <select class="form-input" id="an-product-lot-id">
            ${lots.map(p => `<option value="${p.id}">${p.productName} / ${p.fgLotNo} / ${p.productCode || '-'}</option>`).join('')}
          </select>
        </div>
        ${commonFields()}
        <div class="form-group">
          <label class="form-label">PDI / 펠렛내구도(%)</label>
          <input type="number" class="form-input" id="an-pdi" step="0.01">
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="QualityRDPage.closeModal('analysis-modal')">취소</button>
          <button class="btn btn-primary" onclick="QualityRDPage.submitProduct()">저장</button>
        </div>
      </div>
    `;
    openModal('analysis-modal');
  };

  const readCommon = () => ({
    moisture: document.getElementById('an-moisture')?.value || 0,
    protein: document.getElementById('an-protein')?.value || 0,
    fat: document.getElementById('an-fat')?.value || 0,
    fiber: document.getElementById('an-fiber')?.value || 0,
    ash: document.getElementById('an-ash')?.value || 0,
    verdict: document.getElementById('an-verdict')?.value || 'PASS',
    analyst: document.getElementById('an-analyst')?.value || 'R&D',
    analyzedAt: (document.getElementById('an-date')?.value || new Date().toISOString().split('T')[0]) + 'T09:00:00.000Z',
    memo: document.getElementById('an-memo')?.value || ''
  });

  const submitRaw = () => {
    const receivingId = document.getElementById('an-receiving-id')?.value;
    if (!receivingId) { App.toast('입고 LOT가 없습니다', 'error'); return; }
    DB.addRawAnalysis({ receivingId, ...readCommon() });
    closeModal('analysis-modal');
    App.toast('원료분석 데이터 저장 완료', 'success');
    App.refreshPage();
  };

  const submitProduct = () => {
    const productLotId = document.getElementById('an-product-lot-id')?.value;
    if (!productLotId) { App.toast('제품 LOT가 없습니다', 'error'); return; }
    DB.addProductAnalysis({ productLotId, pelletDurability: document.getElementById('an-pdi')?.value || 0, ...readCommon() });
    closeModal('analysis-modal');
    App.toast('제품분석 데이터 저장 완료', 'success');
    App.refreshPage();
  };

  const openModal = (id) => document.getElementById(id)?.classList.add('open');
  const closeModal = (id) => document.getElementById(id)?.classList.remove('open');

  return { render, afterRender: () => DiseaseAlert.afterRender?.(), setTab, openRawModal, openProductModal, submitRaw, submitProduct, closeModal };
})();
