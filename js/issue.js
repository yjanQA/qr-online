// ============================================================
// issue.js — 공정 이슈 기록 (품질/설비/안전 이상)
// ============================================================

const ProcessIssuePage = (() => {
  const SEV = { HIGH:{t:'긴급',c:'badge-fail'}, MEDIUM:{t:'중간',c:'badge-warning'}, LOW:{t:'낮음',c:'badge-info'} };
  const ST  = { OPEN:{t:'접수',c:'badge-warning'}, ACTION:{t:'조치중',c:'badge-info'}, CLOSED:{t:'완료',c:'badge-pass'} };

  const render = () => {
    const factory = App.getFactory();
    const issues  = DB.getIssues(factory);
    const open    = issues.filter(i => i.status !== 'CLOSED').length;

    return `
      <div class="fade-in">
        <div class="flex items-center justify-between mb-20">
          <div class="text-sm text-muted">공정 이슈 ${issues.length}건 · 미해결 ${open}건</div>
          <button class="btn btn-primary btn-sm" onclick="ProcessIssuePage.openAddModal()">＋ 이슈 등록</button>
        </div>

        <div class="card">
          <div class="table-wrapper"><table>
            <thead><tr><th>일시</th><th>공장</th><th>공정</th><th>분류</th><th>제목</th><th>긴급도</th><th>상태</th><th>보고자</th><th>액션</th></tr></thead>
            <tbody>${issues.length===0?`<tr><td colspan="9" style="text-align:center;padding:28px;color:var(--text-muted)">등록된 공정 이슈가 없습니다</td></tr>`:
              issues.map(i => `<tr${i.severity==='HIGH'&&i.status!=='CLOSED'?' style="background:rgba(239,68,68,.05)"':''}>
                <td class="text-xs">${App.formatDate(i.createdAt)}</td>
                <td>${DB.getFactoryName(i.factory)}</td>
                <td class="text-xs">${i.processStep||'-'}</td>
                <td class="text-xs">${i.category}</td>
                <td><strong>${i.title}</strong>${i.detail?`<div class="text-xs text-muted">${i.detail}</div>`:''}${i.action?`<div class="text-xs" style="color:var(--success)">↳ ${i.action}</div>`:''}</td>
                <td><span class="badge ${SEV[i.severity]?.c||''}">${SEV[i.severity]?.t||i.severity}</span></td>
                <td><span class="badge ${ST[i.status]?.c||''}">${ST[i.status]?.t||i.status}</span></td>
                <td class="text-xs">${i.reporter}</td>
                <td style="white-space:nowrap">${i.status!=='CLOSED'?`<button class="btn btn-ghost btn-xs" onclick="ProcessIssuePage.openResolveModal('${i.id}')">조치</button>`:''}<button class="btn btn-ghost btn-xs" onclick="ProcessIssuePage.toAgenda('${i.id}')">회의안건</button></td>
              </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>

      <div class="modal-overlay" id="pi-add-modal"><div class="modal" style="max-width:480px"><div class="modal-header"><h3>공정 이슈 등록</h3><button class="modal-close" onclick="ProcessIssuePage.close('pi-add-modal')">✕</button></div><div id="pi-add-body"></div></div></div>
      <div class="modal-overlay" id="pi-res-modal"><div class="modal" style="max-width:440px"><div class="modal-header"><h3>이슈 조치</h3><button class="modal-close" onclick="ProcessIssuePage.close('pi-res-modal')">✕</button></div><div id="pi-res-body"></div></div></div>
    `;
  };

  const openAddModal = () => {
    const body = document.getElementById('pi-add-body'); if (!body) return;
    const factories = DB.getFactories();
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">공장</label><select class="form-input" id="pi-factory">${factories.map(f=>`<option value="${f.id}" ${f.id===App.getFactory()?'selected':''}>${f.name}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">공정단계</label><input class="form-input" id="pi-step" placeholder="예) 배합/성형/포장"></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">분류</label><select class="form-input" id="pi-cat"><option>품질</option><option>설비</option><option>안전</option><option>원료</option><option>기타</option></select></div>
          <div class="form-group"><label class="form-label">긴급도</label><select class="form-input" id="pi-sev"><option value="HIGH">긴급</option><option value="MEDIUM" selected>중간</option><option value="LOW">낮음</option></select></div>
        </div>
        <div class="form-group"><label class="form-label">제목 *</label><input class="form-input" id="pi-title" placeholder="예) 펠릿기 온도 급상승"></div>
        <div class="form-group"><label class="form-label">상세 내용</label><textarea class="form-input" id="pi-detail" rows="3"></textarea></div>
        <div class="form-group"><label class="form-label">보고자</label><input class="form-input" id="pi-reporter" value="현장"></div>
        <div class="modal-footer"><button class="btn btn-ghost" onclick="ProcessIssuePage.close('pi-add-modal')">취소</button><button class="btn btn-primary" onclick="ProcessIssuePage.submitAdd()">등록</button></div>
      </div>`;
    document.getElementById('pi-add-modal').classList.add('open');
  };

  const submitAdd = () => {
    const title = document.getElementById('pi-title')?.value.trim();
    if (!title) { App.toast('제목을 입력하세요', 'error'); return; }
    DB.addIssue({
      factory: document.getElementById('pi-factory')?.value || 'AS',
      processStep: document.getElementById('pi-step')?.value.trim(),
      category: document.getElementById('pi-cat')?.value,
      severity: document.getElementById('pi-sev')?.value,
      title, detail: document.getElementById('pi-detail')?.value.trim(),
      reporter: document.getElementById('pi-reporter')?.value.trim() || '현장',
    });
    close('pi-add-modal'); App.toast('공정 이슈 등록', 'success'); App.updateBadges(); App.refreshPage();
  };

  const openResolveModal = (id) => {
    const i = DB.getIssues('ALL').find(x => x.id === id);
    const body = document.getElementById('pi-res-body'); if (!body || !i) return;
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="text-sm"><strong>${i.title}</strong></div>
        <div class="form-group"><label class="form-label">조치 내용</label><textarea class="form-input" id="pr-action" rows="3">${i.action||''}</textarea></div>
        <div class="form-group"><label class="form-label">상태</label><select class="form-input" id="pr-status"><option value="ACTION" ${i.status==='ACTION'?'selected':''}>조치중</option><option value="CLOSED">완료</option></select></div>
        <div class="modal-footer"><button class="btn btn-ghost" onclick="ProcessIssuePage.close('pi-res-modal')">취소</button><button class="btn btn-primary" onclick="ProcessIssuePage.submitResolve('${id}')">저장</button></div>
      </div>`;
    document.getElementById('pi-res-modal').classList.add('open');
  };

  const submitResolve = (id) => {
    DB.updateIssue(id, { action: document.getElementById('pr-action')?.value.trim(), status: document.getElementById('pr-status')?.value });
    close('pi-res-modal'); App.toast('조치 내용 저장', 'success'); App.updateBadges(); App.refreshPage();
  };

  // 품질회의 안건으로 올리기
  //   공정이슈 분류를 회의 안건 분류로 옮긴다(설비→설비·시설, 품질→제품 품질, 그 외→공정 관리)
  const AGENDA_CAT = { 설비: '설비·시설', 품질: '제품 품질', 위생: '위생 관리' };
  const toAgenda = (id) => {
    const i = (DB.getIssues('ALL') || []).find(x => x.id === id);
    if (!i || typeof MeetingPage === 'undefined') return;
    // 공장 select 버그로 'undefined' 문자열이 저장된 레코드가 있다
    const fx = (i.factory && i.factory !== 'undefined') ? i.factory : '';
    MeetingPage.quickAgenda({
      sourceType: 'ISSUE',
      sourceId: i.id,
      sourceLabel: `${App.formatDate(i.createdAt)} ${i.processStep || ''}`.trim(),
      title: `[공정이슈] ${i.title}`,
      content: `${i.detail || ''}${i.action ? `\n기존 조치: ${i.action}` : ''}`,
      category: AGENDA_CAT[i.category] || '공정 관리',
      factory: fx,
      priority: i.severity === 'HIGH' ? '긴급' : i.severity === 'LOW' ? '낮음' : '보통',
    });
  };

  const close = (id) => document.getElementById(id)?.classList.remove('open');
  const afterRender = () => {};
  return { render, afterRender, openAddModal, submitAdd, openResolveModal, submitResolve, toAgenda, close };
})();
