// ============================================================
// journal_setup.js — 일지 양식 설정 (일지설정관리)
//   새 일지가 필요할 때 화면을 개발하지 않고 양식만 등록하면 바로 쓰인다.
//     · 점검항목(rows) : 라벨 / 입력유형 / 단위 / 한계기준(min~max) / 부적합 선택지
//     · 점검대상(targets) : 설비·구역 단위로 행이 반복되는 매트릭스형 일지
//     · 주기(cycle) : 미작성 지연 판정 기준
//     · 결재선 : 검토자·승인자 지정
// ============================================================

const JournalSetupPage = (() => {
  let editId = null;         // 편집 중인 양식 id ('NEW' = 신규)
  let draft = null;          // 편집 중 사본
  let fCat = 'ALL';
  let showInactive = false;

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const fac = () => (typeof App !== 'undefined' && App.getFactory) ? App.getFactory() : 'ALL';

  // ============================================================
  // 목록
  // ============================================================
  const listView = () => {
    let tpls = JournalDB.getTemplates({ category: fCat });
    if (!showInactive) tpls = tpls.filter(t => t.active !== false);
    const due = {}; JournalDB.dueList('ALL').forEach(d => { due[d.tpl.id] = d; });

    const catTabs = ['ALL'].concat(JournalDB.CATEGORIES).map(c =>
      `<button class="factory-tab ${fCat === c ? 'active' : ''}" onclick="JournalSetupPage.setCat('${c}')">${c === 'ALL' ? '전체' : c}</button>`).join('');

    const rows = tpls.length ? tpls.map(t => {
      const d = due[t.id] || {};
      const off = t.active === false;
      return `<tr${off ? ' style="opacity:.5"' : ''}>
        <td class="td-mono text-xs">${esc(t.code)}</td>
        <td><strong>${esc(t.name)}</strong>${t.builtin ? ' <span class="badge badge-default text-xs">표준</span>' : ''}
          ${t.note ? `<div class="text-muted text-xs" style="max-width:420px">${esc(t.note)}</div>` : ''}</td>
        <td class="text-xs">${esc(t.category)}</td>
        <td class="text-xs">${JournalDB.cycleLabel(t.cycle)}</td>
        <td style="text-align:center">${(t.targets || []).length || '-'}</td>
        <td style="text-align:center">${(t.rows || []).length}</td>
        <td class="text-xs">${d.last ? esc(d.last) : '<span class="text-muted">미작성</span>'}</td>
        <td style="text-align:center">${d.overdue > 0
          ? `<span class="badge badge-fail">${d.last ? d.overdue + '일 초과' : '미작성 ' + d.overdue + '일'}</span>`
          : '<span class="badge badge-pass">정상</span>'}</td>
        <td style="text-align:center">${off ? '<span class="badge badge-default">미사용</span>' : '<span class="badge badge-pass">사용</span>'}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-xs" onclick="JournalSetupPage.edit('${t.id}')">편집</button>
          <button class="btn btn-ghost btn-xs" onclick="JournalSetupPage.toggle('${t.id}')">${off ? '사용' : '중지'}</button>
          <button class="btn btn-ghost btn-xs" onclick="JournalSetupPage.copy('${t.id}')">복제</button>
          <button class="btn btn-ghost btn-xs" onclick="JournalSetupPage.del('${t.id}')">삭제</button>
        </td>
      </tr>`;
    }).join('') : `<tr><td colspan="10" class="text-muted" style="text-align:center;padding:26px">등록된 양식이 없습니다</td></tr>`;

    const lines = JournalDB.getLines();
    const lineRows = lines.length ? lines.map(l => {
      const t = l.tplId === 'ALL' ? null : JournalDB.getTemplate(l.tplId);
      return `<tr>
        <td>${esc(l.name)}</td>
        <td class="text-xs">${t ? esc(t.name) : '<span class="text-muted">전체 일지 공통</span>'}</td>
        <td class="text-xs">${esc((l.reviewer && l.reviewer.name) || '-')}</td>
        <td class="text-xs">${esc((l.approver && l.approver.name) || '-')}</td>
        <td><button class="btn btn-ghost btn-xs" onclick="JournalSetupPage.delLine('${l.id}')">삭제</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:14px">등록된 결재선이 없습니다. 미등록 시 모든 사용자가 결재할 수 있습니다.</td></tr>';

    const users = (() => { try { return Auth.listUsers ? Auth.listUsers() : []; } catch (_) { return []; } })();
    const userOpts = '<option value="">지정 안함</option>' + users.map(u => `<option value="${esc(u.id)}">${esc(u.name || u.id)}</option>`).join('');
    const tplOpts = '<option value="ALL">전체 일지 공통</option>' +
      JournalDB.getTemplates({ activeOnly: true }).map(t => `<option value="${t.id}">${esc(t.code)} ${esc(t.name)}</option>`).join('');

    return `
      <div class="fade-in">
        <div class="card alert-banner alert-warn">
          여기서 등록한 양식이 <b>전자 일지</b> 화면의 작성 목록에 그대로 나타납니다.
          새 일지가 필요하면 화면 개발 없이 양식만 추가하면 됩니다.
        </div>

        <div class="card mb-16">
          <div class="card-head">
            <div class="card-title">일지 양식 <span class="text-muted" style="font-weight:400">(${tpls.length}종)</span></div>
            <div style="display:flex;gap:8px;align-items:center">
              <label style="display:flex;align-items:center;gap:6px;font-size:12px">
                <input type="checkbox" ${showInactive ? 'checked' : ''} onchange="JournalSetupPage.setShowInactive(this.checked)"> 미사용 포함
              </label>
              <button class="btn btn-primary btn-sm" onclick="JournalSetupPage.edit('NEW')">＋ 양식 등록</button>
            </div>
          </div>
          <div class="factory-tabs mb-12">${catTabs}</div>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>코드</th><th>일지명</th><th>구분</th><th>주기</th><th style="text-align:center">대상</th><th style="text-align:center">항목</th><th>최근작성</th><th style="text-align:center">기한</th><th style="text-align:center">사용</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>

        <div class="card mb-24">
          <div class="card-head"><div class="card-title">결재선 설정</div>
            <span class="text-muted" style="font-size:12px">지정하면 상신 시 자동으로 검토자·승인자가 배정됩니다</span></div>
          <div class="form-grid form-grid-3">
            <div class="form-group"><label class="form-label">결재선 이름</label>
              <input class="form-input form-input-sm" id="jl-name" placeholder="예: 품질팀 기본"></div>
            <div class="form-group"><label class="form-label">적용 일지</label>
              <select class="form-input form-input-sm" id="jl-tpl">${tplOpts}</select></div>
            <div class="form-group"><label class="form-label">검토자</label>
              <select class="form-input form-input-sm" id="jl-rev">${userOpts}</select></div>
          </div>
          <div class="form-grid form-grid-3">
            <div class="form-group"><label class="form-label">승인자</label>
              <select class="form-input form-input-sm" id="jl-app">${userOpts}</select></div>
          </div>
          <div class="form-actions"><button class="btn btn-outline-primary btn-sm" onclick="JournalSetupPage.addLine()">결재선 추가</button></div>
          <div class="table-wrapper mt-12">
            <table>
              <thead><tr><th>결재선</th><th>적용 일지</th><th>검토자</th><th>승인자</th><th></th></tr></thead>
              <tbody>${lineRows}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  };

  // ============================================================
  // 양식 편집
  // ============================================================
  const edit = (id) => {
    if (id === 'NEW') {
      draft = {
        id: null, code: '', name: '', category: '선행요건', cycle: 'DAILY', factory: 'ALL',
        note: '', targetLabel: '점검대상', targets: [], rows: [],
        useReview: true, useApproval: true, active: true,
      };
    } else {
      const t = JournalDB.getTemplate(id); if (!t) return;
      draft = JSON.parse(JSON.stringify(t));
      if (!draft.targetLabel) draft.targetLabel = '점검대상';
    }
    editId = id; App.refreshPage();
  };
  const cancel = () => { editId = null; draft = null; App.refreshPage(); };

  const setD = (k, v) => { if (draft) draft[k] = v; };
  const setRow = (i, k, v) => {
    if (!draft || !draft.rows[i]) return;
    if (k === 'min' || k === 'max') { draft.rows[i][k] = (v === '' ? undefined : Number(v)); }
    else if (k === 'options' || k === 'ng') { draft.rows[i][k] = String(v).split(',').map(s => s.trim()).filter(Boolean); }
    else draft.rows[i][k] = v;
    if (k === 'type') App.refreshPage();
  };
  const addRow = () => {
    if (!draft) return;
    const prev = draft.rows[draft.rows.length - 1];
    draft.rows.push({ key: 'f' + (draft.rows.length + 1) + Math.random().toString(36).slice(2, 4), label: '', type: 'CHECK', group: (prev && prev.group) || '' });
    App.refreshPage();
  };
  const delRow = (i) => { if (draft) { draft.rows.splice(i, 1); App.refreshPage(); } };
  const moveRow = (i, dir) => {
    if (!draft) return;
    const j = i + dir; if (j < 0 || j >= draft.rows.length) return;
    const t = draft.rows[i]; draft.rows[i] = draft.rows[j]; draft.rows[j] = t;
    App.refreshPage();
  };
  const setTargets = (v) => { if (draft) draft.targets = String(v).split(',').map(s => s.trim()).filter(Boolean); };

  const editView = () => {
    const d = draft;
    const typeOpts = (cur) => Object.keys(JournalDB.FIELD_TYPES).map(k =>
      `<option value="${k}" ${cur === k ? 'selected' : ''}>${JournalDB.FIELD_TYPES[k].label}</option>`).join('');
    const catOpts = JournalDB.CATEGORIES.map(c => `<option ${d.category === c ? 'selected' : ''}>${c}</option>`).join('');
    const cycOpts = Object.keys(JournalDB.CYCLES).map(k =>
      `<option value="${k}" ${d.cycle === k ? 'selected' : ''}>${JournalDB.CYCLES[k].label}</option>`).join('');
    const facOpts = ['<option value="ALL">전 공장 공통</option>'].concat(
      (typeof DB !== 'undefined' ? DB.getFactories() : []).map(x => `<option value="${x.id}" ${d.factory === x.id ? 'selected' : ''}>${x.name}</option>`)).join('');

    const rowCards = d.rows.map((r, i) => {
      const isNum = r.type === 'NUM';
      const isSel = r.type === 'SELECT';
      return `<tr>
        <td style="text-align:center;white-space:nowrap">
          <button class="btn btn-ghost btn-xs" onclick="JournalSetupPage.moveRow(${i},-1)">▲</button>
          <button class="btn btn-ghost btn-xs" onclick="JournalSetupPage.moveRow(${i},1)">▼</button>
        </td>
        <td><input class="form-input form-input-sm" value="${esc(r.group || '')}" placeholder="구분(선택)"
          onchange="JournalSetupPage.setRow(${i},'group',this.value)"></td>
        <td><input class="form-input form-input-sm" value="${esc(r.label)}" placeholder="항목명"
          onchange="JournalSetupPage.setRow(${i},'label',this.value)"></td>
        <td><select class="form-input form-input-sm" onchange="JournalSetupPage.setRow(${i},'type',this.value)">${typeOpts(r.type)}</select></td>
        <td><input class="form-input form-input-sm" style="width:70px" value="${esc(r.unit || '')}" placeholder="단위"
          onchange="JournalSetupPage.setRow(${i},'unit',this.value)"></td>
        <td>${isNum ? `<div style="display:flex;gap:4px;align-items:center">
              <input type="number" step="any" class="form-input form-input-sm" style="width:80px" value="${r.min ?? ''}" placeholder="하한"
                onchange="JournalSetupPage.setRow(${i},'min',this.value)">
              <span class="text-muted">~</span>
              <input type="number" step="any" class="form-input form-input-sm" style="width:80px" value="${r.max ?? ''}" placeholder="상한"
                onchange="JournalSetupPage.setRow(${i},'max',this.value)"></div>`
          : isSel ? `<input class="form-input form-input-sm" value="${esc((r.options || []).join(', '))}" placeholder="선택지: 쉼표 구분"
                onchange="JournalSetupPage.setRow(${i},'options',this.value)">`
          : `<span class="text-muted text-xs">${esc(JournalDB.stdText(r) || '-')}</span>`}</td>
        <td>${isSel ? `<input class="form-input form-input-sm" value="${esc((r.ng || []).join(', '))}" placeholder="부적합 값"
                onchange="JournalSetupPage.setRow(${i},'ng',this.value)">`
          : `<span class="text-muted text-xs">${esc((JournalDB.ngValuesOf(r) || []).join(', ') || '-')}</span>`}</td>
        <td><button class="btn btn-ghost btn-xs" onclick="JournalSetupPage.delRow(${i})">삭제</button></td>
      </tr>`;
    }).join('');

    return `
      <div class="fade-in">
        <div class="flex items-center justify-between mb-16">
          <div><strong style="font-size:16px">${d.id ? '양식 편집' : '새 일지 양식 등록'}</strong>
            ${d.builtin ? ' <span class="badge badge-default">표준 양식</span>' : ''}</div>
          <button class="btn btn-ghost btn-sm" onclick="JournalSetupPage.cancel()">← 목록</button>
        </div>

        <div class="card mb-16">
          <div class="card-head"><div class="card-title">기본 정보</div></div>
          <div class="form-grid form-grid-3">
            <div class="form-group"><label class="form-label">일지 코드 <span class="req">*</span></label>
              <input class="form-input form-input-sm" id="jt-code" value="${esc(d.code)}" placeholder="예: PR-14"></div>
            <div class="form-group"><label class="form-label">일지명 <span class="req">*</span></label>
              <input class="form-input form-input-sm" id="jt-name" value="${esc(d.name)}" placeholder="예: 원료 하역장 점검일지"></div>
            <div class="form-group"><label class="form-label">구분</label>
              <select class="form-input form-input-sm" id="jt-cat">${catOpts}</select></div>
          </div>
          <div class="form-grid form-grid-3">
            <div class="form-group"><label class="form-label">작성 주기</label>
              <select class="form-input form-input-sm" id="jt-cycle">${cycOpts}</select>
              <div class="form-hint">주기가 지나면 작성기한 초과로 알립니다 (수시는 제외)</div></div>
            <div class="form-group"><label class="form-label">적용 공장</label>
              <select class="form-input form-input-sm" id="jt-fac">${facOpts}</select></div>
            <div class="form-group"><label class="form-label">결재 사용</label>
              <div style="display:flex;gap:14px;align-items:center;height:32px">
                <label style="display:flex;gap:5px;align-items:center;font-size:12px"><input type="checkbox" id="jt-rev" ${d.useReview !== false ? 'checked' : ''}> 검토자</label>
                <label style="display:flex;gap:5px;align-items:center;font-size:12px"><input type="checkbox" id="jt-app" ${d.useApproval !== false ? 'checked' : ''}> 승인자</label>
              </div></div>
          </div>
          <div class="form-group"><label class="form-label">작성 안내 문구</label>
            <textarea class="form-textarea" rows="2" id="jt-note" placeholder="현장에서 참고할 기준·주의사항">${esc(d.note || '')}</textarea></div>
        </div>

        <div class="card mb-16">
          <div class="card-head"><div class="card-title">점검 대상</div>
            <span class="text-muted" style="font-size:12px">비워두면 문항형(항목 나열), 입력하면 대상별 매트릭스형 일지가 됩니다</span></div>
          <div class="form-grid form-grid-2">
            <div class="form-group"><label class="form-label">대상 구분 이름</label>
              <input class="form-input form-input-sm" id="jt-tlabel" value="${esc(d.targetLabel || '점검대상')}" placeholder="예: 작업장 / 설비 / 구역"></div>
            <div class="form-group"><label class="form-label">대상 목록 (쉼표로 구분)</label>
              <input class="form-input form-input-sm" value="${esc((d.targets || []).join(', '))}" placeholder="예: 원료창고, 배합실, 포장실"
                onchange="JournalSetupPage.setTargets(this.value)"></div>
          </div>
        </div>

        <div class="card mb-16">
          <div class="card-head"><div class="card-title">점검 항목 <span class="text-muted" style="font-weight:400">(${d.rows.length}개)</span></div>
            <button class="btn btn-outline-primary btn-sm" onclick="JournalSetupPage.addRow()">＋ 항목 추가</button></div>
          <div class="text-muted text-xs mb-8">구분을 입력하면 일지 화면에서 원본 서식처럼 구분줄이 생깁니다(예: 개인위생 / 작업 전 위생상태).</div>
          <div class="table-wrapper">
            <table>
              <thead><tr><th style="width:80px">순서</th><th style="width:130px">구분</th><th style="min-width:180px">항목명</th><th style="width:140px">입력유형</th><th style="width:80px">단위</th><th style="min-width:180px">한계기준 / 선택지</th><th style="min-width:120px">부적합 값</th><th style="width:60px"></th></tr></thead>
              <tbody>${rowCards || '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:20px">항목 추가 버튼으로 점검 항목을 등록하세요</td></tr>'}</tbody>
            </table>
          </div>
        </div>

        <div class="flex gap-8 mb-24">
          <button class="btn btn-ghost" onclick="JournalSetupPage.cancel()">취소</button>
          <button class="btn btn-primary" onclick="JournalSetupPage.save()">양식 저장</button>
        </div>
      </div>`;
  };

  const save = () => {
    if (!draft) return;
    const code = val('jt-code'), name = val('jt-name');
    if (!code) { App.toast('일지 코드를 입력하세요', 'error'); return; }
    if (!name) { App.toast('일지명을 입력하세요', 'error'); return; }
    if (!draft.rows.length) { App.toast('점검 항목을 1개 이상 등록하세요', 'error'); return; }
    if (draft.rows.some(r => !String(r.label || '').trim())) { App.toast('항목명이 비어있는 항목이 있습니다', 'error'); return; }
    const dup = JournalDB.getTemplates().find(t => t.code === code && t.id !== draft.id);
    if (dup) { App.toast('이미 사용 중인 일지 코드입니다', 'error'); return; }

    JournalDB.saveTemplate({
      id: draft.id || undefined,
      code, name, category: val('jt-cat'), cycle: val('jt-cycle'),
      factory: val('jt-fac'), note: val('jt-note'),
      targetLabel: val('jt-tlabel'), targets: draft.targets,
      rows: draft.rows,
      useReview: document.getElementById('jt-rev').checked,
      useApproval: document.getElementById('jt-app').checked,
    });
    App.toast('양식이 저장되었습니다', 'success');
    editId = null; draft = null; App.refreshPage();
  };

  const copy = (id) => {
    const t = JournalDB.getTemplate(id); if (!t) return;
    const c = JSON.parse(JSON.stringify(t));
    delete c.id; c.builtin = false;
    c.code = t.code + '-C'; c.name = t.name + ' (복사본)';
    JournalDB.saveTemplate(c);
    App.toast('양식이 복제되었습니다', 'success'); App.refreshPage();
  };
  const toggle = (id) => { JournalDB.toggleTemplate(id); App.refreshPage(); };
  const del = (id) => {
    if (!confirm('이 양식을 삭제할까요? 작성된 일지가 있으면 삭제 대신 미사용 처리됩니다.')) return;
    const r = JournalDB.deleteTemplate(id);
    App.toast(r === 'DEACTIVATED' ? '작성 이력이 있어 미사용 처리했습니다' : '삭제되었습니다', 'success');
    App.refreshPage();
  };

  // ── 결재선 ──
  const addLine = () => {
    const name = val('jl-name');
    if (!name) { App.toast('결재선 이름을 입력하세요', 'error'); return; }
    const users = (() => { try { return Auth.listUsers ? Auth.listUsers() : []; } catch (_) { return []; } })();
    const find = (email) => users.find(u => u.id === email);
    const rv = find(val('jl-rev')), ap = find(val('jl-app'));
    JournalDB.saveLine({
      name, tplId: val('jl-tpl'),
      reviewer: rv ? { name: rv.name || rv.id, email: rv.id } : null,
      approver: ap ? { name: ap.name || ap.id, email: ap.id } : null,
    });
    App.toast('결재선이 추가되었습니다', 'success'); App.refreshPage();
  };
  const delLine = (id) => { if (confirm('삭제할까요?')) { JournalDB.deleteLine(id); App.refreshPage(); } };

  const setCat = (c) => { fCat = c; App.refreshPage(); };
  const setShowInactive = (b) => { showInactive = b; App.refreshPage(); };

  const render = () => (editId && draft) ? editView() : listView();

  return {
    render, edit, cancel, save, copy, toggle, del,
    setD, setRow, addRow, delRow, moveRow, setTargets,
    addLine, delLine, setCat, setShowInactive,
  };
})();
