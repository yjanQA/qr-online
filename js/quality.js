// ============================================================
// quality.js — 품질 게이트 페이지
// ============================================================

const QualityPage = (() => {
  let targetReceivingId = null;

  const render = (receivingId) => {
    targetReceivingId = receivingId || null;
    const gates = DB.getQCConfig();
    const pendingList = DB.getReceivings().filter(r =>
      r.status === 'PENDING_QC' || r.status === 'APPROVED'
    ).slice().reverse();

    return `
      <div class="fade-in">
        ${targetReceivingId ? renderInspectionForm(targetReceivingId) : renderPendingList(pendingList)}
      </div>

      <!-- 검사 모달 -->
      <div class="modal-overlay" id="inspect-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <div class="modal-title" id="inspect-modal-title">품질 검사</div>
            <button class="modal-close" onclick="QualityPage.closeModal('inspect-modal')">✕</button>
          </div>
          <div id="inspect-modal-body"></div>
        </div>
      </div>

      <!-- 게이트 설정 모달 -->
      <div class="modal-overlay" id="gate-config-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <div class="modal-title">품질 게이트 설정</div>
            <button class="modal-close" onclick="QualityPage.closeModal('gate-config-modal')">✕</button>
          </div>
          <div id="gate-config-body"></div>
        </div>
      </div>
    `;
  };

  const renderPendingList = (list) => {
    const gates = DB.getQCConfig();

    return `
      <div class="flex items-center justify-between mb-20">
        <div class="text-sm text-muted">검사 대기: ${list.length}건</div>
        <button class="btn btn-ghost btn-sm" onclick="QualityPage.openGateConfig()">게이트 설정</button>
      </div>

      <!-- 게이트 개요 카드 (동일 크기·중앙 정렬) -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px;margin-bottom:20px">
        ${gates.map(g => `
          <div class="card" style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:6px;min-height:158px">
            <div style="font-size:28px;line-height:1;height:34px">${g.order === 1 ? '' : g.order === 2 ? '' : ''}</div>
            <div class="font-bold">${g.name}</div>
            <div class="text-sm text-muted">${g.items.length}개 항목</div>
            <div class="badge ${g.required ? 'badge-info' : 'badge-default'}">${g.required ? '필수' : '선택'}</div>
          </div>`).join('')}
      </div>

      ${list.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon"></div>
          <h3>검사 대기 항목이 없습니다</h3>
          <p>계근이 완료된 입고 항목이 이곳에 표시됩니다</p>
        </div>` : `
        <div style="display:flex;flex-direction:column;gap:12px">
          ${list.map(r => {
            const inspections = DB.getInspectionsByReceivingId(r.id);
            const doneGates = inspections.map(i => i.gateId);
            const anyFail = inspections.some(i => i.verdict === 'FAIL');
            return `
            <div class="card">
              <div class="flex items-center justify-between" style="flex-wrap:wrap;gap:12px">
                <div>
                  <div class="flex items-center gap-8">
                    <div class="font-bold">${r.materialName}</div>
                    ${anyFail ? '<span class="badge badge-fail">불합격 항목 있음</span>' : ''}
                  </div>
                  <div class="text-sm text-muted font-mono mt-4">${r.materialCode} · ${r.supplier || '-'} · ${r.receivedDate}</div>
                  <div class="flex gap-8 mt-8" style="flex-wrap:wrap">
                    ${gates.map(g => {
                      const done = inspections.find(i => i.gateId === g.id);
                      if (!done) return `<span class="badge badge-default">${g.name}</span>`;
                      if (done.verdict === 'PASS') return `<span class="badge badge-pass">${g.name}</span>`;
                      if (done.verdict === 'FAIL') return `<span class="badge badge-fail">${g.name}</span>`;
                      return `<span class="badge badge-warning">${g.name}</span>`;
                    }).join('')}
                  </div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  ${gates.map(g => {
                    const done = inspections.find(i => i.gateId === g.id);
                    if (!done) return `<button class="btn btn-sm" style="border:1.5px solid #c62222;color:#c62222;background:transparent" onclick="QualityPage.openInspect('${r.id}','${g.id}')" title="미완료 — 검사 필요">${g.name}</button>`;
                    if (done.verdict === 'FAIL') return `<button class="btn btn-danger btn-sm" onclick="QualityPage.viewInspection('${done.id}')" title="불합격">✕ ${g.name}</button>`;
                    if (done.verdict === 'PASS') return `<button class="btn btn-success btn-sm" onclick="QualityPage.viewInspection('${done.id}')" title="합격 완료">${g.name}</button>`;
                    return `<button class="btn btn-warning btn-sm" onclick="QualityPage.viewInspection('${done.id}')" title="조건부 합격">${g.name}</button>`;
                  }).join('')}
                  ${r.status === 'APPROVED' ? `<button class="btn btn-success btn-sm" onclick="ReceivingPage.registerStock('${r.id}')">재고등록</button>` : ''}
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>`}
    `;
  };

  const renderInspectionForm = (receivingId) => {
    const r = DB.getReceivingById(receivingId);
    if (!r) return `<div class="empty-state"><div class="empty-icon"></div><h3>입고 데이터를 찾을 수 없습니다</h3></div>`;

    const inspections = DB.getInspectionsByReceivingId(receivingId);
    const gates = DB.getQCConfig();

    return `
      <div class="flex items-center gap-12 mb-20">
        <button class="btn btn-ghost btn-sm" onclick="App.navigate('quality')">← 목록으로</button>
        <div>
          <div class="font-bold">${r.materialName}</div>
          <div class="text-sm text-muted font-mono">${r.materialCode}</div>
        </div>
      </div>
      ${renderPendingList(DB.getReceivings().filter(x => x.id === receivingId))}
    `;
  };

  // ── 검사 모달 열기 ──
  const openInspect = (receivingId, gateId) => {
    const r = DB.getReceivingById(receivingId);
    const gates = DB.getQCConfig();
    const gate = gates.find(g => g.id === gateId);
    if (!r || !gate) return;

    document.getElementById('inspect-modal-title').textContent = `${gate.name}`;
    document.getElementById('inspect-modal-body').innerHTML = `
      <div style="margin-bottom:16px">
        <div class="font-bold">${r.materialName}</div>
        <div class="text-sm text-muted font-mono">${r.materialCode} · ${r.receivedDate}</div>
      </div>

      <!-- 체크리스트 -->
      <div class="form-group mb-16">
        <label class="form-label">검사 항목</label>
        <div class="checklist" id="check-list">
          ${gate.items.map((item, i) => `
            <div class="checklist-item" id="ci-${i}" data-index="${i}">
              <span class="checklist-name">${item}</span>
              <div class="checklist-btns">
                <button class="check-btn pass" onclick="QualityPage.setCheck(${i},'PASS')">합격</button>
                <button class="check-btn fail" onclick="QualityPage.setCheck(${i},'FAIL')">불합격</button>
              </div>
            </div>`).join('')}
        </div>
      </div>

      <div id="fail-reason-area" class="hidden mb-16">
        <div class="form-group">
          <label class="form-label">부적합 원인코드 <span class="req">*</span></label>
          <select class="form-select" id="fail-code">
            <option value="">원인을 선택하세요</option>
            ${DB.FAIL_CODES.map(f => `<option value="${f.code}">${f.code} - ${f.label}</option>`).join('')}
          </select>
          <div class="form-hint">원인별 부적합 통계·실패비용 집계의 기준이 됩니다.</div>
        </div>
        <div class="form-group mt-12">
          <label class="form-label">상세 사유</label>
          <textarea class="form-textarea" id="fail-reason" placeholder="불합격 상세 사유를 입력하세요"></textarea>
        </div>
        <div class="form-group mt-12">
          <label class="form-label">불량 사진 첨부</label>
          <div class="photo-upload" onclick="document.getElementById('fail-photo').click()">
            <div>클릭하여 사진 첨부</div>
            <div class="text-xs text-muted mt-4">카메라 또는 갤러리에서 선택</div>
            <img id="fail-photo-preview" class="hidden">
          </div>
          <input type="file" id="fail-photo" accept="image/*" class="hidden" onchange="QualityPage.previewPhoto(this)">
        </div>
      </div>

      <div class="form-grid form-grid-2" style="gap:12px">
        <div class="form-group">
          <label class="form-label">최종 판정</label>
          <select class="form-select" id="final-verdict">
            <option value="PASS">합격</option>
            <option value="FAIL">불합격</option>
            <option value="CONDITIONAL">조건부합격</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">검사자</label>
          <input type="text" class="form-input" id="inspector" placeholder="검사자 이름">
        </div>
      </div>
      <div class="form-group mt-12">
        <label class="form-label">메모</label>
        <textarea class="form-textarea" id="qc-memo" placeholder="특이사항"></textarea>
      </div>

      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="QualityPage.closeModal('inspect-modal')">취소</button>
        <button class="btn btn-danger btn-sm" onclick="QualityPage.markFail('${receivingId}','${gateId}')">불합격 처리</button>
        <button class="btn btn-success" onclick="QualityPage.submitInspect('${receivingId}','${gateId}')">판정 완료</button>
      </div>
    `;

    // 상태 배열 초기화
    window._checkResults = gate.items.map(() => null);

    // 판정 변경 시 원인 입력 영역 표시
    setTimeout(() => {
      document.getElementById('final-verdict')?.addEventListener('change', syncFailArea);
    }, 100);

    openModal('inspect-modal');
  };

  // 원인 입력 영역은 불합격뿐 아니라 조건부합격(특채)에서도 필요하다.
  //   특채도 부적합이 있는데 사용을 승인한 것이므로 원인이 남아야 한다.
  const needsCause = (verdict) => verdict === 'FAIL' || verdict === 'CONDITIONAL';
  const syncFailArea = () => {
    const area = document.getElementById('fail-reason-area');
    if (!area) return;
    const verdict = document.getElementById('final-verdict')?.value || 'PASS';
    const hasFail = (window._checkResults || []).some(r => r === 'FAIL');
    if (needsCause(verdict) || hasFail) area.classList.remove('hidden');
    else area.classList.add('hidden');
  };

  const setCheck = (index, result) => {
    if (!window._checkResults) window._checkResults = [];
    window._checkResults[index] = result;

    const item = document.getElementById(`ci-${index}`);
    item.classList.remove('pass-item', 'fail-item');
    item.classList.add(result === 'PASS' ? 'pass-item' : 'fail-item');

    // 버튼 active 상태
    item.querySelectorAll('.check-btn').forEach(btn => btn.classList.remove('active'));
    item.querySelector(`.check-btn.${result.toLowerCase()}`)?.classList.add('active');

    // 불합격 항목 있으면 판정을 불합격으로 맞추고 원인 입력 영역 표시
    const hasFail = window._checkResults.some(r => r === 'FAIL');
    if (hasFail) document.getElementById('final-verdict').value = 'FAIL';
    else if (window._checkResults.every(r => r === 'PASS')) document.getElementById('final-verdict').value = 'PASS';
    syncFailArea();
  };

  // 불합격 처리 버튼 — 값만 바꾸면 change 이벤트가 안 나 원인 입력 영역이 열리지 않았다.
  //   그 탓에 이 경로로 저장된 건은 전부 기본 원인코드가 박혔다.
  const markFail = (receivingId, gateId) => {
    const v = document.getElementById('final-verdict');
    if (v) v.value = 'FAIL';
    syncFailArea();
    submitInspect(receivingId, gateId);
  };

  const previewPhoto = (input) => {
    if (!input.files || !input.files[0]) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.getElementById('fail-photo-preview');
      img.src = e.target.result;
      img.classList.remove('hidden');
      window._photoBase64 = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
  };

  const submitInspect = (receivingId, gateId) => {
    const gates = DB.getQCConfig();
    const gate = gates.find(g => g.id === gateId);
    const verdict = document.getElementById('final-verdict')?.value || 'PASS';
    const inspector = document.getElementById('inspector')?.value || '검사자';
    // 누르지 않은 항목을 합격으로 채우지 않는다 — 미검사와 합격은 다른 기록이다.
    const checkItems = (gate?.items || []).map((name, i) => ({
      name,
      result: (window._checkResults || [])[i] || 'NA'
    }));

    const failCode = document.getElementById('fail-code')?.value || '';
    const failReason = (document.getElementById('fail-reason')?.value || '').trim();
    const hasFail = checkItems.some(ci => ci.result === 'FAIL');

    // 부적합 건은 원인코드가 있어야 원인별 통계가 성립한다
    if ((needsCause(verdict) || hasFail) && !failCode) {
      App.toast('부적합 원인코드를 선택하세요', 'error');
      document.getElementById('fail-reason-area')?.classList.remove('hidden');
      document.getElementById('fail-code')?.focus();
      return;
    }
    if (failCode === 'OTHER' && !failReason) {
      App.toast('원인이 기타일 때는 상세 사유를 입력하세요', 'error');
      document.getElementById('fail-reason')?.focus();
      return;
    }
    const naCount = checkItems.filter(ci => ci.result === 'NA').length;
    if (naCount && !confirm(`검사하지 않은 항목이 ${naCount}건 있습니다.\n미검사로 기록됩니다. 계속할까요?`)) return;

    try {
      DB.addInspection({
        receivingId,
        gateId,
        gateName: gate?.name || gateId,
        materialCode: DB.getReceivingById(receivingId)?.materialCode || '',
        materialName: DB.getReceivingById(receivingId)?.materialName || '',
        checkItems,
        verdict,
        failCode,
        failReason,
        imageBase64: window._photoBase64 || null,
        inspector,
        memo: document.getElementById('qc-memo')?.value || ''
      });
      window._checkResults = [];
      window._photoBase64 = null;
      closeModal('inspect-modal');
      App.toast(`검사 완료: ${verdict === 'PASS' ? '합격' : verdict === 'FAIL' ? '불합격' : '조건부합격'}`, verdict === 'FAIL' ? 'error' : 'success');
      App.refreshPage();
    } catch (e) {
      App.toast('검사 저장 실패: ' + e.message, 'error');
    }
  };

  // 기존 검사 결과 보기
  const viewInspection = (inspectionId) => {
    const insp = DB.getInspections().find(i => i.id === inspectionId);
    if (!insp) return;

    document.getElementById('inspect-modal-title').textContent = `${insp.gateName} 결과`;
    document.getElementById('inspect-modal-body').innerHTML = `
      <div class="mb-16">
        <div class="badge ${insp.verdict === 'PASS' ? 'badge-pass' : insp.verdict === 'FAIL' ? 'badge-fail' : 'badge-warning'} mb-8">
          ${insp.verdict === 'PASS' ? '합격' : insp.verdict === 'FAIL' ? '불합격' : '조건부합격'}
        </div>
        <div class="text-sm text-muted">검사자: ${insp.inspector} · ${new Date(insp.inspectedAt).toLocaleString('ko-KR')}</div>
      </div>
      <div class="checklist mb-16">
        ${insp.checkItems.map(ci => `
          <div class="checklist-item ${ci.result === 'PASS' ? 'pass-item' : ci.result === 'FAIL' ? 'fail-item' : ''}">
            <span class="checklist-name">${ci.name}</span>
            <span class="badge ${ci.result === 'PASS' ? 'badge-pass' : ci.result === 'FAIL' ? 'badge-fail' : 'badge-default'}">${ci.result === 'PASS' ? '합격' : ci.result === 'FAIL' ? '불합격' : '미검사'}</span>
          </div>`).join('')}
      </div>
      ${insp.failCode || insp.failReason ? `<div class="card" style="background:var(--danger-bg);border-color:var(--danger)"><div class="text-sm font-bold text-danger">부적합 원인</div><div class="text-sm mt-4">${DB.failCodeLabel(insp.failCode)}${insp.failReason ? ' · ' + insp.failReason : ''}</div></div>` : ''}
      ${insp.imageBase64 ? `<img src="${insp.imageBase64}" style="max-width:100%;border-radius:var(--radius-md);margin-top:12px">` : ''}
      ${insp.memo ? `<div class="text-sm text-muted mt-8">메모: ${insp.memo}</div>` : ''}
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="QualityPage.closeModal('inspect-modal')">닫기</button>
        <button class="btn btn-outline-primary" onclick="QualityPage.toAgenda('${insp.id}')">회의 안건 등록</button>
      </div>
    `;
    openModal('inspect-modal');
  };

  // 품질회의 안건으로 올리기 — 원료명·사유에 따옴표가 섞일 수 있어 id 만 넘기고 여기서 조립한다
  const toAgenda = (inspectionId) => {
    const i = DB.getInspections().find(x => x.id === inspectionId);
    if (!i || typeof MeetingPage === 'undefined') return;
    const r = DB.getReceivingById(i.receivingId);
    const cause = DB.failCodeLabel(i.failCode);
    MeetingPage.quickAgenda({
      sourceType: 'DEFECT',
      sourceId: i.id,
      sourceLabel: `${i.gateName} · ${i.materialName || i.materialCode || ''}`,
      title: `[입고 부적합] ${i.materialName || i.materialCode || ''} — ${cause}`,
      content: `${i.gateName} ${i.verdict === 'FAIL' ? '불합격' : '조건부합격'}\n원인: ${cause}${i.failReason ? '\n사유: ' + i.failReason : ''}${r ? `\n입고: ${r.receivedDate || ''} ${r.supplierName || ''}` : ''}`,
      category: '원료 품질',
      factory: r?.factory || '',
      priority: i.verdict === 'FAIL' ? '높음' : '보통',
    });
  };

  // ── 게이트 설정 ──
  const openGateConfig = () => {
    const gates = DB.getQCConfig();
    document.getElementById('gate-config-body').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px" id="gate-list">
        ${gates.map((g, gi) => `
          <div class="card" style="border-left:3px solid var(--accent)">
            <div class="flex items-center justify-between mb-12">
              <div class="font-bold">${g.order}차 ${g.name}</div>
              <div style="display:flex;gap:6px;align-items:center">
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
                  <input type="checkbox" ${g.required ? 'checked' : ''} onchange="QualityPage.toggleRequired('${g.id}',this.checked)">
                  필수
                </label>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              ${g.items.map((item, ii) => `
                <div style="display:flex;gap:6px;align-items:center">
                  <input type="text" class="form-input form-input-sm" value="${item}"
                    style="flex:1;padding:6px 10px;font-size:12px"
                    onchange="QualityPage.updateItem('${g.id}',${ii},this.value)">
                  <button class="btn btn-ghost btn-icon btn-sm" onclick="QualityPage.removeItem('${g.id}',${ii})" title="삭제">✕</button>
                </div>`).join('')}
              <button class="btn btn-ghost btn-sm" style="margin-top:4px" onclick="QualityPage.addItem('${g.id}')">＋ 항목 추가</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="QualityPage.closeModal('gate-config-modal')">취소</button>
        <button class="btn btn-primary" onclick="QualityPage.saveGateConfig()">저장</button>
      </div>
    `;
    window._gateConfig = JSON.parse(JSON.stringify(gates));
    openModal('gate-config-modal');
  };

  const updateItem  = (gateId, idx, val) => { const g = window._gateConfig.find(x => x.id === gateId); if (g) g.items[idx] = val; };
  const removeItem  = (gateId, idx) => { const g = window._gateConfig.find(x => x.id === gateId); if (g) { g.items.splice(idx, 1); renderGateConfig(); } };
  const addItem     = (gateId) => { const g = window._gateConfig.find(x => x.id === gateId); if (g) { g.items.push('새 검사 항목'); renderGateConfig(); } };
  const toggleRequired = (gateId, val) => { const g = window._gateConfig.find(x => x.id === gateId); if (g) g.required = val; };

  const renderGateConfig = () => { openGateConfig(); };

  const saveGateConfig = () => {
    DB.saveQCConfig(window._gateConfig);
    closeModal('gate-config-modal');
    App.toast('품질 게이트 설정 저장됨', 'success');
    App.refreshPage();
  };

  const openModal  = (id) => document.getElementById(id)?.classList.add('open');
  const closeModal = (id) => document.getElementById(id)?.classList.remove('open');

  const afterRender = () => {};

  return {
    render, afterRender, openInspect, setCheck, submitInspect, markFail,
    previewPhoto, viewInspection, toAgenda, openGateConfig, saveGateConfig,
    updateItem, removeItem, addItem, toggleRequired,
    closeModal
  };
})();
