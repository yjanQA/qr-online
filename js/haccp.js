// ============================================================
// haccp.js — 스마트 HACCP / CCP 실시간 모니터링
// ============================================================

const HaccpPage = (() => {
  const judgeBadge = (j) => j === 'DEVIATION'
    ? '<span class="badge badge-fail">한계이탈</span>'
    : '<span class="badge badge-pass">정상</span>';

  const clText = (d) => {
    if (d.limitType === 'pass')  return '합격 판정';
    if (d.limitType === 'min')   return `≥ ${d.clMin}${d.unit}`;
    if (d.limitType === 'max')   return `≤ ${d.clMax}${d.unit}`;
    if (d.limitType === 'range') return `${d.clMin}~${d.clMax}${d.unit}`;
    return '-';
  };

  const render = () => {
    const factory = App.getFactory();
    const status  = DB.getCCPStatus(factory);
    const logs    = DB.getCCPLogs(factory).slice(0, 40);
    const devCount = status.reduce((s, x) => s + x.deviations, 0);

    return `
      <div class="fade-in">
        <div class="flex items-center justify-between mb-20">
          <div class="text-sm text-muted">중요관리점(CCP) ${status.length}개 · 오늘 한계이탈 ${devCount}건</div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" onclick="HaccpPage.openDefModal()">＋ CCP 등록</button>
            <button class="btn btn-primary btn-sm" onclick="HaccpPage.openLogModal()">측정 기록</button>
          </div>
        </div>

        ${devCount > 0 ? `<div class="card" style="border-left:4px solid var(--danger);margin-bottom:16px;padding:12px 16px;background:rgba(239,68,68,.06)">
          <strong style="color:var(--danger)">한계기준 이탈 ${devCount}건</strong> — 개선조치 확인이 필요합니다.
        </div>` : ''}

        <div class="ccp-status-grid mb-24" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
          ${status.map(s => {
            const dev = s.last && s.last.judged === 'DEVIATION';
            return `
            <div class="card" style="padding:14px;border-left:4px solid ${dev?'var(--danger)':(s.last?'var(--success)':'var(--border)')}">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span class="td-mono text-xs">${s.def.code}</span>
                ${s.last ? judgeBadge(s.last.judged) : '<span class="badge badge-default">미측정</span>'}
              </div>
              <div style="font-weight:700;margin:6px 0 2px">${s.def.name}</div>
              <div class="text-xs text-muted">${s.def.processStep} · 한계 ${clText(s.def)}</div>
              <div style="margin-top:8px;font-size:20px;font-weight:700">
                ${s.last ? `${s.last.value}<span style="font-size:12px;color:var(--text-muted)">${s.def.unit}</span>` : '<span style="font-size:14px;color:var(--text-muted)">기록 없음</span>'}
              </div>
              <div class="text-xs text-muted">${s.last ? App.formatDate(s.last.measuredAt) + ' · ' + s.last.measuredBy : '주기: ' + s.def.monitorCycle}</div>
              ${s.deviations > 0 ? `<div class="text-xs" style="color:var(--danger);margin-top:4px">오늘 이탈 ${s.deviations}건</div>` : ''}
            </div>`;
          }).join('') || '<div class="empty-state"><div class="empty-icon"></div><h3>등록된 CCP가 없습니다</h3></div>'}
        </div>

        <div class="section-title mb-12">모니터링 기록</div>
        <div class="card">
          <div class="table-wrapper">
            <table>
              <thead>
                <tr><th>일시</th><th>CCP</th><th>공정</th><th class="td-right">측정값</th><th>판정</th><th>참조LOT</th><th>개선조치</th><th>담당</th></tr>
              </thead>
              <tbody>
                ${logs.length === 0 ? `<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--text-muted)">모니터링 기록이 없습니다</td></tr>` :
                logs.map(l => `<tr${l.judged==='DEVIATION'?' style="background:rgba(239,68,68,.05)"':''}>
                  <td class="text-xs">${App.formatDate(l.measuredAt)}</td>
                  <td><strong>${l.ccpName}</strong></td>
                  <td class="text-xs">${l.param}</td>
                  <td class="td-right font-bold">${l.value}${l.unit}</td>
                  <td>${judgeBadge(l.judged)}</td>
                  <td class="td-mono text-xs">${l.refLotNo || '-'}</td>
                  <td class="text-xs">${l.correctiveAction || '-'}</td>
                  <td class="text-xs">${l.measuredBy}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 측정 기록 모달 -->
      <div class="modal-overlay" id="ccp-log-modal">
        <div class="modal" style="max-width:480px">
          <div class="modal-header"><h3>CCP 측정 기록</h3><button class="modal-close" onclick="HaccpPage.close('ccp-log-modal')">✕</button></div>
          <div id="ccp-log-body"></div>
        </div>
      </div>

      <!-- CCP 정의 모달 -->
      <div class="modal-overlay" id="ccp-def-modal">
        <div class="modal" style="max-width:520px">
          <div class="modal-header"><h3>CCP 등록</h3><button class="modal-close" onclick="HaccpPage.close('ccp-def-modal')">✕</button></div>
          <div id="ccp-def-body"></div>
        </div>
      </div>
    `;
  };

  const openLogModal = () => {
    const factory = App.getFactory();
    const defs = DB.getCCPDefs(factory === 'ALL' ? 'ALL' : factory);
    const body = document.getElementById('ccp-log-body');
    if (!body) return;
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div class="form-group">
          <label class="form-label">중요관리점(CCP) *</label>
          <select class="form-input" id="ccp-sel" onchange="HaccpPage.onSelCCP()">
            ${defs.map(d => `<option value="${d.id}">${d.code} · ${d.name} (한계 ${clText(d)})</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">측정값 *</label>
          <input type="text" class="form-input" id="ccp-val" placeholder="예) 82 또는 합격">
          <div class="text-xs text-muted" id="ccp-hint" style="margin-top:4px"></div>
        </div>
        <div class="form-group">
          <label class="form-label">참조 LOT(선택)</label>
          <input type="text" class="form-input" id="ccp-lot" placeholder="배치/제품 LOT">
        </div>
        <div class="form-group" id="ccp-action-wrap" style="display:none">
          <label class="form-label" style="color:var(--danger)">개선조치(이탈 시)</label>
          <textarea class="form-input" id="ccp-action" rows="2"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">담당자</label>
          <input type="text" class="form-input" id="ccp-by" value="현장">
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="HaccpPage.close('ccp-log-modal')">취소</button>
          <button class="btn btn-primary" onclick="HaccpPage.submitLog()">기록 저장</button>
        </div>
      </div>`;
    document.getElementById('ccp-log-modal').classList.add('open');
    onSelCCP();
  };

  const onSelCCP = () => {
    const id = document.getElementById('ccp-sel')?.value;
    const d  = DB.getCCPDefs('ALL').find(x => x.id === id);
    const hint = document.getElementById('ccp-hint');
    if (d && hint) hint.textContent = `한계기준: ${clText(d)} · 이탈 시 조치: ${d.action}`;
  };

  const submitLog = () => {
    const ccpId = document.getElementById('ccp-sel')?.value;
    const value = document.getElementById('ccp-val')?.value.trim();
    const refLotNo = document.getElementById('ccp-lot')?.value.trim();
    const correctiveAction = document.getElementById('ccp-action')?.value.trim();
    const measuredBy = document.getElementById('ccp-by')?.value.trim() || '현장';
    if (!value) { App.toast('측정값을 입력하세요', 'error'); return; }
    const rec = DB.addCCPLog({ ccpId, value, refLotNo, correctiveAction, measuredBy });
    close('ccp-log-modal');
    if (rec.judged === 'DEVIATION') App.toast(`한계기준 이탈! 개선조치를 확인하세요`, 'error', 5000);
    else App.toast('CCP 측정 기록 완료', 'success');
    App.refreshPage();
  };

  const openDefModal = () => {
    const body = document.getElementById('ccp-def-body');
    if (!body) return;
    const factories = DB.getFactories();
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">코드 *</label><input class="form-input" id="cd-code" placeholder="예) CCP-1B"></div>
          <div class="form-group"><label class="form-label">CCP 명 *</label><input class="form-input" id="cd-name" placeholder="예) 가열공정 온도"></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">공정단계</label><input class="form-input" id="cd-step" placeholder="예) 가열"></div>
          <div class="form-group"><label class="form-label">공장</label><select class="form-input" id="cd-factory">${factories.map(f=>`<option value="${f.code}">${f.name}</option>`).join('')}</select></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">관리항목</label><input class="form-input" id="cd-param" placeholder="예) 온도/수분/금속검출"></div>
          <div class="form-group"><label class="form-label">단위</label><input class="form-input" id="cd-unit" placeholder="예) ℃"></div>
        </div>
        <div class="form-group"><label class="form-label">한계기준 유형</label>
          <select class="form-input" id="cd-type" onchange="HaccpPage.onDefType()">
            <option value="min">최소(≥)</option><option value="max">최대(≤)</option><option value="range">범위</option><option value="pass">합격판정</option>
          </select>
        </div>
        <div class="form-grid form-grid-2" id="cd-cl-wrap">
          <div class="form-group"><label class="form-label">하한(CL min)</label><input type="number" class="form-input" id="cd-min"></div>
          <div class="form-group"><label class="form-label">상한(CL max)</label><input type="number" class="form-input" id="cd-max"></div>
        </div>
        <div class="form-group"><label class="form-label">이탈 시 개선조치</label><textarea class="form-input" id="cd-action" rows="2"></textarea></div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="HaccpPage.close('ccp-def-modal')">취소</button>
          <button class="btn btn-primary" onclick="HaccpPage.submitDef()">CCP 등록</button>
        </div>
      </div>`;
    document.getElementById('ccp-def-modal').classList.add('open');
    onDefType();
  };

  const onDefType = () => {
    const t = document.getElementById('cd-type')?.value;
    const wrap = document.getElementById('cd-cl-wrap');
    if (wrap) wrap.style.display = (t === 'pass') ? 'none' : '';
  };

  const submitDef = () => {
    const code = document.getElementById('cd-code')?.value.trim();
    const name = document.getElementById('cd-name')?.value.trim();
    if (!code || !name) { App.toast('코드와 CCP명을 입력하세요', 'error'); return; }
    DB.addCCPDef({
      code, name,
      processStep: document.getElementById('cd-step')?.value.trim(),
      factory: document.getElementById('cd-factory')?.value || 'AS',
      param: document.getElementById('cd-param')?.value.trim(),
      unit: document.getElementById('cd-unit')?.value.trim(),
      limitType: document.getElementById('cd-type')?.value,
      clMin: document.getElementById('cd-min')?.value ? Number(document.getElementById('cd-min').value) : null,
      clMax: document.getElementById('cd-max')?.value ? Number(document.getElementById('cd-max').value) : null,
      monitorCycle: '배치',
      action: document.getElementById('cd-action')?.value.trim(),
    });
    close('ccp-def-modal');
    App.toast('CCP 등록 완료', 'success');
    App.refreshPage();
  };

  const close = (id) => document.getElementById(id)?.classList.remove('open');
  const afterRender = () => {};
  return { render, afterRender, openLogModal, onSelCCP, submitLog, openDefModal, onDefType, submitDef, close };
})();
