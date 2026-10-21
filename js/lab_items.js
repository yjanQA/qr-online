// ============================================================
// items.js — 분석항목 관리 (추가/수정/삭제 · 원료·제품 적용대상 구분)
// ============================================================

const ItemsPage = (() => {
  const applyOpts = (cur) => ['both', 'raw', 'prod'].map(a =>
    `<option value="${a}" ${a === cur ? 'selected' : ''}>${LabDB.itemAppliesLabel(a)}</option>`).join('');

  const render = () => {
    const items = LabDB.getItems();
    const groups = [...new Set(items.map(i => i.group))];
    const rows = items.map(it => {
      const ap = it.appliesTo || 'both';
      const r = LabDB.getItemSummary('raw', it.key);
      const p = LabDB.getItemSummary('prod', it.key);
      return `<tr>
        <td><b>${esc(it.label)}</b> <span class="mono text-muted" style="font-size:10px">${esc(it.key)}</span></td>
        <td>${esc(it.unit || '')}</td>
        <td><input type="text" class="form-input form-input-sm" style="min-width:90px" value="${esc(it.owner || '')}" placeholder="담당자"
              onchange="ItemsPage.setOwner('${esc(it.key)}', this.value)"></td>
        <td>${esc(it.group || '')}</td>
        <td>
          <select class="form-input form-input-sm" onchange="ItemsPage.setApplies('${esc(it.key)}', this.value)">${applyOpts(ap)}</select>
        </td>
        <td>${it.custom ? '<span class="tag tag-blue">추가</span>' : '<span class="tag tag-gray">기본</span>'}</td>
        <td class="mono text-muted">원료 ${r.n || 0} · 제품 ${p.n || 0}</td>
        <td style="text-align:right"><button class="btn btn-ghost btn-xs" onclick="ItemsPage.del('${esc(it.key)}')">삭제</button></td>
      </tr>`;
    }).join('');

    const groupList = groups.map(g => `<option value="${esc(g)}">`).join('');

    return `
    <div class="card">
      <div class="card-head"><div class="card-title">분석항목 추가</div></div>
      <div class="form-grid form-grid-6">
        <div class="form-group"><label class="form-label">항목명 <span class="req">*</span></label><input type="text" class="form-input form-input-sm" id="it-label" placeholder="예: 조단백2, 라이신"></div>
        <div class="form-group"><label class="form-label">단위</label><input type="text" class="form-input form-input-sm" id="it-unit" placeholder="% · ppm · ppb"></div>
        <div class="form-group"><label class="form-label">담당자</label><input type="text" class="form-input form-input-sm" id="it-owner" placeholder="분석 담당자명"></div>
        <div class="form-group"><label class="form-label">그룹</label>
          <input type="text" class="form-input form-input-sm" id="it-group" list="it-groups" placeholder="일반성분 · 아미노산 …">
          <datalist id="it-groups">${groupList}</datalist>
        </div>
        <div class="form-group"><label class="form-label">적용대상</label><select class="form-input form-input-sm" id="it-applies">${applyOpts('both')}</select></div>
        <div class="form-group"><label class="form-label">항목키 <span class="text-muted">(선택)</span></label><input type="text" class="form-input form-input-sm" id="it-key" placeholder="영문/숫자 자동"></div>
      </div>
      <div class="form-actions"><button class="btn btn-primary btn-sm" onclick="ItemsPage.add()">항목 추가</button></div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">분석항목 목록 <span class="text-muted" style="font-weight:400">(${items.length}개)</span></div></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>항목명</th><th>단위</th><th>담당자</th><th>그룹</th><th>적용대상</th><th>유형</th><th>데이터</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="text-muted" style="font-size:12px;margin-top:10px;line-height:1.6">
        · <b>적용대상</b> 을 <b>원료</b> 또는 <b>제품</b> 으로 지정하면, 입력화면·대시보드에서 해당 구분에만 나타납니다. (예: 수분을 원료용/제품용으로 나눠 관리)<br>
        · 기본 항목도 적용대상 변경·삭제가 가능하며, 추가 항목은 즉시 입력화면에 반영됩니다.
      </div>
    </div>`;
  };

  const add = () => {
    const label = document.getElementById('it-label').value.trim();
    if (!label) { App.toast('항목명을 입력하세요', 'error'); return; }
    try {
      LabDB.addItem({
        label,
        unit: document.getElementById('it-unit').value,
        owner: document.getElementById('it-owner').value,
        group: document.getElementById('it-group').value || '기타',
        appliesTo: document.getElementById('it-applies').value,
        key: document.getElementById('it-key').value,
      });
      App.toast('분석항목이 추가되었습니다', 'success');
      App.refreshPage();
    } catch (e) { App.toast(e.message || '추가 실패', 'error'); }
  };

  const setApplies = (key, val) => {
    LabDB.updateItem(key, { appliesTo: val });
    App.toast(`적용대상: ${LabDB.itemAppliesLabel(val)}`, 'info', 1500);
  };

  const setOwner = (key, val) => {
    LabDB.updateItem(key, { owner: String(val || '').trim() });
    App.toast(val.trim() ? `담당자: ${val.trim()}` : '담당자 해제', 'info', 1500);
  };

  const del = (key) => {
    const it = LabDB.getItem(key);
    if (!confirm(`'${it ? it.label : key}' 항목을 삭제할까요?\n(입력된 측정값 자체는 남지만 화면에서 숨겨집니다)`)) return;
    LabDB.deleteItem(key);
    App.refreshPage();
  };

  return { render, add, setApplies, setOwner, del };
})();
