// ============================================================
// haccp.js — 사료HACCP 디지털화
//   HaccpDocsPage(기준서/문서) · HaccpHAPage(위해요소분석)
//   HaccpLogsPage(일지) · NewMatPage(신원료 위해평가)
// ============================================================

// ── 공통 ──
const HAZARD_TYPE = { B: { label: '생물학적', cls: 'high' }, C: { label: '화학적', cls: 'low' }, P: { label: '물리적', cls: 'na' } };
const riskCls = (r) => r >= 6 ? 'high' : r >= 3 ? 'low' : 'ok';

// ============================================================
// 1) 기준서 / 문서 관리
// ============================================================
const HaccpDocsPage = (() => {
  let openId = null;

  const listView = () => {
    const docs = LabDB.getHaccpDocs();
    const rows = docs.length ? docs.map(d => `
      <tr onclick="HaccpDocsPage.open('${d.id}')" style="cursor:pointer">
        <td class="mono">${esc(d.docNo)}</td>
        <td><b>${esc(d.title)}</b></td>
        <td><span class="tag tag-gray">${esc(d.category)}</span></td>
        <td class="mono">${esc(d.version)}</td>
        <td>${esc(d.effDate)}</td>
        <td>${d.status === '유효' ? '<span class="verdict verdict-ok">유효</span>' : d.status === '개정중' ? '<span class="verdict verdict-low">개정중</span>' : '<span class="verdict verdict-na">폐기</span>'}</td>
      </tr>`).join('') : `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:20px">문서가 없습니다</td></tr>`;
    return `
    <div class="card">
      <div class="card-head">
        <div class="card-title">HACCP 기준서 · 문서 <span class="text-muted" style="font-weight:400">(${docs.length}건)</span></div>
        <button class="btn btn-primary btn-sm" onclick="HaccpDocsPage.open('NEW')">＋ 문서 추가</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>문서번호</th><th>제목</th><th>분류</th><th>버전</th><th>시행일</th><th>상태</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="text-muted" style="font-size:12px;margin-top:10px">사료HACCP 7원칙 12절차 기준. 선행요건관리기준서·HACCP관리기준서·제품설명서·공정흐름도·CCP관리계획을 문서로 관리합니다.</div>
    </div>`;
  };

  const detailView = (id) => {
    const isNew = id === 'NEW';
    const d = isNew ? { docNo: '', title: '', category: LabDB.DOC_CATEGORIES[0], version: '1.0', effDate: new Date().toISOString().slice(0, 10), revDate: '', author: '', reviewer: '', approver: '', status: '유효', body: '' } : LabDB.getHaccpDoc(id);
    if (!d) return listView();
    const catOpts = LabDB.DOC_CATEGORIES.map(c => `<option ${c === d.category ? 'selected' : ''}>${c}</option>`).join('');
    const stOpts = ['유효', '개정중', '폐기'].map(s => `<option ${s === d.status ? 'selected' : ''}>${s}</option>`).join('');
    return `
    <div class="detail-head">
      <button class="btn btn-ghost btn-sm" onclick="HaccpDocsPage.back()">← 목록</button>
      <div><div class="detail-title">${isNew ? '문서 추가' : esc(d.title)}</div><div class="detail-sub">${isNew ? '새 HACCP 문서' : esc(d.docNo) + ' · ' + esc(d.category)}</div></div>
    </div>
    <div class="card">
      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label">문서번호</label><input class="form-input form-input-sm" id="d-docNo" value="${esc(d.docNo)}" placeholder="WS-DOC-08"></div>
        <div class="form-group"><label class="form-label">분류</label><select class="form-input form-input-sm" id="d-cat">${catOpts}</select></div>
        <div class="form-group"><label class="form-label">버전</label><input class="form-input form-input-sm" id="d-ver" value="${esc(d.version)}"></div>
        <div class="form-group"><label class="form-label">상태</label><select class="form-input form-input-sm" id="d-status">${stOpts}</select></div>
      </div>
      <div class="form-group"><label class="form-label">제목 <span class="req">*</span></label><input class="form-input" id="d-title" value="${esc(d.title)}"></div>
      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label">시행일</label><input type="date" class="form-input form-input-sm" id="d-eff" value="${esc(d.effDate)}"></div>
        <div class="form-group"><label class="form-label">작성</label><input class="form-input form-input-sm" id="d-author" value="${esc(d.author)}"></div>
        <div class="form-group"><label class="form-label">검토</label><input class="form-input form-input-sm" id="d-reviewer" value="${esc(d.reviewer)}"></div>
        <div class="form-group"><label class="form-label">승인</label><input class="form-input form-input-sm" id="d-approver" value="${esc(d.approver)}"></div>
      </div>
      <div class="form-group"><label class="form-label">본문 / 주요내용</label><textarea class="form-input" id="d-body" rows="8" style="font-family:inherit;line-height:1.6">${esc(d.body)}</textarea></div>
      <div class="form-actions">
        ${isNew ? '' : `<button class="btn btn-danger btn-sm" onclick="HaccpDocsPage.del('${d.id}')">삭제</button>`}
        <button class="btn btn-primary" onclick="HaccpDocsPage.save('${isNew ? 'NEW' : d.id}')">저장</button>
      </div>
    </div>
    ${isNew ? `<div class="card"><div class="text-muted" style="font-size:13px">문서를 먼저 저장하면 실제 파일(PDF·docx·xlsx 등)을 첨부할 수 있습니다.</div></div>` : attachmentCard(d) + historyCard(d)}`;
  };

  // ── 첨부파일 섹션 ──
  const fmtSize = (n) => {
    if (n == null) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  };
  const attachmentCard = (d) => {
    const atts = d.attachments || [];
    const rows = atts.length ? atts.map(a => `
      <tr>
        <td>${esc(a.name)}</td>
        <td class="mono text-muted">${fmtSize(a.size)}</td>
        <td class="text-muted">${a.uploadedAt ? fmtDate(a.uploadedAt) : '-'}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-xs" onclick="HaccpDocsPage.download('${a.id}','${esc(a.name)}')">다운로드</button>
          <button class="btn btn-ghost btn-xs" onclick="HaccpDocsPage.removeAtt('${d.id}','${a.id}')" title="삭제">✕</button>
        </td>
      </tr>`).join('') : `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:16px">첨부된 파일이 없습니다. 아래에서 파일을 업로드하세요.</td></tr>`;
    return `
    <div class="card" style="margin-top:14px">
      <div class="card-head">
        <div class="card-title">첨부 파일 <span class="text-muted" style="font-weight:400">(${atts.length})</span></div>
        <label class="btn btn-primary btn-sm" style="cursor:pointer;margin:0">
          ＋ 파일 업로드
          <input type="file" style="display:none" id="d-file" onchange="HaccpDocsPage.upload('${d.id}', this)">
        </label>
      </div>
      <div class="table-wrap">
        <table class="data-table compact">
          <thead><tr><th>파일명</th><th>크기</th><th>업로드일</th><th>처리</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div id="d-file-status" class="text-muted" style="font-size:12px;margin-top:6px">PDF·워드·엑셀·이미지 등 문서 원본을 이 기기에 저장합니다. (다른 기기에서는 목록만 보이며 그 기기에 업로드된 파일만 다운로드됩니다)</div>
    </div>`;
  };

  // ── 변경 이력 섹션 ──
  const ACTION_CLS = { '생성': 'ok', '수정': 'low', '첨부': 'ok', '첨부삭제': 'high' };
  const historyCard = (d) => {
    const hist = (d.history || []).slice().sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    const rows = hist.length ? hist.map(h => `
      <tr>
        <td class="text-muted mono">${fmtDate(h.ts)}</td>
        <td><span class="verdict verdict-${ACTION_CLS[h.action] || 'na'}">${esc(h.action)}</span></td>
        <td>${esc(h.detail || '')}</td>
        <td class="text-muted">${esc(h.by || '-')}</td>
      </tr>`).join('') : `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:16px">이력이 없습니다</td></tr>`;
    return `
    <div class="card" style="margin-top:14px">
      <div class="card-title">변경 이력 <span class="text-muted" style="font-weight:400">(${hist.length})</span></div>
      <div class="table-wrap">
        <table class="data-table compact">
          <thead><tr><th style="width:150px">일시</th><th style="width:90px">작업</th><th>내용</th><th style="width:90px">담당</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  };

  const render = (id) => { if (id) openId = id === 'BACK' ? null : id; return openId ? detailView(openId) : listView(); };
  const open = (id) => { openId = id; App.refreshPage(); };
  const back = () => { openId = null; App.refreshPage(); };
  const collect = () => ({
    docNo: val('d-docNo'), category: val('d-cat'), version: val('d-ver'), status: val('d-status'),
    title: val('d-title'), effDate: val('d-eff'), author: val('d-author'), reviewer: val('d-reviewer'), approver: val('d-approver'), body: val('d-body'),
  });
  const save = (id) => {
    const data = collect();
    if (!data.title) { App.toast('제목을 입력하세요', 'error'); return; }
    if (id === 'NEW') { const r = LabDB.addHaccpDoc(data); openId = r.id; App.toast('문서가 추가되었습니다', 'success'); }
    else { LabDB.updateHaccpDoc(id, data); App.toast('저장되었습니다', 'success'); }
    App.refreshPage();
  };
  const del = (id) => { if (confirm('이 문서를 삭제할까요?')) { LabDB.deleteHaccpDoc(id); openId = null; App.refreshPage(); } };

  // ── 첨부파일 업로드/다운로드/삭제 ──
  const upload = async (docId, inputEl) => {
    const file = inputEl.files && inputEl.files[0];
    if (!file) return;
    const statusEl = document.getElementById('d-file-status');
    if (typeof FileStore === 'undefined' || !FileStore.available()) {
      App.toast('이 브라우저에서 파일 저장을 지원하지 않습니다', 'error'); return;
    }
    if (statusEl) statusEl.innerHTML = '<span class="text-muted">업로드 중…</span>';
    try {
      const attId = 'ATT-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      await FileStore.put(attId, file, { name: file.name, type: file.type });
      const by = document.getElementById('d-author')?.value || '-';
      LabDB.addDocAttachment(docId, {
        id: attId, name: file.name, size: file.size, type: file.type,
        uploadedAt: new Date().toISOString(), by,
      }, by);
      App.toast(`첨부되었습니다 · ${file.name}`, 'success');
      App.refreshPage();
    } catch (e) {
      console.error('[Haccp] upload failed', e);
      if (statusEl) statusEl.innerHTML = `<span class="text-danger">업로드 실패: ${esc(e.message || '오류')}</span>`;
      App.toast('파일 업로드에 실패했습니다', 'error');
    }
  };
  const download = async (attId, name) => {
    if (typeof FileStore === 'undefined') return;
    try {
      const rec = await FileStore.get(attId);
      if (!rec || !rec.blob) { App.toast('이 기기에 파일이 없습니다(다른 기기에서 업로드된 첨부입니다)', 'warning'); return; }
      const url = URL.createObjectURL(rec.blob);
      const a = document.createElement('a');
      a.href = url; a.download = name || 'download';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { console.error('[Haccp] download failed', e); App.toast('다운로드 실패', 'error'); }
  };
  const removeAtt = async (docId, attId) => {
    if (!confirm('첨부파일을 삭제할까요?')) return;
    try { if (typeof FileStore !== 'undefined') await FileStore.del(attId); } catch (_) {}
    const by = document.getElementById('d-author')?.value || '-';
    LabDB.removeDocAttachment(docId, attId, by);
    App.toast('첨부파일이 삭제되었습니다', 'info');
    App.refreshPage();
  };

  return { render, open, back, save, del, upload, download, removeAtt };
})();

// ============================================================
// 2) 위해요소분석 (HA)
// ============================================================
const HaccpHAPage = (() => {
  const render = () => {
    const rows = LabDB.getHA();
    const trs = rows.length ? rows.map(h => {
      const ht = HAZARD_TYPE[h.hazardType] || HAZARD_TYPE.B;
      return `<tr class="${h.isCCP ? 'row-active' : ''}">
        <td class="mono">${h.seq}</td>
        <td>${esc(h.step)}<br><span class="text-muted" style="font-size:10px">${esc(h.stepType)}</span></td>
        <td><span class="verdict verdict-${ht.cls}">${h.hazardType}</span> ${ht.label}</td>
        <td>${esc(h.hazard)}</td>
        <td class="text-muted">${esc(h.cause)}</td>
        <td class="mono" style="text-align:center">${h.severity}</td>
        <td class="mono" style="text-align:center">${h.likelihood}</td>
        <td style="text-align:center"><span class="verdict verdict-${riskCls(h.risk)}">${h.risk}</span></td>
        <td>${esc(h.control)}</td>
        <td style="text-align:center">${h.isCCP ? `<span class="tag tag-blue">${esc(h.ccpNo || 'CCP')}</span>` : '<span class="text-muted">-</span>'}</td>
        <td><button class="btn btn-ghost btn-xs" onclick="HaccpHAPage.del('${h.id}')">삭제</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="11" class="text-muted" style="text-align:center;padding:20px">항목이 없습니다</td></tr>`;

    const sev = [1, 2, 3].map(n => `<option value="${n}">${n}</option>`).join('');
    return `
    <div class="card">
      <div class="card-head"><div class="card-title">위해요소 추가</div></div>
      <div class="form-grid form-grid-5">
        <div class="form-group"><label class="form-label">공정/원료명 <span class="req">*</span></label><input class="form-input form-input-sm" id="h-step" placeholder="예: 열처리"></div>
        <div class="form-group"><label class="form-label">구분</label><select class="form-input form-input-sm" id="h-stepType"><option>공정</option><option>원료</option></select></div>
        <div class="form-group"><label class="form-label">위해유형</label><select class="form-input form-input-sm" id="h-type"><option value="B">B 생물학적</option><option value="C">C 화학적</option><option value="P">P 물리적</option></select></div>
        <div class="form-group"><label class="form-label">위해요소</label><input class="form-input form-input-sm" id="h-hazard" placeholder="예: 병원성미생물"></div>
        <div class="form-group"><label class="form-label">발생원인</label><input class="form-input form-input-sm" id="h-cause"></div>
      </div>
      <div class="form-grid form-grid-5">
        <div class="form-group"><label class="form-label">심각도(1-3)</label><select class="form-input form-input-sm" id="h-sev">${sev}</select></div>
        <div class="form-group"><label class="form-label">발생가능성(1-3)</label><select class="form-input form-input-sm" id="h-like">${sev}</select></div>
        <div class="form-group" style="grid-column:span 2"><label class="form-label">예방조치</label><input class="form-input form-input-sm" id="h-control"></div>
        <div class="form-group"><label class="form-label">CCP 지정</label>
          <div style="display:flex;gap:6px;align-items:center">
            <input type="checkbox" id="h-ccp" onchange="document.getElementById('h-ccpno').disabled=!this.checked">
            <input class="form-input form-input-sm" id="h-ccpno" placeholder="CCP-1B" disabled style="flex:1">
          </div>
        </div>
      </div>
      <div class="form-actions"><button class="btn btn-primary btn-sm" onclick="HaccpHAPage.add()">위해요소 추가</button></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">위해요소분석표 (HACCP Plan)</div>
        <span class="text-muted" style="font-size:12px">위해도 = 심각도 × 발생가능성 · <span class="v-high">6↑ 유의</span></span>
      </div>
      <div class="table-wrap">
        <table class="data-table compact">
          <thead><tr><th>순번</th><th>공정/원료</th><th>위해유형</th><th>위해요소</th><th>발생원인</th><th>심각</th><th>발생</th><th>위해도</th><th>예방조치</th><th>CCP</th><th></th></tr></thead>
          <tbody>${trs}</tbody>
        </table>
      </div>
    </div>`;
  };
  const add = () => {
    const step = val('h-step');
    if (!step) { App.toast('공정/원료명을 입력하세요', 'error'); return; }
    LabDB.addHA({
      step, stepType: val('h-stepType'), hazardType: val('h-type'), hazard: val('h-hazard'), cause: val('h-cause'),
      severity: val('h-sev'), likelihood: val('h-like'), control: val('h-control'),
      isCCP: document.getElementById('h-ccp').checked, ccpNo: val('h-ccpno'),
    });
    App.toast('추가되었습니다', 'success'); App.refreshPage();
  };
  const del = (id) => { if (confirm('삭제할까요?')) { LabDB.deleteHA(id); App.refreshPage(); } };
  return { render, add, del };
})();

// ============================================================
// 3) HACCP 일지
// ============================================================
const HaccpLogsPage = (() => {
  let filter = 'ALL';
  const render = () => {
    const logs = LabDB.getHaccpLogs(filter);
    const tabs = ['ALL', ...LabDB.LOG_TYPES].map(t =>
      `<button class="kind-btn ${filter === t ? 'active' : ''}" onclick="HaccpLogsPage.setFilter('${t}')">${t === 'ALL' ? '전체' : t}</button>`).join('');
    const rows = logs.length ? logs.map(l => `
      <tr>
        <td><span class="tag tag-gray">${esc(l.type)}</span></td>
        <td>${esc(l.date)}</td>
        <td>${esc(l.target)}</td>
        <td class="mono">${esc(l.value)}</td>
        <td>${l.judged === '적합' ? '<span class="verdict verdict-ok">적합</span>' : l.judged === '부적합' ? '<span class="verdict verdict-high">부적합</span>' : '<span class="text-muted">-</span>'}</td>
        <td class="text-muted ellipsis" style="max-width:160px">${esc(l.memo)}${l.action ? ' · 조치:' + esc(l.action) : ''}</td>
        <td>${esc(l.by)}</td>
        <td><button class="btn btn-ghost btn-xs" onclick="HaccpLogsPage.del('${l.id}')">삭제</button></td>
      </tr>`).join('') : `<tr><td colspan="8" class="text-muted" style="text-align:center;padding:20px">일지가 없습니다</td></tr>`;
    const typeOpts = LabDB.LOG_TYPES.map(t => `<option>${t}</option>`).join('');
    return `
    <div class="card">
      <div class="card-head"><div class="card-title">일지 작성</div></div>
      <div class="form-grid form-grid-5">
        <div class="form-group"><label class="form-label">유형</label><select class="form-input form-input-sm" id="l-type">${typeOpts}</select></div>
        <div class="form-group"><label class="form-label">일자</label><input type="date" class="form-input form-input-sm" id="l-date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="form-group"><label class="form-label">대상/항목</label><input class="form-input form-input-sm" id="l-target" placeholder="CCP-1B 열처리 · 작업장 등"></div>
        <div class="form-group"><label class="form-label">측정값/결과</label><input class="form-input form-input-sm" id="l-value" placeholder="82℃ · 미검출 · 양호"></div>
        <div class="form-group"><label class="form-label">판정</label><select class="form-input form-input-sm" id="l-judged"><option>적합</option><option>부적합</option><option>-</option></select></div>
      </div>
      <div class="form-grid form-grid-2">
        <div class="form-group"><label class="form-label">특이사항</label><input class="form-input form-input-sm" id="l-memo"></div>
        <div class="form-group"><label class="form-label">개선조치(부적합 시)</label><input class="form-input form-input-sm" id="l-action"></div>
      </div>
      <div class="form-group" style="max-width:200px"><label class="form-label">작성자</label><input class="form-input form-input-sm" id="l-by"></div>
      <div class="form-actions"><button class="btn btn-primary btn-sm" onclick="HaccpLogsPage.add()">일지 저장</button></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">HACCP 일지 <span class="text-muted" style="font-weight:400">(${logs.length}건)</span></div>
        <div class="kind-toggle">${tabs}</div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>유형</th><th>일자</th><th>대상/항목</th><th>측정값</th><th>판정</th><th>특이사항·조치</th><th>작성자</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  };
  const setFilter = (t) => { filter = t; App.refreshPage(); };
  const add = () => {
    LabDB.addHaccpLog({
      type: val('l-type'), date: val('l-date'), target: val('l-target'), value: val('l-value'),
      judged: val('l-judged'), memo: val('l-memo'), action: val('l-action'), by: val('l-by'),
    });
    App.toast('일지가 저장되었습니다', 'success'); App.refreshPage();
  };
  const del = (id) => { if (confirm('삭제할까요?')) { LabDB.deleteHaccpLog(id); App.refreshPage(); } };
  return { render, setFilter, add, del };
})();

