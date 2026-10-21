// ============================================================
// lab_validation.js — 유효성 평가(Validation) 관리
//   HACCP 선행요건·CCP 실행성 검증 등 유효성평가 항목을 목록·상세로 관리
//   실제 우성사료 논산공장 유효성평가 폴더(모의회수·소독제·마그네트·X-Ray 등) 기준
// ============================================================

const ValidationPage = (() => {
  let openId = null;

  const RESULT_META = {
    '적합':  { cls: 'ok' },
    '부적합': { cls: 'high' },
    '진행중': { cls: 'low' },
  };
  const resultBadge = (r) => { const m = RESULT_META[r] || { cls: 'na' }; return `<span class="verdict verdict-${m.cls}">${esc(r || '-')}</span>`; };

  // ── 관련 서류(성적서·보고서) ──
  //   원본은 PhotoStore 가 서버(data/files) 또는 IndexedDB 에 두고 레코드엔 메타만 남긴다.
  //   기존 항목은 첨부·삭제 즉시 저장한다 — "저장"을 안 누르고 나가서 성적서가
  //   사라지는 일이 없도록. 신규 항목만 저장 시점까지 pending 에 들고 있는다.
  const MAX_FILES = 10;
  const ACCEPT = '.pdf,.xlsx,.xls,.docx,.doc,.pptx,.hwp,.hwpx,.csv,.txt,.zip,image/*';
  const pending = [];                       // 신규 항목 전용(재대입 금지)
  let uploading = 0;
  const actorName = () => { try { return (typeof Auth !== 'undefined' && Auth.currentName) ? (Auth.currentName() || '') : ''; } catch (_) { return ''; } };

  const filesOf = (v) => (v && Array.isArray(v.files)) ? v.files : [];
  const curFiles = () => openId === 'NEW' ? pending : filesOf(LabDB.getValidation(openId));
  const setFiles = (list) => {
    if (openId === 'NEW') { pending.length = 0; list.forEach(f => pending.push(f)); }
    else LabDB.updateValidation(openId, { files: list });
  };

  const setBusy = (on) => {
    uploading += on ? 1 : -1;
    if (uploading < 0) uploading = 0;
    document.querySelectorAll('[data-upload-lock]').forEach(el => { el.disabled = uploading > 0; });
  };

  const onPick = async (input) => {
    const picked = [...(input.files || [])];
    input.value = '';
    if (!picked.length) return;
    setBusy(true);
    App.toast(`서류 ${picked.length}건을 저장하는 중입니다`, 'info');
    try {
      for (const f of picked) {
        // 매 건마다 현재 저장본을 다시 읽는다 — 업로드 대기중 다른 곳에서 바뀌었을 수 있다
        const list = curFiles().slice();
        if (list.length >= MAX_FILES) { App.toast(`서류는 최대 ${MAX_FILES}건까지 첨부할 수 있습니다`, 'warning'); break; }
        try {
          const meta = await PhotoStore.save(f, { kind: 'DOC', by: actorName() });
          if (meta) { list.push(meta); setFiles(list); }
        } catch (e) { App.toast(e.message || '서류 저장에 실패했습니다', 'error'); }
        renderFiles();
      }
    } finally { setBusy(false); }
  };

  const removeFile = async (i) => {
    const list = curFiles().slice();
    const f = list[i];
    if (!f) return;
    if (!confirm(`"${f.name}" 첨부를 삭제할까요?`)) return;
    list.splice(i, 1);
    setFiles(list);
    renderFiles();
    await PhotoStore.remove(f);
  };
  const viewFile = (i) => { const f = curFiles()[i]; if (f) PhotoStore.openViewer([f], 0); };
  const downloadFile = (i) => { const f = curFiles()[i]; if (f) PhotoStore.download(f); };

  const renderFiles = () => {
    const el = document.getElementById('val-files');
    if (!el) return;
    const list = curFiles();
    el.innerHTML = list.length ? list.map((f, i) => `
      <div class="val-file">
        <span class="val-file-ext">${esc(PhotoStore.typeLabel(f))}</span>
        <span class="val-file-name" title="${esc(f.name || '')}">${esc(f.name || '첨부')}</span>
        <span class="val-file-meta">${esc(PhotoStore.sizeText(f.bytes))}${f.by ? ' · ' + esc(f.by) : ''}${f.at ? ' · ' + String(f.at).slice(0, 10) : ''}</span>
        <button type="button" class="btn btn-ghost btn-xs" onclick="ValidationPage.viewFile(${i})">보기</button>
        <button type="button" class="btn btn-ghost btn-xs" onclick="ValidationPage.downloadFile(${i})">다운로드</button>
        <button type="button" class="val-file-x" onclick="ValidationPage.removeFile(${i})" title="삭제">✕</button>
      </div>`).join('')
      : '<div class="text-muted" style="font-size:12px;padding:6px 2px">첨부된 서류가 없습니다</div>';
  };

  const listView = () => {
    const list = LabDB.getValidations();
    const s = LabDB.validationSummary();
    const rows = list.length ? list.map(v => `
      <tr onclick="ValidationPage.open('${v.id}')" style="cursor:pointer">
        <td class="mono">${v.no}</td>
        <td><b>${esc(v.name)}</b></td>
        <td><span class="tag tag-gray">${esc(v.category)}</span></td>
        <td>${esc(v.cycle)}</td>
        <td class="text-muted">${esc(v.lastDate || '-')}</td>
        <td>${resultBadge(v.result)}</td>
        <td class="ellipsis" style="max-width:220px">${esc(v.evidence || '')}</td>
        <td>${filesOf(v).length ? `<span class="tag tag-blue">서류 ${filesOf(v).length}</span>` : '<span class="text-muted">-</span>'}</td>
      </tr>`).join('') : `<tr><td colspan="8" class="text-muted" style="text-align:center;padding:20px">등록된 유효성평가 항목이 없습니다</td></tr>`;

    return `
    <div class="stat-grid" style="margin-bottom:14px">
      <div class="stat-card"><div class="stat-label">유효성평가 항목</div><div class="stat-value">${fmtNum(s.total, 0)}</div><div class="stat-sub">전체 검증 대상</div></div>
      <div class="stat-card ok"><div class="stat-label">적합</div><div class="stat-value">${fmtNum(s.pass, 0)}</div><div class="stat-sub">유효성 확인 완료</div></div>
      <div class="stat-card ${s.fail > 0 ? 'danger' : ''}"><div class="stat-label">부적합</div><div class="stat-value">${fmtNum(s.fail, 0)}</div><div class="stat-sub">재검증 필요</div></div>
      <div class="stat-card ${s.ongoing > 0 ? 'danger' : 'ok'}"><div class="stat-label">진행중/미실시</div><div class="stat-value">${fmtNum(s.ongoing, 0)}</div><div class="stat-sub">검증 예정</div></div>
    </div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">유효성 평가 <span class="text-muted" style="font-weight:400">(${list.length}건)</span></div>
        <button class="btn btn-primary btn-sm" onclick="ValidationPage.open('NEW')">＋ 항목 추가</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>No</th><th>검증 항목</th><th>분류</th><th>주기</th><th>최근 수행</th><th>결과</th><th>근거자료</th><th>첨부</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="text-muted" style="font-size:12px;margin-top:10px">CCP 실행성 검증(X-Ray·금속검출기·건조기), 선행요건 유효성(소독제·자외선·오존·마그네트·철물·플러싱), 모의회수·외부심사·용기포장 시험성적서를 관리합니다.</div>
    </div>`;
  };

  const detailView = (id) => {
    const isNew = id === 'NEW';
    const v = isNew
      ? { no: LabDB.getValidations().length + 1, name: '', category: LabDB.VALIDATION_CATEGORIES[0], cycle: '연1회', lastDate: '', nextDate: '', result: '진행중', evidence: '', note: '' }
      : LabDB.getValidation(id);
    if (!v) return listView();
    const catOpts = LabDB.VALIDATION_CATEGORIES.map(c => `<option ${c === v.category ? 'selected' : ''}>${c}</option>`).join('');
    const resOpts = ['적합', '부적합', '진행중'].map(r => `<option ${r === v.result ? 'selected' : ''}>${r}</option>`).join('');
    return `
    <div class="card">
      <div class="card-head">
        <button class="btn btn-ghost btn-sm" onclick="ValidationPage.back()">← 목록</button>
        <div class="card-title" style="margin:0">${isNew ? '＋ 유효성평가 항목 추가' : '' + esc(v.name)}</div>
        ${isNew ? '' : `<button class="btn btn-ghost btn-sm" onclick="ValidationPage.toAgenda('${v.id}')">회의 안건</button>
        <button class="btn btn-ghost btn-sm" onclick="ValidationPage.remove('${v.id}')" title="삭제">삭제</button>`}
      </div>
      <div class="form-grid form-grid-2">
        <div class="form-group"><label class="form-label">검증 항목명 <span class="req">*</span></label><input type="text" class="form-input" id="val-name" value="${esc(v.name)}" placeholder="예: 반려동물 소포장 X-Ray 검출기 검증"></div>
        <div class="form-group"><label class="form-label">분류</label><select class="form-input" id="val-cat">${catOpts}</select></div>
      </div>
      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label">검증 주기</label><input type="text" class="form-input" id="val-cycle" value="${esc(v.cycle)}" placeholder="연1회 / 반기1회"></div>
        <div class="form-group"><label class="form-label">최근 수행일</label><input type="date" class="form-input" id="val-last" value="${esc(v.lastDate || '')}"></div>
        <div class="form-group"><label class="form-label">차기 예정일</label><input type="date" class="form-input" id="val-next" value="${esc(v.nextDate || '')}"></div>
        <div class="form-group"><label class="form-label">결과</label><select class="form-input" id="val-result">${resOpts}</select></div>
      </div>
      <div class="form-group"><label class="form-label">근거자료 / 성적서</label><input type="text" class="form-input" id="val-evidence" value="${esc(v.evidence || '')}" placeholder="예: 자외선 살균 유효성 테스트(2025.01.12), 자체 대장균군 분석성적서"></div>

      <div class="form-group">
        <label class="form-label">관련 서류
          <span class="text-muted" style="font-weight:400;font-size:12px">(성적서·시험결과·보고서 원본 · 최대 ${MAX_FILES}건)</span></label>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer;display:inline-block;margin:0">파일 선택
          <input type="file" accept="${ACCEPT}" multiple style="display:none" onchange="ValidationPage.onPick(this)"></label>
        <div id="val-files" class="val-file-list"></div>
        <div class="form-hint">PDF·엑셀·워드·한글·이미지 첨부 가능(1건 8MB). ${isNew
          ? '신규 항목은 저장할 때 함께 등록됩니다.'
          : '첨부·삭제는 즉시 반영됩니다.'} ${PhotoStore.serverOn()
          ? '원본은 서버에 보관되어 모든 단말에서 내려받을 수 있습니다.'
          : '서버 미연결 — 원본은 이 기기에만 저장됩니다.'}</div>
      </div>

      <div class="form-group"><label class="form-label">비고</label><textarea class="form-input" id="val-note" rows="3" placeholder="검증 방법·판정기준·특이사항">${esc(v.note || '')}</textarea></div>
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="ValidationPage.back()">취소</button>
        <button class="btn btn-primary" data-upload-lock onclick="ValidationPage.save('${isNew ? 'NEW' : v.id}')">저장</button>
      </div>
    </div>`;
  };

  // 품질회의 안건으로 올리기 — 부적합·미실시 항목을 회의에서 다루기 위해
  const toAgenda = (id) => {
    const v = LabDB.getValidation(id);
    if (!v || typeof MeetingPage === 'undefined') return;
    MeetingPage.quickAgenda({
      sourceType: 'VALIDATION',
      sourceId: v.id,
      sourceLabel: `${v.category} · ${v.cycle}`,
      title: `[유효성평가] ${v.name} — ${v.result}`,
      content: `분류 ${v.category} · 주기 ${v.cycle}\n최근 수행 ${v.lastDate || '미실시'}${v.nextDate ? ` · 차기 ${v.nextDate}` : ''}\n결과 ${v.result}${v.evidence ? `\n근거자료 ${v.evidence}` : ''}${v.note ? `\n비고 ${v.note}` : ''}`,
      category: 'HACCP·선행요건',
      factory: v.factory,
      priority: v.result === '부적합' ? '긴급' : v.result === '진행중' ? '높음' : '보통',
    });
  };

  const render = () => openId ? detailView(openId) : listView();
  const afterRender = () => { if (openId) renderFiles(); };

  const open = (id) => { openId = id; if (id === 'NEW') pending.length = 0; App.refreshPage(); };
  const back = () => { openId = null; pending.length = 0; App.refreshPage(); };
  const save = (id) => {
    if (uploading > 0) { App.toast('서류 저장이 끝난 뒤에 저장해 주세요', 'warning'); return; }
    const g = (i) => document.getElementById(i)?.value || '';
    const name = g('val-name').trim();
    if (!name) { App.toast('검증 항목명을 입력하세요', 'error'); return; }
    const data = {
      name, category: g('val-cat'), cycle: g('val-cycle'), lastDate: g('val-last'),
      nextDate: g('val-next'), result: g('val-result'), evidence: g('val-evidence'), note: g('val-note'),
    };
    // 기존 항목의 files 는 첨부 즉시 저장되므로 여기서 건드리지 않는다(덮어쓰기 방지)
    if (id === 'NEW') LabDB.addValidation({ ...data, files: pending.slice() });
    else LabDB.updateValidation(id, data);
    App.toast('유효성평가 항목이 저장되었습니다', 'success');
    pending.length = 0;
    openId = null;
    App.refreshPage();
  };
  const remove = (id) => {
    const v = LabDB.getValidation(id);
    if (!v) return;
    if (!confirm(`"${v.name}" 항목을 삭제할까요?`)) return;
    LabDB.deleteValidation(id);
    App.toast('삭제되었습니다', 'info');
    openId = null;
    App.refreshPage();
  };

  return { render, afterRender, open, back, save, remove, onPick, removeFile, viewFile, downloadFile, toAgenda };
})();
