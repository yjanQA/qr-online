// ============================================================
// rnd_research.js — 연구관리 > 연구관리 3개 화면
//
//   RndNotePage      연구기록관리 — 실험계획서 / 연구노트. 점검자 서명 시 잠금
//   RndKnowledgePage 지식자산관리 — 연구데이터·노하우 축적 + 전 도메인 통합 검색
//   RndCollabPage    협업관리     — 공동연구 상대·범위·공유수준·교류 이력
// ============================================================

// ============================================================
// 연구기록관리 (실험계획서 / 연구노트)
// ============================================================
const RndNotePage = (() => {
  const U = () => RndUI;
  let q = '', fType = '', fProject = '';
  let editId = null, openId = null;

  const list = () => {
    const u = U();
    return RndDB.getNotesBy(u.fac())
      .filter(n => !fType || n.type === fType)
      .filter(n => !fProject || n.projectId === fProject)
      .filter(n => u.matches(q, n.title, n.noteNo, n.objective, n.method, n.result, n.conclusion, n.author));
  };

  const card = (n) => {
    const u = U();
    const open = openId === n.id;
    return `
      <div class="card rnd-card ${n.locked ? 'locked' : ''}">
        <div class="rnd-card-head">
          <div>
            <div class="rnd-card-code">${u.esc(n.noteNo)} · ${u.esc(u.dateOnly(n.expDate))} · ${u.esc(u.facName(n.factory))}</div>
            <h4 class="rnd-card-title">${u.esc(n.title)}</h4>
          </div>
          <div class="rnd-card-badges">
            ${u.badge(RndDB.NOTE_TYPES, n.type)}
            ${n.locked ? '<span class="badge badge-pass">서명·잠김</span>' : '<span class="badge badge-default">작성중</span>'}
            ${u.fileChip(n.files)}
          </div>
        </div>

        <div class="rnd-kv">
          ${n.projectId ? `<div><label>연결 과제</label><span>${u.esc(u.projectLabel(n.projectId))}</span></div>` : ''}
          <div><label>작성자</label><span>${u.esc(n.author || '-')}${n.locked ? ` · 점검 ${u.esc(n.witness)} (${u.esc(u.dateOnly(n.witnessedAt))})` : ''}</span></div>
          ${n.objective ? `<div><label>목적</label><span>${u.nl2br(n.objective)}</span></div>` : ''}
        </div>

        ${open ? `
          <div class="rnd-note-body">
            ${n.materials ? `<section><h5>사용 원료·시약</h5><p>${u.nl2br(n.materials)}</p></section>` : ''}
            ${n.method ? `<section><h5>실험 방법</h5><p>${u.nl2br(n.method)}</p></section>` : ''}
            ${n.result ? `<section><h5>결과</h5><p>${u.nl2br(n.result)}</p></section>` : ''}
            ${n.conclusion ? `<section><h5>고찰·결론</h5><p>${u.nl2br(n.conclusion)}</p></section>` : ''}
            ${n.nextPlan ? `<section><h5>다음 계획</h5><p>${u.nl2br(n.nextPlan)}</p></section>` : ''}
            ${u.fileStrip(n.files)}
          </div>` : ''}

        <div class="rnd-card-actions">
          <button class="btn btn-sm" onclick="RndNotePage.toggle('${n.id}')">${open ? '접기' : '본문 보기'}</button>
          ${!n.locked ? `<button class="btn btn-sm" onclick="RndNotePage.openEdit('${n.id}')">수정</button>` : ''}
          ${!n.locked ? `<button class="btn btn-sm btn-primary" onclick="RndNotePage.sign('${n.id}')">점검자 서명</button>` : ''}
          ${n.type === 'PLAN' && !n.locked ? `<button class="btn btn-sm" onclick="RndNotePage.toNote('${n.id}')">연구노트로 전환</button>` : ''}
          <button class="btn btn-sm btn-danger" onclick="RndNotePage.remove('${n.id}')">삭제</button>
        </div>
      </div>`;
  };

  const render = () => {
    const u = U();
    const all = RndDB.getNotesBy(u.fac());
    const rows = list();
    const projs = RndDB.getProjectsBy(u.fac());
    return `
      <div class="fade-in">
        <div class="module-hero mb-20">
          <div>
            <div class="module-kicker">연구관리 · 연구기록</div>
            <h2>연구기록관리</h2>
            <p>실험계획서와 연구노트를 남깁니다. 점검자가 서명하면 본문이 잠겨 사후 수정이 막힙니다 — 첨부 추가만 가능합니다.</p>
          </div>
          <div class="module-metrics">
            <div><span>${all.length}</span><label>전체 기록</label></div>
            <div><span>${all.filter(x => x.type === 'PLAN').length}</span><label>실험계획서</label></div>
            <div><span>${all.filter(x => x.type === 'NOTE').length}</span><label>연구노트</label></div>
            <div><span>${all.filter(x => x.locked).length}</span><label>서명 완료</label></div>
          </div>
        </div>

        ${u.toolbar('rnd-note', {
          placeholder: '제목 · 번호 · 목적 · 방법 · 결과 검색',
          q,
          onSearch: 'RndNotePage.onSearch',
          onAdd: 'RndNotePage.openAdd()',
          addLabel: '기록 작성',
          filters: u.selectFilter('rnd-note-type', RndDB.NOTE_TYPES, fType, 'RndNotePage.onType', '전체 유형')
            + `<select class="form-input rnd-filter" onchange="RndNotePage.onProject(this.value)">
                 <option value="">전체 과제</option>
                 ${projs.map(p => `<option value="${p.id}" ${fProject === p.id ? 'selected' : ''}>${u.esc(p.code)} · ${u.esc(p.name)}</option>`).join('')}
               </select>`,
        })}

        <div class="rnd-list">
          ${rows.length ? rows.map(card).join('')
            : u.emptyState('등록된 연구기록이 없습니다', '실험 전에는 실험계획서를, 실험 후에는 연구노트를 남기십시오.')}
        </div>

        ${modal()}
      </div>`;
  };

  const modal = () => {
    const u = U();
    const n = editId ? RndDB.getNoteById(editId) : null;
    return `
      <div class="modal-overlay" id="rnd-note-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <h3>${n ? '연구기록 수정' : '연구기록 작성'}</h3>
            <button class="modal-close" onclick="RndUI.closeModal('rnd-note-modal')">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group"><label class="form-label">제목 <em>*</em></label>
                <input type="text" class="form-input" id="nt-title" value="${u.esc(n?.title || '')}"></div>
              <div class="form-group"><label class="form-label">유형</label>
                <select class="form-input" id="nt-type">${u.options(RndDB.NOTE_TYPES, n?.type || 'PLAN')}</select></div>
              <div class="form-group"><label class="form-label">실험일</label>
                <input type="date" class="form-input" id="nt-date" value="${u.esc(n?.expDate || RndDB.todayStr())}"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">연결 과제</label>
                <select class="form-input" id="nt-project">${u.projectOptions(n?.projectId || '')}</select></div>
              <div class="form-group"><label class="form-label">공장·소속</label>
                <select class="form-input" id="nt-factory">${u.factoryOptions(n?.factory || u.defaultFactory())}</select></div>
              <div class="form-group"><label class="form-label">작성자</label>
                <input type="text" class="form-input" id="nt-author" value="${u.esc(n?.author || u.actorName())}" readonly></div>
            </div>
            <div class="form-group"><label class="form-label">목적·가설</label>
              <textarea class="form-input" id="nt-objective" rows="2" placeholder="무엇을 확인하려는 실험인가">${u.esc(n?.objective || '')}</textarea></div>
            <div class="form-group"><label class="form-label">사용 원료·시약·기기</label>
              <textarea class="form-input" id="nt-materials" rows="2" placeholder="원료 LOT·시약 규격·사용 기기까지 적어야 재현이 됩니다">${u.esc(n?.materials || '')}</textarea></div>
            <div class="form-group"><label class="form-label">실험 방법·조건</label>
              <textarea class="form-input" id="nt-method" rows="3">${u.esc(n?.method || '')}</textarea></div>
            <div class="form-group"><label class="form-label">결과</label>
              <textarea class="form-input" id="nt-result" rows="3" placeholder="수치는 단위와 반복수까지">${u.esc(n?.result || '')}</textarea></div>
            <div class="form-group"><label class="form-label">고찰·결론</label>
              <textarea class="form-input" id="nt-conclusion" rows="2">${u.esc(n?.conclusion || '')}</textarea></div>
            <div class="form-group"><label class="form-label">다음 계획</label>
              <textarea class="form-input" id="nt-next" rows="2">${u.esc(n?.nextPlan || '')}</textarea></div>
            ${u.attachBox('note', '실험 사진·크로마토그램·원시 데이터 엑셀 등')}
          </div>
          <div class="modal-footer">
            <button class="btn" onclick="RndUI.closeModal('rnd-note-modal')">취소</button>
            <button class="btn btn-primary" data-upload-lock onclick="RndNotePage.submit()">저장</button>
          </div>
        </div>
      </div>`;
  };

  const openAdd = () => { editId = null; App.refreshPage(); RndUI.resetBucket('note', []); RndUI.openModal('rnd-note-modal'); RndUI.renderBucket('note'); };
  const openEdit = (id) => {
    const n = RndDB.getNoteById(id);
    if (n?.locked) { App.toast('서명된 기록은 본문을 수정할 수 없습니다', 'warning'); return; }
    editId = id;
    App.refreshPage();
    RndUI.resetBucket('note', (n?.files || []).slice());
    RndUI.openModal('rnd-note-modal'); RndUI.renderBucket('note');
  };

  const submit = () => {
    const u = U();
    const title = u.val('nt-title');
    if (!title) { App.toast('제목을 입력하십시오', 'warning'); return; }
    const data = {
      title,
      type: u.val('nt-type'),
      expDate: u.val('nt-date'),
      projectId: u.val('nt-project'),
      factory: u.val('nt-factory'),
      author: u.val('nt-author') || u.actorName(),
      authorEmail: u.actorEmail(),
      objective: u.val('nt-objective'),
      materials: u.val('nt-materials'),
      method: u.val('nt-method'),
      result: u.val('nt-result'),
      conclusion: u.val('nt-conclusion'),
      nextPlan: u.val('nt-next'),
      files: u.bucket('note').slice(),
    };
    if (editId) RndDB.updateNote(editId, data); else RndDB.addNote(data);
    editId = null;
    RndUI.closeModal('rnd-note-modal');
    App.toast('연구기록을 저장했습니다', 'success');
    App.refreshPage();
  };

  const sign = (id) => {
    const n = RndDB.getNoteById(id);
    if (!n) return;
    const w = prompt('점검자 성명을 입력하십시오.\n서명하면 본문이 잠겨 더 이상 수정할 수 없습니다.', RndUI.actorName());
    if (!w) return;
    RndDB.signNote(id, w.trim());
    App.toast('서명했습니다 — 본문이 잠겼습니다', 'success');
    App.refreshPage();
  };

  // 실험계획서 → 연구노트: 목적·방법을 그대로 물려받아 결과만 채우게 한다
  const toNote = (id) => {
    const n = RndDB.getNoteById(id);
    if (!n) return;
    const created = RndDB.addNote({
      ...n, id: undefined, noteNo: undefined,
      type: 'NOTE',
      title: n.title,
      expDate: RndDB.todayStr(),
      result: '', conclusion: '', nextPlan: '',
      author: RndUI.actorName(), authorEmail: RndUI.actorEmail(),
      files: [],
    });
    App.toast(`연구노트 ${created.noteNo} 를 만들었습니다 — 결과를 채워 넣으십시오`, 'success');
    openId = created.id;
    App.refreshPage();
  };

  const remove = (id) => {
    const n = RndDB.getNoteById(id);
    if (n?.locked && !confirm('서명된 연구기록입니다. 그래도 삭제할까요?')) return;
    if (!n?.locked && !RndUI.confirmDelete('연구기록')) return;
    RndDB.removeNote(id); App.toast('삭제했습니다', 'success'); App.refreshPage();
  };

  const toggle = (id) => { openId = (openId === id ? null : id); repaintList(); };
  const onSearch = (v) => { q = v; repaintList(); };
  const onType = (v) => { fType = v; repaintList(); };
  const onProject = (v) => { fProject = v; repaintList(); };
  const repaintList = () => {
    const el = document.querySelector('.rnd-list');
    if (!el) return;
    const rows = list();
    el.innerHTML = rows.length ? rows.map(card).join('')
      : RndUI.emptyState('조건에 맞는 기록이 없습니다', '검색어나 필터를 바꿔보십시오.');
  };

  return { render, afterRender: () => {}, openAdd, openEdit, submit, sign, toNote, remove, toggle, onSearch, onType, onProject };
})();


