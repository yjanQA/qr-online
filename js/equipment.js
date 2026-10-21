// ============================================================
// equipment.js — 설비관리 · OEE · 예지보전 · 수리내역
// ============================================================

const EquipmentPage = (() => {
  const STATUS = { RUN:{t:'가동',c:'badge-pass'}, IDLE:{t:'대기',c:'badge-info'}, DOWN:{t:'고장정지',c:'badge-fail'}, MAINT:{t:'정비중',c:'badge-warning'} };
  const oeeColor = (v) => v >= 85 ? 'var(--success)' : v >= 60 ? 'var(--warning)' : 'var(--danger)';

  const render = () => {
    const factory = App.getFactory();
    const eqs  = DB.getEquipment(factory);
    const due  = DB.getMaintenanceDue(factory);
    const oees = DB.getOEERecords(factory).slice(0, 10);
    const logs = DB.getEquipLogs().filter(l => factory === 'ALL' || l.factory === factory).slice(0, 30);
    const running = eqs.filter(e => e.status === 'RUN').length;
    const down    = eqs.filter(e => e.status === 'DOWN').length;
    const avgOee  = oees.length ? Math.round(oees.reduce((s,o)=>s+o.oee,0)/oees.length*10)/10 : 0;

    return `
      <div class="fade-in">
        <div class="flex items-center justify-between mb-20">
          <div class="text-sm text-muted">설비 ${eqs.length}대 · 가동 ${running} · 고장 ${down} · 정비임박 ${due.length}</div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" onclick="EquipmentPage.openEquipModal()">＋ 설비 등록</button>
            <button class="btn btn-ghost btn-sm" onclick="EquipmentPage.openOeeModal()">OEE 입력</button>
            <button class="btn btn-primary btn-sm" onclick="EquipmentPage.openLogModal()">점검·수리</button>
          </div>
        </div>

        <div class="inventory-summary-grid mb-20">
          <div class="inventory-summary-card"><div class="summary-label">가동 설비</div><div class="summary-value">${running}<span>대</span></div></div>
          <div class="inventory-summary-card ${down>0?'summary-risk':''}"><div class="summary-label">고장 정지</div><div class="summary-value">${down}<span>대</span></div></div>
          <div class="inventory-summary-card ${due.length>0?'summary-risk':''}"><div class="summary-label">예방정비 임박</div><div class="summary-value">${due.length}<span>건</span></div></div>
          <div class="inventory-summary-card"><div class="summary-label">평균 OEE</div><div class="summary-value" style="color:${oeeColor(avgOee)}">${avgOee}<span>%</span></div></div>
        </div>

        ${due.length > 0 ? `
        <div class="section-title mb-12">예방정비 알림</div>
        <div class="card" style="margin-bottom:20px">
          <div class="table-wrapper"><table>
            <thead><tr><th>설비</th><th>공장</th><th>최근점검</th><th>다음정비</th><th>D-Day</th><th>액션</th></tr></thead>
            <tbody>${due.map(e => `<tr${e.overdue?' style="background:rgba(239,68,68,.05)"':''}>
              <td><strong>${e.name}</strong> <span class="td-mono text-xs">${e.code}</span></td>
              <td>${DB.getFactoryName(e.factory)}</td>
              <td class="text-xs">${e.lastCheck||'-'}</td>
              <td class="text-xs">${e.nextCheck}</td>
              <td>${e.overdue ? `<span class="badge badge-fail">지남 ${Math.abs(e.dday)}일</span>` : `<span class="badge badge-warning">D-${e.dday}</span>`}</td>
              <td style="white-space:nowrap"><button class="btn btn-ghost btn-xs" onclick="EquipmentPage.openLogModal('${e.id}','CHECK')">점검완료</button>
                <button class="btn btn-ghost btn-xs" onclick="EquipmentPage.toAgenda('${e.id}')">회의안건</button></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>` : ''}

        <div class="section-title mb-12">설비 현황</div>
        <div class="card" style="margin-bottom:20px">
          <div class="table-wrapper"><table>
            <thead><tr><th>코드</th><th>설비명</th><th>공장</th><th>유형</th><th>상태</th><th class="td-right">누적가동</th><th>다음정비</th><th>액션</th></tr></thead>
            <tbody>${eqs.length===0?`<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted)">등록된 설비가 없습니다</td></tr>`:
              eqs.map(e => `<tr>
                <td class="td-mono text-xs">${e.code}</td>
                <td><strong>${e.name}</strong></td>
                <td>${DB.getFactoryName(e.factory)}</td>
                <td class="text-xs">${e.type||'-'}</td>
                <td>
                  <select class="form-input" style="height:28px;padding:2px 6px;font-size:12px;width:auto;display:inline-block" onchange="EquipmentPage.changeStatus('${e.id}', this.value)">
                    ${Object.keys(STATUS).map(s=>`<option value="${s}" ${e.status===s?'selected':''}>${STATUS[s].t}</option>`).join('')}
                  </select>
                </td>
                <td class="td-right">${formatNum(e.runtimeHours||0)}h</td>
                <td class="text-xs">${e.nextCheck||'-'}</td>
                <td><button class="btn btn-ghost btn-xs" onclick="EquipmentPage.openLogModal('${e.id}')">기록</button></td>
              </tr>`).join('')}</tbody>
          </table></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="eq-two-col">
          <div>
            <div class="section-title mb-12">최근 OEE</div>
            <div class="card"><div class="table-wrapper"><table>
              <thead><tr><th>일자</th><th>설비</th><th class="td-right">가동률</th><th class="td-right">성능</th><th class="td-right">품질</th><th class="td-right">OEE</th></tr></thead>
              <tbody>${oees.length===0?`<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">OEE 기록 없음</td></tr>`:
                oees.map(o=>`<tr>
                  <td class="text-xs">${o.date}</td><td class="text-xs">${o.equipName}</td>
                  <td class="td-right">${o.availability}%</td><td class="td-right">${o.performance}%</td><td class="td-right">${o.quality}%</td>
                  <td class="td-right font-bold" style="color:${oeeColor(o.oee)}">${o.oee}%</td>
                </tr>`).join('')}</tbody>
            </table></div></div>
          </div>
          <div>
            <div class="section-title mb-12">점검·수리 이력</div>
            <div class="card"><div class="table-wrapper"><table>
              <thead><tr><th>일시</th><th>설비</th><th>구분</th><th>내용</th><th class="td-right">비용</th></tr></thead>
              <tbody>${logs.length===0?`<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">기록 없음</td></tr>`:
                logs.map(l=>`<tr>
                  <td class="text-xs">${App.formatDate(l.at)}</td><td class="text-xs">${l.equipName}</td>
                  <td>${({RUN:'가동',STOP:'정지',REPAIR:'수리',CHECK:'점검'})[l.type]||l.type}</td>
                  <td class="text-xs">${l.memo||'-'}${l.downtimeMin?` <span class="text-muted">(${l.downtimeMin}분)</span>`:''}</td>
                  <td class="td-right">${l.cost?formatNum(l.cost)+'원':'-'}</td>
                </tr>`).join('')}</tbody>
            </table></div></div>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="eq-log-modal"><div class="modal" style="max-width:480px"><div class="modal-header"><h3>점검·수리 기록</h3><button class="modal-close" onclick="EquipmentPage.close('eq-log-modal')">✕</button></div><div id="eq-log-body"></div></div></div>
      <div class="modal-overlay" id="eq-oee-modal"><div class="modal" style="max-width:520px"><div class="modal-header"><h3>OEE 입력</h3><button class="modal-close" onclick="EquipmentPage.close('eq-oee-modal')">✕</button></div><div id="eq-oee-body"></div></div></div>
      <div class="modal-overlay" id="eq-add-modal"><div class="modal" style="max-width:480px"><div class="modal-header"><h3>설비 등록</h3><button class="modal-close" onclick="EquipmentPage.close('eq-add-modal')">✕</button></div><div id="eq-add-body"></div></div></div>
    `;
  };

  const changeStatus = (id, status) => { DB.setEquipStatus(id, status); App.toast('설비 상태 변경', 'info'); App.refreshPage(); };

  const openLogModal = (equipId = '', type = 'REPAIR') => {
    const body = document.getElementById('eq-log-body'); if (!body) return;
    const eqs = DB.getEquipment('ALL');
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="form-group"><label class="form-label">설비 *</label>
          <select class="form-input" id="el-eq">${eqs.map(e=>`<option value="${e.id}" ${e.id===equipId?'selected':''}>${e.code} · ${e.name}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">구분</label>
          <select class="form-input" id="el-type">
            <option value="REPAIR" ${type==='REPAIR'?'selected':''}>수리</option>
            <option value="CHECK" ${type==='CHECK'?'selected':''}>점검(예방정비)</option>
            <option value="STOP">정지</option>
          </select></div>
        <div class="form-group"><label class="form-label">내용</label><textarea class="form-input" id="el-memo" rows="2" placeholder="증상/조치 내용"></textarea></div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">비가동(분)</label><input type="number" class="form-input" id="el-down" value="0"></div>
          <div class="form-group"><label class="form-label">비용(원)</label><input type="number" class="form-input" id="el-cost" value="0"></div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" id="el-restore" checked> 수리 완료 후 가동상태로 복귀</label>
        <div class="form-group"><label class="form-label">담당자</label><input class="form-input" id="el-actor" value="설비팀"></div>
        <div class="modal-footer"><button class="btn btn-ghost" onclick="EquipmentPage.close('eq-log-modal')">취소</button><button class="btn btn-primary" onclick="EquipmentPage.submitLog()">저장</button></div>
      </div>`;
    document.getElementById('eq-log-modal').classList.add('open');
  };

  const submitLog = () => {
    const equipId = document.getElementById('el-eq')?.value;
    DB.addEquipLog({
      equipId, type: document.getElementById('el-type')?.value,
      memo: document.getElementById('el-memo')?.value.trim(),
      downtimeMin: document.getElementById('el-down')?.value,
      cost: document.getElementById('el-cost')?.value,
      restore: document.getElementById('el-restore')?.checked,
      actor: document.getElementById('el-actor')?.value.trim() || '설비팀',
    });
    close('eq-log-modal'); App.toast('설비 기록 저장', 'success'); App.refreshPage();
  };

  const openOeeModal = () => {
    const body = document.getElementById('eq-oee-body'); if (!body) return;
    const eqs = DB.getEquipment('ALL');
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="form-group"><label class="form-label">설비 *</label>
          <select class="form-input" id="oe-eq">${eqs.map(e=>`<option value="${e.id}">${e.code} · ${e.name}</option>`).join('')}</select></div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">계획가동(분)</label><input type="number" class="form-input" id="oe-plan" placeholder="예) 480"></div>
          <div class="form-group"><label class="form-label">실가동(분)</label><input type="number" class="form-input" id="oe-run" placeholder="예) 420"></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">이상생산속도(/분)</label><input type="number" class="form-input" id="oe-rate" placeholder="예) 50"></div>
          <div class="form-group"><label class="form-label">생산수량</label><input type="number" class="form-input" id="oe-prod" placeholder="예) 19000"></div>
        </div>
        <div class="form-group"><label class="form-label">양품수량</label><input type="number" class="form-input" id="oe-good" placeholder="예) 18600"></div>
        <div class="text-xs text-muted">OEE = 가동률 × 성능 × 품질 로 자동 계산됩니다.</div>
        <div class="modal-footer"><button class="btn btn-ghost" onclick="EquipmentPage.close('eq-oee-modal')">취소</button><button class="btn btn-primary" onclick="EquipmentPage.submitOee()">계산·저장</button></div>
      </div>`;
    document.getElementById('eq-oee-modal').classList.add('open');
  };

  const submitOee = () => {
    const rec = DB.addOEE({
      equipId: document.getElementById('oe-eq')?.value,
      plannedMin: document.getElementById('oe-plan')?.value,
      runMin: document.getElementById('oe-run')?.value,
      idealRate: document.getElementById('oe-rate')?.value,
      producedQty: document.getElementById('oe-prod')?.value,
      goodQty: document.getElementById('oe-good')?.value,
    });
    close('eq-oee-modal'); App.toast(`OEE ${rec.oee}% 저장 완료`, 'success'); App.refreshPage();
  };

  const openEquipModal = () => {
    const body = document.getElementById('eq-add-body'); if (!body) return;
    const factories = DB.getFactories();
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">코드 *</label><input class="form-input" id="ea-code" placeholder="예) MIX-02"></div>
          <div class="form-group"><label class="form-label">설비명 *</label><input class="form-input" id="ea-name" placeholder="예) 배합 믹서 2호"></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">공장</label><select class="form-input" id="ea-factory">${factories.map(f=>`<option value="${f.id}" ${f.id===App.getFactory()?'selected':''}>${f.name}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">유형</label><input class="form-input" id="ea-type" placeholder="예) 배합/성형/포장/검사"></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">설치일</label><input type="date" class="form-input" id="ea-install"></div>
          <div class="form-group"><label class="form-label">다음 정비일</label><input type="date" class="form-input" id="ea-next"></div>
        </div>
        <div class="modal-footer"><button class="btn btn-ghost" onclick="EquipmentPage.close('eq-add-modal')">취소</button><button class="btn btn-primary" onclick="EquipmentPage.submitEquip()">등록</button></div>
      </div>`;
    document.getElementById('eq-add-modal').classList.add('open');
  };

  const submitEquip = () => {
    const code = document.getElementById('ea-code')?.value.trim();
    const name = document.getElementById('ea-name')?.value.trim();
    if (!code || !name) { App.toast('코드와 설비명을 입력하세요', 'error'); return; }
    DB.addEquipment({
      code, name, factory: document.getElementById('ea-factory')?.value || 'AS',
      type: document.getElementById('ea-type')?.value.trim(),
      installDate: document.getElementById('ea-install')?.value || '',
      lastCheck: '', nextCheck: document.getElementById('ea-next')?.value || '',
    });
    close('eq-add-modal'); App.toast('설비 등록 완료', 'success'); App.refreshPage();
  };

  // 품질회의 안건으로 올리기 — 정비 기한 초과·고장 설비
  const toAgenda = (equipId) => {
    const e = (DB.getEquipment('ALL') || []).find(x => x.id === equipId);
    if (!e || typeof MeetingPage === 'undefined') return;
    const fx = (e.factory && e.factory !== 'undefined') ? e.factory : '';
    const down = e.status === 'DOWN';
    MeetingPage.quickAgenda({
      sourceType: 'EQUIP',
      sourceId: e.id,
      sourceLabel: `${e.code || ''} ${e.name || ''}`.trim(),
      title: `[설비] ${e.name} — ${down ? '고장 정지' : '예방정비 대상'}`,
      content: `${e.code || ''} ${e.name || ''}\n최근점검 ${e.lastCheck || '-'} · 다음정비 ${e.nextCheck || '-'}${down ? '\n현재 상태: 고장 정지' : ''}`,
      category: '설비·시설',
      factory: fx,
      priority: down ? '긴급' : '높음',
    });
  };

  const close = (id) => document.getElementById(id)?.classList.remove('open');
  const afterRender = () => {};
  return { render, afterRender, changeStatus, openLogModal, submitLog, openOeeModal, submitOee, openEquipModal, submitEquip, toAgenda, close };
})();
