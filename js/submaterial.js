// ============================================================
// submaterial.js — 부자재/포장재 재고 · 자동발주 제안
// ============================================================

const SubMaterialPage = (() => {
  const stockBadge = (s) => {
    const ratio = s.reorderPoint > 0 ? s.qty / s.reorderPoint : 1;
    if (s.qty <= s.reorderPoint) return '<span class="badge badge-fail">발주 필요</span>';
    if (ratio < 1.3) return '<span class="badge badge-warning">주의</span>';
    return '<span class="badge badge-pass">충분</span>';
  };

  const render = () => {
    const factory = App.getFactory();
    const mats  = DB.getSubMaterials(factory);
    const sugg  = DB.getReorderSuggestions(factory);
    const orders = DB.getSubOrders(factory).slice(0, 15);
    const cats  = [...new Set(mats.map(m => m.category))];

    return `
      <div class="fade-in">
        <div class="flex items-center justify-between mb-20">
          <div class="text-sm text-muted">부자재 ${mats.length}품목 · 발주필요 ${sugg.length}건</div>
          <button class="btn btn-ghost btn-sm" onclick="SubMaterialPage.openAddModal()">＋ 부자재 등록</button>
        </div>

        ${sugg.length > 0 ? `
        <div class="section-title mb-12">자동발주 제안</div>
        <div class="card" style="margin-bottom:20px;border-left:4px solid var(--warning)">
          <div class="table-wrapper"><table>
            <thead><tr><th>부자재</th><th>공장</th><th class="td-right">현재고</th><th class="td-right">발주점</th><th class="td-right">제안수량</th><th>협력사</th><th>리드타임</th><th>액션</th></tr></thead>
            <tbody>${sugg.map(s => `<tr>
              <td><strong>${s.name}</strong> <span class="td-mono text-xs">${s.code}</span></td>
              <td>${DB.getFactoryName(s.factory)}</td>
              <td class="td-right" style="color:var(--danger);font-weight:700">${formatNum(s.qty)}${s.unit}</td>
              <td class="td-right">${formatNum(s.reorderPoint)}${s.unit}</td>
              <td class="td-right font-bold">${formatNum(s.suggestQty)}${s.unit}</td>
              <td class="text-xs">${s.supplierName||'-'}</td>
              <td class="text-xs">${s.leadDays}일</td>
              <td><button class="btn btn-primary btn-xs" onclick="SubMaterialPage.orderNow('${s.id}', ${s.suggestQty})">발주</button></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>` : `<div class="card" style="margin-bottom:20px;padding:14px 16px;color:var(--text-muted)">현재 발주가 필요한 부자재가 없습니다.</div>`}

        <div class="section-title mb-12">부자재 재고</div>
        <div class="card" style="margin-bottom:20px">
          <div class="table-wrapper"><table>
            <thead><tr><th>코드</th><th>부자재명</th><th>분류</th><th>공장</th><th class="td-right">재고</th><th class="td-right">발주점</th><th>상태</th><th>조정</th></tr></thead>
            <tbody>${mats.length===0?`<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted)">등록된 부자재가 없습니다</td></tr>`:
              mats.map(m => `<tr>
                <td class="td-mono text-xs">${m.code}</td>
                <td><strong>${m.name}</strong></td>
                <td class="text-xs">${m.category}</td>
                <td>${DB.getFactoryName(m.factory)}</td>
                <td class="td-right font-bold">${formatNum(m.qty)}${m.unit}</td>
                <td class="td-right text-xs">${formatNum(m.reorderPoint)}${m.unit}</td>
                <td>${stockBadge(m)}</td>
                <td>
                  <button class="btn btn-ghost btn-xs" onclick="SubMaterialPage.quickAdjust('${m.id}',1)">＋</button>
                  <button class="btn btn-ghost btn-xs" onclick="SubMaterialPage.quickAdjust('${m.id}',-1)">－</button>
                  <button class="btn btn-ghost btn-xs" onclick="SubMaterialPage.openAdjustModal('${m.id}')">조정</button>
                </td>
              </tr>`).join('')}</tbody>
          </table></div>
        </div>

        <div class="section-title mb-12">발주 이력</div>
        <div class="card">
          <div class="table-wrapper"><table>
            <thead><tr><th>일시</th><th>부자재</th><th class="td-right">수량</th><th>협력사</th><th>상태</th><th>액션</th></tr></thead>
            <tbody>${orders.length===0?`<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">발주 이력 없음</td></tr>`:
              orders.map(o=>`<tr>
                <td class="text-xs">${App.formatDate(o.createdAt)}</td>
                <td><strong>${o.name}</strong></td>
                <td class="td-right">${formatNum(o.qty)}${o.unit}</td>
                <td class="text-xs">${o.supplierName||'-'}</td>
                <td>${o.status==='RECEIVED'?'<span class="badge badge-pass">입고완료</span>':o.status==='ORDERED'?'<span class="badge badge-info">발주됨</span>':'<span class="badge badge-warning">제안</span>'}</td>
                <td>${o.status!=='RECEIVED'?`<button class="btn btn-ghost btn-xs" onclick="SubMaterialPage.receive('${o.id}')">입고처리</button>`:'-'}</td>
              </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>

      <div class="modal-overlay" id="sm-add-modal"><div class="modal" style="max-width:480px"><div class="modal-header"><h3>부자재 등록</h3><button class="modal-close" onclick="SubMaterialPage.close('sm-add-modal')">✕</button></div><div id="sm-add-body"></div></div></div>
      <div class="modal-overlay" id="sm-adj-modal"><div class="modal" style="max-width:420px"><div class="modal-header"><h3>재고 조정</h3><button class="modal-close" onclick="SubMaterialPage.close('sm-adj-modal')">✕</button></div><div id="sm-adj-body"></div></div></div>
    `;
  };

  const quickAdjust = (id, delta) => { DB.adjustSubMaterial(id, delta, '수기 조정', '자재팀'); App.refreshPage(); };

  const orderNow = (id, qty) => {
    DB.addSubOrder({ subId: id, qty, status: 'ORDERED' });
    App.toast('발주 등록 완료', 'success'); App.refreshPage();
  };

  const receive = (orderId) => { DB.updateSubOrder(orderId, { status: 'RECEIVED' }); App.toast('입고 처리 및 재고 반영', 'success'); App.refreshPage(); };

  const openAdjustModal = (id) => {
    const m = DB.getSubMaterials('ALL').find(x => x.id === id);
    const body = document.getElementById('sm-adj-body'); if (!body || !m) return;
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="text-sm"><strong>${m.name}</strong> · 현재고 ${formatNum(m.qty)}${m.unit}</div>
        <div class="form-group"><label class="form-label">증감(+입고 / -출고)</label><input type="number" class="form-input" id="sa-delta" placeholder="예) -50"></div>
        <div class="form-group"><label class="form-label">사유</label><input class="form-input" id="sa-reason" placeholder="예) 생산 투입"></div>
        <div class="modal-footer"><button class="btn btn-ghost" onclick="SubMaterialPage.close('sm-adj-modal')">취소</button><button class="btn btn-primary" onclick="SubMaterialPage.submitAdjust('${id}')">반영</button></div>
      </div>`;
    document.getElementById('sm-adj-modal').classList.add('open');
  };

  const submitAdjust = (id) => {
    const delta = Number(document.getElementById('sa-delta')?.value);
    if (!delta) { App.toast('증감 수량을 입력하세요', 'error'); return; }
    DB.adjustSubMaterial(id, delta, document.getElementById('sa-reason')?.value.trim() || '수기 조정', '자재팀');
    close('sm-adj-modal'); App.toast('재고 조정 완료', 'success'); App.refreshPage();
  };

  const openAddModal = () => {
    const body = document.getElementById('sm-add-body'); if (!body) return;
    const factories = DB.getFactories();
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">코드 *</label><input class="form-input" id="sm-code" placeholder="예) PKG-20KG"></div>
          <div class="form-group"><label class="form-label">부자재명 *</label><input class="form-input" id="sm-name" placeholder="예) 20kg 포대"></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">분류</label><select class="form-input" id="sm-cat"><option>포장재</option><option>라벨</option><option>프리믹스</option><option>기타</option></select></div>
          <div class="form-group"><label class="form-label">단위</label><input class="form-input" id="sm-unit" placeholder="예) 매/개/kg"></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">현재고</label><input type="number" class="form-input" id="sm-qty" value="0"></div>
          <div class="form-group"><label class="form-label">발주점</label><input type="number" class="form-input" id="sm-rop" value="0"></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">협력사</label><input class="form-input" id="sm-sup" placeholder="공급 협력사"></div>
          <div class="form-group"><label class="form-label">공장</label><select class="form-input" id="sm-factory">${factories.map(f=>`<option value="${f.code}">${f.name}</option>`).join('')}</select></div>
        </div>
        <div class="form-group"><label class="form-label">리드타임(일)</label><input type="number" class="form-input" id="sm-lead" value="5"></div>
        <div class="modal-footer"><button class="btn btn-ghost" onclick="SubMaterialPage.close('sm-add-modal')">취소</button><button class="btn btn-primary" onclick="SubMaterialPage.submitAdd()">등록</button></div>
      </div>`;
    document.getElementById('sm-add-modal').classList.add('open');
  };

  const submitAdd = () => {
    const code = document.getElementById('sm-code')?.value.trim();
    const name = document.getElementById('sm-name')?.value.trim();
    if (!code || !name) { App.toast('코드와 부자재명을 입력하세요', 'error'); return; }
    DB.addSubMaterial({
      code, name, category: document.getElementById('sm-cat')?.value,
      unit: document.getElementById('sm-unit')?.value.trim() || 'ea',
      qty: Number(document.getElementById('sm-qty')?.value) || 0,
      reorderPoint: Number(document.getElementById('sm-rop')?.value) || 0,
      supplierName: document.getElementById('sm-sup')?.value.trim(),
      factory: document.getElementById('sm-factory')?.value || 'AS',
      leadDays: Number(document.getElementById('sm-lead')?.value) || 5,
    });
    close('sm-add-modal'); App.toast('부자재 등록 완료', 'success'); App.refreshPage();
  };

  const close = (id) => document.getElementById(id)?.classList.remove('open');
  const afterRender = () => {};
  return { render, afterRender, quickAdjust, orderNow, receive, openAdjustModal, submitAdjust, openAddModal, submitAdd, close };
})();