// ============================================================
// 4) 신원료 위해평가
// ============================================================
const NewMatPage = (() => {
  let openId = null;

  const verdictTag = (v) => v === '승인' ? '<span class="verdict verdict-ok">승인</span>'
    : v === '조건부승인' ? '<span class="verdict verdict-low">조건부승인</span>'
    : v === '반려' ? '<span class="verdict verdict-high">반려</span>' : '<span class="verdict verdict-na">검토중</span>';

  const listView = () => {
    const list = LabDB.getNewMats();
    const rows = list.length ? list.map(m => `
      <tr onclick="NewMatPage.open('${m.id}')" style="cursor:pointer">
        <td class="mono">${esc(m.code || '-')}</td>
        <td><b>${esc(m.name)}</b></td>
        <td>${esc(m.supplier)}</td>
        <td>${esc(m.origin)}</td>
        <td>${(m.docsNeeded || []).length ? (m.docsNeeded || []).map(d => `<span class="chip">${esc(d)}</span>`).join(' ') : '<span class="text-muted">-</span>'}</td>
        <td>${verdictTag(m.verdict)}</td>
        <td class="text-muted">${esc(m.date)}</td>
      </tr>`).join('') : `<tr><td colspan="7" class="text-muted" style="text-align:center;padding:20px">평가 건이 없습니다</td></tr>`;
    return `
    <div class="card">
      <div class="card-head">
        <div class="card-title">신원료 위해평가 <span class="text-muted" style="font-weight:400">(${list.length}건)</span></div>
        <button class="btn btn-primary btn-sm" onclick="NewMatPage.open('NEW')">＋ 신원료 평가</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>원료코드</th><th>원료명</th><th>공급처</th><th>원산지</th><th>필요 성적서</th><th>종합판정</th><th>평가일</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="text-muted" style="font-size:12px;margin-top:10px">신규 원료 도입 시 생물학적(B)·화학적(C)·물리적(P) 위해요소를 평가하고, 필요 시험성적서 확인 후 승인 여부를 결정합니다.</div>
    </div>`;
  };

  const hzBlock = (key, label, o) => `
    <div class="input-group-block">
      <div class="group-title">${label}</div>
      <div class="form-grid form-grid-3">
        <div class="form-group"><label class="form-label">위해요소</label><input class="form-input form-input-sm" id="nm-${key}-hazard" value="${esc(o.hazard || '')}"></div>
        <div class="form-group"><label class="form-label">평가</label><input class="form-input form-input-sm" id="nm-${key}-assess" value="${esc(o.assess || '')}" placeholder="저·중·고"></div>
        <div class="form-group"><label class="form-label">관리방안</label><input class="form-input form-input-sm" id="nm-${key}-control" value="${esc(o.control || '')}"></div>
      </div>
    </div>`;

  const detailView = (id) => {
    const isNew = id === 'NEW';
    const m = isNew ? { code: '', name: '', supplier: '', origin: '', use: '', bio: {}, chem: {}, phys: {}, docsNeeded: [], verdict: '검토중', assessor: '', approver: '', date: new Date().toISOString().slice(0, 10), note: '' } : LabDB.getNewMat(id);
    if (!m) return listView();
    const docChecks = LabDB.HAZARD_DOCS.map(d => `
      <label class="check-chip"><input type="checkbox" class="nm-doc" value="${esc(d)}" ${(m.docsNeeded || []).includes(d) ? 'checked' : ''}> ${esc(d)}</label>`).join('');
    const vOpts = ['검토중', '승인', '조건부승인', '반려'].map(v => `<option ${v === m.verdict ? 'selected' : ''}>${v}</option>`).join('');
    return `
    <div class="detail-head">
      <button class="btn btn-ghost btn-sm" onclick="NewMatPage.back()">← 목록</button>
      <div><div class="detail-title">${isNew ? '신원료 위해평가' : esc(m.name)}</div><div class="detail-sub">${isNew ? '신규 원료 도입 평가' : '위해요소 평가 · ' + verdictText(m.verdict)}</div></div>
    </div>
    <div class="card">
      <div class="form-grid form-grid-4">
        <div class="form-group" style="position:relative"><label class="form-label">원료코드</label>
          <input class="form-input form-input-sm" id="nm-code" value="${esc(m.code)}" placeholder="기존코드(선택)" oninput="NewMatPage.suggest()" autocomplete="off">
          <div class="suggest-box" id="nm-suggest"></div>
        </div>
        <div class="form-group"><label class="form-label">원료명 <span class="req">*</span></label><input class="form-input form-input-sm" id="nm-name" value="${esc(m.name)}"></div>
        <div class="form-group"><label class="form-label">공급처</label><input class="form-input form-input-sm" id="nm-supplier" value="${esc(m.supplier)}"></div>
        <div class="form-group"><label class="form-label">원산지</label><input class="form-input form-input-sm" id="nm-origin" value="${esc(m.origin)}"></div>
      </div>
      <div class="form-group"><label class="form-label">용도</label><input class="form-input form-input-sm" id="nm-use" value="${esc(m.use)}" placeholder="단백질원 등"></div>

      <hr class="divider">
      <div class="section-label">위해요소 평가</div>
      ${hzBlock('bio', '생물학적(B)', m.bio || {})}
      ${hzBlock('chem', '화학적(C)', m.chem || {})}
      ${hzBlock('phys', '물리적(P)', m.phys || {})}

      <hr class="divider">
      <div class="section-label">필요 시험성적서</div>
      <div class="check-chips">${docChecks}</div>

      <hr class="divider">
      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label">종합판정</label><select class="form-input form-input-sm" id="nm-verdict">${vOpts}</select></div>
        <div class="form-group"><label class="form-label">평가자</label><input class="form-input form-input-sm" id="nm-assessor" value="${esc(m.assessor)}"></div>
        <div class="form-group"><label class="form-label">승인자</label><input class="form-input form-input-sm" id="nm-approver" value="${esc(m.approver)}"></div>
        <div class="form-group"><label class="form-label">평가일</label><input type="date" class="form-input form-input-sm" id="nm-date" value="${esc(m.date)}"></div>
      </div>
      <div class="form-group"><label class="form-label">비고 / 조건</label><input class="form-input" id="nm-note" value="${esc(m.note)}"></div>
      <div class="form-actions">
        ${isNew ? '' : `<button class="btn btn-danger btn-sm" onclick="NewMatPage.del('${m.id}')">삭제</button>`}
        <button class="btn btn-primary" onclick="NewMatPage.save('${isNew ? 'NEW' : m.id}')">저장</button>
      </div>
    </div>`;
  };

  const verdictText = (v) => v || '검토중';

  const render = (id) => { if (id) openId = id; return openId ? detailView(openId) : listView(); };
  const open = (id) => { openId = id; App.refreshPage(); };
  const back = () => { openId = null; App.refreshPage(); };

  const suggest = () => {
    const q = val('nm-code');
    const box = document.getElementById('nm-suggest');
    const list = LabDB.searchMaster('raw', q, 12);
    if (!q || !list.length) { box.classList.remove('open'); return; }
    box.innerHTML = list.map(mm => `<div class="suggest-item" onclick="NewMatPage.pick('${esc(mm.code)}','${esc(mm.name)}')"><span class="mono">${esc(mm.code)}</span><span class="ellipsis">${esc(mm.name)}</span><span></span></div>`).join('');
    box.classList.add('open');
  };
  const pick = (code, name) => { document.getElementById('nm-code').value = code; const n = document.getElementById('nm-name'); if (!n.value) n.value = name; document.getElementById('nm-suggest').classList.remove('open'); };

  const collect = () => {
    const docs = [...document.querySelectorAll('.nm-doc:checked')].map(c => c.value);
    const hz = (k) => ({ hazard: val(`nm-${k}-hazard`), assess: val(`nm-${k}-assess`), control: val(`nm-${k}-control`) });
    return {
      code: val('nm-code'), name: val('nm-name'), supplier: val('nm-supplier'), origin: val('nm-origin'), use: val('nm-use'),
      bio: hz('bio'), chem: hz('chem'), phys: hz('phys'), docsNeeded: docs,
      verdict: val('nm-verdict'), assessor: val('nm-assessor'), approver: val('nm-approver'), date: val('nm-date'), note: val('nm-note'),
    };
  };
  const save = (id) => {
    const data = collect();
    if (!data.name) { App.toast('원료명을 입력하세요', 'error'); return; }
    if (id === 'NEW') { const r = LabDB.addNewMat(data); openId = r.id; App.toast('평가가 저장되었습니다', 'success'); }
    else { LabDB.updateNewMat(id, data); App.toast('저장되었습니다', 'success'); }
    App.refreshPage();
  };
  const del = (id) => { if (confirm('이 평가를 삭제할까요?')) { LabDB.deleteNewMat(id); openId = null; App.refreshPage(); } };

  return { render, open, back, suggest, pick, save, del };
})();

// 공통 헬퍼
function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