// ============================================================
// 지식자산관리
// ============================================================
const RndKnowledgePage = (() => {
  const U = () => RndUI;
  let q = '', fCat = '', fTag = '';
  let editId = null, openId = null;

  const list = () => {
    const u = U();
    return RndDB.getKnowledgeBy(u.fac())
      .filter(k => !fCat || k.category === fCat)
      .filter(k => !fTag || (k.tags || []).includes(fTag))
      .filter(k => u.matches(q, k.title, k.summary, k.body, (k.tags || []).join(' '), k.author));
  };

  const card = (k) => {
    const u = U();
    const open = openId === k.id;
    return `
      <div class="card rnd-card">
        <div class="rnd-card-head">
          <div>
            <div class="rnd-card-code">${u.esc(k.code)} · ${u.esc(RndDB.knowCatLabel(k.category))} · ${u.esc(u.facName(k.factory))}</div>
            <h4 class="rnd-card-title">${u.esc(k.title)}</h4>
          </div>
          <div class="rnd-card-badges">
            <span class="rnd-chip">조회 ${Number(k.views) || 0}</span>
            ${u.fileChip(k.files)}
          </div>
        </div>

        ${k.summary ? `<p class="rnd-summary">${u.nl2br(k.summary)}</p>` : ''}

        ${(k.tags || []).length ? `<div class="rnd-tags">${k.tags.map(t =>
          `<button class="rnd-tag" onclick="RndKnowledgePage.onTag('${u.esc(t)}')">${u.esc(t)}</button>`).join('')}</div>` : ''}

        ${open ? `
          <div class="rnd-note-body">
            ${k.body ? `<section><p>${u.nl2br(k.body)}</p></section>` : ''}
            ${k.projectId ? `<section><h5>연결 과제</h5><p>${u.esc(u.projectLabel(k.projectId))}</p></section>` : ''}
            ${u.fileStrip(k.files)}
          </div>` : ''}

        <div class="rnd-card-foot">
          <span>${u.esc(k.author || '-')} · ${u.esc(u.dateOnly(k.updatedAt))}</span>
          <div class="rnd-card-actions">
            <button class="btn btn-sm" onclick="RndKnowledgePage.toggle('${k.id}')">${open ? '접기' : '전체 보기'}</button>
            <button class="btn btn-sm" onclick="RndKnowledgePage.openEdit('${k.id}')">수정</button>
            <button class="btn btn-sm btn-danger" onclick="RndKnowledgePage.remove('${k.id}')">삭제</button>
          </div>
        </div>
      </div>`;
  };

  const render = () => {
    const u = U();
    const all = RndDB.getKnowledgeBy(u.fac());
    const rows = list();
    const tags = RndDB.allTags(u.fac()).slice(0, 20);
    return `
      <div class="fade-in">
        <div class="module-hero mb-20">
          <div>
            <div class="module-kicker">연구관리 · 지식자산</div>
            <h2>지식자산관리</h2>
            <p>연구 데이터와 현장 노하우를 검색 가능한 형태로 쌓습니다. 담당자가 바뀌어도 남는 것이 목적입니다.</p>
          </div>
          <div class="module-metrics">
            <div><span>${all.length}</span><label>등록 지식</label></div>
            <div><span>${RndDB.allTags(u.fac()).length}</span><label>태그</label></div>
            <div><span>${all.filter(x => (x.files || []).length).length}</span><label>첨부 보유</label></div>
            <div><span>${all.reduce((s, x) => s + (Number(x.views) || 0), 0)}</span><label>누적 조회</label></div>
          </div>
        </div>

        <div class="card mb-16 rnd-searchall">
          <div class="card-title mb-12">통합 검색</div>
          <input type="text" class="form-input" id="rnd-all-q" placeholder="지식자산 · 연구기록 · 개발과제 · 협업내역을 한 번에 검색"
                 oninput="RndKnowledgePage.onSearchAll(this.value)">
          <div id="rnd-all-result" class="rnd-allresult"></div>
        </div>

        ${u.toolbar('rnd-know', {
          placeholder: '제목 · 요약 · 본문 · 태그 검색',
          q,
          onSearch: 'RndKnowledgePage.onSearch',
          onAdd: 'RndKnowledgePage.openAdd()',
          addLabel: '지식 등록',
          filters: u.selectFilter('rnd-know-cat', RndDB.KNOW_CATEGORIES, fCat, 'RndKnowledgePage.onCat', '전체 분류'),
        })}

        ${tags.length ? `<div class="rnd-tagbar">
          <button class="rnd-tag ${fTag ? '' : 'active'}" onclick="RndKnowledgePage.onTag('')">전체</button>
          ${tags.map(([t, n]) => `<button class="rnd-tag ${fTag === t ? 'active' : ''}" onclick="RndKnowledgePage.onTag('${u.esc(t)}')">${u.esc(t)} <em>${n}</em></button>`).join('')}
        </div>` : ''}

        <div class="rnd-list">
          ${rows.length ? rows.map(card).join('')
            : u.emptyState('등록된 지식자산이 없습니다', '트러블슈팅 한 건, 원료 특성 한 건부터 쌓으면 됩니다.')}
        </div>

        ${modal()}
      </div>`;
  };

  const modal = () => {
    const u = U();
    const k = editId ? RndDB.getKnowledgeById(editId) : null;
    return `
      <div class="modal-overlay" id="rnd-know-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <h3>${k ? '지식자산 수정' : '지식자산 등록'}</h3>
            <button class="modal-close" onclick="RndUI.closeModal('rnd-know-modal')">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group"><label class="form-label">제목 <em>*</em></label>
                <input type="text" class="form-input" id="kn-title" value="${u.esc(k?.title || '')}" placeholder="검색될 문장으로 적으십시오"></div>
              <div class="form-group"><label class="form-label">분류</label>
                <select class="form-input" id="kn-cat">${u.options(RndDB.KNOW_CATEGORIES, k?.category || 'PROCESS')}</select></div>
              <div class="form-group"><label class="form-label">공장·소속</label>
                <select class="form-input" id="kn-factory">${u.factoryOptions(k?.factory || u.defaultFactory())}</select></div>
            </div>
            <div class="form-group"><label class="form-label">한 줄 요약</label>
              <textarea class="form-input" id="kn-summary" rows="2" placeholder="목록에서 이 줄만 보고 열지 말지 판단합니다">${u.esc(k?.summary || '')}</textarea></div>
            <div class="form-group"><label class="form-label">본문</label>
              <textarea class="form-input" id="kn-body" rows="8" placeholder="배경 · 관찰 · 원인 · 조치 · 재발방지 순으로 적으면 나중에 쓰기 좋습니다">${u.esc(k?.body || '')}</textarea></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">태그</label>
                <input type="text" class="form-input" id="kn-tags" value="${u.esc((k?.tags || []).join(', '))}" placeholder="쉼표로 구분 — 펠릿, 조질, 호화"></div>
              <div class="form-group"><label class="form-label">연결 과제</label>
                <select class="form-input" id="kn-project">${u.projectOptions(k?.projectId || '')}</select></div>
              <div class="form-group"><label class="form-label">작성자</label>
                <input type="text" class="form-input" id="kn-author" value="${u.esc(k?.author || u.actorName())}" readonly></div>
            </div>
            ${u.attachBox('know', '원시 데이터·논문·성적서·사진 등')}
          </div>
          <div class="modal-footer">
            <button class="btn" onclick="RndUI.closeModal('rnd-know-modal')">취소</button>
            <button class="btn btn-primary" data-upload-lock onclick="RndKnowledgePage.submit()">저장</button>
          </div>
        </div>
      </div>`;
  };

  const openAdd = () => { editId = null; App.refreshPage(); RndUI.resetBucket('know', []); RndUI.openModal('rnd-know-modal'); RndUI.renderBucket('know'); };
  const openEdit = (id) => {
    editId = id;
    const k = RndDB.getKnowledgeById(id);
    App.refreshPage();
    RndUI.resetBucket('know', (k?.files || []).slice());
    RndUI.openModal('rnd-know-modal'); RndUI.renderBucket('know');
  };

  const submit = () => {
    const u = U();
    const title = u.val('kn-title');
    if (!title) { App.toast('제목을 입력하십시오', 'warning'); return; }
    const data = {
      title,
      category: u.val('kn-cat'),
      factory: u.val('kn-factory'),
      summary: u.val('kn-summary'),
      body: u.val('kn-body'),
      tags: u.val('kn-tags').split(',').map(s => s.trim()).filter(Boolean),
      projectId: u.val('kn-project'),
      author: u.val('kn-author') || u.actorName(),
      files: u.bucket('know').slice(),
    };
    if (editId) RndDB.updateKnowledge(editId, data); else RndDB.addKnowledge(data);
    editId = null;
    RndUI.closeModal('rnd-know-modal');
    App.toast('지식자산을 저장했습니다', 'success');
    App.refreshPage();
  };

  const remove = (id) => {
    if (!RndUI.confirmDelete('지식자산')) return;
    RndDB.removeKnowledge(id); App.toast('삭제했습니다', 'success'); App.refreshPage();
  };

  const toggle = (id) => {
    if (openId !== id) RndDB.bumpKnowledgeView(id);
    openId = (openId === id ? null : id);
    repaintList();
  };

  const onSearchAll = (v) => {
    const el = document.getElementById('rnd-all-result');
    if (!el) return;
    const hits = RndDB.searchAll(v, RndUI.fac());
    if (!String(v || '').trim()) { el.innerHTML = ''; return; }
    el.innerHTML = hits.length ? hits.map(h => `
      <div class="rnd-allrow" onclick="App.navigate('${h.page}')">
        <span class="rnd-chip">${RndUI.esc(h.kind)}</span>
        <strong>${RndUI.esc(h.title)}</strong>
        <em>${RndUI.esc(h.sub || '')}</em>
        <span class="rnd-allrow-date">${RndUI.esc(RndUI.dateOnly(h.at))}</span>
      </div>`).join('')
      : '<div class="rnd-files-empty">일치하는 기록이 없습니다</div>';
  };

  const onSearch = (v) => { q = v; repaintList(); };
  const onCat = (v) => { fCat = v; repaintList(); };
  const onTag = (t) => { fTag = (fTag === t ? '' : t); App.refreshPage(); };
  const repaintList = () => {
    const el = document.querySelector('.rnd-list');
    if (!el) return;
    const rows = list();
    el.innerHTML = rows.length ? rows.map(card).join('')
      : RndUI.emptyState('조건에 맞는 지식이 없습니다', '검색어·분류·태그를 바꿔보십시오.');
  };

  return { render, afterRender: () => {}, openAdd, openEdit, submit, remove, toggle, onSearch, onSearchAll, onCat, onTag };
})();


// ============================================================
// 협업관리
// ============================================================
const RndCollabPage = (() => {
  const U = () => RndUI;
  let q = '', fType = '', fStatus = '';
  let editId = null, openId = null, logFor = null;

  const list = () => {
    const u = U();
    return RndDB.getCollabsBy(u.fac())
      .filter(c => !fType || c.partnerType === fType)
      .filter(c => !fStatus || c.status === fStatus)
      .filter(c => u.matches(q, c.partnerName, c.theme, c.scope, c.contactName, u.projectLabel(c.projectId)));
  };

  const card = (c) => {
    const u = U();
    const open = openId === c.id;
    const logs = (c.logs || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return `
      <div class="card rnd-card">
        <div class="rnd-card-head">
          <div>
            <div class="rnd-card-code">${u.esc(c.code)} · ${u.esc(u.label(RndDB.PARTNER_TYPES, c.partnerType))} · ${u.esc(u.facName(c.factory))}</div>
            <h4 class="rnd-card-title">${u.esc(c.partnerName)}${c.theme ? ` <em>${u.esc(c.theme)}</em>` : ''}</h4>
          </div>
          <div class="rnd-card-badges">
            ${u.badge(RndDB.COLLAB_STATUS, c.status)}
            ${u.badge(RndDB.SHARE_LEVELS, c.shareLevel)}
            ${c.nda ? '<span class="badge badge-pass">NDA</span>' : '<span class="badge badge-warning">NDA 없음</span>'}
            ${u.fileChip(c.files)}
          </div>
        </div>

        <div class="rnd-kv">
          ${c.projectId ? `<div><label>연결 과제</label><span>${u.esc(u.projectLabel(c.projectId))}</span></div>` : ''}
          ${c.scope ? `<div><label>협업 범위</label><span>${u.nl2br(c.scope)}</span></div>` : ''}
          <div><label>담당자</label><span>${u.esc(c.contactName || '-')}${c.contactInfo ? ` · ${u.esc(c.contactInfo)}` : ''}</span></div>
          <div><label>기간</label><span>${u.esc(c.startDate || '-')} ~ ${u.esc(c.endDate || '-')} ${c.endDate && c.status === 'ACTIVE' ? u.ddayText(c.endDate) : ''}</span></div>
          <div><label>교류 이력</label><span>${logs.length}건${logs.length ? ` · 최근 ${u.esc(logs[0].date)} ${u.esc(logs[0].kind)}` : ''}</span></div>
        </div>

        ${open ? `
          <div class="rnd-note-body">
            <section>
              <h5>교류 이력</h5>
              ${logs.length ? `<div class="rnd-logs">${logs.map(l => `
                <div class="rnd-log">
                  <span class="rnd-log-date">${u.esc(l.date)}</span>
                  <span class="rnd-chip">${u.esc(l.kind)}</span>
                  <span class="rnd-log-sum">${u.nl2br(l.summary)}</span>
                  <span class="rnd-log-by">${u.esc(l.by || '')}</span>
                  <button class="btn btn-sm" onclick="RndCollabPage.delLog('${c.id}','${l.id}')">✕</button>
                </div>`).join('')}</div>` : '<p class="rnd-files-empty">기록된 교류 이력이 없습니다</p>'}
              <button class="btn btn-sm mt-8" onclick="RndCollabPage.openLog('${c.id}')">＋ 이력 추가</button>
            </section>
            ${u.fileStrip(c.files)}
          </div>` : ''}

        <div class="rnd-card-actions">
          <button class="btn btn-sm" onclick="RndCollabPage.toggle('${c.id}')">${open ? '접기' : '상세·이력'}</button>
          <button class="btn btn-sm" onclick="RndCollabPage.openLog('${c.id}')">이력 추가</button>
          <button class="btn btn-sm" onclick="RndCollabPage.openEdit('${c.id}')">수정</button>
          <button class="btn btn-sm btn-danger" onclick="RndCollabPage.remove('${c.id}')">삭제</button>
        </div>
      </div>`;
  };

  const render = () => {
    const u = U();
    const all = RndDB.getCollabsBy(u.fac());
    const rows = list();
    return `
      <div class="fade-in">
        <div class="module-hero mb-20">
          <div>
            <div class="module-kicker">연구관리 · 협업</div>
            <h2>협업관리</h2>
            <p>대학·연구기관·협력사와의 공동연구를 관리합니다. 어디까지 공유했는지(공유수준·NDA)를 반드시 남기십시오.</p>
          </div>
          <div class="module-metrics">
            <div><span>${all.filter(x => x.status === 'ACTIVE').length}</span><label>진행중</label></div>
            <div><span>${all.length}</span><label>전체 협업</label></div>
            <div><span>${all.filter(x => !x.nda).length}</span><label>NDA 미체결</label></div>
            <div><span>${all.reduce((s, x) => s + (x.logs || []).length, 0)}</span><label>교류 이력</label></div>
          </div>
        </div>

        ${all.filter(x => !x.nda && x.shareLevel !== 'OPEN' && x.status === 'ACTIVE').length ? `
          <div class="rnd-warnbar">
            NDA 없이 제한·기밀 자료를 공유 중인 협업이
            ${all.filter(x => !x.nda && x.shareLevel !== 'OPEN' && x.status === 'ACTIVE').length}건 있습니다. 계약 상태를 확인하십시오.
          </div>` : ''}

        ${u.toolbar('rnd-collab', {
          placeholder: '기관명 · 주제 · 범위 · 담당자 검색',
          q,
          onSearch: 'RndCollabPage.onSearch',
          onAdd: 'RndCollabPage.openAdd()',
          addLabel: '협업 등록',
          filters: u.selectFilter('rnd-collab-type', RndDB.PARTNER_TYPES, fType, 'RndCollabPage.onType', '전체 유형')
                 + u.selectFilter('rnd-collab-status', RndDB.COLLAB_STATUS, fStatus, 'RndCollabPage.onStatus', '전체 상태'),
        })}

        <div class="rnd-list">
          ${rows.length ? rows.map(card).join('')
            : u.emptyState('등록된 협업이 없습니다', '＋ 협업 등록으로 공동연구 상대와 범위를 기록하십시오.')}
        </div>

        ${modal()}
        ${logModal()}
      </div>`;
  };

  const modal = () => {
    const u = U();
    const c = editId ? RndDB.getCollabById(editId) : null;
    return `
      <div class="modal-overlay" id="rnd-collab-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <h3>${c ? '협업 수정' : '협업 등록'}</h3>
            <button class="modal-close" onclick="RndUI.closeModal('rnd-collab-modal')">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group"><label class="form-label">기관·부서명 <em>*</em></label>
                <input type="text" class="form-input" id="cb-partner" value="${u.esc(c?.partnerName || '')}"></div>
              <div class="form-group"><label class="form-label">유형</label>
                <select class="form-input" id="cb-type">${u.options(RndDB.PARTNER_TYPES, c?.partnerType || 'UNIV')}</select></div>
              <div class="form-group"><label class="form-label">공장·소속</label>
                <select class="form-input" id="cb-factory">${u.factoryOptions(c?.factory || u.defaultFactory())}</select></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">협업 주제</label>
                <input type="text" class="form-input" id="cb-theme" value="${u.esc(c?.theme || '')}"></div>
              <div class="form-group"><label class="form-label">연결 과제</label>
                <select class="form-input" id="cb-project">${u.projectOptions(c?.projectId || '')}</select></div>
            </div>
            <div class="form-group"><label class="form-label">협업 범위·역할 분담</label>
              <textarea class="form-input" id="cb-scope" rows="3" placeholder="상대가 무엇을 하고 우리가 무엇을 하는지, 산출물 귀속까지 적어두면 나중에 다툼이 없습니다">${u.esc(c?.scope || '')}</textarea></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">상대 담당자</label>
                <input type="text" class="form-input" id="cb-contact" value="${u.esc(c?.contactName || '')}"></div>
              <div class="form-group"><label class="form-label">연락처</label>
                <input type="text" class="form-input" id="cb-contactinfo" value="${u.esc(c?.contactInfo || '')}"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">시작일</label>
                <input type="date" class="form-input" id="cb-start" value="${u.esc(c?.startDate || RndDB.todayStr())}"></div>
              <div class="form-group"><label class="form-label">종료일</label>
                <input type="date" class="form-input" id="cb-end" value="${u.esc(c?.endDate || '')}"></div>
              <div class="form-group"><label class="form-label">공유 수준</label>
                <select class="form-input" id="cb-share">${u.options(RndDB.SHARE_LEVELS, c?.shareLevel || 'LIMITED')}</select></div>
              <div class="form-group"><label class="form-label">상태</label>
                <select class="form-input" id="cb-status">${u.options(RndDB.COLLAB_STATUS, c?.status || 'ACTIVE')}</select></div>
            </div>
            <div class="form-group">
              <label class="rnd-check"><input type="checkbox" id="cb-nda" ${c?.nda ? 'checked' : ''}> 비밀유지계약(NDA) 체결 완료</label>
            </div>
            ${u.attachBox('collab', '협약서·NDA·회의록·공동 실험 결과 등')}
          </div>
          <div class="modal-footer">
            <button class="btn" onclick="RndUI.closeModal('rnd-collab-modal')">취소</button>
            <button class="btn btn-primary" data-upload-lock onclick="RndCollabPage.submit()">저장</button>
          </div>
        </div>
      </div>`;
  };

  const logModal = () => {
    const u = U();
    return `
      <div class="modal-overlay" id="rnd-log-modal">
        <div class="modal">
          <div class="modal-header">
            <h3>교류 이력 추가</h3>
            <button class="modal-close" onclick="RndUI.closeModal('rnd-log-modal')">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group"><label class="form-label">일자</label>
                <input type="date" class="form-input" id="lg-date" value="${RndDB.todayStr()}"></div>
              <div class="form-group"><label class="form-label">구분</label>
                <select class="form-input" id="lg-kind">
                  ${['회의', '시료 송부', '시료 수령', '중간보고', '방문', '자료 공유', '기타']
                    .map(k => `<option value="${k}">${k}</option>`).join('')}
                </select></div>
            </div>
            <div class="form-group"><label class="form-label">내용</label>
              <textarea class="form-input" id="lg-summary" rows="3" placeholder="무엇을 주고받았는지 · 결정사항"></textarea></div>
            <div class="form-group"><label class="form-label">기록자</label>
              <input type="text" class="form-input" id="lg-by" value="${u.esc(u.actorName())}" readonly></div>
          </div>
          <div class="modal-footer">
            <button class="btn" onclick="RndUI.closeModal('rnd-log-modal')">취소</button>
            <button class="btn btn-primary" onclick="RndCollabPage.submitLog()">저장</button>
          </div>
        </div>
      </div>`;
  };

  const openAdd = () => { editId = null; App.refreshPage(); RndUI.resetBucket('collab', []); RndUI.openModal('rnd-collab-modal'); RndUI.renderBucket('collab'); };
  const openEdit = (id) => {
    editId = id;
    const c = RndDB.getCollabById(id);
    App.refreshPage();
    RndUI.resetBucket('collab', (c?.files || []).slice());
    RndUI.openModal('rnd-collab-modal'); RndUI.renderBucket('collab');
  };

  const submit = () => {
    const u = U();
    const partnerName = u.val('cb-partner');
    if (!partnerName) { App.toast('기관·부서명을 입력하십시오', 'warning'); return; }
    const data = {
      partnerName,
      partnerType: u.val('cb-type'),
      factory: u.val('cb-factory'),
      theme: u.val('cb-theme'),
      projectId: u.val('cb-project'),
      scope: u.val('cb-scope'),
      contactName: u.val('cb-contact'),
      contactInfo: u.val('cb-contactinfo'),
      startDate: u.val('cb-start'),
      endDate: u.val('cb-end'),
      shareLevel: u.val('cb-share'),
      status: u.val('cb-status'),
      nda: u.checked('cb-nda'),
      files: u.bucket('collab').slice(),
    };
    if (editId) RndDB.updateCollab(editId, data); else RndDB.addCollab(data);
    editId = null;
    RndUI.closeModal('rnd-collab-modal');
    App.toast('협업 정보를 저장했습니다', 'success');
    App.refreshPage();
  };

  const openLog = (id) => { logFor = id; RndUI.openModal('rnd-log-modal'); };
  const submitLog = () => {
    const u = U();
    if (!logFor) return;
    const summary = u.val('lg-summary');
    if (!summary) { App.toast('내용을 입력하십시오', 'warning'); return; }
    RndDB.addCollabLog(logFor, {
      date: u.val('lg-date'), kind: u.val('lg-kind'), summary, by: u.actorName(),
    });
    openId = logFor; logFor = null;
    RndUI.closeModal('rnd-log-modal');
    App.toast('교류 이력을 기록했습니다', 'success');
    App.refreshPage();
  };
  const delLog = (id, logId) => {
    if (!confirm('이 이력을 삭제할까요?')) return;
    RndDB.removeCollabLog(id, logId); App.refreshPage();
  };

  const remove = (id) => {
    if (!RndUI.confirmDelete('협업 기록')) return;
    RndDB.removeCollab(id); App.toast('삭제했습니다', 'success'); App.refreshPage();
  };

  const toggle = (id) => { openId = (openId === id ? null : id); repaintList(); };
  const onSearch = (v) => { q = v; repaintList(); };
  const onType = (v) => { fType = v; repaintList(); };
  const onStatus = (v) => { fStatus = v; repaintList(); };
  const repaintList = () => {
    const el = document.querySelector('.rnd-list');
    if (!el) return;
    const rows = list();
    el.innerHTML = rows.length ? rows.map(card).join('')
      : RndUI.emptyState('조건에 맞는 협업이 없습니다', '검색어나 필터를 바꿔보십시오.');
  };

  return { render, afterRender: () => {}, openAdd, openEdit, submit, openLog, submitLog, delLog, remove, toggle, onSearch, onType, onStatus };
})();
